import { jsRemoveCommand, pythonInterpreter } from "../core/package-manager";
import { MANIFEST, readManifest } from "../core/manifest";
import { hasBlock, onlyBlocks, removeBlocks, unsetEnv } from "../core/text";
import { sha256 } from "../core/workspace";
import { color } from "../core/ui";
import { resolveApp, resolveIntegration, type Runtime } from "./common";

/**
 * Takes out what the wizard added: its fenced blocks, the files it created
 * (only if unchanged since), its env vars, and, if wanted, the SDK package.
 * Files that existed before keep everything else.
 */
export async function uninstall(runtime: Runtime): Promise<number> {
  const { ui, flags } = runtime;
  ui.intro(flags.dryRun ? "Nex Uninstall — Dry Run" : "Nex Uninstall");
  const context = await resolveApp(runtime);
  const manifest = readManifest(context.files);
  const integration = manifest ? null : await resolveIntegration(runtime, context, { quiet: true });
  const files = context.files;
  const manual: string[] = [];

  const created = new Map((manifest?.created ?? []).map((entry) => [entry.path, entry.sha256]));
  const candidates = new Set<string>([...created.keys(), ...(manifest?.modified ?? []), ...(integration?.instrumentationFiles(context) ?? []), ".gitignore", "requirements.txt", "pyproject.toml"]);
  if (manifest?.envFile) candidates.add(manifest.envFile);
  for (const env of [".env", ".env.local"]) candidates.add(env);

  for (const path of candidates) {
    const content = files.read(path);
    if (content === null || !hasBlock(content)) continue;
    const isEnv = /(^|\/)\.env[^/]*$/.test(path);
    const cleaned = isEnv ? unsetEnv(content) : removeBlocks(content);
    const createdHash = created.get(path);
    if (isEnv && path === manifest?.envFile && manifest.envFileCreated && cleaned.trim() === "") files.remove(path);
    else if (createdHash !== undefined && (sha256(content) === createdHash || onlyBlocks(content))) files.remove(path);
    else if (createdHash !== undefined && cleaned.trim() === "") files.remove(path);
    else files.write(path, cleaned);
  }
  for (const [path, hash] of created) {
    const content = files.read(path);
    if (content !== null && !hasBlock(content) && sha256(content) !== hash) manual.push(`${path} was created by the wizard and changed since: remove it yourself if it's no longer needed.`);
  }
  if (files.exists(MANIFEST)) files.remove(MANIFEST);

  const removed = files.removed();
  const edited = files.changes().map((c) => c.path);
  if (!removed.length && !edited.length) {
    ui.outro("Nex isn't configured here. Nothing to remove.");
    return 0;
  }
  ui.note([removed.length ? `${color.bold("Remove")}\n  ${removed.join("\n  ")}` : null, edited.length ? `${color.bold("Take Nex out of")}\n  ${edited.join("\n  ")}` : null].filter(Boolean).join("\n\n"), flags.dryRun ? "Would change" : "Changes");
  if (flags.dryRun) {
    ui.outro("No changes were made.");
    return 0;
  }
  if (ui.interactive && !flags.yes && !(await ui.confirm("Remove Nex from this app?", true))) {
    ui.outro("Nothing was changed.");
    return 0;
  }
  files.apply();
  ui.success("Removed Nex's configuration");

  for (const pkg of manifest?.packages ?? []) {
    const remove = ui.interactive && !flags.yes ? await ui.confirm(`Uninstall ${pkg.name} too?`, true) : flags.yes;
    if (!remove) continue;
    const [command, args] =
      pkg.ecosystem === "javascript"
        ? jsRemoveCommand((context.js?.manager ?? pkg.manager) as Parameters<typeof jsRemoveCommand>[0], [pkg.name])
        : pkg.manager === "uv"
          ? ["uv", ["remove", pkg.name]]
          : pkg.manager === "poetry"
            ? ["poetry", ["remove", pkg.name]]
            : pkg.manager === "pipenv"
              ? ["pipenv", ["uninstall", pkg.name]]
              : [pythonInterpreter(context.root), ["-m", "pip", "uninstall", "-y", pkg.name]];
    const spinner = ui.spinner(`Uninstalling ${pkg.name}`);
    const result = await runtime.runner.run(command as string, args as string[], { cwd: context.root });
    if (result.code === 0) spinner.stop(`Uninstalled ${pkg.name}`);
    else {
      spinner.fail(`Couldn't uninstall ${pkg.name}`);
      manual.push(`Uninstall it yourself: ${[command, ...(args as string[])].join(" ")}`);
    }
  }
  manual.push("The SDK token and browser key still exist in Nex: revoke them in the Nex app → your project → SDK keys if they're no longer used.");
  ui.note(manual.map((m) => `• ${m}`).join("\n"), "Left for you");
  ui.outro("Nex was removed from this app.");
  return 0;
}
