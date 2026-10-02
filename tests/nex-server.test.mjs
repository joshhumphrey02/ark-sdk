// nex-js/server: dependency checks, service-map calls, runtime vitals, jobs,
// the Next.js hook and the module-level API.

import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";

import { checks, init, getClient, captureException, parseStack, _resetForTesting } from "../packages/nex-js/dist/server.js";
import { fakeApi, json, makeClient, TOKEN } from "./monitoringHelpers.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("checks.postgres runs SELECT 1 and reports the pool; waiting clients mean degraded", async () => {
  const queries = [];
  const pool = { query: async (q) => queries.push(q), totalCount: 10, idleCount: 0, waitingCount: 3, options: { host: "db.internal", port: 5432 } };
  const check = checks.postgres(pool);
  assert.equal(check.kind, "postgres");
  assert.equal(check.target, "db.internal:5432");
  const result = await check.check();
  assert.deepEqual(queries, ["SELECT 1"]);
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.metrics, { poolTotal: 10, poolIdle: 0, poolWaiting: 3 });
});

test("checks never send credentials in targets", () => {
  const pool = { query: async () => {}, options: { connectionString: "postgres://admin:hunter2@db.internal:5432/app" } };
  assert.equal(checks.postgres(pool).target, "db.internal:5432");
  assert.equal(checks.http("https://user:pw@api.paystack.co/health?key=abc").target, "https://api.paystack.co");
  assert.equal(checks.redis({ ping: async () => "PONG", options: { url: "redis://:secret@cache:6379/0" } }).target, "cache:6379");
});

test("checks.redis pings and reads memory, clients and hit rate from INFO", async () => {
  const info = ["# Memory", "used_memory:943718400", "maxmemory:1048576000", "# Clients", "connected_clients:12", "# Stats", "instantaneous_ops_per_sec:340", "keyspace_hits:90", "keyspace_misses:10"].join("\r\n");
  const result = await checks.redis({ ping: async () => "PONG", info: async () => info, options: { host: "cache", port: 6379 } }).check();
  assert.equal(result.status, "degraded", "90% of maxmemory is degraded");
  assert.equal(result.metrics.usedMemoryMb, 900);
  assert.equal(result.metrics.memoryPercent, 90);
  assert.equal(result.metrics.clients, 12);
  assert.equal(result.metrics.opsPerSec, 340);
  assert.equal(result.metrics.hitRatePercent, 90);
});

test("checks.rabbitmq reports depth and consumers, on its own channel", async () => {
  let closed = false;
  const connection = {
    createChannel: async () => ({
      on: () => {},
      checkQueue: async (name) => (name === "orders" ? { messageCount: 5000, consumerCount: 2 } : { messageCount: 3, consumerCount: 0 }),
      close: async () => {
        closed = true;
      },
    }),
  };
  const result = await checks.rabbitmq(connection, { queues: ["orders", "emails"], maxQueueDepth: 1000 }).check();
  assert.ok(closed, "the check's channel is closed");
  assert.equal(result.status, "degraded");
  assert.equal(result.metrics.messages, 5003);
  assert.equal(result.metrics["orders.messages"], 5000);
  assert.equal(result.metrics["emails.consumers"], 0);
  assert.match(result.error, /orders has 5000 messages waiting/);
  assert.match(result.error, /emails has no consumers/);
});

test("checks.rabbitmq can read the management API, with credentials in the header only", async () => {
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url: String(url), auth: init.headers.authorization });
    return json(200, { messages_ready: 4, consumers: 1 });
  };
  const check = checks.rabbitmq("http://guest:guest@rabbit:15672", { queues: ["orders"], fetch });
  assert.equal(check.target, "rabbit:15672");
  const result = await check.check();
  assert.equal(result.status, "healthy");
  assert.equal(seen[0].url, "http://rabbit:15672/api/queues/%2F/orders");
  assert.equal(seen[0].auth, `Basic ${btoa("guest:guest")}`);
});

test("checks.tcp connects to a listening port and reports a closed one down", async () => {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    assert.equal(await checks.tcp("127.0.0.1", port).check(), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const down = await checks.tcp("127.0.0.1", port, { timeoutMs: 500 }).check();
  assert.equal(down.status, "down");
});

test("heartbeats send full dependency reports with kind, target, latency and metrics", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, {
    checks: {
      database: checks.postgres({ query: async () => {}, totalCount: 4, idleCount: 4, waitingCount: 0, options: { host: "db", port: 5432 } }),
      legacy: () => true,
    },
  });
  await monitoring.heartbeat();
  const { database, legacy } = api.calls[0].body.dependencies;
  assert.equal(database.status, "healthy");
  assert.equal(database.kind, "postgres");
  assert.equal(database.target, "db:5432");
  assert.equal(typeof database.latencyMs, "number");
  assert.deepEqual(database.metrics, { poolTotal: 4, poolIdle: 4, poolWaiting: 0 });
  assert.equal(legacy.status, "healthy");
});

