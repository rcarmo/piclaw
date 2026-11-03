import { afterEach, expect, test, spyOn } from "bun:test";
import { renameSync, writeFileSync } from "fs";
import { join } from "path";

import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { readDeferredBranchSeed, restoreClaimedDeferredBranchSeed, writeDeferredBranchSeed } from "../../src/agent-pool/branch-seeding.js";
import { ensureSessionDir } from "../../src/agent-pool/session.js";
import { AgentSessionManager } from "../../src/agent-pool/session-manager.js";
import { createTempWorkspace, setEnv, waitFor } from "../helpers.js";

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  cleanupWorkspace?.();
  restoreEnv = null;
  cleanupWorkspace = null;
});

function createRuntime(session: any): AgentSessionRuntime {
  return {
    session,
    cwd: "/workspace",
    diagnostics: [],
    services: {} as any,
    modelFallbackMessage: undefined,
    newSession: async () => ({ cancelled: false }),
    switchSession: async () => ({ cancelled: false }),
    fork: async () => ({ cancelled: false }),
    importFromJsonl: async () => ({ cancelled: false }),
    dispose: async () => {
      session.dispose?.();
    },
  } as any;
}

function createManager(overrides: Record<string, unknown> = {}) {
  const pool = new Map<string, { runtime: any; lastUsed: number }>();
  const state = {
    bound: [] as string[],
    infos: [] as string[],
    warns: [] as string[],
    errors: [] as string[],
  };

  const manager = new AgentSessionManager({
    pool,
    settingsManager: {
      getDefaultProvider: () => null,
      getDefaultModel: () => null,
    } as any,
    createDefaultTools: () => [] as any,
    bindSession: async (_runtime, chatJid) => {
      state.bound.push(chatJid);
    },
    onInfo: (message) => state.infos.push(message),
    onWarn: (message) => state.warns.push(message),
    onError: (message) => state.errors.push(message),
    ...overrides,
  });

  return { manager, pool, state };
}

test("memory reclamation stays blocked through protected runs and asynchronous disposal", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fixture = createManager();
  const runtime = createRuntime({ isStreaming: false, isBashRunning: false, isCompacting: false });
  runtime.dispose = async () => { await gate; };
  fixture.pool.set("web:cleanup", { runtime, lastUsed: Date.now() - 10000 });
  expect(fixture.manager.hasActiveMemoryReclamationWork()).toBe(false);
  const unprotect = fixture.manager.acquireEvictionProtection("web:cleanup");
  expect(fixture.manager.hasActiveMemoryReclamationWork()).toBe(true);
  unprotect();
  runtime.session.isStreaming = true;
  expect(fixture.manager.hasActiveMemoryReclamationWork()).toBe(true);
  runtime.session.isStreaming = false;
  fixture.manager.evictIdle({ mainIdleTtlMs: 1 });
  expect(fixture.manager.hasActiveMemoryReclamationWork()).toBe(true);
  release();
  await waitFor(() => !fixture.manager.hasActiveMemoryReclamationWork());
  expect(fixture.manager.hasActiveMemoryReclamationWork()).toBe(false);
  await fixture.manager.shutdown();
});

test("AgentSessionManager creates, caches, and binds main sessions", async () => {
  let createCalls = 0;
  const session = {
    dispose() {},
  };
  const fixture = createManager({
    createSession: async () => {
      createCalls += 1;
      return createRuntime(session) as any;
    },
  });

  const first = await fixture.manager.getOrCreate("web:default");
  const second = await fixture.manager.getOrCreate("web:default");

  expect(first.session).toBe(session);
  expect(second.session).toBe(session);
  expect(createCalls).toBe(1);
  expect(fixture.state.bound).toEqual(["web:default"]);
  expect(fixture.pool.get("web:default")?.runtime.session).toBe(session);
});

test("AgentSessionManager does not overwrite a restored session model with the default model", async () => {
  const setModel = spyOn({
    setModel: async () => true,
  }, "setModel");
  const session = {
    model: { provider: "anthropic", id: "claude-3-7-sonnet", reasoning: true },
    setModel,
    dispose() {},
  };
  const fixture = createManager({
    settingsManager: {
      getDefaultProvider: () => "openai",
      getDefaultModel: () => "gpt-4.1",
    } as any,
    createSession: async () => createRuntime(session) as any,
  });

  await fixture.manager.getOrCreate("web:default");

  expect(session.model).toEqual({ provider: "anthropic", id: "claude-3-7-sonnet", reasoning: true });
  expect(setModel).not.toHaveBeenCalled();
});

