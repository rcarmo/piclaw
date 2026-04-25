/**
 * test/channels/web/web-channel.test.ts – Integration tests for WebChannel.
 *
 * Tests HTTP server startup, request routing, authentication,
 * SSE connections, and the full message lifecycle.
 */

import { createHmac } from "node:crypto";
import { expect, test, afterEach } from "bun:test";
import { createTempWorkspace, setEnv, waitFor } from "../../helpers.js";

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

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string): Buffer | null {
  const clean = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (!clean) return null;

  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return bytes.length > 0 ? Buffer.from(bytes) : null;
}

function totpCode(secret: string, timeMs = Date.now(), stepSeconds = 30, digits = 6): string {
  const key = decodeBase32(secret) ?? Buffer.from(secret, "utf8");
  const counter = Math.floor(timeMs / 1000 / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (code % 10 ** digits).toString().padStart(digits, "0");
}

async function createStoredTotpCardFixture(options: {
  currentSecret?: string;
  command: Record<string, unknown>;
}) {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const config = await import("../../../src/core/config.js");
  config.setWebTotpSecret(options.currentSecret || "");

  const freshSuffix = `?t=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const totp = await import(`../../../src/agent-control/handlers/totp.js${freshSuffix}`) as typeof import("../../../src/agent-control/handlers/totp.js");
  const result = await totp.handleTotp({} as any, options.command as any);
  const block = (Array.isArray(result.contentBlocks) ? result.contentBlocks[0] : null) as Record<string, any> | null;
  const token = block?.payload?.actions?.[0]?.data?.__totp_token as string | undefined;
  const cardId = typeof block?.card_id === "string" ? block.card_id : "";

  const sourceRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "web-agent",
    sender_name: "Pi",
    content: result.message,
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: true,
    content_blocks: result.contentBlocks,
    thread_id: null,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(sourceRowId, sourceRowId);

  const totpCard = await import("../../../src/channels/web/auth/totp-card.js");
  const parsed = totpCard.parseTotpCardToken(token || "");

  const webMod = await import(`../../../src/channels/web.js${freshSuffix}`) as typeof import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  return { db, config, result, block, token, cardId, parsed, sourceRowId, web };
}

test("web channel timeline and search endpoints", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const makeMessage = (content: string, timestamp: string) => ({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content,
    timestamp,
    is_from_me: false,
    is_bot_message: false,
  });

  db.storeMessage(makeMessage("hello #world", "2024-01-01T00:00:00.000Z"));
  db.storeMessage(makeMessage("another message", "2024-01-01T00:01:00.000Z"));
  db.storeMessage(makeMessage("#world hello", "2024-01-01T00:02:00.000Z"));
  db.storeChatMetadata("web:branch", new Date().toISOString(), "Branch");
  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:branch",
    sender: "user",
    sender_name: "User",
    content: "branch only hello",
    timestamp: "2024-01-01T00:03:00.000Z",
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });

  const timelineRes = await (web as any).handleRequest(new Request("http://test/timeline?limit=2"));
  const timelineJson = await timelineRes.json();
  expect(timelineJson.posts.length).toBe(2);

  const searchRes = await (web as any).handleRequest(new Request("http://test/search?q=hello&limit=10&offset=0"));
  const searchJson = await searchRes.json();
  expect(searchJson.results.length).toBe(2);

  const hashtagRes = await (web as any).handleRequest(new Request("http://test/hashtag/world?limit=10&offset=0"));
  const hashtagJson = await hashtagRes.json();
  expect(hashtagJson.posts.length).toBe(2);

  const branchTimelineRes = await (web as any).handleRequest(new Request("http://test/timeline?limit=10&chat_jid=web%3Abranch"));
  const branchTimelineJson = await branchTimelineRes.json();
  expect(branchTimelineJson.posts).toHaveLength(1);
  expect(branchTimelineJson.posts[0]?.data?.content).toBe("branch only hello");

  const branchSearchRes = await (web as any).handleRequest(new Request("http://test/search?q=branch&limit=10&offset=0&chat_jid=web%3Abranch"));
  const branchSearchJson = await branchSearchRes.json();
  expect(branchSearchJson.results).toHaveLength(1);
  expect(branchSearchJson.results[0]?.data?.content).toBe("branch only hello");

  const branchThreadRes = await (web as any).handleRequest(new Request(`http://test/thread/${branchTimelineJson.posts[0]?.id}?chat_jid=web%3Abranch`));
  const branchThreadJson = await branchThreadRes.json();
  expect(branchThreadJson.thread).toHaveLength(1);
  expect(branchThreadJson.thread[0]?.data?.content).toBe("branch only hello");
});

test("web channel can create a post", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });

  const req = new Request("http://test/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "hi" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.data.content).toBe("hi");
});

test("web channel handles /model command without queueing agent", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  let queued = false;
  let commandHandled = false;

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => { queued = true; } },
    agentPool: {
      runAgent: async () => ({ status: "success", result: "ok" }),
      applyControlCommand: async () => {
        commandHandled = true;
        return { status: "success", message: "Model set to openai/gpt-test." };
      },
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "/model openai/gpt-test" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(200);
  expect(commandHandled).toBe(true);
  expect(queued).toBe(false);

  const body = await res.json();
  expect(body?.ui_only).toBe(true);
  expect(body?.command?.status).toBe("success");

  const timeline = db.getTimeline("web:default", 10);
  expect(timeline.length).toBe(0);
});

test("web channel sends /compact result as an attachment instead of dumping the summary inline", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const mediaId = db.createMedia(
    "compaction-report-test.md",
    "text/markdown",
    new TextEncoder().encode("# Compaction report\n\n## Summary\n\nA long compacted summary."),
    null,
    { source: "compact" }
  );

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      runAgent: async () => ({ status: "success", result: "ok" }),
      applyControlCommand: async () => ({
        status: "success",
        message: "Compaction complete.\nTokens before: 1,200\nFirst kept entry: entry-1\nAttached: full compaction report (.md).",
        mediaIds: [mediaId],
      }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "/compact shorten" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);

  const timeline = db.getTimeline("web:default", 10);
  expect(timeline).toHaveLength(2);
  const assistant = timeline.find((item: any) => item.data.content?.includes("Compaction complete."));
  expect(assistant).toBeTruthy();
  expect(assistant.data.media_ids).toEqual([mediaId]);
  expect(assistant.data.content).toContain("Attached: full compaction report (.md).");
  expect(assistant.data.content).not.toContain("A long compacted summary.");
});

test("web channel relays peer messages into another active chat", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:source", new Date().toISOString(), "Source");
  db.storeChatMetadata("web:target", new Date().toISOString(), "Target");

  const enqueuedKeys: string[] = [];
  const activeChats = [
    {
      chat_jid: "web:source",
      agent_name: "source",
      session_id: "s-source",
      session_name: null,
      model: null,
      is_active: false,
      has_side_session: false,
    },
    {
      chat_jid: "web:target",
      agent_name: "target",
      session_id: "s-target",
      session_name: null,
      model: null,
      is_active: false,
      has_side_session: false,
    },
  ];

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: (_task: unknown, key: string) => { enqueuedKeys.push(key); } },
    agentPool: {
      listActiveChats: () => activeChats,
      findActiveChatByAgentName: (name: string) => activeChats.find((chat) => chat.agent_name === name) ?? null,
      getAgentHandleForChat: (chatJid: string) => activeChats.find((chat) => chat.chat_jid === chatJid)?.agent_name ?? null,
      isStreaming: () => false,
      isActive: () => false,
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/peer-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_chat_jid: "web:source",
      target_chat_jid: "web:target",
      content: "Please analyse this path.",
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.status).toBe("ok");
  expect(json.relayed).toBe(true);
  expect(json.source_chat_jid).toBe("web:source");
  expect(json.source_agent_name).toBe("source");
  expect(json.target_chat_jid).toBe("web:target");
  expect(json.target_agent_name).toBe("target");

  const timeline = db.getTimeline("web:target", 10);
  expect(timeline).toHaveLength(1);
  expect(timeline[0].data.content).toContain("Peer message from @source");
  expect(timeline[0].data.content).toContain("Please analyse this path.");
  expect(enqueuedKeys.some((key) => key.startsWith("chat:web:target:"))).toBe(true);
});

test("web channel lists known chat branches for a root chat", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_branches;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
  const root = db.getChatBranchByChatJid("web:default");
  db.storeChatMetadata("web:default:branch:1", new Date().toISOString(), "Research");
  db.ensureChatBranch({
    chat_jid: "web:default:branch:1",
    root_chat_jid: "web:default",
    parent_branch_id: root?.branch_id ?? null,
    agent_name: "research",
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      listActiveChats: () => [],
      listKnownChats: (rootChatJid?: string | null) => db.listChatBranches(rootChatJid || null).map((branch) => ({
        branch_id: branch.branch_id,
        chat_jid: branch.chat_jid,
        root_chat_jid: branch.root_chat_jid,
        parent_branch_id: branch.parent_branch_id,
        agent_name: branch.agent_name,
        
        session_id: null,
        session_name: null,
        model: null,
        is_active: false,
        has_side_session: false,
      })),
      getContextUsageForChat: async () => null,
    },
  });

  const res = await (web as any).handleRequest(new Request("http://test/agent/branches?root_chat_jid=web%3Adefault"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.chats).toHaveLength(2);
  expect(json.chats.map((chat: any) => chat.chat_jid)).toEqual(["web:default", "web:default:branch:1"]);
});

test("web channel includes archived branches when requested", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_branches;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
  db.storeChatMetadata("web:default:branch:1", new Date().toISOString(), "Research");
  db.ensureChatBranch({
    chat_jid: "web:default:branch:1",
    root_chat_jid: "web:default",
    agent_name: "research",
  });
  db.archiveChatBranch("web:default:branch:1");

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      listActiveChats: () => [],
      listKnownChats: (rootChatJid?: string | null, options?: { includeArchived?: boolean }) => db.listChatBranches(rootChatJid || null, options).map((branch) => ({
        branch_id: branch.branch_id,
        chat_jid: branch.chat_jid,
        root_chat_jid: branch.root_chat_jid,
        parent_branch_id: branch.parent_branch_id,
        agent_name: branch.agent_name,
        
        archived_at: branch.archived_at,
        session_id: null,
        session_name: null,
        model: null,
        is_active: false,
        has_side_session: false,
      })),
      getContextUsageForChat: async () => null,
    },
  });

  const withoutArchived = await (web as any).handleRequest(new Request("http://test/agent/branches?root_chat_jid=web%3Adefault"));
  expect(withoutArchived.status).toBe(200);
  const withoutArchivedJson = await withoutArchived.json();
  expect(withoutArchivedJson.chats.map((chat: any) => chat.chat_jid)).toEqual(["web:default"]);

  const withArchived = await (web as any).handleRequest(new Request("http://test/agent/branches?root_chat_jid=web%3Adefault&include_archived=1"));
  expect(withArchived.status).toBe(200);
  const withArchivedJson = await withArchived.json();
  expect(withArchivedJson.chats.map((chat: any) => chat.chat_jid)).toEqual(["web:default", "web:default:branch:1"]);
});

