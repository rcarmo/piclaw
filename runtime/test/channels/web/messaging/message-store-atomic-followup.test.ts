import { afterEach, describe, expect, test } from "bun:test";

import { createTempWorkspace, setEnv } from "../../../helpers.js";

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(() => {
  restoreEnv?.();
  restoreEnv = null;
  cleanupWorkspace?.();
  cleanupWorkspace = null;
});

async function fixture() {
  const ws = createTempWorkspace("piclaw-atomic-followup-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const db = await import("../../../../src/db.js");
  const store = await import("../../../../src/channels/web/messaging/message-store.js");
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");
  const channel = { pendingLinkPreviews: new Set<number>(), broadcastEvent: () => {} } as any;
  const params = {
    chatJid: "web:default",
    content: "continue protected work",
    isBot: false,
    mediaIds: [],
    agentId: "default",
    agentName: "Pi",
    userName: "You",
  };
  return { db, store, channel, params };
}

describe("atomic deferred follow-up materialization", () => {
  test('accepted UUID binding rolls back SQL side effects and retries with unchanged identity', async () => {
    const { db, store, channel, params } = await fixture();
    const source_id = 'source-00000000-0000-4000-8000-000000000001';
    const item = { rowId: -1, source_id, source_accepted: true as const, queuedContent: params.content, queuedAt: new Date().toISOString() };
    db.setDeferredQueuedFollowups(params.chatJid, [item]);
    db.getDb().exec('CREATE TEMP TABLE materialized_fixture (source_id TEXT, message_id TEXT, row_id INTEGER)');
    const options = { consumeDeferredFollowupRowId: -1 };
    // No host port must fail closed, not silently become a legacy timeline input.
    expect(store.storeWebMessage(channel, params, options)).toBeNull();
    for (const asyncResult of [false, true]) {
      expect(store.storeWebMessage(channel, params, { ...options, materializeQueuedSource: ({ item, message, rowId, database }) => {
        expect(database.inTransaction).toBe(true);
        expect(item.source_id).toBe(source_id);
        expect(message.id).toBe(source_id);
        database.query('INSERT INTO materialized_fixture VALUES (?, ?, ?)').run(source_id, message.id, rowId);
        if (asyncResult) return Promise.resolve() as any;
        throw Error('binding fault');
      } })).toBeNull();
      expect(db.getDb().query('SELECT * FROM materialized_fixture').all()).toEqual([]);
      expect(db.getDb().query('SELECT * FROM messages').all()).toEqual([]);
      expect(db.getDeferredQueuedFollowups(params.chatJid)[0]?.source_id).toBe(source_id);
    }
    expect(store.storeWebMessage(channel, { ...params, content: 'different payload' }, { ...options, materializeQueuedSource() {} })).toBeNull();
    const result = store.storeWebMessage(channel, params, { ...options, materializeQueuedSource: ({ message, rowId, database }) => {
      database.query('INSERT INTO materialized_fixture VALUES (?, ?, ?)').run(source_id, message.id, rowId);
    } });
    expect(result).not.toBeNull();
    expect(db.getDb().query('SELECT * FROM materialized_fixture').get()).toEqual({ source_id, message_id: source_id, row_id: result!.id });
    expect(db.getDeferredQueuedFollowups(params.chatJid)).toEqual([]);
    // Restored/stale queue intent must not invoke the upsert and overwrite a committed row.
    db.setDeferredQueuedFollowups(params.chatJid, [{ ...item, queuedContent: 'collision' }]);
    expect(store.storeWebMessage(channel, { ...params, content: 'collision' }, { ...options, materializeQueuedSource() {} })).toBeNull();
    expect(db.getDb().query('SELECT content FROM messages WHERE id=?').get(source_id)).toEqual({ content: params.content });
  });
  test("fault before queue consume rolls back the user row and preserves durable intent", async () => {
    const { db, store, channel, params } = await fixture();
    db.setDeferredQueuedFollowups("web:default", [{
      rowId: -1,
      queuedContent: params.content,
      threadId: 77,
      queuedAt: new Date().toISOString(),
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-1" },
    }]);

    const result = store.storeWebMessage(channel, params, {
      threadId: 77,
      consumeDeferredFollowupRowId: -1,
      beforeDeferredFollowupConsume: () => { throw new Error("simulated process interruption"); },
    });

    expect(result).toBeNull();
    expect(db.getDeferredQueuedFollowups("web:default").map((item) => item.rowId)).toEqual([-1]);
    expect(db.getDb().prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 0 AND content = ?").get("web:default", params.content)).toEqual({ count: 0 });
  });

  test("null consume id is treated as absent and does not roll back an ordinary user row", async () => {
    const { db, store, channel, params } = await fixture();

    const result = store.storeWebMessage(channel, params, {
      threadId: 77,
      consumeDeferredFollowupRowId: null,
    });

    expect(result?.data.content).toBe(params.content);
    expect(db.getDb().prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 0 AND content = ?").get("web:default", params.content)).toEqual({ count: 1 });
  });

  test("successful commit leaves exactly one user row and no queue intent", async () => {
    const { db, store, channel, params } = await fixture();
    db.setDeferredQueuedFollowups("web:default", [{
      rowId: -1,
      queuedContent: params.content,
      threadId: 77,
      queuedAt: new Date().toISOString(),
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-1" },
    }]);

    const result = store.storeWebMessage(channel, params, {
      threadId: 77,
      consumeDeferredFollowupRowId: -1,
    });

    expect(result?.data.content).toBe(params.content);
    expect(db.getDeferredQueuedFollowups("web:default")).toEqual([]);
    expect(db.getDb().prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 0 AND content = ?").get("web:default", params.content)).toEqual({ count: 1 });

    const replay = store.storeWebMessage(channel, params, {
      threadId: 77,
      consumeDeferredFollowupRowId: -1,
    });
    expect(replay).toBeNull();
    expect(db.getDb().prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_jid = ? AND is_bot_message = 0 AND content = ?").get("web:default", params.content)).toEqual({ count: 1 });
  });
});
