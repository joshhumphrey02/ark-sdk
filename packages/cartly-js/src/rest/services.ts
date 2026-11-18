import { contextHeaders, createIdempotencyKey, Header, normalizeHostname } from "../context"
import { CartlyApiError, ErrorCode } from "../errors"
import type { RestTransport } from "./http"
import { uploadMedia, type UploadMediaOptions, type UploadMediaResult } from "./media"
import { readSse, type SseEvent } from "./sse"

/**
 * The REST endpoints merchants' and shoppers' apps use besides sign-in
 * (`auth`): everything else is GraphQL. Each signed-in call takes the access
 * token from the session; business calls name the business, which the API
 * checks against the caller's membership like every `X-Tenant-Id`.
 */
export interface RestServicesOptions {
  rest: RestTransport
  /** API origin, e.g. `https://api.cartly.store`. */
  apiOrigin: string
  fetch?: typeof fetch
  /** The signed-in person's access token (null when signed out). */
  accessToken: () => Promise<string | null>
}

export type ShopperOAuthProvider = "google" | "apple"

export interface PaymentVerification {
  reference: string
  /** What the provider confirmed, never what the client claims. */
  status: string
}

export interface DeviceRegistration {
  /** A stable id for this install, 8–128 characters. */
  deviceId: string
  platform: "IOS" | "ANDROID"
  model?: string
  osVersion?: string
  appVersion?: string
}

export interface AuditLogQuery {
  limit?: number
  cursor?: string
  resourceType?: string
  resourceId?: string
  actorId?: string
  /** Matches actions starting with this, e.g. `order.` */
  action?: string
  /** ISO timestamps. */
  from?: string
  to?: string
}

export interface AuditLogEntry {
  id: string
  tenantId: string | null
  actorType: string
  actorId: string | null
  action: string
  resourceType: string
  resourceId: string | null
  requestId: string | null
  ipAddress: string | null
  changes: unknown
  occurredAt: string
}

export interface AuditLogPage {
  items: AuditLogEntry[]
  pageInfo: { nextCursor: string | null; hasMore: boolean; limit: number }
}

export interface EloraStreamActivity {
  tool: string
  outcome: string
  detail?: string | null
  proposalId?: string | null
}

export type EloraStreamEvent =
  | { event: "conversation"; data: { conversationId: string } }
  | { event: "text"; data: { delta: string } }
  | { event: "activity"; data: { activity: EloraStreamActivity } }
  | { event: "proposal"; data: { proposal: { id: string } & Record<string, unknown> } }
  | { event: "done"; data: { conversationId: string } & Record<string, unknown> }
  | { event: "error"; data: { code: string; message: string } }

export interface EloraTurnInput {
  conversationId?: string | null
  message: string
  /** Media asset ids. */
  attachments?: string[]
  /** The dashboard section the person is on (business turns). */
  page?: string | null
}

