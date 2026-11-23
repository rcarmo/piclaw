/** Foreground, conversation-owned A2UI publication. No arbitrary structured posting. */
import type { Database } from 'bun:sqlite';
import { Type, type Static } from 'typebox';
import { getIdentityConfig } from '../../../core/config.js';
import { captureHostDatabaseBinding } from '../../../db/connection.js';
import { getMessageByRowIdFromDatabase, storeMessageInDatabase } from '../../../db/messages.js';
import { admitSqliteWrite } from '../../../db/sqlite-async-admission.js';
import { stripInternalTags } from '../../../router.js';
import { replaceSurfaceBlocks } from './persistence.js';
import { publicationProtocolError } from './protocol-errors.js';
import { bindA2uiSurfaceOwner, readA2uiSurfaceOwner, releaseA2uiModelSync } from './input-metadata.js';
import { isA2uiSurfaceBlock, type A2uiSurfaceBlock } from './surface.js';

export const a2uiToolParameters = Type.Object({
  express: Type.Optional(Type.String({ maxLength: 16_384, description: 'Bare A2UI Express DSL. Supply exactly one of express or messages.' })),
  messages: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown()), {
    minItems: 1, maxItems: 32, description: 'A2UI v1.0 create/update/delete messages for one surface. Use one draft ID on creation, then the returned surface_id on edits. Supply exactly one of express or messages.',
  })),
  fallback: Type.Optional(Type.String({ maxLength: 1024, description: 'Plain visible summary; required when creating a surface.' })),
  post_id: Type.Optional(Type.Integer({ minimum: 1, description: 'Existing surface post to edit in this thread; omit to create.' })),
  revision: Type.Optional(Type.Integer({ minimum: 1, description: 'Current revision, required when editing or deleting.' })),
  keep_active: Type.Optional(Type.Boolean({ description: 'Accept another submission after each committed action. Only set at creation.' })),
}, { additionalProperties: false });

export async function publishAgentA2ui(options: {
  root: Database;
  chatJid: string;
  conversationId?: number;
  thread: () => number;
  authorise: () => void;
  signal?: AbortSignal;
}, params: Static<typeof a2uiToolParameters>) {
  const { root, chatJid, conversationId, authorise, signal } = options;
  const assertBinding = captureHostDatabaseBinding(root);
  const check = () => { assertBinding(); authorise(); signal?.throwIfAborted(); };
  check();
  if ((params.express === undefined) === (params.messages === undefined)) throw new Error('Supply exactly one of express or messages');
  const threadId = options.thread();
  if (!chatJid.startsWith('web:') || !Number.isSafeInteger(threadId) || threadId < 1) throw new Error('Foreground web thread required');
  const lookup = (postId: number) => {
    const row = getMessageByRowIdFromDatabase(root, chatJid, postId);
    if (row?.data?.type !== 'agent_response' || row.data.thread_id !== threadId) return null;
    const blocks = row.data.content_blocks;
    const surface = blocks?.find(isA2uiSurfaceBlock);
    return surface?.owner === 'agent' ? { blocks: blocks!, surface } : null;
  };
  const editing = params.post_id !== undefined;
  const prior = editing ? lookup(params.post_id!) : null;
  if (editing ? (!prior || prior.surface.state !== 'active' || prior.surface.revision !== params.revision
    || params.fallback !== undefined || params.keep_active !== undefined) : params.revision !== undefined) throw new Error('Invalid or stale surface target');
  const fallback = prior?.surface.fallback_text ?? stripInternalTags(params.fallback ?? '').trim();
  if (!fallback || fallback.length > 1024) throw new Error('A visible surface fallback is required');
  const surfaceId = prior?.surface.surface.surfaceId ?? crypto.randomUUID();
  const { compileA2uiExpress, applyA2uiMessages, bindA2uiDraftId, readA2uiDraftSurfaceId } = await import('./express.js');
  check();
  let surface: ReturnType<typeof applyA2uiMessages>;
  try {
    const messages = params.express !== undefined ? compileA2uiExpress(params.express, surfaceId)
      : editing ? params.messages! : bindA2uiDraftId(params.messages!, surfaceId);
    surface = applyA2uiMessages(surfaceId, messages, prior?.surface.surface, params.messages !== undefined);
  } catch (error) {
    const draftId = !editing && params.messages ? readA2uiDraftSurfaceId(params.messages) : undefined;
    throw publicationProtocolError(error, draftId ?? surfaceId) ?? error;
  }
  if (surface?.sendDataModel && (conversationId === undefined || !Number.isSafeInteger(conversationId) || conversationId < 1))
    throw new Error('Model sync requires an owning agent conversation');
  const messageId = `a2ui:${surfaceId}`;
  const revision = (prior?.surface.revision ?? 0) + 1;
  const rowId = await admitSqliteWrite(root, () => {
    if (options.thread() !== threadId) throw new Error('Surface thread changed');
    const next: A2uiSurfaceBlock | null = surface ? {
      type: 'a2ui_surface', owner: 'agent', surface, revision, state: 'active', fallback_text: fallback,
      ...((params.keep_active || prior?.surface.submit_behavior === 'keep_active') ? { submit_behavior: 'keep_active' as const } : {}),
    } : null;
    if (prior) {
      const current = lookup(params.post_id!);
      if (!current || JSON.stringify(current.surface) !== JSON.stringify(prior.surface)) throw new Error('Surface has changed');
      const owner = readA2uiSurfaceOwner(root, chatJid, messageId);
      if (owner ? owner.conversation_id !== conversationId : current.surface.surface.sendDataModel)
        throw new Error('Surface belongs to another agent conversation');
      const blocks = current.blocks.map(block => block === current.surface
        ? next ?? { type: "a2ui_surface_removed", revision } : block);
      replaceSurfaceBlocks(root, chatJid, params.post_id!, blocks);
      if (!next && current.surface.surface.sendDataModel) releaseA2uiModelSync(root, chatJid, messageId);
      return params.post_id!;
    }
    // A freshly created surface deleted in the same batch never reaches the timeline.
    if (!next) return null;
    const row = storeMessageInDatabase(root, { id: messageId, chat_jid: chatJid, thread_id: threadId,
      sender: 'assistant', sender_name: getIdentityConfig().assistantName, is_from_me: true, is_bot_message: true,
      timestamp: new Date().toISOString(), content: fallback, content_blocks: [next] });
    if (row <= 0) throw new Error('Could not store surface');
    if (conversationId !== undefined) bindA2uiSurfaceOwner(root, chatJid, messageId, conversationId, next.surface.sendDataModel === true);
    return row;
  }, check, signal, undefined, assertBinding);
  return { rowId, surfaceId, revision, deleted: !surface, created: rowId !== null && !editing };
}
