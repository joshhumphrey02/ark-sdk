import assert from "node:assert/strict";
import test from "node:test";

import { TOKEN, captureLogger, fakeApi, json, makeClient, sleep, startServer } from "./monitoringHelpers.mjs";
import { Monitoring, createMonitoring } from "../packages/nex-js/dist/index.js";

/**
 * Delivery when Nerdstack is slow, failing, or gone. The rule these tests pin:
 * monitoring is never more important than the application. Requests time out
 * quickly, retries are bounded, an outage triggers a pause rather than a retry
 * storm, buffered events are capped, and nothing ever throws into the caller.
 */

test("a hanging server is abandoned after the request timeout", async () => {
  const server = await startServer(() => {
    // Never respond.
  });
  try {
    const monitoring = createMonitoring({
      endpoint: server.url,
      token: TOKEN,
      service: "ark-api",
      requestTimeout: 150,
      maxRetries: 0,
      logger: null,
    });
    const started = Date.now();
    assert.equal(await monitoring.heartbeat(), null);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1_000, `took ${elapsed}ms`);
  } finally {
    await server.close();
  }
});

test("an unreachable server never throws into the application", async () => {
  // Nothing listens on port 9 on a developer machine or CI runner.
  const monitoring = createMonitoring({ endpoint: "http://127.0.0.1:9", token: TOKEN, service: "ark-api", maxRetries: 1, retryDelay: 1, logger: null });
  assert.equal(await monitoring.heartbeat(), null);
  assert.equal(monitoring.captureException(new Error("while offline")), true);
  assert.equal(await monitoring.flush(2_000), false, "not delivered");
  assert.equal(monitoring.stats().queued, 1, "kept in memory for later");
  assert.equal(await monitoring.reportRelease({ version: "1.0.0" }), null);
});

test("transient failures are retried with backoff, then succeed", async () => {
  const api = fakeApi((call, n) => (n <= 2 ? json(503, { detail: "Monitoring is disabled" }) : undefined));
  const monitoring = makeClient(api, { maxRetries: 2 });
  const reply = await monitoring.heartbeat({});
  // Heartbeats retry at most once; the next beat supersedes a lost one.
  assert.equal(reply, null);
  assert.equal(api.calls.length, 2);

  const release = await monitoring.reportRelease({ version: "1.2.3" });
  assert.equal(release.version, "1.2.3");
  assert.equal(api.calls.length, 3);
});

test("retries are bounded", async () => {
  const api = fakeApi(() => json(500, { detail: "Internal server error" }));
  const monitoring = makeClient(api, { maxRetries: 2 });
  assert.equal(await monitoring.reportRelease({ version: "1" }), null);
  assert.equal(api.calls.length, 3, "one attempt plus two retries");
});

test("client errors are not retried", async () => {
  for (const status of [400, 413, 422]) {
    const api = fakeApi(() => json(status, { detail: "service: Unknown service" }));
    const monitoring = makeClient(api, { maxRetries: 3 });
    await monitoring.reportRelease({ version: "1" });
    assert.equal(api.calls.length, 1, `status ${status}`);
  }
});

test("429 honours Retry-After", async () => {
  const api = fakeApi((call, n) => (n === 1 ? json(429, { detail: "Rate limit exceeded" }, { "retry-after": "0" }) : undefined));
  const monitoring = makeClient(api, { maxRetries: 1 });
  assert.ok(await monitoring.reportRelease({ version: "1" }));
  assert.equal(api.calls.length, 2);

  // A long Retry-After becomes a pause instead of a held-open request.
  const slow = fakeApi(() => json(429, { detail: "Rate limit exceeded" }, { "retry-after": "120" }));
  const paused = makeClient(slow, { maxRetries: 3 });
  const started = Date.now();
  assert.equal(await paused.reportRelease({ version: "1" }), null);
  assert.ok(Date.now() - started < 500);
  assert.equal(paused.stats().paused, true);
  await paused.heartbeat();
  assert.equal(slow.calls.length, 1, "no request while paused");
});

test("repeated failures pause sending instead of storming the server", async () => {
  const api = fakeApi(() => {
    throw new TypeError("fetch failed");
  });
  const monitoring = makeClient(api, { maxRetries: 0 });
  for (let i = 0; i < 3; i++) await monitoring.heartbeat();
  assert.equal(api.calls.length, 3);
  assert.equal(monitoring.stats().paused, true);

  for (let i = 0; i < 20; i++) await monitoring.heartbeat();
  monitoring.captureMessage("during outage", "critical");
  await monitoring.flush(200);
  assert.equal(api.calls.length, 3, "paused: no further requests");
});

test("a rejected token stops all reporting, with one warning that never shows the token", async () => {
  const { lines, logger } = captureLogger();
  const api = fakeApi(() => json(401, { detail: "Invalid monitoring token" }));
  const monitoring = makeClient(api, { logger });
  await monitoring.heartbeat();
  await monitoring.heartbeat();
  assert.equal(monitoring.captureException(new Error("after 401")), false);
  await monitoring.flush();

  assert.equal(api.calls.length, 1);
  assert.equal(monitoring.stats().tokenRejected, true);
  const warnings = lines.filter((l) => l.includes("401"));
  assert.equal(warnings.length, 1);
  assert.ok(!lines.join("\n").includes(TOKEN));
});

