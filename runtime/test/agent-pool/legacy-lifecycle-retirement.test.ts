import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { AgentPool } from '../../src/agent-pool.js';
import '../helpers.js';

test('no caller-less legacy session binder remains on the host API or in the shipped source', () => {
  expect(AgentPool.prototype).not.toHaveProperty('setSessionBinder');
  expect(existsSync(new URL('../../src/agent-pool/session-binder.ts', import.meta.url))).toBe(false);
});

test('resident legacy creation, deferred replay and file persistence owners are absent from shipped source',()=>{
  for(const name of ['session-manager','branch-seeding','adopted-session-import','session-file-persistence'])
    expect(existsSync(new URL(`../../src/agent-pool/${name}.ts`,import.meta.url))).toBe(false);
  expect(existsSync(new URL('../../src/db/migration-input-holds.ts',import.meta.url))).toBe(false);
});
