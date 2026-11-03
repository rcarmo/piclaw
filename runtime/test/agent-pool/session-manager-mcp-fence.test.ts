import { expect, test } from "bun:test";
import type { AgentSession, AgentSessionRuntime, ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { AgentSessionManager, type PoolEntry } from "../../src/agent-pool/session-manager.js";
import { createTempWorkspace, setEnv } from "../helpers.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
function runtime(id: string, dispose: () => Promise<void> = async () => {}) {
  return { session: { model: { provider: "fixture", id: "model" }, sessionId: id }, dispose } as unknown as AgentSessionRuntime;
}
function fixture(options: { createSession?: () => Promise<AgentSessionRuntime>; bindSession?: () => Promise<void> } = {}) {
  const ws = createTempWorkspace("session-mcp-fence-");
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const pool = new Map<string, PoolEntry>();
  const manager = new AgentSessionManager({ pool, modelRuntime: { getAvailableModels: () => [] } as unknown as ModelRuntime,
    settingsManager: { getDefaultProvider: () => undefined, getDefaultModel: () => undefined } as unknown as SettingsManager,
    createDefaultTools: () => [], bindSession: options.bindSession ?? (async () => {}),
    createSession: options.createSession });
  return { manager, pool, cleanup: () => { restore(); ws.cleanup(); } };
}

test("manager fence rejects cached/new main admissions and prevents prewarm/eviction", async () => {
  const f = fixture();
  const main = runtime("main");
  try {
    f.pool.set("web:main", { runtime: main, lastUsed: 1 });
    f.manager.blockMcpAdmissions();
    await expect(f.manager.getOrCreate("web:main")).rejects.toThrow("MCP engine transition");
    await expect(f.manager.getOrCreate("web:new")).rejects.toThrow("MCP engine transition");
    expect(f.manager.prewarm("web:new", { priority: true })).toBe(false);
    f.manager.evictIdle({ mainIdleTtlMs: 0 });
    expect(f.pool.size).toBe(1);
    expect(await f.manager.fenceMcpAndSnapshot(new AbortController().signal)).toEqual([main]);
    f.manager.resumeMcpAdmissions();
    expect(await f.manager.getOrCreate("web:main")).toBe(main);
  } finally { f.cleanup(); }
});

for (const kind of ["main"] as const) {
  test(`fence drains and discards ${kind} creation begun before selection`, async () => {
    const pending = deferred<AgentSessionRuntime>(), entered = deferred<void>();
    let disposed = 0;
    const late = runtime("late", async () => { disposed++; });
    const create = async () => { entered.resolve(); return pending.promise; };
    const f = fixture({ createSession: create });
    try {
      const admitted = f.manager.getOrCreate("web:late").catch(error => error);
      await entered.promise;
      let snapshotted = false;
      const snapshot = f.manager.fenceMcpAndSnapshot(new AbortController().signal).then(value => { snapshotted = true; return value; });
      await Bun.sleep(0); expect(snapshotted).toBe(false);
      pending.resolve(late);
      expect(await admitted).toBeInstanceOf(Error);
      expect(await snapshot).toEqual([]); expect(disposed).toBe(1);
      expect(f.pool.size).toBe(0);
      f.manager.resumeMcpAdmissions();
    } finally { f.cleanup(); }
  });
}

test("fence includes cached main runtimes once even when aliases share identity", async () => {
  const f = fixture(), shared = runtime("shared");
  try {
    f.pool.set("web:a", { runtime: shared, lastUsed: 1 }); f.pool.set("web:alias", { runtime: shared, lastUsed: 1 });
    expect(await f.manager.fenceMcpAndSnapshot(new AbortController().signal)).toEqual([shared]);
  } finally { f.cleanup(); }
});

test("snapshot cancellation remains fenced and late creation is disposed without publication", async () => {
  const pending = deferred<AgentSessionRuntime>(), entered = deferred<void>();
  let disposed = 0;
  const f = fixture({ createSession: async () => { entered.resolve(); return pending.promise; } });
  try {
    const creation = f.manager.getOrCreate("web:late").catch(error => error);
    await entered.promise;
    const controller = new AbortController();
    const snapshot = f.manager.fenceMcpAndSnapshot(controller.signal);
    controller.abort();
    await expect(snapshot).rejects.toThrow("cancelled");
    expect(() => f.manager.assertMcpAdmission()).toThrow("blocked");
    pending.resolve(runtime("late", async () => { disposed++; }));
    expect(await creation).toBeInstanceOf(Error); expect(disposed).toBe(1); expect(f.pool.size).toBe(0);
  } finally { f.cleanup(); }
});

test("old creation is invalidated and reopening is refused until it has drained", async () => {
  const pending = deferred<AgentSessionRuntime>(), entered = deferred<void>();
  let disposed = 0;
  const f = fixture({ createSession: async () => { entered.resolve(); return pending.promise; } });
  try {
    const creation = f.manager.getOrCreate("web:old").catch(error => error);
    await entered.promise;
    f.manager.blockMcpAdmissions();
    expect(() => f.manager.resumeMcpAdmissions()).toThrow("not drained");
    pending.resolve(runtime("old", async () => { disposed++; }));
    expect(await creation).toBeInstanceOf(Error); expect(disposed).toBe(1); expect(f.pool.size).toBe(0);
    f.manager.resumeMcpAdmissions();
    expect(() => f.manager.assertMcpAdmission()).not.toThrow();
  } finally { f.cleanup(); }
});

test("quarantine removes only captured runtime generation and deduplicates concurrent teardown", async () => {
  const release = deferred<void>(), entered = deferred<void>(); let disposed = 0;
  const old = runtime("old", async () => { disposed++; entered.resolve(); await release.promise; });
  const newer = runtime("new");
  const f = fixture();
  try {
    f.pool.set("web:same", { runtime: newer, lastUsed: 1 }); f.pool.set("web:old", { runtime: old, lastUsed: 1 });
    f.manager.blockMcpAdmissions();
    const first = f.manager.quarantineMcpRuntime(old), second = f.manager.quarantineMcpRuntime(old);
    expect(f.pool.get("web:same")?.runtime).toBe(newer); expect(f.pool.has("web:old")).toBe(false);
    await entered.promise; expect(disposed).toBe(1);
    release.resolve(); await Promise.all([first, second]);
    expect(disposed).toBe(1);
  } finally { f.cleanup(); }
});

test("fenced manager rejects runtime recreation before lifecycle work", async () => {
  const f = fixture();
  try {
    f.manager.blockMcpAdmissions();
    await expect(f.manager.recreate("web:any")).rejects.toThrow("blocked");
  } finally { f.cleanup(); }
});

test("lightweight prewarm already in flight is drained by the snapshot", async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const f = fixture();
  try {
    // This variant creates no session, but extension-factory discovery must
    // still finish before the fenced owner snapshot is considered stable.
    const manager = new AgentSessionManager({ pool: f.pool, modelRuntime: {} as ModelRuntime, settingsManager: {} as SettingsManager, createDefaultTools: () => [], bindSession: async () => {},
      lightweightPrewarmSession: async () => { entered.resolve(); await release.promise; } });
    expect(manager.prewarm("web:light", { mode: "lightweight" })).toBe(true);
    await entered.promise;
    let settled = false;
    const snapshot = manager.fenceMcpAndSnapshot(new AbortController().signal).then(value => { settled = true; return value; });
    await Bun.sleep(0); expect(settled).toBe(false);
    release.resolve(); expect(await snapshot).toEqual([]);
  } finally { f.cleanup(); }
});

