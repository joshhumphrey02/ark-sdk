"""Official Python SDK for Ark storage."""

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _version

from .async_client import AsyncArk
from .errors import ArkError
from .models import (
    ArkFile,
    ArkFolder,
    ArkStream,
    ArkUsage,
    ClientSession,
    FilePage,
    ImageOptions,
    StorageUsage,
    StreamCreation,
    StreamPage,
    StreamStatus,
    StreamUploadTicket,
)
from .s3 import create_s3_client
from .sync import Ark

__all__ = [
    "Ark",
    "ArkError",
    "ArkFile",
    "ArkFolder",
    "ArkStream",
    "ArkUsage",
    "AsyncArk",
    "ClientSession",
    "FilePage",
    "ImageOptions",
    "StorageUsage",
    "StreamCreation",
    "StreamPage",
    "StreamStatus",
    "StreamUploadTicket",
    "create_s3_client",
]

# Read from the installed distribution rather than hard-coded. This said
# "1.0.0" while pyproject.toml said 1.0.4, so anyone reporting a bug with
# ark_py.__version__ quoted a version that had not shipped in months.
try:  # pragma: no cover - depends on install state, not on logic
    __version__ = _version("nerdstack-ark")
except PackageNotFoundError:  # running from a source tree, not installed
    __version__ = "0.0.0.dev0"
