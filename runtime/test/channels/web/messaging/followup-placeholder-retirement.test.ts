import { afterEach, expect, test } from 'bun:test';
import { WebChannel } from '../../../../src/channels/web.js';
import * as writes from '../../../../src/channels/web/message-write-service.js';
import { createTempWorkspace, setEnv } from '../../../helpers.js';

let cleanup: (() => void) | undefined;
afterEach(() => { cleanup?.(); cleanup = undefined; });

test('only the SDK owns follow-ups; obsolete placeholder producer/consumer APIs are absent', () => {
  for (const name of ['queueFollowupPlaceholder', 'replaceQueuedFollowupPlaceholder', 'consumeQueuedFollowupPlaceholder']) {
    expect(name in WebChannel.prototype).toBe(false);
  }
  expect(WebChannel.prototype).not.toHaveProperty('getQueuedFollowupCount');
});

test('outgoing writes have no parallel context factory or placeholder/helper modules', async () => {
  expect('createMessageWriteContext' in writes).toBe(false);
  for (const name of ['messaging/message-write-flows.ts', 'runtime/followup-placeholders.ts']) {
    expect(await Bun.file(new URL(`../../../../src/channels/web/${name}`, import.meta.url)).exists()).toBe(false);
  }
});
