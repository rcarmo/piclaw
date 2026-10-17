import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { SESSIONS_DIR } from "../../src/core/config.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/runtime.js";
import { acquireRuntimeLock } from "../../src/runtime/single-instance.js";
import { createShutdownHandler } from "../../src/runtime/shutdown.js";
import * as shutdownRegistry from "../../src/runtime/shutdown-registry.js";
import {
  bootstrapRuntime,
  createDefaultRuntimeBootstrapDeps,
  type RuntimeBootstrapAgentPool,
  type RuntimeBootstrapDeps,
  type RuntimeBootstrapPushover,
  type RuntimeBootstrapQueue,
  type RuntimeBootstrapState,
  type RuntimeBootstrapWeb,
  type RuntimeBootstrapDefaultBaseServices,
} from "../../src/runtime/bootstrap.js";
import type { RuntimeSenders } from "../../src/runtime/wiring.js";
import { AgentPool } from "../../src/agent-pool.js";
import { AgentQueue } from "../../src/queue.js";
import { WebChannel } from "../../src/channels/web.js";
import { initDatabase, getDb } from "../../src/db/connection.js";
import { createAgentPoolModelOptions } from "../model-services-fixture.js";
import type { RuntimeBootstrapContext } from "../../src/runtime/bootstrap.js";
import { getChatTransport, registerChatTransport, setLocalChatTransport } from "../../src/extensions/chat-transport-registry.js";

