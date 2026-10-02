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

export { Monitoring, SDK_NAME, SDK_VERSION, createMonitoring, deriveStatus } from "./client";
export { exceptionChain, parseStack } from "./stacktrace";
export type { ExceptionPayload, StackFrame } from "./stacktrace";
export type { Breadcrumb, BreadcrumbLevel, MonitoringUser, RequestInfo } from "./scope";
export type {
  BreadcrumbOptions,
  CaptureErrorOptions,
  CaptureExceptionOptions,
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
