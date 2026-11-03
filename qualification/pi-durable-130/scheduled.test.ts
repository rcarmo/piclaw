import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/index.js";
import { barrier, context, openFixture } from "./src/fixture.js";
import { value } from "./src/host-handoff.js";
import { createScheduledRunDispatch, type ScheduledAgentInput } from "../../runtime/durable-engine/src/index.js";
import { initDatabase, getDb, closeDatabase } from "../../runtime/src/db/connection.js";
import { createTask, getTaskById, getTaskRunLogs, updateTask } from "../../runtime/src/db/tasks.js";
import { AgentQueue } from "../../runtime/src/queue.js";
import { pollScheduledRunsOnce, stopSchedulerLoop, type SchedulerDeps } from "../../runtime/src/task-scheduler.js";
import { createCurrentPiclawScheduledRunStore } from "../../runtime/src/service-effects/current-piclaw/scheduled-run-store.js";
import type { ScheduledRunLease, ScheduledRunStore } from "../../runtime/src/service-effects/contracts/scheduled-run-store.js";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Scheduled qualification timed out");
    await Bun.sleep(2);
  }
}

function captureRenewals() {
  const original = globalThis.setTimeout;
  const callbacks: Array<() => Promise<void>> = [];
  globalThis.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    const timer = original(callback, delay, ...args);
    if (delay === 20000) callbacks.push(async () => { clearTimeout(timer); await (callback as () => Promise<void>)(); });
    return timer;
  }) as typeof setTimeout;
  return { callbacks, restore: () => { globalThis.setTimeout = original; } };
}

