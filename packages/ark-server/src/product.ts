/**
 * `ArkProduct` -- Ark's product integration API (`/api/v1/internal`).
 *
 * For NerdStack products (Cartly, …) that run one Ark organization per
 * customer: one client credential for the product, each customer addressed
 * by the product's own id (`external:<id>`). Server-side only; customers
 * never receive Ark credentials. Browsers PUT bytes to the presigned upload
 * URLs this returns, with `uploadToSession` from `@nerdstackgrp/ark-client`.
 *
 * ```ts
 * const ark = new ArkProduct({
 *   clientId: process.env.ARK_CLIENT_ID!,
 *   clientSecret: process.env.ARK_CLIENT_SECRET!,
 *   requestSigningSecret: process.env.ARK_REQUEST_SIGNING_SECRET,
 * });
 * const org = { externalTenantId: account.id };
 * await ark.organizations.create({ externalTenantId: account.id, name: account.name });
 * const session = await ark.uploads.create(org, { filename, size, mimeType }, { idempotencyKey: asset.id });
 * ```
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ArkError, errorFromRest } from "./errors";

const DEFAULT_API_URL = "https://ark.nerdstackgrp.com/api/v1/internal";
const DEFAULT_TIMEOUT_MS = 15_000;
/** Refresh the access token this long before Ark says it expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface ArkProductOptions {
  clientId: string;
  clientSecret: string;
  /**
   * Signs every request (`X-Ark-Signature`). Required by Ark for products
   * registered with request signing on, which is the default.
   */
  requestSigningSecret?: string;
  /** Defaults to `https://ark.nerdstackgrp.com/api/v1/internal`. */
  apiUrl?: string;
  /** Per request, including the token request. Defaults to 15 seconds. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Extra headers for every request, e.g. `{ "x-correlation-id": requestId }`. */
  headers?: () => Record<string, string>;
  /** Called once per HTTP call, e.g. for metrics. Never receives secrets. */
  onResponse?: (event: ArkProductCallEvent) => void;
}

export interface ArkProductCallEvent {
  /** e.g. `uploads.create`. */
  operation: string;
  /** HTTP status, or null when Ark could not be reached. */
  status: number | null;
  ok: boolean;
  durationMs: number;
}

/** An organization: Ark's id, or the product's own id for it. */
export type ArkOrganizationRef = string | { externalTenantId: string };

export interface ArkProductInfo {
  id: string;
  slug: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

export interface ArkOrganization {
  organizationId: string;
  externalTenantId: string;
  name?: string;
  status: string;
  /** Set by `create`: false when the organization already existed. */
  created?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ArkPage<T> {
  items: T[];
  nextCursor: string | null;
}

export type ArkEntitlementSourceType = "PLAN" | "ADD_ON" | "PROMOTION" | (string & {});

export interface ArkEntitlementsInput {
  /** Ark keeps the highest revision per source and refuses an older one (`STALE_REVISION`). */
  revision: number;
  source: { type: ArkEntitlementSourceType; reference: string };
  entitlements: { key: string; limit: number }[];
}

export interface ArkEntitlementsResult {
  outcome: "APPLIED" | "UNCHANGED" | (string & {});
  revision: number;
  [key: string]: unknown;
}

export interface ArkOrganizationUsage {
  measuredAt: string;
  storage: { usedBytes: number; limitBytes: number | null; assetCount: number };
  bandwidth: { usedBytes: number; limitBytes: number | null; period: string };
  [key: string]: unknown;
}

export interface ArkUploadInput {
  filename: string;
  size: number;
  mimeType: string;
  /** Hex SHA-256 of the bytes; Ark checks it at completion. */
  checksum?: string;
  folderId?: string;
  metadata?: Record<string, unknown>;
}

/** Same shape as `ArkUploadSession` in `@nerdstackgrp/ark-client`. */
export type ArkProductUploadSession =
  | {
      organizationId?: string;
      uploadId: string;
      fileId: string;
      multipart: false;
      method: "PUT";
      url: string;
      headers: Record<string, string>;
      /** Needs the product's token: never hand it to a browser. */
      fallbackUrl?: string;
      expiresAt: string;
    }
  | {
      organizationId?: string;
      uploadId: string;
      fileId: string;
      multipart: true;
      partSize: number;
      partCount: number;
      parts: { partNumber: number; url: string; fallbackUrl?: string }[];
      maxConcurrency: number;
      expiresAt: string;
    };

export interface ArkAsset {
  id: string;
  size: number;
  mimeType: string;
  status: string;
  checksum: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  [key: string]: unknown;
}

export interface ArkFolderEntry {
  id: string;
  name: string;
  parentId: string | null;
  [key: string]: unknown;
}

function segment(value: string) {
  return encodeURIComponent(value);
}

function orgPath(ref: ArkOrganizationRef) {
  return typeof ref === "string"
    ? `/organizations/${segment(ref)}`
    : `/organizations/external:${segment(ref.externalTenantId)}`;
}

function query(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/** Not-found (or already finished) is success for cleanup calls. */
async function ignoring<T>(statuses: number[], call: Promise<T>): Promise<T | undefined> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof ArkError && error.status !== null && statuses.includes(error.status)) return undefined;
    throw error;
  }
}

