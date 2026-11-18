import { CartlyApiError, ErrorCode, hasErrorCode } from "../errors"
import type { RestRequest, RestTransport } from "./http"

/**
 * What an app keeps after signing in: the short-lived access token, in
 * memory only. In a browser the refresh token lives in the API's HttpOnly
 * `cartly_rt` cookie (SameSite=Strict, scoped to /api/v1/auth) and is never
 * readable here; in token mode it goes to the app's `RefreshTokenStore`.
 */
export interface AuthSession {
  accessToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  sessionId: string
}

export type LoginResult =
  | { mfaRequired: true; challengeToken: string }
  | { mfaRequired: false; session: AuthSession }

export interface LoginInput {
  email: string
  password: string
  deviceLabel?: string
  /**
   * Stay signed in (the default). False: a session of a few hours whose
   * refresh cookie ends with the browser, for a shared computer.
   */
  rememberMe?: boolean
}

/** What a new account keeps when the email is new; ignored for an existing one. */
export interface SignupFields {
  /** e.g. "+234 803 000 0000". */
  phone?: string
  /** The terms and privacy version the person accepted, stored with the time. */
  acceptedTermsVersion?: string
}

export type ContinueInput = LoginInput & SignupFields

export type MfaInput =
  | { challengeToken: string; code: string; recoveryCode?: never }
  | { challengeToken: string; recoveryCode: string; code?: never }

export interface RegisterInput extends SignupFields {
  email: string
  password: string
  displayName?: string
}

/** The one sign-in form's outcome: signed in (maybe at the second step), or a new account to verify. */
export type ContinueResult =
  | { status: "verification_email_sent" }
  | ({ status: "signed_in" } & LoginResult)

export type OAuthProvider = "google" | "apple"

interface IssuedTokens {
  accessToken: string
  accessTokenExpiresIn: number
  refreshToken?: string
  refreshTokenExpiresAt?: string
  sessionId: string
}

/**
 * Where an app without the browser's HttpOnly cookie keeps its refresh token:
 * a phone's secure storage (expo-secure-store, the Keychain or Keystore), or
 * a website's own server-side session. Never localStorage, a cookie page
 * scripts can read, or anything sent to the browser.
 */
export interface RefreshTokenStore {
  get(): string | null | Promise<string | null>
  set(token: string): void | Promise<void>
  clear(): void | Promise<void>
}

export interface AuthApiOptions {
  /**
   * Token mode, for mobile apps and for a website's server signing people in
   * on its own domain: the API returns the refresh token in the body and it
   * goes here. Omit it in a browser on Cartly's own origins, where the
   * HttpOnly cookie holds it.
   */
  refreshTokens?: RefreshTokenStore
  /**
   * A stable id for this install, sent as X-Device-Id when signing in, so
   * only a new device triggers the "new sign-in" email.
   */
  deviceId?: () => string | null | Promise<string | null>
}

/** What `/auth/refresh` answers when the refresh token is really finished. */
const SESSION_OVER = [
  ErrorCode.UNAUTHENTICATED,
  ErrorCode.INVALID_TOKEN,
  ErrorCode.ACCOUNT_DISABLED,
] as const

function toSession(tokens: IssuedTokens): AuthSession {
  // The refresh token never leaves this module in the session: in a browser
  // it stays in the HttpOnly cookie, in token mode it goes to the store.
  return {
    accessToken: tokens.accessToken,
    expiresAt: Date.now() + tokens.accessTokenExpiresIn * 1000,
    sessionId: tokens.sessionId,
  }
}

/**
 * The REST auth flows (login, MFA, refresh, logout, registration and email
 * links). These stay REST by design; everything else is GraphQL.
 */
