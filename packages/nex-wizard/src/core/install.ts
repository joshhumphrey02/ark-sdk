import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Integration } from "../integrations/types";
import { WizardError } from "./errors";
import type { Runner } from "./exec";
import { jsAddCommand, pythonInterpreter } from "./package-manager";
import type { ProjectContext } from "./project";

export type InstallPlan = { name: string; manager: string; command: [string, string[]] | null; alreadyInstalled: boolean };

/** The installed nex-js version, looking up through node_modules like Node does (hoisted monorepos). */
export function installedJsVersion(context: ProjectContext, name: string): string | null {
  let dir = context.root;
  for (;;) {
    const file = join(dir, "node_modules", name, "package.json");
    if (existsSync(file)) {
      try {
        return (JSON.parse(readFileSync(file, "utf8")) as { version?: string }).version ?? null;
      } catch {
        return null;
      }
    }
    if (dir === context.repoRoot || dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
}

export async function installedPythonVersion(context: ProjectContext, runner: Runner): Promise<string | null> {
  const result = await runner.run(pythonInterpreter(context.root), ["-c", "import nex_py; print(nex_py.__version__)"], { cwd: context.root });
  return result.code === 0 ? result.stdout.trim() || null : null;
}

export function planInstall(context: ProjectContext, integration: Integration): InstallPlan | null {
  const sdk = integration.sdk;
  if (!sdk) return null;
  if (sdk.registry === "npm") {
    const manager = context.js?.manager ?? "npm";
    const installed = sdk.name in context.deps && installedJsVersion(context, sdk.name) !== null;
    return { name: sdk.name, manager, command: installed ? null : jsAddCommand(manager, [`${sdk.name}@${sdk.version}`]), alreadyInstalled: installed };
  }
  const manager = context.python?.manager ?? "pip";
  const spec = `${sdk.name}${sdk.version}`;
  const command: [string, string[]] =
    manager === "uv"
      ? ["uv", ["add", spec]]
      : manager === "poetry"
        ? ["poetry", ["add", spec]]
        : manager === "pipenv"
          ? ["pipenv", ["install", spec]]
          : [pythonInterpreter(context.root), ["-m", "pip", "install", spec]];
  return { name: sdk.name, manager, command, alreadyInstalled: false };
}

export async function runInstall(context: ProjectContext, plan: InstallPlan, runner: Runner): Promise<void> {
  if (!plan.command) return;
  const [command, args] = plan.command;
  const result = await runner.run(command, args, { cwd: context.root });
  if (result.code !== 0) {
    const reason = (result.stderr || result.stdout).trim().split("\n").slice(-3).join("\n");
    throw new WizardError(`Couldn't install ${plan.name} with ${plan.manager}.`, `Run it yourself, then run the wizard again:\n  ${[command, ...args].join(" ")}${reason ? `\n\n${reason}` : ""}`);
  }
}
