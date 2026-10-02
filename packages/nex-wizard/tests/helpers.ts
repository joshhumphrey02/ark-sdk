import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import type { CommandResult, Runner } from "../src/core/exec";
import type { Choice, Spinner, UI } from "../src/core/ui";

/** A temporary app folder with these files. */
export function fixture(files: Record<string, string | object>): string {
  const root = mkdtempSync(join(tmpdir(), "nex-wizard-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  return root;
}

/** Every file under `root` (except node_modules), as path → content. */
export function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(root, path)] = readFileSync(path, "utf8");
    }
  };
  walk(root);
  return out;
}

export const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

type Answer = unknown | ((choices: Choice<unknown>[]) => unknown);

/**
 * A UI that answers prompts from a script (matched by a fragment of the
 * question) and records what was said. An unscripted question fails the test.
 */
export function scriptedUI(answers: Record<string, Answer> = {}, interactive = true): UI & { log: string[]; asked: string[] } {
  const log: string[] = [];
  const asked: string[] = [];
  const answer = (message: string, choices?: Choice<unknown>[]) => {
    asked.push(message);
    const key = Object.keys(answers).find((k) => message.includes(k));
    if (key === undefined) throw new Error(`Unscripted prompt: ${message}`);
    const value = answers[key];
    if (typeof value === "function") return (value as (c: Choice<unknown>[]) => unknown)(choices ?? []);
    if (choices && typeof value === "string" && !choices.some((c) => c.value === value)) {
      const byLabel = choices.find((c) => c.label === value);
      if (byLabel) return byLabel.value;
    }
    return value;
  };
  const spinner = (message: string): Spinner => {
    log.push(`… ${message}`);
    return { stop: (m) => log.push(`✔ ${m}`), fail: (m) => log.push(`✖ ${m}`), message: () => undefined };
  };
  return {
    interactive,
    log,
    asked,
    intro: (m) => log.push(`# ${m}`),
    outro: (m) => log.push(`= ${m}`),
    step: (m) => log.push(`> ${m}`),
    success: (m) => log.push(`✔ ${m}`),
    info: (m) => log.push(`ℹ ${m}`),
    warn: (m) => log.push(`⚠ ${m}`),
    error: (m) => log.push(`✖ ${m}`),
    note: (body, title) => log.push(`[${title ?? ""}] ${body}`),
    link: (url) => log.push(`🔗 ${url}`),
    spinner,
    select: async <T,>(message: string, choices: Choice<T>[]) => answer(message, choices as Choice<unknown>[]) as T,
    search: async <T,>(message: string, choices: Choice<T>[]) => answer(message, choices as Choice<unknown>[]) as T,
    confirm: async (message: string) => answer(message) as boolean,
    text: async (message: string, opts?: { initial?: string }) => {
      const value = answer(message);
      return (value === undefined ? opts?.initial : value) as string;
    },
  };
}

/** Records commands instead of running them; `respond` can fake output. */
export function fakeRunner(respond: (command: string, args: string[]) => Partial<CommandResult> = () => ({})): Runner & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(command, args) {
      calls.push([command, ...args].join(" "));
      return { code: 0, stdout: "", stderr: "", ...respond(command, args) };
    },
  };
}

export const TOKEN = `nsk_live_${"A".repeat(43)}`;
export const KEY = `nex_pub_${"b".repeat(43)}`;

type Call = { method: string; path: string; body: unknown; auth: string | null; query: Record<string, string> };

/**
 * A Nex API with one organization ("acme") and one project ("shop"), the
 * sign-in endpoints, and telemetry. `fail` makes chosen routes error.
 */
