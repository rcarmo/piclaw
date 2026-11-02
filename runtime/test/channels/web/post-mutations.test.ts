import { describe, expect, test } from "bun:test";
import type { InteractionRow } from "../../../src/db.js";
import {
  handleInternalPostRequest,
  handleUpdatePostRequest,
  type PostMutationsContext,
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

function createContext(overrides: Partial<PostMutationsContext> = {}): PostMutationsContext {
  return {
    defaultChatJid: "web:default",
    lastCommandInteractionId: null,
    json: (payload, status = 200) => jsonResponse(payload, status),
    replaceMessageContent: () => interaction(10),
    broadcastInteractionUpdated: () => {},
    admitMessage: async () => interaction(20),
    broadcastAgentResponse: () => {},
    ...overrides,
  };
}

describe("web post mutation helpers", () => {
  test("handleUpdatePostRequest validates id and body", async () => {
    const req = new Request("https://example.com/post/1", {
      method: "PATCH",
      body: JSON.stringify({ content: "ok" }),
      headers: { "Content-Type": "application/json" },
    });

    const badIdRes = await handleUpdatePostRequest(req, null, createContext());
    expect(badIdRes.status).toBe(400);
    expect(await badIdRes.json()).toEqual({ error: "Missing or invalid post id" });

    const badJsonReq = new Request("https://example.com/post/1", {
      method: "PATCH",
      body: "{",
      headers: { "Content-Type": "application/json" },
    });
    const badJsonRes = await handleUpdatePostRequest(badJsonReq, 1, createContext());
    expect(badJsonRes.status).toBe(400);
    expect(await badJsonRes.json()).toEqual({ error: "Invalid JSON" });
  });

  test("handleUpdatePostRequest updates thread id and broadcasts", async () => {
    let setThread: { messageId: number; threadId: number } | null = null;
    let broadcasted = false;
    let usedChatJid: string | null = null;
    const ctx = createContext({
      replaceMessageContent: (chatJid, messageId, _content, threadId) => {
        usedChatJid = chatJid;
        setThread = { messageId, threadId: threadId! };
        return interaction(44);
      },
      broadcastInteractionUpdated: () => {
        broadcasted = true;
      },
    });

    const req = new Request("https://example.com/post/44?chat_jid=web%3Abranch", {
      method: "PATCH",
      body: JSON.stringify({ content: "updated", thread_id: 7 }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleUpdatePostRequest(req, 44, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", ok: true, id: 44 });
    expect(usedChatJid).toBe("web:branch");
    expect(setThread).toEqual({ messageId: 44, threadId: 7 });
    expect(broadcasted).toBeTrue();
  });

  test("handleInternalPostRequest validates content and broadcasts success", async () => {
    const missingReq = new Request("https://example.com/internal/post", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const missingRes = await handleInternalPostRequest(missingReq, createContext());
    expect(missingRes.status).toBe(400);
    expect(await missingRes.json()).toEqual({ error: "Missing content" });

    let usedThreadId: number | undefined;
    let usedChatJid: string | null = null;
    let broadcasted = false;
    const ctx = createContext({
      lastCommandInteractionId: 99,
      admitMessage: async (chatJid, _content, _isBot, _mediaIds, options) => {
        usedChatJid = chatJid;
        usedThreadId = options?.threadId;
        return interaction(55);
      },
      broadcastAgentResponse: () => {
        broadcasted = true;
      },
    });

    const okReq = new Request("https://example.com/internal/post?chat_jid=web%3Abranch", {
      method: "POST",
      body: JSON.stringify({ content: "hello" }),
      headers: { "Content-Type": "application/json" },
    });
    const okRes = await handleInternalPostRequest(okReq, ctx);

    expect(okRes.status).toBe(201);
    expect(await okRes.json()).toEqual({ status: "ok", ok: true, id: 55 });
    expect(usedChatJid).toBe("web:branch");
    expect(usedThreadId).toBe(99);
    expect(broadcasted).toBeTrue();
  });
});

for (const publicationFails of [false, true]) test(`internal post pins storage/default/thread before JSON and keeps committed acceptance: publication failure=${publicationFails}`, async () => {
  let admitted = 0, replacement = 0, broadcasts = 0;
  const ctx = createContext({ lastCommandInteractionId: 99,
    admitMessage: async function(chat, text, bot, media, options, check, signal) {
      expect(this).toBe(ctx); check?.('before');
      expect([chat, text, bot, media, options]).toEqual(['web:default', 'accepted', true, [], { threadId: 99 }]);
      expect(signal).toBe(req.signal); admitted++; check?.('after'); return interaction(55);
    },
    broadcastAgentResponse() { broadcasts++; if (publicationFails) throw Error('publication failed'); },
  });
  const req = new Request('https://fixture/internal/post', { method: 'POST' });
  req.json = async () => { ctx.admitMessage = async () => { replacement++; throw Error('replacement'); };
    ctx.defaultChatJid = 'web:replacement'; ctx.lastCommandInteractionId = 777; return { content: 'accepted' }; };
  const res = await handleInternalPostRequest(req, ctx);
  expect(res.status).toBe(201); expect(await res.json()).toEqual({ status: 'ok', ok: true, id: 55 });
  expect([admitted, replacement, broadcasts]).toEqual([1, 0, 1]);
});

test('internal post revocation is checked at the admitted write rather than adopted after JSON', async () => {
  let principal: any = { kind: 'user', userId: 'fixture-user', mode: 'single-user', role: 'admin', authentication: { method: 'cookie' } };
  let writes = 0;
  const ctx = createContext({ authGateway: { isAuthEnabled: () => true, getPrincipal: () => principal } as any,
    admitMessage: async (_chat, _text, _bot, _media, _options, check) => { check?.('before'); writes++; return interaction(55); },
  });
  const req = new Request('https://fixture/internal/post', { method: 'POST' });
  req.json = async () => { principal = null; return { content: 'must not commit' }; };
  await expect(handleInternalPostRequest(req, ctx)).rejects.toThrow('principal changed'); expect(writes).toBe(0);
});

test('internal post fails closed without admission and never parses or uses a raw storage fallback', async () => {
  const req = new Request('https://fixture/internal/post', { method: 'POST' });
  req.json = async () => { throw Error('must not parse'); };
  const ctx = createContext({ admitMessage: undefined as any });
  (ctx as any).storeMessage = () => { throw Error('must not store synchronously'); };
  expect((await handleInternalPostRequest(req, ctx)).status).toBe(503);
});
