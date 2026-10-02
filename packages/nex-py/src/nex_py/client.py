"""The Nex client.

Safe to call from anywhere, at any time:

- capture methods are synchronous, never raise, and only queue the event;
  a background thread sends batches, so this works the same in Flask,
  Django, FastAPI, Celery workers and scripts;
- Nex being slow, down or misconfigured can never hurt the application:
  requests time out, retries are bounded, repeated failures pause sending,
  the buffer is capped, and a rejected token stops reporting;
- the thread is a daemon and the client flushes (bounded) at exit.
"""

from __future__ import annotations

import atexit
import concurrent.futures
import contextlib
import functools
import inspect
import json
import logging
import os
import platform
import re
import sys
import threading
import time
from collections import deque
from collections.abc import Awaitable, Callable, Iterator, Mapping
from datetime import datetime, timezone
from typing import Any, TypeVar, cast

import httpx

from ._redact import bound_json, redact, redact_bounded, strip_query, truncate
from ._scope import Scope, current_scope, pop_scope, push_scope
from ._stack import exception_chain, flat_error
from ._stats import CallRecorder, JobRecorder, RuntimeSampler, install_http_observers
from .checks import DependencyCheck, clean_target

__version__ = "0.1.0"
SDK_NAME = "nex-py"

log = logging.getLogger("nex")

TOKEN_PATTERN = re.compile(r"^nsk_(live|test)_[A-Za-z0-9_-]{20,}$")
SERVICE_PATTERN = re.compile(r"^[a-z0-9]+(?:[-_.][a-z0-9]+)*$")
API_PATH = "/api/v1/monitoring"

LEVELS = {"debug": "INFO", "info": "INFO", "warning": "WARNING", "error": "ERROR", "critical": "CRITICAL", "fatal": "CRITICAL"}
ENVIRONMENTS = {
    "production": "production",
    "prod": "production",
    "staging": "staging",
    "stage": "staging",
    "development": "development",
    "dev": "development",
    "local": "development",
}

MAX_BATCH = 25
MAX_BATCH_BYTES = 900_000
METADATA_BYTES = 8_000
FAILURES_BEFORE_PAUSE = 3
BASE_PAUSE = 30.0
MAX_PAUSE = 300.0

Check = Callable[[], Any] | DependencyCheck
F = TypeVar("F", bound=Callable[..., Any])
DEPENDENCY_STATUSES = ("healthy", "degraded", "unhealthy", "down", "unknown")


class MonitoringConfigError(ValueError):
    """Raised once, at startup, when monitoring is configured but invalid."""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("Nex is misconfigured: " + "; ".join(problems))
        self.problems = problems


def _first(*values: str | None) -> str | None:
    for value in values:
        if value and value.strip():
            return value.strip()
    return None


def normalize_environment(value: str | None) -> str | None:
    if not value:
        return None
    return ENVIRONMENTS.get(value.strip().lower(), value.strip().lower())


def _api_url(raw: str) -> str:
    url = raw.rstrip("/")
    # The older form is the site origin; the API lives under API_PATH there.
    if re.fullmatch(r"https?://[^/]+", url):
        url += API_PATH
    return url


def _status_from(dependencies: Mapping[str, Mapping[str, Any]]) -> str:
    return "degraded" if any(d["status"] in ("down", "unhealthy", "degraded") for d in dependencies.values()) else "healthy"


def _dependency_status(value: Any) -> str:
    if value is True:
        return "healthy"
    if value is False or value is None:
        return "down"
    return value if value in DEPENDENCY_STATUSES else "unknown"


