import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createTempWorkspace } from '../helpers.js';
import { isolateBudgetTestDatabase } from './fixture.js';
import { getDb } from '../../src/db/connection.js';
import { ensureBudgetWork, saveBudgetCap } from '../../src/db/budget-limits.js';
import { evaluateBudget } from '../../src/budget/evaluator.js';
import { applyOwnedMigrations, listAppliedOwnedMigrations } from '../../src/db/migrations.js';
import { budgetTerminalReceiptMigration, initializeBudgetLimitsSchema } from '../../src/db/budget-limits-schema.js';
import { admitSqliteWrite } from '../../src/db/sqlite-async-admission.js';
import { reserveBudgetRequest, dispatchBudgetRequest, abandonBudgetRequest, settleBudgetRequest, getBudgetRequest,
  recordBudgetTerminalReceipt, readBudgetTerminalReceipt, retainBudgetTerminalReceipt, type BudgetRequestBinding, type BudgetTerminalReceiptPayload } from '../../src/db/budget-request-reservations.js';

isolateBudgetTestDatabase();
const receivedAt = '2026-10-04T12:00:00.000Z';
const later = '2026-10-05T12:00:00.000Z';
function fixture(dispatch = true) {
  const db = getDb();
  ensureBudgetWork({ id: 'receipt-work', chatJid: 'web:receipt', executionKind: 'interactive' }, db);
  const binding: BudgetRequestBinding = { id: 'receipt-request', workId: 'receipt-work', chatJid: 'web:receipt', providerId: 'fixture', modelId: 'fixture-model', accountRef: 'account-generation-1', amountMicros: 60 };
  reserveBudgetRequest(binding, {}, db);
  if (dispatch) dispatchBudgetRequest(binding, { authorise() {}, signal: new AbortController().signal }, db);
  const payload: BudgetTerminalReceiptPayload = { version: 1, requestId: binding.id,
    requestBindingSha256: getBudgetRequest(binding.id, db)!.binding_sha256,
    projectedOutcome: { kind: 'terminal', stopReason: 'stop', usage: { valuation: 'unknown', input: 10 }, content: [{ type: 'text', text: 'synthetic safe fixture' }] } };
  return { db, binding, payload };
}
function usage(known = true) {
  return { chat_jid: 'web:receipt', run_at: receivedAt, input_tokens: 10, output_tokens: 2, cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 12,
    cost_input: known ? 0.00004 : 0, cost_output: 0, cost_cache_read: 0, cost_cache_write: 0, cost_total: known ? 0.00004 : 0,
    provider: 'fixture', model: 'fixture-model', api_equivalent_cost_known: known, api_equivalent_cost_microusd: known ? 40 : null,
    valuation_provenance: known ? 'catalogue_estimate' as const : 'unavailable' as const };
}

// Exact pre-receipt reservation DDL from eabf89e19 (not synthesized from the candidate schema).
const oldTableSql = `CREATE TABLE budget_request_reservations (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL REFERENCES budget_work(id),
      chat_jid TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      account_ref TEXT NOT NULL,
      binding_sha256 TEXT NOT NULL,
      amount_microusd INTEGER CHECK(amount_microusd IS NULL OR amount_microusd >= 0),
      state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','unresolved','settled','released')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      settlement_sha256 TEXT,
      usage_event_id TEXT UNIQUE,
      CHECK((state='settled') = (settlement_sha256 IS NOT NULL AND usage_event_id IS NOT NULL))
    ) STRICT`;

test('fresh schema owns one additive migration; initializer is idempotent and checksum drift fails', () => {
  const { db } = fixture();
  const before = listAppliedOwnedMigrations(db, budgetTerminalReceiptMigration.owner);
  expect(before).toHaveLength(1);
  initializeBudgetLimitsSchema(db);
  expect(listAppliedOwnedMigrations(db, budgetTerminalReceiptMigration.owner)).toEqual(before);
  expect(() => applyOwnedMigrations(db, [{ ...budgetTerminalReceiptMigration, sql: budgetTerminalReceiptMigration.sql + '\n' }])).toThrow('checksum mismatch');
  expect(db.query("SELECT name,type FROM pragma_table_info('budget_request_reservations') WHERE name LIKE 'terminal_%'").all()).toEqual([
    { name: 'terminal_receipt_json', type: 'TEXT' }, { name: 'terminal_receipt_sha256', type: 'TEXT' }, { name: 'terminal_received_at', type: 'TEXT' },
  ]);
});

