/**
 * `@nerdstackgrp/nex-js/client` -- Nex for web frontends: crashes and errors
 * with the page, browser, user and the clicks, navigations, requests and
 * console output that led to them.
 *
 * ```ts
 * import * as nex from "@nerdstackgrp/nex-js/client";
 *
 * nex.init({ key: process.env.NEXT_PUBLIC_NEX_KEY, release: process.env.NEXT_PUBLIC_APP_VERSION });
 * nex.setUser({ id: user.id });
 * ```
 *
 * In Next.js, call `init()` from `instrumentation-client.ts`, and report
 * render errors from `app/global-error.tsx` / `error.tsx` with
 * `nex.captureException(error)` (or use `ErrorBoundary` from
 * `@nerdstackgrp/nex-js/react`).
 */

import { BrowserClient, type BrowserCaptureOptions, type BrowserOptions } from "./browser";
import type { Breadcrumb, MonitoringUser } from "../shared/context";
import type { MonitoringLevel } from "../shared/types";

export { BrowserClient, DEFAULT_API_URL, KEY_PATTERN, SDK_NAME, SDK_VERSION } from "./browser";
export type { BrowserCaptureOptions, BrowserOptions } from "./browser";
export { parseBrowser, parseOs } from "./context";
export { describeElement } from "./integrations";
export { exceptionChain, parseStack } from "../shared/stacktrace";
export type { ExceptionPayload, StackFrame } from "../shared/stacktrace";
export type { Breadcrumb, BreadcrumbLevel, MonitoringUser } from "../shared/context";
export type { EventPayload, MonitoringLevel } from "../shared/types";

const KEY = Symbol.for("nex-js.client");
type Holder = { [KEY]?: BrowserClient };

/**
 * Starts reporting from this page. Calling it again returns the running
 * client. Without a valid key it warns once and does nothing else.
 */
export function init(options: BrowserOptions): BrowserClient {
  const holder = globalThis as Holder;
  if (holder[KEY]) return holder[KEY];
  const client = new BrowserClient(options).install();
  holder[KEY] = client;
  return client;
}

export function getClient(): BrowserClient | null {
  return (globalThis as Holder)[KEY] ?? null;
}

export function captureException(error: unknown, options?: BrowserCaptureOptions): boolean {
  return getClient()?.captureException(error, options) ?? false;
}

export function captureMessage(message: string, level?: MonitoringLevel, options?: Omit<BrowserCaptureOptions, "level">): boolean {
  return getClient()?.captureMessage(message, level, options) ?? false;
}

export function setUser(user: MonitoringUser | null): void {
  getClient()?.setUser(user);
}

export function setTag(key: string, value: string | number | boolean): void {
  getClient()?.setTag(key, value);
}

export function setTags(tags: Record<string, string | number | boolean>): void {
  getClient()?.setTags(tags);
}

export function setTransaction(name: string | null): void {
  getClient()?.setTransaction(name);
}

export function addBreadcrumb(crumb: Breadcrumb): void {
  getClient()?.addBreadcrumb(crumb);
}

export function flush(): Promise<void> {
  return getClient()?.flush() ?? Promise.resolve();
}

/** Removes the integrations and forgets the client (tests, hot reload). */
export function close(): void {
  getClient()?.close();
  delete (globalThis as Holder)[KEY];
}
