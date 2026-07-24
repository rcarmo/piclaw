/**
 * db/messages.ts – CRUD operations for the `messages` and `chats` tables.
 *
 * Provides all read/write access to stored chat messages, including:
 *   - Persisting inbound messages from any channel (storeMessage)
 *   - Timeline pagination for the web UI (getTimeline, hasOlderMessages)
 *   - Full-text and hashtag search (searchMessages, getMessagesByHashtag)
 *   - Message editing and deletion with media cleanup
 *   - Polling for new messages by the router (getNewMessages, getMessagesSince)
 *
 * Consumers:
 *   - router.ts calls getNewMessages() each poll cycle.
 *   - channels/web/message-store.ts wraps many functions for the web channel.
 *   - channels/web/handlers/posts.ts uses timeline/search/delete functions.
 *   - agent-control/handlers/info.ts uses searchMessages for `/search`.
 *   - Channel addons call storeMessage() for inbound messages.
 *   - agent-pool.ts calls storeMessage() to persist agent responses.
 */

import { getDb } from "./connection.js";
import { ensureChatBranch } from "./chat-branches.js";
import { clampWebContent } from "./web-content.js";
import type { InteractionRow } from "./types.js";
import type { NewMessage } from "../types.js";
import {
  attachMediaToMessage,
  deleteUnreferencedMedia,
  getMediaIdsForMessage,
  getMediaIdsForMessages,
} from "./media.js";
import {
  deleteThinkingContentByChatJid,
  deleteThinkingContentByChatJidPattern,
  deleteThinkingContentByMessageRowIds,
} from "./thinking-cleanup.js";
import { getSearchMatchMode } from "../core/config.js";

/**
 * Internal representation of a raw row from the `messages` table.
 * JSON columns (content_blocks, link_previews) are still serialised strings.
 */
interface StoredMessageRow {
  rowid: number;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  screen_hint: string | null;
  content_blocks: string | null;
  link_previews: string | null;
  annotations: string | null;
  thread_id: number | null;
  timestamp: string;
  is_bot_message: number;
}

/** Column list used in SELECT queries to ensure a consistent shape. */
const MESSAGE_COLUMNS = "rowid, chat_jid, sender, sender_name, content, screen_hint, content_blocks, link_previews, annotations, thread_id, timestamp, is_bot_message";

function ensureMonotonicMessageTimestamp(chatJid: string, requestedTimestamp: string): string {
  const requestedMs = Date.parse(requestedTimestamp);
  if (!Number.isFinite(requestedMs)) return requestedTimestamp;

  const db = getDb();
  const row = db
    .prepare("SELECT timestamp FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC, rowid DESC LIMIT 1")
    .get(chatJid) as { timestamp: string } | undefined;
  if (!row?.timestamp) return requestedTimestamp;

  const lastMs = Date.parse(row.timestamp);
  if (!Number.isFinite(lastMs) || requestedMs > lastMs) return requestedTimestamp;

  return new Date(lastMs + 1).toISOString();
}

