import "../helpers.js";
import { beforeEach, describe, expect, test } from "bun:test";
import Database from "bun:sqlite";
import { getDb, initDatabase } from "../../src/db/connection.js";
import { createMedia, deleteUnreferencedMedia, getMediaById, attachMediaToMessage } from "../../src/db/media.js";
import { deleteMessageByRowId, deleteThreadByRowId, updateMessageLinkPreviews } from "../../src/db/messages.js";
import { getMessageInlineMedia, putMessageInlineMedia, initializeMessageInlineMediaSchema } from "../../src/db/message-inline-media.js";
import { purgeExpiredLinkPreviewImageCache, upsertLinkPreviewImageCache } from "../../src/db/link-preview-image-cache.js";

const chat = "web:inline-media";
let seq = 0;
function message(threadId: number | null = null): number {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO chats(jid, name) VALUES (?, ?)").run(chat, chat);
  return Number(db.prepare(`INSERT INTO messages(id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, thread_id)
    VALUES (?, ?, 'web-agent', 'agent', 'text', '2026-11-15T00:00:00.000Z', 0, 1, ?)`).run(`m-${++seq}`, chat, threadId).lastInsertRowid);
}
const image = (kind = "tool_image_thumbnail") => createMedia("x.webp", "image/webp", new Uint8Array([1, 2, 3]), null, { cache_kind: kind });
const inlineRows = () => getDb().query("SELECT message_rowid, media_id, kind, ref FROM message_inline_media ORDER BY message_rowid, kind, ref").all();

beforeEach(() => {
  initDatabase();
  const db = getDb();
  db.exec("DELETE FROM message_inline_media; DELETE FROM link_preview_image_cache; DELETE FROM message_media;");
});

