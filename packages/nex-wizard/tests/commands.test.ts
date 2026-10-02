import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/main";
import { credentialsPath, saveCredentials } from "../src/nex/credentials";
import { DEFAULT_API_URL } from "../src/nex/api";
import { KEY, TOKEN, approvingBrowser, fakeNex, fakeRunner, nextApp, read, scriptedUI, snapshot } from "./helpers";

const ENV = ["NEX_TOKEN", "NEX_BROWSER_KEY", "NEX_API_URL", "NEX_SERVICE", "NEX_ENVIRONMENT", "NEX_CONFIG_DIR", "CI"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env.NEX_CONFIG_DIR = mkdtempSync(join(tmpdir(), "nex-config-"));
});
afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** Installs as the package manager would: node_modules gets the SDK. */
function installingRunner(root: string) {
  return fakeRunner((command, args) => {
    if (args.some((a) => a.startsWith("@nerdstackgrp/nex-js"))) {
      mkdirSync(join(root, "node_modules/@nerdstackgrp/nex-js"), { recursive: true });
      writeFileSync(join(root, "node_modules/@nerdstackgrp/nex-js/package.json"), '{"version":"0.3.0"}');
    }
    void command;
    return {};
  });
}

const ANSWERS = { "Use the Next.js integration?": true, "Select a Nex project": "shop", "Which environment": (c: { value: unknown }[]) => c[0]!.value, "Continue?": "yes" };

async function runInit(root: string, extra: { argv?: string[]; ui?: ReturnType<typeof scriptedUI>; nex?: ReturnType<typeof fakeNex> } = {}) {
  const nex = extra.nex ?? fakeNex();
  const ui = extra.ui ?? scriptedUI(ANSWERS);
  const browser = approvingBrowser();
  const runner = installingRunner(root);
  const code = await main(["-i", "nextjs", ...(extra.argv ?? [])], { cwd: root, ui, fetch: nex.fetch, runner, openBrowser: browser.open });
  return { code, ui, nex, runner, browser };
}

