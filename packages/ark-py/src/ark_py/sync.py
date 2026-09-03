from __future__ import annotations

import builtins
from collections.abc import Mapping
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from contextlib import suppress
from pathlib import Path
from types import TracebackType
from typing import Any, BinaryIO, TypeVar, cast

import httpx

from ._shared import (
    DEFAULT_BASE_URL,
    UploadSource,
    api_url,
    ensure_stream_complete,
    image_url,
    iter_exact,
    iter_file_range,
    parse_client_session,
    query_string,
    read_exact,
    resolve_upload_source,
    segment,
    sorted_parts,
    upload_payload,
)
from .errors import ArkError, error_from_response, network_error, upload_error
from .models import (
    ArkFile,
    ArkFolder,
    ArkStream,
    ArkUsage,
    ClientSession,
    FilePage,
    ImageOptions,
    StreamCreation,
    StreamPage,
    StreamUploadTicket,
)

T = TypeVar("T")


class Ark:
    """Synchronous Ark client for Django, Flask, Celery, scripts, and workers."""

    def __init__(
        self,
        token: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        version: str = "v2",
        timeout: float | httpx.Timeout = 30.0,
        client: httpx.Client | None = None,
    ) -> None:
        if not token:
            raise ArkError("UNAUTHORIZED", "An Ark API token is required")
        self._token = token
        self._base_url = base_url.rstrip("/")
        self._version = version
        self._client = client or httpx.Client(timeout=timeout, follow_redirects=True)
        self._owns_client = client is None
        self.files = Files(self)
        self.folders = Folders(self)
        self.images = Images(self)
        self.imports = Imports(self)
        self.streams = Streams(self)

    def __enter__(self) -> Ark:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def usage(self) -> ArkUsage:
        return ArkUsage.from_dict(self._request("GET", "/usage"))

    def create_client_session(
        self,
        *,
        scopes: list[str] | None = None,
        folder_id: str | None = None,
        ttl_seconds: int | None = None,
    ) -> ClientSession:
        payload: dict[str, Any] = {}
        if scopes is not None:
            payload["scopes"] = scopes
        if folder_id is not None:
            payload["folderId"] = folder_id
        if ttl_seconds is not None:
            payload["ttlSeconds"] = ttl_seconds
        return parse_client_session(self._request("POST", "/client-sessions", json=payload))

    def _url(self, path: str) -> str:
        return api_url(self._base_url, self._version, path)

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            response = self._client.request(
                method,
                self._url(path),
                headers={"authorization": f"Bearer {self._token}"},
                json=dict(json) if json is not None else None,
            )
        except httpx.HTTPError as error:
            raise network_error(error) from error
        if response.is_error:
            raise error_from_response(response)
        if response.status_code == 204:
            return {}
        value = response.json()
        if not isinstance(value, dict):
            raise ArkError("INTERNAL_ERROR", "Ark returned an invalid JSON response")
        return cast(dict[str, Any], value)


