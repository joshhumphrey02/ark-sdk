import { block, hasBlock } from "../../core/text";
import { SDKS } from "../../sdks";
import { ASTRO_ENV, NO_SOURCE_MAPS, browserEnv, browserInit, browserReleases, ensureIgnored, hasDep, insertIntoArray, prependOnce, scriptExt, writeBlockFile } from "../shared";
import type { ProjectContext } from "../../core/project";
import type { Integration } from "../types";

const configFile = (context: ProjectContext) => context.files.first("astro.config.mjs", "astro.config.ts", "astro.config.js", "astro.config.mts");

/** A local Astro integration that loads the Nex browser script on every page. */
function integration(clientPath: string, ts: boolean): string {
  return `${ts ? `import type { AstroIntegration } from "astro";\n\n` : ""}const nexIntegration${ts ? ": AstroIntegration" : ""} = {
  name: "nex",
  hooks: {
    "astro:config:setup": ({ injectScript }) => {
      injectScript("page", 'import "/${clientPath}";');
    },
  },
};`;
}

export const astro: Integration = {
  id: "astro",
  name: "Astro",
  ecosystem: "javascript",
  status: "available",
  sdk: SDKS.javascript,
  compatibility: [{ dependency: "astro", label: "Astro", min: "4.0.0" }],

  detect(context) {
    const config = configFile(context);
    if (!hasDep(context, "astro") && !config) return null;
    return { confidence: 85, signals: [config ?? "astro dependency"] };
  },

  needs: () => ({ server: false, browser: true }),

  configure(context, setup) {
    const manual: string[] = [];
    const clientPath = `src/nex.client.${scriptExt(context)}`;
    writeBlockFile(context, clientPath, "init", browserInit(setup, ASTRO_ENV));
    const config = configFile(context);
    const content = config ? context.files.read(config) : null;
    if (!config || content === null) {
      manual.push(`Couldn't find astro.config. Load ${clientPath} on every page, e.g. <script>import "../nex.client";</script> in your layout.`);
    } else if (!hasBlock(content, "integration-entry")) {
      const ts = config.endsWith("ts");
      const updated = insertIntoArray(content, /integrations\s*:\s*\[/, "integration-entry", "nexIntegration,") ?? insertIntoArray(content, /defineConfig\(\s*\{/, "integration-entry", "integrations: [nexIntegration],");
      if (!updated) manual.push(`Couldn't place the Nex integration in ${config}. Load ${clientPath} on every page from your layout.`);
      else {
        context.files.write(config, updated);
        prependOnce(context, config, "integration", integration(clientPath, ts));
      }
    }
    ensureIgnored(context, ASTRO_ENV.file);
    return {
      envFile: ASTRO_ENV.file,
      env: browserEnv(setup, ASTRO_ENV),
      manual: [...manual, "Server-rendered errors (SSR) aren't set up by the wizard yet: browser errors are reported."],
      sourceMaps: NO_SOURCE_MAPS,
      releases: browserReleases(ASTRO_ENV),
    };
  },

  instrumentationFiles: (context) => [context.files.first("src/nex.client.ts", "src/nex.client.js"), configFile(context)].filter((p): p is string => p !== null),
};
