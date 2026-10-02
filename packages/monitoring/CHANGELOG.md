# Changelog

## 0.2.0

Errors arrive with everything Nex needs to group them and show what led to
them. Needs a Nex server from October 2026 to use the new context; older
servers ignore it and keep working.

### Added

- Errors carry their chain (the error and up to four causes) with stack
  frames, each marked as application or library/runtime code, and how they
  were caught (`mechanism`, `handled`). Nex groups issues by these.
- `setUser`, `setTag`/`setTags`, `setTransaction`, `addBreadcrumb` and
  `withScope`. Instrumented requests (`httpMiddleware`, `instrumentHttp`,
  `wrapFetchHandler`) each get their own scope, with the request's method,
  path, route and user agent attached to their errors.
- Automatic breadcrumbs from `start()`: console output and outgoing
  `fetch`/`node:http` calls (from Node's diagnostics channels).
- `errorHandler()`: Express error middleware that reports 5xx errors with
  their request.
- `fingerprint` and `tags` options on captures.
- OpenTelemetry trace and span ids on events when the application uses
  OpenTelemetry (no dependency added).
- Runtime/OS contexts and the SDK name/version on every event.

### Changed

- `start()` now reports crashes (uncaught exceptions, unhandled rejections)
  by default. Pass `captureUnhandled: false` to opt out. The process still
  crashes exactly as it would without the SDK.
- An error thrown by a `wrapFetchHandler` handler is reported once, as the
  exception with its request, instead of as a generic 500 event.
- Batches may be up to 900 KB (the events endpoint now accepts 1 MB).

## 0.1.0

First release of the Nerdstack Monitoring SDK for Node.js and Bun.

### Added

- `createMonitoring()`: configuration from options or `MONITORING_*`
  environment variables, validated once at startup with a
  `MonitoringConfigError` that lists every problem and never repeats the
  token.
- Heartbeats: `heartbeat()` with optional dependency health or configured
  `checks`, and `start()`/`stop()` for automatic, non-overlapping heartbeats
  that never keep the process alive.
- Error reporting: `captureException`, `captureError`, `captureMessage`
  (`info` / `warning` / `error` / `critical`), `track`, `captureEvent`, with
  `setContext`/`clearContext`, cause chains, request ids, and de-duplication.
- `reportRelease()`, with version and commit detected from common CI/host
  variables, and `fetchConfig()`.
- Opt-in fatal-error reporting (`captureUnhandled`) that preserves Node's crash
  behaviour.
- Opt-in HTTP instrumentation: `instrumentHttp` (any `node:http` server),
  `httpMiddleware` (Connect/Express), `wrapFetchHandler` (Bun.serve, Elysia,
  Hono, Next.js route handlers).
- Key- and value-based redaction, size limits matching the API, `redactKeys`
  and `beforeSend`.
- Delivery that cannot hurt the host application: per-request timeouts, bounded
  retries with backoff and `Retry-After`, a pause after repeated failures,
  a bounded in-memory buffer, and a hard stop on a rejected token.
