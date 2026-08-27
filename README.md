# ark-sdk

TypeScript SDKs for Ark storage. One repo, two surfaces: `@ark/client` for
direct browser uploads, `@ark/server` for backend REST and S3-compatible
access.

## Packages

### `@ark/client`

Direct browser uploads with short-lived Ark authorization. No provider
credentials ever reach the browser.

```ts
import { ArkClient } from "@ark/client";

const ark = new ArkClient({ token: sessionTokenFromYourBackend });

const file = await ark.files.upload(selectedFile, {
  folderId,
  onProgress: ({ percentage }) => setProgress(percentage),
});

await ark.files.list({ folderId });
await ark.files.get(file.id);
await ark.files.delete(file.id);
await ark.files.getDownloadUrl(file.id);

await ark.folders.create({ name: "Products" });
await ark.folders.list();
```

### `@ark/server`

Backend access via Ark's REST API or any S3-compatible tooling.

```ts
import { Ark, ArkS3 } from "@ark/server";

// REST API
const ark = new Ark({ token: process.env.ARK_API_TOKEN! });
const folder = await ark.folders.create({ name: "Products" });
await ark.files.upload("./photo.jpg", { folderId: folder.id });
const usage = await ark.usage();

// S3-compatible
const s3 = new ArkS3({
  endpoint: "https://s3.ark.nerdstackgrp.com",
  accessKeyId: process.env.ARK_ACCESS_KEY_ID!,
  secretAccessKey: process.env.ARK_SECRET_ACCESS_KEY!,
  bucket: "product-media",
});
await s3.putObject("photo.jpg", bytes);
await s3.listObjects({ prefix: "photos/" });
await s3.presignGet("photo.jpg", { expiresInSeconds: 900 });
```

The S3 endpoint also works with the official AWS SDK, AWS CLI, and rclone.

## Security model

- Browser uploads use short-lived, scoped sessions minted from your backend.
  The `ark_live_…` API token never leaves the server.
- `@ark/server` never asks for provider credentials; Ark handles physical
  storage routing.
- Every failure surfaces as an `ArkError` with a stable `code`, `message`, and
  `requestId`.

## Requirements

Node.js >= 20. Both packages are ESM and ship as TypeScript.

## Examples

- `examples/browser-upload/` — React widget with direct uploads and progress
- `examples/backend-usage/` — REST and S3 usage patterns

## Docs

- `docs/sdk-library-inspection.md`
- `docs/media-webhooks-teams-imports.md`

## License

MIT. See `LICENSE` in each package.
