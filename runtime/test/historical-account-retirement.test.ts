import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeDatabase, getDb, initDatabase, getDatabaseBinding } from "../src/db/connection.js";
import { resolveRuntimeConfigPaths } from "../src/core/config-paths.js";
import { getRootOwnership } from "../src/db/session-ownership.js";
import { readAccessState } from "../src/db/access-state.js";
import { createWebSession } from "../src/db/web-sessions.js";
import { applyHistoricalAccountCopy, prepareHistoricalAccountCopy } from "../scripts/lib/historical-account-copies.js";
import { applyHistoricalAccounts, historicalAccountMigration, inspectHistoricalAccounts, snapshotHistoricalDatabase } from "../scripts/lib/historical-account-retirement.js";
import manifest from "../scripts/lib/historical-account-schema.json";
import legacy from "./fixtures/historical-account-schema.json";

let root: string;
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
const open = (path: string, readonly = false) => {
  const db = new Database(path, { readonly, strict: true, safeIntegers: true });
  db.exec(readonly ? "PRAGMA query_only=ON" : "PRAGMA foreign_keys=ON");
  return db;
};
beforeEach(async () => {
  await closeDatabase(); process.env.PICLAW_DB_IN_MEMORY = "1"; initDatabase();
  root = mkdtempSync(join(process.env.TMPDIR!, "historical-accounts-"));
});
afterEach(async () => { await closeDatabase(); rmSync(root, { recursive: true, force: true }); });
function source(historical = true, mutate?: (db: Database) => void) {
  const db = getDb();
  if (historical) for (const batch of legacy) db.exec(batch.sql);
  mutate?.(db);
  const path = join(root, "source.db");
  writeFileSync(path, db.serialize(), { mode: 0o600 });
  return path;
}
function copies(path: string) { return prepareHistoricalAccountCopy(path, join(root, "prepared")); }
function handles() {
  const candidate = open(join(root, "prepared", "candidate.db"));
  const archive = open(join(root, "prepared", "archive.db"), true);
  return { candidate, archive, close() { candidate.close(); archive.close(); } };
}
function assertUntouched(path: string, original: string, archiveHash: string) {
  expect(sha(path)).toBe(original);
  expect(sha(join(root, "prepared", "archive.db"))).toBe(archiveHash);
}

test("source manifest qualifies 36 regular tables, exact FTS and all eleven retained-table triggers", () => {
  const db = getDb();
  for (const batch of legacy) db.exec(batch.sql);
  const plan = inspectHistoricalAccounts(db);
  expect(plan.blocked).toEqual([]);
  expect(plan.objects).toHaveLength(157);
  expect(plan.expectedPhysicalTables).toBe(42);
  expect(plan.objects.filter(o => o.kind === "table" && o.storageKind === "table")).toHaveLength(36);
  expect(manifest.objects.filter(o => o.kind === "trigger" && !manifest.names.includes(o.table))).toHaveLength(11);
  expect(plan.tables.find(t => t.name === "family_workspace_index_generation")?.rowCount).toBe(1);
});

test("fresh copy retires zero tables without introducing historical objects or changing source", () => {
  const path = source(false), original = sha(path), plan = copies(path);
  expect(plan.blocked).toEqual([]); expect(plan.expectedPhysicalTables).toBe(0);
  const result = applyHistoricalAccountCopy(join(root, "prepared"), plan.sha256);
  expect(result.expectedPhysicalTables).toBe(0);
  assertUntouched(path, original, plan.archiveSha256);
  const h = handles();
  try {
    expect(h.candidate.query("SELECT owner,id FROM piclaw_schema_migrations WHERE owner=?").all(historicalAccountMigration.owner))
      .toEqual([{ owner: historicalAccountMigration.owner, id: historicalAccountMigration.id }]);
    expect(inspectHistoricalAccounts(h.candidate).expectedPhysicalTables).toBe(0);
  } finally { h.close(); }
});

