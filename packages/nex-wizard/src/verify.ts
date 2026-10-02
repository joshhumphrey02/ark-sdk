import { installedJsVersion, installedPythonVersion } from "./core/install";
import type { Runner } from "./core/exec";
import type { ProjectContext } from "./core/project";
import { hasBlock, parseEnv } from "./core/text";
import type { Integration } from "./integrations/types";
import { ApiError, DEFAULT_API_URL, NexApi, type Fetch } from "./nex/api";

const ENV_FILES = [".env.local", ".env", ".env.development.local", ".env.development", ".env.production.local", ".env.production"];
const KEY_VARS = ["NEXT_PUBLIC_NEX_KEY", "VITE_NEX_KEY", "PUBLIC_NEX_KEY", "REACT_APP_NEX_KEY", "VUE_APP_NEX_KEY", "NEX_BROWSER_KEY"];
const API_VARS = ["NEX_API_URL", "NEXT_PUBLIC_NEX_API_URL", "VITE_NEX_API_URL", "PUBLIC_NEX_API_URL", "REACT_APP_NEX_API_URL", "VUE_APP_NEX_API_URL"];

/** The Nex settings the app will run with: env files (first wins), then the process environment. */
export type NexSettings = {
  apiUrl: string;
  token: string | null;
  browserKey: string | null;
  service: string | null;
  environment: string | null;
  /** Where each was found, by variable name. */
  sources: Record<string, string>;
};

export function readSettings(context: ProjectContext): NexSettings {
  const sources: Record<string, string> = {};
  const values = new Map<string, string>();
  for (const file of ENV_FILES) {
    const content = context.files.read(file);
    if (content === null) continue;
    for (const [key, value] of parseEnv(content)) {
      if (!values.has(key) && value) {
        values.set(key, value);
        sources[key] = file;
      }
    }
  }
  const get = (...names: string[]) => {
    for (const name of names) {
      const value = values.get(name) ?? process.env[name];
      if (value) {
        sources[name] ??= "environment";
        return value;
      }
    }
    return null;
  };
  // Angular keeps its (public) key in source.
  const angularKey = /nex_pub_[A-Za-z0-9_-]+/.exec(context.files.read("src/nex.ts") ?? "")?.[0] ?? null;
  return {
    apiUrl: get(...API_VARS) ?? DEFAULT_API_URL,
    token: get("NEX_TOKEN", "MONITORING_TOKEN"),
    browserKey: get(...KEY_VARS) ?? angularKey,
    service: get("NEX_SERVICE", "MONITORING_SERVICE"),
    environment: get("NEX_ENVIRONMENT", "MONITORING_ENVIRONMENT"),
    sources,
  };
}

export type Check = { label: string; ok: boolean; detail?: string; fix?: string; skipped?: boolean };

export type VerifyOptions = { runner: Runner; fetch?: Fetch; sendTestEvent: boolean; service?: string };

/** Each thing that has to be right for events to reach Nex, checked for real. */
export async function verify(context: ProjectContext, integration: Integration, options: VerifyOptions): Promise<{ checks: Check[]; settings: NexSettings }> {
  const checks: Check[] = [];
  const settings = readSettings(context);
  const needs = integration.needs(context);

  if (integration.sdk) {
    const version = integration.sdk.registry === "npm" ? installedJsVersion(context, integration.sdk.name) : await installedPythonVersion(context, options.runner);
    checks.push(version ? { label: `SDK installed (${integration.sdk.name} ${version})`, ok: true } : { label: "SDK installed", ok: false, fix: `Install ${integration.sdk.name} (run the wizard again).` });
  }

  const files = integration.instrumentationFiles(context);
  const instrumented = files.filter((file) => hasBlock(context.files.read(file) ?? "") || (context.files.read(file) ?? "").includes(integration.sdk?.name === "nex-python" ? "nex_py" : "@nerdstackgrp/nex-js"));
  checks.push(instrumented.length ? { label: "Instrumentation detected", ok: true, detail: instrumented.join(", ") } : { label: "Instrumentation detected", ok: false, fix: "Run the wizard again to add it." });

  if (needs.server) checks.push(settings.token ? { label: "SDK token configured (NEX_TOKEN)", ok: true, detail: settings.sources.NEX_TOKEN } : { label: "SDK token configured", ok: false, fix: "Set NEX_TOKEN (run the wizard again to create one)." });
  if (needs.browser) checks.push(settings.browserKey ? { label: "Browser key configured", ok: true } : { label: "Browser key configured", ok: false, fix: "Run the wizard again to add the browser key." });

  const api = new NexApi(settings.apiUrl, options.fetch);
  const reachable = await api.health();
  checks.push(reachable ? { label: "Nex reachable", ok: true, detail: new URL(settings.apiUrl).host } : { label: "Nex reachable", ok: false, detail: settings.apiUrl, fix: "Check your network connection, or NEX_API_URL." });
  if (!reachable) return { checks, settings };

  if (needs.server && settings.token) {
    try {
      const config = await api.withToken(settings.token).sdkConfig();
      checks.push({ label: "Project credentials valid", ok: true, detail: `${config.application.name} · ${config.environment.name}` });
    } catch (error) {
      checks.push({ label: "Project credentials valid", ok: false, detail: error instanceof ApiError ? error.detail : String(error), fix: "The token was revoked or mistyped: run the wizard again to create a new one." });
      return { checks, settings };
    }
  }

  if (!options.sendTestEvent) return { checks, settings };
  try {
    if (needs.server && settings.token) await api.withToken(settings.token).sendTestEvent(settings.service ?? options.service ?? "app", settings.environment ?? undefined);
    else if (settings.browserKey) await api.sendBrowserTestEvent(settings.browserKey);
    else throw new Error("no credentials");
    checks.push({ label: "Test event received by Nex", ok: true });
  } catch (error) {
    checks.push({ label: "Test event received by Nex", ok: false, detail: error instanceof ApiError ? error.detail : error instanceof Error ? error.message : String(error), fix: "Run `npx @nerdstackgrp/nex-wizard doctor` for details." });
  }
  return { checks, settings };
}
