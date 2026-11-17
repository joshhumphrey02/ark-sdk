import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import { defineConfig } from "tsup";

/**
 * esbuild drops module directives when it bundles, so `"use client"` is put
 * back at the top of the React entry: a Next.js server component can then
 * render <CartlyProvider> directly. The source map is shifted by the one
 * line added.
 */
async function markReactEntryAsClient() {
  for (const file of ["dist/react.js", "dist/react.cjs"]) {
    if (!existsSync(file)) continue;
    const code = await readFile(file, "utf8");
    if (code.startsWith('"use client"')) continue;
    await writeFile(file, `"use client";\n${code}`);
    const mapFile = `${file}.map`;
    if (existsSync(mapFile)) {
      const map = JSON.parse(await readFile(mapFile, "utf8"));
      map.mappings = `;${map.mappings}`;
      await writeFile(mapFile, JSON.stringify(map));
    }
  }
}

export default defineConfig({
  // One entry per import path, matching package.json "exports".
  entry: {
    index: "src/index.ts",
    graphql: "src/gql/index.ts",
    "graphql-types": "src/gql/graphql.ts",
    operations: "src/operations/index.ts",
    react: "src/react/index.ts",
    "storefront-content": "src/storefront-content.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Shared chunks for CJS too, not only ESM: each entry would otherwise carry
  // its own copy of CartlyApiError and `instanceof` would fail across them
  // (isRetryable in /react on an error thrown by the client from ".").
  splitting: true,
  target: "es2022",
  external: ["react", "@tanstack/react-query"],
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
  onSuccess: markReactEntryAsClient,
});
