import type { IntegrationId } from "../integrations/types";
import { sha256, type FileChange, type Workspace } from "./workspace";

export const MANIFEST = ".nex-wizard.json";

/**
 * What the wizard did to this app, for `uninstall` and for a second run.
 * No secrets: tokens live only in the env file, which git ignores.
 */
export type Manifest = {
  version: 1;
  integration: IntegrationId;
  updatedAt: string;
  apiUrl: string;
  organization: { id: string; slug: string; name: string } | null;
  application: { id: string; slug: string; name: string } | null;
  environment: { id: string | null; slug: string; name: string } | null;
  services: { server: string | null; browser: string | null };
  /** Files the wizard created, with their content hash: removed on uninstall only if unchanged. */
  created: { path: string; sha256: string }[];
  /** Files the wizard added a fenced block to. */
  modified: string[];
  envFile: string | null;
  /** The wizard created the env file, so uninstall may delete it once empty. */
  envFileCreated: boolean;
  envKeys: string[];
  packages: { ecosystem: string; manager: string; name: string }[];
};

export function readManifest(files: Workspace): Manifest | null {
  const manifest = files.json<Manifest>(MANIFEST);
  return manifest?.version === 1 ? manifest : null;
}

/** Folds this run's changes into the manifest (a re-run keeps what the first run created). */
export function recordChanges(previous: Manifest | null, base: Omit<Manifest, "created" | "modified" | "updatedAt" | "packages" | "envKeys">, changes: FileChange[], extra: { packages: Manifest["packages"]; envKeys: string[] }): Manifest {
  const created = new Map((previous?.created ?? []).map((entry) => [entry.path, entry.sha256]));
  const modified = new Set(previous?.modified ?? []);
  for (const change of changes) {
    // The env file holds secrets: it's tracked by name only (envFile), never hashed.
    if (change.path === MANIFEST || change.path === base.envFile) continue;
    if (change.before === null || created.has(change.path)) created.set(change.path, sha256(change.after));
    else modified.add(change.path);
  }
  const packages = [...(previous?.packages ?? []), ...extra.packages].filter((p, i, all) => all.findIndex((q) => q.name === p.name && q.ecosystem === p.ecosystem) === i);
  return {
    ...base,
    version: 1,
    updatedAt: new Date().toISOString(),
    created: [...created].map(([path, hash]) => ({ path, sha256: hash })).sort((a, b) => a.path.localeCompare(b.path)),
    modified: [...modified].filter((path) => !created.has(path)).sort(),
    packages,
    envKeys: [...new Set([...(previous?.envKeys ?? []), ...extra.envKeys])].sort(),
  };
}
