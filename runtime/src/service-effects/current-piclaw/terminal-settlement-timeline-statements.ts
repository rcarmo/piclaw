import { gunzipSync } from "bun";
import type Database from "bun:sqlite";
import type { TerminalTimelineWrite } from "../contracts/terminal-settlement-store.js";

export type TerminalTimelineStatement =
  | "timeline_chat_insert"
  | "timeline_chat_update"
  | "timeline_message_insert"
  | "timeline_placeholder_fence"
  | "timeline_message_replace"
  | "timeline_media_unlink"
  | "timeline_media_link"
  | "timeline_fts_media_delete"
  | "timeline_fts_media_insert";

export interface TerminalTimelineContent {
  readonly content: string;
  readonly blocks: readonly Readonly<Record<string, unknown>>[] | null;
}

export class TerminalTimelineStatementError extends Error {
  constructor(readonly tag: "owner_conflict" | "corrupt_state") {
    super(tag);
  }
}

interface MessageFtsRow {
  content: unknown;
  chat_jid: unknown;
  sender: unknown;
  sender_name: unknown;
  timestamp: unknown;
  is_bot_message: unknown;
}

const INDEXABLE_MEDIA_TYPES = [
  "image/svg+xml",
  "text/markdown",
  "text/plain",
  "text/html",
  "text/csv",
  "text/xml",
  "application/xml",
  "application/json",
] as const;

export function insertTerminalTimeline(
  database: Database,
  operationId: string,
  committedAt: string,
  timeline: Extract<TerminalTimelineWrite, { readonly mode: "insert" }>,
  content: TerminalTimelineContent,
  afterStatement: (statement: TerminalTimelineStatement) => void,
): number {
  validateThreadRoot(database, timeline.chatJid, timeline.threadId);
  const chatInsert = database
    .prepare(
      `INSERT INTO chats(jid,name,last_message_time)
       VALUES (?,?,?) ON CONFLICT(jid) DO NOTHING`,
    )
    .run(timeline.chatJid, timeline.chatJid, committedAt);
  afterStatement("timeline_chat_insert");
  if (Number(chatInsert.changes) > 1) throw new TerminalTimelineStatementError("corrupt_state");
  if (Number(chatInsert.changes) === 0) {
    const chatUpdate = database
      .prepare(
        `UPDATE chats
         SET name=COALESCE(name,?),
             last_message_time=CASE
               WHEN last_message_time IS NULL OR last_message_time < ? THEN ?
               ELSE last_message_time
             END
         WHERE jid=?`,
      )
      .run(timeline.chatJid, committedAt, committedAt, timeline.chatJid);
    if (!changedExactlyOne(chatUpdate.changes)) {
      throw new TerminalTimelineStatementError("corrupt_state");
    }
    afterStatement("timeline_chat_update");
  }

  const messageId = `service-terminal:${operationId}`;
  if (database.prepare("SELECT 1 FROM messages WHERE id=? LIMIT 1").get(messageId)) {
    throw new TerminalTimelineStatementError("corrupt_state");
  }
  const inserted = database
    .prepare(
      `INSERT INTO messages(
         rowid,id,chat_jid,sender,sender_name,content,content_blocks,thread_id,timestamp,
         is_from_me,is_bot_message,is_terminal_agent_reply,is_steering_message
       ) VALUES (?,?,?,?,?,?,?,?,?,0,1,1,0) RETURNING rowid`,
    )
    .get(
      null,
      messageId,
      timeline.chatJid,
      "web-agent",
      "Piclaw",
      content.content,
      content.blocks === null ? null : JSON.stringify(content.blocks),
      timeline.threadId,
      committedAt,
    ) as { rowid?: unknown } | undefined;
  const rowId = inserted?.rowid;
  if (!Number.isSafeInteger(rowId) || (rowId as number) < 1) {
    throw new TerminalTimelineStatementError("corrupt_state");
  }
  const messageRowId = rowId as number;
  afterStatement("timeline_message_insert");
  linkTerminalMedia(database, messageRowId, timeline.mediaIds, afterStatement);
  return messageRowId;
}

