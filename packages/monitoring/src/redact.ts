/**
 * Redaction and size bounding for everything the SDK sends.
 *
 * Two layers, both applied to every event:
 *
 * - **Keys.** A value under a key that looks like a credential (password,
 *   token, authorization, cookie, api key, secret, session, private key, …)
 *   is replaced by `"[redacted]"`, at any depth.
 * - **Values.** Strings are scanned for credential shapes that turn up in
 *   error messages and stack traces: bearer tokens, Nerdstack monitoring
 *   tokens, JWTs, `password=…` pairs, and `user:pass@` in URLs.
 *
 * The server redacts too. This is the first line, so a secret never leaves
 * the process in the first place.
 */

import type { JsonObject, JsonValue } from "./types";

export const REDACTED = "[redacted]";

/**
 * Keys whose values are never sent. Case-insensitive. Written to catch
 * `password`, `x-api-key`, `setCookie`, `sessionId`, `client_secret`, while
 * leaving ordinary keys such as `author` or `passengers` alone.
 */
export const DEFAULT_SENSITIVE_KEY =
  /^pass$|passw(or)?d|passphrase|secret|token|^auth$|authori[sz]ation|cookie|api[-_]?key|access[-_]?key|credential|private[-_]?key|^session$|session[-_]?(id|token|key|secret)|signature|jwt|bearer|card[-_]?number|^cvv$|^ssn$/i;

const VALUE_PATTERNS: [RegExp, string][] = [
  // Monitoring tokens, including our own.
  [/nsk_(live|test)_[A-Za-z0-9_-]{16,}/g, REDACTED],
  // Ark API tokens.
  [/ark_(live|test)_[A-Za-z0-9_-]{16,}/g, REDACTED],
  // Authorization header values.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // JWTs.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  // key=value / key: value pairs for credential-looking keys.
  [
    /\b(password|passwd|pwd|secret|token|api[-_]?key|access[-_]?key|client[-_]?secret)(["']?\s*[:=]\s*["']?)([^\s"'&,;]+)/gi,
    `$1$2${REDACTED}`,
  ],
  // Credentials embedded in URLs. Scheme and userinfo lengths are bounded so
  // the pattern stays linear on long input (an unbounded `[a-z0-9+.-]*` here
  // backtracks quadratically and stalled on a 100KB stack trace).
  [/([a-z][a-z0-9+.-]{0,20}:\/\/)[^\s/:@]{1,256}:[^\s/@]{1,256}@/gi, `$1${REDACTED}@`],
];

/**
 * Characters kept beyond a length limit while redacting, so a secret that
 * straddles the cut is still recognised whole before the text is shortened.
 */
const REDACTION_MARGIN = 512;

/**
 * Redacts and truncates to `max`. Cuts first (with a margin), so redaction
 * cost is bounded by the limit rather than by whatever length was passed in.
 */
export function redactBounded(value: string, max: number): string {
  return truncate(redactString(value.length > max + REDACTION_MARGIN ? value.slice(0, max + REDACTION_MARGIN) : value), max);
}

/** Replaces credential-shaped substrings in free text. */
export function redactString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of VALUE_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

export type RedactOptions = {
  /** Extra keys to redact, as exact names (case-insensitive) or patterns. */
  keys?: Array<string | RegExp>;
  maxDepth?: number;
  maxStringLength?: number;
  maxArrayLength?: number;
  maxKeys?: number;
};

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function keyMatcher(extra: Array<string | RegExp> | undefined): (key: string) => boolean {
  const names = new Set((extra ?? []).filter((k): k is string => typeof k === "string").map((k) => k.toLowerCase()));
  const patterns = (extra ?? []).filter((k): k is RegExp => k instanceof RegExp);
  return (key) => DEFAULT_SENSITIVE_KEY.test(key) || names.has(key.toLowerCase()) || patterns.some((p) => p.test(key));
}

/**
 * Turns any value into bounded, redacted JSON. Never throws: cycles,
 * functions, symbols and BigInts become placeholders instead of errors.
 */
export function redact(value: unknown, options: RedactOptions = {}): JsonValue {
  const maxDepth = options.maxDepth ?? 6;
  const maxString = options.maxStringLength ?? 1_000;
  const maxArray = options.maxArrayLength ?? 50;
  const maxKeys = options.maxKeys ?? 100;
  const sensitive = keyMatcher(options.keys);
  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): JsonValue => {
    if (input === null || input === undefined) return null;
    switch (typeof input) {
      case "string":
        return redactBounded(input, maxString);
      case "number":
        return Number.isFinite(input) ? input : null;
      case "boolean":
        return input;
      case "bigint":
        return input.toString();
      case "function":
      case "symbol":
        return null;
    }
    if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input.toISOString();
    if (input instanceof Error) {
      return { name: input.name, message: redactBounded(input.message, maxString) };
    }
    if (typeof input !== "object") return null;
    if (seen.has(input)) return "[circular]";
    if (depth >= maxDepth) return "[truncated]";
    seen.add(input);

    if (Array.isArray(input)) {
      return input.slice(0, maxArray).map((item) => walk(item, depth + 1));
    }
    // Maps, Sets, Buffers and class instances are reduced to their own
    // enumerable properties; nothing is invoked.
    const out: JsonObject = {};
    let count = 0;
    for (const [key, item] of Object.entries(input as Record<string, unknown>)) {
      if (count++ >= maxKeys) break;
      out[truncate(key, 100)] = sensitive(key) ? REDACTED : walk(item, depth + 1);
    }
    return out;
  };

  return walk(value, 0);
}

/**
 * Redacts and bounds metadata to at most `maxBytes` once serialised. When it
 * is still too large, it is replaced by a marker naming its top-level keys, so
 * the event still sends rather than being rejected by the server.
 */
export function boundMetadata(value: unknown, options: RedactOptions & { maxBytes?: number } = {}): JsonObject | undefined {
  if (value === null || value === undefined) return undefined;
  const clean = redact(value, options);
  const object: JsonObject = clean !== null && typeof clean === "object" && !Array.isArray(clean) ? clean : { value: clean };
  const maxBytes = options.maxBytes ?? 8_000;
  const size = byteLength(JSON.stringify(object));
  if (size <= maxBytes) return object;
  return { _truncated: true, _originalBytes: size, keys: Object.keys(object).slice(0, 20) };
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