test("AgentSessionManager singleflights concurrent main-session creation for the same chat", async () => {
  let createCalls = 0;
  let releaseCreate!: () => void;
  const waitForCreate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });
  const session = {
    dispose() {},
  };
  const fixture = createManager({
    createSession: async () => {
      createCalls += 1;
      await waitForCreate;
      return createRuntime(session) as any;
    },
  });

  const first = fixture.manager.getOrCreate("web:default");
  const second = fixture.manager.getOrCreate("web:default");
  releaseCreate();

  expect(await first).toBe(await second);
  expect(createCalls).toBe(1);
  expect(fixture.state.bound).toEqual(["web:default"]);
});

test("AgentSessionManager disposes runtime and persistence exactly once across overlapping recreate calls", async () => {
  let runtimeDisposals = 0;
  let persistenceDisposals = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const session = {
    sessionId: "overlap",
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    dispose() {},
  };
  const runtime = createRuntime(session);
  runtime.dispose = async () => { runtimeDisposals += 1; await gate; };
  const fixture = createManager({
    disposePersistence: async () => { persistenceDisposals += 1; },
  });
  fixture.pool.set("web:overlap", { runtime, lastUsed: Date.now() });

  const first = fixture.manager.recreate("web:overlap");
  const second = fixture.manager.recreate("web:overlap");
  await Bun.sleep(0);
  expect(runtimeDisposals).toBe(1);
  release();
  await Promise.all([first, second]);
  expect(runtimeDisposals).toBe(1);
  expect(persistenceDisposals).toBe(1);
});

test("AgentSessionManager recreates cached main sessions", async () => {
  let disposed = 0;
  const mainSession = {
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    dispose() {
      disposed += 1;
    },
  };

  const fixture = createManager();
  fixture.pool.set("web:default", { runtime: createRuntime(mainSession), lastUsed: Date.now() });

  await fixture.manager.recreate("web:default");

  expect(fixture.pool.has("web:default")).toBe(false);
  expect(disposed).toBe(1);
});

test("AgentSessionManager protects pending and in-flight chats from TTL and pool-limit eviction", async () => {
  let disposed = 0;
  const protectedSession = {
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    dispose() { disposed += 1; },
  };
  const otherSession = {
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    dispose() { disposed += 1; },
  };
  const fixture = createManager({ mainSessionMaxSize: 1 });
  fixture.pool.set("web:protected", { runtime: createRuntime(protectedSession), lastUsed: Date.now() - 10_000 });
  fixture.pool.set("web:other", { runtime: createRuntime(otherSession), lastUsed: Date.now() - 10_000 });

  const releaseFirst = fixture.manager.acquireEvictionProtection("web:protected");
  const releaseSecond = fixture.manager.acquireEvictionProtection("web:protected");
  expect(fixture.manager.getInstrumentationSnapshot().evictionProtectedChats).toBe(1);

  // Keep both entries within the TTL window so the max-size path—not TTL—must
  // choose the unprotected candidate.
  fixture.manager.evictIdle({ mainIdleTtlMs: 60_000, mainSessionMaxSizeOverride: 1 });
  expect(fixture.pool.has("web:protected")).toBe(true);
  expect(fixture.pool.has("web:other")).toBe(false);

  releaseFirst();
  fixture.manager.evictIdle({ mainIdleTtlMs: 1, mainSessionMaxSizeOverride: 1 });
  expect(fixture.pool.has("web:protected")).toBe(true);

  releaseSecond();
  expect(fixture.manager.getInstrumentationSnapshot().evictionProtectedChats).toBe(0);
  fixture.pool.get("web:protected")!.lastUsed = Date.now() - 10_000;
  fixture.manager.evictIdle({ mainIdleTtlMs: 1, mainSessionMaxSizeOverride: 1 });
  expect(fixture.pool.has("web:protected")).toBe(false);
  await waitFor(() => disposed === 2);
  expect(disposed).toBe(2);
});

test("AgentSessionManager evicts idle sessions and shuts down remaining sessions", async () => {
  let disposed = 0;
  const oldSession = {
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    dispose() {
      disposed += 1;
    },
  };
  const activeSession = {
    isStreaming: true,
    isBashRunning: false,
    isCompacting: false,
    dispose() {
      disposed += 1;
    },
  };

  const fixture = createManager();
  fixture.pool.set("web:old", { runtime: createRuntime(oldSession), lastUsed: Date.now() - 10_000 });
  fixture.pool.set("web:active", { runtime: createRuntime(activeSession), lastUsed: Date.now() - 10_000 });

  fixture.manager.evictIdle({ mainIdleTtlMs: 1_000 });

  expect(fixture.pool.has("web:old")).toBe(false);
  expect(fixture.pool.has("web:active")).toBe(true);
  await waitFor(() => disposed === 1);
  expect(disposed).toBe(1);

  await fixture.manager.shutdown();
  expect(fixture.pool.size).toBe(0);
  expect(disposed).toBe(2);
});

