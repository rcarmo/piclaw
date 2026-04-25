import { describe, expect, test } from "bun:test";
import {
  WebChannelRuntimeStateService,
  type WebChannelRuntimeStateCallbacks,
} from "../../../../src/channels/web/runtime/runtime-state-service.js";
import type { ChatRunControlStore } from "../../../../src/channels/web/runtime/chat-run-control.js";
import type { WebRecoveryStore } from "../../../../src/channels/web/runtime/recovery.js";

describe("web runtime state service", () => {
  test("resumeChat wires queue/process callbacks through the resume context", async () => {
    const enqueued: Array<{ key: string; laneKey?: string; task: () => Promise<void> }> = [];
    const processed: Array<{ chatJid: string; agentId: string; threadRootId?: number | null }> = [];

    const callbacks: WebChannelRuntimeStateCallbacks = {
      getAssistantName: () => "Pi",
      getChatCursor: () => "2026-03-27T20:00:00.000Z",
      enqueue: (task, key, laneKey) => {
        enqueued.push({ task, key, laneKey });
      },
      processChat: async (chatJid, agentId, threadRootId) => {
        processed.push({ chatJid, agentId, threadRootId });
      },
    };

    const service = new WebChannelRuntimeStateService(callbacks, {
      defaultAgentId: "default",
      stateKey: "state-key",
    });

    service.resumeChat("web:1", 77);
    service.resumeChat("web:2");

    expect(enqueued.map(({ key, laneKey }) => ({ key, laneKey }))).toEqual([
      { key: "resume:web:1:77", laneKey: "chat:web:1" },
      { key: "resume:web:2:wake", laneKey: "chat:web:2" },
    ]);

    await enqueued[0].task();
    await enqueued[1].task();

    expect(processed).toEqual([
      { chatJid: "web:1", agentId: "default", threadRootId: 77 },
      { chatJid: "web:2", agentId: "default", threadRootId: undefined },
    ]);
  });

  test("recovery helpers use live assistant identity plus queue/process wiring", async () => {
    const enqueued: Array<{ key: string; laneKey?: string; task: () => Promise<void> }> = [];
    const processed: Array<{ chatJid: string; agentId: string; threadRootId?: number | null }> = [];
    const messageChecks: Array<{ chatJid: string; since: string; assistantName: string }> = [];
    const draftRecoveryMap = new Map<string, { turnId?: string; text: string; totalLines: number; updatedAt: number }>();
    let assistantName = "Pi stable";

    const callbacks: WebChannelRuntimeStateCallbacks = {
      getAssistantName: () => assistantName,
      getChatCursor: () => "cursor",
      enqueue: (task, key, laneKey) => {
        enqueued.push({ task, key, laneKey });
      },
      processChat: async (chatJid, agentId, threadRootId) => {
        processed.push({ chatJid, agentId, threadRootId });
      },
    };

    const store: WebRecoveryStore = {
      getInflightRuns: () => [{ chatJid: "web:replay", prevTs: "t0", messageId: "m1", startedAt: "2026-03-27T20:00:00.000Z" }],
      transaction: (run) => run(),
      getAgentReplyStateAfter: () => "none",
      clearInflightMarker: () => {},
      rollbackInflightRun: () => {},
      getAllChatCursors: () => ({ "web:pending": "t1" }),
      getKnownChatJids: () => ["web:pending"],
      getDeferredQueuedFollowups: () => [],
      getMessagesSince: (chatJid, since, seenAssistantName) => {
        messageChecks.push({ chatJid, since, assistantName: seenAssistantName });
        return [{ id: `${chatJid}-message` }];
      },
    };

    const state = {
      load: () => {},
      save: () => {},
      setAgentStatus: () => {},
      getAgentStatuses: () => ({}),
      setContextUsage: () => {},
      getContextUsage: () => null,
      setDraftRecovery: (chatJid: string, entry: { turnId?: string; text: string; totalLines: number; updatedAt: number } | null) => {
        if (!entry) {
          draftRecoveryMap.delete(chatJid);
          return;
        }
        draftRecoveryMap.set(chatJid, entry);
      },
      getDraftRecovery: (chatJid: string) => draftRecoveryMap.get(chatJid) ?? null,
    };

    const service = new WebChannelRuntimeStateService(callbacks, {
      defaultAgentId: "default",
      stateKey: "state-key",
    }, {
      state,
    });

    service.recoverInflightRuns(store);
    assistantName = "Pi live";
    service.resumePendingChats(undefined, store);

    expect(messageChecks).toEqual([
      { chatJid: "web:pending", since: "t1", assistantName: "Pi live" },
    ]);
    expect(enqueued.map(({ key, laneKey }) => ({ key, laneKey }))).toEqual([
      { key: "resume:web:pending", laneKey: "chat:web:pending" },
    ]);

    await enqueued[0].task();

    expect(processed).toEqual([
      { chatJid: "web:pending", agentId: "default", threadRootId: undefined },
    ]);
  });

  test("state and runtime store delegations stay confined to injected stores", () => {
    const calls: string[] = [];
    const statusMap = new Map<string, Record<string, unknown>>();
    const pendingMap = new Map<string, string[] | null>();
    const expandedMap = new Map<string, { thought?: boolean; draft?: boolean }>();
    const bufferMap = new Map<string, { thought?: { text: string; totalLines: number }; draft?: { text: string; totalLines: number } }>();

    const draftRecoveryMap = new Map<string, { turnId?: string; text: string; totalLines: number; updatedAt: number }>();
    const state = {
      load: () => {
        calls.push("state.load");
      },
      save: () => {
        calls.push("state.save");
      },
      setAgentStatus: () => {},
      getAgentStatuses: () => ({}),
      setContextUsage: () => {},
      getContextUsage: () => null,
      setDraftRecovery: (chatJid: string, entry: { turnId?: string; text: string; totalLines: number; updatedAt: number } | null) => {
        calls.push(`draft.set:${chatJid}:${entry?.turnId ?? ""}`);
        if (!entry) {
          draftRecoveryMap.delete(chatJid);
          return;
        }
        draftRecoveryMap.set(chatJid, entry);
      },
      getDraftRecovery: (chatJid: string) => draftRecoveryMap.get(chatJid) ?? null,
    };
    const agentStatusStore = {
      load: () => {
        calls.push("status.load");
      },
      update: (chatJid: string, status: Record<string, unknown>) => {
        calls.push(`status.update:${chatJid}`);
        statusMap.set(chatJid, status);
      },
      get: (chatJid: string) => statusMap.get(chatJid) ?? null,
    };
    const pendingSteeringStore = {
      queue: (chatJid: string, timestamp: string | undefined) => {
        calls.push(`pending.queue:${chatJid}:${timestamp ?? ""}`);
        pendingMap.set(chatJid, timestamp ? [timestamp] : null);
      },
      consumeAll: (chatJid: string) => {
        calls.push(`pending.consume:${chatJid}`);
        const value = pendingMap.get(chatJid) ?? [];
        pendingMap.delete(chatJid);
        return value ?? [];
      },
    };
    const agentBuffers = {
      setPanelExpanded: (turnId: string, panel: "thought" | "draft", expanded: boolean) => {
        calls.push(`panel.set:${turnId}:${panel}:${expanded}`);
        expandedMap.set(turnId, { ...expandedMap.get(turnId), [panel]: expanded });
      },
      isPanelExpanded: (turnId: string, panel: "thought" | "draft") => expandedMap.get(turnId)?.[panel] ?? false,
      updateBuffer: (turnId: string, panel: "thought" | "draft", text: string, totalLines: number) => {
        calls.push(`buffer.update:${turnId}:${panel}:${totalLines}`);
        bufferMap.set(turnId, { ...bufferMap.get(turnId), [panel]: { text, totalLines } });
      },
      getBuffer: (turnId: string, panel: "thought" | "draft") => bufferMap.get(turnId)?.[panel],
    };

    const service = new WebChannelRuntimeStateService(
      {
        getAssistantName: () => "Pi",
        getChatCursor: () => "cursor",
        enqueue: async () => {},
        processChat: async () => {},
      },
      {
        defaultAgentId: "default",
        stateKey: "state-key",
      },
      {
        state,
        agentStatusStore,
        pendingSteeringStore,
        agentBuffers,
      }
    );

    service.loadState();
    service.saveState();
    service.updateAgentStatus("web:1", { type: "intent", title: "Thinking", turn_id: "turn-1" });
    service.queuePendingSteering("web:1", "2026-03-27T20:05:00.000Z");
    service.setPanelExpanded("turn-1", "thought", true);
    service.updateThoughtBuffer("turn-1", "line one", 1);
    service.updateDraftBuffer("turn-1", "draft one", 2);

    expect(service.getAgentStatus("web:1")).toEqual({ type: "intent", title: "Thinking", turn_id: "turn-1" });
    expect(service.consumePendingSteering("web:1")).toEqual(["2026-03-27T20:05:00.000Z"]);
    expect(service.isPanelExpanded("turn-1", "thought")).toBe(true);
    expect(service.getBuffer("turn-1", "thought")).toEqual({ text: "line one", totalLines: 1 });
    expect(service.getBuffer("turn-1", "draft")).toEqual({ text: "draft one", totalLines: 2 });
    expect(state.getDraftRecovery("web:1")).toEqual(expect.objectContaining({
      turnId: "turn-1",
      text: "draft one",
      totalLines: 2,
    }));
    expect(calls).toEqual([
      "status.load",
      "state.save",
      "status.update:web:1",
      "pending.queue:web:1:2026-03-27T20:05:00.000Z",
      "panel.set:turn-1:thought:true",
      "buffer.update:turn-1:thought:1",
      "buffer.update:turn-1:draft:2",
      "draft.set:web:1:turn-1",
      "state.save",
      "pending.consume:web:1",
    ]);
  });

  test("chat-run control delegation preserves thread-root lookup and failed-run skip behavior", () => {
    const setCalls: Array<{ chatJid: string; ts: string }> = [];
    const clearCalls: string[] = [];
    const store: ChatRunControlStore = {
      getThreadRootId: (chatJid, messageId) => (chatJid === "web:1" && messageId === "m1" ? 42 : null),
      getFailedRun: () => ({ failedTs: "2026-03-27T20:10:00.000Z" }),
      getChatCursor: () => "2026-03-27T20:00:00.000Z",
      setChatCursor: (chatJid, ts) => {
        setCalls.push({ chatJid, ts });
      },
      clearFailedRun: (chatJid) => {
        clearCalls.push(chatJid);
      },
    };

    const service = new WebChannelRuntimeStateService(
      {
        getAssistantName: () => "Pi",
        getChatCursor: () => "cursor",
        enqueue: async () => {},
        processChat: async () => {},
      },
      {
        defaultAgentId: "default",
        stateKey: "state-key",
      }
    );

    expect(service.getThreadRootId("web:1", "m1", store)).toBe(42);
    service.skipFailedOnModelSwitch("web:1", store);

    expect(setCalls).toEqual([{ chatJid: "web:1", ts: "2026-03-27T20:10:00.000Z" }]);
    expect(clearCalls).toEqual(["web:1"]);
  });
});
