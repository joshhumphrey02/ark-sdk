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
    // BLOCKED_BY_EDGE is retryable: the request never reached Ark, and a
    // challenge can clear on a subsequent attempt or once the block is lifted.
    if (
      this.code === "NETWORK_ERROR" ||
      this.code === "RATE_LIMITED" ||
      this.code === "BLOCKED_BY_EDGE"
    )
      return true;
    return this.status !== null && this.status >= 500;
  }
}

const STATUS_CODES: Record<number, ArkErrorCode> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHORIZED",
  403: "INSUFFICIENT_SCOPE",
  404: "NOT_FOUND",
  402: "QUOTA_EXCEEDED",
  413: "FILE_TOO_LARGE",
  415: "INVALID_FILE_TYPE",
  429: "RATE_LIMITED",
};

/**
 * Whether a failing response came from something in front of Ark rather than
 * from Ark itself.
 *
 * The Ark API answers every request -- success or error -- with JSON, so an
 * HTML body on an error response cannot have come from Ark. In practice it is
 * a CDN or WAF challenge page: server-side SDK calls originate from data-centre
 * IP ranges (Vercel, Netlify, Fly, Railway, AWS Lambda), which bot protection
 * scores as automated traffic and answers with an interstitial.
 *
 * Detected by content type rather than by matching challenge text, so this
 * holds for any interposed proxy and does not depend on one vendor's wording.
 */
function isEdgeBlock(response: Response, body: unknown): boolean {
  if (body !== null) return false;
  if (response.status !== 403 && response.status !== 503 && response.status !== 429) return false;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("text/html");
}

/** Turns an Ark API error envelope into an ArkError. */
export async function errorFromResponse(response: Response): Promise<ArkError> {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON body (a proxy error page, say) is not worth surfacing raw.
  }

  // Reported before the status mapping below, which would otherwise call this
  // INSUFFICIENT_SCOPE and send the developer to audit a token that is fine.
  if (isEdgeBlock(response, body)) {
    const ray = response.headers.get("cf-ray");
    return new ArkError({
      code: "BLOCKED_BY_EDGE",
      message:
        "The request was blocked by a network in front of Ark and never reached it. " +
        "This usually means bot protection challenged the call because it came from a " +
        "data-centre IP, which is where server-side code runs. " +
        "The site owner can allow it by exempting the API path from the challenge." +
        (ray ? ` Reference: cf-ray ${ray}.` : ""),
      status: response.status,
      requestId: ray,
      details: ray ? { cfRay: ray } : null,
    });
  }
  const rawError = body?.error;
  const envelope = rawError && typeof rawError === "object" ? rawError : {};
  const code =
    (envelope.code as ArkErrorCode) ||
    STATUS_CODES[response.status] ||
    "INTERNAL_ERROR";
  return new ArkError({
    code,
    message:
      envelope.message ||
      (typeof rawError === "string" ? rawError : `Request failed with status ${response.status}`),
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
