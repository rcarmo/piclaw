import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';
import { createTempWorkspace } from '../helpers.js';
import { isolateBudgetTestDatabase } from './fixture.js';
import { getDb } from '../../src/db/connection.js';
import { ensureBudgetWork, saveBudgetCap, setBudgetWorkStatus, grantBudgetAllowance, setBudgetWarningsOnly } from '../../src/db/budget-limits.js';
import { evaluateBudget } from '../../src/budget/evaluator.js';
import { recordSessionEventUsage } from '../../src/agent-pool/usage.js';
import { withBudgetWorkContext } from '../../src/budget/context.js';
import { reserveBudgetRequest, dispatchBudgetRequest, settleBudgetRequest, abandonBudgetRequest, getBudgetRequest, findBudgetRequestByModelInvocation, findBudgetRequestByLogicalModelInvocation, type BudgetModelInvocation, type BudgetModelInvocationIdentity, type BudgetRequestBinding } from '../../src/db/budget-request-reservations.js';
isolateBudgetTestDatabase();
function fixture(amount = 100) {
  const db = getDb();
  ensureBudgetWork({ id: 'parent', chatJid: 'web:parent', executionKind: 'interactive' });
  ensureBudgetWork({ id: 'child', chatJid: 'web:child', executionKind: 'delegate', parentWorkId: 'parent' });
  const cap = saveBudgetCap({ id: 'task-cap', scope: 'task', metric: 'api_usd_micros', amount, workId: 'parent' });
  const binding: BudgetRequestBinding = { id: 'request-1', workId: 'child', chatJid: 'web:child', providerId: 'fixture', modelId: 'fixture-model', accountRef: 'account-generation-1', amountMicros: 60 };
  return { db, cap, binding };
}
const request = () => ({ authorise() {}, signal: new AbortController().signal });
const usage = (cost = 40) => ({ chat_jid: 'web:child', run_at: '2026-10-04T12:00:00.000Z', input_tokens: 10, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 12,
  cost_input: cost / 1e6, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0, cost_total: cost / 1e6,
  provider: 'fixture', model: 'fixture-model', api_equivalent_cost_microusd: cost, api_equivalent_cost_known: true, valuation_provenance: 'catalogue_estimate' as const });

