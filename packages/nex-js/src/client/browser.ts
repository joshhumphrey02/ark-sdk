/**
 * Nex in the browser. Reports crashes and errors from web apps with the
 * page, browser, user and the trail of clicks, navigations, requests and
 * console output that led to them.
 *
 * It authenticates with a **browser key** (`nex_pub_…`), which is public by
 * design: it can only send error events for one application environment's
 * frontend service, only from the origins allowed for it, and never read
 * anything. Secret SDK tokens (`nsk_…`) are refused here, so one can't end
 * up in a bundle by mistake.
 *
 * The rules match the server SDK: nothing here throws into the page,
 * delivery is batched and bounded, and whatever leaves the page is redacted
 * first.
 */

import { browserContexts, pageUrl } from "./context";
import { installClicks, installConsole, installFetch, installGlobalHandlers, installNavigation, installXhr } from "./integrations";
import { isErrorLike, normalizeError } from "../shared/errors";
import { activeTrace } from "../shared/otel";
import { boundMetadata, byteLength, redact, redactBounded, truncate } from "../shared/redact";
import { exceptionChain, type InAppTest } from "../shared/stacktrace";
import type { Breadcrumb, MonitoringUser } from "../shared/context";
import type { EventPayload, JsonObject, MonitoringLevel, MonitoringSeverity } from "../shared/types";

export const SDK_NAME = "nex-js.browser";
export const SDK_VERSION = "0.3.0";
export const DEFAULT_API_URL = "https://nerdstackgrp.com/api/v1/monitoring";
export const KEY_PATTERN = /^nex_pub_[A-Za-z0-9_-]{24,64}$/;

const MAX_BREADCRUMBS = 50;
const MAX_QUEUE = 30;
const MAX_BATCH = 10;
/** Browsers cap keepalive request bodies at 64KB in total. */
const KEEPALIVE_BYTES = 60_000;
const FLUSH_DELAY_MS = 1_000;
const BASE_PAUSE_MS = 10_000;

/** Errors with no information, or that browsers raise for harmless reasons. */
const DEFAULT_IGNORE: (string | RegExp)[] = [
  /^Script error\.?$/,
  /ResizeObserver loop (limit exceeded|completed with undelivered notifications)/,
  /^Non-Error promise rejection captured with value: (undefined|null)$/,
];

/** Extensions and browser internals are never the application's code. */
const NOT_IN_APP_URL = /^(chrome|moz|safari(-web)?|ms-browser)-extension:|^(webkit-masked-url|native|<anonymous>)|\/node_modules\/|\/_next\/static\/chunks\/(framework|main|main-app|webpack|polyfills)[-.]/;

export type BrowserOptions = {
  /** The browser key from Nex (`nex_pub_…`): Application → SDK keys → Browser. */
  key?: string;
  /** Default `https://nerdstackgrp.com/api/v1/monitoring`. */
  apiUrl?: string;
  /** The web app's version, e.g. `process.env.NEXT_PUBLIC_APP_VERSION`. Nex shows which releases an issue happened in. */
  release?: string;
  /** `false` turns everything into a no-op, e.g. in development. */
  enabled?: boolean;
  /** Share of errors sent, 0..1. Default 1. */
  sampleRate?: number;
  /** Messages (exact text or pattern) never reported. Added to the defaults (`Script error.`, ResizeObserver noise). */
  ignoreErrors?: (string | RegExp)[];
  /** Only report errors whose top frame comes from these scripts. */
  allowUrls?: (string | RegExp)[];
  /** Never report errors whose top frame comes from these scripts (ads, widgets). */
  denyUrls?: (string | RegExp)[];
  /** Origins that serve your own scripts besides the page's (a CDN). Their frames count as your code. */
  appOrigins?: string[];
  /** Change or drop (`null`) an event before it is sent. */
  beforeSend?: (event: EventPayload) => EventPayload | null;
  /** Errors reported per page load, at most. Default 100. */
  maxEventsPerPage?: number;
  /** Turn individual integrations off. All default true. */
  integrations?: { errors?: boolean; console?: boolean; fetch?: boolean; xhr?: boolean; navigation?: boolean; clicks?: boolean };
  /** Log what the SDK does to the console. */
  debug?: boolean;
  /** Custom fetch (tests). */
  fetch?: typeof fetch;
};