async function setup(holdRootAdapter = false, rootOnDisk = false) {
  await mkdir(resolve(process.env.PICLAW_WORKSPACE!, ".piclaw"), { recursive: true });
  await writeFile(resolve(process.env.PICLAW_WORKSPACE!, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
  process.env.PICLAW_DB_IN_MEMORY = rootOnDisk ? "0" : "1";
  initDatabase();
  const db = getDb(); db.exec("PRAGMA foreign_keys=ON");
  const dir = await mkdtemp(resolve(process.env.PICLAW_WORKSPACE!, "scheduled-"));
  const fixture = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(resolve(dir, "durable.sqlite"))));
  const actual = value(createCurrentPiclawScheduledRunStore(db, { hitFault: () => false, recordTrace() {} }));
  const queue = new AgentQueue();
  const leases = new Map<string, ScheduledRunLease>();
  const payloads = new Map<string, string>();
  const bridges = new Map<string, ReturnType<typeof createScheduledRunDispatch<string>>>();
  const inputs: ScheduledAgentInput[] = [], sent: string[] = [], cancelled: string[] = [];
  const late = barrier(), rootAdapter = barrier();
  if (!holdRootAdapter) rootAdapter.release();
  // The public authority fixture's get() returns a revision snapshot, whose
  // status is authored, not live. Read the actual EF-S07 head via the root DB
  // accessor instead. Test-only SQL; no candidate/private SDK table access.
  const currentTask = async (taskId: string) => db.query(
    "SELECT current_revision AS revision,status FROM service_effect_s07_tasks WHERE task_id=?",
  ).get(taskId) as { revision: number; status: string } | null;
  let holdLate = false;
  const store: ScheduledRunStore = {
    claimDue: async request => {
      const result = await actual.claimDue(request);
      if (result.ok) for (const lease of result.value) {
        leases.set(lease.record.runId, lease);
        const task = getTaskById(lease.record.taskId)!;
        expect(task.revision).toBe(lease.record.taskRevision);
        payloads.set(lease.task.payloadRef, task.prompt);
      }
      return result;
    },
    renew: async request => {
      const result = await actual.renew(request);
      // Qualification host wiring: root scheduler owns renewal. Forward its
      // failure to the active durable dispatch; do not start another renew loop.
      if (!result.ok) bridges.get(request.runId)?.fence();
      return result;
    },
    bindAcceptedSource: request => actual.bindAcceptedSource(request), complete: request => actual.complete(request),
    abandon: request => actual.abandon(request), get: id => actual.get(id), listRuns: request => actual.listRuns(request),
    cleanupTerminal: request => actual.cleanupTerminal(request),
  };
  async function dispatch(input: ScheduledAgentInput) {
    inputs.push(input);
    expect(input.chatJid).toBe("web:scheduled-qualification");
    const source = db.query("SELECT source_id,kind FROM service_effect_s01_sources WHERE chat_jid=? AND source_seq=?").get(input.chatJid, input.sourceSeq);
    expect(source).toEqual({ source_id: input.requestId, kind: "scheduled_agent" });
    expect(value(await actual.get(input.requestId))?.operationId).toBe(input.operationId);
    // Dedicated scheduled fixture conversation, NOT a production main-chat
    // save/restore adapter. Public request lookup handles uncertain submit ACK.
    const submission = await fixture.storage.submissionByRequest(fixture.root.id, input.requestId, context);
    const content = payloads.get(input.payloadRef);
    if (content === undefined) throw new Error("Missing occurrence payload");
    const handle = submission ? await fixture.harness.submission(submission.id, context) : await fixture.submit(input.requestId, content);
    if (!handle) throw new Error("Missing scheduled submission");
    let cancellation: Promise<void> | undefined;
    const abort = () => {
      // Abort placed WORK, not merely its wait. This fixture owns this whole
      // conversation; production requires equivalent exact-scope ownership.
      cancellation = fixture.root.abort(context).then(() => { cancelled.push(input.requestId); });
    };
    input.signal.addEventListener("abort", abort, { once: true });
    if (input.signal.aborted) abort();
    try {
      await handle.wait(context);
      await cancellation;
      if (holdLate) await late.promise; // Deliberately ignore abort at return boundary.
      if (input.signal.aborted) return "LATE_UNTRUSTED_RESULT";
      return (await fixture.settlement(handle)).answer.model!.flatMap(message => message.role === "assistant"
        ? message.content.filter(part => part.type === "text").map(part => part.text) : []).join("");
    } finally { input.signal.removeEventListener("abort", abort); }
  }
  const deps: SchedulerDeps = {
    queue,
    // Only the host agent adapter is replaced. All claim/source/bind/renew,
    // run-log, terminal/source settlement and task advancement code is real.
    agentPool: {
      saveSessionPosition: async () => "dedicated-scheduled-fixture", restoreSessionPosition: async () => {},
      getCurrentModelLabel: async () => null,
      dispatchScheduledAgent: async (lease: ScheduledRunLease) => {
        expect(leases.get(lease.record.runId)).toEqual(lease);
        const records=value(await actual.listRuns({taskId:lease.record.taskId,state:'source_bound'}));
        expect(records.some(record=>record.runId===lease.record.runId)).toBe(true);
        if(payloads.get(lease.task.payloadRef)===undefined)throw Error('Missing scheduled payload');
        await rootAdapter.promise;
        if (holdRootAdapter) throw new Error("Isolated admission probe finished");
        const bridge = createScheduledRunDispatch(store, lease, currentTask, dispatch);
        bridges.set(lease.record.runId, bridge);
        const first = bridge.run(); expect(bridge.run()).toBe(first);
        return { status: "success", result: await first };
      },
    } as unknown as SchedulerDeps["agentPool"],
    sendMessage: async (_jid, text) => { sent.push(text); },
  };
  const due = new Date(Date.now() - 1000).toISOString();
  createTask({ id: "scheduled-fixture", chat_jid: "web:scheduled-qualification", prompt: "synthetic scheduled input",
    schedule_type: "once", schedule_value: due, next_run: due, status: "active", notify_on_complete: false, created_at: due });
  return { db, fixture, actual, store, queue, leases, bridges, inputs, sent, cancelled, late, currentTask, dispatch,
    setHoldLate: () => { holdLate = true; },
    poll: () => pollScheduledRunsOnce(deps, store),
    async close() {
      stopSchedulerLoop(); for (const bridge of bridges.values()) bridge.fence();
      fixture.host.modelHold?.release(); late.release(); rootAdapter.release();
      await queue.shutdown(); await fixture.close(); closeDatabase(); await rm(dir, { recursive: true, force: true });
    },
  };
}

