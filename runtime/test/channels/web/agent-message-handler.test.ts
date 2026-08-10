import { describe, expect, test } from "bun:test";
import "../../helpers.ts";
import {
  beginChatRun,
  cancelChatOperation,
  claimNextChatOperation,
  completeChatOperation,
  disposeChatOperationIntent,
  fenceChatOperationSettlement,
  getChatCursor,
  getChatOperation,
  getInflightMessageId,
  getMessageByRowId,
  getMessageRowIdById,
  initDatabase,
  registerAcceptedChatSource,
  registerChatOperationIntent,
  storeMessage,
} from "../../../src/db.js";
import { handleAgentMessage } from "../../../src/channels/web/handlers/agent.ts";

function cleanupActiveOperation(chatJid: string): void {
  let operation = getChatOperation(chatJid);
  if (!operation) return;
  const owner = {
    operationId: operation.operationId,
    sourceSeq: operation.sourceSeq,
    phase: operation.phase,
    generation: operation.generation,
  };
  if (!operation.cancellation) {
    const cancellation = cancelChatOperation(chatJid, owner, {
      cause: "test_cleanup",
      requestedAt: "2026-08-08T09:02:00.000Z",
    });
    if (cancellation.status !== "applied") return;
    operation = cancellation.operation;
  }
  completeChatOperation(chatJid, {
    owner: {
      operationId: operation.operationId,
      sourceSeq: operation.sourceSeq,
      phase: operation.phase,
      generation: operation.generation,
    },
    outcome: "cancelled",
    cause: operation.cancellation?.cause ?? "test_cleanup",
    provenance: "agent_message_handler_test_cleanup",
    createdAt: "2026-08-08T09:02:01.000Z",
  });
}

