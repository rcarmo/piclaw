import { beforeEach, describe, expect, test, spyOn } from "bun:test";
import "./helpers.js";
import { getWorkspaceDir } from "../src/core/config-context.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isolateBudgetTestDatabase } from "./budget/fixture.js";
isolateBudgetTestDatabase();

import { drainScheduledBudgetNotifications } from "../src/budget/scheduled-notifications.js";
import { ensureBudgetWork, getDb, getTaskRunLogs, initDatabase, persistBudgetDecision } from "../src/db.js";
import { createTask, updateTask } from "../src/db/tasks.js";
import { createCurrentPiclawScheduledRunStore } from "../src/service-effects/current-piclaw/scheduled-run-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../src/service-effects/contracts/common.js";
import { pollScheduledRunsOnce } from "../src/task-scheduler.js";
import { runAdmittedScheduledTask } from "./helpers/admitted-scheduled-task.js";
import type { SchedulerDeps } from "../src/task-scheduler.js";
import type { ScheduledRunStore } from "../src/service-effects/contracts/scheduled-run-store.js";

const TASK_ID = "scheduled-budget-notice";
const CHAT_JID = "web:scheduled-owner";
const BLOCKED_ERROR = "PICLAW-BUDGET-BLOCKED: Budget limit stopped background work.";

