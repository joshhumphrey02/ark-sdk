/**
 * Automatic breadcrumbs: what the application logged and which HTTP calls it
 * made just before an error. They answer "what led to this?" without anyone
 * adding logging first.
 *
 * - console: `console.log/info/warn/error/debug` are wrapped to also leave a
 *   breadcrumb. Output is unchanged.
 * - http: outgoing `fetch` (undici) and `node:http` requests, from Node's
 *   diagnostics channels (no monkey-patching): method, URL without its query,
 *   status and duration. Calls to the monitoring API itself are skipped.
 *
 * Each installer returns an uninstall function.
 */

import diagnostics from "node:diagnostics_channel";
import { redactBounded } from "../shared/redact";
import type { Breadcrumb, BreadcrumbLevel } from "./scope";

type Add = (crumb: Breadcrumb) => void;

const CONSOLE_LEVELS: Record<string, BreadcrumbLevel> = { debug: "debug", log: "info", info: "info", warn: "warning", error: "error" };

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg) ?? String(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

/** The SDK's own log lines (`[nex] …`) are never recorded. */
export function installConsoleBreadcrumbs(add: Add): () => void {
  const target = console as unknown as Record<string, (...args: unknown[]) => void>;
  const originals: [string, (...args: unknown[]) => void][] = [];
  let recording = false;
  for (const method of Object.keys(CONSOLE_LEVELS)) {
    const original = target[method];
    if (typeof original !== "function") continue;
    originals.push([method, original]);
    target[method] = function (this: unknown, ...args: unknown[]) {
      if (!recording && !(typeof args[0] === "string" && args[0].startsWith("[nex]"))) {
        recording = true;
        try {
          add({ type: "default", category: "console", level: CONSOLE_LEVELS[method], message: redactBounded(formatArgs(args), 500) });
        } catch {
          // Never break logging.
        } finally {
          recording = false;
        }
      }
      return original.apply(this, args);
    };
  }
  return () => {
    for (const [method, original] of originals) target[method] = original;
  };
}

/** What tracing wants from an outgoing call: a header to send, and to hear when it ends. */
export type OutgoingHooks = { traceparent?: string; finish?: (status: number | undefined, error?: unknown) => void };
export type OnOutgoingStart = (method: string, url: string) => OutgoingHooks | null;

type Pending = { method: string; url: string; started: number; hooks: OutgoingHooks | null };

/** One finished outgoing request. `url` has no query string or fragment. */
export type OutgoingCall = { method: string; url: string; status?: number; durationMs: number; error?: unknown };

function cleanUrl(url: string): string {
  return url.replace(/[?#].*$/, "");
}

/** The breadcrumb for an outgoing call. */
export function callBreadcrumb(call: OutgoingCall): Breadcrumb {
  const { method, url, status, error } = call;
  return {
    type: "http",
    category: "http",
    level: error || (status !== undefined && status >= 500) ? "error" : status !== undefined && status >= 400 ? "warning" : "info",
    message: `${method} ${url}${status !== undefined ? ` → ${status}` : error ? " failed" : ""}`,
    data: {
      method,
      url,
      ...(status !== undefined ? { status } : {}),
      durationMs: Math.round(call.durationMs),
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    },
  };
}

/**
 * Observes outgoing `fetch` (undici) and `node:http` requests through Node's
 * diagnostics channels: no monkey-patching, nothing changes for the request.
 * `skipOrigin`: the Nex API's own origin, whose calls are not reported.
 */
export function installHttpObserver(onCall: (call: OutgoingCall) => void, skipOrigin: string | null, now: () => number, onStart?: OnOutgoingStart): () => void {
  const pending = new WeakMap<object, Pending>();
  const begin = (method: string, url: string): Pending => {
    const own = Boolean(skipOrigin && url.startsWith(skipOrigin));
    let hooks: OutgoingHooks | null = null;
    try {
      hooks = own || !onStart ? null : onStart(method, url);
    } catch {
      hooks = null;
    }
    return { method, url, started: now(), hooks };
  };
  const finish = (request: object, status: number | undefined, error?: unknown) => {
    const started = pending.get(request);
    if (!started) return;
    pending.delete(request);
    if (skipOrigin && started.url.startsWith(skipOrigin)) return;
    try {
      started.hooks?.finish?.(status, error);
    } catch {
      // Never break the request.
    }
    onCall({ method: started.method, url: started.url, status, durationMs: now() - started.started, ...(error ? { error } : {}) });
  };
  type NodeRequest = { method?: string; protocol?: string; host?: string; path?: string; headersSent?: boolean; setHeader?: (name: string, value: string) => void };
  const nodeStart = (request: NodeRequest) => {
    if (pending.has(request)) return;
    const entry = begin((request.method ?? "GET").toUpperCase(), cleanUrl(`${request.protocol ?? "http:"}//${request.host ?? ""}${request.path ?? ""}`));
    if (entry.hooks?.traceparent && !request.headersSent) request.setHeader?.("traceparent", entry.hooks.traceparent);
    pending.set(request, entry);
  };

  const subscriptions: [string, (message: unknown) => void][] = [
    // fetch (undici)
    [
      "undici:request:create",
      (message) => {
        const request = (message as { request?: { origin?: string; method?: string; path?: string; addHeader?: (name: string, value: string) => void } }).request;
        if (!request) return;
        const entry = begin((request.method ?? "GET").toUpperCase(), cleanUrl(`${request.origin ?? ""}${request.path ?? ""}`));
        if (entry.hooks?.traceparent) request.addHeader?.("traceparent", entry.hooks.traceparent);
        pending.set(request, entry);
      },
    ],
    [
      "undici:request:headers",
      (message) => {
        const { request, response } = message as { request?: object; response?: { statusCode?: number } };
        if (request) finish(request, response?.statusCode);
      },
    ],
    [
      "undici:request:error",
      (message) => {
        const { request, error } = message as { request?: object; error?: unknown };
        if (request) finish(request, undefined, error ?? "error");
      },
    ],
    // node:http / node:https clients. "created" comes before the headers are
    // sent (so the trace header can still be added); "start" on older Nodes.
    [
      "http.client.request.created",
      (message) => {
        const request = (message as { request?: NodeRequest }).request;
        if (request) nodeStart(request);
      },
    ],
    [
      "http.client.request.start",
      (message) => {
        const request = (message as { request?: NodeRequest }).request;
        if (request) nodeStart(request);
      },
    ],
    [
      "http.client.request.error",
      (message) => {
        const { request, error } = message as { request?: object; error?: unknown };
        if (request) finish(request, undefined, error ?? "error");
      },
    ],
    [
      "http.client.response.finish",
      (message) => {
        const { request, response } = message as { request?: object; response?: { statusCode?: number } };
        if (request) finish(request, response?.statusCode);
      },
    ],
  ];

  // Bun doesn't publish these channels: observe its fetch by wrapping it instead.
  const uninstallBunFetch = (globalThis as { process?: { versions?: { bun?: string } } }).process?.versions?.bun ? wrapFetch(onCall, skipOrigin, now, onStart) : () => {};

  const active: [string, (message: unknown) => void][] = [];
  for (const [name, handler] of subscriptions) {
    const safe = (message: unknown) => {
      try {
        handler(message);
      } catch {
        // Never break the request.
      }
    };
    try {
      diagnostics.subscribe(name, safe);
      active.push([name, safe]);
    } catch {
      // Channel API unavailable on this runtime: no HTTP breadcrumbs.
    }
  }
  return () => {
    uninstallBunFetch();
    for (const [name, handler] of active) {
      try {
        diagnostics.unsubscribe(name, handler);
      } catch {
        // Ignore.
      }
    }
  };
}

/** Times `globalThis.fetch` calls; the response and errors pass through untouched. */
function wrapFetch(onCall: (call: OutgoingCall) => void, skipOrigin: string | null, now: () => number, onStart?: OnOutgoingStart): () => void {
  const original = globalThis.fetch;
  if (typeof original !== "function") return () => {};
  const wrapped = Object.assign(
    function (this: unknown, input: string | URL | Request, init?: RequestInit) {
      let method = "GET";
      let url = "";
      try {
        method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        url = cleanUrl(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      } catch {
        // Unreadable input: call through unobserved.
      }
      const started = now();
      const own = !url || Boolean(skipOrigin && url.startsWith(skipOrigin));
      let hooks: OutgoingHooks | null = null;
      let nextInit = init;
      if (!own && onStart) {
        try {
          hooks = onStart(method, url);
          if (hooks?.traceparent) {
            const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
            headers.set("traceparent", hooks.traceparent);
            nextInit = { ...init, headers };
          }
        } catch {
          hooks = null;
          nextInit = init;
        }
      }
      const promise = original.call(this, input, nextInit);
      if (own) return promise;
      const report = (status: number | undefined, error?: unknown) => {
        try {
          hooks?.finish?.(status, error);
          onCall({ method, url, status, durationMs: now() - started, ...(error ? { error } : {}) });
        } catch {
          // Never break the request.
        }
      };
      return promise.then(
        (response) => {
          report(response.status);
          return response;
        },
        (error: unknown) => {
          report(undefined, error ?? "error");
          throw error;
        },
      );
    },
    original,
  ) as typeof fetch;
  globalThis.fetch = wrapped;
  return () => {
    if (globalThis.fetch === wrapped) globalThis.fetch = original;
  };
}
