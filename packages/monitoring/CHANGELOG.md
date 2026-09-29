# Changelog

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