def _dependency_report(
    result: Any, *, kind: str | None = None, target: str | None = None, latency_ms: float | None = None, error: str | None = None
) -> dict[str, Any]:
    """A check's result → the report sent: bounded, without credentials."""
    data = result if isinstance(result, Mapping) else None
    report: dict[str, Any] = {"status": _dependency_status(data.get("status") if data is not None else result)}
    kind = (data or {}).get("kind") or kind
    target = clean_target((data or {}).get("target") or target)
    if kind:
        report["kind"] = truncate(str(kind), 40)
    if target:
        report["target"] = target
    latency = (data or {}).get("latencyMs", latency_ms)
    if isinstance(latency, (int, float)) and not isinstance(latency, bool):
        report["latencyMs"] = max(0, round(latency))
    metrics = (data or {}).get("metrics")
    if isinstance(metrics, Mapping):
        clean = {truncate(str(k), 80): v for k, v in list(metrics.items())[:40] if isinstance(v, (int, float)) and not isinstance(v, bool)}
        if clean:
            report["metrics"] = clean
    error = (data or {}).get("error") or error
    if error:
        report["error"] = redact_bounded(str(error), 500)
    return report


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _active_trace() -> dict[str, str]:
    """The OpenTelemetry trace an event happens in, when OpenTelemetry is used."""
    try:
        from opentelemetry import trace  # type: ignore[import-not-found]

        context = trace.get_current_span().get_span_context()
        if context.is_valid:
            return {"traceId": f"{context.trace_id:032x}", "spanId": f"{context.span_id:016x}"}
    except Exception:
        pass
    return {}


