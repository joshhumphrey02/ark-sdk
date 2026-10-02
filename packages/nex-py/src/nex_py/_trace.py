"""Distributed tracing, the part Nex needs: W3C ``traceparent`` in and out,
spans with ids, timing, status and attributes, and one sampling decision
per trace carried along by its ``sampled`` flag.
"""

from __future__ import annotations

import contextlib
import random
import re
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from ._redact import redact_bounded, truncate

_TRACEPARENT = re.compile(r"^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$")
MAX_ATTRIBUTES = 32


@dataclass(frozen=True)
class TraceContext:
    trace_id: str
    span_id: str
    sampled: bool


def new_trace_id() -> str:
    while True:
        value = secrets.token_hex(16)
        if value.strip("0"):
            return value


def new_span_id() -> str:
    while True:
        value = secrets.token_hex(8)
        if value.strip("0"):
            return value


def parse_traceparent(header: str | None) -> TraceContext | None:
    """``traceparent`` → context, or None when absent or malformed (a new trace starts)."""
    match = _TRACEPARENT.match((header or "").strip().lower())
    if not match or not match.group(1).strip("0") or not match.group(2).strip("0"):
        return None
    return TraceContext(match.group(1), match.group(2), bool(int(match.group(3), 16) & 1))


def format_traceparent(context: TraceContext) -> str:
    return f"00-{context.trace_id}-{context.span_id}-{'01' if context.sampled else '00'}"


def sample(rate: float, parent: TraceContext | None) -> bool:
    """Keep ``rate`` of new traces; a trace started elsewhere keeps its decision."""
    if parent is not None:
        return parent.sampled
    return rate >= 1 or (rate > 0 and random.random() < rate)


class Span:
    """One timed piece of work. ``end()`` once; unsampled spans are never sent."""

    def __init__(self, name: str, kind: str, parent: TraceContext | None, sampled: bool, on_end: Callable[[dict[str, Any]], None]) -> None:
        self.name = truncate(name, 300)
        self.kind = kind
        self.trace_id = parent.trace_id if parent else new_trace_id()
        self.parent_span_id = parent.span_id if parent else None
        self.span_id = new_span_id()
        self.sampled = sampled
        self.status = "ok"
        self.attributes: dict[str, str | int | float | bool] = {}
        self._started_at = time.time()
        self._started = time.perf_counter()
        self._ended = False
        self._on_end = on_end

    @property
    def context(self) -> TraceContext:
        return TraceContext(self.trace_id, self.span_id, self.sampled)

    @property
    def traceparent(self) -> str:
        return format_traceparent(self.context)

    def set_attribute(self, key: str, value: str | int | float | bool | None) -> Span:
        if value is None or (len(self.attributes) >= MAX_ATTRIBUTES and key not in self.attributes):
            return self
        self.attributes[truncate(key, 100)] = redact_bounded(value, 500) if isinstance(value, str) else value
        return self

    def set_status(self, status: str) -> Span:
        self.status = "error" if status == "error" else "ok"
        return self

    def end(self) -> None:
        if self._ended:
            return
        self._ended = True
        if not self.sampled:
            return
        payload: dict[str, Any] = {
            "traceId": self.trace_id,
            "spanId": self.span_id,
            "parentSpanId": self.parent_span_id,
            "name": self.name,
            "kind": self.kind,
            "status": self.status,
            "startTime": datetime.fromtimestamp(self._started_at, timezone.utc).isoformat(),
            "durationMs": round((time.perf_counter() - self._started) * 1000, 3),
        }
        if self.attributes:
            payload["attributes"] = dict(self.attributes)
        # Recording a span never breaks the code it measures.
        with contextlib.suppress(Exception):
            self._on_end(payload)
