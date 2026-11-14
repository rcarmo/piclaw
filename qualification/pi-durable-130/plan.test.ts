import { Harness, AgentDoc, createRegistry } from "../../runtime/durable-engine/qualification/durable.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.js";
import { BACKGROUND_CONTEXT as context } from "../../runtime/durable-engine/qualification/context.js";
import { BunSqliteDatabase } from "../../runtime/durable-engine/src/bun-sqlite.js";
import { createHostModels } from "../../runtime/durable-engine/src/host-models.js";
import './src/test-guard.js';
import { expect } from 'bun:test';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extensionKvSet } from '../../runtime/src/db/extension-kv.js';
import { isolatedApplicationTest } from './src/isolated-application-test.js';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { storeChatMetadata } from '../../runtime/src/db.js';
import { acquireRuntimeLock } from '../../runtime/src/runtime/single-instance.js';
import { createRecoverableRuntimeBackend } from '../../runtime/src/runtime/bootstrap.js';
import { createDefaultApplicationRuntime } from '../../runtime/durable-engine/src/default-application-runtime.js';
import { createRuntimeBaseServices } from '../../runtime/src/runtime/composition.js';
import { createTestCredentialStore } from '../../runtime/test/model-services-fixture.js';
import { AgentPool } from '../../runtime/src/agent-pool.js';
import { WebChannel } from '../../runtime/src/channels/web.js';
import { handleAgentMessage } from '../../runtime/src/channels/web/handlers/agent.js';
import { handleAgentRoutes } from '../../runtime/src/channels/web/http/dispatch-agent.js';
import { ModelRuntime } from '../../node_modules/@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream } from '../../node_modules/@earendil-works/pi-ai';

