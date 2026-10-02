/**
 * Ready-made dependency checks. Each one probes the dependency the way its
 * own client would, measures how long that took, and reports the numbers
 * worth watching (pool usage, queue depth, memory), so Nex can show the
 * database, cache and broker behind every service, not only the service.
 *
 * ```ts
 * createMonitoring({
 *   service: "orders-api",
 *   checks: {
 *     database: checks.postgres(pool),
 *     cache: checks.redis(redis),
 *     queue: checks.rabbitmq(connection, { queues: ["orders"], maxQueueDepth: 1000 }),
 *     payments: checks.http("https://api.paystack.co"),
 *   },
 * });
 * ```
 *
 * The client objects are typed structurally: nothing here imports a driver,
 * so the SDK adds no dependencies and works with whichever version you use.
 * A check never changes the client's state, and one that throws or times out
 * reports `down`.
 */

import { connect } from "node:net";
import { truncate } from "../shared/redact";
import type { DependencyKind, DependencyStatus } from "../shared/types";

/** What a check function may return. */
export type DependencyResult =
  | boolean
  | DependencyStatus
  | { status: DependencyStatus | boolean; metrics?: Record<string, number>; error?: string };

/** A check with what it checks, for Nex's dependency list and service map. */
export type DependencyCheckDefinition = {
  kind?: DependencyKind | (string & {});
  /** Where it is, e.g. "db.internal:5432". Credentials are removed before sending. */
  target?: string;
  check: () => DependencyResult | Promise<DependencyResult>;
};

type Options = { target?: string };

/** "host:port" (or the URL's origin), with any credentials removed. */
export function cleanTarget(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      const url = new URL(raw);
      const scheme = url.protocol.replace(/:$/, "");
      // Web addresses keep their scheme; drivers' URLs (postgres://, redis://) are named by host.
      return truncate(scheme === "http" || scheme === "https" ? `${url.protocol}//${url.host}` : url.host, 200);
    }
  } catch {
    // Not a URL.
  }
  return truncate(raw.replace(/^[^@/]*@/, ""), 200);
}

function hostPort(host: unknown, port: unknown): string | undefined {
  if (typeof host !== "string" || !host) return undefined;
  return typeof port === "number" || typeof port === "string" ? `${host}:${port}` : host;
}

// --- SQL ---------------------------------------------------------------------------------

type PgPoolLike = {
  query: (text: string) => Promise<unknown>;
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
  options?: { host?: string; port?: number; connectionString?: string };
  connectionParameters?: { host?: string; port?: number };
};
type PrismaLike = { $queryRawUnsafe: (query: string) => Promise<unknown> };
type PostgresJsLike = ((strings: TemplateStringsArray) => Promise<unknown>) & { options?: { host?: string[]; port?: number[] } };

function templateOf(text: string): TemplateStringsArray {
  return Object.assign([text], { raw: [text] }) as unknown as TemplateStringsArray;
}

/**
 * PostgreSQL through `pg` (Pool or Client), `postgres` (postgres.js) or a
 * Prisma client: runs `SELECT 1`. With a `pg` Pool it also reports the
 * pool's size, idle and waiting connections; waiting clients mean the pool
 * is too small for the load.
 */
export function postgres(client: PgPoolLike | PrismaLike | PostgresJsLike, options: Options = {}): DependencyCheckDefinition {
  const pg = client as PgPoolLike;
  const target =
    options.target ??
    cleanTarget(pg.options?.connectionString) ??
    hostPort(pg.options?.host ?? pg.connectionParameters?.host, pg.options?.port ?? pg.connectionParameters?.port) ??
    hostPort((client as PostgresJsLike).options?.host?.[0], (client as PostgresJsLike).options?.port?.[0]);
  return {
    kind: "postgres",
    target: cleanTarget(target),
    check: async () => {
      if (typeof (client as PrismaLike).$queryRawUnsafe === "function") await (client as PrismaLike).$queryRawUnsafe("SELECT 1");
      else if (typeof pg.query === "function") await pg.query("SELECT 1");
      else if (typeof client === "function") await (client as PostgresJsLike)(templateOf("SELECT 1"));
      else return { status: "unknown", error: "Not a pg, postgres.js or Prisma client" };
      const metrics: Record<string, number> = {};
      if (typeof pg.totalCount === "number") metrics.poolTotal = pg.totalCount;
      if (typeof pg.idleCount === "number") metrics.poolIdle = pg.idleCount;
      if (typeof pg.waitingCount === "number") metrics.poolWaiting = pg.waitingCount;
      return { status: metrics.poolWaiting ? "degraded" : "healthy", metrics };
    },
  };
}

type MysqlLike = { query: (text: string) => Promise<unknown>; config?: { host?: string; port?: number; connectionConfig?: { host?: string; port?: number } } };

