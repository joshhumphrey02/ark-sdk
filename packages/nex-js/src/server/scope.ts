/**
 * What is known when an error happens: who the user is, tags, the request
 * being handled, and the trail of breadcrumbs leading up to it.
 *
 * There is one process-wide scope, and each instrumented request gets its own
 * copy (AsyncLocalStorage), so one request's user and breadcrumbs never end
 * up on another request's error.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { Breadcrumb, MonitoringUser, RequestInfo } from "../shared/context";

export type { Breadcrumb, BreadcrumbLevel, MonitoringUser, RequestInfo } from "../shared/context";

export const MAX_BREADCRUMBS = 100;

export class Scope {
  user: MonitoringUser | null = null;
  tags: Record<string, string> = {};
  breadcrumbs: Breadcrumb[] = [];
  request: RequestInfo | null = null;
  transaction: string | null = null;

  /** A copy for a request: same user and tags, its own breadcrumbs. */
  fork(): Scope {
    const scope = new Scope();
    scope.user = this.user;
    scope.tags = { ...this.tags };
    scope.breadcrumbs = this.breadcrumbs.slice(-20);
    return scope;
  }

  addBreadcrumb(crumb: Breadcrumb, now: number) {
    this.breadcrumbs.push({ ...crumb, timestamp: crumb.timestamp ?? new Date(now).toISOString() });
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) this.breadcrumbs.splice(0, this.breadcrumbs.length - MAX_BREADCRUMBS);
  }
}

export class ScopeManager {
  readonly global = new Scope();
  readonly #storage = new AsyncLocalStorage<Scope>();

  get current(): Scope {
    return this.#storage.getStore() ?? this.global;
  }

  /** Runs `fn` with its own scope (a fork of the current one). */
  run<T>(fn: (scope: Scope) => T, scope = this.current.fork()): T {
    return this.#storage.run(scope, () => fn(scope));
  }

  /**
   * Gives the rest of the current execution its own scope. For `node:http`
   * servers, where the instrumentation runs before the application's own
   * request listener and cannot wrap it.
   */
  enter(scope = this.current.fork()): Scope {
    this.#storage.enterWith(scope);
    return scope;
  }
}
