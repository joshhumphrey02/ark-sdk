"""Exceptions as the chain Nex groups and shows: the exception, then what
caused it, each with its frames (most recent call first) marked as the
application's code or library/standard-library code.
"""

from __future__ import annotations

import os
import sysconfig
import traceback
from typing import Any

from ._redact import redact_bounded, truncate

MAX_FRAMES = 50
MAX_CHAIN = 5

_LIBRARY_DIRS = tuple(os.path.realpath(path) for key in ("stdlib", "platstdlib", "purelib", "platlib") if (path := sysconfig.get_paths().get(key)))


def is_in_app(filename: str | None) -> bool:
    if not filename or filename.startswith("<"):
        return False
    normalized = filename.replace("\\", "/")
    if "/site-packages/" in normalized or "/dist-packages/" in normalized:
        return False
    real = os.path.realpath(filename)
    return not any(real.startswith(directory + os.sep) for directory in _LIBRARY_DIRS)


def frames_of(exc: BaseException) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for frame, lineno in traceback.walk_tb(exc.__traceback__):
        code = frame.f_code
        frames.append(
            {
                "function": truncate(code.co_name, 200),
                "filename": truncate(code.co_filename, 500),
                "module": truncate(str(frame.f_globals.get("__name__", "")), 200) or None,
                "lineno": lineno,
                "inApp": is_in_app(code.co_filename),
            }
        )
    # Python lists the outermost call first; Nex wants the most recent first.
    frames.reverse()
    return [{k: v for k, v in f.items() if v is not None} for f in frames[:MAX_FRAMES]]


def exception_chain(exc: BaseException, *, mechanism: str, handled: bool) -> list[dict[str, Any]]:
    chain: list[dict[str, Any]] = []
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and len(chain) < MAX_CHAIN and id(current) not in seen:
        seen.add(id(current))
        entry: dict[str, Any] = {
            "type": truncate(type(current).__qualname__, 200),
            "value": redact_bounded(str(current), 4_000),
        }
        if not chain:
            entry["mechanism"] = {"type": mechanism, "handled": handled}
        frames = frames_of(current)
        if frames:
            entry["stacktrace"] = {"frames": frames}
        chain.append(entry)
        if current.__cause__ is not None:
            current = current.__cause__
        elif current.__context__ is not None and not current.__suppress_context__:
            current = current.__context__
        else:
            current = None
    return chain


def flat_error(exc: BaseException) -> dict[str, str]:
    """``{name, message, stack}`` for servers that predate exception chains."""
    stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return {
        "name": truncate(type(exc).__qualname__, 200),
        "message": redact_bounded(str(exc), 4_000),
        "stack": redact_bounded(stack, 16_000),
    }
