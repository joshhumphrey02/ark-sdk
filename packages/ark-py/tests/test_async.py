from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest
from conftest import file_response, json_response

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
