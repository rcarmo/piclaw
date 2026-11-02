import '../helpers.js';
import { expect, test } from 'bun:test';
import { createDurableQueuedSteering } from '../../src/agent-pool/durable-queued-steering.js';

// Boundary-only double: real SQL attachment/SDK intent is exercised by the
// native factory and controller/delegate steering qualification fixtures.
function coordinator(materialize: () => Promise<null>) {
  let entered = 0, submitted = 0;
  const unavailable = () => { throw Error('SQL body must not enter in this boundary test'); };
  const steering = createDurableQueuedSteering({
    work: { getChatFrontier: () => ({ ok: true, value: { activeOperationId: 'active' } }),
      getOperation: () => ({ ok: true, value: { phase: 'executing', harness: { sessionId: 'captured', harnessOperationId: 'running' } } }),
      getAcceptedSource: unavailable, attachQueuedSourceInTransaction: unavailable } as any,
    adapter: { supportsIntent: true, submitIntent: async () => { submitted++; }, validateIntent: unavailable } as any,
    chatJid: 'web:boundary', branchId: 'main', runningBinding: { sessionId: 'captured' }, assertCurrentWriter() {},
    readQueued: () => ({ rowId: -1, source_accepted: true, source_id: 'accepted', queuedContent: 'queued', queuedAt: '2026-01-01' }),
    validatePayload: unavailable,
    materialize: (() => { entered++; return materialize(); }) as any,
  });
  return { steering, entered: () => entered, submitted: () => submitted };
}

test('accepted steering joins asynchronous materialisation before observing its result', async () => {
  let release!: (value: null) => void, settled = false;
  const held = new Promise<null>(resolve => { release = resolve; });
  const f = coordinator(() => held);
  const observed = f.steering.accept(-1).then(value => { settled = true; return value; }, error => { settled = true; return error; });
  await Bun.sleep(0); expect(settled).toBe(false); expect(f.entered()).toBe(1); expect(f.submitted()).toBe(0);
  release(null); expect(String(await observed)).toContain('materialization failed'); expect(f.submitted()).toBe(0);
});

test('an asynchronous materialisation failure retains its cause and is never replayed or submitted', async () => {
  const cause = Error('owned acquisition rejected');
  const f = coordinator(async () => { await Bun.sleep(0); throw cause; });
  expect(await f.steering.accept(-1).catch(error => error)).toBe(cause);
  expect(f.entered()).toBe(1); expect(f.submitted()).toBe(0);
});
