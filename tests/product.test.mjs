import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import { ArkError, ArkProduct, verifyArkWebhook } from "../packages/ark-server/dist/index.js";
import { uploadToSession } from "../packages/ark-client/dist/index.js";

const API = "https://ark.test/api/v1/internal";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

/** A fake Ark: answers the token request, records every other call. */
function fakeArk(answer = () => json({})) {
  const calls = [];
  let tokens = 0;
  const fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname.replace("/api/v1/internal", "");
    if (path === "/auth/token") {
      tokens += 1;
      return json({ access_token: `token-${tokens}`, expires_in: 900 });
    }
    const call = { path, url: String(url), method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    return answer(call);
  };
  return { fetch, calls, tokens: () => tokens };
}

const product = (fetch, extra = {}) => new ArkProduct({ clientId: "cid", clientSecret: "secret", apiUrl: API, fetch, ...extra });

test("ArkProduct addresses organizations by the product's own id and shares one token", async () => {
  const ark = fakeArk(() => json({ organizationId: "o1", externalTenantId: "acc 1", status: "ACTIVE", created: true }));
  const client = product(ark.fetch);
  await Promise.all([
    client.organizations.create({ externalTenantId: "acc 1", name: "Ada" }),
    client.organizations.suspend({ externalTenantId: "acc 1" }, "business_suspended"),
    client.usage.get("org-uuid"),
  ]);
  assert.equal(ark.tokens(), 1);
  assert.deepEqual(
    ark.calls.map((c) => `${c.method} ${c.path}`).sort(),
    ["GET /organizations/org-uuid/usage", "POST /organizations", "POST /organizations/external:acc%201/suspend"].sort(),
  );
  assert.ok(ark.calls.every((c) => c.headers.authorization === "Bearer token-1"));
});

test("ArkProduct sends idempotency keys, signs requests and reports each call", async () => {
  const events = [];
  const ark = fakeArk(() => json({ uploadId: "u1", fileId: "f1", multipart: false, method: "PUT", url: "https://store.test/x", headers: {}, expiresAt: "" }));
  const client = product(ark.fetch, {
    requestSigningSecret: "sign-secret",
    headers: () => ({ "x-correlation-id": "req-1" }),
    onResponse: (event) => events.push(event),
  });
  await client.uploads.create({ externalTenantId: "a" }, { filename: "a.jpg", size: 3, mimeType: "image/jpeg" }, { idempotencyKey: "asset-1" });
  const [call] = ark.calls;
  assert.equal(call.headers["idempotency-key"], "asset-1");
  assert.equal(call.headers["x-correlation-id"], "req-1");
  const bodyHash = createHash("sha256").update(call.body).digest("hex");
  const canonical = ["ARK-HMAC-SHA256", call.headers["x-ark-timestamp"], call.headers["x-ark-nonce"], "POST", "/api/v1/internal/organizations/external:a/uploads", bodyHash].join("\n");
  assert.equal(call.headers["x-ark-signature"], `v1=${createHmac("sha256", "sign-secret").update(canonical).digest("hex")}`);
  assert.deepEqual(events.map((e) => [e.operation, e.status]), [["auth.token", 200], ["uploads.create", 200]]);
});

test("ArkProduct refreshes a rejected token once and surfaces Ark's error codes", async () => {
  let first = true;
  const ark = fakeArk((call) => {
    if (call.path.endsWith("/entitlements")) {
      return json({ error: { code: "STALE_REVISION", message: "older", details: { currentRevision: 7 } } }, 409);
    }
    if (first) {
      first = false;
      return json({ error: { code: "UNAUTHORIZED", message: "expired" } }, 401);
    }
    return json({ id: "p", slug: "cartly", name: "Cartly", status: "ACTIVE" });
  });
  const client = product(ark.fetch);
  assert.equal((await client.product()).slug, "cartly");
  assert.equal(ark.tokens(), 2);

  await assert.rejects(
    client.entitlements.set({ externalTenantId: "a" }, { revision: 3, source: { type: "PLAN", reference: "plan" }, entitlements: [] }),
    (error) => error instanceof ArkError && error.code === "STALE_REVISION" && error.details.currentRevision === 7 && !error.retryable,
  );
  const busy = new ArkError({ code: "ORGANIZATION_NOT_READY", message: "x", status: 409 });
  assert.equal(busy.retryable, true);
});

