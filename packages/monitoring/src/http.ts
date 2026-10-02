/**
 * Opt-in HTTP instrumentation without framework dependencies.
 *
 * What is recorded per request: method, route, status, duration, and whether
 * it failed. Never headers, bodies, query strings, cookies or client IPs.
 * Recording is a timestamp and a map update, so the overhead is negligible.
 *
 * What is sent:
 * - 5xx responses and thrown handler errors, as `error` events (at most one
 *   per route + status per `eventWindow`, so an error storm is one event);
 * - requests slower than `slowRequestMs`, as `performance` warnings (same limit);
 * - a per-route summary every `summaryInterval`, as one `performance` event.
 *
 * Three entry points cover the common runtimes:
 * - `instrumentHttp(server)` for any `node:http` server (Node, Express's
 *   `app.listen()`, Fastify's `fastify.server`, Koa, Bun's node:http);
 * - `httpMiddleware()` for Connect/Express-style middleware chains;
 * - `wrapFetchHandler(fn)` for `(Request) => Response` handlers (Bun.serve,
 *   Elysia, Hono, Next.js route handlers).
 */

import type { MonitoringEventType } from "./types";

export type HttpInstrumentationOptions = {
  /** Map a request to a low-cardinality route. Default: framework route when known, else the path with ids masked. */
  route?: (request: { method: string; url: string }) => string | undefined;
  /** Report 5xx responses as error events. Default true. */
  captureServerErrors?: boolean;
  /** Report requests at least this slow. Default 5000ms; 0 disables. */
  slowRequestMs?: number;
  /** Send a per-route summary this often. Default 60000ms; 0 disables. */
  summaryInterval?: number;
  /** Minimum gap between repeated error/slow events for one route. Default 60000ms. */
  eventWindow?: number;
  /** Paths never recorded, e.g. health checks. Default: /health, /healthz, /ready, /live, /favicon.ico. */
  ignore?: Array<string | RegExp>;
};

export type ResolvedHttpOptions = Required<Omit<HttpInstrumentationOptions, "route">> & Pick<HttpInstrumentationOptions, "route">;

export type HttpObservation = {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  error?: unknown;
};

/** Emits events through the client, which applies redaction and buffering. */
export type HttpEventSink = (event: {
  type: MonitoringEventType;
  level: "info" | "warning" | "error";
  message: string;
  metadata: Record<string, unknown>;
  error?: unknown;
}) => void;

const DEFAULT_IGNORE = ["/health", "/healthz", "/ready", "/readyz", "/live", "/livez", "/favicon.ico"];
const MAX_ROUTES = 200;

export function resolveHttpOptions(options: HttpInstrumentationOptions = {}): ResolvedHttpOptions {
  return {
    route: options.route,
    captureServerErrors: options.captureServerErrors ?? true,
    slowRequestMs: options.slowRequestMs ?? 5_000,
    summaryInterval: options.summaryInterval ?? 60_000,
    eventWindow: options.eventWindow ?? 60_000,
    ignore: options.ignore ?? DEFAULT_IGNORE,
  };
}

/**
 * The path, without query or fragment (which can carry tokens), with
 * id-like segments masked so `/orders/8812` and `/orders/9014` are one route.
 */
export function normalizeRoute(url: string): string {
  let path = url;
  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut);
  try {
    if (/^[a-z]+:\/\//i.test(path)) path = new URL(path).pathname;
  } catch {
    // Leave as-is.
  }
  const segments = path.split("/").map((segment) => {
    if (!segment) return segment;
    if (/^\d+$/.test(segment)) return ":id";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ":id";
    if (/^[0-9a-f]{16,}$/i.test(segment)) return ":id";
    // Long opaque tokens (cuid, base64url ids, signed values).
    if (segment.length >= 20 && /\d/.test(segment) && /^[A-Za-z0-9_-]+$/.test(segment)) return ":id";
    return segment;
  });
  const route = segments.join("/") || "/";
  return route.length > 200 ? `${route.slice(0, 199)}…` : route;
}

type RouteStats = { method: string; route: string; count: number; errors: number; totalMs: number; maxMs: number };

export class HttpMetrics {
  private stats = new Map<string, RouteStats>();
  private lastEvent = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private users = 0;

  constructor(
    private readonly sink: HttpEventSink,
    private readonly now: () => number = Date.now,
  ) {}

