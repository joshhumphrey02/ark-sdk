import type { RestTransport } from "./http"

/**
 * What a browser keeps after signing in: the short-lived access token, in
 * memory only. The refresh token lives in the API's HttpOnly `cartly_rt`
 * cookie (SameSite=Strict, scoped to /api/v1/auth) and is never readable here.
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

function toSession(tokens: IssuedTokens): AuthSession {
  // The API also returns the refresh token in the body (for mobile clients).
  // Drop it: in a browser it must stay in the HttpOnly cookie only.
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
export function createAuthApi(rest: RestTransport) {
  return {
    async login(input: LoginInput): Promise<LoginResult> {
      const result = await rest<
        | { mfaRequired: true; challengeToken: string }
        | ({ mfaRequired: false } & IssuedTokens)
      >({
        method: "POST",
        path: "/auth/login",
        body: input,
        credentials: "include",
      })
      return result.mfaRequired
        ? { mfaRequired: true, challengeToken: result.challengeToken }
        : { mfaRequired: false, session: toSession(result) }
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
      >({
        method: "POST",
        path: "/auth/continue",
        body: input,
        credentials: "include",
      })
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
            session: toSession(result),
          }
    },

    /** Which of Google and Apple are set up on this API. */
    async oauthProviders(): Promise<Record<OAuthProvider, boolean>> {
      return rest({ method: "GET", path: "/auth/oauth/providers" })
    },

    async verifyMfa(input: MfaInput): Promise<AuthSession> {
      const tokens = await rest<IssuedTokens>({
        method: "POST",
        path: "/auth/mfa/verify",
        body: input,
        credentials: "include",
      })
      return toSession(tokens)
    },

    /** Rotates the refresh cookie. Single-use: never call it concurrently. */
    async refresh(): Promise<AuthSession> {
      const tokens = await rest<IssuedTokens>({
        method: "POST",
        path: "/auth/refresh",
        body: {},
        credentials: "include",
      })
      return toSession(tokens)
    },

    async logout(accessToken: string): Promise<void> {
      await rest({
        method: "POST",
        path: "/auth/logout",
        accessToken,
        credentials: "include",
      })
    },

    async logoutAll(accessToken: string): Promise<{ revoked: number }> {
      return rest({
        method: "POST",
        path: "/auth/logout-all",
        accessToken,
        credentials: "include",
      })
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