test("ArkProduct treats cleanup of something already gone as done", async () => {
  const ark = fakeArk(() => json({ error: { code: "NOT_FOUND", message: "gone" } }, 404));
  const client = product(ark.fetch);
  await client.assets.delete({ externalTenantId: "a" }, "asset-1");
  await client.uploads.abort({ externalTenantId: "a" }, "upload-1");
  assert.equal(ark.calls[0].headers["idempotency-key"], "delete-asset-1");
  await assert.rejects(client.assets.get({ externalTenantId: "a" }, "asset-1"), (error) => error.code === "NOT_FOUND");
});

test("ArkProduct entitlements carry the external tenant id", async () => {
  const ark = fakeArk(() => json({ outcome: "APPLIED", revision: 4 }));
  await product(ark.fetch).entitlements.set({ externalTenantId: "acc-9" }, { revision: 4, source: { type: "PLAN", reference: "cartly-subscription" }, entitlements: [{ key: "media.storage.bytes", limit: 10 }] });
  assert.deepEqual(JSON.parse(ark.calls[0].body), {
    externalTenantId: "acc-9",
    revision: 4,
    source: { type: "PLAN", reference: "cartly-subscription" },
    entitlements: [{ key: "media.storage.bytes", limit: 10 }],
  });
});

test("verifyArkWebhook accepts Ark's signature and refuses tampering, replays and missing secrets", () => {
  const body = JSON.stringify({ id: "evt_1", type: "asset.uploaded" });
  const now = 1_761_556_800_000;
  const t = Math.floor(now / 1000);
  const header = `t=${t},v1=${createHmac("sha256", "whsec").update(`${t}.${body}`).digest("hex")}`;
  assert.equal(verifyArkWebhook(body, header, "whsec", { now }), true);
  assert.equal(verifyArkWebhook(Buffer.from(body), header, "whsec", { now }), true);
  assert.equal(verifyArkWebhook(`${body} `, header, "whsec", { now }), false);
  assert.equal(verifyArkWebhook(body, header, "whsec", { now: now + 301_000 }), false);
  assert.equal(verifyArkWebhook(body, header, "other", { now }), false);
  assert.equal(verifyArkWebhook(body, header, undefined, { now }), false);
  assert.equal(verifyArkWebhook(body, undefined, "whsec", { now }), false);
});

test("uploadToSession PUTs to the presigned URL only, never Ark's fallback, and returns part ETags", async () => {
  const puts = [];
  const fetch = async (url, init) => {
    puts.push({ url: String(url), headers: init.headers, size: init.body.size });
    return new Response("", { status: 200, headers: { etag: `"etag-${puts.length}"` } });
  };
  const file = new Blob([new Uint8Array(10)], { type: "image/png" });

  const single = await uploadToSession(
    file,
    { uploadId: "u", fileId: "f", multipart: false, method: "PUT", url: "https://store.test/one", headers: { "x-amz-meta": "1" }, fallbackUrl: "https://ark.test/fallback", expiresAt: "" },
    { fetch },
  );
  assert.equal(single.parts, undefined);
  assert.deepEqual(puts[0], { url: "https://store.test/one", headers: { "content-type": "image/png", "x-amz-meta": "1" }, size: 10 });

  puts.length = 0;
  const progress = [];
  const multi = await uploadToSession(
    file,
    {
      uploadId: "u",
      fileId: "f",
      multipart: true,
      partSize: 6,
      partCount: 2,
      maxConcurrency: 2,
      expiresAt: "",
      parts: [
        { partNumber: 1, url: "https://store.test/p1", fallbackUrl: "https://ark.test/p1" },
        { partNumber: 2, url: "https://store.test/p2", fallbackUrl: "https://ark.test/p2" },
      ],
    },
    { fetch, onProgress: (p) => progress.push(p.percentage) },
  );
  assert.deepEqual(multi.parts.map((p) => p.partNumber), [1, 2]);
  assert.ok(puts.every((p) => p.url.startsWith("https://store.test/") && !p.headers?.authorization));
  assert.equal(progress.at(-1), 100);

  // A failed direct PUT is not retried through Ark: the browser has no Ark credential.
  const failing = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(
    uploadToSession(file, { uploadId: "u", fileId: "f", multipart: false, method: "PUT", url: "https://store.test/x", headers: {}, fallbackUrl: "https://ark.test/f", expiresAt: "" }, { fetch: failing }),
  );
});
