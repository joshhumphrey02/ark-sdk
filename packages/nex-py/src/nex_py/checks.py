"""Ready-made dependency checks.

Each one probes the dependency the way its own client would, and reports
what Nex shows for it: kind, target (host and port, never credentials),
latency (measured by the client) and the numbers worth watching::

    import nex_py as nex
    from nex_py import checks

    nex.init(service="orders-api", checks={
        "database": checks.sqlalchemy(engine),
        "cache": checks.redis(redis_client),
        "queue": checks.rabbitmq("http://guest:guest@rabbit:15672", queues=["orders"], max_queue_depth=1000),
        "payments": checks.http("https://api.paystack.co"),
    })

Clients are used through their public methods only, so nothing here
imports a driver. Checks run in the heartbeat thread and must be
synchronous; one that raises or exceeds ``check_timeout`` reports down.
"""

from __future__ import annotations

import base64
import contextlib
import socket
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

from ._redact import truncate

Result = Any  # bool | status str | {"status", "metrics", "error"}


@dataclass(frozen=True)
class DependencyCheck:
    """A check with what it checks, for Nex's dependency list and service map."""

    check: Callable[[], Result]
    kind: str | None = None
    target: str | None = None


def clean_target(value: str | None) -> str | None:
    """``host:port`` (or the web origin), without credentials, path or query."""
    if not value or not value.strip():
        return None
    raw = value.strip()
    if "://" in raw:
        try:
            parts = urlsplit(raw)
            host = parts.hostname or ""
            if parts.port:
                host = f"{host}:{parts.port}"
            if parts.scheme in ("http", "https"):
                return truncate(f"{parts.scheme}://{host}", 200)
            return truncate(host, 200) if host else None
        except ValueError:
            return None
    return truncate(raw.rsplit("@", 1)[-1], 200)


def _host_port(host: Any, port: Any) -> str | None:
    if not host:
        return None
    return f"{host}:{port}" if port else str(host)


# --- SQL ------------------------------------------------------------------------------------

_DIALECT_KIND = {"postgresql": "postgres", "mysql": "mysql", "mariadb": "mysql", "sqlite": "sqlite", "mssql": "mssql", "oracle": "oracle"}


def sqlalchemy(engine: Any, *, target: str | None = None) -> DependencyCheck:
    """A SQLAlchemy ``Engine``: ``SELECT 1``, plus the pool's size, checked-out
    connections and overflow. A pool with every connection checked out and
    overflowing reports degraded: requests are queueing for a connection."""
    url = getattr(engine, "url", None)
    kind = _DIALECT_KIND.get(getattr(getattr(engine, "dialect", None), "name", ""), "sql")

    def check() -> Result:
        with engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
        metrics: dict[str, float] = {}
        pool = getattr(engine, "pool", None)
        for name, method in (("poolSize", "size"), ("poolCheckedOut", "checkedout"), ("poolOverflow", "overflow"), ("poolIdle", "checkedin")):
            fn = getattr(pool, method, None)
            if callable(fn):
                try:
                    value = fn()
                    if isinstance(value, (int, float)):
                        metrics[name] = value
                except Exception:
                    pass
        busy = metrics.get("poolOverflow", 0) > 0 and metrics.get("poolIdle", 1) == 0
        return {"status": "degraded" if busy else "healthy", "metrics": metrics}

    return DependencyCheck(
        check, kind=kind, target=clean_target(target or (_host_port(getattr(url, "host", None), getattr(url, "port", None)) if url is not None else None))
    )


def django(alias: str = "default") -> DependencyCheck:
    """A Django database connection: ``SELECT 1`` on ``connections[alias]``."""
    from django.db import connections  # type: ignore[import-not-found,import-untyped,unused-ignore]

    settings = connections.databases.get(alias, {})
    engine = str(settings.get("ENGINE", ""))
    kind = "postgres" if "postgres" in engine else "mysql" if "mysql" in engine else "sqlite" if "sqlite" in engine else "sql"

    def check() -> Result:
        with connections[alias].cursor() as cursor:
            cursor.execute("SELECT 1")
        return True

    return DependencyCheck(check, kind=kind, target=clean_target(_host_port(settings.get("HOST"), settings.get("PORT"))))


