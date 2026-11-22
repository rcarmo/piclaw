import type { Database } from 'bun:sqlite';
import { isA2uiSurfaceBlock, type A2uiSnapshot } from './surface.js';

export interface A2uiRendererDataModel {
  version: '1.0';
  surfaces: Record<string, Record<string, unknown>>;
}

type Recipient = { chatJid: string; sourceId: string; conversationId: number };

/** Internal acceptance context. Browser-written data must be validated against stored controls first. */
export interface A2uiRendererInput {
  editedSurface?: A2uiSnapshot;
}

export function reserveA2uiModelSync(database: Database, chatJid: string, messageId: string, conversationId: number): void {
  if (!database.inTransaction) throw Error('A2UI model sync requires the surface publication transaction');
  const count = database.query('SELECT COUNT(*) AS total FROM a2ui_synced_surfaces WHERE chat_jid=? AND conversation_id=?')
    .get(chatJid, conversationId) as {total: number};
  // Seven maximum-sized models and envelope overhead fit in one bounded native input.
  if (count.total >= 7) throw Error('Too many active A2UI surfaces with model sync');
  database.query('INSERT INTO a2ui_synced_surfaces (chat_jid,message_id,conversation_id) VALUES (?,?,?)').run(chatJid,messageId,conversationId);
}

export function ownsA2uiModelSync(database: Database, chatJid: string, messageId: string, conversationId: number | undefined): boolean {
  return conversationId !== undefined && !!database.query(`SELECT 1 FROM a2ui_synced_surfaces WHERE chat_jid=? AND message_id=? AND conversation_id=?`)
    .get(chatJid, messageId, conversationId);
}

export function releaseA2uiModelSync(database: Database, chatJid: string, messageId: string): void {
  if (!database.inTransaction) throw Error('A2UI model sync release requires the surface transaction');
  database.query('DELETE FROM a2ui_synced_surfaces WHERE chat_jid=? AND message_id=?').run(chatJid,messageId);
}

/** Collect active agent-owned models for the exact native conversation, not from the browser. */
export function readA2uiRendererDataModel(database: Database, chatJid: string, conversationId: number, edited?: A2uiSnapshot): A2uiRendererDataModel {
  const rows = database.query(`SELECT m.id, m.content_blocks FROM a2ui_synced_surfaces s JOIN messages m
    ON m.id=s.message_id AND m.chat_jid=s.chat_jid WHERE s.chat_jid=? AND s.conversation_id=? AND m.is_bot_message=1
    AND json_valid(m.content_blocks) ORDER BY m.id`).all(chatJid,conversationId) as {id: string; content_blocks: string}[];
  const surfaces: A2uiRendererDataModel['surfaces'] = {};
  for (const row of rows) {
    const blocks: unknown = JSON.parse(row.content_blocks);
    const block = Array.isArray(blocks) ? blocks.find(isA2uiSurfaceBlock) : undefined;
    if (block?.owner !== 'agent' || block.state !== 'active' || !block.surface.sendDataModel || row.id !== `a2ui:${block.surface.surfaceId}`) continue;
    const surface = edited?.surfaceId === block.surface.surfaceId ? edited : block.surface;
    surfaces[surface.surfaceId] = surface.dataModel;
  }
  return { version: '1.0', surfaces };
}

/** Native input metadata is separate from the user-visible message and its content blocks. */
export function storeA2uiInputMetadata(database: Database, recipient: Recipient, model: A2uiRendererDataModel): void {
  if (!database.inTransaction) throw Error('A2UI input metadata requires the source admission transaction');
  if (Object.keys(model.surfaces).length === 0) return;
  const metadata = JSON.stringify({ a2uiRendererDataModel: model });
  if (Buffer.byteLength(metadata) > 256 * 1024) throw Error('A2UI input metadata exceeds its size limit');
  const result = database.query(`INSERT INTO a2ui_input_metadata (chat_jid, message_id, conversation_id, metadata)
    SELECT chat_jid, id, ?, ? FROM messages WHERE chat_jid=? AND id=? AND is_bot_message=0`)
    .run(recipient.conversationId, metadata, recipient.chatJid, recipient.sourceId);
  if (result.changes !== 1) throw Error('A2UI metadata source disappeared');
}

/** The native SDK accepts text here. Serialize the canonical metadata envelope only in its input, never in the timeline. */
export function projectA2uiAgentInput(database: Database, recipient: Omit<Recipient, 'conversationId'> & { conversationId?: number }, content: string): string {
  if (recipient.conversationId === undefined || !recipient.chatJid.startsWith('web:')) return content;
  const row = database.query(`SELECT metadata FROM a2ui_input_metadata WHERE chat_jid=? AND message_id=? AND conversation_id=?`)
    .get(recipient.chatJid, recipient.sourceId, recipient.conversationId) as { metadata: string } | null;
  return row ? `${content}\n\nA2UI renderer metadata:\n${row.metadata}` : content;
}
