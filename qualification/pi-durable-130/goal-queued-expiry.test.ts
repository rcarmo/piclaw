import { isolatedApplicationTest } from "./src/isolated-application-test.js";
import "./src/test-guard.js";
import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { getDeferredQueuedFollowups, setDeferredQueuedFollowups, storeChatMetadata } from "../../runtime/src/db.js";
import { registerRootExtensionKvStore } from "../../runtime/src/db/register-extension-kv.js";
import { requireExtensionKvAuthority, withExtensionKvAuthority, resetExtensionKvStoreForTests } from "../../runtime/src/extension-kv-registry.js";
import { acquireRuntimeLock } from "../../runtime/src/runtime/single-instance.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { configure } from "../../runtime/durable-engine/qualification/durable.ts";
import { applicationOwnership, createApplicationBootstrapBundle } from "../../runtime/durable-engine/src/application-bootstrap.js";
import { createHostGoalCommand } from "../../runtime/durable-engine/src/host-goal-command.js";
import * as goalInputModule from "../../runtime/durable-engine/src/host-goal-input.js";
import { createHostGoalPrompt } from "../../runtime/durable-engine/src/host-goal-prompt.js";
import type { HostConversationRuntime } from "../../runtime/durable-engine/src/host-runtime.js";
import { installTerminalSettlementCompositionSchema } from "../../runtime/src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { QueuedFollowupLifecycleService } from "../../runtime/src/channels/web/runtime/queued-followup-lifecycle-service.js";
import { materializeDeferredFollowups, type QueuedFollowupMaterializationRuntime } from "../../runtime/src/channels/web/runtime/process-chat-control-runtime.js";
import { admitWebMessage } from "../../runtime/src/channels/web/messaging/message-store.js";
import type { QueuedFollowupItem } from "../../runtime/src/queued-followups.js";
import { openFixture, context, barrier } from "./src/fixture.js";
import { value, effect, sealed } from "./src/host-handoff.js";
import { InMemoryEffectPayloadResolver } from "../../runtime/src/service-effects/testing/in-memory-payload-resolver.js";

const applicationTest = isolatedApplicationTest(import.meta.url);
type PrepareExpiry = (chat: string, item: Readonly<QueuedFollowupItem>) => (() => void) | undefined;
type Expire = (chat: string, item: Readonly<QueuedFollowupItem>) => Promise<boolean>;
// Deliberately only the old-red compatibility seam. Baseline must reach real
// materialisation and fail stale-source retirement, not throw a missing export.
const createExpiry = (goalInputModule as typeof goalInputModule & {
  createHostGoalQueueExpiry?: (addon: Parameters<typeof goalInputModule.createHostGoalInput>[0], assertAdmission: (chat: string) => void) => PrepareExpiry;
}).createHostGoalQueueExpiry;

