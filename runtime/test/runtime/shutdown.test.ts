import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { AgentPool } from "../../src/agent-pool.js";
import { initDatabase } from "../../src/db/connection.js";
import { createAgentPoolModelOptions } from "../model-services-fixture.js";
import { createShutdownHandler } from "../../src/runtime/shutdown.js";
import { SchedulerStoreReleaseError } from "../../src/task-scheduler.js";
import { addLogSink, removeLogSink, type LogRecord } from "../../src/utils/logger.js";
import { registerRuntimeShutdownSignals } from "../../src/runtime/composition.js";
import { registerShutdownHandler, requestGracefulShutdown } from "../../src/runtime/shutdown-registry.js";

const realSetTimeout = globalThis.setTimeout;
const backstops: {handle: ReturnType<typeof setTimeout>; run: () => void}[] = [];
let timerStub: ReturnType<typeof spyOn>;
beforeEach(() => {
  timerStub = spyOn(globalThis, "setTimeout").mockImplementation(((run: () => void, ms?: number, ...args: unknown[]) => {
    if (ms !== 15000) return realSetTimeout(run, ms, ...args);
    const handle = realSetTimeout(() => {}, 86400000); handle.unref();
    backstops.push({ handle, run }); return handle;
  }) as typeof setTimeout);
});
afterEach(() => {
  for (const timer of backstops.splice(0)) clearTimeout(timer.handle);
  timerStub.mockRestore();
});

test("web admission seals synchronously and joins before pollers or queue disposal", async () => {
  const calls: string[] = [];
  const release = Promise.withResolvers<void>();
  const exit = spyOn(process, 'exit').mockImplementation((() => {}) as any);
  try {
    const shutdown = createShutdownHandler({
      web: { sealAdmissions: () => { calls.push('seal'); return release.promise; }, stop: async () => { calls.push('web-stop'); } },
      stopMessageLoop: () => { calls.push('message'); },
      stopIpcWatcher: async () => {}, stopSchedulerLoop: () => { calls.push('scheduler'); }, stopOptionalProviders: () => {},
      queue: { shutdown: async () => { calls.push('queue'); } }, agentPool: { shutdown: async () => { calls.push('pool'); } },
      onShutdownComplete: () => { calls.push('certificate'); },
    });
    const pending = shutdown('test');
    expect(calls).toEqual(['seal']);
    await Promise.resolve(); expect(calls).toEqual(['seal']);
    release.resolve(); await pending;
    expect(calls).toEqual(['seal', 'message', 'scheduler', 'queue', 'web-stop', 'pool', 'certificate']);
  } finally { release.resolve(); exit.mockRestore(); }
});

test("failed web admission join leaves queue and pool alive and cannot certify owner release", async () => {
  const calls: string[] = [];
  const failure = new Error('web join failed');
  const shutdown = createShutdownHandler({
    web: { sealAdmissions: async () => { throw failure; }, stop: async () => { calls.push('web'); } },
    stopIpcWatcher: async () => {}, stopSchedulerLoop: () => {}, stopOptionalProviders: () => {},
    queue: { shutdown: async () => { calls.push('queue'); } }, agentPool: { shutdown: async () => { calls.push('pool'); } },
    onShutdownComplete: () => { calls.push('certificate'); },
  });
  expect(await shutdown('test').catch(error => error)).toBe(failure);
  expect(calls).toEqual([]);
});

test("queue join rejection stops disposal even after known post-join store failure", async () => {
  const calls: string[] = [];
  const releaseError = new SchedulerStoreReleaseError(new Error("FK restore failed"));
  const queueError = new Error("queue cleanup failed");
  const exit = spyOn(process, "exit").mockImplementation((() => { calls.push("exit"); }) as any);
  const timer = spyOn(globalThis, "clearTimeout");
  try {
    const shutdown = createShutdownHandler({
      stopIpcWatcher: async () => {}, stopSchedulerLoop: async () => { throw releaseError; },
      stopOptionalProviders: () => { calls.push("providers"); },
      queue: { shutdown: async () => { calls.push("queue"); throw queueError; } },
      agentPool: { shutdown: async () => { calls.push("pool"); } },
      web: { stop: async () => { calls.push("web"); } },
    });
    const error = await shutdown("test").catch((error) => error);
    expect(error).toBe(queueError);
    expect(calls).toEqual(["providers", "queue"]);
    expect(timer).toHaveBeenCalled();
  } finally { timer.mockRestore(); exit.mockRestore(); }
});

