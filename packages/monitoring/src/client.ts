/**
 * The monitoring client.
 *
 * Every public method is safe to call from anywhere, at any time:
 * - capture methods are synchronous and never throw; events are buffered and
 *   sent in the background in batches;
 * - async methods resolve (never reject) with the server's answer or `null`;
 * - nothing keeps the process alive: all timers are unref'd.
 */

import { normalizeEnvironment, resolveConfig, type DependencyCheck, type MonitoringOptions, type OutgoingEvent, type ResolvedConfig } from "./config";
import { isErrorLike, normalizeError } from "./errors";
import {
  HttpMetrics,
  normalizeRoute,
  observeNodeRequest,
  resolveHttpOptions,
  type HttpInstrumentationOptions,
  type IncomingMessageLike,
  type NodeHttpServerLike,
  type ServerResponseLike,
} from "./http";
import { installConsoleBreadcrumbs, installHttpBreadcrumbs } from "./breadcrumbs";
import { activeTrace } from "./otel";
import { installFatalHandlers, type UnhandledOptions } from "./process";
import { ScopeManager, type Breadcrumb, type MonitoringUser, type RequestInfo, type Scope } from "./scope";
import { exceptionChain } from "./stacktrace";
import { boundMetadata, byteLength, redact, redactBounded, truncate } from "./redact";
import { realClock, Transport, type Clock } from "./transport";
import type {
  ApplicationConfigResponse,
  DependencyStatus,
  EventPayload,
  HeartbeatPayload,
  HeartbeatResponse,
  JsonObject,
  MonitoringEventType,
  MonitoringLevel,
  MonitoringSeverity,
  MonitoringStatus,
  ReleasePayload,
  ReleaseResponse,
} from "./types";

const MAX_BATCH = 25;
/** Stay under the server's 1MB events body limit with room for the envelope. */
const MAX_BATCH_BYTES = 900_000;
export const SDK_NAME = "@nerdstackgrp/monitoring";
export const SDK_VERSION = "0.2.0";
const MESSAGE_LIMIT = 2_000;
const METADATA_BYTES = 8_000;
const MAX_DEPENDENCIES = 50;
const DEFAULT_HEARTBEAT_MS = 30_000;
const RETRY_BUFFERED_MS = 15_000;

const SEVERITY: Record<MonitoringLevel, MonitoringSeverity> = {
  info: "INFO",
  warning: "WARNING",
  error: "ERROR",
  critical: "CRITICAL",
};

const DEPENDENCY_STATUSES: readonly DependencyStatus[] = ["healthy", "degraded", "unhealthy", "down", "unknown"];

function isDependencyStatus(value: unknown): value is DependencyStatus {
  return typeof value === "string" && (DEPENDENCY_STATUSES as readonly string[]).includes(value);
}

function toDependencyStatus(value: unknown): DependencyStatus {
  if (value === true) return "healthy";
  if (value === false) return "down";
  return isDependencyStatus(value) ? value : "unknown";
}

/** A dependency that is down makes the service degraded, not down: it is still answering. */
export function deriveStatus(dependencies: Record<string, DependencyStatus>): MonitoringStatus {
  const values = Object.values(dependencies);
  return values.some((s) => s === "down" || s === "unhealthy" || s === "degraded") ? "degraded" : "healthy";
}

function uptimeSeconds(): number | undefined {
  const proc = (globalThis as { process?: { uptime?: () => number } }).process;
  return typeof proc?.uptime === "function" ? Math.floor(proc.uptime()) : undefined;
}

function unref(timer: unknown) {
  (timer as { unref?: () => void } | null)?.unref?.();
}

export type CaptureOptions = {
  level?: MonitoringLevel;
  metadata?: Record<string, unknown>;
  /** Correlates the event with a request in your logs. */
  requestId?: string;
  /** Report against another registered service, or `null` for the application as a whole. */
  service?: string | null;
  /** Tags for this event only, on top of `setTag`. */
  tags?: Record<string, string | number | boolean>;
  /** Overrides grouping: events with the same parts are one issue in Nex. */
  fingerprint?: string[];
};

export type CaptureExceptionOptions = CaptureOptions & {
  /** How it was caught, shown in Nex. Default "manual". */
  mechanism?: string;
  /** False marks a crash. Default true. */
  handled?: boolean;
};

export type BreadcrumbOptions = {
  /** console.log/info/warn/error/debug. Default true. */
  console?: boolean;
  /** Outgoing fetch and node:http requests. Default true. */
  http?: boolean;
};

export type CaptureErrorOptions = CaptureOptions & {
  /** The underlying error, if there is one. */
  error?: unknown;
};

export type HeartbeatOptions = {
  /** Overrides the status derived from dependencies. */
  status?: MonitoringStatus;
  /** Dependency health for this heartbeat. `true`/`false` mean healthy/down. Skips the configured `checks`. */
  dependencies?: Record<string, DependencyStatus | boolean>;
  /** Milliseconds for the service's own health probe. Default: how long `checks` took. */
  responseTime?: number;
};

