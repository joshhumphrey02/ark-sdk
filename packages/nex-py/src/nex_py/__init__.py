"""Nex for Python services.

Quick start::

    import nex_py as nex
    from nex_py import checks

    nex.init(service="checkout-api", checks={"database": checks.sqlalchemy(engine)})  # NEX_API_URL / NEX_TOKEN
    nex.set_user({"id": user.id})
    try:
        charge(order)
    except Exception:
        nex.capture_exception()
        raise

``init()`` reports crashes, turns log records into breadcrumbs (and
``logger.error``/``logger.exception`` into events), and sends a heartbeat
with dependency health, outgoing calls, vitals and job stats every 30s.
Unconfigured means off: without an API URL and token every call is a no-op.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from . import checks
from ._redact import REDACTED, redact, redact_string
from ._scope import Scope
from ._trace import Span, TraceContext, format_traceparent, parse_traceparent
from .checks import DependencyCheck
from .client import SDK_NAME, Monitoring, MonitoringConfigError, __version__, normalize_environment
from .integrations import (
    MonitoringASGIMiddleware,
    MonitoringLogHandler,
    MonitoringWSGIMiddleware,
    install_asyncio_handler,
    install_celery,
    install_crash_handlers,
)

__all__ = [
    "REDACTED",
    "SDK_NAME",
    "DependencyCheck",
    "Monitoring",
    "MonitoringASGIMiddleware",
    "MonitoringConfigError",
    "MonitoringLogHandler",
    "MonitoringWSGIMiddleware",
    "Scope",
    "Span",
    "TraceContext",
    "__version__",
    "add_breadcrumb",
    "capture_event",
    "capture_exception",
    "capture_message",
    "checks",
    "flush",
    "format_traceparent",
    "gauge",
    "get_client",
    "increment",
    "init",
    "install_asyncio_handler",
    "install_celery",
    "install_crash_handlers",
    "job",
    "metric",
    "new_scope",
    "normalize_environment",
    "parse_traceparent",
    "redact",
    "redact_string",
    "set_tag",
    "set_tags",
    "set_transaction",
    "set_user",
    "start_span",
    "trace",
    "trace_headers",
]

_client: Monitoring | None = None


def init(
    *,
    crashes: bool = True,
    logging_integration: bool = True,
    heartbeat_interval: float | None = 30.0,
    service_map: bool = True,
    runtime_metrics: bool = True,
    **options: Any,
) -> Monitoring:
    """Creates the process-wide client and installs the integrations.

    ``heartbeat_interval=None`` turns automatic heartbeats off;
    ``service_map=False`` stops counting outgoing calls; ``runtime_metrics=False``
    leaves vitals out. Raises ``MonitoringConfigError`` once, at startup, if
    configured but invalid.
    """
    global _client
    client = Monitoring(**options)
    _client = client
    if not client.enabled:
        return client
    if crashes:
        install_crash_handlers(client)
    if logging_integration:
        root = logging.getLogger()
        # Records reach it at the levels the application already logs at;
        # monitoring never changes what gets logged.
        if not any(isinstance(h, MonitoringLogHandler) for h in root.handlers):
            root.addHandler(MonitoringLogHandler(client))
    if heartbeat_interval:
        client.start(heartbeat_interval, service_map=service_map, runtime_metrics=runtime_metrics)
    return client


def get_client() -> Monitoring | None:
    return _client


def _with(method: str, *args: Any, **kwargs: Any) -> Any:
    if _client is None:
        return False if method.startswith("capture") else None
    return getattr(_client, method)(*args, **kwargs)


def capture_exception(exc: BaseException | None = None, **options: Any) -> bool:
    return bool(_with("capture_exception", exc, **options))


def capture_message(message: str, level: str = "info", **options: Any) -> bool:
    return bool(_with("capture_message", message, level, **options))


def capture_event(type: str, message: str, **options: Any) -> bool:
    return bool(_with("capture_event", type, message, **options))


def set_user(user: Mapping[str, Any] | None) -> None:
    _with("set_user", user)


def set_tag(key: str, value: object) -> None:
    _with("set_tag", key, value)


def set_tags(tags: Mapping[str, object]) -> None:
    _with("set_tags", tags)


def set_transaction(name: str | None) -> None:
    _with("set_transaction", name)


def add_breadcrumb(message: str | None = None, **options: Any) -> None:
    _with("add_breadcrumb", message, **options)


def new_scope() -> Any:
    if _client is None:
        import contextlib

        return contextlib.nullcontext(Scope())
    return _client.new_scope()


def job(name: str, **options: Any) -> Any:
    """``with nex.job("name"):`` / ``@nex.job("name")``; plain when not initialised."""
    if _client is None:
        import contextlib

        class _Plain(contextlib.nullcontext[None]):
            def __call__(self, fn: Any) -> Any:
                return fn

        return _Plain()
    return _client.job(name, **options)


def trace(name: str, **options: Any) -> Any:
    """``with nex.trace("SELECT orders"):`` / ``@nex.trace("render")``; plain when not initialised."""
    if _client is None:
        import contextlib

        class _Plain(contextlib.nullcontext[None]):
            def __call__(self, fn: Any) -> Any:
                return fn

        return _Plain()
    return _client.trace(name, **options)


def start_span(name: str, **options: Any) -> Span | None:
    return _client.start_span(name, **options) if _client else None


def trace_headers() -> dict[str, str]:
    return _client.trace_headers() if _client else {}


def metric(name: str, value: float, **options: Any) -> bool:
    return bool(_with("metric", name, value, **options))


def increment(name: str, by: float = 1) -> bool:
    return bool(_with("increment", name, by))


def gauge(name: str, value: float, unit: str | None = None) -> bool:
    return bool(_with("gauge", name, value, unit))


def flush(timeout: float = 5.0) -> bool:
    return bool(_client.flush(timeout)) if _client else True
