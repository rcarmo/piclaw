// Self-isolating: forces PICLAW_DB_IN_MEMORY=1 via shared test helpers
import "../helpers.js";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { getDb, initDatabase } from "../../src/db/connection.js";
import { handleTurnActivity } from "../../src/channels/web/handlers/turn-activity.js";
import { projectTurnActivity, toolResultImage } from "../../src/channels/web/agent/turn-activity.js";
import { pruneToolImageThumbnails } from "../../src/channels/web/media/tool-image-thumbnails.js";
import type { DurableTurnEntries } from "../../src/agent-pool/durable-runtime-adapter.js";

const chat = "web:thumbs";
let replyId = "";
let cacheDir = "";
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
  cacheDir = mkdtempSync(join(process.env.TMPDIR || "/tmp", "tool-thumbs-"));
  large = (await sharp({ create: { width: 1600, height: 800, channels: 3, background: "#c03030" } }).png().toBuffer()).toString("base64");
});
afterAll(() => { if (cacheDir) rmSync(cacheDir, { recursive: true, force: true }); });

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
    const response = await handleTurnActivity(pool, request(params), { thumbnailCacheDir: cacheDir });
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
    const stored = readdirSync(cacheDir);
    expect(stored).toHaveLength(1);
    // The stored copy is what later requests receive.
    writeFileSync(join(cacheDir, stored[0]!), bytes.subarray(0, bytes.length));
    const again = await handleTurnActivity(pool, request(params), { thumbnailCacheDir: cacheDir });
    expect(Buffer.from(await again.arrayBuffer()).equals(bytes)).toBe(true);
    expect(readdirSync(cacheDir)).toHaveLength(1);
  });

  test("serves the running turn too", async () => {
    const pool = { getTurnEntriesForChat: async () => turnWith([{ type: "image", data: large, mimeType: "image/png" }]) };
    const response = await handleTurnActivity(pool, request({ chat_jid: chat, live: "1", step: "tool:call-img", image: "0" }), { thumbnailCacheDir: cacheDir });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
  });

  test("answers a uniform 404 for missing, invalid or undecodable images", async () => {
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
      const response = await handleTurnActivity(pool, request(params), { thumbnailCacheDir: cacheDir });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not found" });
    }
  });
});

test("prunes the least recently used stored thumbnails beyond the bound", () => {
  const dir = mkdtempSync(join(process.env.TMPDIR || "/tmp", "tool-thumbs-prune-"));
  try {
    for (let i = 0; i < 5; i++) {
      const file = join(dir, `${i}.webp`);
      writeFileSync(file, "x");
      utimesSync(file, new Date(1_000_000 + i * 1000), new Date(1_000_000 + i * 1000));
    }
    writeFileSync(join(dir, "keep.txt"), "not a thumbnail");
    expect(pruneToolImageThumbnails(dir, 2)).toBe(3);
    expect(readdirSync(dir).sort()).toEqual(["3.webp", "4.webp", "keep.txt"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