test('reservation holds shared ancestor balance and existing parent admission sees it', () => {
  const { binding } = fixture();
  expect(reserveBudgetRequest(binding).state).toBe('reserved');
  expect(() => reserveBudgetRequest({ ...binding, id: 'request-2' })).toThrow('budget_denied');
  const parent = evaluateBudget({ workId: 'parent', pendingRequest: { amountMicros: 41 } });
  expect(parent.action).toBe('pause');
  expect(parent.blockers[0].knownUsage).toBe(101);
  expect(reserveBudgetRequest(binding).id).toBe(binding.id);
  expect(() => reserveBudgetRequest({ ...binding, amountMicros: 1 })).toThrow('conflict');
});
test('dispatch excludes its own hold but charges the proposed bound once and never dispatches twice', () => {
  const { binding } = fixture(60);
  reserveBudgetRequest(binding);
  expect(dispatchBudgetRequest(binding, request()).state).toBe('dispatched');
  expect(() => dispatchBudgetRequest(binding, request())).toThrow('invalid_state');
  expect(evaluateBudget({ workId: 'parent' }).action).toBe('pause');
});
test('a zero-cost prospective request cannot revive an already exhausted cap', () => {
  const {binding}=fixture(60);reserveBudgetRequest(binding);dispatchBudgetRequest(binding,request());
  expect(()=>reserveBudgetRequest({...binding,id:'zero-cost-after-exhaustion',amountMicros:0})).toThrow('budget_denied');
});
test('dispatch revalidates revised caps, ancestors, caller and cancellation', () => {
  const { binding, cap } = fixture(); reserveBudgetRequest(binding);
  saveBudgetCap({ id: cap.id, scope: 'task', metric: 'api_usd_micros', amount: 59, workId: 'parent' });
  expect(() => dispatchBudgetRequest(binding, request())).toThrow('budget_denied');
  saveBudgetCap({ id: cap.id, scope: 'task', metric: 'api_usd_micros', amount: 100, workId: 'parent' });
  setBudgetWorkStatus('parent', 'paused'); expect(() => dispatchBudgetRequest(binding, request())).toThrow('unavailable');
  setBudgetWorkStatus('parent', 'active');
  expect(() => dispatchBudgetRequest(binding, { ...request(), authorise() { throw Error('revoked'); } })).toThrow('revoked');
  const abort = new AbortController(); abort.abort(Error('cancelled'));
  expect(() => dispatchBudgetRequest(binding, { authorise() {}, signal: abort.signal })).toThrow('cancelled');
  expect(getBudgetRequest(binding.id)?.state).toBe('reserved');
});
test('known-unsent cancellation releases, dispatched unknown outcome blocks independently of tokens', () => {
  const { db, binding } = fixture(); reserveBudgetRequest(binding);
  expect(abandonBudgetRequest(binding).state).toBe('released');
  const sent = { ...binding, id: 'sent' }; reserveBudgetRequest(sent); dispatchBudgetRequest(sent, request());
  expect(abandonBudgetRequest(sent).state).toBe('unresolved');
  expect(evaluateBudget({ workId: 'parent' }).blockers[0].reason).toBe('unknown_pricing');
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  setBudgetWorkStatus('child', 'cancelled');
  expect(settleBudgetRequest(sent, usage()).state).toBe('settled');
  expect(evaluateBudget({ workId: 'parent' }).action).toBe('allow');
});
test('settlement attributes captured ownership once, compares payload and atomically releases hold', () => {
  const { db, binding } = fixture(); reserveBudgetRequest(binding); dispatchBudgetRequest(binding, request());
  expect(settleBudgetRequest(binding, usage()).state).toBe('settled');
  expect(settleBudgetRequest(binding, { ...usage() }).state).toBe('settled');
  expect(() => settleBudgetRequest(binding, usage(41))).toThrow('conflict');
  expect(() => settleBudgetRequest({ ...binding, accountRef: 'other-account' }, usage())).toThrow('conflict');
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
  expect(db.query('SELECT work_id,invocation_id,chat_jid FROM budget_usage_events').get()).toEqual({ work_id: 'child', invocation_id: binding.id, chat_jid: binding.chatJid });
  expect(evaluateBudget({ workId: 'parent' }).action).toBe('allow');
});
test('unknown zero telemetry cannot settle an ambiguous dispatched request or release its hold', () => {
  const { db, binding } = fixture(); reserveBudgetRequest(binding); dispatchBudgetRequest(binding, request()); abandonBudgetRequest(binding);
  const unknown = { ...usage(0), input_tokens: 0, output_tokens: 0, total_tokens: 0, api_equivalent_cost_known: false, api_equivalent_cost_microusd: null, valuation_provenance: 'unavailable' as const };
  expect(settleBudgetRequest(binding, unknown).state).toBe('unresolved');
  expect(evaluateBudget({ workId: 'parent' }).blockers[0].reason).toBe('unknown_pricing');
  expect(() => reserveBudgetRequest({ ...binding, id: 'after-unknown', amountMicros: 1 })).toThrow('budget_denied');
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  expect(settleBudgetRequest(binding, { ...unknown, api_equivalent_cost_known: true, api_equivalent_cost_microusd: 0, valuation_provenance: 'documented_free' }).state).toBe('settled');
  expect(evaluateBudget({ workId: 'parent' }).action).toBe('allow');
});
test('zero known without explicit free provenance and contradictory pricing reject', () => {
  const { binding } = fixture(); reserveBudgetRequest(binding); dispatchBudgetRequest(binding, request());
  expect(() => settleBudgetRequest(binding, usage(0))).toThrow('invalid_binding');
  expect(() => settleBudgetRequest(binding, { ...usage(), valuation_provenance: 'documented_free' })).toThrow('invalid_binding');
  expect(() => settleBudgetRequest(binding, { ...usage(), api_equivalent_cost_known: false })).toThrow('invalid_binding');
  expect(() => settleBudgetRequest(binding, { ...usage(), api_equivalent_cost_microusd: 1 })).toThrow('invalid_binding');
  const emptyFree={...usage(0),input_tokens:0,output_tokens:0,total_tokens:0,valuation_provenance:'documented_free' as const};
  expect(()=>settleBudgetRequest(binding,{...emptyFree,cost_input:0.01})).toThrow('invalid_binding');
  expect(getBudgetRequest(binding.id)?.state).toBe('dispatched');
});
test('actual parent tool usage replay shares the globally generated invocation identity', () => {
  const { db, binding } = fixture(); reserveBudgetRequest(binding); dispatchBudgetRequest(binding, request()); settleBudgetRequest(binding, usage());
  withBudgetWorkContext({ workId: 'parent', chatJid: 'web:parent', kind: 'interactive' }, () => recordSessionEventUsage('web:parent', {
    type: 'message_end', message: { role: 'toolResult', toolCallId: 'delegate-tool-call', provider: 'fixture', model: 'fixture-model',
      usage: { invocationId: binding.id, input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12,
        cost: { input: 0.00004, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.00004 } } },
  }));
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
  expect(db.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 1 });
  expect(db.query('SELECT usage_event_id,work_id FROM token_usage').get()).toEqual({ usage_event_id: `usage:invocation:${binding.id}`, work_id: 'child' });
});
test('usage/ledger storage fault rolls back both settlement and charge', () => {
  const { db, binding } = fixture(); reserveBudgetRequest(binding); dispatchBudgetRequest(binding, request());
  db.exec("CREATE TRIGGER deny_request_settle BEFORE UPDATE ON budget_request_reservations WHEN NEW.state='settled' BEGIN SELECT RAISE(ABORT,'fault'); END");
  expect(() => settleBudgetRequest(binding, usage())).toThrow('fault');
  expect(getBudgetRequest(binding.id)?.state).toBe('dispatched');
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  expect(db.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 0 });
});
test('outstanding holds survive new caps and calendar rollover conservatively', () => {
  const { binding } = fixture(1000); reserveBudgetRequest(binding);
  saveBudgetCap({ scope: 'instance_daily', metric: 'api_usd_micros', amount: 50, timezone: 'UTC' });
  const decision = evaluateBudget({ workId: 'parent', now: new Date('2030-01-01T00:00:00Z') });
  expect(decision.action).toBe('pause'); expect(decision.blockers[0].knownUsage).toBe(60);
});
test('unknown bounds fail closed under dollar caps, but no cap does not imply a new cap', () => {
  const { binding, cap } = fixture();
  expect(() => reserveBudgetRequest({ ...binding, amountMicros: null })).toThrow('budget_denied');
  getDb().query('UPDATE budget_caps SET enabled=0 WHERE id=?').run(cap.id);
  expect(reserveBudgetRequest({ ...binding, amountMicros: null }).state).toBe('reserved');
  saveBudgetCap({ id: cap.id, scope: 'task', metric: 'api_usd_micros', amount: 1000, workId: 'parent' });
  expect(evaluateBudget({ workId: 'parent' }).blockers[0].reason).toBe('unknown_pricing');
});
test('invalid binding and mismatched usage never create or release capacity', () => {
  const { db, binding } = fixture();
  expect(() => reserveBudgetRequest({ ...binding, amountMicros: NaN })).toThrow('invalid_binding');
  expect(() => reserveBudgetRequest({ ...binding, chatJid: 'web:wrong' })).toThrow('unavailable');
  reserveBudgetRequest(binding); dispatchBudgetRequest(binding, request());
  expect(() => settleBudgetRequest(binding, { ...usage(), provider: 'other' })).toThrow('conflict');
  expect(() => settleBudgetRequest(binding, { ...usage(), total_tokens: -1 })).toThrow('invalid_binding');
  expect(getBudgetRequest(binding.id)?.state).toBe('dispatched'); expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
});
test('a scheduled child shares its occurrence cap and sibling holds, not another run', () => {
  const db = getDb();
  ensureBudgetWork({ id: 'scheduled-parent', chatJid: 'web:scheduled', executionKind: 'scheduled', scheduledTaskId: 'scheduled-task' });
  for (const id of ['scheduled-child-a','scheduled-child-b']) ensureBudgetWork({ id, chatJid: 'web:scheduled', executionKind: 'delegate', parentWorkId: 'scheduled-parent' });
  ensureBudgetWork({ id: 'scheduled-second', chatJid: 'web:scheduled', executionKind: 'scheduled', scheduledTaskId: 'scheduled-task' });
  saveBudgetCap({ scope: 'scheduled_run', metric: 'api_usd_micros', amount: 100, scheduledTaskId: 'scheduled-task' });
  const binding: BudgetRequestBinding = { id: 'scheduled-request', workId: 'scheduled-child-a', chatJid: 'web:scheduled', providerId: 'fixture', modelId: 'fixture', accountRef: 'account', amountMicros: 60 };
  reserveBudgetRequest(binding);
  expect(() => reserveBudgetRequest({ ...binding, id: 'sibling-request', workId: 'scheduled-child-b' })).toThrow('budget_denied');
  expect(evaluateBudget({ workId: 'scheduled-parent' }).action).toBe('allow');
  expect(reserveBudgetRequest({ ...binding, id: 'second-run-request', workId: 'scheduled-second' }).state).toBe('reserved');
  expect(db.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 2 });
});
test('allowance expiry and explicit warnings-only retain existing operator policy', () => {
  const { binding, cap } = fixture(50); const now = new Date('2026-10-04T12:00:00Z');
  grantBudgetAllowance({ workId: 'parent', capId: cap.id, capRevision: cap.revision, windowId: `work:parent:r${cap.revision}`, amount: 20, expiresAt: '2026-10-04T13:00:00Z', now: now.toISOString() });
  reserveBudgetRequest(binding, { now });
  expect(() => dispatchBudgetRequest(binding, { ...request(), now: new Date('2026-10-04T13:00:00Z') })).toThrow('budget_denied');
  setBudgetWarningsOnly({ workId: 'parent', chatJid: 'web:parent', expiresAt: '2026-10-04T14:00:00Z', now: now.toISOString() });
  expect(dispatchBudgetRequest(binding, { ...request(), now: new Date('2026-10-04T13:00:00Z') }).state).toBe('dispatched');
  expect(evaluateBudget({ workId: 'parent', now: new Date('2026-10-04T13:30:00Z') }).action).toBe('warn');
});
test('provider-window evidence is exact for selected account and never borrowed from another provider', () => {
  const { binding } = fixture(1000); const selected = { ...binding, providerId: 'openai-codex', accountRef: 'account' };
  saveBudgetCap({ id: 'provider-cap', scope: 'provider_window', metric: 'provider_percent_used_micros', amount: 80_000_000, providerId: 'openai-codex', quotaDimension: 'primary.percent_used', accountRef: 'account' });
  const now = new Date('2026-10-04T12:00:00Z'), evidence = { capId: 'provider-cap', providerId: 'openai-codex', accountRef: 'account', quotaDimension: 'primary.percent_used', windowId: 'provider-window', fetchedAt: now.toISOString(), resetsAt: '2026-10-04T13:00:00Z', stale: false, availability: 'available', valueMicros: 50_000_000, source: 'synthetic' };
  expect(() => reserveBudgetRequest(selected, { now, providerEvidence: [{ ...evidence, accountRef: 'wrong' }] })).toThrow('budget_denied');
  expect(() => reserveBudgetRequest(selected, { now, providerEvidence: [{ ...evidence, providerId: 'openrouter' }] })).toThrow('budget_denied');
  expect(() => reserveBudgetRequest(selected, { now, providerEvidence: [{ ...evidence, quotaDimension: 'secondary.percent_used' }] })).toThrow('budget_denied');
  expect(() => reserveBudgetRequest(selected, { now, providerEvidence: [{ ...evidence, fetchedAt: '2026-10-04T11:00:00Z' }] })).toThrow('budget_denied');
  expect(() => reserveBudgetRequest(selected, { now, providerEvidence: [{ ...evidence, fetchedAt: '2026-10-04T12:01:00Z' }] })).toThrow('budget_denied');
  expect(() => reserveBudgetRequest(selected, { now, providerEvidence: [{ ...evidence, resetsAt: 'not-a-date' }] })).toThrow('budget_denied');
  expect(() => reserveBudgetRequest(selected, { now, providerEvidence: [{ ...evidence, resetsAt: now.toISOString() }] })).toThrow('budget_denied');
  expect(reserveBudgetRequest(selected, { now, providerEvidence: [evidence] }).state).toBe('reserved');
  expect(() => dispatchBudgetRequest(selected, { ...request(), now, providerEvidence: [{ ...evidence, stale: true }] })).toThrow('budget_denied');
  expect(dispatchBudgetRequest(selected, { ...request(), now, providerEvidence: [evidence] }).state).toBe('dispatched');
});
test('safe-integer accounting rejects aggregate hold overflow rather than rounding capacity', () => {
  const { db, binding } = fixture(); db.query('UPDATE budget_caps SET enabled=0').run();
  reserveBudgetRequest({ ...binding, amountMicros: Number.MAX_SAFE_INTEGER });
  reserveBudgetRequest({ ...binding, id: 'overflow-second', amountMicros: 1 });
  saveBudgetCap({ scope: 'instance_daily', metric: 'api_usd_micros', amount: Number.MAX_SAFE_INTEGER, timezone: 'UTC' });
  expect(() => evaluateBudget({ workId: 'parent' })).toThrow('safe integer accounting');
});
test('a dispatched unresolved hold survives WAL reopen and late settlement uses the reopened handle', async () => {
  const { db, binding } = fixture(); reserveBudgetRequest(binding); dispatchBudgetRequest(binding, request()); abandonBudgetRequest(binding);
  const ws = createTempWorkspace('budget-request-reopen-'), path = join(ws.workspace,'requests.db'); await Bun.write(path,db.serialize());
  let disk = new Database(path); disk.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');disk.close();disk=new Database(path);
  try {
    expect(getBudgetRequest(binding.id,disk)?.state).toBe('unresolved');
    expect(evaluateBudget({workId:'parent'},disk).blockers[0].reason).toBe('unknown_pricing');
    expect(settleBudgetRequest(binding,usage(),disk).state).toBe('settled');
    expect(disk.query('SELECT count(*) n FROM token_usage').get()).toEqual({n:1});
    expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({n:0});
    expect(evaluateBudget({workId:'parent'},disk).action).toBe('allow');
  } finally { disk.close();ws.cleanup(); }
});
test('two real WAL writer processes cannot reserve the same remaining balance', async () => {
  const db = getDb();
  ensureBudgetWork({ id: 'concurrent-parent', chatJid: 'web:concurrent-parent', executionKind: 'interactive' });
  ensureBudgetWork({ id: 'concurrent-child', chatJid: 'web:concurrent-child', executionKind: 'delegate', parentWorkId: 'concurrent-parent' });
  saveBudgetCap({ scope: 'task', metric: 'api_usd_micros', amount: 100, workId: 'concurrent-parent' });
  const ws = createTempWorkspace('budget-reservation-wal-'), path = join(ws.workspace,'requests.db'), release = join(ws.workspace,'release');
  await Bun.write(path,db.serialize());
  const disk = new Database(path); disk.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  const launcher = join(import.meta.dir,'../../scripts/local-test-priority.ts'), fixture = join(import.meta.dir,'../fixtures/budget-request-concurrent.ts');
  const children = [1,2].map(index => {
    const marker = join(ws.workspace,`ready-${index}`);
    const child = Bun.spawn([process.execPath,'--no-env-file',launcher,'--',process.execPath,'--no-env-file',fixture,path,marker,release,`concurrent-${index}`],{stdin:'ignore',stdout:'pipe',stderr:'pipe'});
    return {marker,child,result:Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])};
  });
  const timer = setTimeout(()=>{for(const c of children)c.child.kill('SIGKILL');},7000);
  try {
    const deadline = Date.now()+4000;
    while(!children.every(c=>existsSync(c.marker))){if(Date.now()>=deadline)throw Error('Owned WAL writers not ready');await Bun.sleep(5);}
    writeFileSync(release,'go');
    const results = await Promise.all(children.map(async c=>{const [exit,stdout,stderr]=await c.result;expect(exit,stderr).toBe(0);return JSON.parse(stdout.trim().split('\n').at(-1)!);}));
    expect(results.filter(r=>r.accepted)).toHaveLength(1);
    expect(disk.query("SELECT count(*) n FROM budget_request_reservations WHERE state='reserved'").get()).toEqual({n:1});
    expect((disk.query('PRAGMA synchronous').get() as {synchronous:number}).synchronous).toBe(2);
  } finally { clearTimeout(timer);for(const c of children){if(c.child.exitCode===null)c.child.kill('SIGKILL');await c.child.exited;}disk.close();ws.cleanup(); }
},10000);

