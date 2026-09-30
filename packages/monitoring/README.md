# `@nerdstackgrp/monitoring`

Report a service's health, errors and deployments to Nerdstack Operations, a
multi-tenant application monitoring platform.

```ts
import { createMonitoring } from "@nerdstackgrp/monitoring";

const monitoring = createMonitoring({
  apiUrl: process.env.MONITORING_API_URL!,
  token: process.env.MONITORING_TOKEN!,
  service: "api",
});

monitoring.start();
```

Those four lines report a heartbeat every 30 seconds. The rest of this
document covers what else the SDK can do and how it behaves.

- Node.js 20+ and Bun. Server-side only; there is no browser build.
- Zero runtime dependencies, and no framework dependencies.
- ESM, CommonJS and TypeScript declarations.
- If the monitoring API is unreachable, your application does not notice.
- The SDK knows one address, `MONITORING_API_URL`, so the API can move to a
  new host without an SDK release.

## Install

```bash
npm install @nerdstackgrp/monitoring
# or: bun add @nerdstackgrp/monitoring
```

## Configuration

Add the application and its services in the Operations app, then create an
SDK token for the environment this deployment runs in (**Application →
Settings → SDK tokens**); it is shown once. A token belongs to one
application environment and can only report. Then set:

```env
MONITORING_API_URL=https://nerdstackgrp.com/api/v1/monitoring
MONITORING_TOKEN=nsk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MONITORING_SERVICE=api
APP_VERSION=2.4.1
```

With those set, `createMonitoring()` needs no arguments:

