import assert from "node:assert/strict";
import test from "node:test";

import { Ark, ArkError, ArkS3 } from "../packages/ark-server/dist/index.js";
import { ArkClient } from "../packages/ark-client/dist/index.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const usage = {
  storage: { usedBytes: 0, pendingBytes: 0, limitBytes: 1, availableBytes: 1 },
  tier: "free",
  status: "active",
};

test("Ark and ArkClient compose the default API URL exactly once", async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(String(url));
    return json(usage);
  };

  await new Ark({ token: "ark_live_test", fetch }).usage();
  await new ArkClient({ token: "arkc_test", fetch }).usage();

  assert.deepEqual(urls, [
    "https://ark.nerdstackgrp.com/api/v2/usage",
    "https://ark.nerdstackgrp.com/api/v2/usage",
  ]);
});

test("custom origins, versions, and REST identifiers are composed safely", async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(String(url));
    return json({ id: "file", name: "file" });
  };
  const id = "folder/../file?admin=true";

  await new Ark({ token: "token", baseUrl: "https://ark.test/", version: "v9/../admin", fetch })
    .files.get(id);
  await new ArkClient({ token: "arkc_test", baseUrl: "https://ark.test/", version: "v9/../admin", fetch })
    .files.get(id);

  assert.deepEqual(urls, [
    "https://ark.test/api/v9%2F..%2Fadmin/files/folder%2F..%2Ffile%3Fadmin%3Dtrue",
    "https://ark.test/api/v9%2F..%2Fadmin/files/folder%2F..%2Ffile%3Fadmin%3Dtrue",
  ]);
});

test("ArkS3 rejects bucket and key path traversal before fetch", async () => {
  let requests = 0;
  const s3 = new ArkS3({
    accessKeyId: "ARKAKIATEST",
    secretAccessKey: "secret",
    bucket: "valid-bucket",
    fetch: async () => {
      requests += 1;
      return new Response(null, { status: 200 });
    },
  });

  await assert.rejects(s3.putObject("../../api/v2/usage", "bad"), (error) => {
    assert.ok(error instanceof ArkError);
    assert.equal(error.code, "INVALID_ARGUMENT");
    return true;
  });
  await assert.rejects(
    s3.putObject("safe.txt", "bad", { bucket: "../other" }),
    /Invalid bucket name/,
  );
  assert.equal(requests, 0);
});

test("ArkS3 returns Ark's canonical identity after a committed PUT", async () => {
  const physicalKey = "apps/app-id/buckets/bucket-id/objects/asset-id/photo.jpg";
  const canonicalUrl = `https://cdn.nerdstackgrp.com/${physicalKey}`;
  const s3 = new ArkS3({
    accessKeyId: "ARKAKIATEST",
    secretAccessKey: "secret",
    bucket: "valid-bucket",
    fetch: async () => new Response(null, {
      status: 200,
      headers: {
        etag: '"etag-1"',
        "x-ark-asset-id": "asset-id",
        "x-ark-object-key": encodeURIComponent(physicalKey),
        "x-ark-url": canonicalUrl,
      },
    }),
  });

  assert.deepEqual(await s3.putObject("admin/photo.jpg", "bytes"), {
    etag: "etag-1",
    assetId: "asset-id",
    objectKey: physicalKey,
    url: canonicalUrl,
  });
});

test("ArkS3 validates presign TTLs", () => {
  const s3 = new ArkS3({
    accessKeyId: "ARKAKIATEST",
    secretAccessKey: "secret",
    bucket: "valid-bucket",
  });

  assert.throws(() => s3.presignGet("file.txt", { expiresInSeconds: 0 }), /between 1 and 604800/);
  assert.throws(() => s3.presignPut("file.txt", { expiresInSeconds: 604801 }), /between 1 and 604800/);
  assert.throws(() => s3.presignPut("file.txt", { expiresInSeconds: 1.5 }), /integer/);
});

test("ArkS3 XML-escapes caller-provided multipart ETags", async () => {
  let requestBody = "";
  const s3 = new ArkS3({
    accessKeyId: "ARKAKIATEST",
    secretAccessKey: "secret",
    bucket: "valid-bucket",
    fetch: async (_url, init) => {
      requestBody = String(init.body);
      return new Response("<CompleteMultipartUploadResult><ETag>done</ETag></CompleteMultipartUploadResult>", {
        status: 200,
        headers: { "content-type": "application/xml" },
      });
    },
  });

  await s3.completeMultipartUpload({
    key: "file.bin",
    uploadId: "upload-1",
    parts: [{ partNumber: 1, etag: 'value&<unsafe>"' }],
  });

  assert.match(requestBody, /<ETag>"value&amp;&lt;unsafe&gt;"<\/ETag>/);
  assert.doesNotMatch(requestBody, /<unsafe>/);
});

test("ArkS3 decodes XML entities in list responses", async () => {
  const s3 = new ArkS3({
    accessKeyId: "ARKAKIATEST",
    secretAccessKey: "secret",
    bucket: "valid-bucket",
    fetch: async (url) => {
      const path = new URL(url).pathname;
      if (path === "/s3/") {
        return new Response(
          "<ListAllMyBucketsResult><Buckets><Bucket><Name>images&amp;media</Name><CreationDate>2026-01-01T00:00:00Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>",
          { status: 200 },
        );
      }
      return new Response(
        "<ListBucketResult>" +
          "<Contents><Key>photos/a&amp;b.jpg</Key><LastModified>2026-01-01T00:00:00Z</LastModified><ETag>&quot;etag&amp;1&quot;</ETag><Size>4</Size></Contents>" +
          "<CommonPrefixes><Prefix>photos/a&amp;b/</Prefix></CommonPrefixes>" +
          "<IsTruncated>true</IsTruncated><NextContinuationToken>next&amp;page</NextContinuationToken>" +
          "</ListBucketResult>",
        { status: 200 },
      );
    },
  });

  assert.equal((await s3.listBuckets())[0].name, "images&media");
  const listed = await s3.listObjects();
  assert.equal(listed.objects[0].key, "photos/a&b.jpg");
  assert.equal(listed.objects[0].etag, "etag&1");
  assert.deepEqual(listed.prefixes, ["photos/a&b/"]);
  assert.equal(listed.nextContinuationToken, "next&page");
});

test("ArkClient cancels sibling multipart uploads and awaits session cleanup", async () => {
  let siblingAborted = false;
  let sessionAborted = false;
  const file = new Blob([Uint8Array.from({ length: 8 }, (_, index) => index)]);
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
      await new Promise((resolve) => setTimeout(resolve, 2));
      return new Response("failed", { status: 500 });
    }
    if (value.endsWith("/part-2")) {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          siblingAborted = true;
          reject(init.signal.reason);
        }, { once: true });
      });
    }
    if (value.includes("/abort")) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      sessionAborted = true;
      return json({ aborted: true });
    }
    throw new Error(`Unexpected request: ${value}`);
  };

  await assert.rejects(
    new ArkClient({ token: "arkc_test", baseUrl: "https://ark.test", fetch })
      .files.upload(file),
    /status 500/,
  );
  assert.equal(siblingAborted, true);
  assert.equal(sessionAborted, true);
});
