import type { ProjectContext } from "../core/project";

/** Stable ids: used on the command line, in the manifest and in docs. Never display names. */
export const INTEGRATION_IDS = [
  "nextjs",
  "react",
  "vue",
  "angular",
  "svelte",
  "solid",
  "astro",
  "javascript",
  "nodejs",
  "python",
  "react-native",
  "flutter",
  "go",
  "swift",
  "ruby",
  "php",
  "laravel",
  "spring-boot",
] as const;

export type IntegrationId = (typeof INTEGRATION_IDS)[number];

export type Detection = {
  /** 0–100; the highest wins, a tie is asked about. */
  confidence: number;
  /** What was found, shown to the developer ("next dependency", "App Router"). */
  signals: string[];
};

/** A framework version Nex's integration has been checked against. */
export type CompatibilityRule = {
  /** The dependency whose version decides (npm package name). */
  dependency: string;
  label: string;
  min?: string;
  max?: string;
};

/** What the selected Nex project gives this app. Secrets are never printed. */
export type SetupValues = {
  apiUrl: string;
  /** The API URL is the public default, so generated code needn't name it. */
  defaultApiUrl: boolean;
  /** SDK token for server code (secret), when the integration needs one. */
  serverToken: string | null;
  /** Browser key for web code (public), when the integration needs one. */
  browserKey: string | null;
  /** Service the server side reports as. */
  service: string;
  /** Service the browser side reports as. */
  browserService: string;
  /** Environment slug, e.g. "production". */
  environment: string | null;
};

export type ConfigureResult = {
  /** Where env vars go (relative), or null when the integration needs none. */
  envFile: string | null;
  /** Variables to set there. Secret values are never printed. */
  env: Record<string, string>;
  /** Steps the wizard couldn't do safely, for the developer to finish. */
  manual: string[];
  /** One line each on how source maps and releases are handled. */
  sourceMaps: string;
  releases: string;
};

export type SdkPackage = { registry: "npm" | "pypi"; name: string; version: string };

export type Integration = {
  id: IntegrationId;
  name: string;
  ecosystem: "javascript" | "python" | "dart" | "go" | "swift" | "ruby" | "php" | "java";
  /** "planned": detected and explained, but no Nex SDK exists for it yet. */
  status: "available" | "planned";
  /** The SDK it installs. Package names live in ../sdks.ts only. */
  sdk: SdkPackage | null;
  compatibility: CompatibilityRule[];
  detect(context: ProjectContext): Detection | null;
  /** Which credentials it needs: an SDK token (server), a browser key, or both. */
  needs(context: ProjectContext): { server: boolean; browser: boolean };
  /** Stages its file edits in `context.files` (nothing is written until applied). */
  configure(context: ProjectContext, setup: SetupValues): ConfigureResult;
  /** Files whose Nex blocks show it is set up (for doctor and idempotency). */
  instrumentationFiles(context: ProjectContext): string[];
};
