/**
 * test/runtime/scheduler.test.ts – Tests for the task scheduler.
 *
 * Verifies cron-based and one-shot task scheduling, execution timing,
 * task persistence, and cleanup of completed tasks.
 */

import { afterEach, expect, test } from "bun:test";
import { getTestWorkspace, importFresh, setEnv } from "../helpers.js";

let restoreEnv: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
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

test("runScheduledTask relies on runAgent persistence and records one agent response and run log", async () => {
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
  let messageSerial = 0;
  const persistAgentResponse = (source: string, text: string) => {
    messageSerial += 1;
    db.storeMessage({
      id: `scheduled-agent-${source}-${messageSerial}`,
      chat_jid: "web:default",
      sender: "agent",
      sender_name: "Agent",
      content: text,
      timestamp: new Date().toISOString(),
      is_from_me: false,
      is_bot_message: true,
    });
  };
  const deps = {
    queue: { enqueueTask: (_id: string, fn: () => Promise<void>) => fn() } as any,
    agentPool: {
      runAgent: async () => {
        persistAgentResponse("run-agent", "Hello");
        return { status: "success", result: "Hello" };
      },
      saveSessionPosition: async () => "leaf-123",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
    } as any,
    sendMessage: async (_jid: string, text: string) => {
      sent.push(text);
      persistAgentResponse("scheduler-send", text);
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
  expect(sent).toEqual([]);
  expect(nudges).toEqual(["Hello"]);

  const visibleResponses = db.getDb().prepare(
    "SELECT content FROM messages WHERE chat_jid = ? AND is_bot_message = 1 AND content = ?",
  ).all("web:default", "Hello") as Array<{ content: string }>;
  expect(visibleResponses).toEqual([{ content: "Hello" }]);

  const logs = db.getTaskRunLogs(taskId);
  expect(logs.length).toBe(1);
  expect(logs[0].status).toBe("success");

  const metrics = scheduler.getSchedulerMetrics();
  expect(metrics.taskRunsStarted).toBe(1);
  expect(metrics.taskRunsSucceeded).toBe(1);
  expect(metrics.taskRunsFailed).toBe(0);
});

test("runScheduledTask can keep runAgent-persisted output muted from Pushover nudges", async () => {
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

  expect(sent).toEqual([]);
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

  expect(sent).toEqual([]);

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

  stop();
  scheduler.stopSchedulerLoop();
});
