import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { createTempWorkspace, setEnv, type TempWorkspace } from '../helpers.js';
import { resolveRuntimeConfigPaths } from '../../src/core/config-paths.js';
import { closeDatabase, getDb, initDatabase } from '../../src/db/connection.js';
import { ensureBudgetWork, getBudgetWork, saveBudgetCap, setBudgetWorkStatus, setBudgetWarningsOnly, grantBudgetAllowance } from '../../src/db/budget-limits.js';
import { getBudgetRequest, recordBudgetTerminalReceipt, readBudgetTerminalReceipt, settleBudgetRequest,
  type BudgetRequestBinding, type BudgetTerminalReceiptPayload } from '../../src/db/budget-request-reservations.js';
import { modelRequestAccounting } from '../../src/budget/model-request-accounting.js';
import { evaluateBudget } from '../../src/budget/evaluator.js';
import { canonicalJson } from '../../src/utils/canonical-json.js';

// All new cases use actual owned, file-backed SQLite. Every pending operation
// is joined before this fixture closes its connection or removes its directory.
let workspace: TempWorkspace, restore: () => void;
function ownedPaths() {
  // setEnv intentionally enforces memory for default callers. Use the explicit
  // bootstrap path API for this owned file fixture, not a global test bypass.
  return resolveRuntimeConfigPaths({ env: { ...process.env, PICLAW_DB_IN_MEMORY: '0' } });
}
beforeEach(() => {
  workspace = createTempWorkspace('retained-settlement-');
  restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store,
    PICLAW_DATA: workspace.data });
  initDatabase(ownedPaths());
  expect(getDb().query("SELECT file FROM pragma_database_list WHERE name='main'").get()).toEqual({ file: ownedPaths().databasePath });
  expect(getDb().query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
});
afterEach(() => { closeDatabase(); restore(); workspace.cleanup(); });
const receivedAt = '2026-10-04T12:00:00.000Z';
const earlier = '2026-10-03T10:00:00.000Z';
const later = '2026-10-05T12:00:00.000Z';
function terminal(): AssistantMessage {
  return { role: 'assistant', content: [{ type: 'text', text: 'synthetic safe fixture' }],
    api: 'openai-completions', provider: 'fixture', model: 'fixture-model', responseModel: 'fixture/fixture-model',
    stopReason: 'stop', timestamp: 1,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0.00003, output: 0.00001, cacheRead: 0, cacheWrite: 0, total: 0.00004 },
      ...{ providerCost: 0.00005, reasoningTokens: 1, cacheReadReported: true, cacheWriteReported: false } } };
}
function owner() { return { signal: new AbortController().signal, assertCurrent() {} }; }
function accounting() { return modelRequestAccounting({ authorise() {}, documentedFree: false, usageSource: 'compaction' }); }
async function fixture(message = terminal(), retain = true, workId = 'durable-request:request') {
  const db = getDb(), helper = accounting(), signal = new AbortController().signal;
  ensureBudgetWork({ id: 'parent', chatJid: 'web:receipt', executionKind: 'interactive' });
  ensureBudgetWork({ id: workId, chatJid: 'web:receipt', executionKind: 'background', parentWorkId: 'parent' });
  saveBudgetCap({ scope: 'task', workId: 'parent', metric: 'api_usd_micros', amount: 100 });
  const binding: BudgetRequestBinding = { id: 'request', workId, chatJid: 'web:receipt', providerId: 'fixture',
    modelId: 'fixture-model', accountRef: 'original-account-generation', amountMicros: 60 };
  await helper.reserve(binding, signal); await helper.dispatch(binding, signal);
  const payload: BudgetTerminalReceiptPayload = { version: 1, requestId: binding.id,
    requestBindingSha256: getBudgetRequest(binding.id)!.binding_sha256,
    projectedOutcome: JSON.parse(JSON.stringify(message)) };
  const receipt = retain ? recordBudgetTerminalReceipt(binding, payload, receivedAt) : null;
  return { db, helper, binding, payload, receipt };
}
function financialRows() {
  return { tokens: getDb().query('SELECT * FROM token_usage').all(), events: getDb().query('SELECT * FROM budget_usage_events').all() };
}
function unchangedFinancials() { expect(financialRows()).toEqual({ tokens: [], events: [] }); }

