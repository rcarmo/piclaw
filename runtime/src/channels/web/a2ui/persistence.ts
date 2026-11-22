import type { Database } from 'bun:sqlite';

/** Change only A2UI blocks; the source's text, annotations and attachments are immutable here. */
export function replaceSurfaceBlocks(database: Database, chatJid: string, postId: number, blocks: unknown[]): void {
  if (!database.inTransaction) throw new Error('Surface update requires the owning transaction');
  const result = database.prepare('UPDATE messages SET content_blocks = ? WHERE chat_jid = ? AND rowid = ?').run(JSON.stringify(blocks), chatJid, postId);
  if (result.changes !== 1) throw new Error('Surface post disappeared');
}
