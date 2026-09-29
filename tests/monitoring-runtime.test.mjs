import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import http from "node:http";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { normalizeRoute } from "../packages/monitoring/dist/index.js";
import { TOKEN, fakeApi, json, makeClient, sleep, startServer } from "./monitoringHelpers.mjs";

/**
 * Runtime integrations: fatal-error reporting and HTTP instrumentation.
 *
 * Fatal errors run in real child processes, because the property that
 * matters is observable only there: the error is reported AND the process
 * still dies exactly as it would have without the SDK. Monitoring must never
 * be the reason a crashed application keeps running.
 */

const DIST = pathToFileURL(new URL("../packages/monitoring/dist/index.js", import.meta.url).pathname).href;

function runChild(script, { execArgv = [], env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...execArgv, "--input-type=module", "-e", script], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const killer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    child.on("exit", (code, signal) => {
      clearTimeout(killer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function acceptingServer() {
  return startServer((req, res) => {
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, accepted: 1, events: [] }));
  });
}

const setup = (url, extra = "") => `
  import { createMonitoring } from ${JSON.stringify(DIST)};
  const monitoring = createMonitoring({ endpoint: ${JSON.stringify(url)}, token: ${JSON.stringify(TOKEN)}, service: "ark-api", logger: null ${extra} });
`;

const eventsFrom = (server) =>
  server.requests
    .filter((r) => r.url === "/api/v1/monitoring/events")
    .flatMap((r) => (Array.isArray(r.body.events) ? r.body.events : [r.body]));

test("an uncaught exception is reported, then the process still crashes with code 1", async () => {
  const server = await acceptingServer();
  try {
    const result = await runChild(`${setup(server.url)}
      monitoring.captureUnhandled();
      setTimeout(() => { throw new Error("boom in production"); }, 10);
    `);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /boom in production/);
    const events = eventsFrom(server);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "exception");
    assert.equal(events[0].severity, "CRITICAL");
    assert.equal(events[0].metadata.origin, "uncaughtException");
  } finally {
    await server.close();
  }
});

test("an unhandled rejection is reported once and crashes like Node's default", async () => {
  const server = await acceptingServer();
  try {
    const result = await runChild(`${setup(server.url)}
      monitoring.captureUnhandled();
      Promise.reject(new Error("rejected promise"));
    `);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /rejected promise/);
    const events = eventsFrom(server);
    assert.equal(events.length, 1, "re-raising must not report it a second time");
    assert.equal(events[0].metadata.origin, "unhandledRejection");
  } finally {
    await server.close();
  }
});

test("the crash is not held up by an unreachable monitoring server", async () => {
  const started = Date.now();
  const result = await runChild(`${setup("http://127.0.0.1:9", ", maxRetries: 0")}
    monitoring.captureUnhandled({ flushTimeout: 300 });
    setTimeout(() => { throw new Error("fatal while offline"); }, 10);
  `);
  assert.equal(result.code, 1);
  assert.ok(Date.now() - started < 5_000);
});

test("an application's own uncaughtException handler stays in charge", async () => {
  const server = await acceptingServer();
  try {
    const result = await runChild(`${setup(server.url)}
      monitoring.captureUnhandled();
      process.on("uncaughtException", () => { console.log("app handled it"); });
      setTimeout(() => { throw new Error("handled by app"); }, 10);
      setTimeout(async () => { await monitoring.flush(); console.log("still alive"); process.exit(0); }, 300);
    `);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /app handled it/);
    assert.match(result.stdout, /still alive/);
    assert.equal(eventsFrom(server).length, 1);
  } finally {
    await server.close();
  }
});

test("--unhandled-rejections=warn is respected", async () => {
  const server = await acceptingServer();
  try {
    const result = await runChild(
      `${setup(server.url)}
      monitoring.captureUnhandled();
      Promise.reject(new Error("tolerated"));
      setTimeout(async () => { await monitoring.flush(); console.log("kept running"); }, 200);
    `,
      { execArgv: ["--unhandled-rejections=warn"] },
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /kept running/);
    assert.equal(eventsFrom(server).length, 1);
  } finally {
    await server.close();
  }
});

