"""The Python SDK's contract: what it sends, what it never sends, and that it
can't hurt the application. The API is a mock transport; nothing leaves the
machine."""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import threading
from typing import Any

import httpx
import pytest

import nex_py as nm
from nex_py import Monitoring, MonitoringASGIMiddleware, MonitoringConfigError, MonitoringLogHandler, MonitoringWSGIMiddleware
from nex_py._scope import reset_global_scope

TOKEN = "nsk_test_" + "A1b2C3d4E5" * 4 + "xyz"


class FakeApi:
    def __init__(self, status: int | None = None) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.status = status

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.url.path, body))
        if self.status is not None:
            return httpx.Response(self.status, json={"detail": "nope"})
        return httpx.Response(202, json={"ok": True})

    def events(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for path, body in self.calls:
            if path.endswith("/events"):
                out.extend(body.get("events", [body]))
        return out


@pytest.fixture(autouse=True)
def fresh_scope() -> None:
    reset_global_scope()


def client(api: FakeApi, **options: Any) -> Monitoring:
    return Monitoring(
        api_url="https://nex.example/api/v1/monitoring",
        token=TOKEN,
        service="checkout-api",
        environment="prod",
        release="2.4.1",
        flush_interval=0,
        dedupe_window=0,
        transport=httpx.MockTransport(api.handler),
        **options,
    )


class PaymentError(Exception):
    pass


def charge() -> None:
    try:
        raise ConnectionError("gateway refused")
    except ConnectionError as cause:
        raise PaymentError("card declined") from cause


# --- Configuration ------------------------------------------------------------------------


def test_unconfigured_means_off(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("MONITORING_API_URL", "MONITORING_URL", "MONITORING_TOKEN"):
        monkeypatch.delenv(key, raising=False)
    monitoring = Monitoring(service="x")
    assert monitoring.enabled is False
    assert monitoring.capture_message("x", "error") is False
    assert monitoring.flush() is True


def test_misconfiguration_fails_loudly_once_without_repeating_the_token() -> None:
    with pytest.raises(MonitoringConfigError) as error:
        Monitoring(api_url="ftp://x", token="nsk_live_short", service="Not A Slug")
    assert len(error.value.problems) == 3
    assert "nsk_live_short" not in str(error.value)
    monitoring = client(FakeApi())
    assert TOKEN not in repr(monitoring)


def test_an_origin_gets_the_api_path() -> None:
    monitoring = Monitoring(api_url="https://nerdstackgrp.com", token=TOKEN, service="api", transport=httpx.MockTransport(FakeApi().handler))
    assert monitoring._url == "https://nerdstackgrp.com/api/v1/monitoring"


# --- Events -------------------------------------------------------------------------------


def test_exceptions_carry_their_chain_frames_and_context() -> None:
    api = FakeApi()
    monitoring = client(api)
    try:
        charge()
    except PaymentError:
        assert monitoring.capture_exception(fingerprint=["payments", "declined"]) is True
    assert monitoring.flush()
    [event] = api.events()
    assert event["type"] == "exception"
    assert event["severity"] == "ERROR"
    assert event["environment"] == "production"
    assert event["release"] == "2.4.1"
    assert [e["type"] for e in event["exception"]] == ["PaymentError", "ConnectionError"]
    assert event["exception"][0]["mechanism"] == {"type": "manual", "handled": True}
    top = event["exception"][0]["stacktrace"]["frames"][0]
    assert top["function"] == "charge" and top["inApp"] is True and top["filename"].endswith("test_monitoring.py")
    assert event["fingerprint"] == ["payments", "declined"]
    assert event["sdk"]["name"] == "nex-py"
    assert event["contexts"]["runtime"]["name"] in ("cpython", "pypy")
    assert "Traceback" in event["error"]["stack"]  # older servers still get the flat error


def test_the_same_exception_is_reported_once() -> None:
    api = FakeApi()
    monitoring = client(api)
    error = ValueError("x")
    assert monitoring.capture_exception(error) is True
    assert monitoring.capture_exception(error) is False


def test_user_tags_and_breadcrumbs_go_with_events_and_secrets_dont() -> None:
    api = FakeApi()
    monitoring = client(api)
    monitoring.set_user({"id": 81, "email": "ada@example.com", "password": "x"})
    monitoring.set_tags({"region": "eu", "apiKey": "sk-live-123"})
    for i in range(120):
        monitoring.add_breadcrumb(f"step {i}", category="step")
    monitoring.add_breadcrumb("login with Bearer abcdefghijklmnop", data={"password": "hunter2"})
    monitoring.capture_message("checkout failed", "error", tags={"attempt": 2})
    monitoring.flush()
    [event] = api.events()
    assert event["user"] == {"id": "81", "email": "ada@example.com"}
    assert event["tags"] == {"region": "eu", "apiKey": "[redacted]", "attempt": "2"}
    assert len(event["breadcrumbs"]) == 100
    last = event["breadcrumbs"][-1]
    assert "abcdefghijklmnop" not in last["message"]
    assert last["data"]["password"] == "[redacted]"


def test_a_scope_is_its_own() -> None:
    api = FakeApi()
    monitoring = client(api)
    with monitoring.new_scope() as scope:
        scope.set_user({"id": "job-owner"})
        scope.set_tag("job", "sync")
        monitoring.capture_message("inside", "error")
    monitoring.capture_message("outside", "error")
    monitoring.flush()
    inside, outside = api.events()
    assert inside["user"]["id"] == "job-owner" and inside["tags"]["job"] == "sync"
    assert "user" not in outside and "tags" not in outside


async def test_concurrent_requests_never_share_users() -> None:
    api = FakeApi()
    monitoring = client(api)

    async def handle(user: str, fail: bool) -> None:
        with monitoring.request_scope(method="post", path=f"/orders/{user}?token=x"):
            monitoring.set_user({"id": user})
            monitoring.add_breadcrumb(f"start {user}")
            await asyncio.sleep(0.01)
            if fail:
                monitoring.capture_message(f"failed for {user}", "error")

    await asyncio.gather(handle("alice", True), handle("bob", False))
    monitoring.flush()
    [event] = api.events()
    assert event["user"]["id"] == "alice"
    assert [b["message"] for b in event["breadcrumbs"]] == ["start alice"]
    assert event["request"] == {"method": "POST", "url": "/orders/alice"}


# --- Delivery -----------------------------------------------------------------------------


def test_a_rejected_token_stops_reporting() -> None:
    api = FakeApi(status=401)
    monitoring = client(api)
    monitoring.capture_message("a", "error")
    monitoring.flush(1)
    monitoring.capture_message("b", "error")
    monitoring.flush(1)
    assert len(api.calls) == 1


def test_an_invalid_batch_is_dropped_and_an_outage_keeps_events() -> None:
    rejected = FakeApi(status=422)
    monitoring = client(rejected)
    monitoring.capture_message("bad", "error")
    monitoring.flush(1)
    assert monitoring.dropped == 1

    down = FakeApi(status=503)
    monitoring = client(down)
    monitoring.capture_message("kept", "error")
    assert monitoring.flush(0.3) is False
    assert len(monitoring._queue) == 1  # still there to retry


def test_nothing_raises_into_the_application() -> None:
    def explode(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    monitoring = Monitoring(api_url="https://x.example", token=TOKEN, service="api", flush_interval=0, transport=httpx.MockTransport(explode))
    assert monitoring.capture_message("x", "error") is True
    monitoring.flush(0.2)
    assert monitoring.heartbeat() is False


# --- Heartbeats & releases -----------------------------------------------------------------


def test_heartbeats_run_checks_and_report_degradation() -> None:
    api = FakeApi()

    def broken() -> bool:
        raise RuntimeError("redis down")

    monitoring = client(api, checks={"database": lambda: True, "redis": broken, "queue": lambda: "degraded"})
    assert monitoring.heartbeat() is True
    path, body = api.calls[-1]
    assert path.endswith("/heartbeat")
    assert {name: d["status"] for name, d in body["dependencies"].items()} == {"database": "healthy", "redis": "down", "queue": "degraded"}
    assert body["dependencies"]["redis"]["error"] == "redis down"
    assert body["status"] == "degraded" and body["version"] == "2.4.1"
    assert monitoring.report_release(commit="abc123") is True
    assert api.calls[-1][1] == {"version": "2.4.1", "service": "checkout-api", "commitSha": "abc123", "environment": "production"}


# --- Integrations -------------------------------------------------------------------------


def test_logging_records_become_breadcrumbs_and_errors_become_events() -> None:
    api = FakeApi()
    monitoring = client(api)
    logger = logging.getLogger("shop.orders")
    logger.setLevel(logging.INFO)
    handler = MonitoringLogHandler(monitoring)
    logger.addHandler(handler)
    try:
        logger.info("loading order 81")
        logging.getLogger("nex").error("own logs are ignored")
        try:
            charge()
        except PaymentError:
            logger.exception("charging failed")
        logger.error("plain error without exception")
    finally:
        logger.removeHandler(handler)
    monitoring.flush()
    crash, plain = api.events()
    assert crash["exception"][0]["mechanism"]["type"] == "logging"
    assert [b["message"] for b in crash["breadcrumbs"]] == ["loading order 81"]
    assert plain["type"] == "error" and plain["message"] == "plain error without exception"


def test_crash_handlers_report_and_keep_the_previous_behaviour(monkeypatch: pytest.MonkeyPatch) -> None:
    api = FakeApi()
    monitoring = client(api)
    seen: list[str] = []
    monkeypatch.setattr(sys, "excepthook", lambda kind, value, tb: seen.append(f"main:{value}"))
    monkeypatch.setattr(threading, "excepthook", lambda args: seen.append(f"thread:{args.exc_value}"))
    uninstall = nm.install_crash_handlers(monitoring, flush_timeout=1)
    try:
        try:
            raise RuntimeError("boom")
        except RuntimeError as error:
            sys.excepthook(type(error), error, error.__traceback__)
        worker = threading.Thread(target=lambda: (_ for _ in ()).throw(ValueError("in thread")))
        worker.start()
        worker.join()
    finally:
        uninstall()
    monitoring.flush()
    assert seen == ["main:boom", "thread:in thread"]
    events = api.events()
    assert [e["exception"][0]["mechanism"] for e in events] == [
        {"type": "excepthook", "handled": False},
        {"type": "threading", "handled": False},
    ]
    assert all(e["severity"] == "CRITICAL" for e in events)


async def test_asgi_middleware_reports_errors_with_their_request() -> None:
    from starlette.applications import Starlette
    from starlette.responses import PlainTextResponse
    from starlette.routing import Route

    api = FakeApi()
    monitoring = client(api)

    async def crash(request: Any) -> PlainTextResponse:
        monitoring.set_user({"id": "alice"})
        raise PaymentError(f"card declined for {request.path_params['order']}")

    async def broken(request: Any) -> PlainTextResponse:
        return PlainTextResponse("no", status_code=503)

    app = Starlette(routes=[Route("/orders/{order}/pay", crash, methods=["POST"]), Route("/status", broken)])
    app.add_middleware(MonitoringASGIMiddleware, monitoring=monitoring)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://shop.test") as http:
        assert (await http.post("/orders/81/pay?session=x", headers={"user-agent": "test"})).status_code == 500
        await http.get("/status")
        await http.get("/status")
    monitoring.flush()
    exception, server_error = api.events()
    assert exception["exception"][0]["mechanism"] == {"type": "asgi", "handled": False}
    assert exception["request"]["url"] == "/orders/81/pay"
    assert exception["request"]["route"] == "/orders/{order}/pay"
    assert exception["request"]["userAgent"] == "test"
    assert exception["transaction"] == "POST /orders/{order}/pay"
    assert exception["user"]["id"] == "alice"
    assert server_error["message"] == "GET /status returned 503"  # once, not twice


def test_wsgi_middleware_reports_errors_with_their_request() -> None:
    api = FakeApi()
    monitoring = client(api)

    def app(environ: dict[str, Any], start_response: Any) -> list[bytes]:
        if environ["PATH_INFO"] == "/boom":
            raise KeyError("missing")
        start_response("200 OK", [])
        return [b"ok"]

    wrapped = MonitoringWSGIMiddleware(app, monitoring)
    with pytest.raises(KeyError):
        wrapped({"REQUEST_METHOD": "GET", "PATH_INFO": "/boom", "HTTP_USER_AGENT": "curl"}, lambda *a: None)
    assert wrapped({"REQUEST_METHOD": "GET", "PATH_INFO": "/ok"}, lambda *a: None) == [b"ok"]
    monitoring.flush()
    [event] = api.events()
    assert event["request"] == {"method": "GET", "url": "/boom", "userAgent": "curl"}
    assert event["exception"][0]["mechanism"]["type"] == "wsgi"


def test_module_level_api_is_a_no_op_before_init() -> None:
    nm._client = None
    assert nm.capture_message("x") is False
    nm.set_user({"id": "1"})
    with nm.new_scope():
        pass
    assert nm.flush() is True