test("web channel renames a registry-backed chat branch", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_branches;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
  db.ensureChatBranch({
    chat_jid: "web:default:branch:1",
    root_chat_jid: "web:default",
    agent_name: "research",
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      listActiveChats: () => [],
      renameChatBranch: async (chatJid: string, options: { agentName?: string | null }) => db.renameChatBranchIdentity({
        chat_jid: chatJid,
        ...(options.agentName !== undefined ? { agent_name: options.agentName } : {}),
      }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/branch-rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_jid: "web:default:branch:1",
      agent_name: "research-lead",
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.status).toBe("ok");
  expect(json.branch.agent_name).toBe("research-lead");
  expect(json.branch.display_name).toBeNull();
  expect(db.getChatBranchByAgentName("research-lead")?.chat_jid).toBe("web:default:branch:1");
});

test("web channel rename rejects missing agent_name", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_branches;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Default");

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: { setSessionBinder: () => {} },
  });

  const res = await web.handleAgentBranchRename(new Request("https://e.test/agent/branch-rename", {
    method: "POST",
    body: JSON.stringify({ chat_jid: "web:default" }),
    headers: { "Content-Type": "application/json" },
  }));
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toContain("Missing agent_name");
});

test("web channel prunes a registry-backed chat branch", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_branches;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
  db.ensureChatBranch({
    chat_jid: "web:default:branch:1",
    root_chat_jid: "web:default",
    agent_name: "research",
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      listActiveChats: () => [],
      pruneChatBranch: async (chatJid: string) => db.archiveChatBranch(chatJid),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/branch-prune", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_jid: "web:default:branch:1" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.status).toBe("ok");
  expect(json.branch.chat_jid).toBe("web:default:branch:1");
  expect(json.branch.archived_at).toBeTruthy();
  expect(db.listChatBranches("web:default").map((chat: any) => chat.chat_jid)).toEqual(["web:default"]);
});

test("web channel restores a previously pruned branch", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_branches;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Default");
  db.ensureChatBranch({
    chat_jid: "web:default:branch:1",
    root_chat_jid: "web:default",
    agent_name: "release",
  });
  db.archiveChatBranch("web:default:branch:1");

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      listActiveChats: () => [],
      restoreChatBranch: async (chatJid: string, options: { agentName?: string | null }) => db.restoreChatBranchIdentity({
        chat_jid: chatJid,
        ...(options.agentName !== undefined ? { agent_name: options.agentName } : {}),
      }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/branch-restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_jid: "web:default:branch:1" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.status).toBe("ok");
  expect(json.branch.chat_jid).toBe("web:default:branch:1");
  expect(json.branch.archived_at).toBeNull();
  expect(db.listChatBranches("web:default").map((chat: any) => chat.chat_jid)).toEqual(["web:default", "web:default:branch:1"]);
});

test("web channel resolves peer relay by target agent name", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:source", new Date().toISOString(), "Source");
  db.storeChatMetadata("web:target", new Date().toISOString(), "Target");

  const enqueuedKeys: string[] = [];
  const activeChats = [
    {
      chat_jid: "web:source",
      agent_name: "source",
      session_id: "s-source",
      session_name: null,
      model: null,
      is_active: false,
      has_side_session: false,
    },
    {
      chat_jid: "web:target",
      agent_name: "research",
      session_id: "s-target",
      session_name: "Research",
      model: null,
      is_active: false,
      has_side_session: false,
    },
  ];

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: (_task: unknown, key: string) => { enqueuedKeys.push(key); } },
    agentPool: {
      listActiveChats: () => activeChats,
      findActiveChatByAgentName: (name: string) => activeChats.find((chat) => chat.agent_name === name) ?? null,
      getAgentHandleForChat: (chatJid: string) => activeChats.find((chat) => chat.chat_jid === chatJid)?.agent_name ?? null,
      isStreaming: () => false,
      isActive: () => false,
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/peer-message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source_chat_jid: "web:source",
      target_agent_name: "research",
      content: "Please inspect the current plan.",
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.status).toBe("ok");
  expect(json.relayed).toBe(true);
  expect(json.target_chat_jid).toBe("web:target");
  expect(json.target_agent_name).toBe("research");

  const timeline = db.getTimeline("web:target", 10);
  expect(timeline).toHaveLength(1);
  expect(timeline[0].data.content).toContain("Please inspect the current plan.");
  expect(enqueuedKeys.some((key) => key.startsWith("chat:web:target:"))).toBe(true);
});

test("web channel routes leading @agent mentions into the target chat", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:source", new Date().toISOString(), "Source");
  db.storeChatMetadata("web:target", new Date().toISOString(), "Target");

  const enqueuedKeys: string[] = [];
  const activeChats = [
    {
      chat_jid: "web:source",
      agent_name: "source",
      session_id: "s-source",
      session_name: null,
      model: null,
      is_active: false,
      has_side_session: false,
    },
    {
      chat_jid: "web:target",
      agent_name: "research",
      session_id: "s-target",
      session_name: "Research",
      model: null,
      is_active: false,
      has_side_session: false,
    },
  ];

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: (_task: unknown, key: string) => { enqueuedKeys.push(key); } },
    agentPool: {
      listActiveChats: () => activeChats,
      findActiveChatByAgentName: (name: string) => activeChats.find((chat) => chat.agent_name === name) ?? null,
      getAgentHandleForChat: (chatJid: string) => activeChats.find((chat) => chat.chat_jid === chatJid)?.agent_name ?? null,
      isStreaming: () => false,
      isActive: () => false,
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/default/message?chat_jid=web:source", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "@research please inspect this branch" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.relayed).toBe(true);
  expect(json.mention_routed).toBe(true);
  expect(json.source_chat_jid).toBe("web:source");
  expect(json.target_chat_jid).toBe("web:target");
  expect(json.target_agent_name).toBe("research");

  const sourceTimeline = db.getTimeline("web:source", 10);
  expect(sourceTimeline).toHaveLength(1);
  expect(sourceTimeline[0].data.content).toBe("@research please inspect this branch");

  const targetTimeline = db.getTimeline("web:target", 10);
  expect(targetTimeline).toHaveLength(1);
  expect(targetTimeline[0].data.content).toBe("please inspect this branch");
  expect(enqueuedKeys).toHaveLength(1);
  expect(enqueuedKeys[0]).toMatch(/^chat:web:target:/);
});

test("web channel defers /queue command into queue-state without placeholder row", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  let queued = false;

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => { queued = true; } },
    agentPool: {
      applyControlCommand: async () => ({
        status: "success",
        message: "Queued as a follow-up (one-at-a-time).",
        queued_followup: true,
      }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "/queue do this" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  expect(queued).toBe(false);

  const queueStateRes = await (web as any).handleRequest(new Request("http://test/agent/queue-state"));
  const queueState = await queueStateRes.json();
  expect(queueState.count).toBe(1);
  expect(queueState.items[0].content).toBe("do this");

  const timeline = db.getTimeline("web:default", 10);
  expect(timeline.length).toBe(1);
  expect(timeline[0].data.content).toBe("/queue do this");
});

test("web channel queues normal message as follow-up when no mode is provided", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const rootMessageId = `msg-${Math.random()}`;
  const rootTimestamp = new Date().toISOString();
  const rootRowId = db.storeMessage({
    id: rootMessageId,
    chat_jid: "web:default",
    sender: "web-user",
    sender_name: "You",
    content: "root turn",
    timestamp: rootTimestamp,
    is_from_me: false,
    is_bot_message: false,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(rootRowId, rootRowId);
  db.beginChatRun("web:default", rootTimestamp, {
    prevTs: "",
    messageId: rootMessageId,
    startedAt: new Date().toISOString(),
  });

  let runCalls = 0;

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => true,
      runAgent: async () => {
        runCalls += 1;
        return { status: "success", result: "ok" };
      },
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "Queue this while active" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  const payload = await res.json();
  expect(payload.queued).toBe("followup");
  // Deferred followups should NOT inherit the active turn's thread root.
  // They start their own thread when materialized (self-rooted).
  expect(payload.thread_id).toBe(null);

  expect(runCalls).toBe(0);

  const queueStateRes = await (web as any).handleRequest(new Request("http://test/agent/queue-state"));
  const queueState = await queueStateRes.json();
  expect(queueState.count).toBe(1);
  expect(queueState.items[0].content).toBe("Queue this while active");
  expect(queueState.items[0].row_id).toBeLessThan(0);
  expect(queueState.items[0].thread_id).toBe(null);

  // Deferred queued messages should not be persisted to the timeline until consumed.
  const timeline = db.getTimeline("web:default", 10);
  expect(timeline.length).toBe(1);
  expect(timeline[0].data.content).toBe("root turn");
});

test("web channel processes messages normally when a turn is inflight but not actively streaming", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const rootMessageId = `msg-${Math.random()}`;
  const rootTimestamp = new Date().toISOString();
  const rootRowId = db.storeMessage({
    id: rootMessageId,
    chat_jid: "web:default",
    sender: "web-user",
    sender_name: "You",
    content: "root turn",
    timestamp: rootTimestamp,
    is_from_me: false,
    is_bot_message: false,
    thread_id: null,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(rootRowId, rootRowId);
  // Set an inflight marker WITHOUT an active streaming session — simulates
  // a stale marker left after a restart or brief finalization gap.
  db.beginChatRun("web:default", rootTimestamp, {
    prevTs: "",
    messageId: rootMessageId,
    startedAt: new Date().toISOString(),
  });

  let processChatEnqueued = false;
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => { processChatEnqueued = true; } },
    agentPool: {
      isStreaming: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "should process immediately despite stale inflight" }),
  });

  const res = await (web as any).handleRequest(req);
  const payload = await res.json();
  // Must NOT be queued — the stale DB inflight marker must not block processing
  expect(res.status).toBe(201);
  expect(payload.queued).toBeUndefined();
  expect(payload.user_message).toBeTruthy();
  expect(processChatEnqueued).toBe(true);

  // Message should be stored in the timeline (not deferred)
  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).toContain("should process immediately despite stale inflight");
});

test("web channel defers new auto submissions behind deferred backlog and wakes a drain run", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  let processChatEnqueued = false;
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => { processChatEnqueued = true; } },
    agentPool: {
      isStreaming: () => false,
      isActive: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  web.enqueueQueuedFollowupItem("web:default", 0, "older deferred");

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "new turn should defer behind backlog" }),
  });

  const res = await (web as any).handleRequest(req);
  const payload = await res.json();

  expect(res.status).toBe(201);
  expect(payload.queued).toBe("followup");
  // Backlog-only defer path should proactively wake processChat.
  expect(processChatEnqueued).toBe(true);

  const queueState = await (web as any).handleRequest(new Request("http://test/agent/queue-state"));
  const queuePayload = await queueState.json();
  expect(queuePayload.count).toBe(2);
  expect(queuePayload.items.map((item: any) => item.content)).toContain("older deferred");
  expect(queuePayload.items.map((item: any) => item.content)).toContain("new turn should defer behind backlog");

  const timeline = db.getTimeline("web:default", 10);
  expect(timeline.length).toBe(0);
});

