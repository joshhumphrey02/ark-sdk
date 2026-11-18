import { assertSecureUrl } from "./context"
import { createGraphQLClient, type FetchInit } from "./graphql/client"
import {
  createAuthApi,
  oauthStartUrl,
  type OAuthProvider,
  type RefreshTokenStore,
} from "./rest/auth"
import { createRestTransport } from "./rest/http"
import { createRestServices } from "./rest/services"
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
  /**
   * Token mode: where the refresh token is kept when there is no HttpOnly
   * cookie for it (a mobile app's secure storage, or a website server's own
   * session). Omit in a browser on Cartly's own origins.
   */
  refreshTokens?: RefreshTokenStore
  /** A stable id for this install, sent at sign-in (token mode). */
  deviceId?: () => string | null | Promise<string | null>
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
  const auth = createAuthApi(rest, {
    refreshTokens: options.refreshTokens,
    deviceId: options.deviceId,
  })
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
  const api = createRestServices({
    rest,
    apiOrigin: endpoints.origin,
    fetch: options.fetch,
    accessToken: () => session.getAccessToken(),
  })
  return {
    endpoints,
    rest,
    auth,
    session,
    graphql,
    /** The other REST endpoints: payment verification, media, devices, streams, audit log. */
    api,
    /** Google or Apple sign-in for an app (token mode); see `createPkce`. */
    oauthStartUrl: (
      provider: OAuthProvider,
      start: { redirectUri: string; codeChallenge: string }
    ) => oauthStartUrl(endpoints.origin, provider, start),
  }
}

/**
 * The client for a mobile app (React Native, Expo) or a website's own
 * server, signing people in to their Cartly accounts: merchants and their
 * staff, and event-goers on a marketplace. The refresh token is kept in
 * `refreshTokens` (expo-secure-store, or the website server's encrypted
 * session); the access token stays in memory. Browsers on Cartly's own
 * origins use `createCartlyBrowserClient` (HttpOnly cookie) instead.
 */
export function createCartlyAppClient(
  options: CartlyClientOptions & { refreshTokens: RefreshTokenStore }
) {
  return createCartlyBrowserClient(options)
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