test("events buffer while offline, drop the oldest past the limit, and deliver after the pause", async () => {
  let online = false;
  let now = Date.parse("2026-09-29T10:00:00Z");
  const clock = { now: () => now, sleep: async () => {} };
  const api = fakeApi(() => {
    if (!online) throw new TypeError("fetch failed");
    return undefined;
  });
  const monitoring = new Monitoring(
    { endpoint: "https://monitor.example.com", token: TOKEN, service: "ark-api", logger: null, fetch: api.fetch, maxBufferedEvents: 3, maxRetries: 0, dedupeWindow: 0, flushInterval: 5 },
    clock,
  );
  for (let i = 1; i <= 5; i++) {
    monitoring.captureMessage(`event ${i}`, "warning");
    await monitoring.flush(100);
  }
  assert.equal(monitoring.stats().queued, 3);
  assert.equal(monitoring.stats().dropped, 2, "oldest discarded first");
  assert.equal(monitoring.stats().paused, true);

  online = true;
  const attempts = api.calls.length;
  assert.equal(await monitoring.flush(100), false, "still paused: nothing sent");
  assert.equal(api.calls.length, attempts);

  now += 31_000;
  assert.equal(await monitoring.flush(), true);
  assert.deepEqual(
    api.events().slice(-3).map((e) => e.message),
    ["event 3", "event 4", "event 5"],
  );
  assert.equal(monitoring.stats().paused, false);
});

test("buffered events are delivered once the outage ends", async () => {
  let online = false;
  const api = fakeApi(() => (online ? undefined : json(502, { detail: "Bad gateway" })));
  const monitoring = makeClient(api, { maxRetries: 0, dedupeWindow: 0 });
  monitoring.captureMessage("first", "warning");
  await monitoring.flush(200);
  monitoring.captureMessage("second", "warning");
  await monitoring.flush(200);
  assert.equal(monitoring.stats().queued, 2);

  online = true;
  assert.equal(await monitoring.flush(), true);
  assert.deepEqual(api.events().slice(-2).map((e) => e.message), ["first", "second"]);
  assert.equal(monitoring.stats().queued, 0);
});

test("the buffer limit also applies when nothing can be sent at all", async () => {
  const api = fakeApi(() => {
    throw new TypeError("fetch failed");
  });
  const monitoring = makeClient(api, { maxBufferedEvents: 10, maxRetries: 0, dedupeWindow: 0, flushInterval: 60_000 });
  for (let i = 0; i < 1_000; i++) monitoring.captureMessage(`e${i}`, "info");
  assert.equal(monitoring.stats().queued, 10);
  assert.equal(monitoring.stats().dropped, 990);
});

test("an invalid batch is dropped rather than retried forever", async () => {
  const api = fakeApi((call) => (call.path.endsWith("/events") ? json(422, { detail: "service: Unknown service" }) : undefined));
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  monitoring.captureMessage("one", "warning");
  monitoring.captureMessage("two", "warning");
  await monitoring.flush();
  assert.equal(monitoring.stats().queued, 0);
  assert.equal(monitoring.stats().dropped, 2);
  await monitoring.flush();
  assert.equal(api.calls.length, 1);
});

test("flush() is bounded by its timeout even if the server hangs", async () => {
  const server = await startServer(() => {});
  try {
    const monitoring = createMonitoring({ endpoint: server.url, token: TOKEN, service: "ark-api", requestTimeout: 5_000, logger: null });
    monitoring.captureMessage("x", "warning");
    const started = Date.now();
    assert.equal(await monitoring.flush(200), false);
    assert.ok(Date.now() - started < 1_000);
  } finally {
    await server.close();
  }
});

test("reports reach a real HTTP server with the documented shape", async () => {
  const server = await startServer((req, res) => {
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "ark-api", receivedAt: new Date().toISOString(), expectedIntervalSeconds: 20 }));
  });
  try {
    const monitoring = createMonitoring({ endpoint: server.url, token: TOKEN, service: "ark-api", environment: "staging", logger: null });
    await monitoring.heartbeat({ dependencies: { database: "healthy" } });
    monitoring.captureException(new Error("real"));
    await monitoring.flush();
    const [heartbeat, event] = server.requests;
    assert.equal(heartbeat.url, "/api/v1/monitoring/heartbeat");
    assert.equal(heartbeat.headers.authorization, `Bearer ${TOKEN}`);
    assert.match(heartbeat.headers["user-agent"], /nex-js/);
    assert.equal(heartbeat.body.environment, "staging");
    assert.equal(event.url, "/api/v1/monitoring/events");
    assert.equal(event.body.type, "exception");
  } finally {
    await server.close();
  }
});

test("the server's suggested heartbeat interval is used when none is configured", async () => {
  const api = fakeApi((call) =>
    call.path.endsWith("/heartbeat")
      ? json(202, { ok: true, service: "ark-api", receivedAt: "", expectedIntervalSeconds: 0.05 })
      : undefined,
  );
  const monitoring = makeClient(api);
  monitoring.start();
  await sleep(180);
  await monitoring.stop();
  assert.ok(api.calls.length >= 3, `got ${api.calls.length}`);
});
