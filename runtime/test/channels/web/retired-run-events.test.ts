import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const runtime = resolve(import.meta.dir, '../../..');

test('retired AgentSession SSE adapter, timer, publisher and opaque classifier are absent from production', () => {
  for (const path of ['channels/web/sse/agent-events.ts', 'channels/web/sse/display-update-coalescer.ts', 'channels/web/messaging/agent-message-store.ts', 'agent-pool/recovery-classification.ts']) {
    expect(existsSync(resolve(runtime, 'src', path)), path).toBe(false);
  }
});

test('native watch projection and committed terminal publication retain their existing owners', () => {
  const factory = readFileSync(resolve(runtime, 'durable-engine/src/default-application-runtime.ts'), 'utf8');
  expect(factory).toMatch(/createNativeTurnView\(root,\s*\{/);
  expect(factory).toContain('publishInput(sourceId)');
  expect(factory).toContain('terminalBroadcast("new_post", interaction');
  expect(factory).not.toContain('createStreamingEventHandler');
  expect(existsSync(resolve(runtime, 'src/channels/web/agent/native-turn-view.ts'))).toBe(true);
  expect(existsSync(resolve(runtime, 'src/channels/web/messaging/message-store.ts'))).toBe(true);
  expect(existsSync(resolve(runtime, 'src/channels/web/push/web-push-service.ts'))).toBe(true);
});
