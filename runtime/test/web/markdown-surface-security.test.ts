import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const WEB_SRC = join(import.meta.dir, '..', '..', 'web', 'src');

const markdownInjectionSurfaces = [
  'components/markdown-preview.ts',
  'components/btw-panel.ts',
];

test('live markdown DOM injection surfaces do not disable markdown sanitization', () => {
  for (const relativePath of markdownInjectionSurfaces) {
    const source = readFileSync(join(WEB_SRC, relativePath), 'utf8');
    expect(source).not.toContain('sanitize: false');
    expect(source).not.toContain('sanitize:false');
  }
});
