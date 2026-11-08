import './src/test-guard.js';
import { expect, test } from 'bun:test';
import { openFixture, context } from './src/fixture.js';
import type { Storage } from '../../runtime/durable-engine/qualification/durable.ts';
import { captureInterruptedScheduledHarness } from '../../runtime/durable-engine/src/host-scheduled-terminal.js';

async function failedFixture() {
  const f = await openFixture({ acquired: true });
  f.host.modelAllowed = false;
  const identity = { sessionId: 'fixture-sdk-domain', submissionId: '', runId: 'scheduled_run:fixture', operationId: 'scheduled_operation:fixture', sourceSeq: 9, chatJid: 'web:fixture' };
  const requestId = `scheduled:${identity.runId}`;
  const submitted = await f.root.submit({ type: 'input', requestId, content: 'do fixture work', entry: { kind: 'host.accepted',
    data: { incarnation: identity.sessionId, conversationId: f.root.id, chatJid: identity.chatJid, operationId: identity.operationId,
      sourceSeq: identity.sourceSeq, sourceId: identity.runId, requestId, role: 'primary' } } }, context);
  identity.submissionId = String(submitted.id);
  const status = await submitted.wait(context);
  expect(status.status).toBe('unanswered');
  return { ...f, identity, submitted, status };
}

test('real failed native submission yields only a receipt fence, never reopens or replays SDK execution', async () => {
  const f = await failedFixture();
  try {
    const before = [f.host.modelCalls, f.host.effects];
    let checks = 0;
    const fence = await captureInterruptedScheduledHarness(f.storage, context, f.identity, () => { checks++; });
    fence();
    expect(checks).toBeGreaterThan(3);
    expect([f.host.modelCalls, f.host.effects]).toEqual(before);
    expect(await f.submitted.status(context)).toEqual(f.status);
  } finally { await f.close(); }
});

for (const field of ['sessionId', 'submissionId', 'runId', 'operationId', 'sourceSeq', 'chatJid'] as const) test(`terminal SDK proof rejects foreign ${field}`, async () => {
  const f = await failedFixture();
  try {
    const identity = { ...f.identity, [field]: field === 'sourceSeq' ? 10 : 'foreign' };
    await expect(captureInterruptedScheduledHarness(f.storage, context, identity as typeof f.identity, () => {})).rejects.toThrow();
  } finally { await f.close(); }
});

function override(storage: Storage, methods: Partial<Storage>): Storage {
  return new Proxy(storage, { get(target, key) { const replacement = Reflect.get(methods, key); if (replacement) return replacement;
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
}

test('terminal submission alone cannot conceal pending, completing, sleeping or aborted-marked live tools', async () => {
  const f = await failedFixture();
  try {
    for (const status of ['pending', 'running', 'waiting', 'sleeping', 'completing']) {
      const storage = override(f.storage, { async scanTasks() { return { items: [{ conversationId: f.root.id, kind: 'pi.tool', state: { status }, abortRequested: true } as never] }; } });
      await expect(captureInterruptedScheduledHarness(storage, context, f.identity, () => {})).rejects.toThrow('not terminal');
    }
    const storage = override(f.storage, { async scanTasks() { return { items: [] }; } });
    await expect(captureInterruptedScheduledHarness(storage, context, f.identity, () => {})).rejects.toThrow('generation receipt required');
  } finally { await f.close(); }
});

test('queued inputs, owned child work and ownership cycles keep reconciliation blocked', async () => {
  const f = await failedFixture();
  try {
    for (const status of ['queued', 'placed']) {
      const storage = override(f.storage, { async scanSubmissions() { return { items: [{ status } as never] }; } });
      await expect(captureInterruptedScheduledHarness(storage, context, f.identity, () => {})).rejects.toThrow('unsettled');
    }
    const tasks = f.storage.scanTasks.bind(f.storage);
    const storage = override(f.storage, {
      async scanConversations(query) { return { items: query.ownerConversationId === f.root.id ? [{ id: 999 as never, owner: { conversationId: f.root.id, taskId: 998 as never } }] : [] }; },
      async scanTasks(query, ...args) { return query.conversationId === f.root.id ? tasks(query, ...args) : { items: [{ conversationId: 999, state: { status: 'waiting' } } as never] }; },
    });
    await expect(captureInterruptedScheduledHarness(storage, context, f.identity, () => {})).rejects.toThrow('not terminal');
    const cycle = override(f.storage, { async scanConversations() { return { items: [{ id: f.root.id, owner: { conversationId: f.root.id, taskId: 998 as never } }] }; } });
    await expect(captureInterruptedScheduledHarness(cycle, context, f.identity, () => {})).rejects.toThrow('ownership tree');
  } finally { await f.close(); }
});

test('receipt outcome, accepted-entry provenance and synchronous owner fence are independent requirements', async () => {
  const f = await failedFixture();
  try {
    for (const patch of [{ status: 'done' }, { status: 'placed' }, { reason: 'aborted' }, { type: 'write' }, { requestId: 'foreign' }]) {
      const storage = override(f.storage, { async submission() { return { ...f.status, ...patch } as never; } });
      await expect(captureInterruptedScheduledHarness(storage, context, f.identity, () => {})).rejects.toThrow();
    }
    const storage = override(f.storage, { async entry() { return undefined; } });
    await expect(captureInterruptedScheduledHarness(storage, context, f.identity, () => {})).rejects.toThrow('source identity');
    let current = true;
    const fence = await captureInterruptedScheduledHarness(f.storage, context, f.identity, () => { if (!current) throw Error('owner revoked'); });
    current = false;
    expect(fence).toThrow('owner revoked');
    await expect(captureInterruptedScheduledHarness(f.storage, context, f.identity, () => { throw Error('owner revoked'); })).rejects.toThrow('owner revoked');
  } finally { await f.close(); }
});
