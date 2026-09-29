import assert from "node:assert/strict";
import test from "node:test";
import { inspect } from "node:util";

import {
  createMonitoring,
  MonitoringConfigError,
  normalizeEnvironment,
  redact,
  redactBounded,
  redactString,
} from "../packages/monitoring/dist/index.js";
import { TOKEN, captureLogger, fakeApi, json, makeClient, sleep } from "./monitoringHelpers.mjs";

/**
 * The monitoring SDK's contract with applications: configuration fails loudly
 * at startup and never afterwards; every report matches the Nerdstack API
 * exactly; and nothing sensitive leaves the process.
 */

// --- Configuration --------------------------------------------------------------

test("missing configuration fails at startup, listing every problem", () => {
  const saved = { ...process.env };
  delete process.env.MONITORING_URL;
  delete process.env.MONITORING_TOKEN;
  delete process.env.MONITORING_SERVICE;
  try {
    assert.throws(
      () => createMonitoring({}),
      (error) => {
        assert.ok(error instanceof MonitoringConfigError);
        assert.equal(error.problems.length, 3);
        assert.match(error.message, /MONITORING_URL/);
        assert.match(error.message, /MONITORING_TOKEN/);
        assert.match(error.message, /MONITORING_SERVICE/);
        return true;
      },
    );
  } finally {
    process.env = saved;
  }
});

test("a malformed token is rejected without echoing it", () => {
  assert.throws(
    () => createMonitoring({ endpoint: "https://nerdstackgrp.com", token: "sk_live_mysecretvalue123", service: "ark-api" }),
    (error) => {
      assert.ok(error instanceof MonitoringConfigError);
      assert.ok(!error.message.includes("mysecretvalue"), error.message);
      return true;
    },
  );
});

test("the endpoint must be https, except for localhost", () => {
  const base = { token: TOKEN, service: "ark-api", logger: null };
  assert.throws(() => createMonitoring({ ...base, endpoint: "http://nerdstackgrp.com" }), /https/);
  assert.throws(() => createMonitoring({ ...base, endpoint: "not a url" }), /absolute URL/);
  assert.throws(() => createMonitoring({ ...base, endpoint: "https://user:pw@nerdstackgrp.com" }), /credentials/);
  assert.doesNotThrow(() => createMonitoring({ ...base, endpoint: "http://localhost:3000" }));
  assert.throws(() => createMonitoring({ ...base, endpoint: "https://nerdstackgrp.com", service: "Ark API" }), /slug/);
});

test("an endpoint that already includes the API path is accepted", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { endpoint: "https://nerdstackgrp.com/api/v1/monitoring/" });
  await monitoring.heartbeat();
  assert.equal(api.calls[0].url, "https://nerdstackgrp.com/api/v1/monitoring/heartbeat");
});

test("configuration can come entirely from the environment", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    MONITORING_URL: "https://nerdstackgrp.com",
    MONITORING_TOKEN: TOKEN,
    MONITORING_SERVICE: "ace-api",
    APP_VERSION: "9.1.0",
    NODE_ENV: "prod",
  });
  try {
    const api = fakeApi();
    const monitoring = createMonitoring({ fetch: api.fetch, logger: null });
    assert.equal(monitoring.service, "ace-api");
    assert.equal(monitoring.version, "9.1.0");
    assert.equal(monitoring.environment, "production");
    await monitoring.heartbeat();
    assert.equal(api.calls[0].headers.authorization, `Bearer ${TOKEN}`);
  } finally {
    process.env = saved;
  }
});

test("disabled monitoring needs no configuration and sends nothing", async () => {
  const api = fakeApi();
  const monitoring = createMonitoring({ enabled: false, fetch: api.fetch });
  assert.equal(monitoring.enabled, false);
  assert.equal(monitoring.captureException(new Error("x")), false);
  assert.equal(await monitoring.heartbeat(), null);
  assert.equal(await monitoring.reportRelease({ version: "1" }), null);
  monitoring.start();
  await monitoring.stop();
  assert.equal(api.calls.length, 0);

  const saved = process.env.MONITORING_ENABLED;
  process.env.MONITORING_ENABLED = "false";
  try {
    assert.equal(createMonitoring({}).enabled, false);
  } finally {
    if (saved === undefined) delete process.env.MONITORING_ENABLED;
    else process.env.MONITORING_ENABLED = saved;
  }
});

