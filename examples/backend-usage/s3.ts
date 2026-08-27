/**
 * Backend usage via the Ark S3-compatible API.
 *
 * Useful when you already have S3-shaped code, or tooling that speaks S3.
 * Ark routes the bytes to the right provider for your plan; your code does not
 * change when that changes.
 */

import { ArkS3 } from "@ark/server";
import { readFile } from "node:fs/promises";

const s3 = new ArkS3({
  endpoint: "https://s3.ark.nerdstackgrp.com",
  accessKeyId: process.env.ARK_ACCESS_KEY_ID!,
  secretAccessKey: process.env.ARK_SECRET_ACCESS_KEY!,
  bucket: "product-media",
});

async function main() {
  await s3.putObject("photos/hero.jpg", new Uint8Array(await readFile("./hero.jpg")), {
    contentType: "image/jpeg",
  });

  const meta = await s3.headObject("photos/hero.jpg");
  console.log("Stored", meta.size, "bytes as", meta.contentType);

  // `delimiter` rolls sub-prefixes up, the way `aws s3 ls` displays folders.
  const { objects, prefixes } = await s3.listObjects({
    prefix: "photos/",
    delimiter: "/",
  });
  console.log(`${objects.length} object(s), ${prefixes.length} prefix(es)`);

  const url = await s3.presignGet("photos/hero.jpg", { expiresInSeconds: 300 });
  console.log("Share URL (5 min):", url);
}

void main();