/** MySQL/MariaDB through `mysql2/promise` (pool or connection) or Prisma: `SELECT 1`. */
export function mysql(client: MysqlLike | PrismaLike, options: Options = {}): DependencyCheckDefinition {
  const config = (client as MysqlLike).config;
  return {
    kind: "mysql",
    target: cleanTarget(options.target ?? hostPort(config?.connectionConfig?.host ?? config?.host, config?.connectionConfig?.port ?? config?.port)),
    check: async () => {
      if (typeof (client as PrismaLike).$queryRawUnsafe === "function") await (client as PrismaLike).$queryRawUnsafe("SELECT 1");
      else await (client as MysqlLike).query("SELECT 1");
      return true;
    },
  };
}

// --- Redis -------------------------------------------------------------------------------

type RedisLike = {
  ping: () => Promise<unknown>;
  info?: (section?: string) => Promise<string>;
  options?: { host?: string; port?: number; url?: string; socket?: { host?: string; port?: number } };
};

/** `INFO` text → the numbers worth watching. */
export function redisInfoMetrics(info: string): Record<string, number> {
  const values = new Map<string, string>();
  for (const line of info.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at > 0 && !line.startsWith("#")) values.set(line.slice(0, at), line.slice(at + 1).trim());
  }
  const metrics: Record<string, number> = {};
  const number = (key: string) => {
    const value = Number(values.get(key));
    return Number.isFinite(value) ? value : undefined;
  };
  const used = number("used_memory");
  if (used !== undefined) metrics.usedMemoryMb = Math.round(used / 1024 / 1024);
  const max = number("maxmemory");
  if (used !== undefined && max) metrics.memoryPercent = Math.round((used / max) * 1000) / 10;
  for (const [key, name] of [
    ["connected_clients", "clients"],
    ["blocked_clients", "blockedClients"],
    ["instantaneous_ops_per_sec", "opsPerSec"],
    ["evicted_keys", "evictedKeys"],
    ["rejected_connections", "rejectedConnections"],
  ] as const) {
    const value = number(key);
    if (value !== undefined) metrics[name] = value;
  }
  const hits = number("keyspace_hits");
  const misses = number("keyspace_misses");
  if (hits !== undefined && misses !== undefined && hits + misses > 0) metrics.hitRatePercent = Math.round((hits / (hits + misses)) * 1000) / 10;
  return metrics;
}

/**
 * Redis through `ioredis` or `redis` (node-redis): `PING`, then `INFO` for
 * memory, clients, throughput and hit rate. Memory above 90% of `maxmemory`
 * reports degraded: evictions or write errors are next.
 */
export function redis(client: RedisLike, options: Options & { info?: boolean } = {}): DependencyCheckDefinition {
  const o = client.options;
  return {
    kind: "redis",
    target: cleanTarget(options.target ?? (o?.url ? cleanTarget(o.url) : hostPort(o?.socket?.host ?? o?.host, o?.socket?.port ?? o?.port))),
    check: async () => {
      await client.ping();
      if (options.info === false || typeof client.info !== "function") return true;
      let metrics: Record<string, number> = {};
      try {
        metrics = redisInfoMetrics(await client.info());
      } catch {
        // INFO can be disabled (managed Redis); PING answered, so it is up.
      }
      return { status: (metrics.memoryPercent ?? 0) >= 90 ? "degraded" : "healthy", metrics };
    },
  };
}

// --- MongoDB -----------------------------------------------------------------------------

type MongoLike = { db: (name?: string) => { command: (command: Record<string, unknown>) => Promise<unknown> }; options?: { hosts?: { host?: string; port?: number }[] } };

/** MongoDB through the official driver's `MongoClient`: `{ ping: 1 }` on admin. */
export function mongodb(client: MongoLike, options: Options = {}): DependencyCheckDefinition {
  const host = client.options?.hosts?.[0];
  return {
    kind: "mongodb",
    target: cleanTarget(options.target ?? hostPort(host?.host, host?.port)),
    check: async () => {
      await client.db("admin").command({ ping: 1 });
      return true;
    },
  };
}

// --- RabbitMQ ----------------------------------------------------------------------------

type AmqpChannelLike = {
  checkQueue: (queue: string) => Promise<{ messageCount: number; consumerCount: number }>;
  close: () => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
};
type AmqpConnectionLike = { createChannel: () => Promise<AmqpChannelLike> };

type RabbitOptions = Options & {
  /** Queues whose depth and consumers to report. */
  queues?: string[];
  /** A queue holding more ready messages than this makes the broker degraded. */
  maxQueueDepth?: number;
  /** A listed queue with no consumers makes the broker degraded. Default true. */
  requireConsumers?: boolean;
  /** Management API only: the virtual host. Default "/". */
  vhost?: string;
  /** Management API only: custom fetch. */
  fetch?: typeof fetch;
};

function queueStatus(queues: { name: string; messages: number; consumers: number }[], options: RabbitOptions) {
  const metrics: Record<string, number> = { messages: 0, consumers: 0 };
  const problems: string[] = [];
  for (const q of queues) {
    metrics.messages += q.messages;
    metrics.consumers += q.consumers;
    metrics[`${q.name}.messages`] = q.messages;
    metrics[`${q.name}.consumers`] = q.consumers;
    if (options.maxQueueDepth !== undefined && q.messages > options.maxQueueDepth) problems.push(`${q.name} has ${q.messages} messages waiting`);
    if (options.requireConsumers !== false && q.consumers === 0) problems.push(`${q.name} has no consumers`);
  }
  return problems.length ? { status: "degraded" as const, metrics, error: truncate(problems.join("; "), 500) } : { status: "healthy" as const, metrics };
}

