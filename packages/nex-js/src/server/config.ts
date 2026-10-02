/**
 * Configuration: what the caller passes, filled in from the environment,
 * validated once at construction.
 *
 * Misconfiguration throws immediately, with every problem listed, because it
 * is a deploy-time mistake a developer should see on the first run. Once
 * constructed, the SDK never throws again.
 */

import type { MonitoringEnvironment, MonitoringEventType } from "../shared/types";
import type { DependencyCheckDefinition, DependencyResult } from "./checks";

/**
 * A dependency check: a function (`() => pool.query("SELECT 1").then(() => true)`)
 * or one of the ready-made `checks.*`, which also say what they check.
 */
export type DependencyCheck = (() => DependencyResult | Promise<DependencyResult>) | DependencyCheckDefinition;

export type LoggerLike = {
  warn(message: string): void;
  debug?(message: string): void;
};

/** A fully-formed event, as passed to `beforeSend`. */
export type OutgoingEvent = {
  type: MonitoringEventType;
  level: "info" | "warning" | "error" | "critical";
  message: string;
  error?: { name?: string; message?: string; stack?: string };
  metadata?: Record<string, unknown>;
  service?: string | null;
  timestamp: string;
  /** The error chain with stack frames (exceptions only). */
  exception?: import("../shared/stacktrace").ExceptionPayload[];
  /** False for crashes (uncaught exceptions, unhandled rejections). */
  handled?: boolean;
  /** Overrides grouping. */
  fingerprint?: string[];
  /** Tags for this event only. */
  tags?: Record<string, string | number | boolean>;
};

export interface MonitoringOptions {
  /**
   * The monitoring API's base URL, used as given, e.g.
   * `https://nerdstackgrp.com/api/v1/monitoring` or `https://api.example.com/v1`.
   * Env: `NEX_API_URL` (or `MONITORING_API_URL`). This is the only address the SDK knows, so the
   * API can move without an SDK release.
   */
  apiUrl?: string;
  /**
   * Older form: the site origin, e.g. `https://nerdstackgrp.com`, to which
   * `/api/v1/monitoring` is appended. Env: `MONITORING_URL`. Ignored when
   * `apiUrl` is set.
   */
  endpoint?: string;
  /** `nsk_live_…` / `nsk_test_…`. Env: `NEX_TOKEN` (or `MONITORING_TOKEN`). */
  token?: string;
  /** Service slug, e.g. `ark-api`; registered in Nex on first report. Env: `NEX_SERVICE` (or `MONITORING_SERVICE`). */
  service?: string;
  /** Env: `APP_VERSION`, then `npm_package_version`. */
  version?: string;
  /** Deploy commit for releases. Env: `APP_COMMIT`, `GIT_COMMIT`, `SOURCE_COMMIT`, `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`. */
  commit?: string;
  /**
   * Usually leave unset: the token already belongs to one environment, and
   * the server uses it. When set, it must name the token's environment or the
   * server refuses the report. Any common spelling (`prod`, `staging`).
   * Env: `NEX_ENVIRONMENT` (or `MONITORING_ENVIRONMENT`). NODE_ENV is deliberately not used: staging
   * servers often run with NODE_ENV=production.
   */
  environment?: string;
  /** Set false to make every call a no-op (tests, local dev). Env: `NEX_ENABLED=false`. */
  enabled?: boolean;

  /** Default interval for `start()`. Default: the server's suggestion, else 30s. */
  heartbeatInterval?: number;
  /** Per-request timeout. Default 3000ms. */
  requestTimeout?: number;
  /** Events held in memory while Nex is unreachable; oldest dropped first. Default 100. */
  maxBufferedEvents?: number;
  /** Retries per request for network errors, 5xx and 429. Default 2. */
  maxRetries?: number;
  /** First retry delay; doubles each time, with jitter. Default 500ms. */
  retryDelay?: number;
  /** Identical events inside this window are sent once. Default 2000ms; 0 disables. */
  dedupeWindow?: number;
  /** How long buffered events wait to be batched. Default 1000ms. */
  flushInterval?: number;

