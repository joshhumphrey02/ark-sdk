/**
 * HTTP to the monitoring API, built so that Nerdstack being slow, down or
 * misconfigured can never hurt the application:
 *
 * - every request has a hard timeout (default 3s);
 * - retries are bounded (default 2) with exponential backoff and jitter, and
 *   only for failures that can succeed on retry (network, timeout, 408, 429,
 *   5xx), honouring `Retry-After`;
 * - after 3 failed requests in a row the transport pauses itself (30s,
 *   doubling to 5 minutes), so an outage costs one probe per pause rather
 *   than a retry storm from every instance;
 * - a rejected token (401) stops all sending until restart, with one warning;
 * - nothing here throws. Every outcome is a value.
 */

import type { ResolvedConfig } from "./config";

export type SendFailureReason = "disabled" | "paused" | "timeout" | "network" | "http";

export type SendResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; reason: SendFailureReason; status: number | null; retryable: boolean; detail?: string };

const BASE_PAUSE_MS = 30_000;
const MAX_PAUSE_MS = 5 * 60_000;
const FAILURES_BEFORE_PAUSE = 3;
/** Never sleep longer than this between retries; longer waits become a pause. */
const MAX_RETRY_WAIT_MS = 10_000;
const USER_AGENT = "nerdstack-monitoring-js/0.1.0";

export type Clock = {
  now(): number;
  sleep(ms: number): Promise<void>;
};

export const realClock: Clock = {
  now: () => Date.now(),
  // Deliberately not unref'd. A retry wait belongs to a request someone may be
  // awaiting (`await monitoring.reportRelease()` in a deploy script); an
  // unref'd timer let Node exit mid-await with that promise never settling.
  // The wait is bounded (backoff capped at MAX_RETRY_WAIT_MS, retries capped),
  // so it can delay exit by seconds, never indefinitely.
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

export class Transport {
  private consecutiveFailures = 0;
  private pausedUntil = 0;
  private pauseLength = BASE_PAUSE_MS;
  private authFailed = false;
  private readonly warned = new Set<string>();

  constructor(
    private readonly config: ResolvedConfig,
    private readonly clock: Clock = realClock,
  ) {}

  /** False once the token was rejected; nothing will be sent until restart. */
  get usable(): boolean {
    return !this.authFailed;
  }

  get paused(): boolean {
    return this.clock.now() < this.pausedUntil;
  }

  /** How long until another attempt is worthwhile. */
  get nextAttemptInMs(): number {
    return Math.max(0, this.pausedUntil - this.clock.now());
  }

  warnOnce(key: string, message: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.config.logger?.warn(`[nerdstack-monitoring] ${message}`);
  }

  private debug(message: string) {
    if (this.config.debug) this.config.logger?.debug?.(`[nerdstack-monitoring] ${message}`);
  }

  async request<T>(method: "GET" | "POST", path: string, body?: unknown, retries = this.config.maxRetries): Promise<SendResult<T>> {
    let last: SendResult<T> = { ok: false, reason: "network", status: null, retryable: true };

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (this.authFailed) return { ok: false, reason: "disabled", status: 401, retryable: false };
      if (this.paused) return { ok: false, reason: "paused", status: null, retryable: true };

      const { result, retryAfter } = await this.attempt<T>(method, path, body);
      last = result;
      if (result.ok) {
        this.consecutiveFailures = 0;
        this.pauseLength = BASE_PAUSE_MS;
        return result;
      }
      if (!result.retryable) return result;

      if (attempt === retries) break;
      const backoff = this.config.retryDelay * 2 ** attempt;
      const delay = retryAfter ?? backoff + Math.random() * backoff * 0.5;
      if (delay > MAX_RETRY_WAIT_MS) {
        // The server asked for a long wait: honour it as a pause instead of
        // holding this request open.
        this.pausedUntil = this.clock.now() + delay;
        break;
      }
      await this.clock.sleep(delay);
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= FAILURES_BEFORE_PAUSE && !this.paused) {
      this.pausedUntil = this.clock.now() + this.pauseLength;
      this.debug(`pausing for ${Math.round(this.pauseLength / 1000)}s after ${this.consecutiveFailures} failed requests`);
      this.pauseLength = Math.min(this.pauseLength * 2, MAX_PAUSE_MS);
    }
    return last;
  }

  private async attempt<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
  ): Promise<{ result: SendResult<T>; retryAfter: number | null }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.requestTimeout);

    try {
      const response = await this.config.fetch(`${this.config.endpoint}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.token}`,
          accept: "application/json",
          "user-agent": USER_AGENT,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text().catch(() => "");
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // Not JSON (a proxy's HTML error page). Treated as no body.
      }

      if (response.ok) {
        this.debug(`${method} ${path} → ${response.status}`);
        return { result: { ok: true, status: response.status, data: data as T }, retryAfter: null };
      }

      const detail =
        data && typeof data === "object" && typeof (data as { detail?: unknown }).detail === "string"
          ? (data as { detail: string }).detail
          : undefined;
      const status = response.status;
      const retryable = status === 408 || status === 429 || status >= 500;
      this.debug(`${method} ${path} → ${status}${detail ? ` (${detail})` : ""}`);

      if (status === 401) {
        this.authFailed = true;
        this.warnOnce(
          "401",
          "The monitoring token was rejected (401). Reporting is stopped until restart; check MONITORING_TOKEN, or generate a new token in Nerdstack Monitoring.",
        );
      } else if (!retryable) {
        this.warnOnce(`${status}:${path}:${detail ?? ""}`, `${method} ${path} was rejected (${status})${detail ? `: ${detail.replace(/[.\s]+$/, "")}` : ""}. It will not be retried.`);
      } else if (status === 503) {
        this.warnOnce("503", "Nerdstack Monitoring is unavailable (503). Events are buffered in memory and retried later.");
      }

      return {
        result: { ok: false, reason: "http", status, retryable, detail },
        retryAfter: status === 429 || status === 503 ? retryAfterMs(response.headers.get("retry-after"), this.clock.now()) : null,
      };
    } catch {
      this.debug(`${method} ${path} → ${timedOut ? "timeout" : "network error"}`);
      return {
        result: { ok: false, reason: timedOut ? "timeout" : "network", status: null, retryable: true },
        retryAfter: null,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