test("empty history and zero counter retire transactionally while current auth, ownership, FTS and provenance survive backup/reopen", async () => {
  const path = source(true, db => {
    createWebSession("synthetic-retained-session", "default", 3600, "totp");
    db.exec(`INSERT INTO chats(jid) VALUES('web:retained');
      INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at)
        VALUES('retained-root','web:retained','web:retained','retained-agent','now','now');
      INSERT INTO session_roots(root_branch_id,owner_user_id,created_at) VALUES('retained-root','default','now');
      INSERT INTO workspace_fts(content,path,mtime_ms,size_bytes) VALUES('retained searchable history','retained.md',1,10);
      INSERT INTO migration_input_holds VALUES(7,'retained-input','web:retained','default','now','hash','source provenance','now');`);
  });
  const original = sha(path), plan = copies(path);
  expect(plan.blocked).toEqual([]); expect(plan.expectedPhysicalTables).toBe(42);
  const result = applyHistoricalAccountCopy(join(root, "prepared"), plan.sha256);
  expect(result.expectedPhysicalTables).toBe(42);
  assertUntouched(path, original, plan.archiveSha256);
  const h = handles();
  try {
    expect(snapshotHistoricalDatabase(h.candidate, true)).toBe(snapshotHistoricalDatabase(h.archive, true));
    expect(h.candidate.query("SELECT count(*) n FROM web_sessions").get()).toEqual({ n: 1n });
    expect(getRootOwnership(h.candidate, "web:retained")?.ownerUserId).toBe("default");
    expect(h.candidate.query("SELECT path FROM workspace_fts WHERE workspace_fts MATCH 'searchable'").all()).toEqual([{ path: "retained.md" }]);
    expect(h.candidate.query("SELECT source_snapshot FROM migration_input_holds").get()).toEqual({ source_snapshot: "source provenance" });
    expect(h.archive.query("SELECT * FROM family_workspace_index_generation").all()).toEqual([{ id: 1n, revision: 0n }]);
  } finally { h.close(); }
  // An isolated copied profile exercises the actual current startup initializer.
  await closeDatabase();
  const paths = resolveRuntimeConfigPaths({ env: { PICLAW_WORKSPACE: root, PICLAW_STORE: join(root, "reopened-store"), PICLAW_DB_IN_MEMORY: "0" } });
  mkdirSync(paths.storeDir, { recursive: true });
  copyFileSync(join(root, "prepared", "candidate.db"), paths.databasePath);
  initDatabase(paths);
  expect(getDatabaseBinding()?.path).toBe(paths.databasePath);
  expect(inspectHistoricalAccounts(getDb()).expectedPhysicalTables).toBe(0);
  expect(getRootOwnership(getDb(), "web:retained")?.ownerUserId).toBe("default");
});

for (const [label, sql] of [
  ["credentials", "INSERT INTO user_totp_factors VALUES('default',x'00ff',x'01',x'02','revision',0,'now')"],
  ["account audit", "INSERT INTO operator_recovery_events VALUES('audit','default','totp','https://fixture.invalid','now')"],
  ["nonzero counter", "UPDATE family_workspace_index_generation SET revision=1"],
  ["FTS content", "INSERT INTO family_workspace_fts(content,path) VALUES('historical text','old.md')"],
  ["FTS tombstone bytes", "INSERT INTO family_workspace_fts(content,path) VALUES('historical text','old.md'); DELETE FROM family_workspace_fts"],
] as const) test(`populated ${label} is preserved in verified archive and refuses removal`, () => {
  const path = source(true, db => db.exec(sql)), original = sha(path), plan = copies(path);
  expect(plan.blocked.length).toBeGreaterThan(0);
  const candidateHash = sha(join(root, "prepared", "candidate.db"));
  expect(() => applyHistoricalAccountCopy(join(root, "prepared"), plan.sha256)).toThrow("blocked");
  expect(sha(join(root, "prepared", "candidate.db"))).toBe(candidateHash);
  assertUntouched(path, original, plan.archiveSha256);
});

for (const [label, sql] of [
  ["unknown column", "ALTER TABLE user_preferences ADD COLUMN alien TEXT"],
  ["partial FTS", "DROP TABLE family_workspace_fts"],
  ["FK integrity", "PRAGMA foreign_keys=OFF; INSERT INTO user_preferences VALUES('absent-user',1,'dark','retained orphan','now')"],
  ["extra index", "CREATE INDEX alien_index ON user_preferences(theme)"],
  ["missing external guard", "DROP TRIGGER family_scheduled_account_revoked"],
  ["incoming FK", "CREATE TABLE external_reference(id TEXT REFERENCES user_preferences(user_id))"],
  ["quoted view", 'CREATE VIEW external_reference AS SELECT * FROM "USER_PREFERENCES"'],
  ["comment-quoted view", 'CREATE VIEW external_reference AS SELECT * FROM /* " */ operator_recovery_events /* " */'],
  ["comment-quoted trigger", 'CREATE TRIGGER external_reference AFTER INSERT ON users BEGIN SELECT * FROM /* ` */ operator_recovery_events /* ` */; END'],
  ["literal-quoted view", `CREATE VIEW external_reference AS SELECT '"' AS note,* FROM operator_recovery_events WHERE ''!='"'`],
  ["retained trigger", 'CREATE TRIGGER external_reference AFTER INSERT ON users BEGIN SELECT * FROM `user_preferences`; END'],
] as const) test(`malformed or cross-owned ${label} refuses before DDL`, () => {
  const path = source(true, db => db.exec(sql)), plan = copies(path);
  expect(plan.blocked.length).toBeGreaterThan(0);
  const h = handles();
  try {
    const before = snapshotHistoricalDatabase(h.candidate);
    expect(() => applyHistoricalAccounts(h.candidate, h.archive, plan.sha256)).toThrow("blocked");
    expect(snapshotHistoricalDatabase(h.candidate)).toBe(before);
  } finally { h.close(); }
});

