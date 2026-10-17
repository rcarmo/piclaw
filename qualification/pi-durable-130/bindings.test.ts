import "./src/test-guard.js";
import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHostDurableBindings, initializeHostDurableBindings, type AcceptedInput, type HostBindingOptions } from "../../runtime/durable-engine/src/index.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { hashCanonicalRequest } from "../../runtime/src/service-effects/contracts/common.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { barrier } from "./src/fixture.js";

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  try { await run(f); } finally { f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
}
async function setup() {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "bindings-"));
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase(); getDb().query("VACUUM INTO ?").run(join(dir, "host.sqlite")); closeDatabase();
  const db = new Database(join(dir, "host.sqlite"), { strict: true });
  db.exec("PRAGMA foreign_keys=ON"); installTerminalSettlementCompositionSchema(db);
  let owned = true, failAfterWrite = false, resolves = 0;
  const assertOwner = () => {
    if (!owned || (failAfterWrite && db.inTransaction && count() > 0)) throw Error("Owner lost");
  };
  const count = () => (db.query("SELECT count(*) AS n FROM piclaw_durable_bindings_v1").get() as { n: number }).n;
  initializeHostDurableBindings(db, () => { if (!owned) throw Error("Owner lost"); });
  const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
  // Represents an EXISTING host payload service, not a second adapter-owned content table.
  const payloads = new Map<string, string>();
  const options: HostBindingOptions = { domain: "host", incarnation: "store-A", assertOwner,
    manifest: [{ chatJid: "web:bindings", branchId: "main", conversationId: 1 },
      { chatJid: "web:bindings-2", branchId: "main", conversationId: 2 }],
    async resolveContent(ref) { resolves++; return payloads.get(ref)!; } };
  const bindings = createHostDurableBindings(db, options);
  let seq = 0;
  async function accept(requestId = "arbitrary / request: α", content = "accepted user prompt", chatJid = "web:bindings"): Promise<AcceptedInput> {
    const id = `source:${++seq}`;
    const source = value(await work.acceptSource(sealed({ effect: effect(`accept:${id}`), chatJid, sourceId: id,
      kind: "message" as const, payloadRef: `payload:${id}`, targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
    const claim = value(await work.claimNext(sealed({ effect: effect(`claim:${id}`), chatJid: source.chatJid,
      expectedFrontier: source.sourceSeq - 1, newOperationId: `operation:${id}`, claimedAt: at })))!;
    payloads.set(source.payloadRef, content);
    return { incarnation: "store-A", conversationId: chatJid === "web:bindings" ? 1 : 2, chatJid: source.chatJid, branchId: "main",
      operationId: claim.operation.operationId, sourceSeq: source.sourceSeq, sourceId: source.sourceId,
      payloadRef: source.payloadRef, requestId, requestHash: hashCanonicalRequest({ type: "input", requestId, content }) };
  }
  return { dir, db, work, options, bindings, payloads, accept, count, resolves: () => resolves,
    loseOwner: () => { owned = false; }, failAfterWrite: () => { failAfterWrite = true; } };
}

test("bindings: factory does not initialize schema; explicit setup is fenced", async () => {
  const db = new Database(":memory:");
  const options: HostBindingOptions = { domain: "d", incarnation: "i", manifest: [], assertOwner() {}, async resolveContent() { return ""; } };
  try {
    createHostDurableBindings(db, options);
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
    expect(() => initializeHostDurableBindings(db, () => { throw Error("Owner lost"); })).toThrow("Owner lost");
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
    db.exec("PRAGMA foreign_keys=ON");
    initializeHostDurableBindings(db, () => {}); initializeHostDurableBindings(db, () => {});
    const columns = db.query("PRAGMA table_info(piclaw_durable_bindings_v1)").all() as { name: string }[];
    expect(columns.some(c => c.name === "content")).toBe(false);
    const intentColumns = db.query("PRAGMA table_info(piclaw_durable_intent_bindings_v1)").all() as { name: string }[];
    expect(intentColumns.some(c => c.name === "content")).toBe(false);
    expect(intentColumns.filter(c => ["operation_id", "source_seq", "request_hash"].includes(c.name))).toHaveLength(3);
  } finally { db.close(); }
});

test("bindings: real accepted EF source, immutable bind, submission CAS and reopen", () => fixture(async f => {
  const input = await f.accept();
  expect(await f.bindings.get(input)).toBeNull();
  expect(await f.bindings.getOrBind(input)).toEqual({ content: "accepted user prompt" });
  expect(await f.bindings.bind(input)).toEqual({ ...input, submissionId: null });
  await f.bindings.recordSubmission(input, 42); await f.bindings.recordSubmission(input, 42);
  const reopened = createHostDurableBindings(f.db, f.options);
  expect(await reopened.get(input)).toEqual({ ...input, submissionId: 42 });
  await expect(reopened.recordSubmission(input, 43)).rejects.toThrow("Host binding conflict");
  expect((await reopened.get(input))?.submissionId).toBe(42);
  expect(f.count()).toBe(1);
}));

test("bindings: every immutable field and manifest mismatch fail without changing rows", () => fixture(async f => {
  const i = await f.accept(); await f.bindings.bind(i);
  for (const patch of [{ sourceId: "other" }, { payloadRef: "other" }, { operationId: "other" }, { sourceSeq: 99 },
    { requestHash: "0".repeat(64) }, { chatJid: "other" }, { branchId: "other" }, { conversationId: 2 }, { incarnation: "foreign" }]) {
    await expect(f.bindings.get({ ...i, ...patch })).rejects.toThrow();
    await expect(f.bindings.recordSubmission({ ...i, ...patch }, 7)).rejects.toThrow();
  }
  expect(await f.bindings.get(i)).toEqual({ ...i, submissionId: null });
  const requestId = "other request", changed = { ...i, requestId,
    requestHash: hashCanonicalRequest({ type: "input", requestId, content: "accepted user prompt" }) };
  await expect(f.bindings.bind(changed)).rejects.toThrow("Host binding conflict");
  expect(f.count()).toBe(1);
}));

test("bindings: missing binding, unaccepted source and incorrect payload are rejected", () => fixture(async f => {
  const i = await f.accept();
  await expect(f.bindings.recordSubmission(i, 1)).rejects.toThrow("Host binding conflict");
  await expect(f.bindings.bind({ ...i, operationId: "invented" })).rejects.toThrow("Unverified host source");
  f.payloads.set(i.payloadRef, "tampered");
  await expect(f.bindings.bind(i)).rejects.toThrow("Host payload hash conflict");
  expect(f.count()).toBe(0);
  // Primary evidence cannot be reused through the optional intent capability.
  await expect(f.bindings.intents!.bind(i)).rejects.toThrow("Unverified host source");
  expect(await f.bindings.intents!.list(i)).toEqual([]);
}));

test("bindings: owner loss on read, after awaited resolution, and after write rolls back", () => fixture(async f => {
  const i = await f.accept();
  f.failAfterWrite();
  await expect(f.bindings.bind(i)).rejects.toThrow("Owner lost");
  expect(f.count()).toBe(0);
  const hold = barrier(), entered = barrier();
  const port = createHostDurableBindings(f.db, { ...f.options, async resolveContent() {
    entered.release(); await hold.promise; return "accepted user prompt";
  } });
  const pending = port.bind(i); await entered.promise; f.loseOwner(); hold.release();
  await expect(pending).rejects.toThrow("Owner lost");
  await expect(port.get(i)).rejects.toThrow("Owner lost");
  expect(f.count()).toBe(0);
}));

test("bindings: captures input, scope, manifest and callbacks before resolution awaits", () => fixture(async f => {
  const i = await f.accept(), original = { ...i }, hold = barrier(), entered = barrier();
  const manifest = [{ chatJid: i.chatJid, branchId: i.branchId, conversationId: i.conversationId }];
  const options = { ...f.options, manifest, async resolveContent() { entered.release(); await hold.promise; return "accepted user prompt"; } };
  const port = createHostDurableBindings(f.db, options), pending = port.bind(i);
  await entered.promise;
  Object.assign(i, { requestId: "changed", operationId: "changed", payloadRef: "changed" });
  Object.assign(options, { incarnation: "foreign", assertOwner() { throw Error("replacement"); }, async resolveContent() { throw Error("replacement"); } });
  manifest.length = 0; hold.release();
  expect(await pending).toEqual({ ...original, submissionId: null });
}));

test("bindings: request validation precedes payload resolution", () => fixture(async f => {
  const i = await f.accept();
  for (const requestId of ["", "x".repeat(1025)]) await expect(f.bindings.bind({ ...i, requestId })).rejects.toThrow();
  expect(f.resolves()).toBe(0); expect(f.count()).toBe(0);
}));

test("bindings: submission IDs are unique within a store, not globally across incarnations", () => fixture(async f => {
  const i = await f.accept(); await f.bindings.bind(i); await f.bindings.recordSubmission(i, 8);
  // A different candidate store may legitimately reuse the same numeric conversation/submission IDs.
  const foreign = createHostDurableBindings(f.db, { ...f.options, incarnation: "store-B" });
  const b = { ...i, incarnation: "store-B" };
  expect(await foreign.get(b)).toBeNull();
  await foreign.bind(b); await foreign.recordSubmission(b, 8);
  await expect(foreign.get(i)).rejects.toThrow("Host binding conflict");
  // Another host chat supplies a second real accepted operation without advancing the first frontier.
  const second = await f.accept("second", "accepted user prompt", "web:bindings-2"); await f.bindings.bind(second);
  await expect(f.bindings.recordSubmission(second, 8)).rejects.toThrow("Host binding conflict");
  expect((await f.bindings.get(second))?.submissionId).toBeNull();
}));

test("bindings: exact queued intent proof matches root; terminal committed replay survives reopen", () => fixture(async f => {
  const primary = await f.accept();
  const sourceId = crypto.randomUUID(), content = "queued payload", requestId = `queued-steer:${sourceId}`;
  const source = value(await f.work.acceptSource(sealed({ effect: effect("queue-source"), chatJid: primary.chatJid,
    sourceId, kind: "message" as const, payloadRef: `queued-source:${sourceId}`, targetOperationId: primary.operationId,
    parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  f.db.query("UPDATE service_effect_s01_sources SET state='claimed' WHERE chat_jid=? AND source_seq=?").run(source.chatJid, source.sourceSeq);
  f.db.query("INSERT INTO service_effect_s01_operation_sources (operation_id,chat_jid,source_seq) VALUES (?,?,?)")
    .run(primary.operationId, source.chatJid, source.sourceSeq);
  const intent = { operationId: primary.operationId, intentId: requestId, kind: "queue_input", payloadRef: source.payloadRef, createdAt: at };
  const hash = hashCanonicalRequest(intent);
  f.db.query("INSERT INTO service_effect_s01_intents (operation_id,intent_id,intent_hash,kind,payload_ref,created_at) VALUES (?,?,?,?,?,?)")
    .run(intent.operationId, intent.intentId, hash, intent.kind, intent.payloadRef, intent.createdAt);
  f.payloads.set(source.payloadRef, content);
  const input = { ...primary, sourceSeq: source.sourceSeq, sourceId, payloadRef: source.payloadRef, requestId,
    requestHash: hashCanonicalRequest({ type: "input", requestId, content }) };
  expect(f.work.getQueuedInputIntent(primary.operationId, source)?.intentId).toBe(requestId);
  for (const [column, bad] of [["intent_id", "wrong"], ["intent_hash", "0".repeat(64)], ["payload_ref", "wrong"], ["kind", "prompt"]]) {
    const original = column === "intent_id" ? requestId : column === "intent_hash" ? hash : column === "payload_ref" ? source.payloadRef : "queue_input";
    f.db.query(`UPDATE service_effect_s01_intents SET ${column}=? WHERE operation_id=?`).run(bad!, primary.operationId);
    expect(f.work.getQueuedInputIntent(primary.operationId, source)).toBeNull();
    await expect(f.bindings.intents!.bind(input)).rejects.toThrow("Unverified host source");
    f.db.query(`UPDATE service_effect_s01_intents SET ${column}=? WHERE operation_id=?`).run(original, primary.operationId);
  }
  const wrongRequest = "other", wrongInput = { ...input, requestId: wrongRequest,
    requestHash: hashCanonicalRequest({ type: "input", requestId: wrongRequest, content }) };
  await expect(f.bindings.intents!.bind(wrongInput)).rejects.toThrow("Unverified host source");
  f.db.query("UPDATE service_effect_s01_sources SET target_operation_id=NULL WHERE chat_jid=? AND source_seq=?").run(input.chatJid, input.sourceSeq);
  expect(f.work.getQueuedInputIntent(primary.operationId, source)).toBeNull();
  await expect(f.bindings.intents!.bind(input)).rejects.toThrow("Unverified host source");
  f.db.query("UPDATE service_effect_s01_sources SET target_operation_id=? WHERE chat_jid=? AND source_seq=?").run(primary.operationId, input.chatJid, input.sourceSeq);
  f.db.query("DELETE FROM service_effect_s01_operation_sources WHERE operation_id=? AND source_seq=?").run(primary.operationId, input.sourceSeq);
  expect(f.work.getQueuedInputIntent(primary.operationId, source)).toBeNull();
  await expect(f.bindings.intents!.bind(input)).rejects.toThrow("Unverified host source");
  f.db.query("INSERT INTO service_effect_s01_operation_sources (operation_id,chat_jid,source_seq) VALUES (?,?,?)").run(primary.operationId, input.chatJid, input.sourceSeq);
  const mutating = createHostDurableBindings(f.db, { ...f.options, async resolveContent() {
    f.db.query("UPDATE service_effect_s01_intents SET intent_hash=? WHERE operation_id=?").run("0".repeat(64), primary.operationId);
    return content;
  } });
  await expect(mutating.intents!.bind(input)).rejects.toThrow("Unverified host source");
  expect(await f.bindings.intents!.get(input)).toBeNull();
  f.db.query("UPDATE service_effect_s01_intents SET intent_hash=? WHERE operation_id=?").run(hash, primary.operationId);
  await f.bindings.intents!.bind(input); await f.bindings.intents!.recordSubmission(input, 77);
  // Cross-table source overlap is rejected even when a conflicting row bypassed the role verifier.
  f.db.query("INSERT INTO piclaw_durable_bindings_v1 VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("host", "store-A", 1, input.chatJid, "main", "other-op", input.sourceSeq, input.sourceId, input.payloadRef, "other-request", input.requestHash, null);
  await expect(f.bindings.intents!.bind(input)).rejects.toThrow("Host binding conflict");
  f.db.query("DELETE FROM piclaw_durable_bindings_v1 WHERE operation_id='other-op'").run();
  // A terminal operation cannot gain a fresh binding, but its exact committed binding can replay.
  f.db.query("UPDATE service_effect_s01_operations SET phase='terminal' WHERE operation_id=?").run(primary.operationId);
  f.db.query("UPDATE service_effect_s01_sources SET state='consumed' WHERE chat_jid=? AND source_seq=?").run(input.chatJid, input.sourceSeq);
  expect(f.work.getQueuedInputIntent(primary.operationId, source)).toBeNull();
  const reopenedDb = new Database(join(f.dir, "host.sqlite"), { strict: true });
  try {
    const reopened = createHostDurableBindings(reopenedDb, f.options);
    expect((await reopened.intents!.bind(input)).submissionId).toBe(77);
    reopenedDb.query("DELETE FROM piclaw_durable_intent_bindings_v1").run();
    await expect(reopened.intents!.bind(input)).rejects.toThrow("Unverified host source");
  } finally { reopenedDb.close(); }
}));