test("known post-join store release failure permits transport disposal but retains native owner registrations", async () => {
  const calls: string[] = [];
  const failure = new SchedulerStoreReleaseError(new Error("store release failed"));
  const shutdown = createShutdownHandler({
    stopIpcWatcher: async () => {}, stopSchedulerLoop: async () => { throw failure; },
    stopOptionalProviders: () => {},
    queue: { shutdown: async () => { calls.push("queue"); } },
    agentPool: { shutdown: async () => { calls.push("pool"); } },
    web: { stop: async () => { calls.push("web"); } },
    onShutdownComplete: () => { calls.push("certificate"); },
  });
  const error = await shutdown("test").catch(error => error);
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.errors).toEqual([failure]);
  // Queue joined, but failed store release does not confirm native backend cleanup.
  expect(calls).toEqual(["queue", "web"]);
});

test("uncertain poll join failure does not dispose potentially live resources", async () => {
  const calls: string[] = [];
  const failure = new Error("join failed");
  const shutdown = createShutdownHandler({
    stopIpcWatcher: async () => {}, stopSchedulerLoop: async () => { throw failure; },
    stopOptionalProviders: () => { calls.push("providers"); },
    queue: { shutdown: async () => { calls.push("queue"); } },
    agentPool: { shutdown: async () => { calls.push("pool"); } },
    web: { stop: async () => { calls.push("web"); } },
  });
  expect(await shutdown("test").catch((error) => error)).toBe(failure);
  expect(calls).toEqual([]);
});

test("signal and request entrypoints log rejected shutdown without unhandled rejection or fallback exit", async () => {
  const records: LogRecord[] = [];
  const sink = (record: LogRecord) => { if (record.level === "error") records.push(record); };
  addLogSink(sink);
  const exit = spyOn(process, "exit").mockImplementation((() => {}) as any);
  const failure = new Error("shutdown rejected");
  const shutdown = async () => { throw failure; };
  const listeners = new Map<string, () => void>();
  try {
    registerRuntimeShutdownSignals({ on: (signal, listener) => { listeners.set(signal, listener); } }, shutdown);
    registerShutdownHandler(shutdown);
    listeners.get("SIGTERM")!(); listeners.get("SIGINT")!();
    requestGracefulShutdown("test", 0);
    await Bun.sleep(0);
    expect(records).toHaveLength(3);
    expect(records.map((record) => record.operation)).toEqual(["shutdown_signal", "shutdown_signal", "request_shutdown"]);
    expect(records.every((record) => (record.err as { message: string }).message === failure.message)).toBe(true);
    expect(exit).not.toHaveBeenCalled();
  } finally { registerShutdownHandler(async () => {}); removeLogSink(sink); exit.mockRestore(); }
});

test("shutdown joins held asynchronous message poll before scheduler, queue, and pool disposal", async () => {
  const calls: string[] = [];
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const exit = spyOn(process, "exit").mockImplementation((() => {}) as any);
  let running: Promise<void> | undefined;
  try {
    const shutdown = createShutdownHandler({
      stopMessageLoop: async () => { calls.push("message-stop"); entered.resolve(); await release.promise; calls.push("message-joined"); },
      stopIpcWatcher: async () => { calls.push("ipc"); },
      stopSchedulerLoop: () => { calls.push("scheduler"); },
      stopOptionalProviders: () => {},
      queue: { shutdown: async () => { calls.push("queue"); } },
      agentPool: { shutdown: async () => { calls.push("pool"); } },
      web: { stop: async () => {} },
    });
    running = shutdown("test");
    await entered.promise;
    await Promise.resolve();
    expect(calls).toEqual(["message-stop"]);
    release.resolve();
    await running;
    expect(calls).toEqual(["message-stop", "message-joined", "ipc", "scheduler", "queue", "pool"]);
  } finally { release.resolve(); await running; exit.mockRestore(); }
});

