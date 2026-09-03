from __future__ import annotations

import io
import json
import threading
import time
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import file_response, json_response

from ark_py import Ark, ArkError, ImageOptions

STREAM_RESPONSE = {
    "id": "stream-1",
    "title": "Launch",
    "status": "ready",
    "encodeProgress": 100,
    "durationSeconds": 12,
    "width": 1920,
    "height": 1080,
    "size": 42,
    "thumbnailUrl": "https://cdn.test/thumb.jpg",
    "hlsUrl": "https://cdn.test/playlist.m3u8",
    "embedUrl": "https://player.test/embed",
    "createdAt": "2026-09-03T00:00:00.000Z",
}


def client_for(handler: Any) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_default_url_and_encoded_identifiers() -> None:
    urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        return json_response(file_response(1))

    client = client_for(handler)
    ark = Ark("token", version="v2/../admin", client=client)
    ark.files.get("folder/../file?admin=true")

    assert urls == [
        "https://ark.nerdstackgrp.com/api/v2%2F..%2Fadmin/files/folder%2F..%2Ffile%3Fadmin%3Dtrue"
    ]
    client.close()


def test_resources_models_images_and_errors() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/files"):
            return json_response({"data": [file_response(4)], "nextCursor": "next"})
        if request.url.path.endswith("/folders"):
            return json_response({"data": [{"id": "folder-1", "name": "Media", "parentId": None}]})
        if request.url.path.endswith("/usage"):
            return json_response(
                {
                    "storage": {
                        "usedBytes": 4,
                        "pendingBytes": 0,
                        "limitBytes": 100,
                        "availableBytes": 96,
                    },
                    "tier": "paid",
                    "status": "active",
                }
            )
        if request.url.path.endswith("/client-sessions"):
            return json_response(
                {
                    "token": "arkc_test",
                    "expiresAt": "2026-01-01T00:15:00Z",
                    "expiresInSeconds": 900,
                    "scopes": ["uploads:create"],
                }
            )
        return json_response(
            {"error": {"code": "NOT_FOUND", "message": "missing", "requestId": "req-1"}},
            404,
        )

    client = client_for(handler)
    ark = Ark("token", client=client)
    page = ark.files.list(folder_id="folder-1", limit=10)
    assert page.data[0].original_name == "upload.bin"
    assert page.next_cursor == "next"
    assert ark.folders.list()[0].name == "Media"
    assert ark.usage().storage.available_bytes == 96
    assert ark.create_client_session(ttl_seconds=900).token == "arkc_test"
    assert ark.images.url(
        "asset/id",
        ImageOptions(width=600, format="webp", watermark=True),
    ).endswith("/assets/asset%2Fid/image?width=600&format=webp&watermark=1")
    with pytest.raises(ArkError) as caught:
        ark.files.get("missing")
    assert caught.value.code == "NOT_FOUND"
    assert caught.value.request_id == "req-1"
    client.close()


def test_streams_control_plane() -> None:
    requests: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, str(request.url)))
        if request.url.path.endswith("/streams") and request.method == "POST":
            return json_response(
                {"stream": STREAM_RESPONSE, "upload": {"endpoint": "/streams/stream-1/upload"}},
                201,
            )
        if request.url.path.endswith("/streams/fetch"):
            return json_response(STREAM_RESPONSE, 202)
        if request.url.path.endswith("/upload-url"):
            return json_response({"endpoint": "/streams/stream-1/upload?appId=app-1"})
        if request.method == "DELETE":
            return httpx.Response(204)
        if request.url.path.endswith("/stream-1"):
            return json_response(STREAM_RESPONSE)
        return json_response({"streams": [STREAM_RESPONSE], "nextCursor": "next"})

    client = client_for(handler)
    streams = Ark("token", base_url="https://ark.test", client=client).streams
    assert streams.create("Launch", 42, app_id="app-1").upload.endpoint.endswith("/upload")
    assert streams.import_from_url("Remote", "https://video.test/a.mp4").id == "stream-1"
    assert streams.list(app_id="app-1", limit=10).next_cursor == "next"
    assert streams.get("stream-1", app_id="app-1").hls_url is not None
    assert streams.refresh_upload_url("stream-1", app_id="app-1").endpoint.endswith("appId=app-1")
    assert streams.delete("stream-1", app_id="app-1") is None
    assert requests[2] == ("GET", "https://ark.test/api/v2/streams?appId=app-1&limit=10")
    client.close()


