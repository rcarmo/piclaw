import { expect, test } from 'bun:test';

const manifest = await Bun.file(new URL('../../../package.json', import.meta.url)).json();

test('canonical host CI isolates file globals and leaked handles without weakening its census', () => {
  const command = manifest.scripts['ci:fast:tests'];
  expect(command).toContain('bun test --isolate --max-concurrency=1');
  for (const pattern of ['**/features/**', '**/scripts/**', '**/*.optional.test.ts']) {
    expect(command).toContain(`--path-ignore-patterns='${pattern}'`);
  }
});
