/**
 * Transport helpers: retry with backoff (§43) and XHR-based upload progress
 * (§44).
 */

import { ArkError, errorFromResponse } from "./errors";

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
};

/** Only these are worth retrying (§43); auth and validation failures are not. */
function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

/**
 * Exponential backoff with full jitter. Jitter matters: without it, every
 * client that failed at the same moment retries at the same moment and
 * re-creates the overload that caused the failure.
 */
function backoffDelay(attempt: number, baseDelayMs: number) {
  const ceiling = Math.min(baseDelayMs * 2 ** (attempt - 1), 30_000);
  return Math.random() * ceiling;
}

export async function requestWithRetry(
  doFetch: () => Promise<Response>,
  options: RetryOptions & { signal?: AbortSignal } = {},
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      throw new ArkError({ code: "UPLOAD_ABORTED", message: "Aborted" });
    }
    try {
      const response = await doFetch();
      if (response.ok || !isRetryableStatus(response.status)) return response;
      if (attempt === maxAttempts) return response;
      lastError = await errorFromResponse(response.clone());
    } catch (error) {
      // A network-level failure is transient by nature; an abort is not.
      if ((error as Error)?.name === "AbortError") {
        throw new ArkError({ code: "UPLOAD_ABORTED", message: "Aborted" });
      }
      lastError = error;
      if (attempt === maxAttempts) {
        throw new ArkError({
          code: "NETWORK_ERROR",
          message: (error as Error)?.message || "Network request failed",
        });
      }
    }
    await sleep(backoffDelay(attempt, baseDelayMs), options.signal);
  }

  throw lastError instanceof ArkError
    ? lastError
    : new ArkError({ code: "UPLOAD_FAILED", message: "Request failed after retries" });
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ArkError({ code: "UPLOAD_ABORTED", message: "Aborted" }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ArkError({ code: "UPLOAD_ABORTED", message: "Aborted" }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * PUT a body with real progress reporting.
 *
 * `fetch` cannot report request upload progress in any browser today, so this
 * uses XMLHttpRequest where available -- that is the only way to give the
 * accurate byte counts §44 requires. Outside a browser (Node, workers) there is
 * no XHR and no user-visible progress bar to drive, so it falls back to fetch
 * and reports completion.
 */
export function putWithProgress(input: {
  url: string;
  body: Blob | ArrayBuffer | Uint8Array;
  headers?: Record<string, string>;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ status: number; etag: string | null }> {
  if (input.signal?.aborted) {
    return Promise.reject(new ArkError({ code: "UPLOAD_ABORTED", message: "Upload aborted" }));
  }
  const hasXhr = typeof XMLHttpRequest !== "undefined";
  if (!hasXhr || !input.onProgress) {
    const doFetch = input.fetchImpl ?? fetch;
    return doFetch(input.url, {
      method: "PUT",
      body: input.body as BodyInit,
      headers: input.headers,
      signal: input.signal,
    }).then((response) => ({
      status: response.status,
      etag: (response.headers.get("etag") || "").replace(/"/g, "") || null,
    }));
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanup = () => input.signal?.removeEventListener("abort", onAbort);
    xhr.open("PUT", input.url, true);
    for (const [key, value] of Object.entries(input.headers ?? {})) {
      xhr.setRequestHeader(key, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) input.onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      cleanup();
      resolve({
        status: xhr.status,
        etag: (xhr.getResponseHeader("etag") || "").replace(/"/g, "") || null,
      });
    };
    xhr.onerror = () => {
      cleanup();
      reject(new ArkError({ code: "NETWORK_ERROR", message: "Upload connection failed" }));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new ArkError({ code: "UPLOAD_ABORTED", message: "Upload aborted" }));
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(input.body as XMLHttpRequestBodyInit);
  });
}
