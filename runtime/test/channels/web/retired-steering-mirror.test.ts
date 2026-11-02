import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebChannel } from '../../../src/channels/web.js';
import { WebChannelRuntimeStateService } from '../../../src/channels/web/runtime/runtime-state-service.js';
import { WebChannelRuntimePublicSurfaceService } from '../../../src/channels/web/core/web-channel-runtime-public-surface-service.js';

test('unconsumed timestamp mirror and every private forwarding stage are retired', () => {
  expect(existsSync(resolve(import.meta.dir, '../../../src/channels/web/runtime/pending-steering.ts'))).toBe(false);
  for (const owner of [WebChannel, WebChannelRuntimeStateService, WebChannelRuntimePublicSurfaceService]) {
    expect('queuePendingSteering' in owner.prototype).toBe(false);
    expect('consumePendingSteering' in owner.prototype).toBe(false);
  }
});
