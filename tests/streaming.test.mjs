import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { Ark, ArkError } from "../packages/ark-server/dist/index.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function bodyBytes(body) {
  if (body == null) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof body[Symbol.asyncIterator] === "function") {
    const chunks = [];
    let size = 0;
    for await (const chunk of body) {
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      chunks.push(bytes);
      size += bytes.byteLength;
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
  return new Uint8Array(await new Response(body).arrayBuffer());
}

function fileResult(size) {
  return {
    id: "file-1",
    name: "upload.bin",
    originalName: "upload.bin",
    size,
    mimeType: "application/octet-stream",
    folderId: null,
    status: "available",
    checksum: null,
    url: "https://files.test/upload.bin",
    createdAt: null,
  };
}

function uploadFetch({ bytes, multipart = false, partSize = 4, maxConcurrency = 2, failUpload = false }) {
  const uploads = [];
  const completed = [];
  const aborted = [];
  let active = 0;
  let maxActive = 0;
  const fetch = async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith("/uploads/presign")) {
      const input = JSON.parse(init.body);
      assert.equal(input.size, bytes.byteLength);
      return json(multipart
        ? {
            uploadId: "upload/id",
            multipart: true,
            partSize,
            parts: Array.from({ length: Math.ceil(bytes.byteLength / partSize) }, (_, index) => ({
              partNumber: index + 1,
              url: `https://storage.test/part-${index + 1}`,
            })),
            maxConcurrency,
          }
        : {
            uploadId: "upload/id",
            multipart: false,
            url: "https://storage.test/single",
            headers: {},
          });
    }
    if (value.startsWith("https://storage.test/")) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        const uploaded = await bodyBytes(init.body);
        uploads.push({ url: value, bytes: uploaded, body: init.body, init });
        await new Promise((resolve) => setTimeout(resolve, 2));
        if (failUpload) return new Response("failed", { status: 500 });
        const part = /part-(\d+)/.exec(value)?.[1];
        return new Response(null, { status: 200, headers: part ? { etag: `"etag-${part}"` } : {} });
      } finally {
        active -= 1;
      }
    }
    if (value.includes("/complete")) {
      completed.push(JSON.parse(init.body));
      return json(fileResult(bytes.byteLength));
    }
    if (value.includes("/abort")) {
      aborted.push(value);
      return json({ aborted: true });
    }
    throw new Error(`Unexpected request: ${value}`);
  };
  return { fetch, uploads, completed, aborted, get maxActive() { return maxActive; } };
}

test("filesystem paths use a streaming body for single-part uploads", async () => {
  const bytes = new TextEncoder().encode("stream this file");
  const directory = await mkdtemp(join(tmpdir(), "ark-sdk-stream-"));
  const path = join(directory, "upload.bin");
  await writeFile(path, bytes);
  const mock = uploadFetch({ bytes });

  await new Ark({ token: "token", baseUrl: "https://ark.test", fetch: mock.fetch })
    .files.upload(path);

  assert.equal(mock.uploads.length, 1);
  assert.ok(!(mock.uploads[0].body instanceof Uint8Array));
  assert.equal(mock.uploads[0].init.duplex, "half");
  assert.equal(mock.uploads[0].init.headers["content-length"], String(bytes.byteLength));
  assert.deepEqual(mock.uploads[0].bytes, bytes);
  assert.equal(mock.aborted.length, 0);
});

test("multipart path uploads stream correct ranges with bounded concurrency", async () => {
  const bytes = Uint8Array.from({ length: 19 }, (_, index) => index + 1);
  const directory = await mkdtemp(join(tmpdir(), "ark-sdk-parts-"));
  const path = join(directory, "upload.bin");
  await writeFile(path, bytes);
  const mock = uploadFetch({ bytes, multipart: true, partSize: 4, maxConcurrency: 2 });

  await new Ark({ token: "token", baseUrl: "https://ark.test", fetch: mock.fetch })
    .files.upload(path);

  assert.equal(mock.uploads.length, 5);
  assert.ok(mock.uploads.every((upload) => !(upload.body instanceof Uint8Array)));
  assert.ok(mock.maxActive <= 2);
  const ordered = mock.uploads.toSorted((a, b) => a.url.localeCompare(b.url));
  assert.deepEqual(ordered.map((upload) => [...upload.bytes]), [
    [1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19],
  ]);
  assert.deepEqual(mock.completed[0].parts, [
    { partNumber: 1, etag: "etag-1" },
    { partNumber: 2, etag: "etag-2" },
    { partNumber: 3, etag: "etag-3" },
    { partNumber: 4, etag: "etag-4" },
    { partNumber: 5, etag: "etag-5" },
  ]);
});

test("Blob and Uint8Array uploads remain supported without whole-Blob conversion", async () => {
  const bytes = new TextEncoder().encode("blob bytes");
  class GuardedBlob extends Blob {
    arrayBuffer() {
      throw new Error("the SDK must not call arrayBuffer on the complete Blob");
    }
  }

  const blobMock = uploadFetch({ bytes, multipart: true, partSize: 3 });
  await new Ark({ token: "token", baseUrl: "https://ark.test", fetch: blobMock.fetch })
    .files.upload(new GuardedBlob([bytes]), { filename: "blob.bin" });
  assert.deepEqual(blobMock.uploads.flatMap((upload) => [...upload.bytes]), [...bytes]);

  const arrayMock = uploadFetch({ bytes });
  await new Ark({ token: "token", baseUrl: "https://ark.test", fetch: arrayMock.fetch })
    .files.upload(bytes, { filename: "bytes.bin" });
  assert.deepEqual(arrayMock.uploads[0].bytes, bytes);
});

