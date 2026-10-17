import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { createDurableConversationAdapter, type DurableAcceptedInput, type DurableConversationOperation, type DurableConversationRuntimePort } from "../../src/agent-pool/durable-runtime-adapter.js";
import { hashCanonicalRequest } from "../../src/service-effects/contracts/common.js";

const at = "2026-10-15T12:00:00.000Z";
function operation(): DurableConversationOperation {
  return { branchId: "main", requestId: "request-1", content: "hello", claimed: {
    source: { chatJid: "web:adapter", sourceSeq: 1, sourceId: "source-1", kind: "message", state: "claimed",
      payloadRef: "input:1", targetOperationId: null, parentSourceSeq: null, acceptedAt: at,
      dispositionReason: null, provenanceRef: "test:adapter" },
    operation: { operationId: "operation-1", chatJid: "web:adapter", version: 1, phase: "claimed",
      primarySourceSeq: 1, claimedSourceSeqs: [1], cancellation: null, harness: null, terminal: null },
  } };
}
function fixture() {
  const calls: { method: string; input?: DurableAcceptedInput; args: unknown[] }[] = [];
  const runtime: DurableConversationRuntimePort = {
    async submit(input) { expect(this).toBe(runtime); calls.push({ method: "submit", input, args: [] }); return 7; },
    async reconcile(input) {
      calls.push({ method: "reconcile", input, args: [] });
      return { operation: operation().claimed.operation, submissionId: 7, status: { type: "input", status: "done" },
        answer: { text: "private answer", message: { thinking: "private reasoning" } } };
    },
    async cancel(input, ...args) { calls.push({ method: "cancel", input, args }); return "already_placed"; },
    async resume(input, ...args) { calls.push({ method: "resume", input, args }); },
    async settle(input) { calls.push({ method: "settle", input, args: [] }); return null; },
    async close() { calls.push({ method: "close", args: [] }); },
  };
  const manifest = [{ chatJid: "web:adapter", branchId: "main", conversationId: 3 }];
  const adapter = createDurableConversationAdapter({ incarnation: "copy-A", manifest, runtime });
  return { adapter, runtime, calls, manifest };
}

test("inactive adapter maps accepted host records, snapshots its manifest and preserves exact control arguments", async () => {
  const f = fixture(), work = operation();
  expect(f.calls).toEqual([]); // Construction does not open, admit or schedule anything.
  f.manifest[0]!.conversationId = 999;
  f.runtime.submit = async () => { throw new Error("replaced caller method"); };
  expect(await f.adapter.submit(work)).toBe(7);
  const input = f.calls[0]!.input!;
  expect(input).toEqual({ incarnation: "copy-A", conversationId: 3, chatJid: "web:adapter", branchId: "main",
    operationId: "operation-1", sourceSeq: 1, sourceId: "source-1", payloadRef: "input:1", requestId: "request-1",
    requestHash: hashCanonicalRequest({ type: "input", requestId: "request-1", content: "hello" }) });
  expect(Object.isFrozen(input)).toBe(true);
  const cancellation = { effect: { idempotencyKey: "cancel-1", requestHash: "a".repeat(64), operationId: "operation-1",
    sourceSeq: 2, provenanceRef: "test:adapter", redactionClass: "private" as const },
    expectedVersion: 1, sourceId: "cancel-source", sourceSeq: 2, cause: "user", requestedAt: at };
  expect(await f.adapter.cancel(work, 7, cancellation)).toBe("already_placed");
  await f.adapter.resume(work, 7);
  expect(await f.adapter.settle(work)).toBeNull();
  await f.adapter.close();
  expect(f.calls.map(c => c.method)).toEqual(["submit", "cancel", "resume", "settle", "close"]);
  expect(f.calls[1]!.args).toEqual([7, cancellation]);
  expect(f.calls[1]!.args[1]).toBe(cancellation);
  expect(f.calls[2]!.args).toEqual([7]);
});