test("environments are normalised to what the API accepts, and others omitted", async () => {
  assert.equal(normalizeEnvironment("PROD"), "production");
  assert.equal(normalizeEnvironment("stage"), "staging");
  assert.equal(normalizeEnvironment("dev"), "development");
  assert.equal(normalizeEnvironment("test"), undefined);

  const api = fakeApi();
  const monitoring = makeClient(api, { environment: "test" });
  await monitoring.heartbeat();
  monitoring.captureMessage("hi");
  await monitoring.flush();
  assert.ok(!("environment" in api.calls[0].body), "an unsupported environment would fail server validation");
  assert.ok(!("environment" in api.events()[0]));
});

test("invalid numeric options are reported at startup", () => {
  assert.throws(
    () => createMonitoring({ endpoint: "https://nerdstackgrp.com", token: TOKEN, service: "ark-api", requestTimeout: -1 }),
    /requestTimeout/,
  );
});

// --- Heartbeat ---------------------------------------------------------------------

test("a heartbeat reports service, version, environment, status, uptime and timestamp", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  const reply = await monitoring.heartbeat();

  const call = api.calls[0];
  assert.equal(call.method, "POST");
  assert.equal(call.path, "/api/v1/monitoring/heartbeat");
  assert.equal(call.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(call.headers["content-type"], "application/json");
  assert.equal(call.body.service, "ark-api");
  assert.equal(call.body.version, "2.4.1");
  assert.equal(call.body.environment, "production");
  assert.equal(call.body.status, "healthy");
  assert.equal(typeof call.body.uptime, "number");
  assert.ok(!Number.isNaN(Date.parse(call.body.timestamp)));
  assert.equal(reply.expectedIntervalSeconds, 30);
});

test("dependencies are optional, accept booleans, and drive the derived status", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);

  await monitoring.heartbeat({ dependencies: { database: "healthy", redis: true, storage: false } });
  assert.deepEqual(api.calls[0].body.dependencies, { database: "healthy", redis: "healthy", storage: "down" });
  assert.equal(api.calls[0].body.status, "degraded");

  await monitoring.heartbeat({ status: "unhealthy", dependencies: { database: "healthy" } });
  assert.equal(api.calls[1].body.status, "unhealthy");

  await monitoring.heartbeat();
  assert.ok(!("dependencies" in api.calls[2].body));
});

test("configured checks run per heartbeat; failures and hangs report down", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, {
    checkTimeout: 50,
    checks: {
      database: async () => true,
      redis: async () => {
        throw new Error("ECONNREFUSED");
      },
      storage: () => new Promise(() => {}),
      queue: () => "degraded",
    },
  });
  await monitoring.heartbeat();
  const body = api.calls[0].body;
  assert.deepEqual(body.dependencies, { database: "healthy", redis: "down", storage: "down", queue: "degraded" });
  assert.equal(body.status, "degraded");
  assert.equal(typeof body.responseTime, "number");
});

