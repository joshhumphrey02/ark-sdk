import type { ProjectContext } from "../../core/project";
import { block, hasBlock, insertAfterLine, statementEndLine, insertAt } from "../../core/text";
import { SDKS } from "../../sdks";
import { NO_SOURCE_MAPS, SERVER, ensureIgnored, hasDep, prependOnce, releasesFromCi, serverEnv } from "../shared";
import type { Integration } from "../types";

const SERVER_FRAMEWORKS: [string, string][] = [
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["koa", "Koa"],
  ["hono", "Hono"],
  ["@nestjs/core", "NestJS"],
  ["@hapi/hapi", "hapi"],
  ["elysia", "Elysia"],
];

const FRONTEND = ["react", "vue", "svelte", "solid-js", "@angular/core", "astro", "next"];

const COMMON_ENTRIES = ["src/main.ts", "src/index.ts", "src/server.ts", "src/app.ts", "index.ts", "server.ts", "src/index.js", "src/server.js", "index.js", "server.js", "app.js", "src/main.js", "index.mjs", "server.mjs"];

/** The file the app starts from: package.json "main", the start/dev script, or a usual name. */
export function findEntry(context: ProjectContext): string | null {
  const pkg = context.packageJson;
  const candidates: string[] = [];
  for (const script of [pkg?.scripts?.start, pkg?.scripts?.dev]) {
    const match = script && /(?:^|\s)(?:node|tsx|ts-node|ts-node-dev|nodemon|bun(?: run)?|node --watch)\s+(?:--?[\w-]+(?:=\S+)?\s+)*([\w./-]+\.(?:[cm]?[jt]s))/.exec(script);
    if (match) candidates.push(match[1]!.replace(/^\.\//, ""));
  }
  if (pkg?.main) candidates.push(pkg.main.replace(/^\.\//, ""));
  for (const candidate of candidates) {
    if (context.files.exists(candidate)) return candidate;
    // "main" often names the build output (dist/index.js); prefer its source.
    const source = candidate.replace(/^(dist|build|lib)\//, "src/").replace(/\.js$/, ".ts");
    if (context.files.exists(source)) return source;
  }
  return context.files.first(...COMMON_ENTRIES);
}

function isEsm(context: ProjectContext, entry: string): boolean {
  return /\.(ts|mts|mjs)$/.test(entry) || (context.packageJson?.type === "module" && !entry.endsWith(".cjs"));
}

function initBlock(esm: boolean, ts: boolean, service: string): string {
  const load = esm ? `import * as nex from "${SERVER}";` : `const nex = require("${SERVER}");`;
  return `${load}

const nexClient = (() => {
  try {
    return nex.init({ service: process.env.NEX_SERVICE ?? "${service}" });
  } catch (error) {
    // Misconfigured monitoring must never stop the app from starting.
    console.warn("[nex] not started:", ${ts ? "(error as Error)" : "error"}.message);
    return null;
  }
})();`;
}

/** Express: trace requests right after the app is created; report errors after the routes. */
function wireExpress(content: string, manual: string[], entry: string): string {
  if (hasBlock(content, "express-requests")) return content;
  const app = /^(?:const|let|var)\s+(\w+)\s*=\s*express\(\s*\)/m.exec(content);
  if (!app) {
    manual.push(`Couldn't find your Express app in ${entry}. Add, after creating it:\n  app.use(nexClient.httpMiddleware());\nand after your routes:\n  app.use(nexClient.errorHandler());`);
    return content;
  }
  const name = app[1]!;
  const created = statementEndLine(content, app.index)!;
  let next = insertAfterLine(content, created, block("express-requests", `if (nexClient) ${name}.use(nexClient.httpMiddleware());`, "slash"));
  const listen = new RegExp(`^\\s*${name}\\.listen\\(`, "m").exec(next);
  if (listen) {
    const line = next.slice(0, listen.index).split("\n").length - 1;
    next = insertAt(next, line, block("express-errors", `if (nexClient) ${name}.use(nexClient.errorHandler());`, "slash"));
  } else {
    manual.push(`Report Express errors: after your routes, add\n  if (nexClient) ${name}.use(nexClient.errorHandler());`);
  }
  return next;
}

export const nodejs: Integration = {
  id: "nodejs",
  name: "Node.js",
  ecosystem: "javascript",
  status: "available",
  sdk: SDKS.javascript,
  compatibility: [],

  detect(context) {
    if (!context.packageJson) return null;
    const framework = SERVER_FRAMEWORKS.find(([dep]) => hasDep(context, dep));
    if (framework) return { confidence: 60, signals: [`${framework[1]} dependency`] };
    if (FRONTEND.some((dep) => hasDep(context, dep))) return null;
    const entry = findEntry(context);
    return entry ? { confidence: 25, signals: [`entry ${entry}`] } : null;
  },

  needs: () => ({ server: true, browser: false }),

  configure(context, setup) {
    const manual: string[] = [];
    const entry = findEntry(context);
    if (!entry) {
      manual.push(`Couldn't find your app's entry file. Start Nex at the very top of it:\n${initBlock(true, context.typescript, setup.service)}`);
    } else {
      prependOnce(context, entry, "init", initBlock(isEsm(context, entry), entry.endsWith("ts"), setup.service));
      if (hasDep(context, "express")) context.files.write(entry, wireExpress(context.files.read(entry)!, manual, entry));
      else {
        const framework = SERVER_FRAMEWORKS.find(([dep]) => hasDep(context, dep));
        if (framework) manual.push(`Errors and crashes are reported. To trace ${framework[1]} requests too, see the Nex SDK guide ("Servers").`);
      }
    }
    if (!hasDep(context, "dotenv", "@nestjs/config")) manual.push(`Node doesn't read .env by itself: start with \`node --env-file=.env\`, or set the NEX_* variables in your deployment.`);
    ensureIgnored(context, ".env");
    return { envFile: ".env", env: serverEnv(setup), manual, sourceMaps: NO_SOURCE_MAPS, releases: releasesFromCi("by the SDK at startup") };
  },

  instrumentationFiles: (context) => [findEntry(context)].filter((p): p is string => p !== null),
};
