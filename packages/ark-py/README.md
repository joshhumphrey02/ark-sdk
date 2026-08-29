# Ark for Python

The official Python SDK for [Ark](https://ark.nerdstackgrp.com) storage. It is
framework-independent and provides:

- `Ark` for Django, Flask, Celery, scripts, and synchronous workers.
- `AsyncArk` for FastAPI, Starlette, aiohttp, and async workers.
- Memory-bounded single and multipart uploads.
- Typed result models and one normalized `ArkError` exception.
- Optional access through Ark's S3-compatible endpoint using boto3.

## Install

```bash
pip install nerdstack-ark
```

For S3-compatible access:

```bash
pip install "nerdstack-ark[s3]"
```

Python 3.10 or newer is required.

## Synchronous usage

```python
import os
from ark_py import Ark

with Ark(os.environ["ARK_API_TOKEN"]) as ark:
    folder = ark.folders.create("Product Media")
    file = ark.files.upload(
        "./hero.mp4",
        folder_id=folder.id,
        content_type="video/mp4",
    )
    download_url = ark.files.get_download_url(file.id, expires_in_seconds=600)
    print(download_url)
```

Filesystem paths stream directly from disk. A file-like object is also
accepted; provide `size` and `filename` when it is not seekable:

```python
file = ark.files.upload(
    request.stream,
    size=int(request.headers["content-length"]),
    filename="upload.bin",
)
```

The stream must produce exactly the declared number of bytes. Ark aborts an
incomplete server-side session if the transfer fails, underflows, or overflows.

## Asynchronous usage

```python
import os
from ark_py import AsyncArk

async with AsyncArk(os.environ["ARK_API_TOKEN"]) as ark:
    file = await ark.files.upload("./hero.mp4", content_type="video/mp4")
    usage = await ark.usage()
    print(file.id, usage.storage.used_bytes)
```

`AsyncArk.files.upload` accepts paths, ordinary binary files, and
`AsyncIterable[bytes]`. Async iterables require an exact `size` and `filename`.

## Files, folders, images, and sessions

```python
page = ark.files.list(folder_id=folder.id, limit=50)
file = ark.files.get(page.data[0].id)
ark.files.move(file.id, folder_id=None)
ark.files.delete(file.id)

folders = ark.folders.list(parent_id=None)
ark.folders.rename(folder.id, "Campaign Media")

image_url = ark.images.url(file.id)
signed_url = ark.images.signed_url(file.id, expires_in_seconds=600)

session = ark.create_client_session(ttl_seconds=900)
# Hand session.token to @nerdstackgrp/ark-client in the browser.
```

## S3-compatible access

```python
import os
from ark_py import create_s3_client

s3 = create_s3_client(
    access_key_id=os.environ["ARK_ACCESS_KEY_ID"],
    secret_access_key=os.environ["ARK_SECRET_ACCESS_KEY"],
)

s3.put_object(Bucket="product-media", Key="hero.jpg", Body=image_bytes)
objects = s3.list_objects_v2(Bucket="product-media", Prefix="photos/")
```

These must be Ark-issued S3 credentials. The helper configures SigV4 and
path-style addressing for `https://ark.nerdstackgrp.com/s3`.

## Errors

```python
from ark_py import ArkError

try:
    ark.files.get("missing")
except ArkError as error:
    print(error.code, error.status, error.request_id, error.retryable)
```

## Framework examples

Complete examples live in [`examples/`](examples):

- Django upload view and application lifecycle.
- Flask application factory and upload route.
- FastAPI lifespan management and `UploadFile` streaming.

Keep `ARK_API_TOKEN` in server-side environment configuration. Never expose it
to templates, frontend bundles, mobile apps, logs, or error responses.

## Development

```bash
python -m venv .venv
.venv/bin/pip install -e ".[dev]"
.venv/bin/pytest
.venv/bin/ruff check .
.venv/bin/mypy
.venv/bin/python -m build
.venv/bin/twine check dist/*
```

## License

MIT © Nerdstack.
