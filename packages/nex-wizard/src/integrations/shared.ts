import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { JS } from "../sdks";
import type { ProjectContext } from "../core/project";
import { appendBlock, block, gitignoreCovers, hasBlock, insertAt, prependBlock, statementEndLine, syntaxFor } from "../core/text";
import { minVersion } from "../core/semver";
import type { SetupValues } from "./types";

export const SERVER = `${JS}/server`;
export const CLIENT = `${JS}/client`;
export const REACT = `${JS}/react`;

/** A dependency is declared (in package.json). */
export function hasDep(context: ProjectContext, ...names: string[]): boolean {
  return names.some((name) => name in context.deps);
}

/** The installed version of a dependency, else the minimum of its declared range. */
export function depVersion(context: ProjectContext, name: string): [number, number, number] | null {
  const installed = context.files.json<{ version?: string }>(`node_modules/${name}/package.json`)?.version;
  return minVersion(installed ?? context.deps[name]);
}

export function scriptExt(context: ProjectContext, jsx = false): string {
  return context.typescript ? (jsx ? "tsx" : "ts") : jsx ? "jsx" : "js";
}

/** Top-level statements that load .env: SDK init must run after them, or it starts without its token. */
const ENV_LOADERS = {
  python: /^(?:dotenv\.)?load_dotenv\(/m,
  js: /^(?:require\(\s*["']dotenv["']\s*\)\.config\(|require\(\s*["']dotenv\/config["']\s*\)|dotenv\.config\(|(?:dotenv\.)?config\(\s*\)\s*;?\s*$)/m,
};

/** The line after the last top-level .env loading statement, or null. */
export function afterEnvLoad(content: string, language: "js" | "python"): number | null {
  const pattern = new RegExp(ENV_LOADERS[language].source, "gm");
  let last: number | null = null;
  for (const match of content.matchAll(pattern)) last = statementEndLine(content, match.index!, language);
  return last === null ? null : last + 1;
}

/**
 * Adds a block at the top of a file (after directives), once; for SDK init
 * (`afterEnv`), after the file's own .env loading if it has any. Returns
 * false if the file is missing.
 */
export function prependOnce(context: ProjectContext, path: string, id: string, body: string, options: { afterEnv?: boolean } = {}): boolean {
  const content = context.files.read(path);
  if (content === null) return false;
  if (hasBlock(content, id)) return true;
  const language = path.endsWith(".py") ? "python" : "js";
  const text = block(id, body, syntaxFor(path));
  const line = options.afterEnv ? afterEnvLoad(content, language) : null;
  context.files.write(path, line === null ? prependBlock(content, text, language) : insertAt(content, line, text));
  return true;
}

/** Creates a file that is one Nex block, or appends the block to an existing one, once. */
export function writeBlockFile(context: ProjectContext, path: string, id: string, body: string, options: { prepend?: boolean } = {}): void {
  const content = context.files.read(path);
  const text = block(id, body, syntaxFor(path));
  if (content === null) context.files.write(path, `${text}\n`);
  else if (!hasBlock(content, id)) {
    const language = path.endsWith(".py") ? "python" : "js";
    context.files.write(path, options.prepend ? prependBlock(content, text, language) : appendBlock(content, text));
  }
}

/**
 * Secrets go in an env file only if git ignores it: when neither the app's
 * nor the repository's .gitignore covers it, the wizard adds it to the app's.
 */
export function ensureIgnored(context: ProjectContext, file: string): void {
  const local = context.files.read(".gitignore") ?? "";
  if (gitignoreCovers(local, file)) return;
  if (context.repoRoot !== context.root) {
    const prefix = relative(context.repoRoot, context.root).split(sep).join("/");
    const rootIgnore = readText(join(context.repoRoot, ".gitignore"));
    if (rootIgnore && (gitignoreCovers(rootIgnore, file) || gitignoreCovers(rootIgnore, `${prefix}/${file}`))) return;
  }
  if (!hasBlock(local, "gitignore")) context.files.write(".gitignore", appendBlock(local, block("gitignore", file, "hash")));
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Server-side variables, the same for every runtime. */
export function serverEnv(setup: SetupValues): Record<string, string> {
  if (!setup.serverToken) return {};
  return {
    // The server SDK has no default URL: it must always be named.
    NEX_API_URL: setup.apiUrl,
    NEX_TOKEN: setup.serverToken,
    NEX_SERVICE: setup.service,
    ...(setup.environment ? { NEX_ENVIRONMENT: setup.environment } : {}),
  };
}

export const NO_SOURCE_MAPS = "Source-map upload isn't available in Nex yet; stack traces show the built file and line.";

export function releasesFromCi(where: string): string {
  return `Releases come from your CI's commit (GITHUB_SHA, VERCEL_GIT_COMMIT_SHA, …) or APP_VERSION, read ${where}.`;
}

/** `apiUrl` for generated browser code, only when it isn't the default. */
export function apiUrlOption(setup: SetupValues, expression: string): string {
  return setup.defaultApiUrl ? "" : `, apiUrl: ${expression}`;
}

// --- Browser apps --------------------------------------------------------------------------

export type PublicEnv = {
  /** How code reads a public variable, e.g. `import.meta.env.VITE_NEX_KEY`. */
  read: (name: string) => string;
  /** The variable name with the bundler's public prefix. */
  name: (base: string) => string;
  file: string;
};

export const VITE_ENV: PublicEnv = { read: (name) => `import.meta.env.${name}`, name: (base) => `VITE_${base}`, file: ".env.local" };
export const CRA_ENV: PublicEnv = { read: (name) => `process.env.${name}`, name: (base) => `REACT_APP_${base}`, file: ".env.local" };
export const VUE_CLI_ENV: PublicEnv = { read: (name) => `process.env.${name}`, name: (base) => `VUE_APP_${base}`, file: ".env.local" };
export const ASTRO_ENV: PublicEnv = { read: (name) => `import.meta.env.${name}`, name: (base) => `PUBLIC_${base}`, file: ".env" };

/** The browser SDK started from public env vars; nothing happens without a key. */
export function browserInit(setup: SetupValues, env: PublicEnv): string {
  const key = env.read(env.name("NEX_KEY"));
  return `import * as nex from "${CLIENT}";

if (${key}) {
  nex.init({ key: ${key}, release: ${env.read(env.name("APP_VERSION"))}${apiUrlOption(setup, env.read(env.name("NEX_API_URL")))} });
}`;
}

export function browserEnv(setup: SetupValues, env: PublicEnv): Record<string, string> {
  if (!setup.browserKey) return {};
  return { [env.name("NEX_KEY")]: setup.browserKey, ...(setup.defaultApiUrl ? {} : { [env.name("NEX_API_URL")]: setup.apiUrl }) };
}

export function browserReleases(env: PublicEnv): string {
  return `Releases: set ${env.name("APP_VERSION")} at build time (e.g. to the commit SHA) to tag browser errors with it.`;
}

/** The first file that exists among `bases` × extensions. */
export function findFile(context: ProjectContext, bases: string[], exts = ["tsx", "ts", "jsx", "js", "mjs"]): string | null {
  return context.files.first(...bases.flatMap((base) => exts.map((ext) => `${base}.${ext}`)));
}

/** Meta-frameworks the wizard doesn't set up yet, named so it never configures them wrongly. */
const UNSUPPORTED: [string, string][] = [
  ["nuxt", "Nuxt"],
  ["@remix-run/react", "Remix"],
  ["@react-router/dev", "React Router (framework mode)"],
  ["gatsby", "Gatsby"],
  ["expo", "Expo"],
];

export function unsupportedMetaFramework(context: ProjectContext): string | null {
  return UNSUPPORTED.find(([dep]) => dep in context.deps)?.[1] ?? null;
}

/**
 * Inserts `item` as the first entry of the array opened by `opener`
 * (`providers: [`), as a fenced block. The rest of the array is untouched.
 */
export function insertIntoArray(content: string, opener: RegExp, id: string, item: string): string | null {
  const match = opener.exec(content);
  if (!match) return null;
  const lineStart = content.lastIndexOf("\n", match.index) + 1;
  const baseIndent = /^\s*/.exec(content.slice(lineStart))![0];
  const indent = `${baseIndent}  `;
  const end = match.index + match[0].length;
  const restOfLine = content.slice(end, content.indexOf("\n", end) < 0 ? content.length : content.indexOf("\n", end));
  const fenced = block(id, item, "slash", indent);
  if (restOfLine.trim() === "") return `${content.slice(0, end)}\n${fenced}${content.slice(end)}`;
  return `${content.slice(0, end)}\n${fenced}\n${indent}${content.slice(end).replace(/^\s+/, "")}`;
}