export type BrowserCaptureOptions = {
  level?: MonitoringLevel;
  tags?: Record<string, string | number | boolean>;
  /** Extra data shown with the event. Redacted and size-bounded. */
  extra?: Record<string, unknown>;
  fingerprint?: string[];
  /** How it was caught, e.g. "react.errorBoundary". */
  mechanism?: string;
  /** False marks a crash. Default true. */
  handled?: boolean;
};

type CaptureInput = {
  type: EventPayload["type"];
  level: MonitoringLevel;
  message: string;
  error?: { name?: string; message?: string; stack?: string };
  exception?: EventPayload["exception"];
  handled?: boolean;
  options: BrowserCaptureOptions;
};

const SEVERITY: Record<MonitoringLevel, MonitoringSeverity> = { info: "INFO", warning: "WARNING", error: "ERROR", critical: "CRITICAL" };

function matches(value: string, rules: (string | RegExp)[]): boolean {
  return rules.some((rule) => (typeof rule === "string" ? value.includes(rule) : rule.test(value)));
}

function location(): { href: string; origin: string } | null {
  const loc = (globalThis as { location?: { href?: string; origin?: string } }).location;
  return loc?.href && loc.origin ? { href: loc.href, origin: loc.origin } : null;
}

export class BrowserClient {
  readonly #options: BrowserOptions;
  readonly #enabled: boolean;
  readonly #endpoint: string;
  readonly #ignore: (string | RegExp)[];
  readonly #inApp: InAppTest;
  #user: MonitoringUser | null = null;
  #tags: Record<string, string> = {};
  #breadcrumbs: Breadcrumb[] = [];
  #queue: EventPayload[] = [];
  #sent = 0;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #sending = false;
  #pausedUntil = 0;
  #pause = BASE_PAUSE_MS;
  #stopped = false;
  #recent = new Map<string, number>();
  #reported = new WeakSet<object>();
  #uninstall: (() => void)[] = [];
  #transaction: string | null = null;

