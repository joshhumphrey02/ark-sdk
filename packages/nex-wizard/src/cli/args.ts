import { parseArgs } from "node:util";
import { WizardError } from "../core/errors";
import { isIntegrationId } from "../integrations/registry";
import type { IntegrationId } from "../integrations/types";

export type Command = "init" | "doctor" | "test" | "uninstall" | "login" | "logout";
const COMMANDS: Command[] = ["init", "doctor", "test", "uninstall", "login", "logout"];

export type Flags = {
  command: Command;
  integration: IntegrationId | null;
  dryRun: boolean;
  yes: boolean;
  debug: boolean;
  help: boolean;
  version: boolean;
  cwd: string;
  apiUrl: string | null;
  org: string | null;
  project: string | null;
  environment: string | null;
};

export function parseFlags(argv: string[], cwd = process.cwd()): Flags {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        integration: { type: "string", short: "i" },
        "dry-run": { type: "boolean" },
        yes: { type: "boolean", short: "y" },
        debug: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        cwd: { type: "string" },
        "api-url": { type: "string" },
        org: { type: "string" },
        project: { type: "string" },
        environment: { type: "string" },
      },
    });
  } catch (error) {
    throw new WizardError(error instanceof Error ? error.message.replace(/^.*?: /, "") : "Invalid options.", "Run with --help to see the options.");
  }
  const { values, positionals } = parsed;
  const word = positionals[0] ?? "init";
  if (!COMMANDS.includes(word as Command)) throw new WizardError(`Unknown command "${word}".`, `Commands: ${COMMANDS.join(", ")}`);
  if (positionals.length > 1) throw new WizardError(`Unexpected "${positionals[1]}".`, "Run with --help to see the options.");
  const integration = values.integration?.trim().toLowerCase() ?? null;
  if (integration !== null && !isIntegrationId(integration)) throw new WizardError(`Unknown integration "${values.integration}".`, "Run with --help to see the supported integrations.");
  return {
    command: word as Command,
    integration: integration as IntegrationId | null,
    dryRun: values["dry-run"] ?? false,
    yes: values.yes ?? false,
    debug: values.debug ?? false,
    help: values.help ?? false,
    version: values.version ?? false,
    cwd: values.cwd ?? cwd,
    apiUrl: values["api-url"] ?? null,
    org: values.org ?? null,
    project: values.project ?? null,
    environment: values.environment ?? null,
  };
}
