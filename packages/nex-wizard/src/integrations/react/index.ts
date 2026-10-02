import { WizardError } from "../../core/errors";
import { SDKS } from "../../sdks";
import { CRA_ENV, NO_SOURCE_MAPS, REACT, VITE_ENV, browserEnv, browserInit, browserReleases, ensureIgnored, findFile, hasDep, prependOnce, unsupportedMetaFramework } from "../shared";
import type { Integration } from "../types";

const ENTRIES = ["src/main", "src/index"];

export const react: Integration = {
  id: "react",
  name: "React",
  ecosystem: "javascript",
  status: "available",
  sdk: SDKS.javascript,
  compatibility: [{ dependency: "react", label: "React", min: "17.0.0" }],

  detect(context) {
    if (!hasDep(context, "react") || hasDep(context, "next", "react-native")) return null;
    const signals = ["react dependency"];
    if (hasDep(context, "vite")) signals.push("Vite");
    if (hasDep(context, "react-scripts")) signals.push("Create React App");
    return { confidence: 70, signals };
  },

  needs: () => ({ server: false, browser: true }),

  configure(context, setup) {
    const meta = unsupportedMetaFramework(context);
    if (meta) throw new WizardError(`${meta} isn't supported by the Nex wizard yet.`, "See the Nex SDK guide to set up @nerdstackgrp/nex-js by hand.");
    const env = hasDep(context, "react-scripts") ? CRA_ENV : VITE_ENV;
    const entry = findFile(context, ENTRIES);
    const manual: string[] = [];
    if (!entry || !prependOnce(context, entry, "init", browserInit(setup, env))) {
      manual.push(`Couldn't find your app's entry file (src/main or src/index). Start Nex at the top of it:\n${browserInit(setup, env)}`);
    }
    manual.push(`Optional: wrap parts of your UI in <ErrorBoundary> from "${REACT}" to report errors React catches.`);
    ensureIgnored(context, env.file);
    return { envFile: env.file, env: browserEnv(setup, env), manual, sourceMaps: NO_SOURCE_MAPS, releases: browserReleases(env) };
  },

  instrumentationFiles: (context) => [findFile(context, ENTRIES)].filter((p): p is string => p !== null),
};