const logicalInvocation = (): BudgetModelInvocationIdentity => ({
  version: 1, domain: 'fixture-sdk', conversationId: 17, taskId: 23,
  taskKind: 'pi.generation', phase: 'request', checkpointHash: 'a'.repeat(64),
});

test('logical invocation lookup uses the migrated index and returns the original full binding without writes', () => {
  const { db, binding } = fixture(1000);
  const scopes: BudgetModelInvocationIdentity[] = [logicalInvocation(), { ...logicalInvocation(), taskKind: 'pi.compaction', phase: 'summarize' }];
  const originals = scopes.map((scope, index) => reserveBudgetRequest({
    ...binding, id: `logical-${index}`, modelInvocation: { ...scope, operationId: `original-operation-${index}` },
  }));
  const plan = db.query('EXPLAIN QUERY PLAN SELECT * FROM budget_request_reservations WHERE model_invocation_key_sha256=?')
    .all(originals[0].model_invocation_key_sha256) as { detail: string }[];
  expect(plan.some(row => /SEARCH .*USING INDEX idx_budget_requests_model_invocation/.test(row.detail))).toBe(true);
  const changes = db.query('SELECT total_changes() n').get();
  const rows = db.query('SELECT * FROM budget_request_reservations ORDER BY id').all();
  // SQLite itself forbids even a transient write during both hits and misses.
  db.exec('PRAGMA query_only=ON');
  try {
    for (const [index, scope] of scopes.entries()) {
      const found = findBudgetRequestByLogicalModelInvocation(scope, db);
      expect(found).toEqual(originals[index]); // Includes original hashes, timestamps and reserved state.
      expect(JSON.parse(found!.model_invocation_json!)).toEqual({ ...scope, operationId: `original-operation-${index}` });
      expect(findBudgetRequestByLogicalModelInvocation(Object.assign(Object.create(null), scope), db)).toEqual(found);
    }
    const scope = scopes[0];
    const misses: BudgetModelInvocationIdentity[] = [
      { ...scope, domain: 'other-sdk' }, { ...scope, conversationId: 18 },
      { ...scope, taskId: 24 }, { ...scope, checkpointHash: 'b'.repeat(64) },
      { ...scope, taskKind: 'pi.compaction', phase: 'summarize', taskId: 24 },
    ];
    for (const miss of misses) expect(findBudgetRequestByLogicalModelInvocation(miss, db)).toBeNull();
    expect(db.query('SELECT * FROM budget_request_reservations ORDER BY id').all()).toEqual(rows);
    expect(db.query('SELECT total_changes() n').get()).toEqual(changes);
    expect(db.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 2 });
    expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
    expect(db.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 0 });
  } finally { db.exec('PRAGMA query_only=OFF'); }
});

