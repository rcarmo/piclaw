import './src/test-guard.js';

import { expect, test } from 'bun:test';

import { realpathSync } from 'node:fs';

import { fileURLToPath } from 'node:url';

import type { CredentialStore, Model, TranscriptContext } from '../../node_modules/@earendil-works/pi-ai';

import { getSupportedThinkingLevels as privateLevels, estimateContextTokens as privateEstimate,
  type Model as PrivateModel } from '../../runtime/durable-engine/qualification/ai.ts';

import { createHostModels, type HostModelPolicy } from '../../runtime/durable-engine/src/host-models.ts';

import { AgentDoc, Harness, MemoryStorage, createRegistry } from '../../runtime/durable-engine/qualification/durable.ts';

import { BACKGROUND_CONTEXT as context } from '../../runtime/durable-engine/qualification/context.ts';

const root = new URL('../../package.json', import.meta.url).href;

const engine = new URL('../../runtime/durable-engine/package.json', import.meta.url).href;

const rootAI = import.meta.resolve('@earendil-works/pi-ai', root);

const engineAI = import.meta.resolve('@earendil-works/pi-ai', engine);

const { ModelRuntime }: typeof import('../../node_modules/@earendil-works/pi-coding-agent') =
  await import(import.meta.resolve('@earendil-works/pi-coding-agent', root));

const { getSupportedThinkingLevels: rootLevels, normalizeContext: rootNormalize }:
  typeof import('../../node_modules/@earendil-works/pi-ai') = await import(rootAI);

const { estimateContextTokens: rootEstimate } =
  await import(import.meta.resolve('@earendil-works/pi-ai/utils/estimate', root));

const { streamSimple: sdkStreamSimple }: typeof import('../../node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js') =
  await import(import.meta.resolve('@earendil-works/pi-ai/api/openai-completions', root));

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const ref = { provider: 'qualification-request-contract', id: 'offline-reasoner' };

const token = 'SYNTHETIC-REQUEST-CONTRACT-KEY';

