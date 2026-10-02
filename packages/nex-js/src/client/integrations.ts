/**
 * What the browser SDK hooks into. Each installer leaves the page's
 * behaviour unchanged (wrappers call through and re-throw), never throws
 * itself, and returns an uninstall function.
 *
 * - errors: `window` "error" and "unhandledrejection", i.e. crashes;
 * - console: console output as breadcrumbs;
 * - fetch / XHR: method, URL without query, status and duration, as
 *   breadcrumbs (calls to Nex itself are skipped);
 * - navigation: route changes (history API and back/forward), so an error
 *   shows which pages the user came through;
 * - clicks: which element was clicked, described by tag, id, classes and
 *   accessible name, never by what was typed.
 */

import { redactBounded, truncate } from "../shared/redact";
import type { Breadcrumb } from "../shared/context";
import { pageUrl } from "./context";

type Add = (crumb: Breadcrumb) => void;
type Uninstall = () => void;

const noop: Uninstall = () => {};

type WindowLike = {
  addEventListener: (type: string, listener: (event: never) => void, options?: boolean | AddEventListenerOptions) => void;
  removeEventListener: (type: string, listener: (event: never) => void, options?: boolean | EventListenerOptions) => void;
  location?: { href: string };
  history?: History;
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
};

function win(): WindowLike | null {
  const w = globalThis as unknown as Partial<WindowLike>;
  return typeof w.addEventListener === "function" ? (w as WindowLike) : null;
}

function safely(fn: () => void) {
  try {
    fn();
  } catch {
    // Instrumentation never breaks the page.
  }
}

// --- Crashes -----------------------------------------------------------------------------

export type CrashHandlers = {
  onError: (error: unknown, mechanism: string, fallback: { message: string; filename?: string; lineno?: number; colno?: number }) => void;
};

export function installGlobalHandlers(handlers: CrashHandlers): Uninstall {
  const w = win();
  if (!w) return noop;
  const onError = (event: ErrorEvent) =>
    safely(() => {
      // Resource load failures (img, script) also fire "error", without a message.
      if (!event.message && !event.error) return;
      handlers.onError(event.error, "onerror", { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno });
    });
  const onRejection = (event: PromiseRejectionEvent) =>
    safely(() => {
      const reason = event.reason;
      handlers.onError(reason, "onunhandledrejection", { message: reason instanceof Error ? reason.message : `Unhandled promise rejection: ${String(reason)}` });
    });
  w.addEventListener("error", onError as (event: never) => void);
  w.addEventListener("unhandledrejection", onRejection as (event: never) => void);
  return () => {
    w.removeEventListener("error", onError as (event: never) => void);
    w.removeEventListener("unhandledrejection", onRejection as (event: never) => void);
  };
}

// --- Console -----------------------------------------------------------------------------

const LEVELS = { debug: "debug", log: "info", info: "info", warn: "warning", error: "error" } as const;

export function installConsole(add: Add): Uninstall {
  const target = console as unknown as Record<string, (...args: unknown[]) => void>;
  const originals: [string, (...args: unknown[]) => void][] = [];
  for (const method of Object.keys(LEVELS) as (keyof typeof LEVELS)[]) {
    const original = target[method];
    if (typeof original !== "function") continue;
    originals.push([method, original]);
    target[method] = function (this: unknown, ...args: unknown[]) {
      if (!(typeof args[0] === "string" && args[0].startsWith("[nex]"))) {
        safely(() =>
          add({
            category: "console",
            level: LEVELS[method],
            message: redactBounded(
              args
                .map((arg) => {
                  if (typeof arg === "string") return arg;
                  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
                  try {
                    return JSON.stringify(arg) ?? String(arg);
                  } catch {
                    return String(arg);
                  }
                })
                .join(" "),
              500,
            ),
          }),
        );
      }
      return original.apply(this, args);
    };
  }
  return () => {
    for (const [method, original] of originals) target[method] = original;
  };
}

// --- Network -----------------------------------------------------------------------------