describe("timeline inline media", () => {
  test("stores media against a timeline row and reads it back by kind and reference", () => {
    const row = message(), media = image();
    putMessageInlineMedia(getDb(), row, "tool_image", "call-a:0", media);
    expect(getMessageInlineMedia(getDb(), row, "tool_image", "call-a:0")).toBe(media);
    expect(getMessageInlineMedia(getDb(), row, "tool_image", "call-a:1")).toBeUndefined();
  });

  test("deleting a message deletes its inline media, through every deletion path", () => {
    const a = message(), b = message(), parent = message(), reply = message(parent), raw = message();
    const media = [a, b, parent, reply, raw].map((row) => { const id = image(); putMessageInlineMedia(getDb(), row, "tool_image", "call:0", id); return id; });
    expect(deleteMessageByRowId(chat, a)).toBe(true);
    expect(deleteThreadByRowId(chat, parent).sort()).toEqual([parent, reply].sort());
    getDb().prepare("DELETE FROM messages WHERE rowid = ?").run(raw);
    for (const [index, id] of media.entries()) expect(getMediaById(id) === undefined).toBe(index !== 1);
    expect(inlineRows()).toEqual([{ message_rowid: b, media_id: media[1], kind: "tool_image", ref: "call:0" }]);
  });

  test("media shared with another message or attachment survives until its last reference goes", () => {
    const first = message(), second = message(), shared = image(), attachment = image();
    putMessageInlineMedia(getDb(), first, "link_preview", "https://example.test", shared);
    putMessageInlineMedia(getDb(), second, "link_preview", "https://example.test", shared);
    putMessageInlineMedia(getDb(), first, "link_preview", "https://attached.test", attachment);
    attachMediaToMessage(second, [attachment]);
    deleteMessageByRowId(chat, first);
    expect(getMediaById(shared)).toBeDefined();
    expect(getMediaById(attachment)).toBeDefined();
    deleteMessageByRowId(chat, second);
    expect(getMediaById(shared)).toBeUndefined();
    expect(getMediaById(attachment)).toBeUndefined();
    expect(inlineRows()).toEqual([]);
  });

  test("a cached link-preview image goes with the last post using it, and expiry no longer orphans posts", () => {
    const post = message(), id = image();
    upsertLinkPreviewImageCache("https://img.test/a.png", id, "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    expect(updateMessageLinkPreviews(chat, post, [{ url: "https://site.test", image: `/media/${id}` }])).toBe(true);
    expect(inlineRows()).toEqual([{ message_rowid: post, media_id: id, kind: "link_preview", ref: "https://site.test" }]);
    // Cache expiry drops the URL mapping but keeps the image the post still shows.
    expect(purgeExpiredLinkPreviewImageCache("2027-01-01T00:00:00.000Z")).toEqual({ purgedEntries: 1, purgedMedia: 0 });
    expect(getMediaById(id)).toBeDefined();
    expect(deleteUnreferencedMedia([id])).toBe(0);
    deleteMessageByRowId(chat, post);
    expect(getMediaById(id)).toBeUndefined();
  });

  test("updating link previews replaces their inline rows; an unshared dropped image is removed", () => {
    const post = message(), first = image(), second = image();
    updateMessageLinkPreviews(chat, post, [{ url: "https://one.test", image: `/media/${first}` }, { url: "https://external.test", image: "https://cdn.test/x.png" }]);
    updateMessageLinkPreviews(chat, post, [{ url: "https://two.test", image: `/media/${second}` }]);
    expect(inlineRows()).toEqual([{ message_rowid: post, media_id: second, kind: "link_preview", ref: "https://two.test" }]);
    expect(getMediaById(first)).toBeUndefined();
    updateMessageLinkPreviews(chat, post, []);
    expect(inlineRows()).toEqual([]);
    expect(getMediaById(second)).toBeUndefined();
  });

  test("deleting a cached preview image clears its URL cache row instead of failing the foreign key", () => {
    const post = message(), id = image();
    upsertLinkPreviewImageCache("https://img.test/b.png", id, "2026-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    updateMessageLinkPreviews(chat, post, [{ url: "https://site.test", image: `/media/${id}` }]);
    expect(deleteMessageByRowId(chat, post)).toBe(true);
    expect(getDb().query("SELECT COUNT(*) AS n FROM link_preview_image_cache").get()).toEqual({ n: 0 });
  });

  test("never deletes media that was not created as derived inline media", () => {
    const post = message(), upload = createMedia("photo.png", "image/png", new Uint8Array([9]), null, { size: 1 });
    updateMessageLinkPreviews(chat, post, [{ url: "https://site.test", image: `/media/${upload}` }]);
    updateMessageLinkPreviews(chat, post, []);
    expect(getMediaById(upload)).toBeDefined();
    updateMessageLinkPreviews(chat, post, [{ url: "https://site.test", image: `/media/${upload}` }]);
    deleteMessageByRowId(chat, post);
    expect(getMediaById(upload)).toBeDefined();
  });

  test("backfills existing posts whose previews point at stored images", () => {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(`CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, filename TEXT NOT NULL, content_type TEXT NOT NULL, data BLOB NOT NULL, thumbnail BLOB, metadata TEXT, created_at TEXT);
      CREATE TABLE message_media (message_rowid INTEGER NOT NULL, media_id INTEGER NOT NULL, PRIMARY KEY (message_rowid, media_id));
      CREATE TABLE link_preview_image_cache (source_url TEXT PRIMARY KEY, media_id INTEGER NOT NULL UNIQUE, fetched_at TEXT, expires_at TEXT, last_used_at TEXT, FOREIGN KEY (media_id) REFERENCES media(id));
      CREATE TABLE messages (id TEXT, chat_jid TEXT, content TEXT, link_previews TEXT, timestamp TEXT, PRIMARY KEY (id, chat_jid));
      INSERT INTO media(id, filename, content_type, data, metadata) VALUES (7, 'a', 'image/webp', x'00', '{"cache_kind":"link_preview_image"}');
      INSERT INTO messages(id, chat_jid, content, link_previews, timestamp) VALUES
        ('a', 'c', 'x', '[{"url":"https://a.test","image":"/media/7"},{"url":"https://gone.test","image":"/media/99"},{"url":"https://ext.test","image":"https://cdn.test/i.png"}]', 't'),
        ('b', 'c', 'y', NULL, 't'), ('c', 'c', 'z', 'not json', 't');`);
    initializeMessageInlineMediaSchema(db);
    initializeMessageInlineMediaSchema(db); // idempotent
    expect(db.query("SELECT message_rowid, media_id, kind, ref FROM message_inline_media").all()).toEqual([{ message_rowid: 1, media_id: 7, kind: "link_preview", ref: "https://a.test" }]);
    db.close();
  });
});