test("public runtime rebinding is rejected while fenced and pre-fence binding is drained", async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const f = fixture({ bindSession: async () => { entered.resolve(); await release.promise; } });
  const current = runtime("bind");
  try {
    f.pool.set("web:bind", { runtime: current, lastUsed: 1 });
    const binding = f.manager.refreshRuntime("web:bind", current).catch(error => error);
    await entered.promise;
    let settled = false;
    const snapshot = f.manager.fenceMcpAndSnapshot(new AbortController().signal).then(value => { settled = true; return value; });
    await expect(f.manager.refreshRuntime("web:bind", current)).rejects.toThrow("blocked");
    await Bun.sleep(0); expect(settled).toBe(false);
    release.resolve(); expect(await binding).toBeInstanceOf(Error);
    expect(await snapshot).toEqual([current]);
  } finally { f.cleanup(); }
});

test("shutdown closes admission and is drained before an MCP snapshot", async () => {
  const release = deferred<void>(); let disposed = 0;
  const f = fixture();
  try {
    f.pool.set("web:shutdown", { runtime: runtime("shutdown", async () => { disposed++; await release.promise; }), lastUsed: 1 });
    const shutdown = f.manager.shutdown();
    await expect(f.manager.getOrCreate("web:shutdown")).rejects.toThrow("blocked");
    let settled = false;
    const snapshot = f.manager.fenceMcpAndSnapshot(new AbortController().signal).then(value => { settled = true; return value; });
    await Bun.sleep(0); expect(settled).toBe(false); expect(disposed).toBe(1);
    release.resolve(); await shutdown;
    expect(await snapshot).toEqual([]);
    expect(() => f.manager.resumeMcpAdmissions()).toThrow("shutting down");
  } finally { f.cleanup(); }
});