export function createRestServices(options: RestServicesOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)

  async function signedIn(): Promise<string> {
    const token = await options.accessToken()
    if (!token)
      throw new CartlyApiError({ code: ErrorCode.UNAUTHENTICATED, message: "Sign in first." })
    return token
  }

  /** The validated X-Tenant-Id header for a business call. */
  function business(tenantId: string): Record<string, string> {
    const value = contextHeaders({ tenantId }).get(Header.tenantId)
    if (!value)
      throw new CartlyApiError({
        code: ErrorCode.INVALID_REQUEST_CONTEXT,
        message: "Name the business (tenantId).",
      })
    return { [Header.tenantId]: value }
  }

  return {
    payments: {
      /**
       * After a payment provider sends the buyer back (`/checkout/return`):
       * Cartly asks the provider and answers what it confirmed. Never trust a
       * status in the return URL; show this one.
       */
      verify(reference: string): Promise<PaymentVerification> {
        if (!/^C[BO]-[A-Za-z0-9]{8,32}$/.test(reference))
          throw new CartlyApiError({
            code: ErrorCode.BAD_REQUEST,
            message: "That is not a Cartly payment reference.",
          })
        return options.rest({
          method: "POST",
          path: `/payments/${encodeURIComponent(reference)}/verify`,
        })
      },
    },

    devices: {
      /**
       * A mobile app says it has been opened (before any sign-in). Push
       * tokens attach to a person later with the `linkAppDevice` mutation.
       */
      async register(device: DeviceRegistration): Promise<void> {
        await options.rest({ method: "POST", path: "/devices/register", body: device })
      },
    },

    media: {
      /** Uploads a file into a business's media library (`media.manage`). */
      async upload(
        tenantId: string,
        input: Omit<UploadMediaOptions, "rest" | "accessToken" | "tenantId">
      ): Promise<UploadMediaResult> {
        business(tenantId)
        return uploadMedia({ ...input, rest: options.rest, accessToken: await signedIn(), tenantId })
      },
      /** Points every use of an asset at a ready replacement. */
      async replace(tenantId: string, assetId: string, replacementAssetId: string): Promise<unknown> {
        return options.rest({
          method: "POST",
          path: `/media/${encodeURIComponent(assetId)}/replace`,
          body: { replacementAssetId },
          accessToken: await signedIn(),
          headers: business(tenantId),
        })
      },
      async delete(tenantId: string, assetId: string): Promise<void> {
        await options.rest({
          method: "DELETE",
          path: `/media/${encodeURIComponent(assetId)}`,
          accessToken: await signedIn(),
          headers: business(tenantId),
        })
      },
    },

    notifications: {
      /**
       * A single-use ticket (60 s) for the notification stream, which an
       * EventSource opens without headers: `new EventSource(streamUrl(ticket))`.
       */
      async createStreamTicket(): Promise<{ ticket: string; expiresIn: number }> {
        return options.rest({
          method: "POST",
          path: "/notifications/stream-tickets",
          accessToken: await signedIn(),
        })
      },
      streamUrl(ticket: string): string {
        const url = new URL("/api/v1/notifications/stream", options.apiOrigin)
        url.searchParams.set("ticket", ticket)
        return url.toString()
      },
    },

    /** A business's activity history (`tenant.audit.read`), newest first. */
    async auditLogs(tenantId: string, query: AuditLogQuery = {}): Promise<AuditLogPage> {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query))
        if (value !== undefined && value !== null) params.set(key, String(value))
      const search = params.toString()
      return options.rest({
        method: "GET",
        path: `/audit-logs${search ? `?${search}` : ""}`,
        accessToken: await signedIn(),
        headers: business(tenantId),
      })
    },

    elora: {
      /**
       * Streams one turn of Elora: for a business (`tenantId`), or event
       * discovery for any signed-in account (`scope: "events"`). Events
       * arrive in order: `conversation`, then `text`, `activity` and
       * `proposal` as they happen, and `done` or `error` last.
       */
      async streamTurn(input: {
        scope: "business" | "events"
        tenantId?: string
        body: EloraTurnInput
        onEvent: (event: EloraStreamEvent) => void
        signal?: AbortSignal
      }): Promise<void> {
        const headers = new Headers({
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          [Header.authorization]: `Bearer ${await signedIn()}`,
        })
        if (input.scope === "business") {
          if (!input.tenantId)
            throw new CartlyApiError({
              code: ErrorCode.INVALID_REQUEST_CONTEXT,
              message: "Name the business (tenantId).",
            })
          for (const [name, value] of Object.entries(business(input.tenantId))) headers.set(name, value)
        }
        const path = input.scope === "events" ? "/api/v1/elora/events/turns" : "/api/v1/elora/turns"
        const response = await fetchImpl(new URL(path, options.apiOrigin).toString(), {
          method: "POST",
          headers,
          body: JSON.stringify(input.body),
          credentials: "omit",
          ...(input.signal ? { signal: input.signal } : {}),
        })
        await readSse(response, (event: SseEvent) => {
          input.onEvent(event as EloraStreamEvent)
          if (event.event === "error") {
            const data = event.data as { code?: string; message?: string }
            throw new CartlyApiError({
              code: data.code ?? ErrorCode.INTERNAL_ERROR,
              message: data.message ?? "Elora ran into a problem.",
            })
          }
        })
      },
    },

    storefront: {
      /**
       * Where a store sends a shopper to sign in with Google or Apple. The
       * API returns to `returnUrl` (an https page on one of the store's own
       * domains) with `?code=` for the store's server to trade with the
       * `customerProviderSignIn` mutation, once, within two minutes.
       */
      oauthStartUrl(input: {
        provider: ShopperOAuthProvider
        storefrontHost: string
        returnUrl: string
        /** A path on the store to land on afterwards. */
        next?: string
      }): string {
        const host = normalizeHostname(input.storefrontHost)
        if (!host)
          throw new CartlyApiError({
            code: ErrorCode.INVALID_REQUEST_CONTEXT,
            message: "Invalid storefrontHost.",
          })
        const url = new URL(`/api/v1/storefront/oauth/${input.provider}/start`, options.apiOrigin)
        url.searchParams.set("host", host)
        url.searchParams.set("return", input.returnUrl)
        if (input.next) url.searchParams.set("next", input.next)
        return url.toString()
      },
    },

    /** A key for one attempt at a financial or checkout mutation (send it on every retry of that attempt). */
    idempotencyKey: createIdempotencyKey,
  }
}

export type RestServices = ReturnType<typeof createRestServices>
