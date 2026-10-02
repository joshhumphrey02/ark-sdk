import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseFlags } from "../src/cli/args";
import { checkCompatibility, resolveApp, resolveIntegration, type Runtime } from "../src/commands/common";
import { choose, detectAll } from "../src/core/detect";
import { detectJsPackageManager, detectPythonPackageManager, jsAddCommand } from "../src/core/package-manager";
import { findApps, loadProject } from "../src/core/project";
import { fakeRunner, fixture, scriptedUI } from "./helpers";

const best = (files: Record<string, string | object>) => {
  const { best } = choose(detectAll(loadProject(fixture(files))));
  return best?.integration.id ?? null;
};
const pkg = (dependencies: Record<string, string>, extra: object = {}) => ({ "package.json": { name: "app", dependencies, ...extra } });

describe("framework detection", () => {
  test.each([
    ["nextjs", pkg({ next: "15.3.0", react: "19.0.0" })],
    ["react", pkg({ react: "19.0.0", vite: "6.0.0" })],
    ["angular", pkg({ "@angular/core": "19.0.0" })],
    ["vue", pkg({ vue: "3.5.0" })],
    ["svelte", { ...pkg({ "@sveltejs/kit": "2.0.0", svelte: "5.0.0" }), "svelte.config.js": "export default {};\n" }],
    ["astro", { ...pkg({ astro: "5.0.0" }), "astro.config.mjs": "export default {};\n" }],
    ["solid", pkg({ "solid-js": "1.9.0" })],
    ["nodejs", pkg({ express: "4.21.0" })],
    ["javascript", pkg({}, { devDependencies: { vite: "6.0.0" } })],
    ["python", { "requirements.txt": "fastapi==0.115.0\n" }],
    ["react-native", pkg({ react: "18.3.0", "react-native": "0.76.0" })],
    ["flutter", { "pubspec.yaml": "name: app\n" }],
    ["go", { "go.mod": "module example.com/app\n" }],
    ["ruby", { Gemfile: "gem 'rails'\n" }],
    ["php", { "composer.json": "{}" }],
    ["laravel", { "composer.json": '{"require":{"laravel/framework":"^11"}}', artisan: "#!/usr/bin/env php\n" }],
    ["swift", { "Package.swift": "// swift-tools-version:5.9\n" }],
    ["spring-boot", { "pom.xml": "<artifactId>spring-boot-starter-web</artifactId>" }],
  ] as const)("%s", (id, files) => {
    expect(best(files as Record<string, string | object>)).toBe(id);
  });

  test("Next.js wins over React; React Native over React", () => {
    expect(detectAll(loadProject(fixture(pkg({ next: "15.3.0", react: "19.0.0" })))).map((c) => c.integration.id)).toContain("nextjs");
    expect(best(pkg({ react: "18.3.0", "react-native": "0.76.0" }))).toBe("react-native");
  });

  test("a Django app with a React frontend in the same folder is ambiguous", () => {
    const { contenders } = choose(detectAll(loadProject(fixture({ ...pkg({ react: "19.0.0" }), "manage.py": "", "requirements.txt": "django==5.1\n" }))));
    expect(contenders.map((c) => c.integration.id).sort()).toEqual(["python", "react"]);
  });

  test("nothing recognisable", () => {
    expect(best({ "README.md": "# hi\n" })).toBeNull();
  });
});