/** Safely parse a JSON string into an array, returning undefined on failure. */
function parseJsonArray(value: string | null | undefined): unknown[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert a raw StoredMessageRow into the InteractionRow shape expected by
 * the web timeline and other consumers. Clamps overly-long content and
 * attaches parsed content_blocks / link_previews / media_ids.
 */
function buildInteraction(row: StoredMessageRow, mediaIds: number[] = []): InteractionRow {
  const { content, meta } = clampWebContent(row.content);
  const contentBlocks = parseJsonArray(row.content_blocks);
  const linkPreviews = parseJsonArray(row.link_previews);
  const data: InteractionRow["data"] = {
    type: row.is_bot_message ? "agent_response" : "user_message",
    content,
    content_meta: meta,
    agent_id: "default",
    media_ids: mediaIds,
  };
  if (row.screen_hint) data.screen_hint = row.screen_hint;
  if (contentBlocks?.length) data.content_blocks = contentBlocks;
  if (linkPreviews?.length) data.link_previews = linkPreviews;
  const annotations = parseJsonArray(row.annotations);
  if (annotations?.length) data.annotations = annotations;
  if (row.thread_id !== null && row.thread_id !== undefined) data.thread_id = row.thread_id;
  return {
    id: row.rowid,
    chat_jid: row.chat_jid,
    timestamp: row.timestamp,
    data,
  };
}

/**
 * Insert or update the `chats` table with the latest message timestamp and
 * optionally the chat's display name. Called by the router whenever a message
 * arrives or chat metadata changes.
 */
export function storeChatMetadata(chatJid: string, timestamp: string, name?: string): void {
  const db = getDb();
  if (name) {
    db.prepare(
      `INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET
         name = excluded.name,
         last_message_time = MAX(last_message_time, excluded.last_message_time)`
    ).run(chatJid, name, timestamp);
  } else {
    db.prepare(
      `INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET
         last_message_time = MAX(last_message_time, excluded.last_message_time)`
    ).run(chatJid, chatJid, timestamp);
  }

  ensureChatBranch({
    chat_jid: chatJid,
  });
}

export function listRecentChatJids(limit = 10, options?: { excludeChatJids?: string[] }): string[] {
  const maxRows = Math.max(1, Math.min(100, Math.trunc(limit) || 10));
  const excluded = Array.isArray(options?.excludeChatJids)
    ? options.excludeChatJids.map((jid) => String(jid || "").trim()).filter(Boolean).slice(0, 900)
    : [];
  const db = getDb();
  const exclusionSql = excluded.length > 0
    ? ` AND c.jid NOT IN (${excluded.map(() => "?").join(", ")})`
    : "";
  const rows = db.prepare(
    `SELECT c.jid AS chat_jid
       FROM chats c
       LEFT JOIN chat_branches b ON b.chat_jid = c.jid
      WHERE (b.chat_jid IS NULL OR b.archived_at IS NULL)${exclusionSql}
      ORDER BY c.last_message_time DESC, c.jid ASC
      LIMIT ?`
  ).all(...excluded, maxRows) as Array<{ chat_jid: string | null | undefined }>;

  return rows
    .map((row) => (typeof row.chat_jid === "string" ? row.chat_jid.trim() : ""))
    .filter(Boolean);
}

/**
 * Persist a message into the `messages` table.
 * Returns the SQLite rowid of the inserted row (used as the interaction id
 * in the web timeline and for media attachment linking).
 */
export function storeMessage(msg: NewMessage): number {
  const db = getDb();
  msg.timestamp = ensureMonotonicMessageTimestamp(msg.chat_jid, msg.timestamp);
  const contentBlocks = msg.content_blocks ? JSON.stringify(msg.content_blocks) : null;
  const linkPreviews = msg.link_previews ? JSON.stringify(msg.link_previews) : null;

  db.prepare(
    `INSERT INTO messages (
      id, chat_jid, sender, sender_name, content, screen_hint, content_blocks, link_previews,
      thread_id, timestamp, is_from_me, is_bot_message, is_terminal_agent_reply, is_steering_message
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id, chat_jid) DO UPDATE SET
       sender = excluded.sender,
       sender_name = excluded.sender_name,
       content = excluded.content,
       screen_hint = excluded.screen_hint,
       content_blocks = excluded.content_blocks,
       link_previews = excluded.link_previews,
       thread_id = excluded.thread_id,
       timestamp = excluded.timestamp,
       is_from_me = excluded.is_from_me,
       is_bot_message = excluded.is_bot_message,
       is_terminal_agent_reply = excluded.is_terminal_agent_reply,
       is_steering_message = excluded.is_steering_message`
  ).run(
    msg.id,
    msg.chat_jid,
    msg.sender,
    msg.sender_name,
    msg.content,
    msg.screen_hint ?? null,
    contentBlocks,
    linkPreviews,
    msg.thread_id ?? null,
    msg.timestamp,
    msg.is_from_me ? 1 : 0,
    msg.is_bot_message ? 1 : 0,
    msg.is_terminal_agent_reply ? 1 : 0,
    msg.is_steering_message ? 1 : 0
  );

  const row = db
    .prepare("SELECT rowid as rowid FROM messages WHERE id = ? AND chat_jid = ?")
    .get(msg.id, msg.chat_jid) as { rowid: number } | undefined;
  return row?.rowid ?? 0;
}

/**
 * Look up the rowid for a message by its chat JID and message id.
 * Used by the web channel when it needs to reference a specific message.
 */
export function getMessageRowIdById(chatJid: string, messageId: string): number | null {
  const db = getDb();
  const row = db
    .prepare("SELECT rowid as rowid FROM messages WHERE chat_jid = ? AND id = ?")
    .get(chatJid, messageId) as { rowid: number } | undefined;
  return row?.rowid ?? null;
}

/**
 * Look up the persisted thread root rowid for a message id.
 * Returns the message's own rowid when it is a root/self-threaded message.
 */
export function getMessageThreadRootIdById(chatJid: string, messageId: string): number | null {
  const db = getDb();
  const row = db
    .prepare("SELECT rowid as rowid, thread_id FROM messages WHERE chat_jid = ? AND id = ?")
    .get(chatJid, messageId) as { rowid: number; thread_id: number | null } | undefined;
  if (!row) return null;
  return row.thread_id ?? row.rowid ?? null;
}

/**
 * Fetch a single message by its rowid within a known chat, returning it as an InteractionRow.
 * Used by replaceMessageContent and the web channel's post-detail views.
 */
export function getMessageByRowId(chatJid: string, rowId: number): InteractionRow | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_jid = ? AND rowid = ?`
    )
    .get(chatJid, rowId) as StoredMessageRow | undefined;
  if (!row) return undefined;
  const mediaIds = getMediaIdsForMessage(row.rowid);
  return buildInteraction(row, mediaIds);
}

/**
 * Fetch a single message by its rowid across all chats.
 * Used when callers only have a persisted source post id and must recover the
 * authoritative owning chat before applying updates or routing follow-up work.
 */
export function getMessageByAnyRowId(rowId: number): InteractionRow | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE rowid = ?`
    )
    .get(rowId) as StoredMessageRow | undefined;
  if (!row) return undefined;
  const mediaIds = getMediaIdsForMessage(row.rowid);
  return buildInteraction(row, mediaIds);
}

