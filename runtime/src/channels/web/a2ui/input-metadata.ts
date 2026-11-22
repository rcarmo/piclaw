import type { Database } from 'bun:sqlite';
import { isA2uiSurfaceBlock, type A2uiSnapshot, type A2uiSurfaceBlock } from './surface.js';
import { validateA2uiDraftEdits } from './action.js';
import { InvalidA2uiDraftError, type A2uiDraftPatch } from './drafts.js';
import { negotiateClassicA2ui, type ClassicA2uiRendererCapabilities } from './capabilities.js';

export interface A2uiRendererDataModel {
  version: '1.0';
  surfaces: Record<string, Record<string, unknown>>;
}

type Recipient = { chatJid: string; sourceId: string; conversationId: number };

/** Internal acceptance context. Browser-written data must be validated against stored controls first. */
export interface A2uiRendererInput {
  capabilities?: ClassicA2uiRendererCapabilities;
  submittedSurfaceId?: string;
  editedSurface?: A2uiSnapshot;
  draftSurface?: (block: A2uiSurfaceBlock) => A2uiSnapshot | undefined;
}

/** Prepare once outside the SQL admission transaction; resolve controls against its committed revision. */
export async function prepareA2uiDraftProjection(patches: A2uiDraftPatch[]): Promise<A2uiRendererInput['draftSurface']> {
  const { applyA2uiControlEdits } = await import('./express.js');
  const drafts = new Map(patches.map(patch => [patch.surface_id, patch]));
  return block => {
    const patch = drafts.get(block.surface.surfaceId);
    if (!patch || patch.revision !== block.revision) return;
    try { return applyA2uiControlEdits(block.surface, validateA2uiDraftEdits(block.surface, patch.edits)); }
    catch { throw new InvalidA2uiDraftError(); }
  };
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
export function readA2uiRendererDataModel(database: Database, chatJid: string, conversationId: number, input?: A2uiRendererInput): A2uiRendererDataModel {
  const rows = database.query(`SELECT m.id, m.content_blocks FROM a2ui_synced_surfaces s JOIN messages m
    ON m.id=s.message_id AND m.chat_jid=s.chat_jid WHERE s.chat_jid=? AND s.conversation_id=? AND m.is_bot_message=1
    AND json_valid(m.content_blocks) ORDER BY m.id`).all(chatJid,conversationId) as {id: string; content_blocks: string}[];
  const surfaces: A2uiRendererDataModel['surfaces'] = {};
  for (const row of rows) {
    const blocks: unknown = JSON.parse(row.content_blocks);
    const block = Array.isArray(blocks) ? blocks.find(isA2uiSurfaceBlock) : undefined;
    if (block?.owner !== 'agent' || block.state !== 'active' || !block.surface.sendDataModel || row.id !== `a2ui:${block.surface.surfaceId}`) continue;
    const surface = input?.editedSurface?.surfaceId === block.surface.surfaceId ? input.editedSurface : input?.draftSurface?.(block) ?? block.surface;
    surfaces[surface.surfaceId] = surface.dataModel;
  }
  if (input?.submittedSurfaceId && !Object.hasOwn(surfaces, input.submittedSurfaceId)) throw new InvalidA2uiDraftError();
  return { version: '1.0', surfaces };
}

/** Native input metadata is separate from the user-visible message and its content blocks. */
export function storeA2uiInputMetadata(database: Database, recipient: Recipient, model?: A2uiRendererDataModel, capabilities?: ClassicA2uiRendererCapabilities): void {
  if (!database.inTransaction) throw Error('A2UI input metadata requires the source admission transaction');
  const dataModel = model && Object.keys(model.surfaces).length ? model : undefined;
  if (!dataModel && !capabilities) return;
  const metadata = JSON.stringify({ a2uiRendererDataModel: dataModel, a2uiRendererCapabilities: capabilities });
  if (Buffer.byteLength(metadata) > 256 * 1024) throw Error('A2UI input metadata exceeds its size limit');
  const result = database.query(`INSERT INTO a2ui_input_metadata (chat_jid, message_id, conversation_id, metadata)
    SELECT chat_jid, id, ?, ? FROM messages WHERE chat_jid=? AND id=? AND is_bot_message=0`)
    .run(recipient.conversationId, metadata, recipient.chatJid, recipient.sourceId);
  if (result.changes !== 1) throw Error('A2UI metadata source disappeared');
}

function readMetadata(database: Database, recipient: Omit<Recipient, 'conversationId'> & { conversationId?: number }): string | undefined {
  if (recipient.conversationId === undefined || !recipient.chatJid.startsWith('web:')) return;
  const row = database.query(`SELECT metadata FROM a2ui_input_metadata WHERE chat_jid=? AND message_id=? AND conversation_id=?`)
    .get(recipient.chatJid, recipient.sourceId, recipient.conversationId) as { metadata: string } | null;
  return row?.metadata;
}

/** Only transport metadata written in the accepted source transaction can grant catalogue support. */
export function hasA2uiRendererOffer(database: Database, recipient: Recipient): boolean {
  const metadata = readMetadata(database, recipient);
  try { return metadata !== undefined && !!negotiateClassicA2ui(JSON.parse(metadata)); }
  catch { return false; }
}

/** The native SDK accepts text here. Serialize the canonical metadata envelope only in its input, never in the timeline. */
export function projectA2uiAgentInput(database: Database, recipient: Omit<Recipient, 'conversationId'> & { conversationId?: number }, content: string): string {
  const metadata = readMetadata(database, recipient);
  return metadata ? `${content}\n\nA2UI renderer metadata:\n${metadata}` : content;
}