test("AgentSessionManager keeps main sessions within their idle TTL", async () => {
  let disposed = 0;
  const mainSession = {
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    dispose() {
      disposed += 1;
    },
  };

  const fixture = createManager();
  const lastUsed = Date.now() - 2_000;
  fixture.pool.set("web:main", { runtime: createRuntime(mainSession), lastUsed });

  fixture.manager.evictIdle({ mainIdleTtlMs: 10_000 });

  expect(fixture.pool.has("web:main")).toBe(true);
  expect(disposed).toBe(0);

  await fixture.manager.shutdown();
});

test("AgentSessionManager caps cached main sessions by evicting the oldest idle runtimes", async () => {
  let disposed = 0;
  const fixture = createManager({
    mainSessionMaxSize: 2,
    createSession: async (chatJid: string) => {
      const session = {
        chatJid,
        isStreaming: chatJid === "web:one",
        isBashRunning: false,
        isCompacting: false,
        dispose() {
          disposed += 1;
        },
      };
      return createRuntime(session) as any;
    },
  });

  await fixture.manager.getOrCreate("web:one");
  await Bun.sleep(2);
  await fixture.manager.getOrCreate("web:two");
  await Bun.sleep(2);
  await fixture.manager.getOrCreate("web:three");

  await Bun.sleep(10);

  expect(fixture.pool.has("web:one")).toBe(true);
  expect(fixture.pool.has("web:two")).toBe(false);
  expect(fixture.pool.has("web:three")).toBe(true);
  expect(fixture.pool.size).toBe(2);
  expect(disposed).toBe(1);

  await fixture.manager.shutdown();
});

test("AgentSessionManager lightweight prewarm primes caches without creating a runtime", async () => {
  const lightweight: string[] = [];
  let createCalls = 0;
  const fixture = createManager({
    lightweightPrewarmSession: async (chatJid: string) => {
      lightweight.push(chatJid);
    },
    createSession: async () => {
      createCalls += 1;
      return createRuntime({ dispose() {} }) as any;
    },
  });

  expect(fixture.manager.prewarm("web:recent", { mode: "lightweight" })).toBe(true);
  await Bun.sleep(20);

  expect(lightweight).toEqual(["web:recent"]);
  expect(createCalls).toBe(0);
  expect(fixture.pool.size).toBe(0);

  await fixture.manager.shutdown();
});

test("AgentSessionManager serializes queued prewarms and honors priority ordering", async () => {
  const created: string[] = [];
  let activeCreates = 0;
  let maxConcurrentCreates = 0;

  const fixture = createManager({
    createSession: async (chatJid: string) => {
      created.push(chatJid);
      activeCreates += 1;
      maxConcurrentCreates = Math.max(maxConcurrentCreates, activeCreates);
      await Bun.sleep(10);
      activeCreates -= 1;
      return createRuntime({ dispose() {} }) as any;
    },
  });

  expect(fixture.manager.prewarm("web:older")).toBe(true);
  expect(fixture.manager.prewarm("web:newer")).toBe(true);
  expect(fixture.manager.prewarm("web:priority", { priority: true })).toBe(true);
  expect(fixture.manager.prewarm("web:older")).toBe(false);

  await Bun.sleep(50);

  expect(created).toEqual(["web:older", "web:priority", "web:newer"]);
  expect(maxConcurrentCreates).toBe(1);

  await fixture.manager.shutdown();
});