class Monitoring:
    def __init__(
        self,
        *,
        api_url: str | None = None,
        token: str | None = None,
        service: str | None = None,
        environment: str | None = None,
        release: str | None = None,
        enabled: bool | None = None,
        flush_interval: float = 1.0,
        max_buffer: int = 1_000,
        timeout: float = 3.0,
        dedupe_window: float = 2.0,
        redact_keys: tuple[str, ...] = (),
        before_send: Callable[[dict[str, Any]], dict[str, Any] | None] | None = None,
        checks: Mapping[str, Check] | None = None,
        check_timeout: float = 2.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        env = os.environ
        url = _first(api_url, env.get("NEX_API_URL"), env.get("MONITORING_API_URL"), env.get("MONITORING_URL"))
        token = _first(token, env.get("NEX_TOKEN"), env.get("MONITORING_TOKEN"))
        switch = (_first(env.get("NEX_ENABLED"), env.get("MONITORING_ENABLED")) or "").lower()
        self.enabled = enabled if enabled is not None else switch != "false" and bool(url or token)
        self.service = _first(service, env.get("NEX_SERVICE"), env.get("MONITORING_SERVICE")) or ""
        self.environment = normalize_environment(_first(environment, env.get("NEX_ENVIRONMENT"), env.get("MONITORING_ENVIRONMENT")))
        commit = _first(env.get("GIT_COMMIT"), env.get("SOURCE_COMMIT"), env.get("GITHUB_SHA"), env.get("RENDER_GIT_COMMIT"))
        self.release = _first(release, env.get("APP_VERSION"), env.get("RELEASE"), commit[:12] if commit else None)

        if self.enabled:
            problems = []
            if not url:
                problems.append("api_url is required (or NEX_API_URL)")
            elif not re.match(r"^https?://", url):
                problems.append("api_url must be an http(s) URL")
            if not token:
                problems.append("token is required (or NEX_TOKEN)")
            elif not TOKEN_PATTERN.match(token):
                problems.append("token does not look like a Nex SDK token (nsk_live_… / nsk_test_…)")
            if not self.service:
                problems.append("service is required (or NEX_SERVICE)")
            elif not SERVICE_PATTERN.match(self.service):
                problems.append(f'service "{self.service}" is not a valid slug (lowercase letters, digits, - _ .)')
            if problems:
                raise MonitoringConfigError(problems)

        self._url = _api_url(url) if url else ""
        self._token = token or ""
        self._flush_interval = flush_interval
        self._dedupe_window = dedupe_window
        self._redact_keys = redact_keys
        self._before_send = before_send
        self.checks = dict(checks or {})
        self._check_timeout = check_timeout
        self._calls = CallRecorder()
        self._jobs = JobRecorder()
        self._runtime: RuntimeSampler | None = None
        self._uninstall_observers: Callable[[], None] | None = None
        self._legacy_heartbeat = False
        self._last_detail = ""
        self._queue: deque[dict[str, Any]] = deque(maxlen=max(1, max_buffer))
        self._lock = threading.Condition()
        self._sending = False
        self._worker: threading.Thread | None = None
        self._closed = False
        self._token_rejected = False
        self._failures = 0
        self._paused_until = 0.0
        self._warned: set[str] = set()
        self._recent: dict[str, float] = {}
        self._heartbeat_thread: threading.Thread | None = None
        self._heartbeat_stop = threading.Event()
        self.dropped = 0
        self._http = (
            httpx.Client(
                timeout=timeout,
                transport=transport,
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "User-Agent": f"{SDK_NAME}/{__version__}",
                    "Accept": "application/json",
                },
            )
            if self.enabled
            else None
        )
        self._contexts = {
            "runtime": {"name": platform.python_implementation().lower(), "version": platform.python_version()},
            "os": {"name": platform.system().lower() or "unknown", "release": platform.release()},
        }
        if self.enabled:
            atexit.register(self.close, 2.0)

    def __repr__(self) -> str:  # Never the token.
        return f"Monitoring(service={self.service!r}, enabled={self.enabled}, token='[redacted]')"

    # --- Scope -------------------------------------------------------------------

    def set_user(self, user: Mapping[str, Any] | None) -> None:
        """Who is affected (``id``, ``username``, ``email``). Per request inside one."""
        current_scope().set_user(dict(user) if user else None)

    def set_tag(self, key: str, value: object) -> None:
        current_scope().set_tag(key, value)

    def set_tags(self, tags: Mapping[str, object]) -> None:
        for key, value in tags.items():
            self.set_tag(key, value)

    def set_transaction(self, name: str | None) -> None:
        """Names what is running (a job, a command). Requests are named automatically."""
        current_scope().set_transaction(name)

    def add_breadcrumb(
        self,
        message: str | None = None,
        *,
        category: str | None = None,
        level: str = "info",
        type: str | None = None,
        data: Mapping[str, Any] | None = None,
    ) -> None:
        """Leaves a trail entry; the last 100 go with the next error."""
        if not self.enabled:
            return
        with contextlib.suppress(Exception):
            current_scope().add_breadcrumb(
                {
                    "type": type,
                    "category": truncate(category, 100) if category else None,
                    "level": level,
                    "message": redact_bounded(message, 1_000) if message else None,
                    "data": bound_json(redact(dict(data), self._redact_keys), 2_000) if data else None,
                }
            )

    @contextlib.contextmanager
    def new_scope(self) -> Iterator[Scope]:
        """Its own user, tags and breadcrumbs, e.g. for one job:

        ``with monitoring.new_scope() as scope: scope.set_tag("job", name); run()``
        """
        token = push_scope()
        try:
            yield current_scope()
        finally:
            pop_scope(token)

    # --- Capture -----------------------------------------------------------------

    def capture_exception(
        self,
        exc: BaseException | None = None,
        *,
        level: str = "error",
        handled: bool = True,
        mechanism: str = "manual",
        tags: Mapping[str, object] | None = None,
        fingerprint: list[str] | None = None,
        metadata: Mapping[str, Any] | None = None,
        service: str | None = None,
    ) -> bool:
        """Reports an exception (the one being handled when ``exc`` is omitted)."""
        if exc is None:
            exc = sys.exc_info()[1]
        if exc is None or not self.enabled:
            return False
        try:
            if getattr(exc, "__nex_reported__", False):
                return False
            with contextlib.suppress(Exception):
                exc.__nex_reported__ = True  # type: ignore[attr-defined]
            error = flat_error(exc)
            return self._capture(
                {
                    "type": "exception",
                    "severity": LEVELS.get(level, "ERROR"),
                    "message": error["message"] or error["name"],
                    "error": error,
                    "exception": exception_chain(exc, mechanism=mechanism, handled=handled),
                    "handled": handled,
                },
                tags=tags,
                fingerprint=fingerprint,
                metadata=metadata,
                service=service,
            )
        except Exception:
            return False

    def capture_message(
        self,
        message: str,
        level: str = "info",
        *,
        tags: Mapping[str, object] | None = None,
        fingerprint: list[str] | None = None,
        metadata: Mapping[str, Any] | None = None,
        service: str | None = None,
    ) -> bool:
        """``info`` … ``critical``; ``critical`` opens an incident in Nex."""
        event_type = "warning" if level == "warning" else "custom" if level in ("info", "debug") else "error"
        return self.capture_event(event_type, str(message), level=level, tags=tags, fingerprint=fingerprint, metadata=metadata, service=service)

    def capture_event(
        self,
        type: str,
        message: str,
        *,
        level: str = "info",
        tags: Mapping[str, object] | None = None,
        fingerprint: list[str] | None = None,
        metadata: Mapping[str, Any] | None = None,
        service: str | None = None,
    ) -> bool:
        """Any API event type: ``dependency_failure``, ``performance``, ``security``…"""
        if not self.enabled:
            return False
        try:
            return self._capture(
                {"type": type, "severity": LEVELS.get(level, "INFO"), "message": str(message)},
                tags=tags,
                fingerprint=fingerprint,
                metadata=metadata,
                service=service,
            )
        except Exception:
            return False

    def _capture(
        self,
        event: dict[str, Any],
        *,
        tags: Mapping[str, object] | None,
        fingerprint: list[str] | None,
        metadata: Mapping[str, Any] | None,
        service: str | None,
    ) -> bool:
        if self._closed or self._token_rejected:
            return False
        scope = current_scope()
        payload = self._payload(event, scope, tags, fingerprint, metadata, service)
        if self._before_send:
            try:
                result = self._before_send(payload)
            except Exception:
                self._warn_once("before_send", "before_send raised; the event was sent without it.")
                result = payload
            if result is None:
                return False
            payload = result
        if self._duplicate(payload):
            return False
        with self._lock:
            if len(self._queue) == self._queue.maxlen:
                self.dropped += 1
            self._queue.append(payload)
            self._lock.notify()
        self._ensure_worker()
        return True

    def _payload(
        self,
        event: dict[str, Any],
        scope: Scope,
        tags: Mapping[str, object] | None,
        fingerprint: list[str] | None,
        metadata: Mapping[str, Any] | None,
        service: str | None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            **event,
            "message": redact_bounded(event["message"] or event["type"], 2_000),
            "timestamp": _now(),
            "contexts": self._contexts,
            "sdk": {"name": SDK_NAME, "version": __version__},
        }
        if service != "":
            payload["service"] = service or self.service
        if self.environment:
            payload["environment"] = self.environment
        if self.release:
            payload["release"] = truncate(self.release, 64)
        merged_tags = {**scope.tags, **{str(k): str(v) for k, v in (tags or {}).items()}}
        if merged_tags:
            payload["tags"] = redact(merged_tags, self._redact_keys)
        if fingerprint:
            payload["fingerprint"] = [truncate(str(part), 200) for part in fingerprint[:10]]
        if metadata:
            payload["metadata"] = bound_json(redact(dict(metadata), self._redact_keys), METADATA_BYTES)
        if scope.user:
            payload["user"] = {k: truncate(v, 320) for k, v in scope.user.items()}
        if scope.breadcrumbs:
            payload["breadcrumbs"] = list(scope.breadcrumbs)
        if scope.request:
            payload["request"] = scope.request
        transaction = scope.transaction or (
            f"{scope.request.get('method', '')} {scope.request['route']}".strip() if scope.request and scope.request.get("route") else None
        )
        if transaction:
            payload["transaction"] = truncate(transaction, 300)
        payload.update(_active_trace())
        return payload

    def _duplicate(self, payload: dict[str, Any]) -> bool:
        if self._dedupe_window <= 0:
            return False
        stack = (payload.get("error") or {}).get("stack", "")
        key = "|".join([payload["type"], payload["severity"], payload.get("service", ""), payload["message"], stack[-300:]])
        now = time.monotonic()
        last = self._recent.get(key)
        self._recent[key] = now
        if len(self._recent) > 500:
            self._recent = {k: t for k, t in self._recent.items() if now - t < self._dedupe_window}
        return last is not None and now - last < self._dedupe_window

    # --- Delivery ----------------------------------------------------------------

    def _ensure_worker(self) -> None:
        if self._worker and self._worker.is_alive():
            return
        with self._lock:
            if self._worker and self._worker.is_alive():
                return
            self._worker = threading.Thread(target=self._run, name="nex-delivery", daemon=True)
            self._worker.start()

    def _run(self) -> None:
        while True:
            with self._lock:
                while not self._queue and not self._closed:
                    self._lock.wait()
                if not self._queue and self._closed:
                    return
            # Let a burst gather into one batch.
            time.sleep(self._flush_interval if not self._closed else 0)
            self._drain()

    def _next_batch(self) -> list[dict[str, Any]]:
        batch: list[dict[str, Any]] = []
        size = 16
        with self._lock:
            while self._queue and len(batch) < MAX_BATCH:
                event = self._queue[0]
                event_size = len(json.dumps(event, default=str))
                if event_size > MAX_BATCH_BYTES:
                    # Shed the bulky parts rather than lose the event.
                    event = {k: v for k, v in event.items() if k not in ("breadcrumbs", "metadata")}
                    self._queue[0] = event
                    event_size = len(json.dumps(event, default=str))
                if batch and size + event_size > MAX_BATCH_BYTES:
                    break
                batch.append(self._queue.popleft())
                size += event_size + 1
            self._sending = bool(batch)
        return batch

    def _drain(self) -> None:
        try:
            while not self._token_rejected:
                if time.monotonic() < self._paused_until:
                    return
                batch = self._next_batch()
                if not batch:
                    return
                status = self._post("/events", batch[0] if len(batch) == 1 else {"events": batch})
                if status is not None and status < 300:
                    self._failures = 0
                    continue
                if status is None or status == 429 or status >= 500:
                    # Unreachable or overloaded: keep the events, pause, retry later.
                    with self._lock:
                        for event in reversed(batch):
                            if len(self._queue) == self._queue.maxlen:
                                self.dropped += 1
                                break
                            self._queue.appendleft(event)
                    self._failures += 1
                    if self._failures >= FAILURES_BEFORE_PAUSE:
                        pause = min(MAX_PAUSE, BASE_PAUSE * 2 ** (self._failures - FAILURES_BEFORE_PAUSE))
                        self._paused_until = time.monotonic() + pause
                        self._warn_once("paused", f"Nex is unreachable; pausing reports for {pause:.0f}s (events are kept in memory).")
                    else:
                        time.sleep(min(5.0, 0.5 * 2**self._failures))
                    return
                # Rejected as invalid: retrying would fail the same way.
                self.dropped += len(batch)
        finally:
            with self._lock:
                self._sending = False
                self._lock.notify_all()

    def _post(self, path: str, body: Any) -> int | None:
        if not self._http:
            return None
        self._last_detail = ""
        try:
            response = self._http.post(self._url + path, json=body)
        except Exception:
            return None
        if response.status_code == 401:
            self._token_rejected = True
            self._warn_once("401", "The Nex token was rejected (401). Reporting is stopped; check NEX_TOKEN.")
        elif 400 <= response.status_code < 500 and response.status_code != 429:
            detail = ""
            with contextlib.suppress(Exception):
                detail = str(response.json().get("detail", ""))
            self._last_detail = detail
            if path == "/heartbeat" and response.status_code == 422 and detail.startswith("dependencies") and not self._legacy_heartbeat:
                return response.status_code  # Retried in the older format; not worth a warning.
            self._warn_once(f"{response.status_code}:{path}:{detail}", f"POST {path} was rejected ({response.status_code}): {detail}. It will not be retried.")
        return response.status_code

    def flush(self, timeout: float = 5.0) -> bool:
        """Waits (bounded) until everything queued is sent. True if it all went."""
        if not self.enabled:
            return True
        deadline = time.monotonic() + timeout
        self._ensure_worker()
        with self._lock:
            self._lock.notify_all()
            while self._queue or self._sending:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or self._token_rejected or time.monotonic() < self._paused_until:
                    return not self._queue
                self._lock.wait(min(remaining, 0.05))
        return True

    def close(self, timeout: float = 2.0) -> None:
        """Stops heartbeats and flushes (bounded). Called at exit automatically."""
        self._heartbeat_stop.set()
        if self._uninstall_observers:
            with contextlib.suppress(Exception):
                self._uninstall_observers()
            self._uninstall_observers = None
        if self._closed:
            return
        self.flush(timeout)
        self._closed = True
        with self._lock:
            self._lock.notify_all()
        if self._http:
            with contextlib.suppress(Exception):
                self._http.close()

    def _warn_once(self, key: str, message: str) -> None:
        if key in self._warned:
            return
        self._warned.add(key)
        log.warning("[nex] %s", message)

    # --- Heartbeats & releases ---------------------------------------------------------

    def heartbeat(self, *, status: str | None = None, dependencies: Mapping[str, Any] | None = None) -> bool:
        """Reports the service alive, with each dependency's health (from
        ``checks`` when not given), outgoing calls, vitals and job stats."""
        if not self.enabled or self._token_rejected:
            return False
        started = time.monotonic()
        given = list((dependencies or {}).items())[:50]
        deps = self._run_checks() if dependencies is None else {str(name)[:64]: _dependency_report(value) for name, value in given}
        body: dict[str, Any] = {
            "service": self.service,
            "status": status or _status_from(deps),
            "responseTime": round((time.monotonic() - started) * 1000),
            "timestamp": _now(),
        }
        if deps:
            body["dependencies"] = deps
        if self.release:
            body["version"] = truncate(self.release, 64)
        if self.environment:
            body["environment"] = self.environment
        calls = self._calls.take()
        jobs = self._jobs.take()
        if calls:
            body["calls"] = calls
        if jobs:
            body["jobs"] = jobs
        if self._runtime:
            body["runtime"] = self._runtime.take()
        status_code = self._post("/heartbeat", _legacy(body) if self._legacy_heartbeat else body)
        if status_code == 422 and not self._legacy_heartbeat and self._last_detail.startswith("dependencies"):
            # A server from before dependency reports takes statuses only.
            self._legacy_heartbeat = True
            status_code = self._post("/heartbeat", _legacy(body))
        return status_code is not None and status_code < 300

    def _run_checks(self) -> dict[str, dict[str, Any]]:
        checks = list(self.checks.items())[:50]
        if not checks:
            return {}
        results: dict[str, dict[str, Any]] = {}
        # Every check shares one deadline; one that hangs reports down
        # without holding up the heartbeat (its thread is left to finish).
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(checks)), thread_name_prefix="nex-check")
        try:
            futures = {}
            for name, check in checks:
                definition = check if isinstance(check, DependencyCheck) else DependencyCheck(check)
                futures[str(name)[:64]] = (definition, executor.submit(_timed, definition.check))
            deadline = time.perf_counter() + self._check_timeout
            for name, (definition, future) in futures.items():
                try:
                    result, elapsed = future.result(timeout=max(0.0, deadline - time.perf_counter()))
                    results[name] = _dependency_report(result, kind=definition.kind, target=definition.target, latency_ms=elapsed)
                except concurrent.futures.TimeoutError:
                    waited = self._check_timeout * 1000
                    results[name] = _dependency_report(
                        "down", kind=definition.kind, target=definition.target, latency_ms=waited, error=f"No answer within {waited:.0f}ms"
                    )
                except Exception as exc:
                    results[name] = _dependency_report("down", kind=definition.kind, target=definition.target, error=str(exc) or type(exc).__name__)
        finally:
            executor.shutdown(wait=False)
        return results

    def start(self, interval: float = 30.0, *, service_map: bool = True, runtime_metrics: bool = True) -> None:
        """Heartbeats every ``interval`` seconds from a daemon thread, until
        ``close()``. Also counts outgoing ``httpx``/``requests`` calls per
        target for the service map, and samples memory, CPU and threads."""
        if not self.enabled or (self._heartbeat_thread and self._heartbeat_thread.is_alive()):
            return
        self._heartbeat_stop.clear()
        if runtime_metrics:
            self._runtime = RuntimeSampler()
        if service_map and self._uninstall_observers is None:
            origin = None
            with contextlib.suppress(Exception):
                parsed = httpx.URL(self._url)
                origin = f"{parsed.scheme}://{parsed.netloc.decode()}"
            self._uninstall_observers = install_http_observers(self._calls.record, origin)

        def loop() -> None:
            while not self._heartbeat_stop.is_set():
                with contextlib.suppress(Exception):
                    self.heartbeat()
                self._heartbeat_stop.wait(interval)

        self._heartbeat_thread = threading.Thread(target=loop, name="nex-heartbeat", daemon=True)
        self._heartbeat_thread.start()

    # --- Jobs ------------------------------------------------------------------------

    def job(self, name: str, *, tags: Mapping[str, object] | None = None) -> _Job:
        """One unit of background work (a queue message, a cron run), as a
        context manager or a decorator, sync or async::

            with monitoring.job("process-order"):
                handle(message)

            @monitoring.job("sync-invoices")
            async def sync_invoices(): ...

        The run gets its own scope; its exception is reported with the job's
        name and re-raised; every run is counted and timed for Nex.
        """
        return _Job(self, name, tags)

    def _record_job(self, name: str, duration_ms: float, failed: bool) -> None:
        if self.enabled:
            with contextlib.suppress(Exception):
                self._jobs.record(name, duration_ms, failed)

    def report_release(self, version: str | None = None, *, commit: str | None = None, service: str | None = None) -> bool:
        """Records a deployment of ``version`` (default: the configured release)."""
        version = version or self.release
        if not self.enabled or not version:
            return False
        body: dict[str, Any] = {"version": truncate(version, 64), "service": service or self.service}
        commit = commit or _first(os.environ.get("GIT_COMMIT"), os.environ.get("SOURCE_COMMIT"), os.environ.get("GITHUB_SHA"))
        if commit:
            body["commitSha"] = truncate(commit, 64)
        if self.environment:
            body["environment"] = self.environment
        status_code = self._post("/releases", body)
        return status_code is not None and status_code < 300

    # --- Requests (used by the integrations) -------------------------------------------

    def request_scope(self, *, method: str, path: str, route: str | None = None, user_agent: str | None = None) -> contextlib.AbstractContextManager[Scope]:
        @contextlib.contextmanager
        def scoped() -> Iterator[Scope]:
            with self.new_scope() as scope:
                scope.request = {
                    "method": method.upper(),
                    "url": truncate(strip_query(path), 2_000),
                    **({"route": route} if route else {}),
                    **({"userAgent": truncate(user_agent, 500)} if user_agent else {}),
                }
                yield scope

        return scoped()


