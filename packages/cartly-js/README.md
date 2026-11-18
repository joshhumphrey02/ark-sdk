# @nerdstackgrp/cartly

The typed Cartly SDK: a GraphQL client with typed storefront, cart, checkout,
customer-account, booking and SEO operations, REST sign-in, a cross-tab
session, stable error codes, and React hooks.

```bash
npm install @nerdstackgrp/cartly
```

Ships ESM and CommonJS with TypeScript declarations. Requires Node.js >= 20 (or
any runtime with `fetch` and `AbortSignal.any`).

## A store's server

Storefront operations are called from the server: the API's CORS allow-list
does not include merchant domains. Scope each request with `.with()`; every
value is validated before it becomes a header.

```ts
import { createCartlyServerClient, createIdempotencyKey } from "@nerdstackgrp/cartly";
import {
  CheckoutMutation,
  CreateCartMutation,
  SetCartItemMutation,
  StorefrontProductsQuery,
} from "@nerdstackgrp/cartly/operations";

const cartly = createCartlyServerClient({ apiUrl: "https://api.cartly.store" });
const store = cartly.with({ storefrontHost: "shop.example.com" });

const { storefrontProducts } = await store.request(StorefrontProductsQuery, {
  page: { limit: 24 },
});

const { createCart } = await store.request(CreateCartMutation);
const cart = store.with({ cartToken: createCart.cartToken });
await cart.request(SetCartItemMutation, { variantId, quantity: 1 });

// One key per checkout attempt, reused on its retries.
await cart
  .with({ idempotencyKey: createIdempotencyKey() })
  .request(CheckoutMutation, { input });
```

`request()` resolves to `data` and throws the first error; `execute()` resolves
to `{ data, errors }` for screens that can render partial data. In Next.js,
pass cache options per call: `cartly.with({}, { init: { next: { revalidate: 60 } } })`.

## A signed-in browser app

```ts
import { createCartlyBrowserClient } from "@nerdstackgrp/cartly";

const cartly = createCartlyBrowserClient({ apiUrl: "https://api.cartly.store" });

await cartly.auth.login({ email, password });
cartly.session.getSnapshot(); // { status: "authenticated", ... }
```

The GraphQL client attaches a fresh access token to every call and refreshes
once on `UNAUTHENTICATED`. Tokens are kept in memory only; tabs share one
refresh over a `BroadcastChannel`.

## A merchant's own app: Sign in with Cartly

Register the app and its return addresses in the Cartly web app
(`/account/developers`); a phone app is a public client (no secret). A
person approves it for one business, and the app gets a token for that
business and the permissions they grant, never their Cartly account.

```ts
import * as SecureStore from "expo-secure-store";
import { createCartlyConnectedApp, createPkce } from "@nerdstackgrp/cartly";

export const cartly = createCartlyConnectedApp({
  apiUrl: "https://api.cartly.store",
  appUrl: "https://merchant.nerdstackgrp.com", // where Cartly's consent page is
  clientId: "YOUR_CLIENT_ID",
  redirectUri: "com.example.app:/callback", // registered with the app
  tokens: {
    get: async () => JSON.parse((await SecureStore.getItemAsync("cartly")) ?? "null"),
    set: (t) => SecureStore.setItemAsync("cartly", JSON.stringify(t)),
    clear: () => SecureStore.deleteItemAsync("cartly"),
  },
});

const pkce = await createPkce(); // React Native: pass expo-crypto's functions
const url = cartly.authorizeUrl({ scopes: ["orders.read"], state, codeChallenge: pkce.challenge });
// …open url in an auth session; on the return address:
await cartly.completeAuthorization({ params, expectedState: state, codeVerifier: pkce.verifier });
await cartly.graphql.request(OrdersQuery); // as the app, for that business
```

A server app (confidential client) also passes `clientSecret`; never put it
in a phone app or browser code. The business can disconnect the app at any
time (Settings → Connected apps).

## An app Cartly runs (token mode)

For Cartly's own apps (Cartly Business, Acessyn), where people sign in to
their whole Cartly account. Where there is no HttpOnly cookie for the refresh
token, the app keeps it in its own secure storage; the access token stays in
memory.

