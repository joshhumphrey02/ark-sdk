from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from conftest import json_response

from ark_py import Ark, ArkError

STREAM = {
    "id": "stream-1",
    "title": "clip",
    "status": "created",
    "encodeProgress": 0,
    "durationSeconds": 0,
    "width": 0,
    "height": 0,
    "size": 9,
    "thumbnailUrl": None,
    "hlsUrl": None,
    "embedUrl": None,
    "createdAt": "2026-09-03T00:00:00.000Z",
}


class TusServer:
    """A TUS endpoint that records what it was sent.

    `fail_at_offset` makes exactly one PATCH fail *after* accepting the bytes,
    which is the case worth testing: a client that assumes a failed request
    transferred nothing would resend those bytes and corrupt the video.
    """

    def __init__(self, total: int, *, fail_at_offset: int | None = None) -> None:
        self.total = total
        self.fail_at_offset = fail_at_offset
        self.received = bytearray()
        self.patches: list[int] = []
        self.head_calls = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/streams") and request.method == "POST":
            return json_response({"stream": STREAM, "upload": {"endpoint": "/streams/stream-1/upload"}})

        if request.url.path == "/api/v2/streams/stream-1/upload" and request.method == "POST":
            assert request.headers["upload-length"] == str(self.total)
            assert "filename" in request.headers["upload-metadata"]
            return httpx.Response(201, headers={"location": "/api/v2/streams/stream-1/upload/abc"})

        if request.url.path.endswith("/upload/abc") and request.method == "HEAD":
            self.head_calls += 1
            return httpx.Response(200, headers={"upload-offset": str(len(self.received))})

        if request.url.path.endswith("/upload/abc") and request.method == "PATCH":
            offset = int(request.headers["upload-offset"])
            self.patches.append(offset)
            body = request.read()
            # The server only accepts a write that starts where it left off.
            assert offset == len(self.received), "client resent or skipped bytes"
            self.received.extend(body)
            if self.fail_at_offset is not None and offset == self.fail_at_offset:
                self.fail_at_offset = None
                return httpx.Response(500, json={"error": "flaky"})
            return httpx.Response(204, headers={"upload-offset": str(len(self.received))})

        raise AssertionError(f"unexpected {request.method} {request.url}")


def client_for(server: TusServer) -> Ark:
    return Ark(
        "token",
        base_url="https://ark.test",
        client=httpx.Client(transport=httpx.MockTransport(server.handler)),
    )


def test_uploads_a_file_in_chunks(tmp_path: Path) -> None:
    path = tmp_path / "clip.mp4"
    path.write_bytes(b"abcdefghi")
    server = TusServer(9)

    stream = client_for(server).streams.upload(path, chunk_size=4)

    assert stream.id == "stream-1"
    assert bytes(server.received) == b"abcdefghi"
    assert server.patches == [0, 4, 8]


def test_resumes_from_the_server_offset_after_a_failure(tmp_path: Path) -> None:
    path = tmp_path / "clip.mp4"
    path.write_bytes(b"abcdefghi")
    # The failure lands after the server stored bytes 4-7.
    server = TusServer(9, fail_at_offset=4)

    client_for(server).streams.upload(path, chunk_size=4)

    # The whole file arrives exactly once: the retry asked where to continue
    # rather than resending the chunk that had in fact landed.
    assert bytes(server.received) == b"abcdefghi"
    assert server.head_calls == 1


def test_reports_progress(tmp_path: Path) -> None:
    path = tmp_path / "clip.mp4"
    path.write_bytes(b"abcdefghi")
    seen: list[tuple[int, int]] = []

    client_for(TusServer(9)).streams.upload(
        path, chunk_size=4, on_progress=lambda done, total: seen.append((done, total))
    )

    assert seen == [(4, 9), (8, 9), (9, 9)]


def test_derives_the_title_from_the_filename(tmp_path: Path) -> None:
    path = tmp_path / "my-launch-video.mp4"
    path.write_bytes(b"abc")
    titles: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/streams") and request.method == "POST":
            import json as _json

            titles.append(_json.loads(request.read())["title"])
            return json_response({"stream": STREAM, "upload": {"endpoint": "/streams/stream-1/upload"}})
        if request.method == "POST":
            return httpx.Response(201, headers={"location": "/api/v2/streams/stream-1/upload/abc"})
        return httpx.Response(204, headers={"upload-offset": "3"})

    Ark(
        "token",
        base_url="https://ark.test",
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    ).streams.upload(path)

    assert titles == ["my-launch-video"]


def test_rejects_an_invalid_chunk_size(tmp_path: Path) -> None:
    path = tmp_path / "clip.mp4"
    path.write_bytes(b"abc")

    with pytest.raises(ArkError) as excinfo:
        client_for(TusServer(3)).streams.upload(path, chunk_size=0)

    assert excinfo.value.code == "INVALID_ARGUMENT"


@pytest.mark.asyncio
async def test_async_upload_matches_the_sync_client(tmp_path: Path) -> None:
    """The async client must transfer identically, not merely succeed."""
    from ark_py import AsyncArk

    path = tmp_path / "clip.mp4"
    path.write_bytes(b"abcdefghi")
    server = TusServer(9, fail_at_offset=4)

    ark = AsyncArk(
        "token",
        base_url="https://ark.test",
        client=httpx.AsyncClient(transport=httpx.MockTransport(server.handler)),
    )
    stream = await ark.streams.upload(path, chunk_size=4)

    assert stream.id == "stream-1"
    assert bytes(server.received) == b"abcdefghi"
    assert server.head_calls == 1