function seedTask(notifyOnComplete = true, id = TASK_ID) {
  createTask({
    id,
    chat_jid: CHAT_JID,
    prompt: "private scheduled prompt",
    model: null,
    task_kind: "agent",
    command: null,
    cwd: null,
    timeout_sec: null,
    notify_on_complete: notifyOnComplete,
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: new Date(Date.now() - 1_000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });
}

function persistPendingStop(workId: string): string {
  ensureBudgetWork({
    id: workId,
    chatJid: CHAT_JID,
    executionKind: "scheduled",
    scheduledTaskId: TASK_ID,
  });
  return persistBudgetDecision({
    decision: {
      action: "stop",
      workId,
      checkedAt: new Date().toISOString(),
      blockers: [],
      warnings: [],
      applicableCapIds: [],
      warningsOnly: false,
    },
    boundary: "model_call",
    notificationKey: `budget-stop:${workId}:model_call`,
  });
}

function pendingStatus(decisionId: string): string | null {
  const row = getDb().prepare("SELECT notification_status FROM budget_decisions WHERE id=?").get(decisionId) as { notification_status: string | null };
  return row.notification_status;
}

function agentDeps(options: {
  sendMessage: SchedulerDeps["sendMessage"];
  sendNudge?: SchedulerDeps["sendNudge"];
  dispatchScheduledAgent?: NonNullable<SchedulerDeps["agentPool"]["dispatchScheduledAgent"]>;
}): SchedulerDeps {
  return {
    queue: {} as SchedulerDeps["queue"],
    agentPool: {
      isDurableRuntime:()=>true,
      dispatchScheduledAgent: options.dispatchScheduledAgent ?? (async () => ({status:'error',result:null,error:BLOCKED_ERROR,failureCategory:'provider_budget'})),
    } as SchedulerDeps["agentPool"],
    sendMessage: options.sendMessage,
    sendNudge: options.sendNudge,
  };
}

beforeEach(() => {
  initDatabase();
  seedTask();
});

describe("scheduled budget stop notifications", () => {
  test("defers an exact live occurrence notice until canonical history commits", async () => {
    updateTask(TASK_ID, { task_kind: "shell", command: "printf synthetic" });
    const db = getDb(); db.exec("PRAGMA foreign_keys=ON");
    const built = createCurrentPiclawScheduledRunStore(db, { hitFault() { return false; }, recordTrace() {} });
    if (!built.ok) throw Error(built.error._tag);
    const store = built.value;
    const claimed = await store.claimDue({ now: new Date().toISOString(), limit: 1, workerId: "worker:notice", leaseTokenPrefix: "lease:notice", leaseDurationMs: 60000, reclaimAuthorities: [] });
    if (!claimed.ok || !claimed.value[0]) throw Error("Missing fixture claim");
    const lease = claimed.value[0];
    const decision = persistPendingStop(`scheduled:${lease.record.runId}`);
    const sent: string[] = [];
    const deps = { sendMessage: async (_jid: string, text: string) => { sent.push(text); expect(getTaskRunLogs(TASK_ID)).toHaveLength(1); } };
    await drainScheduledBudgetNotifications(deps);
    expect(sent).toEqual([]);
    expect(pendingStatus(decision)).toBe("pending");
    const now = new Date().toISOString();
    const request = { effect: { idempotencyKey: "complete:notice", requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "notice:fixture", redactionClass: "private" as const },
      runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision,
      leaseToken: lease.leaseToken, now, status: "error" as const, durationMs: 1, resultRef: null, errorCode: "scheduled_task_failed", completedAt: now,
      resultPayload: { version: 1 as const, result: null, error: BLOCKED_ERROR }, outboxIntents: [] };
    request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
    expect((await store.complete(request)).ok).toBe(true);
    await drainScheduledBudgetNotifications(deps);
    expect(sent).toHaveLength(1);
    expect(pendingStatus(decision)).toBe("delivered");
  });

  test("logs the blocked run before delivery and routes the durable notice to the task chat", async () => {
    let decisionId = "";
    let runAgentCalls = 0;
    const sent: Array<{ jid: string; text: string; loggedBeforeSend: boolean }> = [];
    const nudges: string[] = [];
    const task = getDb().prepare("SELECT * FROM scheduled_tasks WHERE id=?").get(TASK_ID) as any;

    const outcome = await runAdmittedScheduledTask(task, agentDeps({
      dispatchScheduledAgent: async (lease) => {
        runAgentCalls += 1;
        expect(lease.record.taskId).toBe(TASK_ID);
        decisionId = persistPendingStop(`scheduled:${lease.record.runId}`);
        return { status: "error", result: null, error: BLOCKED_ERROR, failureCategory: "provider_budget" } as any;
      },
      sendMessage: async (jid, text) => {
        sent.push({ jid, text, loggedBeforeSend: getTaskRunLogs(TASK_ID).length === 1 });
      },
      sendNudge: async (text) => { nudges.push(text); },
    }));

    expect(outcome.status).toBe("error");
    expect(runAgentCalls).toBe(1);
    expect(getTaskRunLogs(TASK_ID)).toEqual([
      expect.objectContaining({ status: "error", error: expect.stringContaining("PICLAW-BUDGET-BLOCKED") }),
    ]);
    expect(sent).toEqual([
      expect.objectContaining({ jid: CHAT_JID, loggedBeforeSend: true }),
    ]);
    expect(sent[0]!.text).toContain(TASK_ID);
    expect(sent[0]!.text).not.toContain("private scheduled prompt");
    expect(sent[0]!.text).not.toContain(BLOCKED_ERROR);
    expect(nudges).toEqual([]);
    expect(pendingStatus(decisionId)).toBe("delivered");
  });

  test("keeps failed delivery pending and the next drain retries without new agent work", async () => {
    let decisionId = "";
    let runAgentCalls = 0;
    let sendAttempts = 0;
    const sent: Array<{ jid: string; text: string }> = [];
    const task = getDb().prepare("SELECT * FROM scheduled_tasks WHERE id=?").get(TASK_ID) as any;
    const deps = agentDeps({
      dispatchScheduledAgent: async (lease) => {
        runAgentCalls += 1;
        decisionId = persistPendingStop(`scheduled:${lease.record.runId}`);
        return { status: "error", result: null, error: BLOCKED_ERROR, failureCategory: "provider_budget" } as any;
      },
      sendMessage: async (jid, text) => {
        sendAttempts += 1;
        if (sendAttempts === 1) throw new Error("transport unavailable");
        sent.push({ jid, text });
      },
    });

    const outcome = await runAdmittedScheduledTask(task, deps);
    expect(outcome.status).toBe("error");
    expect(getTaskRunLogs(TASK_ID)).toHaveLength(1);
    expect(runAgentCalls).toBe(1);
    expect(sendAttempts).toBe(1);
    expect(pendingStatus(decisionId)).toBe("pending");

    // Keep the independent mocked claim phase reachable after the completed notice task advanced.
    seedTask(false, "notice-poll-candidate");
    let claimCalls = 0;
    await pollScheduledRunsOnce(deps, {
      claimDue: async () => {
        claimCalls += 1;
        return { ok: true, value: [] };
      },
    } as unknown as ScheduledRunStore);

    expect(claimCalls).toBe(1);
    expect(sendAttempts).toBe(2);
    expect(sent).toEqual([expect.objectContaining({ jid: CHAT_JID })]);
    expect(runAgentCalls).toBe(1);
    expect(getTaskRunLogs(TASK_ID)).toHaveLength(1);
    expect(pendingStatus(decisionId)).toBe("delivered");

    await drainScheduledBudgetNotifications(deps);
    expect(sendAttempts).toBe(2);
  });

  test("suppressed tasks post the timeline notice without a push nudge", async () => {
    getDb().prepare("UPDATE scheduled_tasks SET notify_on_complete=0 WHERE id=?").run(TASK_ID);
    const workId = "scheduled:muted:1";
    const decisionId = persistPendingStop(workId);
    const sent: string[] = [];
    const nudges: string[] = [];

    await drainScheduledBudgetNotifications(agentDeps({
      sendMessage: async (_jid, text) => { sent.push(text); },
      sendNudge: async (text) => { nudges.push(text); },
    }));

    expect(sent).toHaveLength(1);
    expect(nudges).toEqual([]);
    expect(pendingStatus(decisionId)).toBe("delivered");
  });

  test("durable work binding delivers after task deletion without inventing a nudge", async () => {
    const decisionId = persistPendingStop("scheduled:deleted-task:1");
    getDb().exec("PRAGMA foreign_keys=OFF");
    try {
      getDb().prepare("DELETE FROM scheduled_tasks WHERE id=?").run(TASK_ID);
    } finally {
      getDb().exec("PRAGMA foreign_keys=ON");
    }
    const sent: Array<{ jid: string; text: string }> = [];
    const nudges: string[] = [];

    await drainScheduledBudgetNotifications(agentDeps({
      sendMessage: async (jid, text) => { sent.push({ jid, text }); },
      sendNudge: async (text) => { nudges.push(text); },
    }));

    expect(sent).toEqual([expect.objectContaining({ jid: CHAT_JID })]);
    expect(nudges).toEqual([]);
    expect(pendingStatus(decisionId)).toBe("delivered");
  });

  test("overlapping drains share one local delivery attempt", async () => {
    const decisionId = persistPendingStop("scheduled:overlap:1");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let sends = 0;
    const deps = agentDeps({
      sendMessage: async () => {
        sends += 1;
        await gate;
      },
    });

    const first = drainScheduledBudgetNotifications(deps);
    const second = drainScheduledBudgetNotifications(deps);
    expect(first).toBe(second);
    await Bun.sleep(0);
    expect(sends).toBe(1);
    release();
    await Promise.all([first, second]);

    expect(pendingStatus(decisionId)).toBe("delivered");
    expect(sends).toBe(1);
  });
  test("a stuck send cannot hold the scheduler indefinitely or launch overlapping retries", async () => {
    const decision = persistPendingStop("stuck-send");
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let sends = 0;
    const deps = { sendMessage: async () => { sends++; await held; } };
    const start = Date.now();
    try {
      await drainScheduledBudgetNotifications(deps);
      expect(Date.now() - start).toBeLessThan(8000);
      expect(pendingStatus(decision)).toBe("pending");
      await drainScheduledBudgetNotifications(deps);
      expect(sends).toBe(1);
    } finally { release(); await Bun.sleep(10); }
    expect(pendingStatus(decision)).toBe("delivered");
  }, 10000);

  test("a row-read failure cannot reject a logged budget stop or scheduler poll", async () => {
    const database = getDb();
    const realQuery = database.query.bind(database);
    let decision = "", sends = 0;
    const query = spyOn(database, "query").mockImplementation(((sql: string) => {
      if (sql.startsWith("SELECT 1 FROM budget_decisions")) throw Error("injected pending-row failure");
      return realQuery(sql);
    }) as any);
    try {
      const outcome = await runAdmittedScheduledTask(database.prepare("SELECT * FROM scheduled_tasks WHERE id=?").get(TASK_ID) as any, agentDeps({ dispatchScheduledAgent: async (lease) => {
        decision = persistPendingStop(`scheduled:${lease.record.runId}`);
        return { status: "error", result: null, error: BLOCKED_ERROR, failureCategory: "provider_budget" } as any;
      }, sendMessage: async () => { sends++; } }));
      expect(outcome.status).toBe("error");
      expect(getTaskRunLogs(TASK_ID)).toHaveLength(1);
      expect(pendingStatus(decision)).toBe("pending");
      seedTask(false, "notice-failure-poll-candidate");
      let claimed = 0;
      const store = { async claimDue() { claimed++; return { ok: true, value: [] }; } } as unknown as ScheduledRunStore;
      await pollScheduledRunsOnce(agentDeps({ sendMessage: async () => { sends++; } }), store);
      expect(claimed).toBe(1);
      expect(sends).toBe(0);
    } finally { query.mockRestore(); }
  });

  test("mode change during delivery prevents acknowledgement and the next send", async () => {
    const a = persistPendingStop("scope-change:a"), b = persistPendingStop("scope-change:b");
    const config = join(getWorkspaceDir(), ".piclaw/config.json");
    mkdirSync(join(getWorkspaceDir(), ".piclaw"), { recursive: true });
    let sends = 0;
    try {
      await drainScheduledBudgetNotifications({ sendMessage: async () => {
        sends++;
        writeFileSync(config, JSON.stringify({ domains: { access: { mode: "family-shared" } } }));
      } });
      expect(sends).toBe(1);
      expect(pendingStatus(a)).toBe("pending");
      expect(pendingStatus(b)).toBe("pending");
    } finally { rmSync(config, { force: true }); }
  });

  test("bounded drains advance past a full batch of failed deliveries", async () => {
    for (let i = 0; i < 21; i++) persistPendingStop("fair:" + i);
    let attempts = 0;
    const deps = { sendMessage: async () => { attempts++; throw Error("fixture unavailable"); } };
    await drainScheduledBudgetNotifications(deps);
    expect(attempts).toBe(20);
    await drainScheduledBudgetNotifications(deps);
    expect(attempts).toBe(21);
    expect(getDb().query("SELECT count(*) n FROM budget_decisions WHERE notification_status=\u0027pending\u0027").get()).toEqual({ n: 21 });
  });

});