/**
 * RabbitMQ. Two ways in:
 *
 * - an `amqplib` connection (from `amqp.connect()`): opens a short-lived
 *   channel of its own (so a missing queue can't close yours) and reads
 *   each listed queue's depth and consumers;
 * - the management API's URL, e.g. `http://user:pass@rabbit:15672`: reads
 *   the same per queue, over HTTP.
 *
 * A queue backing up past `maxQueueDepth`, or with nobody consuming it,
 * reports degraded: messages are piling up even though the broker is up.
 */
export function rabbitmq(connection: AmqpConnectionLike | string, options: RabbitOptions = {}): DependencyCheckDefinition {
  const queues = options.queues ?? [];
  if (typeof connection === "string") {
    const base = new URL(connection);
    const auth = base.username ? `Basic ${btoa(`${decodeURIComponent(base.username)}:${decodeURIComponent(base.password)}`)}` : undefined;
    base.username = "";
    base.password = "";
    const origin = `${base.protocol}//${base.host}${base.pathname.replace(/\/+$/, "")}`;
    const vhost = encodeURIComponent(options.vhost ?? "/");
    const doFetch = options.fetch ?? ((input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init));
    const get = async (path: string) => {
      const response = await doFetch(`${origin}${path}`, { headers: { accept: "application/json", ...(auth ? { authorization: auth } : {}) } });
      if (!response.ok) throw new Error(`RabbitMQ management API answered ${response.status}`);
      return response.json() as Promise<Record<string, unknown>>;
    };
    return {
      kind: "rabbitmq",
      target: cleanTarget(options.target ?? base.host),
      check: async () => {
        if (!queues.length) {
          await get("/api/overview");
          return true;
        }
        const found = await Promise.all(
          queues.map(async (name) => {
            const q = await get(`/api/queues/${vhost}/${encodeURIComponent(name)}`);
            return { name, messages: Number(q.messages_ready ?? q.messages ?? 0), consumers: Number(q.consumers ?? 0) };
          }),
        );
        return queueStatus(found, options);
      },
    };
  }
  return {
    kind: "rabbitmq",
    target: cleanTarget(options.target),
    check: async () => {
      const channel = await connection.createChannel();
      // A failed checkQueue closes the channel with an error event; without a
      // listener that event would crash the process.
      channel.on?.("error", () => {});
      try {
        const found = [];
        for (const name of queues) {
          const q = await channel.checkQueue(name);
          found.push({ name, messages: q.messageCount, consumers: q.consumerCount });
        }
        return found.length ? queueStatus(found, options) : true;
      } finally {
        await channel.close().catch(() => {});
      }
    },
  };
}

// --- Network -----------------------------------------------------------------------------

/**
 * Any HTTP dependency (a payment provider, another service's health
 * endpoint): healthy on a 2xx/3xx, down otherwise.
 */
export function http(url: string, options: Options & { method?: "GET" | "HEAD"; expectStatus?: number; fetch?: typeof fetch; headers?: Record<string, string> } = {}): DependencyCheckDefinition {
  const doFetch = options.fetch ?? ((input: string | URL | Request, init?: RequestInit) => globalThis.fetch(input, init));
  return {
    kind: "http",
    target: cleanTarget(options.target ?? url),
    check: async () => {
      const response = await doFetch(url, { method: options.method ?? "GET", headers: options.headers, redirect: "manual" });
      await response.body?.cancel().catch(() => {});
      const ok = options.expectStatus !== undefined ? response.status === options.expectStatus : response.status < 400;
      return ok ? true : { status: "down", error: `Answered ${response.status}` };
    },
  };
}

/** Any TCP service (SMTP, a database without a client here): connects and hangs up. */
export function tcp(host: string, port: number, options: Options & { timeoutMs?: number } = {}): DependencyCheckDefinition {
  return {
    kind: "tcp",
    target: cleanTarget(options.target ?? `${host}:${port}`),
    check: () =>
      new Promise<DependencyResult>((resolve) => {
        const socket = connect({ host, port });
        const done = (result: DependencyResult) => {
          socket.destroy();
          resolve(result);
        };
        socket.setTimeout(options.timeoutMs ?? 2_000, () => done({ status: "down", error: "Timed out" }));
        socket.once("connect", () => done(true));
        socket.once("error", (error) => done({ status: "down", error: error.message }));
      }),
  };
}

/** Wraps your own probe so it shows in Nex with a kind and target. */
export function custom(kind: DependencyKind | (string & {}), check: DependencyCheckDefinition["check"], options: Options = {}): DependencyCheckDefinition {
  return { kind, target: cleanTarget(options.target), check };
}
