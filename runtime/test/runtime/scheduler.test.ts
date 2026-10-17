/**
 * test/runtime/scheduler.test.ts – Tests for the task scheduler.
 *
 * Verifies cron-based and one-shot task scheduling, execution timing,
 * task persistence, and cleanup of completed tasks.
 */

import { afterEach, expect, test } from "bun:test";
import { getTestWorkspace, importFresh, setEnv } from "../helpers.js";

let restoreEnv: (() => void) | null = null;
let restoreForeignKeys: (() => void) | null = null;

afterEach(() => {
  try {
    restoreForeignKeys?.();
  } finally {
    restoreForeignKeys = null;
    restoreEnv?.();
    restoreEnv = null;
  }
});

test("computeNextRun handles cron and interval", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const scheduler = await import("../../src/task-scheduler.js");

  const cronNext = scheduler.computeNextRun("cron", "*/5 * * * *");
  expect(cronNext).not.toBeNull();

  const intervalNext = scheduler.computeNextRun("interval", "1000");
  expect(intervalNext).not.toBeNull();

  const onceNext = scheduler.computeNextRun("once", "2020-01-01T00:00:00.000Z");
  expect(onceNext).toBeNull();
});

test("computeNextRun handles invalid cron and timezone", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    TZ: "UTC",
  });

  const scheduler = await importFresh<typeof import("../src/task-scheduler.js")>("../src/task-scheduler.js");

  const invalidCron = scheduler.computeNextRun("cron", "not a cron");
  expect(invalidCron).toBeNull();

  const cronNext = scheduler.computeNextRun("cron", "0 0 * * *");
  expect(cronNext).not.toBeNull();
  expect(cronNext).toMatch(/T00:00:00\.000Z$/);

  const onceFuture = scheduler.computeNextRun("once", "2099-01-01T00:00:00.000Z");
  expect(onceFuture).toBeNull();
});

test("computeNextRun can anchor cron schedules to a prior next_run", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    TZ: "UTC",
  });

  const scheduler = await importFresh<typeof import("../src/task-scheduler.js")>("../src/task-scheduler.js");

  const cronNext = scheduler.computeNextRun("cron", "*/5 * * * *", {
    currentDate: "2024-01-01T00:00:00.000Z",
  });
  expect(cronNext).toBe("2024-01-01T00:05:00.000Z");
});

test("runScheduledTask logs run and updates task", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const scheduler = await import("../../src/task-scheduler.js");
  scheduler.resetSchedulerMetricsForTests();

  const taskId = `task-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "say hi",
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const sent: string[] = [];
  const nudges: string[] = [];
  const deps = {
    queue: { enqueueTask: (_id: string, fn: () => Promise<void>) => fn() } as any,
    agentPool: {
      runAgent: async () => ({ status: "success", result: "Hello" }),
      saveSessionPosition: async () => "leaf-123",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
    } as any,
    sendMessage: async (_jid: string, text: string) => {
      sent.push(text);
    },
    sendNudge: async (text: string) => {
      nudges.push(text);
    },
  };

  const task = db.getTaskById(taskId)!;
  await scheduler.runScheduledTask(task, deps as any);

  const updated = db.getTaskById(taskId)!;
  expect(updated.last_run).not.toBeNull();
  expect(updated.last_result).toContain("Hello");
  expect(sent.length).toBe(1);
  expect(nudges).toEqual(["Hello"]);

  const logs = db.getTaskRunLogs(taskId);
  expect(logs.length).toBe(1);
  expect(logs[0].status).toBe("success");

  const metrics = scheduler.getSchedulerMetrics();
  expect(metrics.taskRunsStarted).toBe(1);
  expect(metrics.taskRunsSucceeded).toBe(1);
  expect(metrics.taskRunsFailed).toBe(0);
});

test("runScheduledTask can post task output without sending Pushover nudges", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const scheduler = await import("../../src/task-scheduler.js");
  scheduler.resetSchedulerMetricsForTests();

  const taskId = `task-muted-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "say hi",
    notify_on_complete: false,
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const sent: string[] = [];
  const nudges: string[] = [];
  const deps = {
    queue: { enqueueTask: (_id: string, fn: () => Promise<void>) => fn() } as any,
    agentPool: {
      runAgent: async () => ({ status: "success", result: "Hello" }),
      saveSessionPosition: async () => "leaf-muted",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
    } as any,
    sendMessage: async (_jid: string, text: string) => {
      sent.push(text);
    },
    sendNudge: async (text: string) => {
      nudges.push(text);
    },
  };

  const task = db.getTaskById(taskId)!;
  await scheduler.runScheduledTask(task, deps as any);

  expect(sent).toEqual(["Hello"]);
  expect(nudges).toEqual([]);

  const updated = db.getTaskById(taskId)!;
  expect(updated.last_result).toContain("Hello");
});

