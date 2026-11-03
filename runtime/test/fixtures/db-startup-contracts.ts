/** Isolated on-disk init contracts. Does not open an operator database. */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";

const mode = process.argv[2];
assert(["fresh", "empty-file", "existing", "rollback", "late-rollback", "existing-rollback"].includes(mode));
assertPathWithinTestFilesystemIsolation(process.env.PICLAW_STORE!, process.env, { allowRoot: false });
assert.equal(process.env.PICLAW_DB_IN_MEMORY, "0");
const path = join(process.env.PICLAW_STORE!, "messages.db");
mkdirSync(process.env.PICLAW_STORE!, { recursive: true });
if (mode === "empty-file") writeFileSync(path, "");
if (mode === "existing" || mode === "existing-rollback") {
  const legacy = new Database(path);
  legacy.exec("CREATE TABLE fixture_legacy (value TEXT); INSERT INTO fixture_legacy VALUES ('keep-me');");
  assert.equal((legacy.query("PRAGMA auto_vacuum").get() as any).auto_vacuum, 0);
  legacy.close();
}
const exec = Database.prototype.exec;
let vacuums = 0, baseCalls = 0, injectFailure = ["rollback", "late-rollback", "existing-rollback"].includes(mode);
const schemaInTransaction: boolean[] = [];
Database.prototype.exec = function (sql: string) {
  if (/^VACUUM\s*;?$/i.test(sql.trim())) vacuums++;
  if (sql.includes("CREATE TABLE IF NOT EXISTS chats (")) {
    baseCalls++; schemaInTransaction.push(this.inTransaction);
    if (injectFailure && mode === "rollback") {
      exec.call(this, "CREATE TABLE fixture_partial (id INTEGER)");
      throw new Error("Injected base-schema failure");
    }
  }
  if (injectFailure && ["late-rollback", "existing-rollback"].includes(mode) && sql.includes('CREATE TABLE IF NOT EXISTS owned_fork_operations (')) {
    assert(this.inTransaction);exec.call(this, "CREATE TABLE fixture_partial (id INTEGER)");
    throw new Error('Injected late-schema failure');
  }
  return exec.call(this, sql);
};
try {
  if (["rollback", "late-rollback", "existing-rollback"].includes(mode)) {
    assert.throws(initDatabase, /Injected (?:base|late)-schema failure/);
    assert.throws(() => getDb(), /not initialized/);
    const inspect = new Database(path, { readonly: true });
    try {
      assert.equal(inspect.inTransaction, false);
      assert.deepEqual(inspect.query("SELECT name FROM sqlite_schema").all(), mode === "existing-rollback" ? [{ name: "fixture_legacy" }] : []);
    } finally { inspect.close(true); }
    await closeDatabase({ shrinkMemory: false }); injectFailure = false;
  }
  initDatabase();
  const db = getDb();
  assert.equal(db.inTransaction, false);
  assert.equal((db.query("PRAGMA auto_vacuum").get() as any).auto_vacuum, mode.startsWith('existing') ? 0 : 2);
  assert.equal((db.query("PRAGMA journal_mode").get() as any).journal_mode, "wal");
  assert.equal((db.query("PRAGMA synchronous").get() as any).synchronous, 2);
  assert.equal((db.query("PRAGMA secure_delete").get() as any).secure_delete, 1);
  assert.equal((db.query("PRAGMA foreign_keys").get() as any).foreign_keys, 0);
  assert.equal(vacuums, 0);
  assert.deepEqual(schemaInTransaction, ["rollback", "late-rollback", "existing-rollback"].includes(mode) ? [true, true] : [true]);
  if (mode === "existing" || mode === "existing-rollback") assert.deepEqual(db.query("SELECT value FROM fixture_legacy").all(), [{ value: "keep-me" }]);
  db.query("INSERT INTO chats (jid, name) VALUES (?, ?)").run("fixture-chat", "Fixture");
  db.query("INSERT INTO messages (id, chat_jid, content, timestamp, is_bot_message) VALUES (?, ?, ?, ?, ?)").run("fixture-message", "fixture-chat", "synthetic searchable needle", "2026-10-03T00:00:00.000Z", 0);
  assert.equal((db.query("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'needle'").get() as any).n, 1);
  const schema = () => JSON.stringify(getDb().query("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type,name").all());
  const initialSchema = schema();
  db.exec("PRAGMA foreign_keys=ON"); initDatabase();
  assert.equal((db.query("PRAGMA foreign_keys").get() as any).foreign_keys, 1);
  assert.equal(schema(), initialSchema);
  await closeDatabase({ shrinkMemory: false }); initDatabase();
  assert.equal(schema(), initialSchema);
  assert.equal((getDb().query("PRAGMA quick_check").get() as any).quick_check, "ok");
  assert.equal((getDb().query("SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH 'needle'").get() as any).n, 1);
  assert.equal(vacuums, 0);
  assert.equal(baseCalls, ["rollback", "late-rollback", "existing-rollback"].includes(mode) ? 3 : 2);
  console.log(JSON.stringify({ mode, vacuums, schemaInTransaction, schemaStable: true, rowsAndFtsPreserved: true }));
} finally { Database.prototype.exec = exec; await closeDatabase({ shrinkMemory: false }); }