test("concurrent heartbeats share one request", async () => {
  const api = fakeApi(async () => {
    await sleep(30);
    return undefined;
  });
  const monitoring = makeClient(api);
  const [a, b, c] = await Promise.all([monitoring.heartbeat(), monitoring.heartbeat(), monitoring.heartbeat()]);
  assert.equal(api.calls.length, 1);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("a failed heartbeat resolves null instead of throwing", async () => {
  const api = fakeApi(() => {
    throw new TypeError("fetch failed");
  });
  const monitoring = makeClient(api, { maxRetries: 0 });
  assert.equal(await monitoring.heartbeat(), null);
});

// --- Automatic heartbeat -------------------------------------------------------------

test("start() heartbeats immediately and on the interval; stop() ends it", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  monitoring.start({ heartbeatInterval: 40 });
  monitoring.start({ heartbeatInterval: 40 }); // no second timer
  assert.equal(monitoring.running, true);
  await sleep(150);
  await monitoring.stop();
  const sent = api.calls.filter((c) => c.path.endsWith("/heartbeat")).length;
  assert.ok(sent >= 3 && sent <= 5, `expected ~4 heartbeats, got ${sent}`);

  await sleep(100);
  assert.equal(api.calls.filter((c) => c.path.endsWith("/heartbeat")).length, sent, "no heartbeats after stop()");
  assert.equal(monitoring.running, false);
});

test("a slow heartbeat never overlaps the next one", async () => {
  let active = 0;
  let maxActive = 0;
  const api = fakeApi(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await sleep(60);
    active -= 1;
    return undefined;
  });
  const monitoring = makeClient(api);
  monitoring.start({ heartbeatInterval: 10 });
  await sleep(200);
  await monitoring.stop();
  assert.equal(maxActive, 1);
});

// --- Errors ---------------------------------------------------------------------------

test("captureException reports name, message, stack, service, version, environment and request id", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  const error = new TypeError("Cannot read properties of undefined");
  assert.equal(monitoring.captureException(error, { requestId: "req-42", metadata: { orderId: "o-1" } }), true);
  await monitoring.flush();

  const [event] = api.events();
  assert.equal(event.type, "exception");
  assert.equal(event.severity, "ERROR");
  assert.equal(event.service, "ark-api");
  assert.equal(event.environment, "production");
  assert.equal(event.message, "Cannot read properties of undefined");
  assert.equal(event.error.name, "TypeError");
  assert.match(event.error.stack, /monitoring-core\.test\.mjs/);
  assert.equal(event.metadata.requestId, "req-42");
  assert.equal(event.metadata.orderId, "o-1");
  assert.equal(event.metadata.version, "2.4.1");
  assert.ok(!Number.isNaN(Date.parse(event.timestamp)));
});

test("anything thrown can be captured without crashing the reporter", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  const circular = { message: undefined };
  circular.self = circular;
  for (const value of ["plain string", 42, undefined, null, { code: "E1" }, circular, Symbol("s")]) {
    assert.doesNotThrow(() => monitoring.captureException(value));
  }
  await monitoring.flush();
  const events = api.events();
  assert.equal(events.length, 7);
  assert.equal(events[0].message, "plain string");
  assert.equal(events[0].error.name, "NonError");
});

test("error causes are included in the stack", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  monitoring.captureException(new Error("Failed to save order", { cause: new Error("connect ECONNREFUSED 10.0.0.5:5432") }));
  await monitoring.flush();
  assert.match(api.events()[0].error.stack, /Caused by: Error: connect ECONNREFUSED/);
});

test("captureError reports an error condition with an optional underlying error", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  monitoring.captureError("Payment provider declined", { error: new Error("402 from provider"), metadata: { provider: "paystack" } });
  monitoring.captureError("Queue backlog above threshold", { level: "warning" });
  await monitoring.flush();
  const [first, second] = api.events();
  assert.equal(first.type, "error");
  assert.equal(first.severity, "ERROR");
  assert.equal(first.error.message, "402 from provider");
  assert.equal(second.severity, "WARNING");
  assert.ok(!("error" in second));
});

test("captureMessage levels map to the API's severities and event types", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  monitoring.captureMessage("Something happened", "info");
  monitoring.captureMessage("Something looks wrong", "warning");
  monitoring.captureMessage("Operation failed", "error");
  monitoring.captureMessage("Production is unavailable", "critical");
  await monitoring.flush();
  const byMessage = Object.fromEntries(api.events().map((e) => [e.message, [e.severity, e.type]]));
  assert.deepEqual(byMessage["Something happened"], ["INFO", "custom"]);
  assert.deepEqual(byMessage["Something looks wrong"], ["WARNING", "warning"]);
  assert.deepEqual(byMessage["Operation failed"], ["ERROR", "error"]);
  assert.deepEqual(byMessage["Production is unavailable"], ["CRITICAL", "error"]);
});