test("sequential quarantine tears down a late-rebuilt captured runtime again", async () => {
  let disposed = 0;
  const f = fixture(), captured = runtime("late-reload", async () => { disposed++; });
  try {
    await f.manager.quarantineMcpRuntime(captured);
    await f.manager.quarantineMcpRuntime(captured);
    expect(disposed).toBe(2);
  } finally { f.cleanup(); }
});

test("shutdown beginning after fence capture is drained before the returned snapshot", async () => {
  const entered = deferred<void>(), bindRelease = deferred<void>(), disposeRelease = deferred<void>();
  let disposed = 0;
  const f = fixture({ bindSession: async () => { entered.resolve(); await bindRelease.promise; } });
  const captured = runtime("captured", async () => { disposed++; await disposeRelease.promise; });
  try {
    f.pool.set("web:captured", { runtime: captured, lastUsed: 1 });
    const binding = f.manager.refreshRuntime("web:captured", captured).catch(error => error);
    await entered.promise;
    let settled = false;
    const snapshot = f.manager.fenceMcpAndSnapshot(new AbortController().signal).then(value => { settled = true; return value; });
    const shutdown = f.manager.shutdown();
    await Bun.sleep(0); expect(disposed).toBe(0);
    bindRelease.resolve(); expect(await binding).toBeInstanceOf(Error);
    await Bun.sleep(0); expect(disposed).toBe(1); expect(settled).toBe(false);
    disposeRelease.resolve(); await shutdown; expect(await snapshot).toEqual([]);
  } finally { f.cleanup(); }
});

test("resume cannot reopen during snapshot or pending pre-fence work after cancellation", async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const f = fixture({ createSession: async () => { entered.resolve(); await release.promise; return runtime("late"); } });
  try {
    const creation = f.manager.getOrCreate("web:late").catch(error => error); await entered.promise;
    const controller = new AbortController(); const snapshot = f.manager.fenceMcpAndSnapshot(controller.signal);
    expect(() => f.manager.resumeMcpAdmissions()).toThrow("not drained");
    controller.abort(); await expect(snapshot).rejects.toThrow("cancelled");
    expect(() => f.manager.resumeMcpAdmissions()).toThrow("not drained");
    release.resolve(); expect(await creation).toBeInstanceOf(Error);
    f.manager.resumeMcpAdmissions(); expect(() => f.manager.assertMcpAdmission()).not.toThrow();
  } finally { f.cleanup(); }
});

test("a second snapshot cannot overlap the transition participant enumeration", async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const f = fixture({ createSession: async () => { entered.resolve(); await release.promise; return runtime("late"); } });
  try {
    const creation = f.manager.getOrCreate("web:late").catch(error => error); await entered.promise;
    const snapshot = f.manager.fenceMcpAndSnapshot(new AbortController().signal);
    await expect(f.manager.fenceMcpAndSnapshot(new AbortController().signal)).rejects.toThrow("already in progress");
    release.resolve(); await creation; expect(await snapshot).toEqual([]);
  } finally { f.cleanup(); }
});

