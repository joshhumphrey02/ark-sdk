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
import { redactBounded } from "./redact";
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

/** The SDK's own log lines (`[nerdstack-monitoring] …`) are never recorded. */
export function installConsoleBreadcrumbs(add: Add): () => void {
  const target = console as unknown as Record<string, (...args: unknown[]) => void>;
  const originals: [string, (...args: unknown[]) => void][] = [];
  let recording = false;
  for (const method of Object.keys(CONSOLE_LEVELS)) {
    const original = target[method];
    if (typeof original !== "function") continue;
    originals.push([method, original]);
    target[method] = function (this: unknown, ...args: unknown[]) {
      if (!recording && !(typeof args[0] === "string" && args[0].startsWith("[nerdstack-monitoring]"))) {
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

type Pending = { method: string; url: string; started: number };

function cleanUrl(url: string): string {
  return url.replace(/[?#].*$/, "");
}

/** `skipOrigin`: the monitoring API's own origin, whose calls are not breadcrumbs. */
export function installHttpBreadcrumbs(add: Add, skipOrigin: string | null, now: () => number): () => void {
  const pending = new WeakMap<object, Pending>();
  const finish = (request: object, status: number | undefined, error?: unknown) => {
    const started = pending.get(request);
    if (!started) return;
    pending.delete(request);
    if (skipOrigin && started.url.startsWith(skipOrigin)) return;
    add({
      type: "http",
      category: "http",
      level: error || (status !== undefined && status >= 500) ? "error" : status !== undefined && status >= 400 ? "warning" : "info",
      message: `${started.method} ${started.url}${status !== undefined ? ` → ${status}` : error ? " failed" : ""}`,
      data: {
        method: started.method,
        url: started.url,
        ...(status !== undefined ? { status } : {}),
        durationMs: Math.round(now() - started.started),
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
      },
    });
  };

  const subscriptions: [string, (message: unknown) => void][] = [
    // fetch (undici)
    [
      "undici:request:create",
      (message) => {
        const request = (message as { request?: { origin?: string; method?: string; path?: string } }).request;
        if (request) pending.set(request, { method: (request.method ?? "GET").toUpperCase(), url: cleanUrl(`${request.origin ?? ""}${request.path ?? ""}`), started: now() });
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
    // node:http / node:https clients
    [
      "http.client.request.start",
      (message) => {
        const request = (message as { request?: { method?: string; protocol?: string; host?: string; path?: string } }).request;
        if (request) pending.set(request, { method: (request.method ?? "GET").toUpperCase(), url: cleanUrl(`${request.protocol ?? "http:"}//${request.host ?? ""}${request.path ?? ""}`), started: now() });
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
    for (const [name, handler] of active) {
      try {
        diagnostics.unsubscribe(name, handler);
      } catch {
        // Ignore.
      }
    }
  };
}
