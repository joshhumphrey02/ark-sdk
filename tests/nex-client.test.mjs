// nex-js/client in a simulated browser: crashes, breadcrumbs, context,
// filtering and delivery to the browser endpoint.

import assert from "node:assert/strict";
import test from "node:test";

import { BrowserClient, describeElement, parseBrowser, parseOs } from "../packages/nex-js/dist/client.js";

const KEY = `nex_pub_${"Ab3dEf6hIj".repeat(3)}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A window just real enough for the SDK: events, location, history, document. */
function fakeWindow(href = "https://shop.example.com/cart?coupon=SECRET") {
  const win = new EventTarget();
  const doc = new EventTarget();
  doc.visibilityState = "visible";
  const saved = {};
  const set = (key, value) => {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  const location = { href, origin: new URL(href).origin };
  set("addEventListener", win.addEventListener.bind(win));
  set("removeEventListener", win.removeEventListener.bind(win));
  set("location", location);
  set("document", doc);
  set("history", {
    pushState: (_state, _title, url) => {
      location.href = new URL(url, location.href).href;
    },
    replaceState: () => {},
  });
  set("navigator", { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", language: "en-GB" });
  return {
    win,
    doc,
    location,
    restore() {
      for (const [key, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

function fakeEndpoint(status = 202) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response("{}", { status: typeof status === "function" ? status(calls.length) : status });
  };
  return { calls, fetch, events: () => calls.flatMap((c) => c.body.events) };
}

function errorEvent(error, extra = {}) {
  const event = new Event("error");
  Object.assign(event, { error, message: error?.message ?? extra.message ?? "", filename: extra.filename ?? "", lineno: extra.lineno ?? 0, colno: extra.colno ?? 0 });
  return event;
}

function appError(message = "Cannot read properties of undefined (reading 'total')") {
  const error = new TypeError(message);
  error.stack = [
    `TypeError: ${message}`,
    "    at renderTotal (https://shop.example.com/_next/static/chunks/app/cart/page-1a2b.js:1:2345)",
    "    at commitRoot (https://shop.example.com/_next/static/chunks/framework-9f8e.js:1:999)",
    "    at track (https://cdn.analytics.example/widget.js:3:10)",
  ].join("\n");
  return error;
}

test("a crash is sent to the browser endpoint with frames, page, browser and breadcrumbs", async () => {
  const w = fakeWindow();
  const api = fakeEndpoint();
  const client = new BrowserClient({ key: KEY, release: "web@2.1.0", fetch: api.fetch, apiUrl: "https://nex.example.com/api/v1/monitoring" }).install();
  try {
    client.setUser({ id: "u_1", email: "ada@example.com" });
    globalThis.history.pushState({}, "", "/checkout?step=2");
    console.info("loading totals");
    w.win.dispatchEvent(errorEvent(appError()));
    await sleep(20);

    assert.equal(api.calls.length, 1);
    const call = api.calls[0];
    assert.equal(call.url, `https://nex.example.com/api/v1/monitoring/browser/events?key=${KEY}`);
    assert.equal(call.init.headers["content-type"], "text/plain;charset=UTF-8", "a simple request: no CORS preflight");
    assert.equal(call.init.credentials, "omit");
    const [event] = call.body.events;
    assert.equal(event.severity, "ERROR");
    assert.equal(event.handled, false);
    assert.equal(event.release, "web@2.1.0");
    assert.equal(event.exception[0].type, "TypeError");
    assert.equal(event.exception[0].mechanism.type, "onerror");
    const frames = event.exception[0].stacktrace.frames;
    assert.deepEqual(frames.map((f) => f.inApp), [true, false, false], "app code yes; framework and third-party scripts no");
    assert.equal(event.request.url, "https://shop.example.com/checkout", "no query string");
    assert.equal(event.transaction, "/checkout");
    assert.equal(event.contexts.browser.name, "Safari");
    assert.equal(event.contexts.os.name, "macOS");
    assert.equal(event.contexts.runtime.name, "browser");
    assert.equal(event.user.id, "u_1");
    assert.equal(event.sdk.name, "nex-js.browser");
    const crumbs = event.breadcrumbs.map((b) => b.category);
    assert.ok(crumbs.includes("navigation"));
    assert.ok(crumbs.includes("console"));
    assert.ok(!JSON.stringify(event).includes("SECRET"), "query strings never leave the page");
  } finally {
    client.close();
    w.restore();
  }
});

test("unhandled rejections are reported; noise and extension errors are not", async () => {
  const w = fakeWindow();
  const api = fakeEndpoint();
  const client = new BrowserClient({ key: KEY, fetch: api.fetch, ignoreErrors: ["Ignore me"] }).install();
  try {
    const rejection = new Event("unhandledrejection");
    rejection.reason = new Error("payment failed");
    w.win.dispatchEvent(rejection);
    w.win.dispatchEvent(errorEvent(null, { message: "Script error." }));
    w.win.dispatchEvent(errorEvent(new Error("ResizeObserver loop completed with undelivered notifications.")));
    client.captureException(new Error("Ignore me please"));
    const fromExtension = new Error("boom");
    fromExtension.stack = "Error: boom\n    at x (chrome-extension://abc/content.js:1:1)";
    client.captureException(fromExtension);
    w.win.dispatchEvent(new Event("error")); // a broken <img>: no message, no error
    await sleep(20);
    const events = api.events();
    assert.equal(events.length, 1, JSON.stringify(events.map((e) => e.message)));
    assert.equal(events[0].message, "payment failed");
    assert.equal(events[0].exception[0].mechanism.type, "onunhandledrejection");
  } finally {
    client.close();
    w.restore();
  }
});