test("web channel exposes queued follow-up items from queue-state", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      applyControlCommand: async () => ({
        status: "success",
        message: "Queued as a follow-up (one-at-a-time).",
        queued_followup: true,
      }),
      removeQueuedFollowupMessage: async () => true,
      getContextUsageForChat: async () => null,
    },
  });

  const reqOne = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "/queue first followup" }),
  });
  const reqTwo = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "/queue second followup" }),
  });

  const resOne = await (web as any).handleRequest(reqOne);
  const resTwo = await (web as any).handleRequest(reqTwo);
  expect(resOne.status).toBe(201);
  expect(resTwo.status).toBe(201);

  const queueState = await (web as any).handleRequest(new Request("http://test/agent/queue-state"));
  const payload = await queueState.json();
  expect(payload.count).toBe(2);
  expect(Array.isArray(payload.items)).toBe(true);
  expect(payload.items.length).toBe(2);
  expect(payload.items[0].content).toContain("first followup");
  expect(payload.items[1].content).toContain("second followup");

  const removeReq = new Request("http://test/agent/queue-remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ row_id: payload.items[0].row_id }),
  });
  const removeRes = await (web as any).handleRequest(removeReq);
  const removeJson = await removeRes.json();
  expect(removeRes.status).toBe(200);
  expect(removeJson.status).toBe("ok");
  expect(removeJson.removed).toBe(true);

  const queueStateAfter = await (web as any).handleRequest(new Request("http://test/agent/queue-state"));
  const payloadAfter = await queueStateAfter.json();
  expect(payloadAfter.count).toBe(1);
  expect(payloadAfter.items[0].content).toContain("second followup");
});

test("web channel queue removal respects explicit branch chat_jid", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");
  db.storeChatMetadata("web:branch", new Date().toISOString(), "Branch");

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });

  const defaultRowId = web.enqueueQueuedFollowupItem("web:default", 0, "default followup");
  const branchRowId = web.enqueueQueuedFollowupItem("web:branch", 0, "branch followup");

  const removeReq = new Request("http://test/agent/queue-remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_jid: "web:branch", row_id: branchRowId }),
  });
  const removeRes = await (web as any).handleRequest(removeReq);
  const removeJson = await removeRes.json();
  expect(removeRes.status).toBe(200);
  expect(removeJson.status).toBe("ok");
  expect(removeJson.removed).toBe(true);
  expect(web.getQueuedFollowupCount("web:branch")).toBe(0);
  expect(web.getQueuedFollowupCount("web:default")).toBe(1);

  const defaultQueueState = await (web as any).handleRequest(new Request("http://test/agent/queue-state?chat_jid=web%3Adefault"));
  const defaultPayload = await defaultQueueState.json();
  expect(defaultPayload.items).toHaveLength(1);
  expect(defaultPayload.items[0].row_id).toBe(defaultRowId);
  expect(defaultPayload.items[0].content).toContain("default followup");

  const branchQueueState = await (web as any).handleRequest(new Request("http://test/agent/queue-state?chat_jid=web%3Abranch"));
  const branchPayload = await branchQueueState.json();
  expect(branchPayload.count).toBe(0);
});

test("web channel reports active agent status", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });

  web.updateAgentStatus("web:default", { type: "thinking", title: "Thinking...", turn_id: "turn-1" });

  const res = await (web as any).handleRequest(new Request("http://test/agent/status"));
  const json = await res.json();
  expect(json.status).toBe("active");
  expect(json.data.turn_id).toBe("turn-1");

  web.updateAgentStatus("web:default", { type: "done", turn_id: "turn-1" });
  const resIdle = await (web as any).handleRequest(new Request("http://test/agent/status"));
  const jsonIdle = await resIdle.json();
  expect(jsonIdle.status).toBe("idle");
});

test("web channel delete post cascades thread replies", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const rootRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "root",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });
  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "reply",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
    thread_id: rootRowId,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });

  const res = await (web as any).handleRequest(
    new Request(`http://test/post/${rootRowId}?cascade=true`, { method: "DELETE" })
  );
  const json = await res.json();
  expect(json.deleted).toBe(2);

  const remaining = db.getTimeline("web:default", 10);
  expect(remaining.length).toBe(0);
});

test("web channel queues steering without advancing cursor", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.getDb().exec("DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const events: Array<{ type: string; data: any }> = [];

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      queueStreamingMessage: async () => ({ queued: true }),
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
      applyControlCommand: async (_chatJid, command) => ({
        status: command?.type === "steer" ? "success" : "error",
        message: command?.type === "steer" ? "Steering queued: steer" : "Unsupported command.",
        queued_steer: command?.type === "steer" ? true : undefined,
      }),
    },
  });
  web.broadcastEvent = (type: string, data: unknown) => {
    events.push({ type, data });
  };

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "/steer this" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json.queued).toBe("steer");
  expect(db.getChatCursor("web:default")).toBe("");
  const pending = (web as any).consumePendingSteering("web:default");
  expect(pending).toHaveLength(1);
  expect(events.some((event) => event.type === "agent_steer_queued")).toBe(true);
});

test("web channel defers active /queue without creating a timeline message", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const events: Array<{ type: string; data: any }> = [];

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => true,
      getContextUsageForChat: async () => null,
    },
  });
  web.broadcastEvent = (type: string, data: unknown) => {
    events.push({ type, data });
  };

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "/queue later" }),
  });

  const res = await (web as any).handleRequest(req);
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.queued).toBe("followup");

  const queueStateRes = await (web as any).handleRequest(new Request("http://test/agent/queue-state"));
  const queueState = await queueStateRes.json();
  expect(queueState.count).toBe(1);
  expect(queueState.items[0].content).toBe("later");

  const timeline = db.getTimeline("web:default", 10);
  expect(timeline.length).toBe(0);
  expect(events.some((event) => event.type === "agent_followup_queued")).toBe(true);
});

test("web channel defers active /steer command without creating a timeline message", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const events: Array<{ type: string; data: any }> = [];
  let applyCalls = 0;

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => true,
      queueStreamingMessage: async () => ({ queued: true }),
      applyControlCommand: async () => {
        applyCalls += 1;
        return { status: "success", message: "unexpected" };
      },
      getContextUsageForChat: async () => null,
    },
  });
  web.broadcastEvent = (type: string, data: unknown) => {
    events.push({ type, data });
  };

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "/steer now" }),
  });

  const res = await (web as any).handleRequest(req);
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.queued).toBe("steer");
  expect(applyCalls).toBe(0);
  expect((web as any).consumePendingSteering("web:default")).toEqual([]);

  const timeline = db.getTimeline("web:default", 10);
  expect(timeline.length).toBe(0);
  expect(events.some((event) => event.type === "agent_steer_queued")).toBe(true);
});

test("web channel atomically converts a queued item into steering when active", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const rootMessageId = `msg-${Math.random()}`;
  const rootTimestamp = new Date().toISOString();
  const rootRowId = db.storeMessage({
    id: rootMessageId,
    chat_jid: "web:default",
    sender: "web-user",
    sender_name: "You",
    content: "root turn",
    timestamp: rootTimestamp,
    is_from_me: false,
    is_bot_message: false,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(rootRowId, rootRowId);
  db.beginChatRun("web:default", rootTimestamp, {
    prevTs: "",
    messageId: rootMessageId,
    startedAt: new Date().toISOString(),
  });

  const events: Array<{ type: string; data: any }> = [];
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => true,
      setSessionBinder: () => {},
      queueStreamingMessage: async () => ({ queued: true }),
      getContextUsageForChat: async () => null,
    },
  });
  web.broadcastEvent = (type: string, data: unknown) => {
    events.push({ type, data });
  };

  const queueReq = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "queued steer me" }),
  });
  const queueRes = await (web as any).handleRequest(queueReq);
  const queueJson = await queueRes.json();
  expect(queueRes.status).toBe(201);
  expect(queueJson.queued).toBe("followup");
  expect(queueJson.thread_id).toBe(null);

  const queueStateRes = await (web as any).handleRequest(new Request("http://test/agent/queue-state"));
  const queueState = await queueStateRes.json();
  expect(queueState.items[0].thread_id).toBe(null);
  const rowId = queueState.items[0].row_id;

  const res = await (web as any).handleRequest(new Request("http://test/agent/queue-steer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ row_id: rowId }),
  }));
  const json = await res.json();

  expect(res.status).toBe(201);
  expect(json.status).toBe("ok");
  expect(json.queued).toBe("steer");
  expect(json.user_message?.data?.content).toBe("queued steer me");
  expect(json.thread_id).toBe(rootRowId);
  expect(web.getQueuedFollowupCount("web:default")).toBe(0);
  expect(events.some((event) => event.type === "agent_followup_removed")).toBe(true);
  expect(events.some((event) => event.type === "new_post" && event.data?.data?.content === "queued steer me")).toBe(true);
  expect(events.some((event) => event.type === "agent_steer_queued" && event.data?.thread_id === rootRowId)).toBe(true);

  const timeline = db.getTimeline("web:default", 10);
  const steerMessage = timeline.find((item: any) => item.data.content === "queued steer me");
  expect(steerMessage?.data?.thread_id).toBe(rootRowId);
});

test("web channel emits queue removal before steer enqueue when converting a queued item while active", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const rootMessageId = `msg-${Math.random()}`;
  const rootTimestamp = new Date().toISOString();
  const rootRowId = db.storeMessage({
    id: rootMessageId,
    chat_jid: "web:default",
    sender: "web-user",
    sender_name: "You",
    content: "root turn",
    timestamp: rootTimestamp,
    is_from_me: false,
    is_bot_message: false,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(rootRowId, rootRowId);
  db.beginChatRun("web:default", rootTimestamp, {
    prevTs: "",
    messageId: rootMessageId,
    startedAt: new Date().toISOString(),
  });

  const events: Array<{ type: string; data: any }> = [];
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => true,
      setSessionBinder: () => {},
      queueStreamingMessage: async () => ({ queued: true }),
      getContextUsageForChat: async () => null,
    },
  });
  web.broadcastEvent = (type: string, data: unknown) => {
    events.push({ type, data });
  };

  const rowId = web.enqueueQueuedFollowupItem("web:default", 0, "queued ordering check");

  const res = await (web as any).handleRequest(new Request("http://test/agent/queue-steer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ row_id: rowId }),
  }));

  expect(res.status).toBe(201);
  const orderedTypes = events
    .map((event) => event.type)
    .filter((type) => ["agent_followup_removed", "new_post", "agent_steer_queued"].includes(type));
  expect(orderedTypes).toEqual(["agent_followup_removed", "new_post", "agent_steer_queued"]);
});

