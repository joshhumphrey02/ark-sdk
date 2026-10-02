import { describe, expect, test } from "bun:test";
import { loadProject, type ProjectContext } from "../src/core/project";
import { hasBlock, removeBlocks } from "../src/core/text";
import { INTEGRATIONS } from "../src/integrations/registry";
import type { IntegrationId, SetupValues } from "../src/integrations/types";
import { KEY, TOKEN, fixture, nextApp } from "./helpers";

const setup: SetupValues = {
  apiUrl: "https://nerdstackgrp.com/api/v1/monitoring",
  defaultApiUrl: true,
  serverToken: TOKEN,
  browserKey: KEY,
  service: "my-store",
  browserService: "my-store-web",
  environment: "production",
};

function configure(id: IntegrationId, root: string): { context: ProjectContext; result: ReturnType<(typeof INTEGRATIONS)[IntegrationId]["configure"]> } {
  const context = loadProject(root);
  const result = INTEGRATIONS[id].configure(context, setup);
  return { context, result };
}

const staged = (context: ProjectContext, path: string) => context.files.read(path) ?? "";

describe("Next.js", () => {
  test("a fresh app gets instrumentation, client instrumentation and a global error page", () => {
    const { context, result } = configure("nextjs", nextApp());
    const created = context.files.changes().filter((c) => c.before === null).map((c) => c.path);
    expect(created).toEqual(["app/global-error.tsx", "instrumentation-client.ts", "instrumentation.ts"]);
    expect(staged(context, "instrumentation.ts")).toContain('process.env.NEXT_RUNTIME === "nodejs"');
    expect(staged(context, "instrumentation.ts")).toContain("captureRequestError");
    expect(staged(context, "instrumentation-client.ts")).toContain("process.env.NEXT_PUBLIC_NEX_KEY");
    expect(staged(context, "app/global-error.tsx")).toContain('"use client"');
    expect(result.envFile).toBe(".env.local");
    expect(Object.keys(result.env).sort()).toEqual(["NEXT_PUBLIC_NEX_KEY", "NEX_API_URL", "NEX_ENVIRONMENT", "NEX_SERVICE", "NEX_TOKEN"]);
    // No secret in any generated source file.
    for (const change of context.files.changes()) if (!change.path.startsWith(".env")) expect(change.after).not.toContain(TOKEN);
  });

  test("uses src/ when the app lives there", () => {
    const { context } = configure("nextjs", nextApp({ "src/app/page.tsx": "export default function P() { return null; }\n", "app/layout.tsx": undefined as never }));
    void context;
    const root = fixture({ "package.json": { dependencies: { next: "15.3.0" } }, "tsconfig.json": "{}", "src/app/page.tsx": "x\n" });
    const c = loadProject(root);
    INTEGRATIONS.nextjs.configure(c, setup);
    expect(c.files.changes().map((x) => x.path)).toContain("src/instrumentation.ts");
    expect(c.files.changes().map((x) => x.path)).toContain("src/app/global-error.tsx");
  });

  test("an existing register() gets Nex inside it; the developer's code is kept", () => {
    const mine = `import { registerOTel } from "@vercel/otel";\n\nexport function register() {\n  registerOTel({ serviceName: "shop" });\n}\n`;
    const { context, result } = configure("nextjs", nextApp({ "instrumentation.ts": mine }));
    const after = staged(context, "instrumentation.ts");
    expect(after).toContain('registerOTel({ serviceName: "shop" });');
    expect(after.indexOf("nex:begin register")).toBeGreaterThan(after.indexOf("export function register()"));
    expect(after).toContain("void import(");
    expect(after).toContain("nex:begin on-request-error");
    expect(removeBlocks(after).trim()).toBe(mine.trim());
    expect(result.manual).toEqual([]);
  });

  test("an existing onRequestError is left alone and explained", () => {
    const mine = "export function register() {}\n\nexport async function onRequestError() {}\n";
    const { context, result } = configure("nextjs", nextApp({ "instrumentation.ts": mine }));
    expect(staged(context, "instrumentation.ts").match(/onRequestError/g)).toHaveLength(1);
    expect(result.manual.join("\n")).toContain("onRequestError");
  });

  test("an existing global-error page is not touched", () => {
    const page = '"use client";\nexport default function GlobalError() { return null; }\n';
    const { context, result } = configure("nextjs", nextApp({ "app/global-error.tsx": page }));
    expect(staged(context, "app/global-error.tsx")).toBe(page);
    expect(result.manual.join("\n")).toContain("global-error");
  });

  test("Next.js before 15.3 has no client instrumentation: said, not faked", () => {
    const root = fixture({ "package.json": { dependencies: { next: "15.1.0" } }, "app/page.tsx": "x\n" });
    const { context, result } = configure("nextjs", root);
    expect(context.files.exists("instrumentation-client.js")).toBe(false);
    expect(result.manual.join("\n")).toContain("15.3");
  });

  test("running twice changes nothing the second time", () => {
    const root = nextApp();
    const first = loadProject(root);
    INTEGRATIONS.nextjs.configure(first, setup);
    first.files.apply();
    const second = loadProject(root);
    INTEGRATIONS.nextjs.configure(second, setup);
    expect(second.files.changes()).toEqual([]);
  });

  test("an env file git doesn't ignore is added to .gitignore; one it ignores is not", () => {
    expect(staged(configure("nextjs", nextApp()).context, ".gitignore")).toContain(".env.local");
    const ignored = configure("nextjs", nextApp({ ".gitignore": ".env*.local\n" })).context;
    expect(ignored.files.changes().some((c) => c.path === ".gitignore")).toBe(false);
  });
});