test('prior committed receipt survives work-write fault: charge/reservation/work roll back together, exact retry commits once', async () => {
  const { db, helper, binding, receipt } = await fixture();
  const before = getBudgetRequest(binding.id), work = getBudgetWork(binding.workId), parent = getBudgetWork('parent');
  expect(receipt).not.toBeNull(); unchangedFinancials();
  db.exec(`CREATE TRIGGER work_fault BEFORE UPDATE ON budget_work WHEN NEW.id='durable-request:request'
    AND NEW.status='completed' BEGIN SELECT RAISE(ABORT,'work publication fault'); END`);
  await expect(helper.settleRetainedRequest(binding, owner())).rejects.toThrow('work publication fault');
  expect(getBudgetRequest(binding.id)).toEqual(before);
  expect(getBudgetWork(binding.workId)).toEqual(work); expect(getBudgetWork('parent')).toEqual(parent);
  expect(readBudgetTerminalReceipt(binding)).toEqual(receipt); unchangedFinancials();
  db.exec('DROP TRIGGER work_fault');
  expect((await helper.settleRetainedRequest(binding, owner())).state).toBe('settled');
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
  expect(db.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 1 });
  expect(db.query(`SELECT run_at,api,model,response_model,provider,usage_source,cost_total,provider_cost_total,
    catalogue_cost_total,cost_provenance,reasoning_tokens,cache_read_reported,cache_write_reported,
    api_equivalent_cost_microusd FROM token_usage`).get()).toEqual({ run_at: receivedAt, api: 'openai-completions',
      model: 'fixture-model', response_model: 'fixture-model', provider: 'fixture', usage_source: 'compaction',
      cost_total: 0.00005, provider_cost_total: 0.00005, catalogue_cost_total: 0.00004, cost_provenance: 'provider_reported',
      reasoning_tokens: 1, cache_read_reported: 1, cache_write_reported: 0, api_equivalent_cost_microusd: 40 });
  expect(getBudgetWork(binding.workId)?.status).toBe('completed');
  expect(getBudgetWork(binding.workId)?.closed_at).toBe(receivedAt);
  expect(getBudgetWork('parent')).toEqual(parent); expect(readBudgetTerminalReceipt(binding)).toEqual(receipt);
});

test('concurrent exact receipt reconciliations share one charge and original completion instead of conflicting on progress', async () => {
  const { helper, binding, receipt } = await fixture(), writer = new Database(ownedPaths().databasePath);
  writer.exec('BEGIN IMMEDIATE');
  const pending = [helper.settleRetainedRequest(binding, owner()), accounting().settleRetainedRequest(binding, owner()), accounting().settleRetainedRequest(binding, owner())];
  try {
    writer.exec('COMMIT');
    const results = await Promise.allSettled(pending);
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    for (const result of results) { if (result.status === 'rejected') throw result.reason; expect(result.value.state).toBe('settled'); }
    expect(getDb().query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
    expect(getDb().query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 1 });
    expect(readBudgetTerminalReceipt(binding)).toEqual(receipt);
    expect(getBudgetWork(binding.workId)?.closed_at).toBe(receivedAt);
  } finally { await Promise.allSettled(pending); if (writer.inTransaction) writer.exec('ROLLBACK'); writer.close(); }
});

test('retained request completion uses existing work-status owner to revoke only its allowances and overrides', async () => {
  const { helper, binding, receipt } = await fixture();
  const cap = saveBudgetCap({ id: 'request-grant-cap', scope: 'task', workId: binding.workId, metric: 'api_usd_micros', amount: 100 });
  const parentCap = saveBudgetCap({ id: 'parent-grant-cap', scope: 'task', workId: 'parent', metric: 'api_usd_micros', amount: 100 });
  for (const [workId, item] of [[binding.workId, cap], ['parent', parentCap]] as const) {
    setBudgetWarningsOnly({ workId, chatJid: binding.chatJid, now: earlier, expiresAt: later });
    grantBudgetAllowance({ workId, capId: item.id, capRevision: item.revision, windowId: `work:${workId}:r${item.revision}`, amount: 10, now: earlier, expiresAt: later });
  }
  await helper.settleRetainedRequest(binding, owner());
  expect(getDb().query('SELECT revoked_at FROM budget_overrides WHERE work_id=?').get(binding.workId)).toEqual({ revoked_at: receivedAt });
  expect(getDb().query('SELECT revoked_at FROM budget_allowances WHERE work_id=?').get(binding.workId)).toEqual({ revoked_at: receivedAt });
  expect(getDb().query("SELECT revoked_at FROM budget_overrides WHERE work_id='parent'").get()).toEqual({ revoked_at: null });
  expect(getDb().query("SELECT revoked_at FROM budget_allowances WHERE work_id='parent'").get()).toEqual({ revoked_at: null });
  expect(readBudgetTerminalReceipt(binding)).toEqual(receipt);
});

