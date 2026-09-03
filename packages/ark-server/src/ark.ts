/**
 * `Ark` -- the high-level REST client (§22).
 *
 * Talks to the Ark REST API with an `ark_live_…` token. Server-side only: the
 * token is a permanent secret and must never reach a browser (§15, §16). For
 * browser uploads, mint a client session and use `@nerdstackgrp/ark-client`.
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { ArkError, errorFromRest } from "./errors";
import type {
  ArkFile,
  ArkFolder,
  ArkOptions,
  ArkUsage,
  ArkImageOptions,
  ArkImportInput,
  ArkUploadOptions,
  ArkUploadStream,
  ArkUploadStreamOptions,
  ArkStream,
  ArkStreamCreateInput,
  ArkStreamImportInput,
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

export class Ark {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #version: string;
  readonly #fetch: typeof fetch;

  constructor(options: ArkOptions) {
    if (!options?.token) {
      throw new ArkError({ code: "UNAUTHORIZED", message: "An Ark API token is required" });
    }
    this.#baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#token = options.token;
    this.#version = options.version || "v2";
    this.#fetch = options.fetch || globalThis.fetch.bind(globalThis);
  }

  /** Single place composing endpoints, so no path hardcodes the version (§56). */
  #url(path: string) {
    return `${this.#baseUrl}/api/${pathSegment(this.#version)}${path}`;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(this.#url(path), {
        ...init,
        headers: {
          authorization: `Bearer ${this.#token}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers as Record<string, string>),
        },
      });
    } catch (error) {
      throw new ArkError({
        code: "NETWORK_ERROR",
        message: (error as Error)?.message || "Network request failed",
      });
    }
    if (!response.ok) throw await errorFromRest(response);
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
      return this.#request<{ data: ArkFile[]; nextCursor: string | null }>(`/files${suffix}`);
    },

    get: (fileId: string) => this.#request<ArkFile>(`/files/${pathSegment(fileId)}`),

    delete: (fileId: string) =>
      this.#request<{ id: string; deleted: boolean }>(`/files/${pathSegment(fileId)}`, { method: "DELETE" }),

    move: (fileId: string, input: { folderId: string | null }) =>
      this.#request<ArkFile>(`/files/${pathSegment(fileId)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    getDownloadUrl: async (fileId: string, options?: { expiresInSeconds?: number }) => {
      const result = await this.#request<{ url: string }>("/downloads/presign", {
        method: "POST",
        body: JSON.stringify({ fileId, expiresInSeconds: options?.expiresInSeconds }),
      });
      return result.url;
    },

    /**
     * Upload from a path, Buffer or Blob. Multipart is handled transparently
     * when Ark asks for it, so callers do not branch on file size (§19).
     */
    upload: async (
      source: string | Uint8Array | Blob,
      options: ArkUploadOptions = {},
    ): Promise<ArkFile> => {
      const resolved = await resolveSource(source, options.filename);
      return this.#uploadResolved(resolved, {
        ...options,
        filename: resolved.filename,
        contentType: options.contentType || resolved.contentType,
      });
    },

    /** Upload a caller-provided stream without buffering the complete object. */
    uploadStream: (source: ArkUploadStream, options: ArkUploadStreamOptions) => {
      assertUploadSize(options?.size);
      if (!options?.filename) {
        throw invalidArgument("A filename is required");
      }
      assertUploadStream(source);
      return this.#uploadStream(source, options);
    },
  };

  readonly folders = {
    list: (params?: { parentId?: string }) => {
      const suffix = params?.parentId ? `?parentId=${encodeURIComponent(params.parentId)}` : "";
      return this.#request<{ data: ArkFolder[] }>(`/folders${suffix}`);
    },
    create: (input: { name: string; parentId?: string | null }) =>
      this.#request<ArkFolder>("/folders", { method: "POST", body: JSON.stringify(input) }),
    rename: (folderId: string, name: string) =>
      this.#request<ArkFolder>(`/folders/${pathSegment(folderId)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
  };

  readonly images = {
    url: (assetId: string, options: ArkImageOptions = {}) => imageUrl(this.#baseUrl, this.#version, assetId, options),
    signedUrl: async (assetId: string, options?: { expiresInSeconds?: number }) => {
      const suffix = options?.expiresInSeconds ? `?ttl=${options.expiresInSeconds}` : "";
      const result = await this.#request<{ url: string }>(`/assets/${pathSegment(assetId)}/signed-url${suffix}`);
      return result.url;
    },
  };

  readonly imports = {
    create: (input: ArkImportInput) => this.#request<any>("/imports", { method: "POST", body: JSON.stringify(input) }),
    get: (importId: string) => this.#request<any>(`/imports/${pathSegment(importId)}`),
    cancel: (importId: string) => this.#request<{ cancelled: boolean }>(`/imports/${pathSegment(importId)}/cancel`, { method: "POST" }),
  };

  /** Ark Streams control plane. Upload bytes with the returned TUS ticket in a client. */
  readonly streams = {
    create: (input: ArkStreamCreateInput) =>
      this.#request<{ stream: ArkStream; upload: ArkStreamUploadTicket }>("/streams", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    import: (input: ArkStreamImportInput) =>
      this.#request<ArkStream>("/streams/fetch", {
        method: "POST",
        body: JSON.stringify(input),
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
  };

  usage() {
    return this.#request<ArkUsage>("/usage");
  }

  /**
   * Mint a short-lived browser session (§16). This is how a customer's backend
   * lets its frontend upload without ever shipping the API token to a client.
   */
  createClientSession(input?: {
    scopes?: string[];
    folderId?: string | null;
    ttlSeconds?: number;
  }) {
    return this.#request<{
      token: string;
      expiresAt: string;
      expiresInSeconds: number;
      scopes: string[];
    }>("/client-sessions", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    });
  }

  async #uploadResolved(resolved: ResolvedSource, options: ArkUploadOptions & {
    filename: string;
    contentType: string;
  }) {
    assertUploadSize(resolved.size);
    return this.#withUploadSession(options, resolved.size, async (session) => {
      if (!session.multipart) {
        const upload = resolved.open(0, resolved.size);
        await this.#putUpload({
          url: session.url,
          upload,
          size: resolved.size,
          contentType: options.contentType,
          headers: session.headers,
        });
        return undefined;
      }
      return this.#uploadResolvedParts(resolved, session);
    });
  }

  async #uploadStream(source: ArkUploadStream, options: ArkUploadStreamOptions) {
    try {
      return await this.#withUploadSession(options, options.size, async (session) => {
        if (!session.multipart) {
          const validated = validatingStream(source, options.size);
          try {
            await this.#putUpload({
              url: session.url,
              upload: { body: validated.body as BodyInit, streaming: true },
              size: options.size,
              contentType: options.contentType || "application/octet-stream",
              headers: session.headers,
            });
          } catch (error) {
            await validated.cancel(error);
            throw error;
          }
          return undefined;
        }
        return this.#uploadStreamParts(source, options.size, session);
      });
    } catch (error) {
      await cancelUploadStream(source, error);
      throw error;
    }
  }

  async #withUploadSession(
    options: ArkUploadOptions & { filename: string },
    size: number,
    transfer: (session: UploadSession) => Promise<CompletedPart[] | undefined>,
  ): Promise<ArkFile> {
    const session = await this.#request<UploadSession>("/uploads/presign", {
      method: "POST",
      body: JSON.stringify({
        filename: options.filename,
        size,
        mimeType: options.contentType || "application/octet-stream",
        folderId: options.folderId ?? undefined,
        metadata: options.metadata,
      }),
    });

    try {
      const parts = await transfer(session);
      return await this.#request<ArkFile>(
        `/uploads/${pathSegment(session.uploadId)}/complete`,
        { method: "POST", body: JSON.stringify({ parts }) },
      );
    } catch (error) {
      // Release the server-side session and quota reservation before rejecting.
      await this.#request(`/uploads/${pathSegment(session.uploadId)}/abort`, {
        method: "POST",
      }).catch(() => {});
      throw error;
    }
  }

  async #uploadResolvedParts(resolved: ResolvedSource, session: MultipartUploadSession) {
    const etags: CompletedPart[] = [];
    const queue = [...session.parts];
    const concurrency = uploadConcurrency(session);
    const controller = new AbortController();

    const worker = async () => {
      while (queue.length > 0 && !controller.signal.aborted) {
        const part = queue.shift();
        if (!part) return;
        const start = (part.partNumber - 1) * session.partSize;
        const end = Math.min(start + session.partSize, resolved.size);
        try {
          const etag = await this.#putUpload({
            url: part.url,
            upload: resolved.open(start, end),
            size: end - start,
            signal: controller.signal,
            partNumber: part.partNumber,
          });
          etags.push({ partNumber: part.partNumber, etag: etag! });
        } catch (error) {
          controller.abort(error);
          throw error;
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    return etags.sort((a, b) => a.partNumber - b.partNumber);
  }

  async #uploadStreamParts(
    source: ArkUploadStream,
    declaredSize: number,
    session: MultipartUploadSession,
  ) {
    const reader = new UploadStreamReader(source, declaredSize);
    const controller = new AbortController();
    const results: CompletedPart[] = [];
    const inFlight = new Set<Promise<void>>();
    let uploadFailure: unknown;

    try {
      for (const part of session.parts) {
        while (inFlight.size >= uploadConcurrency(session)) {
          await Promise.race(inFlight);
        }
        if (uploadFailure) throw uploadFailure;

        const start = (part.partNumber - 1) * session.partSize;
        const expectedSize = Math.min(session.partSize, declaredSize - start);
        if (expectedSize <= 0) {
          throw invalidArgument("The upload session contains more parts than the declared size");
        }
        const bytes = await reader.readPart(expectedSize);
        const task = this.#putUpload({
          url: part.url,
          upload: { body: bytes as BodyInit, streaming: false },
          size: bytes.byteLength,
          signal: controller.signal,
          partNumber: part.partNumber,
        }).then((etag) => {
          results.push({ partNumber: part.partNumber, etag: etag! });
        });
        inFlight.add(task);
        void task.then(
          () => inFlight.delete(task),
          (error) => {
            uploadFailure = error;
            controller.abort(error);
            inFlight.delete(task);
          },
        );
      }

      await reader.assertComplete();
      await Promise.all(inFlight);
      if (uploadFailure) throw uploadFailure;
      return results.sort((a, b) => a.partNumber - b.partNumber);
    } catch (error) {
      controller.abort(error);
      await reader.cancel(error);
      await Promise.allSettled(inFlight);
      throw error;
    }
  }

  async #putUpload(input: {
    url: string;
    upload: UploadBody;
    size: number;
    contentType?: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    partNumber?: number;
  }) {
    const init: RequestInit & { duplex?: "half" } = {
      method: "PUT",
      body: input.upload.body,
      headers: {
        ...(input.contentType ? { "content-type": input.contentType } : {}),
        "content-length": String(input.size),
        ...(input.headers || {}),
      },
      signal: input.signal,
    };
    if (input.upload.streaming) init.duplex = "half";

    const response = await this.#fetch(input.url, init);
    if (!response.ok) {
      throw new ArkError({
        code: response.status === 403 ? "ACCESS_DENIED" : "INTERNAL_ERROR",
        message: input.partNumber
          ? `Part ${input.partNumber} failed with status ${response.status}`
          : `Upload failed with status ${response.status}`,
        status: response.status,
      });
    }
    if (input.partNumber) {
      const etag = (response.headers.get("etag") || "").replace(/"/g, "");
      if (!etag) {
        throw new ArkError({
          code: "INTERNAL_ERROR",
          message: `Part ${input.partNumber} did not return an ETag`,
        });
      }
      return etag;
    }
    return undefined;
  }
}

