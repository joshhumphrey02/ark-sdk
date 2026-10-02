# Changelog

## 0.1.0

First release of Nex monitoring for Python, with the same API contract and
safety rules as the Node SDK (`@nerdstackgrp/monitoring` 0.2.0).

- `init()` / `Monitoring`: configuration from options or `MONITORING_*`
  environment variables, validated once at startup.
- Errors with their cause chain and stack frames marked as your code or
  library code, how they were caught, release, environment, runtime and
  OpenTelemetry trace ids.
- `set_user`, `set_tag(s)`, `set_transaction`, `add_breadcrumb`, `new_scope`;
  each request gets its own scope (`contextvars`).
- Crash reports from `sys.excepthook`, `threading.excepthook` and asyncio.
- `MonitoringLogHandler`: log records as breadcrumbs, `logger.error` and
  `logger.exception` as events.
- `MonitoringASGIMiddleware` and `MonitoringWSGIMiddleware`.
- Heartbeats with dependency `checks`, `report_release()`.
- Background delivery that can't hurt the application: timeouts, bounded
  retries with backoff, a pause after repeated failures, a capped buffer,
  and a hard stop on a rejected token.