test('exact duplicates, lost ACK and database/helper reopen preserve original charge/hash/host time/closedAt', async () => {
  const { helper, binding, receipt, payload } = await fixture();
  // Simulated caller ACK loss AFTER the real transaction completed, not a
  // claim that a rejected settlement promise proves it was not applied.
  const lostAck = Error('postcommit ACK lost');
  await expect((async () => { await helper.settleRetainedRequest(binding, owner()); throw lostAck; })()).rejects.toBe(lostAck);
  const request = getBudgetRequest(binding.id), work = getBudgetWork(binding.workId), rows = financialRows();
  expect(recordBudgetTerminalReceipt(binding, payload, later)).toEqual(receipt);
  await helper.settleRetainedRequest(binding, owner());
  expect(getBudgetRequest(binding.id)).toEqual(request); expect(getBudgetWork(binding.workId)).toEqual(work);
  closeDatabase(); initDatabase(ownedPaths());
  await accounting().settleRetainedRequest(binding, owner());
  expect(readBudgetTerminalReceipt(binding)).toEqual(receipt);
  expect(getBudgetRequest(binding.id)).toEqual(request); expect(getBudgetWork(binding.workId)).toEqual(work);
  expect(financialRows()).toEqual(rows);
});

test('unknown retained valuation stays unresolved with original receipt, hold, cap blocker and active work', async () => {
  const message = terminal();
  message.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const { helper, binding, receipt } = await fixture(message), work = getBudgetWork(binding.workId);
  expect((await helper.settleRetainedRequest(binding, owner())).state).toBe('unresolved');
  expect(getBudgetRequest(binding.id)?.amount_microusd).toBe(60);
  expect(getBudgetRequest(binding.id)?.settlement_sha256).toBeNull();
  expect(getBudgetRequest(binding.id)?.usage_event_id).toBeNull();
  expect(getBudgetWork(binding.workId)).toEqual(work); expect(readBudgetTerminalReceipt(binding)).toEqual(receipt);
  expect(evaluateBudget({ workId: 'parent' }).blockers[0].reason).toBe('unknown_pricing'); unchangedFinancials();
  const unresolved = getBudgetRequest(binding.id);
  await Bun.sleep(2);
  await accounting().settleRetainedRequest(binding, owner());
  expect(getBudgetRequest(binding.id)).toEqual(unresolved);
  expect(getBudgetWork(binding.workId)).toEqual(work); unchangedFinancials();
});

test('absence and changed binding fail closed, with no reserve/dispatch/replay or work publication', async () => {
  const { helper, binding, payload } = await fixture(terminal(), false), before = getBudgetRequest(binding.id);
  await expect(helper.settleRetainedRequest(binding, owner())).rejects.toThrow('unavailable');
  recordBudgetTerminalReceipt(binding, payload, receivedAt);
  const retained = getBudgetRequest(binding.id);
  for (const changed of [{ ...binding, accountRef: 'changed' }, { ...binding, amountMicros: 61 },
    { ...binding, modelId: 'other' }, { ...binding, providerId: 'other' }, { ...binding, chatJid: 'web:other' }]) {
    await expect(helper.settleRetainedRequest(changed, owner())).rejects.toThrow('conflict');
  }
  expect(before?.state).toBe('dispatched'); expect(getBudgetRequest(binding.id)).toEqual(retained);
  expect(getBudgetWork(binding.workId)?.status).toBe('active'); unchangedFinancials();
});

