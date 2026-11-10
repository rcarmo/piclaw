import {runAdmittedScheduledTask,waitForAdmittedScheduledTask} from '../helpers/admitted-scheduled-task.js';
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
      isDurableRuntime:()=>true,dispatchScheduledAgent: async () => ({ status: "success", result: "Hello" }),
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
  await runAdmittedScheduledTask(task, deps as any);

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
      isDurableRuntime:()=>true,dispatchScheduledAgent: async () => ({ status: "success", result: "Hello" }),
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
  await runAdmittedScheduledTask(task, deps as any);

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
      isDurableRuntime:()=>true,dispatchScheduledAgent: async () => ({
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
  await runAdmittedScheduledTask(task, deps as any);

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
      isDurableRuntime:()=>true,dispatchScheduledAgent: async () => { throw Error("dispatch failed"); },
      saveSessionPosition: async () => { throw Error("Legacy position lookup forbidden"); },
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
    } as any,
    sendMessage: async () => {},
  };

  const task = db.getTaskById(taskId)!;
  await runAdmittedScheduledTask(task, deps as any);

  const updated = db.getTaskById(taskId)!;
  expect(updated.last_run).not.toBeNull();
  expect(updated.last_result).toContain("dispatch failed");
  expect(updated.next_run).not.toBe(task.next_run);

  const logs = db.getTaskRunLogs(taskId);
  expect(logs.length).toBe(1);
  expect(logs[0].status).toBe("error");
  expect(logs[0].error).toContain("dispatch failed");

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
      isDurableRuntime:()=>true,dispatchScheduledAgent: async () => ({ status: "success", result: "Hello" }),
      saveSessionPosition: async () => "leaf-123",
      restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
    } as any,
    sendMessage: async () => {},
  };

  const task = db.getTaskById(taskId)!;
  await runAdmittedScheduledTask(task, deps as any);

  const updated = db.getTaskById(taskId)!;
  expect(updated.next_run).toBe("2024-01-01T00:05:00.000Z");
});