test('exact old shape upgrade preserves every old row/hash/state, CHECK, unique usage id and FK', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE budget_work(id TEXT PRIMARY KEY); INSERT INTO budget_work VALUES('work'); ${oldTableSql};
      CREATE INDEX idx_budget_requests_work_state ON budget_request_reservations(work_id,state);
      CREATE INDEX idx_budget_requests_state ON budget_request_reservations(state);`);
    for (const state of ['reserved','dispatched','unresolved','settled','released']) {
      db.query('INSERT INTO budget_request_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
        state, 'work', 'web:legacy', 'provider', 'model', 'account', `original-binding-${state}`, state === 'unresolved' ? null : 60,
        state, receivedAt, later, state === 'settled' ? 'original-settlement-hash' : null, state === 'settled' ? 'original-usage-id' : null);
    }
    const before = db.query('SELECT * FROM budget_request_reservations ORDER BY id').all();
    const indexes = db.query("SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='budget_request_reservations' ORDER BY name").all();
    applyOwnedMigrations(db, [budgetTerminalReceiptMigration]);
    applyOwnedMigrations(db, [budgetTerminalReceiptMigration]);
    const after = db.query('SELECT * FROM budget_request_reservations ORDER BY id').all();
    expect(after).toEqual(before.map(row => ({ ...row, terminal_receipt_json: null, terminal_receipt_sha256: null, terminal_received_at: null })));
    expect(db.query("SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='budget_request_reservations' ORDER BY name").all()).toEqual(indexes);
    expect(() => db.exec("UPDATE budget_request_reservations SET state='settled' WHERE id='dispatched'")).toThrow('CHECK');
    expect(() => db.exec("UPDATE budget_request_reservations SET state='settled',settlement_sha256='other',usage_event_id='original-usage-id' WHERE id='dispatched'")).toThrow('UNIQUE');
    expect(() => db.exec("UPDATE budget_request_reservations SET amount_microusd=-1 WHERE id='reserved'")).toThrow('CHECK');
    expect(() => db.exec("UPDATE budget_request_reservations SET work_id='missing' WHERE id='reserved'")).toThrow('FOREIGN KEY');
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

test('failed additive migration rolls back columns and ledger together', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE budget_work(id TEXT PRIMARY KEY); ${oldTableSql};
      CREATE TRIGGER budget_request_receipt_no_delete BEFORE DELETE ON budget_request_reservations BEGIN SELECT 1; END;`);
    expect(() => applyOwnedMigrations(db, [budgetTerminalReceiptMigration])).toThrow();
    expect(db.query("SELECT name FROM pragma_table_info('budget_request_reservations') WHERE name LIKE 'terminal_%'").all()).toEqual([]);
    expect(listAppliedOwnedMigrations(db, budgetTerminalReceiptMigration.owner)).toEqual([]);
  } finally { db.close(); }
});

test('capture is canonical and exact replay returns original body/hash/host time without row changes', () => {
  const { db, binding, payload } = fixture();
  const before = getBudgetRequest(binding.id, db)!;
  expect(readBudgetTerminalReceipt(binding, db)).toBeNull();
  const first = recordBudgetTerminalReceipt(binding, payload, receivedAt, db);
  expect(first.sha256).toBe(createHash('sha256').update(first.bodyJson).digest('hex'));
  expect(JSON.parse(first.bodyJson)).toEqual(payload);
  const reordered = { projectedOutcome: payload.projectedOutcome, requestBindingSha256: payload.requestBindingSha256, requestId: payload.requestId, version: payload.version };
  expect(recordBudgetTerminalReceipt(binding, reordered, later, db)).toEqual(first);
  expect(readBudgetTerminalReceipt(binding, db)).toEqual(first);
  expect(getBudgetRequest(binding.id, db)).toEqual({ ...before, terminal_receipt_json: first.bodyJson, terminal_receipt_sha256: first.sha256, terminal_received_at: receivedAt });
  payload.projectedOutcome.stopReason = 'length';
  expect(JSON.parse(readBudgetTerminalReceipt(binding, db)!.bodyJson).projectedOutcome.stopReason).toBe('stop');
  expect(() => recordBudgetTerminalReceipt(binding, payload, later, db)).toThrow('conflict');
});

