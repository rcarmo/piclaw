import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const dbSrc = (...parts: string[]) => join(import.meta.dir, "../../src/db", ...parts);

function file(path: string): string {
  return readFileSync(path, "utf8");
}

test("DB compression uses the ordinary writer with no resident recompression module", () => {
  expect(file(dbSrc("connection.ts"))).not.toContain("./media-recompress.js");
  expect(existsSync(dbSrc("media-recompress.ts"))).toBe(false);
  expect(file(dbSrc("media.ts"))).toContain("maybeCompress");
});

test("DB current message cleanup has no retired branch purge or import cycle", () => {
  expect(file(dbSrc("messages.ts"))).toContain("./chat-branches.js");
  expect(file(dbSrc("chat-branches.ts"))).not.toMatch(/from ["']\.\/messages\.js["']/);
  expect(file(dbSrc("messages.ts"))).toContain("./thinking-cleanup.js");
  expect(file(dbSrc("chat-branches.ts"))).not.toContain("./thinking-cleanup.js");
  expect(file(dbSrc("chat-branches.ts"))).not.toContain("function permanentDeleteArchivedBranch");
});
