# `@nerdstackgrp/ark-server`

The Ark backend SDK. One package, two ways in: Ark's REST API, or any
S3-compatible tooling.

```ts
import { Ark, ArkS3 } from "@nerdstackgrp/ark-server";
```

## Install

```bash
npm install @nerdstackgrp/ark-server
```

Runtimes: Node 20+, Bun. Signing uses WebCrypto, so Deno and Cloudflare
Workers also work for the `ArkS3` client; `Ark`'s upload-from-path helper is
the only Node-specific part.

## REST API

```ts
const ark = new Ark({ token: process.env.ARK_API_TOKEN! });

const file = await ark.files.upload("./photo.jpg", { folderId });
const files = await ark.files.list({ limit: 50 });
const url = await ark.files.getDownloadUrl(file.id);
await ark.files.delete(file.id);

await ark.folders.create({ name: "Products" });
const usage = await ark.usage();
```

`upload` accepts a path, a `Uint8Array`, or a `Blob`, and handles multipart
transparently. Paths and blobs are streamed in bounded ranges rather than read
into memory in full.

For a custom Node or Web stream, provide its exact size so Ark can reserve
quota and plan multipart uploads before transferring bytes:

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const path = "./large-video.mp4";
const { size } = await stat(path);
const file = await ark.files.uploadStream(createReadStream(path), {
  size,
  filename: "large-video.mp4",
  contentType: "video/mp4",
});
```

The stream must produce exactly `size` bytes. Ark rejects underflow or overflow
and aborts the server-side upload session so its quota reservation is released.

### Browser sessions

To let your frontend upload directly without exposing your token:

```ts
const session = await ark.createClientSession({ ttlSeconds: 900 });
// Hand session.token to the browser, use it with @nerdstackgrp/ark-client.
```

## S3-compatible API

```ts
const s3 = new ArkS3({
  endpoint: "https://ark.nerdstackgrp.com/s3",
  accessKeyId: process.env.ARK_ACCESS_KEY_ID!,
  secretAccessKey: process.env.ARK_SECRET_ACCESS_KEY!,
  bucket: "product-media",
});

const stored = await s3.putObject("photo.jpg", bytes, { contentType: "image/jpeg" });
// `stored.url` is Ark's stable delivery URL. It uses the canonical physical
// object identity, not the logical S3 key supplied above.
console.log(stored.url, stored.assetId, stored.objectKey);
const data = await s3.getObject("photo.jpg");
const meta = await s3.headObject("photo.jpg");
const { objects } = await s3.listObjects({ prefix: "photos/", delimiter: "/" });
await s3.deleteObject("photo.jpg");
```

These are **Ark** credentials, issued in your Ark dashboard. They are not
credentials for any underlying storage provider, and they authenticate only
against Ark.

### Multipart

```ts
const { uploadId } = await s3.createMultipartUpload("big.mp4");
const part = await s3.uploadPart({ key: "big.mp4", uploadId, partNumber: 1, body: chunk });
await s3.completeMultipartUpload({ key: "big.mp4", uploadId, parts: [part] });
```

### Presigned URLs

```ts
const url = await s3.presignGet("photo.jpg", { expiresInSeconds: 900 });
const put = await s3.presignPut("upload.bin", { expiresInSeconds: 900 });
```

## Using the standard AWS SDK

Ark's S3 endpoint works with the official AWS SDK, the AWS CLI, and rclone —
you are not required to use this package:

```ts
import { S3Client } from "@aws-sdk/client-s3";

const client = new S3Client({
  endpoint: "https://ark.nerdstackgrp.com/s3",
  region: "auto",
  credentials: {
    accessKeyId: process.env.ARK_ACCESS_KEY_ID!,
    secretAccessKey: process.env.ARK_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
});
```

```bash
aws s3 ls s3://product-media --endpoint-url https://ark.nerdstackgrp.com/s3
```

Supported operations: `PutObject`, `GetObject`, `HeadObject`, `DeleteObject`,
`ListObjectsV2`, `CreateBucket`, `DeleteBucket`, `ListBuckets`, the four
multipart operations, and presigned GET/PUT. Not supported yet: `CopyObject`,
object versioning, ACLs, bucket policies, lifecycle rules, and tagging.

## Errors

```ts
import { ArkError } from "@nerdstackgrp/ark-server";

try {
  await s3.getObject("missing.jpg");
} catch (error) {
  if (error instanceof ArkError && error.code === "NO_SUCH_KEY") { /* ... */ }
}
```

Both surfaces normalize into `ArkError` — the REST API's JSON envelope and the
S3 API's XML errors alike — so mixing them means handling one error type.

## Buckets

An Ark bucket is a logical container scoped to your app, not a physical bucket
at a storage provider. Object keys are yours; the physical location is Ark's
concern and can change (for example when you upgrade your plan) without your
bucket names, keys, or credentials changing.

## Security

- Ark never issues you provider credentials, and never receives yours.
- Secrets are shown once at creation. Store them immediately.
- Rotate with an overlap window so a deploy never races an in-flight process:
  the old key stays valid for a grace period after the new one is issued.

## License

MIT. Derived in part from [`s3mini`](https://code.nolog.cz/thinking.tools/s3mini)
(MIT, © 2026 thinking.tools) — its AWS SigV4 construction was adapted for
Ark's client and gateway. See `LICENSE` and `LICENSE.upstream`.
