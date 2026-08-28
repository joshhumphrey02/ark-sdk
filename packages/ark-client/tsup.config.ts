import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // Emit .d.ts for the ESM entry and .d.cts for the CJS entry, so a
  // `require()`-based TypeScript consumer resolves declarations it is
  // actually allowed to import.
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
  outExtension: ({ format }) => ({ js: format === "cjs" ? ".cjs" : ".js" }),
});