function bootstrapDepsForFailure(overrides: Partial<RuntimeBootstrapDeps> = {}): RuntimeBootstrapDeps {
  const queue = { shutdown: async () => {} } as RuntimeBootstrapQueue;
  const agentPool = { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool;
  const web = { stop: async () => {} } as RuntimeBootstrapWeb;
  return {
    base: { queue, state: {} as RuntimeBootstrapState },
    assistantName: "Pi",
    triggerPattern: /@pi/i,
    pollIntervalMs: 1,
    signalRegistrar: { on: () => {} },
    initializeRuntimeEnvironment: () => {},
    hydrateMcpCredentials: async () => [{ serverName: "mcp", envName: "PICLAW_MCP_SECRET", keychainName: "mcp/test" }],
    clearMcpCredentials: () => {},
    createAgentPool: async () => agentPool,
    startWebChannel: async () => web,
    startBackgroundModelRefresh: () => {},
    startOptionalPushoverChannel: async () => null,
    createShutdownHandler: () => async () => {},
    registerRuntimeShutdownSignals: () => {},
    createRuntimeSenders: () => ({ sendMessage: async () => {}, sendNudge: async () => {} }),
    startRuntimeWorkers: () => {},
    queueStartupResumePendingIpc: () => {},
    startRuntimeLoop: async () => {},
    log: () => {},
    stopIpcWatcher: async () => {},
    stopSchedulerLoop: () => {},
    stopOptionalProviders: () => {},
    ...overrides,
  };
}

describe("runtime bootstrap", () => {
  test("migration inspection refuses legacy ownership before any stop or seal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "migration-legacy-"));
    const owner = acquireRuntimeLock({ lockPath: join(dir, "owner"), strictOwnership: false });
    let context!: RuntimeBootstrapContext;
    let stops = 0;
    try {
      await bootstrapRuntime(bootstrapDepsForFailure({
        migrationInspection: { onReady: value => { context = value; } },
        stopIpcWatcher: async () => { stops++; },
        stopSchedulerLoop: () => { stops++; },
      }), owner);
      await expect(context.prepareLegacyMigration("next")).rejects.toThrow("Strict runtime owner");
      expect(stops).toBe(0);
    } finally { owner.release(); rmSync(dir, { recursive: true, force: true }); }
  });

  for (const scenario of ["drain", "stale-owner", "unread", "nonterminal", "pending"] as const) test(`actual bootstrap migration ${scenario}: installed handles and retained lifetime`, async () => {
    initDatabase();
    getDb().exec("DELETE FROM messages; DELETE FROM chat_cursors; DELETE FROM service_effect_s01_operations; DELETE FROM service_effect_s01_sources; DELETE FROM service_effect_s01_chats;");
    const dir = mkdtempSync(join(tmpdir(), "migration-runtime-"));
    const owner = acquireRuntimeLock({ lockPath: join(dir, "owner"), strictOwnership: true });
    const queue = new AgentQueue();
    const pool = new AgentPool(createAgentPoolModelOptions());
    const web = new WebChannel({ queue, agentPool: pool });
    const producer = Promise.withResolvers<void>(), task = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<RuntimeBootstrapContext>();
    let complete!: () => void;
    let returned = false, queued = false;
    const running = bootstrapRuntime(bootstrapDepsForFailure({
      base: { queue, state: { lastTimestamp: "" } as RuntimeBootstrapState },
      createAgentPool: async () => pool,
      startWebChannel: async () => web,
      createShutdownHandler: deps => { complete = deps.onShutdownComplete!; return async () => {}; },
      migrationInspection: { onReady: value => ready.resolve(value) },
      startRuntimeLoop: async deps => { await new Promise<void>(resolve => deps.signal!.addEventListener("abort", () => resolve(), { once: true })); },
      stopSchedulerLoop: async () => { await producer.promise; queue.enqueueTask("accepted", async () => { await task.promise; queued = true; }); },
    }), owner).then(() => { returned = true; });
    try {
      const context = await ready.promise;
      const preparing = context.prepareLegacyMigration("trusted-next-writer");
      expect(context.prepareLegacyMigration("ignored")).toBe(preparing);
      await expect(web.runInternalDispatch(() => {})).rejects.toThrow("sealed");
      expect(returned).toBe(false);
      producer.resolve();
      await Promise.resolve();
      task.resolve();
      if (scenario === "stale-owner") owner.release();
      if (scenario === "unread") getDb().query("INSERT INTO messages(id,chat_jid,sender,content,timestamp,is_bot_message) VALUES ('unread','web:unread','user','accepted','2099-01-01',0)").run();
      if (scenario === "pending" || scenario === "nonterminal") {
        getDb().exec("INSERT INTO service_effect_s01_chats(chat_jid) VALUES ('migration-test');");
        getDb().query("INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,accepted_at,provenance_ref,create_wake_intent) VALUES ('migration-test',1,'pending',?,'message',?,'payload','2026-01-01','test',0)")
          .run("a".repeat(64), scenario === "pending" ? "pending" : "consumed");
        if (scenario === "nonterminal") getDb().exec("INSERT INTO service_effect_s01_operations(operation_id,chat_jid,version,phase,primary_source_seq) VALUES ('migration-op','migration-test',1,'claimed',1)");
      }
      if (scenario !== "drain") {
        await expect(preparing).rejects.toThrow(scenario === "stale-owner" ? "ownership lost" : scenario === "unread" ? "Unread" : scenario === "pending" ? "Pending S01" : "Nonterminal S01");
        expect(returned).toBe(false);
        return;
      }
      const result = await preparing;
      expect(queued).toBe(true);
      const sessionDir = join(SESSIONS_DIR, "web_migration"); mkdirSync(sessionDir, { recursive: true });
      const manager = SessionManager.inMemory(dir, { id: "resident-original" });
      manager.appendMessage({ role: "system", content: "persisted baseline", timestamp: 1 });
      manager.appendMessage({ role: "user", content: "history", timestamp: 2 });
      const file = join(sessionDir, "resident.jsonl");
      writeFileSync(file, [manager.getHeader(), ...manager.getEntries()].map(row => JSON.stringify(row)).join("\n") + "\n");
      const resident = SessionManager.open(file);
      getDb().exec("INSERT INTO chats(jid) VALUES ('web:migration'); INSERT INTO chat_branches(branch_id,chat_jid,root_chat_jid,agent_name,created_at,updated_at) VALUES ('migration-branch','web:migration','web:migration','migration','2026-01-01','2026-01-01');");
      (pool as any).pool.set("web:migration", { lastUsed: Date.now(), runtime: { session: {
        sessionManager: resident, systemPrompt: "persisted baseline", messages: resident.buildSessionContext().messages,
        isStreaming: false, isCompacting: false, isRetrying: false, isBashRunning: false,
        hasPendingBashMessages: false, pendingMessageCount: 0, dispose() {},
      }, async dispose() {} } });
      const bytes = readFileSync(file), before = getDb().serialize();
      const captured = await result.capture();
      expect(captured.inputs).toHaveLength(1);
      expect(captured.inputs[0]!.sourceJSONL).toBe(bytes.toString());
      expect(captured.migrationIncarnation).toBe("trusted-next-writer");
      captured.revalidate();
      expect(getDb().serialize()).toEqual(before);
      expect(readFileSync(file)).toEqual(bytes);
      rmSync(sessionDir, { recursive: true, force: true });
      result.coordinator.assertSealedAndDrained();
      expect(result.coordinator.migrationIncarnation()).toBe("trusted-next-writer");
      owner.assertCurrentOwner();
      expect(returned).toBe(false);
      result.release();
      expect(() => result.coordinator.assertSealedAndDrained()).toThrow("released");
      expect(returned).toBe(false);
    } finally {
      producer.resolve(); task.resolve(); complete(); await running;
      await pool.shutdown(); await web.stop(); owner.release(); rmSync(dir, { recursive: true, force: true });
    }
  });
  for (const phase of ["producer-await", "prepared"] as const) test(`late unsupported local transport rejects at ${phase}`, async () => {
    initDatabase();
    getDb().exec("DELETE FROM messages; DELETE FROM chat_cursors; DELETE FROM service_effect_s01_operations; DELETE FROM service_effect_s01_sources; DELETE FROM service_effect_s01_chats;");
    const originalLocal = getChatTransport("local");
    const dir = mkdtempSync(join(tmpdir(), "migration-local-"));
    const owner = acquireRuntimeLock({ lockPath: join(dir, "owner"), strictOwnership: true });
    const queue = new AgentQueue();
    const pool = new AgentPool(createAgentPoolModelOptions());
    const web = new WebChannel({ queue, agentPool: pool });
    const producer = Promise.withResolvers<void>();
    const ready = Promise.withResolvers<RuntimeBootstrapContext>();
    let complete!: () => void;
    let unregister: (() => void) | undefined;
    let returned = false;
    const capture = spyOn(pool, "captureLegacyUpgradeBindings");
    // This fixture completes shutdown directly; do not retain its handles globally.
    const shutdownRegistration = spyOn(shutdownRegistry, "registerShutdownHandler").mockImplementation(() => {});
    setLocalChatTransport({ id: "local", send: async () => { throw new Error("Unexpected local send"); } });
    const running = bootstrapRuntime(bootstrapDepsForFailure({
      base: { queue, state: { lastTimestamp: "" } as RuntimeBootstrapState },
      createAgentPool: async () => pool,
      startWebChannel: async () => web,
      createShutdownHandler: deps => { complete = deps.onShutdownComplete!; return async () => {}; },
      migrationInspection: { onReady: value => ready.resolve(value) },
      startRuntimeLoop: async deps => { await new Promise<void>(resolve => deps.signal!.addEventListener("abort", () => resolve(), { once: true })); },
      stopSchedulerLoop: () => producer.promise,
    }), owner).then(() => { returned = true; });
    try {
      const context = await ready.promise;
      const preparing = context.prepareLegacyMigration("trusted-next-writer");
      const before = getDb().serialize();
      if (phase === "prepared") producer.resolve();
      const prepared = phase === "prepared" ? await preparing : undefined;
      prepared?.coordinator.assertSealedAndDrained();
      setLocalChatTransport(undefined);
      unregister = registerChatTransport({ id: "unsupported-local", kind: "local",
        send: async () => { throw new Error("Unexpected unsupported send"); } });
      producer.resolve();
      if (prepared) {
        expect(() => prepared.coordinator.assertSealedAndDrained()).toThrow("Ingress registry changed");
        await expect(prepared.capture()).rejects.toThrow("Ingress registry changed");
        prepared.release();
      } else {
        await expect(preparing).rejects.toThrow("Ingress registry changed");
        expect(capture).not.toHaveBeenCalled();
      }
      expect(getDb().serialize()).toEqual(before);
      queue.assertLegacyCaptureDrained();
      owner.assertCurrentOwner();
      expect(returned).toBe(false);
    } finally {
      producer.resolve(); complete(); await running;
      await queue.shutdown(); await pool.shutdown(); await web.stop();
      unregister?.(); setLocalChatTransport(originalLocal ?? undefined);
      shutdownRegistration.mockRestore(); capture.mockRestore();
      owner.release(); rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unknown installed channel refuses before stopping producers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "migration-unknown-"));
    const owner = acquireRuntimeLock({ lockPath: join(dir, "owner"), strictOwnership: true });
    let context!: RuntimeBootstrapContext, stopped = false;
    try {
      await bootstrapRuntime(bootstrapDepsForFailure({
        migrationInspection: { onReady: value => { context = value; } },
        stopIpcWatcher: async () => { stopped = true; },
        stopSchedulerLoop: () => { stopped = true; },
      }), owner);
      await expect(context.prepareLegacyMigration("next")).rejects.toThrow("Unsupported installed channel");
      owner.assertCurrentOwner(); expect(stopped).toBe(false);
    } finally { owner.release(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("stop joins only its own coordinator, is stable, and cannot stop a replacement", async () => {
    const startInstance = async () => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let stop!: () => void | Promise<void>;
      let signal!: AbortSignal;
      let complete!: () => void;
      const running = bootstrapRuntime(bootstrapDepsForFailure({
        createShutdownHandler: (deps) => { stop = deps.stopMessageLoop!; complete = deps.onShutdownComplete!; return async () => {}; },
        startRuntimeLoop: async (deps) => {
          signal = deps.signal!;
          entered.resolve();
          await release.promise; // Includes any asynchronous poll/notification tail.
        },
      }));
      await entered.promise;
      return { stop, signal, running, release, complete };
    };
    const old = await startInstance();
    let joined = false;
    const stopping = old.stop() as Promise<void>;
    void stopping.then(() => { joined = true; });
    expect(old.stop()).toBe(stopping);
    expect(old.signal.aborted).toBe(true);
    await Promise.resolve();
    expect(joined).toBe(false);
    old.release.resolve();
    await stopping;
    old.complete();
    await old.running;
    const next = await startInstance();
    expect(old.stop()).toBe(stopping);
    expect(next.signal.aborted).toBe(false);
    const nextStop = next.stop();
    next.release.resolve();
    await nextStop;
    next.complete();
    await next.running;
  });

  test("stop registered before workers prevents later loop admission", async () => {
    let stop!: () => void | Promise<void>;
    let started = false;
    let complete!: () => void;
    await bootstrapRuntime(bootstrapDepsForFailure({
      createShutdownHandler: (deps) => { stop = deps.stopMessageLoop!; complete = deps.onShutdownComplete!; return async () => {}; },
      startRuntimeWorkers: () => { void stop(); complete(); },
      startRuntimeLoop: async () => { started = true; },
    }));
    expect(started).toBe(false);
  });

  test("applies environment before AgentPool creation and starts refresh after channels", async () => {
    const events: string[] = [];

    const queue = { shutdown: async () => {} } as RuntimeBootstrapQueue;
    const agentPool = { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool;
    const state = {} as RuntimeBootstrapState;

    const web = {
      stop: async () => {},
      sendMessage: async () => {},
      resumeChat: () => {},
      resumePendingChats: () => {},
    } as RuntimeBootstrapWeb;

    const pushover = {
      stop: async () => {},
      sendMessage: async () => {},
    } as RuntimeBootstrapPushover;
    const senders = {
      sendMessage: async () => {},
      sendNudge: async () => {},
    } as RuntimeSenders;

    let capturedShutdownDeps: { stopIpcWatcher: () => void; stopSchedulerLoop: () => void; stopOptionalProviders: () => void } | null = null;

    const deps: RuntimeBootstrapDeps = {
      base: { queue, state },
      assistantName: "Pi",
      triggerPattern: /@pi/i,
      pollIntervalMs: 123,
      signalRegistrar: { on: () => {} },
      initializeRuntimeEnvironment: () => events.push("init-runtime-env"),
      hydrateMcpCredentials: async () => {
        events.push("hydrate-mcp-credentials");
        return [];
      },
      clearMcpCredentials: () => events.push("clear-mcp-credentials"),
      createAgentPool: async () => {
        events.push("create-agent-pool");
        return agentPool;
      },
      startWebChannel: async () => {
        events.push("start-web");
        return web;
      },
      startBackgroundModelRefresh: (received) => {
        expect(received).toBe(agentPool);
        events.push("start-model-refresh");
      },
      startOptionalPushoverChannel: async () => {
        events.push("start-pushover");
        return pushover;
      },
      createShutdownHandler: (shutdownDeps) => {
        events.push("create-shutdown");
        capturedShutdownDeps = {
          stopIpcWatcher: shutdownDeps.stopIpcWatcher,
          stopSchedulerLoop: shutdownDeps.stopSchedulerLoop,
          stopOptionalProviders: shutdownDeps.stopOptionalProviders,
        };
        return async () => {};
      },
      registerRuntimeShutdownSignals: () => events.push("register-shutdown-signals"),
      createRuntimeSenders: () => {
        events.push("create-senders");
        return senders;
      },
      startRuntimeWorkers: (_queue, _agentPool, _web, runtimeSenders) => {
        events.push("start-workers");
        expect(runtimeSenders).toBe(senders);
      },
      queueStartupResumePendingIpc: () => events.push("queue-startup-resume"),
      startRuntimeLoop: async (loopDeps) => {
        events.push("start-runtime-loop");
        expect(loopDeps.agentPool).toBe(agentPool);
        expect(loopDeps.assistantName).toBe("Pi");
        expect(loopDeps.pollIntervalMs).toBe(123);
      },
      log: () => events.push("log-banner"),
      stopIpcWatcher: async () => {},
      stopSchedulerLoop: () => {},
      stopOptionalProviders: () => {},
    };

    await bootstrapRuntime(deps);

    expect(capturedShutdownDeps).not.toBeNull();
    expect(events).toEqual([
      "init-runtime-env",
      "hydrate-mcp-credentials",
      "create-agent-pool",
      "log-banner",
      "start-web",
      "start-pushover",
      "start-model-refresh",
      "create-shutdown",
      "register-shutdown-signals",
      "create-senders",
      "start-workers",
      "start-runtime-loop",
    ]);
  });

  test("family mode starts only the web runtime and waits without legacy workers", async () => {
    const events: string[] = [];
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const deps = bootstrapDepsForFailure({
      initializeRuntimeEnvironment: () => ({ effectiveMode: "family-shared" }),
      hydrateMcpCredentials: async () => { events.push("mcp"); return []; },
      createAgentPool: async () => { events.push("agent-pool"); return { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool; },
      startWebChannel: async () => { events.push("web"); return { stop: async () => {} } as RuntimeBootstrapWeb; },
      startOptionalPushoverChannel: async () => { events.push("pushover"); return null; },
      startBackgroundModelRefresh: () => events.push("model-refresh"),
      startRuntimeWorkers: () => events.push("workers"),
      startRuntimeLoop: async () => { events.push("loop"); },
      waitForFamilyShutdown: () => wait,
    });
    const running = bootstrapRuntime(deps); await Bun.sleep(1);
    expect(events).toEqual(["agent-pool", "web"]);
    release(); await running;
  });

  test("clears hydrated MCP credentials when AgentPool creation fails", async () => {
    const cleared: string[][] = [];
    const deps = bootstrapDepsForFailure({
      createAgentPool: async () => { throw new Error("agent pool failed"); },
      clearMcpCredentials: (entries) => cleared.push(entries.map((entry) => entry.envName)),
    });

    await expect(bootstrapRuntime(deps)).rejects.toThrow("agent pool failed");
    expect(cleared).toEqual([["PICLAW_MCP_SECRET"]]);
  });

  test("clears hydrated MCP credentials when web startup fails", async () => {
    const cleared: string[][] = [];
    const deps = bootstrapDepsForFailure({
      startWebChannel: async () => { throw new Error("web failed"); },
      clearMcpCredentials: (entries) => cleared.push(entries.map((entry) => entry.envName)),
    });

    await expect(bootstrapRuntime(deps)).rejects.toThrow("web failed");
    expect(cleared).toEqual([["PICLAW_MCP_SECRET"]]);
  });

  test("background refresh is queued and not awaited by bootstrap", async () => {
    const queue = { shutdown: async () => {} } as RuntimeBootstrapQueue;
    const agentPool = { shutdown: async () => {}, resolveModelInput: () => null } as RuntimeBootstrapAgentPool;
    const state = {} as RuntimeBootstrapState;
    let refreshFinished = false;

    const deps = {
      base: { queue, state },
      assistantName: "Pi",
      triggerPattern: /@pi/i,
      pollIntervalMs: 1,
      signalRegistrar: { on: () => {} },
      initializeRuntimeEnvironment: () => {},
      hydrateMcpCredentials: async () => [],
      clearMcpCredentials: () => {},
      createAgentPool: async () => agentPool,
      startWebChannel: async () => ({ stop: async () => {} } as RuntimeBootstrapWeb),
      startBackgroundModelRefresh: () => {
        void Bun.sleep(100).then(() => { refreshFinished = true; });
      },
      startOptionalPushoverChannel: async () => null,
      createShutdownHandler: () => async () => {},
      registerRuntimeShutdownSignals: () => {},
      createRuntimeSenders: () => ({ sendMessage: async () => {}, sendNudge: async () => {} }),
      startRuntimeWorkers: () => {},
      queueStartupResumePendingIpc: () => {},
      startRuntimeLoop: async () => {},
      log: () => {},
      stopIpcWatcher: async () => {},
      stopSchedulerLoop: () => {},
      stopOptionalProviders: () => {},
    } as RuntimeBootstrapDeps;

    await bootstrapRuntime(deps);
    expect(refreshFinished).toBe(false);
  });

  test("createDefaultRuntimeBootstrapDeps preserves provided runtime base", () => {
    const base = {
      queue: {} as RuntimeBootstrapDefaultBaseServices["queue"],
      state: {} as RuntimeBootstrapDefaultBaseServices["state"],
    };

    const deps = createDefaultRuntimeBootstrapDeps(base);

    expect(deps.base).toBe(base);
    expect(deps.assistantName.length).toBeGreaterThan(0);
    expect(typeof deps.pollIntervalMs).toBe("number");
    expect(deps.triggerPattern).toBeInstanceOf(RegExp);
    expect(typeof deps.hydrateMcpCredentials).toBe("function");
    expect(typeof deps.clearMcpCredentials).toBe("function");
    expect(typeof deps.prepareApplicationBackend).toBe("function");
    expect(typeof deps.createAgentPool).toBe("function");
    expect(typeof deps.startRuntimeLoop).toBe("function");
  });
});

for (const failure of ["none", "scheduler", "producer", "queue"] as const) {
  test(`main retains strict global owner through producer stop (${failure})`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "poller-owner-"));
    const lockPath = join(dir, "runtime.lock");
    const acquire = () => acquireRuntimeLock({ lockPath, strictOwnership: true, disabled: false });
    const owner = acquire();
    const entered = Promise.withResolvers<void>();
    const scheduler = Promise.withResolvers<void>();
    const queueEntered = Promise.withResolvers<void>(), queue = Promise.withResolvers<void>();
    const poolEntered = Promise.withResolvers<void>(), pool = Promise.withResolvers<void>();
    const webEntered = Promise.withResolvers<void>(), web = Promise.withResolvers<void>();
    let shutdown!: (signal: string) => Promise<void>;
    let settled = false;
    const exit = spyOn(process, "exit").mockImplementation((() => {}) as any);
    const deps = bootstrapDepsForFailure({
      createShutdownHandler,
      registerRuntimeShutdownSignals: (_registrar, handler) => { shutdown = handler; },
      startRuntimeLoop: async ({ signal }) => {
        entered.resolve();
        await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
        if (failure === "producer") throw new Error("uncertain producer join");
      },
      stopSchedulerLoop: () => scheduler.promise,
      createAgentPool: async () => ({ shutdown: async () => { poolEntered.resolve(); await pool.promise; } }) as RuntimeBootstrapAgentPool,
      startWebChannel: async () => ({ stop: async () => { webEntered.resolve(); await web.promise; } }) as RuntimeBootstrapWeb,
    });
    deps.base.queue = { shutdown: async () => {
      queueEntered.resolve(); await queue.promise;
      if (failure === "queue") throw new Error("queue cleanup failed");
    } } as RuntimeBootstrapQueue;
    const running = main({ acquireLock: () => owner, createBootstrapDeps: () => deps });
    void running.then(() => { settled = true; }, () => { settled = true; });
    const assertHeld = async () => {
      await Bun.sleep(0);
      expect(settled).toBe(false);
      owner.assertCurrentOwner();
      expect(acquire).toThrow("refuses existing lock");
    };
    try {
      await entered.promise;
      const stopping = shutdown("test");
      // Observe rejection immediately, including a producer join failure.
      const stopped = stopping.catch((error: unknown) => error);
      await assertHeld(); // Producer has resolved, scheduler join is still held.
      if (failure === "scheduler" || failure === "producer") {
        if (failure === "scheduler") scheduler.reject(new Error("uncertain scheduler join"));
        const error = await stopped;
        expect(error).toBeInstanceOf(Error);
        await assertHeld();
        expect(exit).not.toHaveBeenCalled();
      } else {
        scheduler.resolve();
        await queueEntered.promise; await assertHeld(); queue.resolve();
        if (failure === "queue") {
          expect(await stopped).toBeInstanceOf(Error);
          await assertHeld();
          expect(exit).not.toHaveBeenCalled();
        } else {
          await poolEntered.promise; await assertHeld(); pool.resolve();
          await webEntered.promise; await assertHeld(); web.resolve();
          await stopping;
          await running;
          expect(exit).toHaveBeenCalledWith(0);
          const replacement = acquire();
          replacement.assertCurrentOwner();
          replacement.release();
        }
      }
    } finally {
      scheduler.resolve(); queue.resolve(); pool.resolve(); web.resolve();
      owner.release(); // Offline fixture cleanup only, including fail-closed case.
      exit.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

for (const uncertain of [false, true]) test(`backend startup cleanup retains owner only when uncertain=${uncertain}`, async () => {
  const dir = mkdtempSync(join(tmpdir(), "backend-startup-"));
  const acquire = () => acquireRuntimeLock({ lockPath: join(dir, "owner"), strictOwnership: true, disabled: false });
  const owner = acquire();
  const events: string[] = [];
  const sessionOptions = Object.freeze({ getDurableSession: () => undefined });
  const bind = (options: any) => options;
  try {
    const deps = bootstrapDepsForFailure({
      prepareApplicationBackend: async actual => {
        expect(actual).toBe(owner); actual.assertCurrentOwner(); events.push("prepare");
        return { sessionOptions, bind, stop: () => { events.push("stop"); }, close: async () => { events.push("close"); if (uncertain) throw Error("close uncertain"); } };
      },
      base: { queue: { shutdown: async () => { events.push("queue-close"); } } as RuntimeBootstrapQueue, state: {} as RuntimeBootstrapState },
      createAgentPool: async options => {
        expect(options).toBe(sessionOptions); events.push("pool");
        return { shutdown: async () => { events.push("pool-close"); } } as RuntimeBootstrapAgentPool;
      },
      startWebChannel: async (_queue, _pool, actualBind) => {
        expect(actualBind).toBe(bind); events.push("web"); throw Error("web failed");
      },
    });
    await expect(main({ acquireLock: () => owner, createBootstrapDeps: () => deps })).rejects.toThrow(uncertain ? "cleanup uncertain" : "web failed");
    expect(events).toEqual(["prepare", "pool", "web", "stop", "queue-close", "pool-close", "close"]);
    if (uncertain) { owner.assertCurrentOwner(); expect(acquire).toThrow("refuses existing lock"); }
    else acquire().release();
  } finally { owner.release(); rmSync(dir, { recursive: true, force: true }); }
});

test("backend preparation requires strict owner before callback", async () => {
  let called = false;
  await expect(bootstrapRuntime(bootstrapDepsForFailure({ prepareApplicationBackend: async () => {
    called = true; throw Error("must not open");
  } }))).rejects.toThrow("Strict runtime owner required");
  expect(called).toBe(false);
});

test("selected backend preparation error never falls back to legacy construction", async () => {
  const dir = mkdtempSync(join(tmpdir(), "backend-no-fallback-"));
  const owner = acquireRuntimeLock({ lockPath: join(dir, "owner"), strictOwnership: true, disabled: false });
  const legacy = spyOn(SessionManager, "create").mockImplementation(() => { throw Error("legacy forbidden"); });
  let pools = 0;
  try {
    await expect(bootstrapRuntime(bootstrapDepsForFailure({
      prepareApplicationBackend: async () => { throw Error("selected backend failed"); },
      createAgentPool: async () => { pools++; throw Error("legacy fallback forbidden"); },
    }), owner)).rejects.toThrow("selected backend failed");
    expect(pools).toBe(0); expect(legacy).not.toHaveBeenCalled(); owner.assertCurrentOwner();
  } finally { legacy.mockRestore(); owner.release(); rmSync(dir, { recursive: true, force: true }); }
});

test("main preserves lock release on startup failure before producer stop", async () => {
  const dir = mkdtempSync(join(tmpdir(), "poller-startup-owner-"));
  const acquire = () => acquireRuntimeLock({ lockPath: join(dir, "runtime.lock"), strictOwnership: true, disabled: false });
  try {
    await expect(main({ acquireLock: acquire, createBootstrapDeps: () => bootstrapDepsForFailure({
      createAgentPool: async () => { throw new Error("startup failed"); },
    }) })).rejects.toThrow("startup failed");
    acquire().release();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
