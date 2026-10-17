import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SessionManager, buildSessionContext, convertToLlm, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { Harness, type ConversationId } from "../../runtime/durable-engine/qualification/durable.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { HostConversationRuntime as InactiveHostRuntime, type AcceptedInput, type RuntimeOptions } from "../../runtime/durable-engine/src/index.js";
import { HostCutoverController, initializeCutoverManifest, type Manifest } from "../../runtime/durable-engine/src/index.js";
import { importCopiedLegacyTree, DEFAULT_TREE_IMPORT_LIMITS, type GetLegacyContext } from "../../runtime/durable-engine/src/index.js";
import { TestOwner, OwnedSqlite } from "./src/ownership.js";
import { barrier, context, openFixture } from "./src/fixture.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { hashCanonicalRequest } from "../../runtime/src/service-effects/contracts/common.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { createHostDurableBindings, initializeHostDurableBindings } from "../../runtime/durable-engine/src/index.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const bridge: GetLegacyContext = (entries, leaf) => ({ messages: json(convertToLlm(buildSessionContext([...entries], leaf).messages)),
  projected: entries.map(e => ({ sourceEntryId: e.id, messages: json(convertToLlm(sessionEntryToContextMessages(e))) })) });

async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  try { await run(f); } finally {
    f.base.host.modelHold?.release(); await f.closeRuntime(); await f.base.close();
    f.owner.releaseAfterClose(); f.owner.closeConnection(); f.db.close(); await rm(f.dir, { recursive: true, force: true });
  }
}
async function setup() {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "cutover-runtime-"));
  process.env.PICLAW_DB_IN_MEMORY = "1"; initDatabase();
  const hostPath = join(dir, "host.sqlite"); getDb().query("VACUUM INTO ?").run(hostPath); closeDatabase();
  const db = new Database(hostPath, { strict: true }); db.exec("PRAGMA foreign_keys=ON");
  installTerminalSettlementCompositionSchema(db); initializeCutoverManifest(db);
  db.exec(`CREATE TABLE runtime_payloads (ref TEXT PRIMARY KEY, content TEXT NOT NULL)`);
  const owner = TestOwner.acquire(join(dir, "candidate.sqlite"));
  initializeHostDurableBindings(db, () => owner.assert());
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new OwnedSqlite(owner)));
  const manager = SessionManager.inMemory(dir, { id: "copied-runtime-session" });
  manager.appendMessage({ role: "system", content: "baseline", timestamp: 0 });
  manager.appendMessage({ role: "user", content: "copied history", timestamp: 1 });
  const leaf = manager.getLeafId()!, bindings = { [leaf]: { chatJid: "web:cutover", chatIncarnation: "chat-A", branchId: "main", hostBaseline: "baseline" } };
  const sourceJSONL = [manager.getHeader(), ...manager.getEntries()].map(x => JSON.stringify(x)).join("\n") + "\n";
  const original = join(dir, "original.jsonl"), copied = join(dir, "copied.jsonl"); await writeFile(original, sourceJSONL);
  const sourceDigest = sha(sourceJSONL), importHash = sha(JSON.stringify({ importerVersion: 1, sourceJSONL,
    plannedBranches: [{ sourceLeafId: leaf, ...bindings[leaf] }], ...DEFAULT_TREE_IMPORT_LIMITS }));
  const identity = { domain: "runtime-domain", incarnation: "host-A", ownerGeneration: owner.token.generation, sourceEngineId: "legacy", candidateStoreRef: "candidate:one" };
  function currentWriter() {
    owner.assert(); const row = db.query("SELECT manifest FROM qualification_cutover_v1 WHERE domain=?").get(identity.domain) as { manifest: string } | null;
    return row ? (JSON.parse(row.manifest) as Manifest).writer : "legacy";
  }
  function assertWriter(writer: string) { if (currentWriter() !== writer) throw Error("Writer denied"); }
  const controller = new HostCutoverController(db, identity, {
    assertOwner(i) { owner.assert(); if (JSON.stringify(i) !== JSON.stringify(identity)) throw Error("Owner denied"); },
    assertCurrentWriter: assertWriter,
    checkDrained() {
      const pending = (db.query("SELECT COUNT(*) AS n FROM service_effect_s01_sources WHERE state='pending'").get() as { n: number }).n;
      const inflight = (db.query("SELECT COUNT(*) AS n FROM service_effect_s01_operations WHERE phase<>'terminal'").get() as { n: number }).n;
      return { sourceDigest: sha(readFileSync(original, "utf8")), pending, inflight };
    },
  });
  const store = (writer: string) => value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {}, validateAcceptance() {
    expect(db.inTransaction).toBe(true); assertWriter(writer); return true;
  } }));
  const legacy = store("legacy"), work = store("candidate:one"), payloads = new InMemoryEffectPayloadResolver();
  const terminalFor = (writer: string) => value(createCurrentPiclawTerminalSettlementStore(db, payloads, { hitFault: () => false, recordTrace() {}, validateOwnership() {
    expect(db.inTransaction).toBe(true); assertWriter(writer); return true;
  } }));
  const terminal = terminalFor("candidate:one"), legacyTerminal = terminalFor("legacy");
  // The synthetic provider's actual effect gate reads the SAME host manifest at invocation.
  Object.defineProperty(base.host, "modelAllowed", { get: () => currentWriter() === "candidate:one" });
  const receipt = { sourceDigest, receiptHash: importHash }, request = { requestKey: "cutover:runtime", sourceDigest, importHash };
  let conversationId!: ConversationId;
  const preparation = {
    async copy() { expect(sha(await readFile(original, "utf8"))).toBe(sourceDigest); await copyFile(original, copied); return receipt; },
    async importCopied() {
      const imported = await importCopiedLegacyTree(base.root, { sourceJSONL: await readFile(copied, "utf8"), hostBranchBindings: bindings }, bridge, () => owner.assert(), context);
      expect(imported.sourceHash).toBe(importHash); conversationId = imported.branches[0]!.engineConversationId as ConversationId; return receipt;
    },
  };
  async function verify() {
    const conversation = (await base.harness.conversation(conversationId, context))!;
    expect((await conversation.context(context)).messages).toEqual(json(convertToLlm(buildSessionContext(manager.getEntries(), leaf).messages)));
    expect(base.host.modelCalls + base.host.effects + base.host.credentialLookups).toBe(0); return receipt;
  }
  async function ready() { const m = controller.preflight(request); const copied = await controller.begin(m.revision, preparation); return controller.verify(copied.revision, verify); }
  const sourceRequest = (id: string) => sealed({ effect: effect(`accept:${id}`), chatJid: "web:cutover", sourceId: id,
    kind: "message" as const, payloadRef: `input:${id}`, targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: true });
  async function accept(id: string, content = "hello"): Promise<AcceptedInput> {
    assertWriter("candidate:one");
    // Deliberately NO recordPostCutoverWork: rollback must discover actual SQL work.
    const source = value(await work.acceptSource(sourceRequest(id)));
    const claim = value(await work.claimNext(sealed({ effect: effect(`claim:${id}`), chatJid: source.chatJid,
      expectedFrontier: source.sourceSeq - 1, newOperationId: `operation:${id}`, claimedAt: at })))!;
    db.query("INSERT INTO runtime_payloads VALUES (?,?)").run(source.payloadRef, content);
    return { incarnation: "host-A", conversationId, chatJid: source.chatJid, branchId: "main", operationId: claim.operation.operationId,
      sourceSeq: source.sourceSeq, sourceId: source.sourceId, payloadRef: source.payloadRef, requestId: id,
      requestHash: hashCanonicalRequest({ type: "input", requestId: id, content }) };
  }
  let runtime: InactiveHostRuntime | undefined;
  let options: RuntimeOptions;
  async function open() {
    options = { incarnation: "host-A", owner: { assert: () => owner.assert(), release() {} },
      openStorage: () => SqliteStorage.open(new OwnedSqlite(owner)),
      harnessOptions: { models: base.models, registry: base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } },
      work, terminal, existingConversationIds: [conversationId], conversationFor(chat, branch) {
        if (chat !== "web:cutover" || branch !== "main") throw Error("Unknown branch"); return conversationId;
      }, bindings: createHostDurableBindings(db, { domain: identity.domain, incarnation: "host-A",
        assertOwner() { owner.assert(); assertWriter("candidate:one"); },
        manifest: [{ chatJid: "web:cutover", branchId: "main", conversationId }],
        async resolveContent(ref) {
          const row = db.query("SELECT content FROM runtime_payloads WHERE ref=?").get(ref) as { content: string } | null;
          if (!row) throw Error("Missing host payload"); return row.content;
        } }),
      authorizeScheduling() { assertWriter("candidate:one"); }, putAnswer: (ref, text) => { payloads.putText(ref, text); },
      sessionId: "copied-runtime-session", lane: "main", generation: owner.token.generation, now: () => at };
    runtime = await InactiveHostRuntime.open(options, context); return runtime;
  }
  let committedMessages: unknown[] = [];
  async function drain() {
    await runtime!.close();
    const storage = await options.openStorage(), harness = await Harness.open(storage, options.harnessOptions, context);
    try {
      await harness.waitForIdle(context);
      const conversation = (await harness.conversation(conversationId, context))!;
      committedMessages = [...(await conversation.context(context)).messages];
    } finally { await harness.close(context); }
    runtime = await InactiveHostRuntime.open(options, context); return runtime;
  }
  return { dir, db, owner, base, controller, request, preparation, verify, ready, legacy, legacyTerminal, work, sourceRequest, accept, open, drain,
    committedMessages: () => committedMessages, conversationId: () => conversationId, closeRuntime: async () => { await runtime?.close(); } };
}

