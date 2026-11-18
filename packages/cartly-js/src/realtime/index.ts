import { createClient, type Client } from "graphql-ws"

import { assertSecureUrl, contextHeaders, Header, type RequestContext } from "../context"
import { CartlyApiError, ErrorCode } from "../errors"
import type { TypedDocument, VariablesArgs } from "../graphql/client"

/** The API closes the socket with this when the access token expires. */
const TOKEN_EXPIRED = 4401

/** What a subscription may be scoped by (the same values as request headers). */
export type SubscriptionContext = Pick<
  RequestContext,
  "tenantId" | "storefrontHost" | "conversationToken"
>

export interface CartlySubscriptionsOptions {
  /** e.g. `https://api.cartly.store` */
  apiUrl: string
  /** A fresh access token per connection (the session manager's getAccessToken). Omit for public subscriptions. */
  accessToken?: () => Promise<string | null> | string | null
  context?: SubscriptionContext
  /** A WebSocket implementation where there is no global one (Node before 22). */
  webSocketImpl?: unknown
  onConnectionChange?: (connected: boolean) => void
}

export interface SubscriptionSink<TResult> {
  next(data: TResult): void
  error?(error: CartlyApiError): void
  complete?(): void
}

export interface CartlySubscriptions {
  /** Starts a subscription; call the returned function to stop it. */
  subscribe<TResult, TVariables>(
    document: TypedDocument<TResult, TVariables>,
    sink: SubscriptionSink<TResult>,
    ...variables: VariablesArgs<TVariables>
  ): () => void
  /** Closes the socket and every subscription. */
  dispose(): void
}

interface Active {
  query: string
  variables: unknown
  sink: SubscriptionSink<unknown>
  stop: (() => void) | null
}

function toError(error: unknown): CartlyApiError {
  if (error instanceof CartlyApiError) return error
  const first = Array.isArray(error)
    ? (error[0] as { message?: string; extensions?: { code?: string } } | undefined)
    : undefined
  if (first)
    return new CartlyApiError({
      code: first.extensions?.code ?? ErrorCode.INTERNAL_ERROR,
      message: first.message ?? "The subscription failed.",
    })
  return new CartlyApiError({
    code: ErrorCode.NETWORK_ERROR,
    message: "The live connection closed.",
    cause: error,
  })
}

/**
 * GraphQL subscriptions over WebSocket (graphql-ws, same path as queries):
 * `notificationReceived`, `orderActivity`, `conversationActivity`,
 * `myConversationActivity`, `paymentSessionActivity`, `eventCheckInActivity`.
 * Credentials and scope travel in the connection parameters, validated like
 * headers; a connection whose token expired reconnects with a fresh one and
 * resumes every subscription.
 */
export function createCartlySubscriptions(
  options: CartlySubscriptionsOptions
): CartlySubscriptions {
  const api = assertSecureUrl(options.apiUrl, "Cartly API URL")
  const url = new URL("/api/graphql", api.origin)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  const active = new Set<Active>()
  let client: Client | null = null
  let disposed = false

  async function connectionParams() {
    const accessToken = (await options.accessToken?.()) ?? null
    const headers = contextHeaders({ ...options.context, accessToken })
    const params: Record<string, string> = {}
    const authorization = headers.get(Header.authorization)
    const tenantId = headers.get(Header.tenantId)
    const storefrontHost = headers.get(Header.storefrontHost)
    const conversationToken = headers.get(Header.conversationToken)
    if (authorization) params["authorization"] = authorization
    if (tenantId) params["tenantId"] = tenantId
    if (storefrontHost) params["storefrontHost"] = storefrontHost
    if (conversationToken) params["conversationToken"] = conversationToken
    return params
  }

  function start(entry: Active) {
    entry.stop =
      connection().subscribe(
        { query: entry.query, variables: entry.variables as Record<string, unknown> },
        {
          next: (result) => {
            if (result.errors?.length) entry.sink.error?.(toError(result.errors))
            else if (result.data) entry.sink.next(result.data)
          },
          error: (error) => {
            // A token expiry restarts the connection; it isn't the subscriber's error.
            if ((error as { code?: number } | undefined)?.code === TOKEN_EXPIRED) return
            entry.sink.error?.(toError(error))
          },
          complete: () => entry.sink.complete?.(),
        }
      ) ?? null
  }

  function connection(): Client {
    if (client) return client
    const current = createClient({
      url: url.toString(),
      lazy: true,
      retryAttempts: 5,
      connectionParams,
      ...(options.webSocketImpl ? { webSocketImpl: options.webSocketImpl } : {}),
      on: {
        connected: () => options.onConnectionChange?.(true),
        closed: (event) => {
          options.onConnectionChange?.(false)
          if ((event as { code?: number } | undefined)?.code !== TOKEN_EXPIRED || disposed) return
          // graphql-ws treats 4401 as final: start again with a fresh token.
          if (client === current) client = null
          void current.dispose()
          for (const entry of active) start(entry)
        },
      },
    })
    client = current
    return current
  }

  return {
    subscribe(document, sink, ...[variables]) {
      if (disposed) throw new Error("These subscriptions were disposed.")
      const entry: Active = {
        query: document.toString(),
        variables: variables ?? {},
        sink: sink as SubscriptionSink<unknown>,
        stop: null,
      }
      active.add(entry)
      start(entry)
      return () => {
        active.delete(entry)
        entry.stop?.()
      }
    },
    dispose() {
      disposed = true
      for (const entry of active) entry.stop?.()
      active.clear()
      void client?.dispose()
      client = null
    },
  }
}
