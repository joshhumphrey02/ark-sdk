import { CartlyApiError, ErrorCode } from "./errors"

/** Header names the Cartly API reads. */
export const Header = {
  authorization: "Authorization",
  tenantId: "X-Tenant-Id",
  accountId: "X-Account-Id",
  storefrontHost: "X-Storefront-Host",
  cartToken: "X-Cart-Token",
  conversationToken: "X-Conversation-Token",
  customerToken: "X-Customer-Token",
  idempotencyKey: "Idempotency-Key",
  requestId: "X-Request-Id",
  storefrontKey: "X-Storefront-Key",
  shopperIp: "X-Shopper-Ip",
} as const

/**
 * Who is calling and on whose behalf. Each field maps to one header; the
 * server verifies every one of them (membership for the tenant, ACTIVE domain
 * for the host, ownership for capability tokens), so these are claims, not
 * authority. Leave a field unset rather than sending an empty value.
 */
export interface RequestContext {
  /** Bearer access token (in memory only; never persist it). */
  accessToken?: string | null
  /** Business id for back-office operations. */
  tenantId?: string | null
  /** Client account id for billing and account operations (subscription, invoices, createBusiness under an account). */
  accountId?: string | null
  /** Shopper-facing hostname for public storefront operations. */
  storefrontHost?: string | null
  /** Secret capability token returned by `createCart`. */
  cartToken?: string | null
  /** Secret capability token returned by `contactBusiness`. */
  conversationToken?: string | null
  /** Secret shopper session token returned by `customerLogin` (storefront servers only). */
  customerToken?: string | null
  /** One per checkout attempt, reused on retries of that attempt. */
  idempotencyKey?: string | null
  /** Correlates this call with server logs. */
  requestId?: string | null
  /**
   * A self-built storefront's key (server only, from its environment): Cartly
   * then counts its traffic per shopper instead of per server address.
   */
  storefrontKey?: string | null
  /** The shopper's address as the store's server saw it; read only with a storefrontKey. */
  shopperIp?: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
// Same rule as the server: 8-255 of A-Za-z0-9._:-
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,255}$/
// Opaque tokens: visible ASCII, no whitespace or separators that could
// smuggle a second header value.
const OPAQUE_TOKEN = /^[\x21-\x7e]{16,4096}$/
const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/
const STOREFRONT_KEY = /^csk_[A-Za-z0-9_-]{40,64}$/
// An IPv4 or IPv6 address, nothing else (the API checks it again).
const IP = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]{2,39}(?:\.\d{1,3}){0,3})$/

function invalid(field: keyof RequestContext): never {
  // Never echo the value: it may be a secret.
  throw new CartlyApiError({
    code: ErrorCode.INVALID_REQUEST_CONTEXT,
    message: `Invalid ${field} in request context.`,
  })
}

function check(
  field: keyof RequestContext,
  value: string | null | undefined,
  pattern: RegExp
): string | undefined {
  if (value == null || value === "") return undefined
  if (!pattern.test(value)) invalid(field)
  return value
}

/**
 * Lower-cases a hostname and strips a port and trailing dot. Returns null for
 * anything that is not a plain DNS name (IP literals, userinfo, paths).
 */
export function normalizeHostname(raw: string | null | undefined) {
  if (!raw) return null
  let host = raw.trim().toLowerCase()
  if (host.startsWith("[")) return null // IPv6 literal
  const colon = host.lastIndexOf(":")
  if (colon !== -1) {
    if (!/^\d{1,5}$/.test(host.slice(colon + 1))) return null
    host = host.slice(0, colon)
  }
  if (host.endsWith(".")) host = host.slice(0, -1)
  return HOSTNAME.test(host) ? host : null
}

/**
 * Turns a context into request headers, validating each value first so a
 * malformed or misplaced value fails here, loudly, instead of on the wire.
 */
export function contextHeaders(context: RequestContext): Headers {
  const headers = new Headers()
  const token = check("accessToken", context.accessToken, OPAQUE_TOKEN)
  if (token) headers.set(Header.authorization, `Bearer ${token}`)

  const tenantId = check("tenantId", context.tenantId, UUID)
  if (tenantId) headers.set(Header.tenantId, tenantId)

  const accountId = check("accountId", context.accountId, UUID)
  if (accountId) headers.set(Header.accountId, accountId)

  if (context.storefrontHost) {
    const host = normalizeHostname(context.storefrontHost)
    if (!host) invalid("storefrontHost")
    headers.set(Header.storefrontHost, host)
  }

  const cart = check("cartToken", context.cartToken, OPAQUE_TOKEN)
  if (cart) headers.set(Header.cartToken, cart)

  const conversation = check(
    "conversationToken",
    context.conversationToken,
    OPAQUE_TOKEN
  )
  if (conversation) headers.set(Header.conversationToken, conversation)

  const customer = check("customerToken", context.customerToken, OPAQUE_TOKEN)
  if (customer) headers.set(Header.customerToken, customer)

  const key = check("idempotencyKey", context.idempotencyKey, IDEMPOTENCY_KEY)
  if (key) headers.set(Header.idempotencyKey, key)

  const requestId = check("requestId", context.requestId, REQUEST_ID)
  if (requestId) headers.set(Header.requestId, requestId)

  const storefrontKey = check(
    "storefrontKey",
    context.storefrontKey,
    STOREFRONT_KEY
  )
  if (storefrontKey) {
    headers.set(Header.storefrontKey, storefrontKey)
    // A shopper's address means nothing without the key, so it only goes with
    // one. It comes from a request header, so a malformed one is left out
    // rather than failing the shopper's request.
    if (context.shopperIp && IP.test(context.shopperIp))
      headers.set(Header.shopperIp, context.shopperIp)
  }

  return headers
}

/** Merges contexts left to right; `null` clears a field, `undefined` keeps it. */
export function mergeContext(
  ...contexts: (RequestContext | undefined)[]
): RequestContext {
  const merged: RequestContext = {}
  for (const context of contexts) {
    if (!context) continue
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) merged[key as keyof RequestContext] = value
    }
  }
  return merged
}

/**
 * A fresh key for one checkout attempt. Keep it until that attempt settles
 * and send the same key on every retry, so a retry cannot create a second
 * order.
 */
export function createIdempotencyKey(): string {
  return `chk_${crypto.randomUUID()}`
}

/**
 * Refuses to send credentials over plain HTTP except to the local machine.
 * Call it on every configured API URL at startup.
 */
export function assertSecureUrl(url: string, label = "API URL"): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`${label} is not a valid absolute URL.`)
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error(`${label} must use https.`)
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain credentials.`)
  }
  return parsed
}
