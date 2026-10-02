/**
 * `@nerdstackgrp/nex-js/server` -- Nex for Node and Bun services: errors and
 * crashes with full context, heartbeats with the health of every database,
 * cache and broker behind the service, outgoing calls for the service map,
 * process vitals, background jobs, and releases.
 *
 * ```ts
 * import * as nex from "@nerdstackgrp/nex-js/server";
 *
 * nex.init({
 *   service: "orders-api", // NEX_API_URL and NEX_TOKEN from the environment
 *   checks: { database: nex.checks.postgres(pool), cache: nex.checks.redis(redis) },
 * });
 * ```
 */

export { Monitoring, SDK_NAME, SDK_VERSION, createMonitoring, deriveStatus } from "./client";
export { init, getClient, captureException, captureMessage, captureRequestError, setUser, setTag, addBreadcrumb, job, trace, metric, increment, gauge, flush, _resetForTesting } from "./global";
export { Span, formatTraceparent, parseTraceparent } from "../shared/trace";
export type { SpanAttributes, SpanKind, SpanPayload, SpanStatus, TraceContext } from "../shared/trace";
export type { InitOptions } from "./global";
export * as checks from "./checks";
export type { DependencyCheckDefinition, DependencyResult } from "./checks";
export { exceptionChain, parseStack } from "../shared/stacktrace";
export type { ExceptionPayload, InAppTest, StackFrame } from "../shared/stacktrace";
export type { Breadcrumb, BreadcrumbLevel, MonitoringUser, RequestInfo } from "./scope";
export type {
  BreadcrumbOptions,
  CaptureErrorOptions,
  CaptureExceptionOptions,
  CaptureOptions,
  HeartbeatOptions,
  JobOptions,
  MonitoringStats,
  SpanOptions,
  ReleaseOptions,
  StartOptions,
} from "./client";
export { MonitoringConfigError, normalizeEnvironment } from "./config";
export type { DependencyCheck, LoggerLike, MonitoringOptions, OutgoingEvent } from "./config";
export { normalizeError, isErrorLike } from "../shared/errors";
export type { NormalizedError } from "../shared/errors";
export { normalizeRoute } from "./http";
export type { HttpInstrumentationOptions, IncomingMessageLike, NodeHttpServerLike, ServerResponseLike } from "./http";
export type { UnhandledOptions } from "./process";
export { DEFAULT_SENSITIVE_KEY, REDACTED, boundMetadata, redact, redactBounded, redactString } from "../shared/redact";
export type { RedactOptions } from "../shared/redact";
export { MONITORING_EVENT_TYPES } from "../shared/types";
export type {
  ApiErrorBody,
  ApplicationConfigResponse,
  CallStats,
  CustomMetric,
  DependencyKind,
  DependencyReport,
  DependencyStatus,
  EventPayload,
  EventsResponse,
  HeartbeatPayload,
  HeartbeatResponse,
  JobStats,
  JsonObject,
  JsonValue,
  MonitoringEnvironment,
  MonitoringEventType,
  MonitoringLevel,
  MonitoringSeverity,
  MonitoringStatus,
  ReleasePayload,
  ReleaseResponse,
  RequestStats,
  RuntimeMetrics,
} from "../shared/types";
