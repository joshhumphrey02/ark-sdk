import type { DocumentTypeDecoration } from "@graphql-typed-document-node/core"

import {
  contextHeaders,
  Header,
  mergeContext,
  type RequestContext,
} from "../context"
import { CartlyApiError, ErrorCode, type ErrorDetail } from "../errors"

/** A typed operation produced by `graphql()` from "@nerdstackgrp/cartly/graphql". */
export type TypedDocument<TResult, TVariables> = DocumentTypeDecoration<
  TResult,
  TVariables
> & { toString(): string }

/** Variables are optional when the operation declares none (or all optional). */
export type VariablesArgs<TVariables> =
  Record<string, never> extends TVariables
    ? [variables?: TVariables]
    : [variables: TVariables]

export interface GraphQLErrorEntry {
  message: string
  path?: (string | number)[]
  extensions?: {
    code?: string
    status?: number
    requestId?: string
    details?: ErrorDetail[]
  }
}

export interface GraphQLResult<TResult> {
  /** Null when the operation failed as a whole. */
  data: TResult | null
  /** Present when any field failed; `data` may still hold the rest. */
  errors: CartlyApiError[]
}

/** Extra fetch options, e.g. Next's `{ next: { revalidate, tags } }`. */
export type FetchInit = Omit<
  RequestInit,
  "method" | "body" | "headers" | "credentials" | "signal"
> & { next?: { revalidate?: number | false; tags?: string[] } }

export interface GraphQLClientOptions {
  /** Absolute URL of `POST /api/graphql`. */
  endpoint: string
  /**
   * Resolved before every request, so it can return a fresh access token.
   * Merged under the context given to `with()`.
   */
  context?: () => RequestContext | Promise<RequestContext>
  /**
   * Called once when the server answers UNAUTHENTICATED. Resolve to true
   * after refreshing the session to retry the request one time.
   */
  onUnauthenticated?: () => Promise<boolean>
  /** Abort after this long. Default 15 s. */
  timeoutMs?: number
  fetch?: typeof fetch
  /** Defaults to `{ cache: "no-store" }`: responses are per user and tenant. */
  init?: FetchInit
}

export interface RequestOptions {
  signal?: AbortSignal
  init?: FetchInit
}

export interface GraphQLClient {
  /** Resolves to `data`; throws the first error if any field failed. */
  request<TResult, TVariables>(
    document: TypedDocument<TResult, TVariables>,
    ...variables: VariablesArgs<TVariables>
  ): Promise<TResult>
  /** Resolves to `{ data, errors }` for screens that can render partial data. */
  execute<TResult, TVariables>(
    document: TypedDocument<TResult, TVariables>,
    ...variables: VariablesArgs<TVariables>
  ): Promise<GraphQLResult<TResult>>
  /** A client that sends these context values (and options) on every call. */
  with(context: RequestContext, options?: RequestOptions): GraphQLClient
  /** The fixed part of this client's context, e.g. for cache keys. */
  readonly scope: Readonly<RequestContext>
}

/** Reads the operation name, used for logging and cache keys. */
export function operationName(document: { toString(): string }) {
  return (
    /\b(?:query|mutation|subscription)\s+([_A-Za-z][_0-9A-Za-z]*)/.exec(
      document.toString()
    )?.[1] ?? "anonymous"
  )
}

function toError(entry: GraphQLErrorEntry, httpStatus: number) {
  return new CartlyApiError({
    code: entry.extensions?.code ?? ErrorCode.INTERNAL_ERROR,
    message: entry.message || "Request failed.",
    status: entry.extensions?.status ?? httpStatus,
    requestId: entry.extensions?.requestId,
    details: entry.extensions?.details,
    path: entry.path,
  })
}

