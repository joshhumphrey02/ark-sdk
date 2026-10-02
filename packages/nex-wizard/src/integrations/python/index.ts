import type { ProjectContext } from "../../core/project";
import { block, hasBlock, indentOf, insertAfterLine, statementEndLine } from "../../core/text";
import { SDKS } from "../../sdks";
import { NO_SOURCE_MAPS, ensureIgnored, prependOnce, releasesFromCi, serverEnv } from "../shared";
import type { Integration } from "../types";

export type PythonFramework = "django" | "fastapi" | "flask" | "plain";

const has = (context: ProjectContext, name: string) => new RegExp(`(^|[\\s"'\\[,])${name}\\b`, "m").test(context.python?.dependencies ?? "");

export function pythonFramework(context: ProjectContext): PythonFramework {
  if (context.files.exists("manage.py") || has(context, "django")) return "django";
  if (has(context, "fastapi") || has(context, "starlette")) return "fastapi";
  if (has(context, "flask")) return "flask";
  return "plain";
}

/** Python files where an app may be created, shallow first. */
function pythonFiles(context: ProjectContext): string[] {
  const found: string[] = [];
  const visit = (dir: string, depth: number) => {
    for (const name of context.files.list(dir).sort()) {
      if (name.startsWith(".") || ["venv", "node_modules", "__pycache__", "site-packages", "tests", "test", "migrations"].includes(name)) continue;
      const path = dir === "." ? name : `${dir}/${name}`;
      if (name.endsWith(".py")) found.push(path);
      else if (depth < 3 && context.files.isDirectory(path)) visit(path, depth + 1);
    }
  };
  visit(".", 0);
  return found.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
}

/** The first file that creates `constructor(...)`, and where. */
function findApp(context: ProjectContext, constructor: string): { path: string; name: string; offset: number } | null {
  const pattern = new RegExp(`^[ \\t]*(\\w+)\\s*(?::\\s*[\\w.]+\\s*)?=\\s*${constructor}\\(`, "m");
  for (const path of pythonFiles(context)) {
    const content = context.files.read(path) ?? "";
    const match = pattern.exec(content);
    if (match) return { path, name: match[1]!, offset: match.index };
  }
  return null;
}

function initCode(service: string, options = ""): string {
  return `import os

import nex_py as nex

try:
    nex.init(service=os.environ.get("NEX_SERVICE", "${service}")${options})
except nex.MonitoringConfigError as error:
    # Misconfigured monitoring must never stop the app from starting.
    print(f"[nex] not started: {error}")`;
}

/** Inserts `code` after the statement that creates the app, at its indentation. */
function afterApp(context: ProjectContext, app: { path: string; offset: number }, id: string, code: string): boolean {
  const content = context.files.read(app.path)!;
  if (hasBlock(content, id)) return true;
  const end = statementEndLine(content, app.offset, "python");
  if (end === null) return false;
  const startLine = content.slice(0, app.offset).split("\n").length - 1;
  context.files.write(app.path, insertAfterLine(content, end, block(id, code, "hash", indentOf(content, startLine))));
  return true;
}

function configureDjango(context: ProjectContext, service: string, manual: string[]): string[] {
  const touched: string[] = [];
  const files = pythonFiles(context);
  for (const [suffix, middleware] of [
    ["wsgi.py", "MonitoringWSGIMiddleware"],
    ["asgi.py", "MonitoringASGIMiddleware"],
  ] as const) {
    const path = files.find((file) => file.endsWith(`/${suffix}`) && /get_(w|a)sgi_application\(\)/.test(context.files.read(file) ?? ""));
    if (!path) continue;
    const content = context.files.read(path)!;
    if (hasBlock(content, "init")) {
      touched.push(path);
      continue;
    }
    const app = /^application\s*=\s*get_(?:w|a)sgi_application\(\)\s*$/m.exec(content);
    if (!app) continue;
    const line = content.slice(0, app.index).split("\n").length - 1;
    const code = `${initCode(service, ', checks={"database": nex.checks.django()}')}

if nex.get_client() is not None:
    application = nex.${middleware}(application, monitoring=nex.get_client())`;
    context.files.write(path, insertAfterLine(content, line, block("init", code, "hash")));
    touched.push(path);
  }
  if (!touched.length) manual.push(`Couldn't find your wsgi.py or asgi.py. After \`application = get_wsgi_application()\`, add:\n${initCode(service)}\n  application = nex.MonitoringWSGIMiddleware(application, monitoring=nex.get_client())`);
  return touched;
}

