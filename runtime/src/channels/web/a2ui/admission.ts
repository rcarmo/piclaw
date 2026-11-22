import type { Database } from 'bun:sqlite';
import { getDb } from '../../../db.js';
import { admitSqliteWrite } from '../../../db/sqlite-async-admission.js';
/** Authenticated, revision-bound admission of ordinary A2UI actions. */
import { createHash } from 'node:crypto';
import { isSingleUserAccess } from '../../../core/config-access.js';
import { getMessageByRowId } from '../../../db/messages.js';
import { captureHostDatabaseBinding } from '../../../db/connection.js';
import { captureWebRequestAuthority } from '../auth/auth-gateway.js';
import type { WebChannelLike } from '../core/web-channel-contracts.js';
import { handleAgentMessage } from '../handlers/agent.js';
import { bindInputRequestAuthority, captureInputTarget, releaseInputRequestAuthority, type ValidateInputAuthority } from '../messaging/input-request-authority.js';
import { validateA2uiActionWithEdits, type A2uiAction } from './action.js';
import { validA2uiEventTimestamp } from './date-time.js';
import { releaseA2uiModelSync } from './input-metadata.js';
import { MAX_A2UI_DRAFT_BYTES, parseA2uiDrafts } from './drafts.js';
import { negotiateClassicA2ui } from './capabilities.js';
import { bindRendererOffer } from './rpc.js';
import { handleTotpSurfaceAction } from './totp.js';
import { recoveryPrompt } from './recovery.js';
import { invokeAddonA2ui } from './addon.js';
import { handleProviderLoginSurface } from './provider-login.js';
import { replaceSurfaceBlocks } from './persistence.js';
import { isA2uiSurfaceBlock } from './surface.js';

