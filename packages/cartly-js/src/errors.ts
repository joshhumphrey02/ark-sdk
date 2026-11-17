/**
 * Stable error codes. REST returns them in `error.code`, GraphQL in
 * `errors[].extensions.code`; the values are the same in both transports.
 * Mirrors cartly/src/common/errors/error-codes.ts plus Apollo's request
 * error codes and the client-side codes at the bottom.
 */
export const ErrorCode = {
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  CONFLICT: "CONFLICT",
  BOOKING_UNAVAILABLE: "BOOKING_UNAVAILABLE",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  UNPROCESSABLE: "UNPROCESSABLE",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",

  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  INVALID_TOKEN: "INVALID_TOKEN",
  INVALID_MFA_CODE: "INVALID_MFA_CODE",
  TENANT_SUSPENDED: "TENANT_SUSPENDED",
  IDEMPOTENCY_KEY_REQUIRED: "IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  ENTITLEMENT_LIMIT_REACHED: "ENTITLEMENT_LIMIT_REACHED",
  FEATURE_NOT_AVAILABLE: "FEATURE_NOT_AVAILABLE",
  /** The business has not switched on the capability the operation needs. */
  CAPABILITY_NOT_ENABLED: "CAPABILITY_NOT_ENABLED",
  INVALID_STATE_TRANSITION: "INVALID_STATE_TRANSITION",
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  MEDIA_NOT_READY: "MEDIA_NOT_READY",
  PAYMENT_PROVIDER_ERROR: "PAYMENT_PROVIDER_ERROR",
  PAYMENT_NOT_CONFIGURED: "PAYMENT_NOT_CONFIGURED",
  INVALID_SIGNATURE: "INVALID_SIGNATURE",
  QUERY_TOO_COMPLEX: "QUERY_TOO_COMPLEX",
  QUERY_TOO_DEEP: "QUERY_TOO_DEEP",

  // Apollo request errors (the operation never ran).
  GRAPHQL_PARSE_FAILED: "GRAPHQL_PARSE_FAILED",
  GRAPHQL_VALIDATION_FAILED: "GRAPHQL_VALIDATION_FAILED",
  BAD_USER_INPUT: "BAD_USER_INPUT",

  // Client-side: the request did not produce a usable server response.
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  INVALID_REQUEST_CONTEXT: "INVALID_REQUEST_CONTEXT",
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/** A field-level validation problem (`VALIDATION_FAILED`). */
export interface ErrorDetail {
  path: string
  message: string
}

export interface CartlyApiErrorInit {
  code: string
  message: string
  status?: number
  requestId?: string
  details?: ErrorDetail[]
  path?: readonly (string | number)[]
  cause?: unknown
}

/**
 * Every failure from the Cartly API, REST or GraphQL, surfaces as this class.
 * Branch on `code`, never on `message`: messages are for people and may change.
 */
export class CartlyApiError extends Error {
  override readonly name = "CartlyApiError"
  /** One of {@link ErrorCode}; unknown future codes are passed through. */
  readonly code: ErrorCode | (string & {})
  readonly status: number | undefined
  /** Quote this in support requests; the server logs the cause under it. */
  readonly requestId: string | undefined
  readonly details: ErrorDetail[]
  /** GraphQL only: the response path of the field that failed. */
  readonly path: readonly (string | number)[] | undefined

  constructor(init: CartlyApiErrorInit) {
    super(init.message, { cause: init.cause })
    this.code = init.code
    this.status = init.status
    this.requestId = init.requestId
    this.details = init.details ?? []
    this.path = init.path
  }

  /** Field errors keyed by path, ready for a form library. */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.details.map((d) => [d.path, d.message]))
  }
}

export function isCartlyApiError(error: unknown): error is CartlyApiError {
  return error instanceof CartlyApiError
}

export function hasErrorCode(error: unknown, code: ErrorCode): boolean {
  return isCartlyApiError(error) && error.code === code
}

/** The session is gone or the token expired: refresh or sign in again. */
export function isAuthError(error: unknown): boolean {
  return (
    hasErrorCode(error, ErrorCode.UNAUTHENTICATED) ||
    hasErrorCode(error, ErrorCode.INVALID_TOKEN)
  )
}

const NON_RETRYABLE = new Set<string>([
  ErrorCode.BAD_REQUEST,
  ErrorCode.VALIDATION_FAILED,
  ErrorCode.UNAUTHENTICATED,
  ErrorCode.FORBIDDEN,
  ErrorCode.NOT_FOUND,
  ErrorCode.CONFLICT,
  ErrorCode.UNPROCESSABLE,
  ErrorCode.INVALID_CREDENTIALS,
  ErrorCode.ACCOUNT_LOCKED,
  ErrorCode.ACCOUNT_DISABLED,
  ErrorCode.INVALID_TOKEN,
  ErrorCode.TENANT_SUSPENDED,
  ErrorCode.IDEMPOTENCY_CONFLICT,
  ErrorCode.ENTITLEMENT_LIMIT_REACHED,
  ErrorCode.FEATURE_NOT_AVAILABLE,
  ErrorCode.INVALID_STATE_TRANSITION,
  ErrorCode.INSUFFICIENT_STOCK,
  ErrorCode.QUERY_TOO_COMPLEX,
  ErrorCode.QUERY_TOO_DEEP,
  ErrorCode.GRAPHQL_PARSE_FAILED,
  ErrorCode.GRAPHQL_VALIDATION_FAILED,
  ErrorCode.BAD_USER_INPUT,
  ErrorCode.INVALID_REQUEST_CONTEXT,
])

/**
 * Whether repeating the same request could succeed. Rate limits are excluded
 * on purpose: hammering a limiter only extends the lockout.
 */
export function isRetryable(error: unknown): boolean {
  if (!isCartlyApiError(error)) return false
  if (error.code === ErrorCode.RATE_LIMITED) return false
  return !NON_RETRYABLE.has(error.code)
}
