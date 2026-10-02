"""Dependency checks, the service map, vitals and jobs: what heartbeats carry
beyond "alive". The API is a mock transport; nothing leaves the machine."""

from __future__ import annotations

import asyncio
import contextlib
import json
import socket
import time
from typing import Any

import httpx
import pytest

import nex_py as nex
from nex_py import Monitoring, checks
from nex_py._scope import reset_global_scope

TOKEN = "nsk_test_" + "A1b2C3d4E5" * 4 + "xyz"


class FakeApi:
    def __init__(self, respond: Any = None) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.respond = respond

    def handler(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        self.calls.append((request.url.path, body))
        if self.respond:
            custom = self.respond(request.url.path, body)
            if custom is not None:
                return custom  # type: ignore[no-any-return]
        return httpx.Response(202, json={"ok": True})

    def heartbeats(self) -> list[dict[str, Any]]:
        return [body for path, body in self.calls if path.endswith("/heartbeat")]

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
        service="orders-worker",
        flush_interval=0,
        dedupe_window=0,
        transport=httpx.MockTransport(api.handler),
        **options,
    )


# --- Checks ---------------------------------------------------------------------------------


class FakeRedis:
    connection_pool = type("Pool", (), {"connection_kwargs": {"host": "cache", "port": 6379, "password": "secret"}})()

    def ping(self) -> bool:
        return True

    def info(self) -> dict[str, Any]:
        return {"used_memory": 943_718_400, "maxmemory": 1_048_576_000, "connected_clients": 12, "keyspace_hits": 90, "keyspace_misses": 10}


def test_redis_check_reports_memory_clients_and_hit_rate() -> None:
    check = checks.redis(FakeRedis())
    assert check.kind == "redis"
    assert check.target == "cache:6379"
    result = check.check()
    assert result["status"] == "degraded"
    assert result["metrics"] == {"usedMemoryMb": 900, "memoryPercent": 90.0, "clients": 12, "hitRatePercent": 90.0}


def test_targets_never_carry_credentials() -> None:
    assert checks.clean_target("postgresql://admin:hunter2@db.internal:5432/app") == "db.internal:5432"
    assert checks.clean_target("https://user:pw@api.paystack.co/health?key=x") == "https://api.paystack.co"
    assert checks.clean_target("admin:pw@db:5432") == "db:5432"


class FakeEngine:
    url = type("Url", (), {"host": "db", "port": 5432})()
    dialect = type("Dialect", (), {"name": "postgresql"})()

    class pool:
        @staticmethod
        def size() -> int:
            return 5

        @staticmethod
        def checkedout() -> int:
            return 5

        @staticmethod
        def overflow() -> int:
            return 2

        @staticmethod
        def checkedin() -> int:
            return 0

    def __init__(self) -> None:
        self.queries: list[str] = []

    @contextlib.contextmanager
    def connect(self) -> Any:
        engine = self

        class Connection:
            def exec_driver_sql(self, sql: str) -> None:
                engine.queries.append(sql)

        yield Connection()


def test_sqlalchemy_check_runs_select_1_and_reports_a_saturated_pool() -> None:
    engine = FakeEngine()
    check = checks.sqlalchemy(engine)
    assert (check.kind, check.target) == ("postgres", "db:5432")
    result = check.check()
    assert engine.queries == ["SELECT 1"]
    assert result["status"] == "degraded"
    assert result["metrics"] == {"poolSize": 5, "poolCheckedOut": 5, "poolOverflow": 2, "poolIdle": 0}


