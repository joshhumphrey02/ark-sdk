import { appendBlock, block, hasBlock } from "../../core/text";
import { SDKS } from "../../sdks";
import { CLIENT, NO_SOURCE_MAPS, SERVER, VITE_ENV, apiUrlOption, browserEnv, browserInit, browserReleases, ensureIgnored, findFile, hasDep, prependOnce, scriptExt, serverEnv } from "../shared";
import type { ProjectContext } from "../../core/project";
import type { Integration, SetupValues } from "../types";

const isKit = (context: ProjectContext) => hasDep(context, "@sveltejs/kit");

function clientHooks(setup: SetupValues, ts: boolean): { init: string; handler: string } {
  return {
    init: `import * as nex from "${CLIENT}";
import { env as nexPublicEnv } from "$env/dynamic/public";${ts ? `\nimport type { HandleClientError } from "@sveltejs/kit";` : ""}

if (nexPublicEnv.PUBLIC_NEX_KEY) {
  nex.init({ key: nexPublicEnv.PUBLIC_NEX_KEY, release: nexPublicEnv.PUBLIC_APP_VERSION${apiUrlOption(setup, "nexPublicEnv.PUBLIC_NEX_API_URL")} });
}`,
    handler: `export const handleError${ts ? ": HandleClientError" : ""} = ({ error }) => {
  nex.captureException(error);
};`,
  };
}

function serverHooks(ts: boolean): { init: string; handler: string } {
  return {
    init: `import * as nexServer from "${SERVER}";
import { env as nexEnv } from "$env/dynamic/private";${ts ? `\nimport type { HandleServerError } from "@sveltejs/kit";` : ""}

try {
  nexServer.init({ apiUrl: nexEnv.NEX_API_URL, token: nexEnv.NEX_TOKEN, service: nexEnv.NEX_SERVICE ?? "web", environment: nexEnv.NEX_ENVIRONMENT });
} catch (error) {
  // Misconfigured monitoring must never stop the app from starting.
  console.warn("[nex] not started:", ${ts ? "(error as Error)" : "error"}.message);
}`,
    handler: `export const handleError${ts ? ": HandleServerError" : ""} = ({ error }) => {
  nexServer.captureException(error);
};`,
  };
}

/** One hooks file: the init block at the top, handleError at the end (unless the app has its own). */
function addHooks(context: ProjectContext, path: string, hooks: { init: string; handler: string }, manual: string[], call: string): void {
  const content = context.files.read(path);
  if (content === null) {
    context.files.write(path, `${block("init", hooks.init, "slash")}\n\n${block("handle-error", hooks.handler, "slash")}\n`);
    return;
  }
  if (hasBlock(content)) return;
  prependOnce(context, path, "init", hooks.init);
  if (/\bhandleError\b/.test(content)) manual.push(`${path} has its own handleError: call ${call}(error) in it.`);
  else context.files.write(path, appendBlock(context.files.read(path)!, block("handle-error", hooks.handler, "slash")));
}

export const svelte: Integration = {
  id: "svelte",
  name: "Svelte",
  ecosystem: "javascript",
  status: "available",
  sdk: SDKS.javascript,
  compatibility: [{ dependency: "@sveltejs/kit", label: "SvelteKit", min: "2.0.0" }],

  detect(context) {
    const config = context.files.first("svelte.config.js", "svelte.config.mjs", "svelte.config.ts");
    if (!hasDep(context, "svelte") && !config) return null;
    return { confidence: 80, signals: [...(config ? [config] : []), ...(isKit(context) ? ["SvelteKit"] : ["svelte dependency"])] };
  },

  needs: (context) => ({ server: isKit(context), browser: true }),

  configure(context, setup) {
    const manual: string[] = [];
    const ts = context.typescript;
    if (isKit(context)) {
      const ext = scriptExt(context);
      addHooks(context, findFile(context, ["src/hooks.client"], ["ts", "js"]) ?? `src/hooks.client.${ext}`, clientHooks(setup, ts), manual, "nex.captureException");
      addHooks(context, findFile(context, ["src/hooks.server"], ["ts", "js"]) ?? `src/hooks.server.${ext}`, serverHooks(ts), manual, "nexServer.captureException");
      ensureIgnored(context, ".env.local");
      const env = {
        ...serverEnv(setup),
        ...(setup.browserKey ? { PUBLIC_NEX_KEY: setup.browserKey } : {}),
        ...(setup.browserKey && !setup.defaultApiUrl ? { PUBLIC_NEX_API_URL: setup.apiUrl } : {}),
      };
      return { envFile: ".env.local", env, manual, sourceMaps: NO_SOURCE_MAPS, releases: "Releases: the server reads your CI's commit (GITHUB_SHA, …) or APP_VERSION; set PUBLIC_APP_VERSION for browser errors." };
    }
    const entry = findFile(context, ["src/main"], ["ts", "js"]);
    if (!entry || !prependOnce(context, entry, "init", browserInit(setup, VITE_ENV))) manual.push(`Couldn't find src/main.ts or src/main.js. Start Nex at the top of your entry file:\n${browserInit(setup, VITE_ENV)}`);
    ensureIgnored(context, VITE_ENV.file);
    return { envFile: VITE_ENV.file, env: browserEnv(setup, VITE_ENV), manual, sourceMaps: NO_SOURCE_MAPS, releases: browserReleases(VITE_ENV) };
  },

  instrumentationFiles(context) {
    const files = isKit(context) ? [findFile(context, ["src/hooks.client"], ["ts", "js"]), findFile(context, ["src/hooks.server"], ["ts", "js"])] : [findFile(context, ["src/main"], ["ts", "js"])];
    return files.filter((p): p is string => p !== null);
  },
};
