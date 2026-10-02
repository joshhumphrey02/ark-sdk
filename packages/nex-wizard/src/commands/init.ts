import { CancelledError, WizardError } from "../core/errors";
import { planInstall, runInstall, installedPythonVersion } from "../core/install";
import { MANIFEST, readManifest, recordChanges, type Manifest } from "../core/manifest";
import { serviceSlug, type ProjectContext } from "../core/project";
import { diff, hasBlock, parseEnv, removeBlocks, setEnv } from "../core/text";
import { color } from "../core/ui";
import type { ConfigureResult, Integration, SetupValues } from "../integrations/types";
import { NexApi } from "../nex/api";
import { resumeSession, signIn } from "../nex/auth";
import { chooseProject, issueCredentials, type ProjectChoice } from "../nex/project";
import { verify, type Check } from "../verify";
import { apiUrlFor, checkCompatibility, resolveApp, resolveIntegration, type Runtime } from "./common";
import { DEFAULT_API_URL } from "../nex/api";

const PLACEHOLDER_TOKEN = "nsk_live_(created when you run without --dry-run)";
const PLACEHOLDER_KEY = "nex_pub_(created when you run without --dry-run)";

export function printChecks(runtime: Runtime, checks: Check[]): boolean {
  for (const check of checks) {
    const detail = check.detail ? color.dim(` ${check.detail}`) : "";
    if (check.ok) runtime.ui.success(`${check.label}${detail}`);
    else runtime.ui.error(`${check.label}${detail}${check.fix ? `\n${check.fix}` : ""}`);
  }
  return checks.every((check) => check.ok);
}

/** True when this app already has the integration's Nex code. */
function alreadyConfigured(context: ProjectContext, integration: Integration): boolean {
  return Boolean(readManifest(context.files)) || integration.instrumentationFiles(context).some((file) => hasBlock(context.files.read(file) ?? ""));
}

type Credentials = { setup: SetupValues; project: ProjectChoice | null; ci: boolean };

/**
 * CI: an SDK token (and browser key) from the environment, nothing signed in
 * and nothing secret written to files. Otherwise: browser sign-in, pick the
 * project, and create the credentials it needs there.
 */
async function obtainCredentials(runtime: Runtime, context: ProjectContext, integration: Integration): Promise<Credentials> {
  const { flags, ui } = runtime;
  const needs = integration.needs(context);
  const apiUrl = apiUrlFor(flags);
  const slug = serviceSlug(context);
  const services = { server: process.env.NEX_SERVICE?.trim() || slug, browser: needs.server ? `${slug}-web` : slug };
  const base = { apiUrl, defaultApiUrl: apiUrl === DEFAULT_API_URL, service: services.server, browserService: services.browser };

  const envToken = process.env.NEX_TOKEN?.trim() || null;
  const envKey = process.env.NEX_BROWSER_KEY?.trim() || null;
  if (envToken || envKey) {
    if (needs.server && !envToken) throw new WizardError("NEX_BROWSER_KEY is set but NEX_TOKEN isn't.", `The ${integration.name} integration reports from the server too: set NEX_TOKEN (an SDK token for this environment).`);
    ui.info(`Using ${[envToken && "NEX_TOKEN", envKey && "NEX_BROWSER_KEY"].filter(Boolean).join(" and ")} from the environment. Nothing secret is written to files.`);
    return { setup: { ...base, serverToken: needs.server ? envToken : null, browserKey: needs.browser ? envKey : null, environment: process.env.NEX_ENVIRONMENT?.trim() || null }, project: null, ci: true };
  }
  const api = new NexApi(apiUrl, runtime.fetch);
  ui.step("Connecting to Nex");
  let session = await resumeSession(api);
  if (session) ui.success(`Signed in as ${session.user.email}`);
  else if (!ui.interactive) throw new WizardError("Signing in needs an interactive terminal.", "Run `npx @nerdstackgrp/nex-wizard login` first, or in CI set NEX_TOKEN (and NEX_BROWSER_KEY for web apps) and pass --yes.");
  else session = await signIn(api, ui, { open: runtime.openBrowser, printOnly: runtime.flags.noBrowser });
  const project = await chooseProject(session.api, ui, {
    yes: flags.yes,
    dryRun: flags.dryRun,
    org: flags.org ?? undefined,
    project: flags.project ?? undefined,
    environment: flags.environment ?? undefined,
    suggestedName: slug,
  });
  ui.success(`Project: ${project.application.name} ${color.dim(`(${project.organization.name} · ${project.environment.name})`)}`);
  const environment = project.environment.slug;
  if (flags.dryRun || project.pending) {
    return { setup: { ...base, serverToken: needs.server ? PLACEHOLDER_TOKEN : null, browserKey: needs.browser ? PLACEHOLDER_KEY : null, environment }, project, ci: false };
  }
  const spinner = ui.spinner("Creating credentials");
  try {
    const issued = await issueCredentials(session.api, project, needs, services);
    spinner.stop([issued.serverToken && "SDK token created", issued.browserKey && "Browser key ready"].filter(Boolean).join(" · ") || "Credentials ready");
    return { setup: { ...base, ...issued, environment }, project, ci: false };
  } catch (error) {
    spinner.fail("Couldn't create credentials");
    throw error;
  }
}

