import '../helpers.js';
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { TOOLSETS } from '../../src/extensions/tool-capabilities.js';

test('native process control has no second legacy executor or restart-replay declaration', () => {
  expect(existsSync(new URL('../../src/extensions/exit-process.ts', import.meta.url))).toBe(false);
  const factories = readFileSync(new URL('../../src/extensions/index.ts', import.meta.url), 'utf8');
  expect(factories).not.toContain('exitProcess');
  expect(TOOLSETS.find(group=>group.name==='lifecycle')?.toolNames).toContain('exit_process');
  const manifest = readFileSync(new URL('../../src/service-effects/tool-preparation/manifest.ts', import.meta.url), 'utf8');
  expect(manifest).not.toContain('src/extensions/exit-process.ts');
  expect(existsSync(new URL('../../src/agent-pool/legacy-authority-capture.ts', import.meta.url))).toBe(false);
  const bootstrap = readFileSync(new URL('../../src/runtime/bootstrap.ts', import.meta.url), 'utf8');
  expect(bootstrap).not.toContain('prepareLegacyMigration');
});
