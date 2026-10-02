// Shared fixtures for the monitoring SDK tests. Nothing here talks to a real
// Nerdstack deployment: the API is either a scripted fetch or a local server.

import http from "node:http";

import { createMonitoring } from "../packages/nex-js/dist/index.js";

export const TOKEN = `nsk_test_${"A1b2C3d4E5".repeat(4)}xyz`;

export function json(status, body, headers = {}) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * A fake monitoring API. `respond(call, index)` may return a Response (or a
 * promise of one); returning nothing yields the endpoint's normal success.
 */
export function fakeApi(respond = () => undefined) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = {
      url: String(url),
      path: new URL(String(url)).pathname,
      method: init.method,
      headers: init.headers ?? {},
      body: init.body ? JSON.parse(init.body) : undefined,
      raw: init.body ?? "",
      signal: init.signal,
    };
    calls.push(call);
    const custom = await respond(call, calls.length);
    if (custom) return custom;
    if (call.path.endsWith("/heartbeat")) {
      return json(202, { ok: true, service: call.body.service, receivedAt: new Date().toISOString(), expectedIntervalSeconds: 30 });
    }
    if (call.path.endsWith("/events")) {
      const events = Array.isArray(call.body.events) ? call.body.events : [call.body];
      return json(202, { ok: true, accepted: events.length, events: events.map((_, i) => ({ id: `e${i}`, fingerprint: "f" })) });
    }
    if (call.path.endsWith("/releases")) {
      return json(201, { ok: true, release: { id: "r1", version: call.body.version, previousVersion: "2.4.0", commit: call.body.commit ?? null } });
    }
    return json(200, { ok: true });
  };
  return {
    calls,
    fetch,
    /** Every event sent so far, unwrapped from batches. */
    events: () =>
      calls
        .filter((c) => c.path.endsWith("/events"))
        .flatMap((c) => (Array.isArray(c.body.events) ? c.body.events : [c.body])),
  };
}

/** A client wired to a fake API, with fast timings and a silent logger. */
export function makeClient(api, overrides = {}) {
  return createMonitoring({
    endpoint: "https://monitor.example.com",
    token: TOKEN,
    service: "ark-api",
    version: "2.4.1",
    environment: "production",
    logger: null,
    flushInterval: 5,
    retryDelay: 1,
    fetch: api.fetch,
    ...overrides,
  });
}

/** A collecting logger, to assert on what the SDK prints. */
export function captureLogger() {
  const lines = [];
  return { lines, logger: { warn: (m) => lines.push(m), debug: (m) => lines.push(m) } };
}

/** A real local HTTP server standing in for Nerdstack. */
export async function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const record = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : undefined };
      requests.push(record);
      handler(record, res);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
