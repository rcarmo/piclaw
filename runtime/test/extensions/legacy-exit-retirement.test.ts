import '../helpers.js';
import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { getDefaultActiveToolNames } from '../../src/extensions/tool-activation.js';

test('native process control has no second legacy executor or restart-replay declaration', () => {
  expect(existsSync(new URL('../../src/extensions/exit-process.ts', import.meta.url))).toBe(false);
  const factories = readFileSync(new URL('../../src/extensions/index.ts', import.meta.url), 'utf8');
  expect(factories).not.toContain('exitProcess');
  for (const platform of ['linux', 'win32'] as const) expect(getDefaultActiveToolNames(platform)).toContain('exit_process');
  const manifest = readFileSync(new URL('../../src/service-effects/tool-preparation/manifest.ts', import.meta.url), 'utf8');
  expect(manifest).not.toContain('src/extensions/exit-process.ts');
  const capture = readFileSync(new URL('../../src/agent-pool/legacy-authority-capture.ts', import.meta.url), 'utf8');
  expect(capture).not.toContain('tool-preparation');
  expect(capture).not.toContain('createBuiltinExtensionFactories');
});
