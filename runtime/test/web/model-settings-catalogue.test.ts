import { expect, test } from 'bun:test';

import { normaliseModelCatalogue } from '../../web/src/ui/model-catalogue.ts';
import {
  MODEL_SETTINGS_RENDER_LIMIT,
  buildModelSettingsProjection,
  collectModelSettingsFacets,
  moveModelSettingsActiveKey,
} from '../../web/src/ui/model-settings-catalogue.ts';

function catalogue(count = 405) {
  return normaliseModelCatalogue({
    current: 'openrouter/google/model-404',
    model_options: Array.from({ length: count }, (_, index) => ({
      provider: index % 3 === 0 ? 'github-copilot' : 'openrouter',
      id: index % 3 === 0 ? `gpt/model-${index}` : `${index % 2 ? 'anthropic' : 'google'}/model-${index}${index % 7 === 0 ? ':free' : ''}`,
      name: `Model ${index}`,
      context_window: 200_000 + index,
      reasoning: index % 2 === 0,
      pricing: { input_per_million: index / 10, output_per_million: index / 5 },
    })),
  });
}

test('Settings projection bounds 405 models and keeps a matching selected row addressable', () => {
  const entries = catalogue();
  const selectedKey = entries[404].key;
  const projection = buildModelSettingsProjection(entries, {}, selectedKey);
  expect(projection.totalMatches).toBe(405);
  expect(projection.renderedEntries).toHaveLength(MODEL_SETTINGS_RENDER_LIMIT);
  expect(projection.renderedEntries.some((entry) => entry.key === selectedKey)).toBe(true);
  expect(projection.hiddenCount).toBe(305);
  expect(projection.groups.map((group) => group.provider)).toEqual(['github-copilot', 'openrouter']);
  const publishers = projection.groups.find((group) => group.provider === 'openrouter')?.publisherGroups.map((group) => group.publisher) ?? [];
  expect(publishers).toEqual([...publishers].sort());
  expect(publishers).toContain('google');
});

test('Settings projection retains distinct selected and current rows inside the cap', () => {
  const entries = catalogue();
  const selectedKey = entries.find((entry) => entry.key.endsWith('model-403'))?.key;
  const projection = buildModelSettingsProjection(entries, { sort: 'name' }, selectedKey);
  expect(projection.renderedEntries).toHaveLength(MODEL_SETTINGS_RENDER_LIMIT);
  expect(projection.renderedEntries.some((entry) => entry.current)).toBe(true);
  expect(projection.renderedEntries.some((entry) => entry.key === selectedKey)).toBe(true);
});

test('Settings projection uses shared filters, ranking and facets', () => {
  const entries = catalogue(40);
  const projection = buildModelSettingsProjection(entries, {
    providers: 'openrouter',
    publishers: 'anthropic',
    reasoning: false,
    variants: 'stable',
    sort: 'output-price',
  });
  expect(projection.renderedEntries.length).toBeGreaterThan(0);
  expect(projection.renderedEntries.every((entry) => entry.provider === 'openrouter' && entry.publisher === 'anthropic' && !entry.reasoning && !entry.variants.includes('free'))).toBe(true);
  const facets = collectModelSettingsFacets(entries);
  expect(facets.providers).toEqual(['github-copilot', 'openrouter']);
  expect(facets.publishers).toEqual(['anthropic', 'google', 'gpt']);
  expect(facets.variants).toContain('stable');
  expect(facets.variants).toContain('free');
});

test('Settings detail never exposes actions for a model hidden by filters', () => {
  const entries = catalogue(20);
  const selectedKey = entries[0].key;
  const filtered = buildModelSettingsProjection(entries, { query: entries[1].key }, selectedKey);
  expect(filtered.selectedEntry?.key).toBe(entries[1].key);
  const empty = buildModelSettingsProjection(entries, { query: 'no-such-model' }, selectedKey);
  expect(empty.selectedEntry).toBeNull();
  expect(empty.totalMatches).toBe(0);
});

test('Settings list navigation has one active key and supports paging', () => {
  const entries = catalogue(20);
  expect(moveModelSettingsActiveKey(entries, null, 'next')).toBe(entries[0].key);
  expect(moveModelSettingsActiveKey(entries, entries[0].key, 'page-next', 8)).toBe(entries[8].key);
  expect(moveModelSettingsActiveKey(entries, entries[8].key, 'page-previous', 8)).toBe(entries[0].key);
  expect(moveModelSettingsActiveKey(entries, entries[0].key, 'last')).toBe(entries.at(-1)?.key);
});
