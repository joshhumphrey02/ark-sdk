import assert from "node:assert/strict";
import diagnostics from "node:diagnostics_channel";
import { EventEmitter } from "node:events";
import test from "node:test";

import { parseStack } from "../packages/nex-js/dist/index.js";
import { fakeApi, makeClient, sleep } from "./monitoringHelpers.mjs";

/**
 * What an error carries besides its message: the stack as frames and the
 * cause chain, who was affected, the request, tags, breadcrumbs, the runtime
 * and the trace, so Nex can group it and show what led to it.
 */

function fakeReq(method, url, headers = {}) {
  return { method, url, headers };
}

function fakeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  return res;
}

test("exceptions carry frames, their causes and how they were caught", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  const root = new Error("connection refused");
  monitoring.captureException(new Error("failed to save order", { cause: root }), { fingerprint: ["orders", "save"] });
  await monitoring.flush();

  const [event] = api.events();
  assert.equal(event.exception.length, 2);
  assert.deepEqual(event.exception[0].mechanism, { type: "manual", handled: true });
  assert.equal(event.exception[0].value, "failed to save order");
  assert.equal(event.exception[1].value, "connection refused");
  const frame = event.exception[0].stacktrace.frames[0];
  assert.match(frame.filename, /monitoring-context\.test\.mjs$/);
  assert.equal(frame.inApp, true);
  assert.equal(event.handled, true);
  assert.deepEqual(event.fingerprint, ["orders", "save"]);
  assert.equal(event.sdk.name, "nex-js");
  assert.ok(["node", "bun"].includes(event.contexts.runtime.name));
  assert.equal(event.release, "2.4.1", "the version is the event's release");
  // Older servers still get the flat error.
  assert.equal(event.error.message, "failed to save order");
});

test("stack frames know library and runtime code from the application's", () => {
  const frames = parseStack(`Error: x
    at handler (/srv/app/src/routes.ts:10:5)
    at Layer.handle (/srv/app/node_modules/express/lib/router/layer.js:95:5)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at file:///srv/app/dist/main.js:3:1`);
  assert.deepEqual(
    frames.map((f) => [f.function ?? null, f.inApp]),
    [["handler", true], ["Layer.handle", false], ["process.processTicksAndRejections", false], [null, true]],
  );
  assert.equal(frames[3].filename, "/srv/app/dist/main.js");
});

test("user, tags and breadcrumbs go with the next events; secrets don't", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  monitoring.setUser({ id: 81, email: "ada@example.com" });
  monitoring.setTags({ region: "eu", apiKey: "sk_live_123" });
  for (let i = 0; i < 120; i++) monitoring.addBreadcrumb({ category: "step", message: `step ${i}` });
  monitoring.addBreadcrumb({ category: "auth", message: "login with Bearer abcdefghijklmnop", data: { password: "hunter2" } });
  monitoring.captureMessage("checkout failed", "error", { tags: { attempt: 2 } });
  await monitoring.flush();

  const [event] = api.events();
  assert.deepEqual(event.user, { id: "81", email: "ada@example.com" });
  assert.equal(event.tags.region, "eu");
  assert.equal(event.tags.attempt, "2");
  assert.equal(event.tags.apiKey, "[redacted]");
  assert.equal(event.breadcrumbs.length, 100, "the last 100 are kept");
  const last = event.breadcrumbs.at(-1);
  assert.doesNotMatch(last.message, /abcdefghijklmnop/);
  assert.equal(last.data.password, "[redacted]");
  assert.ok(last.timestamp);
});

test("each request has its own scope: one request's user never reaches another's error", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  const middleware = monitoring.httpMiddleware({ summaryInterval: 0 });

  const handle = (url, user, fail) =>
    new Promise((resolve) => {
      middleware(fakeReq("POST", url, { "user-agent": "test-agent" }), fakeRes(), async () => {
        monitoring.setUser({ id: user });
        monitoring.addBreadcrumb({ message: `start ${user}` });
        await sleep(5);
        if (fail) monitoring.captureException(new Error(`boom for ${user}`));
        resolve();
      });
    });

  await Promise.all([handle("/orders/12?token=secret", "alice", true), handle("/orders/13", "bob", false)]);
  monitoring.captureMessage("after the requests", "error");
  await monitoring.flush();

  const [boom, after] = api.events();
  assert.equal(boom.user.id, "alice");
  assert.deepEqual(boom.breadcrumbs.map((b) => b.message), ["start alice"]);
  assert.deepEqual(boom.request, { method: "POST", url: "/orders/12", route: "/orders/:id", userAgent: "test-agent" });
  assert.equal(boom.transaction, "POST /orders/:id");
  assert.equal(after.user, undefined, "request scopes don't leak out");
  assert.equal(after.request, undefined);
});

