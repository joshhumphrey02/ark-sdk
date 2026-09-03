import assert from "node:assert/strict";
import test from "node:test";

import { Ark } from "../packages/ark-server/dist/index.js";
import { ArkClient } from "../packages/ark-client/dist/index.js";

const stream = {
  id: "stream/id",
  title: "Launch",
  status: "processing",
  encodeProgress: 40,
  durationSeconds: 12,
  width: 1920,
  height: 1080,
  size: 8,
  thumbnailUrl: null,
  hlsUrl: null,
  embedUrl: null,
  createdAt: "2026-09-03T00:00:00.000Z",
};

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("server SDK exposes every Ark Streams control-plane endpoint", async () => {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method || "GET", body: init.body });
    const path = new URL(url).pathname;
    if (path.endsWith("/streams/fetch")) return json(stream, 202);
    if (path.endsWith("/streams/stream%2Fid/upload-url")) {
      return json({ endpoint: "/streams/stream%2Fid/upload?appId=app%2Fid" });
    }
    if (path.endsWith("/streams/stream%2Fid") && init.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("/streams/stream%2Fid")) return json(stream);
    if (path.endsWith("/streams") && init.method === "POST") {
      return json({ stream, upload: { endpoint: "/streams/stream%2Fid/upload" } }, 201);
    }
    if (path.endsWith("/streams")) return json({ streams: [stream], nextCursor: "next" });
    throw new Error(`Unexpected request: ${url}`);
  };
  const ark = new Ark({ token: "token", baseUrl: "https://ark.test", fetch });

  const created = await ark.streams.create({
    title: "Launch",
    sizeBytes: 8,
    appId: "app/id",
    collectionId: "collection-1",
  });
  assert.equal(created.stream.id, "stream/id");
  assert.equal((await ark.streams.import({ title: "Remote", url: "https://video.test/a.mp4", appId: "app/id" })).id, "stream/id");
  assert.equal((await ark.streams.list({ appId: "app/id", limit: 10, cursor: "cursor/id" })).nextCursor, "next");
  assert.equal((await ark.streams.get("stream/id", { appId: "app/id" })).encodeProgress, 40);
  assert.match((await ark.streams.refreshUploadUrl("stream/id", { appId: "app/id" })).endpoint, /upload/);
  await ark.streams.delete("stream/id", { appId: "app/id" });

  assert.deepEqual(requests.map(({ method, url }) => [method, url]), [
    ["POST", "https://ark.test/api/v2/streams"],
    ["POST", "https://ark.test/api/v2/streams/fetch"],
    ["GET", "https://ark.test/api/v2/streams?appId=app%2Fid&limit=10&cursor=cursor%2Fid"],
    ["GET", "https://ark.test/api/v2/streams/stream%2Fid?appId=app%2Fid"],
    ["POST", "https://ark.test/api/v2/streams/stream%2Fid/upload-url?appId=app%2Fid"],
    ["DELETE", "https://ark.test/api/v2/streams/stream%2Fid?appId=app%2Fid"],
  ]);
});

test("browser SDK creates and uploads an Ark Stream with resumable TUS chunks", async () => {
  const bytes = Uint8Array.from({ length: 8 }, (_, index) => index + 1);
  const file = new Blob([bytes], { type: "video/mp4" });
  const patches = [];
  const progress = [];
  let offset = 0;
  let failFirstPatch = true;
  let headRequests = 0;
  const fetch = async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith("/api/v2/streams") && init.method === "POST") {
      assert.deepEqual(JSON.parse(init.body), { title: "Demo", sizeBytes: 8, appId: "app-1" });
      return json({ stream, upload: { endpoint: "/streams/stream%2Fid/upload?appId=app-1" } }, 201);
    }
    if (value.includes("/upload?appId=app-1") && init.method === "POST") {
      assert.equal(init.headers["Upload-Length"], "8");
      return new Response(null, {
        status: 201,
        headers: { location: "/api/v2/streams/stream%2Fid/upload/token?appId=app-1" },
      });
    }
    if (value.includes("/upload/token?appId=app-1") && init.method === "PATCH") {
      assert.equal(Number(init.headers["Upload-Offset"]), offset);
      if (failFirstPatch) {
        failFirstPatch = false;
        return new Response(null, { status: 503 });
      }
      const chunk = new Uint8Array(await init.body.arrayBuffer());
      patches.push([...chunk]);
      offset += chunk.byteLength;
      return new Response(null, { status: 204, headers: { "upload-offset": String(offset) } });
    }
    if (value.includes("/upload/token?appId=app-1") && init.method === "HEAD") {
      headRequests += 1;
      return new Response(null, { status: 204, headers: { "upload-offset": String(offset) } });
    }
    throw new Error(`Unexpected request: ${value}`);
  };

  const result = await new ArkClient({ token: "arkc_test", baseUrl: "https://ark.test", fetch })
    .streams.upload(file, {
      title: "Demo",
      appId: "app-1",
      chunkSize: 3,
      onProgress: ({ uploadedBytes }) => progress.push(uploadedBytes),
    });

  assert.equal(result.id, "stream/id");
  assert.deepEqual(patches, [[1, 2, 3], [4, 5, 6], [7, 8]]);
  assert.deepEqual(progress, [3, 6, 8]);
  assert.equal(headRequests, 1);
});
