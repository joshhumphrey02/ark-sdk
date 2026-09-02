import assert from "node:assert/strict";
import test from "node:test";

import { ArkS3 } from "../packages/ark-server/dist/index.js";

/**
 * Storage runs on third-party infrastructure whose error bodies name the
 * vendor and its internals. Those bodies used to be surfaced verbatim, so a
 * failed upload showed an application's end user the name of a service they
 * have no relationship with. These tests pin that the vendor's prose is
 * replaced by Ark's own, while the classification it carried is kept.
 */

function s3Xml(code, message, status) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code>` +
      `<Message>${message}</Message><RequestId>abc123</RequestId></Error>`,
    { status, headers: { "content-type": "application/xml" } },
  );
}

function s3(fetchImpl) {
  return new ArkS3({
    accessKeyId: "ark_test",
    secretAccessKey: "secret",
    bucket: "bucket",
    endpoint: "https://ark.example.com",
    fetch: fetchImpl,
  });
}

test("a provider's error prose never reaches the caller", async () => {
  const client = s3(async () =>
    s3Xml(
      "InternalError",
      "The Cloudflare R2 origin returned an incomplete response from the Bunny edge.",
      500,
    ),
  );

  const error = await client.getObject("k").then(
    () => null,
    (caught) => caught,
  );

  assert.ok(error, "expected the request to reject");
  for (const vendor of ["cloudflare", "r2", "bunny"]) {
    assert.ok(
      !error.message.toLowerCase().includes(vendor),
      `message leaked "${vendor}": ${error.message}`,
    );
  }
});

test("scrubbing keeps the classification the provider reported", async () => {
  const client = s3(async () => s3Xml("NoSuchKey", "The specified key does not exist.", 404));

  const error = await client.getObject("missing").then(
    () => null,
    (caught) => caught,
  );

  assert.equal(error.code, "NO_SUCH_KEY");
  assert.equal(error.status, 404);
  // The request id is operator-facing plumbing, not vendor prose, so it stays.
  assert.equal(error.requestId, "abc123");
});

test("an unparseable body still yields an Ark-worded error", async () => {
  const client = s3(async () => new Response("<html>502 Bad Gateway</html>", { status: 502 }));

  const error = await client.getObject("k").then(
    () => null,
    (caught) => caught,
  );

  assert.equal(error.code, "INTERNAL_ERROR");
  assert.ok(error.message.length > 0);
  assert.ok(!/html|gateway/i.test(error.message));
});
