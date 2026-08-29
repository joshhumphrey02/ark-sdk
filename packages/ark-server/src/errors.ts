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

/** Extracts `<Code>`/`<Message>` without pulling in an XML parser. */
export function errorFromS3Xml(body: string, status: number): ArkError {
  const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? "";
  const message = /<Message>([^<]+)<\/Message>/.exec(body)?.[1] ?? "";
  const requestId = /<RequestId>([^<]*)<\/RequestId>/.exec(body)?.[1] ?? null;
  return new ArkError({
    code: S3_CODES[code] || (status >= 500 ? "INTERNAL_ERROR" : "ACCESS_DENIED"),
    message: message || `S3 request failed with status ${status}`,
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
