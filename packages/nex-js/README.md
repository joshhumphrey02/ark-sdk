# `@nerdstackgrp/nex-js`

Nex for JavaScript and TypeScript: errors and crashes with everything that
led to them, from your servers and your web frontends; the health of the
databases, caches and brokers behind every service; which services call
which; process vitals; background jobs; and releases.

| Import | Runs in | For |
| --- | --- | --- |
| `@nerdstackgrp/nex-js/server` (also `@nerdstackgrp/nex-js`) | Node 20+, Bun | APIs, workers, Next.js server side |
| `@nerdstackgrp/nex-js/client` | Browsers | Web apps, Next.js client side |
| `@nerdstackgrp/nex-js/react` | Browsers | React error boundary |

```ts
// Server
import * as nex from "@nerdstackgrp/nex-js/server";

nex.init({
  service: "orders-api",
  checks: {
    database: nex.checks.postgres(pool),
    cache: nex.checks.redis(redis),
    queue: nex.checks.rabbitmq(amqpConnection, { queues: ["orders"], maxQueueDepth: 1_000 }),
  },
});
```

```ts
// Browser
import * as nex from "@nerdstackgrp/nex-js/client";

nex.init({ key: process.env.NEXT_PUBLIC_NEX_KEY, release: process.env.NEXT_PUBLIC_APP_VERSION });
```

- Zero runtime dependencies; no framework or driver dependencies.
- ESM, CommonJS and TypeScript declarations.
- If Nex is slow or unreachable, your application does not notice.
- Formerly `@nerdstackgrp/monitoring`: the server API is unchanged
  (`createMonitoring`, `Monitoring`), and the `MONITORING_*` variables still
  work.

## Install

```bash
npm install @nerdstackgrp/nex-js
# or: bun add @nerdstackgrp/nex-js
```

## Configuration (server)

Add the application in Nex, then create an SDK token for the environment
this deployment runs in (**Application → SDK keys**); it is shown once. A
token belongs to one application environment and can only report. Services
are registered the first time they report. Then set:

```env
NEX_API_URL=https://nerdstackgrp.com/api/v1/monitoring
NEX_TOKEN=nsk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NEX_SERVICE=orders-api
APP_VERSION=2.4.1
```

With those set, `nex.init()` (or `createMonitoring()`) needs no arguments:

