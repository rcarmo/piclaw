import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { createBuiltinExtensionFactories } from '../../src/extensions/index.js';
import { TOOLSETS } from '../../src/extensions/tool-activation.js';
import { createFakeExtensionApi } from './fake-extension-api.js';

test('retired legacy SQL execution has no built-in registration, data toolset entry or packaged source', () => {
  const fake = createFakeExtensionApi({ allTools: [] });
  for (const factory of createBuiltinExtensionFactories()) factory(fake.api);
  expect(fake.tools.has('introspect_sql')).toBe(false);
  expect(TOOLSETS.find(set => set.name === 'data')!.toolNames).not.toContain('introspect_sql');
  expect(fake.tools.has('messages')).toBe(true);
  expect(existsSync(new URL('../../src/extensions/sql-introspect.ts', import.meta.url))).toBe(false);
});
