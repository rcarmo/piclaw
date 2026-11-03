import { Database } from "bun:sqlite";
import { expect, spyOn } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase, getDatabaseBinding } from "../../src/db/connection.js";
import * as checkpoints from "../../src/db/sqlite-checkpoint.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../src/utils/logger.js";
import { startSchedulerLoop, stopSchedulerLoop, type SchedulerDeps } from "../../src/task-scheduler.js";
import { BunSqliteDatabase } from "../../durable-engine/src/bun-sqlite.js";
import { waitFor } from "../helpers.js";

if (process.env.PICLAW_TEST_FS_ISOLATION_ACTIVE !== "1") throw Error("Owned fixture launcher required");
const scenario = process.argv[2] ?? "file";
// Shared test helpers default to memory; select this owned fixture's role explicitly.
process.env.PICLAW_DB_IN_MEMORY = scenario.startsWith("memory") ? "1" : "0";
const deps = { queue: { enqueueTask() { throw Error("No work is permitted in this fixture"); } },
  agentPool: {}, async sendMessage() {} } as unknown as SchedulerDeps;
mkdirSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw"), { recursive: true });
writeFileSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
const registrations: Database[] = [], removals: Database[] = [], records: LogRecord[] = [];
const register = checkpoints.registerSqliteCheckpoint;
const registration = spyOn(checkpoints, "registerSqliteCheckpoint").mockImplementation((db, path) => {
  const stop = register(db, path, true); // Force eligible filesystem policy only in this isolated fixture.
  registrations.push(db);
  return () => { removals.push(db); stop?.(); };
});
const sink = (record: LogRecord) => { if (record.module === "db.checkpoint") records.push(record); };
addLogSink(sink);
let sdk: BunSqliteDatabase | undefined;
let stop: (() => Promise<void>) | undefined;
try {
  initDatabase(); const root = getDb();
  expect(root.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 });
  if (scenario === "memory-enable-failure") {
    const failure = Error("memory FK enable failed"), exec = root.exec.bind(root);
    const enable = spyOn(root, "exec").mockImplementation(sql => {
      if (sql === "PRAGMA foreign_keys=ON") throw failure;
      return exec(sql);
    });
    try { expect(() => startSchedulerLoop(deps)).toThrow(failure); }
    finally { enable.mockRestore(); }
    expect(root.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 });
    stop = startSchedulerLoop(deps);
    expect(root.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    await stop();
    expect(root.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 });
    expect(registrations).toHaveLength(0);
  } else if (scenario === "failure" || scenario === "memory-failure") {
    root.exec("DROP TABLE service_effect_s07_occurrences");
    const closed: Database[] = [], originalClose = Database.prototype.close;
    const close = spyOn(Database.prototype, "close").mockImplementation(function(this: Database) {
      closed.push(this); return originalClose.call(this);
    });
    try {
      expect(() => startSchedulerLoop(deps)).toThrow("Scheduled run store unavailable");
      expect(closed).toHaveLength(scenario === "failure" ? 1 : 0);
      expect(closed.includes(root)).toBe(false);
      expect(root.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
      expect(root.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 });
      expect(registrations).toHaveLength(scenario === "failure" ? 1 : 0);
    } finally { close.mockRestore(); }
  } else if (scenario === "memory") {
    expect(getDatabaseBinding()).toBeNull();
    for (let i = 0; i < 2; i++) {
      stop = startSchedulerLoop(deps);
      expect(root.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
      await stop();
      expect(root.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 });
      expect(root.query("SELECT 1 AS alive").get()).toEqual({ alive: 1 });
    }
    expect(registrations).toHaveLength(0);
  } else {
    const path = getDatabaseBinding()!.path;
    sdk = new BunSqliteDatabase(path, { root, assertOwner() {}, fenceTransactions: true });
    stop = startSchedulerLoop(deps);
    expect(registrations).toHaveLength(3);
    expect(new Set(registrations).size).toBe(3);
    const scheduler = registrations[2]!;
    for (const [i, db] of registrations.entries()) {
      expect(db.query("PRAGMA busy_timeout").get()).toEqual({ timeout: 0 });
      expect(db.query("PRAGMA synchronous").get()).toEqual({ synchronous: 2 });
      expect(db.query("PRAGMA secure_delete").get()).toEqual({ secure_delete: 1 });
      expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: i === 0 ? 0 : 1 });
    }
    await waitFor(() => registrations.every(db => (db.query("PRAGMA wal_autocheckpoint").get() as any).wal_autocheckpoint === 0), 3000);
    expect(records.filter(record => record.operation === "sqlite_checkpoint.ready")).toHaveLength(1);
    root.exec("CREATE TABLE role_probe(value BLOB); INSERT INTO role_probe VALUES(zeroblob(5000000))");
    await waitFor(() => records.some(record => record.operation === "sqlite_checkpoint.progress" && record.activeConnectionCount === 3), 3000);
    await stop();
    expect(removals.filter(db => db === scheduler)).toHaveLength(1);
    expect(() => scheduler.query("SELECT 1")).toThrow();
    expect(root.query("PRAGMA wal_autocheckpoint").get()).toEqual({ wal_autocheckpoint: 0 });
    root.exec("INSERT INTO role_probe VALUES(zeroblob(5000000))");
    await waitFor(() => records.some(record => record.operation === "sqlite_checkpoint.progress" && record.activeConnectionCount === 2), 3000);
    await sdk.close(); sdk = undefined;
    expect(root.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 0 });
  }
  console.log(JSON.stringify({ scenario, schedulerRoles: true, separateHandles: scenario === "file", noModelEffects: true }));
} finally {
  await stop?.(); await stopSchedulerLoop(); await sdk?.close(); closeDatabase(); registration.mockRestore(); removeLogSink(sink);
}