export function replaceTerminalTimeline(
  database: Database,
  operationId: string,
  timeline: Extract<
    TerminalTimelineWrite,
    { readonly mode: "replace_placeholder" }
  >,
  content: TerminalTimelineContent,
  afterStatement: (statement: TerminalTimelineStatement) => void,
): number {
  validateThreadRoot(database, timeline.chatJid, timeline.threadId);
  const fenced = database
    .prepare(
      `UPDATE service_effect_timeline_writes
       SET revision=revision
       WHERE write_type='draft' AND operation_id=? AND message_rowid=?
         AND chat_jid=?
         AND revision=(
           SELECT MAX(newer.revision)
           FROM service_effect_timeline_writes newer
           WHERE newer.write_type='draft'
             AND newer.operation_id=service_effect_timeline_writes.operation_id
         )
         AND EXISTS (
           SELECT 1 FROM messages m
           WHERE m.rowid=service_effect_timeline_writes.message_rowid
             AND m.chat_jid=service_effect_timeline_writes.chat_jid
             AND m.thread_id IS ? AND m.is_bot_message=1
             AND m.is_terminal_agent_reply=0
         )`,
    )
    .run(
      operationId,
      timeline.placeholderRowId,
      timeline.chatJid,
      timeline.threadId,
    );
  if (!changedExactlyOne(fenced.changes)) {
    throw new TerminalTimelineStatementError("owner_conflict");
  }
  afterStatement("timeline_placeholder_fence");
  const previousMediaCount = normaliseExistingMediaFts(
    database,
    timeline.placeholderRowId,
    afterStatement,
  );
  const updated = database
    .prepare(
      `UPDATE messages
       SET content=?,content_blocks=?,is_terminal_agent_reply=1
       WHERE rowid=? AND chat_jid=? AND thread_id IS ?
         AND is_bot_message=1 AND is_terminal_agent_reply=0
         AND EXISTS (
           SELECT 1 FROM service_effect_timeline_writes w
           WHERE w.write_type='draft' AND w.operation_id=?
             AND w.message_rowid=messages.rowid AND w.chat_jid=messages.chat_jid
             AND w.revision=(
               SELECT MAX(newer.revision)
               FROM service_effect_timeline_writes newer
               WHERE newer.write_type='draft' AND newer.operation_id=w.operation_id
             )
         ) RETURNING rowid`,
    )
    .get(
      content.content,
      content.blocks === null ? null : JSON.stringify(content.blocks),
      timeline.placeholderRowId,
      timeline.chatJid,
      timeline.threadId,
      operationId,
    ) as { rowid?: unknown } | undefined;
  if (updated?.rowid !== timeline.placeholderRowId) {
    throw new TerminalTimelineStatementError("owner_conflict");
  }
  afterStatement("timeline_message_replace");

  const removed = database
    .prepare("DELETE FROM message_media WHERE message_rowid=?")
    .run(timeline.placeholderRowId);
  if (Number(removed.changes) !== previousMediaCount) {
    throw new TerminalTimelineStatementError("corrupt_state");
  }
  afterStatement("timeline_media_unlink");
  linkTerminalMedia(
    database,
    timeline.placeholderRowId,
    timeline.mediaIds,
    afterStatement,
  );
  return timeline.placeholderRowId;
}

function validateThreadRoot(
  database: Database,
  chatJid: string,
  threadId: number | null,
): void {
  if (threadId === null) return;
  const root = database
    .prepare(
      `SELECT 1 present FROM messages
       WHERE rowid=? AND chat_jid=? AND (thread_id IS NULL OR thread_id=rowid)`,
    )
    .get(threadId, chatJid) as { present?: unknown } | undefined;
  if (root?.present !== 1) {
    throw new TerminalTimelineStatementError("owner_conflict");
  }
}

