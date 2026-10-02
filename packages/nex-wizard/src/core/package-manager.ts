import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type JsPackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type PythonPackageManager = "uv" | "poetry" | "pipenv" | "pip";

const LOCKFILES: [string, JsPackageManager][] = [
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/**
 * The JS package manager from the nearest lockfile (walking up to the
 * repository root, for monorepos), else the `packageManager` field, else npm.
 */
export function detectJsPackageManager(dir: string, stopAt: string): { manager: JsPackageManager; signal: string } {
  let current = dir;
  for (;;) {
    for (const [file, manager] of LOCKFILES) if (existsSync(join(current, file))) return { manager, signal: file };
    try {
      const field = (JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as { packageManager?: string }).packageManager;
      const named = field?.split("@")[0];
      if (named === "pnpm" || named === "yarn" || named === "bun" || named === "npm") return { manager: named, signal: `packageManager: ${field}` };
    } catch {
      // No package.json here.
    }
    if (current === stopAt || dirname(current) === current) break;
    current = dirname(current);
  }
  return { manager: "npm", signal: "no lockfile (npm)" };
}

export function jsAddCommand(manager: JsPackageManager, packages: string[], dev = false): [string, string[]] {
  switch (manager) {
    case "pnpm":
      return ["pnpm", ["add", ...(dev ? ["-D"] : []), ...packages]];
    case "yarn":
      return ["yarn", ["add", ...(dev ? ["-D"] : []), ...packages]];
    case "bun":
      return ["bun", ["add", ...(dev ? ["-d"] : []), ...packages]];
    default:
      return ["npm", ["install", ...(dev ? ["--save-dev"] : []), ...packages]];
  }
}

export function jsRemoveCommand(manager: JsPackageManager, packages: string[]): [string, string[]] {
  switch (manager) {
    case "pnpm":
      return ["pnpm", ["remove", ...packages]];
    case "yarn":
      return ["yarn", ["remove", ...packages]];
    case "bun":
      return ["bun", ["remove", ...packages]];
    default:
      return ["npm", ["uninstall", ...packages]];
  }
}

export function detectPythonPackageManager(dir: string): { manager: PythonPackageManager; signal: string } {
  if (existsSync(join(dir, "uv.lock"))) return { manager: "uv", signal: "uv.lock" };
  if (existsSync(join(dir, "poetry.lock"))) return { manager: "poetry", signal: "poetry.lock" };
  try {
    if (/^\[tool\.poetry\]/m.test(readFileSync(join(dir, "pyproject.toml"), "utf8"))) return { manager: "poetry", signal: "[tool.poetry]" };
  } catch {
    // No pyproject.toml.
  }
  if (existsSync(join(dir, "Pipfile"))) return { manager: "pipenv", signal: "Pipfile" };
  return { manager: "pip", signal: existsSync(join(dir, "requirements.txt")) ? "requirements.txt" : "pip" };
}

/** The project's virtualenv interpreter, if there is one, else python3. */
export function pythonInterpreter(dir: string): string {
  for (const candidate of [".venv/bin/python", "venv/bin/python", ".venv/Scripts/python.exe", "venv/Scripts/python.exe"]) {
    if (existsSync(join(dir, candidate))) return join(dir, candidate);
  }
  return process.platform === "win32" ? "python" : "python3";
}