test("injected migration failure rolls back every removed object and owned receipt", () => {
  const path = source(), plan = copies(path), h = handles();
  try {
    const before = snapshotHistoricalDatabase(h.candidate), exec = h.candidate.exec.bind(h.candidate);
    const failure = spyOn(h.candidate, "exec").mockImplementation(sql => {
      if (sql === historicalAccountMigration.sql) { exec(sql); throw Error("injected migration failure"); }
      return exec(sql);
    });
    try { expect(() => applyHistoricalAccounts(h.candidate, h.archive, plan.sha256)).toThrow("injected migration failure"); }
    finally { failure.mockRestore(); }
    expect(snapshotHistoricalDatabase(h.candidate)).toBe(before);
    expect(h.candidate.query("SELECT 1 FROM piclaw_schema_migrations WHERE owner=?").get(historicalAccountMigration.owner)).toBeNull();
    expect(h.archive.inTransaction).toBe(false);
  } finally { h.close(); }
});

test("approval, changed copies, aliases, attachment and TEMP shadows are fenced", () => {
  const path = source(), plan = copies(path), directory = join(root, "prepared");
  expect(() => applyHistoricalAccountCopy(directory, "0".repeat(64))).toThrow("approval mismatch");
  const h = handles();
  try {
    expect(() => applyHistoricalAccounts(h.candidate, h.candidate, plan.sha256)).toThrow("Two distinct file-backed handles required");
    const alias = open(join(directory, "archive.db"));
    try { expect(() => applyHistoricalAccounts(alias, h.archive, plan.sha256)).toThrow("different physical files"); }
    finally { alias.close(); }
    h.candidate.exec("CREATE TEMP TABLE user_preferences(value)");
    expect(() => applyHistoricalAccounts(h.candidate, h.archive, plan.sha256)).toThrow("TEMP");
    h.candidate.exec("DROP TABLE temp.user_preferences; ATTACH ':memory:' AS alien");
    expect(() => applyHistoricalAccounts(h.candidate, h.archive, plan.sha256)).toThrow("Attached");
    h.candidate.exec("DETACH alien; INSERT INTO user_preferences VALUES('default',1,'dark','changed','now')");
    expect(() => applyHistoricalAccounts(h.candidate, h.archive, plan.sha256)).toThrow("blocked");
  } finally { h.close(); }
  expect(() => applyHistoricalAccountCopy(directory, plan.sha256)).toThrow("Modified artefacts");
  const linked = join(root, "alias"); linkSync(join(directory, "archive.db"), linked);
  expect(() => applyHistoricalAccountCopy(directory, plan.sha256)).toThrow("exclusive");
  rmSync(linked);
  const saved = readFileSync(join(directory, "candidate.db")); rmSync(join(directory, "candidate.db"));
  symlinkSync(join(directory, "archive.db"), join(directory, "candidate.db"));
  expect(() => applyHistoricalAccountCopy(directory, plan.sha256)).toThrow("exclusive");
  rmSync(join(directory, "candidate.db")); writeFileSync(join(directory, "candidate.db"), saved, { mode: 0o600 });
  chmodSync(directory, 0o755);
  expect(() => applyHistoricalAccountCopy(directory, plan.sha256)).toThrow("private directory");
});

test("historical prepared-access veto remains retained and cannot become a fallback activation", () => {
  const path = source(true, db => db.exec("CREATE TABLE access_migration_preparation(value TEXT); INSERT INTO access_migration_preparation VALUES('retained veto')"));
  const plan = copies(path); expect(plan.blocked).toEqual([]);
  applyHistoricalAccountCopy(join(root, "prepared"), plan.sha256);
  const h = handles();
  try {
    expect(h.candidate.query("SELECT value FROM access_migration_preparation").get()).toEqual({ value: "retained veto" });
    expect(() => readAccessState(h.candidate)).toThrow();
  } finally { h.close(); }
});

