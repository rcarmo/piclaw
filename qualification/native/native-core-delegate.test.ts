import './src/test-guard.js';
import { expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { isolatedApplicationTest } from './src/isolated-application-test.js';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { extensionKvGet, extensionKvSet } from '../../runtime/src/db/extension-kv.js';
import { storeChatMetadata } from '../../runtime/src/db.js';
import { acquireRuntimeLock } from '../../runtime/src/runtime/single-instance.js';
import { createDefaultApplicationRuntime } from '../../runtime/durable-engine/src/default-application-runtime.js';
import { createRuntimeBaseServices } from '../../runtime/src/runtime/composition.js';
import { createTestCredentialStore } from '../../runtime/test/model-services-fixture.js';
import { AgentPool } from '../../runtime/src/agent-pool.js';
import { WebChannel } from '../../runtime/src/channels/web.js';
import { handleAgentMessage } from '../../runtime/src/channels/web/handlers/agent.js';
import { ModelRuntime } from '../../node_modules/@earendil-works/pi-coding-agent';
import { createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools, toToolDeclaration } from '../../node_modules/@earendil-works/pi-ai';
import { admitAddonLocalRequest } from '../../runtime/src/addons/local-context.js';
import { handleRegisteredAddonConfigApiRequest } from '../../runtime/src/channels/web/handlers/addon-config-api.js';

const applicationTest = isolatedApplicationTest(import.meta.url);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
// Freeze only the model-facing Delegate bytes from main before #2105 (5d850c4d5).
const delegateDeclarationHash = '0509256753bfd0e28113f01ab145c0c53e2e6697b872158c4a1da17328a6823c';
const delegateInstructionsHash = 'f5cf78b6911f3aae33229b2bc9b31bb64229adee711c426b7fce854182d4d9a4';
type Selection = 'explicit-child' | 'explicit-parent' | 'omitted' | 'fallback-revoked' | 'unavailable-whitelist' | 'invalid-whitelist';
const scenarios: { childModelId: string; installedLegacy: boolean; approved: boolean; credentialed: boolean; selection: Selection }[] = [];
for (const childModelId of ['gpt-5.4-mini', 'mai-code-2', 'mai-code-2-flash', 'gpt-6.1-terra']) for (const installedLegacy of [false, true]) for (const approved of [false, true]) for (const credentialed of [false, true]) {
  scenarios.push({childModelId, installedLegacy, approved, credentialed, selection:'explicit-child'});
}
for (const [selection, approved] of [['omitted',false],['omitted',true],['explicit-parent',false],['explicit-parent',true],['fallback-revoked',false],['unavailable-whitelist',false],['invalid-whitelist',false]] as const) {
  scenarios.push({childModelId:'gpt-6.1-terra', installedLegacy:false, approved, credentialed:false, selection});
}
for (const { childModelId, installedLegacy, approved, credentialed, selection } of scenarios) applicationTest(`Core Delegate fresh tool and Settings; child=${childModelId}; installedLegacy=${installedLegacy}; approved=${approved}; credentialed=${credentialed}; selection=${selection}`, async () => {
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
  const root = getDb();
  if (selection === 'unavailable-whitelist' || selection === 'invalid-whitelist') root.transaction(() => extensionKvSet('delegate', 'config', {
    approved_models: [selection === 'unavailable-whitelist' ? 'missing/approved-model' : 'invalid'],
  }, 'global'))();
  const original = root.query("SELECT * FROM extension_kv WHERE extension_id='delegate'").all();
  const owner = acquireRuntimeLock({ lockPath: join(workspace, 'core-delegate.lock'), strictOwnership: true, disabled: false });
  const common = { provider: 'fixture', api: 'openai-completions', baseUrl: 'https://fixture.invalid', input: ['text'], reasoning: false, contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const parent = { ...common, provider: credentialed ? 'fixture-parent' : 'fixture', id: 'gpt-6.1-sol', name: 'Parent' };
  const child = { ...common, provider: credentialed ? 'fixture-child' : 'fixture', id: childModelId, name: 'Child' };
  const keys: Record<string, string> = { [parent.provider]: 'SYNTHETIC_PARENT_AUTH', [child.provider]: 'SYNTHETIC_CHILD_AUTH', unrelated: 'SYNTHETIC_UNRELATED_AUTH' };
  const credentials = createTestCredentialStore(credentialed ? Object.fromEntries(Object.entries(keys).map(([id, key]) => [id, { type: 'api_key' as const, key }])) : {});
  const searchable = [...new Set([parent.provider, child.provider])];
  const childSlug = `${child.provider}/${child.id}`, parentSlug = `${parent.provider}/${parent.id}`;
  const migrate = approved && installedLegacy && !credentialed && childModelId === 'gpt-5.4-mini';
  if (migrate) root.transaction(() => extensionKvSet('delegate', 'config', { searchable_providers: searchable, excluded_models: [parent.id] }, 'global'))();
  const expectedCandidates = approved ? [childSlug] : [];
  const expectedModel = selection === 'omitted' ? (approved ? childSlug : parentSlug)
    : selection === 'explicit-parent' ? (approved ? undefined : parentSlug)
    : selection === 'fallback-revoked' ? parentSlug : (approved ? childSlug : undefined);
  const requestedModel = selection === 'explicit-parent' ? parentSlug : selection === 'explicit-child' ? childSlug : undefined;
  const childModels: string[] = [];
  const childEntered = Promise.withResolvers<void>(), releaseChild = Promise.withResolvers<void>();
  const host = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, refreshOnCreate: false, allowModelNetwork: false });
  let children = 0; const offered: string[][] = [];
  const requests: { provider: string; model: string; apiKey: string | undefined; options: string; transcript: string }[] = [];
  const parentContexts: { instructions: string; declaration: string; tools: string; sessionId?: string }[] = [];
  const stream = (physical: any, transcript: any, options?: { apiKey?: string; sessionId?: string }) => {
    requests.push({ provider: physical.provider, model: physical.id, apiKey: options?.apiKey, options: JSON.stringify(options ?? {}), transcript: JSON.stringify(transcript) });
    const isChild = transcript.messages.some((message: any) => message.role === 'user' && JSON.stringify(message.content).includes('CHILD_STANDALONE'));
    if (isChild) { children++; childModels.push(`${physical.provider}/${physical.id}`); expect(JSON.stringify(transcript)).not.toContain('PARENT_PRIVATE'); }
    else {
      const tools = getCurrentTools(transcript.messages).map(toToolDeclaration);
      offered.push(tools.map(tool => tool.name));
      parentContexts.push({ instructions: getCurrentSystemPrompt(transcript.messages),
        declaration: JSON.stringify(tools.find(tool => tool.name === 'delegate')), tools: JSON.stringify(tools), sessionId: options?.sessionId });
    }
    const lastUser = transcript.messages.findLastIndex((message: any) => message.role === 'user');
    const called = transcript.messages.slice(lastUser).some((message: any) => message.role === 'toolResult');
    const content = !isChild && !called ? [{ type: 'toolCall', id: 'core-delegate', name: 'delegate', arguments: { prompt: 'CHILD_STANDALONE', ...(requestedModel ? { model: requestedModel } : {}), tools: 'read_only' } }]
      : [{ type: 'text', text: isChild ? 'CHILD_RESULT' : 'PARENT_DONE' }];
    const message: any = { role: 'assistant', api: physical.api, provider: physical.provider, model: physical.id, timestamp: Date.now(), content,
      stopReason: content[0].type === 'toolCall' ? 'toolUse' : 'stop', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
    const output = createAssistantMessageEventStream();
    const finish = () => { output.push({ type: 'done', reason: message.stopReason, message }); output.end(message); };
    if (isChild && selection === 'fallback-revoked') { childEntered.resolve(); void releaseChild.promise.then(finish); }
    else queueMicrotask(finish);
    return output;
  };
  for (const id of searchable) host.registerNativeProvider({ id, name: credentialed ? id : 'Fixture', getModels: () => [parent, child].filter(model => model.provider === id) as any,
    auth: { apiKey: { name: credentialed ? 'Stored synthetic' : 'Keyless', resolve: async ({ credential }) => credentialed
      ? credential?.key === undefined ? undefined : { auth: { apiKey: credential.key }, source: 'fixture-store' }
      : { auth: {}, source: 'fixture' } } }, stream: stream as any, streamSimple: stream as any });
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
    const snapshot: any = await initial!.json(); expect(snapshot.source).toBe('native'); expect(snapshot.candidates.map((entry: any) => entry.id)).toEqual(migrate ? [childSlug] : []);
    if (childModelId === 'gpt-6.1-terra') expect(snapshot.available).toContainEqual(expect.objectContaining({ id: childSlug, tier: 3, classificationRule: 'default' }));
    const migratedRows = root.query("SELECT * FROM extension_kv WHERE extension_id='delegate'").all();
    if (!migrate) expect(migratedRows).toEqual(original);
    else expect(extensionKvGet("delegate", "config", "global")).toEqual({ approved_models: [childSlug], provider_order: searchable });
    const denied = await request('config', 'POST', { add_model: childSlug }, false);
    expect(denied!.status).toBeGreaterThanOrEqual(400);
    expect(root.query("SELECT * FROM extension_kv WHERE extension_id='delegate'").all()).toEqual(migratedRows);
    expect((await request('config', 'POST', { add_model: `${parentSlug}-unknown` }))!.status).toBeGreaterThanOrEqual(400);
    expect((await request('config', 'POST', { searchable_providers: searchable }))!.status).toBeGreaterThanOrEqual(400);
    if (approved && !migrate) expect((await request('config', 'POST', { add_model: childSlug }))!.status).toBe(200);
    const current: any = await (await request('models'))!.json();
    expect(current.candidates.map((model: any) => model.id)).toEqual(expectedCandidates);
    expect(JSON.stringify(current)).not.toMatch(/api_key|synthetic-only|access_token|Authorization/);
    const response = await handleAgentMessage(channel, new Request('https://fixture/agent/default/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'PARENT_PRIVATE', mode: 'auto' }) }), '/agent/default/message', 'web:default', 'default');
    expect(response.status).toBe(201);
    if (selection === "fallback-revoked") {
      await childEntered.promise;
      expect((await request("config", "POST", { add_model: childSlug }))!.status).toBe(200);
      releaseChild.resolve();
    }
    const deadline = Date.now() + 10000;
    while (!root.query('SELECT 1 FROM messages WHERE is_terminal_agent_reply=1').get() && Date.now() < deadline) await Bun.sleep(10);
    expect(offered[0]).toContain('delegate'); expect(offered).toHaveLength(2);
    expect(childModels).toEqual(expectedModel ? [expectedModel] : []);
    const initialPrompt = parentContexts[0]!;
    const delegateBlock = initialPrompt.instructions.split('\n\n').find(block => block.startsWith('## Delegate tool\n'));
    expect(typeof delegateBlock).toBe('string');
    expect(sha256(delegateBlock!)).toBe(delegateInstructionsHash);
    expect(sha256(initialPrompt.declaration)).toBe(delegateDeclarationHash);
    expect(initialPrompt.sessionId).toBeTruthy();
    expect(parentContexts[1]).toEqual(initialPrompt);
    expect(existsSync(marker)).toBe(false);
    expect(root.query("SELECT value FROM extension_kv WHERE extension_id='delegate' AND key='config' AND scope='global' AND scope_key=''").all()).toHaveLength(approved || original.length || selection === "fallback-revoked" ? 1 : 0);
    const firstEntries = JSON.stringify(root.query('SELECT record FROM entries').all());
    const parentTranscript = requests.at(-1)!.transcript;
    expect(parentTranscript.includes('CHILD_RESULT')).toBe(!!expectedModel && selection !== "fallback-revoked");
    if (!expectedModel || selection === "fallback-revoked") {
      const message = selection === 'unavailable-whitelist' ? 'No whitelisted Delegate model is currently available'
        : selection === 'invalid-whitelist' ? 'Invalid Delegate whitelist'
        : approved || selection === "fallback-revoked" ? `Delegate model ${parentSlug} is not in the whitelist`
        : `Delegate model ${childSlug} does not match the chat model ${parentSlug}`;
      expect(parentTranscript).toContain(message);
    }
    // Assert outside provider callbacks: SDK error conversion must not hide a
    // swallowed callback assertion or substitute a different credential/model.
    for (const call of requests) {
      if (credentialed) {
        expect(call.apiKey).toBe(keys[call.provider]);
        for (const [provider, key] of Object.entries(keys)) if (provider !== call.provider) expect(call.options).not.toContain(key);
      }
      if (call.model === child.id) expect(call.transcript).not.toContain('PARENT_PRIVATE');
      for (const key of Object.values(keys)) expect(call.transcript).not.toContain(key);
    }
    for (const key of Object.values(keys)) { expect(firstEntries).not.toContain(key); expect(JSON.stringify(current)).not.toContain(key); }
    if (credentialed && approved) {
      await host.logout(child.provider); // Synthetic provider/store only; no server revocation.
      expect(await credentials.read(parent.provider)).toMatchObject({ key: keys[parent.provider] });
      expect(await credentials.read('unrelated')).toMatchObject({ key: keys.unrelated });
      expect(await credentials.read(child.provider)).toBeUndefined();
      const before = requests.length;
      const response = await handleAgentMessage(channel, new Request('https://fixture/agent/default/message', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'PARENT_PRIVATE_SECOND', mode: 'auto' }) }), '/agent/default/message', 'web:default', 'default');
      expect(response.status).toBe(201);
      const deadline = Date.now() + 10000;
      while ((root.query('SELECT count(*) n FROM messages WHERE is_terminal_agent_reply=1').get() as { n: number }).n < 2 && Date.now() < deadline) await Bun.sleep(10);
      expect((root.query('SELECT count(*) n FROM messages WHERE is_terminal_agent_reply=1').get() as { n: number }).n).toBe(2);
      expect(children).toBe(1); expect(offered).toHaveLength(4);
      expect(requests.slice(before).map(call => [call.provider, call.model])).toEqual([[parent.provider, parent.id], [parent.provider, parent.id]]);
      for (const call of requests.slice(before)) {
        expect(call.apiKey).toBe(keys[parent.provider]);
        for (const key of Object.values(keys)) expect(call.transcript).not.toContain(key);
        for (const [provider, key] of Object.entries(keys)) if (provider !== call.provider) expect(call.options).not.toContain(key);
      }
      const afterLogoutEntries = JSON.stringify(root.query('SELECT record FROM entries').all());
      for (const key of Object.values(keys)) expect(afterLogoutEntries).not.toContain(key);
    }
    if (migrate) {
      const removed = await request('config', 'POST', { remove_model: childSlug });
      expect(removed!.status).toBe(200);
      expect(extensionKvGet("delegate", "config", "global")).toEqual({ approved_models: [], provider_order: searchable });
      const response = await handleAgentMessage(channel, new Request('https://fixture/agent/default/message', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'AFTER_REVOCATION', mode: 'auto' }),
      }), '/agent/default/message', 'web:default', 'default');
      expect(response.status).toBe(201);
      const terminalCount = () => (root.query('SELECT count(*) n FROM messages WHERE is_terminal_agent_reply=1').get() as { n: number }).n;
      const deadline = Date.now() + 10000;
      while (terminalCount() < 2 && Date.now() < deadline) await Bun.sleep(10);
      expect(terminalCount()).toBe(2);
      expect(offered).toHaveLength(4);
      expect(children).toBe(1);
    }
    // A changed approval affects selection/results, not the parent prompt or cache identity.
    for (const prompt of parentContexts) expect(prompt).toEqual(initialPrompt);
    const beforeReopen = (await (await request('models'))!.json() as any).candidates.map((model: any) => model.id);
    const saved = root.query("SELECT * FROM extension_kv WHERE extension_id='delegate'").all(), callsBefore = offered.length;
    await backend.close(); await channel.stop(); await pool.shutdown(); await base.queue.shutdown();
    backend = await createDefaultApplicationRuntime(owner, async () => services);
    expect(root.query("SELECT * FROM extension_kv WHERE extension_id='delegate'").all()).toEqual(saved);
    expect((await (await request('models'))!.json() as any).candidates.map((model: any) => model.id)).toEqual(credentialed || migrate || selection === "fallback-revoked" ? beforeReopen : expectedCandidates);
    expect(offered.length).toBe(callsBefore); expect(children).toBe(expectedModel ? 1 : 0); expect(existsSync(marker)).toBe(false);
    if (credentialed && approved) {
      expect(await credentials.read(child.provider)).toBeUndefined();
      expect(await credentials.read(parent.provider)).toMatchObject({ key: keys[parent.provider] });
      expect(await credentials.read('unrelated')).toMatchObject({ key: keys.unrelated });
    }
  } finally { releaseChild.resolve(); await backend?.close(); await channel?.stop(); await base.queue.shutdown(); await pool?.shutdown(); await closeDatabase(); owner.release(); }
});
