import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";
import { barrier, context, openFixture } from "./src/fixture.js";
import { assertHandoffOwner, hostHandoff, at, effect, sealed, value } from "./src/host-handoff.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver as Payloads } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";
class Runtime {
  validateOwnership?: () => boolean;
  // Qualification fault injection only; this hook is BEFORE the resolver await.
  constructor(readonly denyBeforeEffect: () => boolean = () => false) {}
  lost = false;
  plan(_point: "effect_then_lost_acknowledgement") { this.lost = true; }
  hitFault(point: string) {
    if (point === "before_effect") return this.denyBeforeEffect();
    if (point === "effect_then_lost_acknowledgement" && this.lost) { this.lost = false; return true; }
    return false;
  }
  recordTrace() {}
}

async function fixture(run: (path: string, db: Database, payloads: Payloads, runtime: Runtime) => Promise<void>) {
  const directory = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "handoff-"));
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase();
  const path = join(directory, "host.sqlite");
  getDb().query("VACUUM INTO ?").run(path);
  closeDatabase();
  const db = new Database(path, { strict: true });
  db.exec("PRAGMA foreign_keys=ON");
  installTerminalSettlementCompositionSchema(db);
  try { await run(join(directory, "durable.sqlite"), db, new Payloads(), new Runtime()); }
  finally { db.close(); await rm(directory, { recursive: true, force: true }); }
}
function stores(db: Database, payloads: Payloads, runtime: Runtime) {
  return { work: value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} })),
    terminal: value(createCurrentPiclawTerminalSettlementStore(db, payloads, runtime)) };
}
const open = (path: string) => openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path)));

test("real host acceptance survives before submit, lost submit ack, reopen and EF-S02 lost ack dedup", () => fixture(async (path, originalDb, payloads, runtime) => {
  let db = originalDb;
  let current = await open(path);
  let { work, terminal } = stores(db, payloads, runtime);
  let handoff = hostHandoff(db, work, terminal, current, "store-A", 1, (ref, text) => payloads.putText(ref, text));
  try {
    expect(await handoff("request-1", "hello", "accepted")).toBeNull();
    expect(await current.storage.submissionByRequest(current.root.id, "request-1", context)).toBeUndefined();
    await current.close(); current = await open(path);
    handoff = hostHandoff(db, work, terminal, current, "store-A", 2, (ref, text) => payloads.putText(ref, text));
    expect(await handoff("request-1", "hello", "submitted")).toBeNull();
    const record = await current.storage.submissionByRequest(current.root.id, "request-1", context);
    await (await current.harness.submission(record!.id, context))!.wait(context); // Explicit test execution, not reconciliation.
    await current.close(); current = await open(path);
    const old = handoff;
    const hostPath = (db.query("PRAGMA database_list").get() as { file: string }).file;
    db = new Database(hostPath, { strict: true });
    db.exec("PRAGMA foreign_keys=ON");
    ({ work, terminal } = stores(db, payloads, runtime));
    handoff = hostHandoff(db, work, terminal, current, "store-A", 3, (ref, text) => payloads.putText(ref, text));
    await expect(old("request-1", "hello")).rejects.toThrow("owner lost");
    runtime.plan("effect_then_lost_acknowledgement");
    await expect(handoff("request-1", "hello")).rejects.toThrow("storage_unavailable");
    const settled = await handoff("request-1", "hello");
    expect(settled?.disposition).toBe("completed");
    expect(db.query("SELECT count(*) AS n FROM service_effect_s02_commits").get()).toEqual({ n: 1 });
    expect(await handoff("request-1", "hello")).toEqual(settled);
    expect(db.query("SELECT content FROM messages WHERE is_bot_message=1").all()).toEqual([{ content: "synthetic answer" }]);
    expect(value(await work.getChatFrontier("web:qualification")).consumedThroughSourceSeq).toBe(1);
    expect(current.host.modelCalls).toBe(0);
    await expect(handoff("request-1", "changed")).rejects.toThrow("binding conflict");
    expect(() => hostHandoff(db, work, terminal, current, "store-B", 1, () => {})).toThrow("binding conflict");
    expect(() => hostHandoff(db, work, terminal, current, "", 4, () => {})).toThrow("incarnation required");
  } finally { await current.close(); if (db !== originalDb) db.close(); }
}), 20000);

