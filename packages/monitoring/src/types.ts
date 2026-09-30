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
  dependencies?: Record<string, DependencyStatus>;
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