  constructor(options: BrowserOptions = {}) {
    this.#options = options;
    const key = options.key?.trim() ?? "";
    const problems: string[] = [];
    if (/^nsk_(live|test)_/.test(key)) problems.push("that is a secret SDK token (nsk_…); browsers use a browser key (nex_pub_…) from Nex");
    else if (!KEY_PATTERN.test(key)) problems.push("key must be a Nex browser key (nex_pub_…)");
    const apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, "");
    if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(`${apiUrl}/`)) problems.push("apiUrl must use https (http only for localhost)");
    this.#enabled = options.enabled !== false && problems.length === 0;
    if (options.enabled !== false && problems.length) console.warn(`[nex] Not reporting: ${problems.join("; ")}.`);
    this.#endpoint = `${apiUrl}/browser/events?key=${encodeURIComponent(key)}`;
    this.#ignore = [...DEFAULT_IGNORE, ...(options.ignoreErrors ?? [])];
    const appOrigins = options.appOrigins ?? [];
    this.#inApp = (filename) => {
      if (NOT_IN_APP_URL.test(filename)) return false;
      const page = location();
      if (!/^[a-z]+:\/\//i.test(filename)) return true;
      return (page !== null && filename.startsWith(page.origin)) || appOrigins.some((origin) => filename.startsWith(origin));
    };
  }

  get enabled(): boolean {
    return this.#enabled;
  }

  /** Installs the integrations. Called by `init()`. */
  install(): this {
    if (!this.#enabled || this.#uninstall.length) return this;
    const on = { errors: true, console: true, fetch: true, xhr: true, navigation: true, clicks: true, ...this.#options.integrations };
    const add = (crumb: Breadcrumb) => this.addBreadcrumb(crumb);
    const apiOrigin = this.#endpoint.replace(/^(https?:\/\/[^/]+).*$/, "$1");
    const skip = (url: string) => url.startsWith(apiOrigin) && url.includes("/browser/events");
    try {
      if (on.errors) {
        this.#uninstall.push(
          installGlobalHandlers({
            onError: (error, mechanism, fallback) => {
              if (isErrorLike(error)) this.captureException(error, { mechanism, handled: false });
              else this.#captureUnknown(error, mechanism, fallback);
            },
          }),
        );
      }
      if (on.console) this.#uninstall.push(installConsole(add));
      if (on.fetch) this.#uninstall.push(installFetch(add, skip));
      if (on.xhr) this.#uninstall.push(installXhr(add, skip));
      if (on.navigation) this.#uninstall.push(installNavigation(add, () => {}));
      if (on.clicks) this.#uninstall.push(installClicks(add));
      this.#installFlushOnHide();
    } catch {
      // A missing browser API costs that integration, not the page.
    }
    this.#debug("installed");
    return this;
  }

  /** Removes every integration and sends what is queued. */
  close(): void {
    for (const uninstall of this.#uninstall.splice(0)) uninstall();
    void this.flush();
  }

  // --- Context --------------------------------------------------------------------------

  /** Who is using the page. Nex counts users per issue. `null` on sign-out. */
  setUser(user: MonitoringUser | null): void {
    this.#user = user ? { ...user } : null;
  }

  setTag(key: string, value: string | number | boolean): void {
    this.#tags[String(key)] = String(value);
  }

  setTags(tags: Record<string, string | number | boolean>): void {
    for (const [key, value] of Object.entries(tags)) this.setTag(key, value);
  }

  /** Names the current screen, e.g. a route template: "/orders/[id]". */
  setTransaction(name: string | null): void {
    this.#transaction = name;
  }

  addBreadcrumb(crumb: Breadcrumb): void {
    if (!this.#enabled) return;
    this.#breadcrumbs.push({ ...crumb, timestamp: crumb.timestamp ?? new Date().toISOString() });
    if (this.#breadcrumbs.length > MAX_BREADCRUMBS) this.#breadcrumbs.splice(0, this.#breadcrumbs.length - MAX_BREADCRUMBS);
  }

  // --- Capture ----------------------------------------------------------------------------

  captureException(error: unknown, options: BrowserCaptureOptions = {}): boolean {
    if (typeof error === "object" && error !== null && this.#reported.has(error)) return false;
    const normalized = normalizeError(error);
    const handled = options.handled ?? true;
    const queued = this.#capture({
      type: "exception",
      level: options.level ?? "error",
      message: normalized.message || normalized.name,
      error: normalized,
      exception: exceptionChain(error, { type: options.mechanism ?? "manual", handled }, this.#inApp),
      handled,
      options,
    });
    if (queued && typeof error === "object" && error !== null) this.#reported.add(error);
    return queued;
  }

  captureMessage(message: string, level: MonitoringLevel = "info", options: Omit<BrowserCaptureOptions, "level"> = {}): boolean {
    return this.#capture({ type: level === "warning" ? "warning" : level === "info" ? "message" : "error", level, message: String(message), options });
  }

  /** `window.onerror` without an Error object (a thrown string, a cross-origin script). */
  #captureUnknown(value: unknown, mechanism: string, fallback: { message: string; filename?: string; lineno?: number; colno?: number }) {
    const message = value === undefined || value === null ? fallback.message : typeof value === "string" ? value : fallback.message || String(value);
    const frames = fallback.filename ? [{ filename: truncate(fallback.filename.replace(/[?#].*$/, ""), 500), lineno: fallback.lineno, colno: fallback.colno, inApp: this.#inApp(fallback.filename) }] : [];
    this.#capture({
      type: "exception",
      level: "error",
      message: message || "Unknown error",
      error: { name: "Error", message: redactBounded(message || "Unknown error", 4_000) },
      exception: [{ type: "Error", value: redactBounded(message || "Unknown error", 4_000), mechanism: { type: mechanism, handled: false }, ...(frames.length ? { stacktrace: { frames } } : {}) }],
      handled: false,
      options: {},
    });
  }

  #capture(input: CaptureInput): boolean {
    if (!this.#enabled || this.#stopped) return false;
    try {
      if (matches(input.message, this.#ignore) || (input.error?.message && matches(`${input.error.name}: ${input.error.message}`, this.#ignore))) return false;
      const top = input.exception?.[0]?.stacktrace?.frames[0]?.filename;
      if (top && this.#options.denyUrls && matches(top, this.#options.denyUrls)) return false;
      if (top && this.#options.allowUrls?.length && !matches(top, this.#options.allowUrls)) return false;
      // Every frame from an extension: not this app's error.
      const frames = input.exception?.[0]?.stacktrace?.frames ?? [];
      if (frames.length && frames.every((f) => /-extension:/.test(f.filename ?? ""))) return false;
      const rate = this.#options.sampleRate ?? 1;
      if (rate < 1 && Math.random() >= rate) return false;
      if (this.#sent + this.#queue.length >= (this.#options.maxEventsPerPage ?? 100)) return false;

      const dedupe = `${input.type}|${input.message}|${frames[0]?.filename ?? ""}:${frames[0]?.lineno ?? ""}`;
      const now = Date.now();
      const last = this.#recent.get(dedupe);
      if (last !== undefined && now - last < 2_000) return false;
      this.#recent.set(dedupe, now);
      if (this.#recent.size > 100) this.#recent.clear();

      let payload: EventPayload | null = this.#toPayload(input);
      if (this.#options.beforeSend) {
        try {
          payload = this.#options.beforeSend(payload);
        } catch {
          // A broken hook keeps the event as it was.
        }
        if (!payload) return false;
      }
      this.#queue.push(payload);
      if (this.#queue.length > MAX_QUEUE) this.#queue.shift();
      this.#schedule(input.handled === false ? 0 : FLUSH_DELAY_MS);
      this.#debug(`queued ${payload.type}: ${payload.message}`);
      return true;
    } catch {
      return false;
    }
  }

  #toPayload(input: CaptureInput): EventPayload {
    const page = location();
    const tags: Record<string, string> = { ...this.#tags };
    for (const [key, value] of Object.entries(input.options.tags ?? {})) tags[key] = String(value);
    const agent = (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent;
    const url = page ? pageUrl(page.href) : undefined;
    const extra = input.options.extra ? boundMetadata(input.options.extra, { maxBytes: 8_000 }) : undefined;
    const trace = activeTrace();
    return {
      type: input.type,
      severity: SEVERITY[input.level] ?? "ERROR",
      message: redactBounded(input.message || input.type, 2_000),
      ...(this.#options.release ? { release: truncate(this.#options.release, 64) } : {}),
      ...(input.error
        ? {
            error: {
              ...(input.error.name ? { name: truncate(input.error.name, 200) } : {}),
              ...(input.error.message ? { message: redactBounded(input.error.message, 4_000) } : {}),
              ...(input.error.stack ? { stack: redactBounded(input.error.stack, 16_000) } : {}),
            },
          }
        : {}),
      ...(extra ? { metadata: extra } : {}),
      timestamp: new Date().toISOString(),
      ...(input.exception?.length ? { exception: input.exception } : {}),
      ...(input.handled !== undefined ? { handled: input.handled } : {}),
      ...(input.options.fingerprint?.length ? { fingerprint: input.options.fingerprint.map((part) => truncate(String(part), 200)) } : {}),
      ...(this.#breadcrumbs.length
        ? {
            breadcrumbs: this.#breadcrumbs.map((crumb) => ({
              ...(crumb.timestamp ? { timestamp: crumb.timestamp } : {}),
              ...(crumb.type ? { type: crumb.type } : {}),
              ...(crumb.category ? { category: crumb.category } : {}),
              ...(crumb.level ? { level: crumb.level } : {}),
              ...(crumb.message ? { message: redactBounded(crumb.message, 1_000) } : {}),
              ...(crumb.data ? { data: boundMetadata(crumb.data, { maxBytes: 2_000 }) } : {}),
            })),
          }
        : {}),
      ...(url ? { request: { method: "GET", url, ...(agent ? { userAgent: truncate(agent, 500) } : {}) } } : {}),
      ...(this.#user
        ? {
            user: {
              ...(this.#user.id !== undefined ? { id: truncate(String(this.#user.id), 200) } : {}),
              ...(this.#user.username ? { username: truncate(this.#user.username, 200) } : {}),
              ...(this.#user.email ? { email: truncate(this.#user.email, 320) } : {}),
            },
          }
        : {}),
      ...(Object.keys(tags).length ? { tags: redact(tags) as Record<string, string> } : {}),
      ...(this.#transaction ? { transaction: truncate(this.#transaction, 300) } : url ? { transaction: truncate(new URL(url).pathname, 300) } : {}),
      ...(trace ? trace : {}),
      contexts: browserContexts() as JsonObject,
      sdk: { name: SDK_NAME, version: SDK_VERSION },
    };
  }

  // --- Delivery ---------------------------------------------------------------------------

  #schedule(delay: number) {
    if (this.#timer) {
      if (delay > 0) return;
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, Math.max(delay, this.#pausedUntil - Date.now(), 0));
  }

  /** Sends what is queued. Resolves when done (or given up for now). */
  async flush(): Promise<void> {
    if (this.#sending || !this.#queue.length || this.#stopped) return;
    if (Date.now() < this.#pausedUntil) return this.#schedule(0);
    this.#sending = true;
    try {
      while (this.#queue.length && !this.#stopped) {
        const batch = this.#queue.slice(0, MAX_BATCH);
        const body = JSON.stringify({ events: batch });
        const status = await this.#post(body);
        if (status !== null && status < 300) {
          this.#queue.splice(0, batch.length);
          this.#sent += batch.length;
          this.#pause = BASE_PAUSE_MS;
          continue;
        }
        if (status === 401 || status === 403) {
          // Wrong key, or this origin isn't allowed for it: stop for this page.
          this.#stopped = true;
          this.#queue = [];
          console.warn(`[nex] The browser key was refused (${status}). Check the key and its allowed origins in Nex.`);
        } else if (status === 400 || status === 413 || status === 422) {
          this.#queue.splice(0, batch.length);
        } else {
          // Offline, 429 or 5xx: try again later, with backoff.
          this.#pausedUntil = Date.now() + this.#pause;
          this.#pause = Math.min(this.#pause * 2, 5 * 60_000);
          this.#schedule(0);
        }
        break;
      }
    } finally {
      this.#sending = false;
    }
  }

  async #post(body: string): Promise<number | null> {
    const doFetch = this.#options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!doFetch) return null;
    try {
      // text/plain keeps this a "simple" CORS request: no preflight per batch.
      const response = await doFetch(this.#endpoint, {
        method: "POST",
        body,
        headers: { "content-type": "text/plain;charset=UTF-8" },
        keepalive: byteLength(body) < KEEPALIVE_BYTES,
        credentials: "omit",
      });
      this.#debug(`sent → ${response.status}`);
      return response.status;
    } catch {
      return null;
    }
  }

  /** When the page is hidden or closed, hand what is queued to the browser to deliver. */
  #installFlushOnHide() {
    const doc = (globalThis as { document?: Document }).document;
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (!doc || typeof nav?.sendBeacon !== "function") return;
    const onHide = () => {
      if (doc.visibilityState !== "hidden" || !this.#queue.length || this.#stopped) return;
      try {
        const batch = this.#queue.slice(0, MAX_BATCH);
        const body = JSON.stringify({ events: batch });
        if (byteLength(body) < KEEPALIVE_BYTES && nav.sendBeacon(this.#endpoint, new Blob([body], { type: "text/plain;charset=UTF-8" }))) {
          this.#queue.splice(0, batch.length);
          this.#sent += batch.length;
        }
      } catch {
        // The page is going away; nothing more to do.
      }
    };
    doc.addEventListener("visibilitychange", onHide);
    this.#uninstall.push(() => doc.removeEventListener("visibilitychange", onHide));
  }

  #debug(message: string) {
    if (this.#options.debug) console.debug(`[nex] ${message}`);
  }

  /** Never serialise the key. */
  toJSON() {
    return { enabled: this.#enabled, release: this.#options.release ?? null };
  }
}