test("repeats are sent once, and each page has a cap", async () => {
  const w = fakeWindow();
  const api = fakeEndpoint();
  const client = new BrowserClient({ key: KEY, fetch: api.fetch, maxEventsPerPage: 3 });
  try {
    for (let i = 0; i < 5; i++) client.captureException(appError());
    for (let i = 0; i < 10; i++) client.captureMessage(`distinct ${i}`, "error");
    await client.flush();
    assert.equal(api.events().length, 3);
    assert.equal(api.events().filter((e) => e.exception?.[0].type === "TypeError").length, 1);
  } finally {
    w.restore();
  }
});

test("a refused key stops reporting; outages are retried later", async () => {
  const w = fakeWindow();
  try {
    const refused = fakeEndpoint(403);
    const warn = console.warn;
    console.warn = () => {};
    const a = new BrowserClient({ key: KEY, fetch: refused.fetch });
    a.captureMessage("one", "error");
    await a.flush();
    a.captureMessage("two", "error");
    await a.flush();
    console.warn = warn;
    assert.equal(refused.calls.length, 1, "nothing more after a 403");

    const flaky = fakeEndpoint((n) => (n === 1 ? 503 : 202));
    const b = new BrowserClient({ key: KEY, fetch: flaky.fetch });
    b.captureMessage("kept", "error");
    await b.flush();
    assert.equal(flaky.calls.length, 1);
    await b.flush();
    assert.equal(flaky.calls.length, 1, "paused after the outage");
  } finally {
    w.restore();
  }
});

test("secret tokens are refused in the browser, and a bad key makes every call a no-op", () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    const client = new BrowserClient({ key: `nsk_live_${"x".repeat(43)}` });
    assert.equal(client.enabled, false);
    assert.equal(client.captureMessage("x", "error"), false);
    assert.match(warnings[0], /secret SDK token/);
  } finally {
    console.warn = warn;
  }
});

test("hidden pages hand queued events to sendBeacon", async () => {
  const w = fakeWindow();
  const beacons = [];
  globalThis.navigator.sendBeacon = (url, blob) => {
    beacons.push({ url, blob });
    return true;
  };
  const api = fakeEndpoint();
  const client = new BrowserClient({ key: KEY, fetch: api.fetch }).install();
  try {
    client.captureMessage("leaving", "warning");
    w.doc.visibilityState = "hidden";
    w.doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(beacons.length, 1);
    assert.match(beacons[0].url, /\/browser\/events\?key=nex_pub_/);
    const body = JSON.parse(await beacons[0].blob.text());
    assert.equal(body.events[0].message, "leaving");
    await sleep(1_100);
    assert.equal(api.calls.length, 0, "not sent twice");
  } finally {
    client.close();
    w.restore();
  }
});

test("user agents and elements are described without anything typed", () => {
  assert.deepEqual(parseBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.79"), { name: "Edge", version: "129.0.2792.79" });
  assert.deepEqual(parseOs("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)"), { name: "iOS", version: "17.5" });
  const element = {
    tagName: "BUTTON",
    id: "pay",
    className: "btn primary",
    textContent: "  Pay now ",
    getAttribute: (name) => ({ type: "submit" })[name] ?? null,
  };
  assert.equal(describeElement(element), 'button#pay.btn.primary[type="submit"] "Pay now"');
  const input = { tagName: "INPUT", id: "", className: "", textContent: "", value: "4111 1111 1111 1111", getAttribute: (name) => ({ name: "card" })[name] ?? null };
  assert.equal(describeElement(input), 'input[name="card"]');
});

test("requests to the page's own API carry traceparent and become spans; third parties don't", async () => {
  const w = fakeWindow("https://shop.example.com/cart");
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), traceparent: new Headers(init.headers).get("traceparent") });
    return new Response("{}", { status: String(url).includes("/fail") ? 502 : 200 });
  };
  const api = fakeEndpoint();
  const client = new BrowserClient({ key: KEY, fetch: api.fetch, tracesSampleRate: 1, tracePropagationTargets: ["https://api.shop.example.com"] }).install();
  try {
    await globalThis.fetch("https://shop.example.com/api/cart?id=4");
    await globalThis.fetch("https://api.shop.example.com/fail");
    await globalThis.fetch("https://cdn.thirdparty.example/lib.js");
    assert.match(seen[0].traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.match(seen[1].traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.equal(seen[2].traceparent, null, "third parties never get the header");
    await client.flush();
    const spansCall = api.calls.find((c) => c.url.includes("/browser/spans?key="));
    assert.ok(spansCall, "spans go to the browser spans endpoint");
    const spans = spansCall.body.spans;
    assert.equal(spans.length, 2);
    assert.equal(spans[0].name, "GET /api/cart");
    assert.equal(spans[0].traceId, seen[0].traceparent.split("-")[1]);
    assert.equal(spans[0].spanId, seen[0].traceparent.split("-")[2], "the server's parent is this span");
    assert.equal(spans[1].status, "error");
    assert.ok(!JSON.stringify(spans).includes("id=4"), "no query strings");
  } finally {
    client.close();
    globalThis.fetch = realFetch;
    w.restore();
  }
});