test('changed binding, request id or envelope hash cannot read or replace a receipt', () => {
  const { db, binding, payload } = fixture();
  recordBudgetTerminalReceipt(binding, payload, receivedAt, db);
  for (const changed of [{ ...binding, accountRef: 'other' }, { ...binding, amountMicros: 61 }, { ...binding, workId: 'other' }]) {
    expect(() => readBudgetTerminalReceipt(changed, db)).toThrow('conflict');
    expect(() => recordBudgetTerminalReceipt(changed, payload, later, db)).toThrow();
  }
  expect(() => recordBudgetTerminalReceipt(binding, { ...payload, requestId: 'other' }, later, db)).toThrow('invalid_receipt');
  expect(() => recordBudgetTerminalReceipt(binding, { ...payload, requestBindingSha256: 'f'.repeat(64) }, later, db)).toThrow('invalid_receipt');
  expect(() => readBudgetTerminalReceipt({ ...binding, id: 'missing' }, db)).toThrow('unavailable');
});

test('only dispatched/unresolved first capture; no legacy settled/released/reserved backfill', () => {
  const { db, binding, payload } = fixture(false);
  expect(() => recordBudgetTerminalReceipt(binding, payload, receivedAt, db)).toThrow('invalid_state');
  abandonBudgetRequest(binding, db);
  expect(() => recordBudgetTerminalReceipt(binding, payload, receivedAt, db)).toThrow('invalid_state');
  expect(readBudgetTerminalReceipt(binding, db)).toBeNull();
  const settled = { ...binding, id: 'legacy-settled' };
  reserveBudgetRequest(settled, {}, db);
  dispatchBudgetRequest(settled, { authorise() {}, signal: new AbortController().signal }, db);
  settleBudgetRequest(settled, usage(), db);
  const settledPayload = { ...payload, requestId: settled.id, requestBindingSha256: getBudgetRequest(settled.id, db)!.binding_sha256 };
  expect(() => recordBudgetTerminalReceipt(settled, settledPayload, receivedAt, db)).toThrow('invalid_state');
  expect(readBudgetTerminalReceipt(settled, db)).toBeNull();
});

test('unknown valuation and old unknown holds retain capacity and no charge/status transition is introduced', () => {
  const { db, binding, payload } = fixture();
  settleBudgetRequest(binding, usage(false), db);
  saveBudgetCap({ scope: 'task', metric: 'api_usd_micros', amount: 100, workId: binding.workId }, db);
  const before = getBudgetRequest(binding.id, db)!;
  const check = { workId: binding.workId, now: new Date(receivedAt) };
  const decision = evaluateBudget(check, db);
  const receipt = recordBudgetTerminalReceipt(binding, payload, receivedAt, db);
  expect(getBudgetRequest(binding.id, db)).toEqual({ ...before, terminal_receipt_json: receipt.bodyJson, terminal_receipt_sha256: receipt.sha256, terminal_received_at: receivedAt });
  expect(evaluateBudget(check, db)).toEqual(decision);
  expect(decision.blockers[0].reason).toBe('unknown_pricing');
  expect(() => reserveBudgetRequest({ ...binding, id: 'after-unknown', amountMicros: 1 }, {}, db)).toThrow('budget_denied');
  expect(abandonBudgetRequest(binding, db).state).toBe('unresolved');
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  expect(db.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 0 });
  expect(db.query("SELECT status FROM budget_work WHERE id='receipt-work'").get()).toEqual({ status: 'active' });
});