test("critical events are sent immediately, others are batched", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { flushInterval: 60_000 });
  monitoring.captureMessage("routine", "info");
  await sleep(20);
  assert.equal(api.calls.length, 0, "info waits for the batch");
  monitoring.captureMessage("Production is unavailable", "critical");
  await sleep(20);
  assert.equal(api.events().length, 2, "critical flushes the queue straight away");
  await monitoring.flush();
});

test("the same error object is reported once, and identical repeats are collapsed", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 1_000 });
  const error = new Error("boom");
  assert.equal(monitoring.captureException(error), true);
  assert.equal(monitoring.captureException(error), false, "caught, reported, rethrown, caught again");

  for (let i = 0; i < 20; i++) monitoring.captureMessage("retrying connection", "warning");
  monitoring.captureMessage("a different message", "warning");
  await monitoring.flush();
  const messages = api.events().map((e) => e.message);
  assert.equal(messages.filter((m) => m === "retrying connection").length, 1);
  assert.equal(messages.filter((m) => m === "a different message").length, 1);

  const noDedupe = makeClient(api, { dedupeWindow: 0 });
  noDedupe.captureMessage("x");
  noDedupe.captureMessage("x");
  await noDedupe.flush();
  assert.equal(api.events().filter((e) => e.message === "x").length, 2);
});

// --- Context & custom events -----------------------------------------------------------

test("context is attached to every later event until cleared", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0 });
  monitoring.setContext({ region: "eu-west", instance: "api-01" });
  monitoring.setContext({ deployment: "production", instance: undefined, sessionToken: "abc" });
  monitoring.captureMessage("with context");
  monitoring.clearContext();
  monitoring.captureMessage("without context");
  await monitoring.flush();

  const [withContext, withoutContext] = api.events();
  assert.deepEqual(withContext.metadata.context, { region: "eu-west", deployment: "production", sessionToken: "[redacted]" });
  assert.ok(!("context" in (withoutContext.metadata ?? {})));
  assert.deepEqual(monitoring.getContext(), {});
});

test("track() sends a custom event with redacted properties", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  monitoring.track("payment.failed", { orderId: "ord_1", provider: "paystack", cardNumber: "4242424242424242", apiKey: "sk_x" });
  await monitoring.flush();
  const [event] = api.events();
  assert.equal(event.type, "custom");
  assert.equal(event.severity, "INFO");
  assert.equal(event.message, "payment.failed");
  assert.deepEqual(event.metadata.properties, {
    orderId: "ord_1",
    provider: "paystack",
    cardNumber: "[redacted]",
    apiKey: "[redacted]",
  });
});

test("custom redaction keys and beforeSend filter what is sent", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, {
    dedupeWindow: 0,
    redactKeys: ["email", /^customer/i],
    beforeSend: (event) => {
      if (event.message === "noise") return null;
      return { ...event, metadata: { ...event.metadata, tagged: true } };
    },
  });
  assert.equal(monitoring.captureMessage("noise"), false);
  monitoring.track("signup", { email: "a@b.c", customerName: "Ada", plan: "pro" });
  await monitoring.flush();
  const events = api.events();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].metadata.properties, { email: "[redacted]", customerName: "[redacted]", plan: "pro" });
  assert.equal(events[0].metadata.tagged, true);
});

test("a throwing beforeSend does not lose the event", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, {
    beforeSend: () => {
      throw new Error("bug in hook");
    },
  });
  assert.equal(monitoring.captureMessage("still sent"), true);
  await monitoring.flush();
  assert.equal(api.events()[0].message, "still sent");
});

// --- Releases ---------------------------------------------------------------------------