function imageUrl(baseUrl: string, version: string, assetId: string, options: ArkImageOptions) {
  const query = new URLSearchParams();
  if (options.width) query.set("width", String(options.width)); if (options.height) query.set("height", String(options.height));
  if (options.quality) query.set("quality", String(options.quality)); if (options.format && options.format !== "original") query.set("format", options.format);
  if (options.thumbnail) query.set("thumbnail", "1"); if (options.watermark) query.set("watermark", "1");
  return `${baseUrl}/api/${pathSegment(version)}/assets/${pathSegment(assetId)}/image${query.size ? `?${query}` : ""}`;
}

type ResolvedSource = {
  size: number;
  filename: string;
  contentType: string;
  open: (start: number, end: number) => UploadBody;
};

type UploadBody = { body: BodyInit; streaming: boolean };
type CompletedPart = { partNumber: number; etag: string };

type SingleUploadSession = {
  uploadId: string;
  multipart: false;
  url: string;
  headers?: Record<string, string>;
};

type MultipartUploadSession = {
  uploadId: string;
  multipart: true;
  partSize: number;
  parts: { partNumber: number; url: string }[];
  maxConcurrency?: number;
};

type UploadSession = SingleUploadSession | MultipartUploadSession;

async function resolveSource(
  source: string | Uint8Array | Blob,
  filename?: string,
): Promise<ResolvedSource> {
  if (typeof source === "string") {
    const file = await stat(source);
    return {
      size: file.size,
      filename: filename || basename(source),
      contentType: "application/octet-stream",
      open: (start, end) => ({
        body: createReadStream(source, { start, end: end - 1 }) as unknown as BodyInit,
        streaming: true,
      }),
    };
  }
  if (source instanceof Uint8Array) {
    return {
      size: source.length,
      filename: filename || "upload",
      contentType: "application/octet-stream",
      open: (start, end) => ({
        body: source.subarray(start, end) as BodyInit,
        streaming: false,
      }),
    };
  }
  return {
    size: source.size,
    filename: filename || (source as File).name || "upload",
    contentType: source.type || "application/octet-stream",
    open: (start, end) => ({ body: source.slice(start, end), streaming: false }),
  };
}

function assertUploadSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw invalidArgument("Upload size must be a positive safe integer");
  }
}

function invalidArgument(message: string) {
  return new ArkError({ code: "INVALID_ARGUMENT", message });
}

function uploadConcurrency(session: MultipartUploadSession) {
  return Math.max(1, Math.min(session.maxConcurrency || 4, session.parts.length));
}

function isWebStream(source: ArkUploadStream): source is ReadableStream<Uint8Array> {
  return source != null && typeof (source as ReadableStream<Uint8Array>).getReader === "function";
}

function assertUploadStream(source: ArkUploadStream) {
  if (
    !isWebStream(source) &&
    (source == null || typeof (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !== "function")
  ) {
    throw invalidArgument("Upload source must be a ReadableStream or AsyncIterable");
  }
}

function streamIterator(source: ArkUploadStream): AsyncIterator<Uint8Array> {
  if (!isWebStream(source)) return source[Symbol.asyncIterator]();
  const reader = source.getReader();
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      reader.releaseLock();
    }
  };
  return {
    async next() {
      const result = await reader.read();
      if (result.done) release();
      return result;
    },
    async return() {
      try {
        await reader.cancel();
      } finally {
        release();
      }
      return { done: true, value: undefined };
    },
  };
}

async function cancelUploadStream(source: ArkUploadStream, reason?: unknown) {
  try {
    if (isWebStream(source)) {
      if (!source.locked) await source.cancel(reason);
      return;
    }
    const destroy = (source as { destroy?: (error?: Error) => void }).destroy;
    if (typeof destroy === "function") {
      // Do not pass the upload error: Node would emit an unhandled `error`
      // event when callers have not installed their own listener.
      destroy.call(source);
    }
  } catch {
    // Cleanup must never replace the original upload error.
  }
}