```ts
import * as SecureStore from "expo-secure-store";
import { createCartlyAppClient, createPkce } from "@nerdstackgrp/cartly";

export const cartly = createCartlyAppClient({
  apiUrl: "https://api.cartly.store",
  refreshTokens: {
    get: () => SecureStore.getItemAsync("cartly.refresh"),
    set: (token) => SecureStore.setItemAsync("cartly.refresh", token),
    clear: () => SecureStore.deleteItemAsync("cartly.refresh"),
  },
});

await cartly.auth.login({ email, password });

// Google or Apple: the return address must be in the API's
// OAUTH_APP_REDIRECT_URIS (one entry per app Cartly runs).
const pkce = await createPkce(); // React Native: pass expo-crypto's functions
const url = cartly.oauthStartUrl("google", { redirectUri: "myapp://auth", codeChallenge: pkce.challenge });
// …open url in an auth session, read ?code= from the return, then:
await cartly.auth.exchangeOAuthCode({ code, codeVerifier: pkce.verifier });
```

On a website's server, `refreshTokens` is the server's own encrypted session
for that visitor. Never keep the token anywhere page scripts can read.

## REST flows and live updates

`cartly.api` covers what isn't GraphQL: `payments.verify(reference)` on the
payment return page, `media.upload(tenantId, { file })`,
`devices.register(...)`, `notifications.createStreamTicket()`,
`auditLogs(tenantId)`, `elora.streamTurn(...)` and
`storefront.oauthStartUrl(...)` for shoppers. Subscriptions run over
WebSocket with `createCartlySubscriptions` from
`@nerdstackgrp/cartly/realtime` (install `graphql-ws`).

## Every operation, typed

The package ships the Cartly API's SDK schema (every merchant, account and
shopper operation): point your own codegen at
`node_modules/@nerdstackgrp/cartly/schema.graphql` and pass the typed
documents to `request()`, `execute()` or the React hooks.

## React

Needs `react` 19 and `@tanstack/react-query` 5.

```tsx
"use client";
import { CartlyProvider, CartlyScope, useGraphQLQuery, useSession } from "@nerdstackgrp/cartly/react";
import { ViewerQuery } from "@nerdstackgrp/cartly/operations";

<CartlyProvider client={cartly.graphql} session={cartly.session} auth={cartly.auth}>
  <CartlyScope tenantId={businessId}>
    <App />
  </CartlyScope>
</CartlyProvider>;

const { data } = useGraphQLQuery(ViewerQuery);
```

The scope (tenant, account, storefront host, never tokens) is part of every
query key, so switching business never shows the previous one's data, and the
cache is cleared on sign-out.

## Errors

Every failure is a `CartlyApiError` with a stable `code` (`ErrorCode`), a
`message`, the server's `requestId`, and `fieldErrors()` for validation
failures. `isRetryable(error)`, `isAuthError(error)` and
`hasErrorCode(error, code)` answer the usual questions.

## Import paths

| Path                                    | What                                                         |
| --------------------------------------- | ------------------------------------------------------------ |
| `@nerdstackgrp/cartly`                  | clients, request context, REST auth, session, errors         |
| `@nerdstackgrp/cartly/operations`       | the typed operations and fragments                           |
| `@nerdstackgrp/cartly/graphql`          | `graphql()`, typed for the operations above                  |
| `@nerdstackgrp/cartly/graphql/types`    | result, variable, input and enum types                       |
| `@nerdstackgrp/cartly/storefront-content` | named storefront content shapes and home-page editor limits |
| `@nerdstackgrp/cartly/react`            | provider, scope, session and query hooks                     |
| `@nerdstackgrp/cartly/media`            | media upload helpers (file checks, ARK upload)               |
| `@nerdstackgrp/cartly/realtime`         | GraphQL subscriptions over WebSocket                         |
| `@nerdstackgrp/cartly/schema.graphql`   | the API's SDK schema, for your own codegen                   |

## Developing this package

The source of truth is `@repo/api` in the Cartly storefront repository. This
package copies it and generates its own types from its own operations only:

```bash
npm run sync        # copy src/ and the schema from ../cartly-stores (or CARTLY_STORES_PATH)
npm run codegen     # regenerate src/gql from this package's operations
npm run sync:check  # fails if src/ has drifted from cartly-stores
```

Make SDK changes in cartly-stores, then sync: a sync overwrites every synced
path. `schema.graphql` is the API's SDK schema (never platform-staff
operations); `codegen/type-anchors.graphql` lists input types the SDK exports
that none of its operations take.

## License

MIT