def test_single_path_upload_streams_and_completes(tmp_path: Path) -> None:
    data = b"streamed from disk"
    path = tmp_path / "photo.jpg"
    path.write_bytes(data)
    uploaded: list[bytes] = []
    completions: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/uploads/presign"):
            payload = json.loads(request.content)
            assert payload["size"] == len(data)
            assert payload["mimeType"] == "image/jpeg"
            return json_response(
                {
                    "uploadId": "upload/id",
                    "multipart": False,
                    "url": "https://storage.test/single",
                    "headers": {"x-upload": "required"},
                }
            )
        if request.url.host == "storage.test":
            uploaded.append(request.read())
            assert request.headers["content-length"] == str(len(data))
            assert request.headers["x-upload"] == "required"
            return httpx.Response(200)
        if request.url.path.endswith("/complete"):
            completions.append(json.loads(request.content))
            return json_response(file_response(len(data), "photo.jpg"))
        raise AssertionError(f"unexpected request: {request.url}")

    client = client_for(handler)
    file = Ark("token", base_url="https://ark.test", client=client).files.upload(path)
    assert file.size == len(data)
    assert uploaded == [data]
    assert completions == [{}]
    client.close()


def test_multipart_stream_is_bounded_and_sorted() -> None:
    data = bytes(range(19))
    uploaded: dict[int, bytes] = {}
    active = 0
    max_active = 0
    lock = threading.Lock()
    completion: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal active, max_active, completion
        if request.url.path.endswith("/uploads/presign"):
            return json_response(
                {
                    "uploadId": "upload-1",
                    "multipart": True,
                    "partSize": 4,
                    "maxConcurrency": 2,
                    "parts": [
                        {"partNumber": number, "url": f"https://storage.test/part-{number}"}
                        for number in range(1, 6)
                    ],
                }
            )
        if request.url.host == "storage.test":
            number = int(request.url.path.rsplit("-", 1)[1])
            with lock:
                active += 1
                max_active = max(max_active, active)
            try:
                uploaded[number] = request.read()
                time.sleep(0.005)
                return httpx.Response(200, headers={"etag": f'"etag-{number}"'})
            finally:
                with lock:
                    active -= 1
        if request.url.path.endswith("/complete"):
            completion = json.loads(request.content)
            return json_response(file_response(len(data)))
        raise AssertionError(f"unexpected request: {request.url}")

    client = client_for(handler)
    stream = io.BytesIO(data)
    Ark("token", base_url="https://ark.test", client=client).files.upload(
        stream,
        size=len(data),
        filename="upload.bin",
    )

    assert uploaded == {
        1: data[0:4],
        2: data[4:8],
        3: data[8:12],
        4: data[12:16],
        5: data[16:19],
    }
    assert max_active <= 2
    assert completion["parts"] == [
        {"partNumber": number, "etag": f"etag-{number}"} for number in range(1, 6)
    ]
    client.close()


@pytest.mark.parametrize(
    ("declared", "actual"),
    [(5, b"abc"), (2, b"abc")],
    ids=["underflow", "overflow"],
)
def test_invalid_stream_size_aborts_session(declared: int, actual: bytes) -> None:
    aborted = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal aborted
        if request.url.path.endswith("/uploads/presign"):
            return json_response(
                {
                    "uploadId": "upload-1",
                    "multipart": False,
                    "url": "https://storage.test/single",
                    "headers": {},
                }
            )
        if request.url.host == "storage.test":
            request.read()
            return httpx.Response(200)
        if request.url.path.endswith("/abort"):
            aborted = True
            return json_response({"aborted": True})
        raise AssertionError(f"unexpected request: {request.url}")

    client = client_for(handler)
    with pytest.raises(ArkError, match="upload stream") as caught:
        Ark("token", base_url="https://ark.test", client=client).files.upload(
            io.BytesIO(actual),
            size=declared,
            filename="invalid.bin",
        )
    assert caught.value.code == "INVALID_ARGUMENT"
    assert aborted is True
    client.close()


def test_non_seekable_stream_requires_size_and_filename() -> None:
    class NonSeekable(io.BytesIO):
        def seekable(self) -> bool:
            return False

    ark = Ark("token", client=client_for(lambda _: json_response({})))
    with pytest.raises(ArkError, match="size is required"):
        ark.files.upload(NonSeekable(b"data"), filename="file.bin")
    with pytest.raises(ArkError, match="filename is required"):
        ark.files.upload(NonSeekable(b"data"), size=4)
    ark._client.close()
