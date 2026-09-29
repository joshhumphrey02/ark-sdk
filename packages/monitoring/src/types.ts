/**
 * The Nerdstack Monitoring API contract, as implemented by the control plane
 * at `/api/v1/monitoring/*` (nerdstack-technologies, docs/monitoring/api.md).
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

/** The only environments the API accepts. */
export type MonitoringEnvironment = "production" | "staging" | "development";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// --- Request bodies ------------------------------------------------------------

/** `POST /api/v1/monitoring/heartbeat` */
export interface HeartbeatPayload {
  service: string;
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

/** One event in `POST /api/v1/monitoring/events`. */
export interface EventPayload {
  type: MonitoringEventType;
  severity: MonitoringSeverity;
  message: string;
  service?: string;
  environment?: MonitoringEnvironment;
  error?: { name?: string; message?: string; stack?: string };
  metadata?: JsonObject;
  /** ISO-8601 with offset. */
  timestamp?: string;
}

/** `POST /api/v1/monitoring/releases` */
export interface ReleasePayload {
  version: string;
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
    serviceId: string | null;
    service: string | null;
    version: string;
    previousVersion: string | null;
    commit: string | null;
    environment: string | null;
    deployedAt: string;
  };
}

/** `GET /api/v1/monitoring/config` */
export interface ApplicationConfigResponse {
  application: {
    id: string;
    slug: string;
    name: string;
    environment: "PRODUCTION" | "STAGING" | "DEVELOPMENT";
    ownership: "OWNED" | "MANAGED";
    maintenance: boolean;
  };
  services: {
    slug: string;
    name: string;
    type: string;
    kind: "SERVICE" | "WEBSITE";
    enabled: boolean;
    heartbeatIntervalSeconds: number;
  }[];
  limits: { maxBodyBytes: number; maxEventsPerRequest: number; messageChars: number; stackChars: number };
  endpoints: Record<string, string>;
}

/** The error body every non-2xx response carries. */
export interface ApiErrorBody {
  detail: string;
}
