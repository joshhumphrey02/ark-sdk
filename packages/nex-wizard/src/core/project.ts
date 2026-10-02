import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { detectJsPackageManager, detectPythonPackageManager, type JsPackageManager, type PythonPackageManager } from "./package-manager";
import { Workspace } from "./workspace";

export type PackageJson = {
  name?: string;
  version?: string;
  type?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

/** The application being set up, and what is known about it. */
export type ProjectContext = {
  /** The application's directory. */
  root: string;
  /** The repository root (where .git is), or `root`. */
  repoRoot: string;
  files: Workspace;
  packageJson: PackageJson | null;
  /** dependencies + devDependencies. */
  deps: Record<string, string>;
  typescript: boolean;
  js: { manager: JsPackageManager; signal: string } | null;
  python: { manager: PythonPackageManager; signal: string; dependencies: string } | null;
};

const PYTHON_MARKERS = ["pyproject.toml", "requirements.txt", "Pipfile", "setup.py", "setup.cfg"];

export function findRepoRoot(dir: string): string {
  let current = dir;
  while (dirname(current) !== current) {
    if (existsSync(join(current, ".git"))) return current;
    current = dirname(current);
  }
  return dir;
}

/** The Python dependency text (requirements, pyproject, Pipfile), lowercased, for detection. */
function pythonDependencies(files: Workspace): string {
  return PYTHON_MARKERS.map((file) => files.read(file) ?? "")
    .join("\n")
    .toLowerCase();
}

/** `repoRoot`: the monorepo root when the app was picked from one (lockfiles live there). */
export function loadProject(root: string, repoRoot = findRepoRoot(root)): ProjectContext {
  const files = new Workspace(root);
  const packageJson = files.json<PackageJson>("package.json");
  const deps = { ...(packageJson?.devDependencies ?? {}), ...(packageJson?.dependencies ?? {}) };
  const isPython = PYTHON_MARKERS.some((file) => files.exists(file)) || files.exists("manage.py");
  return {
    root,
    repoRoot,
    files,
    packageJson,
    deps,
    typescript: files.exists("tsconfig.json") || "typescript" in deps,
    js: packageJson ? detectJsPackageManager(root, repoRoot) : null,
    python: isPython ? { ...detectPythonPackageManager(root), dependencies: pythonDependencies(files) } : null,
  };
}

/** A slug from the app's name: "@acme/Web App" → "web-app". */
export function serviceSlug(context: ProjectContext): string {
  const raw = context.packageJson?.name?.split("/").pop() ?? basename(context.root);
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return slug || "app";
}

// --- Monorepos --------------------------------------------------------------------------

export type AppCandidate = { path: string; name: string; kind: "javascript" | "python" };

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function workspaceGlobs(root: string): string[] {
  const globs: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;
    const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
    if (ws) globs.push(...ws);
  } catch {
    // No package.json.
  }
  try {
    const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    for (const match of yaml.matchAll(/^\s*-\s*['"]?([^'"\n#]+)['"]?\s*$/gm)) globs.push(match[1]!.trim());
  } catch {
    // Not a pnpm workspace.
  }
  return globs.filter((glob) => !glob.startsWith("!"));
}

/**
 * Applications inside a monorepo: workspace globs ("apps/*"), else the usual
 * apps/, packages/ and services/ folders. Only folders with a package.json or
 * a Python project file count.
 */
export function findApps(root: string): AppCandidate[] {
  const globs = workspaceGlobs(root);
  const parents = new Set<string>();
  const direct = new Set<string>();
  for (const glob of globs.length ? globs : ["apps/*", "packages/*", "services/*"]) {
    const clean = glob.replace(/\/+$/, "");
    if (clean.endsWith("/*") || clean.endsWith("/**")) parents.add(clean.replace(/\/\*\*?$/, ""));
    else direct.add(clean);
  }
  const dirs = new Set<string>(direct);
  for (const parent of parents) {
    const abs = join(root, parent);
    if (!isDir(abs)) continue;
    for (const entry of readdirSync(abs)) if (!entry.startsWith(".") && isDir(join(abs, entry))) dirs.add(`${parent}/${entry}`);
  }
  const apps: AppCandidate[] = [];
  for (const dir of [...dirs].sort()) {
    const abs = join(root, dir);
    if (existsSync(join(abs, "package.json"))) {
      let name = dir;
      try {
        name = (JSON.parse(readFileSync(join(abs, "package.json"), "utf8")) as PackageJson).name ?? dir;
      } catch {
        // Keep the folder name.
      }
      apps.push({ path: relative(root, abs) || ".", name, kind: "javascript" });
    } else if (PYTHON_MARKERS.some((file) => existsSync(join(abs, file)))) {
      apps.push({ path: relative(root, abs), name: dir, kind: "python" });
    }
  }
  return apps;
}

/** A repository root that holds several apps rather than being one. */
export function isMonorepoRoot(root: string): boolean {
  return workspaceGlobs(root).length > 0 || existsSync(join(root, "turbo.json")) || existsSync(join(root, "nx.json")) || existsSync(join(root, "lerna.json"));
}
