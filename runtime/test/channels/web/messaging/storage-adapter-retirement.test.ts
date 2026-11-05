import '../../../helpers.js';
import { afterEach, expect, spyOn, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { WebChannel } from '../../../../src/channels/web.js';
import * as messages from '../../../../src/channels/web/messaging/message-store.js';
import * as recordings from '../../../../src/session-recordings/session-recordings.js';
import { IDENTITY_CONFIG } from '../../../../src/core/config-identity.js';
import { createWebChannelTestFixture } from '../helpers/web-channel-fixture.js';

const restores: (() => void)[] = [];
afterEach(() => { for (const restore of restores.splice(0).reverse()) restore(); });
async function fixture() {
  const f = await createWebChannelTestFixture({ workspace: 'temp', prefix: 'storage-adapter-retirement-' });
  restores.push(f.cleanup);
  return f;
}

test('golden: admission captures live identity, exact callback, options and signal before waiting; recording cannot revoke commit', async () => {
  const f = await fixture(), identity = { ...IDENTITY_CONFIG };
  restores.push(() => Object.assign(IDENTITY_CONFIG, identity));
  Object.assign(IDENTITY_CONFIG, { assistantName: 'First Assistant', userName: 'First Operator' });
  const held = Promise.withResolvers<null>(), calls: any[][] = [], recorded: unknown[] = [];
  const authority = () => {}, signal = new AbortController().signal, defer = () => false;
  const source = () => {};
  f.channel.getInputSourceAdmission = () => source;
  const row = { id: 33, chat_jid: 'web:identity', timestamp: '2026-01-01', data: { type: 'user_message', content: 'hello' } } as any;
  const admit = spyOn(messages, 'admitWebMessage').mockImplementation(async (...args) => { calls.push(args); await held.promise; return row; });
  const record = spyOn(recordings, 'recordTimelineInteraction').mockImplementation(value => { recorded.push(value); throw Error('optional recorder unavailable'); });
  restores.push(() => admit.mockRestore(), () => record.mockRestore());
  const options = { acceptSource: source, threadId: 55, contentBlocks: [{ type: 'text', text: 'kept' }] };
  const pending = f.channel.admitMessage('web:identity', 'hello', false, [4], options, authority, signal, defer);
  Object.assign(IDENTITY_CONFIG, { assistantName: 'Second Assistant', userName: 'Second Operator' });
  f.channel.getInputSourceAdmission = () => { throw Error('replacement source was read'); };
  held.resolve(null);
  expect(await pending).toBe(row);
  expect(recorded).toEqual([row]);
  expect(calls[0][0]).toBe(f.channel);
  expect(calls[0][1]).toEqual({ chatJid: 'web:identity', content: 'hello', isBot: false, mediaIds: [4], agentId: 'default', agentName: 'First Assistant', userName: 'First Operator' });
  expect(calls[0][2]).toEqual(options);
  expect(calls[0][3]).toBe(authority); expect(calls[0][4]).toBe(signal); expect(calls[0][5]).toBe(defer);
  await f.channel.admitMessage('web:identity', 'bot reply', true, [], {});
  expect(calls[1][1]).toMatchObject({ agentName: 'Second Assistant', userName: 'Second Operator', isBot: true });
  expect(calls[1][2]).toEqual({});
});

test('storage adapter module, instance and constructor-factory port are absent', async () => {
  const f = await fixture();
  expect(f.channel).not.toHaveProperty('messageProcessingStorageService');
  expect(existsSync(new URL('../../../../src/channels/web/messaging/message-processing-storage-service.ts', import.meta.url))).toBe(false);
  const source = await Bun.file(new URL('../../../../src/channels/web/core/web-channel-constructor-factory.ts', import.meta.url)).text();
  expect(source).not.toContain('createMessageProcessingStorageService');
});
