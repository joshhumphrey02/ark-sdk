/**
 * `Ark` -- the high-level REST client (§22).
 *
 * Talks to the Ark REST API with an `ark_live_…` token. Server-side only: the
 * token is a permanent secret and must never reach a browser (§15, §16). For
 * browser uploads, mint a client session and use `@ark/client`.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { ArkError, errorFromRest } from "./errors";
import type { ArkFile, ArkFolder, ArkOptions, ArkUsage, ArkImageOptions, ArkImportInput } from "./types";

const DEFAULT_BASE_URL = "https://api.ark.nerdstackgrp.com";

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
    return `${this.#baseUrl}/api/${this.#version}${path}`;
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

    get: (fileId: string) => this.#request<ArkFile>(`/files/${fileId}`),

    delete: (fileId: string) =>
      this.#request<{ id: string; deleted: boolean }>(`/files/${fileId}`, { method: "DELETE" }),

    move: (fileId: string, input: { folderId: string | null }) =>
      this.#request<ArkFile>(`/files/${fileId}`, {
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
      options: {
        filename?: string;
        contentType?: string;
        folderId?: string | null;
        metadata?: Record<string, unknown>;
      } = {},
    ): Promise<ArkFile> => {
      const resolved = await resolveSource(source, options.filename);
      const session = await this.#request<any>("/uploads/presign", {
        method: "POST",
        body: JSON.stringify({
          filename: resolved.filename,
          size: resolved.size,
          mimeType: options.contentType || resolved.contentType,
          folderId: options.folderId ?? undefined,
          metadata: options.metadata,
        }),
      });

      try {
        const parts = session.multipart
          ? await this.#uploadParts(resolved.bytes, session)
          : await this.#uploadSingle(resolved, session, options.contentType);
        return await this.#request<ArkFile>(`/uploads/${session.uploadId}/complete`, {
          method: "POST",
          body: JSON.stringify({ parts }),
        });
      } catch (error) {
        // Free the server-side session and its quota hold before rethrowing.
        void this.#request(`/uploads/${session.uploadId}/abort`, { method: "POST" }).catch(
          () => {},
        );
        throw error;
      }
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
      this.#request<ArkFolder>(`/folders/${folderId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
  };

  readonly images = {
    url: (assetId: string, options: ArkImageOptions = {}) => imageUrl(this.#baseUrl, this.#version, assetId, options),
    signedUrl: async (assetId: string, options?: { expiresInSeconds?: number }) => {
      const suffix = options?.expiresInSeconds ? `?ttl=${options.expiresInSeconds}` : "";
      const result = await this.#request<{ url: string }>(`/assets/${assetId}/signed-url${suffix}`);
      return result.url;
    },
  };

  readonly imports = {
    create: (input: ArkImportInput) => this.#request<any>("/imports", { method: "POST", body: JSON.stringify(input) }),
    get: (importId: string) => this.#request<any>(`/imports/${importId}`),
    cancel: (importId: string) => this.#request<{ cancelled: boolean }>(`/imports/${importId}/cancel`, { method: "POST" }),
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

  async #uploadSingle(
    resolved: ResolvedSource,
    session: any,
    contentType?: string,
  ) {
    const response = await this.#fetch(session.url, {
      method: "PUT",
      body: resolved.bytes as BodyInit,
      headers: {
        "content-type": contentType || resolved.contentType,
        ...(session.headers || {}),
      },
    });
    if (!response.ok) {
      throw new ArkError({
        code: response.status === 403 ? "ACCESS_DENIED" : "INTERNAL_ERROR",
        message: `Upload failed with status ${response.status}`,
        status: response.status,
      });
    }
    return undefined;
  }

  async #uploadParts(bytes: Uint8Array, session: any) {
    const etags: { partNumber: number; etag: string }[] = [];
    const queue = [...session.parts];
    const concurrency = Math.max(1, Math.min(session.maxConcurrency || 4, queue.length));

    const worker = async () => {
      while (queue.length > 0) {
        const part = queue.shift();
        if (!part) return;
        const start = (part.partNumber - 1) * session.partSize;
        const chunk = bytes.subarray(start, Math.min(start + session.partSize, bytes.length));
        const response = await this.#fetch(part.url, {
          method: "PUT",
          body: chunk as BodyInit,
        });
        if (!response.ok) {
          throw new ArkError({
            code: "INTERNAL_ERROR",
            message: `Part ${part.partNumber} failed with status ${response.status}`,
            status: response.status,
          });
        }
        const etag = (response.headers.get("etag") || "").replace(/"/g, "");
        etags.push({ partNumber: part.partNumber, etag });
      }
    };

    await Promise.all(Array.from({ length: concurrency }, worker));
    return etags.sort((a, b) => a.partNumber - b.partNumber);
  }
}

function imageUrl(baseUrl: string, version: string, assetId: string, options: ArkImageOptions) {
  const query = new URLSearchParams();
  if (options.width) query.set("width", String(options.width)); if (options.height) query.set("height", String(options.height));
  if (options.quality) query.set("quality", String(options.quality)); if (options.format && options.format !== "original") query.set("format", options.format);
  if (options.thumbnail) query.set("thumbnail", "1"); if (options.watermark) query.set("watermark", "1");
  return `${baseUrl}/api/${version}/assets/${encodeURIComponent(assetId)}/image${query.size ? `?${query}` : ""}`;
}

type ResolvedSource = {
  bytes: Uint8Array;
  size: number;
  filename: string;
  contentType: string;
};

async function resolveSource(
  source: string | Uint8Array | Blob,
  filename?: string,
): Promise<ResolvedSource> {
  if (typeof source === "string") {
    const bytes = new Uint8Array(await readFile(source));
    return {
      bytes,
      size: bytes.length,
      filename: filename || basename(source),
      contentType: "application/octet-stream",
    };
  }
  if (source instanceof Uint8Array) {
    return {
      bytes: source,
      size: source.length,
      filename: filename || "upload",
      contentType: "application/octet-stream",
    };
  }
  const bytes = new Uint8Array(await source.arrayBuffer());
  return {
    bytes,
    size: bytes.length,
    filename: filename || (source as File).name || "upload",
    contentType: source.type || "application/octet-stream",
  };
}