export function createGraphQLClient(
  options: GraphQLClientOptions
): GraphQLClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const timeoutMs = options.timeoutMs ?? 15_000

  async function send(
    query: string,
    variables: unknown,
    scope: RequestContext,
    requestOptions: RequestOptions | undefined
  ): Promise<{ status: number; body: unknown; requestId: string | null }> {
    const context = mergeContext(await options.context?.(), scope)
    const headers = contextHeaders(context)
    headers.set("Content-Type", "application/json")
    headers.set("Accept", "application/graphql-response+json, application/json")

    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = requestOptions?.signal
      ? AbortSignal.any([requestOptions.signal, timeout])
      : timeout

    let response: Response
    try {
      response = await fetchImpl(options.endpoint, {
        cache: "no-store",
        ...options.init,
        ...requestOptions?.init,
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables: variables ?? {} }),
        // Auth is the bearer header. Never attach cookies to GraphQL: that
        // keeps it immune to CSRF regardless of the caller's origin.
        credentials: "omit",
        signal,
      })
    } catch (cause) {
      if (requestOptions?.signal?.aborted) throw cause
      const timedOut = timeout.aborted
      throw new CartlyApiError({
        code: timedOut ? ErrorCode.TIMEOUT : ErrorCode.NETWORK_ERROR,
        message: timedOut
          ? "The server took too long to respond."
          : "Could not reach the server.",
        cause,
      })
    }

    const requestId = response.headers.get(Header.requestId)
    let body: unknown
    try {
      body = await response.json()
    } catch (cause) {
      throw new CartlyApiError({
        code: ErrorCode.INVALID_RESPONSE,
        message: "The server sent an unexpected response.",
        status: response.status,
        requestId: requestId ?? undefined,
        cause,
      })
    }
    return { status: response.status, body, requestId }
  }

  function build(scope: RequestContext, scopeOptions?: RequestOptions) {
    async function execute<TResult, TVariables>(
      document: TypedDocument<TResult, TVariables>,
      variables?: TVariables
    ): Promise<GraphQLResult<TResult>> {
      const query = document.toString()
      let attempt = await send(query, variables, scope, scopeOptions)
      let result = parse<TResult>(attempt)

      if (
        options.onUnauthenticated &&
        result.data === null &&
        result.errors.length > 0 &&
        result.errors.every((e) => e.code === ErrorCode.UNAUTHENTICATED) &&
        (await options.onUnauthenticated())
      ) {
        // Root fields are authorised before they run, so a request refused as
        // UNAUTHENTICATED had no effect and is safe to repeat once.
        attempt = await send(query, variables, scope, scopeOptions)
        result = parse<TResult>(attempt)
      }
      return result
    }

    const client: GraphQLClient = {
      scope: Object.freeze({ ...scope }),
      execute: (document, ...[variables]) => execute(document, variables),
      async request(document, ...[variables]) {
        const { data, errors } = await execute(document, variables)
        const [first] = errors
        if (first) throw first
        if (data === null) {
          throw new CartlyApiError({
            code: ErrorCode.INVALID_RESPONSE,
            message: "The server returned no data.",
          })
        }
        return data
      },
      with: (context, more) =>
        build(mergeContext(scope, context), {
          ...scopeOptions,
          ...more,
          init: { ...scopeOptions?.init, ...more?.init },
        }),
    }
    return client
  }

  return build({})
}

function parse<TResult>(attempt: {
  status: number
  body: unknown
  requestId: string | null
}): GraphQLResult<TResult> {
  const body = attempt.body as {
    data?: TResult | null
    errors?: GraphQLErrorEntry[]
  } | null

  if (
    !body ||
    typeof body !== "object" ||
    !("data" in body || "errors" in body)
  ) {
    throw new CartlyApiError({
      code: ErrorCode.INVALID_RESPONSE,
      message: "The server sent an unexpected response.",
      status: attempt.status,
      requestId: attempt.requestId ?? undefined,
    })
  }
  return {
    data: body.data ?? null,
    errors: (body.errors ?? []).map((entry) => toError(entry, attempt.status)),
  }
}
