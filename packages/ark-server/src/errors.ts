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
    if (this.code === "RATE_LIMITED" || this.code === "NETWORK_ERROR") return true;
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

export async function errorFromRest(response: Response): Promise<ArkError> {
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON bodies carry nothing worth surfacing.
  }
  const envelope = body?.error ?? {};
  return new ArkError({
    code: (envelope.code as ArkErrorCode) || "INTERNAL_ERROR",
    message: envelope.message || `Request failed with status ${response.status}`,
    status: response.status,
    requestId: envelope.requestId ?? null,
  });
}
