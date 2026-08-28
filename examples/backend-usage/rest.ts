/**
 * Backend usage via the Ark REST API.
 */

import { Ark } from "@nerdstackgrp/ark-server";

const ark = new Ark({ token: process.env.ARK_API_TOKEN! });

async function main() {
  const folder = await ark.folders.create({ name: "Product Media" });

  // Multipart is chosen automatically for large files.
  const file = await ark.files.upload("./assets/hero.mp4", {
    folderId: folder.id,
    contentType: "video/mp4",
  });
  console.log("Uploaded:", file.id, file.size);

  const url = await ark.files.getDownloadUrl(file.id, { expiresInSeconds: 600 });
  console.log("Temporary URL:", url);

  const usage = await ark.usage();
  console.log(
    `Storage: ${usage.storage.usedBytes} / ${usage.storage.limitBytes} bytes (${usage.tier})`,
  );

  const { data } = await ark.files.list({ folderId: folder.id });
  console.log(`${data.length} file(s) in ${folder.name}`);
}

void main();