test("cutover/runtime: real accepted UUID, committed tool/answer and terminal block rollback without manual work records", () => fixture(async f => {
  const verified = await f.ready();
  const early = await f.work.acceptSource(f.sourceRequest("early")); expect(early.ok).toBe(false);
  f.controller.commitWriter(verified.revision); await f.base.close();
  const runtime = await f.open();
  const beforeAcceptance = f.controller.inspect()!;
  expect(f.controller.prepareRollback(beforeAcceptance.revision).disposition).toBe("safe_to_restore");
  expect(f.controller.inspect()).toEqual(beforeAcceptance);
  const input = await f.accept(randomUUID(), "use-tool");
  const pendingPlan = f.controller.prepareRollback(beforeAcceptance.revision);
  expect(pendingPlan.disposition).toBe("reconciliation_required");
  expect(pendingPlan.unresolvedAcceptedUUIDs).toEqual([input.sourceId]);
  expect(beforeAcceptance.postCutoverCount).toBe(0);
  expect(() => f.controller.rollback(beforeAcceptance.revision)).toThrow("Reconciliation required");
  expect(f.controller.inspect()).toEqual(beforeAcceptance);
  const submission = await runtime.submit(input); expect(await runtime.submit(input)).toBe(submission);
  const reopened = await f.drain();
  expect((await reopened.reconcile(input)).answer?.text).toBe("synthetic answer");
  expect((await reopened.settle(input))?.disposition).toBe("completed");
  expect((await reopened.settle(input))?.disposition).toBe("completed");
  expect(f.db.query("SELECT content FROM messages WHERE is_bot_message=1").all()).toEqual([{ content: "synthetic answer" }]);
  expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
  // The provider requests host_effect only for actual input containing use-tool.
  // Prove the effect AND its committed public result, not a guessed model count.
  expect(f.base.host.effects).toBe(1); expect(f.base.host.credentialLookups).toBe(0);
  expect(f.committedMessages()).toContainEqual(expect.objectContaining({
    role: "toolResult", toolName: "host_effect", isError: false,
    content: [{ type: "text", text: "synthetic effect committed" }],
  }));
  const journal = f.controller.inspect()!;
  const data = ["service_effect_s01_sources", "service_effect_s02_commits", "piclaw_durable_bindings_v1", "messages"]
    .map(table => f.db.query(`SELECT * FROM ${table}`).all());
  const plan = f.controller.prepareRollback(journal.revision);
  expect(plan.disposition).toBe("reconciliation_required");
  expect(plan.unresolvedAcceptedUUIDs).toEqual([input.sourceId]);
  expect(plan.reasons).toContain("accepted_work_changed");
  expect(journal.postCutoverCount).toBe(0);
  // Candidate reconcile/terminal completion is not proof of a matching OLD snapshot.
  expect(() => f.controller.rollback(journal.revision)).toThrow("Reconciliation required");
  expect(f.controller.inspect()).toEqual(journal);
  expect(["service_effect_s01_sources", "service_effect_s02_commits", "piclaw_durable_bindings_v1", "messages"]
    .map(table => f.db.query(`SELECT * FROM ${table}`).all())).toEqual(data);
  expect(f.controller.inspect()!.writer).toBe("candidate:one");
}), 20000);