const physical: Model<'openai-completions'> = {
  ...ref, name: 'Offline reasoning contract', api: 'openai-completions',
  baseUrl: 'https://request-contract.invalid/v1', input: ['text'], reasoning: true,
  thinkingLevelMap: { off: null, minimal: null, low: null, medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
  compat: { maxTokensField: 'max_tokens' }, contextWindow: 100000, maxTokens: 32000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function prefix(tokens = 80000): TranscriptContext {
  return rootNormalize({ messages: [
    { role: 'user', content: 'p'.repeat(Math.floor((tokens - 1) * 3.5)), timestamp: 1 },
    { role: 'assistant', api: physical.api, provider: ref.provider, model: ref.id,
      content: [{ type: 'text', text: 'ok' }], stopReason: 'stop', timestamp: 2,
      usage: { input: tokens - 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: tokens,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
  ] });
}

async function fixture(override?: Partial<Model<'openai-completions'>>) {
  const offered = { ...physical, ...override };
  const reads: string[] = [], auth: string[] = [], wires: { url: string; body: any }[] = [];
  const credentials: CredentialStore = {
    async read(id) {
      // No fallback to environment, files, built-in provider auth, or live credentials.
      if (id !== ref.provider) throw Error('Non-fixture credentials forbidden');
      reads.push(id); return { type: 'api_key', key: token };
    },
    async list() { return [{ providerId: ref.provider, type: 'api_key' }]; },
    async modify() { throw Error('Credential mutation forbidden'); },
    async delete() { throw Error('Credential deletion forbidden'); },
  };
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null,
    modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} },
    allowModelNetwork: false, refreshOnCreate: false });
  // This is a PROVIDED fetch, injected only in the root provider. The source
  // guard's global fetch remains a throwing network trap throughout the tests.
  const providedFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe('https://request-contract.invalid/v1/chat/completions');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`);
    const body = JSON.parse(String(init?.body));
    expect(JSON.stringify(body)).not.toContain(token);
    wires.push({ url: String(url), body });
    const chunk = { id: 'offline-chat', object: 'chat.completion.chunk', created: 3, model: ref.id,
      choices: [{ index: 0, delta: { role: 'assistant', content: 'admitted' }, finish_reason: null }] };
    const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 80000, completion_tokens: 1, total_tokens: 80001 } };
    return new Response([chunk, end].map(value => `data: ${JSON.stringify(value)}\n\n`).join('') + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  let calls = 0;
  runtime.registerNativeProvider({ id: ref.provider, name: 'Offline real OpenAI adapter',
    getModels: () => [copy(offered)],
    auth: { apiKey: { name: 'Synthetic only', check: async () => ({ type: 'api_key' }),
      resolve: async ({ credential }) => {
        auth.push(ref.provider);
        expect(credential).toEqual({ type: 'api_key', key: token });
        return { auth: { apiKey: token }, source: 'synthetic-fixture' };
      } } },
    stream() { throw Error('This fixture qualifies streamSimple only'); },
    // Real SDK conversion, clamping, OpenAI client serialization and SSE parser.
    // Neither a fabricated terminal stream nor a helper-only sizing oracle.
    streamSimple(owner, ctx, options) {
      expect(owner.api).toBe('openai-completions'); calls++;
      return sdkStreamSimple(owner as Model<'openai-completions'>, ctx, { ...options, fetch: providedFetch });
    },
  });
  // Drain registration's background availability refresh before measuring effects.
  await runtime.refresh({ allowNetwork: false });
  await Bun.sleep(0);
  reads.length = 0; auth.length = 0;
  const lifetime = new AbortController();
  const accounting = { authorize: 0, current: 0, dispatch: 0, retain: 0, settle: 0, abandon: 0 };
  const check = (signal: AbortSignal) => { lifetime.signal.throwIfAborted(); signal.throwIfAborted(); };
  const policy: HostModelPolicy = { signal: lifetime.signal,
    async authorize(owner, kind, signal) { expect(owner).toEqual(ref); expect(kind).toBe('chat'); check(signal); accounting.authorize++; },
    assertCurrent(_owner, _kind, signal) { check(signal); accounting.current++; },
    async prepareRequest(_owner, _options, signal) { check(signal); return {
      async dispatch() { check(signal); accounting.dispatch++; },
      async retainTerminal(message) { accounting.retain++; return copy(message); },
      async settle() { check(signal); accounting.settle++; },
      async abandon() { accounting.abandon++; },
    }; },
  };
  const models = createHostModels(runtime, [ref], policy);
  return { runtime, models, model: models.getModel(ref.provider, ref.id)!, reads, auth, wires, accounting,
    calls: () => calls, close: () => lifetime.abort() };
}

function descriptors(f: Awaited<ReturnType<typeof fixture>>) {
  const rootDescriptor = copy(f.runtime.getPhysicalModel(ref.provider, ref.id)!);
  const privateDescriptor = copy(f.model);
  expect(f.runtime.getPhysicalModel(ref.provider, ref.id)).not.toBe(f.model);
  expect(f.runtime.getPhysicalModel(ref.provider, ref.id)!.input).not.toBe(f.model.input);
  expect(f.runtime.getPhysicalModel(ref.provider, ref.id)!.thinkingLevelMap).not.toBe(f.model.thinkingLevelMap);
  return { rootDescriptor, privateDescriptor };
}

test('control: root/private physical SDK graphs are distinct; JSON-only level oracle agrees before bridging', () => {
  expect(realpathSync(fileURLToPath(rootAI))).not.toBe(realpathSync(fileURLToPath(engineAI)));
  expect(rootLevels).not.toBe(privateLevels);
  expect(rootEstimate).not.toBe(privateEstimate);
  expect(privateLevels(copy(physical) as PrivateModel<'openai-completions'>)).toEqual(rootLevels(copy(physical)));
});

test('createHostModels preserves root supported thinking levels including max/xhigh and null-disabled levels', async () => {
  const f = await fixture();
  try {
    const { rootDescriptor, privateDescriptor } = descriptors(f);
    const actual = privateLevels(privateDescriptor), expected = rootLevels(rootDescriptor);
    expect(expected).toEqual(['medium', 'high', 'xhigh', 'max']);
    console.log('[thinking-levels]', JSON.stringify({ expected, actual }));
    expect(f.reads).toEqual([]); expect(f.auth).toEqual([]); expect(f.calls()).toBe(0);
    expect(actual).toEqual(expected);
  } finally { f.close(); }
});

test('private descriptor retains the root JSON thinkingLevelMap (no credential effects)', async () => {
  const f = await fixture();
  try {
    const descriptorsJSON = descriptors(f);
    console.log('[descriptors]', JSON.stringify(descriptorsJSON));
    expect(JSON.stringify(descriptorsJSON)).not.toContain(token);
    expect(f.reads).toEqual([]); expect(f.auth).toEqual([]); expect(f.calls()).toBe(0);
    expect(descriptorsJSON.privateDescriptor.thinkingLevelMap).toEqual(descriptorsJSON.rootDescriptor.thinkingLevelMap);
  } finally { f.close(); }
});

test('thinking map is whitelisted, detached and immutable; caller/source mutations cannot rewrite the catalog', async () => {
  const f = await fixture();
  try {
    const source = copy(f.runtime.getPhysicalModel(ref.provider, ref.id)!);
    Object.assign(source, { headers: { authorization: token }, unknownMetadata: token });
    Object.assign(source.thinkingLevelMap!, { unknownLevel: token });
    const models = createHostModels({ getPhysicalModel: () => source,
      stream: f.runtime.stream.bind(f.runtime), streamSimple: f.runtime.streamSimple.bind(f.runtime) }, [ref], {
      signal: new AbortController().signal,
      async authorize() { throw Error('Descriptor-only test forbids admission'); }, assertCurrent() {},
    });
    const descriptor = models.getModel(ref.provider, ref.id)!;
    expect(descriptor.thinkingLevelMap).toEqual(physical.thinkingLevelMap);
    expect(descriptor.thinkingLevelMap).not.toBe(source.thinkingLevelMap);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.thinkingLevelMap)).toBe(true);
    expect(JSON.stringify(descriptor)).not.toContain(token);
    expect(descriptor).not.toHaveProperty('headers'); expect(descriptor).not.toHaveProperty('unknownMetadata');
    expect(Reflect.set(descriptor.thinkingLevelMap!, 'max', null)).toBe(false);
    source.thinkingLevelMap!.max = null;
    const caller = copy(descriptor); caller.thinkingLevelMap!.xhigh = null;
    expect(privateLevels(caller)).not.toContain('xhigh');
    expect(privateLevels(models.getModel(ref.provider, ref.id)!)).toEqual(['medium', 'high', 'xhigh', 'max']);
    expect(source.thinkingLevelMap!.xhigh).toBe('xhigh');
    expect(f.reads).toEqual([]); expect(f.auth).toEqual([]); expect(f.calls()).toBe(0);
  } finally { f.close(); }
});

test('real native configuration persists xhigh/max for the next actual wire request without replay or history edits', async () => {
  const f = await fixture();
  const reports: unknown[] = [];
  const harness = await Harness.open(new MemoryStorage(), { models: f.models, registry: createRegistry(),
    settings: { retry: { enabled: false }, compaction: { enabled: false } }, onReport: report => reports.push(report),
  }, context);
  try {
    const conversation = await harness.root(context, { agent: {
      model: { provider: ref.provider, modelId: ref.id }, thinkingLevel: 'medium', tools: [], modelTools: [],
    } });
    for (const [index, level] of (['medium', 'xhigh', 'max'] as const).entries()) {
      const before = copy((await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items);
      const priorWire = copy(f.wires);
      await conversation.configure({ thinkingLevel: level }, context);
      expect((await conversation.agent(context)).thinkingLevel).toBe(level);
      expect((await harness.snapshot(AgentDoc, conversation.id, context))!.thinkingLevel).toBe(level);
      expect(copy((await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items)).toEqual(before);
      expect(f.wires).toEqual(priorWire); expect(f.calls()).toBe(index);
      expect(f.reads).toHaveLength(index); expect(f.accounting.authorize).toBe(index);
      const submission = await conversation.submit({ type: 'input', requestId: `thinking-${level}`, content: `next-${level}` }, context);
      expect((await submission.wait(context)).status).toBe('done');
      expect(f.wires).toHaveLength(index + 1);
      expect(f.wires[index]!.body.reasoning_effort).toBe(level);
      const rows = (await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items;
      expect(copy(rows.slice(0, before.length))).toEqual([...before]);
      expect(rows.flatMap(entry => entry.model ?? []).filter(message => message.role === 'user')).toHaveLength(index + 1);
    }
    expect(reports).toEqual([]);
    expect(f.accounting).toMatchObject({ authorize: 3, dispatch: 3, retain: 3, settle: 3, abandon: 0 });
    console.log('[native-thinking-wire]', JSON.stringify(f.wires.map(wire => ({
      reasoning_effort: wire.body.reasoning_effort, max_tokens: wire.body.max_tokens,
    }))));
  } finally { await harness.close(context); f.close(); }
});

for (const change of ['reasoning-disabled', 'level-disabled', 'level-remapped'] as const) {
  test(`changed physical thinking contract refuses before root dispatch: ${change}`, async () => {
    const f = await fixture();
    try {
      let physicalNow = copy(f.runtime.getPhysicalModel(ref.provider, ref.id)!);
      const bridge = createHostModels({ getPhysicalModel: () => physicalNow,
        stream: f.runtime.stream.bind(f.runtime), streamSimple: f.runtime.streamSimple.bind(f.runtime) }, [ref], {
        signal: new AbortController().signal, async authorize() {}, assertCurrent() {},
      });
      const selected = bridge.getModel(ref.provider, ref.id)!;
      if (change === 'reasoning-disabled') physicalNow = { ...physicalNow, reasoning: false };
      else physicalNow = { ...physicalNow, thinkingLevelMap: { ...physicalNow.thinkingLevelMap,
        max: change === 'level-disabled' ? null : 'high' } };
      const result = await bridge.streamSimple(selected, prefix(), { reasoning: 'max' }).result();
      expect(result.stopReason).toBe('error');
      expect(f.calls()).toBe(0); expect(f.wires).toEqual([]);
      expect(f.reads).toEqual([]); expect(f.auth).toEqual([]);
      expect(privateLevels(bridge.getModel(ref.provider, ref.id)!)).toEqual(['medium', 'high', 'xhigh', 'max']);
    } finally { f.close(); }
  });
}

test('thinking metadata change across awaited dispatch admission prevents the root wire request', async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const source = copy(f.runtime.getPhysicalModel(ref.provider, ref.id)!);
    let snapshots = 0;
    const bridge = createHostModels({ getPhysicalModel: () => source,
      stream: f.runtime.stream.bind(f.runtime),
      streamSimple(model, ctx, options) {
        snapshots++; expect(model).not.toBe(source);
        expect(model.thinkingLevelMap).not.toBe(source.thinkingLevelMap);
        expect(Object.isFrozen(model.thinkingLevelMap)).toBe(true);
        return f.runtime.streamSimple(model, ctx, options);
      } }, [ref], {
      signal: new AbortController().signal, async authorize() {}, assertCurrent() {},
      async prepareRequest() { return {
        async dispatch() { entered(); await held; },
        async retainTerminal(message) { return copy(message); }, async settle() {}, async abandon() {},
      }; },
    });
    const result = bridge.streamSimple(bridge.getModel(ref.provider, ref.id)!, prefix(), { reasoning: 'max' }).result();
    await started;
    source.thinkingLevelMap!.max = 'high';
    release();
    expect((await result).stopReason).toBe('error');
    expect(snapshots).toBe(1); expect(f.wires).toEqual([]);
    expect(f.calls()).toBe(0);
  } finally { release(); f.close(); }
});
