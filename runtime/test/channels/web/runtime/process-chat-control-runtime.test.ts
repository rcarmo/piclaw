import { describe, expect, test } from "bun:test";
import {
  executeDeferredControlCommand,
  materializeDeferredFollowups,
  selectProcessChatMessage,
  type DeferredControlCommandRuntime,
  type ProcessChatCursorStore,
  type ProcessChatMessageSelectionStore,
  type QueuedFollowupMaterializationRuntime,
} from "../../../../src/channels/web/runtime/process-chat-control-runtime.js";
import type { InteractionRow } from "../../../../src/db.js";
import type { QueuedFollowupItem } from "../../../../src/queued-followups.js";
import type { NewMessage } from "../../../../src/types.js";

function makeMessage(id: string, timestamp: string, threadId?: number | null): NewMessage {
  return {
    id,
    chat_jid: "web:test",
    sender: "user",
    sender_name: "User",
    content: `message:${id}`,
    timestamp,
    thread_id: threadId,
  };
}

describe("process chat control runtime", () => {
  test('accepted input remains queued beyond the legacy terminal retry limit', async () => {
    let item: QueuedFollowupItem = { rowId: -1, queuedContent: 'accepted', queuedAt: '2026-01-01T00:00:00Z',
      source_id: 'source-00000000-0000-4000-8000-000000000001', source_accepted: true, materializeRetries: 5 };
    let drops = 0, broadcasts = 0;
    const channel = { peekQueuedFollowupItem: () => item, storeMessage: () => null,
      consumeQueuedFollowupItem() { drops++; return item; },
      replaceQueuedFollowupItem(_chat: string, replacement: QueuedFollowupItem) { item = replacement; return true; },
      broadcastEvent() { broadcasts++; } } as unknown as QueuedFollowupMaterializationRuntime;
    const result = await materializeDeferredFollowups({ channel, chatJid: 'web:test', agentId: 'default' });
    expect(result.status).toBe('retried');
    expect(item.materializeRetries).toBe(6);
    expect(item.source_accepted).toBe(true);
    expect(drops).toBe(0);
    expect(broadcasts).toBe(0);
  });
  test("selectProcessChatMessage returns no_messages when the persisted frontier is empty", () => {
    const store: ProcessChatMessageSelectionStore = {
      getMessagesSince: () => [],
      getFailedRun: () => undefined,
      clearFailedRun: () => {},
      setChatCursor: () => {},
    };

    expect(selectProcessChatMessage({
      chatJid: "web:test",
      prevCursor: "2024-01-01T00:00:00.000Z",
      assistantName: "Pi",
      store,
    })).toEqual({ kind: "no_messages", pendingMessages: [] });
  });

  test("selectProcessChatMessage clears a stale failed-run marker and signals whether replay should continue", () => {
    const messages = [
      makeMessage("m1", "2024-01-01T00:00:01.000Z"),
      makeMessage("m2", "2024-01-01T00:00:02.000Z"),
    ];
    const cleared: string[] = [];
    const cursorWrites: Array<{ chatJid: string; ts: string }> = [];

    const store: ProcessChatMessageSelectionStore = {
      getMessagesSince: () => messages,
      getFailedRun: () => ({
        prevTs: "2024-01-01T00:00:00.000Z",
        failedTs: "2024-01-01T00:00:01.000Z",
        messageId: "m1",
        threadRootId: 41,
        createdAt: "2024-01-01T00:00:03.000Z",
      }),
      clearFailedRun: (chatJid) => {
        cleared.push(chatJid);
      },
      setChatCursor: (chatJid, ts) => {
        cursorWrites.push({ chatJid, ts });
      },
    };

    const selection = selectProcessChatMessage({
      chatJid: "web:test",
      prevCursor: "2024-01-01T00:00:00.000Z",
      assistantName: "Pi",
      store,
    });

    expect(selection).toMatchObject({
      kind: "stale_failed_run_cleared",
      currentMessage: expect.objectContaining({ id: "m1" }),
      shouldResume: true,
    });
    expect(cleared).toEqual(["web:test"]);
    expect(cursorWrites).toEqual([{ chatJid: "web:test", ts: "2024-01-01T00:00:01.000Z" }]);
  });

  test("selectProcessChatMessage prefers the persisted message thread root over the queued frontier", () => {
    const store: ProcessChatMessageSelectionStore = {
      getMessagesSince: () => [makeMessage("m1", "2024-01-01T00:00:01.000Z", 42)],
      getFailedRun: () => undefined,
      clearFailedRun: () => {},
      setChatCursor: () => {},
    };

    const selection = selectProcessChatMessage({
      chatJid: "web:test",
      prevCursor: "",
      threadRootId: 77,
      assistantName: "Pi",
      store,
    });

    expect(selection).toMatchObject({
      kind: "message",
      currentMessage: expect.objectContaining({ id: "m1" }),
      messageThreadId: 42,
      effectiveThreadRootId: 42,
    });
  });

  test("executeDeferredControlCommand preserves model-switch side effects and advances the cursor before resuming", async () => {
    const sends: Array<{ chatJid: string; text: string; options?: unknown }> = [];
    const broadcasts: Array<{ event: string; payload: any }> = [];
    const resumeCalls: Array<{ chatJid: string; threadRootId?: number | null }> = [];
    const statusUpdates: Array<Record<string, unknown>> = [];
    const contextUpdates: Array<Record<string, unknown> | null> = [];
    const cursorHistory: string[] = [];
    let cursor = "2024-01-01T00:00:00.000Z";
    let saveCalls = 0;
    let remainingReads = 0;

    const cursorStore: ProcessChatCursorStore = {
      getChatCursor: () => cursor,
      setChatCursor: (_chatJid, ts) => {
        cursor = ts;
        cursorHistory.push(ts);
      },
      getMessagesSince: () => {
        remainingReads += 1;
        return [];
      },
    };

    const channel: DeferredControlCommandRuntime = {
      agentPool: {
        applyControlCommand: async () => ({
          status: "success",
          message: "Model set to openai/gpt-5.",
          model_label: "openai/gpt-5",
          thinking_level: "high",
          thinking_level_label: "High",
        }),
        getAvailableModels: async () => ({
          current: "openai/gpt-5",
          thinking_level: "high",
          thinking_level_label: "High",
          supports_thinking: true,
          models: [],
          provider_usage: null,
          available_thinking_levels: [],
          available_thinking_level_labels: [],
        }),
        getCurrentModelLabel: async () => "openai/gpt-5",
        getContextUsageForChat: async () => null,
      },
      sendMessage: async (chatJid, text, options) => {
        sends.push({ chatJid, text, options });
      },
      setContextUsage: (_chatJid, usage) => {
        contextUpdates.push(usage);
      },
      updateAgentStatus: (_chatJid, status) => {
        statusUpdates.push(status);
      },
      broadcastEvent: (event, payload) => {
        broadcasts.push({ event, payload });
      },
      saveState: () => {
        saveCalls += 1;
      },
      retryFailedOnModelSwitch: () => true,
      resumeChat: (chatJid, threadRootId) => {
        resumeCalls.push({ chatJid, threadRootId });
      },
    };

    const action = await executeDeferredControlCommand({
      channel,
      chatJid: "web:test",
      agentId: "default",
      command: { type: "model", provider: "openai", modelId: "gpt-5" } as any,
      message: {
        rowId: 19,
        messageId: "m1",
        content: "/model openai/gpt-5",
        timestamp: "2024-01-01T00:00:01.000Z",
        threadId: 88,
      },
      effectiveThreadRootId: 88,
      assistantName: "Pi",
      cursorStore,
    });

    expect(action).toBe("resumed");
    expect(cursorHistory).toEqual(["2024-01-01T00:00:01.000Z"]);
    expect(saveCalls).toBe(1);
    expect(remainingReads).toBe(0);
    expect(sends).toEqual([
      {
        chatJid: "web:test",
        text: "Model set to openai/gpt-5.",
        options: { threadId: 88 },
      },
    ]);
    expect(statusUpdates).toEqual([]);
    expect(contextUpdates).toEqual([]);
    expect(broadcasts).toContainEqual({
      event: "model_changed",
      payload: expect.objectContaining({
        chat_jid: "web:test",
        model: "openai/gpt-5",
        thinking_level: "high",
      }),
    });
    expect(resumeCalls).toEqual([{ chatJid: "web:test", threadRootId: undefined }]);
  });

  test("executeDeferredControlCommand emits only a reset when compact usage came from a replaced session", async () => {
    const contextUpdates: Array<Record<string, unknown> | null> = [];
    const statusUpdates: Array<Record<string, unknown>> = [];
    const broadcasts: Array<{ event: string; payload: any }> = [];
    let cursor = "";
    const cursorStore: ProcessChatCursorStore = {
      getChatCursor: () => cursor,
      setChatCursor: (_chatJid, ts) => { cursor = ts; },
      getMessagesSince: () => [],
    };
    const channel: DeferredControlCommandRuntime = {
      agentPool: {
        applyControlCommand: async () => ({
          status: "success",
          message: "Compaction complete.",
          sessionGeneration: "session-new",
          sessionGenerationChanged: true,
          contextUsage: {
            tokens: 95_000,
            contextWindow: 100_000,
            percent: 95,
            sessionGeneration: "session-old",
          },
        }),
        getAvailableModels: async () => ({ models: [] } as any),
        getCurrentModelLabel: async () => null,
        getContextUsageForChat: async () => null,
        getSessionGenerationForChat: () => "session-new",
      },
      sendMessage: async () => {},
      setContextUsage: (_chatJid, usage) => { contextUpdates.push(usage); },
      updateAgentStatus: (_chatJid, status) => { statusUpdates.push(status); },
      broadcastEvent: (event, payload) => { broadcasts.push({ event, payload }); },
      saveState: () => {},
      retryFailedOnModelSwitch: () => false,
      resumeChat: () => {},
    };

    await executeDeferredControlCommand({
      channel,
      chatJid: "web:test",
      agentId: "default",
      command: { type: "compact", raw: "/compact" } as any,
      message: {
        rowId: 20,
        messageId: "m2",
        content: "/compact",
        timestamp: "2024-01-01T00:00:02.000Z",
        threadId: 89,
      },
      effectiveThreadRootId: 89,
      assistantName: "Pi",
      cursorStore,
    });

    expect(contextUpdates).toEqual([{
      tokens: null,
      contextWindow: null,
      percent: null,
      sessionGeneration: "session-new",
      reset: true,
    }]);
    expect(statusUpdates).toHaveLength(3);
    expect(statusUpdates.map(status => status.type)).toEqual(["intent", "context_usage", "done"]);
    expect(new Set(statusUpdates.map(status => status.turn_id)).size).toBe(1);
    expect(statusUpdates[1]).toMatchObject({
      type: "context_usage",
      context_reset: true,
      sessionGeneration: "session-new",
      context_usage: {
        tokens: null,
        contextWindow: null,
        percent: null,
        sessionGeneration: "session-new",
      },
    });
    expect(broadcasts).toContainEqual({ event: "agent_status", payload: statusUpdates[0] });
  });

  test("materializeDeferredFollowups drains deferred commands before resuming the next persisted prompt turn", async () => {
    const queued: QueuedFollowupItem[] = [
      {
        rowId: -1,
        queuedContent: "/compact now",
        threadId: null,
        queuedAt: "2024-01-01T00:00:01.000Z",
        source: "queue:test",
        materializeRetries: 0,
      },
      {
        rowId: -2,
        queuedContent: "queued user",
        threadId: null,
        queuedAt: "2024-01-01T00:00:02.000Z",
        materializeRetries: 0,
      },
    ];
    const sends: Array<{ chatJid: string; text: string; options?: unknown }> = [];
    const broadcasts: Array<{ event: string; payload: any }> = [];
    const resumeCalls: Array<{ chatJid: string; threadRootId?: number | null }> = [];
    const stored: InteractionRow[] = [];
    let cursor = "";
    let nextRowId = 101;

    const cursorStore: ProcessChatCursorStore = {
      getChatCursor: () => cursor,
      setChatCursor: (_chatJid, ts) => {
        cursor = ts;
      },
      getMessagesSince: () => [],
    };

    const channel: QueuedFollowupMaterializationRuntime = {
      agentPool: {
        applyControlCommand: async () => ({
          status: "success",
          message: "Compaction complete.",
        }),
        getAvailableModels: async () => ({
          current: null,
          thinking_level: null,
          thinking_level_label: null,
          supports_thinking: false,
          models: [],
          provider_usage: null,
          available_thinking_levels: [],
          available_thinking_level_labels: [],
        }),
        getCurrentModelLabel: async () => null,
        getContextUsageForChat: async () => null,
      },
      sendMessage: async (chatJid, text, options) => {
        sends.push({ chatJid, text, options });
      },
      setContextUsage: () => {},
      updateAgentStatus: () => {},
      broadcastEvent: (event, payload) => {
        broadcasts.push({ event, payload });
      },
      saveState: () => {},
      retryFailedOnModelSwitch: () => false,
      resumeChat: (chatJid, threadRootId) => {
        resumeCalls.push({ chatJid, threadRootId });
      },
      peekQueuedFollowupItem: () => queued[0] ?? null,
      consumeQueuedFollowupItem: () => queued.shift() ?? null,
      prependQueuedFollowupItem: (chatJid, item) => {
        expect(chatJid).toBe("web:test");
        queued.unshift(item);
      },
      replaceQueuedFollowupItem: (chatJid, item) => {
        expect(chatJid).toBe("web:test");
        const index = queued.findIndex((entry) => entry.rowId === item.rowId);
        if (index < 0) return false;
        queued[index] = item;
        return true;
      },
      storeMessage: (_chatJid, content, _isBot, _mediaIds, options) => {
        const queuedIndex = queued.findIndex((item) => item.rowId === options?.consumeDeferredFollowupRowId);
        if (queuedIndex < 0) return null;
        queued.splice(queuedIndex, 1);
        const row: InteractionRow = {
          id: nextRowId,
          timestamp: `2024-01-01T00:00:0${nextRowId - 100}.000Z`,
          data: {
            content,
            thread_id: options?.threadId ?? nextRowId,
          } as any,
        };
        nextRowId += 1;
        stored.push(row);
        return row;
      },
    };

    const result = await materializeDeferredFollowups({
      channel,
      chatJid: "web:test",
      agentId: "default",
      assistantName: "Pi",
      cursorStore,
    });

    expect(result).toEqual({ status: "resumed", rowId: 102 });
    expect(stored.map((row) => row.data.content)).toEqual(["/compact now", "queued user"]);
    expect(sends).toEqual([
      {
        chatJid: "web:test",
        text: "Compaction complete.",
        options: { threadId: 101 },
      },
    ]);
    expect(resumeCalls).toEqual([{ chatJid: "web:test", threadRootId: 102 }]);
    expect(broadcasts.filter((entry) => entry.event === "agent_followup_consumed").map((entry) => entry.payload.row_id)).toEqual([-1, -2]);
    expect(broadcasts.filter((entry) => entry.event === "new_post")).toHaveLength(2);
  });
});