class Files:
    def __init__(self, ark: Ark) -> None:
        self._ark = ark

    def list(
        self,
        *,
        folder_id: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> FilePage:
        suffix = query_string({"folderId": folder_id, "limit": limit, "cursor": cursor})
        value = self._ark._request("GET", f"/files{suffix}")
        raw_data = value.get("data")
        data = tuple(
            ArkFile.from_dict(item)
            for item in (raw_data if isinstance(raw_data, list) else [])
            if isinstance(item, Mapping)
        )
        next_cursor = value.get("nextCursor")
        return FilePage(data, next_cursor if isinstance(next_cursor, str) else None)

    def get(self, file_id: str) -> ArkFile:
        return ArkFile.from_dict(self._ark._request("GET", f"/files/{segment(file_id)}"))

    def delete(self, file_id: str) -> bool:
        value = self._ark._request("DELETE", f"/files/{segment(file_id)}")
        return bool(value.get("deleted"))

    def move(self, file_id: str, folder_id: str | None) -> ArkFile:
        value = self._ark._request(
            "PATCH",
            f"/files/{segment(file_id)}",
            json={"folderId": folder_id},
        )
        return ArkFile.from_dict(value)

    def get_download_url(self, file_id: str, *, expires_in_seconds: int | None = None) -> str:
        payload: dict[str, Any] = {"fileId": file_id}
        if expires_in_seconds is not None:
            payload["expiresInSeconds"] = expires_in_seconds
        value = self._ark._request("POST", "/downloads/presign", json=payload)
        return str(value["url"])

    def upload(
        self,
        source: str | Path | BinaryIO,
        *,
        size: int | None = None,
        filename: str | None = None,
        content_type: str | None = None,
        folder_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> ArkFile:
        resolved = resolve_upload_source(
            source,
            size=size,
            filename=filename,
            content_type=content_type,
        )
        session = self._ark._request(
            "POST",
            "/uploads/presign",
            json=upload_payload(
                resolved.filename,
                resolved.size,
                resolved.content_type,
                folder_id,
                metadata,
            ),
        )
        upload_id = str(session["uploadId"])
        try:
            parts = self._upload_transfer(resolved, session)
            completion: dict[str, Any] = {}
            if parts is not None:
                completion["parts"] = parts
            value = self._ark._request(
                "POST",
                f"/uploads/{segment(upload_id)}/complete",
                json=completion,
            )
            return ArkFile.from_dict(value)
        except BaseException:
            with suppress(ArkError):
                self._ark._request("POST", f"/uploads/{segment(upload_id)}/abort", json={})
            raise

    def _upload_transfer(
        self,
        source: UploadSource,
        session: Mapping[str, Any],
    ) -> builtins.list[dict[str, object]] | None:
        if not session.get("multipart"):
            url = str(session["url"])
            session_headers = session.get("headers")
            headers = {
                "content-type": source.content_type,
                "content-length": str(source.size),
                **(
                    {str(key): str(value) for key, value in session_headers.items()}
                    if isinstance(session_headers, Mapping)
                    else {}
                ),
            }
            content = (
                iter_file_range(source.path, 0, source.size)
                if source.path is not None
                else iter_exact(cast(BinaryIO, source.stream), source.size)
            )
            self._put(url, content, headers=headers)
            return None
        return self._upload_multipart(source, session)

    def _upload_multipart(
        self,
        source: UploadSource,
        session: Mapping[str, Any],
    ) -> builtins.list[dict[str, object]]:
        raw_parts = session.get("parts")
        if not isinstance(raw_parts, list) or not raw_parts:
            raise ArkError("INTERNAL_ERROR", "Ark returned an invalid multipart session")
        part_size = int(session["partSize"])
        concurrency = max(1, min(int(session.get("maxConcurrency") or 4), len(raw_parts)))
        results: list[dict[str, object]] = []
        pending: set[Future[dict[str, object]]] = set()

        def collect(done: set[Future[dict[str, object]]]) -> None:
            for future in done:
                results.append(future.result())

        with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="ark-upload") as pool:
            for raw_part in raw_parts:
                if not isinstance(raw_part, Mapping):
                    raise ArkError("INTERNAL_ERROR", "Ark returned an invalid multipart part")
                while len(pending) >= concurrency:
                    done, pending = wait(pending, return_when=FIRST_COMPLETED)
                    collect(done)
                part_number = int(raw_part["partNumber"])
                start = (part_number - 1) * part_size
                expected = min(part_size, source.size - start)
                if expected <= 0:
                    raise ArkError("INTERNAL_ERROR", "Multipart session exceeds upload size")
                content: bytes | Any
                if source.path is not None:
                    content = iter_file_range(source.path, start, expected)
                else:
                    content = read_exact(cast(BinaryIO, source.stream), expected)
                pending.add(
                    pool.submit(
                        self._put_part,
                        str(raw_part["url"]),
                        content,
                        expected,
                        part_number,
                    )
                )
            if source.stream is not None:
                ensure_stream_complete(source.stream, source.size)
            collect(pending)
        return sorted_parts(results)

    def _put_part(
        self,
        url: str,
        content: Any,
        size: int,
        part_number: int,
    ) -> dict[str, object]:
        response = self._put(
            url,
            content,
            headers={"content-length": str(size)},
            part_number=part_number,
        )
        etag = response.headers.get("etag", "").replace('"', "")
        if not etag:
            raise ArkError("UPLOAD_FAILED", f"Part {part_number} did not return an ETag")
        return {"partNumber": part_number, "etag": etag}

    def _put(
        self,
        url: str,
        content: Any,
        *,
        headers: Mapping[str, str],
        part_number: int | None = None,
    ) -> httpx.Response:
        try:
            response = self._ark._client.put(url, content=content, headers=headers)
        except httpx.HTTPError as error:
            raise network_error(error) from error
        if response.is_error:
            raise upload_error(response.status_code, part_number=part_number)
        return response


class Folders:
    def __init__(self, ark: Ark) -> None:
        self._ark = ark

    def list(self, *, parent_id: str | None = None) -> tuple[ArkFolder, ...]:
        value = self._ark._request("GET", f"/folders{query_string({'parentId': parent_id})}")
        raw_data = value.get("data")
        return tuple(
            ArkFolder.from_dict(item)
            for item in (raw_data if isinstance(raw_data, list) else [])
            if isinstance(item, Mapping)
        )

    def create(self, name: str, *, parent_id: str | None = None) -> ArkFolder:
        payload: dict[str, Any] = {"name": name}
        if parent_id is not None:
            payload["parentId"] = parent_id
        return ArkFolder.from_dict(self._ark._request("POST", "/folders", json=payload))

    def rename(self, folder_id: str, name: str) -> ArkFolder:
        return ArkFolder.from_dict(
            self._ark._request(
                "PATCH",
                f"/folders/{segment(folder_id)}",
                json={"name": name},
            )
        )


class Images:
    def __init__(self, ark: Ark) -> None:
        self._ark = ark

    def url(self, asset_id: str, options: ImageOptions | None = None) -> str:
        return image_url(
            self._ark._base_url,
            self._ark._version,
            asset_id,
            options or ImageOptions(),
        )

    def signed_url(self, asset_id: str, *, expires_in_seconds: int | None = None) -> str:
        suffix = query_string({"ttl": expires_in_seconds})
        value = self._ark._request(
            "GET",
            f"/assets/{segment(asset_id)}/signed-url{suffix}",
        )
        return str(value["url"])


class Imports:
    def __init__(self, ark: Ark) -> None:
        self._ark = ark

    def create(self, input: Mapping[str, Any]) -> dict[str, Any]:
        return self._ark._request("POST", "/imports", json=input)

    def get(self, import_id: str) -> dict[str, Any]:
        return self._ark._request("GET", f"/imports/{segment(import_id)}")

    def cancel(self, import_id: str) -> bool:
        value = self._ark._request("POST", f"/imports/{segment(import_id)}/cancel", json={})
        return bool(value.get("cancelled"))


class Streams:
    """Ark Streams video creation, import, playback metadata, and lifecycle APIs."""

    def __init__(self, ark: Ark) -> None:
        self._ark = ark

    def create(
        self,
        title: str,
        size_bytes: int,
        *,
        app_id: str | None = None,
        collection_id: str | None = None,
    ) -> StreamCreation:
        payload: dict[str, Any] = {"title": title, "sizeBytes": size_bytes}
        if app_id is not None:
            payload["appId"] = app_id
        if collection_id is not None:
            payload["collectionId"] = collection_id
        value = self._ark._request("POST", "/streams", json=payload)
        stream = value.get("stream")
        upload = value.get("upload")
        if not isinstance(stream, Mapping) or not isinstance(upload, Mapping):
            raise ArkError("INTERNAL_ERROR", "Ark returned an invalid stream creation response")
        return StreamCreation(
            ArkStream.from_dict(stream),
            StreamUploadTicket(str(upload["endpoint"])),
        )

    def import_from_url(
        self,
        title: str,
        url: str,
        *,
        app_id: str | None = None,
        access_token: str | None = None,
        size_bytes: int | None = None,
    ) -> ArkStream:
        payload: dict[str, Any] = {"title": title, "url": url}
        if app_id is not None:
            payload["appId"] = app_id
        if access_token is not None:
            payload["accessToken"] = access_token
        if size_bytes is not None:
            payload["sizeBytes"] = size_bytes
        return ArkStream.from_dict(self._ark._request("POST", "/streams/fetch", json=payload))

    def list(
        self,
        *,
        app_id: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> StreamPage:
        suffix = query_string({"appId": app_id, "limit": limit, "cursor": cursor})
        value = self._ark._request("GET", f"/streams{suffix}")
        raw_streams = value.get("streams")
        streams = tuple(
            ArkStream.from_dict(item)
            for item in (raw_streams if isinstance(raw_streams, list) else [])
            if isinstance(item, Mapping)
        )
        next_cursor = value.get("nextCursor")
        return StreamPage(streams, next_cursor if isinstance(next_cursor, str) else None)

    def get(self, stream_id: str, *, app_id: str | None = None) -> ArkStream:
        suffix = query_string({"appId": app_id})
        return ArkStream.from_dict(
            self._ark._request("GET", f"/streams/{segment(stream_id)}{suffix}")
        )

    def refresh_upload_url(
        self,
        stream_id: str,
        *,
        app_id: str | None = None,
    ) -> StreamUploadTicket:
        suffix = query_string({"appId": app_id})
        value = self._ark._request(
            "POST", f"/streams/{segment(stream_id)}/upload-url{suffix}", json={}
        )
        return StreamUploadTicket(str(value["endpoint"]))

    def delete(self, stream_id: str, *, app_id: str | None = None) -> None:
        suffix = query_string({"appId": app_id})
        self._ark._request("DELETE", f"/streams/{segment(stream_id)}{suffix}")