test("reportRelease sends version, commit, service and environment", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  const release = await monitoring.reportRelease({ version: "2.4.1", commit: "a82f91c", deployedAt: new Date("2026-09-29T10:00:00Z") });
  const call = api.calls[0];
  assert.equal(call.path, "/api/v1/monitoring/releases");
  assert.deepEqual(call.body, {
    version: "2.4.1",
    commit: "a82f91c",
    service: "ark-api",
    environment: "production",
    deployedAt: "2026-09-29T10:00:00.000Z",
  });
  assert.equal(release.previousVersion, "2.4.0");
});

test("release version and commit default from the environment", async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { APP_VERSION: "3.0.0", SOURCE_COMMIT: "deadbeef" });
  try {
    const api = fakeApi();
    const monitoring = createMonitoring({ endpoint: "https://nerdstackgrp.com", token: TOKEN, service: "ark-api", fetch: api.fetch, logger: null });
    await monitoring.reportRelease({ service: null });
    assert.equal(api.calls[0].body.version, "3.0.0");
    assert.equal(api.calls[0].body.commit, "deadbeef");
    assert.ok(!("service" in api.calls[0].body), "service: null reports an application-wide release");
  } finally {
    process.env = saved;
  }
});

test("a release without any version is not sent", async () => {
  const saved = { ...process.env };
  delete process.env.APP_VERSION;
  delete process.env.npm_package_version;
  try {
    const api = fakeApi();
    const { lines, logger } = captureLogger();
    const monitoring = createMonitoring({ endpoint: "https://nerdstackgrp.com", token: TOKEN, service: "ark-api", fetch: api.fetch, logger });
    assert.equal(await monitoring.reportRelease(), null);
    assert.equal(api.calls.length, 0);
    assert.match(lines.join("\n"), /needs a version/);
  } finally {
    process.env = saved;
  }
});

test("fetchConfig reads the application's own config", async () => {
  const api = fakeApi((call) =>
    call.path.endsWith("/config") ? json(200, { application: { slug: "ark" }, services: [] }) : undefined,
  );
  const monitoring = makeClient(api);
  const config = await monitoring.fetchConfig();
  assert.equal(api.calls[0].method, "GET");
  assert.equal(config.application.slug, "ark");
});

// --- Redaction & token handling ---------------------------------------------------------

test("sensitive metadata is redacted at any depth, ordinary keys are kept", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  monitoring.captureMessage("request failed", "error", {
    metadata: {
      headers: { Authorization: "Bearer abc.def.ghi", cookie: "sid=1", "x-api-key": "k", "content-type": "json" },
      user: { password: "hunter2", passwordHash: "$2b$", author: "Ada", passengers: 3 },
      client_secret: "cs",
      privateKey: "-----BEGIN",
      sessionId: "s1",
    },
  });
  await monitoring.flush();
  const meta = api.events()[0].metadata;
  assert.equal(meta.headers.Authorization, "[redacted]");
  assert.equal(meta.headers.cookie, "[redacted]");
  assert.equal(meta.headers["x-api-key"], "[redacted]");
  assert.equal(meta.headers["content-type"], "json");
  assert.equal(meta.user.password, "[redacted]");
  assert.equal(meta.user.passwordHash, "[redacted]");
  assert.equal(meta.user.author, "Ada");
  assert.equal(meta.user.passengers, 3);
  assert.equal(meta.client_secret, "[redacted]");
  assert.equal(meta.privateKey, "[redacted]");
  assert.equal(meta.sessionId, "[redacted]");
  assert.ok(!JSON.stringify(api.calls).includes("hunter2"));
});

test("credentials inside messages and stack traces are scrubbed", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.c2lnbmF0dXJlLXZhbHVl";
  const error = new Error(`Upstream rejected Bearer ${jwt} for postgres://app:s3cret@db:5432/prod password=hunter2`);
  error.stack = `${error.message}\n    at connect (${TOKEN})`;
  monitoring.captureException(error);
  await monitoring.flush();
  const sent = JSON.stringify(api.events());
  for (const secret of [jwt, "s3cret", "hunter2", TOKEN]) assert.ok(!sent.includes(secret), `leaked ${secret}`);
  assert.match(sent, /Bearer \[redacted\]/);
  assert.match(sent, /postgres:\/\/\[redacted\]@db/);
});

