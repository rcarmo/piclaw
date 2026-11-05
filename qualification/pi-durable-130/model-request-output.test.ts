import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { BunSqliteDatabase, HostConversationRuntime } from '../../runtime/durable-engine/src/index.ts';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.ts';
import { TestOwner } from './src/ownership.ts';
import { installServiceWorkSchema } from '../../runtime/src/service-effects/current-piclaw/service-work-schema.ts';
import type { CredentialStore, Model, TranscriptContext } from '../../node_modules/@earendil-works/pi-ai';
import { getSupportedThinkingLevels as privateLevels, estimateContextTokens as privateEstimate,
  type Model as PrivateModel } from '../../runtime/durable-engine/qualification/ai.ts';
import { createHostModels, type HostModelPolicy } from '../../runtime/durable-engine/src/host-models.ts';
import { previewSdkRequest } from '../../runtime/src/agent-pool/model-request-preview.ts';
import { assertModelContextFits } from '../../runtime/durable-engine/src/host-model-context.ts';
import { AgentDoc, Harness, MemoryStorage, createRegistry } from '../../runtime/durable-engine/qualification/durable.ts';
import { BACKGROUND_CONTEXT as context } from '../../runtime/durable-engine/qualification/context.ts';

// Resolve public ESM exports from the ROOT island, never the qualification island.
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
// Coherent text AND authoritative usage: 79,999 input + 1 output = 80,000.
// No negative counters, stale timestamps, cache ambiguity, tool framing, or images.
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
    getModels: () => [copy(offered), copy({ ...offered, id: "initial" })],
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
  const effects = { authorize: 0, current: 0, usage: 0 };
  const check = (signal: AbortSignal) => { lifetime.signal.throwIfAborted(); signal.throwIfAborted(); };
  let previewRequest = previewSdkRequest;
  const policy: HostModelPolicy = { signal: lifetime.signal, previewRequest: (...args) => previewRequest(...args),
    async authorize(owner, kind, signal) { expect(owner).toEqual(ref); expect(kind).toBe('chat'); check(signal); effects.authorize++; },
    assertCurrent(_owner, _kind, signal) { check(signal); effects.current++; },
    observeUsage() { effects.usage++; },
  };
  const models = createHostModels(runtime, [ref, { ...ref, id: "initial" }], policy);
  return { runtime, models, model: models.getModel(ref.provider, ref.id)!, reads, auth, wires, effects,
    calls: () => calls, setPreview(fn: typeof previewSdkRequest) { previewRequest = fn; }, close: () => lifetime.abort() };
}

// piclaw#1868: preserve the original coherent80K/100K/32K counterexample, but size from the producer.
test('actual Root ModelRuntime/private bridge preview is offline, physically isolated and matches the next wire cap', async () => {
  const f = await fixture();
  try {
    expect(realpathSync(fileURLToPath(rootAI))).not.toBe(realpathSync(fileURLToPath(engineAI)));
    expect(rootLevels).not.toBe(privateLevels);
    expect(privateLevels(copy(physical) as PrivateModel<'openai-completions'>)).toEqual(rootLevels(copy(physical)));
    const ctx = prefix(), before = copy(ctx);
    expect(rootEstimate(ctx)).toEqual({ tokens: 80000, usageTokens: 80000, trailingTokens: 0, lastUsageIndex: 1 });
    const output = await f.models.previewSimple!(f.model, copy(ctx));
    expect(output).toEqual({ status: 'bounded', maxOutputTokens: 15904, reserveTokens: 20000, authIndependent: true });
    expect(() => assertModelContextFits(ctx.messages, f.model, output)).not.toThrow();
    expect(f.reads).toEqual([]); expect(f.auth).toEqual([]); expect(f.calls()).toBe(0);
    expect(f.effects.authorize).toBe(0);
    const result = await f.models.streamSimple(f.model, copy(ctx), { maxTokens: 32000 }).result();
    expect(result.stopReason).toBe('stop'); expect(f.wires).toHaveLength(1);
    expect(f.wires[0]!.body.max_tokens).toBe(output.status === 'bounded' ? output.maxOutputTokens : NaN);
    expect(ctx).toEqual(before);
    expect(f.effects).toMatchObject({ authorize: 1, usage: 1 });
  } finally { f.close(); }
});

test('actual sampling override cannot borrow a helper clamp or pass output admission', async () => {
  const f = await fixture({ samplingParams: { max_tokens: 32000 } });
  try {
    const ctx = prefix();
    const output = await f.models.previewSimple!(f.model, copy(ctx));
    expect(output).toEqual({ status: 'bounded', maxOutputTokens: 32000, reserveTokens: 36096, authIndependent: true });
    expect(() => assertModelContextFits(ctx.messages, f.model, output)).toThrow('context estimate exceeded');
    expect(f.reads).toEqual([]); expect(f.auth).toEqual([]); expect(f.effects.authorize).toBe(0);
    // Offline transport control deliberately accepts the otherwise oversized body.
    expect((await f.models.streamSimple(f.model, copy(ctx), { maxTokens: 32000 }).result()).stopReason).toBe('stop');
    expect(f.wires[0]!.body.max_tokens).toBe(32000);
    expect(privateEstimate(ctx.messages).tokens + f.wires[0]!.body.max_tokens).toBe(112000);
  } finally { f.close(); }
});

