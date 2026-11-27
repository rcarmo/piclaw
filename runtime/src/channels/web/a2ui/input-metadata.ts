import type { Database } from 'bun:sqlite';
import { takeA2uiRendererErrors } from './renderer-errors.js';
import { A2UI_METADATA_HEADING, MAX_A2UI_METADATA_BYTES, projectA2uiPromptInput } from './transport-metadata.js';
import { CLASSIC_A2UI_CATALOG, isA2uiSurfaceBlock, type A2uiSnapshot, type A2uiSurfaceBlock } from './surface.js';
import { validateA2uiDraftEdits, type A2uiActionMessage } from './action.js';
import { InvalidA2uiDraftError, type A2uiDraftPatch } from './drafts.js';
import { negotiateClassicA2ui, type ClassicA2uiRendererCapabilities } from './capabilities.js';

export interface A2uiRendererDataModel {
  version: '1.0';
  surfaces: Record<string, Record<string, unknown>>;
}

type Recipient = { chatJid: string; sourceId: string; conversationId: number };
export interface AcceptedRendererPeer { hash: string; catalogues: readonly string[] }

/** Internal acceptance context. Browser-written data must be validated against stored controls first. */
export interface A2uiRendererInput {
  capabilities?: ClassicA2uiRendererCapabilities;
  peer?: AcceptedRendererPeer;
  action?: {postId: number; message: A2uiActionMessage};
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

export function bindA2uiSurfaceOwner(database: Database, chatJid: string, messageId: string, conversationId: number, sync: boolean): void {
  if (!database.inTransaction) throw Error('A2UI ownership requires the surface publication transaction');
  if (sync) {
    const count = database.query('SELECT COUNT(*) AS total FROM a2ui_surface_owners WHERE chat_jid=? AND conversation_id=? AND send_data_model=1')
      .get(chatJid, conversationId) as {total: number};
    // Seven maximum-sized models and envelope overhead fit in one bounded native input.
    if (count.total >= 7) throw Error('Too many active A2UI surfaces with model sync');
  }
  database.query('INSERT INTO a2ui_surface_owners (chat_jid,message_id,conversation_id,send_data_model) VALUES (?,?,?,?)')
    .run(chatJid,messageId,conversationId,Number(sync));
}

export function readA2uiSurfaceOwner(database: Database, chatJid: string, messageId: string) {
  return database.query(`SELECT s.conversation_id,s.send_data_model,m.rowid AS post_id FROM a2ui_surface_owners s
    JOIN messages m ON m.chat_jid=s.chat_jid AND m.id=s.message_id WHERE s.chat_jid=? AND s.message_id=?`)
    .get(chatJid, messageId) as {conversation_id:number;send_data_model:0|1;post_id:number} | null;
}

export function ownsA2uiModelSync(database: Database, chatJid: string, messageId: string, conversationId: number): boolean {
  const owner = readA2uiSurfaceOwner(database, chatJid, messageId);
  return owner?.conversation_id === conversationId && owner.send_data_model === 1;
}

export function releaseA2uiModelSync(database: Database, chatJid: string, messageId: string): void {
  if (!database.inTransaction) throw Error('A2UI model sync release requires the surface transaction');
  database.query('UPDATE a2ui_surface_owners SET send_data_model=0 WHERE chat_jid=? AND message_id=?').run(chatJid,messageId);
}

/** Collect active agent-owned models for the exact native conversation, not from the browser. */
export function readA2uiRendererDataModel(database: Database, chatJid: string, conversationId: number, input?: A2uiRendererInput): A2uiRendererDataModel {
  const rows = database.query(`SELECT m.id, m.content_blocks FROM a2ui_surface_owners s JOIN messages m
    ON m.id=s.message_id AND m.chat_jid=s.chat_jid WHERE s.chat_jid=? AND s.conversation_id=? AND s.send_data_model=1 AND m.is_bot_message=1
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

/** Private renderer authority/snapshots, never user text or SDK model input.
 * Capability negotiation is an authority grant, not a serialized prompt envelope. */
export function storeA2uiInputMetadata(database: Database, recipient: Recipient, model?: A2uiRendererDataModel, capabilities?: ClassicA2uiRendererCapabilities, peer?: AcceptedRendererPeer, message?: A2uiActionMessage): void {
  if (!database.inTransaction) throw Error('A2UI input metadata requires the source admission transaction');
  const dataModel = model && Object.keys(model.surfaces).length ? model : undefined;
  const envelope={a2uiRendererDataModel:dataModel,a2uiRendererMessage:message};
  const renderer = peer ?? (capabilities ? {catalogues:capabilities['1.0'].supportedCatalogIds} : undefined);
  const base=JSON.stringify(envelope);
  const room=MAX_A2UI_METADATA_BYTES - Buffer.byteLength(base);
  if (room<0) throw Error('A2UI input metadata exceeds its size limit');
  const errors=takeA2uiRendererErrors(database,recipient.chatJid,recipient.conversationId,room-32);
  if (base==='{}' && !errors.length && !renderer) return;
  const metadata=errors.length ? JSON.stringify({...envelope,a2uiRendererErrors:errors}) : base;
  const result = database.query(`INSERT INTO a2ui_input_metadata (chat_jid, message_id, conversation_id, metadata, renderer_peer)
    SELECT chat_jid, id, ?, ?, ? FROM messages WHERE chat_jid=? AND id=? AND is_bot_message=0`)
    .run(recipient.conversationId, metadata, renderer ? JSON.stringify(renderer) : null, recipient.chatJid, recipient.sourceId);
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
  const row = database.query('SELECT metadata,renderer_peer FROM a2ui_input_metadata WHERE chat_jid=? AND message_id=? AND conversation_id=?')
    .get(recipient.chatJid,recipient.sourceId,recipient.conversationId) as {metadata:string;renderer_peer:string|null} | null;
  if (!row) return false;
  try {
    const catalogues = row.renderer_peer ? JSON.parse(row.renderer_peer).catalogues : undefined;
    if (Array.isArray(catalogues) && catalogues.includes(CLASSIC_A2UI_CATALOG)) return true;
    // Read-only compatibility for previously accepted grants, not new storage.
    return !!negotiateClassicA2ui(JSON.parse(row.metadata));
  } catch { return false; }
}

export function readAcceptedRendererPeer(database: Database, recipient: Recipient): AcceptedRendererPeer | undefined {
  const row = database.query('SELECT renderer_peer FROM a2ui_input_metadata WHERE chat_jid=? AND message_id=? AND conversation_id=?')
    .get(recipient.chatJid,recipient.sourceId,recipient.conversationId) as {renderer_peer: string | null} | null;
  const peer = row?.renderer_peer ? JSON.parse(row.renderer_peer) as Partial<AcceptedRendererPeer> : undefined;
  return peer && typeof peer.hash==='string' && Array.isArray(peer.catalogues) ? peer as AcceptedRendererPeer : undefined;
}

/** Public SDK history must not expose the private suffix used for model input. */
export function projectPublicA2uiInput(database: Database, recipient: Recipient, content: string): string {
  if (!recipient.chatJid.startsWith('web:')) return content;
  if (!content.includes(A2UI_METADATA_HEADING)) return content;
  // Fresh accepted input is already the visible user text. Never interpret a
  // literal heading/JSON example supplied by the human as transport metadata.
  const row=database.query('SELECT content FROM messages WHERE chat_jid=? AND id=? AND is_bot_message=0')
    .get(recipient.chatJid,recipient.sourceId) as {content:string|null} | null;
  if (row?.content===content || row?.content === null || row === null) return content;
  const stored=readMetadata(database,recipient);
  // Without the bound metadata row there is no legacy projection authority.
  // Preserve the bytes rather than reconstructing history from a heading.
  return stored===undefined ? content : projectA2uiPromptInput(content,{sourceContent:row.content,metadata:stored});
}