describe("browser frameworks", () => {
  test("React (Vite): Nex starts at the top of src/main.tsx from VITE_ variables", () => {
    const main = 'import { createRoot } from "react-dom/client";\nimport App from "./App";\n\ncreateRoot(document.getElementById("root")!).render(<App />);\n';
    const { context, result } = configure("react", fixture({ "package.json": { dependencies: { react: "19.0.0" }, devDependencies: { vite: "6.0.0", typescript: "5" } }, "src/main.tsx": main }));
    const after = staged(context, "src/main.tsx");
    expect(after.startsWith("// nex:begin init")).toBe(true);
    expect(after).toContain("import.meta.env.VITE_NEX_KEY");
    expect(removeBlocks(after)).toBe(main);
    expect(result.env).toEqual({ VITE_NEX_KEY: KEY });
  });

  test("Create React App uses REACT_APP_ variables", () => {
    const { result, context } = configure("react", fixture({ "package.json": { dependencies: { react: "18.0.0", "react-scripts": "5.0.0" } }, "src/index.js": "render();\n" }));
    expect(staged(context, "src/index.js")).toContain("process.env.REACT_APP_NEX_KEY");
    expect(result.env).toEqual({ REACT_APP_NEX_KEY: KEY });
  });

  test("Vue: init plus app.config.errorHandler after createApp", () => {
    const main = 'import { createApp } from "vue";\nimport App from "./App.vue";\n\nconst app = createApp(App);\napp.mount("#app");\n';
    const { context } = configure("vue", fixture({ "package.json": { dependencies: { vue: "3.5.0" }, devDependencies: { vite: "6" } }, "src/main.ts": main }));
    const after = staged(context, "src/main.ts");
    expect(after).toContain("app.config.errorHandler");
    expect(after.indexOf("errorHandler")).toBeLessThan(after.indexOf('app.mount("#app")'));
    expect(removeBlocks(after)).toBe(main);
  });

  test("Angular: an error handler provider, the public key in src/nex.ts", () => {
    const config = 'import { ApplicationConfig } from "@angular/core";\nimport { provideRouter } from "@angular/router";\n\nexport const appConfig: ApplicationConfig = {\n  providers: [provideRouter(routes)],\n};\n';
    const { context, result } = configure("angular", fixture({ "package.json": { dependencies: { "@angular/core": "19.0.0" } }, "angular.json": "{}", "src/app/app.config.ts": config }));
    expect(staged(context, "src/nex.ts")).toContain(KEY);
    const after = staged(context, "src/app/app.config.ts");
    expect(after).toContain("{ provide: NexAngularErrorHandler, useClass: NexErrorHandler },");
    expect(after).toContain('import { NexErrorHandler } from "../nex";');
    expect(after).toContain("provideRouter(routes)]");
    expect(result.envFile).toBeNull();
  });

  test("SvelteKit: client and server hooks, a handleError the app already has is left alone", () => {
    const root = fixture({
      "package.json": { dependencies: { "@sveltejs/kit": "2.8.0", svelte: "5.0.0" }, devDependencies: { typescript: "5" } },
      "svelte.config.js": "export default {};\n",
      "src/hooks.server.ts": "export const handleError = () => {};\n",
    });
    const { context, result } = configure("svelte", root);
    expect(staged(context, "src/hooks.client.ts")).toContain("export const handleError: HandleClientError");
    expect(staged(context, "src/hooks.server.ts")).toContain("$env/dynamic/private");
    expect(staged(context, "src/hooks.server.ts").match(/export const handleError/g)).toHaveLength(1);
    expect(result.manual.join("\n")).toContain("hooks.server.ts has its own handleError");
    expect(Object.keys(result.env)).toContain("PUBLIC_NEX_KEY");
    expect(Object.keys(result.env)).toContain("NEX_TOKEN");
  });

  test("Astro: a local integration that loads the browser script on every page", () => {
    const config = 'import { defineConfig } from "astro/config";\nimport mdx from "@astrojs/mdx";\n\nexport default defineConfig({\n  integrations: [mdx()],\n});\n';
    const { context } = configure("astro", fixture({ "package.json": { dependencies: { astro: "5.0.0" } }, "astro.config.mjs": config }));
    const after = staged(context, "astro.config.mjs");
    expect(after).toContain("const nexIntegration");
    expect(after).toContain("nexIntegration,");
    expect(after).toContain("mdx()");
    expect(staged(context, "src/nex.client.js")).toContain("PUBLIC_NEX_KEY");
    expect(removeBlocks(after).replace(/\s+/g, "")).toBe(config.replace(/\s+/g, ""));
  });

  test("Solid: Nex at the top of src/index.tsx", () => {
    const { context } = configure("solid", fixture({ "package.json": { dependencies: { "solid-js": "1.9.0" } }, "src/index.tsx": "render(() => <App />, root);\n" }));
    expect(hasBlock(staged(context, "src/index.tsx"), "init")).toBe(true);
  });
});

