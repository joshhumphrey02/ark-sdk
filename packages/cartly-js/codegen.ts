import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * Same settings as @repo/api in cartly-stores, with two differences that keep
 * this public package to its public surface:
 *
 * - Documents are this package's own operations only. The cartly-stores
 *   codegen also scans every app and dashboard package, so its generated
 *   files carry store-specific and back-office operations.
 * - `onlyOperationTypes`: only the inputs and enums those operations use are
 *   generated, not every type in the backend schema.
 *
 * The schema is copied by `npm run sync` and is gitignored: this repository
 * is public and the full schema is not.
 */
const config: CodegenConfig = {
  schema: "schema/schema.graphql",
  documents: ["src/**/*.{ts,tsx}", "!src/gql/**/*", "codegen/*.graphql"],
  ignoreNoDocuments: true,
  generates: {
    "src/gql/": {
      preset: "client",
      presetConfig: {
        gqlTagName: "graphql",
        fragmentMasking: false,
      },
      config: {
        documentMode: "string",
        useTypeImports: true,
        enumsAsTypes: true,
        futureProofEnums: true,
        strictScalars: true,
        onlyOperationTypes: true,
        scalars: {
          DateTime: "string",
          Decimal: "string",
          JSON: "unknown",
        },
      },
    },
  },
};

export default config;
