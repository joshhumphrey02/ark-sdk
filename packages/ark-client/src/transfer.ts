/**
 * Moving an upload's bytes to storage, given a session Ark issued: one PUT,
 * or parts with bounded concurrency, with progress. Shared by `ArkClient`
 * (which minted the session itself) and `uploadToSession` (a session minted
 * by a product's backend through the product API).
 */

import { ArkError, uploadErrorFor } from "./errors";
import { putWithProgress } from "./http";
import type { ArkProgress, ArkUploadSession } from "./types";

export interface TransferContext {
  contentType: string;
  report: (uploadedBytes: number) => void;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  /**
   * Auth headers for a URL. Only Ark's own fallback URLs get any: presigned
   * provider URLs must never carry a credential.
   */
  authFor: (url: string) => Record<string, string>;
}

/** Returns the part ETags (ascending) for a multipart session, else undefined. */
export function transferToSession(
  file: File | Blob,
  session: ArkUploadSession,
  context: TransferContext,
): Promise<{ partNumber: number; etag: string }[] | undefined> {
  return session.multipart
    ? transferParts(file, session, context)
    : transferSingle(file, session, context);
}

async function transferSingle(
  file: File | Blob,
  session: Extract<ArkUploadSession, { multipart: false }>,
  context: TransferContext,
) {
  const result = await putWithFallback(context, {
    url: session.url,
    fallbackUrl: session.fallbackUrl,
    body: file,
    headers: { "content-type": context.contentType, ...session.headers },
    onProgress: (uploaded) => context.report(uploaded),
    signal: context.signal,
  });
  if (result.status < 200 || result.status >= 300) {
    throw uploadErrorFor(result.status, "single");
  }
  context.report(file.size);
  return undefined;
}

/**
 * PUT to the provider, and retry through Ark if that cannot complete.
 *
 * The direct URL is the fast path: the bytes go to the nearest provider edge
 * rather than through Ark's single origin. It fails outright when the bucket
 * publishes no CORS policy -- the browser refuses the preflight and reports
 * an opaque network error with no response to inspect, which is
 * indistinguishable from the provider being down.
 *
 * Falling back on that rather than surfacing it keeps an upload working
 * through a CORS gap, a proxy that strips preflights, or a network that
 * blocks the provider. A response that did arrive is returned as-is: a 403
 * from the provider is a real answer about this upload, and retrying it
 * through Ark would only spend the bytes twice.
 */
async function putWithFallback(
  context: TransferContext,
  input: {
    url: string;
    fallbackUrl?: string;
    body: Blob;
    headers?: Record<string, string>;
    onProgress: (uploadedBytes: number) => void;
    signal: AbortSignal;
  },
) {
  try {
    return await putWithProgress({
      url: input.url,
      body: input.body,
      headers: { ...context.authFor(input.url), ...input.headers },
      onProgress: input.onProgress,
      signal: input.signal,
      fetchImpl: context.fetchImpl,
    });
  } catch (error) {
    const aborted =
      input.signal.aborted ||
      (error instanceof ArkError && error.code === "UPLOAD_ABORTED");
    if (!input.fallbackUrl || aborted) throw error;
    // Progress restarts from zero for the retried transfer, so the reported
    // total does not jump backwards mid-upload.
    input.onProgress(0);
    return await putWithProgress({
      url: input.fallbackUrl,
      body: input.body,
      headers: {
        ...context.authFor(input.fallbackUrl),
        // The provider's required headers belong to the presigned URL, not
        // to Ark, which sets whatever the provider needs when it forwards.
        ...(input.headers?.["content-type"]
          ? { "content-type": input.headers["content-type"] }
          : {}),
      },
      onProgress: input.onProgress,
      signal: input.signal,
      fetchImpl: context.fetchImpl,
    });
  }
}

/**
 * Upload parts with bounded concurrency (§19). Per-part progress is summed
 * across workers so the reported total stays monotonic even though parts
 * complete out of order.
 */
async function transferParts(
  file: File | Blob,
  session: Extract<ArkUploadSession, { multipart: true }>,
  context: TransferContext,
) {
  const { signal, report } = context;
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

      const result = await putWithFallback(context, {
        url: part.url,
        fallbackUrl: part.fallbackUrl,
        body: chunk,
        onProgress: (uploaded) => {
          uploadedPerPart.set(part.partNumber, uploaded);
          let total = 0;
          for (const value of uploadedPerPart.values()) total += value;
          report(total);
        },
        signal: controller.signal,
      });
      if (result.status < 200 || result.status >= 300) {
        throw uploadErrorFor(result.status, "part");
      }
      // A direct provider upload returns the ETag as a header, which the
      // bucket's CORS policy must expose. The Ark fallback returns it in the
      // JSON body instead, so a part that went through Ark still completes
      // even where ExposeHeaders is missing.
      const etag = result.etag ?? etagFromBody(result.body);
      if (!etag) {
        throw new ArkError({
          code: "UPLOAD_FAILED",
          message: `Part ${part.partNumber} did not return an ETag`,
        });
      }
      uploadedPerPart.set(part.partNumber, chunk.size);
      etags.push({ partNumber: part.partNumber, etag });
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

/** The ETag from an Ark part response, or null if the body is not one. */
function etagFromBody(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as { etag?: unknown };
    return typeof parsed.etag === "string" && parsed.etag ? parsed.etag : null;
  } catch {
    return null;
  }
}

export interface UploadToSessionOptions {
  contentType?: string;
  onProgress?: (progress: ArkProgress) => void;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

/**
 * Uploads a file's bytes to a session a product's backend created through
 * Ark's product API (`ArkProduct.uploads.create` in
 * `@nerdstackgrp/ark-server`), then returns what that backend needs to
 * complete it: the part ETags for a multipart session, else nothing.
 *
 * The browser holds no Ark credential here, so Ark's `fallbackUrl`s (which
 * need the product's token) are never used: only the presigned URLs are.
 *
 * ```ts
 * const session = await myApi.startUpload(file); // your backend → ArkProduct
 * const { parts } = await uploadToSession(file, session, { onProgress });
 * await myApi.finishUpload(session.uploadId, parts); // → ArkProduct.uploads.complete
 * ```
 */
export async function uploadToSession(
  file: File | Blob,
  session: ArkUploadSession,
  options: UploadToSessionOptions = {},
): Promise<{ parts: { partNumber: number; etag: string }[] | undefined }> {
  const total = file.size;
  const withoutFallback: ArkUploadSession = session.multipart
    ? { ...session, parts: session.parts.map(({ fallbackUrl: _drop, ...part }) => part) }
    : { ...session, fallbackUrl: undefined };
  const parts = await transferToSession(file, withoutFallback, {
    contentType: options.contentType || file.type || "application/octet-stream",
    report: (uploadedBytes) =>
      options.onProgress?.({
        uploadedBytes,
        totalBytes: total,
        percentage: total > 0 ? Math.min(100, (uploadedBytes / total) * 100) : 0,
      }),
    signal: options.signal ?? new AbortController().signal,
    fetchImpl: options.fetch || globalThis.fetch.bind(globalThis),
    authFor: () => ({}),
  });
  return { parts };
}
