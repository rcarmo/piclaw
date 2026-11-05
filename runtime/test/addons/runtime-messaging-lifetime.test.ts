import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { closeDatabase, getDb, initDatabase } from '../../src/db/connection.js';
import { ensureChatBranch } from '../../src/db/chat-branches.js';
import { getDeferredQueuedFollowups } from '../../src/db.js';
import { createAddonMessagingRuntimeHandlers } from '../../src/addons/runtime-messaging.js';
import { addonLocalContextApi } from '../../src/addons/local-context.js';
import { WebChannelRuntimePublicSurfaceService } from '../../src/channels/web/core/web-channel-runtime-public-surface-service.js';
import { readInputRequestAuthority } from '../../src/channels/web/messaging/input-request-authority.js';
import { admitWebMessage } from '../../src/channels/web/messaging/message-store.js';

let cleanup = () => {};
afterEach(async () => { await closeDatabase(); cleanup(); });
const source = { peer_instance_id: 'peerInstance_1234567890', peer_fingerprint: 'fingerprint', message_id: 'message-1', reply_address: 'lab!@auditor', in_reply_to: 'parent-1' };
function fixture(beforeCommit: () => Promise<void> = async () => {}, afterMutation: () => void = () => {}) {
  const ws = createTempWorkspace('peer-lifetime-');
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '1' });
  cleanup = () => { restore(); ws.cleanup(); };
  initDatabase();
  const a = ensureChatBranch({ chat_jid: 'web:agent:a', agent_name: 'agent' });
  const b = ensureChatBranch({ chat_jid: 'web:agent:b', agent_name: 'agent-b' });
  const seen: any[] = [];
  const service = new WebChannelRuntimePublicSurfaceService({
    handleAgentMessage: async req => {
      const body = await req.json();
      body.chat_jid = new URL(req.url).searchParams.get('chat_jid'); seen.push(body);
      const authority = readInputRequestAuthority(req, body.chat_jid, '/agent/default/message')!;
      await beforeCommit(); // Models awaited attachment preparation before admission.
      const validate = (phase?: 'before' | 'after') => { if (phase === 'after') afterMutation(); authority.validate(phase); };
      const row = await admitWebMessage({ broadcastEvent() {} }, { chatJid: body.chat_jid, content: body.content, isBot: false, mediaIds: body.media_ids ?? [], agentId: 'default', agentName: 'Fixture' }, { contentBlocks: body.content_blocks, threadId: body.thread_id }, validate, req.signal);
      return Response.json({ status: 'ok', chat_jid: body.chat_jid, user_message: row });
    },
  } as any);
  const handlers = createAddonMessagingRuntimeHandlers({
    listKnownChats: () => [a, b].map(row => ({ ...row, is_active: false })),
    findChatByAgentName: () => a,
    enqueueAgentMessage: request => service.enqueueAgentMessage(request),
  });
  const request = { target_chat_jid: b.chat_jid, target_incarnation: b.branch_id, content: 'review this', source, thread_id: 7 };
  return { a, b, handlers, request, seen };
}

test('persisted idle sessions enumerate without operator context and exact B keeps peer provenance', async () => {
  const { a, b, handlers, request } = fixture();
  expect(addonLocalContextApi.getToolContext()).toBeNull();
  expect(await handlers.listAdvertisableSessions()).toEqual([
    { chatJid: a.chat_jid, agentName: a.agent_name, incarnation: a.branch_id, active: false },
    { chatJid: b.chat_jid, agentName: b.agent_name, incarnation: b.branch_id, active: false },
  ]);
  expect(await handlers.resolveLocalTarget(request)).toMatchObject({ incarnation: b.branch_id });
  await handlers.deliverPeerMessage({ ...request, mode: 'queue' });
  const rows = getDb().query('SELECT chat_jid,thread_id,content_blocks FROM messages').all() as any[];
  expect(rows).toHaveLength(1);expect(rows[0].chat_jid).toBe(b.chat_jid);expect(rows[0].thread_id).toBe(7);
  const blocks=JSON.parse(rows[0].content_blocks);
  expect(blocks).toMatchObject([{ type: 'peer_message', target_chat_jid: b.chat_jid, in_reply_to: 'parent-1', reply_to: { address: 'lab!@auditor' } }]);
  expect(blocks.some((block:any)=>block.type==='addon_local_dispatch')).toBe(false);
  expect(addonLocalContextApi.getToolContext()).toBeNull();
});

for (const change of ['archive', 'replace'] as const) {
  for (const mode of ['queue', 'auto', 'steer'] as const) {
    test(`${change} after attachment await refuses ${mode} admission and cleans media`, async () => {
      let b: any;
      const f = fixture(async () => {
        await Promise.resolve();
        getDb().query(change === 'archive' ? 'UPDATE chat_branches SET archived_at=? WHERE chat_jid=?' : 'UPDATE chat_branches SET branch_id=? WHERE chat_jid=?').run('changed', b.chat_jid);
      });
      b = f.b;
      const data = new TextEncoder().encode('attachment');
      await expect(f.handlers.deliverPeerMessage({ ...f.request, mode, attachments: [{ filename: 'note.txt', content_type: 'text/plain', size: data.length, sha256: createHash('sha256').update(data).digest('hex'), data }] })).rejects.toThrow('lifetime changed');
      expect(getDeferredQueuedFollowups(b.chat_jid)).toEqual([]);
      for (const table of ['messages', 'media']) expect((getDb().query(`SELECT count(*) n FROM ${table}`).get() as any).n).toBe(0);
    });
  }
}

test('stale claim never reaches enqueue; cancellation during await cannot commit', async () => {
  const abort = new AbortController();
  const f = fixture(async () => abort.abort(Error('cancelled')));
  expect(await f.handlers.resolveLocalTarget({ ...f.request, target_incarnation: 'stale' })).toEqual({ status: 'not_found' });
  await expect(f.handlers.deliverPeerMessage({ ...f.request, target_incarnation: 'stale' })).rejects.toThrow('target was not found');
  expect(f.seen).toEqual([]);
  await expect(f.handlers.deliverPeerMessage({ ...f.request, mode: 'queue', signal: abort.signal })).rejects.toThrow('cancelled');
  expect(getDeferredQueuedFollowups(f.b.chat_jid)).toEqual([]);
});

test('lifetime change after message mutation rolls back exact admission commit', async () => {
  let b: any;
  const f = fixture(undefined, () => getDb().query('UPDATE chat_branches SET archived_at=? WHERE chat_jid=?').run('archived-at-commit', b.chat_jid));
  b = f.b;
  await expect(f.handlers.deliverPeerMessage({ ...f.request, mode: 'queue' })).rejects.toThrow('lifetime changed');
  expect(getDeferredQueuedFollowups(b.chat_jid)).toEqual([]);
});
