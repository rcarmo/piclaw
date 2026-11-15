import { expect, test } from 'bun:test';
import { buildModelCandidates, classifyModel, normalizeConfig, type AvailableModel } from '../../src/delegate/policy.js';

const model = (provider: string, id: string, metadata: Partial<AvailableModel> = {}): AvailableModel => ({
  provider, id, fullId: `${provider}/${id}`, ...metadata,
});
const models = [
  model('github-copilot', 'mai-code-1.1-flash', { supportsImages: true, reasoning: false, contextWindow: 100000, maxOutputTokens: 8192 }),
  model('anthropic', 'claude-opus-5.5'),
  model('openai', 'gpt-5.4-mini'),
  model('github-copilot', 'gpt-6.1-sol'),
  model('github-copilot', 'gpt-6.1-sol-unknown'),
  model('azure-private', 'gpt-5.4-mini'),
];

test('Core Delegate approves no providers by default', () => {
  expect(buildModelCandidates(models)).toEqual([]);
  expect(buildModelCandidates(models, { searchable_providers: [], excluded_providers: [], excluded_models: [] })).toEqual([]);
});

test('normalisation preserves explicit empty exclusions and removes denied provider approvals', () => {
  expect(normalizeConfig({ searchable_providers: ['openai', 'openai', 'anthropic'], excluded_providers: ['anthropic'], excluded_models: [' MINI ', ' MINI '] }))
    .toEqual({ searchable_providers: ['openai'], excluded_providers: ['anthropic'], excluded_models: ['MINI'] });
  expect(normalizeConfig(null)).toEqual({ searchable_providers: null, excluded_providers: null, excluded_models: [] });
});

for (const [id, tier, rule] of [
  ['gpt-5.4-codex-mini', 2, 'gpt-codex-mini'],
  ['gpt-5.4-codex-spark', 4, 'gpt-codex-spark'],
  ['gpt_6.1_sol', 3, 'gpt-6-1-sol'],
  ['openai/gpt-6-astra-pro:batch', 4, 'gpt-6-astra-pro'],
  ['mai-code-1.1-flash', 2, 'mai-code-flash'],
] as const) test(`ordered model classification: ${id}`, () => {
  expect(classifyModel(model('fixture', id))).toMatchObject({ status: 'classified', tier, rule, confidence: 'exact-policy' });
});

for (const id of ['gpt-6.1-sol-unknown', 'gpt-6-unannounced', 'unknown-model']) test(`unclassified models stay denied: ${id}`, () => {
  expect(classifyModel(model('github-copilot', id))).toMatchObject({ status: 'unclassified', tier: null, rule: null });
  expect(buildModelCandidates([model('github-copilot', id)], { searchable_providers: ['github-copilot'], excluded_providers: [], excluded_models: [] })).toEqual([]);
});

test('approved candidates keep metadata, deduplicate exact IDs and sort deterministically', () => {
  const config = { searchable_providers: ['anthropic', 'github-copilot', 'openai'], excluded_providers: [], excluded_models: [] };
  const input = [...models, { ...models[0]!, supportsImages: false }];
  const before = JSON.stringify({ input, config });
  const candidates = buildModelCandidates(input, config);
  expect(candidates.map(candidate => candidate.id)).toEqual(['openai/gpt-5.4-mini', 'github-copilot/mai-code-1.1-flash', 'github-copilot/gpt-6.1-sol', 'anthropic/claude-opus-5.5']);
  expect(candidates[1]).toMatchObject({ supportsImages: true, reasoning: false, contextWindow: 100000, maxOutputTokens: 8192 });
  expect(candidates[0]).toMatchObject({ supportsImages: null, reasoning: null, contextWindow: null, maxOutputTokens: null });
  expect(JSON.stringify({ input, config })).toBe(before);
});

test('configured provider order breaks same-model ties without changing tier order', () => {
  const same = [model('openai', 'gpt-5.4-mini'), model('github-copilot', 'gpt-5.4-mini')];
  expect(buildModelCandidates(same, { searchable_providers: ['github-copilot', 'openai'], excluded_providers: [], excluded_models: [] }).map(candidate => candidate.provider))
    .toEqual(['github-copilot', 'openai']);
});

test('provider defaults, explicit denials and case-insensitive model patterns remain fail closed', () => {
  const config = { searchable_providers: ['azure-private', 'github-copilot'], excluded_providers: null, excluded_models: ['*MAI*'] };
  expect(buildModelCandidates(models, config).map(candidate => candidate.id)).toEqual(['github-copilot/gpt-6.1-sol']);
  expect(buildModelCandidates(models, { ...config, excluded_providers: [] }).map(candidate => candidate.id)).toEqual(['azure-private/gpt-5.4-mini', 'github-copilot/gpt-6.1-sol']);
  expect(buildModelCandidates(models, { ...config, excluded_providers: ['github-copilot'] })).toEqual(['azure-private/gpt-5.4-mini'].map(id => expect.objectContaining({ id })));
  expect(buildModelCandidates(models, { ...config, excluded_models: ['GPT-6.1', 'mai'] })).toEqual([]);
});
