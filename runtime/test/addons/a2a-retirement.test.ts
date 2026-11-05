import '../helpers.js';
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { AgentPool } from '../../src/agent-pool.js';
import { installAddonRuntimeApi } from '../../src/addons/runtime-contributions.js';
const root = resolve(import.meta.dir, '../../..');

test('A2A-only Core service/config/session/dispatch owners are deleted rather than disabled', () => {
  for (const file of ['runtime/src/addons/operation-contracts.ts', 'runtime/src/addons/operation-host.ts', 'runtime/src/addons/operation-service.ts',
    'runtime/src/core/config-operations.ts', 'runtime/src/db/addon-operations.ts', 'runtime/src/agent-pool/operation-session-profile.ts',
    'runtime/durable-engine/src/host-addon-background.ts', 'docs/addon-operations.md', 'docs/addon-operations-validation.md'])
    expect(existsSync(resolve(root, file)), file).toBe(false);
  for (const method of ['prepareAddonOperation', 'dispatchAddonOperation', 'reconcileAddonOperation']) expect(AgentPool.prototype).not.toHaveProperty(method);
  expect(typeof AgentPool.prototype.dispatchDreamOperation).toBe('function');
  expect(existsSync(resolve(root, 'runtime/src/db/addon-operations-schema.ts'))).toBe(true);
});

test('runtime registration has no operations compatibility API and retains shared messaging/transport lifecycles', () => {
  const api = installAddonRuntimeApi();
  expect(api).not.toHaveProperty('operations');
  expect(api.externalRoutes.version).toBe(1); expect(api.authenticatedSockets.version).toBe(1); expect(api.messaging.version).toBe(1);
  expect(typeof api.lifecycle.onShutdown).toBe('function'); expect(typeof api.messaging.registerChatTransport).toBe('function');
  expect(typeof api.enqueueAgentMessage).toBe('function'); expect(typeof api.localContext.getToolContext).toBe('function');
});

test('Core catalogue no longer advertises A2A and its integrity receipt matches without a bundled A2A package', () => {
  const bytes = readFileSync(resolve(root, 'release/core-addons/catalog.json'));
  const catalogue = JSON.parse(bytes.toString()), lock = JSON.parse(readFileSync(resolve(root, 'release/core-addons.lock.json'), 'utf8'));
  expect(catalogue.addons.some((addon: any) => addon.slug === 'a2a' || addon.name === '@rcarmo/piclaw-addon-a2a')).toBe(false);
  expect(lock.addons.some((addon: any) => addon.slug === 'a2a')).toBe(false);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(lock.catalogSha256);
});
