import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildThemeBootstrap } from '../../scripts/theme-bootstrap';

for (const skin of ['classic'] as const) test(`${skin} shipped early theme matches the catalogue generator before CSS`, () => {
  const html = readFileSync(resolve(import.meta.dir, `../../web/static/${skin}/index.html`), 'utf8');
  const source = html.match(/<!-- piclaw-theme-bootstrap-start -->\s*<script>([\s\S]*?)<\/script>\s*<!-- piclaw-theme-bootstrap-end -->/)?.[1];
  expect(source).toBe(buildThemeBootstrap());
  expect(html.indexOf('piclaw-theme-bootstrap-start')).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
  expect(html).not.toContain('var darkPresets =');
  expect(html).toContain('name="apple-mobile-web-app-status-bar-style" content="black-translucent"');
  expect(source).toContain('DOMContentLoaded');
  expect(source).toContain('root.style.background');
});