test("runScheduledTask records recovery summaries in task logs without polluting outbound text", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const scheduler = await import("../../src/task-scheduler.js");
  scheduler.resetSchedulerMetricsForTests();

  const taskId = `task-recovery-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "say hi",
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const sent: string[] = [];
  const deps = {
    queue: { enqueueTask: (_id: string, fn: () => Promise<void>) => fn() } as any,
    agentPool: {
      runAgent: async () => ({
        status: "success",
        result: "Hello",
        recovery: {
          attemptsUsed: 1,
          totalElapsedMs: 1200,
          recovered: true,
          exhausted: false,
          lastClassifier: "context_pressure",
          strategyHistory: ["compact_then_retry"],
        },
      }),
      saveSessionPosition: async () => "leaf-recovery",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
    } as any,
    sendMessage: async (_jid: string, text: string) => {
      sent.push(text);
    },
  };

  const task = db.getTaskById(taskId)!;
  await scheduler.runScheduledTask(task, deps as any);

  expect(sent).toEqual(["Hello"]);

  const updated = db.getTaskById(taskId)!;
  expect(updated.last_result).toContain("Hello");
  expect(updated.last_result).toContain("Automatic recovery succeeded after 1 attempt");

  const logs = db.getTaskRunLogs(taskId);
  expect(logs.length).toBe(1);
  expect(logs[0].status).toBe("success");
  expect(logs[0].result).toContain("Automatic recovery succeeded after 1 attempt");
});

test("runScheduledTask still logs and advances the task after an early execution throw", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const scheduler = await import("../../src/task-scheduler.js");
  scheduler.resetSchedulerMetricsForTests();

  const taskId = `task-early-error-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "say hi",
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const deps = {
    queue: { enqueueTask: (_id: string, fn: () => Promise<void>) => fn() } as any,
    agentPool: {
      runAgent: async () => ({ status: "success", result: "Hello" }),
      saveSessionPosition: async () => {
        throw new Error("save failed");
      },
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
    } as any,
    sendMessage: async () => {},
  };

  const task = db.getTaskById(taskId)!;
  await scheduler.runScheduledTask(task, deps as any);

  const updated = db.getTaskById(taskId)!;
  expect(updated.last_run).not.toBeNull();
  expect(updated.last_result).toContain("save failed");
  expect(updated.next_run).not.toBe(task.next_run);

  const logs = db.getTaskRunLogs(taskId);
  expect(logs.length).toBe(1);
  expect(logs[0].status).toBe("error");
  expect(logs[0].error).toContain("save failed");

  const metrics = scheduler.getSchedulerMetrics();
  expect(metrics.taskRunsStarted).toBe(1);
  expect(metrics.taskRunsSucceeded).toBe(0);
  expect(metrics.taskRunsFailed).toBe(1);
});

