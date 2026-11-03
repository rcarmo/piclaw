import { Database } from "bun:sqlite";
import { expect, spyOn, test } from "bun:test";
import { existsSync, linkSync, renameSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
import { configureSqliteRole, openSqliteRole, type SqliteConnectionRole } from "../../src/db/sqlite-role-policy.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";

const id = (path: string) => { const s = statSync(path); return `${s.dev}:${s.ino}`; };
const policy = (db: Database) => Object.fromEntries(["journal_mode", "synchronous", "busy_timeout", "foreign_keys", "secure_delete", "cache_size", "mmap_size"]
  .map(name => [name, db.query(`PRAGMA ${name}`).get()]));

for (const zfs of [false, true]) test(`file-backed roles share identity and preserve deliberate policy differences; zfs=${zfs}`, () => {
  const ws = createTempWorkspace("sqlite-role-policy-"), path = join(ws.base, "roles.db");
  const root = openSqliteRole(path, { role: "root", zfs });
  const sdk = openSqliteRole(path, { role: "sdk", create: false, expectedIdentity: id(path), expectedPath: path, zfs });
  const scheduler = openSqliteRole(path, { role: "scheduler", expectedIdentity: id(path), expectedPath: path, zfs });
  const worker = openSqliteRole(path, { role: "index-worker", expectedIdentity: id(path), expectedPath: path, zfs });
  try {
    root.exec("CREATE TABLE visible(value TEXT); INSERT INTO visible VALUES('shared')");
    for (const [role, db] of [["root", root], ["sdk", sdk], ["scheduler", scheduler], ["index-worker", worker]] as const) {
      expect(db.query("SELECT * FROM visible").all()).toEqual([{ value: "shared" }]);
      expect(policy(db)).toMatchObject({
        journal_mode: { journal_mode: "wal" }, synchronous: { synchronous: 2 }, secure_delete: { secure_delete: 1 },
        busy_timeout: { timeout: 0 }, foreign_keys: { foreign_keys: role === "root" ? 0 : 1 },
        cache_size: { cache_size: role === "root" ? zfs ? -8000 : -1000 : -2000 },
        mmap_size: { mmap_size: role === "root" && !zfs ? 268435456 : 0 },
      });
    }
    root.exec("PRAGMA foreign_keys=ON");
    configureSqliteRole(root, path, { role: "root", expectedIdentity: id(path), zfs });
    expect(root.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
  } finally { worker.close(); scheduler.close(); sdk.close(); root.close(); ws.cleanup(); }
});

for (const role of ["root", "sdk", "scheduler"] as SqliteConnectionRole[]) test(`memory role ${role} keeps memory journal and immutable zero wait and role-specific FKs`, () => {
  const db = openSqliteRole(":memory:", { role });
  try {
    expect(policy(db)).toMatchObject({ journal_mode: { journal_mode: "memory" }, synchronous: { synchronous: 2 },
      foreign_keys: { foreign_keys: role === "root" ? 0 : 1 }, busy_timeout: { timeout: 0 },
      secure_delete: { secure_delete: 1 }, cache_size: { cache_size: -2000 } });
    db.exec("CREATE TABLE value(n INTEGER); INSERT INTO value VALUES(1)");
    expect(db.query("SELECT * FROM value").all()).toEqual([{ n: 1 }]);
  } finally { db.close(); }
});

test("index-worker role cannot create a file even with create=true and rejects memory", () => {
  const ws = createTempWorkspace("sqlite-worker-existing-"), missing = join(ws.base, "missing.db");
  try {
    expect(() => openSqliteRole(missing, { role: "index-worker", create: true })).toThrow();
    expect(existsSync(missing)).toBe(false);
    expect(() => openSqliteRole(":memory:", { role: "index-worker" })).toThrow("existing file-backed WAL");
  } finally { ws.cleanup(); }
});

test("new root files select incremental format without converting legacy files or running VACUUM", () => {
  const ws = createTempWorkspace("sqlite-root-format-"), freshPath = join(ws.base, "new.db"), legacyPath = join(ws.base, "legacy.db");
  const legacy = new Database(legacyPath);
  legacy.exec("CREATE TABLE retained(value);INSERT INTO retained VALUES(42)"); legacy.close(true);
  const exec = Database.prototype.exec; let maintenance = 0;
  const spy = spyOn(Database.prototype, "exec").mockImplementation(function(this: Database, sql: string) {
    if (/^\s*(?:VACUUM\b|PRAGMA\s+incremental_vacuum\b)/i.test(sql)) maintenance++;
    return exec.call(this, sql);
  });
  let fresh: Database | undefined, existing: Database | undefined;
  try {
    fresh = openSqliteRole(freshPath, { role: "root" });
    existing = openSqliteRole(legacyPath, { role: "root" });
    expect(fresh.query("PRAGMA auto_vacuum").get()).toEqual({ auto_vacuum: 2 });
    expect(existing.query("PRAGMA auto_vacuum").get()).toEqual({ auto_vacuum: 0 });
    expect(existing.query("SELECT * FROM retained").all()).toEqual([{ value: 42 }]);
    expect(maintenance).toBe(0);
  } finally { spy.mockRestore(); fresh?.close(true); existing?.close(true); ws.cleanup(); }
});

test("root/scheduler configure WAL while SDK writer admission remains nonblocking", () => {
  const ws = createTempWorkspace("sqlite-role-lock-"), path = join(ws.base, "roles.db");
  const root = openSqliteRole(path, { role: "root" });
  root.exec("CREATE TABLE visible(value TEXT); BEGIN IMMEDIATE");
  let sdk: Database | undefined;
  try {
    const start = performance.now();
    sdk = openSqliteRole(path, { role: "sdk", create: false, expectedIdentity: id(path) });
    expect(sdk.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 0 });
    expect(() => sdk!.exec("BEGIN IMMEDIATE")).toThrow();
    expect(performance.now() - start).toBeLessThan(500);
  } finally { if (root.inTransaction) root.exec("ROLLBACK"); sdk?.close(); root.close(); ws.cleanup(); }
});

test("SDK cannot enter a synchronous WAL-transition retry loop behind a rollback-journal writer", () => {
  const ws = createTempWorkspace("sqlite-role-nonwal-"), path = join(ws.base, "roles.db"), blocker = new Database(path);
  blocker.exec("PRAGMA journal_mode=DELETE; CREATE TABLE sample(n); BEGIN IMMEDIATE");
  try {
    const start = performance.now();
    expect(() => openSqliteRole(path, { role: "sdk", create: false })).toThrow();
    expect(performance.now() - start).toBeLessThan(500);
  } finally { blocker.exec("ROLLBACK"); blocker.close(); ws.cleanup(); }
});

test("same-file symlink is supported but an alternate hardlink WAL name or unrelated handle is rejected", () => {
  const ws = createTempWorkspace("sqlite-role-alias-"), path = join(ws.base, "main.db"), alias = join(ws.base, "alias.db"), hard = join(ws.base, "hard.db");
  const root = openSqliteRole(path, { role: "root" });
  let sdk: Database | undefined;
  try {
    symlinkSync(path, alias); linkSync(path, hard);
    sdk = openSqliteRole(alias, { role: "sdk", create: false, expectedIdentity: id(path), expectedPath: path });
    expect(sdk.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(() => openSqliteRole(hard, { role: "sdk", create: false, expectedIdentity: id(path), expectedPath: path })).toThrow("path alias is unsupported");
    const other = openSqliteRole(join(ws.base, "other.db"), { role: "root" });
    try {
      const before = policy(other);
      expect(() => configureSqliteRole(other, path, { role: "scheduler" })).toThrow("identity changed");
      expect(policy(other)).toEqual(before);
    } finally { other.close(); }
  } finally { sdk?.close(); root.close(); ws.cleanup(); }
});

test("old expected identity cannot open a replacement database", () => {
  const ws = createTempWorkspace("sqlite-role-replaced-"), path = join(ws.base, "main.db");
  const original = openSqliteRole(path, { role: "root" }); original.close();
  const expectedIdentity = id(path); renameSync(path, path + ".old");
  const replacement = openSqliteRole(path, { role: "root" }); replacement.close();
  try { expect(() => openSqliteRole(path, { role: "scheduler", expectedIdentity })).toThrow("identity changed"); }
  finally { ws.cleanup(); }
});

test("configuration and owner failures close the new handle exactly once before returning failure", () => {
  const ws = createTempWorkspace("sqlite-role-cleanup-"), path = join(ws.base, "main.db");
  const initial = openSqliteRole(path, { role: "root" }); initial.close();
  const closed: Database[] = [], close = Database.prototype.close;
  const spy = spyOn(Database.prototype, "close").mockImplementation(function(this: Database) { closed.push(this); return close.call(this); });
  const failure = Error("owner lost after configuration"); let checks = 0;
  try {
    expect(() => openSqliteRole(path, { role: "scheduler", assertOwner() { if (++checks === 3) throw failure; } })).toThrow(failure);
    expect(closed).toHaveLength(1);
    expect(() => closed[0]!.query("SELECT 1")).toThrow();
  } finally { spy.mockRestore(); ws.cleanup(); }
});

test("path replacement during opening is detected and never publishes the stale handle", () => {
  const ws = createTempWorkspace("sqlite-role-open-race-"), path = join(ws.base, "main.db"), replacement = join(ws.base, "replacement.db");
  for (const name of [path, replacement]) { const db = openSqliteRole(name, { role: "root" }); db.close(); }
  const close = Database.prototype.close, closed: Database[] = [];
  const spy = spyOn(Database.prototype, "close").mockImplementation(function(this: Database) { closed.push(this); return close.call(this); });
  let checks = 0;
  try {
    expect(() => openSqliteRole(path, { role: "sdk", create: false, assertOwner() {
      if (++checks === 2) { renameSync(path, path + ".old"); renameSync(replacement, path); }
    } })).toThrow("identity changed");
    expect(closed).toHaveLength(1); expect(() => closed[0]!.query("SELECT 1")).toThrow();
  } finally { spy.mockRestore(); ws.cleanup(); }
});

test("uncertain failed-open cleanup remains an explicit startup ownership error", () => {
  const ws = createTempWorkspace("sqlite-role-cleanup-failure-"), path = join(ws.base, "main.db");
  const initial = openSqliteRole(path, { role: "root" }); initial.close();
  const original = Error("owner lost"), cleanup = Error("close failed");
  let leaked: Database | undefined, checks = 0;
  const spy = spyOn(Database.prototype, "close").mockImplementation(function(this: Database) { leaked = this; throw cleanup; });
  try {
    let caught: unknown;
    try { openSqliteRole(path, { role: "scheduler", assertOwner() { if (++checks === 3) throw original; } }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(RuntimeStartupCleanupError);
    expect((caught as RuntimeStartupCleanupError).errors).toEqual([original, cleanup]);
  } finally { spy.mockRestore(); leaked?.close(); ws.cleanup(); }
});
