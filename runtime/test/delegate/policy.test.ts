import { expect, test } from 'bun:test';
import { buildModelCandidates, classifyModel, migrateLegacyDelegateConfig, normalizeConfig, type AvailableModel } from '../../src/delegate/policy.js';

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

const migrate = (catalogue: AvailableModel[], legacy: unknown) => buildModelCandidates(catalogue, migrateLegacyDelegateConfig(catalogue, legacy));

test('Core Delegate approves no models by default', () => {
  expect(buildModelCandidates(models)).toEqual([]);
  expect(buildModelCandidates(models, { approved_models: [] })).toEqual([]);
});

test('only exact available persisted IDs can be selected', () => {
  const config = normalizeConfig({ approved_models: ['github-copilot/gpt-6.1-sol', 'github-copilot/gpt-6.1-sol', 'bad', 'openrouter/openai/gpt-6.1-sol'] });
  expect(config.approved_models).toEqual(['github-copilot/gpt-6.1-sol', 'openrouter/openai/gpt-6.1-sol']);
  expect(buildModelCandidates(models, config).map(model => model.id)).toEqual(['github-copilot/gpt-6.1-sol']);
  expect(buildModelCandidates(models, { approved_models:['github-copilot/*', 'github-copilot/GPT-6.1-SOL'] })).toEqual([]);
  expect(normalizeConfig(null)).toEqual({ approved_models: [] });
  expect(migrateLegacyDelegateConfig(models, { ...config, searchable_providers: ['openai'] })).toBeUndefined();
  expect(migrateLegacyDelegateConfig(models, null)).toBeUndefined();
});

test('legacy migration freezes the eligible set and respects existing denials', () => {
  const frozen = migrateLegacyDelegateConfig(models, { searchable_providers:['github-copilot','azure-private'], excluded_models:['*MAI*'] });
  expect(frozen?.approved_models).toEqual(['github-copilot/gpt-6.1-sol']);
  expect(buildModelCandidates([...models, model('github-copilot','gpt-5.4-mini')], frozen).map(model => model.id)).toEqual(frozen?.approved_models ?? []);
  expect(buildModelCandidates([], frozen)).toEqual([]);
});

for (const [id, tier, rule] of [
  ['gpt-5.4-codex-mini', 2, 'gpt-codex-mini'],
  ['gpt-5.4-codex-spark', 4, 'gpt-codex-spark'],
  ['gpt_6.1_sol', 3, 'gpt-6-1-sol'],
  ['openai/gpt-6-astra-pro:batch', 4, 'gpt-6-astra-pro'],
  ['mai-code-1.1-flash', 2, 'mai-code-flash'],
  ['mai-code-2-flash', 2, 'mai-code-flash'],
  ['mai-code-2', 3, 'mai-code-2'],
  ['MAI.Code_2', 3, 'mai-code-2'],
] as const) test(`ordered model classification: ${id}`, () => {
  expect(classifyModel(model('fixture', id))).toMatchObject({ status: 'classified', tier, rule, confidence: 'exact-policy' });
});

test('unmatched available models get the default rank and still need exact approval', () => {
  const sol = model('github-copilot', 'gpt-6.1-sol');
  const terra = model('github-copilot', 'gpt-6.1-terra');
  const router = model('openrouter', 'openai/gpt-6.1-terra-pro:batch');
  const catalogue = [router, terra, sol];
  for (const candidate of [terra, router]) {
    expect(classifyModel(candidate)).toMatchObject({ status: 'default', tier: 3, rule: 'default', confidence: 'default' });
    expect(buildModelCandidates([candidate])).toEqual([]);
    expect(buildModelCandidates([], { approved_models: [candidate.fullId] })).toEqual([]);
  }
  expect(buildModelCandidates(catalogue, { approved_models: [terra.fullId] }).map(candidate => candidate.id)).toEqual([terra.fullId]);
  expect(buildModelCandidates(catalogue, { approved_models: catalogue.map(candidate => candidate.fullId) }).map(candidate => candidate.id))
    .toEqual([sol.fullId, terra.fullId, router.fullId]);
  expect(migrateLegacyDelegateConfig(catalogue, { searchable_providers: ['github-copilot', 'openrouter'] })?.approved_models).toEqual([sol.fullId]);
});

test('approved candidates keep metadata, deduplicate exact IDs and sort deterministically', () => {
  const config = { searchable_providers: ['anthropic', 'github-copilot', 'openai'], excluded_providers: [], excluded_models: [] };
  const input = [...models, { ...models[0]!, supportsImages: false }];
  const before = JSON.stringify({ input, config });
  const candidates = migrate(input, config);
  expect(candidates.map(candidate => candidate.id)).toEqual(['openai/gpt-5.4-mini', 'github-copilot/mai-code-1.1-flash', 'github-copilot/gpt-6.1-sol', 'anthropic/claude-opus-5.5']);
  expect(candidates[1]).toMatchObject({ supportsImages: true, reasoning: false, contextWindow: 100000, maxOutputTokens: 8192 });
  expect(candidates[0]).toMatchObject({ supportsImages: null, reasoning: null, contextWindow: null, maxOutputTokens: null });
  expect(JSON.stringify({ input, config })).toBe(before);
});

test('MAI Code 2 variants require approval and preserve existing exclusions and Flash order', () => {
  const mai = ['mai-code-2', 'mai-code-2-flash', 'mai-code-1.1-flash'].map(id => model('github-copilot', id));
  const config = { searchable_providers: ['github-copilot'], excluded_providers: ['openai-codex'], excluded_models: ['*grok*', 'gpt-6.1'] };
  const before = JSON.stringify({ mai, config });
  expect(buildModelCandidates(mai)).toEqual([]);
  expect(migrate(mai, config).map(candidate => [candidate.modelId, candidate.tier])).toEqual([
    ['mai-code-1.1-flash', 2], ['mai-code-2-flash', 2], ['mai-code-2', 3],
  ]);
  expect(migrate(mai, { ...config, excluded_providers: ['github-copilot'] })).toEqual([]);
  expect(migrate(mai, { ...config, excluded_models: ['mai-code-2'] }).map(candidate => candidate.modelId)).toEqual(['mai-code-1.1-flash']);
  expect(JSON.stringify({ mai, config })).toBe(before);
});

test('configured provider order breaks same-model ties without changing tier order', () => {
  const same = [model('openai', 'gpt-5.4-mini'), model('github-copilot', 'gpt-5.4-mini')];
  expect(migrate(same, { searchable_providers: ['github-copilot', 'openai'], excluded_providers: [], excluded_models: [] }).map(candidate => candidate.provider))
    .toEqual(['github-copilot', 'openai']);
});

test('provider defaults, explicit denials and case-insensitive model patterns remain fail closed', () => {
  const config = { searchable_providers: ['azure-private', 'github-copilot'], excluded_providers: null, excluded_models: ['*MAI*'] };
  expect(migrate(models, config).map(candidate => candidate.id)).toEqual(['github-copilot/gpt-6.1-sol']);
  expect(migrate(models, { ...config, excluded_providers: [] }).map(candidate => candidate.id)).toEqual(['azure-private/gpt-5.4-mini', 'github-copilot/gpt-6.1-sol']);
  expect(migrate(models, { ...config, excluded_providers: ['github-copilot'] })).toEqual(['azure-private/gpt-5.4-mini'].map(id => expect.objectContaining({ id })));
  expect(migrate(models, { ...config, excluded_models: ['GPT-6.1', 'mai'] })).toEqual([]);
});