test("runScheduledTask computes the next cron run from the task next_run anchor", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({
    PICLAW_WORKSPACE: ws.workspace,
    PICLAW_STORE: ws.store,
    PICLAW_DATA: ws.data,
    TZ: "UTC",
  });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const scheduler = await import("../../src/task-scheduler.js");
  scheduler.resetSchedulerMetricsForTests();

  const taskId = `task-cron-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "say hi",
    schedule_type: "cron",
    schedule_value: "*/5 * * * *",
    next_run: "2024-01-01T00:00:00.000Z",
    status: "active",
    created_at: new Date().toISOString(),
  });

  const deps = {
    queue: { enqueueTask: (_id: string, fn: () => Promise<void>) => fn() } as any,
    agentPool: {
      runAgent: async () => ({ status: "success", result: "Hello" }),
      saveSessionPosition: async () => "leaf-123",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
    } as any,
    sendMessage: async () => {},
  };

  const task = db.getTaskById(taskId)!;
  await scheduler.runScheduledTask(task, deps as any);

  const updated = db.getTaskById(taskId)!;
  expect(updated.next_run).toBe("2024-01-01T00:05:00.000Z");
});

test("runScheduledTask switches and restores models", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const scheduler = await import("../../src/task-scheduler.js");

  const taskId = `task-model-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "say hi",
    model: "openai/gpt-4",
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const modelCalls: any[] = [];
  const deps = {
    queue: { enqueueTask: (_id: string, fn: () => Promise<void>) => fn() } as any,
    agentPool: {
      runAgent: async () => ({ status: "success", result: "Hello" }),
      saveSessionPosition: async () => "leaf-456",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => "openai/gpt-3.5",
      applyControlCommand: async (_jid: string, payload: any) => {
        modelCalls.push(payload);
        return { status: "success", message: "" };
      },
    } as any,
    sendMessage: async () => {},
  };

  const task = db.getTaskById(taskId)!;
  await scheduler.runScheduledTask(task, deps as any);

  expect(modelCalls.length).toBe(2);
  expect(modelCalls[0].raw).toBe("/model openai/gpt-4");
  expect(modelCalls[1].raw).toBe("/model openai/gpt-3.5");
});

test("runScheduledTask stops when model switch fails", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const scheduler = await import("../../src/task-scheduler.js");
  scheduler.resetSchedulerMetricsForTests();

  const taskId = `task-model-error-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "say hi",
    model: "openai/gpt-4",
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const modelCalls: any[] = [];
  let runCount = 0;
  const deps = {
    queue: { enqueueTask: (_id: string, fn: () => Promise<void>) => fn() } as any,
    agentPool: {
      runAgent: async () => {
        runCount += 1;
        return { status: "success", result: "Hello" };
      },
      saveSessionPosition: async () => "leaf-789",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => "openai/gpt-3.5",
      applyControlCommand: async (_jid: string, payload: any) => {
        modelCalls.push(payload);
        if (modelCalls.length === 1) {
          return { status: "error", message: "boom" };
        }
        return { status: "success", message: "" };
      },
    } as any,
    sendMessage: async () => {},
  };

  const task = db.getTaskById(taskId)!;
  await scheduler.runScheduledTask(task, deps as any);

  expect(runCount).toBe(0);
  expect(modelCalls.length).toBe(2);
  expect(modelCalls[1].raw).toBe("/model openai/gpt-3.5");

  const metrics = scheduler.getSchedulerMetrics();
  expect(metrics.taskRunsStarted).toBe(1);
  expect(metrics.taskRunsSucceeded).toBe(0);
  expect(metrics.taskRunsFailed).toBe(1);
});

test("runScheduledTask logs restore-model failures", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const scheduler = await import("../../src/task-scheduler.js");

  const taskId = `task-model-restore-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: "web:default",
    prompt: "say hi",
    model: "openai/gpt-4",
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const modelCalls: any[] = [];
  const errors: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: any, encodingOrCb?: any, cb?: any) => {
    errors.push(String(chunk));
    if (typeof encodingOrCb === "function") encodingOrCb();
    else if (typeof cb === "function") cb();
    return true;
  }) as typeof process.stderr.write;

  const deps = {
    queue: { enqueueTask: (_id: string, fn: () => Promise<void>) => fn() } as any,
    agentPool: {
      runAgent: async () => ({ status: "success", result: "Hello" }),
      saveSessionPosition: async () => "leaf-restore",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => "openai/gpt-3.5",
      applyControlCommand: async (_jid: string, payload: any) => {
        modelCalls.push(payload);
        if (modelCalls.length === 2) {
          return { status: "error", message: "restore failed" };
        }
        return { status: "success", message: "" };
      },
    } as any,
    sendMessage: async () => {},
  };

  const task = db.getTaskById(taskId)!;
  await scheduler.runScheduledTask(task, deps as any);

  process.stderr.write = originalWrite;

  expect(modelCalls.length).toBe(2);
  expect(errors.some((line) => line.includes("Failed to restore model"))).toBe(true);

  const logs = db.getTaskRunLogs(taskId);
  expect(logs.length).toBe(1);
  expect(logs[0].status).toBe("success");
});

