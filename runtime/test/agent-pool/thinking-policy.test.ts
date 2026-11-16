import { afterAll, afterEach, expect, test } from 'bun:test';
import { createAgentSession, DefaultResourceLoader, ModelRegistry, ModelRuntime, SessionManager, SettingsManager, type AgentSession, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, type Model } from '@earendil-works/pi-ai';
import { createTempWorkspace } from '../helpers.js';
import { getSessionThinkingPolicy, getThinkingDefaults, installSessionThinkingPolicy, readThinkingPreference } from '../../src/agent-pool/thinking-policy.js';

const ws = createTempWorkspace('thinking-policy-');
const sessions: AgentSession[] = [];
afterAll(() => ws.cleanup());
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); });
// Each fixture uses private settings/auth storage; no provider requests or shared defaults.
const model = (provider: string, id: string, reasoning = true): Model<'openai-responses'> => ({ provider, id, name: id, api: 'openai-responses', baseUrl: 'https://example.invalid', reasoning, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 });
const models = [model('fixture-copilot', 'a'), model('fixture-openai', 'b'), model('fixture-anthropic', 'c'), model('fixture-openai', 'plain', false)];
async function fixture(options: { install?: boolean; settings?: SettingsManager; manager?: SessionManager; scoped?: any[]; extension?: (pi: ExtensionAPI) => void } = {}) {
  const settings = options.settings ?? SettingsManager.inMemory({ defaultThinkingLevel: 'low', compaction: { enabled: false } });
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStorePath: null, allowModelNetwork: false });
  for (const provider of new Set(models.map(m => m.provider))) runtime.registerNativeProvider({ id: provider, name: provider, auth: { apiKey: { name: 'fixture', resolve: async () => ({ auth: { apiKey: 'fixture-only' }, source: 'fixture' }) } }, getModels: () => models.filter(m => m.provider === provider), stream: () => { throw new Error('No provider calls allowed'); } } as any);
  await runtime.refresh({ allowNetwork: false });
  const loader = new DefaultResourceLoader({ cwd: ws.workspace, agentDir: ws.workspace, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, extensionFactories: options.extension ? [options.extension] : [] });
  await loader.reload();
  const preference = options.manager ? readThinkingPreference(options.manager.getBranch()) : null;
  const { session } = await createAgentSession({ cwd: ws.workspace, agentDir: ws.workspace, modelRuntime: runtime, settingsManager: settings, resourceLoader: loader, sessionManager: options.manager ?? SessionManager.inMemory(ws.workspace), model: options.manager?.buildSessionContext().model ? models.find(m => m.provider === options.manager!.buildSessionContext().model!.provider && m.id === options.manager!.buildSessionContext().model!.modelId) : models[0], thinkingLevel: options.manager ? options.manager.buildSessionContext().thinkingLevel : 'high', scopedModels: options.scoped, tools: [] });
  sessions.push(session);
  if (options.install !== false) installSessionThinkingPolicy(session, preference);
  return { session, settings, runtime };
}

test('upstream default-first selection reproduces high to low; installed policy preserves high', async () => {
  const baseline = await fixture({ install: false });
  await baseline.session.setModel(models[1]); expect(baseline.session.thinkingLevel).toBe('low');
  const { session, settings } = await fixture();
  const before = settings.getGlobalSettings();
  for (const target of [models[1], models[2], models[0]]) {
    await session.setModel(target); expect(session.thinkingLevel).toBe('high');
    expect(getSessionThinkingPolicy(session)?.last_transition).toMatchObject({ source: 'session', requested: 'high', effective: 'high', clamped: false });
  }
  expect(settings.getGlobalSettings()).toEqual(before);
  expect(session.sessionManager.getBranch().filter(entry => entry.type === 'thinking_level_change').map(entry => entry.thinkingLevel)).not.toContain('low');
});

