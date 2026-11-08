import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { registerRootExtensionKvStore } from "../../runtime/src/db/register-extension-kv.js";
import { extensionKvGet } from "../../runtime/src/db/extension-kv.js";
import { requireExtensionKvAuthority, withExtensionKvAuthority, resetExtensionKvStoreForTests } from "../../runtime/src/extension-kv-registry.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-store.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";
import { createHostGoalSettlement, withGoalSettlementAuthority } from "../../runtime/durable-engine/src/host-goal-settlement.js";
import { createHostGoalCommand } from "../../runtime/durable-engine/src/host-goal-command.js";
import { createHostGoalPlanReader } from "../../runtime/durable-engine/src/host-goal-plan.js";
import { getExtensionKvStore } from "../../runtime/src/extension-kv-registry.js";
import { hashCanonicalRequest } from "../../runtime/src/service-effects/contracts/common.js";
import { value, effect, sealed, at } from "./src/host-handoff.js";

// Component-only admission witness. The real S01 store accepts the source;
// this SQL probe records its input in the same transaction. It owns no queue,
// SDK placement, execution or status. Actual SDK Goal coverage is separate.
function admissionProbe(db: ReturnType<typeof getDb>, work: import("../../runtime/src/service-effects/current-piclaw/service-work-store.js").CurrentPiclawServiceWorkStore) {
  db.exec('CREATE TABLE goal_admission_probe (source_id TEXT PRIMARY KEY, chat_jid TEXT, content TEXT, queued_at TEXT)');
  return {
    admit(next: {sourceId:string;chatJid:string;text:string;queuedAt:string}) {
      if(!db.inTransaction)throw Error('Goal admission transaction required');
      work.acceptSourceInTransaction(sealed({effect:effect('goal-probe:'+next.sourceId),chatJid:next.chatJid,sourceId:next.sourceId,kind:'message',
        payloadRef:'goal-probe:'+next.sourceId,targetOperationId:null,parentSourceSeq:null,acceptedAt:next.queuedAt,createWakeIntent:false}),db);
      db.query('INSERT INTO goal_admission_probe VALUES (?,?,?,?)').run(next.sourceId,next.chatJid,next.text,next.queuedAt);
      return (db.query('SELECT rowid FROM goal_admission_probe WHERE source_id=?').get(next.sourceId) as {rowid:number}).rowid;
    },
    read(chat:string) {return db.query('SELECT p.source_id,p.content AS queuedContent,1 AS source_accepted FROM goal_admission_probe p JOIN service_effect_s01_sources s ON s.chat_jid=p.chat_jid AND s.source_id=p.source_id WHERE p.chat_jid=? ORDER BY p.rowid').all(chat) as {source_id:string;queuedContent:string;source_accepted:number}[];},
  };
}

test("native Goal commands commit state and accepted continuation atomically", async () => {
  const sourceRoot = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!sourceRoot) throw Error("DURABLE_GOAL_ADDON_ROOT required");
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase(); const db = getDb(); installTerminalSettlementCompositionSchema(db);
  registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const addon = await import(pathToFileURL(join(sourceRoot, "addons/goal/index.ts")).href); addon.resetGoalAddonForTests();
  const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
  const admissions = admissionProbe(db, work), chatJid = "web:native-goal-command";
  let fail = true, admitted = 0;
  const command = createHostGoalCommand(addon, { root: db, assertAdmission(chat) { expect(chat).toBe(chatJid); },
    admit(next) {
      const row = admissions.admit(next);
      admitted++;
      if (fail) throw Error("command admission rollback");
      return row;
    } });
  try {
    expect(await command(chatJid, "/goal help")).toMatchObject({ status: "success" });
    expect(admitted).toBe(0);
    await expect(command(chatJid, "/goal Native objective")).rejects.toThrow("command admission rollback");
    expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toBeNull();
    expect(admissions.read(chatJid)).toHaveLength(0);
    expect(db.query("SELECT * FROM service_effect_s01_sources").all()).toHaveLength(0);
    fail = false;
    expect(await command(chatJid, "/goal Native objective")).toMatchObject({ status: "success", message: "Goal active — continuation queued" });
    expect(admissions.read(chatJid)).toHaveLength(1);
    expect(admissions.read(chatJid)[0]!.queuedContent).toContain("<piclaw_goal_input>");
    expect(await command(chatJid, "/goal pause")).toMatchObject({ status: "success", message: "Goal paused" });
    expect(await command(chatJid, "/goal resume")).toMatchObject({ status: "success", message: "Goal resumed — continuation queued" });
    expect(admissions.read(chatJid)).toHaveLength(2);
    expect(await command(chatJid, "/unknown")).toMatchObject({ status: "error" });
  } finally { addon.resetGoalAddonForTests(); resetExtensionKvStoreForTests(); await closeDatabase(); }
});