/**
 * Update just the link_previews JSON column for a message.
 * Called by the link-preview enrichment pipeline after OpenGraph data is fetched.
 */
export function updateMessageLinkPreviews(
  chatJid: string,
  rowId: number,
  linkPreviews: unknown[]
): boolean {
  const db = getDb();
  const payload = linkPreviews.length > 0 ? JSON.stringify(linkPreviews) : null;
  const res = db
    .prepare("UPDATE messages SET link_previews = ? WHERE chat_jid = ? AND rowid = ?")
    .run(payload, chatJid, rowId);
  return res.changes > 0;
}

/**
 * Read the annotations JSON for a message. Returns parsed array or null.
 */
export function getMessageAnnotations(
  chatJid: string,
  rowId: number,
): unknown[] | null {
  const db = getDb();
  const row = db
    .prepare("SELECT annotations FROM messages WHERE chat_jid = ? AND rowid = ?")
    .get(chatJid, rowId) as { annotations: string | null } | undefined;
  if (!row?.annotations) return null;
  try { return JSON.parse(row.annotations); } catch { return null; }
}

/**
 * Update the annotations JSON column for a message.
 * Stores user-created highlights and markup that are not part of the message content.
 */
export function updateMessageAnnotations(
  chatJid: string,
  rowId: number,
  annotations: unknown[] | null,
): boolean {
  const db = getDb();
  const payload = Array.isArray(annotations) && annotations.length > 0
    ? JSON.stringify(annotations)
    : null;
  const res = db
    .prepare("UPDATE messages SET annotations = ? WHERE chat_jid = ? AND rowid = ?")
    .run(payload, chatJid, rowId);
  return res.changes > 0;
}

