import { defineConfig } from "tsup";

export default defineConfig({
  // One entry per import path. The browser entries never import node:*,
  // so bundlers can ship them as they are.
  entry: {
    index: "src/index.ts",
    server: "src/server/index.ts",
    client: "src/client/index.ts",
    react: "src/react/index.ts",
  },
  format: ["esm", "cjs"],
  // Emit .d.ts for the ESM entry and .d.cts for the CJS entry, so a
  // `require()`-based TypeScript consumer resolves declarations it is
  // actually allowed to import.
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
  external: ["react"],
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
});
