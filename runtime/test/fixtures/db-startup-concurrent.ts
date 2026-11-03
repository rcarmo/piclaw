import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { initDatabase, getDb, closeDatabase, getDatabaseBinding } from "../../src/db/connection.js";
import { isSqliteContention } from "../../src/db/sqlite-async-admission.js";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";
const [ready, go, resume] = process.argv.slice(2);
for (const path of [ready, go, resume]) assertPathWithinTestFilesystemIsolation(path, process.env, { allowRoot: false });
async function wait(path: string) {
  const deadline = Date.now() + 10000;
  while (!existsSync(path)) { assert(Date.now() < deadline, "start barrier timed out"); await Bun.sleep(5); }
}
function verify() {
  const db = getDb();
  assert.equal((db.query("PRAGMA busy_timeout").get() as any).timeout, 0);
  assert.equal((db.query("PRAGMA quick_check").get() as any).quick_check, "ok");
  assert.equal((db.query("PRAGMA auto_vacuum").get() as any).auto_vacuum, 2);
  assert.equal((db.query("PRAGMA journal_mode").get() as any).journal_mode, "wal");
  assert.equal((db.query("PRAGMA synchronous").get() as any).synchronous, 2);
  assert(db.query("SELECT name FROM sqlite_schema WHERE name='messages_fts'").get());
}
writeFileSync(ready, "ready"); await wait(go);
let outcome = "ready";
try { initDatabase(); verify(); }
catch (error) {
  if (!isSqliteContention(error)) throw error;
  outcome = "busy";
  assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
} finally { await closeDatabase({ shrinkMemory: false }); }
writeFileSync(ready + ".attempt", JSON.stringify({ outcome }));
// Zero-wait offline bootstrap may fail promptly. Only the external fixture
// controller starts a fresh attempt, after both earlier SQLite lifetimes closed.
// This is not a production retry loop or provider/SDK callback replay.
await wait(resume);
try { initDatabase(); verify(); console.log("CONCURRENT_INIT_OK"); }
finally { await closeDatabase({ shrinkMemory: false }); }