  isIgnored(options: ResolvedHttpOptions, path: string): boolean {
    const bare = path.split(/[?#]/)[0];
    return options.ignore.some((rule) => (typeof rule === "string" ? bare === rule : rule.test(bare)));
  }

  record(options: ResolvedHttpOptions, observation: HttpObservation) {
    const key = `${observation.method} ${observation.route}`;
    let entry = this.stats.get(key);
    if (!entry) {
      // Bound memory if routing produces unbounded distinct paths.
      if (this.stats.size >= MAX_ROUTES) {
        entry = this.stats.get("OTHER") ?? { method: "*", route: "(other)", count: 0, errors: 0, totalMs: 0, maxMs: 0 };
        this.stats.set("OTHER", entry);
      } else {
        entry = { method: observation.method, route: observation.route, count: 0, errors: 0, totalMs: 0, maxMs: 0 };
        this.stats.set(key, entry);
      }
    }
    const failed = observation.status >= 500 || observation.error !== undefined;
    entry.count += 1;
    entry.totalMs += observation.durationMs;
    entry.maxMs = Math.max(entry.maxMs, observation.durationMs);
    if (failed) entry.errors += 1;

    const metadata = {
      method: observation.method,
      route: observation.route,
      status: observation.status,
      durationMs: Math.round(observation.durationMs),
    };

    if (failed && options.captureServerErrors && this.allow(`error:${key}:${observation.status}`, options.eventWindow)) {
      this.sink({
        type: "error",
        level: "error",
        message: `${observation.method} ${observation.route} failed with ${observation.status}`,
        metadata,
        error: observation.error,
      });
    } else if (
      options.slowRequestMs > 0 &&
      observation.durationMs >= options.slowRequestMs &&
      this.allow(`slow:${key}`, options.eventWindow)
    ) {
      this.sink({
        type: "performance",
        level: "warning",
        message: `${observation.method} ${observation.route} took ${Math.round(observation.durationMs)}ms`,
        metadata: { ...metadata, thresholdMs: options.slowRequestMs },
      });
    }
  }

  private allow(key: string, window: number): boolean {
    const now = this.now();
    const last = this.lastEvent.get(key);
    if (last !== undefined && now - last < window) return false;
    this.lastEvent.set(key, now);
    if (this.lastEvent.size > 1_000) {
      for (const [k, at] of this.lastEvent) if (now - at >= window) this.lastEvent.delete(k);
    }
    return true;
  }

  /** Sends and resets the per-route summary. Returns whether anything was sent. */
  flushSummary(): boolean {
    if (this.stats.size === 0) return false;
    const routes = [...this.stats.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 25)
      .map((r) => ({
        method: r.method,
        route: r.route,
        count: r.count,
        errors: r.errors,
        avgMs: Math.round(r.totalMs / r.count),
        maxMs: Math.round(r.maxMs),
      }));
    const total = [...this.stats.values()].reduce((sum, r) => sum + r.count, 0);
    const errors = [...this.stats.values()].reduce((sum, r) => sum + r.errors, 0);
    this.stats.clear();
    this.sink({
      type: "performance",
      level: "info",
      message: `HTTP summary: ${total} requests, ${errors} errors`,
      metadata: { requests: total, errors, routes },
    });
    return true;
  }

  /** Starts the summary timer for one more instrumented surface; returns its release. */
  retain(options: ResolvedHttpOptions): () => void {
    this.users += 1;
    if (!this.timer && options.summaryInterval > 0) {
      this.timer = setInterval(() => this.flushSummary(), options.summaryInterval);
      (this.timer as { unref?: () => void }).unref?.();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.users -= 1;
      if (this.users <= 0) this.stop();
    };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// --- Structural types for node:http, so the package does not depend on it ---

export type IncomingMessageLike = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  originalUrl?: string;
  baseUrl?: string;
  route?: { path?: unknown };
};

export type ServerResponseLike = {
  statusCode: number;
  once(event: "finish" | "close", listener: () => void): unknown;
};

export type NodeHttpServerLike = {
  on(event: "request", listener: (req: IncomingMessageLike, res: ServerResponseLike) => void): unknown;
  prependListener?(event: "request", listener: (req: IncomingMessageLike, res: ServerResponseLike) => void): unknown;
  removeListener(event: "request", listener: (req: IncomingMessageLike, res: ServerResponseLike) => void): unknown;
};

/** Express exposes the matched route template after routing; prefer it over the raw path. */
function routeOf(options: ResolvedHttpOptions, req: IncomingMessageLike, method: string, url: string): string {
  const custom = options.route?.({ method, url });
  if (custom) return custom;
  const template = typeof req.route?.path === "string" ? req.route.path : undefined;
  if (template) return `${req.baseUrl ?? ""}${template}` || "/";
  return normalizeRoute(url);
}

/** Times one node:http request until its response finishes or the socket closes. */
export function observeNodeRequest(metrics: HttpMetrics, options: ResolvedHttpOptions, req: IncomingMessageLike, res: ServerResponseLike) {
  const url = req.originalUrl ?? req.url ?? "/";
  if (metrics.isIgnored(options, url)) return;
  const started = performance.now();
  const method = (req.method ?? "GET").toUpperCase();
  let done = false;
  const finish = (aborted: boolean) => {
    if (done) return;
    done = true;
    // A client that hung up is not a server error; record it as 499.
    const status = aborted ? 499 : res.statusCode;
    metrics.record(options, { method, route: routeOf(options, req, method, url), status, durationMs: performance.now() - started });
  };
  res.once("finish", () => finish(false));
  res.once("close", () => finish(true));
}
