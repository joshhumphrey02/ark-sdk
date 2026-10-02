# nerdstack-monitoring

Nex monitoring for Python services: errors with their stack frames and what
led to them, crash reports, heartbeats with dependency health, and releases.
The Python counterpart of [`@nerdstackgrp/monitoring`](../monitoring), with the
same API and the same rules.

```sh
pip install nerdstack-monitoring
```

```python
import nerdstack_monitoring as monitoring

monitoring.init(service="chat-api")  # MONITORING_API_URL, MONITORING_TOKEN from the environment
```

That's enough to report crashes, turn `logger.error` and `logger.exception`
into events (and every log record into a breadcrumb), and send a heartbeat
every 30 seconds. Unconfigured means off: without an API URL and token every
call is a no-op, so it can ship before the token exists.

## Configuration

| Option | Environment | |
| --- | --- | --- |
| `api_url` | `MONITORING_API_URL` | e.g. `https://nerdstackgrp.com/api/v1/monitoring`. A bare origin gets `/api/v1/monitoring` added. |
| `token` | `MONITORING_TOKEN` | `nsk_live_…`, from the application's SDK tokens in Nex. |
| `service` | `MONITORING_SERVICE` | Slug of this service. Registered in Nex on first report if it isn't yet. |
| `environment` | `MONITORING_ENVIRONMENT` | `production`, `staging`, `development` (defaults to the token's). |
| `release` | `APP_VERSION`, `RELEASE`, commit | Every event carries it; Nex shows which releases an issue happened in. |
| `checks` | | `{"database": lambda: ping_db(), …}`: run for every heartbeat. `True`/`False` or a status. |
| `before_send` | | Change or drop (`None`) an event before it is queued. |
| `redact_keys` | | Extra metadata keys never to send. |

A configured but invalid setup raises `MonitoringConfigError` once, at
startup, listing every problem. It never repeats the token.

`init(crashes=False, logging_integration=False, heartbeat_interval=None)`
turns the integrations off.

## Errors

```python
try:
    charge(order)
except PaymentError:
    monitoring.capture_exception()           # the exception being handled
    raise

monitoring.capture_exception(error, fingerprint=["payments", "declined"], tags={"provider": "paystack"})
monitoring.capture_message("Inventory sync is behind", "warning")
monitoring.capture_message("Production is down", "critical")  # opens an incident
```

Each exception is sent with its cause chain (`raise … from …`, and the
exception being handled when another was raised) and its frames, each marked
as your code or library/standard-library code. Nex groups errors into issues
by the exception type and where your code raised it, so
`ModelUnavailable("for prompt 1")` and `ModelUnavailable("for prompt 2")` from
the same place are one issue.

## Context

```python
monitoring.set_user({"id": user.id, "email": user.email})   # Nex counts users per issue
monitoring.set_tag("tenant", tenant.slug)
monitoring.add_breadcrumb("Calling the model", category="llm", data={"model": "gpt-4.1"})
```

Each request handled by the middleware gets its own copy of the user, tags
and breadcrumbs (`contextvars`), so one request's context never reaches
another's error. Give background work its own scope too:

```python
with monitoring.new_scope() as scope:
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
from nerdstack_monitoring import MonitoringASGIMiddleware

app.add_middleware(MonitoringASGIMiddleware, monitoring=monitoring.get_client())
```

**Flask:**

```python
from nerdstack_monitoring import MonitoringWSGIMiddleware

app.wsgi_app = MonitoringWSGIMiddleware(app.wsgi_app, monitoring.get_client())
```

**Django:** wrap the WSGI or ASGI application in `wsgi.py` / `asgi.py`
the same way.

The middleware gives each request its scope (method, path without query
string, route, user agent), reports exceptions as unhandled and re-raises
them unchanged, and reports 5xx responses without an exception at most once
per route per minute.

## Heartbeats and releases

```python
client = monitoring.init(service="chat-api", checks={
    "database": lambda: db.execute("SELECT 1") is not None,
    "redis": lambda: redis.ping(),
})
client.report_release()   # once per deploy
```

Any failed check makes the service *degraded*; a check that raises counts as
*down*.

## Safety

Nex being slow, down or misconfigured can never hurt the application.
Capture methods only queue the event and never raise. A background daemon
thread sends batches with a 3s timeout. It retries outages with backoff and
pauses after repeated failures. The buffer is capped (1,000 events), and a
rejected token stops reporting. At exit the client flushes for at most 2s.
Credentials are redacted from keys and from text, and URLs lose their query
strings.