test("durable polling dispatches one SDK run without a host queue and binds source before delivery", async () => {
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
  let observedSourceBound = false, dispatched=0;
  const delivered:Array<{source_id:string;run_id:string;state:string}>=[];
  const deps = {
    queue: {
      enqueueTask: (id: string, run: () => Promise<void>, lane?: string) => queued.push({ id, run, lane }),
    },
    agentPool: {
      saveSessionPosition: async () => "durable-leaf",
      restoreSessionPosition: async () => undefined,
      getCurrentModelLabel: async () => null,
      applyControlCommand: async () => ({ status: "success", message: "" }),
      isDurableRuntime:()=>true,dispatchScheduledAgent: async (lease:any) => {
        if(lease.record.taskId!==taskId)return {status:'success',result:'other fixture task'};
        dispatched++;
        const row = db.getDb().query("SELECT state FROM service_effect_s07_occurrences WHERE task_id=?").get(taskId) as { state: string };
        observedSourceBound = row.state === "source_bound";
        return { status: "success", result: "durable result" };
      },
    },
    sendMessage: async (chat:string) => {
      if(chat!=='web:durable')return;
      const source = db.getDb().query(
        `SELECT s.source_id,r.run_id,r.state FROM service_effect_s01_sources s
         JOIN service_effect_s07_occurrences r ON r.run_id=s.source_id
         WHERE r.task_id=?`,
      ).get(taskId) as { source_id: string; run_id: string; state: string };
      delivered.push(source);
    },
  };

  await scheduler.pollScheduledRunsOnce(deps as any, built.value);
  await scheduler.pollScheduledRunsOnce(deps as any, built.value);
  const durableRun = db.getDb().query(
    "SELECT run_id FROM service_effect_s07_occurrences WHERE task_id=?",
  ).get(taskId) as { run_id: string };
  await waitForAdmittedScheduledTask(taskId);
  expect(queued.filter((item) => item.id === durableRun.run_id)).toHaveLength(0);
  expect(dispatched).toBe(1);
  expect(durableRun.run_id).toMatch(/^scheduled_run:[0-9a-f]{64}$/);
  expect(durableRun.run_id).not.toContain(taskId);
  expect(delivered).toEqual([{source_id:durableRun.run_id,run_id:durableRun.run_id,state:'completed'}]);
  expect(observedSourceBound).toBe(true);
  const occurrence = db.getDb().query(
    "SELECT state,attempt,task_revision FROM service_effect_s07_occurrences WHERE task_id=?",
  ).get(taskId) as { state: string; attempt: number; task_revision: number };
  expect(occurrence).toEqual({ state: "completed", attempt: 1, task_revision: 1 });
  expect(db.getTaskById(taskId)?.next_run).not.toBe(scheduledFor);
  const source = db.getDb().query(
    "SELECT s.state,o.phase FROM service_effect_s01_sources s JOIN service_effect_s01_operations o ON o.chat_jid=s.chat_jid AND o.primary_source_seq=s.source_seq WHERE s.source_id=?",
  ).get(durableRun.run_id) as { state: string; phase: string };
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


for (const attached of [false, true]) test(`poll reconciles an expired disposed scheduled source once without dispatching missed agent runs; SDK-attached=${attached}`,async()=>{
  const ws=getTestWorkspace();restoreEnv=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  const db=await import('../../src/db.js');db.initDatabase();const database=db.getDb();
  const fk=(database.query('PRAGMA foreign_keys').get() as {foreign_keys:number}).foreign_keys;database.exec('PRAGMA foreign_keys=ON');restoreForeignKeys=()=>database.exec(`PRAGMA foreign_keys=${fk?'ON':'OFF'}`);
  const {createCurrentPiclawScheduledRunStore}=await import('../../src/service-effects/current-piclaw/scheduled-run-store.js');
  const {hashCanonicalRequest}=await import('../../src/service-effects/contracts/common.js');
  const scheduler=await import('../../src/task-scheduler.js');
  let captures=0;
  const built=createCurrentPiclawScheduledRunStore(database,{hitFault:()=>false,recordTrace(){},async prepareInterruptedHarness(identity){captures++;expect(identity.sessionId).toBe('sdk-fixture');expect(identity.submissionId).toBe('42');return()=>{};}});if(!built.ok)throw Error(built.error._tag);const store=built.value;
  const taskId='task:terminal-poll:'+crypto.randomUUID(),chat='web:terminal-poll:'+crypto.randomUUID(),operation='scheduled-operation:'+crypto.randomUUID();
  const old=Date.now()-3*86400000,claimedAt=new Date(old).toISOString(),boundAt=new Date(old+1).toISOString(),terminalAt=new Date(old+2000).toISOString();
  // Capture the versioned host body through the production task authority.
  // A bare S07 snapshot no longer authorises a runnable host task.
  db.createTask({id:taskId,chat_jid:chat,prompt:'Synthetic terminal-poll task',task_kind:'agent',schedule_type:'cron',schedule_value:'0 1 * * *',next_run:claimedAt,status:'active',created_at:claimedAt});
  const claimed=await store.claimDue({now:claimedAt,limit:100,workerId:'worker:terminal-poll',leaseTokenPrefix:'terminal-poll:'+taskId,leaseDurationMs:1000,reclaimAuthorities:[]});if(!claimed.ok)throw Error(claimed.error._tag);const lease=claimed.value.find(x=>x.task.taskId===taskId)!;expect(lease).toBeDefined();
  // Exact synthetic historical input; no model submission or fabricated SDK receipt.
  database.transaction(()=>{
    database.query('INSERT INTO service_effect_s01_chats(chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id) VALUES(?,2,0,NULL)').run(chat);
    database.query("INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,accepted_at,provenance_ref,create_wake_intent) VALUES(?,1,?,?,'scheduled_agent','claimed',?,?,?,0)").run(chat,lease.record.runId,'a'.repeat(64),lease.task.payloadRef,boundAt,lease.record.runId);
    database.query("INSERT INTO service_effect_s01_operations(operation_id,chat_jid,version,phase,primary_source_seq) VALUES(?,?,1,'claimed',1)").run(operation,chat);
    database.query('INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq) VALUES(?,?,1)').run(chat,operation);
  }).immediate();
  const bind={effect:{idempotencyKey:'bind:'+taskId,requestHash:'',operationId:operation,sourceSeq:1,provenanceRef:lease.record.runId,redactionClass:'private' as const},runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:1,expectedTaskRevision:1,leaseToken:lease.leaseToken,now:boundAt,boundAt,sourceSeq:1,operationId:operation};bind.effect.requestHash=hashCanonicalRequest(bind as any);expect((await store.bindAcceptedSource(bind)).ok).toBe(true);
  database.transaction(()=>{
    database.query("UPDATE service_effect_s01_operations SET version=2,phase='terminal',terminal_disposition='failed',terminal_error_code='scheduled_run_interrupted',terminal_committed_at=? WHERE operation_id=?").run(terminalAt,operation);
    database.query("UPDATE service_effect_s01_sources SET state='disposed',disposition_reason='scheduled_run_interrupted' WHERE source_id=?").run(lease.record.runId);
    database.query('UPDATE service_effect_s01_chats SET consumed_through_source_seq=1 WHERE chat_jid=?').run(chat);
    if(attached)database.query("UPDATE service_effect_s01_operations SET harness_session_id='sdk-fixture',harness_operation_id='42' WHERE operation_id=?").run(operation);
  }).immediate();
  const sourceBefore=database.query('SELECT * FROM service_effect_s01_sources WHERE chat_jid=?').all(chat),operationBefore=database.query('SELECT * FROM service_effect_s01_operations WHERE operation_id=?').all(operation),leasesBefore=database.query('SELECT * FROM service_effect_s07_leases WHERE run_id=?').all(lease.record.runId);
  let dispatched=0;const deps={queue:{enqueueTask(id:string){if(id===`chat:${chat}`)dispatched++;}},agentPool:{} as any,sendMessage:async()=>{throw Error('Unexpected publication');}};
  await scheduler.pollScheduledRunsOnce(deps as any,store);await scheduler.pollScheduledRunsOnce(deps as any,store);
  const result=await store.get(lease.record.runId);expect(result.ok).toBe(true);expect(result.value).toMatchObject({state:'completed',status:'error',errorCode:'scheduled_run_interrupted',attempt:1,headDisposition:'advanced'});
  expect(result.value!.nextRunAt!>new Date().toISOString()).toBe(true);expect(dispatched).toBe(0);expect(captures).toBe(attached?1:0);
  expect(database.query('SELECT * FROM service_effect_s01_sources WHERE chat_jid=?').all(chat)).toEqual(sourceBefore);expect(database.query('SELECT * FROM service_effect_s01_operations WHERE operation_id=?').all(operation)).toEqual(operationBefore);expect(database.query('SELECT * FROM service_effect_s07_leases WHERE run_id=?').all(lease.record.runId)).toEqual(leasesBefore);
  expect(database.query('SELECT COUNT(*) n FROM service_effect_s07_run_logs WHERE run_id=?').get(lease.record.runId)).toEqual({n:1});expect(database.query('SELECT COUNT(*) n FROM service_effect_s07_next_decisions WHERE run_id=?').get(lease.record.runId)).toEqual({n:1});
});

test('scheduler exposes no raw execution entry or parallel direct history/recurrence mode',async()=>{
  const api=await import('../../src/task-scheduler.js');
  expect(api).not.toHaveProperty('runScheduledTask');
  const source=await Bun.file(new URL('../../src/task-scheduler.ts',import.meta.url)).text();
  for(const name of ['advanceTask','deferHistory','taskRunLogId','logTaskRun(','updateTaskAfterRun('])expect(source).not.toContain(name);
});