test("actual root scheduler: duplicate polls -> one EF-S07 occurrence/source -> public durable input -> sole existing terminal/delivery owner", async () => {
  const h = await setup();
  const renewal = captureRenewals();
  try {
    h.fixture.host.modelHold = barrier();
    await h.poll(); await until(() => h.inputs.length === 1);
    await h.poll(); await h.poll();
    expect(h.queue.getMetrics().enqueued).toBe(1); expect(h.leases.size).toBe(1);
    const id = h.inputs[0]!.requestId;
    expect(id).toMatch(/^scheduled_run:[a-f0-9]{64}$/);
    const beforeRenewal = value(await h.actual.get(id))!;
    expect(beforeRenewal.state).toBe("source_bound");
    expect(renewal.callbacks).toHaveLength(1); await renewal.callbacks[0]!();
    const renewed = value(await h.actual.get(id))!;
    expect(renewed.leaseExpiresAt! > beforeRenewal.leaseExpiresAt!).toBe(true);
    expect(renewed.attempt).toBe(1); expect(h.inputs[0]!.signal.aborted).toBe(false);
    if (renewed.operationId === null) throw new Error("Missing scheduled operation binding");
    const check = await h.bridges.get(id)!.check(); expect(check.operationId).toBe(renewed.operationId);
    // A forged stale attempt may observe the same runId but cannot dispatch.
    let staleCalls = 0;
    const lease = h.leases.get(id)!;
    const stale = createScheduledRunDispatch(h.actual, { ...lease, record: { ...lease.record, attempt: lease.record.attempt + 1 } }, h.currentTask, async () => { staleCalls++; });
    await expect(stale.run()).rejects.toThrow("fenced"); expect(staleCalls).toBe(0);
    h.fixture.host.modelHold.release();
    await until(() => h.queue.getMetrics().succeeded === 1);
    await h.poll();
    expect(h.inputs).toHaveLength(1); expect(h.fixture.host.modelCalls).toBe(1);
    const run = value(await h.actual.get(id))!;
    expect(run.state).toBe("completed"); expect(run.headDisposition).toBe("advanced"); expect(run.nextRunAt).toBeNull();
    expect(run.outboxIds).toEqual([]); expect(getTaskById("scheduled-fixture")?.status).toBe("completed");
    expect(getTaskRunLogs("scheduled-fixture")).toHaveLength(1); expect(h.sent).toEqual(["synthetic answer"]);
    expect(h.db.query("SELECT s.state,o.phase,o.terminal_disposition FROM service_effect_s01_sources s JOIN service_effect_s01_operations o ON o.primary_source_seq=s.source_seq AND o.chat_jid=s.chat_jid WHERE s.source_id=?").get(id))
      .toEqual({ state: "consumed", phase: "terminal", terminal_disposition: "completed" });
    expect(h.db.query("SELECT count(*) AS n FROM service_effect_s07_run_logs").get()).toEqual({ n: 1 });
    expect(h.db.query("SELECT count(*) AS n FROM service_effect_s05_outbox").get()).toEqual({ n: 0 });
    expect(h.db.query("SELECT name FROM sqlite_master WHERE name='service_effect_s02_commits'").all()).toEqual([]); // No second terminal store installed.
    expect((await h.fixture.storage.scanSubmissions({ conversationId: h.fixture.root.id }, 10, undefined, context)).items).toHaveLength(1);
  } finally { renewal.restore(); await h.close(); }
}, 15000);

