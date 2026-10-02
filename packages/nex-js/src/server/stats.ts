/**
 * What a heartbeat reports besides "alive": who this service called and how
 * that went (the service map's edges), the process's own vitals, and its
 * background jobs. Each is a summary of the window since the previous
 * heartbeat, held in bounded memory and reset when taken.
 */

import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { truncate } from "../shared/redact";
import type { CallStats, JobStats, RuntimeMetrics } from "../shared/types";

/** Durations kept per key for percentiles; beyond this, a reservoir sample. */
const SAMPLE_SIZE = 256;
const MAX_TARGETS = 50;
const MAX_JOBS = 100;

/** Count, failures and a duration sample for one key. */
class Durations {
  count = 0;
  errors = 0;
  max = 0;
  #sample: number[] = [];

  add(ms: number, failed: boolean) {
    this.count += 1;
    if (failed) this.errors += 1;
    this.max = Math.max(this.max, ms);
    if (this.#sample.length < SAMPLE_SIZE) this.#sample.push(ms);
    else {
      // Reservoir sampling keeps every observation equally likely to stay.
      const slot = Math.floor(Math.random() * this.count);
      if (slot < SAMPLE_SIZE) this.#sample[slot] = ms;
    }
  }

  percentile(p: number): number {
    if (!this.#sample.length) return 0;
    const sorted = [...this.#sample].sort((a, b) => a - b);
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
  }
}

/**
 * The origin a call went to, as the service map names it: scheme and host
 * for the public internet, host:port for internal names. Never a path or
 * credentials.
 */
export function callTarget(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.host) return null;
    return truncate(`${parsed.protocol}//${parsed.host}`, 200);
  } catch {
    return null;
  }
}

export class CallRecorder {
  #targets = new Map<string, Durations>();

  record(url: string, durationMs: number, status: number | undefined, failed: boolean) {
    const target = callTarget(url);
    if (!target) return;
    let entry = this.#targets.get(target);
    if (!entry) {
      if (this.#targets.size >= MAX_TARGETS) return;
      entry = new Durations();
      this.#targets.set(target, entry);
    }
    entry.add(durationMs, failed || (status !== undefined && status >= 500));
  }

  take(): CallStats[] {
    const calls = [...this.#targets.entries()].map(([target, d]) => ({
      target,
      kind: "http",
      count: d.count,
      errors: d.errors,
      p50Ms: d.percentile(50),
      p95Ms: d.percentile(95),
      maxMs: Math.round(d.max),
    }));
    this.#targets.clear();
    return calls;
  }
}

type JobEntry = { durations: Durations; lastRunAt: number; lastFailedAt?: number };

export class JobRecorder {
  #jobs = new Map<string, JobEntry>();

  record(name: string, durationMs: number, failed: boolean, at: number) {
    const key = truncate(name, 200);
    let entry = this.#jobs.get(key);
    if (!entry) {
      if (this.#jobs.size >= MAX_JOBS) return;
      entry = { durations: new Durations(), lastRunAt: at };
      this.#jobs.set(key, entry);
    }
    entry.durations.add(durationMs, failed);
    entry.lastRunAt = at;
    if (failed) entry.lastFailedAt = at;
  }

  take(): JobStats[] {
    const jobs = [...this.#jobs.entries()].map(([name, { durations: d, lastRunAt, lastFailedAt }]) => ({
      name,
      count: d.count,
      failed: d.errors,
      p50Ms: d.percentile(50),
      p95Ms: d.percentile(95),
      maxMs: Math.round(d.max),
      lastRunAt: new Date(lastRunAt).toISOString(),
      ...(lastFailedAt !== undefined ? { lastFailedAt: new Date(lastFailedAt).toISOString() } : {}),
    }));
    this.#jobs.clear();
    return jobs;
  }
}

type ProcessLike = {
  memoryUsage?: () => { rss: number; heapUsed: number; heapTotal: number };
  cpuUsage?: (previous?: { user: number; system: number }) => { user: number; system: number };
};

const MB = 1024 * 1024;

/** Memory, CPU and event-loop delay, measured between two `take()`s. */
export class RuntimeSampler {
  #histogram: IntervalHistogram | null = null;
  #cpu: { user: number; system: number } | null = null;
  #at = 0;

  constructor(private readonly now: () => number) {}

  start() {
    const proc = (globalThis as { process?: ProcessLike }).process;
    this.#cpu = proc?.cpuUsage?.() ?? null;
    this.#at = this.now();
    try {
      this.#histogram = monitorEventLoopDelay({ resolution: 20 });
      this.#histogram.enable();
    } catch {
      // Not every runtime has it; the other numbers still report.
      this.#histogram = null;
    }
  }

  stop() {
    try {
      this.#histogram?.disable();
    } catch {
      // Ignore.
    }
    this.#histogram = null;
  }

  take(): RuntimeMetrics {
    const proc = (globalThis as { process?: ProcessLike }).process;
    const metrics: RuntimeMetrics = {};
    try {
      const memory = proc?.memoryUsage?.();
      if (memory) {
        metrics.rssMb = Math.round(memory.rss / MB);
        metrics.heapUsedMb = Math.round(memory.heapUsed / MB);
        metrics.heapTotalMb = Math.round(memory.heapTotal / MB);
      }
      const now = this.now();
      if (this.#cpu && proc?.cpuUsage && now > this.#at) {
        const used = proc.cpuUsage(this.#cpu);
        // Microseconds of CPU over milliseconds of wall time.
        metrics.cpuPercent = Math.round(((used.user + used.system) / 1000 / (now - this.#at)) * 1000) / 10;
        this.#cpu = proc.cpuUsage();
      }
      this.#at = now;
      if (this.#histogram && this.#histogram.count > 0) {
        metrics.eventLoopLagMs = Math.round(this.#histogram.percentile(99) / 1e5) / 10;
        this.#histogram.reset();
      }
    } catch {
      // Vitals are best-effort.
    }
    return metrics;
  }
}
