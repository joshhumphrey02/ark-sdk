"""Traces across services, request summaries and custom metrics. The API and
the downstream service are mock transports; nothing leaves the machine."""

from __future__ import annotations

import asyncio
import io
import json
from typing import Any

import httpx
import pytest

import nex_py as nex
from nex_py import Monitoring, MonitoringASGIMiddleware, MonitoringWSGIMiddleware, format_traceparent, parse_traceparent
from nex_py._scope import reset_global_scope

TOKEN = "nsk_test_" + "A1b2C3d4E5" * 4 + "xyz"
INCOMING = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"


class FakeApi:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append((request.url.path, json.loads(request.content) if request.content else None))
        return httpx.Response(202, json={"ok": True})

    def spans(self) -> list[dict[str, Any]]:
        return [span for path, body in self.calls if path.endswith("/spans") for span in body["spans"]]

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
        service="orders-api",
        flush_interval=0,
        dedupe_window=0,
        transport=httpx.MockTransport(api.handler),
        **options,
    )


def test_traceparent_round_trip() -> None:
    context = parse_traceparent(INCOMING)
    assert context is not None and context.trace_id == "4bf92f3577b34da6a3ce929d0e0e4736" and context.sampled
    assert format_traceparent(context) == INCOMING
    assert parse_traceparent("00-" + "0" * 32 + "-00f067aa0ba902b7-01") is None
    assert parse_traceparent(None) is None


def test_asgi_request_continues_the_trace_and_passes_it_on() -> None:
    api = FakeApi()
    monitoring = client(api, traces_sample_rate=0)
    monitoring.start(interval=3600, runtime_metrics=False)
    seen: list[str | None] = []
    downstream = httpx.MockTransport(lambda request: (seen.append(request.headers.get("traceparent")), httpx.Response(200))[1])

    async def app(scope: Any, receive: Any, send: Any) -> None:
        async with httpx.AsyncClient(transport=downstream) as http:
            await http.get("http://payments:8080/charge?card=4111")
        with monitoring.trace("SELECT orders", kind="client", attributes={"db.system": "postgresql"}):
            pass
        monitoring.capture_exception(ValueError("partial failure"))
        await send({"type": "http.response.start", "status": 201, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    middleware = MonitoringASGIMiddleware(app, monitoring)
    sent: list[Any] = []

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b""}

    async def send(message: Any) -> None:
        sent.append(message)

    scope = {"type": "http", "method": "POST", "path": "/orders", "headers": [(b"traceparent", INCOMING.encode())]}
    try:
        asyncio.run(middleware(scope, receive, send))
        assert monitoring.flush(3)
        spans = api.spans()
        server = next(s for s in spans if s["kind"] == "server")
        assert server["traceId"] == "4bf92f3577b34da6a3ce929d0e0e4736"
        assert server["parentSpanId"] == "00f067aa0ba902b7"
        assert server["name"] == "POST /orders"
        assert server["service"] == "orders-api"
        assert server["attributes"]["http.status_code"] == 201
        call = next(s for s in spans if s["name"].startswith("GET http://payments"))
        assert call["parentSpanId"] == server["spanId"]
        assert "card" not in json.dumps(spans)
        header = parse_traceparent(seen[0])
        assert header is not None and header.trace_id == server["traceId"] and header.span_id == call["spanId"]
        db = next(s for s in spans if s["name"] == "SELECT orders")
        assert db["parentSpanId"] == server["spanId"] and db["attributes"]["db.system"] == "postgresql"
        assert api.events()[0]["traceId"] == server["traceId"]
    finally:
        monitoring.close(0.5)


def test_wsgi_request_marks_server_errors_and_unsampled_traces_send_nothing() -> None:
    api = FakeApi()
    monitoring = client(api, traces_sample_rate=1)

    def app(environ: dict[str, Any], start_response: Any) -> list[bytes]:
        start_response("503 Service Unavailable", [])
        return [b"down"]

    wsgi = MonitoringWSGIMiddleware(app, monitoring)
    environ = {"REQUEST_METHOD": "GET", "PATH_INFO": "/health-ish", "wsgi.input": io.BytesIO()}
    wsgi(environ, lambda *a: None)
    wsgi({**environ, "HTTP_TRACEPARENT": INCOMING[:-2] + "00"}, lambda *a: None)
    assert monitoring.flush(3)
    spans = api.spans()
    assert len(spans) == 1, "the unsampled trace is not recorded"
    assert spans[0]["status"] == "error" and spans[0]["parentSpanId"] is None
    monitoring.close(0.5)


def test_trace_nests_and_fails_with_its_code_and_jobs_are_spans() -> None:
    api = FakeApi()
    monitoring = client(api, traces_sample_rate=1)

    @monitoring.trace("import")
    def run_import() -> None:
        with monitoring.trace("parse"):
            pass
        raise ValueError("bad row")

    with pytest.raises(ValueError):
        run_import()
    with monitoring.job("send-receipt"):
        pass
    assert monitoring.flush(3)
    spans = {s["name"]: s for s in api.spans()}
    assert spans["import"]["status"] == "error"
    assert spans["parse"]["parentSpanId"] == spans["import"]["spanId"]
    assert spans["send-receipt"]["kind"] == "consumer"
    monitoring.close(0.5)


def test_heartbeats_carry_request_summary_and_custom_metrics() -> None:
    api = FakeApi()
    monitoring = client(api)

    def app(environ: dict[str, Any], start_response: Any) -> list[bytes]:
        start_response("500 Error" if environ["PATH_INFO"] == "/bad" else "200 OK", [])
        return [b""]

    wsgi = MonitoringWSGIMiddleware(app, monitoring)
    for path in ("/a", "/a", "/bad"):
        wsgi({"REQUEST_METHOD": "GET", "PATH_INFO": path, "wsgi.input": io.BytesIO()}, lambda *a: None)
    monitoring.increment("orders.placed")
    monitoring.increment("orders.placed", 2)
    monitoring.gauge("queue.depth", 40, "jobs")
    assert monitoring.metric("bad name!", 1) is False
    monitoring.heartbeat()
    beat = next(body for path, body in reversed(api.calls) if path.endswith("/heartbeat"))
    assert beat["requests"]["count"] == 3 and beat["requests"]["errors"] == 1 and beat["requests"]["windowSeconds"] >= 1
    assert beat["metrics"] == [{"name": "orders.placed", "type": "counter", "value": 3}, {"name": "queue.depth", "type": "gauge", "value": 40, "unit": "jobs"}]
    monitoring.heartbeat()
    beat = next(body for path, body in reversed(api.calls) if path.endswith("/heartbeat"))
    assert beat["requests"]["count"] == 0
    assert beat["metrics"] == [{"name": "queue.depth", "type": "gauge", "value": 40, "unit": "jobs"}]
    monitoring.close(0.5)


def test_module_helpers_work_without_init(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nex, "_client", None)
    with nex.trace("noop"):
        pass
    assert nex.metric("x", 1) is False
    assert nex.trace_headers() == {}
