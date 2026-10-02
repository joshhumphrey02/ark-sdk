import { available, planned } from "../integrations/registry";
import { color } from "../core/ui";

export const PACKAGE = "@nerdstackgrp/nex-wizard";
export const VERSION = "0.1.0";

export function helpText(): string {
  const b = color.bold;
  return `${b("Nex Wizard")}

Connect your application to Nex.

${b("Usage")}

  npx ${PACKAGE}@latest [command] [options]

${b("Commands")}

  init          Set up Nex in this app (default)
  doctor        Check the setup and what's wrong with it
  test          Send a test event with the app's configuration
  uninstall     Remove what the wizard added
  login         Sign in to Nex
  logout        Sign out and forget the saved sign-in

${b("Options")}

  -i, --integration <id>   Framework integration (detected when omitted)
      --dry-run            Show what would change, change nothing
  -y, --yes                Accept safe defaults, don't ask
      --org <slug>         Nex organization
      --project <slug>     Nex project
      --environment <slug> Project environment (default: production)
      --cwd <dir>          The app's directory (default: here)
      --api-url <url>      Another Nex server (default: Nex cloud)
      --debug              Show details of unexpected errors
  -h, --help               Show this help
  -v, --version            Show the version

${b("Supported integrations")}

  ${available().map((i) => i.id).join("\n  ")}

${b("Planned")} ${color.dim("(detected, SDK not available yet)")}

  ${planned().map((i) => i.id).join("\n  ")}

${b("CI")}

  Set NEX_TOKEN (and NEX_BROWSER_KEY for web apps) and pass --yes: the wizard
  configures the code without signing in or writing secrets to files.
`;
}
