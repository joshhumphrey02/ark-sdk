"""Integrations: crashes, logging, and web frameworks.

- ``install_crash_handlers``: uncaught exceptions (``sys.excepthook``), in
  threads (``threading.excepthook``) and in ``asyncio`` tasks are reported as
  crashes; the previous handlers still run, so the process behaves as before.
- ``MonitoringLogHandler``: log records become breadcrumbs, and
  ``logger.error``/``logger.exception`` become events.
- ``MonitoringASGIMiddleware`` (FastAPI, Starlette, Quart, Django ASGI) and
  ``MonitoringWSGIMiddleware`` (Flask, Django): each request gets its own
  scope with its method, path, route and user agent; errors are reported
  with it and re-raised unchanged, and 5xx responses are reported once per
  route per minute.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import sys
import threading
import time
from collections.abc import Awaitable, Callable, Iterable, MutableMapping
from types import TracebackType
from typing import Any

from .client import Monitoring

_IGNORED_LOGGERS = ("nerdstack.monitoring",)
_LOG_LEVEL = {logging.DEBUG: "debug", logging.INFO: "info", logging.WARNING: "warning", logging.ERROR: "error", logging.CRITICAL: "critical"}


def _level_name(levelno: int) -> str:
    for threshold in (logging.CRITICAL, logging.ERROR, logging.WARNING, logging.INFO):
        if levelno >= threshold:
            return _LOG_LEVEL[threshold]
    return "debug"


# --- Crashes ------------------------------------------------------------------------------


def install_crash_handlers(monitoring: Monitoring, *, flush_timeout: float = 2.0) -> Callable[[], None]:
    """Reports uncaught exceptions as crashes. Returns an uninstaller."""
    previous_hook = sys.excepthook
    previous_thread_hook = threading.excepthook

    def excepthook(kind: type[BaseException], value: BaseException, tb: TracebackType | None) -> None:
        if not issubclass(kind, KeyboardInterrupt):
            if value.__traceback__ is None and tb is not None:
                value = value.with_traceback(tb)
            monitoring.capture_exception(value, level="critical", handled=False, mechanism="excepthook")
            monitoring.flush(flush_timeout)
        previous_hook(kind, value, tb)

    def thread_hook(args: threading.ExceptHookArgs) -> None:
        if args.exc_value is not None and not isinstance(args.exc_value, SystemExit):
            monitoring.capture_exception(args.exc_value, level="critical", handled=False, mechanism="threading")
        previous_thread_hook(args)

    sys.excepthook = excepthook
    threading.excepthook = thread_hook

    def uninstall() -> None:
        if sys.excepthook is excepthook:
            sys.excepthook = previous_hook
        if threading.excepthook is thread_hook:
            threading.excepthook = previous_thread_hook

    return uninstall


def install_asyncio_handler(monitoring: Monitoring, loop: asyncio.AbstractEventLoop | None = None) -> None:
    """Reports exceptions no task awaited (``Task exception was never retrieved``)."""
    loop = loop or asyncio.get_running_loop()
    previous = loop.get_exception_handler()
    if getattr(previous, "__nerdstack__", False):
        return

    def handler(loop: asyncio.AbstractEventLoop, context: dict[str, Any]) -> None:
        exc = context.get("exception")
        if isinstance(exc, BaseException):
            monitoring.capture_exception(exc, level="error", handled=False, mechanism="asyncio")
        if previous is not None:
            previous(loop, context)
        else:
            loop.default_exception_handler(context)

    handler.__nerdstack__ = True  # type: ignore[attr-defined]
    loop.set_exception_handler(handler)


# --- Logging ------------------------------------------------------------------------------


class MonitoringLogHandler(logging.Handler):
    """Log records as breadcrumbs (``breadcrumb_level`` and up) and events
    (``event_level`` and up; with ``exc_info``, the exception itself).

    ``logging.getLogger().addHandler(MonitoringLogHandler(monitoring))``.
    """

    def __init__(self, monitoring: Monitoring, *, breadcrumb_level: int = logging.INFO, event_level: int = logging.ERROR) -> None:
        super().__init__(level=min(breadcrumb_level, event_level))
        self.monitoring = monitoring
        self.breadcrumb_level = breadcrumb_level
        self.event_level = event_level
        self._local = threading.local()
        self._api_url = getattr(monitoring, "_url", "")

    def emit(self, record: logging.LogRecord) -> None:
        if getattr(self._local, "busy", False) or record.name.startswith(_IGNORED_LOGGERS):
            return
        self._local.busy = True
        try:
            message = record.getMessage()
            # The SDK's own HTTP calls (httpx logs them) are not breadcrumbs.
            if self._api_url and self._api_url in message:
                return
            if record.levelno >= self.event_level:
                exc = record.exc_info[1] if record.exc_info else None
                if exc is not None:
                    self.monitoring.capture_exception(
                        exc, level=_level_name(record.levelno), mechanism="logging", metadata={"logger": record.name, "log": message[:1_000]}
                    )
                else:
                    self.monitoring.capture_message(message, _level_name(record.levelno), metadata={"logger": record.name})
            if record.levelno >= self.breadcrumb_level:
                self.monitoring.add_breadcrumb(message, category=record.name, level=_level_name(record.levelno), type="log")
        except Exception:
            pass
        finally:
            self._local.busy = False


# --- ASGI ---------------------------------------------------------------------------------

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

_SERVER_ERROR_WINDOW = 60.0


class _ServerErrors:
    """5xx responses without an exception, at most once per route per minute."""

    def __init__(self, monitoring: Monitoring) -> None:
        self.monitoring = monitoring
        self._last: dict[str, float] = {}

    def report(self, method: str, route: str, status: int) -> None:
        key = f"{method} {route} {status}"
        now = time.monotonic()
        if now - self._last.get(key, -_SERVER_ERROR_WINDOW) < _SERVER_ERROR_WINDOW:
            return
        self._last[key] = now
        self.monitoring.capture_event(
            "error",
            f"{method} {route} returned {status}",
            level="error",
            fingerprint=["http-5xx", method, route, str(status)],
            metadata={"method": method, "route": route, "status": status},
        )


def _route_of(scope: Scope) -> str | None:
    route = scope.get("route")
    path = getattr(route, "path", None) or getattr(route, "path_format", None)
    return path if isinstance(path, str) else None


class MonitoringASGIMiddleware:
    """``app.add_middleware(MonitoringASGIMiddleware, monitoring=monitoring)``."""

    def __init__(self, app: ASGIApp, monitoring: Monitoring) -> None:
        self.app = app
        self.monitoring = monitoring
        self._server_errors = _ServerErrors(monitoring)
        self._asyncio_installed = False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http" or not self.monitoring.enabled:
            await self.app(scope, receive, send)
            return
        if not self._asyncio_installed:
            self._asyncio_installed = True
            with contextlib.suppress(Exception):
                install_asyncio_handler(self.monitoring)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        method = str(scope.get("method", "GET")).upper()
        status: dict[str, int] = {}

        async def send_wrapper(message: MutableMapping[str, Any]) -> None:
            if message.get("type") == "http.response.start":
                status["code"] = int(message.get("status", 0))
            await send(message)

        with self.monitoring.request_scope(method=method, path=str(scope.get("path", "/")), user_agent=headers.get("user-agent")) as request_scope:
            try:
                await self.app(scope, receive, send_wrapper)
            except Exception as exc:
                route = _route_of(scope)
                if route and request_scope.request is not None:
                    request_scope.request["route"] = route
                if request_scope.request is not None:
                    request_scope.request["status"] = 500
                self.monitoring.capture_exception(exc, handled=False, mechanism="asgi")
                raise
            code = status.get("code", 0)
            if code >= 500:
                route = _route_of(scope) or str(scope.get("path", "/"))
                self._server_errors.report(method, route, code)


# --- WSGI ---------------------------------------------------------------------------------

WSGIApp = Callable[[dict[str, Any], Callable[..., Any]], Iterable[bytes]]


class MonitoringWSGIMiddleware:
    """``app.wsgi_app = MonitoringWSGIMiddleware(app.wsgi_app, monitoring)`` (Flask) or wrap
    ``get_wsgi_application()`` (Django)."""

    def __init__(self, app: WSGIApp, monitoring: Monitoring) -> None:
        self.app = app
        self.monitoring = monitoring
        self._server_errors = _ServerErrors(monitoring)

    def __call__(self, environ: dict[str, Any], start_response: Callable[..., Any]) -> Iterable[bytes]:
        if not self.monitoring.enabled:
            return self.app(environ, start_response)
        method = str(environ.get("REQUEST_METHOD", "GET")).upper()
        path = str(environ.get("PATH_INFO", "/")) or "/"
        status: dict[str, int] = {}

        def start_wrapper(code: str, headers: list[tuple[str, str]], exc_info: Any = None) -> Any:
            with contextlib.suppress(Exception):
                status["code"] = int(code.split(" ", 1)[0])
            return start_response(code, headers, exc_info) if exc_info is not None else start_response(code, headers)

        with self.monitoring.request_scope(method=method, path=path, user_agent=environ.get("HTTP_USER_AGENT")):
            try:
                result = self.app(environ, start_wrapper)
            except Exception as exc:
                self.monitoring.capture_exception(exc, handled=False, mechanism="wsgi")
                raise
            if status.get("code", 0) >= 500:
                self._server_errors.report(method, path, status["code"])
            return result
