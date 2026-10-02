import type { SdkPackage } from "./integrations/types";

/**
 * The Nex SDK packages, in one place. Integrations refer to these; renaming
 * or re-versioning an SDK is a change here only.
 */
export const SDKS = {
  /** Node, Bun and browsers: server (`/server`), browser (`/client`), React (`/react`). */
  javascript: { registry: "npm", name: "@nerdstackgrp/nex-js", version: "^0.3.0" },
  /** Python: `import nex_py`. */
  python: { registry: "pypi", name: "nex-python", version: ">=0.1.0" },
} as const satisfies Record<string, SdkPackage>;

export const JS = SDKS.javascript.name;