test("message join failure does not dispose potentially live resources", async () => {
  const calls: string[] = [];
  const failure = new Error("message join failed");
  const shutdown = createShutdownHandler({
    stopMessageLoop: async () => { throw failure; },
    stopIpcWatcher: async () => { calls.push("ipc"); },
    stopSchedulerLoop: () => { calls.push("scheduler"); },
    stopOptionalProviders: () => {},
    queue: { shutdown: async () => { calls.push("queue"); } },
    agentPool: { shutdown: async () => { calls.push("pool"); } },
    web: { stop: async () => {} },
  });
  expect(await shutdown("test").catch((error) => error)).toBe(failure);
  expect(calls).toEqual([]);
});

test("shutdown joins scheduler admission before disposing queue or agent pool", async () => {
  const calls: string[] = [];
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const exit = spyOn(process, "exit").mockImplementation((() => { calls.push("exit"); }) as any);
  let shuttingDown: Promise<void> | undefined;
  try {
    const shutdown = createShutdownHandler({
      stopIpcWatcher: async () => { calls.push("ipc"); },
      stopSchedulerLoop: async () => { calls.push("scheduler-start"); entered.resolve(); await release.promise; calls.push("scheduler-joined"); },
      stopOptionalProviders: () => { calls.push("providers"); },
      queue: { shutdown: async () => { calls.push("queue"); } },
      agentPool: { shutdown: async () => { calls.push("agents"); } },
      web: { stop: async () => { calls.push("web"); } },
    });
    shuttingDown = shutdown("test");
    await entered.promise;
    expect(calls).toEqual(["ipc", "scheduler-start"]);
    await Promise.resolve(); expect(calls).not.toContain("queue");
    release.resolve(); await shuttingDown;
    expect(calls).toEqual(["ipc", "scheduler-start", "scheduler-joined", "providers", "queue", "web", "agents", "exit"]);
  } finally { release.resolve(); await shuttingDown; exit.mockRestore(); }
});

// Keep the never-settling hook in a child process so the registry's run-once
// state and pending promise cannot affect sibling tests.
test("registered shutdown handler arms its deadline before extensible hooks", async () => {
  const script = `
    import { createShutdownHandler } from './src/runtime/shutdown.js';
    import { registerPreShutdownHook, registerShutdownHandler, requestGracefulShutdown } from './src/runtime/shutdown-registry.js';
    const calls = [];
    const realExit = process.exit, realTimer = globalThis.setTimeout;
    globalThis.setTimeout = (run, ms, ...args) => realTimer(run, ms === 15000 ? 7000 : ms, ...args);
    process.exit = (code) => { console.log(JSON.stringify({ code, calls, elapsed: Date.now() - started })); realExit(code); };
    registerPreShutdownHook(() => new Promise(() => {}));
    registerPreShutdownHook(() => { calls.push('later-hook-started'); });
    const shutdown = createShutdownHandler({
      stopIpcWatcher: async () => calls.push('ipc'),
      stopSchedulerLoop: () => calls.push('scheduler'),
      stopOptionalProviders: () => calls.push('providers'),
      queue: { shutdown: async () => calls.push('queue') },
      agentPool: { shutdown: async () => calls.push('agents') },
      web: { stop: async () => calls.push('web') },
    });
    registerShutdownHandler(shutdown);
    const started = Date.now();
    requestGracefulShutdown('test', 0);
    await Bun.sleep(6200);
    console.log(JSON.stringify({ calls, elapsed: Date.now() - started }));
  `;
  const child = Bun.spawn([process.execPath, "-e", script], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "/tmp", PICLAW_TEST_FS_ISOLATION_ACTIVE: process.env.PICLAW_TEST_FS_ISOLATION_ACTIVE || "", PICLAW_TEST_FS_ISOLATION_ROOT: process.env.PICLAW_TEST_FS_ISOLATION_ROOT || "", PICLAW_WORKSPACE: process.env.PICLAW_WORKSPACE || "", PICLAW_STORE: process.env.PICLAW_STORE || "", PICLAW_DATA: process.env.PICLAW_DATA || "", PICLAW_PI_AGENT_DIR: process.env.PICLAW_PI_AGENT_DIR || "", PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR || "", XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME || "", XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || "", XDG_DATA_HOME: process.env.XDG_DATA_HOME || "", TMPDIR: process.env.TMPDIR || "/tmp", TMP: process.env.TMP || "/tmp", TEMP: process.env.TEMP || "/tmp" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, stderr || stdout).toBe(0);
  const line = stdout.trim().split("\n").find((value) => value.startsWith('{"calls"'));
  expect(line).toBeDefined();
  const result = JSON.parse(line!);
  // Cleanup failure keeps the host backstop armed. It exits without claiming
  // successful disposal; only the test accelerates the requested 15s deadline.
  const forced = JSON.parse(stdout.trim().split("\n").find(value => value.startsWith('{"code"'))!);
  expect(forced.code).toBe(0);
  expect(forced.elapsed).toBeGreaterThanOrEqual(6900);
  expect(forced.elapsed).toBeLessThan(9000);
  expect(result.elapsed).toBeGreaterThanOrEqual(6100);
  expect(result.elapsed).toBeLessThan(7500);
  // Failed pre-shutdown cleanup permits transport disposal but cannot release
  // native model/SSH registrations before confirmed application cleanup.
  expect(result.calls).toEqual(["later-hook-started", "ipc", "scheduler", "providers", "queue", "web"]);
}, 10_000);

