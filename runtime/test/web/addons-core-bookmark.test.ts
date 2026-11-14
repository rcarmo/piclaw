import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const runtimeRoot = join(import.meta.dir, '../..');
const source = readFileSync(join(runtimeRoot, 'web/src/components/settings/addons.ts'), 'utf8');
const classicCss = readFileSync(join(runtimeRoot, 'web/static/classic/css/settings.css'), 'utf8');

function cssRuleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || '';
}

test('Add-Ons settings detects core tags and renders an accessible compact bookmark', () => {
  expect(source).toContain("const isCore = (a.tags || []).some(tag => String(tag).toLowerCase() === 'core')");
  expect(source).toContain("${isCore ? ' core' : ''}");
  expect(source).toContain('class="settings-addon-core-bookmark" role="img" aria-label="Core add-on"');
  expect(source).toContain('title="Core add-on — recommended for most Piclaw installations"');
  expect(source).toContain('<svg viewBox="0 0 28 38" width="28" height="38" aria-hidden="true" focusable="false">');
  expect(source).toContain('class="settings-addon-core-bookmark-highlight"');
});

for (const [theme, css] of [['classic', classicCss]] as const) {
  test(`${theme} settings stylesheet reserves compact bookmark space`, () => {
    const card = cssRuleBody(css, '.settings-addon-card');
    const coreHeader = cssRuleBody(css, '.settings-addon-card.core .settings-addon-card-header');
    const coreActions = cssRuleBody(css, '.settings-addon-card.core .settings-addon-actions');
    const bookmark = cssRuleBody(css, '.settings-addon-core-bookmark');
    const svg = cssRuleBody(css, '.settings-addon-core-bookmark svg');

    expect(card).toContain('position: relative;');
    expect(coreHeader).toContain('padding-right: 36px;');
    expect(coreActions).toContain('right: 50px;');
    expect(bookmark).toContain('position: absolute;');
    expect(bookmark).toContain('top: -1px;');
    expect(bookmark).toContain('right: 10px;');
    expect(bookmark).toContain('width: 28px;');
    expect(bookmark).toContain('height: 38px;');
    expect(bookmark).toContain('cursor: help;');
    expect(svg).toContain('width: 28px;');
    expect(svg).toContain('height: 38px;');
  });
}
