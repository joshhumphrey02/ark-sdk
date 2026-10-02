import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Flags } from "../cli/args";
import { choose, detectAll } from "../core/detect";
import { WizardError } from "../core/errors";
import type { Runner } from "../core/exec";
import { readManifest } from "../core/manifest";
import { findApps, isMonorepoRoot, loadProject, type ProjectContext } from "../core/project";
import { format, inRange } from "../core/semver";
import { color, type UI } from "../core/ui";
import { INTEGRATIONS, getIntegration } from "../integrations/registry";
import { depVersion } from "../integrations/shared";
import type { Integration } from "../integrations/types";
import { DEFAULT_API_URL, type Fetch } from "../nex/api";

/** What every command runs with; tests swap the UI, the runner, fetch and the browser. */
export type Runtime = {
  flags: Flags;
  ui: UI;
  runner: Runner;
  fetch: Fetch;
  openBrowser?: (url: string) => void;
};

export function apiUrlFor(flags: Flags): string {
  return (flags.apiUrl ?? process.env.NEX_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
}

const PROJECT_FILES = ["package.json", "pyproject.toml", "requirements.txt", "Pipfile", "setup.py", "manage.py", "go.mod", "Gemfile", "composer.json", "pubspec.yaml", "Package.swift", "pom.xml", "build.gradle", "build.gradle.kts"];

/**
 * The app to set up. From a monorepo's root with several apps, the developer
 * picks one: the wizard never configures every package.
 */
export async function resolveApp(runtime: Runtime): Promise<ProjectContext> {
  const { flags, ui } = runtime;
  const root = resolve(flags.cwd);
  if (!existsSync(root)) throw new WizardError(`The folder ${root} doesn't exist.`);
  if (isMonorepoRoot(root)) {
    const apps = findApps(root);
    if (apps.length === 1) return loadProject(join(root, apps[0]!.path), root);
    if (apps.length > 1) {
      if (!ui.interactive || flags.yes) throw new WizardError("Multiple applications found in this repository.", `Run the wizard from the app's folder, or pass --cwd:\n  ${apps.map((a) => a.path).join("\n  ")}`);
      ui.info("Multiple applications detected.");
      const picked = await ui.select(
        "Which application should Nex configure?",
        apps.map((a) => ({ value: a.path, label: a.path, hint: a.name !== a.path ? a.name : undefined })),
      );
      return loadProject(join(root, picked), root);
    }
  }
  if (!PROJECT_FILES.some((file) => existsSync(join(root, file)))) {
    throw new WizardError("Couldn't find an application here.", `Run the Nex wizard from the root of your application (where package.json or pyproject.toml is).\n\nCurrent directory:\n  ${root}`);
  }
  return loadProject(root);
}

/** The integration: --integration, else the one recorded by a previous run, else detected (and confirmed). */
export async function resolveIntegration(runtime: Runtime, context: ProjectContext, options: { quiet?: boolean } = {}): Promise<Integration> {
  const { flags, ui } = runtime;
  if (flags.integration) return getIntegration(flags.integration);
  const recorded = readManifest(context.files);
  if (recorded) return getIntegration(recorded.integration);

  const candidates = detectAll(context);
  const { best, contenders } = choose(candidates);
  if (!best) {
    throw new WizardError("Couldn't tell which framework this app uses.", "Pick one with --integration, e.g. --integration nextjs. Run with --help to see them all.");
  }
  if (!options.quiet) {
    for (const signal of best.detection.signals) ui.success(signal);
    if (context.typescript && best.integration.ecosystem === "javascript") ui.success("TypeScript");
    if (context.js && best.integration.ecosystem === "javascript") ui.success(`${context.js.manager} ${color.dim(`(${context.js.signal})`)}`);
    if (context.python && best.integration.ecosystem === "python") ui.success(`${context.python.manager} ${color.dim(`(${context.python.signal})`)}`);
  }
  if (contenders.length > 1) {
    if (!ui.interactive || flags.yes) throw new WizardError(`This folder looks like ${contenders.map((c) => c.integration.name).join(" and ")}.`, `Pick one with --integration: ${contenders.map((c) => c.integration.id).join(", ")}`);
    return ui.select(
      "Which integration should Nex use?",
      contenders.map((c) => ({ value: c.integration, label: c.integration.name, hint: c.detection.signals.join(", ") })),
    );
  }
  if (!ui.interactive || flags.yes || options.quiet) return best.integration;
  const yes = await ui.select(`Use the ${best.integration.name} integration?`, [
    { value: true, label: "Yes" },
    { value: false, label: "Choose another integration" },
  ]);
  if (yes) return best.integration;
  const others = candidates.map((c) => c.integration);
  const all = [...others, ...Object.values(INTEGRATIONS).filter((i) => !others.includes(i))];
  return ui.select(
    "Which integration?",
    all.map((i) => ({ value: i, label: i.name, hint: i.status === "planned" ? "SDK not available yet" : i.id })),
  );
}

/** Refuses a framework version the integration is known not to work with. */
export function checkCompatibility(context: ProjectContext, integration: Integration): void {
  for (const rule of integration.compatibility) {
    const version = depVersion(context, rule.dependency);
    if (!version) continue;
    if (!inRange(version, rule.min, rule.max)) {
      const supported = rule.max ? `${rule.label} ${rule.min ?? "any"}–${rule.max}` : `${rule.label} ${rule.min} or later`;
      throw new WizardError(`Your ${rule.label} version isn't supported by the Nex ${integration.name} integration.`, `Detected:\n  ${rule.label} ${format(version)}\n\nSupported:\n  ${supported}`);
    }
  }
}
