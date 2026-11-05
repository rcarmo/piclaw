/**
 * test/channels/web/web-channel.test.ts – Integration tests for WebChannel.
 *
 * Tests HTTP server startup, request routing, authentication,
 * SSE connections, and the full message lifecycle.
 */

import { createHmac } from "node:crypto";
import { expect, test, afterEach } from "bun:test";
import { createTempWorkspace, setEnv, waitFor } from "../../helpers.js";


type NativeQueueIntent = { chatJid: string; text: string; behavior: "steer"; sourceId: string; rowId: number };

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(async () => {
  try {
    const config = await import("../../../src/core/config.js");
    config.setWebTotpSecret("");
    const { getExtensionKvStore } = await import("../../../src/extension-kv-registry.js");
    getExtensionKvStore().clear("piclaw.tool-budget-continuation");
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => { queued = true; } },
    agentPool: {
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => {} },
    agentPool: {
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });

  web.updateAgentStatus("web:default", { sdk_observation: true, type: "thinking", title: "Thinking...", turn_id: "turn-1" });

  const res = await (web as any).handleRequest(new Request("http://test/agent/status"));
  const json = await res.json();
  expect(json.status).toBe("active");
  expect(json.data.turn_id).toBe("turn-1");

  web.updateAgentStatus("web:default", { sdk_observation: true, type: "done", turn_id: "turn-1" });
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => { queued = true; } },
    agentPool: {
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      getAvailableModels: async () => ({models:[]}),
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

test("concurrent TOTP confirmations commit one card and issue one surviving login", async () => {
  const fixture = await createStoredTotpCardFixture({ command: { type: "totp", action: "enrol" } });
  expect(fixture.parsed.ok).toBe(true);
  if (!fixture.parsed.ok) return;
  const secret = fixture.parsed.state.secret;
  const request = () => new Request("http://test/agent/card-action", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ post_id: fixture.sourceRowId, thread_id: fixture.sourceRowId, card_id: fixture.cardId,
      action: { type: "Action.Submit", title: "Confirm setup", data: { intent: "totp-confirm", __totp_token: fixture.token, confirmation_code: totpCode(secret) } } }),
  });
  const outcomes = await Promise.allSettled([fixture.web.handleRequest(request()), fixture.web.handleRequest(request())]);
  const accepted = outcomes.filter((entry): entry is PromiseFulfilledResult<Response> => entry.status === "fulfilled" && entry.value.status === 200);
  expect(accepted).toHaveLength(1);
  expect(accepted[0]!.value.headers.get("Set-Cookie")).toContain("piclaw_session=");
  expect(fixture.db.getDb().query("SELECT count(*) n FROM web_sessions WHERE auth_method='totp'").get()).toEqual({ n: 1 });
  expect(fixture.config.WEB_RUNTIME_CONFIG.totpSecret).toBe(secret);
  expect((fixture.db.getMessageByRowId("web:default", fixture.sourceRowId)?.data.content_blocks?.[0] as any)?.state).toBe("completed");
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
    queue: { enqueue: () => {} },
    agentPool: {
      isStreaming: () => false,
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
      getAvailableModels: async () => ({models:[]}),
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
    getInputSourceAdmission: () => () => {}, dispatchAcceptedInput: async (_chat:string,_id:string,row:number) => ({submission_id:row,queued:false}),
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
