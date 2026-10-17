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

async function createServiceFixture(fileBacked = false) {
  const ws = createTempWorkspace("piclaw-queued-followup-service-");
  cleanupWorkspace = ws.cleanup;
  restoreEnv = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });

  const db = await import("../../../../src/db.js");
  // setEnv enforces memory by default; this reopen fixture explicitly owns its
  // temporary store and restores the default before workspace cleanup.
  if (fileBacked) process.env.PICLAW_DB_IN_MEMORY = "0";
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const mod = await import("../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js");
  const service = new mod.QueuedFollowupLifecycleService();
  return { db, service };
}

describe("queued follow-up lifecycle service", () => {
  test("host identity survives file database reopen and queue edits without changing public actions", async () => {
    const { service, db } = await createServiceFixture(true);
    const { QueuedFollowupLifecycleService } = await import("../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js");
    try {
      const rowId = service.enqueueQueuedFollowupItem("web:default", 0, "persistent", null, "2024-01-01T00:00:00.000Z", {
        source_id: "forged-untyped-host-extras",
      } as any);
      const original = service.peekQueuedFollowupItem("web:default")!;
      expect(original.source_id).toMatch(/^source-[0-9a-f-]{36}$/);
      expect(service.replaceQueuedFollowupItem("web:default", { ...original, source_id: "replacement", materializeRetries: 1 })).toBe(true);
      expect(service.peekQueuedFollowupItem("web:default")!.source_id).toBe(original.source_id);
      db.closeDatabase();
      db.initDatabase();
      const restored = new QueuedFollowupLifecycleService();
      expect(restored.peekQueuedFollowupItem("web:default")).toEqual({ ...original, materializeRetries: 1 });
      const consumed = restored.consumeQueuedFollowupItem("web:default")!;
      restored.prependQueuedFollowupItem("web:default", consumed);
      expect(restored.peekQueuedFollowupItem("web:default")!.source_id).toBe(original.source_id);
      const removed = await restored.removeQueuedFollowupForAction("web:default", rowId);
      expect(removed.removed!.source_id).toBe(original.source_id);
      const restartedEmpty = new QueuedFollowupLifecycleService();
      expect(restartedEmpty.enqueueQueuedFollowupItem("web:default", 0, "persistent", null, original.queuedAt)).toBe(rowId);
      expect(restartedEmpty.peekQueuedFollowupItem("web:default")!.source_id).not.toBe(original.source_id);
    } finally {
      db.closeDatabase();
    }
  });
  test('asynchronous admission commits one atomic queue update and rolls back revoked authority', async () => {
    const { service } = await createServiceFixture();
    const signal = new AbortController().signal;
    await Promise.all([
      service.admitQueuedFollowupItem(['web:admit',0,'first'],()=>{},signal),
      service.admitQueuedFollowupItem(['web:admit',0,'second'],()=>{},signal),
    ]);
    expect(service.getQueuedFollowupItems('web:admit').map(item=>item.queuedContent)).toEqual(['first','second']);
    let checks=0;
    await expect(service.admitQueuedFollowupItem(['web:admit',0,'revoked'],()=>{if(++checks===2)throw Error('revoked');},signal)).rejects.toThrow('revoked');
    expect(service.getQueuedFollowupItems('web:admit').map(item=>item.queuedContent)).toEqual(['first','second']);
  });
  test('post-write authority denial restores queue SQL and allocator seed before retry', async () => {
    const { service, db } = await createServiceFixture();
    const signal = new AbortController().signal;
    const first = service.enqueueQueuedFollowupItem('web:default', 0, 'previous', null, undefined, { mediaIds: [7], contentBlocks: [{ type: 'text', text: 'body' }] });
    const before = service.getQueuedFollowupItems('web:default');
    let called = 0;
    await expect(service.admitQueuedFollowupItem(['web:default', 0, 'denied'], phase => {
      if (phase === 'after') throw Error('revoked after queue write');
    }, signal, ({ item, database }) => {
      called++;
      expect(database).toBe(db.getDb()); expect(database.inTransaction).toBe(true);
      expect(item.rowId).toBe(first - 1);
      expect(service.getQueuedFollowupItems('web:default')).toHaveLength(2);
    })).rejects.toThrow('revoked after queue write');
    expect(called).toBe(1);
    expect(service.getQueuedFollowupItems('web:default')).toEqual(before);
    expect(await service.admitQueuedFollowupItem(['web:default', 0, 'next accepted'], () => {}, signal)).toBe(first - 1);
  });
  test('asynchronous admission rejects redirected workspace before committing captured database work', async () => {
    const {service}=await createServiceFixture();
    let restore:(()=>void)|undefined;
    try {
      await expect(service.admitQueuedFollowupItem(['web:binding',0,'must not commit'],()=>{restore??=setEnv({PICLAW_WORKSPACE:process.env.PICLAW_WORKSPACE+'/changed'});},new AbortController().signal)).rejects.toThrow('binding changed');
    } finally { restore?.(); }
    expect(service.getQueuedFollowupItems('web:binding')).toEqual([]);
  });
  test("combines deferred and placeholder items into queue-state payloads without duplicate row ids", async () => {
    const { db, service } = await createServiceFixture();

    const placeholderTimestamp = "2024-01-01T00:00:03.000Z";
    const placeholderRowId = db.storeMessage({
      id: `msg-${Math.random()}`,
      chat_jid: "web:default",
      sender: "web-agent",
      sender_name: "Pi",
      content: "\u2063",
      timestamp: placeholderTimestamp,
      is_from_me: false,
      is_bot_message: true,
      thread_id: 77,
    });

    const deferredRowId = service.enqueueQueuedFollowupItem(
      "web:default",
      0,
      "deferred first",
      12,
      "2024-01-01T00:00:01.000Z"
    );
    service.enqueueQueuedFollowupItem(
      "web:default",
      placeholderRowId,
      "dedup wins from deferred",
      21,
      "2024-01-01T00:00:02.000Z"
    );
    service.enqueuePlaceholder(
      "web:default",
      placeholderRowId,
      "placeholder survives",
      77,
      placeholderTimestamp
    );

    const items = service.getQueuedFollowupItems("web:default");
    expect(items.map((item) => item.rowId)).toEqual([deferredRowId, placeholderRowId]);
    expect(items.map((item) => item.queuedContent)).toEqual([
      "deferred first",
      "dedup wins from deferred",
    ]);

    const queueState = service.listQueuedStateItems("web:default");
    expect(queueState).toEqual([
      {
        row_id: deferredRowId,
        content: "deferred first",
        timestamp: "2024-01-01T00:00:01.000Z",
        thread_id: 12,
      },
      {
        row_id: placeholderRowId,
        content: "dedup wins from deferred",
        timestamp: placeholderTimestamp,
        thread_id: 77,
      },
    ]);
  });

  test("removes placeholder-backed queued follow-ups from both queue stores and timeline", async () => {
    const { db, service } = await createServiceFixture();

    const placeholderRowId = db.storeMessage({
      id: `msg-${Math.random()}`,
      chat_jid: "web:default",
      sender: "web-agent",
      sender_name: "Pi",
      content: "\u2063",
      timestamp: "2024-01-01T00:00:00.000Z",
      is_from_me: false,
      is_bot_message: true,
      thread_id: 31,
    });
    service.enqueuePlaceholder("web:default", placeholderRowId, "queued placeholder", 31, "2024-01-01T00:00:00.000Z");

    const sessionRemovals: Array<{ chatJid: string; content: string | undefined }> = [];
    const result = await service.removeQueuedFollowupForAction("web:default", placeholderRowId, {
      removeQueuedFollowupMessage: async (chatJid, content) => {
        sessionRemovals.push({ chatJid, content });
        return true;
      },
    });

    expect(result.source).toBe("placeholder");
    expect(result.removed?.queuedContent).toBe("queued placeholder");
    expect(service.getQueuedFollowupCount("web:default")).toBe(0);
    expect(db.getMessageByRowId("web:default", placeholderRowId)).toBeUndefined();
    expect(sessionRemovals).toEqual([{ chatJid: "web:default", content: "queued placeholder" }]);
  });

  test("persists deferred queued follow-ups with canonical metadata projection and mutation isolation", async () => {
    const { db, service } = await createServiceFixture();
    const contentBlock = { type: "text", nested: { value: 1 } };
    const linkPreview = { href: "https://example.test" };
    const queuedBy = { userId: " user ", sessionId: " session ", clientId: " client " };

    const rowId = service.enqueueQueuedFollowupItem("web:default", 0, "deferred metadata", null, "2024-01-01T00:00:00.000Z", {
      mediaIds: [1, 2],
      contentBlocks: [contentBlock],
      linkPreviews: [linkPreview],
      screenHint: " mobile ",
      source: " test ",
      queuedBy,
    });

    contentBlock.nested.value = 99;
    linkPreview.href = "https://mutated.test";
    queuedBy.userId = "mutated";

    const persisted = db.getDeferredQueuedFollowups("web:default");
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      rowId,
      queuedContent: "deferred metadata",
      threadId: null,
      queuedAt: "2024-01-01T00:00:00.000Z",
      mediaIds: [1, 2],
      screenHint: "mobile",
      source: "test",
      queuedBy: { userId: "user", sessionId: "session", clientId: "client" },
      materializeRetries: 0,
    });
    expect((persisted[0].contentBlocks?.[0] as any).nested.value).toBe(1);
    expect((persisted[0].linkPreviews?.[0] as any).href).toBe("https://example.test");

    (persisted[0].contentBlocks?.[0] as any).nested.value = 2;
    expect((service.getQueuedFollowupItems("web:default")[0].contentBlocks?.[0] as any).nested.value).toBe(1);
  });

  test("prioritizes protected source continuations ahead of later queued follow-ups", async () => {
    const { service } = await createServiceFixture();

    service.enqueueQueuedFollowupItem("web:default", 0, "user follow-up", 10, "2024-01-01T00:00:02.000Z", {
      source: "user-queued",
    });
    service.enqueueQueuedFollowupItem("web:default", 0, "protected first", 10, "2024-01-01T00:00:03.000Z", {
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-1" },
    });
    service.enqueueQueuedFollowupItem("web:default", 0, "protected second", 20, "2024-01-01T00:00:04.000Z", {
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-2" },
    });

    expect(service.getQueuedFollowupItems("web:default").map((item) => item.queuedContent)).toEqual([
      "protected first",
      "protected second",
      "user follow-up",
    ]);
  });

  test("replaces retry metadata in one persisted queue mutation", async () => {
    const { service } = await createServiceFixture();
    const rowId = service.enqueueQueuedFollowupItem("web:default", 0, "retry me", 10, "2024-01-01T00:00:00.000Z");
    const original = service.getQueuedFollowupItems("web:default")[0]!;

    expect(service.replaceQueuedFollowupItem("web:default", { ...original, materializeRetries: 1 })).toBe(true);
    expect(service.getQueuedFollowupItems("web:default")).toEqual([
      expect.objectContaining({ rowId, materializeRetries: 1 }),
    ]);
  });

  test("accepted input removal fails before queue, timeline, or HTTP action side effects", async () => {
    const { service, db } = await createServiceFixture();
    const rowId = db.storeMessage({
      id: "accepted-placeholder", chat_jid: "web:default", sender: "web-agent", sender_name: "Pi",
      content: "original timeline", timestamp: "2024-01-01T00:00:00.000Z", is_from_me: false, is_bot_message: true,
    });
    await service.admitQueuedFollowupItem(["web:default", rowId, "accepted"], () => {}, new AbortController().signal, () => {});
    const before = db.getDeferredQueuedFollowups("web:default");
    const timelineBefore = db.getMessageByRowId("web:default", rowId);
    expect(() => service.removeQueuedFollowupItem("web:default", rowId)).toThrow("Accepted input requires host cancellation");
    let sideEffects = 0;
    const { WebAgentControlPlaneService } = await import("../../../../src/channels/web/agent/agent-control-plane-service.js");
    const control = new WebAgentControlPlaneService({
      defaultChatJid: "web:default", defaultAgentId: "default",
      json: (payload, status = 200) => Response.json(payload, { status }),
      queuedFollowupLifecycle: service,
      broadcastEvent: () => { sideEffects++; },
      queue: { enqueue: () => { sideEffects++; } },
      agentPool: {
        setSessionBinder: () => {},
        removeQueuedFollowupMessage: () => { sideEffects++; return true; },
        isStreaming: () => true,
        queueStreamingMessage: async () => { sideEffects++; return { queued: true }; },
      },
      queuePendingSteering: () => { sideEffects++; },
      storeMessage: () => { sideEffects++; return null; }, processChat: () => { sideEffects++; },
    });
    for (const action of ["handleAgentQueueRemove", "handleAgentQueueSteer", "handleAgentQueueReorder"] as const) {
      const response = await control[action](new Request("https://example.test/agent/queue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_id: rowId, from_index: 0, to_index: 0 }),
      }));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: action === "handleAgentQueueRemove" ? "Unable to remove queued follow-up" : "Accepted input requires host cancellation" });
      expect(db.getDeferredQueuedFollowups("web:default")).toEqual(before);
      expect(db.getMessageByRowId("web:default", rowId)).toEqual(timelineBefore);
    }
    expect(sideEffects).toBe(0);
  });

  test("accepted replacement permits only a retry increment with deeply equal immutable input", async () => {
    const { service, db } = await createServiceFixture();
    await service.admitQueuedFollowupItem([
      "web:default", 0, "immutable", 11, "2024-01-01T00:00:00.000Z", {
        mediaIds: [1, 2], contentBlocks: [{ type: "text", text: "original" }],
        linkPreviews: [{ href: "https://example.test", title: "original" }],
        screenHint: "mobile", source: "user-queued",
        queuedBy: { source: "web", userId: "user", sessionId: "session", clientId: "client", sourceMessageId: "msg" },
      },
    ], () => {}, new AbortController().signal, () => {});
    const original = service.peekQueuedFollowupItem("web:default")!;
    const changes = [
      { queuedContent: "changed" }, { mediaIds: [2, 1] }, { contentBlocks: [{ type: "text", text: "changed" }] },
      { linkPreviews: [] }, { threadId: 12 }, { queuedAt: "2025-01-01T00:00:00.000Z" },
      { screenHint: "desktop" }, { source: "changed" },
      ...Object.keys(original.queuedBy!).map(key => ({ queuedBy: { ...original.queuedBy, [key]: "changed" } })),
      { source_id: "forged" }, { source_accepted: undefined }, { tracing: "extra" },
    ];
    for (const change of changes) {
      expect(() => service.replaceQueuedFollowupItem("web:default", { ...original, materializeRetries: 1, ...change })).toThrow("Accepted input only permits a materialization retry increment");
      expect(db.getDeferredQueuedFollowups("web:default")).toEqual([original]);
    }
    for (const materializeRetries of [-1, 0, 2, 0.5, NaN]) {
      expect(() => service.replaceQueuedFollowupItem("web:default", { ...original, materializeRetries })).toThrow("Accepted input only permits a materialization retry increment");
    }
    // Object key order is not payload identity; nested arrays and metadata still compare in full.
    expect(service.replaceQueuedFollowupItem("web:default", {
      ...original, materializeRetries: 1, contentBlocks: [{ text: "original", type: "text" }],
      queuedBy: { clientId: "client", sourceMessageId: "msg", sessionId: "session", userId: "user", source: "web" },
    })).toBe(true);
    expect(service.peekQueuedFollowupItem("web:default")).toEqual({ ...original, materializeRetries: 1 });
  });

  test("any accepted deferred input blocks reordering even of ordinary siblings or identical indices", async () => {
    const { service, db } = await createServiceFixture();
    service.enqueueQueuedFollowupItem("web:default", 0, "first");
    service.enqueueQueuedFollowupItem("web:default", 0, "second");
    await service.admitQueuedFollowupItem(["web:default", 0, "accepted"], () => {}, new AbortController().signal, () => {});
    const before = db.getDeferredQueuedFollowups("web:default");
    for (const [from, to] of [[0, 1], [2, 0], [0, 2], [2, 2]]) {
      expect(() => service.reorderQueuedFollowupItems("web:default", from, to)).toThrow("Accepted input requires host cancellation");
      expect(db.getDeferredQueuedFollowups("web:default")).toEqual(before);
    }
  });

  test("rejects reordering that moves ordinary work ahead of protected continuations", async () => {
    const { service } = await createServiceFixture();

    service.enqueueQueuedFollowupItem("web:default", 0, "protected", 10, "2024-01-01T00:00:00.000Z", {
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-1" },
    });
    service.enqueueQueuedFollowupItem("web:default", 0, "ordinary", 10, "2024-01-01T00:00:01.000Z");

    expect(service.reorderQueuedFollowupItems("web:default", 1, 0)).toBe(false);
    expect(service.getQueuedFollowupItems("web:default").map((item) => item.queuedContent)).toEqual([
      "protected",
      "ordinary",
    ]);
  });

  test("removes deferred queued follow-ups without touching active-session placeholder cleanup", async () => {
    const { db, service } = await createServiceFixture();

    const deferredRowId = service.enqueueQueuedFollowupItem(
      "web:default",
      0,
      "deferred only",
      null,
      "2024-01-01T00:00:00.000Z",
      { mediaIds: [9], contentBlocks: [{ type: "text" }], linkPreviews: [{ href: "https://example.com" }] }
    );

    let sessionRemovalCalls = 0;
    const result = await service.removeQueuedFollowupForAction("web:default", deferredRowId, {
      removeQueuedFollowupMessage: async () => {
        sessionRemovalCalls += 1;
        return true;
      },
    });

    expect(result.source).toBe("deferred");
    expect(result.removed).toEqual({
      source_id: expect.stringMatching(/^source-[0-9a-f-]{36}$/),
      rowId: deferredRowId,
      queuedContent: "deferred only",
      threadId: null,
      queuedAt: "2024-01-01T00:00:00.000Z",
      mediaIds: [9],
      contentBlocks: [{ type: "text" }],
      linkPreviews: [{ href: "https://example.com" }],
      materializeRetries: 0,
    });
    expect(service.getQueuedFollowupCount("web:default")).toBe(0);
    expect(db.getDeferredQueuedFollowups("web:default")).toEqual([]);
    expect(sessionRemovalCalls).toBe(0);
  });
});