describe("init: a fresh Next.js app", () => {
  test("signs in through the browser, connects the project, installs, configures and sends a test event", async () => {
    const root = nextApp();
    const { code, ui, nex, runner, browser } = await runInit(root);
    expect(ui.log.filter((l) => l.startsWith("✖"))).toEqual([]);
    expect(code).toBe(0);

    // Browser sign-in with PKCE on a loopback port, as the CLI client.
    const opened = new URL(browser.opened[0]!);
    expect(opened.origin + opened.pathname).toBe("https://nex.example.test/authorize");
    expect(opened.searchParams.get("client")).toBe("cli");
    expect(opened.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    const exchange = nex.calls.find((c) => c.path === "/auth/token")!;
    expect((exchange.body as { codeVerifier: string }).codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Installed with the project's package manager.
    expect(runner.calls).toEqual(["pnpm add @nerdstackgrp/nex-js@^0.3.0"]);

    // Credentials from the real API, into a git-ignored env file only.
    const env = read(root, ".env.local");
    expect(env).toContain("NEX_TOKEN=nsk_live_");
    expect(env).toContain(`NEXT_PUBLIC_NEX_KEY=${KEY}`);
    expect(read(root, ".gitignore")).toContain(".env.local");
    const files = snapshot(root);
    for (const [path, content] of Object.entries(files)) if (path !== ".env.local") expect(content).not.toMatch(/nsk_live_T/);
    expect(files["instrumentation.ts"]).toContain("nex.init");
    const manifest = JSON.parse(files[".nex-wizard.json"]!);
    expect(manifest.integration).toBe("nextjs");
    expect(manifest.application.slug).toBe("shop");
    expect(manifest.created.map((c: { path: string }) => c.path)).toEqual(["app/global-error.tsx", "instrumentation-client.ts", "instrumentation.ts"]);

    // Verified for real: credentials checked, a test event accepted.
    expect(nex.calls.some((c) => c.path === "/config" && c.auth?.startsWith("Bearer nsk_live_"))).toBe(true);
    expect(nex.calls.some((c) => c.path === "/events")).toBe(true);
    expect(ui.log).toContain("✔ Test event received by Nex");
    expect(ui.log.at(-1)).toContain("Nex is ready");

    // Secrets never reach the terminal.
    expect(ui.log.join("\n")).not.toContain("nsk_live_T");
    // The saved sign-in is private to the user.
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600);
  });

  test("running it again changes nothing and verifies", async () => {
    const root = nextApp();
    await runInit(root);
    const before = snapshot(root);
    const second = await runInit(root, { ui: scriptedUI({ "What would you like to do?": "verify" }) });
    expect(second.code).toBe(0);
    expect(second.ui.log).toContain("ℹ Nex is already configured in this app.");
    expect(snapshot(root)).toEqual(before);
    expect(second.nex.calls.some((c) => c.path.endsWith("/tokens"))).toBe(false);
  });

  test("a saved sign-in is reused, without the browser", async () => {
    saveCredentials({ apiUrl: DEFAULT_API_URL, refreshToken: "nsr_refresh_0", refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { email: "ada@example.com" } });
    const { browser, ui } = await runInit(nextApp());
    expect(browser.opened).toEqual([]);
    expect(ui.log).toContain("✔ Signed in as ada@example.com");
  });

  test("an expired saved sign-in falls back to the browser", async () => {
    saveCredentials({ apiUrl: DEFAULT_API_URL, refreshToken: "nsr_revoked", refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(), user: { email: "ada@example.com" } });
    const { browser, code } = await runInit(nextApp());
    expect(browser.opened).toHaveLength(1);
    expect(code).toBe(0);
  });

  test("creating a new project", async () => {
    const root = nextApp();
    const ui = scriptedUI({ ...ANSWERS, "Select a Nex project": "__new__", "Project name": "My Store", Environment: "PRODUCTION" });
    const { code, nex } = await runInit(root, { ui });
    expect(code).toBe(0);
    expect(nex.calls.find((c) => c.method === "POST" && c.path === "/organizations/acme/applications")?.body).toMatchObject({ name: "My Store", slug: "my-store", environments: ["PRODUCTION"] });
  });

  test("an existing NEX_TOKEN is not replaced without asking", async () => {
    const root = nextApp({ ".env.local": "NEX_TOKEN=mine\n" });
    const ui = scriptedUI({ ...ANSWERS, "NEX_TOKEN already exists": false });
    await runInit(root, { ui });
    expect(read(root, ".env.local")).toContain("NEX_TOKEN=mine");
    expect(ui.asked.some((q) => q.includes("NEX_TOKEN already exists"))).toBe(true);
  });

  test("edits to the developer's files are shown and can be cancelled", async () => {
    const root = nextApp({ "instrumentation.ts": "export function register() {\n  setup();\n}\n" });
    const before = snapshot(root);
    let shown = 0;
    const ui = scriptedUI({ ...ANSWERS, "Continue?": () => (shown++ === 0 ? "show" : "cancel") });
    const { code } = await runInit(root, { ui });
    expect(code).toBe(130);
    expect(ui.log.some((l) => l.startsWith("[instrumentation.ts]") && l.includes("nex:begin register"))).toBe(true);
    expect(snapshot(root)).toEqual(before);
  });
});

describe("dry run", () => {
  test("shows the plan and changes nothing, here or in Nex", async () => {
    const root = nextApp();
    const before = snapshot(root);
    const { code, ui, nex, runner } = await runInit(root, { argv: ["--dry-run"] });
    expect(code).toBe(0);
    expect(snapshot(root)).toEqual(before);
    expect(runner.calls).toEqual([]);
    expect(nex.calls.some((c) => c.method === "POST" && /tokens|client-keys|applications$/.test(c.path))).toBe(false);
    const plan = ui.log.find((l) => l.startsWith("[Dry run]"))!;
    expect(plan).toContain("@nerdstackgrp/nex-js");
    expect(plan).toContain("instrumentation.ts");
    expect(plan).toContain("NEX_TOKEN");
    expect(ui.log.at(-1)).toContain("No changes were made.");
  });
});

describe("uninstall", () => {
  test("puts every file back as it was", async () => {
    const root = nextApp({ "instrumentation.ts": 'import { registerOTel } from "@vercel/otel";\n\nexport function register() {\n  registerOTel({ serviceName: "shop" });\n}\n', ".env.local": "DATABASE_URL=postgres://x\n" });
    const before = snapshot(root);
    await runInit(root);
    expect(snapshot(root)).not.toEqual(before);
    const runner = fakeRunner();
    const code = await main(["uninstall"], { cwd: root, ui: scriptedUI({ "Remove Nex": true, "Uninstall @nerdstackgrp/nex-js": true }), runner, fetch: fakeNex().fetch });
    expect(code).toBe(0);
    expect(snapshot(root)).toEqual(before);
    expect(runner.calls).toEqual(["pnpm remove @nerdstackgrp/nex-js"]);
  });

  test("a fresh app is left exactly as it was, env file and all", async () => {
    const root = nextApp();
    const before = snapshot(root);
    await runInit(root);
    await main(["uninstall", "--yes"], { cwd: root, ui: scriptedUI({}, false), runner: fakeRunner(), fetch: fakeNex().fetch });
    expect(snapshot(root)).toEqual(before);
  });

  test("dry run lists what would be removed and removes nothing", async () => {
    const root = nextApp();
    await runInit(root);
    const before = snapshot(root);
    const ui = scriptedUI();
    await main(["uninstall", "--dry-run"], { cwd: root, ui, runner: fakeRunner(), fetch: fakeNex().fetch });
    expect(snapshot(root)).toEqual(before);
    expect(ui.log.join("\n")).toContain("instrumentation.ts");
  });

  test("a file the wizard created and the developer changed is kept", async () => {
    const root = nextApp();
    await runInit(root);
    writeFileSync(join(root, "app/global-error.tsx"), "export default function Mine() { return null; }\n");
    const ui = scriptedUI({ "Remove Nex": true, "Uninstall": false });
    await main(["uninstall"], { cwd: root, ui, runner: fakeRunner(), fetch: fakeNex().fetch });
    expect(read(root, "app/global-error.tsx")).toContain("Mine");
    expect(ui.log.join("\n")).toContain("app/global-error.tsx was created by the wizard and changed since");
  });
});

describe("CI", () => {
  test("with NEX_TOKEN and NEX_BROWSER_KEY: no sign-in, no secrets written", async () => {
    process.env.NEX_TOKEN = TOKEN;
    process.env.NEX_BROWSER_KEY = KEY;
    const root = nextApp();
    const { code, browser, nex } = await runInit(root, { argv: ["--yes"], ui: scriptedUI({}, false) });
    expect(code).toBe(0);
    expect(browser.opened).toEqual([]);
    expect(nex.calls.some((c) => c.path.startsWith("/auth"))).toBe(false);
    const files = snapshot(root);
    expect(files[".env.local"]).toBeUndefined();
    for (const content of Object.values(files)) expect(content).not.toContain(TOKEN);
    expect(files["instrumentation.ts"]).toContain("nex.init");
  });

  test("without credentials, a non-interactive run explains what to set", async () => {
    const { code, ui } = await runInit(nextApp(), { argv: ["--yes"], ui: scriptedUI({}, false) });
    expect(code).toBe(1);
    expect(ui.log.join("\n")).toContain("set NEX_TOKEN");
  });
});

describe("failures", () => {
  test("sign-in with a refused code", async () => {
    const root = nextApp();
    const ui = scriptedUI(ANSWERS);
    const code = await main(["-i", "nextjs"], { cwd: root, ui, fetch: fakeNex().fetch, runner: fakeRunner(), openBrowser: approvingBrowser("stolen-code").open });
    expect(code).toBe(1);
    expect(ui.log.join("\n")).toContain("The sign-in code was refused or has expired.");
    expect(snapshot(root)[".nex-wizard.json"]).toBeUndefined();
  });

  test("sign-in that never finishes times out", async () => {
    const { signIn } = await import("../src/nex/auth");
    const { NexApi } = await import("../src/nex/api");
    await expect(signIn(new NexApi(DEFAULT_API_URL, fakeNex().fetch), scriptedUI(), { open: () => undefined, timeoutMs: 50 })).rejects.toThrow(/timed out/);
  });

  test("Nex unreachable: a plain message, nothing changed", async () => {
    const root = nextApp();
    const before = snapshot(root);
    const { code, ui } = await runInit(root, { nex: fakeNex({ down: true }) });
    expect(code).toBe(1);
    expect(ui.log.join("\n")).toContain("Could not reach Nex");
    expect(snapshot(root)).toEqual(before);
  });

  test("an unknown --project", async () => {
    const { code, ui } = await runInit(nextApp(), { argv: ["--project", "nope"] });
    expect(code).toBe(1);
    expect(ui.log.join("\n")).toContain('No project "nope"');
  });

  test("no permission to create SDK keys", async () => {
    const nex = fakeNex({ fail: { "POST /organizations/acme/applications/shop/tokens": 403 } });
    const { code, ui } = await runInit(nextApp(), { nex });
    expect(code).toBe(1);
    expect(ui.log.join("\n")).toContain("doesn't have permission");
  });

  test("a failing test event is never reported as success", async () => {
    const nex = fakeNex({ fail: { "POST /events": 503 } });
    const { code, ui } = await runInit(nextApp(), { nex });
    expect(code).toBe(1);
    expect(ui.log.some((l) => l.startsWith("✖ Test event received by Nex"))).toBe(true);
    expect(ui.log.at(-1)).not.toContain("Nex is ready");
  });

  test("a planned framework is refused before anything happens", async () => {
    const root = nextApp();
    const ui = scriptedUI();
    const code = await main(["-i", "go"], { cwd: root, ui, fetch: fakeNex().fetch, runner: fakeRunner() });
    expect(code).toBe(2);
    expect(ui.log.join("\n")).toContain("A Nex SDK for Go isn't available yet.");
  });
});

describe("doctor and test", () => {
  test("doctor reports a healthy setup", async () => {
    const root = nextApp();
    await runInit(root);
    const ui = scriptedUI();
    const code = await main(["doctor"], { cwd: root, ui, runner: fakeRunner(), fetch: fakeNex().fetch });
    expect(code).toBe(0);
    expect(ui.log).toContain("✔ Instrumentation detected instrumentation.ts, instrumentation-client.ts, app/global-error.tsx");
  });

  test("doctor finds a revoked token", async () => {
    const root = nextApp();
    await runInit(root);
    writeFileSync(join(root, ".env.local"), readFileSync(join(root, ".env.local"), "utf8").replace(/NEX_TOKEN=\S+/, "NEX_TOKEN=revoked"));
    const ui = scriptedUI();
    const code = await main(["test"], { cwd: root, ui, runner: fakeRunner(), fetch: fakeNex().fetch });
    expect(code).toBe(1);
    expect(ui.log.some((l) => l.startsWith("✖ Project credentials valid"))).toBe(true);
  });
});

describe("command line", () => {
  test("help lists commands and integrations; version", async () => {
    let out = "";
    expect(await main(["--help"], { write: (t) => (out += t) })).toBe(0);
    expect(out).toContain("-i, --integration <id>");
    expect(out).toContain("doctor");
    expect(out).toContain("nextjs");
    expect(out).toContain("spring-boot");
    out = "";
    await main(["--version"], { write: (t) => (out += t) });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("unknown integration or command", async () => {
    const ui = scriptedUI();
    expect(await main(["-i", "cobol"], { ui })).toBe(1);
    expect(ui.log.join("\n")).toContain('Unknown integration "cobol"');
    expect(await main(["deploy"], { ui })).toBe(1);
  });

  test("--integration is the same as -i", async () => {
    const { parseFlags } = await import("../src/cli/args");
    expect(parseFlags(["--integration", "python"]).integration).toBe("python");
    expect(parseFlags(["-i", "nextjs", "--dry-run", "-y"])).toMatchObject({ integration: "nextjs", dryRun: true, yes: true, command: "init" });
  });
});
