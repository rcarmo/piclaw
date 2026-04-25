import { afterEach, expect, test } from "bun:test";
import { createTempWorkspace, setEnv } from "../../helpers.js";

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(async () => {
  try {
    const config = await import("../../../src/core/config.js");
    config.setWebTotpSecret("");
  } catch (_error) {
    void _error;
  }
  restoreEnv?.();
  restoreEnv = null;
  cleanupWorkspace?.();
  cleanupWorkspace = null;
});

async function initWebChannelFixture(chatJids: string[] = ["web:default"]) {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  const now = new Date().toISOString();
  for (const chatJid of chatJids) {
    db.storeChatMetadata(chatJid, now, "Web");
  }

  const webMod = await import("../../../src/channels/web.js");
  return { db, webMod };
}

test("web channel loadState clears stale statuses but preserves restart-restorable compaction status", async () => {
  const { webMod } = await initWebChannelFixture(["web:default", "web:compact"]);

  const first = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });

  const compactionStatus = {
    type: "intent",
    intent_key: "compaction",
    title: "Compacting context",
    started_at: "2026-03-14T14:00:00.000Z",
    turn_id: "turn-42",
  };

  first.updateAgentStatus("web:default", { type: "tool_call", title: "Running tool", turn_id: "turn-stale" });
  first.updateAgentStatus("web:compact", compactionStatus);

  const second = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });
  second.loadState();

  expect(second.getAgentStatus("web:default")).toBeNull();
  expect(second.getAgentStatus("web:compact")).toEqual(compactionStatus);
});

test("recoverInflightRuns persists buffered draft text across restart instead of showing an interrupted marker", async () => {
  const { db, webMod } = await initWebChannelFixture(["web:default"]);

  const userTs = new Date(Date.now() - 5_000).toISOString();
  const messageId = `msg-${Math.random()}`;
  db.storeMessage({
    id: messageId,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "draft please",
    timestamp: userTs,
    is_from_me: false,
    is_bot_message: false,
  });
  db.beginChatRun("web:default", userTs, {
    prevTs: "",
    messageId,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
  });

  const first = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });
  first.updateAgentStatus("web:default", { type: "thinking", title: "Thinking", turn_id: "turn-restart-draft" });
  first.updateDraftBuffer("turn-restart-draft", "Recovered draft after restart", 1);

  const second = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: { runAgent: async () => ({ status: "success", result: "unexpected recovery replay" }), getContextUsageForChat: async () => null },
  });
  second.loadState();
  second.recoverInflightRuns();

  const timeline = db.getTimeline("web:default", 10);
  const botMessages = timeline.filter((item: any) => item.data.type === "agent_response");
  expect(botMessages.some((item: any) => String(item.data.content || "").includes("Recovered draft after restart"))).toBe(true);
  expect(botMessages.some((item: any) => Array.isArray(item.data.content_blocks)
    && item.data.content_blocks.some((block: any) => block?.type === "turn_outcome_marker" && block?.kind === "interrupted"))).toBe(false);
});

