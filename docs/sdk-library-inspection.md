# Library Inspection (Task §3, §71)

Recorded before any code was changed, so the restructure reuses what works
instead of rewriting it.

## Licensing (§71) — reviewed first, because it gates everything else

| Library | License | Obligations |
|---|---|---|
| `s3mini` | MIT, © 2026 thinking.tools | Preserve copyright + permission notice in all copies/substantial portions. |
| `s3-lite-client` | MIT (no copyright line) + Apache-2.0 attribution | Preserve MIT text **and** the notice that portions derive from MinIO's `minio-js`, © 2015–2021 MinIO, Inc. |

Both permit modification, rebranding and redistribution. Neither is copyleft.
Both `LICENSE` files are carried into the new packages verbatim as
`LICENSE.upstream`, referenced from each package's own `LICENSE`, and credited
in each `README`. The MinIO Apache-2.0 notice travels with the client package
because that is where the derived code lives.

## `s3mini` — the backend library

- **Auth:** AWS SigV4. `_getSignatureKey` derives the `AWS4` HMAC chain
  (date → region → service → `aws4_request`) and caches it per day.
- **Requests:** hand-built `fetch` calls, no AWS SDK. Uses `UNSIGNED_PAYLOAD`.
- **Signing:** `byCodePoint` ordering for canonical headers/query — deliberately
  not `localeCompare`, which would corrupt signatures. Uses WebCrypto
  (`crypto.subtle`) for SHA-256/HMAC, so it is runtime-portable.
- **Upload/download:** `putObject`/`getObject`, plus multipart
  (`createMultipartUpload`/`uploadPart`/`complete`/`abort`).
- **Presigning:** `_presign` builds a query-signed URL; delegates to Bun's
  native `S3Client` when available.
- **Errors:** `S3Error`, `S3ServiceError`, `S3NetworkError`. Already redacts
  sensitive keys via `SENSITIVE_KEYS_REDACTED` when logging.
- **Public API:** `S3mini` class, ~2.5k lines in one file.

**Reused for Ark:** the SigV4 primitives are the valuable part. Ark's S3
gateway must *verify* signatures rather than produce them, so the canonical
request construction and the `byCodePoint` ordering rule were adapted into
`@nerdstackgrp/ark-server`'s `sigv4.ts` and the gateway verifier. The 2.5k-line client class
is not reused — Ark's backend SDK talks to Ark, not to arbitrary S3 providers.

## `s3-lite-client` — the frontend library

- **Auth:** SigV4 with a raw access key/secret held in the client.
- **Requests:** `makeRequest` wrapper over `fetch`.
- **Multipart:** `object-uploader.ts` + `transform-chunk-sizes.ts` re-chunks a
  stream into uniform part sizes.
- **Errors:** rich `S3Error` hierarchy parsed from the provider's XML.
- **XML:** small dependency-free parser (`xml-parser.ts`, 137 lines).
- **Public API:** `S3Client` from `mod.ts`.

**Reused for Ark:** the chunking strategy and the error-hierarchy shape
informed `@nerdstackgrp/ark-client`. The signing code is deliberately **dropped** from the
browser package — §15 forbids provider credentials in a browser, and Ark's
client authenticates with a short-lived Ark token instead. The XML parser moved
server-side, where the gateway needs it to render S3 error documents.

## Existing Ark surface (what the new API builds on, not replaces)

- `App` is the tenant; `User` is the billing account. Tokens are today a
  plaintext `sk_` column on `App`, looked up directly (`middleware/auth.ts`).
- `v2UploadSession.initiateV2Upload` already presigns and already routes
  Free→R2 / Paid→Bunny via `desiredProviderForApp`. It leaked `provider` in its
  response, which §12/§60 forbid; the V2 API normalizes that away.
- `StorageProvider` (`storage/contracts.ts`) already exposes every operation
  §60 needs, including multipart and presigned GET/PUT.
- Quota is enforced in `assertPlanAllowsUpload`, but only against *committed*
  usage — so N concurrent presigns could each pass. §39 reservations were the
  real gap and are new work.
- `recordAuditEntry`, `consumeRateLimit`, and the Prometheus registry all exist
  and are reused rather than reinvented.

## Decisions made during implementation

**Transfer strategy (§26).** GET is answered with a 307 redirect to a
short-lived provider URL, so Ark does not pay egress on every read; PUT is
proxied, because a redirected PUT would require the client to re-send the body
and no S3 client does that. Both keep provider credentials server-side.

**Buckets are logical (§28).** No physical R2/Bunny bucket is created per
customer. A bucket resolves to `app + bucket + key`, and the physical key is
derived from ids that never change — so an R2↔Bunny migration rewrites nothing
the customer can see.

**Ark tokens reuse the existing authorization path.** Rather than duplicating
every route, `middleware/auth.ts` resolves an `ark_live_…` token into the same
`App` principal the legacy `sk_` token produces. Existing routes therefore
accept Ark tokens with no change, and the developer API adds scope enforcement
on top.

**S3 gateway is mounted via `onRequest`, not as a route.** Elysia's router gives
the SPA catch-all (`GET *`) priority over a wildcard route, so a route-based
mount was never reached — verified by reproducing it in isolation. Intercepting
before routing also keeps SigV4/XML traffic out of the JSON API's CORS policy
and rate limiter.

**Secret storage differs by credential type (§33).** REST tokens are stored as
SHA-256 hashes and are unrecoverable. S3 secrets cannot be, because SigV4
verification must recompute an HMAC chain from the raw secret; they are
encrypted with AES-256-GCM under `ARK_S3_SECRET_ENCRYPTION_KEY`, held outside
the database.

## Verified against a live server

Not merely typechecked. A scratch Postgres plus the real server were used to
confirm, with the **official AWS SDK** as the client:

- `ListBuckets`, `ListObjectsV2`, `CreateBucket`, `HeadObject` all succeed.
- A forged secret is refused (`SignatureDoesNotMatch`); an unknown key is
  refused (`InvalidAccessKeyId`); an anonymous request gets 403 XML.
- Tenant B cannot see or list tenant A's bucket even knowing its name.
- Revoked and expired credentials stop working immediately.
- Two concurrent reservations for 60% of quota each: exactly one is granted,
  which is the §39 race closing.