for (const maximum of [4000, 32000]) test(`actual explicit output maximum ${maximum} is checked without auth or a second reserve`, async () => {
  const f = await fixture();
  try {
    const output = await f.models.previewSimple!(f.model, prefix(), { maxTokens: maximum, reasoning: 'max' });
    expect(output).toMatchObject({ status: 'bounded', maxOutputTokens: Math.min(maximum, 15904) });
    expect(() => assertModelContextFits(prefix().messages, f.model, output)).not.toThrow();
    expect(f.reads).toEqual([]); expect(f.auth).toEqual([]); expect(f.calls()).toBe(0);
  } finally { f.close(); }
});

test('unknown output is not zero or a guessed full cap; true input overflow and invalid usage still refuse', async () => {
  const f = await fixture();
  try {
    const unknown = { status: 'unknown' as const, reason: 'unsupported' as const };
    expect(() => assertModelContextFits(prefix().messages, f.model, unknown)).not.toThrow();
    expect(() => assertModelContextFits(prefix(100001).messages, f.model, unknown)).toThrow('context estimate exceeded');
    for (const bad of [NaN, Infinity, -1]) {
      const ctx = copy(prefix());
      const last = ctx.messages[1]!;
      if (last.role !== 'assistant') throw Error('fixture');
      last.usage.input = bad;
      expect(() => assertModelContextFits(ctx.messages, f.model, unknown)).toThrow('usage unavailable');
    }
    for (const key of ['contextWindow', 'maxTokens'] as const) for (const value of [0, -1, NaN, Infinity]) {
      expect(() => assertModelContextFits(prefix().messages, { ...f.model, [key]: value }, unknown)).toThrow('Model context unavailable');
    }
    expect(f.reads).toEqual([]); expect(f.auth).toEqual([]); expect(f.calls()).toBe(0);
  } finally { f.close(); }
});

for (const scenario of ['known', 'override', 'close'] as const) test(`real idle model choice uses the prepared Root bound before SQL; ${scenario}`, async () => {
  const overridden = scenario === 'override';
  const f = await fixture(overridden ? { samplingParams: { max_tokens: 32000 } } : undefined);
  const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, 'producer-choice-'));
  const path = join(dir, 'shared.db'), owner = TestOwner.acquire(path), db = new Database(path);
  installServiceWorkSchema(db);
  const registry = createRegistry();
  const openStorage = () => SqliteStorage.open(new BunSqliteDatabase(path, { root: db, assertOwner: () => owner.assert() }));
  let runtime: HostConversationRuntime | undefined;
  let seed: Harness | undefined;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const preview = previewSdkRequest;
  f.setPreview(async (model, transcript, options) => {
    expect(db.inTransaction).toBe(false);
    const result = await preview(model, transcript, options);
    if (scenario === 'close') { entered(); await held; }
    return result;
  });
  try {
    seed = await Harness.open(await openStorage(), { models: f.models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
    const conversation = await seed.root(context, { agent: { model: { provider: ref.provider, modelId: 'initial' }, thinkingLevel: 'medium', tools: [], modelTools: [] } });
    await conversation.commit(tx => tx.appendEntry(conversation.id, { kind: 'fixture.coherent-prefix', model: copy(prefix().messages) }), context);
    const before = copy((await conversation.entries({ order: 'ascending' }, 100, undefined, context)).items);
    const id = conversation.id;
    await seed.close(context); seed = undefined;
    const unused = async () => { throw Error('Selection must not enter host execution effects'); };
    runtime = await HostConversationRuntime.open({ incarnation: 'producer-choice', sessionId: 'producer-choice',
      owner: { assert: () => owner.assert(), release() {} }, openStorage,
      harnessOptions: { models: f.models, registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } },
      work: { getOperation: unused, acceptCancellation: unused } as any,
      terminal: { getTerminal: unused, commitTerminal: unused } as any,
      bindings: { get: unused, bind: unused, getOrBind: unused, recordSubmission: unused },
      conversationFor: () => id, existingConversationIds: [id], authorizeScheduling: unused, putAnswer: unused, now: () => 'fixture',
    }, context);
    const binding = { incarnation: 'producer-choice', chatJid: 'web:producer-choice', branchId: 'main', conversationId: id };
    if (scenario === 'close') {
      const selecting = runtime.setSessionModel(binding, { provider: ref.provider, modelId: ref.id });
      let rejected = false;
      void selecting.catch(() => { rejected = true; });
      await started;
      const closing = runtime.close();
      await Bun.sleep(0); // Closing must cancel pure metadata before the held producer returns.
      try { expect(rejected).toBe(true); }
      finally { release(); await selecting.catch(() => {}); await closing; }
    } else if (overridden) {
      await expect(runtime.setSessionModel(binding, { provider: ref.provider, modelId: ref.id })).rejects.toThrow('context estimate exceeded');
      expect(await runtime.readSessionModel(binding)).toBe(`${ref.provider}/initial`);
    } else {
      await runtime.setSessionModel(binding, { provider: ref.provider, modelId: ref.id });
      expect(await runtime.readSessionModel(binding)).toBe(`${ref.provider}/${ref.id}`);
    }
    expect(f.reads).toEqual([]); expect(f.auth).toEqual([]); expect(f.calls()).toBe(0);
    expect(f.effects.authorize).toBe(0);
    await runtime.close(); runtime = undefined;
    seed = await Harness.open(await openStorage(), { models: f.models, registry }, context);
    const reopened = (await seed.conversation(id, context))!;
    expect(copy((await reopened.entries({ order: 'ascending' }, 100, undefined, context)).items)).toEqual(before);
    expect((await reopened.agent(context)).model?.modelId).toBe(scenario === 'known' ? ref.id : 'initial');
  } finally {
    release(); await runtime?.close(); await seed?.close(context); f.close(); db.close(); owner.releaseAfterClose(); owner.closeConnection();
    await rm(dir, { recursive: true, force: true });
  }
});