test("web channel atomically converts a queued item into an immediate send when inactive", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      isStreaming: () => false,
      setSessionBinder: () => {},
      queueStreamingMessage: async () => ({ queued: false }),
      runAgent: async () => ({ status: "success", result: "ok", attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  const rowId = web.enqueueQueuedFollowupItem("web:default", 0, "queued send me now");
  const res = await (web as any).handleRequest(new Request("http://test/agent/queue-steer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ row_id: rowId }),
  }));
  const json = await res.json();

  expect(res.status).toBe(201);
  expect(json.status).toBe("ok");
  expect(json.user_message?.data?.content).toBe("queued send me now");
  expect(web.getQueuedFollowupCount("web:default")).toBe(0);

  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).toContain("queued send me now");
  expect(contents).toContain("ok");
});

test("web channel queue steering respects explicit branch chat_jid", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");
  db.storeChatMetadata("web:branch", new Date().toISOString(), "Branch");

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      isStreaming: () => false,
      setSessionBinder: () => {},
      queueStreamingMessage: async () => ({ queued: false }),
      runAgent: async () => ({ status: "success", result: "ok", attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  const defaultRowId = web.enqueueQueuedFollowupItem("web:default", 0, "default queued send");
  const branchRowId = web.enqueueQueuedFollowupItem("web:branch", 0, "branch queued send");

  const steerRes = await (web as any).handleRequest(new Request("http://test/agent/queue-steer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_jid: "web:branch", row_id: branchRowId }),
  }));
  const steerJson = await steerRes.json();

  expect(steerRes.status).toBe(201);
  expect(steerJson.status).toBe("ok");
  expect(steerJson.user_message?.chat_jid).toBe("web:branch");
  expect(steerJson.user_message?.data?.content).toBe("branch queued send");
  expect(web.getQueuedFollowupCount("web:branch")).toBe(0);
  expect(web.getQueuedFollowupCount("web:default")).toBe(1);

  const branchTimeline = db.getTimeline("web:branch", 10).map((item: any) => item.data.content);
  expect(branchTimeline).toContain("branch queued send");
  expect(branchTimeline).toContain("ok");

  const defaultTimeline = db.getTimeline("web:default", 10).map((item: any) => item.data.content);
  expect(defaultTimeline).not.toContain("branch queued send");
  expect(defaultTimeline).not.toContain("ok");

  const defaultQueueState = await (web as any).handleRequest(new Request("http://test/agent/queue-state?chat_jid=web%3Adefault"));
  const defaultPayload = await defaultQueueState.json();
  expect(defaultPayload.items).toHaveLength(1);
  expect(defaultPayload.items[0].row_id).toBe(defaultRowId);
});

test("web channel defers active compose steer without creating a timeline message", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const events: Array<{ type: string; data: any }> = [];

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => true,
      queueStreamingMessage: async () => ({ queued: true }),
      getContextUsageForChat: async () => null,
    },
  });
  web.broadcastEvent = (type: string, data: unknown) => {
    events.push({ type, data });
  };

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "steer now", mode: "steer" }),
  });

  const res = await (web as any).handleRequest(req);
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.queued).toBe("steer");
  expect(db.getChatCursor("web:default")).toBe("");
  expect((web as any).consumePendingSteering("web:default")).toEqual([]);

  const timeline = db.getTimeline("web:default", 10);
  expect(timeline.length).toBe(0);
  expect(events.some((event) => event.type === "agent_steer_queued")).toBe(true);
});

test("web channel defers /steer without active stream into queue-state", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.getDb().exec("DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const events: Array<{ type: string; data: any }> = [];
  let sendCalls = 0;

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
      applyControlCommand: async (_chatJid, command) => ({
        status: command?.type === "steer" ? "success" : "error",
        message: command?.type === "steer" ? "Queued as a follow-up (one-at-a-time)." : "Unsupported command.",
        queued_followup: command?.type === "steer" ? true : undefined,
      }),
    },
  });
  web.sendMessage = async () => {
    sendCalls += 1;
  };
  web.broadcastEvent = (type: string, data: unknown) => {
    events.push({ type, data });
  };

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "/steer this" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  const json = await res.json();
  expect(json?.queued).toBe("followup");
  expect(sendCalls).toBe(0);

  const queueStateRes = await (web as any).handleRequest(new Request("http://test/agent/queue-state"));
  const queueState = await queueStateRes.json();
  expect(queueState.count).toBe(1);
  expect(queueState.items[0].content).toBe("this");
  expect(events.some((event) => event.type === "agent_followup_queued")).toBe(true);
});

test("processChat does not advance cursor to pending steering timestamps or skip later persisted messages", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.getDb().exec("DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const firstTs = "2024-01-01T00:00:00.000Z";
  const secondTs = "2024-01-01T00:00:05.000Z";
  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "first",
    timestamp: firstTs,
    is_from_me: false,
    is_bot_message: false,
  });
  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "second",
    timestamp: secondTs,
    is_from_me: false,
    is_bot_message: false,
  });

  let runCount = 0;
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => {
        runCount += 1;
        return { status: "success", result: "ok", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  web.queuePendingSteering("web:default", "2024-01-01T00:00:10.000Z");

  await web.processChat("web:default", "default");
  expect(db.getChatCursor("web:default")).toBe(firstTs);
  expect(runCount).toBe(1);

  await web.processChat("web:default", "default");
  expect(db.getChatCursor("web:default")).toBe(secondTs);
  expect(runCount).toBe(2);
});

test("processChat rolls back cursor when agent is already processing", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const messageTs = "2024-01-01T00:00:00.000Z";
  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: messageTs,
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "error", error: "already processing", result: null }),
      getContextUsageForChat: async () => null,
    },
  });

  let error: Error | null = null;
  try {
    await web.processChat("web:default", "default");
  } catch (err) {
    error = err as Error;
  }

  expect(error).toBeTruthy();
  expect(error?.message).toContain("already processing");
  expect(db.getChatCursor("web:default")).toBe("");
  expect(db.getInflightRuns().some((run: any) => run.chatJid === "web:default")).toBe(false);
  const retryStatus = web.getAgentStatus("web:default");
  expect(retryStatus?.title).toBe("Queued — waiting for current response");
  expect(typeof retryStatus?.started_at).toBe("string");
  expect(typeof retryStatus?.retry_at).toBe("string");
  expect(typeof retryStatus?.retry_delay_ms).toBe("number");
  expect(Date.parse(String(retryStatus?.retry_at))).toBeGreaterThan(Date.parse(String(retryStatus?.started_at)));
});

test("processChat publishes retry metadata while providers are still initializing", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: "2024-01-01T00:00:00.000Z",
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "error", error: "No API provider registered for api: demo", result: null }),
      getContextUsageForChat: async () => null,
    },
  });

  let error: Error | null = null;
  try {
    await web.processChat("web:default", "default");
  } catch (err) {
    error = err as Error;
  }

  expect(error).toBeTruthy();
  expect(error?.message).toContain("No API provider registered for api:");
  const retryStatus = web.getAgentStatus("web:default");
  expect(retryStatus?.title).toBe("Model provider is initializing — retrying shortly");
  expect(retryStatus?.detail).toContain("No API provider registered for api:");
  expect(typeof retryStatus?.retry_at).toBe("string");
  expect(retryStatus?.retry_delay_ms).toBe(5000);
});

// --- New coverage: agent status lifecycle ---

test("processChat publishes draft fallback when final result is missing", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_start" },
        });
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "draft only" },
        });
        return { status: "success", result: null, attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  const timeline = db.getTimeline("web:default", 10);
  const last = timeline[timeline.length - 1];
  expect(last.data.content).toContain("draft only");
});

test("processChat final first turn does not consume a queued placeholder", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "success", result: "first reply", attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  web.queueFollowupPlaceholder("web:default", "\u2063", 123, "queued later");
  expect(web.getQueuedFollowupCount("web:default")).toBe(1);

  await web.processChat("web:default", "default");

  expect(web.getQueuedFollowupCount("web:default")).toBe(1);
  expect(web.consumeQueuedFollowupPlaceholder("web:default")).not.toBeNull();

  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).toContain("first reply");
});

test("processChat records an explicit failed run when terminal persistence fails", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "success", result: "final reply", attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  const originalStoreMessage = web.storeMessage.bind(web);
  web.storeMessage = (chatJid: string, content: string, isBot: boolean, mediaIds: number[], options?: any) => {
    if (isBot) return null;
    return originalStoreMessage(chatJid, content, isBot, mediaIds, options);
  };

  await web.processChat("web:default", "default");

  const failedRun = db.getFailedRun("web:default");
  expect(failedRun).toBeTruthy();

  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).toEqual(["hello"]);
});

test("processChat records an explicit failed run when draft fallback persistence fails", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_start" },
        });
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "draft only" },
        });
        return { status: "success", result: null, attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  const originalStoreMessage = web.storeMessage.bind(web);
  web.storeMessage = (chatJid: string, content: string, isBot: boolean, mediaIds: number[], options?: any) => {
    if (isBot) return null;
    return originalStoreMessage(chatJid, content, isBot, mediaIds, options);
  };

  await web.processChat("web:default", "default");

  const failedRun = db.getFailedRun("web:default");
  expect(failedRun).toBeTruthy();

  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).toEqual(["hello"]);
});

test("processChat surfaces provider rate limits as a visible outcome bubble", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "error", error: "Error: HTTP 429 Too Many Requests (rate limit exceeded)", result: null, attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  const timeline = db.getTimeline("web:default", 10);
  const botMessages = timeline.filter((item: any) => item.data.type === "agent_response");
  expect(botMessages.length).toBe(1);
  expect(String(botMessages[0].data.content || "")).toBe("");
  expect(botMessages[0].data.content_blocks).toContainEqual(expect.objectContaining({
    type: "turn_outcome_marker",
    kind: "provider",
    label: "rate limit",
    title: "Provider retry budget exhausted",
  }));
});

test("processChat keeps partial draft text and adds a rate-limit bubble when fallback is published", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "error", error: "Azure request failed: Azure rate limit exceeded — the model's per-minute token budget was exhausted.", result: null, attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  web.getBuffer = (_turnId: string, panel: string) => panel === "draft"
    ? { text: "Partial draft already visible", totalLines: 1 }
    : undefined;

  await web.processChat("web:default", "default");

  const timeline = db.getTimeline("web:default", 10);
  const botMessages = timeline.filter((item: any) => item.data.type === "agent_response");
  expect(botMessages.length).toBe(1);
  expect(botMessages[0].data.content).toContain("Partial draft already visible");
  expect(botMessages[0].data.content_blocks).toContainEqual(expect.objectContaining({
    type: "turn_outcome_marker",
    kind: "provider",
    draft_recovered: true,
  }));
});