test("backup and retirement retain sparse implicit rowids, int64, NUL text and binary values", () => {
  const path = source(true, db => db.exec(`
    INSERT INTO chats(jid) VALUES('web:typed');
    INSERT INTO messages(rowid,id,chat_jid,content,timestamp) VALUES(7,'sparse-one','web:typed','first','now'),(19,'sparse-two','web:typed','second','now');
    CREATE TABLE retained_typed(id INTEGER PRIMARY KEY, large_integer INTEGER, bytes BLOB, text_value TEXT, real_value REAL);
    INSERT INTO retained_typed VALUES(9223372036854775807,9007199254740993,x'00ff', 'a'||char(0)||'b', -0.125);
  `));
  const plan = copies(path); expect(plan.blocked).toEqual([]);
  applyHistoricalAccountCopy(join(root, "prepared"), plan.sha256);
  const h = handles();
  try {
    expect(h.candidate.query("SELECT rowid FROM messages ORDER BY rowid").all()).toEqual([{ rowid: 7n }, { rowid: 19n }]);
    expect(h.candidate.query("SELECT * FROM retained_typed").get()).toEqual({ id: 9223372036854775807n,
      large_integer: 9007199254740993n, bytes: new Uint8Array([0, 255]), text_value: "a\0b", real_value: -0.125 });
    expect(snapshotHistoricalDatabase(h.candidate, true)).toBe(snapshotHistoricalDatabase(h.archive, true));
  } finally { h.close(); }
});

test("a qualified 35-table subset binds its actual reduction without guessing the older audit", () => {
  const path = source(true, db => db.exec("DROP TABLE operator_recovery_events"));
  const plan = copies(path);
  expect(plan.blocked).toEqual([]);
  expect(plan.objects.filter(o => o.kind === "table" && o.storageKind === "table")).toHaveLength(35);
  expect(plan.expectedPhysicalTables).toBe(41);
  expect(applyHistoricalAccountCopy(join(root, "prepared"), plan.sha256).expectedPhysicalTables).toBe(41);
});

test("replaced open files and unexpected sidecars refuse without mutation", () => {
  const path = source(), plan = copies(path), directory = join(root, "prepared"), h = handles();
  try {
    const before = snapshotHistoricalDatabase(h.candidate);
    renameSync(join(directory, "candidate.db"), join(directory, "displaced.db"));
    copyFileSync(join(directory, "archive.db"), join(directory, "candidate.db"));
    expect(() => applyHistoricalAccounts(h.candidate, h.archive, plan.sha256)).toThrow("file binding changed");
    expect(snapshotHistoricalDatabase(h.candidate)).toBe(before);
  } finally { h.close(); }
  writeFileSync(join(directory, "candidate.db-journal"), "synthetic unexpected sidecar");
  expect(() => applyHistoricalAccountCopy(directory, plan.sha256)).toThrow("Unexpected copy sidecar");
});

test("CLI requires explicit input and exact approval and produces metadata-only reports", () => {
  const path = source(), directory = join(root, "cli");
  const cli = (...args: string[]) => Bun.spawnSync([process.execPath,
    new URL("../scripts/retire-historical-accounts.ts", import.meta.url).pathname, ...args],
    { env: process.env, stdout: "pipe", stderr: "pipe" });
  const missing = cli(); expect(missing.exitCode).toBe(1); expect(missing.stderr.toString()).toContain("Usage:");
  const prepared = cli("prepare", path, directory);
  expect(prepared.exitCode, prepared.stderr.toString()).toBe(0);
  const plan = JSON.parse(prepared.stdout.toString()); expect(plan.blocked).toEqual([]);
  expect(plan.expectedPhysicalTables).toBe(42);
  const applied = cli("apply", directory, plan.sha256);
  expect(applied.exitCode, applied.stderr.toString()).toBe(0);
  const result = JSON.parse(applied.stdout.toString()); expect(result.expectedPhysicalTables).toBe(42);
  expect(result.migration).toMatchObject({ owner: historicalAccountMigration.owner, id: historicalAccountMigration.id });
  expect(cli("apply", directory, plan.sha256).exitCode).toBe(1);
});

test("failed rowid probes refuse snapshots instead of silently reducing preservation proof", () => {
  const path = source(), plan = copies(path), h = handles();
  try {
    const before = snapshotHistoricalDatabase(h.candidate), prepare = h.candidate.prepare.bind(h.candidate);
    const failure = spyOn(h.candidate, "prepare").mockImplementation(sql => {
      if (/^SELECT t\."(?:_rowid_|rowid|oid)"/.test(sql)) throw Error("injected rowid probe failure");
      return prepare(sql);
    });
    try {
      expect(() => snapshotHistoricalDatabase(h.candidate)).toThrow("injected rowid probe failure");
      expect(() => applyHistoricalAccounts(h.candidate, h.archive, plan.sha256)).toThrow("Historical logical snapshot could not complete");
    } finally { failure.mockRestore(); }
    expect(snapshotHistoricalDatabase(h.candidate)).toBe(before);
  } finally { h.close(); }
});
