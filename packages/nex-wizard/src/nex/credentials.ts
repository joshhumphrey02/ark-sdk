import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Where the wizard keeps the person's Nex sign-in between runs: the refresh
 * token only (access tokens live 15 minutes and stay in memory). Readable by
 * the person alone (0600), outside any project, never printed.
 */
export type StoredCredentials = { apiUrl: string; refreshToken: string; refreshTokenExpiresAt: string; user: { email: string; name?: string | null } };

export function credentialsPath(): string {
  const base = process.env.NEX_CONFIG_DIR || (process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, "nex") : join(homedir(), ".config", "nex"));
  return join(base, "credentials.json");
}

/** Signed-in sessions, one per Nex server. */
export function readCredentials(apiUrl: string): StoredCredentials | null {
  try {
    const all = JSON.parse(readFileSync(credentialsPath(), "utf8")) as Record<string, StoredCredentials>;
    const found = all[apiUrl];
    if (!found || Date.parse(found.refreshTokenExpiresAt) <= Date.now()) return null;
    return found;
  } catch {
    return null;
  }
}

function writeAll(all: Record<string, StoredCredentials>): void {
  const path = credentialsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function saveCredentials(credentials: StoredCredentials): void {
  let all: Record<string, StoredCredentials> = {};
  try {
    all = JSON.parse(readFileSync(credentialsPath(), "utf8")) as Record<string, StoredCredentials>;
  } catch {
    // First sign-in.
  }
  all[credentials.apiUrl] = credentials;
  writeAll(all);
}

export function clearCredentials(apiUrl: string): void {
  const path = credentialsPath();
  if (!existsSync(path)) return;
  try {
    const all = JSON.parse(readFileSync(path, "utf8")) as Record<string, StoredCredentials>;
    delete all[apiUrl];
    if (Object.keys(all).length) writeAll(all);
    else rmSync(path);
  } catch {
    rmSync(path, { force: true });
  }
}