| Option | Environment variable | Default |
| --- | --- | --- |
| `apiUrl` | `NEX_API_URL` (or `MONITORING_API_URL`) | required; the API base URL, used as given |
| `endpoint` | `MONITORING_URL` | older form: a site origin, `/api/v1/monitoring` is appended; ignored when `apiUrl` is set |
| `token` | `NEX_TOKEN` (or `MONITORING_TOKEN`) | required |
| `service` | `NEX_SERVICE` (or `MONITORING_SERVICE`) | required; this service's slug |
| `version` | `APP_VERSION`, then `npm_package_version` | — |
| `commit` | `APP_COMMIT`, `GIT_COMMIT`, `SOURCE_COMMIT` (Coolify), `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA` | — |
| `environment` | `NEX_ENVIRONMENT` (or `MONITORING_ENVIRONMENT`) | — (the token's environment) |
| `enabled` | `NEX_ENABLED=false` turns everything into no-ops | `true` |
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

`nex.init(options)` creates one client per process and starts it
(heartbeats, crash reports, breadcrumbs, service map and runtime vitals; see
`start()` below). It also accepts `start()`'s options, and `autoStart: false`.
The module functions (`nex.captureException`, `nex.setUser`, `nex.job`, …)
use that client, and do nothing before `init()`. If you prefer an explicit
client, `createMonitoring(options)` returns one and `monitoring.start()`
starts it; everything below works on either.

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
`createMonitoring({ enabled: false })` or set `NEX_ENABLED=false`. Every
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

To have dependencies checked on every heartbeat, configure `checks`. See
[Dependencies](#dependencies).

`heartbeat()` resolves to the server's reply, or `null` if it could not be
delivered. It never rejects. Concurrent calls share one request.

### Automatic heartbeat

```ts
monitoring.start();                             // heartbeats, crash reports, breadcrumbs, service map, vitals
monitoring.start({ heartbeatInterval: 15_000 });
monitoring.start({ captureUnhandled: false, breadcrumbs: false, serviceMap: false, runtimeMetrics: false }); // heartbeats only

await monitoring.stop();                        // e.g. in your SIGTERM handler
```

The first heartbeat is sent immediately. Each one is scheduled only after the
previous one finishes, so heartbeats never overlap. Calling `start()` twice has
no effect.

The SDK's timers never keep a process alive. If the process ends on its own
after `start()`, buffered events are flushed once on `beforeExit`. On a
planned shutdown, call `await monitoring.stop()`, which flushes with a bounded
wait.

## Dependencies

Every heartbeat can carry the health of what the service depends on. Nex
lists each dependency with its status, latency and numbers over time, alerts
when one goes down, and draws it on the service map.

```ts
import { checks } from "@nerdstackgrp/nex-js/server";

nex.init({
  checks: {
    database: checks.postgres(pool),                 // pg Pool/Client, postgres.js or Prisma
    cache: checks.redis(redis),                      // ioredis or node-redis
    queue: checks.rabbitmq(connection, { queues: ["orders", "emails"], maxQueueDepth: 1_000 }),
    search: checks.http("http://search:9200/_cluster/health"),
    mail: checks.tcp("smtp.internal", 587),
    ledger: checks.custom("mysql", async () => (await ledger.query("SELECT 1"), true), { target: "ledger:3306" }),
  },
});
```

| Check | Probe | Reports |
| --- | --- | --- |
| `checks.postgres(client)` | `SELECT 1` | `pg` pool size, idle and waiting connections; waiting ⇒ degraded |
| `checks.mysql(client)` | `SELECT 1` | — |
| `checks.redis(client)` | `PING`, `INFO` | memory (MB and % of maxmemory), clients, ops/s, hit rate; ≥ 90% memory ⇒ degraded |
| `checks.mongodb(client)` | `{ ping: 1 }` | — |
| `checks.rabbitmq(connection \| managementUrl, { queues })` | queue declare-check, or the management API | messages waiting and consumers per queue; over `maxQueueDepth` or no consumers ⇒ degraded |
| `checks.http(url)` | `GET` | 2xx/3xx healthy, else down |
| `checks.tcp(host, port)` | connect | — |
| `checks.custom(kind, fn, { target })` | yours | whatever `fn` returns |

Each check reports its kind, its target (host and port; credentials are
removed), how long it took, and any error. A check that throws or takes
longer than `checkTimeout` reports `down`. A plain function still works:
return `true`/`false`, a status, or `{ status, metrics, error }`. The
`rabbitmq` check opens a short-lived channel of its own, so a missing queue
can't close yours. Clients are typed structurally: the SDK imports no driver.

A dependency that isn't healthy makes the service `degraded` (it is still
answering), so Nex can tell "the API is down" from "the API is up but its
database isn't".

## Service map

`start()` counts the service's outgoing HTTP calls per target (count,
failures, p50/p95/max latency) and sends them with each heartbeat; no paths
or query strings, just `https://api.paystack.co` or `payments:8080`. Nex
joins these with the other services' reports to draw which service calls
which, and with the dependencies to show what each one stands on. Calls
come from Node's diagnostics channels (`fetch` and `node:http`); on Bun,
from `fetch`. Turn it off with `start({ serviceMap: false })`.

## Traces

Every instrumented request (`httpMiddleware`, `instrumentHttp`,
`wrapFetchHandler`) is a span; every outgoing `fetch`/`node:http` call made
while handling it is a child span and carries a W3C `traceparent` header,
so the next service (on nex-js, nex-py or OpenTelemetry) continues the
same trace. Jobs are spans too. In Nex, a trace shows as a waterfall across
services, with the errors raised in it; every error links to its trace.

```ts
const rows = await nex.trace("SELECT orders", () => db.query(sql), { kind: "client", attributes: { "db.system": "postgresql" } });

const span = monitoring.startSpan("render invoice");
span.setAttribute("invoice.pages", 12);
span.end();

await fetch(url, { headers: monitoring.traceHeaders() }); // propagate by hand (e.g. into a queue message)
```