for (const lostAcks of [1, 2, "unknown_then_not_applied", "unknown_probe_unavailable"] as const) test(`lost completion ACK repairs the same occurrence history without another native execution: ${lostAcks} lost`, async () => {
  const h = await setup();
  const complete = h.store.complete.bind(h.store);
  const get = h.store.get.bind(h.store);
  let calls = 0, failedProbe = false;
  h.store.get = async id => {
    if (lostAcks === "unknown_probe_unavailable" && calls === 2 && !failedProbe) {
      failedProbe = true;
      return { ok: false, error: { _tag: "storage_unavailable", certainty: "not_applied", retryable: true } };
    }
    return get(id);
  };
  let original: Parameters<ScheduledRunStore["complete"]>[0] | undefined;
  h.store.complete = async request => {
    calls++;
    if (original) expect(request).toBe(original); else original = request;
    if ((lostAcks === "unknown_then_not_applied" || lostAcks === "unknown_probe_unavailable") && calls === 2) return { ok: false, error: { _tag: "storage_unavailable", certainty: "not_applied", retryable: true } };
    const result = await complete(request);
    if (calls <= (typeof lostAcks === "number" ? lostAcks : 1) && result.ok) return { ok: false, error: { _tag: "storage_unavailable", certainty: "unknown", retryable: true } };
    return result;
  };
  try {
    await h.poll();
    await until(() => h.queue.getMetrics().succeeded === 1);
    expect(calls).toBe(2);
    expect(h.fixture.host.modelCalls).toBe(1);
    expect(h.inputs).toHaveLength(1);
    const id = h.inputs[0]!.requestId, committed = value(await h.actual.get(id))!;
    expect(committed.resultRef).toBe(`task_run_result:${id}`);
    if (lostAcks === "unknown_probe_unavailable") {
      expect(failedProbe).toBe(true);
      expect(h.db.query("SELECT terminal_disposition FROM service_effect_s01_operations WHERE operation_id=?").get(committed.operationId!))
        .toEqual({ terminal_disposition: null });
      await h.poll(); // Recovery must preserve the already committed success.
    }
    expect(h.db.query("SELECT s.state,o.phase,o.terminal_disposition FROM service_effect_s01_sources s JOIN service_effect_s01_operations o ON o.primary_source_seq=s.source_seq AND o.chat_jid=s.chat_jid WHERE s.source_id=?").get(id))
      .toEqual({ state: "consumed", phase: "terminal", terminal_disposition: "completed" });
    expect(getTaskRunLogs("scheduled-fixture")).toEqual([expect.objectContaining({ occurrence_id: id, result: "synthetic answer", status: "success" })]);
    h.db.query("DELETE FROM task_run_logs WHERE occurrence_id=?").run(id);
    expect(value(await h.store.complete(original!))).toEqual(committed);
    await h.poll();
    expect(h.fixture.host.modelCalls).toBe(1);
    expect(h.inputs).toHaveLength(1);
    expect(h.sent).toEqual(["synthetic answer"]);
    expect(getTaskRunLogs("scheduled-fixture")).toHaveLength(1);
    expect(h.db.query("SELECT count(*) AS n FROM service_effect_s07_run_logs").get()).toEqual({ n: 1 });
  } finally { await h.close(); }
}, 15000);