def _timed(check: Callable[[], Any]) -> tuple[Any, float]:
    started = time.perf_counter()
    result = check()
    return result, (time.perf_counter() - started) * 1000


def _legacy(body: dict[str, Any]) -> dict[str, Any]:
    """The heartbeat as servers before 2026-10 accept it: dependency statuses only."""
    out = {k: v for k, v in body.items() if k not in ("calls", "jobs", "runtime")}
    if "dependencies" in out:
        out["dependencies"] = {name: d["status"] for name, d in out["dependencies"].items()}
    return out


class _Job:
    """``Monitoring.job()``: a context manager, and a decorator for sync and async functions."""

    def __init__(self, monitoring: Monitoring, name: str, tags: Mapping[str, object] | None) -> None:
        self._monitoring = monitoring
        self._name = name
        self._tags = dict(tags or {})
        self._stack: list[tuple[contextlib.AbstractContextManager[Scope], float]] = []

    def __enter__(self) -> Scope:
        scope_cm = self._monitoring.new_scope()
        scope = scope_cm.__enter__()
        scope.set_transaction(self._name)
        for key, value in self._tags.items():
            scope.set_tag(key, value)
        self._stack.append((scope_cm, time.perf_counter()))
        return scope

    def __exit__(self, kind: type[BaseException] | None, exc: BaseException | None, tb: Any) -> None:
        scope_cm, started = self._stack.pop()
        failed = exc is not None and not isinstance(exc, (KeyboardInterrupt, SystemExit, GeneratorExit))
        try:
            self._monitoring._record_job(self._name, (time.perf_counter() - started) * 1000, failed)
            if failed and exc is not None:
                self._monitoring.capture_exception(exc, handled=False, mechanism="job", tags={"job": self._name})
        finally:
            scope_cm.__exit__(kind, exc, tb)

    def __call__(self, fn: F) -> F:
        if inspect.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def run_async(*args: Any, **kwargs: Any) -> Any:
                with _Job(self._monitoring, self._name, self._tags):
                    return await cast(Callable[..., Awaitable[Any]], fn)(*args, **kwargs)

            return cast(F, run_async)

        @functools.wraps(fn)
        def run(*args: Any, **kwargs: Any) -> Any:
            with _Job(self._monitoring, self._name, self._tags):
                return fn(*args, **kwargs)

        return cast(F, run)