test("lifecycle binding rejects re-entrant shutdown and snapshot instead of deadlocking", async () => {
  const f = fixture();
  try {
    const manager = new AgentSessionManager({ pool: f.pool, modelRuntime: {} as ModelRuntime, settingsManager: {} as SettingsManager,
      createDefaultTools: () => [], bindSession: async () => {
        await expect(manager.shutdown()).rejects.toThrow("callbacks cannot await");
        await expect(manager.fenceMcpAndSnapshot(new AbortController().signal)).rejects.toThrow("callbacks cannot await");
      } });
    const current = runtime("binding");
    f.pool.set("web:binding", { runtime: current, lastUsed: 1 });
    await manager.refreshRuntime("web:binding", current);
    expect(() => manager.assertMcpAdmission()).not.toThrow();
    expect(await manager.fenceMcpAndSnapshot(new AbortController().signal)).toEqual([current]);
  } finally { f.cleanup(); }
});

test("shutdown disposal callback cannot recursively await its enclosing shutdown", async () => {
  const f = fixture(); let disposed = 0;
  try {
    const current = runtime("reentrant-disposal", async () => {
      await expect(f.manager.shutdown()).rejects.toThrow("callbacks cannot await");
      disposed++;
    });
    f.pool.set("web:reentrant", { runtime: current, lastUsed: 1 });
    await Promise.all([f.manager.shutdown(), f.manager.shutdown()]);
    expect(disposed).toBe(1); expect(f.pool.size).toBe(0);
  } finally { f.cleanup(); }
});

test("complete cached-main admission cleanup stays tracked until its disposal tail ends", async () => {
  const entered = deferred<void>(), release = deferred<void>();
  const f = fixture();
  try {
    const current = runtime("cached", async () => { entered.resolve(); await release.promise; });
    f.pool.set("web:cached", { runtime: current, lastUsed: 1 });
    const admission = f.manager.getOrCreate("web:cached").catch(error => error);
    // Enter the admitted cached path, then invalidate its epoch at its await.
    await Promise.resolve();
    f.manager.blockMcpAdmissions();
    await entered.promise;
    let completed = false;
    const snapshot = f.manager.fenceMcpAndSnapshot(new AbortController().signal).then(value => { completed = true; return value; });
    await Bun.sleep(0); expect(completed).toBe(false);
    expect(() => f.manager.resumeMcpAdmissions()).toThrow("not drained");
    release.resolve(); expect(await admission).toBeInstanceOf(Error);
    expect(await snapshot).toEqual([]); f.manager.resumeMcpAdmissions();
  } finally { f.cleanup(); }
});



test("disposal tracking is installed before callbacks and recursive quarantine is rejected", async () => {
  const f = fixture(); let pendingObserved = false, disposed = 0;
  try {
    const captured = runtime("tracking", async () => {
      pendingObserved = f.manager.hasPendingSessionWork("web:tracking");
      await expect(f.manager.quarantineMcpRuntime(captured)).rejects.toThrow("callbacks cannot await");
      disposed++;
    });
    f.pool.set("web:tracking", { runtime: captured, lastUsed: 1 });
    await f.manager.recreate("web:tracking");
    expect(pendingObserved).toBe(true); expect(disposed).toBe(1);
    expect(f.manager.hasPendingSessionWork("web:tracking")).toBe(false);
  } finally { f.cleanup(); }
});

test("creation and binding callbacks cannot re-enter same-manager admission or recreation", async () => {
  const f = fixture(); let guarded = 0;
  try {
    const manager = new AgentSessionManager({ pool: f.pool, modelRuntime: {} as ModelRuntime,
      settingsManager: { getDefaultProvider: () => undefined, getDefaultModel: () => undefined } as unknown as SettingsManager,
      createDefaultTools: () => [], createSession: async () => {
        await expect(manager.getOrCreate("web:reentrant")).rejects.toThrow("callbacks cannot await");
        guarded += 2; return runtime("reentrant");
      }, bindSession: async current => {
        await expect(manager.recreate("web:reentrant")).rejects.toThrow("callbacks cannot await");
        await expect(manager.refreshRuntime("web:reentrant", current)).rejects.toThrow("callbacks cannot await");
        guarded += 2;
      } });
    const created = await manager.getOrCreate("web:reentrant");
    expect(guarded).toBe(4); expect(f.pool.get("web:reentrant")?.runtime).toBe(created);
  } finally { f.cleanup(); }
});

