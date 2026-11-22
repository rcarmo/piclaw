import type { Database } from 'bun:sqlite';
import { isRetiredContentBlock } from '../../../core/retired-content-blocks.js';

/** Change only A2UI blocks; the source's text, annotations and attachments are immutable here. */
export function replaceSurfaceBlocks(database: Database, chatJid: string, postId: number, blocks: unknown[]): void {
  if (!database.inTransaction) throw new Error('Surface update requires the owning transaction');
  const saved = database.query('SELECT content_blocks FROM messages WHERE chat_jid = ? AND rowid = ?')
    .get(chatJid, postId) as { content_blocks: string | null } | null;
  const raw = saved?.content_blocks ? JSON.parse(saved.content_blocks) : [];
  const persisted = [...blocks];
  // Readers redact retired blocks. Revising a current surface must not delete a neighbouring historical block.
  if (Array.isArray(raw)) raw.forEach((block, index) => { if (isRetiredContentBlock(block)) persisted.splice(index, 0, block); });
  const result = database.prepare('UPDATE messages SET content_blocks = ? WHERE chat_jid = ? AND rowid = ?').run(JSON.stringify(persisted), chatJid, postId);
  if (result.changes !== 1) throw new Error('Surface post disappeared');
}