export type StartOptions = {
  /** Default: the `heartbeatInterval` option, else the server's suggestion, else 30s. */
  heartbeatInterval?: number;
  /** Report crashes (uncaught exceptions, unhandled rejections). Default true; `false` turns it off. */
  captureUnhandled?: boolean | UnhandledOptions;
  /** Record console output and outgoing HTTP calls as breadcrumbs. Default true. */
  breadcrumbs?: boolean | BreadcrumbOptions;
};

export type ReleaseOptions = {
  /** Default: the configured version (APP_VERSION). */
  version?: string;
  /** Default: the configured commit (APP_COMMIT, GIT_COMMIT, SOURCE_COMMIT, GITHUB_SHA, …). */
  commit?: string;
  /** Default: this client's service. `null` records an application-wide release. */
  service?: string | null;
  environment?: string;
  deployedAt?: Date | string;
};

export type MonitoringStats = {
  enabled: boolean;
  queued: number;
  dropped: number;
  paused: boolean;
  tokenRejected: boolean;
  running: boolean;
};

type NodeMiddleware = (req: IncomingMessageLike, res: ServerResponseLike, next: (error?: unknown) => void) => void;

export class Monitoring {
  // Private fields: invisible to console.log, util.inspect and JSON.stringify,
  // which is where tokens usually leak.
  readonly #config: ResolvedConfig;
  readonly #transport: Transport;
  readonly #clock: Clock;
  #context: JsonObject = {};
  #queue: EventPayload[] = [];
  #dropped = 0;
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #draining: Promise<void> | null = null;
  #heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  #heartbeatInFlight: Promise<HeartbeatResponse | null> | null = null;
  #serverIntervalMs: number | undefined;
  #running = false;
  #recent = new Map<string, number>();
  #reported = new WeakSet<object>();
  #uninstallFatal: (() => void) | null = null;
  #http: HttpMetrics;
  #httpReleases: (() => void)[] = [];
  #removeBeforeExit: (() => void) | null = null;
  readonly #scopes = new ScopeManager();
  #uninstallBreadcrumbs: (() => void)[] = [];
  #contexts: JsonObject | null = null;