/** Existing values for the keys we'd set, outside our block: replaced only with consent. */
async function resolveEnvConflicts(runtime: Runtime, context: ProjectContext, result: ConfigureResult): Promise<Set<string>> {
  const replace = new Set<string>();
  if (!result.envFile) return replace;
  const content = context.files.read(result.envFile);
  if (content === null) return replace;
  const outside = parseEnv(removeBlocks(content, "env"));
  for (const [key, value] of Object.entries(result.env)) {
    const current = outside.get(key);
    if (current === undefined || current === value) continue;
    if (!runtime.ui.interactive || runtime.flags.yes) {
      runtime.ui.warn(`${key} already exists in ${result.envFile}; kept it. Run without --yes to replace it.`);
      continue;
    }
    if (await runtime.ui.confirm(`${key} already exists in ${result.envFile}. Replace it with the selected Nex project?`, true)) replace.add(key);
  }
  return replace;
}

/** Edits to files the developer wrote: shown and confirmed before anything is written. */
async function confirmEdits(runtime: Runtime, context: ProjectContext, envFile: string | null): Promise<void> {
  const edits = context.files.changes().filter((c) => c.before !== null && c.before.trim() !== "" && !hasBlock(c.before) && c.path !== envFile && c.path !== ".gitignore");
  if (!edits.length || !runtime.ui.interactive || runtime.flags.yes) return;
  runtime.ui.warn(`Nex adds a small, marked block to ${edits.length === 1 ? "this file" : "these files"}, keeping everything else:\n  ${edits.map((e) => e.path).join("\n  ")}`);
  for (;;) {
    const answer = await runtime.ui.select("Continue?", [
      { value: "yes", label: "Yes" },
      { value: "show", label: "Show changes" },
      { value: "cancel", label: "Cancel" },
    ]);
    if (answer === "yes") return;
    if (answer === "cancel") throw new CancelledError();
    for (const edit of edits) runtime.ui.note(colorDiff(diff(edit.before!, edit.after)), edit.path);
  }
}

function colorDiff(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.startsWith("+") ? color.green(line) : line.startsWith("-") ? color.red(line) : color.dim(line)))
    .join("\n");
}

function summarizeDryRun(runtime: Runtime, context: ProjectContext, install: ReturnType<typeof planInstall>, result: ConfigureResult, project: ProjectChoice | null): void {
  const changes = context.files.changes();
  const lines = [
    install?.command ? `${color.bold("Would install")}\n  ${install.name}  ${color.dim(`(${[install.command[0], ...install.command[1]].join(" ")})`)}` : null,
    changes.some((c) => c.before === null) ? `${color.bold("Would create")}\n  ${changes.filter((c) => c.before === null).map((c) => c.path).join("\n  ")}` : null,
    changes.some((c) => c.before !== null) ? `${color.bold("Would modify")}\n  ${changes.filter((c) => c.before !== null).map((c) => c.path).join("\n  ")}` : null,
    Object.keys(result.env).length ? `${color.bold("Would set")} ${color.dim(`(in ${result.envFile})`)}\n  ${Object.keys(result.env).join("\n  ")}` : null,
    project ? `${color.bold("Would connect to")}\n  ${project.pending ? "new project " : ""}${project.application.name} (${project.organization.name} · ${project.environment.name})` : null,
  ].filter(Boolean);
  runtime.ui.note(lines.join("\n\n"), "Dry run");
  for (const change of changes) {
    // Env files hold secrets: listed by key above, never shown.
    if (change.path === result.envFile || /(^|\/)\.env[^/]*$/.test(change.path)) continue;
    const text = change.before === null ? change.after.replace(/\n$/, "").split("\n").map((line) => `+ ${line}`).join("\n") : diff(change.before, change.after);
    runtime.ui.note(colorDiff(text), change.path);
  }
}

