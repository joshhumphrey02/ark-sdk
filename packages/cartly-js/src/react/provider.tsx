"use client"

import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { isRetryable } from "../errors"
import type { GraphQLClient } from "../graphql/client"
import type { AuthApi } from "../rest/auth"
import {
  serverSessionSnapshot,
  type SessionManager,
} from "../session/session-manager"

const GraphQLClientContext = React.createContext<GraphQLClient | null>(null)
const SessionContext = React.createContext<SessionManager | null>(null)
const AuthContext = React.createContext<AuthApi | null>(null)

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => failureCount < 2 && isRetryable(error),
      },
      mutations: {
        // Mutations are not assumed idempotent; checkout uses an explicit
        // Idempotency-Key instead of blind retries.
        retry: false,
      },
    },
  })
}

export interface CartlyProviderProps {
  client: GraphQLClient
  /** Omit for apps without sign-in (e.g. a storefront talking to its BFF). */
  session?: SessionManager
  /** REST auth flows (login, MFA, password reset) for sign-in screens. */
  auth?: AuthApi
  queryClient?: QueryClient
  children: React.ReactNode
}

export function CartlyProvider({
  client,
  session,
  auth,
  queryClient,
  children,
}: CartlyProviderProps) {
  const [cache] = React.useState(() => queryClient ?? createQueryClient())

  React.useEffect(() => {
    if (!session) return
    // Restore a session from the refresh cookie on first load. Concurrent
    // calls (Strict Mode, other tabs) share one refresh.
    if (session.getSnapshot().status === "unknown") {
      session.refresh().catch(() => {
        // Network failure: stay "unknown"; the next request retries.
      })
    }
    // Nothing fetched for one user may be shown to the next one.
    return session.subscribe(() => {
      if (session.getSnapshot().status === "anonymous") cache.clear()
    })
  }, [session, cache])

  return (
    <QueryClientProvider client={cache}>
      <AuthContext value={auth ?? null}>
        <SessionContext value={session ?? null}>
          <GraphQLClientContext value={client}>{children}</GraphQLClientContext>
        </SessionContext>
      </AuthContext>
    </QueryClientProvider>
  )
}

export interface CartlyScopeProps {
  /** Business to act for; verified server-side against the membership. */
  tenantId?: string | null
  /** Shopper-facing hostname for storefront operations. */
  storefrontHost?: string | null
  /** Client account for billing and account operations (X-Account-Id). */
  accountId?: string | null
  children: React.ReactNode
}

/**
 * Scopes every query below it to one business, storefront or client
 * account. The scope is part of each cache key, so switching business or
 * account never shows the previous one's data. `undefined` keeps the parent
 * scope's value; `null` clears it (e.g. account billing must not also send
 * a tenant). Only non-secret values belong here: capability tokens (cart,
 * conversation) stay on the server.
 */
export function CartlyScope({
  tenantId,
  storefrontHost,
  accountId,
  children,
}: CartlyScopeProps) {
  const parent = useGraphQLClient()
  const scoped = React.useMemo(
    () => parent.with({ tenantId, storefrontHost, accountId }),
    [parent, tenantId, storefrontHost, accountId]
  )
  return <GraphQLClientContext value={scoped}>{children}</GraphQLClientContext>
}

export function useGraphQLClient(): GraphQLClient {
  const client = React.use(GraphQLClientContext)
  if (!client) throw new Error("useGraphQLClient needs a <CartlyProvider>.")
  return client
}

export function useSessionManager(): SessionManager {
  const session = React.use(SessionContext)
  if (!session)
    throw new Error("This app's <CartlyProvider> has no session manager.")
  return session
}

export function useAuthApi(): AuthApi {
  const auth = React.use(AuthContext)
  if (!auth) throw new Error("This app's <CartlyProvider> has no auth API.")
  return auth
}

/** Re-renders on sign-in, sign-out and session changes in any tab. */
export function useSession() {
  const session = useSessionManager()
  return React.useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    serverSessionSnapshot
  )
}