test('a receipt survives settlement; replay after settlement is exact and preserves financial hashes', () => {
  const { db, binding, payload } = fixture();
  const first = recordBudgetTerminalReceipt(binding, payload, receivedAt, db);
  const settled = settleBudgetRequest(binding, usage(), db);
  expect(settled.state).toBe('settled');
  expect(recordBudgetTerminalReceipt(binding, payload, later, db)).toEqual(first);
  expect(readBudgetTerminalReceipt(binding, db)).toEqual(first);
  expect(settleBudgetRequest(binding, usage(), db)).toEqual(settled);
  expect(getBudgetRequest(binding.id, db)).toEqual(settled);
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 1 });
});

test('finite plain JSON and exact envelope are validated before any SQL or getter invocation', () => {
  const { binding, payload } = fixture();
  const closed = new Database(':memory:'); closed.close();
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  let getterCalls = 0;
  const getter = { get credential() { getterCalls++; return 'must not run'; } };
  for (const bad of [NaN, Infinity, undefined, 1n, () => 1, new Date(), new Error('synthetic'), cyclic, getter, [ , 1], { toJSON() { throw Error('must not run'); } }, { [Symbol('extra')]: 1 }, Object.create({ inherited: 1 })]) {
    const invalid = { ...payload, projectedOutcome: { bad } };
    // Exercise runtime rejection of values outside the statically typed contract.
    expect(() => Reflect.apply(recordBudgetTerminalReceipt, null, [binding, invalid, receivedAt, closed])).toThrow('invalid_receipt');
  }
  for (const invalid of [null, [], {}, { ...payload, version: 2 }, { ...payload, extra: true }, { ...payload, projectedOutcome: [] }]) {
    expect(() => Reflect.apply(recordBudgetTerminalReceipt, null, [binding, invalid, receivedAt, closed])).toThrow('invalid_receipt');
  }
  for (const invalidTime of ['bad', '2026-10-04', '2026-10-04T12:00:00Z']) {
    expect(() => recordBudgetTerminalReceipt(binding, payload, invalidTime, closed)).toThrow('invalid_receipt');
  }
  expect(getterCalls).toBe(0);
});

test('SQL pairing, envelope, first-capture state and immutable body/hash/time/binding/delete guards', () => {
  const { db, binding, payload } = fixture();
  const body = JSON.stringify(payload), hash = 'a'.repeat(64);
  for (const triple of [[body,null,null], [null,hash,null], [null,null,receivedAt], [body,hash,null], [body,null,receivedAt], [null,hash,receivedAt]]) {
    expect(() => db.query('UPDATE budget_request_reservations SET terminal_receipt_json=?,terminal_receipt_sha256=?,terminal_received_at=? WHERE id=?').run(...triple, binding.id)).toThrow('CHECK');
  }
  for (const badBody of ['not json', '{}', JSON.stringify({ ...payload, requestId: 'other' })]) {
    expect(() => db.query('UPDATE budget_request_reservations SET terminal_receipt_json=?,terminal_receipt_sha256=?,terminal_received_at=? WHERE id=?').run(badBody,hash,receivedAt,binding.id)).toThrow('CHECK');
  }
  db.exec("UPDATE budget_request_reservations SET state='reserved'");
  expect(() => db.query('UPDATE budget_request_reservations SET terminal_receipt_json=?,terminal_receipt_sha256=?,terminal_received_at=?').run(body,hash,receivedAt)).toThrow('invalid terminal receipt state');
  db.exec("UPDATE budget_request_reservations SET state='dispatched'");
  const first = recordBudgetTerminalReceipt(binding, payload, receivedAt, db);
  for (const column of ['terminal_receipt_json','terminal_receipt_sha256','terminal_received_at','id','work_id','chat_jid','provider_id','model_id','account_ref','amount_microusd','binding_sha256']) {
    expect(() => db.exec(`UPDATE budget_request_reservations SET ${column}=NULL`)).toThrow('immutable');
  }
  expect(() => db.exec('DELETE FROM budget_request_reservations')).toThrow('immutable');
  expect(readBudgetTerminalReceipt(binding, db)).toEqual(first);
});

