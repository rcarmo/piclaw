import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { createHostModels } from '../../runtime/durable-engine/src/host-models.ts';
import type { Model } from '../../node_modules/@earendil-works/pi-ai';
import { previewSdkRequest } from '../../runtime/src/agent-pool/model-request-preview.ts';

const root = new URL('../../package.json', import.meta.url).href;
const { createProvider } = await import(import.meta.resolve('@earendil-works/pi-ai', root));
const adapter = await import(import.meta.resolve('@earendil-works/pi-ai/api/openai-completions', root));
const base: Model<'openai-completions'> = {
  api: 'openai-completions', provider: 'offline-output-preview', id: 'physical', name: 'Physical',
  baseUrl: 'https://offline.invalid/v1', input: ['text'], reasoning: false,
  contextWindow: 100000, maxTokens: 32000, compat: { maxTokensField: 'max_tokens' },
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const prefix = { messages: [{ role: 'assistant' as const, api: base.api, provider: base.provider, model: base.id,
  content: [], stopReason: 'stop' as const, timestamp: 0,
  usage: { input: 80000, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 80000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
}] };

function fixture(override: Partial<Model<'openai-completions'>> = {}) {
  let current = structuredClone({ ...base, ...override });
  let auth = 0, authorize = 0, stream = 0;
  const provider: ReturnType<typeof createProvider> & { previewSimple?: typeof previewSdkRequest } = Object.assign(createProvider({ id: base.provider, models: [current],
    auth: { apiKey: { name: 'offline', async resolve() { auth++; throw Error('Preview must not resolve auth'); } } },
    api: adapter,
  }), { previewSimple: previewSdkRequest });
  let owner = provider;
  const abort = new AbortController();
  const models = createHostModels({
    getProvider: () => owner,
    getPhysicalModel: () => current,
    stream() { stream++; throw Error('Preview must not dispatch'); },
    streamSimple() { stream++; throw Error('Preview must not dispatch'); },
  }, [{ provider: base.provider, id: base.id }], {
    signal: abort.signal,
    previewRequest: (...args) => owner.previewSimple?.(...args) ?? Promise.resolve({ status: "unknown", reason: "unsupported" } as const),
    async captureSourceGuard() { throw Error('Preview must not enter execution source capture'); },
    async authorize() { authorize++; throw Error('Preview must not admit execution'); },
    assertCurrent() { throw Error('Preview must not enter execution grant'); },
  });
  return { models, provider, abort, model: models.getModel(base.provider, base.id)!,
    effects: () => ({ auth, authorize, stream }),
    replace(value: typeof provider) { owner = value; },
    mutate() { current = { ...current, maxTokens: current.maxTokens + 1 }; },
  };
}

// piclaw#1868: root producer owns output semantics; only detached JSON crosses to the private graph.
test('host output preview uses the actual root builder clamp without auth or execution admission', async () => {
  const f = fixture();
  const before = structuredClone(prefix);
  const result = await f.models.previewSimple!(f.model, prefix);
  expect(result).toEqual({ status: 'bounded', maxOutputTokens: 15904, reserveTokens: 20000, authIndependent: true });
  expect(Object.isFrozen(result)).toBe(true);
  expect(prefix).toEqual(before);
  expect(f.effects()).toEqual({ auth: 0, authorize: 0, stream: 0 });
});

test('root model sampling overrides survive the redacted private catalogue and cannot be mistaken for a helper clamp', async () => {
  const f = fixture({ samplingParams: { max_tokens: 32000 } });
  expect(f.model).not.toHaveProperty('samplingParams');
  const result = await f.models.previewSimple!(f.model, prefix);
  expect(result).toEqual({ status: 'bounded', maxOutputTokens: 32000, reserveTokens: 36096, authIndependent: true });
  expect(f.effects()).toEqual({ auth: 0, authorize: 0, stream: 0 });
});

test('preview uses actual explicit request options and leaves auth-dependent output unknown', async () => {
  const f = fixture();
  expect(await f.models.previewSimple!(f.model, prefix, { maxTokens: 4000 })).toMatchObject({ status: 'bounded', maxOutputTokens: 4000 });
  const dependent = fixture({ compat: undefined, samplingParams: { max_completion_tokens: 19 } });
  expect(await dependent.models.previewSimple!(dependent.model, prefix)).toEqual({ status: 'unknown', reason: 'auth_dependent' });
  expect(dependent.effects()).toEqual({ auth: 0, authorize: 0, stream: 0 });
});

test('a known API name without the provider capability is unsupported, not a fabricated bound', async () => {
  const f = fixture();
  const { previewSimple: _unsupported, ...provider } = f.provider;
  f.replace(provider);
  expect(await f.models.previewSimple!(f.model, prefix)).toEqual({ status: 'unknown', reason: 'unsupported' });
  expect(f.effects()).toEqual({ auth: 0, authorize: 0, stream: 0 });
});

test('unsupported output still validates the current physical model instead of trusting a stale catalogue window', async () => {
  const f = fixture();
  const { previewSimple: _unsupported, ...provider } = f.provider;
  f.replace(provider); f.mutate();
  await expect(f.models.previewSimple!(f.model, prefix)).rejects.toThrow('Model owner changed');
  expect(f.effects()).toEqual({ auth: 0, authorize: 0, stream: 0 });
});

for (const change of ['physical', 'provider', 'abort'] as const) {
  test(`output preview refuses ${change} revocation across awaited root capability`, async () => {
    const f = fixture();
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.replace({ ...f.provider, async previewSimple(...[model, context, options]: Parameters<typeof previewSdkRequest>) {
      entered(); await held;
      return f.provider.previewSimple!(model, context, options);
    } });
    const pending = f.models.previewSimple!(f.model, prefix);
    try {
      await started;
      if (change === 'physical') f.mutate();
      if (change === 'provider') f.replace({ ...f.provider });
      if (change === 'abort') f.abort.abort(Error('Preview cancelled'));
      release();
      await expect(pending).rejects.toThrow(change === 'abort' ? 'Preview cancelled' : 'Model owner changed');
      expect(f.effects()).toEqual({ auth: 0, authorize: 0, stream: 0 });
    } finally { release(); }
  });
}