async function fixture(goalPreparationAvailable = true) {
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "goal-queue-expiry-"));
  const lock = acquireRuntimeLock({ lockPath: join(dir, "owner.lock"), strictOwnership: true, disabled: false });
  process.env.PICLAW_DB_IN_MEMORY = "0";
  initDatabase();
  const root = getDb(); root.exec("PRAGMA foreign_keys=ON");
  const path = (root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
  const base = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner: () => lock.assertCurrentOwner() })));
  const addonRoot = process.env.DURABLE_GOAL_ADDON_ROOT;
  if (!addonRoot) throw Error("DURABLE_GOAL_ADDON_ROOT required");
  const addon = await import(pathToFileURL(join(addonRoot, "addons/goal/index.ts")).href);
  registerRootExtensionKvStore(); requireExtensionKvAuthority(); addon.resetGoalAddonForTests();
  const chat = `web:goal-expiry:${crypto.randomUUID()}`;
  storeChatMetadata(chat, new Date().toISOString());
  const branchId = (root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=?").get(chat) as { branch_id: string }).branch_id;
  const assertAdmission = (id: string) => {
    lock.assertCurrentOwner();
    if (id !== chat) throw Error("Exact Goal queue chat required");
    if (!root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL").get(chat, branchId)) throw Error("Goal queue route revoked");
  };
  const authority = { extensionId: "goal", chatJid: chat, assertCurrent() { assertAdmission(chat); },
    write<T>(body: () => T): T { return root.transaction(() => { this.assertCurrent(); const result = body(); this.assertCurrent(); return result; }).immediate(); } };
  const scope = <T>(body: () => T) => withExtensionKvAuthority(authority, body);
  let runtime!: HostConversationRuntime;
  const goalGuardFailures: unknown[] = [];
  const prompt = createHostGoalPrompt(addon, { root, assertOwner: () => lock.assertCurrentOwner(), runtime: () => runtime,
    failClosed(error) { goalGuardFailures.push(error); } });
  base.registry.install(prompt);
  const conversation = await base.harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
    model: { provider: "qualification", modelId: "synthetic" }, extensions: [prompt], tools: [],
  } }, context);
  await base.harness.commit(tx => configure(tx, conversation.id, { extensions: [prompt], tools: [] }), context);
  await base.close(); installTerminalSettlementCompositionSchema(root);
  const prepareQueuedInputExpiry = goalPreparationAvailable ? createExpiry?.(addon, assertAdmission) : undefined;
  const answers = new InMemoryEffectPayloadResolver();
  const bundle = await createApplicationBootstrapBundle({ root, path, ownership: applicationOwnership(lock),
    manifest: [{ chatJid: chat, branchId, conversationId: conversation.id }], sessions: new Map([[chat, "original-goal-session"]]),
    offlineInitialize: true, prepareInputText: goalPreparationAvailable ? goalInputModule.createHostGoalInput(addon, assertAdmission) : undefined,
    ...{ prepareQueuedInputExpiry }, onRuntime(current) { runtime = current; },
    answers: { put(ref, text) { answers.putText(ref, text); }, resolver: answers },
    runtime: { incarnation: "goal-queue-expiry", sessionId: "goal-queue-expiry", now: () => new Date().toISOString(),
      harnessOptions: { models: base.models, registry: base.registry } },
  }, context);
  const queue = new QueuedFollowupLifecycleService();
  const ports = bundle.bind({ queue: {} as never, agentPool: {} as never }) as ReturnType<typeof bundle.bind> & { expireQueuedInput?: Expire };
  const command = createHostGoalCommand(addon, { root, assertAdmission, admit(input) {
    expect(root.inTransaction).toBe(true);
    return bundle.admitHostFollowup(input);
  } });
  const work = value(createCurrentPiclawServiceWorkStore(root, { hitFault: () => false, recordTrace() {},
    validateAcceptance() { assertAdmission(chat); return true; }, pendingQueuedSourceOrder: id => queue.getPendingQueuedSourceOrder(id) }));
  const events: { type: string; data: unknown }[] = [], resumed: number[] = [], stored: number[] = [];
  const projection = { broadcastEvent() {}, pendingLinkPreviews: new Set<number>() } as Parameters<typeof admitWebMessage>[0];
  bundle.bindInputProjection(projection);
  const channel: QueuedFollowupMaterializationRuntime & { expireQueuedInput?: Expire } = {
    peekQueuedFollowupItem: id => queue.peekQueuedFollowupItem(id),
    expireQueuedInput: ports.expireQueuedInput,
    async admitMessage(id, content, isBot, mediaIds, options, authorise, signal) {
      const row = await admitWebMessage(projection,
        { chatJid: id, content, isBot, mediaIds: mediaIds ?? [], agentId: "default", agentName: "Fixture" },
        { ...options, materializeQueuedSource: ports.getQueuedInputMaterialization!(id), acceptMaterializedSource: ports.getInputSourceAdmission!(id) }, authorise, signal);
      if (row) stored.push(row.id);
      return row;
    },
    broadcastEvent(type, data) { events.push({ type, data }); },
    resumeChat(id, row) { expect(id).toBe(chat); if (typeof row !== "number") throw Error("Materialized row required"); resumed.push(row); },
    agentPool: {} as never,
    async sendMessage() { throw Error("No deferred slash control delivery expected"); },
    updateAgentStatus() { throw Error("No deferred slash control execution expected"); },
  };
  const items = () => getDeferredQueuedFollowups(chat);
  const state = () => scope(() => addon.loadThreadGoal(chat));
  const sdkRows = () => ["submissions", "tasks", "entries"].map(table => root.query(`SELECT * FROM ${table} ORDER BY id`).all());
  const hostRows = () => ["messages", "service_effect_s01_sources", "service_effect_s01_decisions", "service_effect_s01_chats", "service_effect_s01_operations", "service_effect_s01_operation_sources"].map(table => root.query(`SELECT * FROM ${table}`).all());
  const drain = () => materializeDeferredFollowups({ channel, chatJid: chat, agentId: "default" });
  const stop = async () => {
    const tool = addon.createGoalTools(() => chat, { async run(_name: string, _args: unknown, _ctx: unknown, body: () => Promise<unknown>) {
      authority.assertCurrent(); return scope(body);
    } }).find((tool: { name: string }) => tool.name === "goal_stop")!;
    await tool.execute("external-owned-stop", { reason: "user_needed", summary: "Stop while accepted continuation is still queued" }, undefined, undefined,
      { get sessionManager() { throw Error("Legacy Goal session forbidden"); } });
  };
  return { root, lock, chat, branchId, base, addon, scope, state, bundle, ports, queue, work, command, items,
    prepareQueuedInputExpiry, sdkRows, hostRows, events, resumed, stored, goalGuardFailures, channel, drain, stop,
    async human(text = "Ordinary human input after stopped Goal", humanRowId = 0) {
      await queue.admitQueuedFollowupItem([chat, humanRowId, text, null, new Date().toISOString()], () => assertAdmission(chat),
        new AbortController().signal, ports.getQueuedInputSourceAdmission!(chat));
      return items().at(-1)!;
    },
    async close(ownerLost = false) {
      try {
        if (ownerLost) await expect(bundle.close()).rejects.toThrow("Runtime ownership lost");
        else await bundle.close();
      } finally {
        addon.resetGoalAddonForTests(); resetExtensionKvStoreForTests(); closeDatabase(); lock.release();
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

for (const transition of ["stop", "pause", "replace", "clear"] as const) {
  applicationTest(`68142: ${transition} retires an actually accepted Goal command before timeline/SDK; next human runs once`, async () => {
    const f = await fixture();
    try {
      expect((await f.command(f.chat, "/goal Incident stale queued continuation")).status).toBe("success");
      const stale = f.items()[0]!;
      const initial = f.state();
      expect(initial).toMatchObject({ status: "active", lifecycle_generation: 1 });
      expect(stale).toMatchObject({ source: "goal.continuation", source_accepted: true, source_id: `goal-command:${initial.goal_id}:1` });
      expect(f.addon.goalInputIdentity(stale.queuedContent)).toEqual({ goalId: initial.goal_id, generation: 1 });
      expect(f.work.getAcceptedSource(f.chat, stale.source_id!)?.provenanceRef).toStartWith("application:queued:");
      if (transition === "stop") await f.stop();
      else await f.command(f.chat, transition === "pause" ? "/goal pause" : transition === "clear" ? "/goal clear" : "/goal Replaced objective");
      if (transition === "replace") {
        expect(f.state()).toMatchObject({ lifecycle_generation: 1, status: "active", objective: "Replaced objective" });
        expect(f.state().goal_id).not.toBe(initial.goal_id);
      } else if (transition !== "clear") expect(f.state()).toMatchObject({ lifecycle_generation: 2, status: transition === "stop" ? "stopped" : "paused" });
      else expect(f.state()).toBeNull();
      // Replacing queues a fresh control too: preserve its identity and FIFO,
      // but isolate the ordinary execution proof from autonomous Goal turns.
      const human = await f.human();
      const remaining = f.items().filter(item => item.source_id !== stale.source_id);
      const sdkBefore = f.sdkRows();
      expect((await f.drain()).status).toBe("resumed");
      // Primary old-red assertion: baseline materialises stale instead of retiring it.
      expect(f.work.getAcceptedSource(f.chat, stale.source_id!)?.state).toBe("disposed");
      expect(f.root.query("SELECT 1 FROM messages WHERE chat_jid=? AND id=?").get(f.chat, stale.source_id!)).toBeNull();
      expect(f.sdkRows()).toEqual(sdkBefore);
      expect(f.base.host.modelCalls).toBe(0);
      expect(f.root.query("SELECT * FROM service_effect_s01_decisions WHERE method='withdrawUnclaimedSource.v1'").all()).toHaveLength(1);
      const selected = remaining[0]!;
      const row = f.root.query("SELECT rowid,id,content FROM messages WHERE chat_jid=? ORDER BY rowid").get(f.chat) as { rowid: number; id: string; content: string };
      expect(row.id).toBe(selected.source_id!);
      expect(row.content).toBe(selected.queuedContent);
      expect(f.resumed).toEqual([row.rowid]); expect(f.stored).toEqual([row.rowid]);
      expect(f.events.filter(event => event.type === "new_post")).toHaveLength(1);
      expect(f.items().map(item => item.source_id)).toEqual(remaining.slice(1).map(item => item.source_id));
      if (transition !== "replace") {
        expect(row.id).toBe(human.source_id!);
        const dispatch = f.bundle.dispatchAcceptedInput(f.chat, row.id, row.rowid);
        expect(typeof dispatch).toBe("function");
        expect(await dispatch!()).toBe("settled");
        expect(f.base.host.modelCalls).toBe(1); expect(f.base.host.effects).toBe(0); expect(f.base.host.credentialLookups).toBe(0);
        expect(f.goalGuardFailures).toEqual([]);
        expect(f.work.getAcceptedSource(f.chat, human.source_id!)?.state).toBe("consumed");
        expect(f.work.getAcceptedSource(f.chat, stale.source_id!)?.state).toBe("disposed");
        expect((await f.drain()).status).toBe("none");
        expect(f.base.host.modelCalls).toBe(1);
      } else {
        expect(f.items()[0]!.source_id).toBe(human.source_id!);
        expect(f.work.getAcceptedSource(f.chat, selected.source_id!)?.state).toBe("pending");
      }
    } finally { await f.close(); }
  });
}

applicationTest("68142: expiry classification retains current/new Goal, budget wrap-up, ordinary and untrusted Goal-looking cards", async () => {
  const f = await fixture();
  try {
    await f.command(f.chat, "/goal Current lifecycle");
    const fresh = f.items()[0]!;
    expect(f.prepareQueuedInputExpiry?.(f.chat, fresh)).toBeUndefined();
    expect(await f.ports.expireQueuedInput?.(f.chat, fresh)).toBe(false);
    await f.command(f.chat, "/goal pause");
    await f.command(f.chat, "/goal resume");
    const resumed = f.items().at(-1)!;
    expect(f.addon.goalInputIdentity(resumed.queuedContent)).toEqual({ goalId: f.state().goal_id, generation: f.state().lifecycle_generation });
    expect(await f.ports.expireQueuedInput?.(f.chat, resumed)).toBe(false);
    await f.command(f.chat, "/goal clear");
    await f.command(f.chat, "/goal Current lifecycle");
    const newGoal = f.items().at(-1)!;
    expect(f.state().goal_id).not.toBe(f.addon.goalInputIdentity(fresh.queuedContent).goalId);
    expect(await f.ports.expireQueuedInput?.(f.chat, newGoal)).toBe(false);
    f.scope(() => { f.addon.clearThreadGoal(f.chat); f.addon.createThreadGoal(f.chat, "Budget proof", 1); f.addon.accountGoalProgress(f.chat, 1); });
    expect(f.state().status).toBe("budget_limited");
    const budgetText = goalInputModule.createHostGoalInput(f.addon, () => f.lock.assertCurrentOwner())(f.chat, "🎯 Goal budget reached: Budget proof").text;
    f.root.transaction(() => f.bundle.admitHostFollowup({ sourceId: `goal-budget:${f.state().goal_id}:${f.state().lifecycle_generation}`, chatJid: f.chat, text: budgetText, queuedAt: new Date().toISOString() })).immediate();
    const budget = f.items().at(-1)!;
    const before = f.hostRows(), sdk = f.sdkRows(), queueBefore = f.items();
    expect(await f.ports.expireQueuedInput?.(f.chat, budget)).toBe(false);
    for (const text of ["Goal stopped? Please explain.", "🎯 Continue goal: a human typed this", "bad <piclaw_goal_input>{}</piclaw_goal_input>"]) {
      expect(f.prepareQueuedInputExpiry?.(f.chat, { ...fresh, queuedContent: text })).toBeUndefined();
    }
    for (const changes of [{ source: "remote_peer" }, { source: undefined }, { source_accepted: false }, { source_id: undefined }, { rowId: 1 },
      { queuedContent: "ordinary human text" }, { queuedContent: "🎯 Continue goal: no identity" },
      { queuedContent: "<piclaw_goal_input>{bad}</piclaw_goal_input>" },
      { queuedContent: fresh.queuedContent + fresh.queuedContent }]) {
      // Deliberately malformed caller data also includes source_accepted=false;
      // it must not become a discard capability merely through a cast.
      expect(f.prepareQueuedInputExpiry?.(f.chat, { ...fresh, ...changes } as unknown as Readonly<QueuedFollowupItem>)).toBeUndefined();
    }
    expect(f.items()).toEqual(queueBefore); expect(f.hostRows()).toEqual(before); expect(f.sdkRows()).toEqual(sdk);
    expect(f.base.host.modelCalls).toBe(0); expect(f.goalGuardFailures).toEqual([]);
  } finally { await f.close(); }
});

applicationTest("68142: unavailable Goal lifecycle owner preserves queued input without dispatch", async () => {
  const f = await fixture(false);
  try {
    await f.command(f.chat, "/goal Preserve unknown authority");
    const queued = f.items()[0]!;
    await f.stop();
    const host = f.hostRows(), sdk = f.sdkRows(), goal = f.state();
    expect(f.ports.expireQueuedInput).toBeUndefined();
    await expect(f.drain()).rejects.toThrow("Queued Goal input authority unavailable");
    expect(f.items()).toEqual([queued]);
    expect(f.work.getAcceptedSource(f.chat, queued.source_id!)?.state).toBe("pending");
    expect(f.hostRows()).toEqual(host); expect(f.sdkRows()).toEqual(sdk); expect(f.state()).toEqual(goal);
    expect(f.base.host.modelCalls).toBe(0); expect(f.events).toEqual([]); expect(f.resumed).toEqual([]);
  } finally { await f.close(); }
});

applicationTest("68142: ordinary Goal-looking human input still materializes and executes the real guarded SDK", async () => {
  const f = await fixture();
  try {
    f.scope(() => f.addon.createThreadGoal(f.chat, "Ordinary input control"));
    await f.stop();
    const human = await f.human("Goal stopped? Please explain without autonomous continuation.");
    expect((await f.drain()).status).toBe("resumed");
    const row = f.root.query("SELECT rowid,id,content FROM messages WHERE chat_jid=?").get(f.chat) as { rowid: number; id: string; content: string };
    expect(row.id).toBe(human.source_id!); expect(row.content).toBe(human.queuedContent);
    const dispatch = f.bundle.dispatchAcceptedInput(f.chat, row.id, row.rowid);
    expect(typeof dispatch).toBe("function"); expect(await dispatch!()).toBe("settled");
    expect(f.base.host.modelCalls).toBe(1); expect(f.base.host.effects).toBe(0); expect(f.base.host.credentialLookups).toBe(0);
    expect(f.goalGuardFailures).toEqual([]);
    expect(f.work.getAcceptedSource(f.chat, human.source_id!)?.state).toBe("consumed");
    expect(f.items()).toEqual([]); expect((await f.drain()).status).toBe("none");
    expect(f.base.host.modelCalls).toBe(1);
  } finally { await f.close(); }
});

applicationTest("68142: steering a revoked Goal cannot alter an unrelated live SDK operation", async () => {
  const f = await fixture(), entered = barrier(), release = barrier();
  let pending: Promise<"settled" | "pending"> | undefined;
  f.base.host.modelHold = release; f.base.host.onModelEnter = () => entered.release();
  try {
    const primary = await f.human("Unrelated ordinary primary held at its provider");
    expect((await f.drain()).status).toBe("resumed");
    const row = f.root.query("SELECT rowid,id FROM messages WHERE chat_jid=?").get(f.chat) as { rowid: number; id: string };
    pending = f.bundle.dispatchAcceptedInput(f.chat, row.id, row.rowid)!();
    await Promise.race([entered.promise, pending.then(result => { throw Error(`Primary ended before held provider: ${result}`); })]);
    await f.command(f.chat, "/goal Queued during unrelated work");
    const stale = f.items()[0]!;
    await f.stop();
    const before = f.hostRows(), queued = f.items(), sdk = f.sdkRows();
    const steering = f.ports.getAcceptedQueuedSteering!(f.chat);
    expect(steering).toBeDefined();
    await expect(steering!.accept(stale.rowId)).rejects.toThrow();
    expect(f.items()).toEqual(queued); expect(f.hostRows()).toEqual(before); expect(f.sdkRows()).toEqual(sdk);
    expect(f.goalGuardFailures).toEqual([]); expect(f.base.host.modelCalls).toBe(0); expect(f.base.host.effects).toBe(0);
    expect((await f.drain()).status).toBe("drained");
    expect(f.work.getAcceptedSource(f.chat, stale.source_id!)?.state).toBe("disposed");
    release.release(); expect(await pending).toBe("settled");
    expect(f.work.getAcceptedSource(f.chat, primary.source_id!)?.state).toBe("consumed");
    expect(f.base.host.modelCalls).toBe(1); expect(f.base.host.effects).toBe(0); expect(f.goalGuardFailures).toEqual([]);
    expect(f.root.query("SELECT 1 FROM messages WHERE id=?").get(stale.source_id!)).toBeNull();
    expect(f.state()).toMatchObject({ status: "stopped", lifecycle_generation: 2 });
  } finally { release.release(); if (pending) await pending; await f.close(); }
});

applicationTest("68142: expiry rechecks current revocation after writer contention without renewing old Goal authority", async () => {
  const f = await fixture();
  let blocker: Database | undefined;
  try {
    await f.command(f.chat, "/goal Original accepted lifecycle");
    const stale = f.items()[0]!;
    await f.stop(); await f.human();
    const file = (f.root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
    blocker = new Database(file, { create: false }); blocker.exec("PRAGMA busy_timeout=0;BEGIN IMMEDIATE");
    let completed = false;
    const expiring = f.ports.expireQueuedInput!(f.chat, stale);
    void expiring.then(() => { completed = true; }, () => { completed = true; });
    await Promise.resolve();
    expect(completed).toBe(false); expect(f.work.getAcceptedSource(f.chat, stale.source_id!)?.state).toBe("pending");
    blocker.exec("ROLLBACK");
    // State-only actual addon transition, synchronously before the admission
    // backoff ends. It does not enqueue or replay an SDK input.
    const resumed = f.scope(() => f.addon.applyGoalCommand(f.chat, "resume")).goal;
    expect(resumed).toMatchObject({ status: "active", lifecycle_generation: 3 });
    expect(await expiring).toBe(true);
    expect(f.work.getAcceptedSource(f.chat, stale.source_id!)?.state).toBe("disposed");
    expect(f.state()).toEqual(resumed);
    expect(f.items()).toHaveLength(1); expect(f.items()[0]!.queuedContent).toBe("Ordinary human input after stopped Goal");
    expect(f.root.query("SELECT 1 FROM messages WHERE id=?").get(stale.source_id!)).toBeNull();
    expect(f.base.host.modelCalls).toBe(0); expect(f.base.host.effects).toBe(0);
  } finally { if (blocker?.inTransaction) blocker.exec("ROLLBACK"); blocker?.close(true); await f.close(); }
});

applicationTest("68142: shutdown cancels and joins a contended expiry without withdrawing input", async () => {
  const f = await fixture();
  let blocker: Database | undefined;
  try {
    await f.command(f.chat, "/goal Preserve on shutdown");
    const stale = f.items()[0]!;
    await f.stop();
    const before = f.hostRows(), queued = f.items(), sdk = f.sdkRows();
    const file = (f.root.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
    blocker = new Database(file, { create: false }); blocker.exec("PRAGMA busy_timeout=0;BEGIN IMMEDIATE");
    const pending = f.ports.expireQueuedInput!(f.chat, stale);
    expect(() => f.bundle.assertProcessControlIdle()).toThrow("Host admission or credential/control work is active or uncertain");
    f.bundle.stop();
    await expect(pending).rejects.toThrow(/abort|closing/i);
    expect(blocker.inTransaction).toBe(true); // Rejected before writer release, not after its acquisition deadline.
    expect(f.items()).toEqual(queued); expect(f.hostRows()).toEqual(before); expect(f.sdkRows()).toEqual(sdk);
    expect(f.base.host.modelCalls).toBe(0); expect(f.events).toEqual([]);
  } finally { if (blocker?.inTransaction) blocker.exec("ROLLBACK"); blocker?.close(true); await f.close(); }
});

for (const fault of ["write", "ignored-queue-write", "claim", "owner", "route", "reorder", "identity", "payload", "provenance"] as const) {
  applicationTest(`68142: ${fault} conflict cannot discard an accepted queue source`, async () => {
    const f = await fixture();
    try {
      if (fault === "provenance") await f.human("Original non-Goal application provenance");
      await f.command(f.chat, "/goal Retain on uncertainty");
      const stale = f.items().at(-1)!;
      await f.stop(); await f.human();
      if (fault === "claim") {
        const frontier = value(await f.work.getChatFrontier(f.chat));
        const claimed = value(await f.work.claimNext(sealed({ effect: effect("expiry-claim"), chatJid: f.chat,
          expectedFrontier: frontier.consumedThroughSourceSeq, newOperationId: "owned-before-expiry", claimedAt: new Date().toISOString() })));
        expect(claimed?.source.sourceId).toBe(stale.source_id!);
      }
      if (fault === "reorder") expect(await f.queue.reorderQueuedFollowupItems(f.chat, 0, 1)).toBe(true);
      if (fault === "identity") setDeferredQueuedFollowups(f.chat, f.items().map(item => item.source_id === stale.source_id ? { ...item, source_id: "replacement-identity-same-row" } : item));
      if (fault === "payload") setDeferredQueuedFollowups(f.chat, f.items().map(item => item.source_id === stale.source_id ? { ...item, queuedContent: item.queuedContent + " tampered" } : item));
      if (fault === "provenance") {
        // Queue-only forged host label/marker: actual accepted application source
        // digest still names its original ordinary bytes; no SDK row is touched.
        const human = f.items()[0]!;
        setDeferredQueuedFollowups(f.chat, f.items().map(item => item.source_id === human.source_id ? { ...item, source_id: stale.source_id, source: "goal.continuation", queuedContent: stale.queuedContent } : item));
      }
      if (fault === "write") f.root.exec("CREATE TEMP TRIGGER fail_goal_expiry BEFORE INSERT ON service_effect_s01_decisions WHEN NEW.method='withdrawUnclaimedSource.v1' BEGIN SELECT RAISE(ABORT,'injected expiry decision fault'); END");
      if (fault === "ignored-queue-write") f.root.exec("CREATE TEMP TRIGGER ignore_goal_expiry_queue BEFORE UPDATE ON chat_cursors BEGIN SELECT RAISE(IGNORE); END");
      const queued = f.items(), host = f.hostRows(), sdk = f.sdkRows();
      const observed = fault === "provenance" ? f.items()[0]! : stale;
      if (fault === "owner") f.lock.release();
      if (fault === "route") f.root.query("UPDATE chat_branches SET archived_at=? WHERE chat_jid=?").run(new Date().toISOString(), f.chat);
      let expired: boolean | undefined, error: unknown;
      try {
        if ((fault === "write" || fault === "ignored-queue-write") && f.ports.expireQueuedInput) await f.drain();
        else expired = await f.ports.expireQueuedInput?.(f.chat, observed);
      } catch (cause) { error = cause; }
      expect(expired).not.toBe(true);
      // Absent API is not a green negative test on the old baseline.
      expect(typeof f.ports.expireQueuedInput).toBe("function");
      expect(error !== undefined || expired === false).toBe(true);
      expect(f.items()).toEqual(queued); expect(f.hostRows()).toEqual(host); expect(f.sdkRows()).toEqual(sdk);
      expect(f.base.host.modelCalls).toBe(0); expect(f.resumed).toEqual([]); expect(f.events).toEqual([]);
      if (fault === "write" || fault === "ignored-queue-write") {
        f.root.exec(fault === "write" ? "DROP TRIGGER fail_goal_expiry" : "DROP TRIGGER ignore_goal_expiry_queue");
        expect(await f.ports.expireQueuedInput!(f.chat, stale)).toBe(true);
        expect(f.work.getAcceptedSource(f.chat, stale.source_id!)?.state).toBe("disposed");
      }
    } finally { await f.close(fault === "owner"); }
  });
}

applicationTest("68142: goal_stop after fresh expiry false rolls back materialization and retires in the same drain", async () => {
  const f = await fixture();
  try {
    expect((await f.command(f.chat, "/goal Stop across expiry await")).status).toBe("success");
    const stale = f.items()[0]!, initial = f.state();
    const human = await f.human("First ordinary input after the racing stop");
    const tail = await f.human("Second ordinary input must remain queued");
    const sdk = f.sdkRows();
    const actualExpire = f.channel.expireQueuedInput!, actualStore = f.channel.admitMessage.bind(f.channel);
    expect(typeof actualExpire).toBe("function");
    const checks: { sourceId: string | undefined; expired: boolean }[] = [];
    const attempts: { content: string; rowId: number | null }[] = [];
    let stopped = false;
    f.channel.expireQueuedInput = async (chat, item) => {
      const expired = await actualExpire(chat, item);
      checks.push({ sourceId: item.source_id, expired });
      if (!stopped && item.source_id === stale.source_id) {
        expect(expired).toBe(false);
        expect(f.state()).toEqual(initial);
        stopped = true;
        await f.stop();
        expect(f.state()).toMatchObject({ goal_id: initial.goal_id, status: "stopped", lifecycle_generation: 2 });
      }
      return expired;
    };
    f.channel.admitMessage = async (...args) => {
      try {
        const row = await actualStore(...args);
        attempts.push({ content: args[1], rowId: row?.id ?? null });
        return row;
      } catch (error) {
        attempts.push({ content: args[1], rowId: null });
        if (args[1] === stale.queuedContent) {
          // The real late Root assertion rejects; never turn it into a fake null store.
          expect(String(error)).toContain("Goal input lifecycle changed");
          expect(f.root.query("SELECT * FROM messages WHERE chat_jid=?").all(f.chat)).toEqual([]);
          expect(f.items()).toEqual([stale, human, tail]);
          expect(f.work.getAcceptedSource(f.chat, stale.source_id!)?.state).toBe("pending");
          expect(f.sdkRows()).toEqual(sdk); expect(f.events).toEqual([]); expect(f.resumed).toEqual([]);
        }
        throw error;
      }
    };
    expect((await f.drain()).status).toBe("resumed");
    expect(stopped).toBe(true);
    expect(checks).toEqual([
      { sourceId: stale.source_id, expired: false },
      { sourceId: stale.source_id, expired: true },
      { sourceId: human.source_id, expired: false },
    ]);
    const rows = f.root.query("SELECT rowid,id,content FROM messages WHERE chat_jid=? ORDER BY rowid").all(f.chat) as { rowid: number; id: string; content: string }[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ id: human.source_id!, content: human.queuedContent });
    expect(attempts).toEqual([{ content: stale.queuedContent, rowId: null }, { content: human.queuedContent, rowId: row.rowid }]);
    expect(f.state()).toMatchObject({ goal_id: initial.goal_id, status: "stopped", lifecycle_generation: 2 });
    expect(f.work.getAcceptedSource(f.chat, stale.source_id!)?.state).toBe("disposed");
    expect(f.root.query("SELECT 1 FROM messages WHERE chat_jid=? AND id=?").get(f.chat, stale.source_id!)).toBeNull();
    expect(f.root.query("SELECT * FROM service_effect_s01_decisions WHERE method='withdrawUnclaimedSource.v1'").all()).toHaveLength(1);
    expect(f.items()).toEqual([tail]); expect(f.stored).toEqual([row.rowid]); expect(f.resumed).toEqual([row.rowid]);
    expect(f.events.map(event => event.type)).toEqual(["agent_followup_consumed", "agent_followup_consumed", "new_post"]);
    expect(f.events.slice(0, 2).map(event => event.data)).toEqual([
      expect.objectContaining({ row_id: stale.rowId, content: stale.queuedContent }),
      expect.objectContaining({ row_id: human.rowId, content: human.queuedContent }),
    ]);
    expect(f.events[2]!.data).toMatchObject({ id: row.rowid, chat_jid: f.chat, data: { content: human.queuedContent } });
    expect(f.sdkRows()).toEqual(sdk); expect(f.base.host.modelCalls).toBe(0);
    const dispatch = f.bundle.dispatchAcceptedInput(f.chat, row.id, row.rowid);
    expect(typeof dispatch).toBe("function"); expect(await dispatch!()).toBe("settled");
    expect(f.base.host.modelCalls).toBe(1); expect(f.base.host.effects).toBe(0); expect(f.base.host.credentialLookups).toBe(0);
    expect(f.goalGuardFailures).toEqual([]);
    expect(f.work.getAcceptedSource(f.chat, stale.source_id!)?.state).toBe("disposed");
    expect(f.work.getAcceptedSource(f.chat, human.source_id!)?.state).toBe("consumed");
    expect(f.items()).toEqual([tail]); expect(f.resumed).toEqual([row.rowid]);
  } finally { await f.close(); }
});

applicationTest("68142: reorder after fresh expiry false re-peeks the actual head without materializing the valid Goal", async () => {
  const f = await fixture();
  try {
    expect((await f.command(f.chat, "/goal Stay valid across reorder")).status).toBe("success");
    const goal = f.items()[0]!, initial = f.state();
    const human = await f.human("Human moved ahead of the current Goal");
    const tail = await f.human("FIFO tail after the valid Goal");
    const sdk = f.sdkRows();
    const actualExpire = f.channel.expireQueuedInput!, actualStore = f.channel.admitMessage.bind(f.channel);
    expect(typeof actualExpire).toBe("function");
    const checks: { sourceId: string | undefined; expired: boolean }[] = [], attempts: string[] = [];
    let reordered = false;
    f.channel.expireQueuedInput = async (chat, item) => {
      const expired = await actualExpire(chat, item);
      checks.push({ sourceId: item.source_id, expired });
      if (!reordered && item.source_id === goal.source_id) {
        expect(expired).toBe(false);
        reordered = true;
        expect(await f.queue.reorderQueuedFollowupItems(f.chat, 0, 1, {
          authorise() { f.lock.assertCurrentOwner(); }, signal: new AbortController().signal,
        })).toBe(true);
        expect(f.items()).toEqual([human, goal, tail]);
      }
      return expired;
    };
    f.channel.admitMessage = (...args) => { attempts.push(args[1]); return actualStore(...args); };
    expect((await f.drain()).status).toBe("resumed");
    expect(reordered).toBe(true);
    expect(checks).toEqual([{ sourceId: goal.source_id, expired: false }, { sourceId: human.source_id, expired: false }]);
    expect(attempts).toEqual([human.queuedContent]);
    const rows = f.root.query("SELECT rowid,id,content FROM messages WHERE chat_jid=? ORDER BY rowid").all(f.chat) as { rowid: number; id: string; content: string }[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ id: human.source_id!, content: human.queuedContent });
    expect(f.items()).toEqual([goal, tail]); expect(f.state()).toEqual(initial);
    expect(f.work.getAcceptedSource(f.chat, goal.source_id!)?.state).toBe("pending");
    expect(f.root.query("SELECT 1 FROM messages WHERE chat_jid=? AND id=?").get(f.chat, goal.source_id!)).toBeNull();
    expect(f.root.query("SELECT * FROM service_effect_s01_decisions WHERE method='withdrawUnclaimedSource.v1'").all()).toEqual([]);
    expect(f.stored).toEqual([row.rowid]); expect(f.resumed).toEqual([row.rowid]);
    expect(f.events).toEqual([
      { type: "agent_followup_consumed", data: expect.objectContaining({ chat_jid: f.chat, row_id: human.rowId, content: human.queuedContent }) },
      { type: "new_post", data: expect.objectContaining({ id: row.rowid, chat_jid: f.chat, data: expect.objectContaining({ content: human.queuedContent }) }) },
    ]);
    expect(f.sdkRows()).toEqual(sdk); expect(f.base.host.modelCalls).toBe(0);
    expect(f.base.host.effects).toBe(0); expect(f.base.host.credentialLookups).toBe(0); expect(f.goalGuardFailures).toEqual([]);
  } finally { await f.close(); }
});

applicationTest("68142: owned user DELETE and negative row-ID reuse during expiry false cannot retarget old bytes", async () => {
  const f = await fixture();
  try {
    const old = await f.human("Goal stopped? Deleted ordinary human bytes must never be broadcast.");
    expect(old.rowId).toBeLessThan(0); expect(old.source_accepted).toBe(true);
    const sdk = f.sdkRows();
    const actualExpire = f.channel.expireQueuedInput!, actualStore = f.channel.admitMessage.bind(f.channel);
    expect(typeof actualExpire).toBe("function");
    const checks: { sourceId: string | undefined; expired: boolean }[] = [], attempts: string[] = [];
    let deleted = false, replacement!: typeof old, tail!: typeof old;
    f.channel.expireQueuedInput = async (chat, item) => {
      const expired = await actualExpire(chat, item);
      checks.push({ sourceId: item.source_id, expired });
      if (!deleted && item.source_id === old.source_id) {
        expect(expired).toBe(false);
        deleted = true;
        // Explicit user DELETE is the only caller of the user-withdrawal port;
        // lifecycle expiry above still delegates to the real expiry capability.
        const withdrawal = f.ports.getQueuedInputSourceWithdrawal!(f.chat);
        expect(typeof withdrawal).toBe("function");
        const removed = await f.queue.removeQueuedFollowupForAction(f.chat, old.rowId, {
          authorise() {
            f.lock.assertCurrentOwner();
            expect(f.root.query("SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL").get(f.chat, f.branchId)).not.toBeNull();
          },
          signal: new AbortController().signal, withdrawAcceptedSource: withdrawal,
        });
        expect(removed).toEqual({ removed: old, source: "deferred" });
        expect(f.work.getAcceptedSource(f.chat, old.source_id!)?.state).toBe("disposed");
        replacement = await f.human("Goal stopped? New accepted human at the reused negative row ID.", old.rowId);
        tail = await f.human("Human FIFO tail after row-ID reuse");
        expect(replacement.rowId).toBe(old.rowId); expect(replacement.source_id).not.toBe(old.source_id);
        expect(replacement.source_accepted).toBe(true);
        expect(f.items()).toEqual([replacement, tail]);
      }
      return expired;
    };
    f.channel.admitMessage = (...args) => { attempts.push(args[1]); return actualStore(...args); };
    expect((await f.drain()).status).toBe("resumed");
    expect(deleted).toBe(true);
    expect(checks).toEqual([{ sourceId: old.source_id, expired: false }, { sourceId: replacement.source_id, expired: false }]);
    expect(attempts).toEqual([replacement.queuedContent]);
    const rows = f.root.query("SELECT rowid,id,content FROM messages WHERE chat_jid=? ORDER BY rowid").all(f.chat) as { rowid: number; id: string; content: string }[];
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ id: replacement.source_id!, content: replacement.queuedContent });
    expect(f.work.getAcceptedSource(f.chat, old.source_id!)?.state).toBe("disposed");
    expect(f.work.getAcceptedSource(f.chat, replacement.source_id!)?.state).toBe("pending");
    expect(f.root.query("SELECT 1 FROM messages WHERE chat_jid=? AND id=?").get(f.chat, old.source_id!)).toBeNull();
    expect(f.items()).toEqual([tail]); expect(f.stored).toEqual([row.rowid]); expect(f.resumed).toEqual([row.rowid]);
    expect(f.events).toEqual([
      { type: "agent_followup_consumed", data: expect.objectContaining({ chat_jid: f.chat, row_id: replacement.rowId, content: replacement.queuedContent }) },
      { type: "new_post", data: expect.objectContaining({ id: row.rowid, chat_jid: f.chat, data: expect.objectContaining({ content: replacement.queuedContent }) }) },
    ]);
    expect(JSON.stringify(f.events)).not.toContain(old.queuedContent);
    expect(f.sdkRows()).toEqual(sdk); expect(f.base.host.modelCalls).toBe(0);
    expect(f.base.host.effects).toBe(0); expect(f.base.host.credentialLookups).toBe(0); expect(f.goalGuardFailures).toEqual([]);
  } finally { await f.close(); }
});
