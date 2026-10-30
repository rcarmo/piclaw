import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createTask } from "../../runtime/src/db/tasks.js";
import { saveBudgetCap, setBudgetCapEnabled } from "../../runtime/src/db/budget-limits.js";
import { createCurrentPiclawScheduledRunStore } from "../../runtime/src/service-effects/current-piclaw/scheduled-run-store.js";
import { pollScheduledRunsOnce, stopSchedulerLoop, type SchedulerDeps } from "../../runtime/src/task-scheduler.js";
import { AgentQueue } from "../../runtime/src/queue.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { applicationOwnership, createApplicationBootstrapBundle } from "../../runtime/durable-engine/src/application-bootstrap.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { createHostDurableBindings } from "../../runtime/durable-engine/src/host-bindings.js";
import type { ScheduledRunLease, ScheduledRunStore } from "../../runtime/src/service-effects/contracts/scheduled-run-store.js";
import { context, openFixture, barrier } from "./src/fixture.js";
import { value } from "./src/host-handoff.js";

for (const model of [undefined, "qualification/synthetic"]) test(`allocation-only helper (synthetic native dispatch): source-bound lease, rollback, public fork, forged route denied; model=${model}`, async () => {
  process.env.PICLAW_DB_IN_MEMORY = "0";
  mkdirSync(join(process.env.PICLAW_WORKSPACE!, ".piclaw"), { recursive: true });
  initDatabase();
  const db = getDb(); db.exec("PRAGMA foreign_keys=ON");
  installTerminalSettlementCompositionSchema(db);
  const path = (db.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(r => r.name === "main")!.file;
  const lock = acquireRuntimeLock({ lockPath: join(process.env.PICLAW_WORKSPACE!, "allocation.lock"), strictOwnership: true, disabled: false });
  const assert = () => lock.assertCurrentOwner();
  const storage = new BunSqliteDatabase(path, { root: db, assertOwner: assert, fenceTransactions: true });
  const fixture = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(storage));
  const main = await fixture.harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: "qualification", modelId: "synthetic" } } }, context);
  await main.commit(tx => tx.appendEntry(main.id, { kind: "test.main", data: { unchanged: true } }), context);
  const before = JSON.stringify(db.query("SELECT * FROM entries WHERE conversation_id=?").all(main.id));
  const agentBefore = await fixture.harness.snapshot((await import("../../runtime/durable-engine/qualification/durable.ts")).AgentDoc, main.id, context);
  await fixture.close();
  const rollbackStorage = new BunSqliteDatabase(path, { root: db, assertOwner: assert, fenceTransactions: true });
  const rollbackFixture = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(rollbackStorage));
  const count = db.query("SELECT count(*) AS n FROM conversations").get();
  await expect(rollbackStorage.withHostSourceGuard(assert, async () => { throw Error("allocation rollback"); },
    () => rollbackFixture.harness.commit(async tx => {
      const head = (await tx.scanEntries({ conversationId: main.id, order: "descending" }, 1)).items[0]!;
      await tx.forkConversation(main.id, head.id, { ownership: { kind: "ownerless" } });
    }, context))).rejects.toThrow("allocation rollback");
  expect(db.query("SELECT count(*) AS n FROM conversations").get()).toEqual(count);
  await rollbackFixture.close(); // Public SDK correctly requires reopen after storage failure.
  const chat = model ? "web:allocation-override" : "web:allocation", manifest = [{ chatJid: chat, branchId: "main", conversationId: main.id }];
  const bundle = await createApplicationBootstrapBundle({ root: db, path, ownership: applicationOwnership(lock), manifest,
    sessions: new Map([[chat, "session"]]), offlineInitialize: true,
    runtime: { incarnation: "allocation", sessionId: "allocation", now: () => new Date().toISOString(),
      harnessOptions: { models: fixture.models, registry: fixture.registry, settings: { retry: { enabled: false } } } },
    answers: { resolver: { resolve: () => null }, put() {} },
  }, context);
  const actual = value(createCurrentPiclawScheduledRunStore(db, { hitFault: () => false, recordTrace() {} }));
  let lease!: ScheduledRunLease;
  const store: ScheduledRunStore = { ...actual, claimDue: async req => {
    const result = await actual.claimDue(req); if (result.ok && result.value.length) lease = result.value[0]!; return result;
  }, renew: actual.renew.bind(actual), bindAcceptedSource: actual.bindAcceptedSource.bind(actual), complete: actual.complete.bind(actual),
    abandon: actual.abandon.bind(actual), get: actual.get.bind(actual), listRuns: actual.listRuns.bind(actual), cleanupTerminal: actual.cleanupTerminal.bind(actual) };
  const queue = new AgentQueue(), finished = barrier();
  let failure: unknown;
  const deps: SchedulerDeps = { queue, sendMessage: async () => {}, agentPool: {
    saveSessionPosition: async () => "main", restoreSessionPosition: async () => {}, getCurrentModelLabel: async () => null,
    dispatchScheduledAgent: async () => {
      try {
        const input = await bundle.allocateScheduledConversation(lease);
        expect(input.conversationId).not.toBe(main.id);
        expect((await bundle.allocateScheduledConversation(lease)).conversationId).toBe(input.conversationId);
        await expect(bundle.allocateScheduledConversation({ ...lease, leaseToken: "forged" })).rejects.toThrow("Scheduled source authority unavailable");
        await expect(bundle.allocateScheduledConversation({ ...lease, task: { ...lease.task, payloadRef: "forged" } })).rejects.toThrow("Scheduled source authority unavailable");
        const bindings = createHostDurableBindings(db, { domain: "allocation", incarnation: "allocation", manifest, assertOwner: assert, resolveContent: async () => "scheduled" });
        expect(bindings.resolveConversation(input)).toBe(input.conversationId);
        for (const capInput of [
          { scope: "scheduled_run" as const, scheduledTaskId: lease.task.taskId },
          { scope: "instance_daily" as const, timezone: "UTC" },
        ]) {
          const cap = saveBudgetCap({ ...capInput, metric: "api_usd_micros", amount: 1_000_000 }, db);
          expect(() => bindings.resolveConversation(input)).toThrow("Native scheduled budget admission unavailable");
          setBudgetCapEnabled(cap.id, false, db);
          expect(bindings.resolveConversation(input)).toBe(input.conversationId);
        }
        expect(bindings.resolveConversation({ ...input, conversationId: fixture.root.id })).toBeUndefined();
        expect(JSON.stringify(db.query("SELECT * FROM entries WHERE conversation_id=?").all(main.id))).toBe(before);
        const reader = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root: db, assertOwner: assert })));
        const record = await reader.harness.commit(tx => tx.conversation(input.conversationId), context);
        expect(record?.parent?.conversationId).toBe(main.id);
        expect(await reader.harness.snapshot((await import("../../runtime/durable-engine/qualification/durable.ts")).AgentDoc, main.id, context)).toEqual(agentBefore);
        await reader.close();
      } catch (error) { failure = error; }
      finally { finished.release(); }
      return { status: "success", result: "allocation only" };
    },
  } as unknown as SchedulerDeps["agentPool"] };
  if (model) deps.agentPool.dispatchScheduledAgent = async current => {
    try {
      const count = db.query("SELECT count(*) AS n FROM conversations").get();
      await expect(bundle.allocateScheduledConversation(current)).rejects.toThrow("Scheduled model override unavailable");
      expect(db.query("SELECT count(*) AS n FROM conversations").get()).toEqual(count);
      return { status: "success", result: "fail closed" };
    } catch (error) { failure = error; throw error; }
    finally { finished.release(); }
  };
  try {
    const due = new Date(Date.now() - 1000).toISOString();
    createTask({ id: model ? "allocation-override-task" : "allocation-task", chat_jid: chat, model, prompt: "scheduled", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
    await pollScheduledRunsOnce(deps, store);
    await Promise.race([finished.promise, Bun.sleep(5000).then(() => { throw Error("allocation timeout"); })]);
    if (failure) throw failure;
  } finally { stopSchedulerLoop(); await queue.shutdown(); await bundle.close(); lock.release(); closeDatabase(); }
});

