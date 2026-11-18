import type { CodegenConfig } from "@graphql-codegen/cli";

/**
 * Same settings as @repo/api in cartly-stores, with two differences that keep
 * this public package to its public surface:
 *
 * - The schema is the API's SDK schema (copied by `npm run sync`): every
 *   merchant, account and shopper type, never platform-staff ones.
 * - Documents are this package's own operations only. The cartly-stores
 *   codegen also scans every app and dashboard package, so its generated
 *   files carry store-specific operations.
 */
const config: CodegenConfig = {
  schema: "schema.graphql",
  // The anchors make codegen emit input types the SDK exports but none of
  // its operations take. Apps writing their own operations generate their
  // types from schema.graphql, which this package ships.
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
