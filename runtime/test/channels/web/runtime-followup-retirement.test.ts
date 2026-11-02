import { afterEach, expect, test } from 'bun:test';
import { createWebChannelTestFixture } from './helpers/web-channel-fixture.js';
import { createWebChannelRuntimePublicSurfaceService } from '../../../src/channels/web/core/web-channel-runtime-public-surface-service.js';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });

test('the channel constructs its original owners without a runtime-followup facade', async () => {
  const fixture = await createWebChannelTestFixture({ workspace: 'temp' }); cleanup = fixture.cleanup;
  expect('runtimeFollowupFacade' in fixture.channel).toBe(false);
  expect(await Bun.file(new URL('../../../src/channels/web/runtime/runtime-followup-facade-service.ts', import.meta.url)).exists()).toBe(false);
});

test('public methods retain owner receivers, dynamic writer/queue replacement and exact admission promise/arguments', async () => {
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
  const signal = new AbortController().signal, authorise = () => {}, accept = () => {};
  const args = ['web:owners', 0, 'queued'] as const;
  const result = Promise.resolve(-2);
  const queue = { getQueuedFollowupCount(chat: string) { expect(this).toBe(queue); expect(chat).toBe('web:owners'); return 2; },
    admitQueuedFollowupItem(...actual: unknown[]) {
      expect(this).toBe(queue); expect(actual[0]).toBe(args); expect(actual[1]).toBe(authorise);
      expect(actual[2]).toBe(signal); expect(actual[3]).toBe(accept); return result;
    } };
  channel.queuedFollowupLifecycle = queue;
  await channel.sendMessage('web:owners', 'reply', { threadId: 7 });
  expect(channel.getAgentStatus('web:owners')).toBe(status);
  expect(channel.getQueuedFollowupCount('web:owners')).toBe(2);
  expect(channel.admitQueuedFollowupItem(args, authorise, signal, accept)).toBe(result);
  expect(await result).toBe(-2); expect(calls).toEqual(['writer']);
});

test('the public surface calls owners directly and never consults the retired facade', async () => {
  let sends = 0;
  const writer = { async sendMessage() { expect(this).toBe(writer); sends++; } };
  const service = createWebChannelRuntimePublicSurfaceService({
    get runtimeFollowupFacade() { throw Error('retired forwarding layer'); },
    messageWriteService: writer, queuedFollowupLifecycle: {}, runtimeState: {},
  } as any);
  await service.sendMessage('web:owners', 'reply');
  expect(sends).toBe(1);
});