test("cutover/runtime: real pending source blocks preparation; awaited old admission cannot cross flip; rollback denies candidate scheduling", () => fixture(async f => {
  const verified = await f.ready();
  const held = barrier(), entered = barrier();
  const stale = (async () => {
    expect(f.controller.inspect()!.writer).toBe("legacy");
    entered.release(); await held.promise; return f.legacy.acceptSource(f.sourceRequest("stale-old"));
  })();
  await entered.promise; f.controller.commitWriter(verified.revision);
  const before = f.db.query("SELECT * FROM service_effect_s01_chats").all(); held.release();
  const rejected = await stale; expect(rejected.ok).toBe(false);
  if (!rejected.ok) { expect(rejected.error._tag).toBe("owner_conflict"); expect(rejected.error.certainty).toBe("not_applied"); }
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toEqual([]);
  expect(f.db.query("SELECT * FROM service_effect_s01_wake_intents").all()).toEqual([]);
  expect(f.db.query("SELECT * FROM service_effect_s01_chats").all()).toEqual(before);
  await f.base.close(); const runtime = await f.open();
  f.controller.rollback(f.controller.inspect()!.revision);
  expect((await f.work.acceptSource(f.sourceRequest("late-candidate"))).ok).toBe(false);
  await expect(f.accept("denied-before-intent")).rejects.toThrow("Writer denied");
  const old = f.sourceRequest("accepted-old"); expect((await f.legacy.acceptSource(old)).ok).toBe(true);
  expect(() => f.controller.preflight(f.request)).toThrow("Cutover rejected");
  expect((await f.legacy.acceptSource(old)).ok).toBe(true);
  const claimed = value(await f.legacy.claimNext(sealed({ effect: effect("claim:old"), chatJid: "web:cutover", expectedFrontier: 0,
    newOperationId: "operation:old", claimedAt: at })))!;
  expect(() => f.controller.preflight(f.request)).toThrow("Cutover rejected");
  f.db.query("INSERT INTO runtime_payloads VALUES (?,?)").run("input:accepted-old", "legacy input");
  const input: AcceptedInput = { incarnation: "host-A", conversationId: f.conversationId(), chatJid: "web:cutover", branchId: "main",
    operationId: claimed.operation.operationId, sourceSeq: 1, sourceId: "accepted-old", payloadRef: "input:accepted-old", requestId: "accepted-old",
    requestHash: hashCanonicalRequest({ type: "input", requestId: "accepted-old", content: "legacy input" }) };
  await expect(runtime.submit(input)).rejects.toThrow("Writer denied");
  expect(f.db.query("SELECT state FROM service_effect_s01_sources").all()).toEqual([{ state: "claimed" }]);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(1);
  expect(f.base.host.modelCalls + f.base.host.effects + f.base.host.credentialLookups).toBe(0);
}), 20000);

