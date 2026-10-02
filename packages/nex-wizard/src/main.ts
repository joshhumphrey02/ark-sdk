import { parseFlags } from "./cli/args";
import { helpText, VERSION } from "./cli/help";
import { CancelledError, WizardError } from "./core/errors";
import { processRunner } from "./core/exec";
import { color, terminalUI, type UI } from "./core/ui";
import { login, logout } from "./commands/account";
import type { Runtime } from "./commands/common";
import { doctor } from "./commands/doctor";
import { init } from "./commands/init";
import { uninstall } from "./commands/uninstall";

export type MainOptions = Partial<Omit<Runtime, "flags">> & { cwd?: string; write?: (text: string) => void };

/** Runs one command and returns the exit code. Never throws. */
export async function main(argv: string[], options: MainOptions = {}): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  let ui: UI | null = options.ui ?? null;
  let debug = argv.includes("--debug");
  try {
    const flags = parseFlags(argv, options.cwd);
    debug = flags.debug;
    if (flags.help) {
      write(`${helpText()}\n`);
      return 0;
    }
    if (flags.version) {
      write(`${VERSION}\n`);
      return 0;
    }
    ui ??= terminalUI({ interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI });
    const runtime: Runtime = { flags, ui, runner: options.runner ?? processRunner, fetch: options.fetch ?? fetch, openBrowser: options.openBrowser };
    switch (flags.command) {
      case "init":
        return await init(runtime);
      case "doctor":
        return await doctor(runtime);
      case "test":
        return await doctor(runtime, { testOnly: true });
      case "uninstall":
        return await uninstall(runtime);
      case "login":
        return await login(runtime);
      case "logout":
        return await logout(runtime);
    }
  } catch (error) {
    const out = ui ?? terminalUI({ interactive: false });
    if (error instanceof CancelledError) {
      out.outro(color.dim(error.message));
      return error.exitCode;
    }
    if (error instanceof WizardError) {
      out.error(`${error.message}${error.hint ? `\n\n${error.hint}` : ""}`);
      return error.exitCode;
    }
    out.error(`Something unexpected went wrong${debug ? "" : ". Run again with --debug for details."}`);
    if (debug) write(`${error instanceof Error ? error.stack : String(error)}\n`);
    return 1;
  }
}
