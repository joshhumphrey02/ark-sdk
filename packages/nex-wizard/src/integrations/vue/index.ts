import { WizardError } from "../../core/errors";
import { block, hasBlock, insertAfterLine, statementEndLine } from "../../core/text";
import { SDKS } from "../../sdks";
import { NO_SOURCE_MAPS, VITE_ENV, VUE_CLI_ENV, browserEnv, browserInit, browserReleases, ensureIgnored, findFile, hasDep, prependOnce, unsupportedMetaFramework } from "../shared";
import type { Integration } from "../types";

const ENTRIES = ["src/main"];

export const vue: Integration = {
  id: "vue",
  name: "Vue",
  ecosystem: "javascript",
  status: "available",
  sdk: SDKS.javascript,
  compatibility: [{ dependency: "vue", label: "Vue", min: "3.0.0" }],

  detect(context) {
    if (!hasDep(context, "vue")) return null;
    return { confidence: 75, signals: ["vue dependency", ...(hasDep(context, "vite") ? ["Vite"] : [])] };
  },

  needs: () => ({ server: false, browser: true }),

  configure(context, setup) {
    const meta = unsupportedMetaFramework(context);
    if (meta) throw new WizardError(`${meta} isn't supported by the Nex wizard yet.`, "See the Nex SDK guide to set up @nerdstackgrp/nex-js by hand.");
    const env = hasDep(context, "@vue/cli-service") ? VUE_CLI_ENV : VITE_ENV;
    const entry = findFile(context, ENTRIES, ["ts", "js"]);
    const manual: string[] = [];
    if (!entry || !prependOnce(context, entry, "init", browserInit(setup, env))) {
      manual.push(`Couldn't find src/main.ts or src/main.js. Start Nex at the top of your entry file:\n${browserInit(setup, env)}`);
    } else {
      // Vue catches component errors itself; its errorHandler is where Nex sees them.
      const content = context.files.read(entry)!;
      const app = /^(?:const|let|var)\s+(\w+)\s*=\s*createApp\(/m.exec(content);
      if (hasBlock(content, "error-handler")) {
        // Already there.
      } else if (/config\.errorHandler/.test(content)) {
        manual.push(`Your app sets app.config.errorHandler already: call nex.captureException(error) in it (nex from "@nerdstackgrp/nex-js/client").`);
      } else if (app) {
        const end = statementEndLine(content, app.index);
        if (end === null) manual.push("Couldn't place Vue's error handler. Add after createApp(): app.config.errorHandler = (error) => nex.captureException(error);");
        else context.files.write(entry, insertAfterLine(content, end, block("error-handler", `${app[1]}.config.errorHandler = (error) => {\n  nex.captureException(error);\n  console.error(error);\n};`, "slash")));
      } else {
        manual.push(`Report component errors: assign createApp(...) to a variable, then add\n  app.config.errorHandler = (error) => { nex.captureException(error); console.error(error); };`);
      }
    }
    ensureIgnored(context, env.file);
    return { envFile: env.file, env: browserEnv(setup, env), manual, sourceMaps: NO_SOURCE_MAPS, releases: browserReleases(env) };
  },

  instrumentationFiles: (context) => [findFile(context, ENTRIES, ["ts", "js"])].filter((p): p is string => p !== null),
};