export function storeThinkingContent(
  messageId: string,
  text: string,
  lines: number,
  durationMs: number,
  model?: string,
  truncated = false,
): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO thinking_content (message_id, text, lines, duration_ms, model, truncated)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    String(messageId),
    text,
    Math.max(0, Math.trunc(lines) || 0),
    Math.max(0, Math.trunc(durationMs) || 0),
    typeof model === "string" && model.trim() ? model.trim() : null,
    truncated ? 1 : 0,
  );
}

export function getThinkingContent(messageId: string): {
  text: string;
  lines: number;
  duration_ms: number;
  model: string | null;
  truncated: boolean;
} | null {
  const db = getDb();
  const row = db.prepare(
    `SELECT text, lines, duration_ms, model, truncated
     FROM thinking_content
     WHERE message_id = ?`
  ).get(String(messageId)) as {
    text: string;
    lines: number;
    duration_ms: number;
    model: string | null;
    truncated: number;
  } | undefined;
  if (!row) return null;
  return {
    text: row.text,
    lines: row.lines,
    duration_ms: row.duration_ms || 0,
    model: row.model,
    truncated: Boolean(row.truncated),
  };
}

/**
 * Fetch persisted thinking for a message, scoped to a specific chat_jid and
 * validated to ensure the message exists, is a bot reply, and carries a
 * thinking_ref block in its content_blocks. Returns null if any check fails
 * (without distinguishing why — avoids enumeration oracles).
 *
 * This is the function the public /agent/thinking endpoint should call so
 * that callers cannot read arbitrary thinking by guessing message_ids.
 */
export function getThinkingContentForChat(chatJid: string, messageId: string): {
  text: string;
  lines: number;
  duration_ms: number;
  model: string | null;
  truncated: boolean;
} | null {
  const db = getDb();
  // Single query joins messages + thinking_content with all defense checks:
  //   - message belongs to chat_jid
  //   - message is a bot reply (is_bot_message = 1)
  //   - message references thinking via a thinking_ref content block (uses
  //     json_each so an attacker can't confuse the matcher by embedding the
  //     literal string 'thinking_ref' in unrelated block payload — the
  //     predicate is satisfied only when an actual block has type='thinking_ref')
  //   - thinking_content row exists for the message rowid
  const row = db.prepare(
    `SELECT tc.text, tc.lines, tc.duration_ms, tc.model, tc.truncated
     FROM thinking_content tc
     JOIN messages m ON m.rowid = CAST(tc.message_id AS INTEGER)
     WHERE m.chat_jid = ?
       AND CAST(tc.message_id AS INTEGER) = CAST(? AS INTEGER)
       AND m.is_bot_message = 1
       AND EXISTS (
         SELECT 1 FROM json_each(m.content_blocks)
         WHERE json_extract(value, '$.type') = 'thinking_ref'
       )`
  ).get(chatJid, String(messageId)) as {
    text: string;
    lines: number;
    duration_ms: number;
    model: string | null;
    truncated: number;
  } | undefined;
  if (!row) return null;
  return {
    text: row.text,
    lines: row.lines,
    duration_ms: row.duration_ms || 0,
    model: row.model,
    truncated: Boolean(row.truncated),
  };
}

export {
  deleteThinkingContentByChatJid,
  deleteThinkingContentByChatJidPattern,
  deleteThinkingContentByMessageRowIds,
};

/**
 * Replace the content (and optionally content_blocks, link_previews, media)
 * of an existing message. Used by the web channel's edit-post feature.
 * Returns the updated InteractionRow, or undefined if the row didn't exist.
 */
