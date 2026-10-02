/**
 * The monitoring API contract (nerdstack-technologies, docs/monitoring/API.md),
 * relative to the configured `MONITORING_API_URL`.
 *
 * These types describe what goes over the wire. They are exported so a
 * caller can build payloads or read responses with the same names the server
 * uses.
 */

/** Severity as the API stores it. */
export type MonitoringSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

/** Severity as callers write it: `captureMessage("…", "warning")`. */
export type MonitoringLevel = "info" | "warning" | "error" | "critical";

export const MONITORING_EVENT_TYPES = [
  "exception",
  "error",
  "message",
  "warning",
  "startup",
  "shutdown",
  "dependency_failure",
  "performance",
  "security",
  "custom",
] as const;
export type MonitoringEventType = (typeof MONITORING_EVENT_TYPES)[number];

/** What a service reports about itself in a heartbeat. */
export type MonitoringStatus = "healthy" | "degraded" | "unhealthy" | "down";

/** Health of one dependency. `unknown` when it could not be determined. */
export type DependencyStatus = MonitoringStatus | "unknown";

/**
 * The environment names the SDK normalises to. A token is scoped to one
 * environment, so the server uses the token's own when none is sent.
 */
export type MonitoringEnvironment = "production" | "staging" | "development";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// --- Request bodies ------------------------------------------------------------

/** Kinds of dependency Nex draws with their own icon. Anything else is accepted too. */
export type DependencyKind =
  | "postgres"
  | "mysql"
  | "mongodb"
  | "redis"
  | "rabbitmq"
  | "kafka"
  | "elasticsearch"
  | "http"
  | "tcp"
  | "s3"
  | "smtp"
  | "other";

/** One dependency's health, as a heartbeat reports it. */
export interface DependencyReport {
  status: DependencyStatus;
  kind?: DependencyKind | (string & {});
  /** Where it is, without credentials: "db.internal:5432", "https://api.paystack.co". */
  target?: string;
  /** How long the check took. */
  latencyMs?: number;
  /** Numbers worth graphing: queue depth, consumers, pool usage, memory… */
  metrics?: Record<string, number>;
  /** Why it failed, when it did. */
  error?: string;
}

/** Outgoing calls to one target since the previous heartbeat (the service map's edges). */
export interface CallStats {
  /** Origin or host:port: "https://api.example.com", "payments:8080". */
  target: string;
  kind: "http" | (string & {});
  count: number;
  /** 5xx answers and calls that failed outright. */
  errors: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/** The process itself. */
export interface RuntimeMetrics {
  rssMb?: number;
  heapUsedMb?: number;
  heapTotalMb?: number;
  /** CPU used since the previous heartbeat, as a percentage of one core. */
  cpuPercent?: number;
  /** Event loop delay (p99) since the previous heartbeat. */
  eventLoopLagMs?: number;
  threads?: number;
}

/** Runs of one background job since the previous heartbeat. */
export interface JobStats {
  name: string;
  count: number;
  failed: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  lastRunAt: string;
  lastFailedAt?: string;
}

/** `POST {apiUrl}/heartbeat` */
export interface HeartbeatPayload {
  service: string;
  /** A specific HEARTBEAT/CRON monitor, e.g. a cron job's check-in. */
  monitor?: string;
  status: MonitoringStatus;
  version?: string;
  /** Seconds since the process started. */
  uptime?: number;
  /** Milliseconds the service took to run its own health checks. */
  responseTime?: number;
  environment?: MonitoringEnvironment;
  /** A status per dependency, or a full report (servers before 2026-10 take statuses only). */
  dependencies?: Record<string, DependencyStatus | DependencyReport>;
  /** Outgoing calls by target since the previous heartbeat. */
  calls?: CallStats[];
  runtime?: RuntimeMetrics;
  jobs?: JobStats[];
  /** When the heartbeat was produced. Informational; the server stamps receipt. */
  timestamp?: string;
}

/** One event in `POST {apiUrl}/events`. */
export interface EventPayload {
  type: MonitoringEventType;
  severity: MonitoringSeverity;
  message: string;
  service?: string;
  environment?: MonitoringEnvironment;
  /** The release (version) that produced the event. */
  release?: string;
  error?: { name?: string; message?: string; stack?: string };
  metadata?: JsonObject;
  /** ISO-8601 with offset. */
  timestamp?: string;
  // --- Context (servers before 2026-10 ignore these) ---
  /** The error and its causes, outermost first, with stack frames (most recent call first). */
  exception?: {
    type: string;
    value: string;
    mechanism?: { type: string; handled: boolean };
    stacktrace?: { frames: { function?: string; filename?: string; lineno?: number; colno?: number; inApp: boolean }[] };
  }[];
  /** False when a crash handler caught it rather than the application. */
  handled?: boolean;
  breadcrumbs?: { timestamp?: string; type?: string; category?: string; level?: string; message?: string; data?: JsonObject }[];
  request?: { method?: string; url?: string; route?: string; status?: number; userAgent?: string };
  user?: { id?: string; username?: string; email?: string };
  tags?: Record<string, string>;
  contexts?: JsonObject;
  /** What was running: "GET /orders/:id", a job name. */
  transaction?: string;
  /** OpenTelemetry trace and span, when the application uses OpenTelemetry. */
  traceId?: string;
  spanId?: string;
  /** Overrides grouping: events with the same parts are one issue. */
  fingerprint?: string[];
  sdk?: { name: string; version: string };
}

/** `POST {apiUrl}/releases` */
export interface ReleasePayload {
  version: string;
  commitSha?: string;
  /** Older name for commitSha; still accepted. */
  commit?: string;
  service?: string;
  environment?: MonitoringEnvironment;
  /** ISO-8601 with offset. */
  deployedAt?: string;
}

// --- Responses -------------------------------------------------------------------

export interface HeartbeatResponse {
  ok: true;
  service: string;
  monitor: string;
  environment: string;
  receivedAt: string;
  /** How often the server expects a heartbeat from this service. */
  expectedIntervalSeconds: number;
}

export interface EventsResponse {
  ok: true;
  accepted: number;
  events: { id: string; fingerprint: string }[];
}

export interface ReleaseResponse {
  ok: true;
  release: {
    id: string;
    applicationId: string;
    application: string;
    environmentId: string;
    environment: string;
    serviceId: string | null;
    service: string | null;
    version: string;
    previousVersion: string | null;
    commitSha: string | null;
    deployedAt: string;
  };
}

/** `GET {apiUrl}/config` */
export interface ApplicationConfigResponse {
  application: {
    id: string;
    slug: string;
    name: string;
    ownership: "OWNED" | "MANAGED";
    maintenance: boolean;
  };
  /** The environment this token reports for. */
  environment: { id: string; slug: string; name: string; kind: "PRODUCTION" | "STAGING" | "DEVELOPMENT" };
  services: {
    slug: string;
    name: string;
    type: string;
    monitors: { slug: string; type: "HTTP" | "API" | "TCP" | "HEARTBEAT" | "CRON" | "WEBSITE"; enabled: boolean }[];
    heartbeatIntervalSeconds: number;
  }[];
  limits: { maxBodyBytes: number; maxEventsPerRequest: number; messageChars: number; stackChars: number };
  endpoints: Record<string, string>;
}

/** The error body every non-2xx response carries. */
export interface ApiErrorBody {
  detail: string;
}