test("cutover/runtime: admission during preparation blocks flip while pending AND inflight, without dropping source", () => fixture(async f => {
  const verified = await f.ready();
  const accepted = value(await f.legacy.acceptSource(f.sourceRequest("during-prepare")));
  expect(() => f.controller.commitWriter(verified.revision)).toThrow("Cutover rejected");
  const operation = value(await f.legacy.claimNext(sealed({ effect: effect("claim:during-prepare"), chatJid: accepted.chatJid,
    expectedFrontier: 0, newOperationId: "operation:during-prepare", claimedAt: at })))!;
  expect(() => f.controller.commitWriter(verified.revision)).toThrow("Cutover rejected");
  expect(value(await f.legacy.getOperation(operation.operation.operationId))?.primarySourceSeq).toBe(accepted.sourceSeq);
  expect(f.db.query("SELECT source_id,state FROM service_effect_s01_sources").all()).toEqual([{ source_id: "during-prepare", state: "claimed" }]);
  expect(f.controller.inspect()!.writer).toBe("legacy");
  // Explicit, durable legacy skip (not deletion or fabricated drained counters).
  value(await f.legacyTerminal.commitTerminal(sealed({ effect: effect("terminal:legacy-skip", operation.operation.operationId, accepted.sourceSeq),
    expectedChatJid: accepted.chatJid, expectedVersion: operation.operation.version, expectedHarness: null, disposition: "skipped" as const,
    errorCode: null, terminalAuthorityRef: "fixture:explicit-legacy-skip", timeline: { mode: "none" as const, placeholderRowId: null,
      chatJid: accepted.chatJid, contentRef: null, threadId: null, mediaIds: [] as const, contentBlocksRef: null },
    sourceDispositions: [{ sourceSeq: accepted.sourceSeq, state: "disposed" as const, reason: "explicit fixture skip before cutover" }],
    outboxIntents: [], committedAt: at })));
  f.controller.commitWriter(verified.revision);
  const sources = f.db.query("SELECT * FROM service_effect_s01_sources").all(), wakes = f.db.query("SELECT * FROM service_effect_s01_wake_intents").all();
  expect((await f.legacy.acceptSource(f.sourceRequest("during-prepare"))).ok).toBe(true);
  expect(f.db.query("SELECT * FROM service_effect_s01_sources").all()).toEqual(sources);
  expect(f.db.query("SELECT * FROM service_effect_s01_wake_intents").all()).toEqual(wakes);
}), 20000);

