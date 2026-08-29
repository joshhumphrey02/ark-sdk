from __future__ import annotations

from typing import Any

import httpx


def json_response(data: Any, status: int = 200) -> httpx.Response:
    return httpx.Response(status, json=data)


def file_response(size: int, name: str = "upload.bin") -> dict[str, Any]:
    return {
        "id": "file-1",
        "name": name,
        "originalName": name,
        "size": size,
        "mimeType": "application/octet-stream",
        "folderId": None,
        "status": "available",
        "checksum": None,
        "url": f"https://files.test/{name}",
        "createdAt": "2026-01-01T00:00:00Z",
    }