def test_rabbitmq_management_api_reports_depth_and_consumers() -> None:
    seen: list[tuple[str, str | None]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append((str(request.url), request.headers.get("authorization")))
        depth = {"orders": (5000, 2), "emails": (3, 0)}[request.url.path.rsplit("/", 1)[-1]]
        return httpx.Response(200, json={"messages_ready": depth[0], "consumers": depth[1]})

    check = checks.rabbitmq("http://guest:guest@rabbit:15672", queues=["orders", "emails"], max_queue_depth=1000, transport=httpx.MockTransport(handler))
    assert check.target == "rabbit:15672"
    result = check.check()
    assert seen[0] == ("http://rabbit:15672/api/queues/%2F/orders", "Basic Z3Vlc3Q6Z3Vlc3Q=")
    assert result["status"] == "degraded"
    assert result["metrics"]["messages"] == 5003
    assert result["metrics"]["emails.consumers"] == 0
    assert "orders has 5000 messages waiting" in result["error"]
    assert "emails has no consumers" in result["error"]


def test_rabbitmq_over_amqp_uses_its_own_channel() -> None:
    closed: list[bool] = []

    class Channel:
        is_open = True

        def queue_declare(self, queue: str, passive: bool) -> Any:
            assert passive
            method = type("Method", (), {"message_count": 4, "consumer_count": 1})()
            return type("Frame", (), {"method": method})()

        def close(self) -> None:
            closed.append(True)

    connection = type("Connection", (), {"channel": lambda self: Channel()})()
    result = checks.rabbitmq(connection, queues=["orders"]).check()
    assert result == {"status": "healthy", "metrics": {"messages": 4, "consumers": 1, "orders.messages": 4, "orders.consumers": 1}}
    assert closed == [True]


def test_tcp_check() -> None:
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen()
    port = server.getsockname()[1]
    try:
        assert checks.tcp("127.0.0.1", port).check() is True
    finally:
        server.close()
    with pytest.raises(OSError):
        checks.tcp("127.0.0.1", port, timeout=0.5).check()


# --- Heartbeats -----------------------------------------------------------------------------


def test_heartbeat_sends_full_reports_and_times_out_hung_checks() -> None:
    api = FakeApi()

    def hangs() -> bool:
        time.sleep(1)
        return True

    monitoring = client(api, check_timeout=0.2, checks={"cache": checks.redis(FakeRedis()), "slow": hangs, "plain": lambda: True})
    started = time.monotonic()
    assert monitoring.heartbeat() is True
    assert time.monotonic() - started < 0.9, "a hung check doesn't hold the heartbeat"
    deps = api.heartbeats()[-1]["dependencies"]
    assert deps["cache"]["kind"] == "redis" and deps["cache"]["target"] == "cache:6379"
    assert isinstance(deps["cache"]["latencyMs"], int)
    assert deps["cache"]["metrics"]["clients"] == 12
    assert deps["slow"]["status"] == "down" and deps["slow"]["error"] == "No answer within 200ms"
    assert deps["plain"]["status"] == "healthy"
    assert api.heartbeats()[-1]["status"] == "degraded"


def test_old_servers_get_plain_statuses() -> None:
    def respond(path: str, body: Any) -> httpx.Response | None:
        if path.endswith("/heartbeat") and isinstance((body.get("dependencies") or {}).get("database"), dict):
            return httpx.Response(422, json={"detail": "dependencies.database: Invalid enum value"})
        return None

    api = FakeApi(respond)
    monitoring = client(api, checks={"database": lambda: True})
    assert monitoring.heartbeat() is True
    assert monitoring.heartbeat() is True
    beats = api.heartbeats()
    assert len(beats) == 3, "one rejected attempt, then plain statuses"
    assert beats[1]["dependencies"] == {"database": "healthy"}
    assert beats[2]["dependencies"] == {"database": "healthy"}


def test_start_counts_outgoing_calls_and_samples_vitals() -> None:
    api = FakeApi()
    monitoring = client(api)
    monitoring.start(interval=3600)
    try:
        upstream = httpx.MockTransport(lambda request: httpx.Response(503 if request.url.path == "/fail" else 200))
        with httpx.Client(transport=upstream) as http:
            for path in ("/a?token=x", "/b", "/fail"):
                http.get(f"https://payments.internal:8443{path}")
        time.sleep(0.05)
        assert monitoring.heartbeat() is True
        beat = api.heartbeats()[-1]
        calls = {c["target"]: c for c in beat["calls"]}
        assert "https://nex.example" not in "".join(calls), "calls to Nex itself aren't counted"
        payments = calls["https://payments.internal:8443"]
        assert (payments["count"], payments["errors"]) == (3, 1)
        assert "token" not in json.dumps(beat["calls"])
        assert beat["runtime"]["threads"] >= 1
        assert "cpuPercent" in beat["runtime"]
    finally:
        monitoring.close(0.5)
    assert httpx.Client.send.__name__ == "send" and httpx.Client.send.__module__ == "httpx._client", "close() restores httpx"


# --- Jobs -----------------------------------------------------------------------------------


def test_jobs_are_scoped_counted_and_reported() -> None:
    api = FakeApi()
    monitoring = client(api)

    with monitoring.job("process-order") as scope:
        scope.set_tag("order", "81")

    with pytest.raises(ValueError), monitoring.job("process-order"):
        raise ValueError("bad payload")

    @monitoring.job("sync-invoices", tags={"source": "cron"})
    async def sync() -> int:
        raise TimeoutError("ledger timed out")

    with pytest.raises(TimeoutError):
        asyncio.run(sync())

    assert monitoring.flush(2)
    events = {e["message"]: e for e in api.events()}
    bad = events["bad payload"]
    assert bad["transaction"] == "process-order"
    assert bad["tags"]["job"] == "process-order"
    assert bad["handled"] is False and bad["exception"][0]["mechanism"]["type"] == "job"
    assert events["ledger timed out"]["tags"]["source"] == "cron"

    monitoring.heartbeat()
    jobs = {j["name"]: j for j in api.heartbeats()[-1]["jobs"]}
    assert (jobs["process-order"]["count"], jobs["process-order"]["failed"]) == (2, 1)
    assert "lastFailedAt" in jobs["process-order"]
    assert jobs["sync-invoices"]["failed"] == 1
    monitoring.heartbeat()
    assert "jobs" not in api.heartbeats()[-1], "stats reset after each heartbeat"


def test_module_job_without_init_just_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(nex, "_client", None)

    @nex.job("noop")
    def work() -> int:
        return 7

    assert work() == 7
    with nex.job("noop"):
        pass


def test_nex_environment_variables(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("MONITORING_API_URL", "MONITORING_URL", "MONITORING_TOKEN", "MONITORING_SERVICE"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("NEX_API_URL", "https://nex.example/api/v1/monitoring")
    monkeypatch.setenv("NEX_TOKEN", TOKEN)
    monkeypatch.setenv("NEX_SERVICE", "api")
    monitoring = Monitoring()
    assert monitoring.enabled and monitoring.service == "api"
    monitoring.close(0)
