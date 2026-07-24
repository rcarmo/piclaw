/**
 * db/thinking-cleanup.ts – Low-level thinking_content cleanup helpers.
 *
 * Kept independent from db/messages.ts so branch/message deletion code can
 * share cleanup semantics without creating DB-layer import cycles.
 */

import { getDb } from "./connection.js";

/** Delete thinking_content rows for a set of message rowids. Safe no-op on empty input. */
export function deleteThinkingContentByMessageRowIds(rowIds: number[]): void {
  if (rowIds.length === 0) return;
  const db = getDb();
  const placeholders = rowIds.map(() => "?").join(",");
  db.prepare(
    `DELETE FROM thinking_content WHERE message_id IN (${placeholders})`
  ).run(...rowIds.map((id) => String(id)));
}

/** Delete all thinking_content rows whose owning message belongs to a chat. */
export function deleteThinkingContentByChatJid(chatJid: string): void {
  const db = getDb();
  db.prepare(
    `DELETE FROM thinking_content
     WHERE message_id IN (
       SELECT CAST(rowid AS TEXT) FROM messages WHERE chat_jid = ?
     )`
  ).run(chatJid);
}

/** Delete thinking_content rows whose owning message belongs to chats matching a JID LIKE pattern. */
export function deleteThinkingContentByChatJidPattern(
  jidPattern: string,
  excludeChatJid?: string,
): void {
  const db = getDb();
  if (excludeChatJid) {
    db.prepare(
      `DELETE FROM thinking_content
       WHERE message_id IN (
         SELECT CAST(rowid AS TEXT) FROM messages
         WHERE chat_jid LIKE ? AND chat_jid != ?
       )`
    ).run(jidPattern, excludeChatJid);
    return;
  }

  db.prepare(
    `DELETE FROM thinking_content
     WHERE message_id IN (
       SELECT CAST(rowid AS TEXT) FROM messages WHERE chat_jid LIKE ?
     )`
  ).run(jidPattern);
}