test("processChat includes the last action summary in visible failure fallbacks", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.({ type: "tool_execution_start", toolCallId: "tool-1", toolName: "bash", args: { command: "echo hi" } });
        options.onEvent?.({ type: "tool_execution_update", toolCallId: "tool-1", toolName: "bash", args: { command: "echo hi" } });
        return { status: "error", error: "Prompt completed without emitting an assistant reply before finalization (session delta: 0 appended entries).", result: null, attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  const timeline = db.getTimeline("web:default", 10);
  const last = timeline[timeline.length - 1];
  expect(String(last.data.content || "")).toBe("");
  expect(last.data.content_blocks).toContainEqual(expect.objectContaining({
    type: "turn_outcome_marker",
    kind: "error",
    tool_action_summary: expect.stringContaining("bash"),
  }));
});

test("processChat suppresses a redundant failure bubble when a turn is aborted", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "error", error: "The operation was aborted.", result: null, attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  const timeline = db.getTimeline("web:default", 10);
  expect(timeline).toHaveLength(1);
  expect(String(timeline[0]?.data?.content || "")).toBe("hello");
});

test("processChat persists a compact recovery bubble instead of a generic no-response warning when compaction/recovery stalls", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.({ type: "compaction_start", reason: "overflow" });
        options.onEvent?.({ type: "compaction_end", reason: "overflow", willRetry: false, errorMessage: "Recovery compaction failed: session contains orphaned tool-result blocks." });
        options.onEvent?.({ type: "recovery_start", strategy: "compact_then_retry", attempt: 1, maxAttempts: 2, reason: "context pressure" });
        options.onEvent?.({ type: "recovery_end", outcome: "exhausted", attemptsUsed: 1, classifier: "compaction_failure", errorMessage: "session contains orphaned tool-result blocks" });
        return {
          status: "success",
          result: null,
          attachments: [],
          recovery: {
            attemptsUsed: 1,
            totalElapsedMs: 1200,
            recovered: false,
            exhausted: true,
            lastClassifier: "compaction_failure",
            strategyHistory: ["compact_then_retry"],
            diagnostics: [],
          },
        };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  expect(db.getFailedRun("web:default")).toBeUndefined();

  const timeline = db.getTimeline("web:default", 20);
  const botMessages = timeline.filter((item: any) => item.data.type === "agent_response");
  expect(botMessages.some((item: any) => Array.isArray(item.data.content_blocks)
    && item.data.content_blocks.some((block: any) => block?.type === "turn_outcome_marker" && (block?.label === "recovery" || block?.label === "context") && String(block?.detail || "").includes("orphaned tool-result blocks")))).toBe(true);
  expect(botMessages.some((item: any) => String(item.data.content || "").includes("produced no response"))).toBe(false);
});

test("processChat consumes an empty successful output with a compact no-reply bubble", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const userTs = new Date().toISOString();
  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: userTs,
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "success", result: null, attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  expect(db.getFailedRun("web:default")).toBeUndefined();
  expect(db.getChatCursor("web:default")).toBe(userTs);

  const timeline = db.getTimeline("web:default", 10);
  const botMessages = timeline.filter((item: any) => item.data.type === "agent_response");
  expect(botMessages.some((item: any) => Array.isArray(item.data.content_blocks)
    && item.data.content_blocks.some((block: any) => block?.type === "turn_outcome_marker" && block?.label === "no reply"))).toBe(true);
  expect(botMessages.some((item: any) => String(item.data.content || "") === "")).toBe(true);
});

test("processChat does not replay empty-output turns on subsequent passes", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const userTs = new Date().toISOString();
  db.storeMessage({
    id: "msg-held-failure",
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: userTs,
    is_from_me: false,
    is_bot_message: false,
  });

  let runCount = 0;
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => {
        runCount += 1;
        if (runCount === 1) return { status: "success", result: null, attachments: [] };
        return { status: "success", result: "fixed", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");
  expect(runCount).toBe(1);
  expect(db.getFailedRun("web:default")).toBeUndefined();
  expect(db.getChatCursor("web:default")).toBe(userTs);

  await web.processChat("web:default", "default");
  expect(runCount).toBe(1);
  expect(db.getFailedRun("web:default")).toBeUndefined();

  const timeline = db.getTimeline("web:default", 20);
  expect(timeline.some((item: any) => Array.isArray(item.data?.content_blocks)
    && item.data.content_blocks.some((block: any) => block?.type === "turn_outcome_marker" && block?.label === "no reply"))).toBe(true);
});

test("processChat does not emit no-response notice when an earlier turn was already persisted", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onTurnComplete?.({ text: "response before compaction tail", attachments: [] });
        return { status: "success", result: null, attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  const failedRun = db.getFailedRun("web:default");
  expect(failedRun).toBeUndefined();

  const timeline = db.getTimeline("web:default", 10);
  const botMessages = timeline.filter((item: any) => item.data.type === "agent_response");
  expect(botMessages.length).toBe(1);
  expect(botMessages[0].data.content).toContain("response before compaction tail");
  expect(botMessages[0].data.content).not.toContain("produced no response");
});

test("processChat drains queued follow-ups after a persisted timeout fallback", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: "2024-01-01T00:00:00.000Z",
    is_from_me: false,
    is_bot_message: false,
  });

  let runCount = 0;
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        runCount += 1;
        if (runCount === 1) {
          options.onEvent?.({
            type: "message_update",
            assistantMessageEvent: { type: "text_start" },
          });
          options.onEvent?.({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "draft before timeout" },
          });
          return { status: "error", result: null, error: "Timed out after 1s" };
        }
        return { status: "success", result: "reply after fallback", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  web.enqueueQueuedFollowupItem("web:default", 0, "queued after timeout");
  await web.processChat("web:default", "default");

  expect(runCount).toBe(2);
  expect(web.getQueuedFollowupCount("web:default")).toBe(0);
  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents.some((content: string) => content.includes("draft before timeout"))).toBe(true);
  expect(contents).toContain("queued after timeout");
  expect(contents).toContain("reply after fallback");
});

test("processChat treats a persisted timeout fallback as a terminal completion", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_start" },
        });
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "draft only" },
        });
        return { status: "error", result: null, error: "Timed out after 1s" };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  expect(db.getFailedRun("web:default")).toBeUndefined();

  const timeline = db.getTimeline("web:default", 10);
  const last = timeline[timeline.length - 1];
  expect(last.data.content).toContain("draft only");
  expect(last.data.content_blocks).toContainEqual(expect.objectContaining({
    type: "timeout_marker",
    timed_out: true,
    draft_recovered: true,
  }));
});

test("processChat stores a recovery marker on a successfully recovered final turn", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({
        status: "success",
        result: "recovered final answer",
        recovery: {
          attemptsUsed: 1,
          totalElapsedMs: 1200,
          recovered: true,
          exhausted: false,
          lastClassifier: "transient",
          strategyHistory: ["retry"],
        },
      }),
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  const timeline = db.getTimeline("web:default", 10);
  const last = timeline[timeline.length - 1];
  expect(last.data.content).toContain("recovered final answer");
  expect(Array.isArray(last.data.content_blocks)).toBe(true);
  expect(last.data.content_blocks).toContainEqual(expect.objectContaining({
    type: "recovery_marker",
    recovered: true,
    attempts_used: 1,
    classifier: "transient",
  }));
});

test("processChat emits an exhausted-recovery bubble when automatic recovery gives up", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.({ type: "message_update", assistantMessageEvent: { type: "text_start" } });
        options.onEvent?.({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "partial draft" } });
        return {
          status: "error",
          result: null,
          error: "Timed out after 1s",
          recovery: {
            attemptsUsed: 2,
            totalElapsedMs: 30000,
            recovered: false,
            exhausted: true,
            lastClassifier: "budget_exhausted",
            strategyHistory: ["retry", "compact_then_retry"],
          },
        };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  const timeline = db.getTimeline("web:default", 20);
  const bubbleMessage = timeline.find((entry: any) => Array.isArray(entry.data?.content_blocks)
    && entry.data.content_blocks.some((block: any) => block?.type === "timeout_marker" && block?.draft_recovered === true));
  expect(bubbleMessage).toBeDefined();
  expect(String(bubbleMessage?.data?.content || "")).toContain("partial draft");
});

test("processChat keeps a recovered compaction timeout as one clean final answer", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.({ type: "compaction_start", reason: "overflow" });
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_start" },
        });
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "draft during compaction" },
        });
        return {
          status: "success",
          result: "recovered final answer",
          recovery: {
            attemptsUsed: 1,
            totalElapsedMs: 1200,
            recovered: true,
            exhausted: false,
            lastClassifier: "context_pressure",
            strategyHistory: ["compact_then_retry"],
          },
        };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  const timeline = db.getTimeline("web:default", 10);
  const last = timeline[timeline.length - 1];
  expect(last.data.content).toContain("recovered final answer");
  expect(last.data.content).not.toContain("Response timed out before finalization");
  expect(last.data.content).not.toContain("Context compaction was in progress");
  expect(Array.isArray(last.data.content_blocks)).toBe(true);
  expect(last.data.content_blocks).toContainEqual(expect.objectContaining({
    type: "recovery_marker",
    recovered: true,
    attempts_used: 1,
    classifier: "context_pressure",
  }));
});

test("processChat annotates draft fallback when compaction intent is active", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.({ type: "compaction_start", reason: "overflow" });
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_start" },
        });
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "draft during compaction" },
        });
        return { status: "error", result: null, error: "Timed out after 1s" };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  const timeline = db.getTimeline("web:default", 10);
  const last = timeline[timeline.length - 1];
  expect(last.data.content).toContain("draft during compaction");
  expect(last.data.content_blocks).toContainEqual(expect.objectContaining({
    type: "timeout_marker",
    timed_out: true,
    draft_recovered: true,
  }));
});

test("processChat publishes final draft fallback even after an intermediate turn", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string, options: any) => {
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_start" },
        });
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "first draft" },
        });
        options.onTurnComplete?.({ text: "first reply", attachments: [] });
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_start" },
        });
        options.onEvent?.({
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "second draft" },
        });
        return { status: "success", result: null, attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");

  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => String(item.data.content || ""));
  expect(contents).toContain("first reply");
  expect(contents.some((content) => content.includes("second draft"))).toBe(true);
  // "No final reply" marker is now in content_blocks, not the message text
  const blocks = timeline.flatMap((item: any) => item.data.content_blocks || []);
  expect(blocks.some((b: any) => b?.type === "turn_outcome_marker" && b?.label === "no reply")).toBe(true);
});