test("uploadStream supports fragmented Node streams and multipart boundaries", async () => {
  const bytes = Uint8Array.from({ length: 10 }, (_, index) => index);
  const source = Readable.from([
    bytes.subarray(0, 1),
    bytes.subarray(1, 7),
    bytes.subarray(7),
  ]);
  const mock = uploadFetch({ bytes, multipart: true, partSize: 4, maxConcurrency: 2 });

  await new Ark({ token: "token", baseUrl: "https://ark.test", fetch: mock.fetch })
    .files.uploadStream(source, { size: bytes.byteLength, filename: "stream.bin" });

  const ordered = mock.uploads.toSorted((a, b) => a.url.localeCompare(b.url));
  assert.deepEqual(ordered.map((upload) => [...upload.bytes]), [
    [0, 1, 2, 3], [4, 5, 6, 7], [8, 9],
  ]);
  assert.ok(mock.maxActive <= 2);
});

test("uploadStream supports exact Web streams", async () => {
  const bytes = new TextEncoder().encode("web-stream");
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 2));
      controller.enqueue(bytes.subarray(2));
      controller.close();
    },
  });
  const mock = uploadFetch({ bytes });

  await new Ark({ token: "token", baseUrl: "https://ark.test", fetch: mock.fetch })
    .files.uploadStream(source, { size: bytes.byteLength, filename: "stream.bin" });

  assert.deepEqual(mock.uploads[0].bytes, bytes);
  assert.equal(mock.uploads[0].init.duplex, "half");
});

for (const scenario of [
  { name: "underflow", declared: 5, actual: Uint8Array.of(1, 2, 3) },
  { name: "overflow", declared: 2, actual: Uint8Array.of(1, 2, 3) },
]) {
  test(`uploadStream rejects ${scenario.name} and aborts its Ark session`, async () => {
    const expected = new Uint8Array(scenario.declared);
    const mock = uploadFetch({ bytes: expected });
    const source = Readable.from([scenario.actual]);

    await assert.rejects(
      new Ark({ token: "token", baseUrl: "https://ark.test", fetch: mock.fetch })
        .files.uploadStream(source, {
          size: scenario.declared,
          filename: "invalid.bin",
        }),
      (error) => {
        assert.ok(error instanceof ArkError);
        assert.equal(error.code, "INVALID_ARGUMENT");
        return true;
      },
    );
    assert.equal(mock.completed.length, 0);
    assert.equal(mock.aborted.length, 1);
  });
}

test("uploadStream cancels its source and aborts the session after transfer failure", async () => {
  const bytes = new TextEncoder().encode("cancel me");
  let cancelled = false;
  async function* source() {
    try {
      yield bytes;
    } finally {
      cancelled = true;
    }
  }
  const mock = uploadFetch({ bytes, failUpload: true });

  await assert.rejects(
    new Ark({ token: "token", baseUrl: "https://ark.test", fetch: mock.fetch })
      .files.uploadStream(source(), { size: bytes.byteLength, filename: "failure.bin" }),
    /status 500/,
  );
  assert.equal(cancelled, true);
  assert.equal(mock.aborted.length, 1);
});

test("multipart failure aborts other in-flight part requests", async () => {
  const bytes = Uint8Array.from({ length: 8 }, (_, index) => index);
  let inFlightAborted = false;
  let sessionAborted = false;
  const fetch = async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith("/uploads/presign")) {
      return json({
        uploadId: "upload/id",
        multipart: true,
        partSize: 4,
        maxConcurrency: 2,
        parts: [
          { partNumber: 1, url: "https://storage.test/part-1" },
          { partNumber: 2, url: "https://storage.test/part-2" },
        ],
      });
    }
    if (value.endsWith("/part-1")) {
      await bodyBytes(init.body);
      await new Promise((resolve) => setTimeout(resolve, 2));
      return new Response("failed", { status: 500 });
    }
    if (value.endsWith("/part-2")) {
      await bodyBytes(init.body);
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          inFlightAborted = true;
          reject(init.signal.reason);
        }, { once: true });
      });
    }
    if (value.includes("/abort")) {
      sessionAborted = true;
      return json({ aborted: true });
    }
    throw new Error(`Unexpected request: ${value}`);
  };

  await assert.rejects(
    new Ark({ token: "token", baseUrl: "https://ark.test", fetch })
      .files.uploadStream(Readable.from([bytes]), {
        size: bytes.byteLength,
        filename: "failure.bin",
      }),
    /status 500/,
  );
  assert.equal(inFlightAborted, true);
  assert.equal(sessionAborted, true);
});

test("uploadStream rejects invalid declared sizes before making a request", () => {
  let requests = 0;
  const ark = new Ark({
    token: "token",
    fetch: async () => {
      requests += 1;
      return json({});
    },
  });
  const stream = Readable.from([Uint8Array.of(1)]);

  assert.throws(
    () => ark.files.uploadStream(stream, { size: 0, filename: "empty.bin" }),
    /positive safe integer/,
  );
  assert.equal(requests, 0);
});