const requestIdentity = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/i;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readBody(req: Request): Promise<unknown> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error('Missing action');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let length = 0;
  let body = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        const result = JSON.parse(body + decoder.decode());
        if (length > 32 * 1024) {
          if (!record(result) || !Object.hasOwn(result, 'a2ui_drafts')) throw Error('Action too large');
          const { a2ui_drafts: _drafts, ...action } = result;
          if (Buffer.byteLength(JSON.stringify(action)) > 32 * 1024) throw Error('Action too large');
        }
        return result;
      }
      length += value.length;
      if (length > 32 * 1024 + MAX_A2UI_DRAFT_BYTES) throw new Error('Action too large');
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function handleA2uiAction(channel: WebChannelLike, req: Request): Promise<Response> {
  const json = (payload: unknown, status: number) => channel.json(payload, status);
  const changed = () => json({ error: 'This surface has changed. Use the current surface.' }, 409);
  if (!isSingleUserAccess()) return json({ error: 'Surface actions require single-user access.' }, 403);
  let authorise: () => void;
  let payload: unknown;
  try { authorise = captureWebRequestAuthority(channel.authGateway, req); }
  catch { return json({ error: 'Surface action not authorised.' }, 403); }
  try { payload = await readBody(req); }
  catch { return json({ error: 'Invalid or oversized surface action.' }, 400); }
  if (!record(payload) || Object.keys(payload).length !== 6 + Number(Object.hasOwn(payload, 'private_code')) + Number(Object.hasOwn(payload, 'private_value')) + Number(Object.hasOwn(payload, 'instance_path')) + Number(Object.hasOwn(payload, 'a2ui_drafts')) + Number(Object.hasOwn(payload, 'metadata')) + Number(Object.hasOwn(payload, 'renderer_peer'))) return json({ error: 'Invalid surface action.' }, 400);
  const { chat_jid: chatJid, post_id: postId, thread_id: threadId, revision, request_id: requestId, message, instance_path: instancePath, private_code: code, private_value: privateValue } = payload;
  if (typeof chatJid !== 'string' || !chatJid.startsWith('web:') || chatJid.length > 240
    || typeof postId !== 'number' || !Number.isSafeInteger(postId) || postId < 1
    || typeof threadId !== 'number' || !Number.isSafeInteger(threadId) || threadId < 1
    || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1
    || typeof requestId !== 'string' || !requestIdentity.test(requestId) || !record(message) || !record(message.action)
    || typeof message.action.surfaceId !== 'string'
    || !validA2uiEventTimestamp(message.action.timestamp)
    || (instancePath !== undefined && (typeof instancePath !== 'string' || !/^(?:\/(?:0|[1-9][0-9]?)){1,24}$/.test(instancePath)))) return json({ error: 'Invalid surface action.' }, 400);
  let drafts: ReturnType<typeof parseA2uiDrafts>;
  try { drafts = parseA2uiDrafts(payload.a2ui_drafts); }
  catch { return json({ error: 'Invalid A2UI draft.' }, 400); }
  let capabilities: ReturnType<typeof negotiateClassicA2ui>;
  try { capabilities = negotiateClassicA2ui(payload.metadata); }
  catch { return json({ error: 'Invalid A2UI renderer capabilities.' }, 400); }
  if (drafts?.length && !capabilities) return json({ error: 'A2UI drafts require a renderer offer.' }, 400);
  const surfaceId = message.action.surfaceId;
  const readSource = () => getMessageByRowId(chatJid, postId);
  function sourceBlock(row: ReturnType<typeof readSource>) {
    return row?.data?.content_blocks?.find(block => isA2uiSurfaceBlock(block) && block.surface.surfaceId === surfaceId);
  }
  const binding = captureHostDatabaseBinding();
  const validateTarget = captureInputTarget(chatJid);
  const validate: ValidateInputAuthority = phase => { binding(); authorise(); validateTarget(phase); };
  try { validate(); }
  catch { return json({ error: 'Surface action not authorised.' }, 403); }

  const source = readSource();
  if (!source || source.data?.type !== 'agent_response') return json({ error: 'Surface post not found.' }, 404);
  const sourceThread = source.data?.thread_id ?? postId;
  const root = getMessageByRowId(chatJid, sourceThread);
  if (threadId !== sourceThread || !root || (root.data?.thread_id != null && root.data.thread_id !== root.id)) return changed();
  const block = sourceBlock(source);
  if (!isA2uiSurfaceBlock(block)) return source.data?.content_blocks?.some(isA2uiSurfaceBlock) ? changed() : json({ error: 'Surface not found.' }, 404);
  if (block.owner !== 'agent' && block.owner !== 'recovery' && (block.state !== 'active' || block.revision !== revision)) return changed();
  if (drafts?.length && (block.owner !== 'agent' || message.action.name === 'cancel')) return json({ error: 'Unexpected A2UI draft.' }, 400);
  const selfDraft = drafts?.find(patch => patch.surface_id === surfaceId);
  if (selfDraft && (!block.surface.sendDataModel || selfDraft.revision !== revision)) return changed();
  // A committed model edit may hide or remove the original template occurrence. Match
  // an exact synced retry before re-resolving that occurrence against the new revision.
  const replayDigest = block.owner === 'agent' && (block.surface.sendDataModel || drafts?.length || capabilities) && code === undefined && privateValue === undefined
    ? createHash('sha256').update(JSON.stringify(['a2ui-draft-action', { ...message, action: { ...message.action, timestamp: undefined } }, instancePath, drafts, capabilities, payload.renderer_peer])).digest('hex')
    : undefined;
  const matchesReceipt = (latest: unknown, digest: string | undefined) => digest !== undefined && isA2uiSurfaceBlock(latest)
    && latest.last_submission?.request_id === requestId && latest.last_submission.revision === revision && latest.last_submission.digest === digest;
  const accepted = () => json({ status: 'accepted', duplicate: true }, 200);
  if (matchesReceipt(block, replayDigest)) return accepted();
  let action: A2uiAction, edits: ReadonlyMap<string, unknown>;
  try { ({ action, edits } = validateA2uiActionWithEdits(block.surface, message, instancePath, selfDraft?.edits)); }
  catch { return json({ error: 'Invalid surface action.' }, 400); }
  if (block.owner === 'login') {
    if (code !== undefined) return json({ error: 'Unexpected private authentication input.' }, 400);
    return handleProviderLoginSurface({ channel, req, source: { chat_jid: chatJid, post_id: postId, thread_id: threadId }, block, action, privateValue,
      authorise: () => validate(), assertBinding: binding,
      replace(database, next) {
        const current = readSource();
        const latest = sourceBlock(current);
        if (!current || current.data?.type !== 'agent_response' || (current.data?.thread_id ?? postId) !== threadId
          || !isA2uiSurfaceBlock(latest) || latest.owner !== 'login' || latest.state !== 'active' || latest.revision !== revision
          || JSON.stringify(latest.surface) !== JSON.stringify(block.surface)) throw Error('Authentication surface changed');
        replaceSurfaceBlocks(database, chatJid, postId, current.data!.content_blocks!.map(item => item === latest ? next : item));
      },
      publish() {
        const current = readSource();
        if (current) channel.interactionBroadcaster.broadcastInteractionUpdated(current);
      },
    });
  }
  if (privateValue !== undefined) return json({ error: 'Unexpected private authentication input.' }, 400);
  if (block.owner === 'totp') {
    if (action.name !== 'totp-open') return changed();
    if (code !== undefined && (typeof code !== 'string' || !/^\d{6}$/.test(code))) return json({ error: 'Enter a six-digit code.' }, 400);
    return handleTotpSurfaceAction({ gateway: channel.authGateway, req, chatJid, block, code,
      authorise: () => validate(), assertBinding: binding,
      complete(database, feedback) {
        const current = readSource();
        const latest = sourceBlock(current);
        if (!current || (current.data?.thread_id ?? postId) !== threadId || current.data?.type !== 'agent_response'
          || !isA2uiSurfaceBlock(latest) || latest.owner !== 'totp' || latest.state !== 'active' || latest.revision !== revision) throw Error('TOTP surface changed');
        replaceSurfaceBlocks(database, chatJid, postId, current.data!.content_blocks!.map(item =>
          item === latest ? { ...latest, state: 'completed', revision: revision + 1, fallback_text: feedback,
            surface: { ...latest.surface, components: [{ id: 'root', component: 'Text', text: feedback }] } } : item));
      },
      publish() {
        const current = readSource();
        if (current) channel.interactionBroadcaster.broadcastInteractionUpdated(current);
      },
    });
  }
  if (block.owner === 'addon' && code === undefined) {
    return invokeAddonA2ui({ req, chatJid, threadId, postId, block, action,
      authorise: () => validate(), assertBinding: binding,
      assertConsumed() {
        const current = readSource();
        const latest = sourceBlock(current);
        const root = getMessageByRowId(chatJid, threadId);
        if (!current || current.data?.type !== 'agent_response' || (current.data?.thread_id ?? postId) !== threadId || !root
          || (root.data?.thread_id != null && root.data.thread_id !== threadId)
          || !isA2uiSurfaceBlock(latest) || latest.owner !== 'addon' || latest.state !== 'completed' || latest.revision !== revision + 1
          || JSON.stringify(latest.surface) !== JSON.stringify(block.surface)) throw Error('Add-on action source changed');
      },
      consume(database) {
        const current = readSource();
        const latest = sourceBlock(current);
        if (!current || current.data?.type !== 'agent_response' || (current.data?.thread_id ?? postId) !== threadId
          || !isA2uiSurfaceBlock(latest) || latest.owner !== 'addon' || latest.state !== 'active' || latest.revision !== revision
          || JSON.stringify(latest.surface) !== JSON.stringify(block.surface)) throw Error('Add-on surface changed');
        replaceSurfaceBlocks(database, chatJid, postId, current.data!.content_blocks!.map(item => item === latest
          ? { ...latest, state: 'completed', revision: revision + 1 } : item));
      },
      publish() { const latest = readSource(); if (latest) channel.interactionBroadcaster.broadcastInteractionUpdated(latest); },
      sendMessage: (content) => channel.sendMessage(chatJid, content, { threadId }),
    });
  }
  const recovery = block.owner === 'recovery' && source.data.is_terminal_agent_reply === true && Object.keys(action.context).length === 0
    ? recoveryPrompt(action.name, postId) : undefined;
  if ((block.owner !== 'agent' && !recovery) || code !== undefined || privateValue !== undefined) return json({ error: 'Surface action not authorised.' }, 403);
  const { timestamp: _timestamp, ...submitted } = action;
  const legacyDigest = createHash('sha256').update(JSON.stringify({ ...submitted, instancePath })).digest('hex');
  const digest = replayDigest ?? legacyDigest;
  const duplicate = (latest: unknown) => matchesReceipt(latest, digest) || (!drafts?.length && matchesReceipt(latest, legacyDigest));
  if (duplicate(block)) return accepted();
  if (block.state !== 'active' || block.revision !== revision) return changed();

  let editedSurface: typeof block.surface | undefined;
  if (block.owner === 'agent' && block.surface.sendDataModel && action.name !== 'cancel' && edits.size) {
    try {
      const { applyA2uiControlEdits } = await import('./express.js');
      editedSurface = applyA2uiControlEdits(block.surface, edits);
    } catch { return json({ error: 'Invalid surface model update.' }, 400); }
  }
  const settle = (database: Database, rowId?: number) => {
    const current = readSource();
    const latest = sourceBlock(current);
    const root = getMessageByRowId(chatJid, threadId);
    if (!current || current.data?.type !== 'agent_response' || (current.data?.thread_id ?? postId) !== threadId || !root
      || (root.data?.thread_id != null && root.data.thread_id !== threadId)
      || !isA2uiSurfaceBlock(latest) || latest.owner !== block.owner || (recovery && current.data?.is_terminal_agent_reply !== true) || latest.state !== 'active' || latest.revision !== revision
      || JSON.stringify(latest.surface) !== JSON.stringify(block.surface)) throw new Error('Surface changed before admission');
    const next = { ...latest, surface: editedSurface ?? latest.surface, revision: revision + 1,
      state: rowId === undefined ? 'cancelled' : latest.submit_behavior === 'keep_active' ? 'active' : 'completed',
      last_submission: { request_id: requestId, revision, digest, ...(rowId !== undefined ? { row_id: rowId } : {}) } };
    const blocks = current.data?.content_blocks?.map(item => item === latest ? next : item);
    // Write only structured content; never rewrite the source's clamped display text or its media.
    replaceSurfaceBlocks(database, chatJid, postId, blocks!);
    if (next.surface.sendDataModel && next.state !== 'active') releaseA2uiModelSync(database, chatJid, `a2ui:${surfaceId}`);
  };
  if (block.owner === 'agent' && action.name === 'cancel') {
    if (Object.keys(action.context).length) return json({ error: 'Cancel must not submit form values.' }, 400);
    const database = getDb();
    try { await admitSqliteWrite(database, () => settle(database), validate, req.signal, undefined, binding); }
    catch { return duplicate(sourceBlock(readSource())) ? accepted() : changed(); }
    const updated = readSource();
    if (updated) channel.interactionBroadcaster.broadcastInteractionUpdated(updated);
    return json({ status: 'cancelled' }, 200);
  }

  const pathname = '/agent/default/message';
  const fields = Object.entries(action.context).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  const description = action.userMessage ? [action.userMessage] : [];
  const body = JSON.stringify({ content: recovery ?? [`Submitted ${action.name}`, ...description, ...fields].join('\n'), thread_id: threadId,
    a2ui_drafts: drafts?.filter(patch => patch !== selfDraft),
    metadata: capabilities ? { a2uiRendererCapabilities: capabilities } : undefined });
  const forward = new Request(`http://internal${pathname}`, { method: 'POST', signal: req.signal,
    headers: { 'Content-Type': 'application/json' }, body });
  bindInputRequestAuthority(forward, chatJid, body, validate);
  let response: Response;
  try {
    response = await handleAgentMessage(channel, forward, pathname, chatJid, 'default', {
      requireReplyThread: true,
      authorise: () => {},
      a2uiSubmission: {
        ...(block.owner === 'agent' && block.surface.sendDataModel ? { submittedSurfaceId: surfaceId, editedSurface } : {}),
        peer: capabilities ? bindRendererOffer(channel,req,chatJid,payload.renderer_peer,payload.metadata) : undefined,
      },
      onAccepted: ({ database, rowId }) => settle(database, rowId),
    });
  } finally { releaseInputRequestAuthority(forward); }
  binding();
  const updated = readSource();
  const receipt = sourceBlock(updated);
  if (!duplicate(receipt)) {
    return isA2uiSurfaceBlock(receipt) && (receipt.revision !== revision || receipt.state !== 'active') ? changed() : response;
  }
  if (response.ok || (await response.clone().json().catch(() => null))?.accepted === true) {
    channel.interactionBroadcaster.broadcastInteractionUpdated(updated!);
    return response;
  }
  return accepted();
}
