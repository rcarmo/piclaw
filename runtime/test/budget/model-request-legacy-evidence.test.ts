import { afterEach, beforeEach, expect, test } from 'bun:test';
import { closeDatabase, getDb, initDatabase } from '../../src/db/connection.js';
import { createTempWorkspace, setEnv, type TempWorkspace } from '../helpers.js';
import { resolveRuntimeConfigPaths } from '../../src/core/config-paths.js';
import { applyOwnedMigrations } from '../../src/db/migrations.js';
import { budgetTerminalEvidenceVersionMigration } from '../../src/db/budget-limits-schema.js';
import { ensureBudgetWork, saveBudgetCap } from '../../src/db/budget-limits.js';
import { abandonBudgetRequest, dispatchBudgetRequest, getBudgetRequest, recordBudgetTerminalReceipt,
  reserveBudgetRequest, type BudgetModelInvocation, type BudgetRequestBinding } from '../../src/db/budget-request-reservations.js';
import { assertModelAccountingReady } from '../../src/budget/model-request-accounting.js';

let workspace: TempWorkspace, restore: () => void;
function ownedPaths() { return resolveRuntimeConfigPaths({ env: { ...process.env, PICLAW_DB_IN_MEMORY: '0' } }); }
beforeEach(() => {
  closeDatabase(); workspace = createTempWorkspace('legacy-accounting-');
  restore = setEnv({ PICLAW_WORKSPACE: workspace.workspace, PICLAW_STORE: workspace.store, PICLAW_DATA: workspace.data });
  initDatabase(ownedPaths()); const db = getDb();
  // Reproduce the exact v4 schema, before provenance existed. Fixture changes only.
  db.exec(`DROP TRIGGER budget_request_evidence_version_insert;
    DROP TRIGGER budget_request_evidence_version_update;
    ALTER TABLE budget_request_reservations DROP COLUMN terminal_evidence_version;
    DELETE FROM piclaw_schema_migrations WHERE owner='host.budget-request-reservations' AND id='terminal-evidence-version-v1';`);
  ensureBudgetWork({ id: 'operation', chatJid: 'web:legacy-evidence', executionKind: 'interactive' });
  saveBudgetCap({ scope: 'task', workId: 'operation', metric: 'api_usd_micros', amount: 100 });
});
afterEach(() => { closeDatabase(); restore?.(); workspace?.cleanup(); });
function seed(id: string, createdAt = '2020-01-01T00:00:00.000Z', invocation?: BudgetModelInvocation) {
  const binding: BudgetRequestBinding = { id, workId: `durable-request:${id}`, chatJid: 'web:legacy-evidence',
    providerId: 'fixture', modelId: 'fixture-model', accountRef: 'fixture-account', amountMicros: 60,
    ...(invocation ? { modelInvocation: invocation } : {}) };
  ensureBudgetWork({ id: binding.workId, chatJid: binding.chatJid, executionKind: 'interactive', parentWorkId: 'operation' });
  reserveBudgetRequest(binding, { now: new Date(createdAt) }); dispatchBudgetRequest(binding, { signal: new AbortController().signal, authorise() {} }); abandonBudgetRequest(binding);
  return binding;
}
function migrate() { applyOwnedMigrations(getDb(), [budgetTerminalEvidenceVersionMigration]); }
function snapshot(id: string) {
  const row = { ...getBudgetRequest(id)! } as Partial<ReturnType<typeof getBudgetRequest>>;
  delete row!.terminal_evidence_version;
  return { row, work: getDb().query('SELECT * FROM budget_work ORDER BY id').all(),
    charges: getDb().query('SELECT * FROM budget_usage_events').all(), usage: getDb().query('SELECT * FROM token_usage').all() };
}

test('pre-retention unknown hold survives upgrade/reopen without demanding nonexistent proof', () => {
  const binding = seed('legacy'), before = snapshot(binding.id);
  migrate();
  expect(getBudgetRequest(binding.id)?.terminal_evidence_version).toBe(0);
  for (const terminal of [false, true]) expect(() => assertModelAccountingReady('operation', getDb(), undefined, terminal)).not.toThrow();
  expect(snapshot(binding.id)).toEqual(before);
  // Financial admission still includes the entire unknown reservation.
  ensureBudgetWork({ id: 'another', chatJid: binding.chatJid, executionKind: 'interactive', parentWorkId: 'operation' });
  expect(() => reserveBudgetRequest({ ...binding, id: 'next', workId: 'another', amountMicros: 50 })).toThrow('budget_denied');
  closeDatabase(); initDatabase(ownedPaths());
  expect(getBudgetRequest(binding.id)?.terminal_evidence_version).toBe(0);
  expect(() => assertModelAccountingReady('operation', getDb(), undefined, true)).not.toThrow();
  expect(getBudgetRequest(binding.id)?.state).toBe('unresolved');
  expect(getDb().query('SELECT count(*) AS n FROM budget_usage_events').get()).toEqual({ n: 0 });
});