test('bound receipt reads reject corrupt payload/hash/time without repairing financial records', () => {
  const { db, binding, payload } = fixture();
  const receipt = recordBudgetTerminalReceipt(binding, payload, receivedAt, db);
  // Owned physical corruption injection, not a bypass in the production reader.
  db.exec('DROP TRIGGER budget_request_receipt_no_update; PRAGMA ignore_check_constraints=ON');
  for (const [body, hash, time] of [
    [receipt.bodyJson, 'f'.repeat(64), receivedAt],
    ['not json', receipt.sha256, receivedAt],
    [receipt.bodyJson, receipt.sha256, 'not a host time'],
    [receipt.bodyJson, null, receivedAt],
  ]) {
    db.query('UPDATE budget_request_reservations SET terminal_receipt_json=?,terminal_receipt_sha256=?,terminal_received_at=? WHERE id=?').run(body, hash, time, binding.id);
    const before = getBudgetRequest(binding.id, db);
    expect(() => readBudgetTerminalReceipt(binding, db)).toThrow('conflict');
    expect(getBudgetRequest(binding.id, db)).toEqual(before);
  }
});

test('SQL fault and outer transaction rollback leave no partial receipt; a savepoint failure is catchable', () => {
  const { db, binding, payload } = fixture();
  const before = getBudgetRequest(binding.id, db);
  db.exec("CREATE TRIGGER receipt_fault AFTER UPDATE ON budget_request_reservations WHEN NEW.terminal_receipt_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'receipt fault'); END");
  expect(() => db.transaction(() => {
    expect(() => recordBudgetTerminalReceipt(binding, payload, receivedAt, db)).toThrow('receipt fault');
    expect(getBudgetRequest(binding.id, db)).toEqual(before);
  }).immediate()).not.toThrow();
  db.exec('DROP TRIGGER receipt_fault');
  expect(() => db.transaction(() => { recordBudgetTerminalReceipt(binding, payload, receivedAt, db); throw Error('outer rollback'); }).immediate()).toThrow('outer rollback');
  expect(getBudgetRequest(binding.id, db)).toEqual(before);
});

test('admitSqliteWrite composes synchronously; post-write admission failure rolls back without replay', async () => {
  const { db, binding, payload } = fixture();
  let entered = 0;
  await expect(admitSqliteWrite(db, () => { entered++; return recordBudgetTerminalReceipt(binding, payload, receivedAt, db); }, phase => { if (phase === 'after') throw Error('after fault'); })).rejects.toThrow('after fault');
  expect(entered).toBe(1);
  expect(readBudgetTerminalReceipt(binding, db)).toBeNull();
  const receipt = await admitSqliteWrite(db, () => recordBudgetTerminalReceipt(binding, payload, receivedAt, db));
  expect(readBudgetTerminalReceipt(binding, db)).toEqual(receipt);
});

test('later settlement SQL failure cannot erase an already committed terminal receipt', () => {
  const { db, binding, payload } = fixture();
  const receipt = recordBudgetTerminalReceipt(binding, payload, receivedAt, db);
  db.exec("CREATE TRIGGER settlement_fault BEFORE UPDATE ON budget_request_reservations WHEN NEW.state='settled' BEGIN SELECT RAISE(ABORT,'settlement fault'); END");
  expect(() => settleBudgetRequest(binding, usage(), db)).toThrow('settlement fault');
  expect(readBudgetTerminalReceipt(binding, db)).toEqual(receipt);
  expect(getBudgetRequest(binding.id, db)!.state).toBe('dispatched');
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  expect(db.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 0 });
});