function linkTerminalMedia(
  database: Database,
  messageRowId: number,
  mediaIds: readonly number[],
  afterStatement: (statement: TerminalTimelineStatement) => void,
): void {
  for (const mediaId of mediaIds) {
    const linked = database
      .prepare(
        "INSERT INTO message_media(message_rowid,media_id) VALUES (?,?)",
      )
      .run(messageRowId, mediaId);
    if (!changedExactlyOne(linked.changes)) {
      throw new TerminalTimelineStatementError("corrupt_state");
    }
    afterStatement("timeline_media_link");
  }
  appendMediaTextToFts(database, messageRowId, mediaIds, afterStatement);
}

export function normaliseExistingMediaFts(
  database: Database,
  messageRowId: number,
  afterStatement: (statement: TerminalTimelineStatement) => void,
): number {
  const mediaIds = (
    database
      .prepare(
        "SELECT media_id FROM message_media WHERE message_rowid=? ORDER BY media_id",
      )
      .all(messageRowId) as Array<{ media_id?: unknown }>
  ).map((row) => {
    if (!Number.isSafeInteger(row.media_id) || (row.media_id as number) < 1) {
      throw new TerminalTimelineStatementError("corrupt_state");
    }
    return row.media_id as number;
  });
  const textParts = collectMediaText(database, mediaIds);
  if (textParts.length > 0) {
    const base = readMessageFtsRow(database, messageRowId);
    swapMediaFts(
      database,
      messageRowId,
      base,
      `${base.content}\n\n${textParts.join("\n")}`,
      base.content,
      afterStatement,
    );
  }
  return mediaIds.length;
}

export function appendMediaTextToFts(
  database: Database,
  messageRowId: number,
  mediaIds: readonly number[],
  afterStatement: (statement: TerminalTimelineStatement) => void,
): void {
  const textParts = collectMediaText(database, mediaIds);
  if (textParts.length === 0) return;
  const base = readMessageFtsRow(database, messageRowId);
  swapMediaFts(
    database,
    messageRowId,
    base,
    base.content,
    `${base.content}\n\n${textParts.join("\n")}`,
    afterStatement,
  );
}

function requiredCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TerminalTimelineStatementError("corrupt_state");
  }
  return value as number;
}

function collectMediaText(
  database: Database,
  mediaIds: readonly number[],
): string[] {
  const textParts: string[] = [];
  if (mediaIds.length === 0) return textParts;
  // Validate every stored row, but don't materialise an image or other
  // non-indexable BLOB just to throw its bytes away.
  const rowForMedia = database.prepare(
    `SELECT content_type,metadata,typeof(data) AS data_type,
         CASE WHEN substr(content_type,1,5) COLLATE BINARY='text/'
                OR content_type COLLATE BINARY IN (${INDEXABLE_MEDIA_TYPES.map(() => "?").join(",")})
              THEN data END AS data
       FROM media WHERE id=?`,
  );
  for (const mediaId of mediaIds) {
    const row = rowForMedia.get(...INDEXABLE_MEDIA_TYPES, mediaId) as
      | { content_type?: unknown; data?: unknown; metadata?: unknown; data_type?: unknown }
      | undefined;
    if (
      !row ||
      typeof row.content_type !== "string" ||
      row.data_type !== "blob" ||
      (row.data !== null && !(row.data instanceof Uint8Array)) ||
      (row.metadata !== null && typeof row.metadata !== "string")
    ) {
      throw new TerminalTimelineStatementError("corrupt_state");
    }
    const metadata = parseMetadata(row.metadata as string | null);
    if (row.data === null) continue;
    const bytes = decompressMedia(row.data, metadata);
    const raw = new TextDecoder().decode(bytes);
    const text =
      row.content_type.includes("svg") ||
      row.content_type.includes("html") ||
      row.content_type.includes("xml")
        ? stripTags(raw)
        : raw;
    if (text.length > 0 && text.length < 100_000) textParts.push(text);
  }
  return textParts;
}

