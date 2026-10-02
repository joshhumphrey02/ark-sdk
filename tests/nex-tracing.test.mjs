// nex-js/server: traces across services, request summaries and custom metrics.

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import test from "node:test";

import { formatTraceparent, parseTraceparent } from "../packages/nex-js/dist/server.js";
import { fakeApi, makeClient } from "./monitoringHelpers.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const INCOMING = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

function fakeRes(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  return res;
}

async function downstream() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.traceparent ?? null);
    res.end("ok");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

const sentSpans = (api) => api.calls.filter((c) => c.path.endsWith("/spans")).flatMap((c) => c.body.spans);

test("traceparent parses and formats; malformed ones start a new trace", () => {
  assert.deepEqual(parseTraceparent(INCOMING), { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7", sampled: true });
  assert.equal(parseTraceparent("00-00000000000000000000000000000000-00f067aa0ba902b7-01"), null);
  assert.equal(parseTraceparent("garbage"), null);
  assert.equal(formatTraceparent({ traceId: "a".repeat(32), spanId: "b".repeat(16), sampled: false }), `00-${"a".repeat(32)}-${"b".repeat(16)}-00`);
});

test("a request continues the caller's trace, and its outgoing calls carry it on", async () => {
  const api = fakeApi();
  const down = await downstream();
  const monitoring = makeClient(api, { tracesSampleRate: 0 });
  monitoring.start({ heartbeatInterval: 60_000, captureUnhandled: false });
  try {
    const mw = monitoring.httpMiddleware({ summaryInterval: 0 });
    const res = fakeRes(200);
    await new Promise((resolve) =>
      mw({ method: "GET", url: "/orders/81", headers: { traceparent: INCOMING } }, res, async () => {
        await (await fetch(`${down.url}/stock`)).text();
        await new Promise((done) => http.get(`${down.url}/legacy`, (r) => r.resume().on("end", done)));
        await monitoring.trace("SELECT orders", async () => sleep(5), { kind: "client", attributes: { "db.system": "postgresql" } });
        monitoring.captureException(new Error("partial failure"));
        resolve();
      }),
    );
    res.emit("finish");
    await monitoring.flush();

    // Sampled upstream, so recorded here even at a 0 sample rate.
    const spans = sentSpans(api);
    const server = spans.find((s) => s.kind === "server");
    assert.ok(server, JSON.stringify(spans));
    assert.equal(server.traceId, "4bf92f3577b34da6a3ce929d0e0e4736");
    assert.equal(server.parentSpanId, "00f067aa0ba902b7");
    assert.equal(server.name, "GET /orders/:id");
    assert.equal(server.service, "ark-api");
    assert.equal(server.attributes["http.status_code"], 200);

    const client = spans.find((s) => s.kind === "client" && s.name.startsWith("GET http"));
    assert.ok(client, "the outgoing fetch is a client span");
    assert.equal(client.parentSpanId, server.spanId);
    const header = parseTraceparent(down.seen[0]);
    assert.ok(header, `downstream got a traceparent: ${down.seen[0]}`);
    assert.equal(header.traceId, server.traceId);
    assert.equal(header.spanId, client.spanId, "downstream's parent is the client span");

    // node:http clients carry it too (Node; Bun's fetch-only observer doesn't see them).
    if (!process.versions.bun) {
      const legacy = parseTraceparent(down.seen[1]);
      assert.ok(legacy, `node:http got a traceparent: ${down.seen[1]}`);
      assert.equal(legacy.traceId, server.traceId);
      assert.ok(spans.some((s) => s.kind === "client" && s.spanId === legacy.spanId));
    }

    const db = spans.find((s) => s.name === "SELECT orders");
    assert.equal(db.parentSpanId, server.spanId);
    assert.equal(db.attributes["db.system"], "postgresql");

    const [event] = api.events();
    assert.equal(event.traceId, server.traceId, "errors link to their trace");
  } finally {
    await monitoring.stop({ flushTimeout: 100 });
    await down.close();
  }
});

test("an unsampled trace sends no spans but still passes its decision on", async () => {
  const api = fakeApi();
  const down = await downstream();
  const monitoring = makeClient(api, { tracesSampleRate: 1 });
  monitoring.start({ heartbeatInterval: 60_000, captureUnhandled: false });
  try {
    const mw = monitoring.httpMiddleware({ summaryInterval: 0 });
    const res = fakeRes(200);
    await new Promise((resolve) =>
      mw({ method: "GET", url: "/", headers: { traceparent: INCOMING.replace(/-01$/, "-00") } }, res, async () => {
        await (await fetch(`${down.url}/x`)).text();
        resolve();
      }),
    );
    res.emit("finish");
    await monitoring.flush();
    assert.equal(sentSpans(api).length, 0);
    assert.match(down.seen[0], /^00-4bf92f3577b34da6a3ce929d0e0e4736-[0-9a-f]{16}-00$/);
  } finally {
    await monitoring.stop({ flushTimeout: 100 });
    await down.close();
  }
});

test("trace() fails with its function, nests, and jobs are spans", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { tracesSampleRate: 1 });
  await assert.rejects(
    monitoring.trace("import", async () => {
      await monitoring.trace("parse", () => 1);
      throw new Error("bad row");
    }),
    /bad row/,
  );
  await monitoring.job("send-receipt", async () => sleep(2));
  await monitoring.flush();
  const spans = sentSpans(api);
  const parent = spans.find((s) => s.name === "import");
  const child = spans.find((s) => s.name === "parse");
  assert.equal(parent.status, "error");
  assert.equal(child.parentSpanId, parent.spanId);
  assert.equal(child.traceId, parent.traceId);
  const job = spans.find((s) => s.name === "send-receipt");
  assert.equal(job.kind, "consumer");
  assert.equal(job.parentSpanId, null);
});

