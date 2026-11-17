import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  CartlyApiError,
  ErrorCode,
  assertSecureUrl,
  createCartlyServerClient,
  isRetryable,
} from "../packages/cartly-js/dist/index.js";
import { StorefrontProductsQuery } from "../packages/cartly-js/dist/operations.js";
import { createQueryClient } from "../packages/cartly-js/dist/react.js";

const require = createRequire(import.meta.url);
const API = "https://api.cartly.test";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

/** A fake Cartly API: records every call and answers with `answer(call)`. */
function fakeCartly(answer = () => json({ data: {} })) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const call = { url: String(url), init, body: JSON.parse(init.body) };
    calls.push(call);
    return answer(call);
  };
  return { fetch, calls };
}

test("sends a scoped operation with validated headers and no cookies", async () => {
  const api = fakeCartly(() => json({ data: { storefrontProducts: { items: [] } } }));
  const client = createCartlyServerClient({ apiUrl: API, fetch: api.fetch });

  const data = await client
    .with({ storefrontHost: "Shop.Example.com:443", cartToken: "c".repeat(32) })
    .request(StorefrontProductsQuery, { page: { limit: 5 } });

  assert.deepEqual(data, { storefrontProducts: { items: [] } });
  const [call] = api.calls;
  assert.equal(call.url, `${API}/api/graphql`);
  assert.equal(call.init.credentials, "omit");
  assert.equal(call.init.headers.get("X-Storefront-Host"), "shop.example.com");
  assert.equal(call.init.headers.get("X-Cart-Token"), "c".repeat(32));
  assert.match(call.body.query, /query StorefrontProducts\b/);
  assert.match(call.body.query, /fragment StorefrontProductCardFields\b/);
  assert.deepEqual(call.body.variables, { page: { limit: 5 } });
});

test("turns GraphQL errors into CartlyApiError with the server's code", async () => {
  const api = fakeCartly(() =>
    json({ data: null, errors: [{ message: "No such store.", extensions: { code: "NOT_FOUND", requestId: "req_12345678" } }] }),
  );
  const client = createCartlyServerClient({ apiUrl: API, fetch: api.fetch });

  await assert.rejects(client.request(StorefrontProductsQuery), (error) => {
    assert.ok(error instanceof CartlyApiError);
    assert.equal(error.code, ErrorCode.NOT_FOUND);
    assert.equal(error.requestId, "req_12345678");
    assert.equal(isRetryable(error), false);
    return true;
  });
});

test("refuses a malformed context value without echoing it", async () => {
  const api = fakeCartly();
  const client = createCartlyServerClient({ apiUrl: API, fetch: api.fetch });
  const secret = "short secret";

  await assert.rejects(client.with({ cartToken: secret }).request(StorefrontProductsQuery), (error) => {
    assert.equal(error.code, ErrorCode.INVALID_REQUEST_CONTEXT);
    assert.ok(!error.message.includes(secret));
    return true;
  });
  assert.equal(api.calls.length, 0);
});

test("refuses plain HTTP except to the local machine", () => {
  assert.throws(() => assertSecureUrl("http://api.cartly.test"), /must use https/);
  assert.throws(() => assertSecureUrl("https://user:pass@api.cartly.test"), /credentials/);
  assert.equal(assertSecureUrl("http://localhost:4000").port, "4000");
});

test("the React entry shares error classes with the main entry (ESM and CJS)", async () => {
  const retryable = new CartlyApiError({ code: ErrorCode.NETWORK_ERROR, message: "offline" });
  assert.equal(createQueryClient().getDefaultOptions().queries.retry(0, retryable), true);

  const cjs = require("../packages/cartly-js/dist/index.cjs");
  const cjsReact = require("../packages/cartly-js/dist/react.cjs");
  const cjsError = new cjs.CartlyApiError({ code: cjs.ErrorCode.NETWORK_ERROR, message: "offline" });
  assert.equal(cjsReact.createQueryClient().getDefaultOptions().queries.retry(0, cjsError), true);
});

test("the React entry is marked as a client module", async () => {
  for (const file of ["react.js", "react.cjs"]) {
    const code = await readFile(new URL(`../packages/cartly-js/dist/${file}`, import.meta.url), "utf8");
    assert.ok(code.startsWith('"use client";'), `${file} starts with "use client"`);
  }
});
