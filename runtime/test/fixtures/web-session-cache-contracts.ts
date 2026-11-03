/** Real disk SQLite contract for compiled auth statements; synthetic cookies only. */
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { createWebSession, getWebSession, deleteExpiredWebSessions } from "../../src/db/web-sessions.js";
import { getUser } from "../../src/db/users.js";
import { resolveRequestPrincipal } from "../../src/channels/web/auth/principal.js";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";

assertPathWithinTestFilesystemIsolation(process.env.PICLAW_STORE!, process.env, { allowRoot: false });
assert.equal(process.env.PICLAW_DB_IN_MEMORY, "0");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let external: Database | undefined;
try {
  initDatabase(); let db = getDb();
  assert.deepEqual(db.query("PRAGMA journal_mode").get(), { journal_mode: "wal" });
  assert.deepEqual(db.query("PRAGMA synchronous").get(), { synchronous: 2 });
  const a = createWebSession("fixture-a", "default", 3600, "totp");
  const b = createWebSession("fixture-b", "bob", 3600, "passkey");
  for (let n = 0; n < 10; n++) {
    assert.equal(getWebSession("fixture-a")?.session_id, a.session_id);
    assert.equal(getWebSession("absent"), null);
    assert.equal(getWebSession("fixture-b")?.session_id, b.session_id);
  }
  // No repeated prepare calls for SELECT or expiry DELETE on the hot path.
  let prepares = 0;
  const original = db.prepare;
  db.prepare = ((...args: Parameters<typeof db.prepare>) => { prepares++; return Reflect.apply(original, db, args); }) as typeof db.prepare;
  try { getWebSession("fixture-a"); getWebSession("absent"); deleteExpiredWebSessions(); }
  finally { db.prepare = original; }
  assert.equal(prepares, 0);
  // Caller-owned results and eviction from Bun's bounded statement cache must
  // not change later reads or leave a retained invalid statement.
  const detached = getWebSession("fixture-a")!; detached.user_id = "not-default";
  const selectSql = "SELECT token, user_id, auth_method, created_at, expires_at, session_id FROM web_sessions WHERE token = ?";
  const cached = db.query(selectSql); assert.equal(db.query(selectSql), cached);
  for (let n = 0; n < 50; n++) assert.equal((db.query(`SELECT ${n} AS n`).get() as { n: number }).n, n);
  assert.notEqual(db.query(selectSql), cached, "churn must actually evict the cached statement");
  assert.equal(getWebSession("fixture-a")?.user_id, "default");
  external = new Database(join(process.env.PICLAW_STORE!, "messages.db"));
  external.run("PRAGMA busy_timeout=5000");
  external.query("DELETE FROM web_sessions WHERE token = ?").run(hash("fixture-a"));
  assert.equal(getWebSession("fixture-a"), null);
  assert.equal(getWebSession("fixture-b")?.user_id, "bob");
  createWebSession("fixture-a", "default", 3600, "totp");
  const req = new Request("https://fixture.invalid/agent/me", { headers: { cookie: "piclaw_session=fixture-a" } });
  const principal = () => resolveRequestPrincipal(req, { mode: "single-user", authEnabled: true }, { getSession: getWebSession, getUser: id => getUser(db, id), getLocalDisplayName: () => "Fixture" });
  assert.equal(principal()?.userId, "default");
  external.query("UPDATE users SET enabled = 0 WHERE id = 'default'").run();
  assert.equal(principal(), null);
  external.query("UPDATE users SET enabled = 1 WHERE id = 'default'").run();
  assert.equal(principal()?.userId, "default");

  // A statement cache must not change transaction snapshot semantics or retain
  // a WAL snapshot after the transaction finishes.
  db.run("BEGIN"); assert(getWebSession("fixture-b"));
  external.query("DELETE FROM web_sessions WHERE token = ?").run(hash("fixture-b"));
  assert(getWebSession("fixture-b")); db.run("COMMIT"); assert.equal(getWebSession("fixture-b"), null);
  assert.throws(() => db.transaction(() => {
    db.query("DELETE FROM web_sessions WHERE token = ?").run(hash("fixture-a"));
    assert.equal(getWebSession("fixture-a"), null); throw Error("rollback fixture");
  })(), /rollback fixture/);
  assert(getWebSession("fixture-a"));

  // Expiry is checked again, and the timestamp parameter on the cached DELETE
  // changes on every call.
  const old = "2000-01-01T00:00:00.000Z", future = "2999-01-01T00:00:00.000Z";
  external.query("UPDATE web_sessions SET expires_at = ? WHERE token = ?").run(old, hash("fixture-a"));
  assert.equal(getWebSession("fixture-a"), null);
  assert.equal((db.query("SELECT count(*) n FROM web_sessions WHERE token=?").get(hash("fixture-a")) as { n: number }).n, 1, "denied expired row awaits maintenance");
  createWebSession("expiry-a", "default", 3600, "totp");
  createWebSession("expiry-b", "default", 7200, "totp");
  external.query("UPDATE web_sessions SET expires_at = ? WHERE token = ?").run(old, hash("expiry-a"));
  assert.equal(deleteExpiredWebSessions(new Date(old)), 2); // fixture-a and expiry-a await this physical sweep.
  assert.equal(db.query("SELECT 1 FROM web_sessions WHERE token IN (?,?)").get(hash("fixture-a"), hash("expiry-a")), null);
  assert(getWebSession("expiry-b"));
  assert.equal(deleteExpiredWebSessions(new Date(future)), 1);
  assert.equal(getWebSession("expiry-b"), null);

  // Explicit legacy plaintext migration preserves identity and binds the next
  // hashed lookup correctly after the same statement was used for plaintext.
  db.query("INSERT INTO web_sessions(token,user_id,created_at,expires_at) VALUES (?,?,?,?)").run("legacy-fixture", "default", old, future);
  const legacy = getWebSession("legacy-fixture"); assert(legacy?.session_id);
  assert.equal(getWebSession("legacy-fixture")?.session_id, legacy.session_id);
  assert.equal(db.query("SELECT 1 FROM web_sessions WHERE token = ?").get("legacy-fixture"), null);
  external.close(); external = undefined;

  // Reprepare after DDL on the same connection: stale compiled bytecode cannot
  // authenticate against a dropped table's rows.
  db.run("DROP TABLE web_sessions");
  db.run("CREATE TABLE web_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL,auth_method TEXT,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,session_id TEXT)");
  // Rebuild the owned index as part of this fixture's current schema. This
  // exercises statement invalidation, not repair of missing already-owned DDL.
  db.run("CREATE UNIQUE INDEX idx_web_sessions_session_id ON web_sessions(session_id) WHERE session_id IS NOT NULL");
  assert.equal(getWebSession("legacy-fixture"), null);
  const renewed = createWebSession("legacy-fixture", "new-user", 3600, "passkey");
  assert.equal(getWebSession("legacy-fixture")?.session_id, renewed.session_id);
  assert.equal(getWebSession("legacy-fixture")?.user_id, "new-user");
  await closeDatabase(); initDatabase(); db = getDb();
  assert.equal(getWebSession("legacy-fixture")?.session_id, renewed.session_id);
  assert.equal(getWebSession("fixture-a"), null);
  assert.deepEqual(db.query("PRAGMA quick_check").get(), { quick_check: "ok" });
  console.log(JSON.stringify({ status: "pass", bindings: true, externalRevocation: true, disabledUser: true, transactionSnapshot: true, rollback: true, expiry: true, legacyMigration: true, schemaReprepare: true, reopen: true, hotPathPrepares: prepares, journal: "wal", synchronous: 2 }));
} finally { external?.close(); await closeDatabase(); }