test('explicit lower levels survive model switches and non-reasoning clamping does not erase intent', async () => {
  const { session } = await fixture();
  session.setThinkingLevel('medium'); await session.setModel(models[3]); expect(session.thinkingLevel).toBe('off');
  expect(getSessionThinkingPolicy(session)?.preferred_level).toBe('medium');
  expect(getSessionThinkingPolicy(session)?.last_transition?.clamped).toBe(true);
  await session.setModel(models[1]); expect(session.thinkingLevel).toBe('medium');
  session.setThinkingLevel('low'); await session.setModel(models[0]); expect(session.thinkingLevel).toBe('low');
});

test('target-model and scoped-cycle preferences override session choice without rewriting it', async () => {
  const settings = SettingsManager.inMemory({ defaultThinkingLevel: 'low', modelThinkingLevels: { 'fixture-openai/b': 'medium' } });
  const { session } = await fixture({ settings, scoped: [{ model: models[0] }, { model: models[1], thinkingLevel: 'low' }, { model: models[2] }] });
  await session.setModel(models[1]); expect(session.thinkingLevel).toBe('medium');
  expect(getSessionThinkingPolicy(session)?.last_transition?.source).toBe('model_default');
  await session.setModel(models[0]); expect(session.thinkingLevel).toBe('high');
  const cycle = await session.cycleModel(); expect(cycle?.thinkingLevel).toBe('low');
  expect(getSessionThinkingPolicy(session)?.last_transition?.source).toBe('scoped_model');
  await session.cycleModel(); expect(session.thinkingLevel).toBe('high');
  expect(settings.getDefaultThinkingLevel()).toBe('low');
});

test('explicit SDK and extension APIs share the policy', async () => {
  let api!: ExtensionAPI;
  const { session, runtime } = await fixture({ extension: pi => { api = pi; } });
  await session.bindExtensions({});
  const registry = new ModelRegistry(runtime);
  await session.setModel(models[1]);
  expect(session.thinkingLevel).toBe('high');
  expect(await api.setModel(models[2])).toBe(true); expect(session.thinkingLevel).toBe('high');
  api.setThinkingLevel('low'); await api.setModel(models[0]); expect(session.thinkingLevel).toBe('low');
  session.setThinkingLevel('high');
  const cycled = await session.cycleModel();
  expect(cycled?.thinkingLevel).toBe(session.thinkingLevel);
});

test('two concurrent sessions never exchange intent or mutate shared settings', async () => {
  const shared = SettingsManager.inMemory({ defaultThinkingLevel: 'low' });
  const a = await fixture({ settings: shared }), b = await fixture({ settings: shared });
  a.session.setThinkingLevel('high'); b.session.setThinkingLevel('minimal');
  await Promise.all([a.session.setModel(models[1]), b.session.setModel(models[2])]);
  expect(a.session.thinkingLevel).toBe('high'); expect(b.session.thinkingLevel).toBe('minimal');
  expect(shared.getDefaultThinkingLevel()).toBe('low');
});

test('real SDK settings merge exposes project provenance without paths or unrelated secrets', () => {
  let writes = 0;
  const settings = SettingsManager.fromStorage({ withLock(scope, fn) {
    const result = fn(JSON.stringify({ defaultThinkingLevel: scope === 'global' ? 'high' : 'low', arbitrarySecret: 'must-not-leak' }));
    if (result !== undefined) writes++;
  } });
  expect(getThinkingDefaults(settings)).toEqual({ level: 'low', source: 'project' });
  expect(JSON.stringify(getThinkingDefaults(settings))).not.toContain('must-not-leak');
  expect(writes).toBe(0);
});

test('reinstallation is idempotent and metadata records only bounded choices', async () => {
  const { session } = await fixture(); installSessionThinkingPolicy(session);
  await session.setModel(models[1]);
  const records = session.sessionManager.getBranch().filter(e => e.type === 'custom' && e.customType === 'piclaw.thinking-policy.v1');
  expect(records.length).toBe(1);
  expect(Object.keys((records[0] as any).data).sort()).toEqual(['clamped', 'effective', 'operation', 'preferred', 'previous', 'requested', 'source']);
});


