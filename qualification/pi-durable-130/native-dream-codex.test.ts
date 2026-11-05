import './src/test-guard.js';
import { expect, spyOn } from 'bun:test';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolatedApplicationTest } from './src/isolated-application-test.js';
import { repoRoot } from './src/repo-root.js';
import { getPiclawAgentDir } from '../../runtime/src/core/agent-dir.js';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { acquireRuntimeLock } from '../../runtime/src/runtime/single-instance.js';
import { createDefaultApplicationRuntime } from '../../runtime/durable-engine/src/default-application-runtime.js';
import { HostCodexModelServices } from '../../runtime/durable-engine/src/host-codex-model-services.js';
import * as artifacts from '../../runtime/durable-engine/src/host-codex-artifacts.js';
import type { Api, AssistantMessage, CredentialStore, Model, StreamFunction } from '../../node_modules/@earendil-works/pi-ai';
import { ModelRuntime } from '../../node_modules/@earendil-works/pi-coding-agent/dist/index.js';
import { createProvider, createAssistantMessageEventStream, getCurrentTools } from '../../node_modules/@earendil-works/pi-ai/dist/index.js';
const applicationTest = isolatedApplicationTest(import.meta.url);

for (const reportingFault of [false, true]) applicationTest(`actual Dream Codex request retains source/account/routing/tools/usage without host lifecycle: reporting-fault=${reportingFault}`, async () => {
  const source = realpathSync(process.env.DURABLE_ADDONS_ROOT!), workspace = process.env.PICLAW_WORKSPACE!;
  const pkg = join(workspace, '.pi/extensions/node_modules/@rcarmo/piclaw-addon-codex-conversion');
  cpSync(join(source, 'addons/codex-conversion'), pkg, { recursive: true, filter: path => !path.split('/').includes('node_modules') });
  const dependencies = join(pkg, 'node_modules'); mkdirSync(dependencies, { recursive: true });
  for (const modules of [join(repoRoot('CORE'), 'node_modules'), process.env.DURABLE_CATALOG_DEPENDENCIES!, join(source, 'addons/codex-conversion/node_modules')].filter(existsSync)) {
    for (const entry of readdirSync(modules)) {
      if (entry.startsWith('.')) continue;
      if (entry.startsWith('@')) {
        mkdirSync(join(dependencies, entry), { recursive: true });
        for (const child of readdirSync(join(modules, entry))) {
          const target = join(dependencies, entry, child); if (!existsSync(target)) symlinkSync(join(modules, entry, child), target);
        }
      } else if (!existsSync(join(dependencies, entry))) symlinkSync(join(modules, entry), join(dependencies, entry));
    }
  }
  const model: Model<'openai-codex-responses'> = { provider: 'openai-codex', id: 'synthetic-dream', name: 'Synthetic Dream Codex', api: 'openai-codex-responses',
    baseUrl: 'https://fixture.invalid', input: ['text', 'image'], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } };
  const credentials: CredentialStore = { async read(id) { if (id !== model.provider) throw Error('Ambient credentials forbidden'); return { type: 'api_key', key: 'synthetic-only' }; },
    async list() { return [{ providerId: model.provider, type: 'api_key' }]; }, async modify(_id, body) { return body(undefined); }, async delete() {} };
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, allowModelNetwork: false, refreshOnCreate: false });
  let calls = 0, fixtureError: unknown; const tokens: (string | null)[] = [];
  const release = spyOn(HostCodexModelServices.prototype, 'releaseTurn');
  const fetch = spyOn(globalThis, 'fetch').mockImplementation((async (_url: URL | RequestInfo, init?: RequestInit) => {
    tokens.push(new Headers(init?.headers).get('x-codex-turn-state'));
    return new Response('data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream', 'x-codex-turn-state': 'DREAM_ROUTING_' + tokens.length } });
  }) as typeof globalThis.fetch);
  const stream: StreamFunction<Api> = (physical, transcript, options) => {
    const output = createAssistantMessageEventStream(), attempt = ++calls;
    void (async () => {
      try {
        expect(physical).toMatchObject({ provider: model.provider, id: model.id, api: model.api });
        expect(getCurrentTools(transcript.messages).map(tool => tool.name).sort()).toEqual(['read', 'edit', 'write', 'grep', 'find', 'ls', 'messages', 'search_workspace'].sort());
        expect(options?.headers?.['x-fixture']).toBe('owned'); expect(options?.onPayload).toBeFunction();
        const payload = await options!.onPayload!({ model: model.id, input: [], tools: getCurrentTools(transcript.messages).map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters })) }, physical);
        const response = await options!.fetch!('https://fixture.invalid/responses', { method: 'POST', headers: options!.headers as HeadersInit, body: JSON.stringify(payload) }); await response.text();
        if (attempt === 2) {
          const result = transcript.messages.findLast(message => message.role === 'toolResult');
          expect(result).toBeDefined(); expect((result as { isError: boolean }).isError).toBe(false);
        }
        const message: AssistantMessage = { role: 'assistant', provider: physical.provider, model: physical.id, api: physical.api, timestamp: Date.now(),
          content: attempt === 1 ? [{ type: 'toolCall', id: 'dream-codex-write', name: 'write', arguments: { path: 'dream-codex-proof.md', content: 'Source-bound Dream Codex write' } }] : [{ type: 'text', text: 'Codex Dream completed' }],
          stopReason: attempt === 1 ? 'toolUse' : 'stop', usage: { input: 3, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 5, cost: { input: 0.000003, output: 0.000002, cacheRead: 0, cacheWrite: 0, total: 0.000005 } } };
        output.push({ type: 'done', reason: attempt === 1 ? 'toolUse' : 'stop', message }); output.end(message);
      } catch (error) {
        fixtureError = error;
        const message: AssistantMessage = { role: 'assistant', provider: physical.provider, model: physical.id, api: physical.api, timestamp: Date.now(), content: [], stopReason: 'error', errorMessage: String(error),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        output.push({ type: 'error', reason: 'error', error: message }); output.end(message);
      }
    })(); return output;
  };
  const provider = createProvider({ id: model.provider, models: [model],
    auth: { apiKey: { name: 'Synthetic', resolve: async () => ({ auth: { apiKey: 'synthetic-only', headers: { 'x-fixture': 'owned' } }, source: 'fixture' }) } }, api: { stream, streamSimple: stream } });
  runtime.registerNativeProvider(provider);
  mkdirSync(getPiclawAgentDir(), { recursive: true });
  writeFileSync(join(getPiclawAgentDir(), 'auth.json'), JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'synthetic-only', refresh: 'synthetic-refresh', expires: Date.now() + 3600000, accountId: 'synthetic-account' } }));
  process.env.PICLAW_DB_IN_MEMORY = '0'; initDatabase(); const root = getDb();
  const owner = acquireRuntimeLock({ lockPath: join(workspace, 'dream-codex-owner.lock'), strictOwnership: true, disabled: false });
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  let projection: ReturnType<typeof spyOn> | undefined;
  const services = { modelRuntime: runtime, modelRegistry: { getAvailable: () => [model] } };
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services as never);
    if (reportingFault) {
      projection = spyOn(artifacts, 'renderCodexAnswer').mockImplementation(async () => { throw Error('Synthetic optional projection failure'); });
      root.exec("CREATE TEMP TRIGGER fail_dream_usage BEFORE INSERT ON token_usage BEGIN SELECT RAISE(ABORT,'Synthetic optional usage failure'); END");
    }
    const result = await backend.sessionOptions.dispatchDreamOperation!({ invocationId: reportingFault ? '00000000-0000-4000-8000-000000000041' : '00000000-0000-4000-8000-000000000040', chatJid: 'web:default', mode: 'manual', days: 1,
      model: `${model.provider}/${model.id}`, timeoutMs: 20000, acceptedAt: new Date().toISOString(), assertCurrent() { owner.assertCurrentOwner(); } });
    if (fixtureError) throw fixtureError;
    expect(result).toMatchObject({ status: 'success', result: 'Codex Dream completed', usage: { totalTokens: 5 } });
    expect(calls).toBe(2); expect(tokens).toEqual([null, 'DREAM_ROUTING_1']);
    expect(readFileSync(join(workspace, 'dream-codex-proof.md'), 'utf8')).toBe('Source-bound Dream Codex write');
    expect(release.mock.calls.some(args => /^background:[a-f0-9]{64}$/.test(args[0]!))).toBe(true);
    if (projection) expect(projection).toHaveBeenCalledTimes(1);
    if (!reportingFault) {
      const deadline = Date.now() + 3000;
      while ((root.query('SELECT count(*) n FROM token_usage').get() as { n: number }).n < 2 && Date.now() < deadline) await Bun.sleep(10);
      expect(root.query('SELECT total_tokens FROM token_usage ORDER BY id').all()).toEqual([{ total_tokens: 5 }, { total_tokens: 5 }]);
    } else expect(root.query('SELECT * FROM token_usage').all()).toEqual([]);
    for (const table of ['service_effect_s01_operations', 'service_effect_s02_commits', 'budget_work', 'budget_request_reservations', 'budget_usage_events', 'messages']) expect(root.query(`SELECT * FROM ${table}`).all()).toEqual([]);
    const submissions = root.query('SELECT * FROM submissions ORDER BY id').all(), entries = root.query('SELECT * FROM entries ORDER BY id').all();
    expect(JSON.stringify(entries)).not.toContain('DREAM_ROUTING_');
    await backend.close(); backend = await createDefaultApplicationRuntime(owner, async () => services as never);
    expect(calls).toBe(2); expect(root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(submissions); expect(root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);
  } finally { projection?.mockRestore(); if (backend) await backend.close(); release.mockRestore(); fetch.mockRestore(); await closeDatabase(); owner.release(); }
}, 30000);
