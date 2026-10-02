# Changelog

## 0.1.0

First release of Nex for Python (`pip install nex-py`, `import nex_py`),
with the same API contract and safety rules as `@nerdstackgrp/nex-js`.

- `init()` / `Monitoring`: configuration from options or `NEX_*`
  environment variables (`MONITORING_*` also work), validated once at
  startup.
- Errors with their cause chain and stack frames marked as your code or
  library code, how they were caught, release, environment, runtime and
  OpenTelemetry trace ids.
- `set_user`, `set_tag(s)`, `set_transaction`, `add_breadcrumb`, `new_scope`;
  each request gets its own scope (`contextvars`).
- Crash reports from `sys.excepthook`, `threading.excepthook` and asyncio.
- `MonitoringLogHandler`: log records as breadcrumbs, `logger.error` and
  `logger.exception` as events.
- `MonitoringASGIMiddleware` and `MonitoringWSGIMiddleware`.
- Heartbeats with dependency `checks`, each reported with kind, target,
  latency, metrics and error; `checks.sqlalchemy`, `django`, `sql`,
  `redis`, `mongodb`, `rabbitmq` (management API or pika), `http`, `tcp`
  and `custom`. A hung check reports down after `check_timeout`. Servers
  from before October 2026 get plain statuses automatically.
- Outgoing `httpx` and `requests` calls counted per target for the service
  map; RSS, CPU and thread count with each heartbeat.
- `job()` (context manager and decorator, sync and async) and
  `install_celery()`: scoped, counted and timed background work.
- `report_release()`.
- Background delivery that can't hurt the application: timeouts, bounded
  retries with backoff, a pause after repeated failures, a capped buffer,
  and a hard stop on a rejected token.
