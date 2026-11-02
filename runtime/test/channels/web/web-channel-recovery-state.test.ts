import {readFileSync} from "node:fs";
import {initializeChatCursorStorage,legacyCursorArchive} from "../../../src/db/chat-cursor-storage.js";
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
  // Build a synthetic pre-ledger cursor root inside this blank isolated fixture.
  // The actual populated file upgrade/reopen is qualified in schema-ownership.
  if ((db.getDb().query('SELECT COUNT(*) AS n FROM chat_cursors').get() as {n:number}).n !== 0) throw Error('Cursor fixture must be empty');
  db.getDb().transaction(() => {
    db.getDb().exec("DROP TABLE chat_cursors; DELETE FROM piclaw_schema_migrations WHERE owner='host.chat-cursors'");
    db.getDb().exec(readFileSync(new URL('../../fixtures/legacy-chat-cursors.sql',import.meta.url),'utf8'));
    initializeChatCursorStorage(db.getDb());
  })();
  const now = new Date().toISOString();
  for (const chatJid of chatJids) {
    db.storeChatMetadata(chatJid, now, "Web");
  }

  const webMod = await import("../../../src/channels/web.js");
  return { db, webMod };
}

test("a fresh web channel cannot restore historical tool or compaction observations", async () => {
  const { db, webMod } = await initWebChannelFixture(["web:default", "web:compact"]);

  db.setRouterState("last_agent_timestamp_web", JSON.stringify({
    agentStatuses: {
      "web:default": {
        type: "tool_call",
        title: "Running tool",
        turn_id: "turn-stale",
        runtime_generation: "old-runtime",
      },
      "web:compact": {
        type: "intent",
        intent_key: "compaction",
        title: "Compacting context",
        started_at: "2026-03-14T14:00:00.000Z",
        turn_id: "turn-42",
        runtime_generation: "old-runtime",
      },
    },
    contextUsages: {},
    draftRecoveries: {},
  }));

  const second = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });
  expect(second).not.toHaveProperty('loadState');

  expect(second.getAgentStatus("web:default")).toBeNull();
  expect(second.getAgentStatus("web:compact")).toBeNull();
});

test("web channel ignores old inflight cursors as display authority while preserving them", async () => {
  const { db, webMod } = await initWebChannelFixture(["web:compact"]);

  const userTs = new Date(Date.now() - 5_000).toISOString();
  const messageId = `msg-${Math.random()}`;
  db.storeMessage({
    id: messageId,
    chat_jid: "web:compact",
    sender: "user",
    sender_name: "User",
    content: "/compact",
    timestamp: userTs,
    is_from_me: false,
    is_bot_message: false,
  });
  db.setChatCursor('web:compact',userTs);
  db.getDb().query('INSERT INTO '+legacyCursorArchive+'(chat_jid,cursor_ts,inflight_message_id,inflight_started_at) VALUES(?,?,?,?)').run('web:compact',userTs,messageId,'2026-03-14T14:00:00.000Z');
  const archived = db.getDb().query('SELECT rowid,* FROM '+legacyCursorArchive).all();

  db.setRouterState("last_agent_timestamp_web", JSON.stringify({
    agentStatuses: {
      "web:compact": {
        type: "intent",
        intent_key: "compaction",
        title: "Compacting context",
        started_at: "2026-03-14T14:00:00.000Z",
        turn_id: "turn-42",
        runtime_generation: "old-runtime",
      },
    },
    contextUsages: {},
    draftRecoveries: {},
  }));

  const second = new (webMod.WebChannel as any)({
    queue: { enqueue: () => {} },
    agentPool: { runAgent: async () => ({ status: "success", result: "ok" }), getContextUsageForChat: async () => null },
  });
  expect(second).not.toHaveProperty('loadState');

  expect(second.getAgentStatus("web:compact")).toBeNull();
  expect(db.getDb().query('SELECT rowid,* FROM '+legacyCursorArchive).all()).toEqual(archived);
});

test("native startup and live draft buffers preserve historical payloads without publishing them", async () => {
  const { db, webMod } = await initWebChannelFixture(["web:historical"]);
  const historical = { turnId: "old-turn", text: "Old uncommitted draft", totalLines: 1, updatedAt: 1 };
  db.setRouterState("last_agent_timestamp_web", JSON.stringify({ agentStatuses: {}, contextUsages: {}, draftRecoveries: { "web:historical": historical } }));
  db.getDb().query('INSERT INTO '+legacyCursorArchive+'(chat_jid,cursor_ts,inflight_message_id,inflight_started_at) VALUES(?,?,?,?)').run('web:historical','2026-01-01T00:00:01.000Z','old-input','2026-01-01T00:00:00.000Z');
  const web = new (webMod.WebChannel as any)({ queue: { enqueue() { throw Error("No legacy replay"); } },
    agentPool: { getContextUsageForChat: async () => null } });
  const before = db.getDb().serialize();
  expect(web).not.toHaveProperty('loadState');
  web.updateAgentStatus("web:historical", { type: "thinking", turn_id: "new-turn" });
  web.updateDraftBuffer("new-turn", "Current transient draft", 1);
  const { runWebStartupRecoveryBootstrap } = await import("../../../src/runtime/startup.js");
  const scheduled: (() => void)[] = [];
  runWebStartupRecoveryBootstrap(web, resume => scheduled.push(resume));
  expect(scheduled).toHaveLength(1);
  expect(web.getBuffer("new-turn", "draft")).toEqual({ text: "Current transient draft", totalLines: 1, updatedAt: expect.any(Number) });
  expect(db.getDb().serialize()).toEqual(before);
  expect(db.getTimeline("web:historical", 10)).toEqual([]);
});