test("disposal callback cannot wait for admission fenced by its own teardown", async () => {
  const f = fixture(); let completed = false;
  try {
    f.pool.set("web:dispose-admit", { runtime: runtime("dispose-admit", async () => {
      await expect(f.manager.getOrCreate("web:dispose-admit")).rejects.toThrow("callbacks cannot await"); completed = true;
    }), lastUsed: 1 });
    await f.manager.recreate("web:dispose-admit"); expect(completed).toBe(true);
  } finally { f.cleanup(); }
});

for (const kind of ["main"] as const) {
  test(`failed ${kind} recreation disposal blocks admission/snapshot until explicit quarantine retry`, async () => {
    let fail = true, disposals = 0;
    const captured = runtime(`failed-${kind}`, async () => { disposals++; if (fail) throw new Error("PRIVATE-DISPOSE-SENTINEL"); });
    const f = fixture();
    try {
      f.pool.set("web:failure", { runtime: captured, lastUsed: 1 });
      await expect(f.manager.recreate("web:failure")).rejects.toThrow("admissions remain blocked");
      await expect(f.manager.getOrCreate("web:failure")).rejects.toThrow("blocked");
      await expect(f.manager.fenceMcpAndSnapshot(new AbortController().signal)).rejects.toThrow("unresolved");
      expect(() => f.manager.resumeMcpAdmissions()).toThrow("unresolved");
      fail = false; await f.manager.quarantineMcpRuntime(captured);
      expect(disposals).toBe(2); expect(await f.manager.fenceMcpAndSnapshot(new AbortController().signal)).toEqual([]);
      f.manager.resumeMcpAdmissions(); expect(() => f.manager.assertMcpAdmission()).not.toThrow();
    } finally { f.cleanup(); }
  });
}

test("failed idle disposal is observed and keeps the instance fenced", async () => {
  const f = fixture(); const entered = deferred<void>();
  try {
    f.pool.set("web:idle-failure", { runtime: runtime("idle-failure", async () => { entered.resolve(); throw new Error("failure"); }), lastUsed: 1 });
    f.manager.evictIdle({ mainIdleTtlMs: 0 }); await entered.promise; await Bun.sleep(0);
    expect(() => f.manager.assertMcpAdmission()).toThrow("blocked");
    await expect(f.manager.fenceMcpAndSnapshot(new AbortController().signal)).rejects.toThrow("unresolved");
  } finally { f.cleanup(); }
});

test("shutdown failure remains fenced and does not report successful cleanup", async () => {
  const f = fixture();
  try {
    f.pool.set("web:shutdown-failure", { runtime: runtime("shutdown-failure", async () => { throw new Error("failure"); }), lastUsed: 1 });
    await expect(f.manager.shutdown()).rejects.toThrow("admissions remain blocked");
    expect(() => f.manager.assertMcpAdmission()).toThrow("blocked");
    expect(() => f.manager.resumeMcpAdmissions()).toThrow("shutting down");
  } finally { f.cleanup(); }
});

test("direct quarantine is drained by snapshot and blocks resume through its disposal tail", async () => {
  const release = deferred<void>(), entered = deferred<void>();
  const f = fixture();
  try {
    const captured = runtime("quarantine-tail", async () => {
      expect(() => f.manager.resumeMcpAdmissions()).toThrow("callbacks cannot await");
      entered.resolve(); await release.promise;
    });
    f.pool.set("web:quarantine", { runtime: captured, lastUsed: 1 });
    f.manager.blockMcpAdmissions();
    const quarantine = f.manager.quarantineMcpRuntime(captured);
    expect(() => f.manager.resumeMcpAdmissions()).toThrow("not drained");
    await entered.promise;
    let completed = false;
    const snapshot = f.manager.fenceMcpAndSnapshot(new AbortController().signal).then(value => { completed = true; return value; });
    await Bun.sleep(0); expect(completed).toBe(false);
    release.resolve(); await quarantine; expect(await snapshot).toEqual([]);
    f.manager.resumeMcpAdmissions(); expect(() => f.manager.assertMcpAdmission()).not.toThrow();
  } finally { f.cleanup(); }
});