class UploadStreamReader {
  readonly #iterator: AsyncIterator<Uint8Array>;
  readonly #declaredSize: number;
  #pending: Uint8Array | null = null;
  #pendingOffset = 0;
  #consumed = 0;
  #done = false;

  constructor(source: ArkUploadStream, declaredSize: number) {
    this.#iterator = streamIterator(source);
    this.#declaredSize = declaredSize;
  }

  async readPart(size: number) {
    const bytes = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      if (!this.#pending || this.#pendingOffset >= this.#pending.byteLength) {
        const next = await this.#iterator.next();
        if (next.done) {
          this.#done = true;
          throw invalidArgument(
            `Upload stream ended after ${this.#consumed + offset} bytes; expected ${this.#declaredSize}`,
          );
        }
        if (!(next.value instanceof Uint8Array)) {
          throw invalidArgument("Upload streams must yield Uint8Array chunks");
        }
        if (next.value.byteLength === 0) continue;
        this.#pending = next.value;
        this.#pendingOffset = 0;
      }
      const available = this.#pending.byteLength - this.#pendingOffset;
      const length = Math.min(size - offset, available);
      bytes.set(this.#pending.subarray(this.#pendingOffset, this.#pendingOffset + length), offset);
      this.#pendingOffset += length;
      offset += length;
    }
    this.#consumed += size;
    return bytes;
  }

  async assertComplete() {
    if (this.#consumed !== this.#declaredSize) {
      throw invalidArgument(
        `Upload stream produced ${this.#consumed} bytes; expected ${this.#declaredSize}`,
      );
    }
    if (this.#pending && this.#pendingOffset < this.#pending.byteLength) {
      throw invalidArgument(`Upload stream produced more than ${this.#declaredSize} bytes`);
    }
    while (!this.#done) {
      const next = await this.#iterator.next();
      if (next.done) {
        this.#done = true;
        return;
      }
      if (!(next.value instanceof Uint8Array)) {
        throw invalidArgument("Upload streams must yield Uint8Array chunks");
      }
      if (next.value.byteLength > 0) {
        throw invalidArgument(`Upload stream produced more than ${this.#declaredSize} bytes`);
      }
    }
  }

  async cancel(_reason?: unknown) {
    try {
      await this.#iterator.return?.();
    } catch {
      // Cleanup must never replace the original upload error.
    }
  }
}

function validatingStream(source: ArkUploadStream, declaredSize: number) {
  const reader = new UploadStreamReader(source, declaredSize);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent === declaredSize) {
        try {
          await reader.assertComplete();
          controller.close();
        } catch (error) {
          controller.error(error);
        }
        return;
      }
      try {
        const nextSize = Math.min(64 * 1024, declaredSize - sent);
        const chunk = await reader.readPart(nextSize);
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { body, cancel: (reason?: unknown) => reader.cancel(reason) };
}