describe("asking and refusing", () => {
  const runtime = (cwd: string, ui = scriptedUI(), argv: string[] = []): Runtime => ({ flags: parseFlags(argv, cwd), ui, runner: fakeRunner(), fetch });

  test("the detected integration is confirmed, or another is chosen", async () => {
    const dir = fixture(pkg({ next: "15.3.0", react: "19.0.0" }));
    const yes = scriptedUI({ "Use the Next.js integration?": true });
    expect((await resolveIntegration(runtime(dir, yes), loadProject(dir))).id).toBe("nextjs");
    const other = scriptedUI({ "Use the Next.js integration?": false, "Which integration?": (choices: { value: { id: string } }[]) => choices.find((c) => c.value.id === "react")!.value });
    expect((await resolveIntegration(runtime(dir, other), loadProject(dir))).id).toBe("react");
  });

  test("an ambiguous project is never guessed in --yes mode", async () => {
    const dir = fixture({ ...pkg({ react: "19.0.0" }), "requirements.txt": "flask\n" });
    await expect(resolveIntegration(runtime(dir, scriptedUI({}, false), ["--yes"]), loadProject(dir))).rejects.toThrow(/looks like/);
  });

  test("an incompatible framework version is refused with what is supported", () => {
    const context = loadProject(fixture(pkg({ next: "14.2.0" })));
    expect(() => checkCompatibility(context, detectAll(context)[0]!.integration)).toThrow(/version isn't supported/);
    expect(() => checkCompatibility(loadProject(fixture(pkg({ next: "^15.1.0" }))), detectAll(loadProject(fixture(pkg({ next: "15.1.0" }))))[0]!.integration)).not.toThrow();
  });

  test("no project here: an actionable error naming the folder", async () => {
    const dir = fixture({ "notes.txt": "x" });
    await expect(resolveApp(runtime(dir))).rejects.toThrow(/Couldn't find an application here/);
  });
});

describe("package managers", () => {
  test.each([
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ] as const)("%s → %s", (lockfile, manager) => {
    const dir = fixture({ "package.json": {}, [lockfile]: "" });
    expect(detectJsPackageManager(dir, dir).manager).toBe(manager);
  });

  test("the packageManager field, and the monorepo root's lockfile", () => {
    const dir = fixture({ "package.json": { packageManager: "pnpm@9.1.0" } });
    expect(detectJsPackageManager(dir, dir).manager).toBe("pnpm");
    const repo = fixture({ "package.json": { workspaces: ["apps/*"] }, "yarn.lock": "", "apps/web/package.json": {} });
    expect(detectJsPackageManager(join(repo, "apps/web"), repo).manager).toBe("yarn");
  });

  test("install commands use the project's manager", () => {
    expect(jsAddCommand("pnpm", ["x"])).toEqual(["pnpm", ["add", "x"]]);
    expect(jsAddCommand("yarn", ["x"])).toEqual(["yarn", ["add", "x"]]);
    expect(jsAddCommand("bun", ["x"])).toEqual(["bun", ["add", "x"]]);
    expect(jsAddCommand("npm", ["x"])).toEqual(["npm", ["install", "x"]]);
  });

  test.each([
    [{ "uv.lock": "" }, "uv"],
    [{ "poetry.lock": "" }, "poetry"],
    [{ "pyproject.toml": "[tool.poetry]\nname='x'\n" }, "poetry"],
    [{ Pipfile: "" }, "pipenv"],
    [{ "requirements.txt": "" }, "pip"],
  ] as const)("Python %o → %s", (files, manager) => {
    expect(detectPythonPackageManager(fixture(files as Record<string, string>)).manager).toBe(manager);
  });
});

describe("monorepos", () => {
  const repo = () =>
    fixture({
      "package.json": { name: "repo", private: true, workspaces: ["apps/*", "packages/*"] },
      "pnpm-lock.yaml": "",
      "apps/web/package.json": { name: "@acme/web", dependencies: { next: "15.3.0" } },
      "apps/api/package.json": { name: "@acme/api", dependencies: { express: "4.0.0" } },
      "packages/ui/package.json": { name: "@acme/ui" },
    });

  test("finds the apps in workspaces", () => {
    expect(findApps(repo()).map((a) => a.path)).toEqual(["apps/api", "apps/web", "packages/ui"]);
  });

  test("asks which app from the root, and refuses to guess with --yes", async () => {
    const root = repo();
    const ui = scriptedUI({ "Which application": "apps/web" });
    const context = await resolveApp({ flags: parseFlags([], root), ui, runner: fakeRunner(), fetch });
    expect(context.root).toBe(join(root, "apps/web"));
    expect(context.js?.manager).toBe("pnpm");
    await expect(resolveApp({ flags: parseFlags(["--yes"], root), ui: scriptedUI({}, false), runner: fakeRunner(), fetch })).rejects.toThrow(/Multiple applications/);
  });
});