describe("Node.js", () => {
  test("Express: init at the top, request tracing after the app, errors before listen", () => {
    const server = 'import express from "express";\n\nconst app = express();\napp.get("/", (_req, res) => res.send("ok"));\n\napp.listen(3000);\n';
    const root = fixture({ "package.json": { type: "module", main: "src/index.ts", dependencies: { express: "4.21.0" } }, "src/index.ts": server, "tsconfig.json": "{}" });
    const { context, result } = configure("nodejs", root);
    const after = staged(context, "src/index.ts");
    expect(after.startsWith("// nex:begin init")).toBe(true);
    expect(after.indexOf("httpMiddleware")).toBeGreaterThan(after.indexOf("const app = express()"));
    expect(after.indexOf("errorHandler")).toBeLessThan(after.indexOf("app.listen(3000)"));
    expect(after.indexOf("errorHandler")).toBeGreaterThan(after.indexOf('app.get("/"'));
    expect(removeBlocks(after)).toBe(server);
    expect(result.env.NEX_TOKEN).toBe(TOKEN);
    expect(result.manual.join("\n")).toContain("--env-file");
  });

  test("Node: init after require('dotenv').config()", () => {
    const server = "require('dotenv').config();\nconst express = require('express');\nconst app = express();\napp.listen(3000);\n";
    const { context } = configure("nodejs", fixture({ "package.json": { main: "index.js", dependencies: { express: "4", dotenv: "16" } }, "index.js": server }));
    const after = staged(context, "index.js");
    expect(after.indexOf("nex.init(")).toBeGreaterThan(after.indexOf("require('dotenv').config();"));
    expect(removeBlocks(after)).toBe(server);
  });

  test("CommonJS gets require()", () => {
    const { context } = configure("nodejs", fixture({ "package.json": { main: "server.js", dependencies: { fastify: "5.0.0" } }, "server.js": "const fastify = require('fastify')();\n" }));
    expect(staged(context, "server.js")).toContain('const nex = require("@nerdstackgrp/nex-js/server");');
  });
});

