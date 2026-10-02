/**
 * Text edits the wizard makes to a developer's files. Everything it adds is
 * fenced between marker comments, so a second run sees it and does nothing,
 * and `uninstall` removes exactly what was added and nothing else:
 *
 *   // nex:begin init (added by the Nex wizard)
 *   …
 *   // nex:end init
 */

export type CommentSyntax = "slash" | "hash";

const PREFIX: Record<CommentSyntax, string> = { slash: "//", hash: "#" };

export function syntaxFor(path: string): CommentSyntax {
  return /\.(py|toml|txt|cfg)$|(^|\/)\.(env[^/]*|gitignore)$|requirements[^/]*\.txt$/.test(path) ? "hash" : "slash";
}

function beginLine(id: string, syntax: CommentSyntax): string {
  return `${PREFIX[syntax]} nex:begin ${id} (added by the Nex wizard)`;
}

function endLine(id: string, syntax: CommentSyntax): string {
  return `${PREFIX[syntax]} nex:end ${id}`;
}

const BEGIN = /^\s*(?:\/\/|#)\s*nex:begin\s+([\w.-]+)/;
const END = /^\s*(?:\/\/|#)\s*nex:end\s+([\w.-]+)/;

export function hasBlock(content: string, id?: string): boolean {
  return content.split("\n").some((line) => {
    const match = BEGIN.exec(line);
    return Boolean(match && (id === undefined || match[1] === id));
  });
}

/** Ids of the Nex blocks in a file, in order. */
export function blockIds(content: string): string[] {
  return content.split("\n").flatMap((line) => {
    const match = BEGIN.exec(line);
    return match ? [match[1]!] : [];
  });
}

/** A block, indented, ready to insert. */
export function block(id: string, body: string, syntax: CommentSyntax, indent = ""): string {
  const lines = body.replace(/\n+$/, "").split("\n").map((line) => (line ? indent + line : line));
  return [indent + beginLine(id, syntax), ...lines, indent + endLine(id, syntax)].join("\n");
}

/**
 * Removes every Nex block (or only `id`). Blocks are inserted without blank
 * lines around them, so what remains is the original file byte for byte.
 */
export function removeBlocks(content: string, id?: string): string {
  const out: string[] = [];
  let skipping: string | null = null;
  for (const line of content.split("\n")) {
    if (skipping === null) {
      const begin = BEGIN.exec(line);
      if (begin && (id === undefined || begin[1] === id)) skipping = begin[1]!;
      else out.push(line);
    } else {
      const end = END.exec(line);
      if (end && end[1] === skipping) skipping = null;
    }
  }
  return out.join("\n");
}

/** True for a file that is nothing but Nex blocks (and blank lines). */
export function onlyBlocks(content: string): boolean {
  return removeBlocks(content).trim() === "";
}

// --- Where to insert ----------------------------------------------------------------------

const JS_PROLOGUE = /^\s*(#!.*|["']use (client|server|strict)["'];?\s*(\/\/.*)?|\/\/\s*@ts-\w+.*|\/\*\s*eslint[\s\S]*?\*\/)\s*$/;

/** Index of the first line after a JS/TS file's shebang and directives ("use client"). */
export function jsPrologueEnd(lines: string[]): number {
  let index = 0;
  while (index < lines.length && (JS_PROLOGUE.test(lines[index]!) || (lines[index]!.trim() === "" && index + 1 < lines.length && JS_PROLOGUE.test(lines[index + 1]!)))) index++;
  return index;
}

/** Index of the first line after a Python file's shebang, encoding line, docstring and __future__ imports. */
export function pythonPrologueEnd(lines: string[]): number {
  let index = 0;
  const skipBlank = () => {
    while (index < lines.length && lines[index]!.trim() === "") index++;
  };
  while (index < lines.length && /^#(!|.*coding[:=])/.test(lines[index]!)) index++;
  skipBlank();
  const first = lines[index]?.trim() ?? "";
  const quote = first.startsWith('"""') ? '"""' : first.startsWith("'''") ? "'''" : null;
  if (quote) {
    const closesSameLine = first.length > 3 && first.slice(3).includes(quote);
    if (closesSameLine) index++;
    else {
      index++;
      while (index < lines.length && !lines[index]!.includes(quote)) index++;
      index++;
    }
  }
  let after = index;
  skipBlank();
  while (index < lines.length && /^from __future__ import/.test(lines[index]!)) {
    index++;
    after = index;
    skipBlank();
  }
  return after;
}

/** Inserts `text` before line `index`. No blank lines are added, so removal is exact. */
export function insertAt(content: string, index: number, text: string): string {
  const lines = content.split("\n");
  return [...lines.slice(0, index), text, ...lines.slice(index)].join("\n");
}

export function prependBlock(content: string, text: string, language: "js" | "python"): string {
  const lines = content.split("\n");
  const index = language === "python" ? pythonPrologueEnd(lines) : jsPrologueEnd(lines);
  return insertAt(content, index, text);
}

export function appendBlock(content: string, text: string): string {
  if (!content) return `${text}\n`;
  return `${content}${content.endsWith("\n") ? "" : "\n"}${text}\n`;
}

/** Inserts after line `lineIndex` (0-based), with no added blank lines (inside a body or list). */
export function insertAfterLine(content: string, lineIndex: number, text: string): string {
  const lines = content.split("\n");
  return [...lines.slice(0, lineIndex + 1), text, ...lines.slice(lineIndex + 1)].join("\n");
}

/**
 * The line on which the statement starting at `offset` ends: brackets are
 * balanced, strings and comments skipped. `null` if it never closes.
 */
export function statementEndLine(content: string, offset: number, language: "js" | "python" = "js"): number | null {
  let depth = 0;
  let seenOpen = false;
  let quote: string | null = null;
  for (let i = offset; i < content.length; i++) {
    const ch = content[i]!;
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if ((language === "js" && ch === "/" && content[i + 1] === "/") || (language === "python" && ch === "#")) {
      const newline = content.indexOf("\n", i);
      i = (newline < 0 ? content.length : newline) - 1;
    } else if ("([{".includes(ch)) {
      depth++;
      seenOpen = true;
    } else if (")]}".includes(ch)) depth--;
    else if (ch === "\n" && depth === 0 && seenOpen) return lineOf(content, i - 1);
    if (depth < 0) return null;
  }
  return depth === 0 && seenOpen ? lineOf(content, content.length - 1) : null;
}

export function lineOf(content: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < content.length; i++) if (content[i] === "\n") line++;
  return line;
}

/** The indentation of line `index`. */
export function indentOf(content: string, index: number): string {
  return /^\s*/.exec(content.split("\n")[index] ?? "")![0];
}

// --- Environment files --------------------------------------------------------------------

const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
const REPLACED = /^#\s*nex:replaced\s+(.*)$/;

/** Keys and values of a .env file (later lines win, comments ignored). */
export function parseEnv(content: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of content.split("\n")) {
    const match = ENV_LINE.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    values.set(match[1]!, value);
  }
  return values;
}

function envValue(value: string): string {
  return /^[A-Za-z0-9_./:@+-]*$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Writes `entries` into the file's Nex block. A key already set outside the
 * block is commented out (`# nex:replaced KEY=…`) so uninstall can restore it,
 * but only when listed in `replace`; otherwise it is left alone and skipped.
 */
export function setEnv(content: string, entries: Record<string, string>, replace: Set<string> = new Set()): string {
  const outside = parseEnv(removeBlocks(content, "env"));
  const lines = removeBlocks(content, "env").split("\n").map((line) => {
    const match = ENV_LINE.exec(line);
    if (match && match[1]! in entries && replace.has(match[1]!)) return `# nex:replaced ${line.trim()}`;
    return line;
  });
  const kept = Object.entries(entries).filter(([key]) => !outside.has(key) || replace.has(key));
  const body = kept.map(([key, value]) => `${key}=${envValue(value)}`).join("\n");
  const base = lines.join("\n");
  return kept.length ? appendBlock(base, block("env", body, "hash")) : base;
}

/** Undoes `setEnv`: drops the block and restores lines it replaced. */
export function unsetEnv(content: string): string {
  return removeBlocks(content, "env")
    .split("\n")
    .map((line) => {
      const match = REPLACED.exec(line);
      return match ? match[1]! : line;
    })
    .join("\n");
}

/** True when a .gitignore pattern list already covers `file`. */
export function gitignoreCovers(content: string, file: string): boolean {
  const patterns = content.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#") && !line.startsWith("!"));
  return patterns.some((pattern) => {
    const p = pattern.replace(/^\//, "");
    if (p === file || p === `${file}/`) return true;
    const source = p
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "\u0000")
      .replace(/\*/g, "[^/]*")
      .replace(/\?/g, "[^/]")
      .replace(/\u0000/g, "(?:.*/)?");
    const regex = new RegExp(`^${source}$`);
    return regex.test(file);
  });
}

// --- Diffs --------------------------------------------------------------------------------

/** A compact line diff (+/-, with two lines of context), for "Show changes". */
export function diff(before: string, after: string, context = 2): string {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 4_000_000) return after.split("\n").map((line) => `+ ${line}`).join("\n");
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const ops: { kind: " " | "+" | "-"; line: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) ops.push({ kind: " ", line: a[i++]! }), j++;
    else if (j < b.length && (i >= a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) ops.push({ kind: "+", line: b[j++]! });
    else ops.push({ kind: "-", line: a[i++]! });
  }
  const keep = ops.map((op, index) => op.kind !== " " || ops.slice(Math.max(0, index - context), index + context + 1).some((o) => o.kind !== " "));
  const out: string[] = [];
  let gap = false;
  ops.forEach((op, index) => {
    if (keep[index]) {
      if (gap) out.push("  …");
      gap = false;
      out.push(`${op.kind} ${op.line}`);
    } else gap = true;
  });
  return out.join("\n");
}
