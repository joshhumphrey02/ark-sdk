from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from conftest import file_response, json_response
from test_sync import STREAM_RESPONSE

from ark_py import ArkError, AsyncArk


def async_client_for(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_async_resources_and_default_url() -> None:
    urls: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        return json_response(
            {
                "storage": {
                    "usedBytes": 1,
                    "pendingBytes": 0,
                    "limitBytes": 10,
                    "availableBytes": 9,
                },
                "tier": "free",
                "status": "active",
            }
        )

    client = async_client_for(handler)
    ark = AsyncArk("token", client=client)
    assert (await ark.usage()).storage.used_bytes == 1
    assert urls == ["https://ark.nerdstackgrp.com/api/v2/usage"]
    await client.aclose()


@pytest.mark.asyncio
async def test_async_streams_control_plane() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/streams") and request.method == "POST":
            return json_response(
                {"stream": STREAM_RESPONSE, "upload": {"endpoint": "/streams/stream-1/upload"}},
                201,
            )
        if request.url.path.endswith("/streams/fetch"):
            return json_response(STREAM_RESPONSE, 202)
        if request.url.path.endswith("/upload-url"):
            return json_response({"endpoint": "/streams/stream-1/upload"})
        if request.method == "DELETE":
            return httpx.Response(204)
        if request.url.path.endswith("/stream-1"):
            return json_response(STREAM_RESPONSE)
        return json_response({"streams": [STREAM_RESPONSE], "nextCursor": None})

    client = async_client_for(handler)
    streams = AsyncArk("token", base_url="https://ark.test", client=client).streams
    assert (await streams.create("Launch", 42)).stream.id == "stream-1"
    assert (await streams.import_from_url("Remote", "https://video.test/a.mp4")).size == 42
    assert len((await streams.list(app_id="app-1")).streams) == 1
    assert (await streams.get("stream-1")).status == "ready"
    assert (await streams.refresh_upload_url("stream-1")).endpoint.endswith("/upload")
    assert await streams.delete("stream-1") is None
    await client.aclose()


@pytest.mark.asyncio
async def test_async_iterable_multipart_upload_is_bounded() -> None:
    data = bytes(range(10))
    uploaded: dict[int, bytes] = {}
    active = 0
    max_active = 0
    completion: dict[str, Any] = {}
    closed = False

    async def source() -> AsyncIterator[bytes]:
        nonlocal closed
        try:
            yield data[:1]
            yield data[1:7]
            yield data[7:]
        finally:
            closed = True

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal active, max_active, completion
        if request.url.path.endswith("/uploads/presign"):
            return json_response(
                {
                    "uploadId": "upload/id",
                    "multipart": True,
                    "partSize": 4,
                    "maxConcurrency": 2,
                    "parts": [
                        {"partNumber": number, "url": f"https://storage.test/part-{number}"}
                        for number in range(1, 4)
                    ],
                }
            )
        if request.url.host == "storage.test":
            number = int(request.url.path.rsplit("-", 1)[1])
            active += 1
            max_active = max(max_active, active)
            try:
                uploaded[number] = await request.aread()
                await asyncio.sleep(0.005)
                return httpx.Response(200, headers={"etag": f'"etag-{number}"'})
            finally:
                active -= 1
        if request.url.path.endswith("/complete"):
            completion = json.loads(request.content)
            return json_response(file_response(len(data)))
        raise AssertionError(f"unexpected request: {request.url}")

    client = async_client_for(handler)
    file = await AsyncArk("token", base_url="https://ark.test", client=client).files.upload(
        source(),
        size=len(data),
        filename="upload.bin",
    )
    assert file.size == len(data)
    assert uploaded == {1: data[:4], 2: data[4:8], 3: data[8:]}
    assert max_active <= 2
    assert completion["parts"] == [
        {"partNumber": 1, "etag": "etag-1"},
        {"partNumber": 2, "etag": "etag-2"},
        {"partNumber": 3, "etag": "etag-3"},
    ]
    assert closed is True
    await client.aclose()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("declared", "actual"),
    [(5, b"abc"), (2, b"abc")],
    ids=["underflow", "overflow"],
)
async def test_async_stream_size_mismatch_aborts(declared: int, actual: bytes) -> None:
    aborted = False
    closed = False

    async def source() -> AsyncIterator[bytes]:
        nonlocal closed
        try:
            yield actual
        finally:
            closed = True

    async def handler(request: httpx.Request) -> httpx.Response:
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
            await request.aread()
            return httpx.Response(200)
        if request.url.path.endswith("/abort"):
            aborted = True
            return json_response({"aborted": True})
        raise AssertionError(f"unexpected request: {request.url}")

    client = async_client_for(handler)
    with pytest.raises(ArkError, match="upload stream") as caught:
        await AsyncArk("token", base_url="https://ark.test", client=client).files.upload(
            source(),
            size=declared,
            filename="invalid.bin",
        )
    assert caught.value.code == "INVALID_ARGUMENT"
    assert aborted is True
    assert closed is True
    await client.aclose()


@pytest.mark.asyncio
async def test_async_upload_requires_stream_metadata() -> None:
    async def source() -> AsyncIterator[bytes]:
        yield b"data"

    client = async_client_for(lambda _: json_response({}))
    ark = AsyncArk("token", client=client)
    with pytest.raises(ArkError, match="size is required"):
        await ark.files.upload(source(), filename="file.bin")
    with pytest.raises(ArkError, match="filename is required"):
        await ark.files.upload(source(), size=4)
    await client.aclose()


@pytest.mark.asyncio
async def test_async_folders_list_reads_the_api_envelope() -> None:
    """The async client had no folder coverage at all, which is why it carried
    the same 'data' vs 'folders' bug as the sync client and nothing caught it.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(
            {
                "folders": [
                    {"id": "folder-1", "name": "Media", "parentId": None},
                    {"id": "folder-2", "name": "Docs", "parentId": "folder-1"},
                ],
                "pagination": {"page": 1, "limit": 50, "total": 2, "pages": 1},
            }
        )

    client = async_client_for(handler)
    ark = AsyncArk("token", client=client)
    folders = await ark.folders.list()
    assert [folder.name for folder in folders] == ["Media", "Docs"]
    await client.aclose()


@pytest.mark.asyncio
async def test_async_folders_list_still_accepts_a_data_envelope() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response({"data": [{"id": "f1", "name": "Legacy", "parentId": None}]})

    client = async_client_for(handler)
    ark = AsyncArk("token", client=client)
    assert [folder.name for folder in await ark.folders.list()] == ["Legacy"]
    await client.aclose()


@pytest.mark.asyncio
async def test_async_folders_list_rejects_an_unrecognised_body() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response({"unexpected": []})

    client = async_client_for(handler)
    ark = AsyncArk("token", client=client)
    with pytest.raises(ArkError) as caught:
        await ark.folders.list()
    assert caught.value.code == "INVALID_RESPONSE"
    await client.aclose()


@pytest.mark.asyncio
async def test_async_folders_list_passes_parent_id_through() -> None:
    """Nested resolution walks children level by level, so parentId has to
    reach the query string for anything below the root to be listable."""
    urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        return json_response({"folders": [], "pagination": {"total": 0}})

    client = async_client_for(handler)
    ark = AsyncArk("token", client=client)
    await ark.folders.list(parent_id="folder-1")
    assert "parentId=folder-1" in urls[0]
    await client.aclose()
