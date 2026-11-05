import { afterEach, expect, test } from 'bun:test';
import { createWebChannelTestFixture } from './helpers/web-channel-fixture.js';

import { WebChannel } from '../../../src/channels/web.js';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });

test('the channel constructs its original owners without a runtime-followup facade', async () => {
  const fixture = await createWebChannelTestFixture({ workspace: 'temp' }); cleanup = fixture.cleanup;
  expect('runtimeFollowupFacade' in fixture.channel).toBe(false);
  expect(await Bun.file(new URL('../../../src/channels/web/runtime/runtime-followup-facade-service.ts', import.meta.url)).exists()).toBe(false);
});

test('public methods retain owner receivers, dynamic writer replacement without the removed queue owner', async () => {
  const fixture = await createWebChannelTestFixture({ workspace: 'temp' }); cleanup = fixture.cleanup;
  const channel = fixture.channel as any;
  const state = channel.runtimeState;
  const status = { type: 'intent', title: 'original owner' };
  state.getAgentStatus = function(chat: string) { expect(this).toBe(state); expect(chat).toBe('web:owners'); return status; };
  // Runtime state was captured at construction; replacing a private field must not redirect it.
  channel.runtimeState = new Proxy({}, { get() { throw Error('replacement runtime owner'); } });
  const calls: string[] = [];
  const writer = { async sendMessage(chat: string, text: string, options: unknown) {
    expect(this).toBe(writer); expect([chat, text, options]).toEqual(['web:owners', 'reply', { threadId: 7 }]); calls.push('writer');
  } };
  channel.messageWriteService = writer;
  await channel.sendMessage('web:owners', 'reply', { threadId: 7 });
  expect(channel.getAgentStatus('web:owners')).toBe(status);
  for (const name of ['getQueuedFollowupCount', 'admitQueuedFollowupItem', 'queuedFollowupLifecycle']) expect(channel).not.toHaveProperty(name);
  expect(calls).toEqual(['writer']);
});

test('the public surface calls owners directly and never consults the retired facade', async () => {
  let sends = 0;
  const writer = { async sendMessage() { expect(this).toBe(writer); sends++; } };
  const service = Object.assign(Object.create(WebChannel.prototype), {
    messageWriteService: writer, runtimeState: {},
  } as any);
  Object.defineProperty(service, 'runtimeFollowupFacade', { get() { throw Error('retired forwarding layer'); } });
  await service.sendMessage('web:owners', 'reply');
  expect(sends).toBe(1);
});