`tracesSampleRate` (default `0.1`, env `NEX_TRACES_SAMPLE_RATE`) is the
share of new traces kept. A trace started elsewhere keeps its sampling
decision, so a trace is recorded whole or not at all. Unsampled requests
still send `traceparent` (flagged unsampled) and their errors still carry
the trace id. Spans go in batches to `/spans`, at most every 5 seconds.

## Metrics

Each heartbeat carries a summary of the requests handled since the last
one (count, errors, p50, p95, max), the service's vitals, and your own
metrics:

```ts
nex.increment("orders.placed");          // a counter: summed per heartbeat
nex.gauge("queue.depth", depth, "jobs"); // a gauge: the last value
nex.metric("cart.value", total, { type: "gauge", unit: "NGN" });
```

Nex graphs them per service (request rate, error rate, latency, calls,
memory, CPU, event loop, jobs, your metrics), and alert rules can watch any
of them: "p95 above 800 ms for 5 minutes", "queue.depth above 1,000".

## Runtime vitals and jobs

Heartbeats also carry the process's memory (RSS and heap), CPU and
event-loop delay since the previous one (`start({ runtimeMetrics: false })`
to turn off).

Wrap each unit of background work (a queue message, a cron run) in `job()`:

```ts
channel.consume("orders", (msg) => nex.job("process-order", () => handle(msg)));
cron.schedule("0 * * * *", () => nex.job("sync-invoices", syncInvoices));
```

The run gets its own scope (its errors carry the job's name, `handled:
false`), and every run is counted and timed. Nex shows each job's runs,
failures and p95 duration per service. The error is re-thrown, unless you
pass `{ rethrow: false }`.

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

Each report carries the error chain (the error and up to four `cause`s), each
with its stack as frames marked as your code or library/runtime code, plus
service, version, environment, timestamp, request ID and your metadata. Nex
groups errors into issues by the error type and where your code threw it, so
"Order 81 not found" and "Order 92 not found" from the same place are one
issue. Pass `fingerprint: ["checkout", "declined"]` to group differently.
Anything can be passed as `error`, including strings, plain objects and
`undefined`, without crashing the reporter.

With every error the SDK also sends what it knows (see
[What an error carries](#what-an-error-carries)): the user, tags, the
request being handled, the breadcrumbs that led up to it, the runtime, and
the OpenTelemetry trace.

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

## What an error carries

```ts
monitoring.setUser({ id: user.id, email: user.email }); // Nex counts users per issue
monitoring.setTag("tenant", tenant.slug);
monitoring.addBreadcrumb({ category: "payment", message: "Charging card", data: { provider: "paystack" } });
```

- **User and tags**: `setUser`, `setTag`/`setTags`, or `tags` on one capture.
  Inside an instrumented request they apply to that request only.
- **Request**: method, path (never the query string), route and user agent,
  for requests through `httpMiddleware`, `instrumentHttp` or
  `wrapFetchHandler`. The event is named after the route
  (`POST /orders/:id`); name other work with `setTransaction("sync-invoices")`.
- **Breadcrumbs**: the last 100 things that happened, sent with the next
  error. `start()` records console output and outgoing `fetch`/`node:http`
  calls (method, URL without query, status, duration) automatically; add your
  own with `addBreadcrumb`. Turn the automatic ones off with
  `start({ breadcrumbs: false })` or `{ breadcrumbs: { console: false } }`.
- **Runtime**: Node or Bun version and OS.
- **Trace**: when the application uses OpenTelemetry, the active trace and
  span ids, so an error links to its request across services. No dependency
  on OpenTelemetry is added.

Each instrumented request gets its own copy of the user, tags and
breadcrumbs, so one request's context never reaches another's error. For
work outside requests (queue jobs, cron), give each run its own:

```ts
worker.on("job", (job) =>
  monitoring.withScope(async (scope) => {
    scope.setTag("job", job.name);
    await process(job);
  }),
);
```

Everything goes through the same redaction as metadata.

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
import { createMonitoring } from "@nerdstackgrp/nex-js/server";
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

Errors thrown by a wrapped handler are reported once, as the exception
itself with its request, and then re-thrown unchanged.

**Express error handler:** reports errors your routes pass to `next(err)` or
throw, with their request, then hands them on. 4xx errors (`err.status < 500`)
are not reported.

```ts
app.use(monitoring.httpMiddleware());
// … your routes …
app.use(monitoring.errorHandler());
```

**NestJS** runs on Express or Fastify: call
`monitoring.instrumentHttp(app.getHttpServer())` after `app.listen()`.

## Next.js

Server side, in `instrumentation.ts` at the project root:

```ts
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const nex = await import("@nerdstackgrp/nex-js/server");
    nex.init({ service: "web" });
  }
}