for (const corruption of ['hash', 'body', 'time', 'envelope'] as const) test(`corrupt stored ${corruption} fails closed without repairing financial records`, async () => {
  const { db, helper, binding, receipt } = await fixture();
  if (!receipt) throw Error('missing fixture receipt');
  db.exec('DROP TRIGGER budget_request_receipt_no_update; PRAGMA ignore_check_constraints=ON');
  let body = receipt.bodyJson, hash = receipt.sha256, time = receipt.receivedAt;
  if (corruption === 'hash') hash = 'f'.repeat(64);
  if (corruption === 'body') body = 'not json';
  if (corruption === 'time') time = 'bad time';
  if (corruption === 'envelope') {
    const changed = JSON.parse(body); changed.requestId = 'another-request'; body = canonicalJson(changed);
    hash = createHash('sha256').update(body).digest('hex');
  }
  db.query('UPDATE budget_request_reservations SET terminal_receipt_json=?,terminal_receipt_sha256=?,terminal_received_at=?').run(body, hash, time);
  const before = getBudgetRequest(binding.id), work = getBudgetWork(binding.workId);
  await expect(helper.settleRetainedRequest(binding, owner())).rejects.toThrow('conflict');
  expect(getBudgetRequest(binding.id)).toEqual(before); expect(getBudgetWork(binding.workId)).toEqual(work); unchangedFinancials();
});

for (const invalid of ['model', 'role', 'usage', 'extra'] as const) test(`verified envelope with invalid projected ${invalid} cannot charge`, async () => {
  const { helper, binding, payload } = await fixture(terminal(), false);
  if (invalid === 'model') payload.projectedOutcome.responseModel = 'changed';
  if (invalid === 'role') payload.projectedOutcome.role = 'user';
  if (invalid === 'usage') payload.projectedOutcome.usage = { input: 1 };
  if (invalid === 'extra') {
    const message = terminal(); Object.assign(message.usage, { providerCost: 'not a number' });
    payload.projectedOutcome = JSON.parse(JSON.stringify(message));
  }
  const receipt = recordBudgetTerminalReceipt(binding, payload, receivedAt), before = getBudgetRequest(binding.id);
  await expect(helper.settleRetainedRequest(binding, owner())).rejects.toThrow();
  expect(getBudgetRequest(binding.id)).toEqual(before); expect(readBudgetTerminalReceipt(binding)).toEqual(receipt);
  expect(getBudgetWork(binding.workId)?.status).toBe('active'); unchangedFinancials();
});

test('caller/source cancellation after paid fact does not erase it; independent owner revocation denies SQL', async () => {
  const { binding, receipt } = await fixture(), caller = new AbortController();
  caller.abort(Error('caller cancelled')); let sourceCurrent = false;
  const helper = modelRequestAccounting({ documentedFree: false, usageSource: 'compaction', authorise() {
    caller.signal.throwIfAborted(); if (!sourceCurrent) throw Error('source revoked');
  } });
  const denied = Error('owner revoked'), before = getBudgetRequest(binding.id);
  await expect(helper.settleRetainedRequest(binding, { signal: new AbortController().signal, assertCurrent() { throw denied; } })).rejects.toBe(denied);
  const stopped = new AbortController(); stopped.abort(denied);
  await expect(helper.settleRetainedRequest(binding, { signal: stopped.signal, assertCurrent() {} })).rejects.toBe(denied);
  expect(getBudgetRequest(binding.id)).toEqual(before); unchangedFinancials();
  await helper.settleRetainedRequest(binding, owner());
  expect(getBudgetRequest(binding.id)?.state).toBe('settled'); expect(readBudgetTerminalReceipt(binding)).toEqual(receipt);
  expect(sourceCurrent).toBe(false);
});

for (const status of ['completed', 'cancelled', 'stopped'] as const) test(`paid receipt can settle without changing ${status} work or its closedAt/parent`, async () => {
  const { helper, binding } = await fixture();
  setBudgetWorkStatus(binding.workId, status, { now: earlier, boundary: 'original-close' });
  setBudgetWorkStatus('parent', 'stopped', { now: earlier });
  const work = getBudgetWork(binding.workId), parent = getBudgetWork('parent');
  await helper.settleRetainedRequest(binding, owner());
  expect(getBudgetRequest(binding.id)?.state).toBe('settled');
  expect(getBudgetWork(binding.workId)).toEqual(work); expect(getBudgetWork('parent')).toEqual(parent);
});

