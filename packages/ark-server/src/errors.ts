/**
 * Ark server SDK errors.
 *
 * The REST surface returns Ark's JSON envelope; the S3 surface returns S3 XML.
 * Both are normalized into one `ArkError` so a caller mixing the two APIs
 * handles a single error type (§40).
 */

export type ArkErrorCode =
  | "INVALID_ARGUMENT"
  | "UNAUTHORIZED"
  | "INSUFFICIENT_SCOPE"
  | "ACCESS_DENIED"
  | "NOT_FOUND"
  | "NO_SUCH_BUCKET"
  | "NO_SUCH_KEY"
  | "QUOTA_EXCEEDED"
  | "SIGNATURE_INVALID"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "BLOCKED_BY_EDGE"
  | "INTERNAL_ERROR";

export class ArkError extends Error {
  readonly code: ArkErrorCode;
  readonly status: number | null;
  readonly requestId: string | null;

  constructor(input: {
    code: ArkErrorCode;
    message: string;
    status?: number | null;
    requestId?: string | null;
  }) {
    super(input.message);
    this.name = "ArkError";
    this.code = input.code;
    this.status = input.status ?? null;
    this.requestId = input.requestId ?? null;
  }

  get retryable() {
    // BLOCKED_BY_EDGE is retryable: the request never reached Ark, and a
    // challenge can clear on a retry or once the block is lifted.
    if (
      this.code === "RATE_LIMITED" ||
      this.code === "NETWORK_ERROR" ||
      this.code === "BLOCKED_BY_EDGE"
    )
      return true;
    return this.status !== null && this.status >= 500;
  }
}

const S3_CODES: Record<string, ArkErrorCode> = {
  AccessDenied: "ACCESS_DENIED",
  NoSuchBucket: "NO_SUCH_BUCKET",
  NoSuchKey: "NO_SUCH_KEY",
  NoSuchUpload: "NOT_FOUND",
  InvalidAccessKeyId: "UNAUTHORIZED",
  SignatureDoesNotMatch: "SIGNATURE_INVALID",
  RequestTimeTooSkewed: "SIGNATURE_INVALID",
  EntityTooLarge: "QUOTA_EXCEEDED",
  SlowDown: "RATE_LIMITED",
};

/**
 * Ark's own wording for each failure.
 *
 * Storage runs on third-party infrastructure, and their error bodies name the
 * vendor and its internals. Callers integrate against Ark, so they are told
 * what went wrong in Ark's terms; the upstream text is never passed through.
 */
const ARK_MESSAGES: Record<ArkErrorCode, string> = {
  INVALID_ARGUMENT: "The request was not valid.",
  UNAUTHORIZED: "These credentials are not valid.",
  INSUFFICIENT_SCOPE: "These credentials do not allow this operation.",
  ACCESS_DENIED: "This operation is not allowed.",
  NOT_FOUND: "That resource does not exist.",
  NO_SUCH_BUCKET: "That bucket does not exist.",
  NO_SUCH_KEY: "That object does not exist.",
  QUOTA_EXCEEDED: "This upload exceeds the storage available on your plan.",
  SIGNATURE_INVALID:
    "The request signature was not valid. Check the system clock and the credentials in use.",
  RATE_LIMITED: "Too many requests. Retry shortly.",
  NETWORK_ERROR: "The storage service could not be reached.",
  BLOCKED_BY_EDGE:
    "The request was blocked by a network in front of Ark and never reached it. " +
    "This usually means bot protection challenged the call because it came from a " +
    "data-centre IP, which is where server-side code runs. The site owner can allow " +
    "it by exempting the API path from the challenge.",
  INTERNAL_ERROR: "The storage service is temporarily unavailable.",
};

/**
 * Extracts `<Code>` without pulling in an XML parser.
 *
 * `<Message>` is deliberately discarded: it is the storage vendor's prose,
 * naming their product and infrastructure, and it reaches application users
 * verbatim if surfaced. The code is mapped to Ark's own message instead.
 */
export function errorFromS3Xml(body: string, status: number): ArkError {
  const rawCode = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? "";
  const requestId = /<RequestId>([^<]*)<\/RequestId>/.exec(body)?.[1] ?? null;
  const code = S3_CODES[rawCode] || (status >= 500 ? "INTERNAL_ERROR" : "ACCESS_DENIED");
  return new ArkError({
    code,
    message: ARK_MESSAGES[code],
    status,
    requestId,
  });
}

/**
 * Whether a failure came from something in front of Ark rather than from Ark.
 *
 * The Ark API answers every request -- success or error -- with JSON, so an
 * HTML body on an error response cannot have come from Ark. In practice it is a
 * CDN or WAF challenge page. This package is the one most exposed to it: server
 * SDK calls run on Vercel, Netlify, Fly, Railway and Lambda, whose data-centre
 * IP ranges bot protection scores as automated traffic.
 *
 * Detected by content type rather than by matching challenge text, so this
 * holds for any interposed proxy and not just one vendor's wording.
 */
function isEdgeBlock(response: Response, body: unknown): boolean {
  if (body !== null) return false;
  if (response.status !== 403 && response.status !== 503 && response.status !== 429) return false;
  return (response.headers.get("content-type") || "").includes("text/html");
}

export async function errorFromRest(response: Response): Promise<ArkError> {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON bodies carry nothing worth surfacing.
  }

  // Checked before the status mapping below, which would otherwise report this
  // as INSUFFICIENT_SCOPE and send the developer to audit a token that is fine.
  if (isEdgeBlock(response, body)) {
    const ray = response.headers.get("cf-ray");
    return new ArkError({
      code: "BLOCKED_BY_EDGE",
      message: ARK_MESSAGES.BLOCKED_BY_EDGE + (ray ? ` Reference: cf-ray ${ray}.` : ""),
      status: response.status,
      requestId: ray,
    });
  }

  const rawError = body?.error;
  const envelope = rawError && typeof rawError === "object" ? rawError : {};
  const statusCodes: Record<number, ArkErrorCode> = {
    400: "INVALID_ARGUMENT",
    401: "UNAUTHORIZED",
    402: "QUOTA_EXCEEDED",
    403: "INSUFFICIENT_SCOPE",
    404: "NOT_FOUND",
    429: "RATE_LIMITED",
  };
  return new ArkError({
    code: (envelope.code as ArkErrorCode) || statusCodes[response.status] || "INTERNAL_ERROR",
    message:
      envelope.message ||
      (typeof rawError === "string" ? rawError : `Request failed with status ${response.status}`),
    status: response.status,
    requestId: envelope.requestId ?? null,
  });
}
