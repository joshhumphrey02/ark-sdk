import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { WizardError } from "../core/errors";
import type { UI } from "../core/ui";
import { ApiError, type NexApi, type TokenPair } from "./api";
import { clearCredentials, readCredentials, saveCredentials } from "./credentials";

export type Pkce = { verifier: string; challenge: string; state: string };

export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url"), state: randomBytes(24).toString("base64url") };
}

export function authorizeUrl(webUrl: string, redirectUri: string, pkce: Pkce): string {
  const url = new URL("/authorize", webUrl);
  url.search = new URLSearchParams({
    redirect_uri: redirectUri,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state: pkce.state,
    client: "cli",
  }).toString();
  return url.toString();
}

const DONE_PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;background:#0b0d12;color:#e7e9ee;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:600">${title}</h1><p style="color:#9aa3b2">${body}</p></div>`;

/**
 * Waits on a loopback port for the browser to bring back the sign-in code
 * (RFC 8252). Only a request with the state this run created is accepted.
 */
export function listenForCode(state: string, timeoutMs: number): Promise<{ redirectUri: string; code: Promise<string>; close: () => void }> {
  return new Promise((resolve, reject) => {
    let settle!: { ok: (code: string) => void; fail: (error: Error) => void };
    const code = new Promise<string>((ok, fail) => (settle = { ok, fail }));
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      if (url.searchParams.get("state") !== state || !url.searchParams.get("code")) {
        res.writeHead(400, { "Content-Type": "text/html" }).end(DONE_PAGE("Sign-in didn't match", "Start again from your terminal."));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" }).end(DONE_PAGE("You're signed in", "You can close this tab and go back to your terminal."));
      settle.ok(url.searchParams.get("code")!);
    });
    const timer = setTimeout(() => settle.fail(new WizardError("Sign-in timed out.", "Run the wizard again and finish signing in within 5 minutes.")), timeoutMs);
    timer.unref();
    const close = () => {
      clearTimeout(timer);
      server.close();
    };
    void code.finally(close).catch(() => undefined);
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No loopback port"));
      resolve({ redirectUri: `http://127.0.0.1:${address.port}/callback`, code, close });
    });
  });
}

export function openBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The URL is printed too.
  }
}

export type Session = { api: NexApi; user: TokenPair["user"] | { email: string } };

function remember(api: NexApi, pair: TokenPair): void {
  saveCredentials({ apiUrl: api.apiUrl, refreshToken: pair.refreshToken, refreshTokenExpiresAt: pair.refreshTokenExpiresAt, user: { email: pair.user.email, name: pair.user.name ?? null } });
}

/** A saved sign-in, refreshed (refresh tokens are single-use, so the new one is saved). */
export async function resumeSession(api: NexApi): Promise<Session | null> {
  const saved = readCredentials(api.apiUrl);
  if (!saved) return null;
  try {
    const pair = await api.refresh(saved.refreshToken);
    remember(api, pair);
    return { api: api.withToken(pair.accessToken), user: pair.user };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 401)) {
      clearCredentials(api.apiUrl);
      return null;
    }
    throw error;
  }
}

export type SignInOptions = { open?: (url: string) => void; timeoutMs?: number; printOnly?: boolean };

/** Browser sign-in: the password is typed on the Nex site, never here. */
export async function signIn(api: NexApi, ui: UI, options: SignInOptions = {}): Promise<Session> {
  const index = await api.index();
  const webUrl = index.web?.url;
  if (!webUrl) throw new WizardError("This Nex server doesn't offer browser sign-in.", "Ask its operator to set MONITORING_CONSOLE_URL, or use an SDK token (NEX_TOKEN) instead.");
  const pkce = createPkce();
  const listener = await listenForCode(pkce.state, options.timeoutMs ?? 5 * 60_000);
  const url = authorizeUrl(webUrl, listener.redirectUri, pkce);
  if (options.printOnly) ui.info("Open this link to sign in to Nex:");
  else {
    ui.info("Opening Nex in your browser to sign in. If it doesn't open, use this link:");
    (options.open ?? openBrowser)(url);
  }
  ui.link(url);
  const spinner = ui.spinner("Waiting for you to sign in");
  let code: string;
  try {
    code = await listener.code;
  } catch (error) {
    spinner.fail("Not signed in");
    throw error;
  }
  try {
    const pair = await api.exchangeCode({ code, codeVerifier: pkce.verifier, redirectUri: listener.redirectUri });
    remember(api, pair);
    spinner.stop(`Signed in as ${pair.user.email}`);
    return { api: api.withToken(pair.accessToken), user: pair.user };
  } catch (error) {
    spinner.fail("Sign-in failed");
    if (error instanceof ApiError && error.status === 400) throw new WizardError("The sign-in code was refused or has expired.", "Run the wizard again and approve the sign-in in your browser.");
    throw error;
  }
}

export async function signOut(api: NexApi): Promise<boolean> {
  const saved = readCredentials(api.apiUrl);
  clearCredentials(api.apiUrl);
  if (!saved) return false;
  try {
    await api.logout(saved.refreshToken);
  } catch {
    // Already ended on the server, or unreachable: the local copy is gone either way.
  }
  return true;
}