for (const failBinding of [false, true]) test(`side prompt allocation binds an exact claimed internal source and leaves parent history unchanged; rollback=${failBinding}`, async () => {
  const { createCurrentPiclawServiceWorkStore } = await import("../../runtime/src/service-effects/current-piclaw/service-work-store.js");
  const { effect, sealed } = await import("./src/host-handoff.js");
  const { hashCanonicalRequest } = await import("../../runtime/src/service-effects/contracts/common.js");
  process.env.PICLAW_DB_IN_MEMORY = "0"; initDatabase();
  const db = getDb(); db.exec("PRAGMA foreign_keys=ON"); installTerminalSettlementCompositionSchema(db);
  const path = (db.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
  const lock = acquireRuntimeLock({ lockPath: join(process.env.PICLAW_WORKSPACE!, "side-allocation.lock"), strictOwnership: true, disabled: false });
  const assert = () => lock.assertCurrentOwner();
  const fixture = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root: db, assertOwner: assert })));
  const parent = fixture.root.id;
  const { AgentDoc } = await import("../../runtime/durable-engine/qualification/durable.ts");
  await fixture.root.commit(async tx => {
    const agent = await tx.doc(AgentDoc, parent);
    agent.tools = ["host_effect"]; agent.modelTools = ["host_effect"]; agent.extensions = ["qualification"];
  }, context);
  const empty = await fixture.harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: { provider: "qualification", modelId: "synthetic" } } }, context);
  await fixture.root.commit(tx => tx.appendEntry(parent, { kind: "pi.user", model: [{ role: "user", content: "main history", timestamp: 1 }] }), context);
  const history = db.query("SELECT * FROM entries ORDER BY id").all();
  await fixture.close();
  const chat = `web:side-allocation-${failBinding}`, emptyChat = `${chat}-empty`, manifest = [
    { chatJid: chat, branchId: "main", conversationId: parent }, { chatJid: emptyChat, branchId: "main", conversationId: empty.id }];
  let activeRuntime!: import("../../runtime/durable-engine/src/host-runtime.js").HostConversationRuntime;
  const payloads = new Map<string, string>();
  let acceptMainDuringPayload = false;
  const createBundle = () => createApplicationBootstrapBundle({ root: db, path, ownership: applicationOwnership(lock), manifest,
    sessions: new Map([[chat, "original"], [emptyChat, "empty-original"]]), offlineInitialize: true, onRuntime(runtime) { activeRuntime = runtime; },
    runtime: { incarnation: "side-allocation", sessionId: "side-allocation",
      now: () => new Date().toISOString(), harnessOptions: { models: fixture.models, registry: fixture.registry,
        settings: { retry: { enabled: false }, compaction: { enabled: false } } } },
    answers: { resolver: { resolve(ref) {
      const text = payloads.get(ref); if (text === undefined) return null;
      const bytes = new TextEncoder().encode(text);
      return { ref, bytes, byteLength: bytes.byteLength, sha256: (new Bun.CryptoHasher("sha256")).update(bytes).digest("hex"), mediaType: "text/plain", redactionClass: "private" };
    } }, put(ref, text) {
      payloads.set(ref, text);
      if (acceptMainDuringPayload && ref.startsWith("side-prompt:")) {
        acceptMainDuringPayload = false;
        db.transaction(() => work.acceptSourceInTransaction(sealed({ effect: effect(`main:${ref}`), chatJid: chat, sourceId: "intervening-main",
          kind: "message", payloadRef: "main-payload", targetOperationId: null, parentSourceSeq: null,
          acceptedAt: new Date().toISOString(), createWakeIntent: false }), db)).immediate();
      }
    } } }, context);
  let bundle = await createBundle();
  const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
  try {
    const emptySnapshot = ["service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s01_decisions", "conversations"]
      .map(table => db.query(`SELECT * FROM ${table}`).all());
    const payloadCount = payloads.size;
    await expect(bundle.dispatchSidePrompt(emptyChat, "must not claim")).rejects.toThrow("Side prompt history unavailable");
    expect(["service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s01_decisions", "conversations"]
      .map(table => db.query(`SELECT * FROM ${table}`).all())).toEqual(emptySnapshot);
    expect(payloads.size).toBe(payloadCount);
    const id = `side-prompt:${crypto.randomUUID()}`, prompt = "isolated follow-up";
    payloads.set(id, prompt);
    const source = value(await work.acceptSource(sealed({ effect: effect(`side-accept:${id}`), chatJid: chat, sourceId: id, kind: "internal" as const,
      payloadRef: id, targetOperationId: null, parentSourceSeq: null, acceptedAt: new Date().toISOString(), createWakeIntent: false })));
    const claim = value(await work.claimNext(sealed({ effect: effect(`side-claim:${id}`), chatJid: chat,
      expectedFrontier: source.sourceSeq - 1, newOperationId: crypto.randomUUID(), claimedAt: new Date().toISOString() })))!;
    const input = { incarnation: "side-allocation", conversationId: parent, chatJid: chat, branchId: "main", operationId: claim.operation.operationId,
      sourceSeq: source.sourceSeq, sourceId: id, payloadRef: id, requestId: id, requestHash: hashCanonicalRequest({ type: "input", requestId: id, content: prompt }) };
    if (!failBinding) {
      const callsBeforeReopen = fixture.host.modelCalls;
      await bundle.close();
      db.query("UPDATE service_effect_s01_operations SET phase='executing' WHERE operation_id=?").run(input.operationId);
      await expect(createBundle()).rejects.toThrow("Unverified recovered authority");
      db.query("UPDATE service_effect_s01_operations SET phase='claimed' WHERE operation_id=?").run(input.operationId);
      bundle = await createBundle();
      expect((await activeRuntime.inspectAuthority()).inspection.scheduling).toBe("paused");
      expect(fixture.host.modelCalls).toBe(callsBeforeReopen);
      expect(db.query("SELECT * FROM piclaw_durable_bindings_v1 WHERE chat_jid=?").all(chat)).toEqual([]);
      expect(db.query("SELECT phase FROM service_effect_s01_operations WHERE operation_id=?").get(input.operationId)).toEqual({ phase: "claimed" });
    }
    await expect(bundle.allocateSidePromptConversation({ ...input, sourceId: "internal:other" })).rejects.toThrow("Side prompt source authority unavailable");
    if (failBinding) {
      const beforeFailure = db.query("SELECT * FROM conversations ORDER BY id").all();
      db.exec("CREATE TRIGGER fail_side_binding BEFORE INSERT ON piclaw_durable_bindings_v1 BEGIN SELECT RAISE(ABORT, 'synthetic side binding failure'); END");
      await expect(bundle.allocateSidePromptConversation(input)).rejects.toThrow("synthetic side binding failure");
      expect(db.query("SELECT * FROM conversations ORDER BY id").all()).toEqual(beforeFailure);
      expect(db.query("SELECT * FROM piclaw_durable_bindings_v1 WHERE chat_jid=?").all(chat)).toEqual([]);
      db.exec("DROP TRIGGER fail_side_binding");
      return;
    }
    const allocated = await bundle.allocateSidePromptConversation(input);
    expect(allocated.conversationId).not.toBe(parent);
    expect((await bundle.allocateSidePromptConversation(input)).conversationId).toBe(allocated.conversationId);
    expect(db.query("SELECT * FROM entries ORDER BY id").all()).toEqual(history);
    const bindings = createHostDurableBindings(db, { domain: "side-allocation", incarnation: "side-allocation", manifest, assertOwner: assert, resolveContent: async () => prompt });
    expect(bindings.resolveConversation(allocated)).toBe(allocated.conversationId);
    expect(bindings.resolveConversation({ ...allocated, requestHash: "0".repeat(64) })).toBeUndefined();
    const cap = saveBudgetCap({ scope: "instance_daily", metric: "api_usd_micros", amount: 1, timezone: "UTC" }, db);
    expect(() => bindings.resolveConversation(allocated)).toThrow("Native side prompt budget admission unavailable");
    setBudgetCapEnabled(cap.id, false, db);
    db.query("UPDATE service_effect_s01_sources SET state='pending' WHERE source_id=?").run(id);
    expect(bindings.resolveConversation(allocated)).toBeUndefined();
    db.query("UPDATE service_effect_s01_sources SET state='claimed' WHERE source_id=?").run(id);
    await bundle.close();
    bundle = await createBundle();
    const beforeRun = db.query("SELECT * FROM entries WHERE conversation_id=? ORDER BY id").all(parent);
    await expect(activeRuntime.abortSidePrompt({ ...allocated, conversationId: parent })).rejects.toThrow("Exact isolated side prompt required");
    const abortEntered = barrier();
    fixture.host.modelHold = barrier();
    let sideSignal: AbortSignal | undefined;
    fixture.host.onModelEnter = signal => { sideSignal = signal; abortEntered.release(); };
    const submission = await activeRuntime.submit(allocated);
    const waiting = activeRuntime.wait(allocated, submission);
    await abortEntered.promise;
    await activeRuntime.abortSidePrompt(allocated);
    await waiting;
    expect(sideSignal?.aborted).toBe(true);
    const state = await activeRuntime.reconcile(allocated);
    expect(state.operation.cancellation?.cause).toBe("side_prompt_cancelled");
    expect(state.answer).toBeNull();
    fixture.host.modelHold = undefined;
    fixture.host.onModelEnter = undefined;
    expect(await activeRuntime.settle(allocated)).not.toBeNull();
    expect(db.query("SELECT state FROM service_effect_s01_sources WHERE source_id=?").get(`side-cancel:${id}`)).toEqual({ state: "consumed" });
    expect(db.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid=? AND state NOT IN ('consumed','disposed')").all(chat)).toEqual([]);
    expect(db.query("SELECT * FROM entries WHERE conversation_id=? ORDER BY id").all(parent)).toEqual(beforeRun);
    expect(db.query("SELECT message_row_id FROM service_effect_s02_commits WHERE operation_id=?").get(input.operationId)).toEqual({ message_row_id: null });
    const sourcesBefore = db.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE chat_jid=?").get(chat);
    await expect(bundle.dispatchSidePrompt(chat, "unsupported observer", { onTextDelta() {} })).rejects.toThrow("Native side prompt options unavailable");
    expect(db.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE chat_jid=?").get(chat)).toEqual(sourcesBefore);
    const competing = await Promise.allSettled([bundle.dispatchSidePrompt(chat, "side A"), bundle.dispatchSidePrompt(chat, "side B")]);
    expect(competing.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(competing.filter(result => result.status === "rejected")).toHaveLength(1);
    const successful = competing.find(result => result.status === "fulfilled") as PromiseFulfilledResult<import("../../runtime/src/agent-pool/contracts.js").SidePromptResult>;
    expect(successful.value).toMatchObject({ status: "success", result: "synthetic answer", model: "qualification/synthetic" });
    expect(db.query("SELECT state FROM service_effect_s01_sources WHERE chat_jid=? AND state NOT IN ('consumed','disposed')").all(chat)).toEqual([]);
    expect(db.query("SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?").get(chat)).toEqual({ active_operation_id: null });
    expect(db.query("SELECT * FROM entries WHERE conversation_id=? ORDER BY id").all(parent)).toEqual(beforeRun);
    const effectsBeforeSide = fixture.host.effects;
    const toolSide = await bundle.dispatchSidePrompt(chat, "use-tool for isolated side result");
    expect(toolSide.status).toBe("success");
    expect(fixture.host.effects).toBe(effectsBeforeSide + 1);
    expect(db.query("SELECT * FROM entries WHERE conversation_id=? ORDER BY id").all(parent)).toEqual(beforeRun);
    const recoveringId = `side-prompt:${crypto.randomUUID()}`;
    payloads.set(recoveringId, "recover exact source");
    const frontier = value(await work.getChatFrontier(chat));
    const recovering = db.transaction(() => work.acceptAndClaimSourceInTransaction(sealed({ effect: effect(`accept:${recoveringId}`), chatJid: chat,
      sourceId: recoveringId, kind: "internal", payloadRef: recoveringId, targetOperationId: null, parentSourceSeq: null,
      acceptedAt: new Date().toISOString(), createWakeIntent: false }), sealed({ effect: effect(`claim:${recoveringId}`), chatJid: chat,
      expectedFrontier: frontier.consumedThroughSourceSeq, newOperationId: `op:${recoveringId}`, claimedAt: new Date().toISOString() }), db)).immediate();
    const { writeFileSync } = await import("node:fs");
    const { reserveHostRequest } = await import("../../runtime/durable-engine/src/host-request-accounting.js");
    const authPath = join(process.env.PICLAW_WORKSPACE!, "side-accounting-auth.json");
    writeFileSync(authPath, JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic", refresh: "synthetic", accountId: "side-fixture", expires: Date.now() + 60000 } }), { mode: 0o600 });
    const priced = { ...fixture.models.getModel("qualification", "synthetic"), provider: "openai-codex", contextWindow: 1000, maxTokens: 100,
      cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } };
    const reservation = await reserveHostRequest({ database: db, operationId: recovering.operation.operationId, chatJid: chat, authPath,
      model: priced as any, signal: new AbortController().signal, assertCurrent: assert,
      terminalOwner: { signal: new AbortController().signal, assertCurrent: assert } });
    expect(reservation).toBeDefined();
    expect(db.query("SELECT execution_kind FROM budget_work WHERE id=?").get(`durable-operation:${recovering.operation.operationId}`)).toEqual({ execution_kind: "side_prompt" });
    expect(db.query("SELECT execution_kind FROM budget_work WHERE parent_work_id=?").all(`durable-operation:${recovering.operation.operationId}`)).toEqual([{ execution_kind: "side_prompt" }]);
    await reservation!.abandon();
    const callsBeforeRecovery = fixture.host.modelCalls;
    await bundle.close(); bundle = await createBundle();
    expect(fixture.host.modelCalls).toBe(callsBeforeRecovery);
    await expect(bundle.reconcileSidePrompt(chat, "side-prompt:not-a-uuid")).rejects.toThrow("Unverified side prompt recovery");
    const recoveryEntered = barrier(), recoveryHold = barrier();
    fixture.host.modelHold = recoveryHold;
    fixture.host.onModelEnter = () => recoveryEntered.release();
    const firstRecovery = bundle.reconcileSidePrompt(chat, recoveringId);
    await recoveryEntered.promise;
    const secondRecovery = bundle.reconcileSidePrompt(chat, recoveringId);
    recoveryHold.release();
    const recovered = await Promise.all([firstRecovery, secondRecovery]);
    fixture.host.modelHold = undefined;
    fixture.host.onModelEnter = undefined;
    expect(recovered[0]).toEqual(recovered[1]);
    expect(recovered[0].result).toBe("synthetic answer");
    await expect(bundle.reconcileSidePrompt(chat, recoveringId)).rejects.toThrow("Unverified side prompt recovery");
    expect(fixture.host.modelCalls).toBe(callsBeforeRecovery + 1);
    expect(db.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE source_id=?").get(recoveringId)).toEqual({ n: 1 });
    expect(db.query("SELECT message_row_id FROM service_effect_s02_commits WHERE operation_id=?").get(recovering.operation.operationId)).toEqual({ message_row_id: null });
    expect(db.query("SELECT * FROM entries WHERE conversation_id=? ORDER BY id").all(parent)).toEqual(beforeRun);
    for (const abortFails of [false, true]) {
    const abortJoined = barrier(), releaseAbort = barrier();
    const realAbort = activeRuntime.abortSidePrompt.bind(activeRuntime), realWait = activeRuntime.wait.bind(activeRuntime);
    const failingSignal = new AbortController();
    const waitFailure = Error("synthetic side wait observation failure");
    const abortFailure = Error("synthetic abort observation failure");
    let abortFinished = false, dispatchFinished = false;
    activeRuntime.abortSidePrompt = async input => {
      abortJoined.release();
      await releaseAbort.promise;
      await realAbort(input);
      abortFinished = true;
      if (abortFails) throw abortFailure;
    };
    activeRuntime.wait = async () => { failingSignal.abort(); throw waitFailure; };
    try {
      const failed = bundle.dispatchSidePrompt(chat, "join abort despite wait failure", { signal: failingSignal.signal });
      const observed = failed.then(() => { dispatchFinished = true; return null; }, error => { dispatchFinished = true; return error; });
      await abortJoined.promise;
      await Bun.sleep(0);
      expect(dispatchFinished).toBe(false);
      expect(abortFinished).toBe(false);
      releaseAbort.release();
      const failure = await observed;
      if (abortFails) {
        expect(failure).toBeInstanceOf(AggregateError);
        expect((failure as AggregateError).errors).toEqual([waitFailure, abortFailure]);
      } else expect(failure).toBe(waitFailure);
      expect(abortFinished).toBe(true);
    } finally {
      releaseAbort.release();
      activeRuntime.abortSidePrompt = realAbort;
      activeRuntime.wait = realWait;
    }
    // Observation failure deliberately leaves the cancelled operation owned.
    // Its sources are retired only by explicit same-operation settlement.
    const interrupted = db.query("SELECT s.source_id FROM service_effect_s01_sources s JOIN service_effect_s01_chats c ON c.chat_jid=s.chat_jid JOIN service_effect_s01_operations o ON o.operation_id=c.active_operation_id AND o.primary_source_seq=s.source_seq WHERE s.chat_jid=?").get(chat) as { source_id: string };
    const interruptedBinding = await bindings.findSource(chat, work.getAcceptedSource(chat, interrupted.source_id)!.sourceSeq);
    expect(await activeRuntime.settle(interruptedBinding!)).not.toBeNull();
    }
    const firstRetryCalls = fixture.host.modelCalls;
    const firstRetries = await Promise.allSettled([
      bundle.dispatchSidePrompt(chat, "same first retry", { budgetWorkId: "simultaneous-side-retry" }),
      bundle.dispatchSidePrompt(chat, "same first retry", { budgetWorkId: "simultaneous-side-retry" }),
    ]);
    expect(firstRetries.every(result => result.status === "fulfilled")).toBe(true);
    expect((firstRetries[0] as PromiseFulfilledResult<unknown>).value).toEqual((firstRetries[1] as PromiseFulfilledResult<unknown>).value);
    expect(fixture.host.modelCalls).toBe(firstRetryCalls + 1);
    const stableResult = await bundle.dispatchSidePrompt(chat, "same first retry", { budgetWorkId: "simultaneous-side-retry" });
    expect(stableResult.status).toBe("success");
    expect(fixture.host.modelCalls).toBe(firstRetryCalls + 1);
    const { sidePromptSourceId } = await import("../../runtime/durable-engine/src/host-request-accounting.js");
    const resultRef = `side-result:${sidePromptSourceId(chat, "simultaneous-side-retry")}`;
    const savedResult = payloads.get(resultRef)!;
    payloads.set(resultRef, JSON.stringify({ status: "success", result: 42 }));
    await expect(bundle.dispatchSidePrompt(chat, "same first retry", { budgetWorkId: "simultaneous-side-retry" })).rejects.toThrow("Invalid side prompt stored result");
    payloads.set(resultRef, savedResult);
    expect(fixture.host.modelCalls).toBe(firstRetryCalls + 1);
    acceptMainDuringPayload = true;
    const sourceCount = db.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE chat_jid=?").get(chat) as { n: number };
    await expect(bundle.dispatchSidePrompt(chat, "races main input")).rejects.toThrow("owner_conflict");
    expect(db.query("SELECT state FROM service_effect_s01_sources WHERE source_id='intervening-main'").get()).toEqual({ state: "pending" });
    expect(db.query("SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?").get(chat)).toEqual({ active_operation_id: null });
    expect(db.query("SELECT count(*) AS n FROM service_effect_s01_sources WHERE chat_jid=?").get(chat)).toEqual({ n: sourceCount.n + 1 });
  } finally {
    await bundle.close();
    // These allocation-only fixtures deliberately never execute/settle the
    // claimed source; retire their synthetic work before the next shared-DB case.
    db.query("UPDATE service_effect_s01_sources SET state='disposed' WHERE chat_jid=?").run(chat);
    db.query("UPDATE service_effect_s01_operations SET phase='terminal' WHERE chat_jid=?").run(chat);
    db.query("UPDATE service_effect_s01_chats SET active_operation_id=NULL WHERE chat_jid=?").run(chat);
    lock.release(); closeDatabase();
  }
});
