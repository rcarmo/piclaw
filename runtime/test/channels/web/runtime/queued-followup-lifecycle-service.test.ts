import { afterEach, describe, expect, test } from "bun:test";
import { closeDatabase } from "../../../../src/db/connection.js";
import { createTempWorkspace, setEnv } from "../../../helpers.js";
import { installServiceWorkSchema } from "../../../../src/service-effects/current-piclaw/service-work-schema.js";
import { createCurrentPiclawServiceWorkStore } from "../../../../src/service-effects/current-piclaw/service-work-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../../../src/service-effects/contracts/common.js";
import type { QueuedInputSourceAdmission } from "../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js";

function seal<T extends { effect: { requestHash: string } }>(request: T, method?: string): T {
  request.effect.requestHash = hashCanonicalRequest((method ? { method, ...request } : request) as unknown as CanonicalJsonValue);
  return request;
}

let restoreEnv: (() => void) | null = null;
let cleanupWorkspace: (() => void) | null = null;

afterEach(async () => {
  await closeDatabase();
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
  if (fileBacked) {
    await db.closeDatabase();
    process.env.PICLAW_DB_IN_MEMORY = "0";
  }
  db.initDatabase();
  db.getDb().exec("DELETE FROM message_media; DELETE FROM messages; DELETE FROM chats; DELETE FROM chat_cursors;");
  db.storeChatMetadata("web:default", new Date().toISOString(), "Web");

  const mod = await import("../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js");
  const service = new mod.QueuedFollowupLifecycleService();
  return { db, service };
}

describe("queued follow-up lifecycle service", () => {
  test('input behind deferred control stays queued until normal materialisation', async () => {
    const { service, db } = await createServiceFixture();
    const signal = new AbortController().signal;
    let admissions = 0;
    const accept = () => { admissions++; };
    await service.admitQueuedFollowupItem(['web:default', 0, 'before compact'], () => {}, signal, accept);
    const compact = service.enqueueQueuedFollowupItem('web:default', 0, '/compact');
    await service.admitQueuedFollowupItem(['web:default', 0, 'after compact'], () => {}, signal, accept);
    expect(admissions).toBe(1);
    const items = service.getQueuedFollowupItems('web:default');
    expect(items.map(item => item.queuedContent)).toEqual(['before compact', '/compact', 'after compact']);
    expect(items[0]!.source_accepted).toBe(true);
    expect(items[2]!.source_accepted).toBeUndefined();
    expect(items[1]!.rowId).toBe(compact);
    // Fixture-only completed-prefix simulation; production drains through admitted SQL materialisation.
    db.setDeferredQueuedFollowups('web:default', items.slice(2));
    await service.admitQueuedFollowupItem(['web:default', 0, 'new input'], () => {}, signal, accept);
    expect(admissions).toBe(2);
  });
  test("host identity survives file database reopen and queue edits without changing public actions", async () => {
    const { service, db } = await createServiceFixture(true);
    const { QueuedFollowupLifecycleService } = await import("../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js");
    try {
      const rowId = service.enqueueQueuedFollowupItem("web:default", 0, "persistent", null, "2024-01-01T00:00:00.000Z", {
        source_id: "forged-untyped-host-extras",
      } as any);
      const original = service.peekQueuedFollowupItem("web:default")!;
      expect(original.source_id).toMatch(/^source-[0-9a-f-]{36}$/);
      expect(service).not.toHaveProperty("replaceQueuedFollowupItem");
      expect(service.peekQueuedFollowupItem("web:default")!.source_id).toBe(original.source_id);
      await db.closeDatabase();
      db.initDatabase();
      const restored = new QueuedFollowupLifecycleService();
      expect(restored.peekQueuedFollowupItem("web:default")).toEqual(original);
      const detached = restored.peekQueuedFollowupItem("web:default")!;
      detached.queuedContent = "only a detached snapshot";
      expect(restored.peekQueuedFollowupItem("web:default")).toEqual(original);
      const removed = await restored.removeQueuedFollowupForAction("web:default", rowId);
      expect(removed.removed!.source_id).toBe(original.source_id);
      const restartedEmpty = new QueuedFollowupLifecycleService();
      expect(restartedEmpty.enqueueQueuedFollowupItem("web:default", 0, "persistent", null, original.queuedAt)).toBe(rowId);
      expect(restartedEmpty.peekQueuedFollowupItem("web:default")!.source_id).not.toBe(original.source_id);
    } finally {
      await db.closeDatabase();
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
  for (const seed of ['existing', 'unset'] as const) {
    test(`accepted source callback SQLITE_BUSY is terminal and restores queue SQL and ${seed} allocator seed`, async () => {
      const fixture = await createServiceFixture();
      const { db } = fixture;
      const database = db.getDb();
      installServiceWorkSchema(database);
      const made = createCurrentPiclawServiceWorkStore(database, {
        hitFault: () => false, recordTrace() {}, validateAcceptance: () => true,
      });
      if (!made.ok) throw Error('work fixture');
      const work = made.value;
      const first = fixture.service.enqueueQueuedFollowupItem('web:default', 0, 'same input', 7,
        '2024-01-01T00:00:00.000Z', { mediaIds: [7], contentBlocks: [{ type: 'text', text: 'sibling' }] });
      fixture.service.enqueueQueuedFollowupItem('web:sibling', 0, 'same input');
      // A new service has persisted siblings but no in-memory allocation seed.
      const { QueuedFollowupLifecycleService } = await import('../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js');
      const service = seed === 'existing' ? fixture.service : new QueuedFollowupLifecycleService();
      const beforeQueue = service.getQueuedFollowupItems('web:default');
      const sibling = service.getQueuedFollowupItems('web:sibling');
      const snapshot = () => ['router_state', 'messages', ...['sources', 'chats', 'operations', 'intents', 'decisions', 'wake_intents']
        .map(table => `service_effect_s01_${table}`)]
        .map(table => database.query(`SELECT * FROM ${table} ORDER BY rowid`).all());
      const before = snapshot();
      const policy = database.query('PRAGMA busy_timeout').get();
      const busy = Object.assign(Error('source acceptance busy'), { code: 'SQLITE_BUSY' });
      let calls = 0;
      let checks = 0;
      const signal = new AbortController().signal;
      await expect(service.admitQueuedFollowupItem(['web:default', 0, 'same input'], () => { checks++; }, signal,
        ({ chatJid, item, database: captured }) => {
          calls++;
          expect(captured).toBe(database);
          expect(database.inTransaction).toBe(true);
          expect(item.rowId).toBe(first - 1);
          expect(item.source_id).toMatch(/^source-[0-9a-f-]{36}$/);
          expect(item.source_id).not.toBe(beforeQueue[0]!.source_id);
          expect(db.getDeferredQueuedFollowups(chatJid)).toHaveLength(2);
          expect(db.getDeferredQueuedFollowups(chatJid)[1]!.source_id).toBe(item.source_id);
          work.acceptSourceInTransaction(seal({ effect: {
            idempotencyKey: `accept:${item.source_id}`, requestHash: '', operationId: null, sourceSeq: null,
            provenanceRef: 'host:queue', redactionClass: 'private' as const,
          }, chatJid, sourceId: item.source_id, kind: 'message', payloadRef: `queued-source:${item.source_id}`,
          targetOperationId: null, parentSourceSeq: null, acceptedAt: item.queuedAt, createWakeIntent: false }), database);
          expect(work.getAcceptedSource(chatJid, item.source_id)).not.toBeNull();
          expect(snapshot()).not.toEqual(before);
          // Throw only once: an accidental replay would commit and fail rejection.
          if (calls === 1) throw busy;
        })).rejects.toBe(busy);
      expect(calls).toBe(1);
      expect(checks).toBe(1);
      expect(snapshot()).toEqual(before);
      expect(service.getQueuedFollowupItems('web:default')).toEqual(beforeQueue);
      expect(service.getQueuedFollowupItems('web:sibling')).toEqual(sibling);
      expect(database.inTransaction).toBe(false);
      expect(database.query('PRAGMA busy_timeout').get()).toEqual(policy);
      expect(await service.admitQueuedFollowupItem(['web:default', 0, 'independent accepted input'], () => {}, signal)).toBe(first - 1);
    });
  }
  test('asynchronous admission rejects redirected workspace before committing captured database work', async () => {
    const {service}=await createServiceFixture();
    let restore:(()=>void)|undefined;
    try {
      await expect(service.admitQueuedFollowupItem(['web:binding',0,'must not commit'],()=>{restore??=setEnv({PICLAW_WORKSPACE:process.env.PICLAW_WORKSPACE+'/changed'});},new AbortController().signal)).rejects.toThrow('binding changed');
    } finally { restore?.(); }
    expect(service.getQueuedFollowupItems('web:binding')).toEqual([]);
  });
  test("projects persisted negative/positive rows without duplicate row ids or timeline mutation", async () => {
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
    service.enqueueQueuedFollowupItem(
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

  test("removes only the exact historical positive deferred row and timeline, leaving same-text siblings", async () => {
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
    service.enqueueQueuedFollowupItem("web:default", placeholderRowId, "queued placeholder", 31, "2024-01-01T00:00:00.000Z");

    const siblingRowId = db.storeMessage({
      id: "placeholder-sibling", chat_jid: "web:default", sender: "web-agent", sender_name: "Pi",
      content: "\u2063", timestamp: "2024-01-01T00:00:01.000Z", is_from_me: false, is_bot_message: true,
    });
    service.enqueueQueuedFollowupItem("web:default", siblingRowId, "queued placeholder", 31);
    const deferredRowId = service.enqueueQueuedFollowupItem("web:default", 0, "queued placeholder");
    const siblings = service.getQueuedFollowupItems("web:default").filter(item => item.rowId !== placeholderRowId);
    const timeline = db.getMessageByRowId("web:default", siblingRowId);
    const result = await service.removeQueuedFollowupForAction("web:default", placeholderRowId);

    expect(result.source).toBe("deferred");
    expect(result.removed?.rowId).toBe(placeholderRowId);
    expect(result.removed?.queuedContent).toBe("queued placeholder");
    expect(service.getQueuedFollowupCount("web:default")).toBe(2);
    expect(service.getQueuedFollowupItems("web:default")).toEqual(siblings);
    expect(db.getMessageByRowId("web:default", placeholderRowId)).toBeUndefined();
    expect(db.getMessageByRowId("web:default", siblingRowId)).toEqual(timeline);
    expect(service.getQueuedFollowupItems("web:default").map(item => item.rowId)).toEqual([siblingRowId, deferredRowId]);
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

  test("accepted input removal fails before queue, timeline, or HTTP action side effects", async () => {
    const { service, db } = await createServiceFixture();
    const rowId = db.storeMessage({
      id: "accepted-placeholder", chat_jid: "web:default", sender: "web-agent", sender_name: "Pi",
      content: "original timeline", timestamp: "2024-01-01T00:00:00.000Z", is_from_me: false, is_bot_message: true,
    });
    await service.admitQueuedFollowupItem(["web:default", rowId, "accepted"], () => {}, new AbortController().signal, () => {});
    const before = db.getDeferredQueuedFollowups("web:default");
    const timelineBefore = db.getMessageByRowId("web:default", rowId);
    await expect(service.removeQueuedFollowupForAction("web:default", rowId)).rejects.toThrow("Accepted input requires host cancellation");
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
      },
      queuePendingSteering: () => { sideEffects++; },
      storeMessage: () => { sideEffects++; return null; }, processChat: () => { sideEffects++; },
    });
    for (const action of ["handleAgentQueueRemove", "handleAgentQueueSteer"] as const) {
      const response = await control[action](new Request("https://example.test/agent/queue", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row_id: rowId, from_index: 0, to_index: 0 }),
      }));
      expect(response.status).toBe(action==='handleAgentQueueRemove'?500:409);
      expect(await response.json()).toEqual({ error: action === "handleAgentQueueRemove" ? "Unable to remove queued follow-up" : "This preserved legacy queue item has no SDK submission; it was not changed." });
      expect(db.getDeferredQueuedFollowups("web:default")).toEqual(before);
      expect(db.getMessageByRowId("web:default", rowId)).toEqual(timelineBefore);
    }
    expect(sideEffects).toBe(0);
  });

  for (const outcome of ["success", "missing", "fenced", "async", "post-write-failure"] as const) {
    test(`accepted withdrawal uses native source CAS and preserves siblings; ${outcome}`, async () => {
      const { service, db } = await createServiceFixture();
      const database = db.getDb();
      installServiceWorkSchema(database);
      let owner = true;
      const made = createCurrentPiclawServiceWorkStore(database, {
        hitFault: () => false, recordTrace() {}, validateAcceptance: () => owner,
      });
      if (!made.ok) throw Error("work fixture");
      const work = made.value;
      const effect = (id: string) => ({ idempotencyKey: id, requestHash: "", operationId: null, sourceSeq: null,
        provenanceRef: "host:queue", redactionClass: "private" as const });
      const accept: QueuedInputSourceAdmission = ({ chatJid, item, database }) => {
        work.acceptSourceInTransaction(seal({ effect: effect(`accept:${item.source_id}`), chatJid,
          sourceId: item.source_id, kind: "message", payloadRef: `queued-source:${item.source_id}`,
          targetOperationId: null, parentSourceSeq: null, acceptedAt: item.queuedAt, createWakeIntent: false }), database);
      };
      const rowId = db.storeMessage({
        id: `withdrawal-${outcome}`, chat_jid: "web:default", sender: "web-agent", sender_name: "Pi",
        content: "original timeline", timestamp: "2024-01-01T00:00:00.000Z", is_from_me: false, is_bot_message: true,
      });
      for (const id of [rowId, 0]) {
        await service.admitQueuedFollowupItem(["web:default", id, "same input"], () => {}, new AbortController().signal, accept);
      }
      const [first, sibling] = service.getQueuedFollowupItems("web:default");
      const siblingSource = work.getAcceptedSource("web:default", sibling!.source_id!)!;
      const beforeQueue = db.getDeferredQueuedFollowups("web:default");
      const timeline = db.getMessageByRowId("web:default", rowId);
      const snapshot = () => ["sources", "chats", "operations", "decisions", "wake_intents"]
        .map(table => database.query(`SELECT * FROM service_effect_s01_${table}`).all());
      const before = snapshot();
      let calls = 0;
      const withdraw: QueuedInputSourceAdmission = stored => {
        calls++;
        expect(stored.database).toBe(database);
        expect(database.inTransaction).toBe(true);
        expect(stored.item).toEqual(first);
        expect(db.getDeferredQueuedFollowups(stored.chatJid)).toEqual(beforeQueue);
        expect(db.getMessageByRowId(stored.chatJid, rowId)).toEqual(timeline);
        const sourceHash = (database.query("SELECT source_hash FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?")
          .get(stored.chatJid, stored.item.source_id) as { source_hash: string }).source_hash;
        work.withdrawUnclaimedSourceInTransaction(seal({ effect: effect(`withdraw:${stored.item.source_id}`),
          chatJid: stored.chatJid, sourceId: stored.item.source_id, sourceHash,
          payloadRef: `queued-source:${stored.item.source_id}`, actor: "single-user" }, "withdrawUnclaimedSource.v1"), database);
        if (outcome === "async") return Promise.reject(Error("private async failure")) as never;
        if (outcome === "post-write-failure") throw Error("private post-write failure");
      };
      owner = outcome !== "fenced";
      const remove = () => service.removeQueuedFollowupForAction("web:default", rowId,
        outcome === "missing" ? {} : { withdrawAcceptedSource: withdraw });
      if (outcome === "success") {
        expect((await remove()).removed).toEqual(first);
        expect(db.getDeferredQueuedFollowups("web:default")).toEqual([sibling]);
        expect(db.getMessageByRowId("web:default", rowId)).toBeUndefined();
        expect(work.getAcceptedSource("web:default", first!.source_id!)?.state).toBe("disposed");
        expect(work.getAcceptedSource("web:default", sibling!.source_id!)).toEqual(siblingSource);
        const committed = snapshot();
        expect((await remove()).removed).toBeNull();
        expect(snapshot()).toEqual(committed);
      } else {
        await expect(remove()).rejects.toThrow(outcome === "missing" ? "host cancellation"
          : outcome === "fenced" ? "owner_conflict" : outcome === "async" ? "must be synchronous" : "post-write failure");
        expect(db.getDeferredQueuedFollowups("web:default")).toEqual(beforeQueue);
        expect(db.getMessageByRowId("web:default", rowId)).toEqual(timeline);
        expect(snapshot()).toEqual(before);
      }
      expect(calls).toBe(outcome === "missing" ? 0 : 1);
      await Bun.sleep(0); // Rejected async callbacks must not escape as unhandled rejections.
    });
  }

  test("accepted queue snapshots are detached and no replacement API can mutate their identity", async () => {
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
    expect(service).not.toHaveProperty('replaceQueuedFollowupItem');
    for (const change of changes) {
      const snapshot = service.peekQueuedFollowupItem("web:default")!;
      Object.assign(snapshot, change, { materializeRetries: 100 });
      expect(db.getDeferredQueuedFollowups("web:default")).toEqual([original]);
      expect(service.peekQueuedFollowupItem("web:default")).toEqual(original);
    }
  });

  test("accepted queue reorder preserves immutable identities and priority after materialization/reopen", async () => {
    const { service, db } = await createServiceFixture(true);
    try {
      const signal = new AbortController().signal;
      await service.admitQueuedFollowupItem(['web:default',0,'first'],()=>{},signal,()=>{});
      await service.admitQueuedFollowupItem(['web:default',0,'second'],()=>{},signal,()=>{});
      const before = service.getQueuedFollowupItems('web:default');
      expect(await service.reorderQueuedFollowupItems('web:default',1,0)).toBe(true);
      expect(service.getQueuedFollowupItems('web:default')).toEqual([before[1],before[0]]);
      expect(service.getPendingQueuedSourceOrder('web:default')).toEqual([before[1]!.source_id!,before[0]!.source_id!]);
      const { admitWebMessage } = await import('../../../../src/channels/web/messaging/message-store.js');
      const materialized = await admitWebMessage({ broadcastEvent() {} }, { chatJid: 'web:default', content: before[1]!.queuedContent,
        isBot: false, mediaIds: [], agentId: 'default', agentName: 'Fixture' }, { consumeDeferredFollowupRowId: before[1]!.rowId,
        materializeQueuedSource({ database, message }) { expect(database.inTransaction).toBe(true); expect(message.id).toBe(before[1]!.source_id); } });
      expect(materialized).not.toBeNull();
      await db.closeDatabase(); db.initDatabase();
      const { QueuedFollowupLifecycleService } = await import('../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js');
      const reopened = new QueuedFollowupLifecycleService();
      expect(reopened.getPendingQueuedSourceOrder('web:default')).toEqual([before[1]!.source_id!,before[0]!.source_id!]);
      expect(reopened.getQueuedFollowupItems('web:default')).toEqual([before[0]]);
      expect(await reopened.reorderQueuedFollowupItems('web:default',0,0)).toBe(false);
      expect(await reopened.reorderQueuedFollowupItems('web:default',-1,0)).toBe(false);
    } finally { await db.closeDatabase(); }
  });

  test("rejects reordering that moves ordinary work ahead of protected continuations", async () => {
    const { service } = await createServiceFixture();

    service.enqueueQueuedFollowupItem("web:default", 0, "protected", 10, "2024-01-01T00:00:00.000Z", {
      source: "auto-protected-recovery-continuation",
      queuedBy: { source: "runtime", sourceMessageId: "source-1" },
    });
    service.enqueueQueuedFollowupItem("web:default", 0, "ordinary", 10, "2024-01-01T00:00:01.000Z");

    expect(await service.reorderQueuedFollowupItems("web:default", 1, 0)).toBe(false);
    expect(service.getQueuedFollowupItems("web:default").map((item) => item.queuedContent)).toEqual([
      "protected",
      "ordinary",
    ]);
  });

  test("removes deferred queued follow-ups by row with metadata intact", async () => {
    const { db, service } = await createServiceFixture();

    const deferredRowId = service.enqueueQueuedFollowupItem(
      "web:default",
      0,
      "deferred only",
      null,
      "2024-01-01T00:00:00.000Z",
      { mediaIds: [9], contentBlocks: [{ type: "text" }], linkPreviews: [{ href: "https://example.com" }] }
    );

    const result = await service.removeQueuedFollowupForAction("web:default", deferredRowId);

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
  });
});
