import { expect, test, spyOn } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor, withTempWorkspaceEnv } from "../helpers.js";
import { closeDatabase, createTask, getDb, getTaskById, initDatabase } from "../../src/db.js";
import { getSchedulerMetrics, pollScheduledRunsOnce, resetSchedulerMetricsForTests, runScheduledTask, startSchedulerLoop, stopSchedulerLoop, type SchedulerDeps } from "../../src/task-scheduler.js";
import { withExecutionIdentity, type ExecutionIdentity } from "../../src/core/execution-context.js";
import { createCurrentPiclawScheduledRunStore } from "../../src/service-effects/current-piclaw/scheduled-run-store.js";
import { getRuntimeTimingConfig } from "../../src/core/config.js";
import type { ScheduledRunStore } from "../../src/service-effects/contracts/scheduled-run-store.js";
import type { ScheduledTask } from "../../src/types.js";

type Mode = "single-user" | "family-shared" | "isolated-containers" | "invalid";
const skipped = { status: "skipped", result: null, error: "Scheduled work requires valid single-user configuration and context.", durationMs: 0, taskRunLogId: null };
const identity: ExecutionIdentity = {
  mode: "family-shared", username: "alice", displayName: "Alice", role: "admin", rootChatJid: "web:alice",
  provenance: { actorUserId: "alice", ownerUserId: "alice", chatJid: "web:alice", kind: "scheduled" },
};

async function fixture(run: (configure: (mode: Mode) => void, workspace: string) => Promise<void>) {
  await withTempWorkspaceEnv("scheduler-boundary-", {}, async (ws) => {
    await stopSchedulerLoop(); closeDatabase(); initDatabase(); resetSchedulerMetricsForTests();
    mkdirSync(join(ws.workspace, ".piclaw"));
    const configure = (mode: Mode) => writeFileSync(join(ws.workspace, ".piclaw/config.json"), mode === "invalid" ? "{" : JSON.stringify({ domains: { access: {
      mode, ...(mode === "isolated-containers" ? { isolation: { component: "backend", backendId: "test", ownerUserId: "alice", gatewayUrl: "https://gateway.example", verificationKeyRef: "test-key" } } : {}),
    } } }));
    configure("single-user");
    try { await run(configure, ws.workspace); } finally { await stopSchedulerLoop(); closeDatabase(); }
  });
}

function task(kind: "agent" | "shell" | "internal" = "agent", command?: string) {
  const id = crypto.randomUUID();
  createTask({ id, chat_jid: `web:scheduler-boundary-${id}`, prompt: kind === "internal" ? "dream" : "prompt", model: "test/override", task_kind: kind,
    command: command ?? null, schedule_type: "interval", schedule_value: "60000", next_run: new Date(Date.now() - 1000).toISOString(), status: "active", created_at: new Date().toISOString() });
  return getTaskById(id)!;
}

function snapshot() {
  return JSON.stringify(["scheduled_tasks", "task_run_logs", "service_effect_s07_tasks", "service_effect_s07_occurrences", "service_effect_s07_leases", "service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s01_chats", "chat_cursors"].map((name) => getDb().query(`SELECT * FROM ${name} ORDER BY rowid`).all()));
}

function harness(transition?: string, change: () => void = () => {}, reject = false) {
  const calls: string[] = [], queued: (() => Promise<void>)[] = [];
  const stage = async (name: string, value: any) => { calls.push(name); if (transition === name) { change(); if (reject) throw new Error("stage failed"); } return value; };
  const deps = {
    queue: { enqueueTask: (_id: string, run: () => Promise<void>) => queued.push(run) },
    agentPool: {
      saveSessionPosition: () => stage("save", "leaf"), getCurrentModelLabel: () => stage("model", "test/original"),
      applyControlCommand: (_jid: string, cmd: any) => stage(cmd.modelId === "override" ? "switch" : "restore-model", { status: "success" }),
      runAgent: () => stage("agent", { status: "success", result: "result" }), restoreSessionPosition: () => stage("restore", undefined),
    },
    sendMessage: () => stage("send", undefined), sendNudge: () => stage("nudge", undefined),
  } as unknown as SchedulerDeps;
  return { calls, queued, deps };
}

function store() {
  getDb().exec("PRAGMA foreign_keys=ON");
  const built = createCurrentPiclawScheduledRunStore(getDb(), { hitFault: () => false, recordTrace: () => undefined });
  if (!built.ok) throw new Error(built.error._tag);
  return built.value;
}

