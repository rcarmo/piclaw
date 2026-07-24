import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const dbSrc = (...parts: string[]) => join(import.meta.dir, "../../src/db", ...parts);

function file(path: string): string {
  return readFileSync(path, "utf8");
}

test("DB media compression migration has no connection/media-recompress import cycle", () => {
  expect(file(dbSrc("connection.ts"))).toContain("./media-recompress.js");
  expect(file(dbSrc("media-recompress.ts"))).not.toMatch(/from ["']\.\/connection\.js["']/);
  expect(file(dbSrc("media-recompress.ts"))).toContain("recompressExistingMedia(db:");
});

test("DB branch deletion has no chat-branches/messages import cycle", () => {
  expect(file(dbSrc("messages.ts"))).toContain("./chat-branches.js");
  expect(file(dbSrc("chat-branches.ts"))).not.toMatch(/from ["']\.\/messages\.js["']/);
  expect(file(dbSrc("chat-branches.ts"))).toContain("./thinking-cleanup.js");
});
