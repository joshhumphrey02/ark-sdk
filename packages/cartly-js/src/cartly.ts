import { assertSecureUrl } from "./context"
import { createGraphQLClient, type FetchInit } from "./graphql/client"
import { createAuthApi } from "./rest/auth"
import { createRestTransport } from "./rest/http"
import { createSessionManager } from "./session/session-manager"

export interface CartlyEndpoints {
  /** API origin for REST (`/api/v1/...`). */
  origin: string
  /** `POST` endpoint for GraphQL. */
  graphql: string
}

/** Validates the configured API URL and derives both endpoints from it. */
export function cartlyEndpoints(apiUrl: string): CartlyEndpoints {
  const url = assertSecureUrl(apiUrl, "Cartly API URL")
  return {
    origin: url.origin,
    graphql: new URL("/api/graphql", url.origin).toString(),
  }
}

export interface CartlyClientOptions {
  /** e.g. `https://api.cartly.store` */
  apiUrl: string
  fetch?: typeof fetch
  timeoutMs?: number
  /**
   * Cross-tab session channel. Apps sharing an origin (e.g. several branded
   * dashboards behind one domain) need distinct names so their sessions
   * never mix. Default "cartly-auth".
   */
  channelName?: string
}

/**
 * Everything a signed-in browser app needs: REST auth, the cross-tab session
 * and a GraphQL client that attaches a fresh access token to every call and
 * refreshes once on UNAUTHENTICATED. Create one per app, at module scope of a
 * client component.
 */
export function createCartlyBrowserClient(options: CartlyClientOptions) {
  const endpoints = cartlyEndpoints(options.apiUrl)
  const rest = createRestTransport({
    baseUrl: endpoints.origin,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
  })
  const auth = createAuthApi(rest)
  const session = createSessionManager({
    auth,
    channelName: options.channelName,
  })
  const graphql = createGraphQLClient({
    endpoint: endpoints.graphql,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    context: async () => ({ accessToken: await session.getAccessToken() }),
    onUnauthenticated: () => session.refresh(),
  })
  return { endpoints, rest, auth, session, graphql }
}

export type CartlyBrowserClient = ReturnType<typeof createCartlyBrowserClient>

/**
 * A GraphQL client for server code (route handlers, server actions, server
 * components). It has no session of its own: scope each request with
 * `.with({ storefrontHost, cartToken, ... })`.
 */
export function createCartlyServerClient(
  options: CartlyClientOptions & { init?: FetchInit }
) {
  const endpoints = cartlyEndpoints(options.apiUrl)
  return createGraphQLClient({
    endpoint: endpoints.graphql,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    init: options.init,
  })
}