describe("Python", () => {
  test("FastAPI: init at the top, middleware after the app, nex-python in requirements", () => {
    const main = '"""API."""\nfrom fastapi import FastAPI\n\napp = FastAPI(\n    title="Shop",\n)\n\n\n@app.get("/")\ndef root():\n    return {}\n';
    const { context, result } = configure("python", fixture({ "requirements.txt": "fastapi==0.115.0\n", "app/main.py": main }));
    const after = staged(context, "app/main.py");
    expect(after.indexOf("nex:begin init")).toBeGreaterThan(after.indexOf('"""API."""'));
    expect(after.indexOf("add_middleware")).toBeGreaterThan(after.indexOf('title="Shop"'));
    expect(after.indexOf("add_middleware")).toBeLessThan(after.indexOf("@app.get"));
    expect(removeBlocks(after)).toBe(main);
    expect(staged(context, "requirements.txt")).toContain("nex-python>=0.1.0");
    expect(result.env.NEX_SERVICE).toBe("my-store");
  });

  test("init runs after the app loads its .env, or it would start without a token", () => {
    const main = '"""API."""\nfrom dotenv import load_dotenv\n\nload_dotenv()\n\nfrom fastapi import FastAPI\n\napp = FastAPI()\n';
    const { context } = configure("python", fixture({ "requirements.txt": "fastapi\npython-dotenv\n", "main.py": main }));
    const after = staged(context, "main.py");
    expect(after.indexOf("nex.init(")).toBeGreaterThan(after.indexOf("load_dotenv()\n"));
    expect(removeBlocks(after)).toBe(main);
  });

  test("Flask app factory: indented to match", () => {
    const factory = "from flask import Flask\n\ndef create_app():\n    app = Flask(__name__)\n    return app\n";
    const { context } = configure("python", fixture({ "requirements.txt": "flask\n", "app.py": factory }));
    expect(staged(context, "app.py")).toContain("    if nex.get_client() is not None:\n        app.wsgi_app = nex.MonitoringWSGIMiddleware");
  });

  test("Django: wsgi.py and asgi.py are wrapped, with the database check", () => {
    const wsgi = 'import os\nfrom django.core.wsgi import get_wsgi_application\n\nos.environ.setdefault("DJANGO_SETTINGS_MODULE", "shop.settings")\n\napplication = get_wsgi_application()\n';
    const { context } = configure("python", fixture({ "manage.py": "", "requirements.txt": "django\n", "shop/wsgi.py": wsgi, "shop/asgi.py": wsgi.replaceAll("wsgi", "asgi") }));
    expect(staged(context, "shop/wsgi.py")).toContain("nex.MonitoringWSGIMiddleware(application");
    expect(staged(context, "shop/asgi.py")).toContain("nex.MonitoringASGIMiddleware(application");
    expect(staged(context, "shop/wsgi.py")).toContain("nex.checks.django()");
    expect(removeBlocks(staged(context, "shop/wsgi.py"))).toBe(wsgi);
  });

  test("uv projects aren't edited by hand: uv records the dependency", () => {
    const { context } = configure("python", fixture({ "pyproject.toml": '[project]\nname = "x"\ndependencies = [\n    "fastapi",\n]\n', "uv.lock": "", "main.py": "app = FastAPI()\n" }));
    expect(context.files.changes().some((c) => c.path === "pyproject.toml")).toBe(false);
  });
});

test("planned integrations refuse plainly instead of installing anything", () => {
  const context = loadProject(fixture({ "go.mod": "module x\n" }));
  expect(() => INTEGRATIONS.go.configure(context, setup)).toThrow(/isn't available yet/);
  expect(INTEGRATIONS.go.sdk).toBeNull();
});