test("processChat publishes queued follow-up only after current turn completes", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const firstUserRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "first user",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
    thread_id: null,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(firstUserRowId, firstUserRowId);

  let runCount = 0;
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => {
        runCount += 1;
        return { status: "success", result: runCount === 1 ? "first reply" : "second reply", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  web.enqueueQueuedFollowupItem("web:default", 0, "queued user", firstUserRowId, new Date().toISOString());

  await web.processChat("web:default", "default");
  await Bun.sleep(20);

  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).toContain("first reply");
  expect(contents).toContain("queued user");
  expect(runCount).toBeGreaterThanOrEqual(1);

  const firstUser = timeline.find((item: any) => item.data.content === "first user");
  const queuedUser = timeline.find((item: any) => item.data.content === "queued user");
  const firstReply = timeline.find((item: any) => item.data.content === "first reply");
  expect(firstUser).toBeTruthy();
  expect(queuedUser).toBeTruthy();
  expect(firstReply).toBeTruthy();
  expect(queuedUser.data.thread_id).toBe(firstUserRowId);
  expect(firstReply.data.thread_id).toBe(firstUser.id);
});

test("deferred queued follow-ups survive a new WebChannel instance", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const webMod = await import("../../../src/channels/web.js");
  const createWeb = () => new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "success", result: "unused", attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  const first = createWeb();
  first.enqueueQueuedFollowupItem("web:default", 0, "survives restart");

  const second = createWeb();
  expect(second.getQueuedFollowupCount("web:default")).toBe(1);
  expect(second.getQueuedFollowupItems("web:default")[0]?.queuedContent).toBe("survives restart");
});

test("processChat can materialize a deferred queued follow-up when resumed idle", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  let runCount = 0;
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => {
        runCount += 1;
        return { status: "success", result: "reply after materialize", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  web.enqueueQueuedFollowupItem("web:default", 0, "queued idle item");
  await web.processChat("web:default", "default");

  expect(runCount).toBe(1);
  expect(web.getQueuedFollowupCount("web:default")).toBe(0);
  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).toContain("queued idle item");
  expect(contents).toContain("reply after materialize");
});

test("processChat drains multiple deferred queued follow-ups across resume tasks", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const executedKeys: string[] = [];
  let runningId: string | null = null;
  const pending: Array<{ id?: string; fn: () => Promise<void> }> = [];
  const enqueue = async (fn: () => Promise<void>, id?: string) => {
    if (id && (runningId === id || pending.some((item) => item.id === id))) return;
    pending.push({ fn, id });
    if (runningId) return;
    while (pending.length > 0) {
      const next = pending.shift()!;
      runningId = next.id ?? null;
      executedKeys.push(next.id ?? "");
      try {
        await next.fn();
      } finally {
        runningId = null;
      }
    }
  };

  let runCount = 0;
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async (_prompt: string, _chatJid: string) => {
        runCount += 1;
        return { status: "success", result: `reply ${runCount}`, attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  web.enqueueQueuedFollowupItem("web:default", 0, "queued one");
  web.enqueueQueuedFollowupItem("web:default", 0, "queued two");
  await web.processChat("web:default", "default");
  await waitFor(() => runCount === 2 && web.getQueuedFollowupCount("web:default") === 0, 250, 10);

  expect(runCount).toBe(2);
  expect(web.getQueuedFollowupCount("web:default")).toBe(0);
  expect(executedKeys).toHaveLength(2);
  expect(executedKeys[0]).toMatch(/^resume:web:default:/);
  expect(executedKeys[1]).toMatch(/^resume:web:default:/);
  expect(executedKeys[0]).not.toBe(executedKeys[1]);

  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).toContain("queued one");
  expect(contents).toContain("reply 1");
  expect(contents).toContain("queued two");
  expect(contents).toContain("reply 2");
});

test("processChat does not stall queued draining when multiple deferred items share the same thread root", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const rootRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "root user",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
    thread_id: null,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(rootRowId, rootRowId);

  const executedKeys: string[] = [];
  let runningId: string | null = null;
  const pending: Array<{ id?: string; fn: () => Promise<void> }> = [];
  const enqueue = async (fn: () => Promise<void>, id?: string) => {
    if (id && (runningId === id || pending.some((item) => item.id === id))) return;
    pending.push({ fn, id });
    if (runningId) return;
    while (pending.length > 0) {
      const next = pending.shift()!;
      runningId = next.id ?? null;
      executedKeys.push(next.id ?? "");
      try {
        await next.fn();
      } finally {
        runningId = null;
      }
    }
  };

  let runCount = 0;
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => {
        runCount += 1;
        return { status: "success", result: `threaded reply ${runCount}`, attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  web.enqueueQueuedFollowupItem("web:default", 0, "threaded queued one", rootRowId, new Date().toISOString());
  web.enqueueQueuedFollowupItem("web:default", 0, "threaded queued two", rootRowId, new Date().toISOString());

  await web.processChat("web:default", "default");
  await waitFor(() => runCount === 3 && web.getQueuedFollowupCount("web:default") === 0, 250, 10);

  expect(runCount).toBe(3);
  expect(web.getQueuedFollowupCount("web:default")).toBe(0);
  // The initial root message is processed by the direct call above; the two
  // queued follow-ups must each enqueue their own distinct resume task even
  // though they share the same thread root.
  expect(executedKeys).toHaveLength(2);
  expect(new Set(executedKeys).size).toBe(2);

  const timeline = db.getTimeline("web:default", 20);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).toContain("root user");
  expect(contents).toContain("threaded reply 1");
  expect(contents).toContain("threaded queued one");
  expect(contents).toContain("threaded reply 2");
  expect(contents).toContain("threaded queued two");
  expect(contents).toContain("threaded reply 3");

  const threadedQueuedMessages = timeline.filter((item: any) => item.data.content?.startsWith("threaded queued"));
  expect(threadedQueuedMessages).toHaveLength(2);
  expect(threadedQueuedMessages[0].data.thread_id).toBe(rootRowId);
  expect(threadedQueuedMessages[1].data.thread_id).toBe(rootRowId);
});

test("processChat preserves a deferred queued follow-up if materialization fails", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "success", result: "should not run", attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  web.enqueueQueuedFollowupItem("web:default", 0, "queued idle item");
  const originalStoreMessage = web.storeMessage.bind(web);
  web.storeMessage = (chatJid: string, content: string, isBot: boolean, mediaIds: number[], options?: any) => {
    if (!isBot) return null;
    return originalStoreMessage(chatJid, content, isBot, mediaIds, options);
  };

  await web.processChat("web:default", "default");

  expect(web.getQueuedFollowupCount("web:default")).toBe(1);
  const queueItems = web.getQueuedFollowupItems("web:default");
  expect(queueItems[0]?.queuedContent).toBe("queued idle item");
  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).not.toContain("queued idle item");
});

test("deferred queued follow-up materialize retry count survives a new WebChannel instance", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const webMod = await import("../../../src/channels/web.js");
  const createWeb = () => new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "success", result: "should not run", attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });

  const first = createWeb();
  first.enqueueQueuedFollowupItem("web:default", 0, "queued idle item");
  const firstStoreMessage = first.storeMessage.bind(first);
  first.storeMessage = (chatJid: string, content: string, isBot: boolean, mediaIds: number[], options?: any) => {
    if (!isBot) return null;
    return firstStoreMessage(chatJid, content, isBot, mediaIds, options);
  };

  await first.processChat("web:default", "default");
  expect(db.getDeferredQueuedFollowups("web:default")[0]?.materializeRetries).toBe(1);

  const second = createWeb();
  const secondStoreMessage = second.storeMessage.bind(second);
  second.storeMessage = (chatJid: string, content: string, isBot: boolean, mediaIds: number[], options?: any) => {
    if (!isBot) return null;
    return secondStoreMessage(chatJid, content, isBot, mediaIds, options);
  };

  await second.processChat("web:default", "default");
  expect(db.getDeferredQueuedFollowups("web:default")[0]?.materializeRetries).toBe(2);
});

test("processChat drops a deferred queued follow-up after repeated materialize failures", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");
  db.setDeferredQueuedFollowups("web:default", [
    {
      rowId: -1,
      queuedContent: "drop after repeated failures",
      threadId: null,
      queuedAt: new Date().toISOString(),
      materializeRetries: 5,
    },
  ]);

  const broadcasts: Array<{ event: string; payload: any }> = [];
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => ({ status: "success", result: "should not run", attachments: [] }),
      getContextUsageForChat: async () => null,
    },
  });
  const originalBroadcast = web.broadcastEvent.bind(web);
  web.broadcastEvent = (event: string, payload: any) => {
    broadcasts.push({ event, payload });
    return originalBroadcast(event, payload);
  };
  const originalStoreMessage = web.storeMessage.bind(web);
  web.storeMessage = (chatJid: string, content: string, isBot: boolean, mediaIds: number[], options?: any) => {
    if (!isBot) return null;
    return originalStoreMessage(chatJid, content, isBot, mediaIds, options);
  };

  await web.processChat("web:default", "default");

  expect(web.getQueuedFollowupCount("web:default")).toBe(0);
  expect(db.getDeferredQueuedFollowups("web:default")).toEqual([]);
  expect(broadcasts.some((entry) => entry.event === "agent_followup_consumed" && entry.payload?.row_id === -1)).toBe(true);
});

test("processChat handles persisted user messages one at a time", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const t1 = "2024-01-01T00:00:00.000Z";
  const t2 = "2024-01-01T00:00:01.000Z";
  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "first user",
    timestamp: t1,
    is_from_me: false,
    is_bot_message: false,
  });
  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "second user",
    timestamp: t2,
    is_from_me: false,
    is_bot_message: false,
  });

  let runCount = 0;
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: async (fn: () => Promise<void>) => fn() },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => {
        runCount += 1;
        return { status: "success", result: runCount === 1 ? "reply one" : "reply two", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  await web.processChat("web:default", "default");
  await Bun.sleep(20);

  const timeline = db.getTimeline("web:default", 10);
  const contents = timeline.map((item: any) => item.data.content);
  expect(contents).toContain("first user");
  expect(contents).toContain("second user");
  expect(contents).toContain("reply one");
  expect(contents).toContain("reply two");
  expect(runCount).toBe(2);

  const firstUser = timeline.find((item: any) => item.data.content === "first user");
  const secondUser = timeline.find((item: any) => item.data.content === "second user");
  const firstReply = timeline.find((item: any) => item.data.content === "reply one");
  const secondReply = timeline.find((item: any) => item.data.content === "reply two");
  expect(firstReply.data.thread_id).toBe(firstUser.id);
  expect(secondReply.data.thread_id).toBe(secondUser.id);
});

test("web channel status transitions from thinking to idle during a run", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "user",
    sender_name: "User",
    content: "hello",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: false,
  });

  let resolveRun: (() => void) | null = null;
  const runGate = new Promise<void>((resolve) => { resolveRun = resolve; });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      setSessionBinder: () => {},
      runAgent: async () => {
        await runGate;
        return { status: "success", result: "ok", attachments: [] };
      },
      getContextUsageForChat: async () => null,
    },
  });

  const runPromise = web.processChat("web:default", "default");
  await Bun.sleep(10);

  const activeRes = await web.handleRequest(new Request("http://test/agent/status"));
  const activeJson = await activeRes.json();
  expect(activeJson.status).toBe("active");

  resolveRun?.();
  await runPromise;

  const idleRes = await web.handleRequest(new Request("http://test/agent/status"));
  const idleJson = await idleRes.json();
  expect(idleJson.status).toBe("idle");
});