test("reconcile is one passive read and does not return private engine evidence", async () => {
  const f = fixture();
  const state = await f.adapter.reconcile(operation());
  expect(Object.keys(state).sort()).toEqual(["operation", "status", "submissionId"]);
  expect(state.status).toEqual({ type: "input", status: "done" });
  expect(JSON.stringify(state)).not.toContain("private");
  expect(f.calls.map(c => c.method)).toEqual(["reconcile"]);
});

for (const kind of ["message", "scheduled_agent"] as const) {
  test(`adapter accepts primary ${kind} records without creating another admission queue`, async () => {
    const f = fixture(), work = operation();
    await f.adapter.submit({ ...work, claimed: { ...work.claimed, source: { ...work.claimed.source, kind } } });
    expect(f.calls).toHaveLength(1);
  });
}

for (const mismatch of ["branch", "chat", "kind", "state", "primary", "claimed", "request"] as const) {
  test(`adapter rejects ${mismatch} mismatch before calling the engine`, async () => {
    const f = fixture(), work = operation();
    const broken = { ...work, claimed: { source: { ...work.claimed.source }, operation: { ...work.claimed.operation } } };
    if (mismatch === "branch") broken.branchId = "unknown";
    if (mismatch === "chat") broken.claimed.operation = { ...broken.claimed.operation, chatJid: "web:other" };
    if (mismatch === "kind") broken.claimed.source = { ...broken.claimed.source, kind: "steer" };
    if (mismatch === "state") broken.claimed.source = { ...broken.claimed.source, state: "pending" };
    if (mismatch === "primary") broken.claimed.operation = { ...broken.claimed.operation, primarySourceSeq: 2 };
    if (mismatch === "claimed") broken.claimed.operation = { ...broken.claimed.operation, claimedSourceSeqs: [] };
    if (mismatch === "request") broken.requestId = "";
    for (const invoke of [() => f.adapter.submit(broken), () => f.adapter.reconcile(broken),
      () => f.adapter.resume(broken, 7), () => f.adapter.settle(broken)]) await expect(invoke()).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });
}

test("adapter requires an unambiguous existing manifest", () => {
  const f = fixture();
  expect(() => createDurableConversationAdapter({ incarnation: "copy-A", manifest: [], runtime: f.runtime })).toThrow();
  expect(() => createDurableConversationAdapter({ incarnation: "copy-A", manifest: [...f.manifest, ...f.manifest], runtime: f.runtime })).toThrow("Ambiguous");
});

