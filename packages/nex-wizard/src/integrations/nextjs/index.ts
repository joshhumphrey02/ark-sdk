import type { ProjectContext } from "../../core/project";
import { compare } from "../../core/semver";
import { block, hasBlock, insertAfterLine, appendBlock } from "../../core/text";
import { SDKS } from "../../sdks";
import { CLIENT, NO_SOURCE_MAPS, SERVER, depVersion, ensureIgnored, hasDep, scriptExt, serverEnv, writeBlockFile } from "../shared";
import type { ConfigureResult, Integration, SetupValues } from "../types";

/** Where Next.js looks for instrumentation files: next to app/ (or pages/), inside src/ when that is used. */
export function layout(context: ProjectContext) {
  const f = context.files;
  const src = !f.isDirectory("app") && !f.isDirectory("pages") && (f.isDirectory("src/app") || f.isDirectory("src/pages")) ? "src/" : "";
  const appDir = f.isDirectory(`${src}app`) ? `${src}app` : null;
  const pagesDir = f.isDirectory(`${src}pages`) ? `${src}pages` : null;
  return { src, appDir, pagesDir };
}

function existing(context: ProjectContext, base: string): string | null {
  return context.files.first(...["ts", "js", "mjs", "tsx", "jsx"].map((ext) => `${base}.${ext}`));
}

const initServer = (ts: boolean, service: string) => `try {
  nex.init({ service: process.env.NEX_SERVICE ?? "${service}" });
} catch (error) {
  // Misconfigured monitoring must never stop the app from starting.
  console.warn("[nex] not started:", ${ts ? "(error as Error)" : "error"}.message);
}`;

function registerFunction(ts: boolean, service: string): string {
  return `export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const nex = await import("${SERVER}");
${initServer(ts, service).replace(/^/gm, "    ")}
  }
}`;
}

/** For a register() that exists already (maybe not async): the same, without await. */
function registerBody(ts: boolean, service: string): string {
  return `if (process.env.NEXT_RUNTIME === "nodejs") {
  void import("${SERVER}").then((nex) => {
${initServer(ts, service).replace(/^/gm, "    ")}
  });
}`;
}

function onRequestError(ts: boolean): string {
  return ts
    ? `export async function onRequestError(...args: unknown[]) {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const nex = await import("${SERVER}");
    nex.captureRequestError(...(args as Parameters<typeof nex.captureRequestError>));
  }
}`
    : `export async function onRequestError(...args) {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const nex = await import("${SERVER}");
    nex.captureRequestError(...args);
  }
}`;
}

function clientInit(setup: SetupValues): string {
  return `import * as nex from "${CLIENT}";

if (process.env.NEXT_PUBLIC_NEX_KEY) {
  nex.init({
    key: process.env.NEXT_PUBLIC_NEX_KEY,
    release: process.env.NEXT_PUBLIC_APP_VERSION ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,${setup.defaultApiUrl ? "" : "\n    apiUrl: process.env.NEXT_PUBLIC_NEX_API_URL,"}
  });
}`;
}

function globalError(ts: boolean): string {
  const props = ts ? ": { error: Error & { digest?: string }; reset: () => void }" : "";
  return `"use client";

import { useEffect } from "react";
import { captureException } from "${CLIENT}";

export default function GlobalError({ error, reset }${props}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        <h2>Something went wrong.</h2>
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}`;
}

/** Adds Nex to instrumentation.(ts|js): a new file, or the smallest edit to the developer's. */
function configureInstrumentation(context: ProjectContext, path: string, ts: boolean, service: string, manual: string[]): void {
  const content = context.files.read(path);
  if (content === null) {
    context.files.write(path, `${block("server", `${registerFunction(ts, service)}\n\n${onRequestError(ts)}`, "slash")}\n`);
    return;
  }
  if (hasBlock(content)) return;
  let next = content;
  const register = /^export\s+(async\s+)?function\s+register\s*\([^)]*\)[^{]*\{\s*$/m.exec(next);
  if (register) {
    const line = next.slice(0, register.index).split("\n").length - 1;
    next = insertAfterLine(next, line, block("register", registerBody(ts, service), "slash", "  "));
  } else if (/\bregister\b/.test(next)) {
    manual.push(`Start Nex from your register() in ${path}:\n  const nex = await import("${SERVER}"); nex.init();`);
  } else {
    next = appendBlock(next, block("register", registerFunction(ts, service), "slash"));
  }
  if (/\bonRequestError\b/.test(next)) manual.push(`Report server errors from your onRequestError in ${path}:\n  (await import("${SERVER}")).captureRequestError(...args);`);
  else next = appendBlock(next, block("on-request-error", onRequestError(ts), "slash"));
  context.files.write(path, next);
}

export const nextjs: Integration = {
  id: "nextjs",
  name: "Next.js",
  ecosystem: "javascript",
  status: "available",
  sdk: SDKS.javascript,
  // register() and onRequestError() are stable from Next.js 15.
  compatibility: [{ dependency: "next", label: "Next.js", min: "15.0.0" }],

  detect(context) {
    if (!hasDep(context, "next")) return null;
    const { appDir, pagesDir } = layout(context);
    const signals = ["next dependency"];
    if (appDir) signals.push("App Router");
    if (pagesDir) signals.push("Pages Router");
    return { confidence: 95, signals };
  },

  needs: () => ({ server: true, browser: true }),

  configure(context, setup): ConfigureResult {
    const ts = context.typescript;
    const ext = scriptExt(context);
    const { src, appDir } = layout(context);
    const manual: string[] = [];

    configureInstrumentation(context, existing(context, `${src}instrumentation`) ?? `${src}instrumentation.${ext}`, ts, setup.service, manual);

    // instrumentation-client runs in the browser before the app (Next.js 15.3+).
    const version = depVersion(context, "next");
    if (!version || compare(version, [15, 3, 0]) >= 0) {
      writeBlockFile(context, existing(context, `${src}instrumentation-client`) ?? `${src}instrumentation-client.${ext}`, "client", clientInit(setup), { prepend: true });
    } else {
      manual.push(`Browser errors need Next.js 15.3 or later (instrumentation-client). Upgrade Next.js, then run the wizard again.`);
    }

    if (appDir) {
      const path = existing(context, `${appDir}/global-error`) ?? `${appDir}/global-error.${scriptExt(context, true)}`;
      const content = context.files.read(path);
      if (content === null) context.files.write(path, `${block("global-error", globalError(ts), "slash")}\n`);
      else if (!hasBlock(content) && !content.includes(CLIENT)) manual.push(`Report render errors from ${path}: call captureException(error) from "${CLIENT}" in its useEffect.`);
    }

    ensureIgnored(context, ".env.local");
    return {
      envFile: ".env.local",
      env: {
        ...serverEnv(setup),
        ...(setup.browserKey ? { NEXT_PUBLIC_NEX_KEY: setup.browserKey } : {}),
        ...(setup.browserKey && !setup.defaultApiUrl ? { NEXT_PUBLIC_NEX_API_URL: setup.apiUrl } : {}),
      },
      manual,
      sourceMaps: NO_SOURCE_MAPS,
      releases: "Releases come from your CI's commit (VERCEL_GIT_COMMIT_SHA, GITHUB_SHA, …) or APP_VERSION / NEXT_PUBLIC_APP_VERSION.",
    };
  },

  instrumentationFiles(context) {
    const { src, appDir } = layout(context);
    return [existing(context, `${src}instrumentation`), existing(context, `${src}instrumentation-client`), appDir ? existing(context, `${appDir}/global-error`) : null].filter((p): p is string => p !== null);
  },
};
