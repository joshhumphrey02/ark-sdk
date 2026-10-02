import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export type FileChange = { path: string; before: string | null; after: string };

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * The application's files, with the wizard's edits staged in memory until
 * `apply()`. Integrations read and write through it, so a dry run, the
 * "show changes" preview and the real run are the same code.
 */
export class Workspace {
  readonly #staged = new Map<string, string | null>();

  constructor(readonly root: string) {}

  abs(path: string): string {
    return join(this.root, path);
  }

  exists(path: string): boolean {
    if (this.#staged.has(path)) return this.#staged.get(path) !== null;
    return existsSync(this.abs(path));
  }

  isDirectory(path: string): boolean {
    try {
      return statSync(this.abs(path)).isDirectory();
    } catch {
      return false;
    }
  }

  /** The file as it will be after staged edits; `null` when absent. */
  read(path: string): string | null {
    if (this.#staged.has(path)) return this.#staged.get(path) ?? null;
    return this.readOriginal(path);
  }

  readOriginal(path: string): string | null {
    try {
      return readFileSync(this.abs(path), "utf8");
    } catch {
      return null;
    }
  }

  json<T>(path: string): T | null {
    const text = this.read(path);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  /** The first of `candidates` that exists. */
  first(...candidates: string[]): string | null {
    return candidates.find((c) => this.exists(c)) ?? null;
  }

  /** Entries of a directory (names only); empty when absent. */
  list(path = "."): string[] {
    try {
      return readdirSync(this.abs(path));
    } catch {
      return [];
    }
  }

  write(path: string, content: string): void {
    if (this.readOriginal(path) === content) this.#staged.delete(path);
    else this.#staged.set(path, content);
  }

  remove(path: string): void {
    if (this.readOriginal(path) === null) this.#staged.delete(path);
    else this.#staged.set(path, null);
  }

  /** What `apply()` would do, in path order. Removals have `after: ""` and are listed in `removed`. */
  changes(): FileChange[] {
    return [...this.#staged.entries()]
      .filter(([, after]) => after !== null)
      .map(([path, after]) => ({ path, before: this.readOriginal(path), after: after! }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  removed(): string[] {
    return [...this.#staged.entries()].filter(([, after]) => after === null).map(([path]) => path).sort();
  }

  get dirty(): boolean {
    return this.#staged.size > 0;
  }

  apply(): void {
    for (const [path, content] of this.#staged) {
      const target = this.abs(path);
      if (content === null) {
        if (existsSync(target)) unlinkSync(target);
      } else {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
      }
    }
    this.#staged.clear();
  }

  /** `path` relative to the root, with forward slashes. */
  relative(absolute: string): string {
    return relative(this.root, absolute).split(sep).join("/");
  }
}