// The private package is deliberately not a root dependency. Root-only installs still exercise
// the host contract above; when that package is installed this also qualifies the real boundary.
const hasEngine = existsSync(new URL("../../durable-engine/node_modules/@earendil-works/pi-durable/package.json", import.meta.url));
test.skipIf(!hasEngine)("adapter integrates real public runtime, SQL host bindings and EF-S02 without exposing its SDK graph", async () => {
  const { Database } = await import("bun:sqlite");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { HostConversationRuntime, BunSqliteDatabase, createHostDurableBindings, initializeHostDurableBindings } = await import("../../durable-engine/src/index.js");
  const { SqliteStorage } = await import("../../durable-engine/qualification/sqlite.ts");
  const { Harness } = await import("../../durable-engine/qualification/durable.ts");
  const { context, openFixture } = await import("../../../qualification/pi-durable-130/src/fixture.js");
  const { value, effect, sealed } = await import("../../durable-engine/src/host-effects.js");
  const { initDatabase, getDb, closeDatabase } = await import("../../src/db/connection.js");
  const { installTerminalSettlementCompositionSchema } = await import("../../src/service-effects/current-piclaw/terminal-settlement-schema.js");
  const { createCurrentPiclawServiceWorkStore } = await import("../../src/service-effects/current-piclaw/service-work-store.js");
  const { createCurrentPiclawTerminalSettlementStore } = await import("../../src/service-effects/current-piclaw/terminal-settlement-store.js");
  const { InMemoryEffectPayloadResolver } = await import("../../src/service-effects/testing/in-memory-payload-resolver.js");
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "durable-adapter-"));
  let db: InstanceType<typeof Database> | undefined;
  let adapter: ReturnType<typeof createDurableConversationAdapter> | undefined;
  try {
    initDatabase();
    try { getDb().query("VACUUM INTO ?").run(join(dir, "host.sqlite")); } finally { closeDatabase(); }
    db = new Database(join(dir, "host.sqlite"), { strict: true });
    db.exec("PRAGMA foreign_keys=ON");
    installTerminalSettlementCompositionSchema(db);
    const path = join(dir, "engine.sqlite");
    const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path)));
    const conversationId = base.root.id;
    await base.close();
    let owned = true, releases = 0;
    const assert = () => { if (!owned) throw new Error("Owner lost"); };
    const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
    const payloads = new InMemoryEffectPayloadResolver();
    const terminal = value(createCurrentPiclawTerminalSettlementStore(db, payloads, {
      hitFault: () => false, recordTrace() {}, validateOwnership() { assert(); return db!.inTransaction; },
    }));
    const source = value(await work.acceptSource(sealed({ effect: effect("accept:adapter"), chatJid: "web:adapter", sourceId: "source-1",
      kind: "message" as const, payloadRef: "input:1", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    const claimed = value(await work.claimNext(sealed({ effect: effect("claim:adapter"), chatJid: source.chatJid,
      expectedFrontier: 0, newOperationId: "operation-1", claimedAt: at })))!;
    const accepted = { ...operation(), claimed };
    const manifest = [{ chatJid: source.chatJid, branchId: "main", conversationId }];
    initializeHostDurableBindings(db, assert); // Explicit offline fixture setup, never adapter setup.
    const bindings = createHostDurableBindings(db, { domain: "adapter", incarnation: "copy-A", assertOwner: assert, manifest,
      async resolveContent(ref) { if (ref !== source.payloadRef) throw new Error("Unknown payload"); return accepted.content; } });
    const options = {
      incarnation: "copy-A", owner: { assert, release() { owned = false; releases++; } },
      openStorage: () => SqliteStorage.open(new BunSqliteDatabase(path)),
      harnessOptions: { models: base.models, registry: base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } },
      work, terminal, bindings, existingConversationIds: [conversationId],
      conversationFor(chat: string, branch: string) { if (chat !== source.chatJid || branch !== "main") throw new Error("Unknown binding"); return conversationId; },
      authorizeScheduling() { assert(); }, putAnswer(ref: string, text: string) { payloads.putText(ref, text); },
      sessionId: "host-session", lane: "main", generation: 1, now: () => at,
    };
    const open = async () => createDurableConversationAdapter({ incarnation: "copy-A", manifest,
      runtime: await HostConversationRuntime.open(options, context) }); // Real class structurally satisfies the root port.
    adapter = await open();
    expect((await adapter.reconcile(accepted)).submissionId).toBeNull();
    expect(base.host.modelCalls).toBe(0);
    const id = await adapter.submit(accepted);
    expect(await adapter.submit(accepted)).toBe(id);
    await expect(adapter.submit({ ...accepted, content: "forged payload" })).rejects.toThrow("Host binding conflict");
    await adapter.close(); adapter = undefined;
    expect(releases).toBe(1);
    // Only the qualification driver waits. The root adapter never polls/enables progress.
    owned = true;
    const harness = await Harness.open(await options.openStorage(), options.harnessOptions, context);
    try { await harness.waitForIdle(context); } finally { await harness.close(context); }
    adapter = await open();
    const state = await adapter.reconcile(accepted);
    expect(state.status?.status).toBe("done");
    expect(Object.keys(state).sort()).toEqual(["operation", "status", "submissionId"]);
    const committed = await adapter.settle(accepted);
    expect(committed?.disposition).toBe("completed");
    expect(await adapter.settle(accepted)).toEqual(committed);
    expect(db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
    expect(db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toHaveLength(1);
    owned = false;
    await expect(adapter.reconcile(accepted)).rejects.toThrow("Owner lost");
    owned = true;
  } finally {
    await adapter?.close();
    db?.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 15000);