export async function init(runtime: Runtime): Promise<number> {
  const { flags, ui } = runtime;
  ui.intro(flags.dryRun ? "Nex Wizard — Dry Run" : "Nex Wizard");
  ui.step("Detecting your project");
  const context = await resolveApp(runtime);
  const integration = await resolveIntegration(runtime, context);
  if (integration.status === "planned") {
    integration.configure(context, {} as SetupValues);
  }
  checkCompatibility(context, integration);

  if (alreadyConfigured(context, integration) && !flags.dryRun) {
    ui.info("Nex is already configured in this app.");
    const action = !ui.interactive || flags.yes ? "verify" : await ui.select("What would you like to do?", [
      { value: "verify", label: "Verify installation" },
      { value: "reconfigure", label: "Reconfigure" },
      { value: "exit", label: "Exit" },
    ]);
    if (action === "exit") {
      ui.outro("Nothing was changed.");
      return 0;
    }
    if (action === "verify") {
      ui.step("Verifying");
      const { checks } = await verify(context, integration, { runner: runtime.runner, fetch: runtime.fetch, sendTestEvent: true });
      const ok = printChecks(runtime, checks);
      ui.outro(ok ? "Everything looks good. Nothing needed to change." : "Something needs attention (above).");
      return ok ? 0 : 1;
    }
  } else if (!flags.dryRun) {
    ui.success("Nex isn't set up here yet");
  }

  const { setup, project, ci } = await obtainCredentials(runtime, context, integration);

  // Install first: if that fails, no file has been touched.
  const install = planInstall(context, integration);
  if (install && integration.sdk?.registry === "pypi" && (await installedPythonVersion(context, runtime.runner))) install.command = null;

  const result = integration.configure(context, setup);
  const env = ci ? {} : result.env;
  if (result.envFile && Object.keys(env).length) {
    const replace = await resolveEnvConflicts(runtime, context, { ...result, env });
    context.files.write(result.envFile, setEnv(context.files.read(result.envFile) ?? "", env, replace));
  }

  if (flags.dryRun) {
    summarizeDryRun(runtime, context, install, { ...result, env }, project);
    ui.outro("No changes were made.");
    return 0;
  }

  await confirmEdits(runtime, context, result.envFile);

  ui.step("Installing Nex");
  if (install?.command) {
    const spinner = ui.spinner(`Installing ${install.name}`);
    try {
      await runInstall(context, install, runtime.runner);
      spinner.stop(`Installed ${install.name}`);
    } catch (error) {
      spinner.fail(`Couldn't install ${install.name}`);
      throw error;
    }
  } else if (install) ui.success(`${install.name} already installed`);

  const changes = context.files.changes();
  const previous = readManifest(context.files);
  const manifest: Manifest = recordChanges(
    previous,
    {
      version: 1,
      integration: integration.id,
      apiUrl: setup.apiUrl,
      organization: project ? { id: project.organization.id, slug: project.organization.slug, name: project.organization.name } : previous?.organization ?? null,
      application: project ? { id: project.application.id, slug: project.application.slug, name: project.application.name } : previous?.application ?? null,
      environment: project ? { id: project.environment.id, slug: project.environment.slug, name: project.environment.name } : previous?.environment ?? null,
      services: { server: setup.serverToken ? setup.service : null, browser: setup.browserKey ? setup.browserService : null },
      envFile: Object.keys(env).length ? result.envFile : previous?.envFile ?? null,
      envFileCreated: previous?.envFileCreated ?? (Object.keys(env).length > 0 && result.envFile !== null && context.files.readOriginal(result.envFile) === null),
    },
    changes,
    { packages: install?.command ? [{ ecosystem: integration.ecosystem, manager: install.manager, name: install.name }] : [], envKeys: Object.keys(env) },
  );
  context.files.write(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  context.files.apply();

  const code = changes.filter((c) => c.path !== result.envFile && c.path !== ".gitignore");
  if (code.length) ui.success(`Configured Nex ${color.dim(code.map((c) => c.path).join(", "))}`);
  if (Object.keys(env).length) ui.success(`Environment configured ${color.dim(`${Object.keys(env).join(", ")} in ${result.envFile}`)}`);
  if (changes.some((c) => c.path === ".gitignore")) ui.success(`${result.envFile} added to .gitignore`);
  ui.info(result.sourceMaps);
  ui.info(result.releases);
  if (result.manual.length) ui.note(result.manual.map((step) => `• ${step}`).join("\n\n"), "Finish by hand");

  ui.step("Verifying installation");
  const { checks } = await verify(context, integration, { runner: runtime.runner, fetch: runtime.fetch, sendTestEvent: true, service: setup.service });
  const ok = printChecks(runtime, checks);
  if (!ok) {
    ui.outro(color.red("Nex is installed, but the checks above failed. Run `npx @nerdstackgrp/nex-wizard doctor` once they're fixed."));
    return 1;
  }
  const where = project ? `${project.organization.name} → ${project.application.name}` : manifest.application?.name ?? "your project";
  ui.outro(`${color.green("Nex is ready.")} Open the Nex app → ${where} to see this app's errors, traces and health.`);
  return 0;
}
