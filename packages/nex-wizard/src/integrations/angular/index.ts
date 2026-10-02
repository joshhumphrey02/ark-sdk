import { SDKS } from "../../sdks";
import { hasBlock } from "../../core/text";
import { CLIENT, NO_SOURCE_MAPS, hasDep, insertIntoArray, prependOnce, writeBlockFile } from "../shared";
import type { Integration, SetupValues } from "../types";

function nexFile(setup: SetupValues): string {
  // A browser key is public by design (it can only send error events), so
  // Angular, which has no build-time env vars, keeps it in source.
  const init = setup.browserKey
    ? `nex.init({ key: "${setup.browserKey}"${setup.defaultApiUrl ? "" : `, apiUrl: "${setup.apiUrl}"`} });`
    : `// Set your browser key (nex_pub_…), then: nex.init({ key: "nex_pub_…" });`;
  return `import { ErrorHandler, Injectable } from "@angular/core";
import * as nex from "${CLIENT}";

${init}

/** Angular catches errors itself; this hands them to Nex as well as the console. */
@Injectable()
export class NexErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    nex.captureException(error);
    console.error(error);
  }
}`;
}

const PROVIDER = "{ provide: NexAngularErrorHandler, useClass: NexErrorHandler },";

export const angular: Integration = {
  id: "angular",
  name: "Angular",
  ecosystem: "javascript",
  status: "available",
  sdk: SDKS.javascript,
  compatibility: [{ dependency: "@angular/core", label: "Angular", min: "15.0.0" }],

  detect(context) {
    if (!hasDep(context, "@angular/core")) return null;
    return { confidence: 85, signals: ["@angular/core dependency", ...(context.files.exists("angular.json") ? ["angular.json"] : [])] };
  },

  needs: () => ({ server: false, browser: true }),

  configure(context, setup) {
    const manual: string[] = [];
    writeBlockFile(context, "src/nex.ts", "init", nexFile(setup));
    const config = context.files.first("src/app/app.config.ts", "src/app/app.module.ts");
    const content = config ? context.files.read(config)! : null;
    if (!config || !content) {
      manual.push(`Couldn't find src/app/app.config.ts or app.module.ts. Add to your providers:\n  { provide: ErrorHandler, useClass: NexErrorHandler }  (NexErrorHandler from "src/nex")`);
    } else if (!hasBlock(content, "provider")) {
      const updated = insertIntoArray(content, /providers\s*:\s*\[/, "provider", PROVIDER);
      if (!updated) manual.push(`${config} has no providers array. Add:\n  providers: [{ provide: ErrorHandler, useClass: NexErrorHandler }]`);
      else {
        context.files.write(config, updated);
        prependOnce(context, config, "imports", `import { ErrorHandler as NexAngularErrorHandler } from "@angular/core";\nimport { NexErrorHandler } from "../nex";`);
      }
    }
    if (!setup.browserKey) manual.push("No browser key was available: set it in src/nex.ts.");
    return {
      envFile: null,
      env: {},
      manual,
      sourceMaps: NO_SOURCE_MAPS,
      releases: "Releases: pass release to nex.init in src/nex.ts (e.g. your app version) to tag browser errors.",
    };
  },

  instrumentationFiles: (context) => ["src/nex.ts", context.files.first("src/app/app.config.ts", "src/app/app.module.ts")].filter((p): p is string => p !== null && context.files.exists(p)),
};