const applicationTest = isolatedApplicationTest(import.meta.url);
for (const installedLegacy of [false, true]) for (const nested of [false, true]) applicationTest(`Core native Plan tool, prompt, HTTP, stale writes and reopen; installedLegacy=${installedLegacy}; codemode=${nested}`, async () => {
  const workspace = process.env.PICLAW_WORKSPACE!;
  expect(existsSync(join(workspace, '.pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar'))).toBe(false);
  process.env.PICLAW_DB_IN_MEMORY = '0'; initDatabase();
  storeChatMetadata('web:default', new Date().toISOString());
  const db = getDb();
  const marker = join(workspace, 'retired-plan-evaluated');
  if (installedLegacy) {
    const pkg = join(workspace, '.pi/extensions/node_modules/@rcarmo/piclaw-addon-plan-sidebar');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@rcarmo/piclaw-addon-plan-sidebar', version: '0.1.28', type: 'module', pi: { extensions: ['index.ts'] } }));
    writeFileSync(join(pkg, 'index.ts'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'BAD'); throw Error('RETIRED_PLAN_MUST_NOT_IMPORT');`);
    db.transaction(() => extensionKvSet('plan-sidebar', 'plan', { chat_jid: 'web:default', markdown: '> Authored legacy\n\n- [-] Legacy task', updated_at: 'original timestamp' }, 'chat', 'web:default')).immediate();
  }
  const originalLegacyRows = db.query("SELECT * FROM extension_kv WHERE extension_id='plan-sidebar'").all();
  const owner = acquireRuntimeLock({ lockPath: join(workspace, 'native-plan.lock'), strictOwnership: true, disabled: false });
  const credentials = createTestCredentialStore({});
  const model: any = { provider: 'fixture', id: 'plan', name: 'Plan', api: 'openai-completions', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false,
    contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const host = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, refreshOnCreate: false, allowModelNetwork: false });
  let wrote = false, calls = 0; const requests: string[] = [];
  const stream = (physical: any, transcript: any) => {
    requests.push(JSON.stringify(transcript)); calls++;
    const out = createAssistantMessageEventStream();
    const update = { action: 'update', plan: [{ step: 'Core native plan', status: 'completed' }] };
    const content = !wrote ? [{ type: 'toolCall', id: 'native-plan-write', name: nested ? 'codemode' : 'plan',
      arguments: nested ? { code: `return await tools.plan(${JSON.stringify(update)});` } : update }]
      : [{ type: 'text', text: 'Plan complete' }];
    wrote = true;
    const message: any = { role: 'assistant', api: physical.api, provider: physical.provider, model: physical.id, timestamp: Date.now(), content,
      stopReason: content[0].type === 'toolCall' ? 'toolUse' : 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    queueMicrotask(() => { out.push({ type: 'done', reason: message.stopReason, message }); out.end(message); }); return out;
  };
  host.registerNativeProvider({ id: 'fixture', name: 'Fixture', getModels: () => [model], auth: { apiKey: { name: 'Keyless', resolve: async () => ({ auth: {}, source: 'fixture' }) } }, stream: stream as any, streamSimple: stream as any });
  await host.refresh({ allowNetwork: false });
  const services: any = { modelRuntime: host, modelRegistry: { getAvailable: () => [model] } };
  let backend = await createRecoverableRuntimeBackend(() => createDefaultApplicationRuntime(owner, async () => services));
  let base = createRuntimeBaseServices({ dataDir: workspace });
  let pool: AgentPool, channel: WebChannel;
  const bind = async () => { pool = new AgentPool({ credentialStore: credentials, modelRuntime: host, modelRegistry: services.modelRegistry, ...backend.sessionOptions } as any);
    channel = new WebChannel(backend.bind({ queue: base.queue, agentPool: pool })); await backend.attachChannel!(channel); };
  await bind();
  const api = async (method = 'GET', body?: unknown, etag?: string) => {
    const url = new URL('https://fixture/agent/plan?chat_jid=web%3Adefault');
    const request = new Request(url, { method, headers: { Origin: 'https://fixture', 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return (await handleAgentRoutes(channel!, request, url.pathname, url))!;
  };
  // Open only after backend close: edit current-native metadata through public
  // SDK documents, never a v3 import or a concurrent second application Session.
  const inspectTools = async (change?: (tools: string[]) => string[]) => {
    const path = (db.query("PRAGMA database_list").all() as { name: string; file: string }[]).find(row => row.name === "main")!.file;
    const models = createHostModels(host, [model], { signal: new AbortController().signal, async authorize() {}, assertCurrent() { owner.assertCurrentOwner(); } });
    const harness = await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path, { root: db, assertOwner: () => owner.assertCurrentOwner(), fenceTransactions: true })), { models, registry: createRegistry() }, context);
    try { const app = await harness.root(context); return await app.commit(async tx => {
      const doc = await tx.doc(AgentDoc, app.id), current = doc.tools;
      if (!Array.isArray(current)) throw Error("Explicit native factory tool array required");
      const next = change ? change([...current]) : [...current]; if (change) doc.tools = next; return next;
    }, context); } finally { await harness.close(context); }
  };
  try {
    const fresh = await api(); expect(fresh.status).toBe(200); const initial = (await fresh.json() as any).plan;
    expect(initial.updated_at).toBe(installedLegacy ? 'original timestamp' : null);
    if (installedLegacy) expect(initial.markdown).toBe('> Authored legacy\n\n- [-] Legacy task');
    for (const origin of [undefined, 'https://untrusted.invalid']) {
      const deniedUrl = new URL('https://fixture/agent/plan?chat_jid=web%3Adefault');
      const denied = await handleAgentRoutes(channel!, new Request(deniedUrl, { method: 'POST',
        headers: { ...(origin ? { Origin: origin } : {}), 'If-Match': fresh.headers.get('etag')! }, body: JSON.stringify({ markdown: 'DENIED' }) }), deniedUrl.pathname, deniedUrl);
      expect(denied?.status).toBe(403);
    }
    const noChat = new URL('https://fixture/agent/plan');
    expect((await handleAgentRoutes(channel!, new Request(noChat), noChat.pathname, noChat))?.status).toBe(400);
    const sent = await handleAgentMessage(channel!, new Request('https://fixture/agent/default/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Make the plan', mode: 'auto' }) }), '/agent/default/message', 'web:default', 'default');
    expect(sent.status).toBe(201);
    const deadline = Date.now() + 5000;
    while (!db.query('SELECT 1 FROM messages WHERE is_terminal_agent_reply=1').get() && Date.now() < deadline) await Bun.sleep(10);
    expect(calls).toBe(2); expect(requests[0]).toContain('## Plan Sidebar'); expect(requests[1]).toContain('Core native plan');
    const read = await api(); const tag = read.headers.get('etag')!;
    expect((await read.json() as any).plan.markdown).toBe('- [x] Core native plan');
    expect((await api('POST', { markdown: '- [-] HTTP' }, tag)).status).toBe(200);
    expect((await api('POST', { markdown: 'stale' }, tag)).status).toBe(409);
    expect((await api('POST', { markdown: 'missing precondition' })).status).toBe(428);
    await backend.close(); await channel!.stop(); await base.queue.shutdown(); await pool!.shutdown();
    expect(await inspectTools(tools => tools.filter(name => name !== 'plan'))).not.toContain('plan');
    backend = await createRecoverableRuntimeBackend(() => createDefaultApplicationRuntime(owner, async () => services)); base = createRuntimeBaseServices({ dataDir: workspace }); await bind();
    expect((await (await api()).json() as any).plan.markdown).toBe('- [-] HTTP');
    expect(db.query("SELECT * FROM extension_kv WHERE extension_id='plan-sidebar'").all()).toEqual(originalLegacyRows);
    expect(existsSync(marker)).toBe(false);
    await backend.close(); await channel!.stop(); await base.queue.shutdown(); await pool!.shutdown();
    expect(await inspectTools()).toContain('plan');
    expect(await inspectTools(() => ['read'])).toEqual(['read']);
    const custom = await createDefaultApplicationRuntime(owner, async () => services);
    await custom.close();
    expect(await inspectTools()).toEqual(['read']);
  } finally { await backend.close(); await channel!.stop(); await base.queue.shutdown(); await pool!.shutdown(); await closeDatabase(); owner.release(); }
});
