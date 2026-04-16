import { expect, test } from "bun:test";

import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
import { AgentSessionManager } from "../../src/agent-pool/session-manager.js";

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