test('logical lookup omits operationId without relaxing the existing full invocation lookup', () => {
  const { db, binding } = fixture();
  const logical = logicalInvocation(), full: BudgetModelInvocation = { ...logical, operationId: 'original-operation' };
  const original = reserveBudgetRequest({ ...binding, modelInvocation: full });
  const changes = db.query('SELECT total_changes() n').get();
  expect(findBudgetRequestByLogicalModelInvocation(logical, db)).toEqual(original);
  expect(findBudgetRequestByModelInvocation(full, db)).toEqual(original);
  expect(() => findBudgetRequestByModelInvocation(logical as BudgetModelInvocation, db)).toThrow('invalid_binding');
  expect(() => findBudgetRequestByModelInvocation({ ...full, operationId: 'replacement-operation' }, db)).toThrow('conflict');
  for (const operationId of [full.operationId, 'replacement-operation', undefined, null]) {
    expect(() => findBudgetRequestByLogicalModelInvocation({ ...logical, operationId } as BudgetModelInvocationIdentity, db)).toThrow('invalid_binding');
  }
  expect(getBudgetRequest(binding.id, db)).toEqual(original);
  expect(db.query('SELECT total_changes() n').get()).toEqual(changes);
});

test('logical invocation selector rejects missing fields and invalid values rather than returning absence', () => {
  const { db, binding } = fixture();
  const scope = logicalInvocation();
  const original = reserveBudgetRequest({ ...binding, modelInvocation: { ...scope, operationId: 'original-operation' } });
  const changes = db.query('SELECT total_changes() n').get();
  const invalid: unknown[] = [null, undefined, 1, 'scope', [], Object.create(scope),
    { ...scope, extra: true }, { ...scope, [Symbol('extra')]: true }];
  for (const key of Object.keys(scope)) {
    const missing = { ...scope } as Record<string, unknown>;
    delete missing[key];
    invalid.push(missing, { ...scope, [key]: undefined }, { ...scope, [key]: null },
      Object.defineProperty({ ...scope }, key, { enumerable: false }));
  }
  const invalidFields: Record<string, unknown[]> = {
    version: [0, 2, '1'],
    domain: ['', ' \t', 1, 'bad\u0000domain', 'x'.repeat(257)],
    conversationId: [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '17'],
    taskId: [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '23'],
    taskKind: ['generation', 'pi.compaction'], phase: ['summarize', 'other'],
    checkpointHash: ['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), 1],
  };
  for (const [key, values] of Object.entries(invalidFields)) {
    for (const value of values) invalid.push({ ...scope, [key]: value });
  }
  for (const candidate of invalid) {
    expect(() => findBudgetRequestByLogicalModelInvocation(candidate as BudgetModelInvocationIdentity, db)).toThrow('invalid_binding');
  }
  expect(getBudgetRequest(binding.id, db)).toEqual(original);
  expect(db.query('SELECT total_changes() n').get()).toEqual(changes);
});

test('logical invocation selector rejects accessors and proxies without executing getters or traps', () => {
  const { db } = fixture();
  const scope = logicalInvocation();
  let executions = 0;
  const trap = () => { executions++; throw Error('selector executed caller code'); };
  const candidates: unknown[] = Object.keys(scope).map(key => Object.defineProperty({ ...scope }, key, { enumerable: true, get: trap }));
  candidates.push(Object.defineProperty({ ...scope }, 'operationId', { enumerable: true, get: trap }),
    new Proxy(scope, { get: trap, has: trap, ownKeys: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap }));
  const revoked = Proxy.revocable(scope, {});
  revoked.revoke();
  candidates.push(revoked.proxy);
  const changes = db.query('SELECT total_changes() n').get();
  for (const candidate of candidates) {
    expect(() => findBudgetRequestByLogicalModelInvocation(candidate as BudgetModelInvocationIdentity, db)).toThrow('invalid_binding');
  }
  expect(executions).toBe(0);
  expect(db.query('SELECT total_changes() n').get()).toEqual(changes);
  expect(db.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 0 });
});

