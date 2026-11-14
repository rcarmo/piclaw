import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { AgentPool } from '../../src/agent-pool.js';
import { AgentSessionManager } from '../../src/agent-pool/session-manager.js';
import '../helpers.js';

test('no caller-less legacy session binder remains on the host API or in the shipped source', () => {
  expect(AgentPool.prototype).not.toHaveProperty('setSessionBinder');
  expect(existsSync(new URL('../../src/agent-pool/session-binder.ts', import.meta.url))).toBe(false);
});

test('offline capture retains lifecycle accounting without a second prewarm scheduler', async () => {
  const manager = new AgentSessionManager({ pool: new Map(), modelRuntime: {} as any, settingsManager: {} as any });
  try {
    for (const name of ['prewarm', 'cancelPrewarm', 'prewarmInFlight', 'queuedPrewarms', 'prewarmQueue', 'prewarmCooldownByChat', 'prewarmLoopActive'])
      expect(manager).not.toHaveProperty(name);
    expect(manager.getInstrumentationSnapshot()).toEqual({
      branchSeedRealizationsInFlight: 0, createInFlight: 0, evictionProtectedChats: 0, invalidDeferredSeedErrors: 0,
    });
    expect(manager.hasActiveMemoryReclamationWork()).toBe(false);
    expect(() => manager.assertLegacyCaptureIdle()).not.toThrow();
  } finally { await manager.shutdown(); }
});
