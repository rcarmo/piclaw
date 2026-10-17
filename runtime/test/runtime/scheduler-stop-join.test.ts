import { expect, spyOn, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withTempWorkspaceEnv } from "../helpers.js";
import { closeDatabase, createTask, getDb, getTaskRunLogs, initDatabase } from "../../src/db.js";
import * as stores from "../../src/service-effects/current-piclaw/scheduled-run-store.js";
import { getRuntimeTimingConfig } from "../../src/core/config.js";
import { getSchedulerMetrics, resetSchedulerMetricsForTests, startSchedulerLoop, stopSchedulerLoop, SchedulerStoreReleaseError, type SchedulerDeps } from "../../src/task-scheduler.js";

async function fixture(run: (deps: SchedulerDeps, queued: Array<() => Promise<void>>) => Promise<void>) {
  await withTempWorkspaceEnv("scheduler-stop-join-", {}, async (ws) => {
    await stopSchedulerLoop(); closeDatabase(); initDatabase(); resetSchedulerMetricsForTests();
    mkdirSync(join(ws.workspace, ".piclaw"));
    writeFileSync(join(ws.workspace, ".piclaw/config.json"), JSON.stringify({ domains: { access: { mode: "single-user" } } }));
    const queued: Array<() => Promise<void>> = [];
    const deps = {
      queue: { enqueueTask: (_id: string, run: () => Promise<void>) => queued.push(run) },
      agentPool: {
        saveSessionPosition: async () => "leaf", getCurrentModelLabel: async () => null,
        restoreSessionPosition: async () => {}, runAgent: async () => ({ status: "success", result: "done" }),
      },
      sendMessage: async () => {},
    } as unknown as SchedulerDeps;
    createTask({ id: "join-task", chat_jid: "web:join", prompt: "test", schedule_type: "interval", schedule_value: "60000", next_run: new Date(Date.now() - 1000).toISOString(), status: "active", created_at: new Date().toISOString() });
    try { await run(deps, queued); }
    finally { await stopSchedulerLoop(); closeDatabase(); }
  });
}

test("store release failure rejects the same observed stop promise but retires its generation", async () => {
  await fixture(async (deps) => {
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const db = getDb();
    db.exec("PRAGMA foreign_keys=OFF");
    const factory = stores.createCurrentPiclawScheduledRunStore;
    const factorySpy = spyOn(stores, "createCurrentPiclawScheduledRunStore").mockImplementation((...args) => {
      const result = factory(...args);
      if (!result.ok) return result;
      const claimDue = result.value.claimDue.bind(result.value);
      result.value.claimDue = async (request) => { const result = await claimDue(request); entered.resolve(); await release.promise; return result; };
      return result;
    });
    const failure = new Error("FK restore failed");
    let execSpy: ReturnType<typeof spyOn> | undefined;
    try {
      const stop = startSchedulerLoop(deps);
      await entered.promise;
      const exec = db.exec.bind(db);
      execSpy = spyOn(db, "exec").mockImplementation((sql) => {
        if (sql === "PRAGMA foreign_keys=OFF") throw failure;
        return exec(sql);
      });
      const stopped = stop();
      expect(stop()).toBe(stopped);
      release.resolve();
      // Intentionally ignore the rejected promise for a full event-loop turn.
      await Bun.sleep(0);
      const error = await stopped.catch((error) => error);
      expect(error).toBeInstanceOf(SchedulerStoreReleaseError);
      expect(error.cause).toBe(failure);
      expect(stop()).toBe(stopped);
      execSpy.mockRestore(); factorySpy.mockRestore();
      const stopNew = startSchedulerLoop(deps);
      expect(stopNew).not.toBe(stop);
      expect(stop()).toBe(stopped);
      expect(startSchedulerLoop(deps)).toBe(stopNew);
      await stopNew();
    } finally { release.resolve(); execSpy?.mockRestore(); factorySpy.mockRestore(); }
  });
});

