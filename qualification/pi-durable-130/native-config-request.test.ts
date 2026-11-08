import './src/test-guard.js';
import { expect, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import { cpSync, symlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Socket } from 'node:net';
import { isolatedApplicationTest } from './src/isolated-application-test.js';
import { ModelRuntime, ModelRegistry, SettingsManager } from '../../node_modules/@earendil-works/pi-coding-agent';
import { createTestCredentialStore } from '../../runtime/test/model-services-fixture.js';
import { createDefaultApplicationRuntime } from '../../runtime/durable-engine/src/default-application-runtime.js';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { extensionKvSet } from '../../runtime/src/db/extension-kv.js';
import { getExtensionKvStore } from '../../runtime/src/extension-kv-registry.js';
import { acquireRuntimeLock } from '../../runtime/src/runtime/single-instance.js';
import { getPiclawAgentDir } from '../../runtime/src/core/agent-dir.js';
import { admitAddonLocalRequest } from '../../runtime/src/addons/local-context.js';
import { registerOwnedAddonConfigApi, handleRegisteredAddonConfigApiRequest } from '../../runtime/src/channels/web/handlers/addon-config-api.js';
import * as admission from '../../runtime/src/db/sqlite-async-admission.js';

const test = isolatedApplicationTest(import.meta.url);
const chat = 'web:default', baseUrl = 'http://fixture/agent/addons/api/';
const json = (body: unknown, status = 200) => Response.json(body, { status });
async function fixture(run: (f: { root: Database; request(method: string, action: string, body?: unknown, signal?: AbortSignal, namespace?: string): Request; revoke(): void; snapshot(namespace?: string): unknown[] }) => Promise<void>, globalPorts: readonly string[] = []) {
  const source = process.env.DURABLE_CORE_ADDONS_ROOT;
  if (!source) throw Error('Pinned native fixture required; never use installed packages');
  const workspace = process.env.PICLAW_WORKSPACE!;
  for (const slug of ['goal', 'plan-sidebar', ...globalPorts]) {
    const pkg = join(workspace, '.pi/extensions/node_modules/@rcarmo/piclaw-addon-' + slug);
    cpSync(join(source, 'addons', slug), pkg, { recursive: true, filter: path => basename(path) !== 'node_modules' });
    symlinkSync(join(import.meta.dir, slug === 'observability' ? 'node_modules' : '../../node_modules'), join(pkg, 'node_modules'));
  }
  process.env.PICLAW_DB_IN_MEMORY = '0';
  const owner = acquireRuntimeLock({ lockPath: join(workspace, 'config-request.lock'), strictOwnership: true, disabled: false });
  initDatabase(); const root = getDb();
  root.transaction(() => {
    if (globalPorts.includes('observability')) extensionKvSet('observability', 'config', { enabled: false, instance_name: 'Initial config', appinsights_enabled: false, graphite_enabled: false, appinsights_live_metrics: false, usage_telemetry_enabled: false }, 'global');
    if (globalPorts.includes('late-night-regrets')) extensionKvSet('late-night-regrets', 'config', { enabled: false, decision_model: '', review_scope: 'current', recent_hours_for_reflection: 24 }, 'global');
  }).immediate();
  const credentials = createTestCredentialStore({ synthetic: { type: 'api_key', key: 'synthetic-only' } });
  const models = await ModelRuntime.create({ credentials, modelsPath: null, modelsStore: { read: async () => undefined, write: async () => {}, delete: async () => {} }, allowModelNetwork: false, refreshOnCreate: false });
  let providerCalls = 0, current = true;
  const forbidden = () => { providerCalls++; throw Error('No provider execution in configuration fixture'); };
  const model = { provider: 'synthetic', id: 'approved', name: 'Approved', api: 'openai-completions' as const, baseUrl: 'https://invalid.invalid', input: ['text' as const], reasoning: false, contextWindow: 10000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  models.registerNativeProvider({ id: 'synthetic', name: 'Synthetic', getModels: () => [model] as any, auth: { apiKey: { name: 'Synthetic', check: async () => ({ type: 'api_key' }), resolve: async () => ({ auth: { apiKey: 'synthetic-only' }, source: 'fixture' }) } }, stream: forbidden as any, streamSimple: forbidden as any });
  await models.refresh({ allowNetwork: false }); await models.getAvailable();
  const settings = SettingsManager.create(workspace, getPiclawAgentDir()); settings.setDefaultModelAndProvider('synthetic', 'approved'); await settings.flush();
  const noHttp = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => { throw Error('No HTTP in config fixture'); }, { preconnect() { throw Error('No HTTP preconnect in config fixture'); } }));
  const noSocket = spyOn(Socket.prototype, 'connect').mockImplementation(() => { throw Error('No TCP in config fixture'); });
  let backend: Awaited<ReturnType<typeof createDefaultApplicationRuntime>> | undefined;
  try {
    backend = await createDefaultApplicationRuntime(owner, async () => ({ modelRuntime: models, modelRegistry: new ModelRegistry(models) } as any));
    root.transaction(() => extensionKvSet('goal', 'thread-goal', { goal_id: 'config-request-goal', lifecycle_generation: 1, chat_jid: chat, objective: 'Retain the original goal', status: 'active' }, 'chat', chat)).immediate();
    await run({ root, revoke() { current = false; }, snapshot: (namespace = 'goal') => root.query('SELECT * FROM extension_kv WHERE extension_id=? ORDER BY key').all(namespace),
      request(method, action, body, signal, namespace = 'goal') {
        const req = new Request(baseUrl + namespace + '/' + action + '?chat_jid=' + encodeURIComponent(chat), { method, signal, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
        admitAddonLocalRequest(req, { userId: 'default', mode: 'single-user' }, () => current && !req.signal.aborted);
        return req;
      } });
    expect(providerCalls).toBe(0); expect(noHttp).not.toHaveBeenCalled(); expect(noSocket).not.toHaveBeenCalled();
  } finally { backend?.stop(); await backend?.close(); noHttp.mockRestore(); noSocket.mockRestore(); await closeDatabase(); owner.release(); }
}

for (const reason of ['cancel', 'revoke'] as const) test(`native Goal config preserves the request while writer is held: ${reason}`, () => fixture(async f => {
  const path = (f.root.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file;
  const blocker = new Database(path), controller = new AbortController(), before = f.snapshot();
  blocker.exec('BEGIN IMMEDIATE');
  const pending = handleRegisteredAddonConfigApiRequest(f.request('POST', 'goal', { chat_jid: chat, objective: '' }, controller.signal), 'goal', 'goal', json);
  try {
    await Bun.sleep(35);
    if (reason === 'cancel') controller.abort(Error('configuration cancelled')); else f.revoke();
    const early = await Promise.race([pending.then(() => true), Bun.sleep(400).then(() => false)]);
    expect(blocker.inTransaction).toBe(true); blocker.exec('ROLLBACK');
    const response = await pending;
    console.log(JSON.stringify({ kind: 'config-request-fence', reason, early, status: response?.status, preserved: JSON.stringify(f.snapshot()) === JSON.stringify(before) }));
    expect(early).toBe(true); expect(response!.status).toBeGreaterThanOrEqual(400); expect(f.snapshot()).toEqual(before);
  } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close(); }
}));

test('native config GET cannot obtain chat-scoped mutation admission', () => fixture(async f => {
  const kv = getExtensionKvStore(), before = f.snapshot();
  const probe = registerOwnedAddonConfigApi('goal', 'readonly-probe', { async get() {
    await kv.write!('goal', () => kv.set('goal', 'request-probe', true, 'chat', chat));
    return { mutated: true };
  } }, 'fixture-readonly-probe');
  try {
    const response = await handleRegisteredAddonConfigApiRequest(f.request('GET', 'readonly-probe'), 'goal', 'readonly-probe', json);
    expect(response!.status).toBe(500); expect(await response!.json()).toEqual({ error: 'Extension KV scope denied' }); expect(f.snapshot()).toEqual(before);
  } finally { probe.dispose(); }
}));

test('native Goal request retains chat-only namespace grants while its admitted POST can write', () => fixture(async f => {
  const kv = getExtensionKvStore();
  const probe = registerOwnedAddonConfigApi('goal', 'scope-probe', { async set() {
    await kv.write!('goal', () => {
      expect(() => kv.set('goal', 'global-probe', true, 'global')).toThrow('scope denied');
      expect(() => kv.get('goal', 'global-probe', 'global')).toThrow('scope denied');
      expect(() => kv.set('goal', 'foreign-probe', true, 'chat', 'web:foreign')).toThrow('scope denied');
      expect(() => kv.get('plan-sidebar', 'plan', 'chat', chat)).toThrow('scope denied');
      kv.set('goal', 'scope-probe', true, 'chat', chat);
    });
    return { ok: true };
  } }, 'fixture-goal-scope-probe');
  try {
    const response = await handleRegisteredAddonConfigApiRequest(f.request('POST', 'scope-probe', {}), 'goal', 'scope-probe', json);
    expect(response!.status, await response!.clone().text()).toBe(200);
    expect(f.root.query("SELECT scope,scope_key FROM extension_kv WHERE key='scope-probe'").all()).toEqual([{ scope: 'chat', scope_key: chat }]);
  } finally { probe.dispose(); }
}));

test('native config port observes request revocation during writer acquisition', () => fixture(async f => {
  const path = (f.root.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file;
  const blocker = new Database(path), kv = getExtensionKvStore(), before = f.snapshot(); let entered = 0;
  const probe = registerOwnedAddonConfigApi('goal', 'request-probe', { async set() {
    await kv.write!('goal', () => { entered++; kv.set('goal', 'request-probe', true, 'chat', chat); }); return { ok: true };
  } }, 'fixture-request-probe');
  blocker.exec('BEGIN IMMEDIATE');
  const pending = handleRegisteredAddonConfigApiRequest(f.request('POST', 'request-probe', {}), 'goal', 'request-probe', json);
  try {
    await Bun.sleep(35); f.revoke();
    const early = await Promise.race([pending.then(() => true), Bun.sleep(400).then(() => false)]);
    expect(blocker.inTransaction).toBe(true); blocker.exec('ROLLBACK'); const response = await pending;
    expect(early).toBe(true); expect(response!.status).toBeGreaterThanOrEqual(400); expect(entered).toBe(0); expect(f.snapshot()).toEqual(before);
  } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close(); probe.dispose(); }
}));

test('native config port expires a detached queued write after its handler returns', () => fixture(async f => {
  const path = (f.root.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file;
  const blocker = new Database(path), kv = getExtensionKvStore(), before = f.snapshot();
  let entered = 0, detached: Promise<unknown> | undefined;
  const probe = registerOwnedAddonConfigApi('goal', 'detached-probe', { set() {
    detached = kv.write!('goal', () => { entered++; kv.set('goal', 'detached-probe', true, 'chat', chat); }).then(() => null, error => error);
    return { queued: true };
  } }, 'fixture-detached-probe');
  blocker.exec('BEGIN IMMEDIATE');
  try {
    const response = await handleRegisteredAddonConfigApiRequest(f.request('POST', 'detached-probe', {}), 'goal', 'detached-probe', json);
    expect(response!.status).toBe(200); expect(detached).toBeDefined();
    const terminal = await Promise.race([detached!, Bun.sleep(400).then(() => 'did not settle')]);
    expect(terminal).toBeInstanceOf(Error); expect(blocker.inTransaction).toBe(true); expect(entered).toBe(0); expect(f.snapshot()).toEqual(before);
  } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await detached; blocker.close(); probe.dispose(); }
}));

for (const fault of [false, true]) test(`native Goal config keeps state and continuation in the same commit: fault=${fault}`, () => fixture(async f => {
  const before = f.snapshot(), cursorBefore = f.root.query('SELECT * FROM chat_cursors').all();
  const sourcesBefore = f.root.query('SELECT * FROM service_effect_s01_sources').all();
  if (fault) f.root.exec("CREATE TRIGGER reject_config_followup BEFORE INSERT ON service_effect_s01_sources WHEN NEW.source_id LIKE 'goal-settings:%' BEGIN SELECT RAISE(ABORT,'configuration continuation rejected'); END");
  const response = await handleRegisteredAddonConfigApiRequest(f.request('POST', 'goal', { chat_jid: chat, objective: 'Updated configuration goal' }), 'goal', 'goal', json);
  if (fault) {
    expect(response!.status).toBe(500); expect(await response!.json()).toEqual({ error: 'EF-S01 admission failed: corrupt_state' });
    expect(f.snapshot()).toEqual(before); expect(f.root.query('SELECT * FROM chat_cursors').all()).toEqual(cursorBefore);
    expect(f.root.query('SELECT * FROM service_effect_s01_sources').all()).toEqual(sourcesBefore);
  } else {
    expect(response!.status, await response!.clone().text()).toBe(200); expect(await response!.json()).toMatchObject({ ok: true, continuationQueued: true });
    expect(f.root.query("SELECT source_id FROM service_effect_s01_sources WHERE source_id LIKE 'goal-settings:%'").all()).toHaveLength(1);
    expect(JSON.stringify(f.snapshot())).toContain('Updated configuration goal');
    expect(f.root.query("SELECT m.id,m.content FROM messages m JOIN service_effect_s01_sources s ON s.chat_jid=m.chat_jid AND s.source_id=m.id WHERE s.source_id LIKE 'goal-settings:%'").all()).toMatchObject([{id:expect.stringContaining('goal-settings:'),content:expect.stringContaining('Updated configuration goal')}]);
    expect(f.root.query('SELECT * FROM chat_cursors').all()).toEqual(cursorBefore);
  }
  expect(f.root.inTransaction).toBe(false);
}));

test('native Goal config acknowledges an already committed clear after a late request abort', () => fixture(async f => {
  const controller = new AbortController(), original = admission.admitSqliteWrite; let writes = 0;
  const hook = spyOn(admission, 'admitSqliteWrite').mockImplementation((async (...args: Parameters<typeof original>) => {
    const result = await original(...args); writes++; controller.abort(Error('after physical commit')); return result;
  }) as any);
  try {
    const response = await handleRegisteredAddonConfigApiRequest(f.request('POST', 'goal', { chat_jid: chat, objective: '' }, controller.signal), 'goal', 'goal', json);
    expect(response!.status, await response!.clone().text()).toBe(200); expect(writes).toBe(1); expect(controller.signal.aborted).toBe(true); expect(f.snapshot()).toEqual([]);
  } finally { hook.mockRestore(); }
}));

for (const namespace of ['observability', 'late-night-regrets'] as const) {
  const patch = namespace === 'observability' ? { instance_name: 'Updated config' } : { recent_hours_for_reflection: 12 };
  for (const reason of ['cancel', 'revoke'] as const) test(`native ${namespace} settings preserve request while writer is held: ${reason}`, () => fixture(async f => {
    const path = (f.root.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file;
    const blocker = new Database(path), controller = new AbortController(), before = f.snapshot(namespace);
    blocker.exec('BEGIN IMMEDIATE');
    const pending = handleRegisteredAddonConfigApiRequest(f.request('POST', 'config', patch, controller.signal, namespace), namespace, 'config', json);
    try {
      await Bun.sleep(35); if (reason === 'cancel') controller.abort(Error('configuration cancelled')); else f.revoke();
      const early = await Promise.race([pending.then(() => true), Bun.sleep(400).then(() => false)]);
      expect(blocker.inTransaction).toBe(true); blocker.exec('ROLLBACK'); const response = await pending;
      console.log(JSON.stringify({ kind: 'global-config-fence', namespace, reason, early, status: response?.status, preserved: JSON.stringify(f.snapshot(namespace)) === JSON.stringify(before) }));
      expect(early).toBe(true); expect(response!.status).toBeGreaterThanOrEqual(400); expect(f.snapshot(namespace)).toEqual(before);
    } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close(); }
  }, [namespace]));
  test(`native ${namespace} settings acknowledge commit after late request abort`, () => fixture(async f => {
    const controller = new AbortController(), original = admission.admitSqliteWrite; let writes = 0;
    const hook = spyOn(admission, 'admitSqliteWrite').mockImplementation((async (...args: Parameters<typeof original>) => {
      const result = await original(...args); writes++; controller.abort(Error('after physical commit')); return result;
    }) as any);
    try {
      const response = await handleRegisteredAddonConfigApiRequest(f.request('POST', 'config', patch, controller.signal, namespace), namespace, 'config', json);
      expect(response!.status, await response!.clone().text()).toBe(200); expect(writes).toBe(1); expect(controller.signal.aborted).toBe(true);
      const row = f.root.query("SELECT value FROM extension_kv WHERE extension_id=? AND scope='global' AND key='config'").get(namespace) as { value: string };
      expect(JSON.parse(row.value)).toMatchObject(patch);
    } finally { hook.mockRestore(); }
  }, [namespace]));
}
