import { assertSecureUrl } from "../context"
import { CartlyApiError, ErrorCode } from "../errors"
import { createGraphQLClient, type FetchInit } from "../graphql/client"

/**
 * "Sign in with Cartly" for a merchant's own app or website: Cartly's OAuth
 * for third-party apps (the API's ADR 0028). The merchant registers the app
 * and its return addresses themselves (Cartly web app, `/account/developers`);
 * a person approves it for one business on Cartly's consent page; the app
 * gets a token limited to that business and the permissions approved, never
 * the person's Cartly account. The business can disconnect it at any time
 * (Settings → Connected apps).
 */

export interface ConnectedAppTokens {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  /** The permissions approved. */
  scopes: string[]
  /** The business the app was approved for (sent as X-Tenant-Id). */
  businessId: string
}

/**
 * Where the app keeps its tokens: a phone's secure storage, or the server's
 * own encrypted store. Never localStorage or anything page scripts can read.
 */
export interface ConnectedAppTokenStore {
  get(): ConnectedAppTokens | null | Promise<ConnectedAppTokens | null>
  set(tokens: ConnectedAppTokens): void | Promise<void>
  clear(): void | Promise<void>
}

export interface ConnectedAppOptions {
  /** e.g. `https://api.cartly.store` */
  apiUrl: string
  /** Cartly's web app, where the consent page is, e.g. `https://merchant.nerdstackgrp.com`. */
  appUrl: string
  /** From `/account/developers`. */
  clientId: string
  /**
   * Only for an app whose server keeps it (a confidential client). Never in
   * a phone app or browser code: register those as public clients (PKCE only).
   */
  clientSecret?: string
  /** One of the return addresses registered for the app, exactly. */
  redirectUri: string
  tokens: ConnectedAppTokenStore
  fetch?: typeof fetch
  timeoutMs?: number
  /** Extra fetch options for GraphQL calls, e.g. Next's `{ next: { revalidate } }`. */
  init?: FetchInit
  /** Refresh this long before the access token expires. Default 60 s. */
  refreshMarginMs?: number
}

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token: string
  scope: string
  business_id: string
}

/** OAuth errors after which the stored tokens are useless. */
const FINISHED = new Set(["invalid_grant", "invalid_client", "unauthorized_client"])