test('a v4 request after the retention cutover is not grandfathered', () => {
  const binding = seed('modern-v4', '2099-01-01T00:00:00.000Z'); migrate();
  expect(getBudgetRequest(binding.id)?.terminal_evidence_version).toBe(1);
  expect(() => assertModelAccountingReady('operation')).toThrow('budget_denied');
});

test('attributed requests cannot become legacy even with an old timestamp', () => {
  const invocation: BudgetModelInvocation = { version: 1, domain: 'fixture-domain', operationId: 'operation',
    conversationId: 1, taskId: 2, taskKind: 'pi.generation', phase: 'request', checkpointHash: 'a'.repeat(64) };
  const binding = seed('attributed', undefined, invocation); migrate();
  expect(getBudgetRequest(binding.id)?.terminal_evidence_version).toBe(1);
  expect(() => assertModelAccountingReady('operation')).toThrow('budget_denied');
});

test('new receipt-less requests fail closed regardless of their caller-supplied timestamp', () => {
  migrate(); const binding = seed('new-backdated');
  expect(getBudgetRequest(binding.id)?.terminal_evidence_version).toBe(1);
  for (const terminal of [false, true]) expect(() => assertModelAccountingReady('operation', getDb(), undefined, terminal)).toThrow('budget_denied');
  expect(() => getDb().query('UPDATE budget_request_reservations SET terminal_evidence_version=0 WHERE id=?').run(binding.id)).toThrow('immutable');
});

test('legacy provenance cannot be opted into, replaced, or transplanted', () => {
  const binding = seed('legacy'); migrate();
  expect(() => getDb().query('UPDATE budget_request_reservations SET terminal_evidence_version=1 WHERE id=?').run(binding.id)).toThrow('immutable');
  for (const column of ['id', 'work_id', 'chat_jid', 'provider_id', 'model_id', 'account_ref', 'binding_sha256', 'created_at']) {
    expect(() => getDb().query(`UPDATE budget_request_reservations SET ${column}=? WHERE id=?`).run('changed', binding.id)).toThrow('immutable');
  }
  expect(() => getDb().query('INSERT OR REPLACE INTO budget_request_reservations SELECT * FROM budget_request_reservations WHERE id=?').run(binding.id)).toThrow('immutable');
  const columns = (getDb().query('PRAGMA table_info(budget_request_reservations)').all() as { name: string }[]).map(row => row.name);
  const projection = columns.map(name => name === 'terminal_evidence_version' ? '1' : name).join(',');
  expect(() => getDb().query('INSERT OR REPLACE INTO budget_request_reservations SELECT ' + projection + ' FROM budget_request_reservations WHERE id=?').run(binding.id)).toThrow('immutable');
  expect(() => getDb().query('UPDATE budget_request_reservations SET amount_microusd=0 WHERE id=?').run(binding.id)).toThrow('immutable');
});

test('retained evidence on a legacy hold still enters the normal accounting barrier', () => {
  const binding = seed('legacy'); migrate();
  recordBudgetTerminalReceipt(binding, { version: 1, requestId: binding.id,
    requestBindingSha256: getBudgetRequest(binding.id)!.binding_sha256,
    projectedOutcome: { role: 'assistant', provider: 'fixture', model: 'fixture-model', responseModel: 'fixture/fixture-model',
      api: 'openai-completions', content: [], stopReason: 'stop', timestamp: 1,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0.00003, output: 0.00001, cacheRead: 0, cacheWrite: 0, total: 0.00004 } } } }, '2026-01-01T00:00:00.000Z');
  expect(() => assertModelAccountingReady('operation')).toThrow('budget_denied');
});

test('missing cutover provenance does not classify any unknown hold as legacy', () => {
  seed('no-cutover');
  getDb().exec(`DELETE FROM piclaw_schema_migrations WHERE owner='host.budget-request-reservations' AND id='terminal-receipt-v1'`);
  migrate(); expect(getBudgetRequest('no-cutover')?.terminal_evidence_version).toBe(1);
  expect(() => assertModelAccountingReady('operation')).toThrow('budget_denied');
});

for (const mode of ['equal', 'malformed'] as const) test(`ambiguous legacy creation time fails closed: ${mode}`, () => {
  const cutover = getDb().query("SELECT applied_at FROM piclaw_schema_migrations WHERE owner='host.budget-request-reservations' AND id='terminal-receipt-v1'").get() as { applied_at: string };
  const binding = seed('boundary', cutover.applied_at);
  if (mode === 'malformed') getDb().query('UPDATE budget_request_reservations SET created_at=? WHERE id=?').run('invalid', binding.id);
  migrate(); expect(getBudgetRequest(binding.id)?.terminal_evidence_version).toBe(1);
  expect(() => assertModelAccountingReady('operation')).toThrow('budget_denied');
});
