/**
 * db/message-inline-media.ts – media shown inline in a timeline entry.
 *
 * Timeline media lives in the `media` table. Attachments link to their message
 * through `message_media`; derived inline media (link-preview images, previews
 * of images a tool returned) link through `message_inline_media`, keyed by
 * kind and a per-message reference. Deleting a message deletes its inline rows
 * and any media no other message or attachment still uses, whichever path
 * deletes the message (a trigger, so no caller can forget it).
 */

import type { Database } from "bun:sqlite";
import { applyOwnedMigrations } from "./migrations.js";

export type InlineMediaKind = "link_preview" | "tool_image";

/** Only media created as derived inline media (cached preview images) is ever deleted here. */
const derivedMediaSql = (idExpr: string) =>
  `EXISTS (SELECT 1 FROM media d WHERE d.id = ${idExpr} AND json_valid(d.metadata) AND json_extract(d.metadata, '$.cache_kind') IN ('link_preview_image', 'tool_image_thumbnail'))`;

/** Derived media referenced only by `rowExpr`'s inline rows (no other message, no attachment). */
const exclusiveMediaSql = (rowExpr: string) => `
  SELECT i.media_id FROM message_inline_media i
   WHERE i.message_rowid = ${rowExpr}
     AND NOT EXISTS (SELECT 1 FROM message_inline_media o WHERE o.media_id = i.media_id AND o.message_rowid <> ${rowExpr})
     AND NOT EXISTS (SELECT 1 FROM message_media a WHERE a.media_id = i.media_id)
     AND ${derivedMediaSql("i.media_id")}`;

const schemaSql = `
  CREATE TABLE IF NOT EXISTS message_inline_media (
    message_rowid INTEGER NOT NULL,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    media_id INTEGER NOT NULL,
    PRIMARY KEY (message_rowid, kind, ref),
    FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_message_inline_media_media_id ON message_inline_media(media_id);
  CREATE TRIGGER IF NOT EXISTS messages_inline_media_ad AFTER DELETE ON messages BEGIN
    DELETE FROM link_preview_image_cache WHERE media_id IN (${exclusiveMediaSql("old.rowid")});
    DELETE FROM media WHERE id IN (${exclusiveMediaSql("old.rowid")});
    DELETE FROM message_inline_media WHERE message_rowid = old.rowid;
  END;`;

// Posts stored before this table point their preview images at /media/<id>.
const linkPreviewBackfillSql = `
  INSERT OR IGNORE INTO message_inline_media (message_rowid, kind, ref, media_id)
  SELECT m.rowid, 'link_preview', json_extract(p.value, '$.url'), CAST(substr(json_extract(p.value, '$.image'), 8) AS INTEGER)
    FROM messages m, json_each(m.link_previews) p
   WHERE m.link_previews IS NOT NULL AND json_valid(m.link_previews) AND json_type(m.link_previews) = 'array'
     AND json_type(p.value, '$.url') = 'text'
     AND json_extract(p.value, '$.image') GLOB '/media/[0-9]*'
     AND EXISTS (SELECT 1 FROM media WHERE id = CAST(substr(json_extract(p.value, '$.image'), 8) AS INTEGER));`;

export function initializeMessageInlineMediaSchema(database: Database): void {
  applyOwnedMigrations(database, [
    { owner: "host.timeline-inline-media", id: "message-inline-media-v1", order: 1, sql: schemaSql },
    { owner: "host.timeline-inline-media", id: "link-preview-backfill-v1", order: 2, sql: linkPreviewBackfillSql },
  ]);
}

export function getMessageInlineMedia(database: Database, messageRowId: number, kind: InlineMediaKind, ref: string): number | undefined {
  const row = database.prepare("SELECT media_id FROM message_inline_media WHERE message_rowid = ? AND kind = ? AND ref = ?")
    .get(messageRowId, kind, ref) as { media_id: number } | null;
  return row ? Number(row.media_id) : undefined;
}

export function putMessageInlineMedia(database: Database, messageRowId: number, kind: InlineMediaKind, ref: string, mediaId: number): void {
  database.prepare(`INSERT INTO message_inline_media (message_rowid, kind, ref, media_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(message_rowid, kind, ref) DO UPDATE SET media_id = excluded.media_id`).run(messageRowId, kind, ref, mediaId);
}

/**
 * Replace one message's inline media of a kind, deleting media it alone used.
 * Run inside the caller's write transaction.
 */
export function replaceMessageInlineMedia(database: Database, messageRowId: number, kind: InlineMediaKind, entries: ReadonlyArray<{ ref: string; mediaId: number }>): void {
  const keep = new Map(entries.map((entry) => [entry.ref, entry.mediaId]));
  const current = database.prepare("SELECT ref, media_id FROM message_inline_media WHERE message_rowid = ? AND kind = ?")
    .all(messageRowId, kind) as Array<{ ref: string; media_id: number }>;
  const dropped = current.filter((row) => keep.get(row.ref) !== Number(row.media_id));
  for (const row of dropped) database.prepare("DELETE FROM message_inline_media WHERE message_rowid = ? AND kind = ? AND ref = ?").run(messageRowId, kind, row.ref);
  for (const [ref, mediaId] of keep) putMessageInlineMedia(database, messageRowId, kind, ref, mediaId);
  const stillUsed = database.prepare("SELECT 1 FROM message_inline_media WHERE media_id = ? UNION ALL SELECT 1 FROM message_media WHERE media_id = ? LIMIT 1");
  const derived = database.prepare(`SELECT 1 FROM media WHERE id = ? AND ${derivedMediaSql("media.id")}`);
  const orphaned = dropped.map((row) => Number(row.media_id)).filter((id) => !stillUsed.get(id, id) && derived.get(id));
  for (const id of new Set(orphaned)) {
    database.prepare("DELETE FROM link_preview_image_cache WHERE media_id = ?").run(id);
    database.prepare("DELETE FROM media WHERE id = ?").run(id);
  }
}
