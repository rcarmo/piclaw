import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const src = (...parts: string[]) => join(import.meta.dir, "../src", ...parts);

function file(path: string): string {
  return readFileSync(path, "utf8");
}

test("workspace search and index process share core contracts without importing each other", () => {
  expect(file(src("workspace-search.ts"))).toContain("./workspace-index-core.js");
  expect(file(src("workspace-index-process.ts"))).toContain("./workspace-index-core.js");
  expect(file(src("workspace-index-process.ts"))).not.toMatch(/from ["']\.\/workspace-search\.js["']/);
});
