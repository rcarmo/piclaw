import { afterEach, expect, test } from "bun:test";
import { renameSync, writeFileSync } from "fs";
import { join } from "path";

import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import { readDeferredBranchSeed, restoreClaimedDeferredBranchSeed, writeDeferredBranchSeed } from "../../src/agent-pool/branch-seeding.js";
import { ensureSessionDir } from "../../src/agent-pool/session.js";
import { AgentSessionManager } from "../../src/agent-pool/session-manager.js";
import { createTempWorkspace, setEnv } from "../helpers.js";

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
  const sidePool = new Map<string, { runtime: any; lastUsed: number }>();
  const state = {
    bound: [] as string[],
    registered: [] as string[],
    infos: [] as string[],
    warns: [] as string[],
    errors: [] as string[],
  };

  const manager = new AgentSessionManager({
    pool,
    sidePool,
    authStorage: {} as any,
    modelRegistry: { find: () => undefined } as any,
    settingsManager: {
      getDefaultProvider: () => null,
      getDefaultModel: () => null,
    } as any,
    createDefaultTools: () => [] as any,
    bindSession: async (_runtime, chatJid) => {
      state.bound.push(chatJid);
    },
    ensureBranchRegistration: (chatJid) => {
      state.registered.push(chatJid);
    },
    onInfo: (message) => state.infos.push(message),
    onWarn: (message) => state.warns.push(message),
    onError: (message) => state.errors.push(message),
    ...overrides,
  });

  return { manager, pool, sidePool, state };
}

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
  expect(fixture.state.registered).toEqual(["web:default"]);
  expect(fixture.pool.get("web:default")?.runtime.session).toBe(session);
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

test("AgentSessionManager recreates cached main and side sessions", async () => {
  let disposed = 0;
  const mainSession = {
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    dispose() {
      disposed += 1;
    },
  };
  const sideSession = {
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    dispose() {
      disposed += 1;
    },
  };

  const fixture = createManager();
  fixture.pool.set("web:default", { runtime: createRuntime(mainSession), lastUsed: Date.now() });
  fixture.sidePool.set("web:default", { runtime: createRuntime(sideSession), lastUsed: Date.now() });

  await fixture.manager.recreate("web:default");

  expect(fixture.pool.has("web:default")).toBe(false);
  expect(fixture.sidePool.has("web:default")).toBe(false);
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

  fixture.manager.evictIdle(1_000);

  expect(fixture.pool.has("web:old")).toBe(false);
  expect(fixture.pool.has("web:active")).toBe(true);
  expect(disposed).toBe(1);

  await fixture.manager.shutdown();
  expect(fixture.pool.size).toBe(0);
  expect(fixture.sidePool.size).toBe(0);
  expect(disposed).toBe(2);
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
