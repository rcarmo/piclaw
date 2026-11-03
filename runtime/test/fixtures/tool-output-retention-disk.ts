/** Retention rollback and trigger contracts on disposable WAL storage. */
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { initDatabase, getDb, closeDatabase, getDatabaseBinding } from "../../src/db/connection.js";
import { storeToolOutputWithChunks, deleteToolOutputsBefore } from "../../src/db/tool-outputs.js";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";
assertPathWithinTestFilesystemIsolation(process.env.PICLAW_STORE!, process.env, { allowRoot: false });
assert.equal(process.env.PICLAW_DB_IN_MEMORY, "0");
try {
  initDatabase(); const db = getDb();
  // Seed atomically; the probe measures retention rollback, not 205 FULL flushes.
  db.transaction(() => {
    for (let n = 0; n < 205; n++) storeToolOutputWithChunks({ id: `expired-${n}`, created_at: "2000-01-01T00:00:00.000Z" }, ["needle"]);
  })();
  const snapshot = () => JSON.stringify({ metadata: db.query("SELECT * FROM tool_outputs ORDER BY id").all(), fts: db.query("SELECT rowid,* FROM tool_outputs_fts ORDER BY rowid").all() });
  const before = snapshot(); let checks = 0;
  assert.throws(() => deleteToolOutputsBefore("2026-01-01", null, () => { if (++checks === 2) throw Error("revoked"); }), /revoked/);
  assert.equal(snapshot(), before);
  const prepare = db.prepare; let batches = 0;
  db.prepare = ((sql: string, ...args: unknown[]) => { if (sql.startsWith("DELETE FROM tool_outputs_fts") && ++batches === 2) throw Error("batch fault"); return Reflect.apply(prepare, db, [sql, ...args]); }) as typeof db.prepare;
  try { assert.throws(() => deleteToolOutputsBefore("2026-01-01"), /batch fault/); }
  finally { db.prepare = prepare; }
  assert.equal(snapshot(), before);
  const observer = new Database(getDatabaseBinding()!.path, { readonly: true });
  try { assert.equal((observer.query("SELECT count(*) n FROM tool_outputs").get() as { n: number }).n, 205); }
  finally { observer.close(true); }
  db.run("CREATE TEMP TABLE observed(id TEXT)");
  db.run("CREATE TEMP TRIGGER skip_retention BEFORE DELETE ON tool_outputs WHEN OLD.id='expired-0' BEGIN INSERT INTO observed VALUES(OLD.id); SELECT RAISE(IGNORE); END");
  try { const removed = deleteToolOutputsBefore("2026-01-01"); assert.equal(removed.length, 204); assert(!removed.some(row => row.id === "expired-0")); }
  finally { db.run("DROP TRIGGER skip_retention"); }
  assert.equal((db.query("SELECT count(*) n FROM tool_outputs_fts").get() as { n: number }).n, 1);
  assert.equal(deleteToolOutputsBefore("2026-01-01").length, 1);
  assert.deepEqual(deleteToolOutputsBefore("2026-01-01"), []);
  assert.deepEqual(db.query("PRAGMA journal_mode").get(), { journal_mode: "wal" });
  assert.deepEqual(db.query("PRAGMA synchronous").get(), { synchronous: 2 });
  assert.deepEqual(db.query("PRAGMA busy_timeout").get(), { timeout: 0 });
  assert.deepEqual(db.query("PRAGMA quick_check").get(), { quick_check: "ok" });
  console.log(JSON.stringify({ status: "pass", rollback: true, secondConnection: true, triggerCounts: true, idempotent: true }));
  db.close(true);
} finally { closeDatabase({ shrinkMemory: false }); }
