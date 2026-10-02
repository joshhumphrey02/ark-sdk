/**
 * The OpenTelemetry trace an event happens in, when the application uses
 * OpenTelemetry. Read from the API's global registration, so the SDK needs no
 * dependency on `@opentelemetry/api` and costs nothing without it.
 *
 * With a trace id on every error, Nex can link an error to the request's
 * trace across services.
 */

const API_KEY = Symbol.for("opentelemetry.js.api.1");
const SPAN_KEY = Symbol.for("OpenTelemetry Context Key SPAN");

type SpanContext = { traceId?: string; spanId?: string; traceFlags?: number };
type OtelGlobal = { context?: { active?: () => { getValue?: (key: symbol) => unknown } | undefined } };

const INVALID_TRACE = /^0+$/;

export function activeTrace(): { traceId: string; spanId: string } | null {
  try {
    const api = (globalThis as Record<symbol, OtelGlobal | undefined>)[API_KEY];
    const span = api?.context?.active?.()?.getValue?.(SPAN_KEY) as { spanContext?: () => SpanContext } | undefined;
    const context = span?.spanContext?.();
    if (!context?.traceId || !context.spanId) return null;
    if (!/^[0-9a-f]{32}$/.test(context.traceId) || INVALID_TRACE.test(context.traceId)) return null;
    if (!/^[0-9a-f]{16}$/.test(context.spanId)) return null;
    return { traceId: context.traceId, spanId: context.spanId };
  } catch {
    return null;
  }
}
