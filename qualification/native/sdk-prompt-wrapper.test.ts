import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { openFixture, context } from './src/fixture.ts';
import { withAbortSignal } from '../../runtime/durable-engine/qualification/context.ts';
import { projectModelContext } from '../../runtime/durable-engine/src/host-model-context.ts';

for (const synchronous of [false, true]) test(`stock-SDK prompt wrapper cancels a ${synchronous ? 'synchronously aborting' : 'held'} renderer`, async () => {
  const f = await openFixture({ acquired: true });
  const controller = new AbortController();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<string>(resolve => { release = () => resolve('late metadata'); });
  try {
    const agent = await f.root.agent(context);
    const view = await f.root.context(context);
    const pending = projectModelContext(view, { conversationId: f.root.id, env: undefined,
      agent: { ...agent, sections: [{ key: 'held', render() {
        entered(); if (synchronous) controller.abort(Error('Prompt wrapper cancelled')); return held;
      } }] },
      read: { snapshot: f.harness.snapshot.bind(f.harness), snapshotAsOf: f.harness.snapshotAsOf.bind(f.harness) },
    }, withAbortSignal(controller.signal, context));
    await started;
    if (!synchronous) controller.abort(Error('Prompt wrapper cancelled'));
    await expect(pending).rejects.toThrow('Prompt wrapper cancelled');
    expect(f.host.modelCalls).toBe(0); expect(f.host.credentialLookups).toBe(0);
  } finally { release(); await f.close(); }
});
