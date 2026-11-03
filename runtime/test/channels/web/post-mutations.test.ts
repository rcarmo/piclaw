import '../../helpers.js';
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initDatabase, closeDatabase, getDb, storeChatMetadata, getMessageByRowId } from '../../../src/db.js';
import type { WebChannelLike } from '../../../src/channels/web/core/web-channel-contracts.js';
beforeEach(() => { closeDatabase(); initDatabase(); });
afterEach(() => closeDatabase());
import type { InteractionRow } from "../../../src/db.js";
import {
  handleInternalPostRequest,
  handleUpdatePostRequest,
} from "../../../src/channels/web/post-mutations.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function interaction(id = 1): InteractionRow {
  return { id, data: {} } as unknown as InteractionRow;
}

function createChannel(overrides: Partial<WebChannelLike> = {}): WebChannelLike {
  return {
    lastCommandInteractionId: null,
    json: (payload: unknown, status = 200) => jsonResponse(payload, status),
    admitMessage: async () => interaction(20),
    interactionBroadcaster: { broadcastInteractionUpdated() {}, broadcastAgentResponse() {} },
    ...overrides,
  } as WebChannelLike;
}

describe("web post mutation helpers", () => {
  test("handleUpdatePostRequest validates id and body", async () => {
    const req = new Request("https://example.com/post/1", {
      method: "PATCH",
      body: JSON.stringify({ content: "ok" }),
      headers: { "Content-Type": "application/json" },
    });

    const badIdRes = await handleUpdatePostRequest(createChannel(), req, null, "web:default");
    expect(badIdRes.status).toBe(400);
    expect(await badIdRes.json()).toEqual({ error: "Missing or invalid post id" });

    const badJsonReq = new Request("https://example.com/post/1", {
      method: "PATCH",
      body: "{",
      headers: { "Content-Type": "application/json" },
    });
    const badJsonRes = await handleUpdatePostRequest(createChannel(), badJsonReq, 1, "web:default");
    expect(badJsonRes.status).toBe(400);
    expect(await badJsonRes.json()).toEqual({ error: "Invalid JSON" });
  });

  test("handleUpdatePostRequest updates thread id and broadcasts", async () => {
    storeChatMetadata("web:branch", new Date().toISOString());
    getDb().query("INSERT INTO messages(rowid,id,chat_jid,sender,sender_name,content,timestamp,is_bot_message) VALUES(44,'unit-post','web:branch','agent','Fixture','before','2026-01-01',1)").run();
    let broadcasted = false;
    const channel = createChannel({ interactionBroadcaster: { broadcastAgentResponse() {}, broadcastInteractionUpdated(row) {
      expect(getDb().inTransaction).toBe(false); expect(row.id).toBe(44); broadcasted = true;
    } } });
    const req = new Request("https://example.com/post/44?chat_jid=web%3Abranch", {
      method: "PATCH", body: JSON.stringify({ content: "updated", thread_id: 7 }), headers: { "Content-Type": "application/json" },
    });
    const res = await handleUpdatePostRequest(channel, req, 44, "web:default");
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ status: "ok", ok: true, id: 44 });
    expect(getMessageByRowId("web:branch", 44)!.data).toMatchObject({ content: "updated", thread_id: 7 });
    expect(broadcasted).toBeTrue();
  });

  test("handleInternalPostRequest validates content and broadcasts success", async () => {
    const missingReq = new Request("https://example.com/internal/post", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const missingRes = await handleInternalPostRequest(createChannel(), missingReq, "web:default");
    expect(missingRes.status).toBe(400);
    expect(await missingRes.json()).toEqual({ error: "Missing content" });

    let usedThreadId: number | undefined;
    let usedChatJid: string | null = null;
    let broadcasted = false;
    const ctx = createChannel({
      lastCommandInteractionId: 99,
      admitMessage: async (chatJid, _content, _isBot, _mediaIds, options) => {
        usedChatJid = chatJid;
        usedThreadId = options?.threadId;
        return interaction(55);
      },
      interactionBroadcaster: { broadcastInteractionUpdated() {}, broadcastAgentResponse() { broadcasted = true; } },
    });

    const okReq = new Request("https://example.com/internal/post?chat_jid=web%3Abranch", {
      method: "POST",
      body: JSON.stringify({ content: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const okRes = await handleInternalPostRequest(ctx, okReq, "web:default");

    expect(okRes.status).toBe(201);
    expect(await okRes.json()).toEqual({ status: "ok", ok: true, id: 55 });
    expect(usedChatJid).toBe("web:branch");
    expect(usedThreadId).toBe(99);
    expect(broadcasted).toBeTrue();
  });
});

for (const publicationFails of [false, true]) test(`internal post pins storage/default/thread before JSON and keeps committed acceptance: publication failure=${publicationFails}`, async () => {
  let admitted = 0, replacement = 0, broadcasts = 0;
  const ctx = createChannel({ lastCommandInteractionId: 99,
    admitMessage: async function(chat, text, bot, media, options, check, signal) {
      expect(this).toBe(ctx); check?.('before');
      expect([chat, text, bot, media, options]).toEqual(['web:default', 'accepted', true, [], { threadId: 99 }]);
      expect(signal).toBe(req.signal); admitted++; check?.('after'); return interaction(55);
    },
    interactionBroadcaster: { broadcastInteractionUpdated() {}, broadcastAgentResponse() { broadcasts++; if (publicationFails) throw Error('publication failed'); } },
  });
  const req = new Request('https://fixture/internal/post', { method: 'POST' });
  req.json = async () => { ctx.admitMessage = async () => { replacement++; throw Error('replacement'); };
    ctx.lastCommandInteractionId = 777; return { content: 'accepted' }; };
  const res = await handleInternalPostRequest(ctx, req, "web:default");
  expect(res.status).toBe(201); expect(await res.json()).toEqual({ status: 'ok', ok: true, id: 55 });
  expect([admitted, replacement, broadcasts]).toEqual([1, 0, 1]);
});

test('internal post revocation is checked at the admitted write rather than adopted after JSON', async () => {
  let principal: any = { kind: 'user', userId: 'fixture-user', mode: 'single-user', role: 'admin', authentication: { method: 'cookie' } };
  let writes = 0;
  const ctx = createChannel({ authGateway: { isAuthEnabled: () => true, getPrincipal: () => principal } as any,
    admitMessage: async (_chat, _text, _bot, _media, _options, check) => { check?.('before'); writes++; return interaction(55); },
  });
  const req = new Request('https://fixture/internal/post', { method: 'POST' });
  req.json = async () => { principal = null; return { content: 'must not commit' }; };
  await expect(handleInternalPostRequest(ctx, req, "web:default")).rejects.toThrow('principal changed'); expect(writes).toBe(0);
});

test('internal post fails closed without admission and never parses or uses a raw storage fallback', async () => {
  const req = new Request('https://fixture/internal/post', { method: 'POST' });
  req.json = async () => { throw Error('must not parse'); };
  const ctx = createChannel({ admitMessage: undefined as any });
  (ctx as any).storeMessage = () => { throw Error('must not store synchronously'); };
  expect((await handleInternalPostRequest(ctx, req, "web:default")).status).toBe(503);
});