export class ArkProduct {
  readonly #options: ArkProductOptions;
  readonly #apiUrl: string;
  readonly #fetch: typeof fetch;
  #token: { value: string; refreshAt: number } | undefined;
  #pendingToken: Promise<string> | undefined;

  constructor(options: ArkProductOptions) {
    if (!options?.clientId || !options?.clientSecret) {
      throw new ArkError({ code: "UNAUTHORIZED", message: "An Ark client id and secret are required" });
    }
    this.#options = options;
    this.#apiUrl = (options.apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch || globalThis.fetch.bind(globalThis);
  }

  /** The product itself. Doubles as a health check: reachability plus a valid credential. */
  product(): Promise<ArkProductInfo> {
    return this.#call("product.get", "GET", "/product");
  }

  readonly organizations = {
    /** Idempotent by `externalTenantId`: a retry returns the same organization. */
    create: (input: { externalTenantId: string; name: string; metadata?: Record<string, unknown> }) =>
      this.#call<ArkOrganization>("organizations.create", "POST", "/organizations", { body: input }),
    get: (org: ArkOrganizationRef) => this.#call<ArkOrganization>("organizations.get", "GET", orgPath(org)),
    list: (params: { cursor?: string; limit?: number; status?: string } = {}) =>
      this.#call<ArkPage<ArkOrganization>>("organizations.list", "GET", `/organizations${query(params)}`),
    update: (org: ArkOrganizationRef, input: { name?: string; metadata?: Record<string, unknown> }) =>
      this.#call<ArkOrganization>("organizations.update", "PATCH", orgPath(org), { body: input }),
    /** Existing media stays readable and delivered; only new uploads stop. */
    suspend: (org: ArkOrganizationRef, reason: string) =>
      this.#call<ArkOrganization>("organizations.suspend", "POST", `${orgPath(org)}/suspend`, { body: { reason } }),
    reactivate: (org: ArkOrganizationRef) =>
      this.#call<ArkOrganization>("organizations.reactivate", "POST", `${orgPath(org)}/reactivate`, { body: {} }),
  };