function readMessageFtsRow(
  database: Database,
  messageRowId: number,
): ReturnType<typeof decodeMessageFtsRow> {
  const message = database
    .prepare(
      `SELECT content,chat_jid,sender,sender_name,timestamp,is_bot_message
       FROM messages WHERE rowid=?`,
    )
    .get(messageRowId) as MessageFtsRow | undefined;
  if (!message) throw new TerminalTimelineStatementError("corrupt_state");
  return decodeMessageFtsRow(message);
}

function swapMediaFts(
  database: Database,
  messageRowId: number,
  base: ReturnType<typeof decodeMessageFtsRow>,
  oldContent: string,
  newContent: string,
  afterStatement: (statement: TerminalTimelineStatement) => void,
): void {
  const removed = database
    .prepare(
      `INSERT INTO messages_fts(
         messages_fts,rowid,content,chat_jid,sender,sender_name,timestamp,is_bot_message
       ) VALUES ('delete',?,?,?,?,?,?,?)`,
    )
    .run(
      messageRowId,
      oldContent,
      base.chatJid,
      base.sender,
      base.senderName,
      base.timestamp,
      base.isBotMessage,
    );
  if (!changedFtsIndex(removed.changes)) {
    throw new TerminalTimelineStatementError("corrupt_state");
  }
  afterStatement("timeline_fts_media_delete");
  const inserted = database
    .prepare(
      `INSERT INTO messages_fts(
         rowid,content,chat_jid,sender,sender_name,timestamp,is_bot_message
       ) VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      messageRowId,
      newContent,
      base.chatJid,
      base.sender,
      base.senderName,
      base.timestamp,
      base.isBotMessage,
    );
  if (!changedFtsIndex(inserted.changes)) {
    throw new TerminalTimelineStatementError("corrupt_state");
  }
  afterStatement("timeline_fts_media_insert");
}

function decodeMessageFtsRow(row: MessageFtsRow): {
  content: string;
  chatJid: string;
  sender: string;
  senderName: string | null;
  timestamp: string;
  isBotMessage: number;
} {
  if (
    typeof row.content !== "string" ||
    typeof row.chat_jid !== "string" ||
    typeof row.sender !== "string" ||
    (row.sender_name !== null && typeof row.sender_name !== "string") ||
    typeof row.timestamp !== "string" ||
    (row.is_bot_message !== 0 && row.is_bot_message !== 1)
  ) {
    throw new TerminalTimelineStatementError("corrupt_state");
  }
  return {
    content: row.content,
    chatJid: row.chat_jid,
    sender: row.sender,
    senderName: row.sender_name,
    timestamp: row.timestamp,
    isBotMessage: row.is_bot_message,
  };
}

function decompressMedia(
  data: Uint8Array,
  metadata: Record<string, unknown> | null,
): Uint8Array {
  if (metadata?.compressed !== "gzip") return data;
  try {
    return new Uint8Array(gunzipSync(Buffer.from(data)));
  } catch (error) {
    void error;
    throw new TerminalTimelineStatementError("corrupt_state");
  }
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TerminalTimelineStatementError("corrupt_state");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TerminalTimelineStatementError) throw error;
    throw new TerminalTimelineStatementError("corrupt_state");
  }
}

// Bun reports trigger-side FTS work in the originating statement's Changes.
// Singleton DML is constrained by a PK/unique predicate and must report its
// own exact direct-row count. Multi-row media unlinking is checked separately.
function changedExactlyOne(changes: number): boolean {
  return Number.isSafeInteger(changes) && changes === 1;
}

// Bun reports FTS5 virtual-table maintenance work in this statement result.
// The rowid and delete command still target one logical index row; durable FTS
// FTS content is restored after media changes.
function changedFtsIndex(changes: number): boolean {
  return Number.isSafeInteger(changes) && changes >= 1;
}

function stripTags(value: string): string {
  return value
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