test("real renewal failure cancels pending durable work; late callback cannot settle a revised successor", async () => {
  const h = await setup();
  // Exercise the REAL root 20s renewal callback deterministically, without a
  // sleep, fake store, extra scheduler, or changing production timing.
  const renewal = captureRenewals();
  try {
    h.fixture.host.modelHold = barrier(); h.setHoldLate();
    await h.poll(); await until(() => h.inputs.length === 1);
    const first = h.inputs[0]!, lease = h.leases.get(first.requestId)!;
    const expired = new Date(Date.now() - 1000).toISOString(), claimed = new Date(Date.now() - 2000).toISOString();
    // Same coherent fixture-only expiry used by existing EF-S07 integration tests.
    h.db.query("UPDATE service_effect_s07_occurrences SET claimed_at=?,lease_expires_at=? WHERE run_id=?").run(claimed, expired, first.requestId);
    h.db.query("UPDATE service_effect_s07_leases SET claimed_at=?,lease_expires_at=? WHERE run_id=? AND attempt=?").run(claimed, expired, first.requestId, lease.record.attempt);
    expect(renewal.callbacks).toHaveLength(1); await renewal.callbacks[0]!();
    await until(() => h.cancelled.length === 1);
    expect(first.signal.aborted).toBe(true); expect(h.fixture.host.modelCalls).toBe(0);
    const status = await h.fixture.storage.submissionByRequest(h.fixture.root.id, first.requestId, context);
    expect(status?.status).toBe("unanswered");
    // The real poll reconciles the expired accepted source; a real task revision
    // creates a DISTINCT occurrence. The old callback is still held open.
    const successorDue = new Date(Date.now() - 1).toISOString();
    updateTask("scheduled-fixture", { prompt: "successor payload", schedule_value: successorDue, next_run: successorDue });
    await h.poll(); expect(h.queue.getMetrics().enqueued).toBe(2);
    const successor = [...h.leases.keys()].find(id => id !== first.requestId)!;
    expect(successor).toBeDefined(); expect(value(await h.actual.get(successor))?.state).toBe("claimed");
    h.fixture.host.modelHold.release(); h.late.release();
    await until(() => h.queue.getMetrics().succeeded === 2);
    expect(h.sent).toEqual(["synthetic answer"]); expect(getTaskRunLogs("scheduled-fixture")).toHaveLength(1);
    expect(value(await h.actual.get(first.requestId))?.state).toBe("source_bound"); // No invented terminal authority.
    expect(value(await h.actual.get(successor))?.state).toBe("completed");
    expect(h.db.query("SELECT terminal_disposition,terminal_error_code FROM service_effect_s01_operations WHERE operation_id=?").get(first.operationId))
      .toEqual({ terminal_disposition: "failed", terminal_error_code: "scheduled_run_interrupted" });
    expect(h.fixture.host.modelCalls).toBe(1); expect(h.inputs.map(input => input.requestId)).toEqual([first.requestId, successor]);
    await expect(h.bridges.get(first.requestId)!.run()).rejects.toThrow("Scheduled occurrence fenced");
    expect(h.db.query("SELECT count(*) AS n FROM service_effect_s05_outbox").get()).toEqual({ n: 0 });
  } finally { renewal.restore(); await h.close(); }
}, 15000);

// Isolate the qualification boundary from the legacy runner's error catch/log
// path. Root still creates the real claim and accepted/bound source, but its
// adapter remains held until shutdown. These probes do NOT claim to fix root
// error logging or make async provider/effect admission atomic.
for (const change of ["revision", "pause"] as const) {
  for (const boundary of ["before run", "pending admission", "late result"] as const) {
    test(`live EF-S07 ${change} fences ${boundary} with an unexpired lease and no renewal`, async () => {
      const h = await setup(true);
      const renewal = captureRenewals();
      let bridge: ReturnType<typeof createScheduledRunDispatch<string>> | undefined;
      let running: Promise<string> | undefined;
      try {
        await h.poll();
        await until(() => !!h.db.query("SELECT run_id FROM service_effect_s07_occurrences WHERE state='source_bound'").get());
        const lease = [...h.leases.values()][0]!;
        const before = value(await h.actual.get(lease.record.runId))!;
        const originalHead = await h.currentTask(lease.record.taskId);
        bridge = createScheduledRunDispatch(h.store, lease, h.currentTask, h.dispatch);
        if (boundary === "pending admission") h.fixture.host.modelHold = barrier();
        if (boundary === "late result") h.setHoldLate();
        if (boundary !== "before run") {
          running = bridge.run();
          // Observe the rejection immediately, even while cancellation is held.
          void running.catch(() => {});
          await until(() => h.inputs.length === 1);
          if (boundary === "late result") await until(() => h.fixture.host.modelCalls === 1);
        }
        updateTask(lease.record.taskId, change === "revision"
          ? { prompt: "revised successor payload" } : { status: "paused" });
        const successor = getTaskById(lease.record.taskId)!;
        const head = await h.currentTask(lease.record.taskId);
        expect(head).toEqual({ revision: change === "revision" ? originalHead!.revision + 1 : originalHead!.revision,
          status: change === "pause" ? "paused" : "active" });
        // The occurrence itself is unchanged: this used to pass until renewal.
        expect(value(await h.actual.get(lease.record.runId))).toEqual(before);
        expect(before.leaseExpiresAt! > new Date().toISOString()).toBe(true);
        if (boundary === "before run") {
          await expect(bridge.run()).rejects.toThrow("fenced");
          expect(h.inputs).toHaveLength(0);
        } else if (boundary === "pending admission") {
          await expect(bridge.check()).rejects.toThrow("fenced");
          await until(() => h.cancelled.length === 1);
          h.fixture.host.modelHold!.release();
          await expect(running!).rejects.toThrow("fenced");
        } else {
          h.late.release();
          await expect(running!).rejects.toThrow("fenced");
        }
        expect(bridge.signal.aborted).toBe(true);
        expect(h.fixture.host.modelCalls).toBe(boundary === "late result" ? 1 : 0);
        expect(h.fixture.host.effects).toBe(0);
        expect(h.sent).toEqual([]); expect(getTaskRunLogs(lease.record.taskId)).toEqual([]);
        expect(getTaskById(lease.record.taskId)).toEqual(successor);
        expect(value(await h.actual.get(lease.record.runId))).toEqual(before);
        expect(h.db.query("SELECT count(*) AS n FROM service_effect_s07_run_logs").get()).toEqual({ n: 0 });
        expect(renewal.callbacks).toHaveLength(1); // None invoked; no synthetic expiry.
      } finally {
        bridge?.fence(); h.fixture.host.modelHold?.release(); h.late.release();
        await running?.catch(() => {});
        renewal.restore(); await h.close();
      }
    }, 15000);
  }
}

