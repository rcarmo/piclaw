import { expect, spyOn, test } from "bun:test";
import { AgentQueue } from "../../src/queue.js";

import { importFresh, withTempWorkspaceEnv } from "../helpers.js";

function pollingState(chatJids: string[]) {
  return {
    chatJids: new Set(chatJids),
    lastTimestamp: "",
    saveTimestamps: () => {},
  } as unknown as import("../../src/runtime/state.js").RuntimeState;
}

function makeMessage(chatJid: string, content: string, timestamp: string) {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chat_jid: chatJid,
    sender: "user",
    sender_name: "User",
    content,
    timestamp,
    is_from_me: false,
    is_bot_message: false,
  };
}

test("processMessages leaves lastAgentTimestamp unchanged when runAgent throws", async () => {
  await withTempWorkspaceEnv("piclaw-message-loop-", { PICLAW_KEYCHAIN_KEY: "test-key" }, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    db.initDatabase();

    const chatJid = `wa:${Date.now()}`;
    const timestamp = "2026-04-17T01:00:00.000Z";
    db.storeMessage(makeMessage(chatJid, "@Pi hello", timestamp));

    let saveCalls = 0;
    const state = {
      lastAgentTimestamp: {} as Record<string, string>,
      wasCommandProcessed: () => false,
      markCommandProcessed: () => {},
      saveTimestamps: () => {
        saveCalls += 1;
      },
    };

    await expect(loop.processMessages(chatJid, {
      state: state as any,
      assistantName: "Pi",
      triggerPattern: /@Pi/i,
      agentPool: {
        runAgent: async () => {
          throw new Error("agent crashed");
        },
      } as any,
    })).rejects.toThrow("agent crashed");

    expect(state.lastAgentTimestamp[chatJid]).toBeUndefined();
    expect(saveCalls).toBe(0);
  });
});

test("processMessages persists lastAgentTimestamp after a recovered successful agent run", async () => {
  await withTempWorkspaceEnv("piclaw-message-loop-", { PICLAW_KEYCHAIN_KEY: "test-key" }, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    db.initDatabase();

    const chatJid = `wa:${Date.now()}`;
    const timestamp = "2026-04-17T01:05:00.000Z";
    db.storeMessage(makeMessage(chatJid, "@Pi hello", timestamp));

    let saveCalls = 0;
    const state = {
      lastAgentTimestamp: {} as Record<string, string>,
      wasCommandProcessed: () => false,
      markCommandProcessed: () => {},
      saveTimestamps: () => {
        saveCalls += 1;
      },
    };

    const ok = await loop.processMessages(chatJid, {
      state: state as any,
      assistantName: "Pi",
      triggerPattern: /@Pi/i,
      agentPool: {
        runAgent: async () => ({
          status: "success",
          result: "done",
          recovery: {
            attemptsUsed: 1,
            totalElapsedMs: 1200,
            recovered: true,
            exhausted: false,
            lastClassifier: "transient",
            strategyHistory: ["retry"],
          },
        }),
      } as any,
    });

    expect(ok).toBe(true);
    expect(state.lastAgentTimestamp[chatJid]).toBe(timestamp);
    expect(saveCalls).toBe(1);
  });
});

test("processMessages treats leading path-like slash text after trigger as a normal prompt", async () => {
  await withTempWorkspaceEnv("piclaw-message-loop-", { PICLAW_KEYCHAIN_KEY: "test-key" }, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    db.initDatabase();

    const chatJid = `wa:${Date.now()}`;
    const timestamp = "2026-04-17T01:03:00.000Z";
    db.storeMessage(makeMessage(chatJid, "@Pi /workspace/piclaw is the repo; mention /agent/keychain literally", timestamp));

    const state = {
      lastAgentTimestamp: {} as Record<string, string>,
      wasCommandProcessed: () => false,
      markCommandProcessed: () => {},
      saveTimestamps: () => {},
    };

    let prompt = "";
    const ok = await loop.processMessages(chatJid, {
      state: state as any,
      assistantName: "Pi",
      triggerPattern: /@Pi/i,
      agentPool: {
        applySlashCommand: async () => {
          throw new Error("path-like slash text must not execute as slash command");
        },
        runAgent: async (nextPrompt: string) => {
          prompt = nextPrompt;
          return { status: "success", result: "done" };
        },
      } as any,
    });

    expect(ok).toBe(true);
    expect(prompt).toContain("/workspace/piclaw");
    expect(prompt).toContain("/agent/keychain");
  });
});

