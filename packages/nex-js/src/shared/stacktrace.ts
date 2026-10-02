/**
 * Stack traces as frames, and errors as a chain (the error, then its
 * `cause`s), in the shape the API groups and displays.
 *
 * Grouping happens on the server from the error type and the top "in app"
 * frames, so marking library and runtime frames correctly here is what keeps
 * one bug one issue.
 */

import { redactBounded, truncate } from "./redact";
import { isErrorLike } from "./errors";

export type StackFrame = {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  inApp: boolean;
};

export type ExceptionPayload = {
  type: string;
  value: string;
  mechanism?: { type: string; handled: boolean };
  stacktrace?: { frames: StackFrame[] };
};

const MAX_FRAMES = 50;
const MAX_CHAIN = 5;

const NOT_IN_APP = [/(^|[\\/])node_modules[\\/]/, /^node:/, /^internal[\\/]/, /^native$/, /(^|[\\/])bun:/, /^<anonymous>$/];

/** Whether a frame is the application's own code. Server default: not node_modules or the runtime. */
export type InAppTest = (filename: string) => boolean;

export function isInApp(filename: string | undefined): boolean {
  return Boolean(filename) && !NOT_IN_APP.some((pattern) => pattern.test(filename!));
}

// V8 (Node, Bun, Chrome, Edge): "    at fn (file:1:2)" / "    at file:1:2".
const V8_WITH_FN = /^\s*at (?:async )?(.+?) \((.+?):(\d+):(\d+)\)\s*$/;
const V8_NO_FN = /^\s*at (?:async )?(.+?):(\d+):(\d+)\s*$/;
// Gecko and JavaScriptCore (Firefox, Safari): "fn@file:1:2" / "@file:1:2".
const GECKO = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

/** Stack text → frames, most recent call first. */
export function parseStack(stack: string | undefined, inApp: InAppTest = (filename) => isInApp(filename)): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  const push = (fn: string | undefined, file: string, line: string, col: string) => {
    const filename = file.replace(/^file:\/\//, "");
    const name = fn?.trim();
    frames.push({
      ...(name ? { function: truncate(name, 200) } : {}),
      filename: truncate(filename, 500),
      lineno: Number(line),
      colno: Number(col),
      inApp: inApp(filename),
    });
  };
  for (const line of stack.split("\n")) {
    if (/^\s*Caused by:/.test(line)) break;
    let match = V8_WITH_FN.exec(line);
    if (match) push(match[1], match[2], match[3], match[4]);
    else if ((match = V8_NO_FN.exec(line))) push(undefined, match[1], match[2], match[3]);
    else if (!/^\s*at /.test(line) && (match = GECKO.exec(line))) push(match[1], match[2], match[3], match[4]);
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

function describeValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The thrown value and its causes, outermost first. The first carries how it
 * was caught (`mechanism`): handled by the application, or a crash.
 */
export function exceptionChain(error: unknown, mechanism: { type: string; handled: boolean }, inApp?: InAppTest): ExceptionPayload[] {
  const chain: ExceptionPayload[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current !== undefined && current !== null && chain.length < MAX_CHAIN && !seen.has(current)) {
    seen.add(current);
    if (isErrorLike(current)) {
      const name = typeof current.name === "string" && current.name ? current.name : "Error";
      const frames = parseStack(typeof current.stack === "string" ? current.stack : undefined, inApp);
      chain.push({
        type: truncate(name, 200),
        value: redactBounded(current.message, 4_000),
        ...(chain.length === 0 ? { mechanism } : {}),
        ...(frames.length ? { stacktrace: { frames } } : {}),
      });
      current = current.cause;
    } else {
      chain.push({ type: "NonError", value: redactBounded(describeValue(current), 4_000), ...(chain.length === 0 ? { mechanism } : {}) });
      break;
    }
  }
  return chain;
}