test("durable polling queues one runId and binds scheduled-agent source before delivery", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();
  const database = db.getDb();
  const foreignKeysWereEnabled = (database.query("PRAGMA foreign_keys").get() as { foreign_keys?: number } | undefined)?.foreign_keys === 1;
  database.exec("PRAGMA foreign_keys=ON");
  restoreForeignKeys = () => database.exec(`PRAGMA foreign_keys=${foreignKeysWereEnabled ? "ON" : "OFF"}`);
  const scheduler = await import("../../src/task-scheduler.js");
  const { createCurrentPiclawScheduledRunStore } = await import("../../src/service-effects/current-piclaw/scheduled-run-store.js");
  const built = createCurrentPiclawScheduledRunStore(database, { hitFault: () => false, recordTrace: () => undefined });
  expect(built.ok).toBe(true);
  if (!built.ok) return;

  const scheduledFor = new Date(Date.now() - 1000).toISOString();
  const taskId = `task-durable-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: "web:durable",
    prompt: "say durable",
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: scheduledFor,
    status: "active",
    created_at: new Date().toISOString(),
  });

  const queued: Array<{ id: string; run: () => Promise<void>; lane?: string }> = [];
  let observedSourceBound = false;
  const deps = {
    queue: {
      enqueueTask: (id: string, run: () => Promise<void>, lane?: string) => queued.push({ id, run, lane }),
    },
    agentPool: {
      saveSessionPosition: async () => "durable-leaf",
      restoreSessionPosition: async () => undefined,
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
      runAgent: async () => {
        const row = db.getDb().query("SELECT state FROM service_effect_s07_occurrences WHERE task_id=?").get(taskId) as { state: string };
        observedSourceBound = row.state === "source_bound";
        return { status: "success", result: "durable result" };
      },
    },
    sendMessage: async () => {
      const source = db.getDb().query(
        `SELECT s.source_id,r.run_id,r.state FROM service_effect_s01_sources s
         JOIN service_effect_s07_occurrences r ON r.run_id=s.source_id
         WHERE r.task_id=?`,
      ).get(taskId) as { source_id: string; run_id: string; state: string };
      expect(source.source_id).toBe(source.run_id);
      expect(source.state).toBe("source_bound");
    },
  };

  await scheduler.pollScheduledRunsOnce(deps as any, built.value);
  await scheduler.pollScheduledRunsOnce(deps as any, built.value);
  const durableRun = db.getDb().query(
    "SELECT run_id FROM service_effect_s07_occurrences WHERE task_id=?",
  ).get(taskId) as { run_id: string };
  const durableQueued = queued.filter((item) => item.id === durableRun.run_id);
  expect(durableQueued).toHaveLength(1);
  expect(durableQueued[0].id).toMatch(/^scheduled_run:[0-9a-f]{64}$/);
  expect(durableQueued[0].id).not.toContain(taskId);
  expect(durableQueued[0].lane).toBe("chat:web:durable");

  await durableQueued[0].run();
  expect(observedSourceBound).toBe(true);
  const occurrence = db.getDb().query(
    "SELECT state,attempt,task_revision FROM service_effect_s07_occurrences WHERE task_id=?",
  ).get(taskId) as { state: string; attempt: number; task_revision: number };
  expect(occurrence).toEqual({ state: "completed", attempt: 1, task_revision: 1 });
  expect(db.getTaskById(taskId)?.next_run).not.toBe(scheduledFor);
  const source = db.getDb().query(
    "SELECT s.state,o.phase FROM service_effect_s01_sources s JOIN service_effect_s01_operations o ON o.chat_jid=s.chat_jid AND o.primary_source_seq=s.source_seq WHERE s.source_id=?",
  ).get(durableQueued[0].id) as { state: string; phase: string };
  expect(source).toEqual({ state: "consumed", phase: "terminal" });
  await scheduler.stopSchedulerLoop();
});

test("expired scheduled-agent claim is reclaimed only after stable source absence reconciliation", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const db = await import("../../src/db.js");
  db.initDatabase();
  const database = db.getDb();
  const foreignKeysWereEnabled = (database.query("PRAGMA foreign_keys").get() as { foreign_keys?: number } | undefined)?.foreign_keys === 1;
  database.exec("PRAGMA foreign_keys=ON");
  restoreForeignKeys = () => database.exec(`PRAGMA foreign_keys=${foreignKeysWereEnabled ? "ON" : "OFF"}`);
  const scheduler = await import("../../src/task-scheduler.js");
  const { createCurrentPiclawScheduledRunStore } = await import("../../src/service-effects/current-piclaw/scheduled-run-store.js");
  const built = createCurrentPiclawScheduledRunStore(database, { hitFault: () => false, recordTrace: () => undefined });
  expect(built.ok).toBe(true);
  if (!built.ok) return;

  const taskId = `task-reclaim-${Date.now()}`;
  db.createTask({
    id: taskId,
    chat_jid: "web:reclaim",
    prompt: "reclaim safely",
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });
  const queued: Array<{ id: string; run: () => Promise<void> }> = [];
  const deps = {
    queue: { enqueueTask: (id: string, run: () => Promise<void>) => queued.push({ id, run }) },
    agentPool: {},
    sendMessage: async () => undefined,
  };

  await scheduler.pollScheduledRunsOnce(deps as any, built.value);
  const first = db.getDb().query(
    "SELECT run_id,attempt FROM service_effect_s07_occurrences WHERE task_id=?",
  ).get(taskId) as { run_id: string; attempt: number };
  expect(first.attempt).toBe(1);
  expect(db.getDb().query("SELECT 1 FROM service_effect_s01_sources WHERE source_id=?").get(first.run_id)).toBeNull();
  await scheduler.stopSchedulerLoop();

  const claimedAt = new Date(Date.now() - 2000).toISOString();
  const expiredAt = new Date(Date.now() - 1000).toISOString();
  db.getDb().query("UPDATE service_effect_s07_occurrences SET claimed_at=?,lease_expires_at=? WHERE run_id=?").run(claimedAt, expiredAt, first.run_id);
  db.getDb().query("UPDATE service_effect_s07_leases SET claimed_at=?,lease_expires_at=? WHERE run_id=? AND attempt=1").run(claimedAt, expiredAt, first.run_id);

  await scheduler.pollScheduledRunsOnce(deps as any, built.value);
  const reclaimed = db.getDb().query(
    "SELECT attempt FROM service_effect_s07_occurrences WHERE run_id=?",
  ).get(first.run_id) as { attempt: number };
  expect(reclaimed.attempt).toBe(2);
  expect(queued.filter((item) => item.id === first.run_id)).toHaveLength(2);
  const authority = db.getDb().query(
    "SELECT authority_kind,reconciliation_ref FROM service_effect_s07_leases WHERE run_id=? AND attempt=2",
  ).get(first.run_id) as { authority_kind: string; reconciliation_ref: string };
  expect(authority.authority_kind).toBe("agent_reconciled_absent");
  expect(authority.reconciliation_ref).toContain(first.run_id);
  await scheduler.stopSchedulerLoop();
});

test("startSchedulerLoop returns stop function and stop is idempotent", async () => {
  const ws = getTestWorkspace();
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../src/db.js");
  db.initDatabase();

  const scheduler = await importFresh<typeof import("../src/task-scheduler.js")>("../src/task-scheduler.js");
  scheduler.resetSchedulerMetricsForTests();

  db.createTask({
    id: `task-loop-${Date.now()}`,
    chat_jid: "web:default",
    prompt: "loop",
    schedule_type: "interval",
    schedule_value: "60000",
    next_run: new Date(Date.now() - 1000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  });

  const deps = {
    queue: { enqueueTask: async () => {} },
    agentPool: {} as any,
    sendMessage: async () => {},
  };

  const stop = scheduler.startSchedulerLoop(deps as any);
  expect(typeof stop).toBe("function");

  const stopAgain = scheduler.startSchedulerLoop(deps as any);
  expect(typeof stopAgain).toBe("function");

  await new Promise((resolve) => setTimeout(resolve, 0));
  const metrics = scheduler.getSchedulerMetrics();
  expect(metrics.polls).toBeGreaterThanOrEqual(1);
  expect(metrics.tasksEnqueued).toBeGreaterThanOrEqual(1);

  await stop();
  await scheduler.stopSchedulerLoop();
});
