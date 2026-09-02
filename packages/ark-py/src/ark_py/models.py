from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal


@dataclass(frozen=True, slots=True)
class ArkFile:
    id: str
    name: str
    original_name: str
    size: int
    mime_type: str
    folder_id: str | None
    status: str
    checksum: str | None
    #: Permanent, unsigned CDN delivery URL. Safe to store; it does not expire.
    #: Use this value as-is -- never build a URL from the id or name, and never
    #: append a query parameter to reach a variant. ``thumbnail_url`` is the
    #: thumbnail.
    url: str
    #: Permanent CDN URL for the generated thumbnail, or None if there is none.
    thumbnail_url: str | None
    #: Permanent CDN URL for the compressed variant, or None if there is none.
    compressed_url: str | None
    created_at: str | None

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> ArkFile:
        return cls(
            id=str(value["id"]),
            name=str(value["name"]),
            original_name=str(value.get("originalName", value["name"])),
            size=int(value["size"]),
            mime_type=str(value.get("mimeType") or "application/octet-stream"),
            folder_id=_optional_string(value.get("folderId")),
            status=str(value.get("status") or "available"),
            checksum=_optional_string(value.get("checksum")),
            url=str(value.get("url") or ""),
            thumbnail_url=_optional_string(value.get("thumbnailUrl")),
            compressed_url=_optional_string(value.get("compressedUrl")),
            created_at=_optional_string(value.get("createdAt")),
        )


@dataclass(frozen=True, slots=True)
class ArkFolder:
    id: str
    name: str
    parent_id: str | None

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> ArkFolder:
        return cls(
            id=str(value["id"]),
            name=str(value["name"]),
            parent_id=_optional_string(value.get("parentId")),
        )


@dataclass(frozen=True, slots=True)
class StorageUsage:
    used_bytes: int
    pending_bytes: int
    limit_bytes: int
    available_bytes: int


@dataclass(frozen=True, slots=True)
class ArkUsage:
    storage: StorageUsage
    tier: Literal["free", "paid"] | str
    status: str

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> ArkUsage:
        storage = value.get("storage")
        if not isinstance(storage, Mapping):
            storage = {}
        return cls(
            storage=StorageUsage(
                used_bytes=int(storage.get("usedBytes", 0)),
                pending_bytes=int(storage.get("pendingBytes", 0)),
                limit_bytes=int(storage.get("limitBytes", 0)),
                available_bytes=int(storage.get("availableBytes", 0)),
            ),
            tier=str(value.get("tier") or "free"),
            status=str(value.get("status") or "active"),
        )


@dataclass(frozen=True, slots=True)
class FilePage:
    data: tuple[ArkFile, ...]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class ClientSession:
    token: str
    expires_at: str
    expires_in_seconds: int
    scopes: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ImageOptions:
    width: int | None = None
    height: int | None = None
    quality: int | None = None
    format: Literal["original", "jpeg", "png", "webp", "avif"] = "original"
    thumbnail: bool = False
    watermark: bool = False


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) else None
