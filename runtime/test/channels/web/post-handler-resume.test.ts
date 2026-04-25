import { describe, expect, test } from "bun:test";

import type { InteractionRow } from "../../../src/db.js";
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
      storeMessage: () => makeInteraction(41, 41),
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

  test("POST /post reply wakes resumeChat for the explicit reply thread root", async () => {
    const resumed: Array<{ chatJid: string; threadRootId: number | null | undefined }> = [];

    const channel = {
      json: (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
      storeMessage: () => makeInteraction(52, null),
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
    expect(resumed).toEqual([{ chatJid: "web:default", threadRootId: 41 }]);
  });
});
