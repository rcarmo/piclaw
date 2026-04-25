import { describe, expect, test } from "bun:test";
import "../../helpers.ts";
import { beginChatRun, getChatCursor, getInflightMessageId, initDatabase } from "../../../src/db.js";
import { handleAgentMessage } from "../../../src/channels/web/handlers/agent.ts";

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

  test("surfaces a successful /session-rotate result immediately when the chat is idle", async () => {
    initDatabase();

    const queuedFollowups: Array<{ chatJid: string; content: string }> = [];
    const sentMessages: Array<{ chatJid: string; content: string; threadId: number | null }> = [];
    const broadcasts: Array<{ event: string; payload: unknown }> = [];
    let applyCalls = 0;

    const channel = {
      agentPool: {
        isStreaming: () => false,
        isActive: () => false,
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
      updateAgentStatus: () => {},
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
