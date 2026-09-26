import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paletteVariables, themeContrast } from '../../web/src/ui/theme-palette';
import { WEB_THEME_PRESETS } from '../../src/core/ui-theme-catalogue';
const root = join(import.meta.dir, '../..');
const read = (path:string) => readFileSync(join(root,path),'utf8');

test('editor and baseline use one live CSS-variable theme without vendor selection overrides', () => {
  const source=read('extensions/viewers/editor/editor-extension.ts');
  expect(source).not.toContain('githubDark');
  expect(source).not.toContain('githubLight');
  expect(source).not.toContain('hexToRgb');
  expect(source).toContain('this.themeCompartment.of(editorTheme(isDark))');
  expect(source).toContain('this.baselineThemeCompartment.of(editorTheme(isDark))');
  expect(source).toContain("class: 'cm-markdown-preview'");
  const theme=read('extensions/viewers/editor/theme.ts');
  for(const role of ['--text-code','--bg-code','--selection-background','--search-highlight-color','--accent-color','--text-secondary'])expect(theme).toContain(role);
  for(const skin of ['classic','visual']) {
    expect(read(`web/static/${skin}/css/styles.css`)).toContain('../../common/css/editor-theme.css');
    expect(read(`web/static/${skin}/css/editor.css`)).not.toMatch(/\.tok-keyword\s*\{/);
  }
});

test('preview semantic colours use shared roles instead of fixed palettes', () => {
  const theme=read('extensions/viewers/editor/markdown/theme.ts');
  expect(theme).not.toContain('.cm-md-code-content .tok-keyword');
  expect(theme).not.toContain('rgba(255, 255, 255');
  expect(theme).not.toContain('rgba(29, 155, 240');
  for(const role of ['--bg-code','--text-code','--warning-color','--success-color','--danger-color','--accent-soft'])expect(theme).toContain(role);
  const quotes=read('extensions/viewers/editor/markdown/blockquote.ts');
  expect(quotes).toContain("warning: 'var(--warning-color)'");
  expect(quotes).toContain("success: 'var(--success-color)'");
});

test('selection stays visible and keeps plain-text contrast across every authored palette', () => {
  for (const preset of WEB_THEME_PRESETS) for (const mode of ['light','dark'] as const) {
    const palette=preset[mode];if(!palette)continue;
    const vars=paletteVariables(palette,mode);
    const channels=vars['--selection-background'].match(/[\d.]+/g)!.map(Number);
    const alpha=channels[3];expect(alpha,`${preset.id}/${mode} selection visible`).toBeGreaterThanOrEqual(.1);
    const bg=vars['--bg-primary'].slice(1).match(/../g)!.map(x=>parseInt(x,16));
    const composite='#'+bg.map((c,i)=>Math.round(c*(1-alpha)+channels[i]*alpha).toString(16).padStart(2,'0')).join('');
    expect(themeContrast(vars['--text-primary'],composite),`${preset.id}/${mode} selected prose`).toBeGreaterThanOrEqual(4.5);
  }
});