test('shared or parent work is outside the explicit dedicated request scope', async () => {
  const { helper, binding, receipt } = await fixture(terminal(), true, 'shared-work');
  const before = getBudgetRequest(binding.id), work = getBudgetWork(binding.workId), parent = getBudgetWork('parent');
  await expect(helper.settleRetainedRequest(binding, owner())).rejects.toThrow('invalid_binding');
  await expect(helper.settleRetainedRequest({ ...binding, workId: 'parent' }, owner())).rejects.toThrow('invalid_binding');
  expect(getBudgetRequest(binding.id)).toEqual(before); expect(readBudgetTerminalReceipt(binding)).toEqual(receipt);
  expect(getBudgetWork(binding.workId)).toEqual(work); expect(getBudgetWork('parent')).toEqual(parent); unchangedFinancials();
});

test('entered transaction is never blindly retried even for a SQLITE_BUSY-shaped post-write guard failure', async () => {
  const { db, helper, binding, receipt } = await fixture(), before = getBudgetRequest(binding.id), work = getBudgetWork(binding.workId);
  let writes = 0;
  db.function('count_status_write', () => { writes++; return 1; });
  db.exec(`CREATE TRIGGER count_write BEFORE UPDATE ON budget_work WHEN NEW.status='completed' BEGIN SELECT count_status_write(); END`);
  const busy = Object.assign(Error('entered callback busy'), { code: 'SQLITE_BUSY' });
  await expect(helper.settleRetainedRequest(binding, { signal: new AbortController().signal, assertCurrent() {
    if (getBudgetRequest(binding.id)?.state === 'settled') throw busy;
  } })).rejects.toBe(busy);
  expect(writes).toBe(1); expect(getBudgetRequest(binding.id)).toEqual(before);
  expect(getBudgetWork(binding.workId)).toEqual(work); expect(readBudgetTerminalReceipt(binding)).toEqual(receipt); unchangedFinancials();
  await helper.settleRetainedRequest(binding, owner()); expect(writes).toBe(2);
});

test('patient acquisition alone survives a real WAL writer beyond five seconds; frozen binding and retained usage win', async () => {
  const message = terminal(), { db, helper, binding, receipt } = await fixture(message), original = structuredClone(binding);
  const writer = new Database(ownedPaths().databasePath), lifetime = new AbortController();
  let ticks = 0, writes = 0;
  db.function('settlement_entered', () => { writes++; return 1; });
  db.exec(`CREATE TRIGGER count_settlement BEFORE UPDATE ON budget_request_reservations WHEN NEW.state='settled' BEGIN SELECT settlement_entered(); END`);
  writer.exec('BEGIN IMMEDIATE');
  const pulse = setInterval(() => { ticks++; }, 10), release = setTimeout(() => writer.exec('COMMIT'), 5_200);
  const deadline = setTimeout(() => lifetime.abort(Error('owned settlement deadline')), 10_000), started = performance.now();
  const pending = helper.settleRetainedRequest(binding, { signal: lifetime.signal, assertCurrent() {} });
  binding.accountRef = 'caller mutated'; message.usage.cost.input = 999;
  try {
    await pending;
    expect(performance.now() - started).toBeGreaterThanOrEqual(5_000); expect(ticks).toBeGreaterThan(20); expect(writes).toBe(1);
    expect(readBudgetTerminalReceipt(original)).toEqual(receipt);
    expect(db.query('SELECT api_usd_micros,accounted_at FROM budget_usage_events').get()).toEqual({ api_usd_micros: 40, accounted_at: receivedAt });
  } finally {
    lifetime.abort(); clearInterval(pulse); clearTimeout(release); clearTimeout(deadline);
    await Promise.allSettled([pending]); if (writer.inTransaction) writer.exec('ROLLBACK'); writer.close();
  }
}, 15_000);

