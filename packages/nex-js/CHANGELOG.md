# Changelog

## 0.3.0

Renamed from `@nerdstackgrp/monitoring` to `@nerdstackgrp/nex-js`, now with
a browser side. Replace the import; the server API is unchanged and the
`MONITORING_*` variables still work. Dependency reports, calls, vitals and
jobs need a Nex server from October 2026; with an older server, heartbeats
fall back to plain dependency statuses by themselves.

### Added

- `@nerdstackgrp/nex-js/client`: errors and crashes from browsers, with the
  page, browser, OS, device, user, release and breadcrumbs (navigations,
  clicks, fetch/XHR, console). Authenticates with a public browser key
  (`nex_pub_…`); refuses secret tokens.
- `@nerdstackgrp/nex-js/react`: `ErrorBoundary` and `reactErrorHandler()`.
- `@nerdstackgrp/nex-js/server`, the same as the package root, adds:
  - `init()` and module functions (`captureException`, `setUser`, `job`, …)
    sharing one client per process;
  - `checks.postgres`, `mysql`, `redis`, `mongodb`, `rabbitmq`, `http`,
    `tcp`, `custom`: dependency checks that report kind, target, latency
    and metrics (pool usage, Redis memory and hit rate, queue depth and
    consumers);
  - outgoing HTTP calls per target with each heartbeat, for the service map
    (on Bun too);
  - memory, CPU and event-loop delay with each heartbeat;
  - `job(name, fn)`: scoped, counted and timed background work;
  - `captureRequestError()` for Next.js `onRequestError`.
- Distributed tracing: request, outgoing-call and job spans, W3C
  `traceparent` in and out, `trace()`, `startSpan()`, `traceHeaders()`,
  `tracesSampleRate` (default 0.1); browsers trace requests to their own
  APIs. Errors link to their trace.
- Heartbeats carry an incoming-request summary and custom metrics
  (`metric()`, `increment()`, `gauge()`) for Nex's graphs and alert rules.
- `NEX_API_URL`, `NEX_TOKEN`, `NEX_SERVICE`, `NEX_ENVIRONMENT`, `NEX_ENABLED`,
  `NEX_TRACES_SAMPLE_RATE`.
- Stack traces from Firefox and Safari.

### Changed

- Heartbeats send each dependency as a report (`{ status, kind, target,
  latencyMs, metrics, error }`) instead of a bare status.
- The SDK's log prefix is `[nex]`.

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