test('logical invocation lookup cannot return a malformed or corrupted stored full binding', () => {
  const { db, binding } = fixture();
  const logical = logicalInvocation(), full: BudgetModelInvocation = { ...logical, operationId: 'original-operation' };
  const original = reserveBudgetRequest({ ...binding, modelInvocation: full });
  const stored = JSON.parse(original.model_invocation_json!);
  const withoutOperation = { ...stored };
  delete withoutOperation.operationId;
  const corruptions = [
    { column: 'model_invocation_json', value: null },
    ...['{', 'null', '[]', JSON.stringify(withoutOperation),
      JSON.stringify({ ...stored, operationId: '' }), JSON.stringify({ ...stored, operationId: 'replacement-operation' }),
      JSON.stringify({ ...stored, taskId: stored.taskId + 1 }), JSON.stringify({ ...stored, extra: true }),
      ` ${original.model_invocation_json}`].map(value => ({ column: 'model_invocation_json' as const, value })),
    { column: 'binding_sha256', value: '0'.repeat(64) },
    { column: 'id', value: 'corrupted-request' }, { column: 'work_id', value: 'parent' },
    { column: 'chat_jid', value: 'web:other' }, { column: 'provider_id', value: 'other-provider' },
    { column: 'model_id', value: 'other-model' }, { column: 'account_ref', value: 'other-account' },
    { column: 'amount_microusd', value: 1 },
  ] as const;
  const { rowid } = db.query('SELECT rowid FROM budget_request_reservations WHERE id=?').get(binding.id) as { rowid: number };
  // Fault injection ONLY in this disposable migrated DB, never an alternate schema.
  // Remove the immutability guard and permit a torn NULL/nonnull pair to exercise defensive reads.
  db.exec('DROP TRIGGER budget_request_invocation_no_update; PRAGMA ignore_check_constraints=ON');
  expect(() => db.query('UPDATE budget_request_reservations SET model_invocation_json=? WHERE rowid=?').run('{', rowid)).toThrow('malformed JSON');
  db.exec('DROP INDEX idx_budget_requests_domain_state'); // Deliberate physical corruption crosses this additional integrity barrier too.
  try {
    for (const { column, value } of corruptions) {
      const update = db.query(`UPDATE budget_request_reservations SET ${column}=? WHERE rowid=?`);
      update.run(value, rowid);
      try {
        const damaged = db.query('SELECT * FROM budget_request_reservations WHERE rowid=?').get(rowid);
        const changes = db.query('SELECT total_changes() n').get();
        expect(() => findBudgetRequestByLogicalModelInvocation(logical, db)).toThrow('conflict');
        expect(db.query('SELECT * FROM budget_request_reservations WHERE rowid=?').get(rowid)).toEqual(damaged);
        expect(db.query('SELECT total_changes() n').get()).toEqual(changes);
      } finally { update.run(original[column], rowid); }
    }
  } finally { db.exec('PRAGMA ignore_check_constraints=OFF'); }
  expect(findBudgetRequestByLogicalModelInvocation(logical, db)).toEqual(original);
  expect(db.query('SELECT count(*) n FROM budget_request_reservations').get()).toEqual({ n: 1 });
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  expect(db.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 0 });
});
