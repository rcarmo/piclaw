import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const testsRoot = resolve(import.meta.dir, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (stat.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("runtime tests no longer import automatic-recovery compatibility barrel", () => {
  const files = walk(testsRoot);
  // scanImports is stateless; do not initialise a parser for every test file.
  const scanner = new Bun.Transpiler({ loader: "ts" });
  const importers = files
    .filter((file) => scanner
      .scanImports(readFileSync(file, "utf8").replace(/^#![^\n]*\n/, ""))
      .some((specifier) => specifier.kind === "import-statement"
        && specifier.path.includes("automatic-recovery.js")))
    .map((file) => file.slice(testsRoot.length + 1).replaceAll("\\", "/"))
    .sort();

  expect(importers).toEqual([]);
});
