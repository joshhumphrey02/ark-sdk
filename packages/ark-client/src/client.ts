/**
 * `ArkClient` -- the Ark frontend SDK (§14, §17, §20).
 *
 * Framework-independent by design: no React, no Vue, no framework imports at
 * all. A thin `@nerdstackgrp/ark-react` wrapper can be layered on later without this
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
  ArkStream,
  ArkStreamCreateInput,
  ArkStreamImportInput,
  ArkStreamUploadOptions,
  ArkStreamUploadTicket,
} from "./types";

const DEFAULT_BASE_URL = "https://ark.nerdstackgrp.com";

function pathSegment(value: string) {
  return encodeURIComponent(value);
}

function streamQuery(appId?: string, extra?: { limit?: number; cursor?: string }) {
  const query = new URLSearchParams();
  if (appId) query.set("appId", appId);
  if (extra?.limit) query.set("limit", String(extra.limit));
  if (extra?.cursor) query.set("cursor", extra.cursor);
  return query.toString() ? `?${query}` : "";
}

function tusMetadata(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

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
          "@nerdstackgrp/ark-client does not accept S3 credentials. Use a short-lived Ark client session; " +
          "for server-side S3 access use ArkS3 from @nerdstackgrp/ark-server.",
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
    return `${this.#baseUrl}/api/${pathSegment(this.#version)}${path}`;
  }

  async #request<T>(
    path: string,
    init: RequestInit & { signal?: AbortSignal; retry?: boolean } = {},
  ): Promise<T> {
    const { retry = true, ...requestInit } = init;
    const response = await requestWithRetry(
      () =>
        this.#fetch(this.#url(path), {
          ...requestInit,
          headers: {
            authorization: `Bearer ${this.#token}`,
            ...(requestInit.body ? { "content-type": "application/json" } : {}),
            ...(requestInit.headers as Record<string, string>),
          },
        }),
      { signal: requestInit.signal, maxAttempts: retry ? undefined : 1 },
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

    get: (fileId: string) => this.#request<ArkFile>(`/files/${pathSegment(fileId)}`),

    delete: (fileId: string) =>
      this.#request<{ id: string; deleted: boolean }>(`/files/${pathSegment(fileId)}`, {
        method: "DELETE",
      }),

    /** Move or rename. The stored object is untouched (§30). */
    move: (fileId: string, input: { folderId: string | null }) =>
      this.#request<ArkFile>(`/files/${pathSegment(fileId)}`, {
        method: "PATCH",
        body: JSON.stringify({ folderId: input.folderId }),
      }),

    rename: (fileId: string, name: string) =>
      this.#request<ArkFile>(`/files/${pathSegment(fileId)}`, {
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
      const abortFromCaller = () => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) controller.abort(options.signal.reason);
      else options.signal?.addEventListener("abort", abortFromCaller, { once: true });

      const promise = this.#upload(file, options, controller.signal).finally(() => {
        options.signal?.removeEventListener("abort", abortFromCaller);
      }) as ArkUploadHandle;
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
      this.#request<ArkFolder>(`/folders/${pathSegment(folderId)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
  };

  readonly images = {
    url: (assetId: string, options: ArkImageOptions = {}) => imageUrl(this.#baseUrl, this.#version, assetId, options),
  };

  readonly streams = {
    create: (input: ArkStreamCreateInput) =>
      this.#request<{ stream: ArkStream; upload: ArkStreamUploadTicket }>("/streams", {
        method: "POST",
        body: JSON.stringify(input),
        retry: false,
      }),

    import: (input: ArkStreamImportInput) =>
      this.#request<ArkStream>("/streams/fetch", {
        method: "POST",
        body: JSON.stringify(input),
        retry: false,
      }),

    list: (params?: { appId?: string; limit?: number; cursor?: string }) =>
      this.#request<{ streams: ArkStream[]; nextCursor: string | null }>(
        `/streams${streamQuery(params?.appId, params)}`,
      ),

    get: (streamId: string, params?: { appId?: string }) =>
      this.#request<ArkStream>(
        `/streams/${pathSegment(streamId)}${streamQuery(params?.appId)}`,
      ),

    refreshUploadUrl: (streamId: string, params?: { appId?: string }) =>
      this.#request<ArkStreamUploadTicket>(
        `/streams/${pathSegment(streamId)}/upload-url${streamQuery(params?.appId)}`,
        { method: "POST" },
      ),

    delete: (streamId: string, params?: { appId?: string }) =>
      this.#request<void>(
        `/streams/${pathSegment(streamId)}${streamQuery(params?.appId)}`,
        { method: "DELETE" },
      ),

    /** Create a stream and transfer a File/Blob through Ark's resumable TUS facade. */
    upload: (file: File | Blob, options: ArkStreamUploadOptions = {}) => {
      const filename = (file as File).name || "video";
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) controller.abort(options.signal.reason);
      else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
      return this.#uploadStreamVideo(file, filename, options, controller.signal).finally(() => {
        options.signal?.removeEventListener("abort", abortFromCaller);
      });
    },
  };

  usage() {
    return this.#request<ArkUsage>("/usage");
  }

  async #uploadStreamVideo(
    file: File | Blob,
    filename: string,
    options: ArkStreamUploadOptions,
    signal: AbortSignal,
  ): Promise<ArkStream> {
    const chunkSize = options.chunkSize ?? 64 * 1024 * 1024;
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
      throw new ArkError({ code: "INVALID_ARGUMENT", message: "chunkSize must be a positive integer" });
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new ArkError({ code: "INVALID_ARGUMENT", message: "The video must contain at least one byte" });
    }
    const created = await this.#request<{ stream: ArkStream; upload: ArkStreamUploadTicket }>(
      "/streams",
      {
        method: "POST",
        body: JSON.stringify({
          title: options.title || filename.replace(/\.[^.]+$/, ""),
          sizeBytes: file.size,
          appId: options.appId,
          collectionId: options.collectionId,
        }),
        signal,
        retry: false,
      },
    );
    const ticketUrl = this.#url(created.upload.endpoint);
    const initial = await this.#tusFetch(ticketUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#token}`,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(file.size),
        "Upload-Metadata": `filename ${tusMetadata(filename)},filetype ${tusMetadata(file.type || "video/mp4")}`,
      },
      signal,
    });
    if (!initial.ok) throw await errorFromResponse(initial);
    const location = initial.headers.get("location");
    if (!location) {
      throw new ArkError({ code: "UPLOAD_FAILED", message: "Ark did not return a TUS upload location" });
    }
    const uploadUrl = new URL(location, ticketUrl).toString();
    let offset = 0;
    let retries = 0;
    while (offset < file.size) {
      const chunk = file.slice(offset, Math.min(file.size, offset + chunkSize));
      try {
        const response = await this.#tusFetch(uploadUrl, {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${this.#token}`,
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream",
          },
          body: chunk,
          signal,
        });
        if (!response.ok) throw await errorFromResponse(response);
        const acknowledged = Number(response.headers.get("upload-offset"));
        offset = Number.isFinite(acknowledged) && acknowledged > offset
          ? acknowledged
          : offset + chunk.size;
        retries = 0;
        options.onProgress?.({
          uploadedBytes: offset,
          totalBytes: file.size,
          percentage: file.size ? Math.min(100, (offset / file.size) * 100) : 100,
        });
      } catch (error) {
        if (signal.aborted || retries >= 2) throw error;
        retries += 1;
        const head = await this.#tusFetch(uploadUrl, {
          method: "HEAD",
          headers: { authorization: `Bearer ${this.#token}`, "Tus-Resumable": "1.0.0" },
          signal,
        });
        if (!head.ok) throw await errorFromResponse(head);
        const resumedOffset = Number(head.headers.get("upload-offset"));
        if (!Number.isFinite(resumedOffset) || resumedOffset < 0 || resumedOffset > file.size) {
          throw error;
        }
        offset = resumedOffset;
      }
    }
    return created.stream;
  }

  async #tusFetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url, init);
    } catch (error) {
      if (init.signal?.aborted || (error as Error)?.name === "AbortError") {
        throw new ArkError({ code: "UPLOAD_ABORTED", message: "Upload aborted" });
      }
      if (error instanceof ArkError) throw error;
      throw new ArkError({
        code: "NETWORK_ERROR",
        message: (error as Error)?.message || "Upload connection failed",
      });
    }
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
      return await this.#request<ArkFile>(`/uploads/${pathSegment(session.uploadId)}/complete`, {
        method: "POST",
        body: JSON.stringify({ parts }),
      });
    } catch (error) {
      // Release the server-side session and its quota hold. Best-effort: the
      // original failure is what the caller needs to see.
      await this.#request(`/uploads/${pathSegment(session.uploadId)}/abort`, {
        method: "POST",
      }).catch(() => {});
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
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal.reason);
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", abortFromCaller, { once: true });
    const uploadedPerPart = new Map<number, number>();
    const etags: { partNumber: number; etag: string }[] = [];
    const queue = [...session.parts];
    const concurrency = Math.max(1, Math.min(session.maxConcurrency || 4, queue.length));

    const worker = async () => {
      while (queue.length > 0) {
        if (controller.signal.aborted) {
          throw new ArkError({ code: "UPLOAD_ABORTED", message: "Aborted" });
        }
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
          signal: controller.signal,
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

    try {
      await Promise.all(Array.from({ length: concurrency }, async () => {
        try {
          await worker();
        } catch (error) {
          controller.abort(error);
          throw error;
        }
      }));
      report(file.size);
      // S3 requires parts in ascending order at completion.
      return etags.sort((a, b) => a.partNumber - b.partNumber);
    } finally {
      signal.removeEventListener("abort", abortFromCaller);
    }
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
  return `${baseUrl}/api/${pathSegment(version)}/assets/${pathSegment(assetId)}/image${query.size ? `?${query}` : ""}`;
}

function isBrowser() {
  return typeof window !== "undefined" && typeof window.document !== "undefined";
}

export type { ArkProgress };
