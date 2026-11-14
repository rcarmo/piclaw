import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { handleShellRoutes } from '../../src/channels/web/http/dispatch-shell.js';
const root = resolve(import.meta.dir, '../../..');
test('the only shipped web shell is Classic, including stale Visual selection', async () => {
  let served = '';
  const channel = { serveStatic: async (path: string) => { served = path; return new Response('classic'); } };
  await handleShellRoutes(channel as any, new Request('http://localhost/'), '/', { isIndex: true } as any, async () => new Response());
  expect(served).toBe('classic/index.html');
  expect(existsSync(resolve(root, 'runtime/web/static', 'visual'))).toBe(false);
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  expect(pkg.scripts).not.toHaveProperty('build:web:visual');
  expect(readFileSync(resolve(root, 'Makefile'), 'utf8')).not.toContain('build:web:visual');
});