test("uninstalling restores Node's default crash with no report", async () => {
  const server = await acceptingServer();
  try {
    const result = await runChild(`${setup(server.url)}
      const uninstall = monitoring.captureUnhandled();
      uninstall();
      setTimeout(() => { throw new Error("after uninstall"); }, 10);
    `);
    assert.equal(result.code, 1);
    assert.equal(eventsFrom(server).length, 0);
  } finally {
    await server.close();
  }
});

test("a running client never keeps the process alive", async () => {
  const server = await acceptingServer();
  try {
    const started = Date.now();
    const result = await runChild(`${setup(server.url)}
      monitoring.start({ heartbeatInterval: 60000, captureUnhandled: true });
      monitoring.captureMessage("queued", "info");
      console.log("main done");
    `);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /main done/);
    assert.ok(Date.now() - started < 5_000, "timers are unref'd");
  } finally {
    await server.close();
  }
});

test("events still queued when a started process ends naturally are delivered", async () => {
  const server = await acceptingServer();
  try {
    const result = await runChild(`${setup(server.url, ", flushInterval: 60000")}
      monitoring.start({ heartbeatInterval: 60000 });
      monitoring.captureMessage("last words", "warning");
    `);
    assert.equal(result.code, 0);
    assert.ok(eventsFrom(server).some((e) => e.message === "last words"));
  } finally {
    await server.close();
  }
});

test("an awaited call settles even when the server is unreachable and retries are pending", async () => {
  // Regression: retry waits used unref'd timers, so a script awaiting a
  // report against a dead server exited mid-await (unsettled top-level await).
  const result = await runChild(`${setup("http://127.0.0.1:9", ", retryDelay: 50, maxRetries: 2")}
    const release = await monitoring.reportRelease({ version: "1.0.0" });
    const config = await monitoring.fetchConfig();
    console.log("settled", release, config);
  `);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /settled null null/);
});

// --- HTTP instrumentation ----------------------------------------------------------------

test("routes are normalised and never carry query strings", () => {
  assert.equal(normalizeRoute("/orders/8812?token=secret"), "/orders/:id");
  assert.equal(normalizeRoute("/users/0b7e4f3a-9c1d-4e2b-8f6a-1d2c3b4a5e6f/files"), "/users/:id/files");
  assert.equal(normalizeRoute("/blobs/5f3e2a1b9c8d7e6f"), "/blobs/:id");
  assert.equal(normalizeRoute("/invites/clx7a8b9c0000d1e2f3g4h5i6#frag"), "/invites/:id");
  assert.equal(normalizeRoute("https://api.example.com/v1/health"), "/v1/health");
  assert.equal(normalizeRoute(""), "/");
});

