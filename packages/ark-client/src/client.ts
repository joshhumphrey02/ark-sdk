/**
 * `ArkClient` -- the Ark frontend SDK (§14, §17, §20).
 *
 * Framework-independent by design: no React, no Vue, no framework imports at
 * all. A thin `@ark/react` wrapper can be layered on later without this
 * package changing.
 *
 * Security posture (§15): this client never holds provider credentials and has
 * no signing code. It authenticates to Ark with a short-lived session token and
 * receives narrowly-scoped, expiring upload authorizations in return.
 */

import { ArkError, errorFromResponse, uploadErrorFor } from "./errors";
import { putWithProgress, requestWithRetry } from "./http";
import type {
  ArkClientOptions,
  ArkFile,
  ArkFolder,
  ArkProgress,
  ArkUploadOptions,
  ArkUploadSession,
  ArkUsage,
  ArkImageOptions,
} from "./types";

const DEFAULT_BASE_URL = "https://api.ark.nerdstackgrp.com";

/** An in-flight upload, so callers can cancel it (§45). */
export type ArkUploadHandle = Promise<ArkFile> & { abort: () => void };

export class ArkClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #version: string;
  readonly #fetch: typeof fetch;

  constructor(options: ArkClientOptions) {
    if (!options?.token) {
      throw new ArkError({ code: "UNAUTHORIZED", message: "An Ark token is required" });
    }

    // §15: refuse provider credentials outright. Accepting them would mean a
    // browser bundle contained a permanent secret, which is the exact failure
    // this SDK exists to prevent.
    const asAny = options as Record<string, unknown>;
    if (asAny.accessKeyId || asAny.secretAccessKey) {
      throw new ArkError({
        code: "UNAUTHORIZED",
        message:
          "@ark/client does not accept S3 credentials. Use a short-lived Ark client session; " +
          "for server-side S3 access use ArkS3 from @ark/server.",
      });
    }

    // A long-lived server token in a browser would expose full account access
    // to every visitor (§16). Refused loudly rather than silently working in
    // development and leaking in production.
    if (isBrowser() && options.token.startsWith("ark_")) {
      throw new ArkError({
        code: "UNAUTHORIZED",
        message:
          "A server-side Ark API token must not be used in a browser. Mint a short-lived " +
          "client session from your backend (POST /v2/client-sessions) and pass that instead.",
      });
    }

    this.#baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#token = options.token;
    this.#version = options.version || "v2";
    this.#fetch = options.fetch || globalThis.fetch.bind(globalThis);
  }

  /** Endpoints are composed from a single place so nothing hardcodes /v2 (§56). */
  #url(path: string) {
    return `${this.#baseUrl}/api/${this.#version}${path}`;
  }

  async #request<T>(
    path: string,
    init: RequestInit & { signal?: AbortSignal } = {},
  ): Promise<T> {
    const response = await requestWithRetry(
      () =>
        this.#fetch(this.#url(path), {
          ...init,
          headers: {
            authorization: `Bearer ${this.#token}`,
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...(init.headers as Record<string, string>),
          },
        }),
      { signal: init.signal },
    );
    if (!response.ok) throw await errorFromResponse(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  readonly files = {
    list: (params?: { folderId?: string; limit?: number; cursor?: string }) => {
      const query = new URLSearchParams();
      if (params?.folderId) query.set("folderId", params.folderId);
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.cursor) query.set("cursor", params.cursor);
      const suffix = query.toString() ? `?${query}` : "";
      return this.#request<{ data: ArkFile[]; nextCursor: string | null }>(
        `/files${suffix}`,
      );
    },

    get: (fileId: string) => this.#request<ArkFile>(`/files/${fileId}`),

    delete: (fileId: string) =>
      this.#request<{ id: string; deleted: boolean }>(`/files/${fileId}`, {
        method: "DELETE",
      }),

    /** Move or rename. The stored object is untouched (§30). */
    move: (fileId: string, input: { folderId: string | null }) =>
      this.#request<ArkFile>(`/files/${fileId}`, {
        method: "PATCH",
        body: JSON.stringify({ folderId: input.folderId }),
      }),

    rename: (fileId: string, name: string) =>
      this.#request<ArkFile>(`/files/${fileId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),

    getDownloadUrl: async (fileId: string, options?: { expiresInSeconds?: number }) => {
      const result = await this.#request<{ url: string; expiresAt: string }>(
        "/downloads/presign",
        {
          method: "POST",
          body: JSON.stringify({
            fileId,
            expiresInSeconds: options?.expiresInSeconds,
          }),
        },
      );
      return result.url;
    },

    /**
     * Upload a file, handling presign, transfer and completion (§14). Returns
     * a promise with an `abort()` attached (§45).
     */
    upload: (file: File | Blob, options: ArkUploadOptions = {}): ArkUploadHandle => {
      const controller = new AbortController();
      // Chain the caller's signal so either source can cancel.
      options.signal?.addEventListener("abort", () => controller.abort(), { once: true });

      const promise = this.#upload(file, options, controller.signal) as ArkUploadHandle;
      promise.abort = () => controller.abort();
      return promise;
    },
  };

  readonly folders = {
    list: (params?: { parentId?: string }) => {
      const suffix = params?.parentId ? `?parentId=${encodeURIComponent(params.parentId)}` : "";
      return this.#request<{ data: ArkFolder[] }>(`/folders${suffix}`);
    },
    create: (input: { name: string; parentId?: string | null }) =>
      this.#request<ArkFolder>("/folders", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    rename: (folderId: string, name: string) =>
      this.#request<ArkFolder>(`/folders/${folderId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
  };

  readonly images = {
    url: (assetId: string, options: ArkImageOptions = {}) => imageUrl(this.#baseUrl, this.#version, assetId, options),
  };

  usage() {
    return this.#request<ArkUsage>("/usage");
  }

  async #upload(
    file: File | Blob,
    options: ArkUploadOptions,
    signal: AbortSignal,
  ): Promise<ArkFile> {
    const filename = (file as File).name || "upload";
    const contentType = options.contentType || file.type || "application/octet-stream";
    const totalBytes = file.size;

    const session = await this.#request<ArkUploadSession>("/uploads/presign", {
      method: "POST",
      body: JSON.stringify({
        filename,
        size: totalBytes,
        mimeType: contentType,
        folderId: options.folderId ?? undefined,
        metadata: options.metadata,
      }),
      signal,
    });

    const report = (uploadedBytes: number) => {
      options.onProgress?.({
        uploadedBytes,
        totalBytes,
        percentage: totalBytes > 0 ? Math.min(100, (uploadedBytes / totalBytes) * 100) : 0,
      });
    };

    try {
      const parts = session.multipart
        ? await this.#uploadParts(file, session, report, signal)
        : await this.#uploadSingle(file, session, contentType, report, signal);

      // §13: only now, after Ark has verified the stored object, does the file
      // become available. A presigned URL alone never means "uploaded".
      return await this.#request<ArkFile>(`/uploads/${session.uploadId}/complete`, {
        method: "POST",
        body: JSON.stringify({ parts }),
      });
    } catch (error) {
      // Release the server-side session and its quota hold. Best-effort: the
      // original failure is what the caller needs to see.
      void this.#request(`/uploads/${session.uploadId}/abort`, { method: "POST" }).catch(
        () => {},
      );
      throw error;
    }
  }

  async #uploadSingle(
    file: File | Blob,
    session: Extract<ArkUploadSession, { multipart: false }>,
    contentType: string,
    report: (bytes: number) => void,
    signal: AbortSignal,
  ) {
    const result = await putWithProgress({
      url: session.url,
      body: file,
      headers: { "content-type": contentType, ...session.headers },
      onProgress: (uploaded) => report(uploaded),
      signal,
      fetchImpl: this.#fetch,
    });
    if (result.status < 200 || result.status >= 300) {
      throw uploadErrorFor(result.status, "single");
    }
    report(file.size);
    return undefined;
  }

  /**
   * Upload parts with bounded concurrency (§19). Per-part progress is summed
   * across workers so the reported total stays monotonic even though parts
   * complete out of order.
   */
  async #uploadParts(
    file: File | Blob,
    session: Extract<ArkUploadSession, { multipart: true }>,
    report: (bytes: number) => void,
    signal: AbortSignal,
  ) {
    const uploadedPerPart = new Map<number, number>();
    const etags: { partNumber: number; etag: string }[] = [];
    const queue = [...session.parts];
    const concurrency = Math.max(1, Math.min(session.maxConcurrency || 4, queue.length));

    const worker = async () => {
      while (queue.length > 0) {
        if (signal.aborted) throw new ArkError({ code: "UPLOAD_ABORTED", message: "Aborted" });
        const part = queue.shift();
        if (!part) return;
        const start = (part.partNumber - 1) * session.partSize;
        const chunk = file.slice(start, Math.min(start + session.partSize, file.size));

        const result = await putWithProgress({
          url: part.url,
          body: chunk,
          onProgress: (uploaded) => {
            uploadedPerPart.set(part.partNumber, uploaded);
            let total = 0;
            for (const value of uploadedPerPart.values()) total += value;
            report(total);
          },
          signal,
          fetchImpl: this.#fetch,
        });
        if (result.status < 200 || result.status >= 300) {
          throw uploadErrorFor(result.status, "part");
        }
        if (!result.etag) {
          throw new ArkError({
            code: "UPLOAD_FAILED",
            message: `Part ${part.partNumber} did not return an ETag`,
          });
        }
        uploadedPerPart.set(part.partNumber, chunk.size);
        etags.push({ partNumber: part.partNumber, etag: result.etag });
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    report(file.size);
    // S3 requires parts in ascending order at completion.
    return etags.sort((a, b) => a.partNumber - b.partNumber);
  }
}

function imageUrl(baseUrl: string, version: string, assetId: string, options: ArkImageOptions) {
  const query = new URLSearchParams();
  if (options.width) query.set("width", String(options.width));
  if (options.height) query.set("height", String(options.height));
  if (options.quality) query.set("quality", String(options.quality));
  if (options.format && options.format !== "original") query.set("format", options.format);
  if (options.thumbnail) query.set("thumbnail", "1");
  if (options.watermark) query.set("watermark", "1");
  return `${baseUrl}/api/${version}/assets/${encodeURIComponent(assetId)}/image${query.size ? `?${query}` : ""}`;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof window.document !== "undefined";
}

export type { ArkProgress };
