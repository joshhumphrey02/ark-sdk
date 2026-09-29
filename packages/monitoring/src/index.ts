/**
 * `@nerdstackgrp/monitoring` -- report heartbeats, errors, releases and HTTP
 * metrics from a Node or Bun service to Nerdstack Monitoring.
 *
 * ```ts
 * import { createMonitoring } from "@nerdstackgrp/monitoring";
 *
 * const monitoring = createMonitoring({
 *   endpoint: process.env.MONITORING_URL!,
 *   token: process.env.MONITORING_TOKEN!,
 *   service: "ark-api",
 * });
 * monitoring.start();
 * ```
 */

export { Monitoring, createMonitoring, deriveStatus } from "./client";
export type {
  CaptureErrorOptions,
  CaptureOptions,
  HeartbeatOptions,
  MonitoringStats,
  ReleaseOptions,
  StartOptions,
} from "./client";
export { MonitoringConfigError, normalizeEnvironment } from "./config";
export type { DependencyCheck, LoggerLike, MonitoringOptions, OutgoingEvent } from "./config";
export { normalizeError, isErrorLike } from "./errors";
export type { NormalizedError } from "./errors";
export { normalizeRoute } from "./http";
export type { HttpInstrumentationOptions, IncomingMessageLike, NodeHttpServerLike, ServerResponseLike } from "./http";
export type { UnhandledOptions } from "./process";
export { DEFAULT_SENSITIVE_KEY, REDACTED, boundMetadata, redact, redactBounded, redactString } from "./redact";
export type { RedactOptions } from "./redact";
export { MONITORING_EVENT_TYPES } from "./types";
export type {
  ApiErrorBody,
  ApplicationConfigResponse,
  DependencyStatus,
  EventPayload,
  EventsResponse,
  HeartbeatPayload,
  HeartbeatResponse,
  JsonObject,
  JsonValue,
  MonitoringEnvironment,
  MonitoringEventType,
  MonitoringLevel,
  MonitoringSeverity,
  MonitoringStatus,
  ReleasePayload,
  ReleaseResponse,
} from "./types";