test("processMessages persists lastAgentTimestamp after a successful agent run", async () => {
  await withTempWorkspaceEnv("piclaw-message-loop-", { PICLAW_KEYCHAIN_KEY: "test-key" }, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    db.initDatabase();

    const chatJid = `wa:${Date.now()}`;
    const timestamp = "2026-04-17T01:05:00.000Z";
    db.storeMessage(makeMessage(chatJid, "@Pi hello", timestamp));

    let saveCalls = 0;
    const state = {
      lastAgentTimestamp: {} as Record<string, string>,
      wasCommandProcessed: () => false,
      markCommandProcessed: () => {},
      saveTimestamps: () => {
        saveCalls += 1;
      },
    };

    const ok = await loop.processMessages(chatJid, {
      state: state as any,
      assistantName: "Pi",
      triggerPattern: /@Pi/i,
      agentPool: {
        runAgent: async () => ({
          status: "success",
          result: "done",
        }),
      } as any,
    });

    expect(ok).toBe(true);
    expect(state.lastAgentTimestamp[chatJid]).toBe(timestamp);
    expect(saveCalls).toBe(1);
  });
});


test("abort during poll sleep clears timer and listener without another poll", async () => {
  await withTempWorkspaceEnv("piclaw-poller-stop-", {}, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    db.initDatabase();
    const controller = new AbortController();
    const queue = new AgentQueue();
    const state = pollingState([]);
    let polls = 0;
    Object.defineProperty(state, "lastTimestamp", { get: () => { polls++; return ""; } });
    const timers = spyOn(globalThis, "setTimeout");
    const clear = spyOn(globalThis, "clearTimeout");
    const remove = spyOn(controller.signal, "removeEventListener");
    try {
      const running = loop.runMessageLoop({ queue, state, assistantName: "Pi", pollIntervalMs: 60_000, processMessages: async () => true }, controller.signal);
      expect(polls).toBe(1);
      const timer = timers.mock.results.at(-1)!.value;
      controller.abort();
      await running;
      expect(clear).toHaveBeenCalledWith(timer);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      expect(polls).toBe(1);
      expect(queue.getMetrics().enqueued).toBe(0);
    } finally { timers.mockRestore(); clear.mockRestore(); remove.mockRestore(); await queue.shutdown(); }
  });
});

test("stop after readonly fetch admits nothing and leaves cursor replayable", async () => {
  await withTempWorkspaceEnv("piclaw-poller-stop-", {}, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    db.initDatabase();
    const chat = "wa:stop-before-admission";
    db.storeMessage(makeMessage(chat, "@Pi hello", "2026-04-17T02:00:00.000Z"));
    const controller = new AbortController();
    const queue = new AgentQueue();
    const state = pollingState([chat]);
    let saves = 0;
    state.saveTimestamps = () => { saves++; };
    Object.defineProperty(state, "lastTimestamp", { get: () => { controller.abort(); return ""; } });
    await loop.runMessageLoop({ queue, state, assistantName: "Pi", pollIntervalMs: 60_000, processMessages: async () => true }, controller.signal);
    expect(queue.getMetrics().enqueued).toBe(0);
    expect(saves).toBe(0);
    expect(db.getNewMessages([chat], "", "Pi").messages).toHaveLength(1);
    await queue.shutdown();
  });
});