test("cutover/runtime: accepted cancellation survives runtime reopen and suppresses late answer publication", () => fixture(async f => {
  const verified = await f.ready(); f.controller.commitWriter(verified.revision); await f.base.close();
  f.base.host.modelHold = barrier();
  const runtime = await f.open(), input = await f.accept("cancelled"), submission = await runtime.submit(input);
  const operation = value(await f.work.getOperation(input.operationId))!;
  f.controller.recordPostCutoverWork(f.controller.inspect()!.revision, { operationId: "cancel:cancelled", contentHash: sha("cancel:cancelled") });
  const source = value(await f.work.acceptSource(sealed({ effect: effect("source:cancel"), chatJid: input.chatJid,
    sourceId: "cancel-source", kind: "cancellation" as const, payloadRef: "cancel:payload", targetOperationId: input.operationId,
    parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  await runtime.cancel(input, submission, sealed({ effect: effect("cancel:decision", input.operationId, source.sourceSeq),
    expectedVersion: operation.version, sourceId: source.sourceId, sourceSeq: source.sourceSeq, cause: "user", requestedAt: at }));
  f.base.host.modelHold.release(); const reopened = await f.drain();
  expect((await reopened.settle(input))?.disposition).toBe("cancelled");
  expect((await reopened.settle(input))?.disposition).toBe("cancelled");
  expect(f.db.query("SELECT * FROM messages WHERE is_bot_message=1").all()).toEqual([]);
  expect(f.db.query("SELECT * FROM service_effect_s02_commits").all()).toHaveLength(1);
  expect(() => f.controller.rollback(f.controller.inspect()!.revision)).toThrow("Reconciliation required");
  expect(f.base.host.credentialLookups).toBe(0);
}), 20000);