  /**
   * Share of new traces recorded, 0..1. Default 0.1. A trace another service
   * started keeps that service's decision, so traces are whole or absent.
   * Env: `NEX_TRACES_SAMPLE_RATE`.
   */
  tracesSampleRate?: number;

  /** Dependency checks run for every heartbeat that does not pass its own `dependencies`. */
  checks?: Record<string, DependencyCheck>;
  /** Per-check timeout. Default 2000ms; a check that times out reports `down`. */
  checkTimeout?: number;

  /** Metadata keys to redact in addition to the defaults. */
  redactKeys?: Array<string | RegExp>;
  /** Last chance to edit or drop (return `null`) an event. Redaction still runs after it. */
  beforeSend?: (event: OutgoingEvent) => OutgoingEvent | null;

  /** Where the SDK's own warnings go. Default `console.warn`; pass `null` to silence. */
  logger?: LoggerLike | null;
  /** Log every request outcome through `logger.debug`. */
  debug?: boolean;
  /** Custom fetch (tests, proxies). Default: global `fetch`. */
  fetch?: typeof fetch;
}

export type ResolvedConfig = {
  enabled: boolean;
  /** The full API base URL, without a trailing slash. */
  endpoint: string;
  token: string;
  service: string;
  version: string | undefined;
  commit: string | undefined;
  environment: MonitoringEnvironment | undefined;
  heartbeatInterval: number | undefined;
  requestTimeout: number;
  maxBufferedEvents: number;
  maxRetries: number;
  retryDelay: number;
  dedupeWindow: number;
  flushInterval: number;
  checks: Record<string, DependencyCheck>;
  checkTimeout: number;
  tracesSampleRate: number;
  redactKeys: Array<string | RegExp>;
  beforeSend: MonitoringOptions["beforeSend"];
  logger: LoggerLike | null;
  debug: boolean;
  fetch: typeof fetch;
};

export class MonitoringConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Nex is misconfigured:\n  - ${problems.join("\n  - ")}`);
    this.name = "MonitoringConfigError";
    this.problems = problems;
  }
}

export const TOKEN_PATTERN = /^nsk_(live|test)_[A-Za-z0-9_-]{43}$/;
const SERVICE_PATTERN = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

type Env = Record<string, string | undefined>;

function processEnv(): Env {
  const proc = (globalThis as { process?: { env?: Env } }).process;
  return proc?.env ?? {};
}

function first(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * Maps the many spellings of an environment to the three the API accepts.
 * Anything else (`test`, `ci`, `preview`) is left out of payloads rather than
 * failing validation on the server.
 */
export function normalizeEnvironment(value: string | undefined): MonitoringEnvironment | undefined {
  switch (value?.trim().toLowerCase()) {
    case "production":
    case "prod":
    case "live":
      return "production";
    case "staging":
    case "stage":
    case "preprod":
    case "uat":
      return "staging";
    case "development":
    case "dev":
    case "local":
      return "development";
    default:
      return undefined;
  }
}

/** The API path under a site origin, for the older `endpoint` form. */
const LEGACY_API_PATH = "/api/v1/monitoring";

/**
 * Validates a base URL and returns the API base to call. An `apiUrl` is used
 * as given; a legacy `endpoint` origin gets the API path appended (unless it
 * already ends with it).
 */
function normalizeBaseUrl(raw: string, name: "apiUrl" | "endpoint"): { value: string; problem?: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { value: raw, problem: `${name} must be an absolute URL, e.g. https://api.example.com/v1` };
  }
  if (url.username || url.password) {
    return { value: raw, problem: `${name} must not contain credentials` };
  }
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    // The token rides in a header on every request; plain HTTP would expose it.
    return { value: raw, problem: `${name} must use https (http is allowed only for localhost)` };
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (name === "apiUrl") return { value: `${url.origin}${path}` };
  return { value: `${url.origin}${path.replace(new RegExp(`${LEGACY_API_PATH}$`), "")}${LEGACY_API_PATH}` };
}

function positive(name: string, value: number | undefined, fallback: number, min: number, problems: string[]): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < min) {
    problems.push(`${name} must be a number ≥ ${min}`);
    return fallback;
  }
  return value;
}