test("stop joins a held claim, denies late admission, and old callbacks cannot affect restart", async () => {
  await fixture(async (deps, queued) => {
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const factory = stores.createCurrentPiclawScheduledRunStore;
    const factorySpy = spyOn(stores, "createCurrentPiclawScheduledRunStore").mockImplementation((...args) => {
      const result = factory(...args);
      if (!result.ok) return result;
      const claimDue = result.value.claimDue.bind(result.value);
      result.value.claimDue = async (request) => {
        const claimed = await claimDue(request);
        entered.resolve(); await release.promise;
        return claimed;
      };
      return result;
    });
    const timers: Array<() => Promise<void>> = [];
    const timerCreated = Promise.withResolvers<void>();
    const originalTimer = globalThis.setTimeout;
    const timerSpy = spyOn(globalThis, "setTimeout").mockImplementation(((fn: any, ms: number, ...args: any[]) => {
      if (ms === getRuntimeTimingConfig().schedulerPollIntervalMs) { timers.push(fn); timerCreated.resolve(); return { unref() {} } as any; }
      return originalTimer(fn, ms, ...args);
    }) as any);
    try {
      const stop = startSchedulerLoop(deps);
      expect(startSchedulerLoop(deps)).toBe(stop);
      await entered.promise;
      const joining = stop();
      expect(stop()).toBe(joining); expect(stopSchedulerLoop()).toBe(joining);
      expect(startSchedulerLoop(deps)).toBe(stop); // no overlapping generations
      let joined = false; void joining.then(() => { joined = true; });
      await Promise.resolve(); expect(joined).toBe(false);
      expect(queued).toHaveLength(0);
      release.resolve(); await joining;
      expect(joined).toBe(true); expect(queued).toHaveLength(0); expect(timers).toHaveLength(0);
      factorySpy.mockRestore();
      const stopNew = startSchedulerLoop(deps);
      // Joining the new initial poll deterministically leaves its timer available
      // for a stale callback invocation after a later restart.
      await timerCreated.promise;
      expect(timers).toHaveLength(1);
      expect(stop()).toBe(joining);
      expect(startSchedulerLoop(deps)).toBe(stopNew);
      const staleTimer = timers[0]; await stopNew();
      const stopThird = startSchedulerLoop(deps);
      const before = getSchedulerMetrics().polls;
      await staleTimer(); expect(getSchedulerMetrics().polls).toBe(before);
      expect(startSchedulerLoop(deps)).toBe(stopThird);
      await stopThird();
    } finally { release.resolve(); await stopSchedulerLoop(); factorySpy.mockRestore(); timerSpy.mockRestore(); }
  });
});

test("stop joins dispatch but not an active agent, including across restart", async () => {
  await fixture(async (deps, queued) => {
    const admitted = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<{ status: "success"; result: string }>();
    deps.queue.enqueueTask = (_id, run) => { queued.push(run); admitted.resolve(); };
    deps.agentPool.runAgent = async () => { entered.resolve(); return await release.promise as any; };
    const stop = startSchedulerLoop(deps);
    await admitted.promise;
    const running = queued[0]();
    try {
      await entered.promise;
      await stop();
      expect(getTaskRunLogs("join-task")).toHaveLength(0);
      const stopNew = startSchedulerLoop(deps);
      expect(stop()).toBe(stop());
      release.resolve({ status: "success", result: "done" }); await running;
      expect(getTaskRunLogs("join-task")[0]?.status).toBe("success");
      expect(startSchedulerLoop(deps)).toBe(stopNew);
      await stopNew();
    } finally { release.resolve({ status: "success", result: "done" }); await running; }
  });
});

test("stop does not cancel or join accepted queue work, which can still settle", async () => {
  await fixture(async (deps, queued) => {
    const admitted = Promise.withResolvers<void>();
    deps.queue.enqueueTask = (_id, run) => { queued.push(run); admitted.resolve(); };
    const stop = startSchedulerLoop(deps);
    await admitted.promise;
    await stop();
    expect(queued).toHaveLength(1);
    expect(getTaskRunLogs("join-task")).toHaveLength(0);
    await queued[0]();
    expect(getTaskRunLogs("join-task")[0]?.status).toBe("success");
    expect((getDb().query("SELECT state FROM service_effect_s07_occurrences WHERE task_id='join-task'").get() as any).state).toBe("completed");
  });
});