function wrapStore(real: ScheduledRunStore, overrides: Partial<ScheduledRunStore>): ScheduledRunStore {
  return new Proxy(real, { get: (target, key) => {
    const override = Reflect.get(overrides, key);
    if (override) return override;
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

test("scheduler entry points deny unsupported modes, stale context and invalid config before database/dependency work", async () => {
  await fixture(async (configure, workspace) => {
    const marker = join(workspace, "shell-ran");
    const tasks = [task(), task("shell", `touch '${marker}'`), task("internal")];
    const before = snapshot(), metrics = getSchedulerMetrics();
    const deps = new Proxy({}, { get: () => { throw new Error("Unexpected dependency access"); } }) as SchedulerDeps;
    const forbiddenStore = new Proxy({}, { get: () => { throw new Error("Unexpected store access"); } }) as ScheduledRunStore;
    for (const mode of ["family-shared", "isolated-containers", "invalid", "single-user"] as const) {
      configure(mode);
      for (const context of mode === "single-user" ? [identity] : [null, identity]) {
        await withExecutionIdentity(context, async () => {
          // An unreadable task proves denial precedes even task-id lookup.
          expect(await runScheduledTask(new Proxy({} as ScheduledTask, { get: () => { throw new Error("Unexpected task read"); } }), deps)).toEqual(skipped);
          for (const current of tasks) expect(await runScheduledTask(current, deps)).toEqual(skipped);
          await pollScheduledRunsOnce(deps, forbiddenStore);
          await startSchedulerLoop(deps)();
        });
      }
    }
    expect(snapshot()).toBe(before); expect(getSchedulerMetrics()).toEqual(metrics);
    expect(existsSync(marker)).toBe(false);
  });
});

test("scheduler stops after each agent await or rejection without later restoration, delivery or durable writes", async () => {
  await fixture(async (configure) => {
    const stages = ["save", "model", "switch", "agent", "send", "nudge", "restore", "restore-model"];
    for (const mode of ["family-shared", "invalid"] as const) for (const reject of [false, true]) for (const stage of stages) {
      configure("single-user"); const current = task(); const before = snapshot();
      const h = harness(stage, () => configure(mode), reject);
      expect(await runScheduledTask(current, h.deps)).toEqual(skipped);
      expect(h.calls).toEqual(stages.slice(0, stages.indexOf(stage) + 1));
      expect(snapshot()).toBe(before);
    }
  });
});

test("native dispatch joins a rejecting promise after synchronous authority revocation without settlement", async () => {
  await fixture(async (configure) => {
    const current = task(), h = harness();
    const entered = Promise.withResolvers<void>();
    const native = Promise.withResolvers<Awaited<ReturnType<SchedulerDeps["agentPool"]["runAgent"]>>>();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    let atDispatch = "", finished = false;
    h.deps.agentPool.dispatchScheduledAgent = (lease) => {
      expect(lease.record.taskId).toBe(current.id);
      h.calls.push("native");
      atDispatch = snapshot();
      // Revocation happens before dispatch returns, not at a later await.
      configure("family-shared");
      entered.resolve();
      return native.promise;
    };
    process.on("unhandledRejection", onUnhandled);
    let running: Promise<void> | undefined;
    try {
      await pollScheduledRunsOnce(h.deps, store());
      expect(h.queued).toHaveLength(1);
      running = h.queued[0]().then(() => { finished = true; });
      await entered.promise;
      await Bun.sleep(0);
      // The queue-owned callback must remain active until native work settles.
      expect(finished).toBe(false);
      expect(h.calls).toEqual(["native"]);
      expect(snapshot()).toBe(atDispatch);
      native.reject(new Error("native rejected after authority revocation"));
      await running;
      await Bun.sleep(0);
      expect(finished).toBe(true);
      expect(unhandled).toEqual([]);
      expect(h.calls).toEqual(["native"]);
      // No result log, delivery, restoration, completion, or source settlement.
      expect(snapshot()).toBe(atDispatch);
    } finally {
      native.reject(new Error("native regression cleanup"));
      await running;
      await Bun.sleep(0);
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

test("internal task model setup cannot continue into Dream after a mode change", async () => {
  await fixture(async (configure) => {
    for (const stage of ["model", "switch"]) {
      configure("single-user"); const current = task("internal"); const before = snapshot();
      const h = harness(stage, () => configure("family-shared"));
      expect(await runScheduledTask(current, h.deps)).toEqual(skipped);
      expect(h.calls).toEqual(stage === "model" ? ["model"] : ["model", "switch"]);
      expect(snapshot()).toBe(before);
    }
  });
});

test("an already-started shell may finish but cannot deliver or persist after mode changes", async () => {
  await fixture(async (configure, workspace) => {
    const started = join(workspace, "shell-started"), release = join(workspace, "shell-release");
    const current = task("shell", `touch '${started}'; while [ ! -e '${release}' ]; do sleep 0.02; done; printf 'finished'`);
    current.timeout_sec = 5;
    const before = snapshot(), h = harness();
    const running = runScheduledTask(current, h.deps);
    try {
      await waitFor(() => existsSync(started));
      configure("family-shared");
    } finally { writeFileSync(release, "release"); }
    expect(await running).toEqual(skipped);
    expect(h.calls).toEqual([]); expect(snapshot()).toBe(before);
  });
});

test("a mode change during a durable claim prevents enqueue without abandoning or rewriting the committed claim", async () => {
  await fixture(async (configure) => {
    task(); const real = store(); const h = harness(); let afterClaim = "";
    const wrapped = wrapStore(real, { claimDue: async (request: any) => {
      const result = await real.claimDue(request); afterClaim = snapshot(); configure("family-shared"); return result;
    } });
    await pollScheduledRunsOnce(h.deps, wrapped);
    expect(h.queued).toHaveLength(0); expect(h.calls).toEqual([]); expect(snapshot()).toBe(afterClaim);
    expect((getDb().query("SELECT count(*) n FROM service_effect_s07_occurrences").get() as any).n).toBe(1);
  });
});

test("queued tasks stop before source binding and never resume after their controller is denied", async () => {
  await fixture(async (configure) => {
    task(); const h = harness(); await pollScheduledRunsOnce(h.deps, store());
    expect(h.queued).toHaveLength(1); const before = snapshot();
    configure("family-shared"); await h.queued[0]();
    configure("single-user"); await h.queued[0]();
    expect(h.calls).toEqual([]); expect(snapshot()).toBe(before);
  });
});

test("source binding and settlement continuations do not mutate after a mode change, including rejections", async () => {
  await fixture(async (configure) => {
    for (const stage of ["bindAcceptedSource", "complete", "abandon"] as const) for (const reject of [false, true]) {
      configure("single-user"); const current = task(); const real = store(); const h = harness(); let afterStage = "";
      const wrapped = wrapStore(real, { [stage]: async (request: any) => {
        const result = await (real[stage] as any)(request); afterStage = snapshot(); configure("family-shared");
        if (reject) throw new Error("stage failed"); return result;
      } });
      await pollScheduledRunsOnce(h.deps, wrapped);
      // Earlier claims remain pending; select the newly queued occurrence.
      const run = h.queued.at(-1)!;
      if (stage === "abandon") getDb().query("UPDATE scheduled_tasks SET status='paused' WHERE id=?").run(current.id);
      await run(); expect(afterStage).not.toBe(""); expect(snapshot()).toBe(afterStage);
      if (stage !== "complete") expect(h.calls).toEqual([]);
      await stopSchedulerLoop();
    }
  });
});

test("queued single-user leases still renew, but denial before or after renewal stops further renewal", async () => {
  await fixture(async (configure) => {
    const timers: Array<() => Promise<void>> = [];
    const original = globalThis.setTimeout;
    const originalDate = globalThis.Date;
    let clock = originalDate.now();
    class ClockDate extends originalDate {
      constructor(...args: any[]) {
        super(...(args.length ? args : [clock]));
      }
      static now() { return clock; }
    }
    globalThis.Date = ClockDate as DateConstructor;
    const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(((fn: any, ms: number, ...args: any[]) => {
      if (ms === 20_000) { timers.push(fn); return { unref() {} } as any; }
      return original(fn, ms, ...args);
    }) as any);
    try {
      task(); const real = store(); const h = harness(); let renewals = 0; let changeOnRenew = false; let afterRenew = "";
      const wrapped = wrapStore(real, { renew: async (request: any) => {
        renewals++; const result = await real.renew(request); afterRenew = snapshot();
        if (changeOnRenew) configure("family-shared"); return result;
      } });
      await pollScheduledRunsOnce(h.deps, wrapped);
      expect(timers).toHaveLength(1); clock += 20_000; await timers.shift()!(); expect(renewals).toBe(1); expect(timers).toHaveLength(1);
      changeOnRenew = true; clock += 20_000; await timers.shift()!(); expect(renewals).toBe(2); expect(timers).toHaveLength(0);
      expect(snapshot()).toBe(afterRenew); await h.queued[0](); expect(h.calls).toEqual([]);

      configure("single-user"); task(); const next = harness(); await pollScheduledRunsOnce(next.deps, wrapped);
      expect(timers).toHaveLength(1); const before = snapshot(); configure("invalid"); clock += 20_000; await timers.shift()!();
      expect(renewals).toBe(2); expect(timers).toHaveLength(0); expect(snapshot()).toBe(before);
    } finally { globalThis.Date = originalDate; timerSpy.mockRestore(); }
  });
});

test("renewal rejection stops the controller permanently, even if single-user config is restored before dequeue", async () => {
  await fixture(async (configure) => {
    let renewal: (() => Promise<void>) | undefined;
    const original = globalThis.setTimeout;
    const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(((fn: any, ms: number, ...args: any[]) => {
      if (ms === 20_000) { renewal = fn; return { unref() {} } as any; }
      return original(fn, ms, ...args);
    }) as any);
    try {
      task(); const real = store(); const h = harness();
      const wrapped = wrapStore(real, { renew: async () => { configure("family-shared"); throw new Error("renewal failed"); } });
      await pollScheduledRunsOnce(h.deps, wrapped); const before = snapshot();
      expect(renewal).toBeDefined(); await renewal!(); configure("single-user"); await h.queued[0]();
      expect(h.calls).toEqual([]); expect(snapshot()).toBe(before);
    } finally { timerSpy.mockRestore(); }
  });
});

test("lease denial during an active model wait remains effective after configuration is restored", async () => {
  await fixture(async (configure) => {
    let renewal: (() => Promise<void>) | undefined;
    const original = globalThis.setTimeout;
    const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(((fn: any, ms: number, ...args: any[]) => {
      if (ms === 20_000) { renewal = fn; return { unref() {} } as any; }
      return original(fn, ms, ...args);
    }) as any);
    const waiting = Promise.withResolvers<any>();
    let running: Promise<void> | undefined;
    try {
      task(); const real = store(); const h = harness(); let entered = false;
      h.deps.agentPool.runAgent = async () => { h.calls.push("agent"); entered = true; return waiting.promise; };
      await pollScheduledRunsOnce(h.deps, real); running = h.queued[0]();
      await waitFor(() => entered); const before = snapshot();
      configure("family-shared"); await renewal!(); configure("single-user");
      waiting.resolve({ status: "success", result: "must not deliver" }); await running;
      expect(h.calls).toEqual(["save", "model", "switch", "agent"]); expect(snapshot()).toBe(before);
    } finally { waiting.resolve({ status: "error", result: null }); await running; timerSpy.mockRestore(); }
  });
});

test("automatic denial stops polling, releases store resources and permits a clean later single-user start", async () => {
  await fixture(async (configure) => {
    const polls: Array<() => Promise<void>> = [];
    const original = globalThis.setTimeout;
    const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(((fn: any, ms: number, ...args: any[]) => {
      if (ms === getRuntimeTimingConfig().schedulerPollIntervalMs) { polls.push(fn); return { unref() {} } as any; }
      return original(fn, ms, ...args);
    }) as any);
    const foreignKeys = () => (getDb().query("PRAGMA foreign_keys").get() as any).foreign_keys;
    try {
      getDb().exec("PRAGMA foreign_keys=OFF"); const h = harness(); const before = snapshot();
      startSchedulerLoop(h.deps); await waitFor(() => polls.length === 1);
      expect(foreignKeys()).toBe(1);
      configure("family-shared"); await polls.shift()!(); await stopSchedulerLoop();
      expect(polls).toHaveLength(0); expect(foreignKeys()).toBe(0); expect(snapshot()).toBe(before);
      configure("single-user"); const stop = startSchedulerLoop(h.deps);
      await waitFor(() => polls.length === 1); expect(foreignKeys()).toBe(1);
      await stop(); expect(foreignKeys()).toBe(0); expect(snapshot()).toBe(before);
    } finally { timerSpy.mockRestore(); }
  });
});
