/**
 * Copies the Cartly SDK's runtime and operations from @repo/api in
 * cartly-stores, which stays the source of truth, and renames `@repo/api` to
 * this package's name in what it copies.
 *
 *   npm run sync                 # ../../../cartly-stores next to this repo
 *   CARTLY_STORES_PATH=/path/to/cartly-stores npm run sync
 *   npm run sync:check           # exit 1 if src/ differs from cartly-stores
 *
 * Then `npm run codegen` and commit src/ and schema.graphql (src/gql is
 * regenerated here from the SDK schema and this package's operations, never
 * copied: cartly-stores' generated files carry its apps' operations too). Change the SDK in cartly-stores,
 * not here: the next sync overwrites every synced path.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@nerdstackgrp/cartly";

/** Paths under packages/api/ in cartly-stores, mirrored under this package. */
const SYNCED = [
  "src/index.ts",
  "src/cartly.ts",
  "src/context.ts",
  "src/errors.ts",
  "src/storefront-content.ts",
  "src/pkce.ts",
  "src/realtime",
  "src/graphql",
  "src/rest",
  "src/session",
  "src/react",
  "src/operations",
];

/**
 * The SDK schema (the API's every merchant, account and shopper operation,
 * never platform-staff ones). Public: it is committed and shipped as
 * `@nerdstackgrp/cartly/schema.graphql` for apps generating their own types.
 */
const SCHEMA_SOURCE = "schema/sdk-schema.graphql";
const SCHEMA = "schema.graphql";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(here, "..");
const stores = path.resolve(
  process.env.CARTLY_STORES_PATH ?? path.resolve(target, "../../../cartly-stores"),
);
const source = path.join(stores, "packages/api");
const check = process.argv.includes("--check");

if (!existsSync(path.join(source, "package.json"))) {
  console.error(`@repo/api not found at ${source}. Set CARTLY_STORES_PATH.`);
  process.exit(1);
}

/** Every file under a synced path, relative to its package root. */
async function files(root, relative) {
  const full = path.join(root, relative);
  if (!existsSync(full)) return [];
  if (!(await stat(full)).isDirectory()) return [relative];
  const out = [];
  for (const entry of await readdir(full, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) out.push(...(await files(root, child)));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(child);
  }
  return out;
}

function rewrite(text) {
  return text.replaceAll("@repo/api", PACKAGE_NAME);
}

const wanted = new Map();
for (const relative of SYNCED) {
  for (const file of await files(source, relative)) {
    wanted.set(file, rewrite(await readFile(path.join(source, file), "utf8")));
  }
}

if (check) {
  const drift = [];
  for (const [file, text] of wanted) {
    const local = path.join(target, file);
    if (!existsSync(local) || (await readFile(local, "utf8")) !== text) drift.push(file);
  }
  for (const relative of SYNCED) {
    for (const file of await files(target, relative)) {
      if (!wanted.has(file)) drift.push(`${file} (removed upstream)`);
    }
  }
  if (drift.length) {
    console.error(`Out of sync with ${source}:\n  ${drift.join("\n  ")}\nRun npm run sync.`);
    process.exit(1);
  }
  console.log(`In sync with ${source}.`);
  process.exit(0);
}

// Clear each synced path first so files deleted upstream go here too.
for (const relative of SYNCED) {
  await rm(path.join(target, relative), { recursive: true, force: true });
}
for (const [file, text] of wanted) {
  const local = path.join(target, file);
  await mkdir(path.dirname(local), { recursive: true });
  await writeFile(local, text);
}
console.log(`Synced ${wanted.size} files from ${source}.`);

await copyFile(path.join(source, SCHEMA_SOURCE), path.join(target, SCHEMA));
console.log(`Copied ${SCHEMA}. Now run npm run codegen.`);