def sql(connect: Callable[[], Any], *, kind: str = "postgres", target: str | None = None) -> DependencyCheck:
    """Any DB-API driver (psycopg, psycopg2, PyMySQL…): ``connect()`` returns a
    connection, which runs ``SELECT 1`` and is closed."""

    def check() -> Result:
        connection = connect()
        try:
            cursor = connection.cursor()
            cursor.execute("SELECT 1")
            cursor.fetchone()
        finally:
            connection.close()
        return True

    return DependencyCheck(check, kind=kind, target=clean_target(target))


# --- Redis ----------------------------------------------------------------------------------


def redis_info_metrics(info: dict[str, Any]) -> dict[str, float]:
    """``INFO`` (as redis-py returns it) → the numbers worth watching."""
    metrics: dict[str, float] = {}

    def number(key: str) -> float | None:
        value = info.get(key)
        return float(value) if isinstance(value, (int, float)) else None

    used = number("used_memory")
    if used is not None:
        metrics["usedMemoryMb"] = round(used / 1024 / 1024)
        maximum = number("maxmemory")
        if maximum:
            metrics["memoryPercent"] = round(used / maximum * 100, 1)
    for key, name in (
        ("connected_clients", "clients"),
        ("blocked_clients", "blockedClients"),
        ("instantaneous_ops_per_sec", "opsPerSec"),
        ("evicted_keys", "evictedKeys"),
        ("rejected_connections", "rejectedConnections"),
    ):
        value = number(key)
        if value is not None:
            metrics[name] = value
    hits, misses = number("keyspace_hits"), number("keyspace_misses")
    if hits is not None and misses is not None and hits + misses > 0:
        metrics["hitRatePercent"] = round(hits / (hits + misses) * 100, 1)
    return metrics


def redis(client: Any, *, info: bool = True, target: str | None = None) -> DependencyCheck:
    """redis-py: ``PING``, then ``INFO`` for memory, clients, throughput and
    hit rate. Memory at 90% of ``maxmemory`` or more reports degraded."""
    kwargs = getattr(getattr(client, "connection_pool", None), "connection_kwargs", {}) or {}

    def check() -> Result:
        client.ping()
        if not info:
            return True
        metrics: dict[str, float] = {}
        # INFO can be disabled on managed Redis; PING answered, so it is up.
        with contextlib.suppress(Exception):
            metrics = redis_info_metrics(client.info())
        return {"status": "degraded" if metrics.get("memoryPercent", 0) >= 90 else "healthy", "metrics": metrics}

    return DependencyCheck(check, kind="redis", target=clean_target(target or _host_port(kwargs.get("host"), kwargs.get("port"))))


# --- MongoDB --------------------------------------------------------------------------------


def mongodb(client: Any, *, target: str | None = None) -> DependencyCheck:
    """pymongo ``MongoClient``: ``ping`` on admin."""

    def check() -> Result:
        client.admin.command("ping")
        return True

    address = None
    try:
        nodes = list(getattr(client, "nodes", None) or [])
        if nodes:
            address = _host_port(*nodes[0])
    except Exception:
        pass
    return DependencyCheck(check, kind="mongodb", target=clean_target(target or address))


# --- RabbitMQ -------------------------------------------------------------------------------


def _queue_result(found: list[tuple[str, int, int]], max_queue_depth: int | None, require_consumers: bool) -> Result:
    metrics: dict[str, float] = {"messages": 0, "consumers": 0}
    problems: list[str] = []
    for name, messages, consumers in found:
        metrics["messages"] += messages
        metrics["consumers"] += consumers
        metrics[f"{name}.messages"] = messages
        metrics[f"{name}.consumers"] = consumers
        if max_queue_depth is not None and messages > max_queue_depth:
            problems.append(f"{name} has {messages} messages waiting")
        if require_consumers and consumers == 0:
            problems.append(f"{name} has no consumers")
    if problems:
        return {"status": "degraded", "metrics": metrics, "error": truncate("; ".join(problems), 500)}
    return {"status": "healthy", "metrics": metrics}


