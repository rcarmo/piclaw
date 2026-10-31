import { expect, test } from 'bun:test';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { isolateBudgetTestDatabase } from './fixture.js';
import { ensureBudgetWork, getBudgetWork, saveBudgetCap } from '../../src/db/budget-limits.js';
import { getDb } from '../../src/db/connection.js';
import { evaluateBudget } from '../../src/budget/evaluator.js';
import { abandonBudgetRequest, getBudgetRequest, readBudgetTerminalReceipt, recordBudgetTerminalReceipt } from '../../src/db/budget-request-reservations.js';
import { modelRequestAccounting } from '../../src/budget/model-request-accounting.js';
isolateBudgetTestDatabase();

function seed() {
  ensureBudgetWork({ id: 'parent', chatJid: 'web:fixture', executionKind: 'interactive' });
  for (const [id, kind] of [['side', 'side_prompt'], ['child', 'delegate']] as const) {
    ensureBudgetWork({ id, chatJid: 'web:fixture', executionKind: kind, parentWorkId: 'parent' });
  }
  saveBudgetCap({ scope: 'task', workId: 'parent', metric: 'api_usd_micros', amount: 100 });
}
function message(): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text: 'synthetic' }], api: 'openai-completions', provider: 'fixture', model: 'fixture', stopReason: 'stop', timestamp: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0.00003, output: 0.00001, cacheRead: 0, cacheWrite: 0, total: 0.00004 } } };
}
function binding(id: string, parentWorkId = 'side') {
  const workId = `durable-request:${id}`;
  ensureBudgetWork({ id: workId, chatJid: 'web:fixture', executionKind: 'interactive', parentWorkId });
  return { id, workId, chatJid: 'web:fixture', providerId: 'fixture', modelId: 'fixture', accountRef: 'generation', amountMicros: 60 };
}
function retain(request: ReturnType<typeof binding>, terminal: AssistantMessage, at: string) {
  return recordBudgetTerminalReceipt(request, { version: 1, requestId: request.id,
    requestBindingSha256: getBudgetRequest(request.id)!.binding_sha256,
    projectedOutcome: JSON.parse(JSON.stringify(terminal)) }, at);
}
function owner() {
  const database = getDb();
  return { signal: new AbortController().signal, assertCurrent() { expect(getDb()).toBe(database); } };
}

test('shared accounting exposes only funded admission and owner-bound retained settlement', () => {
  const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  expect(Object.keys(accounting).sort()).toEqual(['dispatch', 'reserve', 'settleRetainedRequest']);
  expect(Object.isFrozen(accounting)).toBe(true);
});

// Preserve the retired owner's contracts through the shipping retained port.
// Receipt helpers only arrange immutable fixture data; they perform no pricing.
test('shared settlement retry preserves host accounting time and exact usage payload', async () => {
  seed(); const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  const request = binding('stable-settlement'), signal = new AbortController().signal;
  await accounting.reserve(request, signal); await accounting.dispatch(request, signal);
  const terminal = message(), at = new Date().toISOString(), receipt = retain(request, terminal, at);
  expect((await accounting.settleRetainedRequest(request, owner())).state).toBe('settled');
  const settled = getBudgetRequest(request.id);
  await Bun.sleep(2);
  retain(request, structuredClone(terminal), at);
  expect((await accounting.settleRetainedRequest(request, owner())).state).toBe('settled');
  expect(getDb().query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 1 });
  expect(() => retain(request, { ...terminal, usage: { ...terminal.usage, cost: { ...terminal.usage.cost, input: 0.000031, total: 0.000041 } } }, at)).toThrow('conflict');
  expect(getBudgetRequest(request.id)).toEqual(settled);
  expect(readBudgetTerminalReceipt(request)).toEqual(receipt);
});

test('accounting rejects disclosed response-model changes and keeps the dispatched hold', async () => {
  seed(); const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  const request = binding('response-model-conflict', 'parent'), signal = new AbortController().signal;
  await accounting.reserve(request, signal); await accounting.dispatch(request, signal);
  retain(request, { ...message(), responseModel: 'other' }, new Date().toISOString());
  await expect(accounting.settleRetainedRequest(request, owner())).rejects.toThrow('identity changed');
  expect(getBudgetRequest(request.id)?.state).toBe('dispatched');
});

test('captured native accounting charges once and releases shared capacity', async () => {
  seed(); const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  const request = binding('known-charge'), signal = new AbortController().signal;
  await accounting.reserve(request, signal); await accounting.dispatch(request, signal);
  retain(request, message(), new Date().toISOString()); await accounting.settleRetainedRequest(request, owner());
  expect(getBudgetRequest(request.id)?.state).toBe('settled');
  expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
  expect(getDb().query('SELECT work_id,invocation_id FROM budget_usage_events').get()).toEqual({ work_id: request.workId, invocation_id: request.id });
  expect(getBudgetWork(request.workId)?.parent_work_id).toBe('side');
  expect(evaluateBudget({ workId: 'parent' }).action).toBe('allow');
  // Preserve the host-calendar invariant despite the synthetic provider's epoch timestamp.
  const row = getDb().query('SELECT run_at FROM token_usage').get() as { run_at: string };
  expect(row.run_at.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
});

test('unknown zero telemetry retains the native dispatched hold and cap blocker', async () => {
  seed(); const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  const request = binding('unknown-charge'), signal = new AbortController().signal;
  await accounting.reserve(request, signal); await accounting.dispatch(request, signal);
  const terminal = message(); terminal.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  retain(request, terminal, new Date().toISOString());
  expect((await accounting.settleRetainedRequest(request, owner())).state).toBe('unresolved');
  expect(getBudgetRequest(request.id)?.state).toBe('unresolved');
  expect(evaluateBudget({ workId: 'parent' }).blockers[0].reason).toBe('unknown_pricing');
  expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
});

test('definitely unsent native request releases its hold without a usage event', async () => {
  seed(); const accounting = modelRequestAccounting({ authorise() {}, documentedFree: false });
  const request = binding('unsent-request'), signal = new AbortController().signal;
  await accounting.reserve(request, signal); abandonBudgetRequest(request);
  expect(getBudgetRequest(request.id)?.state).toBe('released');
  expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  expect(getDb().query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 0 });
});