test("partially admitted batch keeps original cursor and accepted queue work runs after stop", async () => {
  await withTempWorkspaceEnv("piclaw-poller-stop-", {}, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    db.initDatabase();
    const chats = ["wa:partial-one", "wa:partial-two"];
    chats.forEach((chat, i) => db.storeMessage(makeMessage(chat, "@Pi hello", `2026-04-17T02:00:0${i}.000Z`)));
    const controller = new AbortController();
    const queue = new AgentQueue();
    const state = pollingState(chats);
    const accepted = Promise.withResolvers<void>();
    const enqueue = queue.enqueue.bind(queue);
    const intercepted = spyOn(queue, "enqueue").mockImplementation((...args) => { enqueue(...args); controller.abort(); });
    try {
      await loop.runMessageLoop({ queue, state, assistantName: "Pi", pollIntervalMs: 60_000, processMessages: async () => { accepted.resolve(); return true; } }, controller.signal);
      expect(queue.getMetrics().enqueued).toBe(1);
      expect(state.lastTimestamp).toBe("");
      expect(db.getNewMessages(chats, state.lastTimestamp, "Pi").messages).toHaveLength(2);
      await accepted.promise;
    } finally { intercepted.mockRestore(); await queue.shutdown(); }
  });
});

test("shutdown joins poll then waits for accepted asynchronous queue processing before pool disposal", async () => {
  await withTempWorkspaceEnv("piclaw-poller-stop-", {}, async () => {
    const db = await importFresh<typeof import("../../src/db.js")>("../src/db.js");
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    const { createShutdownHandler } = await import("../../src/runtime/shutdown.js");
    db.initDatabase();
    const chat = "wa:held-notification";
    db.storeMessage(makeMessage(chat, "@Pi hello", "2026-04-17T02:00:00.000Z"));
    const queue = new AgentQueue();
    const controller = new AbortController();
    const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const queueStopping = Promise.withResolvers<void>();
    const calls: string[] = [];
    const running = loop.runMessageLoop({
      queue, state: pollingState([chat]), assistantName: "Pi", pollIntervalMs: 60_000,
      processMessages: async () => { entered.resolve(); await release.promise; calls.push("notification-complete"); return true; },
    }, controller.signal);
    const exit = spyOn(process, "exit").mockImplementation((() => {}) as any);
    let stopping: Promise<void> | undefined;
    try {
      await entered.promise;
      const shutdown = createShutdownHandler({
        stopMessageLoop: () => { controller.abort(); return running.then(() => { calls.push("poll-joined"); }); },
        stopIpcWatcher: async () => {}, stopSchedulerLoop: () => {}, stopOptionalProviders: () => {},
        queue: { shutdown: async () => { calls.push("queue-stop"); queueStopping.resolve(); await queue.shutdown(); } },
        agentPool: { shutdown: async () => { calls.push("pool-stop"); } },
        web: { stop: async () => {} },
      });
      stopping = shutdown("test");
      await queueStopping.promise;
      expect(calls).toEqual(["poll-joined", "queue-stop"]);
      release.resolve();
      await stopping;
      expect(calls).toEqual(["poll-joined", "queue-stop", "notification-complete", "pool-stop"]);
      expect(queue.getMetrics().enqueued).toBe(1);
      expect(queue.getMetrics().succeeded).toBe(1);
    } finally { release.resolve(); controller.abort(); await running; await stopping; await queue.shutdown(); exit.mockRestore(); }
  });
});

test("already stopped loop never polls", async () => {
  await withTempWorkspaceEnv("piclaw-poller-stop-", {}, async () => {
    const loop = await importFresh<typeof import("../../src/runtime/message-loop.js")>("../src/runtime/message-loop.js");
    const controller = new AbortController(); controller.abort();
    const state = pollingState([]);
    Object.defineProperty(state, "chatJids", { get: () => { throw new Error("must not poll"); } });
    const queue = new AgentQueue();
    await loop.runMessageLoop({ queue, state, assistantName: "Pi", pollIntervalMs: 60_000, processMessages: async () => true }, controller.signal);
    expect(queue.getMetrics().enqueued).toBe(0);
    await queue.shutdown();
  });
});
