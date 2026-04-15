import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { join } from "path";

import type { AgentSessionRuntime } from "@mariozechner/pi-coding-agent";
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
