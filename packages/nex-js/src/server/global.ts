/**
 * One client per process, set up once and used from anywhere:
 *
 * ```ts
 * import * as nex from "@nerdstackgrp/nex-js/server";
 *
 * nex.init({ service: "orders-api", checks: { database: nex.checks.postgres(pool) } });
 * nex.captureException(error);
 * ```
 *
 * The client is kept on `globalThis`, so frameworks that load a module more
 * than once (Next.js bundles instrumentation and routes separately) still
 * share one client, one buffer and one heartbeat.
 */

import { Monitoring, type CaptureExceptionOptions, type CaptureOptions, type JobOptions, type StartOptions } from "./client";
import type { MonitoringOptions } from "./config";
import type { Breadcrumb, MonitoringUser } from "./scope";
import type { MonitoringLevel } from "../shared/types";

const KEY = Symbol.for("nex-js.server.client");
type Holder = { [KEY]?: Monitoring };

export type InitOptions = MonitoringOptions & StartOptions & {
  /** Start heartbeats, crash reports and breadcrumbs right away. Default true. */
  autoStart?: boolean;
};

/**
 * Creates the process's client (from NEX_* environment variables when
 * options are omitted) and starts it. Calling it again returns the client
 * already running. Throws `MonitoringConfigError` once if misconfigured.
 */
export function init(options: InitOptions = {}): Monitoring {
  const holder = globalThis as Holder;
  const existing = holder[KEY];
  if (existing) return existing;
  const { autoStart, heartbeatInterval, captureUnhandled, breadcrumbs, serviceMap, runtimeMetrics, ...config } = options;
  const client = new Monitoring({ ...config, heartbeatInterval });
  holder[KEY] = client;
  if (autoStart !== false) client.start({ heartbeatInterval, captureUnhandled, breadcrumbs, serviceMap, runtimeMetrics });
  return client;
}

/** The client `init()` created, or `null` before it. */
export function getClient(): Monitoring | null {
  return (globalThis as Holder)[KEY] ?? null;
}

export function captureException(error: unknown, options?: CaptureExceptionOptions): boolean {
  return getClient()?.captureException(error, options) ?? false;
}

export function captureMessage(message: string, level?: MonitoringLevel, options?: Omit<CaptureOptions, "level">): boolean {
  return getClient()?.captureMessage(message, level, options) ?? false;
}

export function setUser(user: MonitoringUser | null): void {
  getClient()?.setUser(user);
}

export function setTag(key: string, value: string | number | boolean): void {
  getClient()?.setTag(key, value);
}

export function addBreadcrumb(crumb: Breadcrumb): void {
  getClient()?.addBreadcrumb(crumb);
}

/** Runs `fn` as a tracked job; without a client it just runs `fn`. */
export async function job<T>(name: string, fn: () => T | Promise<T>, options?: JobOptions): Promise<T | undefined> {
  const client = getClient();
  return client ? client.job(name, fn, options) : fn();
}

/** For Next.js `instrumentation.ts`: `export const onRequestError = nex.captureRequestError;` */
export function captureRequestError(...args: Parameters<Monitoring["captureRequestError"]>): void {
  getClient()?.captureRequestError(...args);
}

export function flush(timeoutMs?: number): Promise<boolean> {
  return getClient()?.flush(timeoutMs) ?? Promise.resolve(true);
}

/** Tests only: forgets the client. */
export function _resetForTesting(): void {
  delete (globalThis as Holder)[KEY];
}
