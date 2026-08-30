import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const classicSource = readFileSync(join(import.meta.dir, '../../web/src/components/settings/models.ts'), 'utf8');
const classicDialogSource = readFileSync(join(import.meta.dir, '../../web/src/components/settings-dialog.ts'), 'utf8');
const visualSource = readFileSync(join(import.meta.dir, '../../web/static/visual/frontend/src/panels/settings/ModelsSection.tsx'), 'utf8');
const composeSource = readFileSync(join(import.meta.dir, '../../web/src/components/compose-box.ts'), 'utf8');
const visualPickerSource = readFileSync(join(import.meta.dir, '../../web/static/visual/frontend/src/components/model-context-bar/useModelPicker.ts'), 'utf8');
const visualStatusSource = readFileSync(join(import.meta.dir, '../../web/static/visual/frontend/src/components/model-context-bar/useStatusPolling.ts'), 'utf8');
const classicCss = readFileSync(join(import.meta.dir, '../../web/static/classic/css/settings.css'), 'utf8');
const visualCss = readFileSync(join(import.meta.dir, '../../web/static/visual/css/shell.css'), 'utf8');

test('classic and visual Settings use the shared bounded master-detail catalogue', () => {
  for (const source of [classicSource, visualSource]) {
    expect(source).toContain('buildModelSettingsProjection');
    expect(source).toContain('collectModelSettingsFacets');
    expect(source).toContain('model-catalogue-settings__workspace');
    expect(source).toContain('role="listbox"');
    expect(source).toContain('aria-activedescendant');
    expect(source).toContain('Provider diagnostics');
    expect(source).toContain('Cache read / 1M');
    expect(source).toContain('enabledModels');
    expect(source).toContain('scoped_model_filter_active');
    expect(source).toContain('formatModelCataloguePricing');
    expect(source).toContain('model-catalogue-settings__row-mobile-meta');
    expect(source).toContain('model-catalogue-settings__filter-disclosure');
    expect(source).toContain('model-catalogue-settings__filter-toggle');
    expect(source).toContain('filtersExpanded');
    expect(source).toContain('aria-expanded');
    expect(source).toContain('Filters and sorting');
  }
  expect(classicDialogSource).toContain('onFilterChange=${setFilter}');
  expect(classicDialogSource).toContain('aria-label=${sectionPlaceholder(activeMeta)}');
  expect(classicDialogSource).toContain("typeof s.icon === 'string' && s.icon.trim().startsWith('<')");
  expect(visualSource).toContain('aria-label="Search model catalogue"');
});

test('visual Settings scopes model fetches and commands to the active chat', () => {
  expect(visualSource).toContain('/agent/models?chat_jid=${encodeURIComponent(targetChatJid)}');
  expect(visualSource).toContain('/agent/context?chat_jid=${encodeURIComponent(targetChatJid)}');
  expect(visualSource).toContain('/agent/${encodeURIComponent(targetChatJid)}/message?chat_jid=${encodeURIComponent(targetChatJid)}');
  expect(visualSource).not.toContain('const THINKING_LEVELS');
  expect(visualSource).toContain('selected?.thinkingLevels');
});

test('recency is recorded only inside server-confirmed model switch branches', () => {
  expect(composeSource).toContain("if (!refreshed || (expectedModel && confirmedModel !== expectedModel))");
  expect(composeSource).toContain('if (expectedModel) recordRecentModelKey(expectedModel)');
  expect(composeSource).toContain('if (recordsModelRecency && confirmedModel) recordRecentModelKey(confirmedModel)');
  expect(visualPickerSource).toContain('if (confirmedCurrent !== id)');
  expect(visualPickerSource.indexOf('if (confirmedCurrent !== id)')).toBeLessThan(visualPickerSource.indexOf('recordRecentModelKey(id)'));
  for (const source of [classicSource, visualSource]) {
    expect(source).toContain('if (confirmed !== selected.key)');
    expect(source.indexOf('if (confirmed !== selected.key)')).toBeLessThan(source.indexOf('recordRecentModelKey(selected.key)'));
  }
});

test('confirmed Settings switches synchronise badges before context refresh', () => {
  for (const source of [classicSource, visualSource]) {
    const dispatch = source.indexOf("window.dispatchEvent(new CustomEvent('piclaw:model-state-changed'") >= 0
      ? source.indexOf("window.dispatchEvent(new CustomEvent('piclaw:model-state-changed'")
      : source.indexOf('window.dispatchEvent(new CustomEvent("piclaw:model-state-changed"');
    const backgroundRefresh = source.indexOf('void loadModels({ quiet: true })', dispatch);
    expect(dispatch).toBeGreaterThan(-1);
    expect(backgroundRefresh).toBeGreaterThan(dispatch);
  }
  expect(visualStatusSource).toContain('agentStatus.value = {');
  expect(visualStatusSource).toContain('modelContextWindow.value = currentOpt.context_window');
  expect(visualStatusSource).toContain('statusAbort.current?.abort()');
});

test('Settings only scrolls selected rows after explicit keyboard navigation', () => {
  for (const source of [classicSource, visualSource]) {
    expect(source).toContain('requestAnimationFrame');
    expect(source.indexOf('requestAnimationFrame')).toBeGreaterThan(source.indexOf('const handleListKeyDown'));
  }
});

test('Settings treats command-level model, thinking and compaction failures as errors', () => {
  for (const source of [classicSource, visualSource]) {
    expect(source).toMatch(/status === ["']error["']/);
    expect(source).toContain('Compaction request failed.');
    expect(source).toContain('The server did not confirm the model switch.');
  }
});

test('Models Settings assigns one vertical scroll owner per layout mode', () => {
  expect(classicCss).toContain('.settings-content:has(.model-catalogue-settings)');
  expect(visualCss).toContain('.settings-panel__content:has(.settings-panel__section--models)');
  for (const css of [classicCss, visualCss]) {
    expect(css).toContain('overflow-y: auto');
    expect(css).toContain('overflow: auto');
    expect(css).toContain('overflow: hidden');
    expect(css).toContain('overflow: visible');
    expect(css).toContain('display: block');
    expect(css).toContain('margin-top: 10px');
    expect(css).toContain('position: static');
    expect(css).not.toContain('overflow-x: hidden;\n        overflow-y: visible');
    expect(css).not.toContain('overflow-x: hidden;\n    overflow-y: visible');
  }
});

test('Settings layouts become single-column with 44px controls on phones', () => {
  for (const css of [classicCss, visualCss]) {
    expect(css).toContain('.model-catalogue-settings__workspace');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toContain('min-height: 44px');
    expect(css).toContain('grid-template-columns: 1fr');
    expect(css).toContain('grid-template-columns: 20px minmax(0, 1fr)');
    expect(css).toContain('model-catalogue-settings__row-mobile-meta');
    expect(css).toContain('@container (max-width: 760px)');
    expect(css).toContain('min-width: 610px');
    expect(css).toContain('.model-catalogue-settings__filters:not(.expanded)');
  }
});