test("server errors mark the request span; a 0 sample rate records nothing new", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { tracesSampleRate: 1 });
  const mw = monitoring.httpMiddleware({ summaryInterval: 0 });
  const res = fakeRes(503);
  mw({ method: "POST", url: "/pay", headers: {} }, res, () => {});
  res.emit("finish");
  await monitoring.flush();
  const [span] = sentSpans(api);
  assert.equal(span.status, "error");
  assert.equal(span.parentSpanId, null);

  const quiet = fakeApi();
  const off = makeClient(quiet, { tracesSampleRate: 0 });
  const res2 = fakeRes(200);
  off.httpMiddleware({ summaryInterval: 0 })({ method: "GET", url: "/", headers: {} }, res2, () => {});
  res2.emit("finish");
  await off.flush();
  assert.equal(sentSpans(quiet).length, 0);
});

test("heartbeats carry the request summary and custom metrics", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  const mw = monitoring.httpMiddleware({ summaryInterval: 0 });
  for (const status of [200, 200, 500]) {
    const res = fakeRes(status);
    mw({ method: "GET", url: "/a", headers: {} }, res, () => {});
    res.emit("finish");
  }
  monitoring.increment("orders.placed");
  monitoring.increment("orders.placed", 2);
  monitoring.gauge("queue.depth", 40, "jobs");
  assert.equal(monitoring.metric("bad name!", 1), false);
  await monitoring.heartbeat();
  const beat = api.calls.filter((c) => c.path.endsWith("/heartbeat")).at(-1).body;
  assert.equal(beat.requests.count, 3);
  assert.equal(beat.requests.errors, 1);
  assert.equal(typeof beat.requests.p95Ms, "number");
  assert.ok(beat.requests.windowSeconds >= 1);
  assert.deepEqual(beat.metrics, [
    { name: "orders.placed", type: "counter", value: 3 },
    { name: "queue.depth", type: "gauge", value: 40, unit: "jobs" },
  ]);
  await monitoring.heartbeat();
  const next = api.calls.filter((c) => c.path.endsWith("/heartbeat")).at(-1).body;
  assert.equal(next.requests.count, 0);
  assert.deepEqual(next.metrics, [{ name: "queue.depth", type: "gauge", value: 40, unit: "jobs" }], "counters reset, gauges stay");
});
