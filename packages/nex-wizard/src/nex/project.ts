import { hostname } from "node:os";
import { WizardError } from "../core/errors";
import type { UI } from "../core/ui";
import type { Application, Environment, NexApi, Organization } from "./api";

export type ProjectChoice = {
  organization: Organization;
  application: Application;
  environment: Environment;
  /** True when `application` doesn't exist yet (dry run of "create a project"). */
  pending?: boolean;
};

export type ProjectOptions = {
  yes: boolean;
  dryRun: boolean;
  org?: string;
  project?: string;
  environment?: string;
  /** Suggested name for a new project (from package.json). */
  suggestedName: string;
};

const NEW = "__new__";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function titleCase(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

async function chooseOrganization(api: NexApi, ui: UI, options: ProjectOptions): Promise<Organization> {
  const organizations = await api.organizations();
  if (!organizations.length) throw new WizardError("Your Nex account isn't in an organization yet.", "Create one in Nex (or accept an invitation), then run the wizard again.");
  if (options.org) {
    const found = organizations.find((o) => o.slug === options.org || o.id === options.org);
    if (!found) throw new WizardError(`No organization "${options.org}" on your account.`, `Yours: ${organizations.map((o) => o.slug).join(", ")}`);
    return found;
  }
  if (organizations.length === 1) return organizations[0]!;
  if (!ui.interactive) throw new WizardError("You're in several Nex organizations.", `Pick one with --org: ${organizations.map((o) => o.slug).join(", ")}`);
  return ui.select("Which Nex organization?", organizations.map((o) => ({ value: o, label: o.name, hint: o.slug })));
}

async function createProject(api: NexApi, ui: UI, organization: Organization, options: ProjectOptions): Promise<ProjectChoice> {
  if (!organization.permissions.includes("applications.create")) {
    throw new WizardError(`You can't create projects in ${organization.name}.`, "Ask an owner or admin to create it, or to give you permission, then pick it here.");
  }
  const suggested = titleCase(options.suggestedName);
  const name = ui.interactive && !options.yes ? await ui.text("Project name", { initial: suggested, validate: (v) => (v.trim() && slugify(v) ? undefined : "Enter a name with letters or digits") }) : suggested;
  const kind =
    ui.interactive && !options.yes
      ? await ui.select("Environment", [
          { value: "PRODUCTION", label: "production" },
          { value: "STAGING", label: "staging" },
          { value: "DEVELOPMENT", label: "development" },
        ])
      : "PRODUCTION";
  const slug = slugify(name);
  if (options.dryRun) {
    const env: Environment = { id: "(new)", name: kind.toLowerCase(), slug: kind.toLowerCase(), kind };
    return { organization, application: { id: "(new)", name: name.trim(), slug, environments: [env], services: [] }, environment: env, pending: true };
  }
  const spinner = ui.spinner(`Creating ${name.trim()}`);
  try {
    await api.createApplication(organization.slug, { name: name.trim(), slug, environments: [kind] });
    const application = await api.application(organization.slug, slug);
    spinner.stop(`Created project ${application.name}`);
    return { organization, application, environment: application.environments[0]! };
  } catch (error) {
    spinner.fail("Couldn't create the project");
    throw error;
  }
}

async function chooseEnvironment(ui: UI, application: Application, options: ProjectOptions): Promise<Environment> {
  const environments = application.environments;
  if (!environments.length) throw new WizardError(`${application.name} has no environments.`, "Add one in Nex, then run the wizard again.");
  if (options.environment) {
    const found = environments.find((e) => e.slug === options.environment || e.name === options.environment);
    if (!found) throw new WizardError(`${application.name} has no "${options.environment}" environment.`, `It has: ${environments.map((e) => e.slug).join(", ")}`);
    return found;
  }
  const production = environments.find((e) => e.kind === "PRODUCTION" || e.slug === "production") ?? environments[0]!;
  if (environments.length === 1 || !ui.interactive || options.yes) return production;
  return ui.select("Which environment is this setup for?", environments.map((e) => ({ value: e, label: e.name, hint: e.slug })), production);
}

/** The Nex project (organization, application, environment) this app reports to. */
export async function chooseProject(api: NexApi, ui: UI, options: ProjectOptions): Promise<ProjectChoice> {
  const organization = await chooseOrganization(api, ui, options);
  if (!organization.permissions.includes("tokens.manage")) {
    throw new WizardError(`You can't create SDK keys in ${organization.name}.`, "Ask an owner or admin of the organization to run the wizard, or to give you the tokens.manage permission.");
  }
  const applications = await api.applications(organization.slug);
  let application: Application;
  if (options.project) {
    const found = applications.find((a) => a.slug === options.project || a.id === options.project);
    if (!found) throw new WizardError(`No project "${options.project}" in ${organization.name}.`, applications.length ? `Projects: ${applications.map((a) => a.slug).join(", ")}` : "Run without --project to create one.");
    application = await api.application(organization.slug, found.slug);
  } else if (!ui.interactive || options.yes) {
    const match = applications.find((a) => a.slug === slugify(options.suggestedName));
    if (match) application = await api.application(organization.slug, match.slug);
    else if (applications.length === 1) application = await api.application(organization.slug, applications[0]!.slug);
    else return createProject(api, ui, organization, options);
  } else {
    const picked = await ui.search<string>("Select a Nex project", [
      ...applications.map((a) => ({ value: a.slug, label: a.name, hint: a.slug })),
      { value: NEW, label: "Create a new project" },
    ]);
    if (picked === NEW) return createProject(api, ui, organization, options);
    application = await api.application(organization.slug, picked);
  }
  return { organization, application, environment: await chooseEnvironment(ui, application, options) };
}

/** An SDK token (secret, shown once) and/or a browser key (public) for the chosen environment. */
export async function issueCredentials(
  api: NexApi,
  choice: ProjectChoice,
  needs: { server: boolean; browser: boolean },
  services: { server: string; browser: string },
): Promise<{ serverToken: string | null; browserKey: string | null }> {
  const org = choice.organization.slug;
  const app = choice.application.slug;
  const environmentId = choice.environment.id;
  const serverToken = needs.server ? (await api.createToken(org, app, { name: `Nex wizard · ${services.server} · ${hostname()}`.slice(0, 100), environmentId })).token : null;
  let browserKey: string | null = null;
  if (needs.browser) {
    // Browser keys are public and listable: reuse the one for this service and environment.
    const existing = await api
      .request<{ key: string; environmentId: string; service: { slug: string } | null; revokedAt?: string | null }[]>("GET", `/organizations/${encodeURIComponent(org)}/applications/${encodeURIComponent(app)}/client-keys`)
      .catch(() => []);
    const reuse = existing.find((k) => k.environmentId === environmentId && k.service?.slug === services.browser && !k.revokedAt);
    browserKey = reuse?.key ?? (await api.createBrowserKey(org, app, { name: `${services.browser} (Nex wizard)`, environmentId, service: services.browser })).key;
  }
  return { serverToken, browserKey };
}
