"""What a heartbeat reports besides "alive": outgoing calls per target (the
service map's edges), the process's vitals, and background jobs. Each is a
summary of the window since the previous heartbeat, bounded in memory and
reset when taken.
"""

from __future__ import annotations

import contextlib
import math
import os
import random
import re
import sys
import threading
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

from ._redact import truncate

SAMPLE_SIZE = 256
MAX_TARGETS = 50
MAX_JOBS = 100


class Durations:
    def __init__(self) -> None:
        self.count = 0
        self.errors = 0
        self.max = 0.0
        self._sample: list[float] = []

    def add(self, ms: float, failed: bool) -> None:
        self.count += 1
        if failed:
            self.errors += 1
        self.max = max(self.max, ms)
        if len(self._sample) < SAMPLE_SIZE:
            self._sample.append(ms)
        else:
            slot = random.randrange(self.count)
            if slot < SAMPLE_SIZE:
                self._sample[slot] = ms

    def percentile(self, p: float) -> int:
        if not self._sample:
            return 0
        ordered = sorted(self._sample)
        return round(ordered[min(len(ordered) - 1, int(p / 100 * len(ordered)))])


def call_target(url: str) -> str | None:
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    if not parts.hostname:
        return None
    host = f"{parts.hostname}:{parts.port}" if parts.port else parts.hostname
    return truncate(f"{parts.scheme}://{host}", 200)


class CallRecorder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._targets: dict[str, Durations] = {}

    def record(self, url: str, duration_ms: float, status: int | None, failed: bool) -> None:
        target = call_target(url)
        if not target:
            return
        with self._lock:
            entry = self._targets.get(target)
            if entry is None:
                if len(self._targets) >= MAX_TARGETS:
                    return
                entry = self._targets[target] = Durations()
            entry.add(duration_ms, failed or (status is not None and status >= 500))

    def take(self) -> list[dict[str, Any]]:
        with self._lock:
            targets, self._targets = self._targets, {}
        return [
            {"target": t, "kind": "http", "count": d.count, "errors": d.errors, "p50Ms": d.percentile(50), "p95Ms": d.percentile(95), "maxMs": round(d.max)}
            for t, d in targets.items()
        ]


def _iso(at: float) -> str:
    return datetime.fromtimestamp(at, timezone.utc).isoformat()


class JobRecorder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, tuple[Durations, float, float | None]] = {}

    def record(self, name: str, duration_ms: float, failed: bool) -> None:
        key = truncate(name, 200)
        now = time.time()
        with self._lock:
            entry = self._jobs.get(key)
            if entry is None:
                if len(self._jobs) >= MAX_JOBS:
                    return
                entry = (Durations(), now, None)
            durations, _, last_failed = entry
            durations.add(duration_ms, failed)
            self._jobs[key] = (durations, now, now if failed else last_failed)

    def take(self) -> list[dict[str, Any]]:
        with self._lock:
            jobs, self._jobs = self._jobs, {}
        out = []
        for name, (d, last_run, last_failed) in jobs.items():
            job: dict[str, Any] = {
                "name": name,
                "count": d.count,
                "failed": d.errors,
                "p50Ms": d.percentile(50),
                "p95Ms": d.percentile(95),
                "maxMs": round(d.max),
                "lastRunAt": _iso(last_run),
            }
            if last_failed is not None:
                job["lastFailedAt"] = _iso(last_failed)
            out.append(job)
        return out


def _rss_mb() -> float | None:
    """Current resident memory: /proc on Linux, psutil when installed, else peak RSS."""
    try:
        with open("/proc/self/statm") as f:
            pages = int(f.read().split()[1])
        return round(pages * os.sysconf("SC_PAGE_SIZE") / 1024 / 1024)
    except Exception:
        pass
    try:
        import psutil  # type: ignore[import-untyped,import-not-found,unused-ignore]

        return float(round(psutil.Process().memory_info().rss / 1024 / 1024))
    except Exception:
        pass
    try:
        import resource

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Bytes on macOS, kilobytes on Linux.
        return round(peak / 1024 / 1024 if sys.platform == "darwin" else peak / 1024)
    except Exception:
        return None


class RuntimeSampler:
    def __init__(self) -> None:
        self._cpu = time.process_time()
        self._at = time.monotonic()

    def take(self) -> dict[str, Any]:
        metrics: dict[str, Any] = {}
        rss = _rss_mb()
        if rss is not None:
            metrics["rssMb"] = rss
        cpu, at = time.process_time(), time.monotonic()
        if at > self._at:
            metrics["cpuPercent"] = round((cpu - self._cpu) / (at - self._at) * 100, 1)
        self._cpu, self._at = cpu, at
        metrics["threads"] = threading.active_count()
        return metrics


# --- Outgoing HTTP ------------------------------------------------------------------------------

OnCall = Callable[[str, float, "int | None", bool], None]
#: Tracing's part in an outgoing call: (method, url) → (traceparent, finish(status, failed)), or None.
OnStart = Callable[[str, str], "tuple[str, Callable[[int | None, bool], None]] | None"]