test("a server that only takes statuses gets them, from then on", async () => {
  const api = fakeApi((call) => {
    if (call.path.endsWith("/heartbeat") && typeof call.body.dependencies?.database === "object") {
      return json(422, { detail: "dependencies.database: Expected string, received object" });
    }
  });
  const monitoring = makeClient(api, { checks: { database: () => true } });
  const reply = await monitoring.heartbeat();
  assert.ok(reply, "the fallback heartbeat was delivered");
  assert.deepEqual(api.calls[1].body.dependencies, { database: "healthy" });
  await monitoring.heartbeat();
  assert.equal(api.calls.length, 3, "no second rejected attempt");
  assert.deepEqual(api.calls[2].body.dependencies, { database: "healthy" });
});

test("start() counts outgoing calls per target and sends them, with runtime vitals, on the heartbeat", async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = req.url === "/fail" ? 503 : 200;
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const target = `http://127.0.0.1:${server.address().port}`;
  const api = fakeApi();
  const monitoring = makeClient(api);
  try {
    monitoring.start({ heartbeatInterval: 60_000, captureUnhandled: false });
    await sleep(20);
    for (const path of ["/a?token=x", "/b", "/fail"]) await (await fetch(`${target}${path}`)).text();
    await sleep(20);
    await monitoring.heartbeat();
    const beat = api.calls.filter((c) => c.path.endsWith("/heartbeat")).at(-1).body;
    const calls = beat.calls.find((c) => c.target === target);
    assert.ok(calls, `calls to ${target} are reported: ${JSON.stringify(beat.calls)}`);
    assert.equal(calls.count, 3);
    assert.equal(calls.errors, 1);
    assert.equal(typeof calls.p95Ms, "number");
    assert.ok(!JSON.stringify(beat.calls).includes("token"), "no paths or queries");
    assert.equal(typeof beat.runtime.rssMb, "number");
    assert.equal(typeof beat.runtime.heapUsedMb, "number");
  } finally {
    await monitoring.stop({ flushTimeout: 100 });
    await new Promise((resolve) => server.close(resolve));
  }
});

test("job() scopes, counts and reports failures, then re-throws", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  assert.equal(await monitoring.job("send-email", async () => 42), 42);
  await assert.rejects(
    monitoring.job("send-email", async () => {
      throw new Error("SMTP refused");
    }),
    /SMTP refused/,
  );
  assert.equal(await monitoring.job("cleanup", () => {
    throw new Error("disk full");
  }, { rethrow: false }), undefined);
  await monitoring.flush();
  const events = api.events();
  const smtp = events.find((e) => e.message === "SMTP refused");
  assert.equal(smtp.transaction, "send-email");
  assert.equal(smtp.tags.job, "send-email");
  assert.equal(smtp.handled, false);
  assert.equal(smtp.exception[0].mechanism.type, "job");

  await monitoring.heartbeat();
  const jobs = api.calls.filter((c) => c.path.endsWith("/heartbeat")).at(-1).body.jobs;
  const email = jobs.find((j) => j.name === "send-email");
  assert.equal(email.count, 2);
  assert.equal(email.failed, 1);
  assert.ok(email.lastFailedAt);
  await monitoring.heartbeat();
  assert.ok(!("jobs" in api.calls.at(-1).body), "stats reset after each heartbeat");
});

test("captureRequestError reports Next.js request errors with their route", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  monitoring.captureRequestError(new Error("render failed"), { path: "/orders/81?secret=1", method: "GET", headers: { "user-agent": "test" } }, { routerKind: "App Router", routePath: "/orders/[id]", routeType: "render" });
  await monitoring.flush();
  const [event] = api.events();
  assert.equal(event.request.url, "/orders/81");
  assert.equal(event.request.route, "/orders/[id]");
  assert.equal(event.tags["next.route_type"], "render");
  assert.equal(event.handled, false);
});

test("init() makes one client per process, reachable from the module functions", async () => {
  _resetForTesting();
  const api = fakeApi();
  try {
    const client = init({ apiUrl: "https://nex.example.com/api/v1/monitoring", token: TOKEN, service: "web", fetch: api.fetch, logger: null, autoStart: false });
    assert.equal(init({}), client, "a second init returns the same client");
    assert.equal(getClient(), client);
    assert.ok(captureException(new Error("from anywhere")));
    await client.flush();
    assert.equal(api.events()[0].message, "from anywhere");
  } finally {
    _resetForTesting();
  }
});

test("Firefox and Safari stacks parse into frames", () => {
  const frames = parseStack(
    ["handleClick@https://app.example.com/static/app.js:10:15", "@https://app.example.com/static/app.js:2:1", "dispatch@https://app.example.com/static/vendor.js:99:7"].join("\n"),
    (file) => file.includes("/app.js"),
  );
  assert.equal(frames.length, 3);
  assert.deepEqual(frames[0], { function: "handleClick", filename: "https://app.example.com/static/app.js", lineno: 10, colno: 15, inApp: true });
  assert.equal(frames[1].function, undefined);
  assert.equal(frames[2].inApp, false);
});
