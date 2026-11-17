import { ErrorCode, hasErrorCode, isAuthError } from "../errors"
import type { AuthApi, AuthSession } from "../rest/auth"

export type SessionStatus = "unknown" | "authenticated" | "anonymous"

export interface SessionSnapshot {
  status: SessionStatus
  sessionId: string | null
  /**
   * Anonymous because someone signed out on purpose (here or in another
   * tab), not because the session ran out: guards go to sign-in plainly
   * instead of saying it expired.
   */
  signedOut: boolean
}

export interface SessionManagerOptions {
  auth: AuthApi
  /** Refresh this long before the access token expires. Default 60 s. */
  refreshMarginMs?: number
  /** Shared by every tab of one app. */
  channelName?: string
}

export interface SessionManager {
  getSnapshot(): SessionSnapshot
  subscribe(listener: () => void): () => void
  /** A valid access token, refreshing first if needed; null when signed out. */
  getAccessToken(): Promise<string | null>
  /** Adopt the session returned by login or MFA verification. */
  setSession(session: AuthSession): void
  /** Force a refresh (e.g. after UNAUTHENTICATED). True if signed in after. */
  refresh(): Promise<boolean>
  /** Revoke the session server-side and forget it in every tab. */
  signOut(options?: { everywhere?: boolean }): Promise<void>
}

type Message =
  { type: "session"; session: AuthSession } | { type: "signed-out" }

const SERVER_SNAPSHOT: SessionSnapshot = {
  status: "unknown",
  sessionId: null,
  signedOut: false,
}

/**
 * Browser session state. The access token is held in this closure only: not
 * in storage, not in a cookie, not in React state.
 *
 * Refresh tokens are single-use and the API revokes the whole session when one
 * is reused, so two tabs must never refresh at the same time. Refreshes are
 * serialised across tabs with the Web Locks API, and the winner shares the
 * new access token over a BroadcastChannel so the others skip their refresh.
 */
export function createSessionManager(
  options: SessionManagerOptions
): SessionManager {
  const margin = options.refreshMarginMs ?? 60_000
  const channelName = options.channelName ?? "cartly-auth"
  const lockName = `${channelName}:refresh`
  const listeners = new Set<() => void>()

  let session: AuthSession | null = null
  let snapshot: SessionSnapshot = SERVER_SNAPSHOT
  let inflight: Promise<AuthSession | null> | null = null

  // Browser only: during SSR there are no other tabs to coordinate with.
  const channel =
    typeof window === "undefined" || typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(channelName)

  channel?.addEventListener("message", (event: MessageEvent<Message>) => {
    const message = event.data
    if (message?.type === "session") adopt(message.session, false)
    else if (message?.type === "signed-out") adopt(null, false, true)
  })

  function adopt(next: AuthSession | null, broadcast: boolean, signedOut = false) {
    session = next
    const status: SessionStatus = next ? "authenticated" : "anonymous"
    const sessionId = next?.sessionId ?? null
    if (
      snapshot.status !== status ||
      snapshot.sessionId !== sessionId ||
      snapshot.signedOut !== signedOut
    ) {
      snapshot = { status, sessionId, signedOut }
      for (const listener of listeners) listener()
    }
    if (broadcast) {
      channel?.postMessage(
        next
          ? ({ type: "session", session: next } satisfies Message)
          : ({ type: "signed-out" } satisfies Message)
      )
    }
  }

  function fresh(candidate: AuthSession | null): candidate is AuthSession {
    return candidate !== null && candidate.expiresAt - Date.now() > margin
  }

  async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks
    return locks ? locks.request(lockName, task) : task()
  }

  function refreshOnce(): Promise<AuthSession | null> {
    if (inflight) return inflight
    const before = session?.accessToken
    inflight = withRefreshLock(async () => {
      // Another tab may have refreshed (and broadcast) while we waited.
      if (fresh(session) && session.accessToken !== before) return session
      try {
        const next = await options.auth.refresh()
        adopt(next, true)
        return next
      } catch (error) {
        // FORBIDDEN: a cookie refresh from an origin outside the API's
        // CORS_ORIGINS. Either way there is no usable session.
        if (!isAuthError(error) && !hasErrorCode(error, ErrorCode.FORBIDDEN))
          throw error
        adopt(null, false)
        return null
      }
    }).finally(() => {
      inflight = null
    })
    return inflight
  }

  async function getAccessToken() {
    if (fresh(session)) return session.accessToken
    // Known signed-out visitors must not hit the rate-limited refresh route.
    if (snapshot.status === "anonymous") return null
    return (await refreshOnce())?.accessToken ?? null
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getAccessToken,
    setSession(next) {
      adopt(next, true)
    },
    async refresh() {
      return (await refreshOnce()) !== null
    },
    async signOut({ everywhere = false } = {}) {
      const token = await getAccessToken().catch(() => null)
      adopt(null, true, true)
      if (!token) return
      // Local state is already cleared. If this throws, the refresh cookie is
      // still valid server-side, so let the caller tell the user to retry
      // (a page reload would otherwise sign them back in).
      if (everywhere) await options.auth.logoutAll(token)
      else await options.auth.logout(token)
    },
  }
}

export function serverSessionSnapshot(): SessionSnapshot {
  return SERVER_SNAPSHOT
}
