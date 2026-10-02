import { SDKS } from "../../sdks";
import { NO_SOURCE_MAPS, VITE_ENV, browserEnv, browserInit, browserReleases, ensureIgnored, findFile, hasDep, prependOnce } from "../shared";
import type { ProjectContext } from "../../core/project";
import type { Integration } from "../types";

const entries = (context: ProjectContext) => (hasDep(context, "@solidjs/start") ? ["src/entry-client"] : ["src/index", "src/main"]);

export const solid: Integration = {
  id: "solid",
  name: "Solid",
  ecosystem: "javascript",
  status: "available",
  sdk: SDKS.javascript,
  compatibility: [{ dependency: "solid-js", label: "Solid", min: "1.6.0" }],

  detect(context) {
    if (!hasDep(context, "solid-js")) return null;
    return { confidence: 80, signals: ["solid-js dependency", ...(hasDep(context, "@solidjs/start") ? ["SolidStart"] : [])] };
  },

  needs: () => ({ server: false, browser: true }),

  configure(context, setup) {
    const manual: string[] = [];
    const entry = findFile(context, entries(context));
    if (!entry || !prependOnce(context, entry, "init", browserInit(setup, VITE_ENV))) manual.push(`Couldn't find your entry file (${entries(context).join(", ")}). Start Nex at the top of it:\n${browserInit(setup, VITE_ENV)}`);
    if (hasDep(context, "@solidjs/start")) manual.push("SolidStart's server isn't set up by the wizard yet: browser errors are reported, server errors are not.");
    ensureIgnored(context, VITE_ENV.file);
    return { envFile: VITE_ENV.file, env: browserEnv(setup, VITE_ENV), manual, sourceMaps: NO_SOURCE_MAPS, releases: browserReleases(VITE_ENV) };
  },

  instrumentationFiles: (context) => [findFile(context, entries(context))].filter((p): p is string => p !== null),
};