| Option | Environment variable | Default |
| --- | --- | --- |
| `apiUrl` | `MONITORING_API_URL` | required; the API base URL, used as given |
| `endpoint` | `MONITORING_URL` | older form: a site origin, `/api/v1/monitoring` is appended; ignored when `apiUrl` is set |
| `token` | `MONITORING_TOKEN` | required |
| `service` | `MONITORING_SERVICE` | required; a service slug of the application |
| `version` | `APP_VERSION`, then `npm_package_version` | — |
| `commit` | `APP_COMMIT`, `GIT_COMMIT`, `SOURCE_COMMIT` (Coolify), `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA` | — |
| `environment` | `MONITORING_ENVIRONMENT` | — (the token's environment) |
| `enabled` | `MONITORING_ENABLED=false` turns everything into no-ops | `true` |
| `heartbeatInterval` | — | the server's suggestion, else 30000 ms |
| `requestTimeout` | — | 3000 ms |
| `maxBufferedEvents` | — | 100 |
| `maxRetries` / `retryDelay` | — | 2 / 500 ms |
| `dedupeWindow` | — | 2000 ms |
| `flushInterval` | — | 1000 ms |
| `checks` / `checkTimeout` | — | none / 2000 ms |
| `redactKeys`, `beforeSend` | — | see [Security](#security-and-redaction) |
| `logger`, `debug` | — | `console.warn`, off |
| `fetch` | — | global `fetch` |

Leave `environment` unset: the token already belongs to one environment and
the server uses it. If you set it, it must name that environment, or the
server refuses the report. `NODE_ENV` is deliberately not used, because
staging servers often run with `NODE_ENV=production`.

Configuration is validated once, when you call `createMonitoring`. A missing
or malformed value throws a `MonitoringConfigError` that lists every problem.
The token itself is never repeated in the error. The API URL must be `https`
(plain `http` is allowed only for `localhost`). After construction, the SDK
never throws.

In tests or local development without a token, use
`createMonitoring({ enabled: false })` or set `MONITORING_ENABLED=false`. Every
method then does nothing and needs no configuration.

## Heartbeat

```ts
await monitoring.heartbeat();

await monitoring.heartbeat({
  dependencies: { database: "healthy", redis: "healthy", storage: true },
});
```

A heartbeat sends `service`, `version`, `environment`, `status`, `uptime`,
`timestamp` and any `dependencies`. Dependencies are optional: report the ones
you have. `true`/`false` mean `healthy`/`down`. If any dependency is not
healthy, the status is `degraded`; pass `status` to override it.

To have dependencies checked on every heartbeat, configure `checks`. A check
may return a boolean or a status, and one that throws or exceeds `checkTimeout`
reports `down`:

```ts
const monitoring = createMonitoring({
  service: "ark-api",
  checks: {
    database: async () => (await db.$queryRaw`SELECT 1`, true),
    redis: async () => (await redis.ping()) === "PONG",
  },
});
```

`heartbeat()` resolves to the server's reply, or `null` if it could not be
delivered. It never rejects. Concurrent calls share one request.

### Automatic heartbeat

```ts
monitoring.start();                             // server-suggested interval, else 30s
monitoring.start({ heartbeatInterval: 15_000 });
monitoring.start({ captureUnhandled: true });   // also report fatal errors (below)

await monitoring.stop();                        // e.g. in your SIGTERM handler
```

The first heartbeat is sent immediately. Each one is scheduled only after the
previous one finishes, so heartbeats never overlap. Calling `start()` twice has
no effect.

The SDK's timers never keep a process alive. If the process ends on its own
after `start()`, buffered events are flushed once on `beforeExit`. On a
planned shutdown, call `await monitoring.stop()`, which flushes with a bounded
wait.

## Error reporting

```ts
try {
  await chargeCard(order);
} catch (error) {
  monitoring.captureException(error, { requestId: req.id, metadata: { orderId: order.id } });
  throw error;
}

monitoring.captureError("Payment provider declined", { error, metadata: { provider: "paystack" } });
```

Each report carries the error's name, message and stack (including up to three
`cause` levels), plus service, version, environment, timestamp, request ID and
your metadata. Anything can be passed as `error`, including strings, plain
objects and `undefined`, without crashing the reporter.

Capture methods are synchronous. They queue the event and return `true`, or
`false` if it was filtered, deduplicated or monitoring is disabled. Events are
sent in the background in batches. `CRITICAL` events are sent immediately.

**Duplicates:** the same error object is reported once, even if it is
captured, re-thrown and caught again. Identical events within `dedupeWindow`
(2s by default) are collapsed into one, so an error in a tight loop produces a
single event rather than thousands.

### Levels

```ts
monitoring.captureMessage("Something happened", "info");
monitoring.captureMessage("Something looks wrong", "warning");
monitoring.captureMessage("Operation failed", "error");
monitoring.captureMessage("Production is unavailable", "critical");
```

| Level | API severity | API event type | Effect on the server |
| --- | --- | --- | --- |
| `info` | `INFO` | `custom` | recorded |
| `warning` | `WARNING` | `warning` | recorded |
| `error` | `ERROR` | `error` | recorded; shown in Errors |
| `critical` | `CRITICAL` | `error` | **opens an incident** |

`captureException` and `captureError` default to `error` and accept `level`.
Any API event type (`startup`, `shutdown`, `dependency_failure`,
`performance`, `security`, …) can be sent with
`captureEvent({ type, level, message })`.

## Context

```ts
monitoring.setContext({ region: "eu-west", instance: "api-01", deployment: "production" });
monitoring.setContext({ instance: undefined }); // removes one key
monitoring.clearContext();
```

Context is attached to every later event as `metadata.context`, and it is
redacted like all other metadata.

## Custom events

```ts
monitoring.track("payment.failed", { orderId: "ord_123", provider: "paystack" });
monitoring.track("import.finished", { rows: 1_200 }, { level: "warning" });
```

The name becomes the event message and the properties go to
`metadata.properties`, with sensitive keys redacted.

## Release reporting

```ts
await monitoring.reportRelease({ version: "2.4.1", commit: "a82f91c" });
await monitoring.reportRelease();               // APP_VERSION + detected commit
await monitoring.reportRelease({ service: null }); // application-wide release
```

The call resolves to the stored release, including `previousVersion`, the
version it replaced, or `null`. Call it once at startup after a deploy, or
from CI:

```ts
// scripts/report-release.ts — run as the last deploy step
import { createMonitoring } from "@nerdstackgrp/monitoring";
const release = await createMonitoring().reportRelease();
console.log(release ? `Reported ${release.version}` : "Release not reported");
```

## Framework integration

The core is framework-free. HTTP instrumentation is opt-in and comes in three
shapes. It records method, route, status and duration for each request, and
never records headers, bodies, query strings, cookies or IP addresses.
Recording costs a timestamp and a map update per request.

What gets sent:
- 5xx responses and thrown handler errors, as `error` events. Repeats of the
  same route and status are limited to one per minute.
- Requests slower than `slowRequestMs` (5s by default), as `performance`
  warnings.
- A per-route summary every `summaryInterval` (60s by default).

Routes are low-cardinality. Express's matched template is used when
available; otherwise ids are masked (`/orders/8812` becomes `/orders/:id`).
Pass `route(req)` to map routes yourself. `/health`, `/healthz`, `/ready` and
`/live` are ignored by default (see `ignore`).

**Node `http`, Express, Fastify, Koa:** any `node:http` server.

```ts
const server = app.listen(3000);           // Express
monitoring.instrumentHttp(server);

monitoring.instrumentHttp(fastify.server);  // Fastify
```

**Express/Connect middleware:** this reports the route template, e.g.
`/orders/:orderId`.

```ts
app.use(monitoring.httpMiddleware());
```

**Fetch-style handlers:** Bun.serve, Elysia, Hono and Next.js route handlers.

```ts
Bun.serve({ fetch: monitoring.wrapFetchHandler(app.fetch) });

// Next.js App Router
export const GET = monitoring.wrapFetchHandler(async (request) => Response.json(await load()));
```

Errors thrown by a wrapped handler are reported and then re-thrown unchanged.

**NestJS** runs on Express or Fastify: call
`monitoring.instrumentHttp(app.getHttpServer())` after `app.listen()`.

A dedicated Next.js integration and a browser package are not part of this
release. Use `wrapFetchHandler` on the server side.

## Fatal errors

Reporting fatal errors is opt-in:

```ts
monitoring.captureUnhandled();                       // or start({ captureUnhandled: true })
monitoring.captureUnhandled({ flushTimeout: 2_000 });
```

`uncaughtException` and `unhandledRejection` are reported as `CRITICAL`
events, and the SDK waits up to `flushTimeout` for delivery. **The process
then crashes exactly as it would have without the SDK.** In Node, merely
listening for these events disables the default crash, so the SDK restores it:

- If no other handler exists, it prints the error and exits with code 1.
- Unhandled rejections are re-raised, as Node's default
  `--unhandled-rejections=throw` does. `warn` and `none` modes are respected.
- If your application has its own handler, that handler decides; the SDK only
  reports.

Monitoring never keeps a crashed process running, and an unreachable
API delays the crash by at most `flushTimeout`. The function returns an
uninstaller.

## Security and redaction

- **The token** travels only in the `Authorization` header over HTTPS. It is
  never in a URL, a payload, an error message or a log line. It lives in a
  private field, so `console.log(monitoring)` and `JSON.stringify(monitoring)`
  never show it.
- **Sensitive keys** are replaced with `"[redacted]"` at any depth before
  anything is sent. This covers `password`, `token`, `secret`, `authorization`,
  `cookie`, `api_key`/`x-api-key`, `access_key`, `credential`, `private_key`,
  `session`/`sessionId`, `signature`, `jwt`, `card_number`, `cvv` and `ssn`.
  Ordinary keys such as `author` or `passengers` are left alone.
- **Credential-shaped text** in messages, stack traces and metadata values is
  scrubbed: `Bearer …`/`Basic …` values, `nsk_…` and `ark_…` tokens, JWTs,
  `password=…`-style pairs, and `user:pass@` in URLs.
- **Size limits:** messages are capped at 2,000 characters, error messages at
  4,000 and stacks at 16,000. Metadata is limited to 8 KB (oversized metadata
  is replaced by a marker listing its keys), and every request stays under the
  server's 64 KB limit. Redaction cost is bounded by these limits, not by the
  input size.
- **Request bodies, headers and cookies** are never collected automatically.

Add your own rules:

```ts
createMonitoring({
  redactKeys: ["email", /^customer/i],
  beforeSend: (event) => (event.message.includes("healthcheck") ? null : event),
});
```

`beforeSend` can edit an event or drop it by returning `null`. Redaction still
runs afterwards, so a hook cannot accidentally re-introduce a secret. The same
utilities are exported for your own logging: `redact(value)`,
`redactString(text)` and `redactBounded(text, max)`.

## Failure behaviour

Monitoring is never more important than the application.

| Situation | What the SDK does |
| --- | --- |
| API slow | Each request is abandoned after `requestTimeout` (3s). |
| Network error, timeout, 408, 429, 5xx | Retries up to `maxRetries` (2) with exponential backoff and jitter, honouring `Retry-After`. Heartbeats retry at most once, since the next beat supersedes them. |
| API down | After 3 failed requests the SDK pauses (30s, doubling up to 5 min), making no requests until then. This prevents retry storms from every instance. |
| Events while unreachable | Kept in memory up to `maxBufferedEvents` (100); the oldest are dropped first; delivered after recovery. |
| 400 / 413 / 422 (e.g. unknown service) | Not retried. One warning per distinct cause. |
| 401 (token revoked or wrong) | All reporting stops until restart, with one warning. |
| Anything else | Capture methods return a boolean; async methods resolve `null`. **Nothing throws into your code.** |

`monitoring.stats()` reports `{ queued, dropped, paused, tokenRejected, running }`.

## API

| Member | Description |
| --- | --- |
| `createMonitoring(options?)` | Creates a client (reads env vars). Throws `MonitoringConfigError` on bad config. |
| `heartbeat(options?)` | `Promise<HeartbeatResponse \| null>` |
| `start(options?)` / `stop(options?)` | Automatic heartbeats; `stop` also flushes. |
| `captureException(error, options?)` | `boolean` |
| `captureError(message, options?)` | `boolean` |
| `captureMessage(message, level?, options?)` | `boolean` |
| `track(name, properties?, options?)` | `boolean` |
| `captureEvent({ type, level, message, … })` | `boolean` |
| `setContext(ctx)` / `clearContext()` / `getContext()` | Context on later events |
| `reportRelease(options?)` | `Promise<release \| null>` |
| `fetchConfig()` | The application's identity and registered services |
| `flush(timeoutMs?)` | `Promise<boolean>`: whether the buffer emptied |
| `captureUnhandled(options?)` | Fatal-error reporting; returns an uninstaller |
| `instrumentHttp(server, options?)` | `node:http` servers; returns an uninstaller |
| `httpMiddleware(options?)` | Connect/Express middleware |
| `wrapFetchHandler(handler, options?)` | Fetch-style handlers |
| `stats()` | Delivery state |

Types that mirror the API contract are exported as well: `MonitoringSeverity`,
`MonitoringLevel`, `MonitoringEventType`, `MonitoringStatus`,
`DependencyStatus`, `MonitoringEnvironment`, `HeartbeatPayload`,
`EventPayload`, `ReleasePayload`, `HeartbeatResponse`, `ReleaseResponse` and
`ApplicationConfigResponse`.

### Endpoints used

| Method | Path | Used by |
| --- | --- | --- |
| `POST` | `/api/v1/monitoring/heartbeat` | `heartbeat`, `start` |
| `POST` | `/api/v1/monitoring/events` | every capture method, HTTP instrumentation; batches of up to 25 as `{ "events": [...] }` |
| `POST` | `/api/v1/monitoring/releases` | `reportRelease` |
| `GET` | `/api/v1/monitoring/config` | `fetchConfig` |