def rabbitmq(
    connection: Any,
    *,
    queues: Sequence[str] = (),
    max_queue_depth: int | None = None,
    require_consumers: bool = True,
    vhost: str = "/",
    target: str | None = None,
    transport: httpx.BaseTransport | None = None,
) -> DependencyCheck:
    """RabbitMQ, by either:

    - the management API's URL (``http://user:pass@rabbit:15672``), or
    - a pika ``BlockingConnection``: a short-lived channel of its own does a
      passive declare of each queue, so a missing queue can't close yours.

    Reports messages waiting and consumers per queue. More than
    ``max_queue_depth`` waiting, or a queue nobody consumes, reports
    degraded: the broker is up, but work is piling up.
    """
    if isinstance(connection, str):
        parts = urlsplit(connection)
        auth = None
        if parts.username:
            auth = "Basic " + base64.b64encode(f"{parts.username}:{parts.password or ''}".encode()).decode()
        port = f":{parts.port}" if parts.port else ""
        base = f"{parts.scheme}://{parts.hostname}{port}{parts.path.rstrip('/')}"
        headers = {"Accept": "application/json", **({"Authorization": auth} if auth else {})}

        def check_http() -> Result:
            with httpx.Client(timeout=3.0, transport=transport, headers=headers) as http:
                if not queues:
                    http.get(f"{base}/api/overview").raise_for_status()
                    return True
                found = []
                for name in queues:
                    response = http.get(f"{base}/api/queues/{quote(vhost, safe='')}/{quote(name, safe='')}")
                    response.raise_for_status()
                    q = response.json()
                    found.append((name, int(q.get("messages_ready", q.get("messages", 0)) or 0), int(q.get("consumers", 0) or 0)))
                return _queue_result(found, max_queue_depth, require_consumers)

        return DependencyCheck(check_http, kind="rabbitmq", target=clean_target(target or f"{parts.hostname}{port}"))

    def check_amqp() -> Result:
        channel = connection.channel()
        try:
            found = []
            for name in queues:
                frame = channel.queue_declare(queue=name, passive=True)
                found.append((name, int(frame.method.message_count), int(frame.method.consumer_count)))
            return _queue_result(found, max_queue_depth, require_consumers) if found else True
        finally:
            try:
                if channel.is_open:
                    channel.close()
            except Exception:
                pass

    params = getattr(connection, "_impl", None)
    params = getattr(params, "params", None)
    return DependencyCheck(check_amqp, kind="rabbitmq", target=clean_target(target or _host_port(getattr(params, "host", None), getattr(params, "port", None))))


# --- Network --------------------------------------------------------------------------------


def http(
    url: str,
    *,
    method: str = "GET",
    expect_status: int | None = None,
    headers: dict[str, str] | None = None,
    transport: httpx.BaseTransport | None = None,
    target: str | None = None,
) -> DependencyCheck:
    """Any HTTP dependency: healthy on 2xx/3xx (or exactly ``expect_status``)."""

    def check() -> Result:
        with httpx.Client(timeout=3.0, transport=transport, follow_redirects=False) as client:
            response = client.request(method, url, headers=headers)
        ok = response.status_code == expect_status if expect_status is not None else response.status_code < 400
        return True if ok else {"status": "down", "error": f"Answered {response.status_code}"}

    return DependencyCheck(check, kind="http", target=clean_target(target or url))


def tcp(host: str, port: int, *, timeout: float = 2.0, target: str | None = None) -> DependencyCheck:
    """Any TCP service: connects and hangs up."""

    def check() -> Result:
        with socket.create_connection((host, port), timeout=timeout):
            return True

    return DependencyCheck(check, kind="tcp", target=clean_target(target or f"{host}:{port}"))


def custom(kind: str, check: Callable[[], Result], *, target: str | None = None) -> DependencyCheck:
    """Your own probe, shown in Nex with a kind and target."""
    return DependencyCheck(check, kind=kind, target=clean_target(target))
