import { resetWebTotpSecretIfLoaded } from '../../../helpers.ts';
import { afterEach, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { getDb, getMessageByRowId, initDatabase, storeMessage } from '../../../../src/db.js';
import { getWebRuntimeConfig, setWebTotpSecret } from '../../../../src/core/config.js';
import { handleA2uiAction } from '../../../../src/channels/web/a2ui/admission.js';
import { stageTotpSurface } from '../../../../src/channels/web/a2ui/totp.js';
import { buildA2uiAction } from '../../../../src/channels/web/a2ui/action.js';
import type { WebChannelLike } from '../../../../src/channels/web/core/web-channel-contracts.js';

const current = 'JBSWY3DPEHPK3PXP';
const candidate = 'AAAAAAAAAAAAAAAA';
const chat = 'web:totp-surface';
afterEach(() => resetWebTotpSecretIfLoaded());

function codeForZeroSeed() {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', Buffer.alloc(10)).update(counter).digest();
  return String((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

function fixture(flow: 'setup' | 'reset' = 'setup', lifetime?: number) {
  initDatabase();
  setWebTotpSecret(flow === 'reset' ? current : '');
  const block = stageTotpSurface({ chatJid: chat, flow, candidate, activeSecret: flow === 'reset' ? current : '', issuer: 'Test', label: 'Test', ttlMs: lifetime });
  const updates: unknown[] = [];
  let liveSecret = '';
  const channel = {
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    interactionBroadcaster: { broadcastInteractionUpdated: (row: unknown) => updates.push(row) },
    authGateway: { setTotpSecret: (secret: string) => { liveSecret = secret; }, createTotpContext: () => ({ buildSessionCookie: () => 'fixture=renewed; HttpOnly' }) },
  } as unknown as WebChannelLike;
  const store = (jid: string, id: string) => storeMessage({ id, chat_jid: jid, sender: 'assistant', content: 'TOTP setup', timestamp: new Date().toISOString(), is_from_me: true, is_bot_message: true, content_blocks: [block] });
  const id = store(chat, block.surface.surfaceId);
  const envelope = { chat_jid: chat, post_id: id, thread_id: id, revision: block.revision, request_id: crypto.randomUUID(), message: buildA2uiAction(block.surface, 'open', new Map(), new Date().toISOString()) };
  const send = (payload: object) => handleA2uiAction(channel, new Request('http://test/agent/a2ui-action', { method: 'POST', body: JSON.stringify(payload) }));
  return { envelope, send, updates, id, store, liveSecret: () => liveSecret };
}

test('private enrolment never stores credentials in the timeline, verifies and commits exactly once', async () => {
  const f = fixture();
  const open = await f.send(f.envelope);
  expect(open.status).toBe(200);
  expect(open.headers.get('Cache-Control')).toBe('private, no-store');
  const { totp_presentation } = await open.json();
  expect(totp_presentation.manual_code).toBe(candidate);
  expect(totp_presentation.qr).toStartWith('data:image/svg+xml;base64,');
  const goodCode = codeForZeroSeed();
  const invalid = goodCode === '000000' ? '111111' : '000000';
  expect((await f.send({ ...f.envelope, private_code: invalid })).status).toBe(422);
  expect(getWebRuntimeConfig().totpSecret).toBe('');
  const replies = await Promise.all([f.send({ ...f.envelope, private_code: goodCode }), f.send({ ...f.envelope, private_code: goodCode })]);
  expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
  expect(replies.find(r => r.ok)?.headers.get('set-cookie')).toContain('HttpOnly');
  expect(getWebRuntimeConfig().totpSecret).toBe(candidate);
  expect(f.liveSecret()).toBe(candidate);
  expect(f.updates).toHaveLength(1);
  expect(JSON.stringify(f.updates)).not.toContain(candidate);
  const row = getDb().query('SELECT content_blocks FROM messages WHERE chat_jid = ? AND rowid = ?').get(chat, f.id) as {content_blocks: string};
  expect(row.content_blocks).not.toContain(candidate);
  expect(row.content_blocks).not.toContain('base64');
  expect(row.content_blocks).not.toContain(goodCode);
});

test('expired and copied surfaces cannot disclose or replace the active TOTP secret', async () => {
  const f = fixture('reset');
  const copiedId = f.store('web:other', 'copy');
  expect((await f.send({ ...f.envelope, chat_jid: 'web:other', post_id: copiedId, thread_id: copiedId })).status).toBe(409);
  setWebTotpSecret(candidate);
  expect((await f.send(f.envelope)).status).toBe(409);
  expect(f.updates).toHaveLength(0);
  const expired = fixture('setup', 0);
  expect((await expired.send(expired.envelope)).status).toBe(409);
  expect(getMessageByRowId(chat, expired.id)?.data?.content_blocks?.[0]).toMatchObject({ state: 'active' });
});

test('current code in the reset command reaches its handler but is not written or broadcast', async () => {
  const { admitWebMessage } = await import('../../../../src/channels/web/messaging/message-store.js');
  const { handleAgentMessage } = await import('../../../../src/channels/web/handlers/agent.js');
  initDatabase();
  const dispatch: unknown[] = [];
  const broadcasts: unknown[] = [];
  const channel = {
    json: (body: unknown, status = 200) => Response.json(body, { status }),
    agentPool: { applyControlCommand: async (_chat: string, command: unknown) => {
      dispatch.push(command);
      return { status: 'error', message: 'Synthetic validation result' };
    } },
    getAgentStatus: () => null,
    broadcastEvent: (_event: string, data: unknown) => broadcasts.push(data),
    sendMessage: async () => {},
    admitMessage: (chatJid: string, content: string, isBot: boolean, mediaIds: number[], opts: any, authority: any, signal: AbortSignal) =>
      admitWebMessage({} as any, { chatJid, agentId: 'default', agentName: 'Pi', content, isBot, mediaIds }, opts, authority, signal),
  } as unknown as WebChannelLike;
  const pathname = '/agent/default/message';
  const response = await handleAgentMessage(channel, new Request(`http://test${pathname}`, { method: 'POST', body: JSON.stringify({ content: '/totp reset 123456' }) }), pathname, chat, 'default');
  expect(response.status).toBe(201);
  expect(dispatch).toEqual([expect.objectContaining({ type: 'totp', action: 'reset', code: '123456' })]);
  expect(await response.text()).not.toContain('123456');
  expect(JSON.stringify(broadcasts)).not.toContain('123456');
  expect(getDb().query("SELECT content FROM messages WHERE chat_jid = ? AND content LIKE '/totp reset%'").all(chat)).toEqual([{content: '/totp reset'}]);
});
