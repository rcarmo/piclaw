import assert from 'node:assert/strict';
import { spyOn } from 'bun:test';
import { registerPreShutdownHook, runPreShutdownHooksOnce } from '../../src/runtime/shutdown-registry.js';
import { WebChannelRuntimeStateService } from '../../src/channels/web/runtime/runtime-state-service.js';
import { AgentStatusStore } from '../../src/channels/web/agent/agent-status-store.js';
import { WebServerLifecycleGatewayService } from '../../src/channels/web/server-lifecycle-gateway-service.js';

const scenario = process.argv[2];
assert(['registration', 'started', 'service', 'gateway', 'failure'].includes(scenario));
if (scenario === 'registration') {
  let calls = 0;
  const shared = () => { calls++; };
  const old = registerPreShutdownHook(shared), current = registerPreShutdownHook(shared);
  old(); old(); await runPreShutdownHooksOnce();
  assert.equal(calls, 1); current(); current(); await runPreShutdownHooksOnce(); assert.equal(calls, 1);
} else if (scenario === 'started') {
  let finish!: () => void, entered = 0, later = 0, completed = false;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const release = registerPreShutdownHook(async () => { entered++; await gate; completed = true; });
  registerPreShutdownHook(() => { later++; });
  const running = runPreShutdownHooksOnce();
  assert.equal(entered, 1); assert.equal(later, 1); assert.equal(completed, false);
  release(); release(); assert.equal(completed, false);
  finish(); await running; await runPreShutdownHooksOnce(); assert.equal(entered, 1); assert.equal(completed, true);
} else {
  const timers = new Set<object>();
  const set = spyOn(globalThis, 'setTimeout').mockImplementation((() => {
    const token = { unref() {} }; timers.add(token); return token;
  }) as any);
  const clear = spyOn(globalThis, 'clearTimeout').mockImplementation(((token: object) => { timers.delete(token); }) as any);
  const counts = [0, 0], wakes = [0, 0];
  const services = counts.map((_count, index) => {
    const status = new AgentStatusStore();
    const dispose = status.dispose.bind(status);
    status.dispose = () => {
      counts[index]++;
      if (scenario === 'failure' && index === 0 && counts[index] === 1) throw Error('uncertain local cleanup');
      dispose();
    };
    return new WebChannelRuntimeStateService({ agentStatusStore: status });
  });
  try {
    services[0]!.updateAgentStatus('shared', { sdk_observation: true, type: 'done' });
    services[1]!.updateAgentStatus('shared', { sdk_observation: true, type: 'done' }); assert.equal(timers.size, 2);
    if (scenario === 'failure') {
      assert.throws(() => services[0]!.dispose(), /uncertain local cleanup/);
      assert.equal(timers.size, 2); assert.equal(services[0]!.getAgentStatus('shared')?.type, 'done');
      await runPreShutdownHooksOnce();
      assert.deepEqual(counts, [2, 1]); assert.equal(timers.size, 0);
      services[0]!.dispose(); assert.deepEqual(counts, [2, 1]);
    } else if (scenario === 'service') {
      services[0]!.dispose(); services[0]!.dispose();
      assert.deepEqual(counts, [1, 0]); assert.equal(timers.size, 1);
    } else {
      let leave!: () => void, providerReleased = 0;
      const entered = new Promise<void>(resolve => { leave = resolve; });
      const gateway = new WebServerLifecycleGatewayService({
        webServerConfig: { host: '127.0.0.1', port: 0, idleTimeout: 1 }, webRuntimeConfig: { terminalEnabled: false },
        json: (body: unknown, status = 200) => Response.json(body, { status }),
        sse: { closeAll() {} }, uiBridge: { stop() {} }, terminalService: { shutdown() {} }, vncService: { shutdown() {} },
        runtimeState: services[0], sessionBroadcast: { dispose() { providerReleased++; } },
      } as any);
      const request = gateway.runInternalDispatch(() => entered);
      const stopping = gateway.stop(); await Promise.resolve();
      assert.deepEqual(counts, [0, 0]); assert.equal(providerReleased, 0);
      leave(); await request; await stopping; await gateway.stop();
      assert.deepEqual(counts, [1, 0]); assert.equal(timers.size, 1); assert.equal(providerReleased, 1);
    }
    if (scenario !== 'failure') {
      assert.equal(services[1]!.getAgentStatus('shared')?.type, 'done');
      services[0]!.updateAgentStatus('late-old', { sdk_observation: true, type: 'done' });
      assert.equal('resumeChat' in services[0]!, false); assert.equal('resumePendingChats' in services[0]!, false);
      assert.equal(timers.size, 1); assert.equal(services[0]!.getAgentStatus('late-old'), null);
      await runPreShutdownHooksOnce();
      assert.deepEqual(counts, [1, 1]); assert.equal(timers.size, 0);
      services[1]!.dispose(); assert.deepEqual(counts, [1, 1]);
    }
  } finally { set.mockRestore(); clear.mockRestore(); }
}
console.log(JSON.stringify({ scenario, ownerRelease: true, noOldTimer: true, noReplay: true }));