test("AgentSessionManager fails loudly and clears the cache when a deferred branch seed is invalid", async () => {
  const ws = createTempWorkspace("piclaw-session-manager-invalid-seed-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  let createCalls = 0;
  let disposed = 0;
  const fixture = createManager({
    createSession: async () => {
      createCalls += 1;
      return createRuntime({
        dispose() {
          disposed += 1;
        },
      });
    },
  });

  const chatJid = "web:broken-branch";
  writeFileSync(join(ensureSessionDir(chatJid), ".branch-seed.json"), "{not-json", "utf8");

  await expect(fixture.manager.getOrCreate(chatJid)).rejects.toThrow("Invalid deferred branch seed");
  await expect(fixture.manager.getOrCreate(chatJid)).rejects.toThrow("Invalid deferred branch seed");
  expect(fixture.pool.has(chatJid)).toBe(false);
  expect(createCalls).toBe(1);
  expect(disposed).toBe(1);
  fixture.manager.prewarm(chatJid);
  expect(createCalls).toBe(1);
});

test("AgentSessionManager disposes an existing runtime and restores its deferred seed when realization fails", async () => {
  const ws = createTempWorkspace("piclaw-session-manager-broken-realize-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  let disposed = 0;
  const runtime = createRuntime({
    dispose() {
      disposed += 1;
    },
  });
  runtime.newSession = async () => {
    throw new Error("seed replay failed");
  };

  const fixture = createManager();
  const chatJid = "web:seeded-branch";
  fixture.pool.set(chatJid, { runtime, lastUsed: Date.now() });
  writeFileSync(join(ensureSessionDir(chatJid), ".branch-seed.json"), JSON.stringify({
    version: 1,
    parentSession: null,
    sessionName: "Seeded",
    model: null,
    thinkingLevel: null,
    mode: "rotated_context",
  }), "utf8");

  await expect(fixture.manager.getOrCreate(chatJid)).rejects.toThrow("seed replay failed");
  expect(fixture.pool.has(chatJid)).toBe(false);
  expect(disposed).toBe(1);
  expect(readDeferredBranchSeed(chatJid)?.sessionName).toBe("Seeded");
});

test("AgentSessionManager clears cached invalid-seed errors after the seed file is rewritten", async () => {
  const ws = createTempWorkspace("piclaw-session-manager-invalid-seed-rewrite-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  let createCalls = 0;
  const fixture = createManager({
    createSession: async (_chatJid: string, sessionDir: string) => {
      createCalls += 1;
      return createRuntime({
        sessionFile: join(sessionDir, "session.jsonl"),
        sessionManager: {
          getHeader: () => ({ type: "session_header" }),
          getEntries: () => [],
        },
        setSessionName() {},
        dispose() {},
      });
    },
  });

  const chatJid = "web:rewritten-branch";
  writeFileSync(join(ensureSessionDir(chatJid), ".branch-seed.json"), "{not-json", "utf8");
  await expect(fixture.manager.getOrCreate(chatJid)).rejects.toThrow("Invalid deferred branch seed");

  writeDeferredBranchSeed(chatJid, {
    version: 1,
    parentSession: null,
    sessionName: "Recovered",
    model: null,
    thinkingLevel: null,
    mode: "rotated_context",
  });

  await expect(fixture.manager.getOrCreate(chatJid)).resolves.toBeTruthy();
  expect(createCalls).toBe(2);
});

test("AgentSessionManager disposes a broken existing runtime only once across concurrent callers", async () => {
  const ws = createTempWorkspace("piclaw-session-manager-single-dispose-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  let disposed = 0;
  const runtime = createRuntime({
    dispose() {
      disposed += 1;
    },
  });
  runtime.newSession = async () => {
    throw new Error("seed replay failed");
  };

  const fixture = createManager();
  const chatJid = "web:concurrent-broken-branch";
  fixture.pool.set(chatJid, { runtime, lastUsed: Date.now() });
  writeDeferredBranchSeed(chatJid, {
    version: 1,
    parentSession: null,
    sessionName: "Broken",
    model: null,
    thinkingLevel: null,
    mode: "rotated_context",
  });

  const [first, second] = await Promise.allSettled([
    fixture.manager.getOrCreate(chatJid),
    fixture.manager.getOrCreate(chatJid),
  ]);

  expect(first.status).toBe("rejected");
  expect(second.status).toBe("rejected");
  expect(disposed).toBe(1);
});

test("AgentSessionManager priority prewarms bypass the recent-chat cooldown and prune expired entries", async () => {
  const fixture = createManager({
    createSession: async () => createRuntime({ dispose() {} }),
  });
  const originalDateNow = Date.now;
  Date.now = () => 100_000;

  try {
    (fixture.manager as any).prewarmCooldownByChat.set("web:recent", 99_500);
    expect(fixture.manager.prewarm("web:recent")).toBe(false);
    expect(fixture.manager.prewarm("web:recent", { priority: true })).toBe(true);

    (fixture.manager as any).queuedPrewarms.clear();
    (fixture.manager as any).prewarmQueue.length = 0;
    (fixture.manager as any).prewarmCooldownByChat.set("web:stale", 69_000);
    expect(fixture.manager.prewarm("web:fresh")).toBe(true);
    expect((fixture.manager as any).prewarmCooldownByChat.has("web:stale")).toBe(false);
  } finally {
    Date.now = originalDateNow;
    await fixture.manager.shutdown();
  }
});

test("AgentSessionManager rejects new prewarms once shutdown starts", async () => {
  const fixture = createManager({
    createSession: async () => createRuntime({ dispose() {} }),
  });

  await fixture.manager.shutdown();
  expect(fixture.manager.prewarm("web:after-shutdown")).toBe(false);
});

test("AgentSessionManager does not retain a prewarm-created runtime when shutdown starts mid-create", async () => {
  let disposed = 0;
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => {
    releaseCreate = resolve;
  });

  const fixture = createManager({
    createSession: async () => {
      await createGate;
      return createRuntime({
        dispose() {
          disposed += 1;
        },
      }) as any;
    },
  });

  expect(fixture.manager.prewarm("web:shutdown-race")).toBe(true);
  await Bun.sleep(10);
  let shutdownCompleted = false;
  const shutdown = fixture.manager.shutdown().then(() => { shutdownCompleted = true; });
  await Bun.sleep(0);
  expect(shutdownCompleted).toBe(false);
  expect(disposed).toBe(0);
  releaseCreate();
  await shutdown;
  await waitFor(() => disposed === 1, 1_000, 10);

  expect(fixture.pool.has("web:shutdown-race")).toBe(false);
  expect(disposed).toBe(1);
});

test("restoreClaimedDeferredBranchSeed preserves a newer primary seed written after claim", () => {
  const ws = createTempWorkspace("piclaw-restore-claimed-seed-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const chatJid = "web:claimed-seed";
  const sessionDir = ensureSessionDir(chatJid);
  const primaryPath = join(sessionDir, ".branch-seed.json");
  const claimedPath = join(sessionDir, ".branch-seed.claimed.json");

  writeDeferredBranchSeed(chatJid, {
    version: 1,
    parentSession: null,
    sessionName: "Older",
    model: null,
    thinkingLevel: null,
    mode: "rotated_context",
  });
  renameSync(primaryPath, claimedPath);
  writeDeferredBranchSeed(chatJid, {
    version: 1,
    parentSession: null,
    sessionName: "Newer",
    model: null,
    thinkingLevel: null,
    mode: "rotated_context",
  });

  restoreClaimedDeferredBranchSeed(chatJid);

  expect(readDeferredBranchSeed(chatJid)?.sessionName).toBe("Newer");
});

test('held provider startup does not prevent another chat from creating or binding',async()=>{
 for(const stage of ['create','bind']){
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
  const fixture=createManager({createSession:async(chatJid:string)=>{if(stage==='create'&&chatJid==='web:slow'){entered();await held;}return createRuntime({isStreaming:false} as AgentSession) as any;},bindSession:async(_runtime:any,chatJid:string)=>{if(stage==='bind'&&chatJid==='web:slow'){entered();await held;}}});
  const slow=fixture.manager.getOrCreate('web:slow');await started;
  const fast=await Promise.race([fixture.manager.getOrCreate('web:fast'),new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('unrelated chat blocked')),250))]);
  expect(fast).toBeDefined();expect(fixture.pool.has('web:fast')).toBe(true);release();await slow;
 }
});

test('streaming slow provider remains cached without blocking a new chat',async()=>{
 const slow=createRuntime({isStreaming:true} as AgentSession);const fixture=createManager({createSession:async()=>createRuntime({isStreaming:false} as AgentSession) as any});
 fixture.pool.set('web:slow',{runtime:slow,lastUsed:0});fixture.manager.acquireEvictionProtection('web:slow');
 const fast=await fixture.manager.getOrCreate('web:fast');expect(fast).toBeDefined();expect(fixture.pool.get('web:slow')?.runtime).toBe(slow);
});

test('manager protects an incompletely bound runtime until actual startup settles',async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});let disposed=0;
 const runtime=createRuntime({isStreaming:false} as AgentSession);runtime.dispose=async()=>{disposed++;};
 const fixture=createManager({createSession:async()=>runtime as any,bindSession:async()=>{entered();await held;}});
 const pending=fixture.manager.getOrCreate('web:binding');await started;expect(fixture.manager.hasProtectedRun('web:binding')).toBe(true);fixture.pool.get('web:binding')!.lastUsed=Date.now()-10000;await fixture.manager.evictIdle({mainIdleTtlMs:1,mainSessionMaxSizeOverride:0});expect(disposed).toBe(0);release();await pending;expect(fixture.manager.hasProtectedRun('web:binding')).toBe(false);
});