test('resume retains effective clamp and preferred choice', async () => {
  const { session } = await fixture();
  session.setThinkingLevel('high'); await session.setModel(models[3]);
  const reopened = SessionManager.inMemory(ws.workspace, { id: 'fixture-resume' }, session.sessionManager.getEntries());
  const restored = await fixture({ manager: reopened });
  expect(getSessionThinkingPolicy(restored.session)?.preferred_level).toBe('high');
  await restored.session.setModel(models[1]); expect(restored.session.thinkingLevel).toBe('high');
});

test('restoration uses active branch and newer explicit SDK level instead of stale policy metadata', async () => {
  const { readThinkingPreference } = await import('../../src/agent-pool/thinking-policy.js');
  const manager = SessionManager.inMemory(ws.workspace);
  const root = manager.appendThinkingLevelChange('medium');
  manager.appendCustomEntry('piclaw.thinking-policy.v1', { preferred: 'high' });
  manager.appendThinkingLevelChange('low');
  expect(readThinkingPreference(manager.getBranch())).toBe('low');
  manager.branch(root); expect(readThinkingPreference(manager.getBranch())).toBe('medium');
  const { session } = await fixture({ manager });
  await session.setModel(models[1]); expect(session.thinkingLevel).toBe('medium');
});

test('a rejected model switch leaves preference, effective level and policy history untouched', async () => {
  const { session } = await fixture();
  const before = session.sessionManager.getEntries().length;
  await expect(session.setModel(model('missing-provider', 'unconfigured'))).rejects.toThrow('No API key');
  expect(session.thinkingLevel).toBe('high'); expect(getSessionThinkingPolicy(session)?.last_transition?.operation).toBe('restore');
  expect(session.sessionManager.getEntries().length).toBe(before);
});

test('extension model-select thinking override is explicit, not mistaken for internal clamping', async () => {
  const { session } = await fixture({ extension: pi => {
    pi.on('model_select', () => pi.setThinkingLevel('low'));
  } });
  await session.bindExtensions({});
  await session.setModel(models[1]);
  expect(session.thinkingLevel).toBe('low');
  expect(getSessionThinkingPolicy(session)?.preferred_level).toBe('low');
  expect(getSessionThinkingPolicy(session)?.last_transition?.operation).toBe('thinking_set');
});

test('native status ignores the installed legacy thinking policy and preserves settings', async () => {
  const { session, settings, runtime } = await fixture();
  session.setThinkingLevel('high');
  await session.setModel(models[1]); expect(session.thinkingLevel).toBe('high');
  expect(getSessionThinkingPolicy(session)?.defaults).toEqual({ level: 'low', source: 'global' });
  const { AgentRuntimeFacade } = await import('../../src/agent-pool/runtime-facade.js');
  const registry = new ModelRegistry(runtime);
  const facade = new AgentRuntimeFacade({ pool: new Map([['fixture', { session, lastUsed: Date.now() }]]), getDurableSession: () => ({sessionId:'native-metadata',branchId:'main',readPosition:async()=>null,readState:async()=>({position:null,model:'fixture-openai/b',thinkingLevel:'high'})}), modelRegistry: registry, settingsManager: settings, modelRuntime: runtime, authPath: 'synthetic-unused' } as any);
  const status = await facade.getAvailableModels('fixture', { includeProviderUsage: false, includeProviderDiagnostics: false });
  expect(status).toMatchObject({current:'fixture-openai/b',thinking_level:'high',thinking_level_label:'high'});
  expect(status.thinking_policy).toBeNull();
  expect(settings.getDefaultThinkingLevel()).toBe('low');
  expect(JSON.stringify(status)).not.toContain(ws.workspace);
}, 20_000);

