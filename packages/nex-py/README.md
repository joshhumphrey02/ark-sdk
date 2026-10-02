# nex-py

Nex for Python services: errors with their stack frames and what led to
them, crash reports, the health of every database, cache and broker behind
the service, outgoing calls for the service map, process vitals, background
jobs, and releases. The Python counterpart of
[`@nerdstackgrp/nex-js`](../nex-js), with the same API and the same rules.

```sh
npx @nerdstackgrp/nex-wizard@latest -i python   # installs and sets it up (FastAPI, Flask, Django)
# or by hand:
pip install nex-python
```

```python
import nex_py as nex
from nex_py import checks

nex.init(service="chat-api", checks={    # NEX_API_URL, NEX_TOKEN from the environment
    "database": checks.sqlalchemy(engine),
    "cache": checks.redis(redis_client),
})
```

That's enough to report crashes, turn `logger.error` and `logger.exception`
into events (and every log record into a breadcrumb), and send a heartbeat
every 30 seconds with each dependency's health, the service's outgoing
calls, its vitals and its jobs. Unconfigured means off: without an API URL and token every
call is a no-op, so it can ship before the token exists.

## Configuration

| Option | Environment | |
| --- | --- | --- |
| `api_url` | `NEX_API_URL` (or `MONITORING_API_URL`) | e.g. `https://nerdstackgrp.com/api/v1/monitoring`. A bare origin gets `/api/v1/monitoring` added. |
| `token` | `NEX_TOKEN` (or `MONITORING_TOKEN`) | `nsk_live_…`, from the application's SDK tokens in Nex. |
| `service` | `NEX_SERVICE` (or `MONITORING_SERVICE`) | Slug of this service. Registered in Nex on first report if it isn't yet. |
| `environment` | `NEX_ENVIRONMENT` (or `MONITORING_ENVIRONMENT`) | `production`, `staging`, `development` (defaults to the token's). |
| `release` | `APP_VERSION`, `RELEASE`, commit | Every event carries it; Nex shows which releases an issue happened in. |
| `checks` | | `{"database": checks.sqlalchemy(engine), …}`: run for every heartbeat. See [Dependencies](#dependencies). |
| `check_timeout` | | Seconds a check may take before it reports down. Default 2. |
| `before_send` | | Change or drop (`None`) an event before it is queued. |
| `redact_keys` | | Extra metadata keys never to send. |

A configured but invalid setup raises `MonitoringConfigError` once, at
startup, listing every problem. It never repeats the token.

`init(crashes=False, logging_integration=False, heartbeat_interval=None,
service_map=False, runtime_metrics=False)` turns the integrations off.

## Errors

```python
try:
    charge(order)
except PaymentError:
    nex.capture_exception()           # the exception being handled
    raise

nex.capture_exception(error, fingerprint=["payments", "declined"], tags={"provider": "paystack"})
nex.capture_message("Inventory sync is behind", "warning")
nex.capture_message("Production is down", "critical")  # opens an incident
```

Each exception is sent with its cause chain (`raise … from …`, and the
exception being handled when another was raised) and its frames, each marked
as your code or library/standard-library code. Nex groups errors into issues
by the exception type and where your code raised it, so
`ModelUnavailable("for prompt 1")` and `ModelUnavailable("for prompt 2")` from
the same place are one issue.

## Context

```python
nex.set_user({"id": user.id, "email": user.email})   # Nex counts users per issue
nex.set_tag("tenant", tenant.slug)
nex.add_breadcrumb("Calling the model", category="llm", data={"model": "gpt-4.1"})
```

Each request handled by the middleware gets its own copy of the user, tags
and breadcrumbs (`contextvars`), so one request's context never reaches
another's error. Give background work its own scope too:

```python
with nex.new_scope() as scope:
    scope.set_tag("job", job.name)
    run(job)
```

Breadcrumbs: the last 100 go with the next error. With the logging
integration, every log record at the levels your app already logs becomes
one, including `httpx` request lines (calls to Nex itself are skipped).

When the application uses OpenTelemetry, events carry the active trace and
span ids.

## Frameworks

**FastAPI / Starlette:**

```python
from nex_py import MonitoringASGIMiddleware

app.add_middleware(MonitoringASGIMiddleware, monitoring=nex.get_client())
```

**Flask:**

```python
from nex_py import MonitoringWSGIMiddleware

app.wsgi_app = MonitoringWSGIMiddleware(app.wsgi_app, nex.get_client())
```

**Django:** wrap the WSGI or ASGI application in `wsgi.py` / `asgi.py`
the same way.

The middleware gives each request its scope (method, path without query
string, route, user agent), reports exceptions as unhandled and re-raises
them unchanged, and reports 5xx responses without an exception at most once
per route per minute.

## Dependencies

```python
from nex_py import checks

nex.init(service="orders-api", checks={
    "database": checks.sqlalchemy(engine),        # or checks.django(), checks.sql(psycopg.connect…)
    "cache": checks.redis(redis_client),
    "queue": checks.rabbitmq("http://guest:guest@rabbit:15672", queues=["orders"], max_queue_depth=1000),
    "documents": checks.mongodb(mongo_client),
    "payments": checks.http("https://api.paystack.co"),
    "mail": checks.tcp("smtp.internal", 587),
})
```

| Check | Probe | Reports |
| --- | --- | --- |
| `checks.sqlalchemy(engine)` | `SELECT 1` | pool size, checked out, overflow, idle; saturated ⇒ degraded |
| `checks.django(alias)` | `SELECT 1` | — |
| `checks.sql(connect, kind=…)` | `SELECT 1` on a fresh DB-API connection | — |
| `checks.redis(client)` | `PING`, `INFO` | memory (MB, % of maxmemory), clients, ops/s, hit rate; ≥ 90% memory ⇒ degraded |
| `checks.mongodb(client)` | `ping` | — |
| `checks.rabbitmq(url \| pika connection, queues=…)` | management API, or a passive declare on its own channel | messages waiting and consumers per queue; over `max_queue_depth` or no consumers ⇒ degraded |
| `checks.http(url)` | `GET` | 2xx/3xx healthy |
| `checks.tcp(host, port)` | connect | — |
| `checks.custom(kind, fn, target=…)` | yours | what `fn` returns |

Each dependency is reported with its kind, target (host and port, never
credentials), latency and error. A plain function still works: return
`True`/`False`, a status, or `{"status", "metrics", "error"}`. Checks run in
parallel in the heartbeat thread, so they must be synchronous; one that
raises or takes longer than `check_timeout` reports down. Any dependency
that isn't healthy makes the service *degraded*.

## Service map and vitals

After `init()` (or `start()`), outgoing `httpx` and `requests` calls are
counted per target (count, failures, p50/p95/max) and sent with each
heartbeat; only the scheme, host and port, never paths or query strings.
Nex joins them with the other services' reports to draw which service calls
which. Heartbeats also carry RSS, CPU and thread count.

## Traces

Each request through the ASGI/WSGI middleware is a span, continuing the
caller's trace when it sent a W3C `traceparent`; every `httpx` or
`requests` call made while handling it is a child span and carries
`traceparent` on, so the next service (on nex-py, nex-js or OpenTelemetry)
joins the same trace. Jobs are spans too. Nex shows each trace as a
waterfall across services, with its errors.

```python
with nex.trace("SELECT orders", kind="client", attributes={"db.system": "postgresql"}):
    rows = db.execute(query)

@nex.trace("render invoice")
def render(invoice): ...

publish(message, headers=nex.trace_headers())   # propagate by hand
```

`traces_sample_rate` (default 0.1, env `NEX_TRACES_SAMPLE_RATE`) is the
share of new traces kept; a trace started elsewhere keeps its decision.
Spans are sent in batches every few seconds.

## Metrics

Heartbeats carry the requests handled since the last one (count, errors,
p50, p95, max) and your own metrics, which Nex graphs and alert rules watch:

```python
nex.increment("orders.placed")            # counter: summed per heartbeat
nex.gauge("queue.depth", depth, "jobs")   # gauge: the last value
```

## Jobs and workers

```python
with nex.job("process-order"):
    handle(message)

@nex.job("sync-invoices")
async def sync_invoices(): ...
```

Each run gets its own scope (its errors carry the job's name and are
reported as unhandled), and is counted and timed: Nex shows each job's
runs, failures and p95 per service. The exception is re-raised.

**Celery:** in the worker, `nex.install_celery(nex.get_client())` makes
every task a job.

## Heartbeats and releases

```python
client = nex.init(service="chat-api", checks={"database": checks.sqlalchemy(engine)})
client.report_release()   # once per deploy
```

## Safety

Nex being slow, down or misconfigured can never hurt the application.
Capture methods only queue the event and never raise. A background daemon
thread sends batches with a 3s timeout. It retries outages with backoff and
pauses after repeated failures. The buffer is capped (1,000 events), and a
rejected token stops reporting. At exit the client flushes for at most 2s.
Credentials are redacted from keys and from text, and URLs lose their query
strings.
