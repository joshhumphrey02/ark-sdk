/**
 * Opt-in reporting of fatal errors: `uncaughtException` and
 * `unhandledRejection`.
 *
 * The hard requirement: monitoring must never keep a crashed process alive.
 * In Node, *adding* a listener for either event switches off the default
 * crash, so a naive reporter turns a fatal error into a zombie process. This
 * one reports, waits briefly for delivery, then restores the default outcome:
 *
 * - `uncaughtException`: if no other listener handles it, print the error the
 *   way Node does and exit with code 1. If the application has its own
 *   listener, that listener owns the outcome and this one only reports.
 * - `unhandledRejection`: Node's default (`--unhandled-rejections=throw`) is to
 *   raise the reason as an uncaught exception, so it is re-thrown from a fresh
 *   tick, which follows exactly that path. `warn` and `none` modes are
 *   respected, and so are other listeners.
 *
 * The wait for delivery is bounded (default 2s): an unreachable monitoring
 * server delays a crash by at most that, never indefinitely.
 */

type ProcessLike = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
  listenerCount(event: string): number;
  exit(code?: number): never;
  exitCode?: number | string;
  execArgv?: string[];
  env?: Record<string, string | undefined>;
  stderr?: { write(chunk: string): unknown };
};

export type UnhandledOptions = {
  /** Longest a crash waits for the report to be delivered. Default 2000ms. */
  flushTimeout?: number;
  /** Report `uncaughtException`. Default true. */
  uncaughtException?: boolean;
  /** Report `unhandledRejection`. Default true. */
  unhandledRejection?: boolean;
};

export type FatalReporter = {
  report(error: unknown, origin: "uncaughtException" | "unhandledRejection"): void;
  flush(timeoutMs: number): Promise<unknown>;
};

function currentProcess(): ProcessLike | null {
  const proc = (globalThis as { process?: ProcessLike }).process;
  return proc && typeof proc.on === "function" ? proc : null;
}

/** The `--unhandled-rejections` mode in effect; Node's default is `throw`. */
export function unhandledRejectionMode(proc: Pick<ProcessLike, "execArgv" | "env">): string {
  const flags = [...(proc.execArgv ?? []), ...(proc.env?.NODE_OPTIONS ?? "").split(/\s+/)];
  for (const flag of flags) {
    const match = /^--unhandled-rejections=(\S+)$/.exec(flag);
    if (match) return match[1];
  }
  return "throw";
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.stack ?? `${error.name}: ${error.message}`;
  try {
    return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** Installs the handlers and returns a function that removes them. */
export function installFatalHandlers(reporter: FatalReporter, options: UnhandledOptions = {}, proc = currentProcess()): () => void {
  if (!proc) return () => {};
  const flushTimeout = options.flushTimeout ?? 2_000;
  const listeners: [string, (...args: unknown[]) => void][] = [];

  if (options.uncaughtException !== false) {
    const onUncaught = (error: unknown) => {
      reporter.report(error, "uncaughtException");
      // Other listeners already ran (listeners are synchronous and ran in
      // order); if any exist, the application has chosen to handle this.
      if (proc.listenerCount("uncaughtException") > 1) return;
      void reporter.flush(flushTimeout).finally(() => {
        proc.stderr?.write(`${describe(error)}\n`);
        proc.exit(1);
      });
    };
    proc.on("uncaughtException", onUncaught);
    listeners.push(["uncaughtException", onUncaught]);
  }

  if (options.unhandledRejection !== false) {
    const onRejection = (reason: unknown) => {
      reporter.report(reason, "unhandledRejection");
      if (proc.listenerCount("unhandledRejection") > 1) return;
      const mode = unhandledRejectionMode(proc);
      if (mode === "none" || mode === "warn") return;
      if (mode === "warn-with-error-code") {
        proc.exitCode = 1;
        return;
      }
      // `throw` / `strict`: re-raise as an uncaught exception, exactly what
      // Node would have done without this listener.
      void reporter.flush(flushTimeout).finally(() => {
        setTimeout(() => {
          throw reason;
        }, 0);
      });
    };
    proc.on("unhandledRejection", onRejection);
    listeners.push(["unhandledRejection", onRejection]);
  }

  return () => {
    for (const [event, listener] of listeners) proc.removeListener(event, listener);
  };
}