test("withScope gives a job its own user and tags", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  await monitoring.withScope(async (scope) => {
    scope.setUser({ id: "job-owner" });
    scope.setTag("job", "sync-invoices");
    await sleep(1);
    monitoring.captureMessage("job failed", "error");
  });
  monitoring.captureMessage("outside", "error");
  await monitoring.flush();
  const [inside, outside] = api.events();
  assert.equal(inside.user.id, "job-owner");
  assert.equal(inside.tags.job, "sync-invoices");
  assert.equal(outside.user, undefined);
  assert.equal(outside.tags, undefined);
});

test("the Express error handler reports server errors with their request and passes them on", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  const handler = monitoring.errorHandler();
  const passed = [];
  const crash = new Error("db timeout");
  const notFound = Object.assign(new Error("no such order"), { status: 404 });
  handler(crash, fakeReq("GET", "/orders/9"), fakeRes(), (err) => passed.push(err));
  handler(notFound, fakeReq("GET", "/orders/10"), fakeRes(), (err) => passed.push(err));
  await monitoring.flush();

  assert.deepEqual(passed, [crash, notFound]);
  const events = api.events();
  assert.equal(events.length, 1, "4xx errors are not reported");
  assert.equal(events[0].exception[0].mechanism.type, "middleware");
  assert.equal(events[0].handled, false);
  assert.equal(events[0].request.route, "/orders/:id");
});

test("start() reports crashes and records console and HTTP breadcrumbs by default; stop() undoes it", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  const listenersBefore = process.listenerCount("uncaughtException");
  const originalLog = console.log;
  monitoring.start({ heartbeatInterval: 60_000 });
  try {
    assert.equal(process.listenerCount("uncaughtException"), listenersBefore + 1);
    assert.notEqual(console.log, originalLog);

    const silenced = console.info;
    console.info = () => {};
    try {
      console.warn("[nex] own log line");
    } catch {
      // ignore
    }
    console.info = silenced;

    // An outgoing request, as Node's diagnostics channels report it.
    const request = { method: "get", origin: "https://payments.example", path: "/charge?card=4242" };
    diagnostics.channel("undici:request:create").publish({ request });
    diagnostics.channel("undici:request:headers").publish({ request, response: { statusCode: 502 } });

    monitoring.captureMessage("charge failed", "error");
    await monitoring.flush();
  } finally {
    await monitoring.stop();
  }
  assert.equal(process.listenerCount("uncaughtException"), listenersBefore);
  assert.equal(console.log, originalLog);

  const event = api.events().find((e) => e.message === "charge failed");
  const http = event.breadcrumbs.find((b) => b.category === "http");
  assert.equal(http.message, "GET https://payments.example/charge → 502");
  assert.equal(http.level, "error");
  assert.ok(!event.breadcrumbs.some((b) => /\[nex\]/.test(b.message ?? "")), "the SDK's own logs are not breadcrumbs");
});

test("events carry the OpenTelemetry trace when the application uses OpenTelemetry", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  const key = Symbol.for("opentelemetry.js.api.1");
  const span = { spanContext: () => ({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" }) };
  globalThis[key] = { context: { active: () => ({ getValue: (k) => (k === Symbol.for("OpenTelemetry Context Key SPAN") ? span : undefined) }) } };
  try {
    monitoring.captureMessage("traced", "error");
    await monitoring.flush();
  } finally {
    delete globalThis[key];
  }
  const [event] = api.events();
  assert.equal(event.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
  assert.equal(event.spanId, "00f067aa0ba902b7");
});

test("a node:http server's requests get their own scope too", async () => {
  const { default: http } = await import("node:http");
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  const server = http.createServer((req, res) => {
    monitoring.setUser({ id: req.url === "/a" ? "alice" : "bob" });
    setTimeout(() => {
      if (req.url === "/a") monitoring.captureException(new Error("failed for a"));
      res.end("ok");
    }, 5);
  });
  monitoring.instrumentHttp(server, { summaryInterval: 0 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await Promise.all([fetch(`${base}/a`), fetch(`${base}/b`)]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await monitoring.flush();
  const [event] = api.events().filter((e) => e.type === "exception");
  assert.equal(event.user.id, "alice");
  assert.equal(event.request.url, "/a");
  assert.equal(event.request.method, "GET");
});