/** Adds nex-python to requirements.txt or pyproject.toml when pip installs it (uv, Poetry and Pipenv record it themselves). */
function recordDependency(context: ProjectContext, manual: string[]): void {
  if (context.python?.manager !== "pip") return;
  const requirement = `${SDKS.python.name}${SDKS.python.version}`;
  const requirements = context.files.read("requirements.txt");
  if (requirements !== null) {
    if (!new RegExp(`^${SDKS.python.name}\\b`, "m").test(requirements) && !hasBlock(requirements, "dependency")) {
      context.files.write("requirements.txt", `${requirements.replace(/\s*$/, "")}\n${block("dependency", requirement, "hash")}\n`);
    }
    return;
  }
  const pyproject = context.files.read("pyproject.toml");
  if (pyproject !== null && !pyproject.includes(SDKS.python.name)) {
    const deps = /^dependencies\s*=\s*\[\s*$/m.exec(pyproject);
    if (deps) {
      const line = pyproject.slice(0, deps.index).split("\n").length - 1;
      context.files.write("pyproject.toml", insertAfterLine(pyproject, line, block("dependency", `"${requirement}",`, "hash", "    ")));
    } else manual.push(`Add "${requirement}" to your project's dependencies.`);
  }
}

export const python: Integration = {
  id: "python",
  name: "Python",
  ecosystem: "python",
  status: "available",
  sdk: SDKS.python,
  compatibility: [],

  detect(context) {
    if (!context.python) return null;
    const framework = pythonFramework(context);
    const names: Record<PythonFramework, string> = { django: "Django", fastapi: "FastAPI", flask: "Flask", plain: "Python project" };
    return { confidence: framework === "plain" ? 50 : 65, signals: [context.python.signal, names[framework]] };
  },

  needs: () => ({ server: true, browser: false }),

  configure(context, setup) {
    const manual: string[] = [];
    const framework = pythonFramework(context);
    recordDependency(context, manual);

    if (framework === "django") configureDjango(context, setup.service, manual);
    else if (framework === "fastapi" || framework === "flask") {
      const ctor = framework === "fastapi" ? "(?:FastAPI|Starlette)" : "Flask";
      const app = findApp(context, ctor);
      if (!app) manual.push(`Couldn't find where your ${framework === "fastapi" ? "FastAPI" : "Flask"} app is created. At the top of that module add:\n${initCode(setup.service)}`);
      else {
        prependOnce(context, app.path, "init", initCode(setup.service), { afterEnv: true });
        const wire =
          framework === "fastapi"
            ? `if nex.get_client() is not None:\n    ${app.name}.add_middleware(nex.MonitoringASGIMiddleware, monitoring=nex.get_client())`
            : `if nex.get_client() is not None:\n    ${app.name}.wsgi_app = nex.MonitoringWSGIMiddleware(${app.name}.wsgi_app, nex.get_client())`;
        const fresh = findApp(context, ctor)!;
        if (!afterApp(context, fresh, "middleware", wire)) manual.push(`Add after creating your app in ${app.path}:\n${wire}`);
      }
    } else {
      const entry = context.files.first("main.py", "app.py", "__main__.py", "run.py") ?? pythonFiles(context).find((file) => /__name__\s*==\s*["']__main__["']/.test(context.files.read(file) ?? ""));
      if (!entry) manual.push(`Couldn't find your program's entry module. At the top of it add:\n${initCode(setup.service)}`);
      else prependOnce(context, entry, "init", initCode(setup.service), { afterEnv: true });
    }

    if (/(^|\W)celery\b/m.test(context.python?.dependencies ?? "")) manual.push("Celery: call nex.install_celery(nex.get_client()) where your worker starts, to report task failures.");
    if (!/python-dotenv|pydantic-settings|django-environ|environs/.test(context.python?.dependencies ?? "")) {
      manual.push("Python doesn't read .env by itself: load it (e.g. python-dotenv) or set the NEX_* variables in your deployment.");
    }
    ensureIgnored(context, ".env");
    return { envFile: ".env", env: serverEnv(setup), manual, sourceMaps: "Python reports full stack traces; there is nothing to upload.", releases: releasesFromCi("by nex-python at startup") };
  },

  instrumentationFiles(context) {
    return pythonFiles(context).filter((file) => hasBlock(context.files.read(file) ?? ""));
  },
};
