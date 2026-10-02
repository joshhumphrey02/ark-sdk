"""Nex monitoring for Python services.

Quick start::

    import nerdstack_monitoring as monitoring

    monitoring.init(service="checkout-api")   # reads MONITORING_API_URL / MONITORING_TOKEN
    monitoring.set_user({"id": user.id})
    try:
        charge(order)
    except Exception:
        monitoring.capture_exception()
        raise

``init()`` reports crashes and turns log records into breadcrumbs (and
``logger.error``/``logger.exception`` into events). Unconfigured means off:
without an API URL and token every call is a no-op.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from ._redact import REDACTED, redact, redact_string
from ._scope import Scope
from .client import SDK_NAME, Monitoring, MonitoringConfigError, __version__, normalize_environment
from .integrations import (
    MonitoringASGIMiddleware,
    MonitoringLogHandler,
    MonitoringWSGIMiddleware,
    install_asyncio_handler,
    install_crash_handlers,
)

__all__ = [
    "REDACTED",
    "SDK_NAME",
    "Monitoring",
    "MonitoringASGIMiddleware",
    "MonitoringConfigError",
    "MonitoringLogHandler",
    "MonitoringWSGIMiddleware",
    "Scope",
    "__version__",
    "add_breadcrumb",
    "capture_event",
    "capture_exception",
    "capture_message",
    "flush",
    "get_client",
    "init",
    "install_asyncio_handler",
    "install_crash_handlers",
    "new_scope",
    "normalize_environment",
    "redact",
    "redact_string",
    "set_tag",
    "set_tags",
    "set_transaction",
    "set_user",
]

_client: Monitoring | None = None


def init(*, crashes: bool = True, logging_integration: bool = True, heartbeat_interval: float | None = 30.0, **options: Any) -> Monitoring:
    """Creates the process-wide client and installs the integrations.

    ``heartbeat_interval=None`` turns automatic heartbeats off. Raises
    ``MonitoringConfigError`` once, at startup, if configured but invalid.
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
        client.start(heartbeat_interval)
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


def flush(timeout: float = 5.0) -> bool:
    return bool(_client.flush(timeout)) if _client else True
