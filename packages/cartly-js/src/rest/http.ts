import { Header } from "../context"
import { CartlyApiError, ErrorCode, type ErrorDetail } from "../errors"

export interface RestRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE"
  /** Path under `/api/v1`, e.g. `/auth/login`. */
  path: `/${string}`
  body?: unknown
  accessToken?: string | null
  /**
   * `include` only for the auth routes that read or set the HttpOnly refresh
   * cookie; everything else omits cookies.
   */
  credentials?: "include" | "omit"
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface RestTransportOptions {
  /** API origin, e.g. `https://api.cartly.store` (no path). */
  baseUrl: string
  fetch?: typeof fetch
  timeoutMs?: number
}

export type RestTransport = <T>(request: RestRequest) => Promise<T>

/** Calls a REST endpoint and unwraps the `{ data }` / `{ error }` envelope. */
export function createRestTransport(
  options: RestTransportOptions
): RestTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const timeoutMs = options.timeoutMs ?? 15_000
  const root = new URL("/api/v1", options.baseUrl).toString()

  return async function rest<T>(request: RestRequest): Promise<T> {
    const headers = new Headers(request.headers)
    headers.set("Accept", "application/json")
    if (request.body !== undefined)
      headers.set("Content-Type", "application/json")
    if (request.accessToken)
      headers.set(Header.authorization, `Bearer ${request.accessToken}`)

    const timeout = AbortSignal.timeout(timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(`${root}${request.path}`, {
        method: request.method,
        headers,
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
        credentials: request.credentials ?? "omit",
        cache: "no-store",
        // Auth responses must never be followed to another origin.
        redirect: "error",
        signal: request.signal
          ? AbortSignal.any([request.signal, timeout])
          : timeout,
      })
    } catch (cause) {
      if (request.signal?.aborted) throw cause
      throw new CartlyApiError({
        code: timeout.aborted ? ErrorCode.TIMEOUT : ErrorCode.NETWORK_ERROR,
        message: timeout.aborted
          ? "The server took too long to respond."
          : "Could not reach the server.",
        cause,
      })
    }

    const requestId = response.headers.get(Header.requestId) ?? undefined
    if (response.status === 204) return undefined as T

    let body: {
      data?: T
      error?: {
        code?: string
        message?: string
        details?: ErrorDetail[]
        requestId?: string
      }
    }
    try {
      body = await response.json()
    } catch (cause) {
      throw new CartlyApiError({
        code: ErrorCode.INVALID_RESPONSE,
        message: "The server sent an unexpected response.",
        status: response.status,
        requestId,
        cause,
      })
    }

    if (!response.ok || body.error) {
      throw new CartlyApiError({
        code: body.error?.code ?? ErrorCode.INTERNAL_ERROR,
        message: body.error?.message ?? "Request failed.",
        status: response.status,
        requestId: body.error?.requestId ?? requestId,
        details: body.error?.details,
      })
    }
    return body.data as T
  }
}