  readonly entitlements = {
    get: (org: ArkOrganizationRef) => this.#call<unknown>("entitlements.get", "GET", `${orgPath(org)}/entitlements`),
    /** Replaces one source's limits. An older revision fails with `STALE_REVISION`. */
    set: (org: ArkOrganizationRef, input: ArkEntitlementsInput) =>
      this.#call<ArkEntitlementsResult>("entitlements.set", "PUT", `${orgPath(org)}/entitlements`, {
        body: { ...(typeof org === "string" ? {} : { externalTenantId: org.externalTenantId }), ...input },
      }),
  };

  readonly usage = {
    get: (org: ArkOrganizationRef) => this.#call<ArkOrganizationUsage>("usage.get", "GET", `${orgPath(org)}/usage`),
    history: (org: ArkOrganizationRef, params: { from?: string; to?: string; cursor?: string; limit?: number } = {}) =>
      this.#call<unknown>("usage.history", "GET", `${orgPath(org)}/usage/history${query(params)}`),
  };

  readonly uploads = {
    /**
     * Reserves the declared bytes against the organization's limits and
     * returns presigned URLs. Pass a stable `idempotencyKey` (e.g. your own
     * asset id) so a retry returns the same session.
     */
    create: (org: ArkOrganizationRef, input: ArkUploadInput, options: { idempotencyKey: string }) =>
      this.#call<ArkProductUploadSession>("uploads.create", "POST", `${orgPath(org)}/uploads`, {
        body: input,
        idempotencyKey: options.idempotencyKey,
      }),
    /** Ark verifies the stored size and type; completing twice returns the same asset. */
    complete: (org: ArkOrganizationRef, uploadId: string, parts?: { partNumber: number; etag: string }[]) =>
      this.#call<ArkAsset>("uploads.complete", "POST", `${orgPath(org)}/uploads/${segment(uploadId)}/complete`, {
        body: parts?.length ? { parts } : {},
      }),
    /** Releases the reservation. Already gone or finished counts as done. */
    abort: async (org: ArkOrganizationRef, uploadId: string): Promise<void> => {
      await ignoring(
        [404, 409],
        this.#call("uploads.abort", "POST", `${orgPath(org)}/uploads/${segment(uploadId)}/abort`, { body: {} }),
      );
    },
  };

  readonly assets = {
    list: (org: ArkOrganizationRef, params: { cursor?: string; limit?: number; folderId?: string } = {}) =>
      this.#call<ArkPage<ArkAsset>>("assets.list", "GET", `${orgPath(org)}/assets${query(params)}`),
    get: (org: ArkOrganizationRef, assetId: string) =>
      this.#call<ArkAsset>("assets.get", "GET", `${orgPath(org)}/assets/${segment(assetId)}`),
    delivery: (org: ArkOrganizationRef, assetId: string) =>
      this.#call<unknown>("assets.delivery", "GET", `${orgPath(org)}/assets/${segment(assetId)}/delivery`),
    update: (org: ArkOrganizationRef, assetId: string, input: Record<string, unknown>) =>
      this.#call<ArkAsset>("assets.update", "PATCH", `${orgPath(org)}/assets/${segment(assetId)}`, { body: input }),
    /** Already gone counts as deleted. */
    delete: async (org: ArkOrganizationRef, assetId: string, options: { idempotencyKey?: string } = {}): Promise<void> => {
      await ignoring(
        [404],
        this.#call("assets.delete", "DELETE", `${orgPath(org)}/assets/${segment(assetId)}`, {
          idempotencyKey: options.idempotencyKey ?? `delete-${assetId}`,
        }),
      );
    },
  };

  readonly folders = {
    list: (org: ArkOrganizationRef, params: { parentId?: string } = {}) =>
      this.#call<ArkFolderEntry[] | ArkPage<ArkFolderEntry>>("folders.list", "GET", `${orgPath(org)}/folders${query(params)}`),
    create: (org: ArkOrganizationRef, input: { name: string; parentId?: string | null }) =>
      this.#call<ArkFolderEntry>("folders.create", "POST", `${orgPath(org)}/folders`, { body: input }),
    update: (org: ArkOrganizationRef, folderId: string, input: { name?: string; parentId?: string | null }) =>
      this.#call<ArkFolderEntry>("folders.update", "PATCH", `${orgPath(org)}/folders/${segment(folderId)}`, { body: input }),
    delete: (org: ArkOrganizationRef, folderId: string, options: { recursive?: boolean } = {}) =>
      this.#call<unknown>("folders.delete", "DELETE", `${orgPath(org)}/folders/${segment(folderId)}${query({ recursive: options.recursive })}`),
  };

  async #accessToken(): Promise<string> {
    if (this.#token && Date.now() < this.#token.refreshAt) return this.#token.value;
    // One token request at a time; concurrent callers share it.
    this.#pendingToken ??= this.#fetchToken().finally(() => {
      this.#pendingToken = undefined;
    });
    return this.#pendingToken;
  }

  async #fetchToken(): Promise<string> {
    const result = await this.#send<{ access_token: string; expires_in: number }>("auth.token", "POST", "/auth/token", {
      body: { grant_type: "client_credentials", client_id: this.#options.clientId, client_secret: this.#options.clientSecret },
      sign: false,
    });
    this.#token = {
      value: result.access_token,
      refreshAt: Date.now() + Math.max(0, result.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS),
    };
    return result.access_token;
  }

  async #call<T>(
    operation: string,
    method: string,
    path: string,
    options: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    try {
      return await this.#send<T>(operation, method, path, { ...options, bearer: await this.#accessToken() });
    } catch (error) {
      // A revoked or rotated token: fetch a new one once and retry. A bad
      // credential (INVALID_CLIENT) will not get better by asking again.
      if (error instanceof ArkError && error.status === 401 && error.code !== "INVALID_CLIENT") {
        this.#token = undefined;
        return this.#send<T>(operation, method, path, { ...options, bearer: await this.#accessToken() });
      }
      throw error;
    }
  }

  async #send<T>(
    operation: string,
    method: string,
    path: string,
    options: { body?: unknown; idempotencyKey?: string; bearer?: string; sign?: boolean },
  ): Promise<T> {
    const url = `${this.#apiUrl}${path}`;
    const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const signing =
      options.sign !== false && this.#options.requestSigningSecret
        ? signRequest(this.#options.requestSigningSecret, method, pathAndQuery(url), body ?? "")
        : {};
    const started = Date.now();
    const report = (status: number | null, ok: boolean) =>
      this.#options.onResponse?.({ operation, status, ok, durationMs: Date.now() - started });

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method,
        headers: {
          accept: "application/json",
          ...this.#options.headers?.(),
          ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(options.idempotencyKey ? { "idempotency-key": options.idempotencyKey } : {}),
          ...signing,
        },
        ...(body !== undefined ? { body } : {}),
        signal: AbortSignal.timeout(this.#options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      report(null, false);
      throw new ArkError({
        code: "NETWORK_ERROR",
        message: `Ark ${operation} failed: ${(error as Error)?.message || "network request failed"}`,
      });
    }
    report(response.status, response.ok);
    if (!response.ok) throw await errorFromRest(response);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

function pathAndQuery(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * Ark's request signature: HMAC-SHA256 over
 * `ARK-HMAC-SHA256\ntimestamp\nnonce\nMETHOD\npath?query\nhex(sha256(body))`.
 */
export function signRequest(
  secret: string,
  method: string,
  pathAndQueryValue: string,
  body: string,
  now = Date.now(),
): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000));
  const nonce = randomBytes(16).toString("hex");
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = ["ARK-HMAC-SHA256", timestamp, nonce, method.toUpperCase(), pathAndQueryValue, bodyHash].join("\n");
  return {
    "x-ark-timestamp": timestamp,
    "x-ark-nonce": nonce,
    "x-ark-signature": `v1=${createHmac("sha256", secret).update(canonical).digest("hex")}`,
  };
}

export interface ArkWebhookEvent {
  id: string;
  type: string;
  organizationId: string | null;
  externalTenantId: string | null;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Verifies an Ark webhook: `X-Ark-Signature: t=<unix seconds>,v1=<hex
 * HMAC-SHA256 of "t.rawBody">`, in constant time, rejecting timestamps more
 * than five minutes off (replay protection). Pass the raw request bytes,
 * not re-serialized JSON.
 */
export function verifyArkWebhook(
  rawBody: string | Uint8Array,
  header: string | null | undefined,
  secret: string | null | undefined,
  options: { now?: number; toleranceSeconds?: number } = {},
): boolean {
  if (!secret || !header) return false;
  const parts = new Map(
    header.split(",").map((part) => {
      const [key = "", ...rest] = part.trim().split("=");
      return [key, rest.join("=")] as const;
    }),
  );
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1");
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !signature) return false;
  const now = options.now ?? Date.now();
  if (Math.abs(now / 1000 - timestamp) > (options.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