// --- New coverage: /model error path ---

test("web channel reports /model errors without queueing agent", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  let queued = false;
  let commandHandled = false;

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => { queued = true; } },
    agentPool: {
      runAgent: async () => ({ status: "success", result: "ok" }),
      applyControlCommand: async () => {
        commandHandled = true;
        return { status: "error", message: "Model not found" };
      },
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/default/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "/model nope/unknown" }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(200);
  expect(commandHandled).toBe(true);
  expect(queued).toBe(false);

  const body = await res.json();
  expect(body?.ui_only).toBe(true);
  expect(body?.command?.status).toBe("error");
  expect(body?.command?.message).toContain("Model not found");

  const timeline = db.getTimeline("web:default", 10);
  expect(timeline.length).toBe(0);
});

test("web channel handles adaptive card submit actions", async () => {
  const ws = createTempWorkspace("piclaw-web-channel-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const sourceRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "web-agent",
    sender_name: "Pi",
    content: "Adaptive Card fallback",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: true,
    content_blocks: [{
      type: "adaptive_card",
      card_id: "card-1",
      schema_version: "1.5",
      state: "active",
      payload: { type: "AdaptiveCard", version: "1.5", body: [] },
      fallback_text: "Adaptive Card fallback",
    }],
    thread_id: null,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(sourceRowId, sourceRowId);

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_id: sourceRowId,
      thread_id: sourceRowId,
      card_id: "card-1",
      action: {
        type: "Action.Submit",
        title: "Approve",
        data: { env: "prod", dryRun: false },
      },
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  const updated = db.getMessageByRowId("web:default", sourceRowId);
  expect((updated?.data.content_blocks?.[0] as any)?.state).toBe("completed");

  const timeline = db.getTimeline("web:default", 10);
  const submission = timeline.find((entry: any) => entry.id !== sourceRowId && entry.data?.content?.includes("Card submission: Approve"));
  expect(submission).toBeDefined();
  expect(submission?.data?.content_blocks?.[0]?.type).toBe("adaptive_card_submission");
});

test("web channel handles recovery-continue adaptive card actions on the same thread", async () => {
  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  const recoveryChatJid = "web:chat:recovery-continue";
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");
  db.storeChatMetadata(recoveryChatJid, new Date().toISOString(), "Recovery");

  const sourceRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: recoveryChatJid,
    sender: "web-agent",
    sender_name: "Pi",
    content: "Recovery exhausted. Choose how to continue.",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: true,
    content_blocks: [{
      type: "adaptive_card",
      card_id: "recovery-card-1",
      schema_version: "1.5",
      state: "active",
      payload: { type: "AdaptiveCard", version: "1.5", body: [] },
      fallback_text: "Recovery exhausted. Choose how to continue.",
    }],
    thread_id: null,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(sourceRowId, sourceRowId);

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_id: sourceRowId,
      thread_id: sourceRowId,
      card_id: "recovery-card-1",
      action: {
        type: "Action.Submit",
        title: "Continue",
        data: { intent: "recovery-continue" },
      },
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);

  const recoveryTimeline = db.getTimeline(recoveryChatJid, 10);
  const submission = recoveryTimeline.find((entry: any) => entry.id !== sourceRowId && entry.data?.content?.includes("Continue the previous answer from the last partial output"));
  expect(submission).toBeDefined();
  expect(submission?.data?.thread_id).toBe(sourceRowId);

  const defaultTimeline = db.getTimeline("web:default", 10);
  expect(defaultTimeline.some((entry: any) => String(entry.data?.content || "").includes("Continue the previous answer from the last partial output"))).toBe(false);
});

test("web channel handles recovery-retry-clean adaptive card actions as isolated runs", async () => {
  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  const recoveryChatJid = "web:chat:recovery-retry";
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");
  db.storeChatMetadata(recoveryChatJid, new Date().toISOString(), "Recovery");

  const sourceRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: recoveryChatJid,
    sender: "web-agent",
    sender_name: "Pi",
    content: "Recovery exhausted. Choose how to continue.",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: true,
    content_blocks: [{
      type: "adaptive_card",
      card_id: "recovery-card-2",
      schema_version: "1.5",
      state: "active",
      payload: { type: "AdaptiveCard", version: "1.5", body: [] },
      fallback_text: "Recovery exhausted. Choose how to continue.",
    }],
    thread_id: 11,
  });

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_id: sourceRowId,
      thread_id: 11,
      card_id: "recovery-card-2",
      action: {
        type: "Action.Submit",
        title: "Retry cleanly",
        data: { intent: "recovery-retry-clean" },
      },
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);

  const recoveryTimeline = db.getTimeline(recoveryChatJid, 10);
  const submission = recoveryTimeline.find((entry: any) => entry.id !== sourceRowId && entry.data?.content?.includes("Retry the previous request cleanly as a new isolated run"));
  expect(submission).toBeDefined();
  expect(submission?.data?.thread_id == null || submission?.data?.thread_id === submission?.id).toBe(true);

  const defaultTimeline = db.getTimeline("web:default", 10);
  expect(defaultTimeline.some((entry: any) => String(entry.data?.content || "").includes("Retry the previous request cleanly as a new isolated run"))).toBe(false);
});

test("web channel strips internal submit metadata before persisting completion state", async () => {
  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const sourceRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "web-agent",
    sender_name: "Pi",
    content: "Adaptive Card fallback",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: true,
    content_blocks: [{
      type: "adaptive_card",
      card_id: "card-2",
      schema_version: "1.5",
      state: "active",
      payload: { type: "AdaptiveCard", version: "1.5", body: [] },
      fallback_text: "Adaptive Card fallback",
    }],
    thread_id: null,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(sourceRowId, sourceRowId);

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_id: sourceRowId,
      thread_id: sourceRowId,
      card_id: "card-2",
      action: {
        type: "Action.Submit",
        title: "Approve",
        data: { env: "prod", nested: { keep: true, __secret: "x" }, __internal: "drop" },
      },
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);

  const updated = db.getMessageByRowId("web:default", sourceRowId);
  expect((updated?.data.content_blocks?.[0] as any)?.last_submission?.data).toEqual({
    env: "prod",
    nested: { keep: true },
  });

  const timeline = db.getTimeline("web:default", 10);
  const submission = timeline.find((entry: any) => entry.id !== sourceRowId && entry.data?.content?.includes("Card submission: Approve"));
  expect(submission?.data?.content).toContain("env: prod");
  expect(submission?.data?.content).not.toContain("__internal");
  expect(submission?.data?.content_blocks?.[0]?.data).toEqual({
    env: "prod",
    nested: { keep: true },
  });
});

test("web channel rejects simulated adaptive-card test submit failures without completing the card", async () => {
  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const sourceRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "web-agent",
    sender_name: "Pi",
    content: "Adaptive Card fallback",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: true,
    content_blocks: [{
      type: "adaptive_card",
      card_id: "test-card-submit-error-1",
      schema_version: "1.5",
      state: "active",
      payload: { type: "AdaptiveCard", version: "1.5", body: [] },
      fallback_text: "Adaptive Card fallback",
    }],
    thread_id: null,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(sourceRowId, sourceRowId);

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_id: sourceRowId,
      thread_id: sourceRowId,
      card_id: "test-card-submit-error-1",
      action: {
        type: "Action.Submit",
        title: "Trigger submit error",
        data: { variant: "submit-error", __test_error: "submit" },
      },
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(422);
  expect(await res.json()).toEqual({ error: "Simulated adaptive-card test submit failure." });

  const updated = db.getMessageByRowId("web:default", sourceRowId);
  expect((updated?.data.content_blocks?.[0] as any)?.state).toBe("active");

  const timeline = db.getTimeline("web:default", 10);
  const submission = timeline.find((entry: any) => entry.id !== sourceRowId && entry.data?.content?.includes("Card submission:"));
  expect(submission).toBeUndefined();
});

test("web channel commits TOTP setup only after successful same-card confirmation", async () => {
  const fixture = await createStoredTotpCardFixture({
    command: { type: "totp", action: "enrol" },
  });
  expect(fixture.parsed.ok).toBe(true);
  if (!fixture.parsed.ok) return;

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_id: fixture.sourceRowId,
      thread_id: fixture.sourceRowId,
      card_id: fixture.cardId,
      action: {
        type: "Action.Submit",
        title: "Confirm setup",
        data: {
          intent: "totp-confirm",
          __totp_token: fixture.token,
          confirmation_code: totpCode(fixture.parsed.state.secret),
        },
      },
    }),
  });

  const res = await (fixture.web as any).handleRequest(req);
  expect(res.status).toBe(200);
  expect(res.headers.get("Set-Cookie")).toContain("piclaw_session=");
  expect(fixture.config.WEB_RUNTIME_CONFIG.totpSecret).toBe(fixture.parsed.state.secret);

  const updated = fixture.db.getMessageByRowId("web:default", fixture.sourceRowId);
  expect((updated?.data.content_blocks?.[0] as any)?.state).toBe("completed");

  const timeline = fixture.db.getTimeline("web:default", 10);
  const feedback = timeline.find((entry: any) => entry.id !== fixture.sourceRowId && entry.data?.content?.includes("TOTP setup confirmed."));
  expect(feedback).toBeDefined();

  const verifyRes = await (fixture.web as any).handleRequest(new Request("http://test/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: totpCode(fixture.parsed.state.secret) }),
  }));
  expect(verifyRes.status).toBe(200);
});

test("web channel invalidates existing sessions when TOTP setup is first confirmed", async () => {
  const fixture = await createStoredTotpCardFixture({
    command: { type: "totp", action: "enrol" },
  });
  expect(fixture.parsed.ok).toBe(true);
  if (!fixture.parsed.ok) return;

  fixture.db.createWebSession("pre-setup-session", fixture.db.DEFAULT_WEB_USER_ID, 3600, "passkey");

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": "piclaw_session=pre-setup-session" },
    body: JSON.stringify({
      post_id: fixture.sourceRowId,
      thread_id: fixture.sourceRowId,
      card_id: fixture.cardId,
      action: {
        type: "Action.Submit",
        title: "Confirm setup",
        data: {
          intent: "totp-confirm",
          __totp_token: fixture.token,
          confirmation_code: totpCode(fixture.parsed.state.secret),
        },
      },
    }),
  });

  const res = await (fixture.web as any).handleRequest(req);
  expect(res.status).toBe(200);
  const setCookie = res.headers.get("Set-Cookie");
  expect(setCookie).toContain("piclaw_session=");
  expect(fixture.config.WEB_RUNTIME_CONFIG.totpSecret).toBe(fixture.parsed.state.secret);
  expect(fixture.db.getWebSession("pre-setup-session")).toBeNull();

  const nextSessionToken = setCookie?.match(/piclaw_session=([^;]+)/)?.[1];
  expect(nextSessionToken).toBeTruthy();
  expect(fixture.db.getWebSession(decodeURIComponent(nextSessionToken || ""))?.auth_method).toBe("totp");

  const timeline = fixture.db.getTimeline("web:default", 10);
  const feedback = timeline.find((entry: any) => entry.id !== fixture.sourceRowId && entry.data?.content?.includes("Existing web sessions were invalidated."));
  expect(feedback).toBeDefined();
});

