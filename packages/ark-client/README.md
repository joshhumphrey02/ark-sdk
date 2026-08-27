# `@ark/client`

The Ark frontend SDK. Direct browser uploads with short-lived Ark
authorization — no provider credentials ever reach the browser.

## Install

```bash
npm install @ark/client
```

## Authentication

An `ark_live_…` API token is a **server-side secret**. Never ship it in a
browser bundle or a `NEXT_PUBLIC_*` variable — anyone viewing the page can read
it. This SDK refuses one in a browser context.

Instead, mint a short-lived scoped session from your backend:

```ts
// Your backend
import { Ark } from "@ark/server";

const ark = new Ark({ token: process.env.ARK_API_TOKEN! });
const session = await ark.createClientSession({ ttlSeconds: 900 });
// Send session.token to the browser.
```

```ts
// Your frontend
import { ArkClient } from "@ark/client";

const ark = new ArkClient({ token: session.token });
```

Sessions expire in minutes and are limited to upload/read scopes. They cannot
delete files or create further sessions.

## Upload

```ts
const file = await ark.files.upload(selectedFile, {
  folderId,
  onProgress({ percentage }) {
    setProgress(percentage);
  },
});
```

Multipart, retry, and completion verification are handled internally. Large
files are split automatically; you do not branch on size.

Returns a normalized `ArkFile`:

```ts
{ id, name, size, mimeType, folderId, status, url, checksum, createdAt }
```

### Cancel

```ts
const upload = ark.files.upload(file);
upload.abort();
```

Aborting also releases the server-side upload session and its quota hold.

## Files and folders

```ts
await ark.files.list({ folderId, limit: 50 });
await ark.files.get(fileId);
await ark.files.delete(fileId);
await ark.files.move(fileId, { folderId });
await ark.files.getDownloadUrl(fileId);

await ark.folders.create({ name: "Products" });
await ark.folders.list();
```

## Errors

Every failure is an `ArkError` with a stable `code`, a `message`, and a
`requestId` to quote in a support request.

```ts
import { ArkError } from "@ark/client";

try {
  await ark.files.upload(file);
} catch (error) {
  if (error instanceof ArkError && error.code === "QUOTA_EXCEEDED") {
    showUpgradePrompt();
  }
}
```

Codes: `UNAUTHORIZED`, `INSUFFICIENT_SCOPE`, `QUOTA_EXCEEDED`,
`FILE_TOO_LARGE`, `INVALID_FILE_TYPE`, `UPLOAD_EXPIRED`, `UPLOAD_FAILED`,
`UPLOAD_ABORTED`, `NOT_FOUND`, `NETWORK_ERROR`, `RATE_LIMITED`,
`INTERNAL_ERROR`.

`error.retryable` tells you whether retrying could help. The SDK already
retries transient failures with exponential backoff and jitter; it never
retries auth, quota or validation failures.

## Security

- No provider credentials. The SDK holds no signing keys and has no signing
  code; it receives short-lived, single-object upload authorizations from Ark.
- Passing `accessKeyId`/`secretAccessKey` throws.
- Passing a server-side `ark_live_…` token in a browser throws.

## Framework support

Framework-independent — plain JS, React, Vue, Svelte, and Next.js client
components all use the same API. No framework is imported by this package.

## License

MIT. Derived in part from [`s3-lite-client`](https://github.com/bradenmacdonald/s3-lite-client)
(MIT), which itself derives from MinIO's `minio-js` (Apache-2.0). See
`LICENSE` and `LICENSE.upstream`.
