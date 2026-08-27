# Media processing, webhooks, teams, and imports

Ark keeps the uploaded object and all legacy locator fields readable. New image
outputs are `AssetVariant` records beside the source on its current provider.
The processing order is source → resize/base processing → watermark → output
format. The worker pre-generates organization defaults; query transformations
use deterministic keys and are cached with a per-asset variant ceiling.

## Image URL API

```http
GET /api/v2/assets/:assetId/image?width=600&format=webp&quality=80&watermark=1
```

Supported parameters are `width`, `height`, `quality`, `format`, `thumbnail`,
and `watermark`. Formats are JPEG, PNG, WebP, and AVIF. Smart cropping is not
implemented. Paid format and watermark requests return
`FEATURE_NOT_AVAILABLE` for an ineligible account.

```ts
ark.images.url(assetId, { width: 600, format: "webp", quality: 80 });
await serverArk.images.signedUrl(privateAssetId, { expiresInSeconds: 900 });
```

## Webhooks

Paid accounts manage endpoints at `/api/v2/webhooks`. Every delivery includes:

```text
X-Ark-Event: file.uploaded
X-Ark-Timestamp: 1787860000000
X-Ark-Signature: sha256=<hex digest>
```

Verify `HMAC-SHA256(secret, timestamp + "." + rawBody)` before parsing JSON.
Ark retries transient/non-2xx failures through RabbitMQ, records a truncated
response, marks an endpoint failing, and disables it only after the configured
persistent-failure threshold. Targets are DNS-resolved and private, loopback,
link-local, metadata, credential-bearing, and unsafe-port URLs are rejected.

## Team permissions

An existing account owner is implicitly `owner`; no migration is required.
Roles are `owner`, `admin`, `developer`, `editor`, and `viewer`. Permission
decisions live in `teamAccess.ts`. If the organization loses the `team`
entitlement, membership rows remain and non-owner access is suspended.

## Imports

`POST /api/v2/imports` supports AWS S3, R2, Bunny S3, MinIO, generic
S3-compatible sources, and HTTPS URLs. Import is copy-only. The worker scans,
checks quota, copies to the account's normal destination (R2 for Free, Bunny
for paid), verifies destination size, creates the Ark record, then queues normal
media processing. Default duplicate policy is `skip`.

```ts
const job = await ark.imports.create({
  appId,
  sourceType: "s3_compatible",
  endpoint,
  bucket,
  accessKey,
  secretKey,
});
await ark.imports.get(job.id);
await ark.imports.cancel(job.id);
```

Import credentials and webhook signing secrets are AES-256-GCM encrypted using
`ARK_S3_SECRET_ENCRYPTION_KEY`. Temporary import credentials are erased on a
terminal outcome. Source objects are never deleted.
