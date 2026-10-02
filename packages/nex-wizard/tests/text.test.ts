import { describe, expect, test } from "bun:test";
import { appendBlock, block, blockIds, diff, gitignoreCovers, hasBlock, insertAfterLine, parseEnv, prependBlock, removeBlocks, setEnv, statementEndLine, unsetEnv } from "../src/core/text";
import { insertIntoArray } from "../src/integrations/shared";

describe("fenced blocks", () => {
  const original = `"use client";\n\nimport { x } from "y";\n\nexport const a = 1;\n`;

  test("a prepended block goes after directives and comes out byte for byte", () => {
    const added = prependBlock(original, block("init", 'import * as nex from "n";', "slash"), "js");
    expect(added.split("\n")[0]).toBe('"use client";');
    expect(hasBlock(added, "init")).toBe(true);
    expect(blockIds(added)).toEqual(["init"]);
    expect(removeBlocks(added)).toBe(original);
  });

  test("after a shebang, and in a file with no directives", () => {
    const script = "#!/usr/bin/env node\nconsole.log(1);\n";
    expect(prependBlock(script, block("init", "x();", "slash"), "js").startsWith("#!/usr/bin/env node\n// nex:begin init")).toBe(true);
    const plain = "const a = 1;\n";
    expect(removeBlocks(prependBlock(plain, block("init", "x();", "slash"), "js"))).toBe(plain);
  });

  test("Python: after the docstring and __future__ imports", () => {
    const py = '"""App."""\nfrom __future__ import annotations\n\nimport os\n';
    const added = prependBlock(py, block("init", "import nex_py", "hash"), "python");
    expect(added.indexOf("nex:begin")).toBeGreaterThan(added.indexOf("__future__"));
    expect(removeBlocks(added)).toBe(py);
  });

  test("appended and inserted blocks are removed exactly", () => {
    const appended = appendBlock(original, block("tail", "export const b = 2;", "slash"));
    expect(removeBlocks(appended)).toBe(original);
    const inside = insertAfterLine("function f() {\n  return 1;\n}\n", 0, block("x", "g();", "slash", "  "));
    expect(inside).toContain("  // nex:begin x");
    expect(removeBlocks(inside)).toBe("function f() {\n  return 1;\n}\n");
  });

  test("only the named block is removed", () => {
    const two = appendBlock(appendBlock("a\n", block("one", "1", "slash")), block("two", "2", "slash"));
    expect(blockIds(removeBlocks(two, "one"))).toEqual(["two"]);
  });
});

describe("statements and arrays", () => {
  test("finds the end of a multi-line call", () => {
    const source = "const app = createApp(App, {\n  a: 1,\n});\napp.mount('#app');\n";
    expect(statementEndLine(source, 0)).toBe(2);
    expect(statementEndLine("app = FastAPI(\n    title='x (y)',\n)\n# done\n", 0, "python")).toBe(2);
  });

  test("inserts into a one-line and a multi-line array, and comes out cleanly", () => {
    const oneLine = "export const appConfig = {\n  providers: [provideRouter(routes)],\n};\n";
    const added = insertIntoArray(oneLine, /providers\s*:\s*\[/, "provider", "{ provide: A, useClass: B },")!;
    expect(added).toContain("// nex:begin provider");
    expect(added).toContain("provideRouter(routes)]");
    expect(removeBlocks(added).replace(/\s+/g, "")).toBe(oneLine.replace(/\s+/g, ""));
    const multi = "x = {\n  providers: [\n    a,\n  ],\n};\n";
    expect(removeBlocks(insertIntoArray(multi, /providers\s*:\s*\[/, "p", "b,")!)).toBe(multi);
  });
});

describe("env files", () => {
  test("adds a fenced block; an existing value is kept unless replacing is allowed", () => {
    const existing = "DATABASE_URL=postgres://x\nNEX_TOKEN=old\n";
    const kept = setEnv(existing, { NEX_TOKEN: "new", NEX_SERVICE: "web" });
    expect(parseEnv(kept).get("NEX_TOKEN")).toBe("old");
    expect(parseEnv(kept).get("NEX_SERVICE")).toBe("web");
    const replaced = setEnv(existing, { NEX_TOKEN: "new" }, new Set(["NEX_TOKEN"]));
    expect(parseEnv(replaced).get("NEX_TOKEN")).toBe("new");
    expect(replaced).toContain("# nex:replaced NEX_TOKEN=old");
    expect(unsetEnv(replaced)).toBe(existing);
  });

  test("a second run rewrites its own block instead of adding another", () => {
    const once = setEnv("", { NEX_TOKEN: "a" });
    const twice = setEnv(once, { NEX_TOKEN: "b" });
    expect(blockIds(twice)).toEqual(["env"]);
    expect(parseEnv(twice).get("NEX_TOKEN")).toBe("b");
  });

  test("parses quotes, export and comments", () => {
    const env = parseEnv(`export A="x y"\nB='z'\nC=plain # note\n# D=commented\n`);
    expect([...env]).toEqual([["A", "x y"], ["B", "z"], ["C", "plain"]]);
  });
});

test("gitignore coverage", () => {
  expect(gitignoreCovers(".env*\n", ".env.local")).toBe(true);
  expect(gitignoreCovers("*.local\n", ".env.local")).toBe(true);
  expect(gitignoreCovers("**/.env\n", ".env")).toBe(true);
  expect(gitignoreCovers("/.env.local\n", ".env.local")).toBe(true);
  expect(gitignoreCovers("node_modules\n# .env.local\n!.env.local\n", ".env.local")).toBe(false);
});

test("diff marks added and removed lines with context", () => {
  const out = diff("a\nb\nc\nd\ne\nf\ng\n", "a\nb\nc\nX\nd\ne\nf\ng\n", 1);
  expect(out).toContain("+ X");
  expect(out).not.toContain("  a");
});
