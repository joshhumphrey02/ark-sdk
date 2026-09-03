# ark-sdk

SDKs for Ark storage. One repo, three surfaces: `@nerdstackgrp/ark-client` for direct
browser uploads, `@nerdstackgrp/ark-server` for TypeScript backends, and
`nerdstack-ark` for Python frameworks and workers.

## Install

```bash
npm install @nerdstackgrp/ark-client   # browser
npm install @nerdstackgrp/ark-server   # backend
```

Both ship ESM and CommonJS builds with TypeScript declarations, and have zero
runtime dependencies.

## Packages

### `@nerdstackgrp/ark-client`

Direct browser uploads with short-lived Ark authorization. No provider
credentials ever reach the browser.

```ts
import { ArkClient } from "@nerdstackgrp/ark-client";

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

const video = await ark.streams.upload(selectedVideo, {
  appId,
  onProgress: ({ percentage }) => setProgress(percentage),
});
// Poll until ready, then use hlsUrl or embedUrl.
await ark.streams.get(video.id, { appId });
```

### `@nerdstackgrp/ark-server`

Backend access via Ark's REST API or any S3-compatible tooling.

```ts
import { Ark, ArkS3 } from "@nerdstackgrp/ark-server";

// REST API
const ark = new Ark({ token: process.env.ARK_API_TOKEN! });
const folder = await ark.folders.create({ name: "Products" });
await ark.files.upload("./photo.jpg", { folderId: folder.id });
const usage = await ark.usage();
const videos = await ark.streams.list({ appId });
await ark.streams.import({ appId, title: "Demo", url: sourceUrl });

// S3-compatible
const s3 = new ArkS3({
  endpoint: "https://ark.nerdstackgrp.com/s3",
  accessKeyId: process.env.ARK_ACCESS_KEY_ID!,
  secretAccessKey: process.env.ARK_SECRET_ACCESS_KEY!,
  bucket: "product-media",
});
await s3.putObject("photo.jpg", bytes);
await s3.listObjects({ prefix: "photos/" });
await s3.presignGet("photo.jpg", { expiresInSeconds: 900 });
```

Filesystem paths and blobs upload without loading the whole object into memory.
Use `ark.files.uploadStream(stream, { size, filename })` for custom Node or Web
streams; the declared size must match the bytes produced.

The S3 endpoint also works with the official AWS SDK, AWS CLI, and rclone.

### `nerdstack-ark` for Python

The [`packages/ark-py/`](packages/ark-py) package provides synchronous and asynchronous Ark
clients for Django, Flask, FastAPI, Celery, scripts, and workers, plus optional
boto3 configuration for Ark's S3-compatible endpoint.

```python
from ark_py import Ark, AsyncArk

with Ark(token) as ark:
    file = ark.files.upload("./photo.jpg")
    videos = ark.streams.list(app_id=app_id)
```

## Security model

- Browser uploads use short-lived, scoped sessions minted from your backend.
  The `ark_live_…` API token never leaves the server.
- `@nerdstackgrp/ark-server` never asks for provider credentials; Ark handles physical
  storage routing.
- Every failure surfaces as an `ArkError` with a stable `code`, `message`, and
  `requestId`.

## Requirements

The TypeScript packages require Node.js >= 20 and ship ESM, CommonJS, and declarations.
`nerdstack-ark` requires Python >= 3.10 and includes a PEP 561 typing marker.

## Examples

- `examples/browser-upload/` — React widget with direct uploads and progress
- `examples/backend-usage/` — REST and S3 usage patterns

## Docs

- `docs/sdk-library-inspection.md` — how `s3mini` and `s3-lite-client` were adapted

## Development

```bash
npm install        # installs workspaces
npm run typecheck  # tsc --noEmit, both packages
npm run build      # tsup -> dist/ (ESM + CJS + .d.ts)

cd packages/ark-py
python -m pip install -e ".[dev]"
pytest
python -m build
```

## Releasing

The npm packages are versioned and published together.

```bash
npm version <patch|minor|major> --workspaces
npm run build
npm publish --workspaces --access public
```

`prepublishOnly` rebuilds each package, so a stale `dist/` cannot be published.

Publish the Python package separately from `packages/ark-py` with
`python -m twine upload dist/*`.

## License

MIT. See `LICENSE` in each package. Portions derive from `s3mini` (MIT) and
`s3-lite-client` (MIT, itself deriving from MinIO's `minio-js`, Apache-2.0);
the upstream texts are preserved as `LICENSE.upstream`.