test("web channel leaves TOTP setup unchanged on invalid same-card confirmation", async () => {
  const fixture = await createStoredTotpCardFixture({
    command: { type: "totp", action: "enrol" },
  });
  expect(fixture.parsed.ok).toBe(true);
  if (!fixture.parsed.ok) return;

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_id: fixture.sourceRowId,
      thread_id: fixture.sourceRowId,
      card_id: fixture.cardId,
      action: {
        type: "Action.Submit",
        title: "Confirm setup",
        data: {
          intent: "totp-confirm",
          __totp_token: fixture.token,
          confirmation_code: "000000",
        },
      },
    }),
  });

  const res = await (fixture.web as any).handleRequest(req);
  expect(res.status).toBe(200);
  expect(res.headers.get("Set-Cookie")).toBeNull();
  expect(fixture.config.WEB_RUNTIME_CONFIG.totpSecret).toBe("");

  const updated = fixture.db.getMessageByRowId("web:default", fixture.sourceRowId);
  expect((updated?.data.content_blocks?.[0] as any)?.state).toBe("active");

  const timeline = fixture.db.getTimeline("web:default", 10);
  const feedback = timeline.find((entry: any) => entry.id !== fixture.sourceRowId && entry.data?.content?.includes("No changes were made."));
  expect(feedback).toBeDefined();

  const verifyRes = await (fixture.web as any).handleRequest(new Request("http://test/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: totpCode(fixture.parsed.state.secret) }),
  }));
  expect(verifyRes.status).toBe(404);
});

test("web channel commits TOTP reset only after successful new-secret confirmation", async () => {
  const currentSecret = "CURRENTSECRET";
  const fixture = await createStoredTotpCardFixture({
    currentSecret,
    command: { type: "totp", action: "reset", code: totpCode(currentSecret) },
  });
  expect(fixture.parsed.ok).toBe(true);
  if (!fixture.parsed.ok) return;

  fixture.db.createWebSession("browser-session", fixture.db.DEFAULT_WEB_USER_ID, 3600, "passkey");
  fixture.db.createWebSession("old-session", fixture.db.DEFAULT_WEB_USER_ID, 3600, "passkey");

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": "piclaw_session=browser-session" },
    body: JSON.stringify({
      post_id: fixture.sourceRowId,
      thread_id: fixture.sourceRowId,
      card_id: fixture.cardId,
      action: {
        type: "Action.Submit",
        title: "Confirm reset",
        data: {
          intent: "totp-confirm",
          __totp_token: fixture.token,
          confirmation_code: totpCode(fixture.parsed.state.secret),
        },
      },
    }),
  });

  const res = await (fixture.web as any).handleRequest(req);
  expect(res.status).toBe(200);
  expect(res.headers.get("Set-Cookie")).toContain("piclaw_session=");
  expect(fixture.config.WEB_RUNTIME_CONFIG.totpSecret).toBe(fixture.parsed.state.secret);
  expect(fixture.db.getWebSession("old-session")).toBeNull();

  const updated = fixture.db.getMessageByRowId("web:default", fixture.sourceRowId);
  expect((updated?.data.content_blocks?.[0] as any)?.state).toBe("completed");

  const timeline = fixture.db.getTimeline("web:default", 10);
  const feedback = timeline.find((entry: any) => entry.id !== fixture.sourceRowId && entry.data?.content?.includes("Existing web sessions were invalidated."));
  expect(feedback).toBeDefined();
});

test("web channel preserves existing secret and sessions when reset confirmation fails", async () => {
  const currentSecret = "CURRENTSECRET";
  const fixture = await createStoredTotpCardFixture({
    currentSecret,
    command: { type: "totp", action: "reset", code: totpCode(currentSecret) },
  });
  expect(fixture.parsed.ok).toBe(true);
  if (!fixture.parsed.ok) return;

  fixture.db.createWebSession("browser-session", fixture.db.DEFAULT_WEB_USER_ID, 3600, "passkey");
  fixture.db.createWebSession("old-session", fixture.db.DEFAULT_WEB_USER_ID, 3600, "passkey");

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": "piclaw_session=browser-session" },
    body: JSON.stringify({
      post_id: fixture.sourceRowId,
      thread_id: fixture.sourceRowId,
      card_id: fixture.cardId,
      action: {
        type: "Action.Submit",
        title: "Confirm reset",
        data: {
          intent: "totp-confirm",
          __totp_token: fixture.token,
          confirmation_code: "000000",
        },
      },
    }),
  });

  const res = await (fixture.web as any).handleRequest(req);
  expect(res.status).toBe(200);
  expect(res.headers.get("Set-Cookie")).toBeNull();
  expect(fixture.config.WEB_RUNTIME_CONFIG.totpSecret).toBe(currentSecret);
  expect(fixture.db.getWebSession("old-session")).not.toBeNull();

  const updated = fixture.db.getMessageByRowId("web:default", fixture.sourceRowId);
  expect((updated?.data.content_blocks?.[0] as any)?.state).toBe("active");

  const timeline = fixture.db.getTimeline("web:default", 10);
  const feedback = timeline.find((entry: any) => entry.id !== fixture.sourceRowId && entry.data?.content?.includes("No changes were made."));
  expect(feedback).toBeDefined();
});

test("web channel supports keep-active submit behavior without completing the card", async () => {
  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const sourceRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "web-agent",
    sender_name: "Pi",
    content: "Adaptive Card fallback",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: true,
    content_blocks: [{
      type: "adaptive_card",
      card_id: "card-stay-open",
      schema_version: "1.5",
      state: "active",
      submit_behavior: "keep_active",
      payload: { type: "AdaptiveCard", version: "1.5", body: [] },
      fallback_text: "Adaptive Card fallback",
    }],
    thread_id: null,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(sourceRowId, sourceRowId);

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_id: sourceRowId,
      thread_id: sourceRowId,
      card_id: "card-stay-open",
      action: {
        type: "Action.Submit",
        title: "Submit without closing",
        data: { note: "keep going" },
      },
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.card_state).toBe("active");
  expect(body.card_updated).toBe(false);

  const updated = db.getMessageByRowId("web:default", sourceRowId);
  expect((updated?.data.content_blocks?.[0] as any)?.state).toBe("active");
  expect((updated?.data.content_blocks?.[0] as any)?.last_submission).toBeUndefined();

  const timeline = db.getTimeline("web:default", 10);
  const submission = timeline.find((entry: any) => entry.id !== sourceRowId && entry.data?.content?.includes("Card submission: Submit without closing"));
  expect(submission).toBeDefined();
  expect(submission?.data?.content_blocks?.[0]?.type).toBe("adaptive_card_submission");
});

test("web channel can transition a card to cancelled via Action.Submit metadata", async () => {
  const db = await import("../../../src/db.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const sourceRowId = db.storeMessage({
    id: `msg-${Math.random()}`,
    chat_jid: "web:default",
    sender: "web-agent",
    sender_name: "Pi",
    content: "Adaptive Card fallback",
    timestamp: new Date().toISOString(),
    is_from_me: false,
    is_bot_message: true,
    content_blocks: [{
      type: "adaptive_card",
      card_id: "card-cancelled",
      schema_version: "1.5",
      state: "active",
      payload: { type: "AdaptiveCard", version: "1.5", body: [] },
      fallback_text: "Adaptive Card fallback",
    }],
    thread_id: null,
  });
  db.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(sourceRowId, sourceRowId);

  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/card-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      post_id: sourceRowId,
      thread_id: sourceRowId,
      card_id: "card-cancelled",
      action: {
        type: "Action.Submit",
        title: "Cancel",
        data: { reason: "user", __card_state: "cancelled" },
      },
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(201);
  const body = await res.json();
  expect(body.card_state).toBe("cancelled");

  const updated = db.getMessageByRowId("web:default", sourceRowId);
  expect((updated?.data.content_blocks?.[0] as any)?.state).toBe("cancelled");
  expect((updated?.data.content_blocks?.[0] as any)?.last_submission?.data).toEqual({ reason: "user" });
});

test("web channel exposes side prompts through /agent/side-prompt", async () => {
  const webMod = await import("../../../src/channels/web.js");
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: {
      runSidePrompt: async (chatJid: string, prompt: string, options: any) => ({
        status: "success",
        result: `answer:${prompt}`,
        thinking: options?.systemPrompt ?? null,
        model: `model-for:${chatJid}`,
        stopReason: "stop",
      }),
      isStreaming: () => false,
      runAgent: async () => ({ status: "success", result: "ok" }),
      getContextUsageForChat: async () => null,
    },
  });

  const req = new Request("http://test/agent/side-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "What changed?",
      system_prompt: "Summarize briefly.",
      chat_jid: "web:side-test",
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    status: "success",
    result: "answer:What changed?",
    thinking: "Summarize briefly.",
    model: "model-for:web:side-test",
    stopReason: "stop",
  });
});

test("web channel streams side prompts through /agent/side-prompt/stream", async () => {
  const webMod = await import("../../../src/channels/web.js");
  class SidePromptAgentPoolStub {
    modelRegistry = { id: "registry" };
    async runSidePrompt(chatJid: string, prompt: string, options: any) {
      if (!this.modelRegistry) throw new Error("missing modelRegistry binding");
      options?.onThinkingDelta?.("plan");
      options?.onTextDelta?.("answer");
      return {
        status: "success",
        result: `answer:${prompt}`,
        thinking: "plan",
        model: `model-for:${chatJid}`,
        stopReason: "stop",
      };
    }
    isStreaming() { return false; }
    async runAgent() { return { status: "success", result: "ok" }; }
    async getContextUsageForChat() { return null; }
  }
  const web = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: new SidePromptAgentPoolStub(),
  });

  const req = new Request("http://test/agent/side-prompt/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "What changed?",
      system_prompt: "Summarize briefly.",
      chat_jid: "web:side-test",
    }),
  });

  const res = await (web as any).handleRequest(req);
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("text/event-stream");
  const body = await res.text();
  expect(body).toContain("event: side_prompt_start");
  expect(body).toContain('event: side_prompt_thinking_delta');
  expect(body).toContain('"delta":"plan"');
  expect(body).toContain('event: side_prompt_text_delta');
  expect(body).toContain('"delta":"answer"');
  expect(body).toContain('event: side_prompt_done');
  expect(body).toContain('"result":"answer:What changed?"');
});
