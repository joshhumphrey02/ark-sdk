from __future__ import annotations

import asyncio
import builtins
import mimetypes
import os
from collections.abc import AsyncIterable, AsyncIterator, Mapping
from contextlib import suppress
from types import TracebackType
from typing import Any, BinaryIO, TypeVar, cast

import httpx

from ._shared import (
    DEFAULT_BASE_URL,
    DEFAULT_CONTENT_TYPE,
    UploadSource,
    api_url,
    image_url,
    parse_client_session,
    query_string,
    read_exact,
    resolve_upload_source,
    segment,
    sorted_parts,
    upload_payload,
    validate_size,
)
from .errors import ArkError, error_from_response, invalid_argument, network_error, upload_error
from .models import ArkFile, ArkFolder, ArkUsage, ClientSession, FilePage, ImageOptions

T = TypeVar("T")
AsyncSource = str | os.PathLike[str] | BinaryIO | AsyncIterable[bytes]


class AsyncArk:
    """Asynchronous Ark client for FastAPI, Starlette, aiohttp, and async workers."""

    def __init__(
        self,
        token: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        version: str = "v2",
        timeout: float | httpx.Timeout = 30.0,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not token:
            raise ArkError("UNAUTHORIZED", "An Ark API token is required")
        self._token = token
        self._base_url = base_url.rstrip("/")
        self._version = version
        self._client = client or httpx.AsyncClient(timeout=timeout, follow_redirects=True)
        self._owns_client = client is None
        self.files = AsyncFiles(self)
        self.folders = AsyncFolders(self)
        self.images = AsyncImages(self)
        self.imports = AsyncImports(self)

    async def __aenter__(self) -> AsyncArk:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def usage(self) -> ArkUsage:
        return ArkUsage.from_dict(await self._request("GET", "/usage"))

    async def create_client_session(
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
        return parse_client_session(await self._request("POST", "/client-sessions", json=payload))

    def _url(self, path: str) -> str:
        return api_url(self._base_url, self._version, path)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            response = await self._client.request(
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


class AsyncFiles:
    def __init__(self, ark: AsyncArk) -> None:
        self._ark = ark

    async def list(
        self,
        *,
        folder_id: str | None = None,
        limit: int | None = None,
        cursor: str | None = None,
    ) -> FilePage:
        suffix = query_string({"folderId": folder_id, "limit": limit, "cursor": cursor})
        value = await self._ark._request("GET", f"/files{suffix}")
        raw_data = value.get("data")
        data = tuple(
            ArkFile.from_dict(item)
            for item in (raw_data if isinstance(raw_data, list) else [])
            if isinstance(item, Mapping)
        )
        next_cursor = value.get("nextCursor")
        return FilePage(data, next_cursor if isinstance(next_cursor, str) else None)

    async def get(self, file_id: str) -> ArkFile:
        return ArkFile.from_dict(await self._ark._request("GET", f"/files/{segment(file_id)}"))

    async def delete(self, file_id: str) -> bool:
        value = await self._ark._request("DELETE", f"/files/{segment(file_id)}")
        return bool(value.get("deleted"))

    async def move(self, file_id: str, folder_id: str | None) -> ArkFile:
        value = await self._ark._request(
            "PATCH",
            f"/files/{segment(file_id)}",
            json={"folderId": folder_id},
        )
        return ArkFile.from_dict(value)

    async def get_download_url(
        self,
        file_id: str,
        *,
        expires_in_seconds: int | None = None,
    ) -> str:
        payload: dict[str, Any] = {"fileId": file_id}
        if expires_in_seconds is not None:
            payload["expiresInSeconds"] = expires_in_seconds
        value = await self._ark._request("POST", "/downloads/presign", json=payload)
        return str(value["url"])

    async def upload(
        self,
        source: AsyncSource,
        *,
        size: int | None = None,
        filename: str | None = None,
        content_type: str | None = None,
        folder_id: str | None = None,
        metadata: Mapping[str, Any] | None = None,
    ) -> ArkFile:
        async_stream = _as_async_iterable(source)
        if async_stream is not None:
            if size is None:
                raise invalid_argument("size is required for async stream uploads")
            validate_size(size)
            if not filename:
                raise invalid_argument("filename is required for async stream uploads")
            resolved: UploadSource | None = None
            resolved_size = size
            resolved_filename = filename
            resolved_type = (
                content_type or mimetypes.guess_type(filename)[0] or DEFAULT_CONTENT_TYPE
            )
        else:
            resolved = await asyncio.to_thread(
                resolve_upload_source,
                cast(str | os.PathLike[str] | BinaryIO, source),
                size=size,
                filename=filename,
                content_type=content_type,
            )
            resolved_size = resolved.size
            resolved_filename = resolved.filename
            resolved_type = resolved.content_type

        session = await self._ark._request(
            "POST",
            "/uploads/presign",
            json=upload_payload(
                resolved_filename,
                resolved_size,
                resolved_type,
                folder_id,
                metadata,
            ),
        )
        upload_id = str(session["uploadId"])
        try:
            parts = await self._upload_transfer(
                resolved,
                async_stream,
                resolved_size,
                resolved_type,
                session,
            )
            completion: dict[str, Any] = {}
            if parts is not None:
                completion["parts"] = parts
            value = await self._ark._request(
                "POST",
                f"/uploads/{segment(upload_id)}/complete",
                json=completion,
            )
            return ArkFile.from_dict(value)
        except BaseException:
            with suppress(ArkError):
                await self._ark._request(
                    "POST",
                    f"/uploads/{segment(upload_id)}/abort",
                    json={},
                )
            if async_stream is not None:
                await _close_async_iterator(async_stream)
            raise

    async def _upload_transfer(
        self,
        source: UploadSource | None,
        async_stream: AsyncIterator[bytes] | None,
        size: int,
        content_type: str,
        session: Mapping[str, Any],
    ) -> builtins.list[dict[str, object]] | None:
        if not session.get("multipart"):
            session_headers = session.get("headers")
            headers = {
                "content-type": content_type,
                "content-length": str(size),
                **(
                    {str(key): str(value) for key, value in session_headers.items()}
                    if isinstance(session_headers, Mapping)
                    else {}
                ),
            }
            content = _iter_resolved(source, async_stream, size)
            await self._put(str(session["url"]), content, headers=headers)
            return None
        return await self._upload_multipart(source, async_stream, size, session)

    async def _upload_multipart(
        self,
        source: UploadSource | None,
        async_stream: AsyncIterator[bytes] | None,
        size: int,
        session: Mapping[str, Any],
    ) -> builtins.list[dict[str, object]]:
        raw_parts = session.get("parts")
        if not isinstance(raw_parts, list) or not raw_parts:
            raise ArkError("INTERNAL_ERROR", "Ark returned an invalid multipart session")
        part_size = int(session["partSize"])
        concurrency = max(1, min(int(session.get("maxConcurrency") or 4), len(raw_parts)))
        semaphore = asyncio.Semaphore(concurrency)
        reader = AsyncChunkReader(async_stream, size) if async_stream is not None else None

        async def upload_part(
            raw_part: Mapping[str, Any],
            content: Any,
            expected: int,
        ) -> dict[str, object]:
            async with semaphore:
                part_number = int(raw_part["partNumber"])
                response = await self._put(
                    str(raw_part["url"]),
                    content,
                    headers={"content-length": str(expected)},
                    part_number=part_number,
                )
                etag = response.headers.get("etag", "").replace('"', "")
                if not etag:
                    raise ArkError("UPLOAD_FAILED", f"Part {part_number} did not return an ETag")
                return {"partNumber": part_number, "etag": etag}

        tasks: list[asyncio.Task[dict[str, object]]] = []
        try:
            for raw_part in raw_parts:
                if not isinstance(raw_part, Mapping):
                    raise ArkError("INTERNAL_ERROR", "Ark returned an invalid multipart part")
                while len([task for task in tasks if not task.done()]) >= concurrency:
                    done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                    for task in done:
                        task.result()
                part_number = int(raw_part["partNumber"])
                start = (part_number - 1) * part_size
                expected = min(part_size, size - start)
                if expected <= 0:
                    raise ArkError("INTERNAL_ERROR", "Multipart session exceeds upload size")
                if reader is not None:
                    content: Any = await reader.read_exact(expected)
                elif source is not None and source.stream is not None:
                    content = await asyncio.to_thread(read_exact, source.stream, expected)
                else:
                    content = _iter_resolved_range(cast(UploadSource, source), start, expected)
                tasks.append(asyncio.create_task(upload_part(raw_part, content, expected)))
            if reader is not None:
                await reader.assert_complete()
            elif source is not None and source.stream is not None:
                overflow = await asyncio.to_thread(source.stream.read, 1)
                if overflow:
                    raise invalid_argument(f"upload stream produced more than {source.size} bytes")
            return sorted_parts(await asyncio.gather(*tasks))
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            if reader is not None:
                await reader.aclose()
            raise

    async def _put(
        self,
        url: str,
        content: Any,
        *,
        headers: Mapping[str, str],
        part_number: int | None = None,
    ) -> httpx.Response:
        try:
            response = await self._ark._client.put(url, content=content, headers=headers)
        except httpx.HTTPError as error:
            raise network_error(error) from error
        if response.is_error:
            raise upload_error(response.status_code, part_number=part_number)
        return response


class AsyncFolders:
    def __init__(self, ark: AsyncArk) -> None:
        self._ark = ark

    async def list(self, *, parent_id: str | None = None) -> tuple[ArkFolder, ...]:
        value = await self._ark._request(
            "GET",
            f"/folders{query_string({'parentId': parent_id})}",
        )
        raw_data = value.get("data")
        return tuple(
            ArkFolder.from_dict(item)
            for item in (raw_data if isinstance(raw_data, list) else [])
            if isinstance(item, Mapping)
        )

    async def create(self, name: str, *, parent_id: str | None = None) -> ArkFolder:
        payload: dict[str, Any] = {"name": name}
        if parent_id is not None:
            payload["parentId"] = parent_id
        return ArkFolder.from_dict(await self._ark._request("POST", "/folders", json=payload))

    async def rename(self, folder_id: str, name: str) -> ArkFolder:
        return ArkFolder.from_dict(
            await self._ark._request(
                "PATCH",
                f"/folders/{segment(folder_id)}",
                json={"name": name},
            )
        )


class AsyncImages:
    def __init__(self, ark: AsyncArk) -> None:
        self._ark = ark

    def url(self, asset_id: str, options: ImageOptions | None = None) -> str:
        return image_url(
            self._ark._base_url,
            self._ark._version,
            asset_id,
            options or ImageOptions(),
        )

    async def signed_url(self, asset_id: str, *, expires_in_seconds: int | None = None) -> str:
        suffix = query_string({"ttl": expires_in_seconds})
        value = await self._ark._request(
            "GET",
            f"/assets/{segment(asset_id)}/signed-url{suffix}",
        )
        return str(value["url"])


class AsyncImports:
    def __init__(self, ark: AsyncArk) -> None:
        self._ark = ark

    async def create(self, input: Mapping[str, Any]) -> dict[str, Any]:
        return await self._ark._request("POST", "/imports", json=input)

    async def get(self, import_id: str) -> dict[str, Any]:
        return await self._ark._request("GET", f"/imports/{segment(import_id)}")

    async def cancel(self, import_id: str) -> bool:
        value = await self._ark._request(
            "POST",
            f"/imports/{segment(import_id)}/cancel",
            json={},
        )
        return bool(value.get("cancelled"))


def _as_async_iterable(source: AsyncSource) -> AsyncIterator[bytes] | None:
    method = getattr(source, "__aiter__", None)
    if method is None:
        return None
    return cast(AsyncIterable[bytes], source).__aiter__()


async def _close_async_iterator(source: AsyncIterator[bytes]) -> None:
    close = getattr(source, "aclose", None)
    if close is not None:
        await close()


async def _iter_resolved(
    source: UploadSource | None,
    async_stream: AsyncIterator[bytes] | None,
    size: int,
) -> AsyncIterator[bytes]:
    if async_stream is not None:
        reader = AsyncChunkReader(async_stream, size)
        try:
            while reader.consumed < size:
                yield await reader.read_exact(min(64 * 1024, size - reader.consumed))
            await reader.assert_complete()
        finally:
            await reader.aclose()
        return
    assert source is not None
    async for chunk in _iter_resolved_range(source, 0, size):
        yield chunk


async def _iter_resolved_range(source: UploadSource, start: int, size: int) -> AsyncIterator[bytes]:
    if source.path is not None:
        file_stream = await asyncio.to_thread(source.path.open, "rb")
        try:
            await asyncio.to_thread(file_stream.seek, start)
            remaining = size
            while remaining:
                chunk = await asyncio.to_thread(file_stream.read, min(64 * 1024, remaining))
                if not chunk:
                    raise invalid_argument("file ended before the expected upload range")
                remaining -= len(chunk)
                yield chunk
        finally:
            await asyncio.to_thread(file_stream.close)
        return
    binary_stream = cast(BinaryIO, source.stream)
    remaining = size
    while remaining:
        chunk = await asyncio.to_thread(binary_stream.read, min(64 * 1024, remaining))
        if not chunk:
            raise invalid_argument(f"upload stream ended early; expected {source.size} bytes")
        remaining -= len(chunk)
        yield chunk
    overflow = (
        await asyncio.to_thread(binary_stream.read, 1) if start + size == source.size else b""
    )
    if overflow:
        raise invalid_argument(f"upload stream produced more than {source.size} bytes")


class AsyncChunkReader:
    def __init__(self, source: AsyncIterator[bytes], declared_size: int) -> None:
        self._source = source
        self._declared_size = declared_size
        self._pending = b""
        self._done = False
        self.consumed = 0

    async def read_exact(self, size: int) -> bytes:
        output = bytearray()
        while len(output) < size:
            if not self._pending:
                try:
                    chunk = await self._source.__anext__()
                except StopAsyncIteration:
                    self._done = True
                    raise invalid_argument(
                        f"upload stream ended after {self.consumed + len(output)} bytes; "
                        f"expected {self._declared_size}"
                    ) from None
                if not isinstance(chunk, bytes):
                    raise invalid_argument("async upload streams must yield bytes")
                self._pending = chunk
                if not self._pending:
                    continue
            needed = size - len(output)
            output.extend(self._pending[:needed])
            self._pending = self._pending[needed:]
        self.consumed += size
        return bytes(output)

    async def assert_complete(self) -> None:
        if self.consumed != self._declared_size:
            raise invalid_argument(
                f"upload stream produced {self.consumed} bytes; expected {self._declared_size}"
            )
        if self._pending:
            raise invalid_argument(f"upload stream produced more than {self._declared_size} bytes")
        if not self._done:
            try:
                chunk = await self._source.__anext__()
            except StopAsyncIteration:
                self._done = True
                return
            if chunk:
                raise invalid_argument(
                    f"upload stream produced more than {self._declared_size} bytes"
                )

    async def aclose(self) -> None:
        close = getattr(self._source, "aclose", None)
        if close is not None:
            await close()