test("instrumentHttp times a node:http server: errors, slow requests and a summary", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  const server = http.createServer((req, res) => {
    if (req.url.startsWith("/fail")) {
      res.statusCode = 503;
      return res.end("down");
    }
    if (req.url.startsWith("/slow")) return setTimeout(() => res.end("late"), 80);
    res.end("ok");
  });
  const uninstall = monitoring.instrumentHttp(server, { slowRequestMs: 50, summaryInterval: 0 });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ["/orders/1?token=abc123secret", "/orders/2", "/fail", "/fail", "/slow", "/health"]) {
      await fetch(`${base}${path}`).then((r) => r.text());
    }
    await monitoring.stop();
    const events = api.events();
    const errors = events.filter((e) => e.type === "error");
    assert.equal(errors.length, 1, "repeated 503s on one route are one event");
    assert.equal(errors[0].metadata.route, "/fail");
    assert.equal(errors[0].metadata.status, 503);
    const slow = events.find((e) => e.type === "performance" && e.severity === "WARNING");
    assert.equal(slow.metadata.route, "/slow");
    const summary = events.find((e) => e.type === "performance" && e.severity === "INFO");
    const orders = summary.metadata.routes.find((r) => r.route === "/orders/:id");
    assert.equal(orders.count, 2);
    assert.equal(summary.metadata.requests, 5, "/health is ignored by default");
    const sent = JSON.stringify(api.calls.map((c) => c.body));
    assert.ok(!sent.includes("abc123secret"), "query strings are never recorded");
  } finally {
    uninstall();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Express-style middleware uses the matched route template", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  const middleware = monitoring.httpMiddleware({ summaryInterval: 0 });

  const req = { method: "get", url: "/api/orders/77", originalUrl: "/api/orders/77?x=1", baseUrl: "/api" };
  const res = Object.assign(new EventEmitter(), { statusCode: 500 });
  let nextCalled = false;
  middleware(req, res, () => (nextCalled = true));
  assert.equal(nextCalled, true);
  req.route = { path: "/orders/:orderId" }; // set by Express during routing
  res.emit("finish");
  res.emit("close");

  await monitoring.flush();
  const [event] = api.events();
  assert.equal(event.metadata.route, "/api/orders/:orderId");
  assert.equal(event.metadata.method, "GET");
  await monitoring.stop();
});

test("a client that disconnects is recorded as 499, not a server error", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  const middleware = monitoring.httpMiddleware({ summaryInterval: 0 });
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });
  middleware({ method: "GET", url: "/stream" }, res, () => {});
  res.emit("close");
  await monitoring.stop();
  const summary = api.events().find((e) => e.type === "performance");
  assert.equal(summary.metadata.errors, 0);
});

test("wrapFetchHandler times fetch-style handlers and re-throws handler errors", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  const handler = monitoring.wrapFetchHandler(
    async (request) => {
      const { pathname } = new URL(request.url);
      if (pathname === "/crash") throw new Error("handler exploded");
      if (pathname === "/slow") await sleep(60);
      return new Response("ok", { status: pathname === "/missing" ? 404 : 200 });
    },
    { slowRequestMs: 50, summaryInterval: 0 },
  );

  assert.equal((await handler(new Request("https://app.test/items/12"))).status, 200);
  assert.equal((await handler(new Request("https://app.test/missing"))).status, 404);
  await handler(new Request("https://app.test/slow"));
  await assert.rejects(handler(new Request("https://app.test/crash", { method: "POST" })), /handler exploded/);
  await monitoring.stop();

  const events = api.events();
  const crash = events.find((e) => e.type === "error");
  assert.equal(crash.metadata.route, "/crash");
  assert.equal(crash.metadata.method, "POST");
  assert.equal(crash.error.message, "handler exploded");
  assert.ok(events.some((e) => e.type === "performance" && e.metadata.route === "/slow"));
  const summary = events.find((e) => e.type === "performance" && e.severity === "INFO");
  assert.equal(summary.metadata.requests, 4);
  assert.equal(summary.metadata.errors, 1, "a 404 is not a server error");
});

test("instrumentation is inert when monitoring is disabled", async () => {
  const { createMonitoring } = await import(DIST);
  const monitoring = createMonitoring({ enabled: false });
  const handler = monitoring.wrapFetchHandler(async () => new Response("ok"));
  assert.equal((await handler(new Request("https://app.test/"))).status, 200);
  const server = http.createServer();
  const uninstall = monitoring.instrumentHttp(server);
  assert.equal(server.listenerCount("request"), 0);
  uninstall();
});

test("an instrumented server keeps serving when monitoring is down", async () => {
  const monitoring = makeClient(fakeApi(() => json(500, { detail: "down" })), { maxRetries: 0 });
  const handler = monitoring.wrapFetchHandler(async () => new Response("still serving"));
  for (let i = 0; i < 5; i++) assert.equal(await (await handler(new Request("https://app.test/"))).text(), "still serving");
  await monitoring.stop();
});
