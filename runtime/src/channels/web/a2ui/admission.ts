/** Authenticated, revision-bound admission of ordinary A2UI actions. */
import { createHash } from 'node:crypto';
import { isSingleUserAccess } from '../../../core/config-access.js';
import { getMessageByRowId } from '../../../db/messages.js';
import { captureHostDatabaseBinding } from '../../../db/connection.js';
import { captureWebRequestAuthority } from '../auth/auth-gateway.js';
import type { WebChannelLike } from '../core/web-channel-contracts.js';
import { handleAgentMessage } from '../handlers/agent.js';
import { bindInputRequestAuthority, captureInputTarget, releaseInputRequestAuthority, type ValidateInputAuthority } from '../messaging/input-request-authority.js';
import { validateA2uiAction } from './action.js';
import { handleTotpSurfaceAction } from './totp.js';
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
      if (done) return JSON.parse(body + decoder.decode());
      length += value.length;
      if (length > 32 * 1024) throw new Error('Action too large');
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
  if (!record(payload) || Object.keys(payload).length !== (Object.hasOwn(payload, 'private_code') ? 7 : 6)) return json({ error: 'Invalid surface action.' }, 400);
  const { chat_jid: chatJid, post_id: postId, thread_id: threadId, revision, request_id: requestId, message, private_code: code } = payload;
  if (typeof chatJid !== 'string' || !chatJid.startsWith('web:') || chatJid.length > 240
    || typeof postId !== 'number' || !Number.isSafeInteger(postId) || postId < 1
    || typeof threadId !== 'number' || !Number.isSafeInteger(threadId) || threadId < 1
    || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1
    || typeof requestId !== 'string' || !requestIdentity.test(requestId) || !record(message) || !record(message.action)
    || typeof message.action.surfaceId !== 'string') return json({ error: 'Invalid surface action.' }, 400);
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
  if (!isA2uiSurfaceBlock(block)) return json({ error: 'Surface not found.' }, 404);
  if (block.owner === 'totp' && (block.state !== 'active' || block.revision !== revision)) return changed();
  let action: ReturnType<typeof validateA2uiAction>;
  try { action = validateA2uiAction(block.surface, message); }
  catch { return json({ error: 'Invalid surface action.' }, 400); }
  if (block.owner === 'totp') {
    if (action.name !== 'totp-open') return changed();
    if (code !== undefined && (typeof code !== 'string' || !/^\d{6}$/.test(code))) return json({ error: 'Enter a six-digit code.' }, 400);
    return handleTotpSurfaceAction({ channel, req, chatJid, block, code,
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
  if (block.owner !== 'agent' || code !== undefined) return json({ error: 'Surface action not authorised.' }, 403);
  const { timestamp: _timestamp, ...submitted } = action;
  const digest = createHash('sha256').update(JSON.stringify(submitted)).digest('hex');
  const duplicate = (latest: unknown) => isA2uiSurfaceBlock(latest) && latest.last_submission?.request_id === requestId
    && latest.last_submission.revision === revision && latest.last_submission.digest === digest;
  const accepted = () => json({ status: 'accepted', duplicate: true }, 200);
  if (duplicate(block)) return accepted();
  if (block.state !== 'active' || block.revision !== revision) return changed();

  const pathname = '/agent/default/message';
  const fields = Object.entries(action.context).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
  const body = JSON.stringify({ content: [`Submitted ${action.name}`, ...fields].join('\n'), thread_id: threadId });
  const forward = new Request(`http://internal${pathname}`, { method: 'POST', signal: req.signal,
    headers: { 'Content-Type': 'application/json' }, body });
  bindInputRequestAuthority(forward, chatJid, body, validate);
  let response: Response;
  try {
    response = await handleAgentMessage(channel, forward, pathname, chatJid, 'default', {
      requireReplyThread: true,
      authorise: () => {},
      onAccepted: ({ database, rowId }) => {
        const current = readSource();
        const latest = sourceBlock(current);
        const root = getMessageByRowId(chatJid, threadId);
        if (!current || current.data?.type !== 'agent_response' || (current.data?.thread_id ?? postId) !== threadId || !root
          || (root.data?.thread_id != null && root.data.thread_id !== threadId)
          || !isA2uiSurfaceBlock(latest) || latest.owner !== 'agent' || latest.state !== 'active' || latest.revision !== revision
          || JSON.stringify(latest.surface) !== JSON.stringify(block.surface)) throw new Error('Surface changed before admission');
        const next = { ...latest, revision: revision + 1,
          state: latest.submit_behavior === 'keep_active' ? 'active' : 'completed',
          last_submission: { request_id: requestId, revision, digest, row_id: rowId } };
        const blocks = current.data?.content_blocks?.map(item => item === latest ? next : item);
        // Write only structured content; never rewrite the source's clamped display text or its media.
        replaceSurfaceBlocks(database, chatJid, postId, blocks!);
      },
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