describe("web agent message handler", () => {
  test("handles /meters as a UI-only command while still returning command output as an assistant message", async () => {
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; options: unknown }> = [];

    const channel = {
      agentPool: {
        isStreaming: () => false,
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: () => 999,
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      storeMessage: () => null,
      sendMessage: async (chatJid: string, content: string, options: unknown) => {
        sentMessages.push({ chatJid, content, options });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/meters on" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ui_only).toBe(true);
    expect(body.command?.status).toBe("success");
    expect(body.command?.payload).toEqual({ mode: "set", enabled: true });
    expect(broadcasts.some((entry) => entry.event === "ui_meters")).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].content).toBe(body.command.message);
  });

  test("handles /theme as a UI-only command while still returning command output as an assistant message", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; options: unknown }> = [];
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => true,
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 999;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      storeMessage: () => {
        storeMessageCalls += 1;
        return null;
      },
      sendMessage: async (chatJid: string, content: string, options: unknown) => {
        sentMessages.push({ chatJid, content, options });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/theme gruvbox" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ui_only).toBe(true);
    expect(body.thread_id).toBeNull();
    expect(body.command?.status).toBe("success");
    expect(queuedFollowups).toHaveLength(0);
    expect(storeMessageCalls).toBe(0);
    expect(broadcasts.some((entry) => entry.event === "ui_theme")).toBe(true);
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(false);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].content).toBe(body.command.message);
    expect((sentMessages[0].options as { forceRoot?: boolean })?.forceRoot).toBe(true);
  });

  test("shows the themed /theme table when command is used without a theme name", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const broadcasts: Array<{ event: string; payload: unknown }> = [];

    const channel = {
      agentPool: {
        isStreaming: () => true,
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 999;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      storeMessage: () => null,
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/theme" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ui_only).toBe(true);
    expect(body.command?.status).toBe("success");
    expect(body.command?.message).toContain("| Theme | Mode | Swatches |");
    expect(body.command?.message).toContain("data:image/svg+xml;base64,");
    expect(queuedFollowups).toHaveLength(0);
  });

  test("handles /abort as a UI-only hard stop without writing a timeline command message", async () => {
    initDatabase();
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    const applyCalls: Array<{ chatJid: string; command: { type: string; raw: string } }> = [];
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => true,
        isActive: () => true,
        applyControlCommand: async (chatJid: string, command: { type: string; raw: string }) => {
          applyCalls.push({ chatJid, command });
          return { status: "success", message: "Aborted current response." };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: () => 0,
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      storeMessage: () => {
        storeMessageCalls += 1;
        return null;
      },
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/abort" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ui_only).toBe(true);
    expect(body.immediate).toBe(true);
    expect(body.command?.message).toBe("Aborted current response.");
    expect(applyCalls).toEqual([{ chatJid: "web:default", command: { type: "abort", raw: "/abort" } }]);
    expect(storeMessageCalls).toBe(0);
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(false);
  });

  test("routes durable /abort through cancellation before physical session abort", async () => {
    const chatJid = "web:durable-local-abort";
    const operation = { operationId: "operation-exact" };
    const cancellationCalls: unknown[][] = [];
    const resumes: string[] = [];
    let legacyAbortCalls = 0;
    const channel = {
      agentPool: {
        isStreaming: () => true,
        isActive: () => true,
        cancelOperationAndAbort: async (...args: unknown[]) => {
          cancellationCalls.push(args);
          return { status: "cancelled", physicallyAborted: true, operation };
        },
        applyControlCommand: async () => {
          legacyAbortCalls += 1;
          return { status: "success", message: "legacy" };
        },
      },
      resumeChat: (nextChatJid: string) => { resumes.push(nextChatJid); },
      json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      enqueueQueuedFollowupItem: () => 0,
      getQueuedFollowupCount: () => 0,
      broadcastEvent: () => {},
      storeMessage: () => null,
      sendMessage: async () => {},
    } as any;

    const response = await handleAgentMessage(channel, new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/abort", expected_operation_id: operation.operationId }),
    }), "/agent/default/message", chatJid, "default");
    const body = await response.json();

    expect(cancellationCalls).toEqual([[chatJid, operation.operationId, "user_abort"]]);
    expect(legacyAbortCalls).toBe(0);
    expect(resumes).toEqual([chatJid]);
    expect(body.command).toMatchObject({
      status: "success",
      cancellation_status: "cancelled",
      physically_aborted: true,
    });
  });

  test("treats an already-cancelled exact compose abort as an idempotent success", async () => {
    const chatJid = "web:repeated-local-abort";
    const operationId = "operation-already-cancelled";
    const resumes: string[] = [];
    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => false,
        cancelOperationAndAbort: async () => ({
          status: "cancelled",
          reason: "already_cancelled",
          physicallyAborted: false,
          operation: null,
        }),
      },
      resumeChat: (nextChatJid: string) => { resumes.push(nextChatJid); },
      json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      enqueueQueuedFollowupItem: () => 0,
      getQueuedFollowupCount: () => 0,
      broadcastEvent: () => {},
      storeMessage: () => null,
      sendMessage: async () => {},
    } as any;

    const response = await handleAgentMessage(channel, new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/abort", expected_operation_id: operationId }),
    }), "/agent/default/message", chatJid, "default");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resumes).toEqual([]);
    expect(body.command).toMatchObject({
      status: "success",
      message: "Operation cancellation was already persisted.",
      cancellation_status: "cancelled",
      physically_aborted: false,
    });
  });

  test("rejects a stale compose abort without cancelling the replacement operation", async () => {
    const chatJid = "web:stale-local-abort";
    const operation = { operationId: "operation-replacement" };
    const cancellationCalls: unknown[][] = [];
    const resumes: string[] = [];
    const channel = {
      agentPool: {
        isStreaming: () => true,
        isActive: () => true,
        cancelOperationAndAbort: async (_chatJid: string, expectedOperationId: string, cause: string) => {
          cancellationCalls.push([_chatJid, expectedOperationId, cause]);
          return expectedOperationId === operation.operationId
            ? { status: "cancelled", physicallyAborted: true, operation }
            : { status: "no_op", reason: "operation_mismatch", physicallyAborted: false, operation };
        },
      },
      resumeChat: (nextChatJid: string) => { resumes.push(nextChatJid); },
      json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      enqueueQueuedFollowupItem: () => 0,
      getQueuedFollowupCount: () => 0,
      broadcastEvent: () => {},
      storeMessage: () => null,
      sendMessage: async () => {},
    } as any;

    const response = await handleAgentMessage(channel, new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/abort", expected_operation_id: "op-stale" }),
    }), "/agent/default/message", chatJid, "default");
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(cancellationCalls).toEqual([[chatJid, "op-stale", "user_abort"]]);
    expect(resumes).toEqual([]);
    expect(body).toMatchObject({
      error: "The active operation changed before cancellation; no action was taken.",
      reason: "operation_mismatch",
      expected_operation_id: "op-stale",
      observed_operation_id: operation.operationId,
    });
  });

  test("runs /compact immediately while the current session is still active", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; options: unknown }> = [];
    const broadcasts: Array<{ event: string; payload: any }> = [];
    const statusUpdates: Array<{ chatJid: string; status: any }> = [];
    const contextUsages: Array<{ chatJid: string; usage: any }> = [];
    let applyCalls = 0;
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => true,
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string }) => {
          applyCalls += 1;
          expect(command.type).toBe("compact");
          return {
            status: "success",
            message: "Compaction requested immediately.",
            contextUsage: {
              tokens: 321,
              contextWindow: 1000,
              percent: 32.1,
              estimated: true,
              source: "compact_command",
              phase: "after_manual_compaction",
            },
          };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 456;
      },
      getQueuedFollowupCount: () => 0,
      getAgentStatus: () => null,
      broadcastEvent: (event: string, payload: any) => broadcasts.push({ event, payload }),
      updateAgentStatus: (chatJid: string, status: any) => statusUpdates.push({ chatJid, status }),
      setContextUsage: (chatJid: string, usage: any) => contextUsages.push({ chatJid, usage }),
      storeMessage: () => {
        storeMessageCalls += 1;
        return {
          id: 456,
          timestamp: "2026-03-14T21:10:00.000Z",
          data: { thread_id: null },
          content: "/compact keep current work",
        };
      },
      sendMessage: async (chatJid: string, content: string, options: unknown) => {
        sentMessages.push({ chatJid, content, options });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/compact keep current work" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.command?.status).toBe("success");
    expect(queuedFollowups).toHaveLength(0);
    expect(applyCalls).toBe(1);
    expect(storeMessageCalls).toBe(1);
    expect(sentMessages[0]?.content).toBe("Compaction requested immediately.");
    expect(contextUsages).toEqual([{ chatJid: "web:default", usage: { tokens: 321, contextWindow: 1000, percent: 32.1 } }]);
    expect(statusUpdates.some((entry) => entry.chatJid === "web:default" && entry.status.type === "context_usage")).toBe(true);
    expect(broadcasts).toContainEqual(expect.objectContaining({
      event: "agent_status",
      payload: expect.objectContaining({
        chat_jid: "web:default",
        type: "context_usage",
        context_usage: expect.objectContaining({
          tokens: 321,
          contextWindow: 1000,
          percent: 32.1,
          estimated: true,
          source: "compact_command",
          phase: "after_manual_compaction",
        }),
      }),
    }));
  });

  test("runs /model immediately while the current session is still active", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    let applyCalls = 0;
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => true,
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string }) => {
          applyCalls += 1;
          expect(command.type).toBe("model");
          return { status: "success", message: "Model set.", model_label: "openai/gpt-4.1" };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 458;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: () => {},
      retryFailedOnModelSwitch: () => false,
      storeMessage: () => {
        storeMessageCalls += 1;
        return null;
      },
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/model openai/gpt-4.1" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.ui_only).toBe(true);
    expect(body.command?.status).toBe("success");
    expect(queuedFollowups).toHaveLength(0);
    expect(applyCalls).toBe(1);
    expect(storeMessageCalls).toBe(0);
  });

  test("runs /model --compact immediately while the current session is still active", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    let applyCalls = 0;
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => true,
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string; compact?: boolean }) => {
          applyCalls += 1;
          expect(command.type).toBe("model");
          expect(command.compact).toBe(true);
          return { status: "success", message: "Compacted and switched.", model_label: "openai/gpt-4.1" };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 457;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: () => {},
      retryFailedOnModelSwitch: () => false,
      storeMessage: () => {
        storeMessageCalls += 1;
        return null;
      },
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/model openai/gpt-4.1 --compact" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.ui_only).toBe(true);
    expect(body.command?.status).toBe("success");
    expect(queuedFollowups).toHaveLength(0);
    expect(applyCalls).toBe(1);
    expect(storeMessageCalls).toBe(0);
  });

  test("does not defer /session-rotate while streaming and returns the command error immediately", async () => {
    initDatabase();

    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; threadId: number | null }> = [];
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    let applyCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => true,
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string }) => {
          applyCalls += 1;
          expect(command.type).toBe("session_rotate");
          return {
            status: "error",
            message: "Cannot rotate the session while a response, compaction, or retry is active.",
          };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 111;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      updateAgentStatus: () => {},
      skipFailedOnModelSwitch: () => {},
      storeMessage: (_chatJid: string, content: string) => ({
        id: 321,
        timestamp: "2026-03-14T21:10:00.000Z",
        data: { thread_id: null },
        content,
      }),
      sendMessage: async (chatJid: string, content: string, threadId: number | null) => {
        sentMessages.push({ chatJid, content, threadId });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/session-rotate keep active context" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.command?.status).toBe("error");
    expect(body.command?.message).toContain("Cannot rotate the session while a response");
    expect(applyCalls).toBe(1);
    expect(queuedFollowups).toHaveLength(0);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.content).toContain("Cannot rotate the session while a response");
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(true);
  });

  test("does not advance the chat cursor for commands while another turn is inflight", async () => {
    initDatabase();

    const chatJid = "web:default";
    const inflightTimestamp = "2026-03-14T21:00:00.000Z";
    beginChatRun(chatJid, inflightTimestamp, {
      prevTs: "2026-03-14T20:59:00.000Z",
      messageId: "active-message-id",
      startedAt: "2026-03-14T21:00:00.100Z",
    });

    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; options: unknown }> = [];

    const channel = {
      agentPool: {
        isStreaming: () => true,
        isActive: () => true,
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string }) => {
          expect(command.type).toBe("tree");
          expect(command.raw).toBe("/tree");
          return {
            status: "success",
            message: "tree output",
          };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: () => 0,
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      updateAgentStatus: () => {},
      storeMessage: () => ({
        id: 987,
        timestamp: "2026-03-14T21:05:00.000Z",
        data: { thread_id: null },
        content: "/tree",
      }),
      sendMessage: async (targetChatJid: string, content: string, options: unknown) => {
        sentMessages.push({ chatJid: targetChatJid, content, options });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/tree" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", chatJid, "default");
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.command?.status).toBe("success");
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.content).toBe("tree output");
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(true);
    expect(getChatCursor(chatJid)).toBe(inflightTimestamp);
    expect(getInflightMessageId(chatJid)).toBe("active-message-id");
  });

  test("runs extension-style slash commands immediately while the current session is active", async () => {
    initDatabase();

    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; options: unknown }> = [];
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    let applySlashCalls = 0;
    let storeMessageCalls = 0;

    const channel = {
      lastCommandInteractionId: null,
      agentPool: {
        isStreaming: () => false,
        isActive: () => true,
        applySlashCommand: async (_chatJid: string, rawText: string) => {
          applySlashCalls += 1;
          expect(rawText).toBe("/custom-extension do it");
          return { status: "success", message: "extension command ran" };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 222;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      updateAgentStatus: () => {},
      storeMessage: () => {
        storeMessageCalls += 1;
        return {
          id: 222,
          timestamp: "2026-03-14T21:15:00.000Z",
          data: { thread_id: null },
          content: "/custom-extension do it",
        };
      },
      sendMessage: async (chatJid: string, content: string, options: unknown) => {
        sentMessages.push({ chatJid, content, options });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/custom-extension do it" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.command?.status).toBe("success");
    expect(queuedFollowups).toHaveLength(0);
    expect(applySlashCalls).toBe(1);
    expect(storeMessageCalls).toBe(1);
    expect(sentMessages[0]?.content).toBe("extension command ran");
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(true);
  });

  test("surfaces a successful /session-rotate result immediately when the chat is idle", async () => {
    initDatabase();

    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; threadId: number | null }> = [];
    const broadcasts: Array<{ event: string; payload: any }> = [];
    const statusUpdates: Array<Record<string, any>> = [];
    const contextUsages: Array<Record<string, any>> = [];
    let applyCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => false,
        getCurrentModelLabel: async () => "github-copilot/gpt-5.4",
        getAvailableModels: async () => ({
          current: "github-copilot/gpt-5.4",
          thinking_level: "high",
          thinking_level_label: "High",
          supports_thinking: true,
        }),
        getContextUsageForChat: async () => ({ tokens: 4_096, contextWindow: 128_000, percent: 3.2 }),
        applyControlCommand: async (_chatJid: string, command: { type: string; raw: string }) => {
          applyCalls += 1;
          expect(command.type).toBe("session_rotate");
          return {
            status: "success",
            message: [
              "Session rotated.",
              "Archived previous session: /tmp/archive/session.jsonl",
              "New session: /tmp/session.jsonl",
            ].join("\n"),
          };
        },
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 222;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
      getAgentStatus: () => statusUpdates.at(-1) ?? null,
      updateAgentStatus: (_chatJid: string, status: Record<string, any>) => { statusUpdates.push(status); },
      setContextUsage: (_chatJid: string, usage: Record<string, any>) => { contextUsages.push(usage); },
      skipFailedOnModelSwitch: () => {},
      storeMessage: (_chatJid: string, content: string) => ({
        id: 654,
        timestamp: "2026-03-14T21:20:00.000Z",
        data: { thread_id: null },
        content,
      }),
      sendMessage: async (chatJid: string, content: string, threadId: number | null) => {
        sentMessages.push({ chatJid, content, threadId });
      },
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "/session-rotate keep active context" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.queued).toBeUndefined();
    expect(body.command?.status).toBe("success");
    expect(body.command?.message).toContain("Session rotated.");
    expect(applyCalls).toBe(1);
    expect(queuedFollowups).toHaveLength(0);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.content).toContain("Archived previous session:");
    expect(statusUpdates[0]).toMatchObject({
      type: "intent",
      intent_key: "session_rotation",
      title: "Rotating session",
      model: "github-copilot/gpt-5.4",
    });
    expect(statusUpdates.some((status) => status.type === "context_usage" && status.context_usage?.tokens === 4_096)).toBe(true);
    expect(contextUsages).toContainEqual({ tokens: 4_096, contextWindow: 128_000, percent: 3.2 });
    expect(broadcasts).toContainEqual(expect.objectContaining({
      event: "model_changed",
      payload: expect.objectContaining({ chat_jid: "web:default", model: "github-copilot/gpt-5.4" }),
    }));
    expect(statusUpdates.at(-1)).toMatchObject({ type: "done", title: "Completed /session-rotate" });
    expect(broadcasts.some((entry) => entry.event === "new_post")).toBe(true);
  });

  test("defers a normal user turn while the chat is still active even if streaming already settled", async () => {
    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    let storeMessageCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => true,
      },
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      enqueueQueuedFollowupItem: (chatJid: string, _rowId: number, content: string) => {
        queuedFollowups.push({ chatJid, content });
        return 777;
      },
      getQueuedFollowupCount: () => 0,
      broadcastEvent: () => {},
      storeMessage: () => {
        storeMessageCalls += 1;
        return null;
      },
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/default/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "follow up while compacting" }),
    });

    const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.queued).toBe("followup");
    expect(queuedFollowups).toEqual([{ chatJid: "web:default", content: "follow up while compacting" }]);
    expect(storeMessageCalls).toBe(0);
  });

  test("reports a disposed steer replay as failed without another SDK queue effect", async () => {
    initDatabase();
    const chatJid = `web:disposed-steer-replay-${crypto.randomUUID()}`;
    registerAcceptedChatSource({
      chatJid,
      sourceClass: "prompt",
      sourceKind: "queued_followup",
      sourceId: "disposed-replay-root",
      acceptedAt: "2026-08-09T12:00:00.000Z",
      payloadRef: "followup:disposed-replay-root",
    });
    const operation = claimNextChatOperation(chatJid).operation;
    if (!operation) throw new Error("expected operation");
    const owner = {
      operationId: operation.operationId,
      sourceSeq: operation.sourceSeq,
      phase: operation.phase,
      generation: operation.generation,
    };
    const messageId = `disposed-steer-${crypto.randomUUID()}`;
    const acceptedAt = "2026-08-09T12:00:01.000Z";
    storeMessage({
      id: messageId,
      chat_jid: chatJid,
      sender: "user",
      sender_name: "User",
      content: "replay failed steer",
      timestamp: acceptedAt,
      is_from_me: false,
      is_bot_message: false,
      is_steering_message: true,
    });
    const registered = registerChatOperationIntent(chatJid, owner, {
      sourceKind: "steer", sourceId: messageId, acceptedAt, payloadRef: `message:${messageId}`,
    });
    if (registered.status === "rejected" || registered.status === "deferred") throw new Error("expected intent");
    expect(disposeChatOperationIntent(chatJid, owner, {
      sourceSeq: registered.source.sourceSeq,
      outcome: "failed",
      cause: "steer_queue_failed",
      provenance: "test_disposed_replay",
      createdAt: "2026-08-09T12:00:02.000Z",
    }).status).toBe("disposed");
    expect(fenceChatOperationSettlement(chatJid, owner, {
      fenceId: `disposed-replay-fence-${crypto.randomUUID()}`,
      fencedAt: "2026-08-09T12:00:03.000Z",
    }).status).toBe("fenced");
    const rowId = getMessageRowIdById(chatJid, messageId);
    const interaction = rowId ? getMessageByRowId(chatJid, rowId) : null;
    if (!interaction) throw new Error("expected replay interaction");

    const broadcasts: Array<{ event: string; payload: any }> = [];
    let sdkQueueEffects = 0;
    const channel = {
      agentPool: {
        isStreaming: () => true,
        isActive: () => true,
        queueStreamingMessage: async (_jid: string, _text: string, _behavior: string, request: any) => {
          const admission = request.beforeQueue();
          expect(admission).toEqual({ sourceSeq: registered.source.sourceSeq, queueEffect: "existing" });
          if (admission.queueEffect !== "existing") sdkQueueEffects += 1;
          return { queued: true, existing: true, operationIntentSourceSeq: admission.sourceSeq };
        },
      },
      json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      enqueueQueuedFollowupItem: () => 0,
      getQueuedFollowupCount: () => 0,
      broadcastEvent: (event: string, payload: unknown) => broadcasts.push({ event, payload }),
      storeMessage: () => interaction,
      sendMessage: async () => {},
    } as any;

    const req = new Request("https://example.com/agent/disposed/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "replay failed steer", mode: "steer", persist_steer: true }),
    });
    const response = await handleAgentMessage(channel, req, "/agent/disposed/message", chatJid, "disposed");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      queued: "steer_failed",
      error: "Steer was already disposed: steer_queue_failed",
    });
    expect(sdkQueueEffects).toBe(0);
    expect(broadcasts).toContainEqual(expect.objectContaining({
      event: "agent_steer_failed",
      payload: expect.objectContaining({ queued: "steer_failed" }),
    }));
    expect(broadcasts.some((entry) => entry.event === "agent_steer_queued")).toBe(false);
    cleanupActiveOperation(chatJid);
  });

  test("returns typed 400s for malformed agent message payload classes", async () => {
    const channel = {
      json: (payload: unknown, status = 200) =>
        new Response(JSON.stringify(payload), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
    } as any;

    const cases = [
      {
        name: "invalid json",
        body: "{",
        expectedError: "Invalid JSON",
      },
      {
        name: "non-object body",
        body: JSON.stringify(["bad"]),
        expectedError: "JSON body must be an object",
      },
      {
        name: "content wrong type",
        body: JSON.stringify({ content: 42 }),
        expectedError: "'content' must be a string",
      },
      {
        name: "mode wrong type",
        body: JSON.stringify({ content: "hello", mode: "sideways" }),
        expectedError: "'mode' must be one of: auto, queue, steer",
      },
      {
        name: "thread id wrong type",
        body: JSON.stringify({ content: "hello", thread_id: "nan" }),
        expectedError: "'thread_id' must be a positive integer or null",
      },
      {
        name: "expected operation id wrong type",
        body: JSON.stringify({ content: "/abort", expected_operation_id: 42 }),
        expectedError: "'expected_operation_id' must be a string",
      },
      {
        name: "expected operation id empty",
        body: JSON.stringify({ content: "/abort", expected_operation_id: "   " }),
        expectedError: "'expected_operation_id' must be between 1 and 128 characters",
      },
      {
        name: "content blocks wrong shape",
        body: JSON.stringify({ content: "hello", content_blocks: { type: "text" } }),
        expectedError: "'content_blocks' must be an array",
      },
      {
        name: "media ids wrong shape",
        body: JSON.stringify({ content: "hello", media_ids: { id: 1 } }),
        expectedError: "'media_ids' must be an array",
      },
      {
        name: "link previews wrong shape",
        body: JSON.stringify({ content: "hello", link_previews: "https://example.com" }),
        expectedError: "'link_previews' must be an array",
      },
      {
        name: "content too large",
        body: JSON.stringify({ content: "x".repeat(100 * 1024 + 1) }),
        expectedError: "Content too large (max 100 KB)",
      },
    ];

    for (const testCase of cases) {
      const req = new Request("https://example.com/agent/default/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: testCase.body,
      });

      const response = await handleAgentMessage(channel, req, "/agent/default/message", "web:default", "default");
      expect(response.status, testCase.name).toBe(400);
      expect((await response.json()).error, testCase.name).toBe(testCase.expectedError);
    }
  });
});
