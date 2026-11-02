import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { initDatabase, closeDatabase, getDb, type InteractionRow } from "../../../src/db.js";

beforeEach(() => initDatabase());
afterEach(() => closeDatabase());
import { handlePost } from "../../../src/channels/web/handlers/posts.js";

function makeInteraction(id: number, threadId?: number | null): InteractionRow {
  return {
    id,
    chat_jid: "web:default",
    timestamp: new Date().toISOString(),
    data: {
      type: "user_message",
      content: "hello",
      agent_id: "default",
      media_ids: [],
      ...(typeof threadId === "number" ? { thread_id: threadId } : {}),
    },
  } as unknown as InteractionRow;
}

describe("web post handler", () => {
  test("POST /post wakes resumeChat for the stored thread root", async () => {
    const resumed: Array<{ chatJid: string; threadRootId: number | null | undefined }> = [];

    const channel = {
      json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      admitUserMessage: async (_chat: string, _text: string, _media: number[], _options: unknown, check: (phase: 'before' | 'after') => void) => {
        return getDb().transaction(() => {
          check('before'); const interaction = makeInteraction(41, 41); check('after'); return interaction;
        }).immediate();
      },
      broadcastEvent: () => {},
      resumeChat: (chatJid: string, threadRootId?: number | null) => {
        resumed.push({ chatJid, threadRootId });
      },
    } as any;

    const req = new Request("https://example.com/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });

    const res = await handlePost(channel, req, false, "web:default");
    expect(res.status).toBe(201);
    expect(resumed).toEqual([{ chatJid: "web:default", threadRootId: 41 }]);
  });

  test("POST /post reply stores and wakes resumeChat for the explicit reply thread root", async () => {
    const resumed: Array<{ chatJid: string; threadRootId: number | null | undefined }> = [];
    const storeCalls: Array<{ threadId?: number }> = [];

    const channel = {
      json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      admitUserMessage: async (_chatJid: string, _content: string, _mediaIds: number[], options: { threadId?: number }, check: (phase: 'before' | 'after') => void) => {
        return getDb().transaction(() => {
          check('before'); storeCalls.push({ threadId: options.threadId });
          const interaction = makeInteraction(52, options.threadId ?? null); check('after'); return interaction;
        }).immediate();
      },
      broadcastEvent: () => {},
      resumeChat: (chatJid: string, threadRootId?: number | null) => {
        resumed.push({ chatJid, threadRootId });
      },
    } as any;

    const req = new Request("https://example.com/post/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello", thread_id: 41 }),
    });

    const res = await handlePost(channel, req, true, "web:default");
    expect(res.status).toBe(201);
    expect(storeCalls).toEqual([{ threadId: 41 }]);
    expect(resumed).toEqual([{ chatJid: "web:default", threadRootId: 41 }]);
  });
});