test('failed or hung cleanup cannot disarm the operator process deadline', async () => {
  const clear=spyOn(globalThis,'clearTimeout'), exit=spyOn(process,'exit').mockImplementation((()=>{}) as any);
  try{
    const shutdown=createShutdownHandler({web:{sealAdmissions:async()=>{throw Error('wedged harness join');},stop:async()=>{}},
      stopIpcWatcher:()=>{},stopSchedulerLoop:()=>{},stopOptionalProviders:()=>{},queue:{shutdown:async()=>{}},agentPool:{shutdown:async()=>{}}});
    await expect(shutdown('operator restart')).rejects.toThrow('wedged harness join');
    expect(backstops).toHaveLength(1);
    expect(clear).not.toHaveBeenCalledWith(backstops[0]!.handle);
    await shutdown('duplicate operator restart');
    expect(backstops).toHaveLength(1);
    backstops[0]!.run();expect(exit).toHaveBeenCalledWith(0);
  }finally{clear.mockRestore();exit.mockRestore();}
});

for (const fails of [false,true]) test(`native backend ${fails ? "uncertain" : "confirmed"} close gates host registration release without legacy manager ownership`, async () => {
  initDatabase(); const pool=new AgentPool(createAgentPoolModelOptions());
  const bridge=(globalThis as any).__piclawRuntimeInterop, selected=bridge.getModelRegistry;
  const entered=Promise.withResolvers<void>(), close=Promise.withResolvers<void>();
  let closes=0, certificates=0;
  const failure=Error("uncertain native cleanup"), exit=spyOn(process,"exit").mockImplementation((()=>{}) as any);
  const shutdown=createShutdownHandler({stopIpcWatcher:async()=>{},stopSchedulerLoop:()=>{},stopOptionalProviders:()=>{},queue:{shutdown:async()=>{}},agentPool:pool,web:{stop:async()=>{}},
    closeApplicationBackend:async()=>{closes++;entered.resolve();await close.promise;},onShutdownComplete:()=>{certificates++;}});
  const pending=shutdown("test");
  try {
    await entered.promise; expect(bridge.getModelRegistry).toBe(selected); expect(pool).not.toHaveProperty("sessionManager");
    if(fails){
      close.reject(failure);await expect(pending).rejects.toBe(failure);
      expect(bridge.getModelRegistry).toBe(selected);expect(certificates).toBe(0);expect(exit).not.toHaveBeenCalled();
      await shutdown("repeat");expect(closes).toBe(1);expect(bridge.getModelRegistry).toBe(selected);
    }else{
      close.resolve();await pending;expect(bridge.getModelRegistry).toBeUndefined();expect(certificates).toBe(1);expect(exit).toHaveBeenCalledTimes(1);
    }
  }finally{close.resolve();await pending.catch(()=>{});await pool.shutdown();exit.mockRestore();}
});