export function createAuthApi(rest: RestTransport, options: AuthApiOptions = {}) {
  const store = options.refreshTokens

  /** Requests that issue or use a session: cookie mode, or token mode's header. */
  async function sessionRequest(
    request: Omit<RestRequest, "credentials">
  ): Promise<RestRequest> {
    if (!store) return { ...request, credentials: "include" }
    const headers: Record<string, string> = {
      ...request.headers,
      // Asks the API for the refresh token in the body instead of a cookie.
      "X-Client-Type": "mobile",
    }
    const device = await options.deviceId?.()
    if (device && /^[\x21-\x7e]{8,128}$/.test(device))
      headers["X-Device-Id"] = device
    return { ...request, headers, credentials: "omit" }
  }

  /** Keeps a newly issued refresh token (token mode) and returns the session. */
  async function adopt(tokens: IssuedTokens): Promise<AuthSession> {
    if (store) {
      if (!tokens.refreshToken)
        throw new CartlyApiError({
          code: ErrorCode.INVALID_RESPONSE,
          message: "The server did not return a refresh token.",
        })
      await store.set(tokens.refreshToken)
    }
    return toSession(tokens)
  }

  async function forget() {
    await store?.clear()
  }

  return {
    /** True when the refresh token is kept by the app (token mode), not a cookie. */
    tokenMode: Boolean(store),

    async login(input: LoginInput): Promise<LoginResult> {
      const result = await rest<
        | { mfaRequired: true; challengeToken: string }
        | ({ mfaRequired: false } & IssuedTokens)
      >(
        await sessionRequest({ method: "POST", path: "/auth/login", body: input })
      )
      return result.mfaRequired
        ? { mfaRequired: true, challengeToken: result.challengeToken }
        : { mfaRequired: false, session: await adopt(result) }
    },

    /**
     * Email and password for everyone: signs in, or creates the account and
     * sends the verification email when the address is new.
     */
    async continueWithEmail(input: ContinueInput): Promise<ContinueResult> {
      const result = await rest<
        | { status: "verification_email_sent" }
        | { status: "signed_in"; mfaRequired: true; challengeToken: string }
        | ({ status: "signed_in"; mfaRequired: false } & IssuedTokens)
      >(
        await sessionRequest({
          method: "POST",
          path: "/auth/continue",
          body: input,
        })
      )
      if (result.status === "verification_email_sent") return result
      return result.mfaRequired
        ? {
            status: "signed_in",
            mfaRequired: true,
            challengeToken: result.challengeToken,
          }
        : {
            status: "signed_in",
            mfaRequired: false,
            session: await adopt(result),
          }
    },

    /** Which of Google and Apple are set up on this API. */
    async oauthProviders(): Promise<Record<OAuthProvider, boolean>> {
      return rest({ method: "GET", path: "/auth/oauth/providers" })
    },

    async verifyMfa(input: MfaInput): Promise<AuthSession> {
      const tokens = await rest<IssuedTokens>(
        await sessionRequest({
          method: "POST",
          path: "/auth/mfa/verify",
          body: input,
        })
      )
      return adopt(tokens)
    },

    /**
     * Token mode, after Google or Apple sent the app back with `?code=`:
     * trades the one-time code (two minutes, one use) with the PKCE verifier
     * that only this app holds. See `oauthStartUrl` and `createPkce`.
     */
    async exchangeOAuthCode(input: {
      code: string
      codeVerifier: string
    }): Promise<LoginResult> {
      if (!store)
        throw new Error(
          "exchangeOAuthCode needs token mode (a refreshTokens store)."
        )
      const result = await rest<
        | { mfaRequired: true; challengeToken: string }
        | ({ mfaRequired: false } & IssuedTokens)
      >(
        await sessionRequest({
          method: "POST",
          path: "/auth/oauth/exchange",
          body: input,
        })
      )
      return result.mfaRequired
        ? { mfaRequired: true, challengeToken: result.challengeToken }
        : { mfaRequired: false, session: await adopt(result) }
    },

    /**
     * Rotates the refresh token (the cookie, or the stored one in token mode).
     * Single-use: never call it concurrently (the session manager doesn't).
     */
    async refresh(): Promise<AuthSession> {
      if (!store) {
        const tokens = await rest<IssuedTokens>({
          method: "POST",
          path: "/auth/refresh",
          body: {},
          credentials: "include",
        })
        return toSession(tokens)
      }
      const refreshToken = await store.get()
      if (!refreshToken)
        throw new CartlyApiError({
          code: ErrorCode.UNAUTHENTICATED,
          message: "Not signed in.",
        })
      try {
        return await adopt(
          await rest<IssuedTokens>(
            await sessionRequest({
              method: "POST",
              path: "/auth/refresh",
              body: { refreshToken },
            })
          )
        )
      } catch (error) {
        // Only a finished session is forgotten. A dropped connection, a rate
        // limit or a server error keeps the token for the next try.
        if (SESSION_OVER.some((code) => hasErrorCode(error, code)))
          await forget()
        throw error
      }
    },

    /** Ends this session. In token mode the stored token is forgotten even if the call fails. */
    async logout(accessToken: string): Promise<void> {
      try {
        await rest({
          method: "POST",
          path: "/auth/logout",
          accessToken,
          credentials: store ? "omit" : "include",
        })
      } finally {
        await forget()
      }
    },

    async logoutAll(accessToken: string): Promise<{ revoked: number }> {
      try {
        return await rest({
          method: "POST",
          path: "/auth/logout-all",
          accessToken,
          credentials: store ? "omit" : "include",
        })
      } finally {
        await forget()
      }
    },

    async register(input: RegisterInput): Promise<void> {
      await rest({ method: "POST", path: "/auth/register", body: input })
    },

    async verifyEmail(token: string): Promise<void> {
      await rest({
        method: "POST",
        path: "/auth/verify-email",
        body: { token },
      })
    },

    /** Opened from the link sent to a new sign-in address (`requestEmailChange`). */
    async confirmEmailChange(token: string): Promise<void> {
      await rest({
        method: "POST",
        path: "/auth/confirm-email-change",
        body: { token },
      })
    },

    /** Opened from the link sent to a secondary address (`setSecondaryEmail`). */
    async confirmSecondaryEmail(token: string): Promise<void> {
      await rest({
        method: "POST",
        path: "/auth/confirm-secondary-email",
        body: { token },
      })
    },

    async resendVerification(email: string): Promise<void> {
      await rest({
        method: "POST",
        path: "/auth/resend-verification",
        body: { email },
      })
    },

    async forgotPassword(email: string): Promise<void> {
      await rest({
        method: "POST",
        path: "/auth/forgot-password",
        body: { email },
      })
    },

    async resetPassword(token: string, password: string): Promise<void> {
      await rest({
        method: "POST",
        path: "/auth/reset-password",
        body: { token, password },
      })
    },
  }
}

export type AuthApi = ReturnType<typeof createAuthApi>

/**
 * Where an app opens Google or Apple sign-in for a Cartly account. The
 * provider sends the person back to `redirectUri` with `?code=` (or
 * `?error=`), never tokens; trade the code with `exchangeOAuthCode`.
 * `redirectUri` must be one the API allows: `cartly://auth`, or one listed
 * in its OAUTH_APP_REDIRECT_URIS (e.g. `acessyn://auth`).
 */
export function oauthStartUrl(
  apiOrigin: string,
  provider: OAuthProvider,
  options: { redirectUri: string; codeChallenge: string }
): string {
  const url = new URL(`/api/v1/auth/oauth/${provider}/start`, apiOrigin)
  url.searchParams.set("redirectUri", options.redirectUri)
  url.searchParams.set("codeChallenge", options.codeChallenge)
  return url.toString()
}
