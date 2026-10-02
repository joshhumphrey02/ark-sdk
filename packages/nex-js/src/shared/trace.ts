/**
 * Distributed tracing, the small part of it Nex needs: W3C trace context
 * (`traceparent`) in and out, spans with ids, timing, status and a few
 * attributes, and a sampling decision made once per trace and carried
 * along by the `sampled` flag so every service keeps or drops the same
 * traces.
 *
 * Works the same in Node, Bun and browsers (Web Crypto for ids). When the
 * application uses OpenTelemetry, use OpenTelemetry for spans; Nex still
 * links errors to its trace ids.
 */

import { redactBounded, truncate } from "./redact";

export type SpanKind = "server" | "client" | "internal" | "producer" | "consumer";
export type SpanStatus = "ok" | "error";
export type SpanAttributes = Record<string, string | number | boolean>;

/** A finished span, as `POST /spans` takes it. */
export type SpanPayload = {
  traceId: string;
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  kind: SpanKind;
  status: SpanStatus;
  startTime: string;
  durationMs: number;
  service?: string;
  attributes?: SpanAttributes;
};

export type TraceContext = { traceId: string; spanId: string; sampled: boolean };

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

function hex(bytes: number): string {
  const array = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(array);
  let out = "";
  for (const byte of array) out += byte.toString(16).padStart(2, "0");
  return out;
}

export function newTraceId(): string {
  let id = hex(16);
  while (/^0+$/.test(id)) id = hex(16);
  return id;
}

export function newSpanId(): string {
  let id = hex(8);
  while (/^0+$/.test(id)) id = hex(8);
  return id;
}

/** `traceparent` → context, or null when absent or malformed (then a new trace starts). */
export function parseTraceparent(header: string | null | undefined): TraceContext | null {
  const match = TRACEPARENT.exec((header ?? "").trim().toLowerCase());
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return null;
  return { traceId: match[1], spanId: match[2], sampled: (parseInt(match[3], 16) & 1) === 1 };
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

/** Keep `rate` of new traces. Inherited decisions win: a trace is kept or dropped everywhere. */
export function sample(rate: number, parent: TraceContext | null): boolean {
  if (parent) return parent.sampled;
  return rate >= 1 ? true : rate <= 0 ? false : Math.random() < rate;
}

const MAX_ATTRIBUTES = 32;

export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly sampled: boolean;
  readonly kind: SpanKind;
  name: string;
  status: SpanStatus = "ok";
  readonly attributes: SpanAttributes = {};
  readonly #startedAt: number;
  readonly #startedPerf: number;
  #ended = false;
  readonly #onEnd: (span: Span, payload: SpanPayload) => void;

  constructor(options: { name: string; kind: SpanKind; parent: TraceContext | null; sampled: boolean; onEnd: (span: Span, payload: SpanPayload) => void; startTime?: number }) {
    this.name = truncate(options.name, 300);
    this.kind = options.kind;
    this.traceId = options.parent?.traceId ?? newTraceId();
    this.parentSpanId = options.parent?.spanId ?? null;
    this.spanId = newSpanId();
    this.sampled = options.sampled;
    this.#startedAt = options.startTime ?? Date.now();
    this.#startedPerf = performance.now() - (Date.now() - this.#startedAt);
    this.#onEnd = options.onEnd;
  }

  get context(): TraceContext {
    return { traceId: this.traceId, spanId: this.spanId, sampled: this.sampled };
  }

  get traceparent(): string {
    return formatTraceparent(this.context);
  }

  get ended(): boolean {
    return this.#ended;
  }

  setAttribute(key: string, value: string | number | boolean | null | undefined): this {
    if (value === null || value === undefined) return this;
    if (Object.keys(this.attributes).length >= MAX_ATTRIBUTES && !(key in this.attributes)) return this;
    this.attributes[truncate(key, 100)] = typeof value === "string" ? redactBounded(value, 500) : value;
    return this;
  }

  setStatus(status: SpanStatus): this {
    this.status = status;
    return this;
  }

  /** Ends the span once; later calls do nothing. Unsampled spans are never sent. */
  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    if (!this.sampled) return;
    const durationMs = Math.max(0, Math.round((performance.now() - this.#startedPerf) * 1000) / 1000);
    try {
      this.#onEnd(this, {
        traceId: this.traceId,
        spanId: this.spanId,
        parentSpanId: this.parentSpanId,
        name: this.name,
        kind: this.kind,
        status: this.status,
        startTime: new Date(this.#startedAt).toISOString(),
        durationMs,
        ...(Object.keys(this.attributes).length ? { attributes: { ...this.attributes } } : {}),
      });
    } catch {
      // Recording a span never breaks the code it measures.
    }
  }
}

/** Whether a request to `url` should carry `traceparent`: same origin, or a listed target. */
export function shouldPropagate(url: string, pageOrigin: string | null, targets: (string | RegExp)[]): boolean {
  let origin: string | null = null;
  try {
    origin = new URL(url, pageOrigin ?? undefined).origin;
  } catch {
    return false;
  }
  if (pageOrigin && origin === pageOrigin) return true;
  return targets.some((t) => (typeof t === "string" ? url.startsWith(t) || origin === t : t.test(url)));
}