function sampleRate(value: number | undefined, problems: string[]): number {
  if (value === undefined) return 0.1;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    problems.push("tracesSampleRate must be a number from 0 to 1");
    return 0.1;
  }
  return value;
}

export function resolveConfig(options: MonitoringOptions = {}, env: Env = processEnv()): ResolvedConfig {
  const enabled = options.enabled ?? first(env.NEX_ENABLED, env.MONITORING_ENABLED)?.toLowerCase() !== "false";
  const problems: string[] = [];

  const apiUrlRaw = first(options.apiUrl, env.NEX_API_URL, env.MONITORING_API_URL);
  const endpointRaw = apiUrlRaw ? undefined : first(options.endpoint, env.MONITORING_URL);
  const token = first(options.token, env.NEX_TOKEN, env.MONITORING_TOKEN) ?? "";
  const service = first(options.service, env.NEX_SERVICE, env.MONITORING_SERVICE) ?? "";

  let endpoint = "";
  if (enabled) {
    if (!apiUrlRaw && !endpointRaw) {
      problems.push("apiUrl is required (option `apiUrl` or NEX_API_URL; MONITORING_API_URL and the older `endpoint` / MONITORING_URL also work)");
    } else {
      const normalized = apiUrlRaw ? normalizeBaseUrl(apiUrlRaw, "apiUrl") : normalizeBaseUrl(endpointRaw!, "endpoint");
      endpoint = normalized.value;
      if (normalized.problem) problems.push(normalized.problem);
    }
    // The token's value is never echoed, not even in validation errors.
    if (!token) problems.push("token is required (option `token` or NEX_TOKEN)");
    else if (!TOKEN_PATTERN.test(token)) problems.push("token is not a Nex SDK token (expected nsk_live_… or nsk_test_…)");
    if (!service) problems.push("service is required (option `service` or NEX_SERVICE)");
    else if (!SERVICE_PATTERN.test(service)) problems.push(`service "${service}" is not a valid slug (lowercase letters, digits, - _ .)`);
  }

  const config: ResolvedConfig = {
    enabled,
    endpoint,
    token,
    service,
    version: first(options.version, env.APP_VERSION, env.npm_package_version),
    commit: first(options.commit, env.APP_COMMIT, env.GIT_COMMIT, env.SOURCE_COMMIT, env.GITHUB_SHA, env.VERCEL_GIT_COMMIT_SHA),
    environment: normalizeEnvironment(first(options.environment, env.NEX_ENVIRONMENT, env.MONITORING_ENVIRONMENT)),
    heartbeatInterval: options.heartbeatInterval === undefined ? undefined : positive("heartbeatInterval", options.heartbeatInterval, 30_000, 1_000, problems),
    requestTimeout: positive("requestTimeout", options.requestTimeout, 3_000, 100, problems),
    maxBufferedEvents: Math.floor(positive("maxBufferedEvents", options.maxBufferedEvents, 100, 0, problems)),
    maxRetries: Math.floor(positive("maxRetries", options.maxRetries, 2, 0, problems)),
    retryDelay: positive("retryDelay", options.retryDelay, 500, 0, problems),
    dedupeWindow: positive("dedupeWindow", options.dedupeWindow, 2_000, 0, problems),
    flushInterval: positive("flushInterval", options.flushInterval, 1_000, 0, problems),
    checks: options.checks ?? {},
    tracesSampleRate: sampleRate(options.tracesSampleRate ?? (env.NEX_TRACES_SAMPLE_RATE ? Number(env.NEX_TRACES_SAMPLE_RATE) : undefined), problems),
    checkTimeout: positive("checkTimeout", options.checkTimeout, 2_000, 1, problems),
    redactKeys: options.redactKeys ?? [],
    beforeSend: options.beforeSend,
    logger: options.logger === undefined ? { warn: (message) => console.warn(message) } : options.logger,
    debug: options.debug ?? false,
    // Resolved per call, so a fetch installed after construction (tests,
    // instrumentation) is honoured, and never invoked with the wrong `this`.
    fetch: options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
  };

  if (enabled && !options.fetch && typeof globalThis.fetch !== "function") problems.push("no fetch implementation available (Node 20+ or Bun required)");
  if (problems.length) throw new MonitoringConfigError(problems);
  return config;
}
