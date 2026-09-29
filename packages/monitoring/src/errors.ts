/**
 * Turning whatever was thrown into `{ name, message, stack }`.
 *
 * JavaScript can throw anything: Errors, strings, plain objects, `undefined`.
 * None of that may crash the reporter, and none of it may be sent unbounded.
 */

import { redactBounded, truncate } from "./redact";

export type NormalizedError = { name: string; message: string; stack?: string };

export const ERROR_LIMITS = { name: 200, message: 4_000, stack: 16_000 } as const;
const MAX_CAUSES = 3;

type ErrorLike = { name?: unknown; message: string; stack?: unknown; cause?: unknown };

/** An Error, or anything shaped like one (cross-realm errors, library error objects). */
export function isErrorLike(value: unknown): value is ErrorLike {
  return (
    value instanceof Error ||
    (typeof value === "object" && value !== null && typeof (value as { message?: unknown }).message === "string")
  );
}

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // Circular or throwing toJSON: fall through.
  }
  try {
    return String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

export function normalizeError(value: unknown): NormalizedError {
  if (!isErrorLike(value)) {
    return { name: "NonError", message: redactBounded(safeString(value), ERROR_LIMITS.message) };
  }

  const name = typeof value.name === "string" && value.name ? value.name : "Error";
  let stack = typeof value.stack === "string" ? value.stack : undefined;

  // Follow `cause` a few levels so "failed to save order" carries the
  // "connection refused" that actually happened.
  let cause = value.cause;
  for (let depth = 0; depth < MAX_CAUSES && cause !== undefined; depth++) {
    const inner = isErrorLike(cause) ? cause : null;
    const line = inner
      ? (typeof inner.stack === "string" ? inner.stack : `${typeof inner.name === "string" ? inner.name : "Error"}: ${inner.message}`)
      : safeString(cause);
    stack = `${stack ?? `${name}: ${value.message}`}\nCaused by: ${line}`;
    cause = inner?.cause;
  }

  return {
    name: truncate(name, ERROR_LIMITS.name),
    message: redactBounded(value.message, ERROR_LIMITS.message),
    stack: stack === undefined ? undefined : redactBounded(stack, ERROR_LIMITS.stack),
  };
}
