import { readManifest } from "../core/manifest";
import { color } from "../core/ui";
import { readCredentials } from "../nex/credentials";
import { verify } from "../verify";
import { apiUrlFor, resolveApp, resolveIntegration, type Runtime } from "./common";
import { printChecks } from "./init";

/** Everything about this app's Nex setup, checked: what's right, what's wrong, and what to do. */
export async function doctor(runtime: Runtime, options: { testOnly?: boolean } = {}): Promise<number> {
  const { ui } = runtime;
  ui.intro(options.testOnly ? "Nex Test" : "Nex Doctor");
  const context = await resolveApp(runtime);
  const integration = await resolveIntegration(runtime, context, { quiet: true });

  if (!options.testOnly) {
    ui.step("Project");
    ui.success(`${integration.name} ${color.dim(`(${integration.id})`)}`);
    if (integration.ecosystem === "javascript") {
      if (context.typescript) ui.success("TypeScript");
      if (context.js) ui.success(`${context.js.manager} ${color.dim(`(${context.js.signal})`)}`);
    }
    if (context.python) ui.success(`${context.python.manager} ${color.dim(`(${context.python.signal})`)}`);
    if (integration.status === "planned") {
      ui.warn(`A Nex SDK for ${integration.name} isn't available yet.`);
      ui.outro("Nothing to check.");
      return 2;
    }
    const manifest = readManifest(context.files);
    if (manifest?.application) ui.success(`Nex project ${manifest.application.name} ${color.dim(`(${manifest.organization?.name ?? ""} · ${manifest.environment?.name ?? ""})`)}`);
    else ui.warn("No Nex wizard record here (.nex-wizard.json): set up by hand, or not yet.");
  }

  ui.step("Nex");
  const { checks, settings } = await verify(context, integration, { runner: runtime.runner, fetch: runtime.fetch, sendTestEvent: true });
  const ok = printChecks(runtime, checks);

  if (!options.testOnly) {
    ui.step("Account");
    const apiUrl = apiUrlFor(runtime.flags);
    const saved = readCredentials(apiUrl);
    ui.info(saved ? `Signed in as ${saved.user.email} (not needed by the app itself)` : "Not signed in to the wizard (not needed by the app itself)");
    ui.info(`Releases: ${settings.sources.APP_VERSION ? "APP_VERSION is set" : "from your CI's commit or APP_VERSION at runtime"}`);
    ui.info("Source maps: upload isn't available in Nex yet");
  }

  if (!ok) {
    ui.note(["Invalid Nex configuration (run the wizard again)", "Network connectivity to Nex", "Revoked or wrong project credentials"].map((c) => `• ${c}`).join("\n"), "Possible causes");
    ui.outro(color.red("Something needs attention."));
    return 1;
  }
  ui.outro(options.testOnly ? "The app can talk to Nex." : "Everything looks good.");
  return 0;
}
