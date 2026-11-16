import './src/test-guard.js';
import { test, expect } from 'bun:test';
import { normalizeContext, type Model } from '../../runtime/src/durable-legacy-sdk.ts';
import { previewSdkRequest, previewHostRequest } from '../../runtime/src/agent-pool/model-request-preview.ts';
import { createProvider } from '../../node_modules/@earendil-works/pi-ai';
import { builtinModels, getBuiltinModels, getBuiltinProviders } from '../../node_modules/@earendil-works/pi-ai/dist/providers/all.js';

const model: Model<'openai-completions'> = { api: 'openai-completions', provider: 'wrapper-fixture', id: 'fixture', name: 'Fixture',
  input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 32000, baseUrl: 'https://wrapper.invalid/v1',
  compat: { maxTokensField: 'max_tokens' }, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
const context = normalizeContext({ messages: [] });
function provider() {
  return createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: 'no auth', async resolve() { throw Error('Auth forbidden'); } } },
    api: { stream() { throw Error('Dispatch forbidden'); }, streamSimple() { throw Error('Dispatch forbidden'); } },
  });
}

// #1857/#1868: use unmodified public SDK builders; no helper-only output inference.
for (const api of ['openai-responses', 'azure-openai-responses'] as const) test(`${api} wrapper observes the actual 16-token request minimum`, async () => {
  const output = await previewSdkRequest({ ...model, api, compat: undefined }, context, { maxTokens: 1 });
  expect(output).toEqual({ status: 'bounded', maxOutputTokens: 16, reserveTokens: 4112, authIndependent: true });
});
for (const [samplingParams, reason] of [
  [{ max_tokens: null, max_completion_tokens: 19 }, 'missing_output_limit'],
  [{ max_tokens: 13, max_completion_tokens: 19 }, 'ambiguous_output_limit'],
  [{ max_tokens: 0 }, 'invalid_output_limit'],
  [{ max_tokens: 1.5 }, 'invalid_output_limit'],
  [{ max_tokens: Number.MAX_SAFE_INTEGER }, 'invalid_output_limit'],
  [{ messages: [] }, 'request_override'],
  [{ tools: [] }, 'request_override'],
] as const) test(`wrapper refuses ${JSON.stringify(samplingParams)} as ${reason}`, async () => {
  expect(await previewSdkRequest({ ...model, samplingParams }, context)).toEqual({ status: 'unknown', reason });
});
test('wrapper never invokes caller hooks or accepts auth-selected output as a bound', async () => {
  let hooks = 0;
  expect(await previewSdkRequest(model, context, { onPayload() { hooks++; throw Error('Caller hook forbidden'); } })).toEqual({ status: 'unknown', reason: 'payload_hook' });
  expect(await previewSdkRequest({ ...model, api: 'openai-responses', provider: 'openai', compat: undefined }, context)).toEqual({ status: 'unknown', reason: 'auth_dependent' });
  expect(hooks).toBe(0);
});
test('extension overrides and virtual targets cannot inherit a bound', async () => {
  const native = provider();
  expect(await previewSdkRequest({ ...model, api: 'pi-virtual' }, context)).toEqual({ status: 'unknown', reason: 'unsupported' });
  expect(await previewHostRequest({ getProvider: () => native, getRegisteredProviderConfig: () => ({ api: model.api, streamSimple() { throw Error('Extension transport forbidden'); } }) }, model, context, {})).toEqual({ status: 'unknown', reason: 'unsupported' });
});
test('unknown native producers remain unsupported and cannot advertise an unchecked preview callback', async () => {
  let callbacks = 0;
  const native = { ...provider(), previewSimple() { callbacks++; throw Error('Untrusted metadata callback forbidden'); } };
  expect(await previewHostRequest({ getProvider: () => native, getRegisteredNativeProvider: () => native, getRegisteredProviderConfig: () => undefined }, model, context, {})).toEqual({ status: 'unknown', reason: 'unsupported' });
  expect(callbacks).toBe(0);
});
test('builtin producer detection uses public registration/catalogue metadata without auth', async () => {
  const builtin = getBuiltinProviders().flatMap(id => getBuiltinModels(id)).find(value => value.api === 'openai-completions')!;
  expect(builtin).toBeDefined();
  const actual = builtinModels().getProvider(builtin.provider);
  const output = await previewHostRequest({ getProvider: () => actual, getRegisteredNativeProvider: () => undefined, getRegisteredProviderConfig: () => undefined }, builtin, context, {});
  expect(output.status).toBe('bounded');
});
test('already-aborted metadata never enters runtime or adapter callbacks', async () => {
  const controller = new AbortController();
  controller.abort(Error('Wrapper cancelled'));
  let entered = false;
  await expect(previewHostRequest({ getProvider() { entered = true; return provider(); } }, model, context, { signal: controller.signal })).rejects.toThrow('Wrapper cancelled');
  await expect(previewSdkRequest(model, context, { signal: controller.signal })).rejects.toThrow('Wrapper cancelled');
  expect(entered).toBe(false);
});

test('unsafe usage cannot turn a clamp-floor result into a negative bounded reserve', async () => {
  const huge = normalizeContext({ messages: [{ role: 'assistant', api: model.api, provider: model.provider, model: model.id,
    timestamp: 0, content: [], stopReason: 'stop', usage: { input: Number.MAX_SAFE_INTEGER + 1, output: 0,
      cacheRead: 0, cacheWrite: 0, totalTokens: Number.MAX_SAFE_INTEGER + 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }] });
  expect(await previewSdkRequest(model, huge)).toEqual({ status: 'unknown', reason: 'invalid_output_limit' });
});