  constructor(options: MonitoringOptions = {}, clock: Clock = realClock) {
    this.#config = resolveConfig(options);
    this.#clock = clock;
    this.#transport = new Transport(this.#config, clock);
    this.#http = new HttpMetrics((event) => {
      // Already reported as an exception, with its request: don't send it twice.
      if (typeof event.error === "object" && event.error !== null && this.#reported.has(event.error)) return;
      this.#capture({
        type: event.type,
        level: event.level,
        message: event.message,
        metadata: event.metadata,
        error: event.error === undefined ? undefined : normalizeError(event.error),
        timestamp: new Date(this.#clock.now()).toISOString(),
      });
    }, () => this.#clock.now());
  }

  get enabled(): boolean {
    return this.#config.enabled;
  }

  get service(): string {
    return this.#config.service;
  }

  get version(): string | undefined {
    return this.#config.version;
  }

  get environment(): string | undefined {
    return this.#config.environment;
  }

  // --- Context -------------------------------------------------------------------

  /** Merges into the context attached to every subsequent event. `undefined` removes a key. */
  setContext(context: Record<string, unknown>): void {
    const next: Record<string, unknown> = { ...this.#context };
    for (const [key, value] of Object.entries(context)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    const clean = redact(next, { keys: this.#config.redactKeys });
    this.#context = clean !== null && typeof clean === "object" && !Array.isArray(clean) ? clean : {};
  }

  clearContext(): void {
    this.#context = {};
  }

  getContext(): JsonObject {
    return { ...this.#context };
  }

  /**
   * Who is affected. Inside an instrumented request it applies to that
   * request only; elsewhere, to everything reported afterwards. Nex counts
   * users per issue. `null` clears it.
   */
  setUser(user: MonitoringUser | null): void {
    this.#scopes.current.user = user ? { ...user } : null;
  }

  /** A searchable label on subsequent events (per request inside one). */
  setTag(key: string, value: string | number | boolean): void {
    this.#scopes.current.tags[String(key)] = String(value);
  }

  setTags(tags: Record<string, string | number | boolean>): void {
    for (const [key, value] of Object.entries(tags)) this.setTag(key, value);
  }

  /** Names what is running, e.g. a job: "sync-invoices". Requests are named automatically. */
  setTransaction(name: string | null): void {
    this.#scopes.current.transaction = name;
  }

  /** Leaves a trail entry; the last 100 are sent with the next error. */
  addBreadcrumb(crumb: Breadcrumb): void {
    if (!this.#config.enabled) return;
    try {
      this.#scopes.current.addBreadcrumb(crumb, this.#clock.now());
    } catch {
      // Never throw into the application.
    }
  }

  /**
   * Runs `fn` with its own user, tags and breadcrumbs, e.g. one job of a
   * worker: `monitoring.withScope(() => processJob(job))`.
   */
  withScope<T>(fn: (scope: { setUser: (user: MonitoringUser | null) => void; setTag: (key: string, value: string | number | boolean) => void }) => T): T {
    return this.#scopes.run((scope) =>
      fn({
        setUser: (user) => {
          scope.user = user ? { ...user } : null;
        },
        setTag: (key, value) => {
          scope.tags[String(key)] = String(value);
        },
      }),
    );
  }

  // --- Capture ---------------------------------------------------------------------

  /** Reports a thrown value. Returns whether it was queued (false if disabled, filtered or a duplicate). */
  captureException(error: unknown, options: CaptureExceptionOptions = {}): boolean {
    if (typeof error === "object" && error !== null) {
      // The same error object caught, reported, re-thrown and caught again
      // (or reaching the uncaught handler) is reported once.
      if (this.#reported.has(error)) return false;
    }
    const normalized = normalizeError(error);
    const handled = options.handled ?? true;
    const queued = this.#capture({
      type: "exception",
      level: options.level ?? "error",
      message: normalized.message || normalized.name,
      error: normalized,
      exception: exceptionChain(error, { type: options.mechanism ?? "manual", handled }),
      handled,
      fingerprint: options.fingerprint,
      metadata: this.#withRequestId(options),
      service: options.service,
      tags: options.tags,
      timestamp: new Date(this.#clock.now()).toISOString(),
    });
    if (queued && typeof error === "object" && error !== null) this.#reported.add(error);
    return queued;
  }

  /** Reports an error condition, with or without an underlying error object. */
  captureError(message: string, options: CaptureErrorOptions = {}): boolean {
    const normalized = options.error === undefined ? undefined : normalizeError(options.error);
    const queued = this.#capture({
      type: "error",
      level: options.level ?? "error",
      message: String(message),
      error: normalized,
      exception: options.error === undefined ? undefined : exceptionChain(options.error, { type: "manual", handled: true }),
      fingerprint: options.fingerprint,
      metadata: this.#withRequestId(options),
      service: options.service,
      tags: options.tags,
      timestamp: new Date(this.#clock.now()).toISOString(),
    });
    if (queued && isErrorLike(options.error) && typeof options.error === "object") this.#reported.add(options.error);
    return queued;
  }

  /** `info` → INFO … `critical` → CRITICAL. `critical` opens an incident in Nerdstack. */
  captureMessage(message: string, level: MonitoringLevel = "info", options: Omit<CaptureOptions, "level"> = {}): boolean {
    const type: MonitoringEventType = level === "warning" ? "warning" : level === "info" ? "custom" : "error";
    return this.#capture({
      type,
      level,
      message: String(message),
      fingerprint: options.fingerprint,
      metadata: this.#withRequestId(options),
      service: options.service,
      tags: options.tags,
      timestamp: new Date(this.#clock.now()).toISOString(),
    });
  }

  /** A named business or product event, e.g. `track("payment.failed", { provider })`. */
  track(name: string, properties: Record<string, unknown> = {}, options: Omit<CaptureOptions, "metadata"> = {}): boolean {
    return this.#capture({
      type: "custom",
      level: options.level ?? "info",
      message: String(name),
      metadata: { ...this.#withRequestId(options), event: String(name), properties },
      service: options.service,
      timestamp: new Date(this.#clock.now()).toISOString(),
    });
  }

  /** Low-level: any event type the API accepts. */
  captureEvent(event: {
    type: MonitoringEventType;
    level?: MonitoringLevel;
    message: string;
    error?: unknown;
    metadata?: Record<string, unknown>;
    service?: string | null;
  }): boolean {
    return this.#capture({
      type: event.type,
      level: event.level ?? "info",
      message: String(event.message),
      error: event.error === undefined ? undefined : normalizeError(event.error),
      metadata: event.metadata,
      service: event.service,
      timestamp: new Date(this.#clock.now()).toISOString(),
    });
  }

  #withRequestId(options: CaptureOptions): Record<string, unknown> | undefined {
    if (!options.requestId) return options.metadata;
    return { ...options.metadata, requestId: options.requestId };
  }

  #capture(input: OutgoingEvent): boolean {
    if (!this.#config.enabled || !this.#transport.usable) return false;
    try {
      let event: OutgoingEvent | null = input;
      if (this.#config.beforeSend) {
        try {
          event = this.#config.beforeSend(input);
        } catch {
          // A broken hook must not lose the event or crash the caller.
          this.#transport.warnOnce("beforeSend", "beforeSend threw; the event was sent without it.");
          event = input;
        }
        if (!event) return false;
      }

      const payload = this.#toPayload(event);
      if (this.#isDuplicate(payload)) return false;

      this.#queue.push(payload);
      const cap = Math.max(1, this.#config.maxBufferedEvents);
      while (this.#queue.length > cap) {
        this.#queue.shift();
        this.#dropped += 1;
      }

      if (payload.severity === "CRITICAL" || this.#queue.length >= MAX_BATCH) void this.#drain();
      else this.#scheduleFlush(this.#config.flushInterval);
      return true;
    } catch {
      return false;
    }
  }

  #toPayload(event: OutgoingEvent): EventPayload {
    const metadata: Record<string, unknown> = { ...event.metadata };
    if (this.#config.version && metadata.version === undefined) metadata.version = this.#config.version;
    if (Object.keys(this.#context).length) metadata.context = this.#context;
    const bounded = boundMetadata(metadata, { keys: this.#config.redactKeys, maxBytes: METADATA_BYTES });
    const service = event.service === null ? undefined : (event.service ?? this.#config.service);
    const scope = this.#scopes.current;
    const tags: Record<string, string> = { ...scope.tags };
    for (const [key, value] of Object.entries(event.tags ?? {})) tags[key] = String(value);
    const trace = activeTrace();
    const transaction = scope.transaction ?? (scope.request?.route ? `${scope.request.method ?? ""} ${scope.request.route}`.trim() : undefined);

    return {
      type: event.type,
      severity: SEVERITY[event.level] ?? "INFO",
      message: redactBounded(event.message || event.type, MESSAGE_LIMIT),
      ...(service ? { service } : {}),
      ...(this.#config.environment ? { environment: this.#config.environment } : {}),
      // Nex tracks which releases an issue happened in.
      ...(this.#config.version ? { release: truncate(this.#config.version, 64) } : {}),
      ...(event.error
        ? {
            error: {
              ...(event.error.name ? { name: truncate(event.error.name, 200) } : {}),
              ...(event.error.message ? { message: redactBounded(event.error.message, 4_000) } : {}),
              ...(event.error.stack ? { stack: redactBounded(event.error.stack, 16_000) } : {}),
            },
          }
        : {}),
      ...(bounded && Object.keys(bounded).length ? { metadata: bounded } : {}),
      timestamp: event.timestamp,
      ...(event.exception?.length ? { exception: event.exception } : {}),
      ...(event.handled !== undefined ? { handled: event.handled } : {}),
      ...(event.fingerprint?.length ? { fingerprint: event.fingerprint.map((part) => truncate(String(part), 200)) } : {}),
      ...(scope.breadcrumbs.length ? { breadcrumbs: this.#cleanBreadcrumbs(scope) } : {}),
      ...(scope.request ? { request: scope.request } : {}),
      ...(scope.user ? { user: this.#cleanUser(scope.user) } : {}),
      ...(Object.keys(tags).length ? { tags: redact(tags, { keys: this.#config.redactKeys }) as Record<string, string> } : {}),
      ...(transaction ? { transaction: truncate(transaction, 300) } : {}),
      ...(trace ? trace : {}),
      contexts: this.#runtimeContexts(),
      sdk: { name: SDK_NAME, version: SDK_VERSION },
    };
  }

  #cleanBreadcrumbs(scope: Scope): EventPayload["breadcrumbs"] {
    return scope.breadcrumbs.map((crumb) => ({
      ...(crumb.timestamp ? { timestamp: crumb.timestamp } : {}),
      ...(crumb.type ? { type: crumb.type } : {}),
      ...(crumb.category ? { category: crumb.category } : {}),
      ...(crumb.level ? { level: crumb.level } : {}),
      ...(crumb.message ? { message: redactBounded(crumb.message, 1_000) } : {}),
      ...(crumb.data ? { data: boundMetadata(crumb.data, { keys: this.#config.redactKeys, maxBytes: 2_000 }) ?? undefined } : {}),
    }));
  }

  #cleanUser(user: MonitoringUser): NonNullable<EventPayload["user"]> {
    return {
      ...(user.id !== undefined ? { id: truncate(String(user.id), 200) } : {}),
      ...(user.username ? { username: truncate(user.username, 200) } : {}),
      ...(user.email ? { email: truncate(user.email, 320) } : {}),
    };
  }

  /** Runtime and OS, worked out once. */
  #runtimeContexts(): JsonObject {
    if (this.#contexts) return this.#contexts;
    const proc = (globalThis as { process?: { version?: string; versions?: Record<string, string>; platform?: string; arch?: string } }).process;
    const bun = proc?.versions?.bun;
    this.#contexts = {
      runtime: bun ? { name: "bun", version: bun } : { name: "node", version: proc?.version?.replace(/^v/, "") ?? "unknown" },
      os: { name: proc?.platform ?? "unknown", arch: proc?.arch ?? "unknown" },
    };
    return this.#contexts;
  }

  #isDuplicate(payload: EventPayload): boolean {
    const window = this.#config.dedupeWindow;
    if (window <= 0) return false;
    const now = this.#clock.now();
    const key = [payload.type, payload.severity, payload.service ?? "", payload.message, payload.error?.name ?? "", payload.error?.stack?.split("\n", 2)[1] ?? ""].join("|");
    const last = this.#recent.get(key);
    if (last !== undefined && now - last < window) return true;
    this.#recent.set(key, now);
    if (this.#recent.size > 500) {
      for (const [k, at] of this.#recent) if (now - at >= window) this.#recent.delete(k);
    }
    return false;
  }

  // --- Delivery --------------------------------------------------------------------

  #scheduleFlush(delay: number) {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.#drain();
    }, delay);
    unref(this.#flushTimer);
  }

  /** Takes the next batch that fits the server's limits. */
  #nextBatch(): EventPayload[] {
    const batch: EventPayload[] = [];
    let bytes = 16;
    while (this.#queue.length && batch.length < MAX_BATCH) {
      let next = this.#queue[0];
      let size = byteLength(JSON.stringify(next));
      if (size > MAX_BATCH_BYTES) {
        // One event larger than a request: shed the bulky parts rather than
        // lose the event.
        next = {
          ...next,
          metadata: undefined,
          breadcrumbs: undefined,
          error: next.error ? { ...next.error, stack: next.error.stack?.slice(0, 4_000) } : undefined,
          exception: next.exception?.map((ex) => ({ ...ex, stacktrace: ex.stacktrace ? { frames: ex.stacktrace.frames.slice(0, 20) } : undefined })),
        };
        size = byteLength(JSON.stringify(next));
        this.#queue[0] = next;
      }
      if (batch.length && bytes + size > MAX_BATCH_BYTES) break;
      batch.push(this.#queue.shift()!);
      bytes += size + 1;
    }
    return batch;
  }

  /** Sends everything queued, one batch at a time. Concurrent calls share one run. */
  #drain(): Promise<void> {
    if (this.#draining) return this.#draining;
    if (this.#flushTimer) {
      clearTimeout(this.#flushTimer);
      this.#flushTimer = null;
    }
    this.#draining = (async () => {
      try {
        while (this.#queue.length && this.#transport.usable) {
          const batch = this.#nextBatch();
          const body = batch.length === 1 ? batch[0] : { events: batch };
          const result = await this.#transport.request("POST", "/events", body);
          if (result.ok) continue;
          if (result.retryable) {
            // Put the batch back in front, still within the buffer limit, and
            // try again later. The transport's pause bounds how often.
            this.#queue.unshift(...batch);
            const cap = Math.max(1, this.#config.maxBufferedEvents);
            while (this.#queue.length > cap) {
              this.#queue.shift();
              this.#dropped += 1;
            }
            this.#scheduleFlush(Math.max(this.#transport.nextAttemptInMs, RETRY_BUFFERED_MS));
          } else {
            // Rejected as invalid: retrying would fail identically.
            this.#dropped += batch.length;
          }
          break;
        }
      } catch {
        // Defensive: the transport does not throw, but delivery must never
        // surface an exception into the application.
      } finally {
        this.#draining = null;
      }
    })();
    return this.#draining;
  }

  /**
   * Sends buffered events now. Resolves `true` when the buffer emptied within
   * `timeoutMs` (default 5000). Call before a planned exit.
   */
  async flush(timeoutMs = 5_000): Promise<boolean> {
    if (!this.#config.enabled) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      unref(timer);
    });
    const done = await Promise.race([this.#drain().then(() => true as const), timeout]);
    clearTimeout(timer);
    return done && this.#queue.length === 0;
  }

  // --- Heartbeat ---------------------------------------------------------------------

  /**
   * Sends one heartbeat. Resolves with the server's reply, or `null` if it
   * could not be delivered. While one is in flight, calls share it.
   */
  heartbeat(options: HeartbeatOptions = {}): Promise<HeartbeatResponse | null> {
    if (!this.#config.enabled) return Promise.resolve(null);
    if (this.#heartbeatInFlight) return this.#heartbeatInFlight;
    this.#heartbeatInFlight = this.#sendHeartbeat(options)
      .catch(() => null)
      .finally(() => {
        this.#heartbeatInFlight = null;
      });
    return this.#heartbeatInFlight;
  }

  async #runChecks(checks: Record<string, DependencyCheck>): Promise<Record<string, DependencyStatus>> {
    const entries = Object.entries(checks).slice(0, MAX_DEPENDENCIES);
    const results = await Promise.all(
      entries.map(async ([name, check]): Promise<[string, DependencyStatus]> => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const timeout = new Promise<DependencyStatus>((resolve) => {
            timer = setTimeout(() => resolve("down"), this.#config.checkTimeout);
            unref(timer);
          });
          const value = await Promise.race([Promise.resolve().then(check).then(toDependencyStatus), timeout]);
          return [name, value];
        } catch {
          return [name, "down"];
        } finally {
          clearTimeout(timer);
        }
      }),
    );
    return Object.fromEntries(results);
  }

  async #sendHeartbeat(options: HeartbeatOptions): Promise<HeartbeatResponse | null> {
    const started = this.#clock.now();
    let dependencies: Record<string, DependencyStatus>;
    let ranChecks = false;
    if (options.dependencies) {
      dependencies = Object.fromEntries(
        Object.entries(options.dependencies)
          .slice(0, MAX_DEPENDENCIES)
          .map(([name, value]) => [name, toDependencyStatus(value)]),
      );
    } else {
      ranChecks = Object.keys(this.#config.checks).length > 0;
      dependencies = ranChecks ? await this.#runChecks(this.#config.checks) : {};
    }
    const cleanDependencies = Object.fromEntries(
      Object.entries(dependencies).map(([name, status]) => [truncate(name.trim() || "dependency", 64), status]),
    );

    const payload: HeartbeatPayload = {
      service: this.#config.service,
      status: options.status ?? deriveStatus(cleanDependencies),
      ...(this.#config.version ? { version: this.#config.version } : {}),
      ...(uptimeSeconds() !== undefined ? { uptime: uptimeSeconds() } : {}),
      ...(options.responseTime !== undefined
        ? { responseTime: Math.max(0, options.responseTime) }
        : ranChecks
          ? { responseTime: this.#clock.now() - started }
          : {}),
      ...(this.#config.environment ? { environment: this.#config.environment } : {}),
      ...(Object.keys(cleanDependencies).length ? { dependencies: cleanDependencies } : {}),
      timestamp: new Date(this.#clock.now()).toISOString(),
    };

    // One retry at most: the next scheduled heartbeat supersedes this one.
    const result = await this.#transport.request<HeartbeatResponse>("POST", "/heartbeat", payload, Math.min(1, this.#config.maxRetries));
    if (!result.ok) return null;
    const suggested = result.data?.expectedIntervalSeconds;
    if (typeof suggested === "number" && suggested > 0) this.#serverIntervalMs = suggested * 1000;
    return result.data;
  }

  /**
   * Sends a heartbeat now and then on an interval, until `stop()`, reports
   * crashes and records breadcrumbs (both on unless turned off). Calling it
   * again while running does nothing. The timer never keeps the process alive.
   */
  start(options: StartOptions = {}): void {
    if (!this.#config.enabled || this.#running) return;
    this.#running = true;
    if (options.captureUnhandled !== false) {
      this.captureUnhandled(typeof options.captureUnhandled === "object" ? options.captureUnhandled : {});
    }
    if (options.breadcrumbs !== false) this.#installBreadcrumbs(typeof options.breadcrumbs === "object" ? options.breadcrumbs : {});

    // Timers are unref'd, so a process that finishes its work exits without
    // waiting for the next batch. Flush once when the event loop empties;
    // the guard stops the flush's own completion from re-triggering it.
    const proc = (globalThis as { process?: { on?: (e: string, l: () => void) => unknown; removeListener?: (e: string, l: () => void) => unknown } }).process;
    if (proc?.on && proc.removeListener) {
      let flushedOnExit = false;
      const onBeforeExit = () => {
        if (flushedOnExit || this.#queue.length === 0) return;
        flushedOnExit = true;
        void this.flush(2_000);
      };
      proc.on("beforeExit", onBeforeExit);
      const remove = proc.removeListener.bind(proc);
      this.#removeBeforeExit = () => remove("beforeExit", onBeforeExit);
    }

    const interval = () =>
      options.heartbeatInterval ?? this.#config.heartbeatInterval ?? this.#serverIntervalMs ?? DEFAULT_HEARTBEAT_MS;

    // Each tick schedules the next only after it finishes, so a slow or
    // failing request can never stack heartbeats on top of each other.
    const tick = async () => {
      this.#heartbeatTimer = null;
      await this.heartbeat();
      if (!this.#running) return;
      this.#heartbeatTimer = setTimeout(tick, interval());
      unref(this.#heartbeatTimer);
    };
    void tick();
  }

  /** Stops heartbeats, HTTP summaries and the fatal-error integration, then flushes (bounded). */
  async stop(options: { flushTimeout?: number } = {}): Promise<void> {
    this.#running = false;
    if (this.#heartbeatTimer) clearTimeout(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
    this.#uninstallFatal?.();
    this.#uninstallFatal = null;
    this.#removeBeforeExit?.();
    this.#removeBeforeExit = null;
    for (const uninstall of this.#uninstallBreadcrumbs.splice(0)) uninstall();
    for (const release of this.#httpReleases.splice(0)) release();
    this.#http.flushSummary();
    await this.flush(options.flushTimeout ?? 2_000);
  }

  get running(): boolean {
    return this.#running;
  }

  #installBreadcrumbs(options: BreadcrumbOptions) {
    for (const uninstall of this.#uninstallBreadcrumbs.splice(0)) uninstall();
    const add = (crumb: Breadcrumb) => this.addBreadcrumb(crumb);
    try {
      if (options.console !== false) this.#uninstallBreadcrumbs.push(installConsoleBreadcrumbs(add));
      if (options.http !== false) {
        const origin = (() => {
          try {
            return new URL(this.#config.endpoint).origin;
          } catch {
            return null;
          }
        })();
        this.#uninstallBreadcrumbs.push(installHttpBreadcrumbs(add, origin, () => performance.now()));
      }
    } catch {
      // Breadcrumbs are a nicety; never fail start() over them.
    }
  }

  // --- Releases & config ---------------------------------------------------------------

  /** Records a deployment. Resolves with the stored release (including `previousVersion`), or `null`. */
  async reportRelease(release: ReleaseOptions = {}): Promise<ReleaseResponse["release"] | null> {
    if (!this.#config.enabled) return null;
    const version = release.version?.trim() || this.#config.version;
    if (!version) {
      this.#transport.warnOnce("release-version", "reportRelease() needs a version (pass one, or set APP_VERSION).");
      return null;
    }
    const commit = release.commit?.trim() || this.#config.commit;
    const service = release.service === null ? undefined : (release.service ?? this.#config.service);
    const environment = release.environment === undefined ? this.#config.environment : normalizeEnvironment(release.environment);
    const deployedAt = release.deployedAt instanceof Date ? release.deployedAt.toISOString() : release.deployedAt;

    const payload: ReleasePayload = {
      version: truncate(version, 64),
      ...(commit ? { commitSha: truncate(commit, 64) } : {}),
      ...(service ? { service } : {}),
      ...(environment ? { environment } : {}),
      ...(deployedAt ? { deployedAt } : {}),
    };
    const result = await this.#transport.request<ReleaseResponse>("POST", "/releases", payload);
    return result.ok ? (result.data?.release ?? null) : null;
  }

  /** The application's identity and registered services, as Nerdstack sees this token. */
  async fetchConfig(): Promise<ApplicationConfigResponse | null> {
    if (!this.#config.enabled) return null;
    const result = await this.#transport.request<ApplicationConfigResponse>("GET", "/config");
    return result.ok ? result.data : null;
  }

  // --- Fatal errors -------------------------------------------------------------------

  /**
   * Reports `uncaughtException` / `unhandledRejection` as CRITICAL events,
   * waits up to `flushTimeout` for delivery, then lets the process crash
   * exactly as it would have without this. Returns an uninstall function.
   */
  captureUnhandled(options: UnhandledOptions = {}): () => void {
    if (!this.#config.enabled) return () => {};
    this.#uninstallFatal?.();
    const uninstall = installFatalHandlers(
      {
        report: (error, origin) => {
          this.captureException(error, { level: "critical", metadata: { origin }, mechanism: origin, handled: false });
        },
        flush: (timeoutMs) => this.flush(timeoutMs),
      },
      options,
    );
    this.#uninstallFatal = uninstall;
    return () => {
      uninstall();
      if (this.#uninstallFatal === uninstall) this.#uninstallFatal = null;
    };
  }

  // --- HTTP instrumentation ------------------------------------------------------------

  /** Times every request on a `node:http` server. Returns an uninstall function. */
  instrumentHttp(server: NodeHttpServerLike, options: HttpInstrumentationOptions = {}): () => void {
    if (!this.#config.enabled) return () => {};
    const resolved = resolveHttpOptions(options);
    const listener = (req: IncomingMessageLike, res: ServerResponseLike) => {
      try {
        // The application's own listener runs right after this one, in
        // this request's scope.
        this.#scopes.enter(this.#requestScope(req));
        observeNodeRequest(this.#http, resolved, req, res);
      } catch {
        // Instrumentation must never break request handling.
      }
    };
    if (typeof server.prependListener === "function") server.prependListener("request", listener);
    else server.on("request", listener);
    const release = this.#http.retain(resolved);
    this.#httpReleases.push(release);
    return () => {
      server.removeListener("request", listener);
      release();
    };
  }

  /** Connect/Express-style middleware: `app.use(monitoring.httpMiddleware())`. */
  httpMiddleware(options: HttpInstrumentationOptions = {}): NodeMiddleware {
    const resolved = resolveHttpOptions(options);
    if (this.#config.enabled) this.#httpReleases.push(this.#http.retain(resolved));
    return (req, res, next) => {
      if (!this.#config.enabled) return next();
      try {
        observeNodeRequest(this.#http, resolved, req, res);
      } catch {
        // Never break the chain.
      }
      let scope: Scope | null = null;
      try {
        scope = this.#requestScope(req);
      } catch {
        // No request scope: errors still report, without request context.
      }
      if (scope) this.#scopes.run(() => next(), scope);
      else next();
    };
  }

  /**
   * Express error middleware: reports the error with its request, then
   * passes it on. Add it after your routes:
   * `app.use(monitoring.errorHandler())`. 4xx errors (`err.status < 500`)
   * are not reported.
   */
  errorHandler(): (error: unknown, req: IncomingMessageLike, res: ServerResponseLike, next: (error?: unknown) => void) => void {
    return (error, req, _res, next) => {
      try {
        const status = (error as { status?: unknown; statusCode?: unknown } | null)?.status ?? (error as { statusCode?: unknown } | null)?.statusCode;
        if (!(typeof status === "number" && status < 500)) {
          const scope = this.#scopes.current;
          if (!scope.request) scope.request = this.#requestInfo(req);
          this.captureException(error, { mechanism: "middleware", handled: false });
        }
      } catch {
        // Never break error handling.
      }
      next(error);
    };
  }

  #requestInfo(req: IncomingMessageLike): RequestInfo {
    const method = (req.method ?? "GET").toUpperCase();
    const url = (req.originalUrl ?? req.url ?? "/").replace(/[?#].*$/, "");
    const agent = req.headers?.["user-agent"];
    return {
      method,
      url: truncate(url, 2_000),
      route: normalizeRoute(url),
      ...(typeof agent === "string" ? { userAgent: truncate(agent, 500) } : {}),
    };
  }

  #requestScope(req: IncomingMessageLike): Scope {
    const scope = this.#scopes.current.fork();
    scope.request = this.#requestInfo(req);
    return scope;
  }

  /**
   * Wraps a `(Request) => Response` handler (Bun.serve, Elysia, Hono, Next.js
   * route handlers). Errors thrown by the handler are reported and re-thrown.
   */
  wrapFetchHandler<Args extends unknown[]>(
    handler: (request: Request, ...args: Args) => Response | Promise<Response>,
    options: HttpInstrumentationOptions = {},
  ): (request: Request, ...args: Args) => Promise<Response> {
    const resolved = resolveHttpOptions(options);
    if (this.#config.enabled) this.#httpReleases.push(this.#http.retain(resolved));
    return async (request, ...args) => {
      if (!this.#config.enabled || this.#http.isIgnored(resolved, new URL(request.url).pathname)) {
        return handler(request, ...args);
      }
      const started = performance.now();
      const method = request.method.toUpperCase();
      const url = request.url;
      const route = () => resolved.route?.({ method, url }) ?? normalizeRoute(url);
      const scope = this.#scopes.current.fork();
      const agent = request.headers.get("user-agent");
      scope.request = { method, url: truncate(url.replace(/[?#].*$/, ""), 2_000), route: route(), ...(agent ? { userAgent: truncate(agent, 500) } : {}) };
      try {
        const response = await this.#scopes.run(() => handler(request, ...args), scope);
        this.#safeRecord(resolved, { method, route: route(), status: response.status, durationMs: performance.now() - started });
        return response;
      } catch (error) {
        try {
          this.#scopes.run(() => this.captureException(error, { mechanism: "fetch-handler", handled: false }), scope);
        } catch {
          // Never mask the application's error.
        }
        this.#safeRecord(resolved, { method, route: route(), status: 500, durationMs: performance.now() - started, error });
        throw error;
      }
    };
  }

  #safeRecord(options: ReturnType<typeof resolveHttpOptions>, observation: Parameters<HttpMetrics["record"]>[1]) {
    try {
      this.#http.record(options, observation);
    } catch {
      // Never break the response.
    }
  }

  // --- Introspection -----------------------------------------------------------------

  stats(): MonitoringStats {
    return {
      enabled: this.#config.enabled,
      queued: this.#queue.length,
      dropped: this.#dropped,
      paused: this.#transport.paused,
      tokenRejected: !this.#transport.usable,
      running: this.#running,
    };
  }

  /** Never serialise configuration, and above all never the token. */
  toJSON() {
    return { service: this.#config.service, environment: this.#config.environment ?? null, enabled: this.#config.enabled };
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    return `Monitoring { service: '${this.#config.service}', enabled: ${this.#config.enabled}, token: '[redacted]' }`;
  }
}

/**
 * Creates a client. With no arguments it reads MONITORING_API_URL,
 * MONITORING_TOKEN, MONITORING_SERVICE, APP_VERSION and MONITORING_ENVIRONMENT.
 * Throws `MonitoringConfigError` once, at startup, if misconfigured.
 */
export function createMonitoring(options: MonitoringOptions = {}): Monitoring {
  return new Monitoring(options);
}