export function createCartlyConnectedApp(options: ConnectedAppOptions) {
  const api = assertSecureUrl(options.apiUrl, "Cartly API URL")
  const app = assertSecureUrl(options.appUrl, "Cartly app URL")
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
  const timeoutMs = options.timeoutMs ?? 15_000
  const margin = options.refreshMarginMs ?? 60_000
  let inflight: Promise<ConnectedAppTokens | null> | null = null

  /** POST /api/v1/oauth/{token,revoke}: RFC 6749 shapes, not Cartly's envelope. */
  async function oauth<T>(path: "token" | "revoke", body: Record<string, string>): Promise<T> {
    const timeout = AbortSignal.timeout(timeoutMs)
    let response: Response
    try {
      response = await fetchImpl(new URL(`/api/v1/oauth/${path}`, api.origin).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          ...body,
          client_id: options.clientId,
          ...(options.clientSecret ? { client_secret: options.clientSecret } : {}),
        }),
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: timeout,
      })
    } catch (cause) {
      throw new CartlyApiError({
        code: timeout.aborted ? ErrorCode.TIMEOUT : ErrorCode.NETWORK_ERROR,
        message: timeout.aborted ? "The server took too long to respond." : "Could not reach the server.",
        cause,
      })
    }
    const json = (await response.json().catch(() => null)) as
      | (T & { error?: undefined })
      | { error: string; error_description?: string }
      | null
    if (!response.ok || !json || json.error) {
      const error = (json as { error?: string; error_description?: string } | null) ?? {}
      throw new CartlyApiError({
        // The OAuth error itself (invalid_grant, invalid_client, …).
        code: error.error ?? ErrorCode.INVALID_RESPONSE,
        message: error.error_description ?? "The authorisation failed.",
        status: response.status,
      })
    }
    return json as T
  }

  function toTokens(response: TokenResponse): ConnectedAppTokens {
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      expiresAt: Date.now() + response.expires_in * 1000,
      scopes: response.scope.split(" ").filter(Boolean),
      businessId: response.business_id,
    }
  }

  async function refresh(): Promise<ConnectedAppTokens | null> {
    inflight ??= (async () => {
      const current = await options.tokens.get()
      if (!current) return null
      try {
        const next = toTokens(
          await oauth<TokenResponse>("token", {
            grant_type: "refresh_token",
            refresh_token: current.refreshToken,
          })
        )
        await options.tokens.set(next)
        return next
      } catch (error) {
        // Refresh tokens are single-use: a finished one (disconnected app,
        // reused token) is forgotten; a network error keeps it for next time.
        if (error instanceof CartlyApiError && FINISHED.has(error.code)) {
          await options.tokens.clear()
          return null
        }
        throw error
      }
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  async function current(): Promise<ConnectedAppTokens | null> {
    const tokens = await options.tokens.get()
    if (tokens && tokens.expiresAt - Date.now() > margin) return tokens
    return tokens ? refresh() : null
  }

  const graphql = createGraphQLClient({
    endpoint: new URL("/api/graphql", api.origin).toString(),
    fetch: options.fetch,
    timeoutMs,
    init: options.init,
    context: async () => {
      const tokens = await current()
      return { accessToken: tokens?.accessToken ?? null, tenantId: tokens?.businessId ?? null }
    },
    onUnauthenticated: async () => (await refresh()) !== null,
  })

  return {
    /**
     * Where to send the person to approve the app. Keep `state` and the PKCE
     * verifier (`createPkce`) until they come back; scopes are permission
     * keys the person must hold themselves.
     */
    authorizeUrl(input: { scopes: string[]; state: string; codeChallenge: string }): string {
      if (input.state.length < 16)
        throw new Error("Use an unguessable state of at least 16 characters.")
      const url = new URL("/oauth/authorize", app.origin)
      url.searchParams.set("response_type", "code")
      url.searchParams.set("client_id", options.clientId)
      url.searchParams.set("redirect_uri", options.redirectUri)
      url.searchParams.set("scope", input.scopes.join(" "))
      url.searchParams.set("state", input.state)
      url.searchParams.set("code_challenge", input.codeChallenge)
      url.searchParams.set("code_challenge_method", "S256")
      return url.toString()
    },

    /**
     * On the return address: checks `state`, trades the one-time code with
     * the verifier and keeps the tokens. A declined approval comes back with
     * `error` instead of `code`.
     */
    async completeAuthorization(input: {
      /** The query of the return URL (`?code=…&state=…` or `?error=…`). */
      params: URLSearchParams
      expectedState: string
      codeVerifier: string
    }): Promise<ConnectedAppTokens> {
      const state = input.params.get("state")
      if (!state || state !== input.expectedState)
        throw new CartlyApiError({ code: "invalid_state", message: "This sign-in didn’t start here. Start again." })
      const error = input.params.get("error")
      if (error)
        throw new CartlyApiError({ code: error, message: input.params.get("error_description") ?? "The app was not approved." })
      const code = input.params.get("code")
      if (!code) throw new CartlyApiError({ code: "invalid_request", message: "No code came back." })
      const tokens = toTokens(
        await oauth<TokenResponse>("token", {
          grant_type: "authorization_code",
          code,
          redirect_uri: options.redirectUri,
          code_verifier: input.codeVerifier,
        })
      )
      await options.tokens.set(tokens)
      return tokens
    },

    /** A valid access token (refreshing first if needed); null when not connected. */
    async getAccessToken(): Promise<string | null> {
      return (await current())?.accessToken ?? null
    },

    /** GraphQL as the app, for the business it was approved for (X-Tenant-Id set). */
    graphql,

    /** Revokes the app's tokens (the whole refresh-token family) and forgets them. */
    async disconnect(): Promise<void> {
      const tokens = await options.tokens.get()
      try {
        if (tokens) await oauth("revoke", { token: tokens.refreshToken, token_type_hint: "refresh_token" })
      } finally {
        await options.tokens.clear()
      }
    },
  }
}

export type CartlyConnectedApp = ReturnType<typeof createCartlyConnectedApp>
