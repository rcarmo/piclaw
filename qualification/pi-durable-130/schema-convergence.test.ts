import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeHostSchema, initializeHostDurableBindings, createHostDurableBindings, HostCutoverController } from "../../runtime/durable-engine/src/index.js";

test("host schema: FK, exact synchronous guard, atomic DDL and incompatible shapes fail closed", () => {
  const db = new Database(":memory:");
  const tables = () => db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  try {
    expect(() => initializeHostSchema(db, () => {})).toThrow("foreign_keys ON");
    db.exec("PRAGMA foreign_keys=ON");
    for (const guard of [() => true, () => Promise.resolve()]) {
      expect(() => initializeHostSchema(db, guard as () => void)).toThrow("owner guard");
      expect(tables()).toEqual([]);
    }
    let calls = 0;
    expect(() => initializeHostSchema(db, () => { if (++calls === 3) throw Error("Owner lost"); })).toThrow("Owner lost");
    expect(tables()).toEqual([]);
    db.exec("CREATE TABLE qualification_cutover_work_v1 (domain TEXT)");
    expect(() => initializeHostSchema(db, () => {})).toThrow("Unsupported host schema");
    expect(tables()).toEqual([{ name: "qualification_cutover_work_v1" }]);
  } finally { db.close(); }
});

test("host schema: existing primary/submission identity preserved; missing intents unsupported on reads", async () => {
  const db = new Database(":memory:"); db.exec("PRAGMA foreign_keys=ON");
  try {
    initializeHostDurableBindings(db, () => {});
    db.query("INSERT INTO piclaw_durable_bindings_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("d", "i", 1, "chat", "main", "op", 1, "source", "payload", "request", "a".repeat(64), 42);
    const rows = () => db.query("SELECT * FROM piclaw_durable_bindings_v1").all();
    const before = rows(); initializeHostSchema(db, () => {}); expect(rows()).toEqual(before);
    const drift = new Database(":memory:");
    try {
      drift.exec("PRAGMA foreign_keys=ON");
      const ddl = (db.query("SELECT sql FROM sqlite_master WHERE name='piclaw_durable_bindings_v1'").get() as { sql: string }).sql;
      drift.exec(ddl.replace("UNIQUE(domain,incarnation,submission_id),", ""));
      expect(() => initializeHostSchema(drift, () => {})).toThrow("Unsupported host schema");
      expect(drift.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([{ name: "piclaw_durable_bindings_v1" }]);
    } finally { drift.close(); }
    expect((db.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(0);
    db.exec("DROP TABLE piclaw_durable_intent_bindings_v1");
    const store = createHostDurableBindings(db, { domain: "d", incarnation: "i", manifest: [], assertOwner() {}, async resolveContent() { return ""; } });
    await expect(store.findSource("chat", 1)).rejects.toThrow("Unsupported host schema");
    expect(rows()).toEqual(before);
    expect(db.query("SELECT name FROM sqlite_master WHERE name='piclaw_durable_intent_bindings_v1'").get()).toBeNull();
  } finally { db.close(); }
});

test("cutover: stale JSON count cannot override existing work rows on inspect, record or rollback", () => {
  const db = new Database(":memory:"); db.exec("PRAGMA foreign_keys=ON");
  try {
    initializeHostSchema(db, () => {});
    const identity = { domain: "d", incarnation: "i", ownerGeneration: 1, sourceEngineId: "source", candidateStoreRef: "candidate" };
    const digest = "a".repeat(64);
    const manifest = { phase: "active", revision: 0, writer: "candidate", postCutoverCount: 999,
      request: { requestKey: "r", sourceDigest: digest, importHash: digest }, receipt: null };
    db.query("INSERT INTO qualification_cutover_v1 VALUES (?,?,?,?)").run("d", JSON.stringify(identity), digest, JSON.stringify(manifest));
    const controller = new HostCutoverController(db, identity, { assertOwner() {}, assertCurrentWriter() {},
      checkDrained() { return { sourceDigest: digest, pending: 0, inflight: 0 }; } });
    expect(controller.inspect()!.postCutoverCount).toBe(0);
    db.query("INSERT INTO qualification_cutover_work_v1 VALUES (?,?,?)").run("d", "op", digest);
    expect(controller.inspect()!.postCutoverCount).toBe(1);
    expect(controller.recordPostCutoverWork(0, { operationId: "op", contentHash: digest }).postCutoverCount).toBe(1);
    expect(controller.recordPostCutoverWork(1, { operationId: "op2", contentHash: digest }).postCutoverCount).toBe(2);
    expect(controller.prepareRollback(2).reasons).toContain("recorded_work");
  } finally { db.close(); }
});
