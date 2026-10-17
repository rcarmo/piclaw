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

test("allocation-only helper (fake runAgent): source-bound lease, rollback, public fork, forged route denied", async () => {
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
  const chat = "web:allocation", manifest = [{ chatJid: chat, branchId: "main", conversationId: main.id }];
  const bundle = await createApplicationBootstrapBundle({ root: db, path, ownership: applicationOwnership(lock), manifest,
    sessions: new Map([[chat, "session"]]), offlineInitialize: true,
    runtime: { incarnation: "allocation", sessionId: "allocation", lane: "main", generation: 1, now: () => new Date().toISOString(),
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
    runAgent: async () => {
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
  try {
    const due = new Date(Date.now() - 1000).toISOString();
    createTask({ id: "allocation-task", chat_jid: chat, prompt: "scheduled", schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
    await pollScheduledRunsOnce(deps, store);
    await Promise.race([finished.promise, Bun.sleep(5000).then(() => { throw Error("allocation timeout"); })]);
    if (failure) throw failure;
  } finally { stopSchedulerLoop(); await queue.shutdown(); await bundle.close(); lock.release(); closeDatabase(); }
});
