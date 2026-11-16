import './src/test-guard.js';
import { expect } from 'bun:test';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { isolatedApplicationTest } from './src/isolated-application-test.js';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { storeChatMetadata } from '../../runtime/src/db.js';
import { acquireRuntimeLock } from '../../runtime/src/runtime/single-instance.js';
import { createDefaultApplicationRuntime } from '../../runtime/durable-engine/src/default-application-runtime.js';
import { createRuntimeBaseServices } from '../../runtime/src/runtime/composition.js';
import { createTestCredentialStore } from '../../runtime/test/model-services-fixture.js';
import { AgentPool } from '../../runtime/src/agent-pool.js';
import { WebChannel } from '../../runtime/src/channels/web.js';
import { handleAgentMessage } from '../../runtime/src/channels/web/handlers/agent.js';
import { ModelRuntime } from '../../node_modules/@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentTools } from '../../node_modules/@earendil-works/pi-ai';
import { admitAddonLocalRequest } from '../../runtime/src/addons/local-context.js';
import { handleRegisteredAddonConfigApiRequest } from '../../runtime/src/channels/web/handlers/addon-config-api.js';

const applicationTest = isolatedApplicationTest(import.meta.url);
for (const installedLegacy of [false, true]) for (const approved of [false, true]) applicationTest(`Core Delegate fresh tool and Settings; installedLegacy=${installedLegacy}; approved=${approved}`, async () => {
  const workspace = process.env.PICLAW_WORKSPACE!;
  const marker = join(workspace, 'retired-delegate-evaluated');
  if (installedLegacy) {
    const pkg = join(workspace, '.pi/extensions/node_modules/@rcarmo/piclaw-addon-delegate');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@rcarmo/piclaw-addon-delegate', version: '99.0.0', type: 'module', pi: { extensions: ['index.ts'], web: { entries: ['web.ts'] } } }));
    const poison = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'BAD'); throw Error('RETIRED_DELEGATE_MUST_NOT_IMPORT');`;
    writeFileSync(join(pkg, 'index.ts'), poison); writeFileSync(join(pkg, 'web.ts'), poison);
  }
  process.env.PICLAW_DB_IN_MEMORY = '0'; initDatabase(); storeChatMetadata('web:default', new Date().toISOString());
  const root = getDb(), original = root.query("SELECT * FROM extension_kv WHERE extension_id='delegate'").all();
  const owner = acquireRuntimeLock({ lockPath: join(workspace, 'core-delegate.lock'), strictOwnership: true, disabled: false });
  const credentials = createTestCredentialStore({});
  const common = { provider: 'fixture', api: 'openai-completions', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const parent = { ...common, id: 'gpt-6.1-sol', name: 'Parent' }, child = { ...common, id: 'gpt-5.4-mini', name: 'Child' };
  const host = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, refreshOnCreate: false, allowModelNetwork: false });
  let children = 0; const offered: string[][] = [];
  const stream = (physical: any, transcript: any) => {
    const isChild = physical.id === child.id;
    if (isChild) { children++; expect(JSON.stringify(transcript)).not.toContain('PARENT_PRIVATE'); }
    else offered.push(getCurrentTools(transcript.messages).map(tool => tool.name));
    const called = transcript.messages.some((message: any) => message.role === 'toolResult');
    const content = !isChild && !called ? [{ type: 'toolCall', id: 'core-delegate', name: 'delegate', arguments: { prompt: 'CHILD_STANDALONE', model: 'fixture/gpt-5.4-mini', tools: 'read_only' } }]
      : [{ type: 'text', text: isChild ? 'CHILD_RESULT' : 'PARENT_DONE' }];
    const message: any = { role: 'assistant', api: physical.api, provider: physical.provider, model: physical.id, timestamp: Date.now(), content,
      stopReason: content[0].type === 'toolCall' ? 'toolUse' : 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const output = createAssistantMessageEventStream(); queueMicrotask(() => { output.push({ type: 'done', reason: message.stopReason, message }); output.end(message); }); return output;
  };
  host.registerNativeProvider({ id: 'fixture', name: 'Fixture', getModels: () => [parent, child] as any, auth: { apiKey: { name: 'Keyless', resolve: async () => ({ auth: {}, source: 'fixture' }) } }, stream: stream as any, streamSimple: stream as any });
  await host.refresh({ allowNetwork: false });
  const services: any = { modelRuntime: host, modelRegistry: { getAvailable: () => [parent, child] } };
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined, pool: AgentPool | undefined, channel: WebChannel | undefined;
  const base = createRuntimeBaseServices({ dataDir: workspace });
  const request = async (action: string, method = 'GET', body?: unknown, authorized = true) => {
    const req = new Request(`https://fixture/agent/addons/api/delegate/${action}`, { method, headers: { Origin: 'https://fixture', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (authorized) admitAddonLocalRequest(req, { kind: 'user', userId: 'default', username: 'fixture', displayName: 'Fixture', role: 'admin', mode: 'single-user', homeChatJid: 'web:default', authentication: { method: 'fixture', sessionId: 'fixture', expiresAt: null } }, () => !req.signal.aborted);
    return handleRegisteredAddonConfigApiRequest(req, 'delegate', action, (data, status = 200) => Response.json(data, { status }));
  };
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    pool = new AgentPool({ credentialStore: credentials, modelRuntime: host, modelRegistry: services.modelRegistry, ...backend.sessionOptions } as any);
    channel = new WebChannel(backend.bind({ queue: base.queue, agentPool: pool })); await backend.attachChannel!(channel);
    const initial = await request('models'); expect(initial?.status).toBe(200);
    const snapshot: any = await initial!.json(); expect(snapshot.source).toBe('native'); expect(snapshot.candidates).toEqual([]);
    expect(root.query("SELECT * FROM extension_kv WHERE extension_id='delegate'").all()).toEqual(original);
    const denied = await request('config', 'POST', { searchable_providers: ['fixture'] }, false);
    expect(denied!.status).toBeGreaterThanOrEqual(400);
    expect(root.query("SELECT * FROM extension_kv WHERE extension_id='delegate'").all()).toEqual(original);
    if (approved) expect((await request('config', 'POST', { searchable_providers: ['fixture'], excluded_models: [] }))!.status).toBe(200);
    const current: any = await (await request('models'))!.json();
    expect(current.candidates.map((model: any) => model.id)).toEqual(approved ? ['fixture/gpt-5.4-mini', 'fixture/gpt-6.1-sol'] : []);
    expect(JSON.stringify(current)).not.toMatch(/api_key|synthetic-only|access_token|Authorization/);
    const response = await handleAgentMessage(channel, new Request('https://fixture/agent/default/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'PARENT_PRIVATE', mode: 'auto' }) }), '/agent/default/message', 'web:default', 'default');
    expect(response.status).toBe(201);
    const deadline = Date.now() + 10000;
    while (!root.query('SELECT 1 FROM messages WHERE is_terminal_agent_reply=1').get() && Date.now() < deadline) await Bun.sleep(10);
    expect(offered[0]).toContain('delegate'); expect(offered).toHaveLength(2); expect(children).toBe(approved ? 1 : 0);
    expect(existsSync(marker)).toBe(false);
    expect(root.query("SELECT value FROM extension_kv WHERE extension_id='delegate' AND key='config' AND scope='global' AND scope_key=''").all()).toHaveLength(approved ? 1 : 0);
    const saved = root.query("SELECT * FROM extension_kv WHERE extension_id='delegate'").all(), callsBefore = offered.length;
    await backend.close(); await channel.stop(); await pool.shutdown(); await base.queue.shutdown();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(root.query("SELECT * FROM extension_kv WHERE extension_id='delegate'").all()).toEqual(saved);
    expect((await (await request('models'))!.json() as any).candidates.map((model: any) => model.id)).toEqual(approved ? ['fixture/gpt-5.4-mini', 'fixture/gpt-6.1-sol'] : []);
    expect(offered.length).toBe(callsBefore); expect(children).toBe(approved ? 1 : 0); expect(existsSync(marker)).toBe(false);
  } finally { await backend?.close(); await channel?.stop(); await base.queue.shutdown(); await pool?.shutdown(); await closeDatabase(); owner.release(); }
});