test("redact() survives cycles, BigInts, functions and dates", () => {
  const value = { n: 10n, fn: () => 1, when: new Date("2026-01-01T00:00:00Z"), list: [1, 2] };
  value.self = value;
  assert.deepEqual(redact(value), { n: "10", fn: null, when: "2026-01-01T00:00:00.000Z", list: [1, 2], self: "[circular]" });
  assert.equal(redactString("key: api_key=abcdef123"), "key: api_key=[redacted]");
});

test("the token never appears in payloads, inspection, JSON or logs", async () => {
  const { lines, logger } = captureLogger();
  const api = fakeApi((call) => (call.path.endsWith("/heartbeat") ? json(401, { detail: "Invalid monitoring token" }) : undefined));
  const monitoring = makeClient(api, { logger, debug: true });
  monitoring.captureException(new Error("x"));
  await monitoring.flush();
  await monitoring.heartbeat();

  assert.ok(!inspect(monitoring, { depth: 10 }).includes(TOKEN));
  assert.ok(!JSON.stringify(monitoring).includes(TOKEN));
  assert.ok(!lines.join("\n").includes(TOKEN));
  for (const call of api.calls) assert.ok(!call.raw.includes(TOKEN), "token only travels in the Authorization header");
  assert.ok(!api.calls.some((c) => c.url.includes("nsk_")), "never in the URL");
});

// --- Payload limits ------------------------------------------------------------------------

test("oversized fields are truncated and oversized metadata is replaced by a marker", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api);
  const error = new Error("m".repeat(50_000));
  error.stack = "s".repeat(100_000);
  monitoring.captureException(error, { metadata: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, "v".repeat(900)])) });
  await monitoring.flush();

  const event = api.events()[0];
  assert.ok(event.message.length <= 2_000);
  assert.ok(event.error.message.length <= 4_000);
  assert.ok(event.error.stack.length <= 16_000);
  assert.equal(event.metadata._truncated, true);
  for (const call of api.calls) assert.ok(Buffer.byteLength(call.raw) < 64 * 1024, "server rejects bodies over 64KB");
});

test("many events are sent in batches of at most 25, each under the size limit", async () => {
  const api = fakeApi();
  const monitoring = makeClient(api, { dedupeWindow: 0, maxBufferedEvents: 200, flushInterval: 60_000 });
  for (let i = 0; i < 60; i++) monitoring.captureMessage(`event ${i} ${"x".repeat(1_500)}`, "warning");
  await monitoring.flush();
  const eventCalls = api.calls.filter((c) => c.path.endsWith("/events"));
  assert.ok(eventCalls.length >= 3);
  for (const call of eventCalls) {
    const count = Array.isArray(call.body.events) ? call.body.events.length : 1;
    assert.ok(count <= 25);
    assert.ok(Buffer.byteLength(call.raw) < 64 * 1024);
  }
  assert.equal(api.events().length, 60);
});

test("redaction cost is bounded by the size limit, not by the input", () => {
  // Pathological input for URL/credential patterns: a long run of scheme-like
  // characters. This used to take tens of seconds.
  const hostile = `${"a".repeat(1_000_000)}://${"b".repeat(100_000)}`;
  const started = performance.now();
  redactBounded(hostile, 16_000);
  redactString("s".repeat(200_000));
  assert.ok(performance.now() - started < 1_000, `took ${Math.round(performance.now() - started)}ms`);
});

test("a secret straddling the truncation point is still redacted", () => {
  const text = `${"x".repeat(1_990)} ${TOKEN} tail`;
  const out = redactBounded(text, 2_000);
  assert.ok(out.length <= 2_000);
  assert.ok(!out.includes(TOKEN.slice(0, 12)), out.slice(-40));
});