test("unbound/stale lease and non-agent task cannot dispatch; explicit host fence before run admits no input", async () => {
  const h = await setup();
  try {
    // Claim using the real store without enqueuing: no accepted source yet.
    const lease = value(await h.actual.claimDue({ now: new Date().toISOString(), workerId: "qualification-worker", leaseTokenPrefix: "qualification-prefix",
      leaseDurationMs: 60000, limit: 1, reclaimAuthorities: [] }))[0]!;
    let calls = 0;
    const dispatch = async () => { calls++; return "forbidden"; };
    await expect(createScheduledRunDispatch(h.actual, lease, h.currentTask, dispatch).run()).rejects.toThrow("fenced");
    const stopped = createScheduledRunDispatch(h.actual, lease, h.currentTask, dispatch); stopped.fence();
    await expect(stopped.run()).rejects.toThrow("fenced");
    expect(() => createScheduledRunDispatch(h.actual, { ...lease, task: { ...lease.task, kind: "shell", executionRepeatability: "repeatable" } }, h.currentTask, dispatch)).toThrow("agent occurrence");
    expect(calls).toBe(0); expect(h.fixture.host.modelCalls).toBe(0); expect(h.sent).toEqual([]);
  } finally { await h.close(); }
}, 15000);

for (const second of ['success','unknown','unknown_probe_unavailable'] as const) test(`retryable not_applied completion preserves native result and late uncertainty: ${second}`, async()=>{
  const h=await setup(), complete=h.store.complete.bind(h.store), get=h.store.get.bind(h.store);
  let calls=0, failedProbe=false, original:Parameters<ScheduledRunStore['complete']>[0]|undefined, snapshot='';
  h.store.complete=async request=>{
    calls++;
    if(original){expect(request).toBe(original);expect(JSON.stringify(request)).toBe(snapshot);}
    else{original=request;snapshot=JSON.stringify(request);}
    if(calls===1)return{ok:false,error:{_tag:'storage_unavailable',certainty:'not_applied',retryable:true}};
    const result=await complete(request);
    if(calls===2&&second!=='success'&&result.ok)return{ok:false,error:{_tag:'storage_unavailable',certainty:'unknown',retryable:true}};
    return result;
  };
  h.store.get=async id=>{
    if(second==='unknown_probe_unavailable'&&calls===2&&!failedProbe){failedProbe=true;return{ok:false,error:{_tag:'storage_unavailable',certainty:'not_applied',retryable:true}};}
    return get(id);
  };
  try{
    await h.poll();await until(()=>h.queue.getMetrics().succeeded===1);
    expect(calls).toBe(2);expect(h.fixture.host.modelCalls).toBe(1);expect(h.inputs).toHaveLength(1);
    const id=h.inputs[0]!.requestId, committed=value(await h.actual.get(id))!;
    expect(committed).toMatchObject({state:'completed',status:'success',resultRef:`task_run_result:${id}`,attempt:1});
    if(second==='unknown_probe_unavailable'){
      expect(failedProbe).toBe(true);
      expect(h.db.query('SELECT terminal_disposition FROM service_effect_s01_operations WHERE operation_id=?').get(committed.operationId!)).toEqual({terminal_disposition:null});
    }
    await h.poll(); // Reconcile an existing receipt only, never dispatch this source again.
    expect(h.db.query('SELECT s.state,o.phase,o.terminal_disposition FROM service_effect_s01_sources s JOIN service_effect_s01_operations o ON o.primary_source_seq=s.source_seq AND o.chat_jid=s.chat_jid WHERE s.source_id=?').get(id))
      .toEqual({state:'consumed',phase:'terminal',terminal_disposition:'completed'});
    expect(getTaskRunLogs('scheduled-fixture')).toEqual([expect.objectContaining({occurrence_id:id,result:'synthetic answer',status:'success'})]);
    expect(h.fixture.host.modelCalls).toBe(1);expect(h.inputs).toHaveLength(1);expect(h.sent).toEqual(['synthetic answer']);
    expect(h.db.query('SELECT count(*) n FROM service_effect_s07_run_logs').get()).toEqual({n:1});
    expect((await h.fixture.storage.scanSubmissions({conversationId:h.fixture.root.id},10,undefined,context)).items).toHaveLength(1);
    expect(value(await h.actual.complete(original!))).toEqual(committed);
    expect(getTaskRunLogs('scheduled-fixture')).toHaveLength(1);
  }finally{await h.close();}
},15000);