test("recoverInflightRuns clears no-output inflight chats without replay while preserving partial and older terminal history", async () => {
  const chats = ["web:rollback", "web:partial", "web:older-terminal"];
  const { db, webMod } = await initWebChannelFixture(chats);

  const now = Date.now();

  const rollbackTs = new Date(now - 5_000).toISOString();
  const rollbackMessageId = `msg-${Math.random()}`;
  db.storeMessage({
    id: rollbackMessageId,
    chat_jid: "web:rollback",
    sender: "user",
    sender_name: "User",
    content: "rollback me",
    timestamp: rollbackTs,
    is_from_me: false,
    is_bot_message: false,
  });
  db.beginChatRun("web:rollback", rollbackTs, {
    prevTs: "",
    messageId: rollbackMessageId,
    startedAt: new Date(now - 31 * 60 * 1000).toISOString(),
  });

  const partialBaseMs = now - 15_000;
  const partialTs = new Date(partialBaseMs).toISOString();
  const partialReplyTs = new Date(partialBaseMs + 1_000).toISOString();
  const partialMessageId = `msg-${Math.random()}`;
  db.storeMessage({
    id: partialMessageId,
    chat_jid: "web:partial",
    sender: "user",
    sender_name: "User",
    content: "partial",
    timestamp: partialTs,
    is_from_me: false,
    is_bot_message: false,
  });
  db.beginChatRun("web:partial", partialTs, {
    prevTs: "",
    messageId: partialMessageId,
    startedAt: partialTs,
  });
  db.storeMessage({
    id: `bot-${Math.random()}`,
    chat_jid: "web:partial",
    sender: "web-agent",
    sender_name: "Pi",
    content: "partial reply",
    timestamp: partialReplyTs,
    is_from_me: false,
    is_bot_message: true,
    is_terminal_agent_reply: false,
  });

  const olderBaseMs = now - 31 * 60 * 1000;
  const prevUserTs = new Date(olderBaseMs).toISOString();
  const prevReplyTs = new Date(olderBaseMs + 1_000).toISOString();
  const currentUserTs = new Date(olderBaseMs + 2_000).toISOString();
  const startedAt = new Date(olderBaseMs + 3_000).toISOString();
  const currentMessageId = `msg-${Math.random()}`;
  db.storeMessage({
    id: `user-prev-${Math.random()}`,
    chat_jid: "web:older-terminal",
    sender: "user",
    sender_name: "User",
    content: "previous",
    timestamp: prevUserTs,
    is_from_me: false,
    is_bot_message: false,
  });
  db.storeMessage({
    id: `bot-prev-${Math.random()}`,
    chat_jid: "web:older-terminal",
    sender: "web-agent",
    sender_name: "Pi",
    content: "previous final",
    timestamp: prevReplyTs,
    is_from_me: false,
    is_bot_message: true,
    is_terminal_agent_reply: true,
  });
  db.storeMessage({
    id: currentMessageId,
    chat_jid: "web:older-terminal",
    sender: "user",
    sender_name: "User",
    content: "current",
    timestamp: currentUserTs,
    is_from_me: false,
    is_bot_message: false,
  });
  db.beginChatRun("web:older-terminal", currentUserTs, {
    prevTs: prevUserTs,
    messageId: currentMessageId,
    startedAt,
  });

  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({
        status: "success",
        result: "unexpected recovery replay",
        attachments: [],
      }),
      getContextUsageForChat: async () => null,
    },
  });

  web.recoverInflightRuns();

  expect(db.getInflightRuns().length).toBe(0);
  expect(db.getChatCursor("web:rollback")).toBe(rollbackTs);
  expect(db.getChatCursor("web:partial")).toBe(partialTs);

  const rollbackTimeline = db.getTimeline("web:rollback", 10);
  const partialTimeline = db.getTimeline("web:partial", 10);
  const olderTimeline = db.getTimeline("web:older-terminal", 10);
  const rollbackContents = rollbackTimeline.map((item: any) => item.data.content);
  const partialContents = partialTimeline.map((item: any) => item.data.content);
  const olderContents = olderTimeline.map((item: any) => item.data.content);

  expect(rollbackContents).not.toContain("unexpected recovery replay");
  expect(partialContents).toContain("partial reply");
  expect(partialContents).not.toContain("unexpected recovery replay");
  expect(olderContents).toContain("previous final");
  expect(olderContents).not.toContain("unexpected recovery replay");
  expect(rollbackTimeline.some((item: any) => item.data.content_blocks?.some((block: any) => block?.type === "turn_outcome_marker" && block?.kind === "interrupted" && block?.title === "Turn interrupted"))).toBe(true);
  expect(olderTimeline.some((item: any) => item.data.content_blocks?.some((block: any) => block?.type === "turn_outcome_marker" && block?.kind === "interrupted" && block?.title === "Turn interrupted"))).toBe(true);
});