for (const revoke of ['signal', 'owner'] as const) test(`patient acquisition rejects ${revoke} revocation while writer still holds, without stale SQL`, async () => {
  const { helper, binding, receipt } = await fixture(), before = getBudgetRequest(binding.id), work = getBudgetWork(binding.workId);
  const writer = new Database(ownedPaths().databasePath), lifetime = new AbortController(), denied = Error('lifetime revoked');
  let current = true;
  writer.exec('BEGIN IMMEDIATE');
  const pending = helper.settleRetainedRequest(binding, { signal: lifetime.signal, assertCurrent() { if (!current) throw denied; } });
  if (revoke === 'signal') lifetime.abort(denied); else current = false;
  try {
    await expect(pending).rejects.toBe(denied); expect(writer.inTransaction).toBe(true);
    expect(getBudgetRequest(binding.id)).toEqual(before); expect(getBudgetWork(binding.workId)).toEqual(work);
    expect(readBudgetTerminalReceipt(binding)).toEqual(receipt); unchangedFinancials();
  } finally { lifetime.abort(); await Promise.allSettled([pending]); writer.exec('ROLLBACK'); writer.close(); }
});

test('writer rechecks exact verified receipt snapshot rather than accepting changed bytes after acquisition wait', async () => {
  const { helper, binding } = await fixture(), writer = new Database(ownedPaths().databasePath);
  writer.exec('DROP TRIGGER budget_request_receipt_no_update; BEGIN IMMEDIATE');
  const pending = helper.settleRetainedRequest(binding, owner());
  writer.query('UPDATE budget_request_reservations SET terminal_received_at=? WHERE id=?').run(later, binding.id);
  writer.exec('COMMIT');
  const changed = getBudgetRequest(binding.id);
  try {
    await expect(pending).rejects.toThrow('conflict');
    expect(getBudgetRequest(binding.id)).toEqual(changed); expect(getBudgetWork(binding.workId)?.status).toBe('active'); unchangedFinancials();
  } finally { await Promise.allSettled([pending]); if (writer.inTransaction) writer.exec('ROLLBACK'); writer.close(); }
});

// Explicit old settlement shape, including legacy time and assistant source.
// Keep the original financial hash rather than enriching/revaluing old records.
function legacyUsage() {
  return { chat_jid: 'web:receipt', run_at: earlier, input_tokens: 1, output_tokens: 1, cache_read_tokens: 0,
    cache_write_tokens: 0, total_tokens: 2, cost_input: 0.00003, cost_output: 0.00001, cost_cache_read: 0,
    cost_cache_write: 0, cost_total: 0.00004, model: 'fixture-model', response_model: 'fixture-model', provider: 'fixture',
    api: 'openai-completions', usage_source: 'assistant' as const, api_equivalent_cost_known: true,
    api_equivalent_cost_microusd: 40, valuation_provenance: 'catalogue_estimate' as const };
}
test('pre-report legacy replay keeps original hash/time/provenance and charge bytes, not new reporting metadata', async () => {
  const { db, helper, binding, receipt } = await fixture();
  settleBudgetRequest(binding, legacyUsage());
  db.exec(`DROP TRIGGER budget_usage_events_no_update;
    UPDATE budget_usage_events SET report_payload_json=NULL,report_payload_sha256=NULL;
    CREATE TRIGGER budget_usage_events_no_update BEFORE UPDATE ON budget_usage_events BEGIN SELECT RAISE(ABORT,'budget usage events are immutable'); END`);
  const before = getBudgetRequest(binding.id), rows = financialRows();
  expect(before?.settlement_sha256).toBe(createHash('sha256').update(canonicalJson(legacyUsage())).digest('hex'));
  await helper.settleRetainedRequest(binding, owner());
  expect(getBudgetRequest(binding.id)).toEqual(before); expect(financialRows()).toEqual(rows);
  expect(readBudgetTerminalReceipt(binding)).toEqual(receipt); expect(getBudgetWork(binding.workId)?.closed_at).toBe(receivedAt);
});

test('receipt reconciliation of an already recorded shipping settlement keeps original host time and exact charge', async () => {
  const message = terminal(), { helper, binding, receipt } = await fixture(message);
  await helper.settle(binding, message);
  const before = getBudgetRequest(binding.id), rows = financialRows();
  await accounting().settleRetainedRequest(binding, owner());
  expect(getBudgetRequest(binding.id)).toEqual(before); expect(financialRows()).toEqual(rows);
  expect(readBudgetTerminalReceipt(binding)).toEqual(receipt);
});