export function replaceMessageContent(
  chatJid: string,
  rowId: number,
  content: string,
  options: { contentBlocks?: unknown[]; linkPreviews?: unknown[]; mediaIds?: number[]; isTerminalAgentReply?: boolean } = {}
): InteractionRow | undefined {
  const db = getDb();
  const contentBlocks = options.contentBlocks ? JSON.stringify(options.contentBlocks) : null;
  const linkPreviews = options.linkPreviews ? JSON.stringify(options.linkPreviews) : null;
  const res = db
    .prepare(
      "UPDATE messages SET content = ?, content_blocks = ?, link_previews = ?, is_terminal_agent_reply = COALESCE(?, is_terminal_agent_reply) WHERE chat_jid = ? AND rowid = ?"
    )
    .run(
      content,
      contentBlocks,
      linkPreviews,
      typeof options.isTerminalAgentReply === "boolean" ? (options.isTerminalAgentReply ? 1 : 0) : null,
      chatJid,
      rowId
    );

  if (res.changes <= 0) return undefined;

  // Re-link media: remove old associations and attach the new set.
  db.prepare("DELETE FROM message_media WHERE message_rowid = ?").run(rowId);
  if (options.mediaIds && options.mediaIds.length > 0) {
    attachMediaToMessage(rowId, options.mediaIds);
  }

  return getMessageByRowId(chatJid, rowId);
}

/**
 * Delete a single message by rowid, cleaning up associated media.
 * Used by the web channel's delete-post endpoint.
 */
export function deleteMessageByRowId(chatJid: string, rowId: number): boolean {
  const db = getDb();
  const mediaIds = getMediaIdsForMessage(rowId);
  // Atomic cleanup: wrap the message_media + thinking_content + messages
  // DELETEs in a transaction. Otherwise a crash between any two leaves an
  // orphan thinking_content row, and SQLite will reuse the rowid for a
  // future INSERT (composite PK on messages means no AUTOINCREMENT), causing
  // the new message to inherit ghost thinking via the endpoint's rowid join.
  const changes = db.transaction(() => {
    db.prepare("DELETE FROM message_media WHERE message_rowid = ?").run(rowId);
    db.prepare("DELETE FROM thinking_content WHERE message_id = ?").run(String(rowId));
    return db.prepare("DELETE FROM messages WHERE chat_jid = ? AND rowid = ?").run(chatJid, rowId).changes;
  })();
  if (changes > 0) {
    deleteUnreferencedMedia(mediaIds);
  }
  return changes > 0;
}

/**
 * Delete a message and all its thread replies. Returns the list of deleted
 * rowids. Used by the web channel when deleting a parent post that has replies.
 */
export function deleteThreadByRowId(chatJid: string, rowId: number): number[] {
  const db = getDb();
  // Find the parent message and all replies whose thread_id points to it.
  const rows = db
    .prepare("SELECT rowid FROM messages WHERE chat_jid = ? AND (rowid = ? OR thread_id = ?)")
    .all(chatJid, rowId, rowId) as Array<{ rowid: number }>;
  const ids = Array.from(new Set(rows.map((row) => row.rowid)));
  if (ids.length === 0) return [];

  const mediaIds = getMediaIdsForMessages(ids);
  const placeholders = ids.map(() => "?").join(",");
  // Atomic cleanup (see deleteMessageByRowId for the rowid-reuse rationale).
  db.transaction(() => {
    db.prepare(`DELETE FROM message_media WHERE message_rowid IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM thinking_content WHERE message_id IN (${ids.map(() => "?").join(",")})`).run(...ids.map(String));
    db.prepare(`DELETE FROM messages WHERE chat_jid = ? AND rowid IN (${placeholders})`).run(chatJid, ...ids);
  })();
  deleteUnreferencedMedia(mediaIds);
  return ids;
}

/**
 * Paginated timeline fetch – returns up to `limit` messages, optionally
 * before a given rowid, in chronological order (oldest first).
 * Used by the web channel's GET /timeline endpoint.
 */
