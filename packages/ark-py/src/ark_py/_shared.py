from __future__ import annotations

import base64
import mimetypes
import os
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO
from urllib.parse import quote, urlencode

from .errors import invalid_argument
from .models import ClientSession, ImageOptions

DEFAULT_BASE_URL = "https://ark.nerdstackgrp.com"
DEFAULT_CONTENT_TYPE = "application/octet-stream"


def api_url(base_url: str, version: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/api/{quote(version, safe='')}{path}"


def segment(value: str) -> str:
    return quote(value, safe="")


def image_url(base_url: str, version: str, asset_id: str, options: ImageOptions) -> str:
    query: dict[str, str] = {}
    if options.width is not None:
        query["width"] = str(options.width)
    if options.height is not None:
        query["height"] = str(options.height)
    if options.quality is not None:
        query["quality"] = str(options.quality)
    if options.format != "original":
        query["format"] = options.format
    if options.thumbnail:
        query["thumbnail"] = "1"
    if options.watermark:
        query["watermark"] = "1"
    suffix = f"?{urlencode(query)}" if query else ""
    return api_url(base_url, version, f"/assets/{segment(asset_id)}/image{suffix}")


def parse_client_session(value: Mapping[str, Any]) -> ClientSession:
    raw_scopes = value.get("scopes")
    scopes = tuple(str(scope) for scope in raw_scopes) if isinstance(raw_scopes, list) else ()
    return ClientSession(
        token=str(value["token"]),
        expires_at=str(value["expiresAt"]),
        expires_in_seconds=int(value["expiresInSeconds"]),
        scopes=scopes,
    )


@dataclass(frozen=True, slots=True)
class UploadSource:
    size: int
    filename: str
    content_type: str
    path: Path | None
    stream: BinaryIO | None


def resolve_upload_source(
    source: str | os.PathLike[str] | BinaryIO,
    *,
    size: int | None,
    filename: str | None,
    content_type: str | None,
) -> UploadSource:
    if isinstance(source, (str, os.PathLike)):
        path = Path(source)
        resolved_size = path.stat().st_size
        resolved_filename = filename or path.name
        guessed_type = mimetypes.guess_type(resolved_filename)[0]
        resolved_type = content_type or guessed_type or DEFAULT_CONTENT_TYPE
        validate_size(resolved_size)
        return UploadSource(resolved_size, resolved_filename, resolved_type, path, None)

    resolved_size = size if size is not None else infer_stream_size(source)
    validate_size(resolved_size)
    source_name = getattr(source, "name", None)
    stream_filename = filename or (Path(source_name).name if isinstance(source_name, str) else None)
    if not stream_filename:
        raise invalid_argument("filename is required for stream uploads")
    resolved_type = content_type or mimetypes.guess_type(stream_filename)[0] or DEFAULT_CONTENT_TYPE
    return UploadSource(resolved_size, stream_filename, resolved_type, None, source)


def infer_stream_size(stream: BinaryIO) -> int:
    if not stream.seekable():
        raise invalid_argument("size is required for non-seekable stream uploads")
    position = stream.tell()
    stream.seek(0, os.SEEK_END)
    end = stream.tell()
    stream.seek(position)
    return end - position


def validate_size(size: int) -> None:
    if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
        raise invalid_argument("upload size must be a positive integer")


def read_exact(stream: BinaryIO, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining:
        chunk = stream.read(remaining)
        if not chunk:
            actual = size - remaining
            raise invalid_argument(f"upload stream ended after {actual} bytes; expected {size}")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def ensure_stream_complete(stream: BinaryIO, declared_size: int) -> None:
    if stream.read(1):
        raise invalid_argument(f"upload stream produced more than {declared_size} bytes")


def iter_exact(stream: BinaryIO, size: int, chunk_size: int = 64 * 1024) -> Iterator[bytes]:
    sent = 0
    while sent < size:
        chunk = stream.read(min(chunk_size, size - sent))
        if not chunk:
            raise invalid_argument(f"upload stream ended after {sent} bytes; expected {size}")
        sent += len(chunk)
        yield chunk
    ensure_stream_complete(stream, size)


def iter_file_range(
    path: Path,
    start: int,
    size: int,
    chunk_size: int = 64 * 1024,
) -> Iterator[bytes]:
    with path.open("rb") as stream:
        stream.seek(start)
        remaining = size
        while remaining:
            chunk = stream.read(min(chunk_size, remaining))
            if not chunk:
                raise invalid_argument(f"file ended before the expected {size}-byte range")
            remaining -= len(chunk)
            yield chunk


def upload_payload(
    filename: str,
    size: int,
    content_type: str,
    folder_id: str | None,
    metadata: Mapping[str, Any] | None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "filename": filename,
        "size": size,
        "mimeType": content_type,
    }
    if folder_id is not None:
        payload["folderId"] = folder_id
    if metadata is not None:
        payload["metadata"] = dict(metadata)
    return payload


def query_string(values: Mapping[str, object | None]) -> str:
    filtered = {key: value for key, value in values.items() if value is not None}
    return f"?{urlencode(filtered)}" if filtered else ""


def sorted_parts(parts: Iterable[dict[str, object]]) -> list[dict[str, object]]:
    def part_number(part: dict[str, object]) -> int:
        value = part["partNumber"]
        if not isinstance(value, int):
            raise invalid_argument("multipart partNumber must be an integer")
        return value

    return sorted(parts, key=part_number)


# --- Ark Streams resumable upload (TUS) -------------------------------------
#
# Video goes to the encoding network over TUS rather than through the presigned
# path files use: an encode is long enough that a dropped connection is normal
# rather than exceptional, so the protocol has to be able to say "you already
# have the first N bytes, continue from there".

#: TUS sends metadata as base64, so a filename with non-ASCII characters
#: survives the header intact.
def tus_metadata(value: str) -> str:
    return base64.b64encode(value.encode("utf-8")).decode("ascii")


#: Default slice sent per PATCH. Large enough that a long video is not thousands
#: of round trips, small enough that a failure re-sends little.
DEFAULT_VIDEO_CHUNK_SIZE = 64 * 1024 * 1024

#: Consecutive failures tolerated per chunk before giving up. Each retry first
#: asks the server what it actually holds, so a retry never duplicates bytes.
MAX_VIDEO_CHUNK_RETRIES = 2


def validate_chunk_size(chunk_size: int) -> None:
    if isinstance(chunk_size, bool) or not isinstance(chunk_size, int) or chunk_size <= 0:
        raise invalid_argument("chunk_size must be a positive integer")


def resumed_offset(header: str | None, total: int, fallback: Exception) -> int:
    """Read an Upload-Offset the server reported, or re-raise.

    A server that answers with an offset past the end of the file, or with
    something unparseable, cannot be resumed from safely -- continuing would
    either skip bytes or corrupt the video.
    """
    try:
        offset = int(header or "")
    except ValueError:
        raise fallback from None
    if offset < 0 or offset > total:
        raise fallback
    return offset
