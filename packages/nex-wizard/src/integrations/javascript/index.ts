import { SDKS } from "../../sdks";
import { NO_SOURCE_MAPS, VITE_ENV, browserEnv, browserInit, browserReleases, ensureIgnored, findFile, hasDep, prependOnce } from "../shared";
import type { Integration } from "../types";

const ENTRIES = ["src/main", "main", "src/index"];

/** A browser app without a framework, built with Vite. */
export const javascript: Integration = {
  id: "javascript",
  name: "JavaScript",
  ecosystem: "javascript",
  status: "available",
  sdk: SDKS.javascript,
  compatibility: [],

  detect(context) {
    if (!context.packageJson) return null;
    if (hasDep(context, "vite")) return { confidence: 30, signals: ["Vite", "no framework"] };
    return context.files.exists("index.html") ? { confidence: 15, signals: ["index.html"] } : null;
  },

  needs: () => ({ server: false, browser: true }),

  configure(context, setup) {
    const manual: string[] = [];
    const entry = findFile(context, ENTRIES, ["ts", "js", "mjs"]);
    if (!hasDep(context, "vite")) manual.push(`Nex's browser SDK is an npm package: load it through your bundler. With Vite, import it at the top of your entry file:\n${browserInit(setup, VITE_ENV)}`);
    else if (!entry || !prependOnce(context, entry, "init", browserInit(setup, VITE_ENV))) manual.push(`Couldn't find your entry file (src/main, main or src/index). Start Nex at the top of it:\n${browserInit(setup, VITE_ENV)}`);
    ensureIgnored(context, VITE_ENV.file);
    return { envFile: VITE_ENV.file, env: browserEnv(setup, VITE_ENV), manual, sourceMaps: NO_SOURCE_MAPS, releases: browserReleases(VITE_ENV) };
  },

  instrumentationFiles: (context) => [findFile(context, ENTRIES, ["ts", "js", "mjs"])].filter((p): p is string => p !== null),
};