function cleanUrl(url: string): string {
  try {
    const base = (globalThis as { location?: { href: string } }).location?.href;
    const parsed = new URL(url, base);
    return truncate(`${parsed.origin}${parsed.pathname}`, 1_000);
  } catch {
    return truncate(url.replace(/[?#].*$/, ""), 1_000);
  }
}

function httpCrumb(method: string, url: string, status: number | undefined, durationMs: number, error?: unknown): Breadcrumb {
  return {
    type: "http",
    category: "fetch",
    level: error || (status !== undefined && (status >= 500 || status === 0)) ? "error" : status !== undefined && status >= 400 ? "warning" : "info",
    message: `${method} ${url}${status !== undefined ? ` → ${status}` : " failed"}`,
    data: { method, url, ...(status !== undefined ? { status } : {}), durationMs: Math.round(durationMs), ...(error ? { error: String((error as Error)?.message ?? error) } : {}) },
  };
}

export function installFetch(add: Add, skip: (url: string) => boolean): Uninstall {
  const w = win();
  const original = w?.fetch;
  if (!w || typeof original !== "function") return noop;
  const wrapped = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    let method = "GET";
    let url = "";
    safely(() => {
      method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
      url = cleanUrl(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    });
    const started = performance.now();
    const promise = original.call(this ?? w, input as RequestInfo, init);
    if (!url || skip(url)) return promise;
    return promise.then(
      (response) => {
        safely(() => add(httpCrumb(method, url, response.status, performance.now() - started)));
        return response;
      },
      (error: unknown) => {
        safely(() => add(httpCrumb(method, url, undefined, performance.now() - started, error)));
        throw error;
      },
    );
  } as typeof fetch;
  w.fetch = wrapped;
  return () => {
    if (w.fetch === wrapped) w.fetch = original;
  };
}

const XHR_INFO = Symbol("nex.xhr");
type XhrInfo = { method: string; url: string; started: number };

export function installXhr(add: Add, skip: (url: string) => boolean): Uninstall {
  const Xhr = win()?.XMLHttpRequest;
  if (!Xhr?.prototype) return noop;
  const proto = Xhr.prototype as XMLHttpRequest & { [XHR_INFO]?: XhrInfo };
  const open = proto.open;
  const send = proto.send;
  proto.open = function (this: XMLHttpRequest & { [XHR_INFO]?: XhrInfo }, method: string, url: string | URL, ...rest: unknown[]) {
    safely(() => {
      this[XHR_INFO] = { method: String(method).toUpperCase(), url: cleanUrl(String(url)), started: 0 };
    });
    return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;
  proto.send = function (this: XMLHttpRequest & { [XHR_INFO]?: XhrInfo }, body?: Document | XMLHttpRequestBodyInit | null) {
    safely(() => {
      const info = this[XHR_INFO];
      if (!info || skip(info.url)) return;
      info.started = performance.now();
      this.addEventListener("loadend", () =>
        safely(() => add(httpCrumb(info.method, info.url, this.status, performance.now() - info.started, this.status === 0 ? "network error" : undefined))),
      );
    });
    return send.call(this, body);
  };
  return () => {
    proto.open = open;
    proto.send = send;
  };
}

// --- Navigation --------------------------------------------------------------------------

export function installNavigation(add: Add, onChange: (url: string) => void): Uninstall {
  const w = win();
  const history = w?.history;
  if (!w || !history || !w.location) return noop;
  let last = pageUrl(w.location.href);
  const changed = () =>
    safely(() => {
      const to = pageUrl(w.location!.href);
      if (to === last) return;
      add({ type: "navigation", category: "navigation", message: `${last} → ${to}`, data: { from: last, to } });
      last = to;
      onChange(to);
    });
  const push = history.pushState;
  const replace = history.replaceState;
  history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
    const result = push.apply(this, args);
    changed();
    return result;
  };
  history.replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
    const result = replace.apply(this, args);
    changed();
    return result;
  };
  w.addEventListener("popstate", changed);
  return () => {
    history.pushState = push;
    history.replaceState = replace;
    w.removeEventListener("popstate", changed);
  };
}

// --- Clicks ------------------------------------------------------------------------------

/** "button#save.btn.primary "Save order"": enough to find it, nothing typed. */
export function describeElement(element: Element | null): string {
  if (!element) return "(unknown)";
  const parts: string[] = [element.tagName.toLowerCase()];
  if (element.id) parts.push(`#${element.id}`);
  const classes = typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
  for (const cls of classes) parts.push(`.${cls}`);
  for (const attr of ["data-testid", "name", "type", "role"]) {
    const value = element.getAttribute(attr);
    if (value) parts.push(`[${attr}="${truncate(value, 40)}"]`);
  }
  // A label, never a value: aria-label, title, or a button/link's own text.
  const label =
    element.getAttribute("aria-label") ??
    element.getAttribute("title") ??
    (/^(button|a)$/i.test(element.tagName) ? element.textContent?.trim().replace(/\s+/g, " ") : null);
  return truncate(`${parts.join("")}${label ? ` "${truncate(label, 60)}"` : ""}`, 200);
}

export function installClicks(add: Add): Uninstall {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return noop;
  let lastTarget: EventTarget | null = null;
  let lastAt = 0;
  const onClick = (event: MouseEvent) =>
    safely(() => {
      // One breadcrumb per element per burst of clicks.
      const now = performance.now();
      if (event.target === lastTarget && now - lastAt < 1_000) return;
      lastTarget = event.target;
      lastAt = now;
      const element = event.target instanceof Element ? (event.target.closest("button, a, [role=button], input, select, label, [data-testid]") ?? event.target) : null;
      add({ category: "ui.click", message: describeElement(element) });
    });
  doc.addEventListener("click", onClick, { capture: true, passive: true });
  return () => doc.removeEventListener("click", onClick, { capture: true });
}