export function fakeNex(options: { fail?: Record<string, number>; projects?: { slug: string; name: string }[]; down?: boolean } = {}) {
  const calls: Call[] = [];
  const projects = options.projects ?? [{ slug: "shop", name: "Shop" }];
  let tokens = 0;
  const detail = (slug: string) => ({
    id: `app_${slug}`,
    slug,
    name: projects.find((p) => p.slug === slug)?.name ?? slug,
    environments: [
      { id: "env_prod", name: "Production", slug: "production", kind: "PRODUCTION" },
      { id: "env_dev", name: "Development", slug: "development", kind: "DEVELOPMENT" },
    ],
    services: [],
  });
  const fetchImpl = (async (input: URL | string, init: RequestInit = {}) => {
    if (options.down) throw new TypeError("fetch failed");
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1\/monitoring/, "") || "/";
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const headers = new Headers(init.headers);
    calls.push({ method, path, body, auth: headers.get("authorization"), query: Object.fromEntries(url.searchParams) });
    const key = `${method} ${path}`;
    if (options.fail?.[key]) return Response.json({ detail: `failed ${key}` }, { status: options.fail[key] });
    const json = (data: unknown, status = 200) => Response.json(data, { status });
    const pair = (n: number) => ({
      accessToken: `access_${n}`,
      accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
      refreshToken: `nsr_refresh_${n}`,
      refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      user: { id: "u1", email: "ada@example.com", name: "Ada" },
    });
    if (key === "GET /") return json({ web: { url: "https://nex.example.test" } });
    if (key === "GET /health") return json({ ok: true });
    if (key === "POST /auth/token") return body.code === "good-code" && body.client === "cli" ? json(pair(1)) : json({ detail: "Invalid code" }, 400);
    if (key === "POST /auth/refresh") return body.refreshToken.startsWith("nsr_refresh_") ? json(pair(2)) : json({ detail: "Session ended" }, 401);
    if (key === "POST /auth/logout") return json({ ok: true });
    if (key === "GET /organizations") return json([{ id: "org1", name: "Acme", slug: "acme", role: "OWNER", permissions: ["applications.create", "tokens.manage"] }]);
    if (key === "GET /organizations/acme/applications") return json(projects.map((p) => ({ id: `app_${p.slug}`, ...p })));
    const app = /^\/organizations\/acme\/applications\/([\w-]+)(\/.*)?$/.exec(path);
    if (app && method === "GET" && !app[2]) return projects.some((p) => p.slug === app[1]) ? json(detail(app[1]!)) : json({ detail: "Not found" }, 404);
    if (key === "POST /organizations/acme/applications") {
      projects.push({ slug: body.slug, name: body.name });
      return json(detail(body.slug), 201);
    }
    if (app?.[2] === "/tokens" && method === "POST") return json({ token: `nsk_live_${String(++tokens).padStart(43, "T")}`, record: {} }, 201);
    if (app?.[2] === "/client-keys" && method === "GET") return json([]);
    if (app?.[2] === "/client-keys" && method === "POST") return json({ key: KEY }, 201);
    if (key === "GET /config") return headers.get("authorization")?.startsWith("Bearer nsk_") ? json({ application: { id: "app_shop", name: "Shop", slug: "shop" }, environment: { id: "env_prod", name: "Production", slug: "production" } }) : json({ detail: "Invalid token" }, 401);
    if (key === "POST /events") return json({ ok: true, accepted: 1, events: [] }, 202);
    if (key === "POST /browser/events") return url.searchParams.get("key")?.startsWith("nex_pub_") ? json({ ok: true, accepted: 1 }, 202) : json({ detail: "Invalid key" }, 401);
    return json({ detail: `No fake for ${key}` }, 404);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

/** Plays the browser: approves the sign-in by calling the loopback callback with a code. */
export function approvingBrowser(code = "good-code") {
  const opened: string[] = [];
  return {
    opened,
    open(url: string) {
      opened.push(url);
      const target = new URL(url);
      const redirect = target.searchParams.get("redirect_uri")!;
      const state = target.searchParams.get("state")!;
      setTimeout(() => void fetch(`${redirect}?code=${code}&state=${state}`).catch(() => undefined), 10);
    },
  };
}

export function nextApp(extra: Record<string, string | object> = {}) {
  return fixture({
    "package.json": { name: "my-store", dependencies: { next: "15.3.2", react: "19.0.0", "react-dom": "19.0.0" }, devDependencies: { typescript: "5.7.2" } },
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "tsconfig.json": "{}\n",
    "app/layout.tsx": "export default function Layout({ children }: { children: React.ReactNode }) {\n  return <html><body>{children}</body></html>;\n}\n",
    "app/page.tsx": "export default function Page() {\n  return <h1>Shop</h1>;\n}\n",
    ".gitignore": "node_modules\n.next\n",
    ...extra,
  });
}
