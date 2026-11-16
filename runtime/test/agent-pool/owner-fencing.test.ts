import { afterEach, expect, test } from 'bun:test';
import { ModelRegistry } from '@earendil-works/pi-coding-agent';
import { AgentPool } from '../../src/agent-pool.js';
import { AgentRuntimeFacade } from '../../src/agent-pool/runtime-facade.js';
import { getSshStatusHintTarget, setSshToolHandlers } from '../../src/extensions/ssh.js';
import { WebSessionBroadcastService } from '../../src/channels/web/sse/session-broadcast-service.js';
import { initDatabase } from '../../src/db/connection.js';
import { createAgentPoolModelOptions } from '../model-services-fixture.js';
import '../helpers.js';

const pools: AgentPool[] = [];
const sshConfig = (target: string, chat = 'web:fixture'): NonNullable<ReturnType<AgentPool['getSshConfig']>> => ({
  chat_jid: chat, ssh_target: target, ssh_port: 22, private_key_keychain: 'synthetic-key', known_hosts_keychain: null,
  strict_host_key_checking: 'yes', created_at: 'fixture', updated_at: 'fixture', last_used_at: 'fixture',
});
afterEach(async () => {
  const results = await Promise.allSettled(pools.splice(0).map(pool => pool.shutdown()));
  setSshToolHandlers(null);
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Pool fixture cleanup failed');
});
function makePool(label: string) {
  initDatabase(); const options = createAgentPoolModelOptions();
  (options.modelRuntime as any).streamSimple = () => ({ marker: label });
  const pool = new AgentPool(options);
  pool.getSshConfig = (chat) => sshConfig(label, chat);
  pools.push(pool); return pool;
}
const interop = () => (globalThis as any).__piclawRuntimeInterop;
const ownedKeys = ['getModelRegistry', 'streamSimple', 'getSessionId', 'getScopedModels'] as const;
function makeFacade() {
  const options = createAgentPoolModelOptions();
  const runtime = options.modelRuntime!;
  return new AgentRuntimeFacade({ pool: new Map(), getDurableSession: () => undefined,
    modelRegistry: new ModelRegistry(runtime), modelRuntime: runtime,
    authPath: options.credentialStore!.authPath, listKnownChats: () => [{ chat_jid: 'web:fixture', model: 'fixture/model' }] });
}
const publish = (facade: AgentRuntimeFacade) => (facade as any).publishProviderUsageRefresh('fixture', { provider: 'fixture', plan: 'synthetic' });

test('old pool shutdown preserves new model/SSH registrations and current shutdown releases only captured callbacks', async () => {
  const old = makePool('old'), current = makePool('current');
  const bridge = interop(), replacement = Object.fromEntries(ownedKeys.map(key => [key, bridge[key]]));
  const stable = { getChatJid: bridge.getChatJid, getExtensionKvStore: bridge.getExtensionKvStore, hasKnownModelCost: bridge.hasKnownModelCost };
  await old.shutdown(); await old.shutdown();
  for (const key of ownedKeys) expect(bridge[key]).toBe(replacement[key]);
  expect(bridge.getModelRegistry()).toBe((current as any).modelRegistry);
  expect(bridge.streamSimple({}, { messages: [] })).toEqual({ marker: 'current' });
  expect(getSshStatusHintTarget('web:fixture')).toBe('current');
  await current.shutdown(); await current.shutdown();
  for (const key of ownedKeys) expect(bridge[key]).toBeUndefined();
  expect(getSshStatusHintTarget('web:fixture')).toBeNull();
  for (const [key, value] of Object.entries(stable)) expect(bridge[key]).toBe(value);
});

test('native pool has no legacy manager cleanup owner; application shutdown gates registration release', async () => {
  const pool=makePool('native');expect(pool).not.toHaveProperty('sessionManager');
  // Held/rejected actual native-backend handoff and non-replay are covered by
  // runtime/shutdown.test.ts, not a fabricated legacy-manager property.
  await pool.shutdown();expect(interop().getModelRegistry).toBeUndefined();
});

test('SSH handle ownership fences reused handler objects and double release', () => {
  const shared = { get: (chat: string) => sshConfig('shared', chat), async set() { throw Error('unused'); }, async clear() { throw Error('unused'); } };
  const old = setSshToolHandlers(shared), current = setSshToolHandlers(shared);
  old(); old(); expect(getSshStatusHintTarget('web:fixture')).toBe('shared');
  current(); current(); expect(getSshStatusHintTarget('web:fixture')).toBeNull();
});

test('provider usage handles fence reused callbacks without dropping the new registration', () => {
  const facade = makeFacade(); let calls = 0;
  const shared = () => { calls++; };
  const old = facade.setProviderUsageRefreshListener(shared), current = facade.setProviderUsageRefreshListener(shared);
  old(); old(); publish(facade); expect(calls).toBe(1);
  current(); current(); publish(facade); expect(calls).toBe(1);
});

test('broadcast owner releases only its provider listener and ignores an already-captured old notification', () => {
  const facade = makeFacade(), events = [[], []] as unknown[][];
  const pool = { setProviderUsageRefreshListener: facade.setProviderUsageRefreshListener.bind(facade) } as unknown as AgentPool;
  const make = (index: number) => new WebSessionBroadcastService(pool, { sse: { broadcast: (...args: unknown[]) => events[index]!.push(args), closeAll() {}, handleRequest: () => new Response() } as any });
  const old = make(0), captured = (facade as any).providerUsageRefreshListener, current = make(1);
  old.dispose(); old.dispose(); publish(facade);
  captured({ chat_jid: 'web:fixture', current: 'fixture/model', provider_usage: {} });
  expect(events[0]).toHaveLength(0); expect(events[1]).toHaveLength(1);
  current.dispose(); current.dispose(); publish(facade); expect(events[1]).toHaveLength(1);
  expect((facade as any).providerUsageRefreshListener).toBeUndefined();
});
