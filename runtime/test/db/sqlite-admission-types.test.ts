import { expect, test } from 'bun:test';
import { join } from 'node:path';

test('SQL admission callback types reject async work without narrowing SDK async scopes', () => {
  const root = join(import.meta.dir, '../../..');
  // This fixture is outside runtime/tsconfig's source-only include list.
  // Match the production Bun/SDK target and explicit TypeScript imports; keep
  // every negative async-admission assertion active.
  const result = Bun.spawnSync([process.execPath, join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--allowImportingTsExtensions', '--target', 'esnext', '--module', 'esnext',
    '--moduleResolution', 'bundler', '--types', 'bun-types',
    join(import.meta.dir, 'sqlite-admission-types.fixture.ts'),
    join(import.meta.dir, 'sqlite-async-admission.test.ts'),
    join(import.meta.dir, 'extension-kv-admission.test.ts')],
  { cwd: root, stdout: 'pipe', stderr: 'pipe', timeout: 30_000, killSignal: 'SIGKILL' });
  expect(result.stdout.toString() + result.stderr.toString()).toBe('');
  expect(result.signalCode).toBeUndefined();
  expect(result.exitCode).toBe(0);
}, 35_000);