test('real six-second completion writer outage persists the same native result after retryable acquisition timeout',async()=>{
  const h=await setup(false,true), complete=h.store.complete.bind(h.store);
  const file=(h.db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
  const writer=new Database(file), first=Promise.withResolvers<void>();
  const policy=h.db.query('PRAGMA busy_timeout').get();
  let calls=0,ticks=0,release:ReturnType<typeof setTimeout>|undefined,original:Parameters<ScheduledRunStore['complete']>[0]|undefined;
  const pulse=setInterval(()=>{ticks++;},10);
  h.store.complete=async request=>{
    calls++;
    if(original)expect(request).toBe(original);else original=request;
    if(calls===1){expect(h.fixture.host.modelCalls).toBe(1);writer.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');release=setTimeout(()=>writer.exec('ROLLBACK'),6000);}
    const result=await complete(request);
    if(calls===1){expect(result).toMatchObject({ok:false,error:{_tag:'storage_unavailable',certainty:'not_applied',retryable:true}});first.resolve();}
    return result;
  };
  try{
    await h.poll();await first.promise;await until(()=>h.queue.getMetrics().succeeded===1);
    expect(calls).toBe(2);expect(ticks).toBeGreaterThan(50);
    const id=h.inputs[0]!.requestId, committed=value(await h.actual.get(id))!;
    expect(committed).toMatchObject({state:'completed',status:'success',resultRef:`task_run_result:${id}`,attempt:1});
    expect(getTaskRunLogs('scheduled-fixture')).toEqual([expect.objectContaining({occurrence_id:id,result:'synthetic answer',status:'success'})]);
    expect(h.fixture.host.modelCalls).toBe(1);expect(h.inputs).toHaveLength(1);expect(h.sent).toEqual(['synthetic answer']);
    expect(h.db.query('SELECT count(*) n FROM service_effect_s07_run_logs').get()).toEqual({n:1});
    expect(h.db.query('SELECT count(*) n FROM service_effect_s07_next_decisions').get()).toEqual({n:1});
    expect(h.db.query('PRAGMA busy_timeout').get()).toEqual(policy);
    await h.poll();expect(h.fixture.host.modelCalls).toBe(1);expect(h.inputs).toHaveLength(1);
  }finally{if(release)clearTimeout(release);clearInterval(pulse);if(writer.inTransaction)writer.exec('ROLLBACK');writer.close();await h.close();}
},20000);