def install_http_observers(on_call: OnCall, skip_origin: str | None, on_start: OnStart | None = None) -> Callable[[], None]:
    """Times outgoing ``httpx`` and ``requests`` calls, and inside a trace adds
    ``traceparent`` to them. Otherwise the call is unchanged: the response and
    any exception pass straight through."""
    undo: list[Callable[[], None]] = []
    finishers: dict[int, Callable[[int | None, bool], None]] = {}

    def begin(method: str, url: str, headers: Any) -> None:
        if on_start is None or (skip_origin and url.startswith(skip_origin)):
            return
        with contextlib.suppress(Exception):
            hooks = on_start(method.upper(), url.split("?", 1)[0].split("#", 1)[0])
            if hooks is not None:
                headers["traceparent"] = hooks[0]
                finishers[id(headers)] = hooks[1]

    def observe(url: str, started: float, status: int | None, failed: bool, headers: Any = None) -> None:
        finish = finishers.pop(id(headers), None) if headers is not None else None
        if skip_origin and url.startswith(skip_origin):
            return
        with contextlib.suppress(Exception):
            if finish is not None:
                finish(status, failed or (status is not None and status >= 500))
            on_call(url, (time.perf_counter() - started) * 1000, status, failed)

    try:
        import httpx

        original_send = httpx.Client.send
        original_async_send = httpx.AsyncClient.send

        def send(self: httpx.Client, request: httpx.Request, *args: Any, **kwargs: Any) -> httpx.Response:
            started = time.perf_counter()
            begin(request.method, str(request.url), request.headers)
            try:
                response = original_send(self, request, *args, **kwargs)
            except Exception:
                observe(str(request.url), started, None, True, request.headers)
                raise
            observe(str(request.url), started, response.status_code, False, request.headers)
            return response

        async def async_send(self: httpx.AsyncClient, request: httpx.Request, *args: Any, **kwargs: Any) -> httpx.Response:
            started = time.perf_counter()
            begin(request.method, str(request.url), request.headers)
            try:
                response = await original_async_send(self, request, *args, **kwargs)
            except Exception:
                observe(str(request.url), started, None, True, request.headers)
                raise
            observe(str(request.url), started, response.status_code, False, request.headers)
            return response

        httpx.Client.send = send  # type: ignore[method-assign]
        httpx.AsyncClient.send = async_send  # type: ignore[method-assign]

        def undo_httpx() -> None:
            httpx.Client.send = original_send  # type: ignore[method-assign]
            httpx.AsyncClient.send = original_async_send  # type: ignore[method-assign]

        undo.append(undo_httpx)
    except Exception:
        pass

    try:
        import requests  # type: ignore[import-untyped,unused-ignore]

        original_requests_send = requests.Session.send

        def requests_send(self: Any, request: Any, **kwargs: Any) -> Any:
            started = time.perf_counter()
            begin(str(request.method), str(request.url), request.headers)
            try:
                response = original_requests_send(self, request, **kwargs)
            except Exception:
                observe(str(request.url), started, None, True, request.headers)
                raise
            observe(str(request.url), started, response.status_code, False, request.headers)
            return response

        requests.Session.send = requests_send

        def undo_requests() -> None:
            requests.Session.send = original_requests_send

        undo.append(undo_requests)
    except Exception:
        pass

    def uninstall() -> None:
        for fn in undo:
            fn()

    return uninstall


class RequestRecorder:
    """Incoming requests in the heartbeat window."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._durations = Durations()
        self._since = time.monotonic()

    def record(self, duration_ms: float, failed: bool) -> None:
        with self._lock:
            self._durations.add(duration_ms, failed)

    def take(self) -> dict[str, Any]:
        with self._lock:
            d, self._durations = self._durations, Durations()
            now = time.monotonic()
            window = max(1, round(now - self._since))
            self._since = now
        return {"count": d.count, "errors": d.errors, "p50Ms": d.percentile(50), "p95Ms": d.percentile(95), "maxMs": round(d.max), "windowSeconds": window}


_METRIC_NAME = re.compile(r"^[A-Za-z0-9_.:/-]{1,100}$")


class MetricRecorder:
    """Custom metrics between heartbeats: a gauge keeps its last value, a counter its sum."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._values: dict[str, dict[str, Any]] = {}

    def record(self, name: str, value: float, kind: str, unit: str | None = None) -> bool:
        if not _METRIC_NAME.match(name) or not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            return False
        with self._lock:
            existing = self._values.get(name)
            if existing is None and len(self._values) >= 100:
                return False
            if existing is not None and existing["type"] == "counter" and kind == "counter":
                existing["value"] += value
            else:
                self._values[name] = {"name": name, "type": kind, "value": value, **({"unit": truncate(unit, 20)} if unit else {})}
        return True

    def take(self) -> list[dict[str, Any]]:
        with self._lock:
            out = [dict(m) for m in self._values.values()]
            self._values = {k: v for k, v in self._values.items() if v["type"] != "counter"}
        return out