export function getTimeline(chatJid: string, limit: number, beforeId?: number): InteractionRow[] {
  const db = getDb();
  const rows = beforeId
    ? (db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_jid = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?`
        )
        .all(chatJid, beforeId, limit) as StoredMessageRow[])
    : (db
        .prepare(
          `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_jid = ? ORDER BY rowid DESC LIMIT ?`
        )
        .all(chatJid, limit) as StoredMessageRow[]);

  const rowIds = rows.map((row) => row.rowid);
  const mediaByMessage = new Map<number, number[]>();
  if (rowIds.length > 0) {
    const placeholders = rowIds.map(() => "?").join(",");
    const mediaRows = db
      .prepare(`SELECT message_rowid, media_id FROM message_media WHERE message_rowid IN (${placeholders}) ORDER BY message_rowid, media_id`)
      .all(...rowIds) as Array<{ message_rowid: number; media_id: number }>;
    for (const mediaRow of mediaRows) {
      const current = mediaByMessage.get(mediaRow.message_rowid);
      if (current) current.push(mediaRow.media_id);
      else mediaByMessage.set(mediaRow.message_rowid, [mediaRow.media_id]);
    }
  }
  const interactions = rows.map((row) => buildInteraction(row, mediaByMessage.get(row.rowid) || []));
  return interactions.reverse();
}

/** Check whether there are messages older than the given rowid in a chat. */
export function hasOlderMessages(chatJid: string, oldestId: number): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT rowid FROM messages WHERE chat_jid = ? AND rowid < ? LIMIT 1")
    .get(chatJid, oldestId) as { rowid: number } | undefined;
  return Boolean(row);
}

/**
 * Fetch messages whose content contains a given #hashtag (case-insensitive LIKE).
 * Used by the web channel's hashtag filter feature.
 */
export function getMessagesByHashtag(chatJid: string, hashtag: string, limit: number, offset: number): InteractionRow[] {
  const db = getDb();
  const pattern = `%#${hashtag}%`;
  const rows = db
    .prepare(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE chat_jid = ? AND content LIKE ? COLLATE NOCASE ORDER BY rowid DESC LIMIT ? OFFSET ?`
    )
    .all(chatJid, pattern, limit, offset) as StoredMessageRow[];

  return rows.map((row) => buildInteraction(row, getMediaIdsForMessage(row.rowid)));
}

/**
 * Full-text search over messages using FTS5 MATCH, with a LIKE fallback
 * if the FTS query syntax is invalid. Hashtag queries (starting with #)
 * are routed to a simpler LIKE search.
 *
 * Used by the web channel's search bar and agent-control /search command.
 */
function searchMessagesInternal(chatJids: string[] | null, query: string, limit: number, offset: number): InteractionRow[] {
  const db = getDb();
  const hasChatFilter = Array.isArray(chatJids);
  if (hasChatFilter && chatJids.length === 0) return [];
  const chatClause = hasChatFilter ? `chat_jid IN (${chatJids.map(() => "?").join(",")}) AND ` : "";
  const ftsChatClause = hasChatFilter ? `messages.chat_jid IN (${chatJids.map(() => "?").join(",")}) AND ` : "";
  const chatParams = hasChatFilter ? chatJids : [];

  // Hashtag shortcut: use LIKE for simple #tag searches.
  if (query.startsWith("#")) {
    const tag = query.replace(/^#+/, "");
    if (!tag) return [];
    const pattern = `%#${tag}%`;
    const rows = db
      .prepare(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${chatClause}content LIKE ? COLLATE NOCASE ORDER BY rowid DESC LIMIT ? OFFSET ?`
      )
      .all(...chatParams, pattern, limit, offset) as StoredMessageRow[];
    return rows.map((row) => buildInteraction(row, getMediaIdsForMessage(row.rowid)));
  }

  const rawQuery = query.trim();
  const hasOperators = /(?:\bAND\b|\bOR\b|\bNOT\b|\bNEAR\b|["():*])/i.test(rawQuery);
  const terms = rawQuery
    .split(/\s+/)
    .map((term) => term.replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
  const joiner = getSearchMatchMode() === "or" ? " OR " : " AND ";
  const ftsQuery = !hasOperators && terms.length > 1 ? terms.join(joiner) : rawQuery;

  try {
    const rows = db
      .prepare(
        `SELECT messages.rowid, messages.chat_jid, messages.sender, messages.sender_name, messages.content, messages.screen_hint, messages.content_blocks, messages.link_previews, messages.thread_id, messages.timestamp, messages.is_bot_message
         FROM messages
         JOIN messages_fts ON messages_fts.rowid = messages.rowid
         WHERE ${ftsChatClause}messages_fts MATCH ?
         ORDER BY messages.rowid DESC
         LIMIT ? OFFSET ?`
      )
      .all(...chatParams, ftsQuery, limit, offset) as StoredMessageRow[];
    return rows.map((row) => buildInteraction(row, getMediaIdsForMessage(row.rowid)));
  } catch {
    const fallbackTerms = terms.length > 0 ? terms : rawQuery ? [rawQuery] : [];
    if (fallbackTerms.length === 0) return [];
    const clauses = fallbackTerms.map(() => "content LIKE ? COLLATE NOCASE").join(" AND ");
    const sql = `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE ${chatClause}${clauses} ORDER BY rowid DESC LIMIT ? OFFSET ?`;
    const params = [...chatParams, ...fallbackTerms.map((term) => `%${term}%`), limit, offset];
    const rows = db.prepare(sql).all(...params) as StoredMessageRow[];
    return rows.map((row) => buildInteraction(row, getMediaIdsForMessage(row.rowid)));
  }
}

export function searchMessages(chatJid: string, query: string, limit: number, offset: number): InteractionRow[] {
  return searchMessagesInternal([chatJid], query, limit, offset);
}

export function searchMessagesAcrossChats(chatJids: string[] | null, query: string, limit: number, offset: number): InteractionRow[] {
  return searchMessagesInternal(chatJids, query, limit, offset);
}

/**
 * Polling query used by the router – fetch all non-bot messages newer than
 * `lastTimestamp` across the given chat JIDs. Returns the messages and the
 * new high-water-mark timestamp for the next poll cycle.
 */
export function getNewMessages(
  jids: string[],
  lastTimestamp: string,
  botPrefix: string
): { messages: NewMessage[]; newTimestamp: string } {
  if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };
  const db = getDb();

  const placeholders = jids.map(() => "?").join(",");
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, screen_hint, timestamp
    FROM messages
    WHERE timestamp > ? AND chat_jid IN (${placeholders})
      AND is_bot_message = 0 AND content NOT LIKE ?
      AND LTRIM(content) NOT LIKE '/%'
      AND COALESCE(is_steering_message, 0) = 0
    ORDER BY timestamp
  `;

  const rows = db.prepare(sql).all(lastTimestamp, ...jids, `${botPrefix}:%`) as NewMessage[];

  let newTimestamp = lastTimestamp;
  for (const row of rows) {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
  }

  return { messages: rows, newTimestamp };
}

/**
 * Fetch non-bot messages since a given timestamp for a single chat.
 * Used by the task scheduler when building context for a scheduled task run.
 */
export function getMessagesSince(
  chatJid: string,
  sinceTimestamp: string,
  botPrefix: string
): NewMessage[] {
  const db = getDb();
  const sql = `
    SELECT id, chat_jid, sender, sender_name, content, screen_hint, timestamp, thread_id
    FROM messages
    WHERE chat_jid = ? AND timestamp > ?
      AND is_bot_message = 0 AND content NOT LIKE ?
      AND LTRIM(content) NOT LIKE '/%'
      AND COALESCE(is_steering_message, 0) = 0
    ORDER BY timestamp
  `;
  return db.prepare(sql).all(chatJid, sinceTimestamp, `${botPrefix}:%`) as NewMessage[];
}
