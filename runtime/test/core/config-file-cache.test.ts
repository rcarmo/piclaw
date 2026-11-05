import { afterEach, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCachedJsonFile } from "../../src/core/config-file-cache.js";
import { readAccessConfig } from "../../src/core/config-access.js";
import { readJsonConfig, writeJsonConfig } from "../../src/core/config-store.js";

const dirs: string[] = [];
function fixture(raw: string): string {
  const dir = mkdtempSync(join(tmpdir(), "piclaw-config-cache-"));
  dirs.push(dir);
  const path = join(dir, "config.json");
  writeFileSync(path, raw, { mode: 0o600 });
  return path;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("unchanged avatar-heavy configuration is parsed once across strict and forgiving readers", () => {
  const raw = JSON.stringify({ domains: { access: { mode: "single-user" }, identity: { assistantAvatar: "x".repeat(1_700_000) } } });
  const path = fixture(raw);
  const parse = spyOn(JSON, "parse");
  try {
    for (let i = 0; i < 50; i++) {
      expect(readAccessConfig(path).mode).toBe("single-user");
      expect(readJsonConfig(path).domains).toBeDefined();
    }
    expect(parse.mock.calls.filter(([text]) => text === raw).length).toBe(1);
  } finally { parse.mockRestore(); }
});

test("callers cannot mutate cached objects, arrays or prototype-named keys", () => {
  const path = fixture('{"nested":{"values":[{"name":"original"}]},"__proto__":{"safe":true}}');
  const first = readJsonConfig(path) as any;
  first.nested.values[0].name = "changed";
  first.nested.values.push("extra");
  first.__proto__.safe = false;
  const next = readJsonConfig(path) as any;
  expect(next.nested.values).toEqual([{ name: "original" }]);
  expect(Object.hasOwn(next, "__proto__")).toBe(true);
  expect(next.__proto__).toEqual({ safe: true });
  expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
});

test("in-place writes with restored mtime invalidate cached contents", () => {
  const path = fixture('{"value":"aaaa"}');
  expect(readCachedJsonFile(path)).toEqual({ value: "aaaa" });
  const before = statSync(path);
  Bun.sleepSync(2);
  writeFileSync(path, '{"value":"bbbb"}');
  utimesSync(path, before.atime, before.mtime);
  expect(readCachedJsonFile(path)).toEqual({ value: "bbbb" });
});

test("same-size atomic replacement with restored mtime invalidates via inode", () => {
  const path = fixture('{"value":"aaaa"}');
  expect(readCachedJsonFile(path)).toEqual({ value: "aaaa" });
  const before = statSync(path);
  const replacement = join(dirs.at(-1)!, "replacement.json");
  writeFileSync(replacement, '{"value":"bbbb"}');
  utimesSync(replacement, before.atime, before.mtime);
  renameSync(replacement, path);
  expect(statSync(path).ino).not.toBe(before.ino);
  expect(readCachedJsonFile(path)).toEqual({ value: "bbbb" });
});

test("access mode changes, invalid JSON and recovery never reuse stale policy", () => {
  const path = fixture('{"domains":{"access":{"mode":"single-user"}}}');
  expect(readAccessConfig(path).mode).toBe("single-user");
  writeJsonConfig(path, { domains: { access: { mode: "isolated-containers", isolation: { component: "backend", backendId: "alice", ownerUserId: "u-alice", gatewayUrl: "https://gateway.internal", verificationKeyRef: "gateway/public-key" } } } });
  expect(readAccessConfig(path).mode).toBe("isolated-containers");
  writeFileSync(path, "{");
  expect(readJsonConfig(path)).toEqual({});
  expect(() => readAccessConfig(path)).toThrow("Invalid JSON");
  writeFileSync(path, '{"domains":{"access":{"mode":"unknown"}}}');
  expect(() => readAccessConfig(path)).toThrow();
  writeJsonConfig(path, { domains: { access: { mode: "single-user" } } });
  expect(readAccessConfig(path).mode).toBe("single-user");
});

test("deletion and recreation invalidate cached values and preserve missing-file semantics", () => {
  const path = fixture('{"domains":{"access":{"mode":"single-user"}}}');
  expect(readAccessConfig(path).mode).toBe("single-user");
  rmSync(path);
  expect(readJsonConfig(path)).toEqual({});
  expect(readAccessConfig(path)).toEqual({ mode: "single-user", isolation: null, modeExplicit: false });
  writeFileSync(path, '{"domains":{"access":{"mode":"single-user"}}}');
  expect(readAccessConfig(path).modeExplicit).toBe(true);
});

test.skipIf(process.getuid?.() === 0)("permission loss invalidates a warm cache and strict access fails closed", () => {
  const path = fixture('{"domains":{"access":{"mode":"single-user"}}}');
  expect(readAccessConfig(path).mode).toBe("single-user");
  chmodSync(path, 0o000);
  try {
    expect(() => readAccessConfig(path)).toThrow("Cannot read access configuration");
    expect(readJsonConfig(path)).toEqual({});
  } finally { chmodSync(path, 0o600); }
  expect(readAccessConfig(path).mode).toBe("single-user");
});

test("colliding metadata never preserves a stale valid access policy", () => {
  const path = fixture('{"domains":{"access":{"mode":"single-user"}}}');
  expect(readAccessConfig(path).mode).toBe("single-user");
  const before = fs.statSync(path, { bigint: true });
  writeFileSync(path, '{"domains":{"access":{"mode":"broken-mode"}}}');
  const stat = spyOn(fs, "statSync").mockReturnValue(before as never);
  const fstat = spyOn(fs, "fstatSync").mockReturnValue(before as never);
  try {
    expect(() => readAccessConfig(path)).toThrow();
  } finally { stat.mockRestore(); fstat.mockRestore(); }
});

test("a file disappearing after open fails closed instead of using missing-file defaults", () => {
  const path = fixture('{"domains":{"access":{"mode":"single-user"}}}');
  expect(readAccessConfig(path).mode).toBe("single-user");
  const original = fs.readSync;
  let removed = false;
  const read = spyOn(fs, "readSync").mockImplementation((...args: any[]) => {
    const count = Reflect.apply(original, fs, args) as number;
    if (!removed && count > 0) { removed = true; rmSync(path); }
    return count;
  });
  try {
    expect(() => readAccessConfig(path)).toThrow("Cannot read access configuration");
  } finally { read.mockRestore(); }
});

test("symlink followed by '..' keeps filesystem path semantics for reads and writes", () => {
  const normalised = fixture('{"value":"normalised"}');
  const actual = fixture('{"value":"filesystem"}');
  const dir = dirs.at(-1)!;
  mkdirSync(join(dir, "nested"));
  const link = join(dirs.at(-2)!, "link");
  symlinkSync(join(dir, "nested"), link);
  const path = `${link}/../config.json`;
  expect(readCachedJsonFile(path)).toEqual({ value: "filesystem" });
  writeJsonConfig(path, { value: "updated" });
  expect(readJsonConfig(actual)).toEqual({ value: "updated" });
  expect(readJsonConfig(normalised)).toEqual({ value: "normalised" });
});

test("reads through different paths remain separate and cache capacity is bounded", () => {
  const original = fixture('{"value":"old"}');
  readCachedJsonFile(original);
  for (let i = 0; i < 20; i++) expect(readCachedJsonFile(fixture(JSON.stringify({ value: i })))).toEqual({ value: i });
  const raw = readFileSync(original, "utf8");
  const parse = spyOn(JSON, "parse");
  try {
    expect(readCachedJsonFile(original)).toEqual({ value: "old" });
    expect(parse.mock.calls.filter(([text]) => text === raw).length).toBe(1);
  } finally { parse.mockRestore(); }
});