for (const mode of ["continue", "human", "human-pending", "human-error", "human-paused", "ordinary", "ordinary-empty", "ordinary-budget", "pending", "error", "stalled", "finalize", "budget", "budget-pending"] as const) test(`actual Goal terminal continuation is atomic and policy scoped: ${mode}`, async () => {
  const ordinary = mode === "ordinary" || mode === "ordinary-empty" || mode === "ordinary-budget";
  const budget = mode === "budget" || mode === "budget-pending" || mode === "ordinary-budget";
  const human = mode.startsWith("human");
  const tokens = mode === "ordinary-empty" || human ? 0 : 7;
  const sourceRoot = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!sourceRoot) throw Error("DURABLE_GOAL_ADDON_ROOT required");
  process.env.PICLAW_DB_IN_MEMORY = "1";
  initDatabase(); const db = getDb(); installTerminalSettlementCompositionSchema(db);
  registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const addon = await import(pathToFileURL(join(sourceRoot, "addons/goal/index.ts")).href); addon.resetGoalAddonForTests();
  const chatJid = "web:goal-settlement";
  const setup = { extensionId: "goal", chatJid, assertCurrent() {}, write<T>(run: () => T) { return db.transaction(run).immediate(); } };
  const text = withExtensionKvAuthority(setup, () => { addon.createThreadGoal(chatJid, "Terminal usage", budget ? 5 : undefined);
    if (mode === "stalled") {
      const plan = { available: true, total: 1, allCompleted: false, fingerprint: "native-plan", plan: [{ step: "Continue work", status: "pending" }] };
      addon.applyGoalPlanProgress(addon.loadThreadGoal(chatJid), plan, false);
      addon.applyGoalPlanProgress(addon.loadThreadGoal(chatJid), plan, false);
    }
    return addon.prepareGoalInput("🎯 Continue goal: Terminal usage", chatJid).decision.text; });
  const work = value(createCurrentPiclawServiceWorkStore(db, { hitFault: () => false, recordTrace() {} }));
  const source = value(await work.acceptSource(sealed({ effect: effect("accept"), chatJid, sourceId: "input", kind: "message", payloadRef: "input", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const claimed = value(await work.claimNext(sealed({ effect: effect("claim"), chatJid, expectedFrontier: 0, newOperationId: "op", claimedAt: at })))!;
  const bound = value(await work.bindHarness(sealed({ effect: effect("bind", "op", source.sourceSeq), expectedVersion: claimed.operation.version, sessionId: "session", harnessOperationId: "1" })));
  const finish = sealed({ effect: effect("finish", "op", source.sourceSeq), expectedVersion: bound.version, expectedHarness: bound.harness! });
  const finished = value(await work.finishHarness({ ...finish, effect: { ...finish.effect, requestHash: hashCanonicalRequest({ method: "finishHarness.v1", ...finish }) } }));
  const admissions = admissionProbe(db, work);
  if (mode === "pending" || mode === "human-pending" || mode === "budget-pending") value(await work.acceptSource(sealed({ effect: effect("pending-user"), chatJid, sourceId: "pending-user", kind: "message", payloadRef: "pending-user", targetOperationId: null, parentSourceSeq: null, acceptedAt: at, createWakeIntent: false })));
  const initial = extensionKvGet("goal", "thread-goal", "chat", chatJid) as { goal_id: string };
  const continuationId = budget ? `goal-budget:${initial.goal_id}:2` : "goal-continuation:op";
  const planRoot = process.env.DURABLE_ADDONS_ROOT;
  if (!planRoot) throw Error("DURABLE_ADDONS_ROOT required for actual Plan qualification");
  const planAddon = await import(pathToFileURL(join(planRoot, "addons/plan-sidebar/index.ts")).href);
  const readPlan = createHostGoalPlanReader(db, planAddon, addon);
  const planMarkdown = mode === "finalize" ? "- [x] Continue work" : "- [ ] Continue work";
  const fingerprint = addon.summarizeGoalPlan(planAddon.parsePlanMarkdown(planMarkdown).plan).fingerprint;
  // Stalled setup used synthetic fingerprint above; replace with actual Plan fingerprint.
  if (mode === "stalled") withExtensionKvAuthority(setup, () => {
    const stored = addon.loadThreadGoal(chatJid);
    getExtensionKvStore().set("goal", "thread-goal", { ...stored, last_auto_continue_fingerprint: fingerprint }, "chat", chatJid);
  });
  let planReads = 0, goalAfterOrdinary = false;
  const prepare = createHostGoalSettlement(addon, { root: db, assertOwner() {}, runtime: () => ({
    async readAcceptedInputText() { return human ? "check pending PRs" : text; },
    async readSettledInputUsage() { return {
      inputs: [{ entryId: 1, text }, ...(ordinary ? [{ entryId: mode === "ordinary-empty" ? 4 : 10, text: "Ordinary human work" }] : []),
        ...(goalAfterOrdinary ? [{ entryId: 20, text }] : [])],
      receipts: [{ conversationId: 1, entryId: 5, tokens: 7 }, ...(ordinary ? [{ conversationId: 1, entryId: 11, tokens: 11 }] : [])],
    }; },
    async hasSettledGoalTerminalResult() { return false; },
  }), continuation: {
    addon,
    async prepare() { return { message: { role: "assistant", stopReason: mode === "error" || mode === "human-error" ? "error" : "stop" }, hadToolActivity: false }; },
    readPlan(chat, assertCurrent) {
      assertCurrent(); expect(db.inTransaction).toBe(true); expect(chat).toBe(chatJid); planReads++;
      return readPlan(chat, assertCurrent);
    },
    admit(next) { return admissions.admit(next); },
  } });
  const input = { incarnation: "fixture", conversationId: 1, chatJid, branchId: "main", operationId: "op", sourceSeq: source.sourceSeq,
    sourceId: source.sourceId, payloadRef: source.payloadRef, requestId: "request", requestHash: "a".repeat(64) };
  if (mode === "ordinary") {
    goalAfterOrdinary = true;
    await expect(prepare(input)).rejects.toThrow("Goal input after ordinary steer");
    expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject({ tokens_used: 0 });
    goalAfterOrdinary = false;
  }
  const apply = await prepare(input);
  if (mode === "human-paused") withExtensionKvAuthority(setup, () => addon.applyGoalCommand(chatJid, "pause"));
  withExtensionKvAuthority({ ...setup, extensionId: "plan-sidebar" }, () => {
    getExtensionKvStore().set("plan-sidebar", "plan", { markdown: planMarkdown, updated_at: at }, "chat", chatJid);
  }); // Change persisted Plan AFTER preparation, BEFORE transaction.
  expect(planReads).toBe(0);
  let fail = true, calls = 0, deniedExternalBudget = 0, retained: (() => void) | undefined;
  const terminal = value(createCurrentPiclawTerminalSettlementStore(db, new InMemoryEffectPayloadResolver(), {
    hitFault: () => false, recordTrace() {}, validateOwnership: () => true,
    applyTerminalEffects(commit, scope) {
      calls++;
      expect(() => withGoalSettlementAuthority(db, { ...commit, operationId: "other-op" }, scope, () => undefined)).toThrow("Exact terminal effect commit required");
      expect(() => withGoalSettlementAuthority(db, { ...commit }, scope, () => undefined)).toThrow("Exact terminal effect commit required");
      withGoalSettlementAuthority(db, commit, scope, authority => {
        retained = authority.assertCurrent;
      });
      apply!(commit, scope);
      if (fail) throw Error("rollback after Goal mutation");
      return undefined;
    },
  }));
  try {
    const request = sealed({ effect: effect("terminal", "op", source.sourceSeq), expectedChatJid: chatJid, expectedVersion: finished.version, expectedHarness: finished.harness!, disposition: "completed" as const,
      errorCode: null, terminalAuthorityRef: null,
      timeline: { mode: "none" as const, chatJid, placeholderRowId: null, contentRef: null, threadId: null, mediaIds: [], contentBlocksRef: null }, sourceDispositions: [{ sourceSeq: source.sourceSeq, state: "consumed" as const, reason: "completed" }], outboxIntents: [], committedAt: at });
    if (mode === "ordinary-empty") {
      const before = extensionKvGet("goal", "thread-goal", "chat", chatJid) as Record<string, unknown>;
      withExtensionKvAuthority(setup, () => getExtensionKvStore().set("goal", "thread-goal",
        { ...before, status: "budget_limited", lifecycle_generation: 2, budget_limit_reported: false }, "chat", chatJid));
      fail = false;
      expect((await terminal.commitTerminal(request)).ok).toBe(false);
      expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject({ tokens_used: 0, status: "budget_limited", budget_limit_reported: false });
      expect(extensionKvGet("goal", "committed-usage:1", "chat", chatJid)).toBeNull();
      expect(admissions.read(chatJid)).toHaveLength(0);
      withExtensionKvAuthority(setup, () => getExtensionKvStore().set("goal", "thread-goal", before, "chat", chatJid));
      deniedExternalBudget = 1;
      fail = true;
    }
    expect((await terminal.commitTerminal(request)).ok).toBe(false);
    expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject({ tokens_used: 0 });
    expect(extensionKvGet("goal", "committed-usage:1", "chat", chatJid)).toBeNull();
    expect(admissions.read(chatJid)).toHaveLength(0);
    expect(db.query("SELECT * FROM service_effect_s01_sources WHERE source_id=?").all(continuationId)).toHaveLength(0);
    fail = false;
    value(await terminal.commitTerminal(request));
    expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject({ tokens_used: tokens });
    if (!tokens) expect(extensionKvGet("goal", "committed-usage:1", "chat", chatJid)).toBeNull();
    value(await terminal.commitTerminal(request));
    expect(calls).toBe(2 + deniedExternalBudget);
    expect(planReads).toBe(budget || mode === "pending" || mode === "error" || (human && mode !== "human") ? 0 : 2); // Replay never re-reads.
    const queued = admissions.read(chatJid);
    if (budget) {
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ source_id: continuationId, source_accepted: 1 });
      expect(queued[0]!.queuedContent).toStartWith("🎯 Goal budget reached:");
      expect(withExtensionKvAuthority({ extensionId: "goal", chatJid, assertCurrent() {},
        write() { throw Error("Read-only assertion"); } },
        () => addon.isGoalBudgetInput(addon.resolveGoalInput(queued[0]!.queuedContent, chatJid).text))).toBe(true);
      expect(addon.goalInputIdentity(queued[0]!.queuedContent)).toMatchObject({ generation: 2 });
      expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject({ status: "budget_limited", budget_limit_reported: true, tokens_used: 7, lifecycle_generation: 2 });
      if (mode === "budget-pending") expect(value(await work.getChatFrontier(chatJid)).nextPendingSourceSeq)
        .toBe(work.getAcceptedSource(chatJid, "pending-user")!.sourceSeq);
      expect(() => retained!()).toThrow("scope ended");
      expect(() => db.transaction(() => retained!()).immediate()).toThrow("scope ended");
      return;
    }
    const continues = mode === "continue" || mode === "human" || ordinary || mode === "finalize";
    expect(queued).toHaveLength(continues ? 1 : 0);
    if (continues) {
    expect(queued[0]).toMatchObject({ source_id: continuationId, source_accepted: 1 });
    expect(queued[0]!.queuedContent).toContain("Terminal usage");
    expect(queued[0]!.queuedContent).toContain("<piclaw_goal_input>");
    expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject(mode === "finalize"
      ? { status: "active", completion_probe_count: 1, completion_plan_fingerprint: fingerprint }
      : { no_progress_turns: 1, last_auto_continue_fingerprint: fingerprint });
    expect(db.query("SELECT source_id,state FROM service_effect_s01_sources WHERE source_id=?").all(continuationId)).toEqual([{ source_id: continuationId, state: "pending" }]);
    } else {
      expect(db.query("SELECT * FROM service_effect_s01_sources WHERE source_id=?").all(continuationId)).toHaveLength(0);
      expect(extensionKvGet("goal", "thread-goal", "chat", chatJid)).toMatchObject(mode === "stalled"
        ? { status: "stopped", stop_reason: "no_progress", lifecycle_generation: 2 }
        : { status: mode === "human-paused" ? "paused" : "active", no_progress_turns: 0 });
    }
    expect(() => retained!()).toThrow("scope ended");
    expect(() => db.transaction(() => retained!()).immediate()).toThrow("scope ended");
  } finally { addon.resetGoalAddonForTests(); resetExtensionKvStoreForTests(); await closeDatabase(); }
});
