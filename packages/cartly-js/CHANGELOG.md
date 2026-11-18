# Changelog

## 0.1.1

### Added

- `createCartlyConnectedApp`: Sign in with Cartly for a merchant's own app
  or website. The merchant registers the app and its return addresses in
  the Cartly web app (`/account/developers`); a person approves it for one
  business on Cartly's consent page; the app gets a token for that business
  and the approved permissions (`authorizeUrl`, `completeAuthorization` with
  a state check and PKCE, automatic refresh, `disconnect`), and its
  `graphql` client sends that business's `X-Tenant-Id`.

### Changed

- `createCartlyAppClient` (a person's whole Cartly account) is documented as
  for apps Cartly runs. A merchant's app uses `createCartlyConnectedApp`;
  its shoppers sign in to the store (`customerLogin`).

## 0.1.0

The first public version, from `@repo/api` in the Cartly storefront
repository.

- `createCartlyServerClient` and `createCartlyBrowserClient`, with validated
  request context (`.with()`), REST sign-in and a cross-tab session.
- Typed storefront, cart, checkout, customer-account, booking, real-estate,
  website-builder and SEO operations.
- `CartlyApiError` with stable error codes.
- React provider, scope and query hooks (`/react`).
- Token mode for phone apps and other sites' servers (`createCartlyAppClient`),
  PKCE and Google/Apple sign-in for apps.
- REST flows on `client.api`, media helpers (`/media`), subscriptions
  (`/realtime`), and the API's SDK schema (`/schema.graphql`).
