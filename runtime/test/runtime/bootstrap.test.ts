import { describe, expect, test } from "bun:test";
import {
  bootstrapRuntime,
  createDefaultRuntimeBootstrapDeps,
  type RuntimeBootstrapAgentPool,
  type RuntimeBootstrapDeps,
  type RuntimeBootstrapPushover,
  type RuntimeBootstrapQueue,
  type RuntimeBootstrapState,
  type RuntimeBootstrapWeb,
  type RuntimeBootstrapWhatsApp,
  type RuntimeBootstrapTelegram,
  type RuntimeBootstrapDefaultCoreServices,
} from "../../src/runtime/bootstrap.js";
import type { RuntimeSenders } from "../../src/runtime/wiring.js";

describe("runtime bootstrap", () => {
  test("bootstrapRuntime wires runtime services in production order", async () => {
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

    const whatsapp = {
      connect: async () => {
        events.push("connect-whatsapp");
      },
      disconnect: async () => {},
      sendMessage: async () => {},
      getMessagesSince: async () => [],
    } as RuntimeBootstrapWhatsApp;

    const telegram = {
      connect: async () => {
        events.push("connect-telegram");
      },
      disconnect: async () => {},
      sendMessage: async () => {},
      setTyping: async () => {},
    } as RuntimeBootstrapTelegram;

    const senders = {
      sendMessage: async () => {},
      sendNudge: async () => {},
    } as RuntimeSenders;

    let capturedShutdownDeps: { stopIpcWatcher: () => void; stopSchedulerLoop: () => void } | null = null;

    const deps: RuntimeBootstrapDeps = {
      core: { queue, agentPool, state },
      assistantName: "Pi",
      triggerPattern: /@pi/i,
      pollIntervalMs: 123,
      signalRegistrar: { on: () => {} },
      initializeRuntimeEnvironment: () => events.push("init-runtime-env"),
      registerOptionalProviders: () => events.push("register-providers"),
      startWebChannel: async () => {
        events.push("start-web");
        return web;
      },
      startOptionalPushoverChannel: async () => {
        events.push("start-pushover");
        return pushover;
      },
      createWhatsAppChannel: () => {
        events.push("create-whatsapp");
        return whatsapp;
      },
      createTelegramChannel: () => {
        events.push("create-telegram");
        return telegram;
      },
      createShutdownHandler: (shutdownDeps) => {
        events.push("create-shutdown");
        capturedShutdownDeps = {
          stopIpcWatcher: shutdownDeps.stopIpcWatcher,
          stopSchedulerLoop: shutdownDeps.stopSchedulerLoop,
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
      queueStartupResumePendingIpc: () => {
        events.push("queue-startup-resume");
      },
      startRuntimeLoop: async (loopDeps) => {
        events.push("start-runtime-loop");
        expect(loopDeps.assistantName).toBe("Pi");
        expect(loopDeps.pollIntervalMs).toBe(123);
      },
      log: () => events.push("log-banner"),
      stopIpcWatcher: () => {},
      stopSchedulerLoop: () => {},
    };

    await bootstrapRuntime(deps);

    expect(capturedShutdownDeps).not.toBeNull();
    expect(events).toEqual([
      "init-runtime-env",
      "register-providers",
      "log-banner",
      "start-web",
      "start-pushover",
      "create-whatsapp",
      "create-telegram",
      "create-shutdown",
      "register-shutdown-signals",
      "create-senders",
      "start-workers",
      "connect-whatsapp",
      "connect-telegram",
      "start-runtime-loop",
    ]);
  });

  test("createDefaultRuntimeBootstrapDeps preserves provided runtime core", () => {
    const core = {
      queue: {} as RuntimeBootstrapDefaultCoreServices["queue"],
      agentPool: {} as RuntimeBootstrapDefaultCoreServices["agentPool"],
      state: {} as RuntimeBootstrapDefaultCoreServices["state"],
    };

    const deps = createDefaultRuntimeBootstrapDeps(core);

    expect(deps.core).toBe(core);
    expect(deps.assistantName.length).toBeGreaterThan(0);
    expect(typeof deps.pollIntervalMs).toBe("number");
    expect(deps.triggerPattern).toBeInstanceOf(RegExp);
    expect(typeof deps.startRuntimeLoop).toBe("function");
  });
});