test('patient receipt acquisition survives a real writer longer than five seconds and freezes data before waiting', async () => {
  const { db, binding, payload } = fixture(), originalBinding = { ...binding };
  const ws = createTempWorkspace('terminal-receipt-patient-'), path = join(ws.workspace, 'receipt.db');
  await Bun.write(path, db.serialize());
  const disk = new Database(path), owner = new AbortController();
  disk.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
  const writer = new Database(path);
  let writes = 0, ticks = 0, checks = 0;
  disk.function('receipt_write_entered', () => { writes++; return 1; });
  disk.exec('CREATE TRIGGER count_receipt_write BEFORE UPDATE ON budget_request_reservations WHEN NEW.terminal_receipt_json IS NOT NULL BEGIN SELECT receipt_write_entered(); END');
  writer.exec('BEGIN IMMEDIATE');
  const pulse = setInterval(() => { ticks++; }, 10);
  const deadline = setTimeout(() => owner.abort(Error('owned receipt probe deadline')), 10_000);
  const release = setTimeout(() => writer.exec('COMMIT'), 5_200);
  const started = performance.now();
  const pending = retainBudgetTerminalReceipt(binding, payload, receivedAt, { database: disk, signal: owner.signal, assertCurrent() { checks++; } });
  payload.projectedOutcome.stopReason = 'length'; binding.accountRef = 'caller mutated after capture';
  try {
    const receipt = await pending;
    expect(performance.now() - started).toBeGreaterThanOrEqual(5_000);
    expect(ticks).toBeGreaterThan(20); expect(checks).toBeGreaterThan(20);
    expect(writes).toBe(1);
    expect(JSON.parse(receipt.bodyJson).projectedOutcome.stopReason).toBe('stop');
    expect(readBudgetTerminalReceipt(originalBinding, disk)).toEqual(receipt);
    expect(getBudgetRequest(originalBinding.id, disk)?.state).toBe('dispatched');
    expect(disk.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
  } finally {
    owner.abort(); clearInterval(pulse); clearTimeout(deadline); clearTimeout(release);
    await Promise.allSettled([pending]);
    if (writer.inTransaction) writer.exec('ROLLBACK');
    writer.close(); disk.close(); ws.cleanup();
  }
}, 15_000);

for (const revoke of ['signal', 'owner'] as const) test(`patient receipt wait releases on ${revoke} revocation without stale SQL`, async () => {
  const { db, binding, payload } = fixture();
  const ws = createTempWorkspace('terminal-receipt-revoke-'), path = join(ws.workspace, 'receipt.db');
  await Bun.write(path, db.serialize());
  const disk = new Database(path); disk.exec('PRAGMA journal_mode=WAL');
  const writer = new Database(path), owner = new AbortController(), denied = Error('receipt owner revoked');
  let current = true;
  writer.exec('BEGIN IMMEDIATE');
  const before = getBudgetRequest(binding.id, disk);
  const pending = retainBudgetTerminalReceipt(binding, payload, receivedAt, {
    database: disk, signal: owner.signal, assertCurrent() { if (!current) throw denied; },
  });
  if (revoke === 'signal') owner.abort(denied); else current = false;
  try {
    await expect(pending).rejects.toBe(denied);
    expect(writer.inTransaction).toBe(true);
    expect(getBudgetRequest(binding.id, disk)).toEqual(before);
    expect(readBudgetTerminalReceipt(binding, disk)).toBeNull();
  } finally {
    owner.abort(); await Promise.allSettled([pending]);
    writer.exec('ROLLBACK'); writer.close(); disk.close(); ws.cleanup();
  }
});

test('receipt and original time survive owned WAL close/reopen without changing the source fixture', async () => {
  const { db, binding, payload } = fixture();
  const ws = createTempWorkspace('terminal-receipt-reopen-'), path = join(ws.workspace, 'receipt.db');
  let disk: Database | undefined;
  try {
    await Bun.write(path, db.serialize());
    disk = new Database(path);
    disk.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    const first = recordBudgetTerminalReceipt(binding, payload, receivedAt, disk);
    disk.close(); disk = new Database(path);
    expect(readBudgetTerminalReceipt(binding, disk)).toEqual(first);
    expect(recordBudgetTerminalReceipt(binding, payload, later, disk)).toEqual(first);
    expect(readBudgetTerminalReceipt(binding, db)).toBeNull();
  } finally { disk?.close(); ws.cleanup(); }
});