test('two successive cold hydrations do not replace preferred high with the effective off clamp', async () => {
  const { session } = await fixture(); await session.setModel(models[3]);
  let entries = session.sessionManager.getEntries();
  for (let i = 0; i < 2; i++) {
    const manager = SessionManager.inMemory(ws.workspace, { id: 'cold-' + i }, entries);
    const resumed = await fixture({ manager });
    expect(resumed.session.thinkingLevel).toBe('off');
    expect(getSessionThinkingPolicy(resumed.session)?.preferred_level).toBe('high');
    entries = resumed.session.sessionManager.getEntries();
  }
});

test('compaction retains preferred intent separately from effective level',async()=>{
  const {session}=await fixture();await session.setModel(models[3]);
  const leaf=session.sessionManager.appendMessage({role:'user',content:'synthetic',timestamp:Date.now()});
  session.sessionManager.appendCompaction('synthetic summary',leaf,100);
  expect(readThinkingPreference(session.sessionManager.getBranch())).toBe('high');
});

test('new settings provenance handles global, project, untrusted and runtime overrides', () => {
  const settings = SettingsManager.fromStorage({ withLock(scope, fn) { const result = fn(JSON.stringify({ defaultThinkingLevel: scope === 'global' ? 'high' : 'low' })); if(result!==undefined)throw Error('Unexpected write'); } }, { projectTrusted: false });
  expect(getThinkingDefaults(settings)).toEqual({ level: 'high', source: 'global' });
  settings.applyOverrides({ defaultThinkingLevel: 'medium' });
  expect(getThinkingDefaults(settings)).toEqual({ level: 'medium', source: 'override' });
});



test('restoration metadata belongs only to the selected branch, not future preference changes', async () => {
  const { session } = await fixture();
  const old = session.sessionManager.getLeafId();
  session.setThinkingLevel('minimal');
  session.sessionManager.branch(old!);
  expect(readThinkingPreference(session.sessionManager.getBranch())).toBe('high');
});


test('native max and restricted target capabilities clamp without erasing preference', async () => {
  const { session } = await fixture();
  const max = { ...models[1], thinkingLevelMap: { max: 'max', xhigh: 'xhigh' } };
  await session.setModel(max); session.setThinkingLevel('max'); expect(session.thinkingLevel).toBe('max');
  await session.setModel(models[0]); expect(session.thinkingLevel).toBe('high');
  expect(getSessionThinkingPolicy(session)?.preferred_level).toBe('max');
  await session.setModel(max); expect(session.thinkingLevel).toBe('max');
  session.setThinkingLevel('high');
  await session.setModel({ ...models[2], thinkingLevelMap: { off: null, minimal: null, medium: null, high: null, xhigh: null, max: null } });
  expect(session.thinkingLevel).toBe('low'); expect(getSessionThinkingPolicy(session)?.preferred_level).toBe('high');
  await session.setModel(models[0]); expect(session.thinkingLevel).toBe('high');
});


test('restore keeps effective choice and resumes session preference on next model', async () => {
  const { restoreSessionThinkingPolicy } = await import('../../src/agent-pool/thinking-policy.js');
  const { session } = await fixture();
  session.sessionManager.appendModelChange(models[0].provider,models[0].id);
  session.sessionManager.appendThinkingLevelChange('medium');
  session.sessionManager.appendCustomEntry('piclaw.thinking-policy.v1',{preferred:'high'});
  restoreSessionThinkingPolicy(session, 'medium', 'high');
  expect(session.thinkingLevel).toBe('medium');
  expect(getSessionThinkingPolicy(session)?.preferred_level).toBe('high');
  expect(getSessionThinkingPolicy(session)?.last_transition).toMatchObject({ operation: 'restore', effective: 'medium', requested: 'medium' });
  expect(session.sessionManager.buildSessionContext().thinkingLevel).toBe('medium');
  expect(readThinkingPreference(session.sessionManager.getBranch())).toBe('high');
  await session.setModel(models[1]); expect(session.thinkingLevel).toBe('high');
  restoreSessionThinkingPolicy(session, 'low'); expect(getSessionThinkingPolicy(session)?.preferred_level).toBe('low');
  await session.setModel(models[2]); expect(session.thinkingLevel).toBe('low');
});