test("host accepted cancellation during held model wins over late committed answer", () => fixture(async (path, db, payloads, runtime) => {
  const current = await open(path);
  const { work, terminal } = stores(db, payloads, runtime);
  const handoff = hostHandoff(db, work, terminal, current, "store-C", 1, (ref, text) => payloads.putText(ref, text));
  try {
    current.host.modelHold = barrier();
    expect(await handoff("cancelled", "hello")).toBeNull();
    const operation = value(await work.getOperation("host:cancelled"))!;
    const cancel = value(await work.acceptSource(sealed({ effect: effect("accept-cancel"), chatJid: operation.chatJid,
      sourceId: "cancel-source", kind: "cancellation" as const, payloadRef: "cancel:payload", targetOperationId: operation.operationId,
      parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    value(await work.acceptCancellation(sealed({ effect: effect("cancel", operation.operationId, cancel.sourceSeq),
      expectedVersion: operation.version, sourceId: "cancel-source", sourceSeq: 2, cause: "user", requestedAt: at })));
    current.host.modelHold.release();
    const record = await current.storage.submissionByRequest(current.root.id, "cancelled", context);
    await (await current.harness.submission(record!.id, context))!.wait(context);
    expect((await handoff("cancelled", "hello"))?.disposition).toBe("cancelled");
    expect(db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toEqual([]);
  } finally { current.host.modelHold?.release(); await current.close(); }
}), 20000);

for (const phase of ["claim", "bind"] as const) {
  test(`takeover after awaited operation read prevents ${phase} mutation`, () => fixture(async (path, db, payloads, runtime) => {
    const current = await open(path);
    const { work, terminal } = stores(db, payloads, runtime);
    const add = (ref: string, text: string) => payloads.putText(ref, text);
    const prepare = hostHandoff(db, work, terminal, current, "store-read", 1, add);
    const entered = barrier(), hold = barrier();
    let pending: Promise<unknown> | undefined;
    try {
      if (phase === "bind") {
        await prepare("read-race", "hello", "submitted");
        const record = await current.storage.submissionByRequest(current.root.id, "read-race", context);
        await (await current.harness.submission(record!.id, context))!.wait(context);
      }
      let reads = 0;
      const heldWork = new Proxy(work, {
        get(target, key) {
          if (key === "getOperation") return async (id: string) => {
            const result = await target.getOperation(id);
            if (++reads === (phase === "claim" ? 1 : 2)) { entered.release(); await hold.promise; }
            return result;
          };
          const member = Reflect.get(target, key, target);
          return typeof member === "function" ? member.bind(target) : member;
        },
      });
      const handoff = hostHandoff(db, heldWork, terminal, current, "store-read", 1, add);
      pending = handoff("read-race", "hello").catch(error => error);
      await entered.promise;
      hostHandoff(db, work, terminal, current, "store-read", 2, add);
      hold.release(); // Never await a rejection assertion while holding the resolver/read.
      expect(await pending).toBeInstanceOf(Error);
      expect(String(await pending)).toContain("owner lost");
      const operation = value(await work.getOperation("host:read-race"));
      if (phase === "claim") expect(operation).toBeNull();
      else expect(operation?.harness).toBeNull();
      expect(db.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);
      expect(db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toEqual([]);
    } finally { hold.release(); await pending; await current.close(); }
  }), 20000);
}

test("commit ownership guard blocks takeover during actual payload resolution without SQL publication", () => fixture(async (path, db, payloads, runtime) => {
  const current = await open(path);
  let checks = 0;
  runtime.validateOwnership = () => {
    checks++;
    expect(db.inTransaction).toBe(true);
    try { assertHandoffOwner(db, current, "store-guard", 1); return true; }
    catch { return false; }
  };
  const { work, terminal } = stores(db, payloads, runtime);
  const add = (ref: string, text: string) => payloads.putText(ref, text);
  const handoff = hostHandoff(db, work, terminal, current, "store-guard", 1, add);
  let release: (() => void) | undefined;
  let pending: Promise<unknown> | undefined;
  try {
    await handoff("guarded-race", "hello", "submitted");
    const record = await current.storage.submissionByRequest(current.root.id, "guarded-race", context);
    await (await current.harness.submission(record!.id, context))!.wait(context);
    const ref = `answer:${record!.id}`;
    release = payloads.hold(ref);
    pending = handoff("guarded-race", "hello").catch(error => error);
    await payloads.waitUntilHeld(ref);
    expect(checks).toBe(0);
    const before = value(await work.getOperation("host:guarded-race"));
    hostHandoff(db, work, terminal, current, "store-guard", 2, add);
    release();
    expect(String(await pending)).toContain('"_tag":"owner_conflict","certainty":"not_applied","retryable":false');
    expect(checks).toBe(1);
    expect(db.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);
    expect(db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toEqual([]);
    expect(db.query("SELECT * FROM service_effect_s05_outbox").all()).toEqual([]);
    expect(db.query("SELECT state FROM service_effect_s01_sources").all()).toEqual([{ state: "claimed" }]);
    expect(value(await work.getOperation("host:guarded-race"))).toEqual(before);
    expect(value(await work.getChatFrontier("web:qualification")).consumedThroughSourceSeq).toBe(0);
    expect(value(await terminal.getTerminal("host:guarded-race"))).toBeNull();
  } finally { release?.(); await pending; await current.close(); }
}), 20000);

for (const entryGuard of [false, true]) {
  test(`NOT ADMITTED: stale owner publishes inside payload await (entry fault guard=${entryGuard})`, () => fixture(async (path, db, payloads) => {
    const current = await open(path);
    // Actual adapter hook, explicitly fixture-only. It runs before resolveTimeline,
    // so even a successful generation check here is NOT a commit-time guard.
    let checks = 0;
    const runtime = new Runtime(() => {
      if (!entryGuard) return false;
      checks++;
      return (db.query("SELECT generation FROM qualification_owner WHERE singleton=1").get() as { generation: number }).generation !== 1;
    });
    const { work, terminal } = stores(db, payloads, runtime);
    const add = (ref: string, text: string) => payloads.putText(ref, text);
    const handoff = hostHandoff(db, work, terminal, current, "store-window", 1, add);
    let release: (() => void) | undefined;
    let pending: Promise<unknown> | undefined;
    try {
      await handoff("payload-race", "hello", "submitted");
      const record = await current.storage.submissionByRequest(current.root.id, "payload-race", context);
      await (await current.harness.submission(record!.id, context))!.wait(context);
      const ref = `answer:${record!.id}`; // Public submission lookup, not a guessed/private candidate ID.
      release = payloads.hold(ref);
      pending = handoff("payload-race", "hello").catch(error => error);
      await payloads.waitUntilHeld(ref);
      expect(checks).toBe(entryGuard ? 1 : 0);
      expect(db.query("SELECT * FROM service_effect_s02_commits").all()).toEqual([]);
      hostHandoff(db, work, terminal, current, "store-window", 2, add);
      release();
      // Post-return fence detects loss, but MUST NOT be mistaken for undoing SQL.
      expect(String(await pending)).toContain("owner lost");
      expect(db.query("SELECT content FROM messages WHERE is_bot_message=1").all()).toEqual([{ content: "synthetic answer" }]);
      expect(db.query("SELECT count(*) AS n FROM service_effect_s02_commits").get()).toEqual({ n: 1 });
      expect(value(await terminal.getTerminal("host:payload-race"))?.disposition).toBe("completed");
      expect(value(await work.getChatFrontier("web:qualification")).consumedThroughSourceSeq).toBe(1);
      expect(value(await work.getOperation("host:payload-race"))?.cancellation).toBeNull();
      expect(current.owner.acquired).toBe(true); // Generation takeover does not revoke old dispatch authority.
    } finally { release?.(); await pending; await current.close(); }
  }), 20000);
}
