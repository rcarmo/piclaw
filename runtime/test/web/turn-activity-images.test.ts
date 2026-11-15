// Self-isolating: forces PICLAW_DB_IN_MEMORY=1 via shared test helpers
import "../helpers.js";

import { beforeAll, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { getDb, initDatabase } from "../../src/db/connection.js";
import { handleTurnActivity } from "../../src/channels/web/handlers/turn-activity.js";
import { projectTurnActivity, toolResultImage } from "../../src/channels/web/agent/turn-activity.js";
import { deleteMessageByRowId } from "../../src/db/messages.js";
import type { DurableTurnEntries } from "../../src/agent-pool/durable-runtime-adapter.js";

const chat = "web:thumbs";
let replyId = "";
let large = "";

const turnWith = (content: unknown[]): DurableTurnEntries => ({
  truncated: false,
  tasks: { 20: { kind: "pi.generation", startedAt: 1, endedAt: 2, outcome: "completed" }, 30: { kind: "pi.tool", startedAt: 2, endedAt: 3, outcome: "completed" } },
  entries: [
    { id: 1, kind: "host.accepted", model: [{ role: "user", content: "look at it" }] },
    { id: 2, kind: "pi.assistant", byTaskId: 20, model: [{ role: "assistant", content: [{ type: "toolCall", id: "call-img", name: "view_image", arguments: { path: "shot.png" } }], stopReason: "toolUse", usage: { output: 1 }, timestamp: 2 }] },
    { id: 3, kind: "pi.tool-result", byTaskId: 30, model: [{ role: "toolResult", toolCallId: "call-img", toolName: "view_image", content, isError: false }] },
    { id: 8, kind: "pi.assistant", byTaskId: 20, model: [{ role: "assistant", content: [{ type: "text", text: "Seen." }], stopReason: "stop", usage: { output: 1 }, timestamp: 8 }] },
  ],
} as unknown as DurableTurnEntries);

beforeAll(async () => {
  initDatabase();
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO chats(jid, name) VALUES (?, ?)").run(chat, chat);
  replyId = String(db.prepare(`INSERT INTO messages(id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, is_terminal_agent_reply)
    VALUES ('native-answer:inc:7:8', ?, 'web-agent', 'agent', 'Seen.', '2026-11-11T00:00:00.000Z', 0, 1, 1)`).run(chat).lastInsertRowid);
  large = (await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#c03030" } }).png().toBuffer()).toString("base64");
});
const previews = () => getDb().query("SELECT i.message_rowid, i.ref, m.content_type, json_extract(m.metadata, '$.cache_kind') AS kind FROM message_inline_media i JOIN media m ON m.id = i.media_id WHERE i.kind = 'tool_image' ORDER BY i.ref").all();
const mediaCount = () => (getDb().query("SELECT COUNT(*) AS n FROM media").get() as { n: number }).n;

const request = (params: Record<string, string>) => new URL(`http://local/agent/turn-activity?${new URLSearchParams(params)}`);

describe("tool result image thumbnails", () => {
  test("finds image blocks by call and index without exposing them in the projection", () => {
    const turn = turnWith([{ type: "text", text: "(see image)" }, { type: "image", data: large, mimeType: "image/png" }]);
    expect(toolResultImage(turn, "call-img", 0)).toEqual({ data: large, mimeType: "image/png" });
    expect(toolResultImage(turn, "call-img", 1)).toBeNull();
    expect(toolResultImage(turn, "missing", 0)).toBeNull();
    const tool = projectTurnActivity(turn, 8).steps.find((step) => step.kind === "tool")!.tool!;
    expect(tool.images).toBe(1);
    expect(JSON.stringify(tool)).not.toContain(large.slice(0, 40));
  });

  test("serves a bounded WebP thumbnail, stores it once and reuses the stored copy", async () => {
    const turn = turnWith([{ type: "image", data: large, mimeType: "image/png" }]);
    const pool = { getTurnEntriesForChat: async () => turn };
    const params = { chat_jid: chat, message_id: replyId, step: "tool:call-img", image: "0" };
    const response = await handleTurnActivity(pool, request(params));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toContain("private");
    const bytes = Buffer.from(await response.arrayBuffer());
    const meta = await sharp(bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(320);
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(160);
    expect(bytes.length).toBeLessThan(Buffer.from(large, "base64").length);
    // Stored once, with the reply, as timeline media.
    expect(previews()).toEqual([{ message_rowid: Number(replyId), ref: "call-img:0", content_type: "image/webp", kind: "tool_image_thumbnail" }]);
    const count = mediaCount();
    // Later requests receive the stored copy rather than a new rendering.
    const mediaId = (getDb().query("SELECT media_id FROM message_inline_media WHERE kind = 'tool_image'").get() as { media_id: number }).media_id;
    getDb().prepare("UPDATE media SET data = ? WHERE id = ?").run(new Uint8Array([1, 2, 3]), mediaId);
    const again = await handleTurnActivity(pool, request(params));
    expect([...new Uint8Array(await again.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(mediaCount()).toBe(count);
  });

  test("deleting the reply deletes its stored previews", async () => {
    const db = getDb();
    const row = Number(db.prepare(`INSERT INTO messages(id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, is_terminal_agent_reply)
      VALUES ('native-answer:inc:7:9', ?, 'web-agent', 'agent', 'Again.', '2026-11-11T00:00:01.000Z', 0, 1, 1)`).run(chat).lastInsertRowid);
    const pool = { getTurnEntriesForChat: async () => turnWith([{ type: "image", data: large, mimeType: "image/png" }]) };
    const response = await handleTurnActivity(pool, request({ chat_jid: chat, message_id: String(row), step: "tool:call-img", image: "0" }));
    expect(response.status).toBe(200);
    const { media_id: mediaId } = db.query("SELECT media_id FROM message_inline_media WHERE message_rowid = ?").get(row) as { media_id: number };
    expect(deleteMessageByRowId(chat, row)).toBe(true);
    expect(db.query("SELECT 1 FROM media WHERE id = ?").get(mediaId)).toBeNull();
    expect(db.query("SELECT 1 FROM message_inline_media WHERE message_rowid = ?").get(row)).toBeNull();
  });

  test("serves the running turn without storing anything, since it has no reply row yet", async () => {
    const pool = { getTurnEntriesForChat: async () => turnWith([{ type: "image", data: large, mimeType: "image/png" }]) };
    const count = mediaCount();
    const response = await handleTurnActivity(pool, request({ chat_jid: chat, live: "1", step: "tool:call-img", image: "0" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mediaCount()).toBe(count);
  });

  test("answers a uniform 404 for missing, invalid or undecodable images", async () => {
    // Previews are stored per reply, call and index; start without one.
    getDb().exec("DELETE FROM message_inline_media WHERE kind = 'tool_image'");
    const pool = { getTurnEntriesForChat: async () => turnWith([{ type: "image", data: "bm90IGFuIGltYWdl", mimeType: "image/png" }]) };
    for (const params of [
      { chat_jid: chat, message_id: replyId, step: "tool:call-img", image: "1" },
      { chat_jid: chat, message_id: replyId, step: "tool:call-img", image: "-1" },
      { chat_jid: chat, message_id: replyId, step: "tool:call-img", image: "x" },
      { chat_jid: chat, message_id: replyId, step: "thinking:2:0", image: "0" },
      { chat_jid: chat, message_id: replyId, step: "tool:missing", image: "0" },
      { chat_jid: "web:other", message_id: replyId, step: "tool:call-img", image: "0" },
      { chat_jid: chat, message_id: replyId, step: "tool:call-img", image: "0" },
    ]) {
      const response = await handleTurnActivity(pool, request(params));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });
});

