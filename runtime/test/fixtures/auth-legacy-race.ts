/** Deterministic synthetic legacy repair races on separate WAL connections. */
import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { assertPathWithinTestFilesystemIsolation } from "../../scripts/test-filesystem-isolation.js";

const [role, mode] = process.argv.slice(2);
assert(["delete", "expire", "owner", "method", "created", "identity", "migrate", "id-delete", "id-expire", "id-owner", "id-method", "id-created", "null-method", "both-migrate", "id-migrate"].includes(mode));
assertPathWithinTestFilesystemIsolation(process.env.PICLAW_STORE!, process.env, { allowRoot: false });
assert.equal(process.env.PICLAW_DB_IN_MEMORY, "0");
const path = join(process.env.PICLAW_STORE!, "messages.db"), ready = join(process.env.PICLAW_STORE!, "ready"), go = join(process.env.PICLAW_STORE!, "go");
const hash = createHash("sha256").update("synthetic-legacy").digest("hex");
async function wait(file: string) { const end = performance.now() + 10000; while (!existsSync(file)) { assert(performance.now() < end, "barrier deadline"); await Bun.sleep(2); } }
if (role === "writer") {
  const db = new Database(path); db.run("PRAGMA busy_timeout=5000"); db.run("PRAGMA synchronous=2");
  try {
    db.run("BEGIN IMMEDIATE");
    if (mode === "delete" || mode === "id-delete") db.run("DELETE FROM web_sessions");
    if (mode === "expire" || mode === "id-expire") db.run("UPDATE web_sessions SET expires_at='2000-01-01T00:00:00.000Z'");
    if (mode === "owner" || mode === "id-owner") db.run("UPDATE web_sessions SET user_id='other-fixture'");
    if (mode === "method" || mode === "id-method" || mode === "null-method") db.run("UPDATE web_sessions SET auth_method='passkey'");
    if (mode === "created" || mode === "id-created") db.run("UPDATE web_sessions SET created_at='2000-01-01T00:00:00.000Z'");
    if (mode === "identity") db.run("UPDATE web_sessions SET session_id='login-replacement'");
    if (mode === "migrate" || mode === "both-migrate") db.query("UPDATE web_sessions SET token=?").run(hash);
    if (mode === "both-migrate") db.run("UPDATE web_sessions SET session_id='login-concurrent-repair'");
    if (mode === "id-migrate") db.run("UPDATE web_sessions SET session_id='login-concurrent-repair'");
    writeFileSync(ready, "ready"); await wait(go);
    const start = performance.now(), cpu = process.cpuUsage(); await Bun.sleep(250); db.run("COMMIT");
    console.log(JSON.stringify({ writer: true, ms: performance.now() - start, cpu: process.cpuUsage(cpu) }));
  } finally { if (db.inTransaction) db.run("ROLLBACK"); db.close(true); }
} else {
  assert.equal(role, "reader");
  const { initDatabase, getDb, closeDatabase } = await import("../../src/db/connection.js");
  const { createWebSession, getWebSession } = await import("../../src/db/web-sessions.js");
  let child: ReturnType<typeof Bun.spawn> | undefined;
  try {
    initDatabase(); const db = getDb(); createWebSession("synthetic-legacy", "default", 3600, "totp");
    if (mode.startsWith("id-")) db.run("UPDATE web_sessions SET session_id=NULL");
    else db.run("UPDATE web_sessions SET token='synthetic-legacy'");
    if (mode === "null-method") db.run("UPDATE web_sessions SET auth_method=NULL");
    if (mode === "both-migrate") db.run("UPDATE web_sessions SET session_id=NULL");
    assert.deepEqual(db.query("PRAGMA journal_mode").all()[0], { journal_mode: "wal" });
    assert.deepEqual(db.query("PRAGMA synchronous").all()[0], { synchronous: 2 });
    const writer = Bun.spawn([process.execPath, "--no-env-file", import.meta.filename, "writer", mode], { env: process.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" }); child = writer;
    const output = Promise.all([new Response(writer.stdout).text(), new Response(writer.stderr).text(), writer.exited]);
    await wait(ready);
    let selectedOld = false;
    // The writer has changed its private transaction, but the reader still sees
    // the committed old legacy state before it requests a writer lock.
    const old = db.query("SELECT user_id FROM web_sessions").get() as { user_id: string };
    assert.equal(old.user_id, "default"); selectedOld = true;
    const originalPrepare = db.prepare; let repairReached = false, selectCalls = 0, updateCalls = 0;
    // Release the writer only after getWebSession itself has read the old row
    // and reaches its repair. This is an ordering hook, not simulated SQL.
    db.prepare = ((sql: string, ...params: unknown[]) => {
      const statement = Reflect.apply(originalPrepare, db, [sql, ...params]);
      return new Proxy(statement, { get(t, key) {
        if (key === "get" && sql.startsWith("SELECT")) return (...args: unknown[]) => { selectCalls++; return Reflect.apply(t.get, t, args); };
        if (key === "run" && sql.startsWith("UPDATE web_sessions")) return (...args: unknown[]) => {
          updateCalls++; if (!repairReached) { repairReached = true; writeFileSync(go, "go"); }
          return Reflect.apply(t.run, t, args);
        };
        return Reflect.get(t, key, t);
      } });
    }) as typeof db.prepare;
    const cpu = process.cpuUsage(), start = performance.now(); let result: ReturnType<typeof getWebSession> = null, error: string | null = null;
    let timerMs = 0; const timer = new Promise<void>(resolve => setTimeout(() => { timerMs = performance.now() - start; resolve(); }, 0));
    try { result = getWebSession("synthetic-legacy"); } catch (e) { error = e instanceof Error ? e.name : "Error"; }
    finally { db.prepare = originalPrepare; }
    assert(repairReached, "actual repair must overlap the writer");
    const elapsedMs = performance.now() - start, used = process.cpuUsage(cpu); await timer;
    const [out, err, exit] = await output; assert.equal(exit, 0, err);
    const rows = db.query("SELECT user_id,expires_at FROM web_sessions").all() as Array<{user_id:string;expires_at:string}>;
    const observation = { mode, selectedOld, repairReached, selectCalls, updateCalls, returned: Boolean(result), returnedOldOwner: result?.user_id === "default", returnedOtherOwner: result?.user_id === "other-fixture", error, rows: rows.length, elapsedMs, timerMs, cpu: used, writer: JSON.parse(out.trim().split("\n").at(-1)!) };
    if (process.argv.includes("--observe")) console.log(JSON.stringify({ ...observation, observationOnly: true }));
    else {
      if (mode === "migrate" || mode === "id-migrate" || mode === "both-migrate") { assert.equal(error, null); assert.equal(result?.user_id, "default"); if (mode !== "migrate") assert.equal(result?.session_id, "login-concurrent-repair"); }
      else if (mode === "owner" || mode === "id-owner") { assert.equal(error, null); assert.equal(result, null); }
      else { assert.equal(error, null); assert.equal(result, null); }
      console.log(JSON.stringify({ ...observation, status: "pass" }));
    }
  } finally { if (child && child.exitCode === null) { child.kill("SIGKILL"); await child.exited; } closeDatabase(); }
}
