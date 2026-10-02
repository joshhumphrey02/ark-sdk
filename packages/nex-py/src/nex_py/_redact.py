"""Redaction and size limits: nothing sensitive or unbounded leaves the process.

The same rules as the Node SDK: values under credential-looking keys are
replaced, and credentials inside text (SDK and API keys, bearer values, JWTs,
``password=`` pairs, URL passwords) are scrubbed before anything is queued.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping
from typing import Any

REDACTED = "[redacted]"

SENSITIVE_KEY = re.compile(
    r"^pass$|passw(or)?d|passphrase|secret|token|^auth$|authori[sz]ation|cookie|api[-_]?key|"
    r"access[-_]?key|credential|private[-_]?key|^session$|session[-_]?(id|token|key|secret)|"
    r"signature|jwt|bearer|card[-_]?number|^cvv$|^ssn$|dsn|database[-_]?url|conn(ection)?[-_]?str(ing)?",
    re.IGNORECASE,
)

_VALUE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"nsk_(live|test)_[A-Za-z0-9_-]{16,}"), REDACTED),
    (re.compile(r"ark_(live|test)_[A-Za-z0-9_-]{16,}"), REDACTED),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{16,}"), REDACTED),
    (re.compile(r"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}", re.IGNORECASE), r"\1 " + REDACTED),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}"), REDACTED),
    (
        re.compile(
            r"\b(password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|client[-_]?secret)"
            r"([\"']?\s*[:=]\s*[\"']?)([^\s\"'&,;]+)",
            re.IGNORECASE,
        ),
        r"\1\2" + REDACTED,
    ),
    # Bounded quantifiers keep this linear on long input.
    (re.compile(r"([a-z][a-z0-9+.-]{0,20}://)[^\s/:@]{1,256}:[^\s/@]{1,256}@", re.IGNORECASE), r"\1" + REDACTED + "@"),
]


def truncate(value: str, limit: int) -> str:
    return value if len(value) <= limit else value[: limit - 1] + "…"


def redact_string(value: str) -> str:
    for pattern, replacement in _VALUE_PATTERNS:
        value = pattern.sub(replacement, value)
    return value


def redact_bounded(value: str, limit: int) -> str:
    # Scrub a little past the limit so a secret cut at the edge is still caught.
    return truncate(redact_string(value[: limit + 512]), limit)


def strip_query(url: str) -> str:
    return re.split(r"[?#]", url, maxsplit=1)[0]


def redact(value: Any, extra_keys: Iterable[str] = (), _depth: int = 0) -> Any:
    """JSON-safe copy with sensitive keys and secret-looking text redacted."""
    extra = {k.lower() for k in extra_keys}
    if value is None or isinstance(value, (bool, int, float)):
        return value if not isinstance(value, float) or value == value else None
    if isinstance(value, str):
        return redact_bounded(value, 1_000)
    if _depth >= 5:
        return "[truncated]"
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for i, (key, item) in enumerate(value.items()):
            if i >= 100:
                break
            name = str(key)[:100]
            sensitive = SENSITIVE_KEY.search(name) or name.lower() in extra
            out[name] = REDACTED if sensitive else redact(item, extra, _depth + 1)
        return out
    if isinstance(value, (list, tuple, set, frozenset)):
        return [redact(item, extra, _depth + 1) for item in list(value)[:50]]
    try:
        return redact_bounded(str(value), 1_000)
    except Exception:
        return "[unserialisable]"


def bound_json(value: Any, max_bytes: int) -> Any:
    """``value`` if it serialises within ``max_bytes``, else a marker naming its keys."""
    try:
        size = len(json.dumps(value, default=str).encode())
    except Exception:
        return {"_truncated": True}
    if size <= max_bytes:
        return value
    keys = list(value.keys())[:20] if isinstance(value, Mapping) else []
    return {"_truncated": True, "_originalBytes": size, "keys": keys}