export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const nex = await import("@nerdstackgrp/nex-js/server");
  nex.captureRequestError(...args);
};
```

That reports errors from server components, route handlers, server actions
and middleware, with the route template (`/orders/[id]`) and the kind of
render. Client side, in `instrumentation-client.ts`:

```ts
import * as nex from "@nerdstackgrp/nex-js/client";

nex.init({ key: process.env.NEXT_PUBLIC_NEX_KEY!, release: process.env.NEXT_PUBLIC_APP_VERSION });
```

and in `app/global-error.tsx` (and any `error.tsx`):

```tsx
"use client";
import { useEffect } from "react";
import { captureException } from "@nerdstackgrp/nex-js/client";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    captureException(error, { mechanism: "nextjs.globalError", handled: false, tags: error.digest ? { digest: error.digest } : undefined });
  }, [error]);
  return <html><body><h2>Something went wrong.</h2></body></html>;
}
```

## Browser

`@nerdstackgrp/nex-js/client` reports from web apps:

- **Crashes**: uncaught errors and unhandled promise rejections.
- **Context**: the page (without its query string), browser, OS, device,
  screen and viewport, language and time zone, the release, the user and
  your tags.
- **Breadcrumbs**: the last 50 navigations, clicks (element, never what was
  typed), `fetch`/XHR calls (method, URL without query, status, duration)
  and console output.
- **Frames**: your scripts are marked as your code; extensions, framework
  chunks and third-party scripts are not. Errors entirely from browser
  extensions are dropped. Add a CDN that serves your bundles with
  `appOrigins`.

It authenticates with a **browser key** (`nex_pub_…`, **Application → SDK
keys → Browser keys**). It is public by design, like a Sentry DSN: it can
only send errors, only for the frontend service it was created for, only
from the origins you allow, and it can read nothing. Secret tokens
(`nsk_…`) are refused in the browser so one can't be shipped by mistake.

```ts
nex.init({
  key: "nex_pub_…",
  release: "web@2.4.1",
  sampleRate: 1,                          // share of errors sent
  ignoreErrors: [/^AbortError/],          // on top of "Script error." and ResizeObserver noise
  denyUrls: [/googletagmanager\.com/],
  beforeSend: (event) => event,           // edit or drop (null)
  integrations: { clicks: false },        // turn any integration off
});
nex.setUser({ id: user.id });
nex.captureException(error, { tags: { section: "checkout" } });
```

**Tracing from the page:** requests to the page's own origin (and to
`tracePropagationTargets`) carry `traceparent` and are recorded as spans
(`tracesSampleRate`, default 0.1), so a trace starts at the click and runs
through your services. Third-party requests are never touched. Other
origins in `tracePropagationTargets` must allow the header
(`Access-Control-Allow-Headers: traceparent`).

Delivery is batched, sent as a simple CORS request (no preflight), and
handed to `sendBeacon` when the tab is hidden or closed, so errors just
before navigating away still arrive. Repeats within 2s are sent once, each
page load sends at most 100 events (`maxEventsPerPage`), outages back off,
and a refused key stops reporting for that page.

## React

```tsx
import { ErrorBoundary } from "@nerdstackgrp/nex-js/react";

<ErrorBoundary fallback={({ reset }) => <button onClick={reset}>Try again</button>} tags={{ section: "cart" }}>
  <Cart />
</ErrorBoundary>
```

Render errors are reported with the component stack. With React 19, report
every error at the root instead:

```ts
import { reactErrorHandler } from "@nerdstackgrp/nex-js/react";

createRoot(container, { onUncaughtError: reactErrorHandler(), onCaughtError: reactErrorHandler() });
```

`react` is an optional peer dependency, needed only for this entry.

## Fatal errors

`start()` reports crashes by default. Turn it off with
`start({ captureUnhandled: false })`, or install it on its own:

```ts
monitoring.captureUnhandled();
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
