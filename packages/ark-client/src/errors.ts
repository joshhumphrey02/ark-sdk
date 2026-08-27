/**
 * Error normalization (§42).
 *
 * Derived in shape from `s3-lite-client`'s error hierarchy (MIT; see
 * LICENSE.upstream). The provider-specific classes are gone: a customer of Ark
 * should never see a Cloudflare or Bunny error, only an Ark one.
 */

import type { ArkErrorCode } from "./types";

export class ArkError extends Error {
  readonly code: ArkErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | null;

  constructor(input: {
    code: ArkErrorCode;
    message: string;
    status?: number | null;
    requestId?: string | null;
    details?: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = "ArkError";
    this.code = input.code;
    this.status = input.status ?? null;
    this.requestId = input.requestId ?? null;
    this.details = input.details ?? null;
  }

  /**
   * Whether retrying could plausibly succeed (§43). Deliberately false for
   * auth, quota and validation failures: retrying those just burns the
   * customer's rate limit and delays a real error reaching them.
   */
  get retryable() {
    if (this.code === "NETWORK_ERROR" || this.code === "RATE_LIMITED") return true;
    return this.status !== null && this.status >= 500;
  }
}

const STATUS_CODES: Record<number, ArkErrorCode> = {
  401: "UNAUTHORIZED",
  403: "INSUFFICIENT_SCOPE",
  404: "NOT_FOUND",
  402: "QUOTA_EXCEEDED",
  413: "FILE_TOO_LARGE",
  415: "INVALID_FILE_TYPE",
  429: "RATE_LIMITED",
};

/** Turns an Ark API error envelope into an ArkError. */
export async function errorFromResponse(response: Response): Promise<ArkError> {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON body (a proxy error page, say) is not worth surfacing raw.
  }
  const envelope = body?.error ?? {};
  const code =
    (envelope.code as ArkErrorCode) ||
    STATUS_CODES[response.status] ||
    "INTERNAL_ERROR";
  return new ArkError({
    code,
    message: envelope.message || `Request failed with status ${response.status}`,
    status: response.status,
    requestId: envelope.requestId ?? null,
    details: envelope.details ?? null,
  });
}

/**
 * Maps a raw provider upload failure onto an Ark code (§42). A presigned URL
 * that has expired returns 403 from the provider, which would otherwise reach
 * the customer as a confusing permissions error.
 */
export function uploadErrorFor(status: number, phase: "single" | "part"): ArkError {
  if (status === 403 || status === 401) {
    return new ArkError({
      code: "UPLOAD_EXPIRED",
      message: "The upload authorization expired before the transfer finished. Please retry.",
      status,
    });
  }
  if (status === 413) {
    return new ArkError({
      code: "FILE_TOO_LARGE",
      message: "The file is larger than this upload allows.",
      status,
    });
  }
  return new ArkError({
    code: "UPLOAD_FAILED",
    message: `Upload ${phase === "part" ? "part " : ""}failed with status ${status}`,
    status,
  });
}
