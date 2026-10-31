import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { isProxy } from 'node:util/types';
import { createTempWorkspace } from '../helpers.js';
import { isolateBudgetTestDatabase } from './fixture.js';
import { getDb } from '../../src/db/connection.js';
import { ensureBudgetWork, saveBudgetCap } from '../../src/db/budget-limits.js';
import { evaluateBudget } from '../../src/budget/evaluator.js';
import { canonicalJson } from '../../src/utils/canonical-json.js';
import { applyOwnedMigrations, listAppliedOwnedMigrations } from '../../src/db/migrations.js';
import { initializeBudgetLimitsSchema, budgetTerminalReceiptMigration, budgetModelInvocationMigration, budgetAccountingScopeMigration, budgetToolInvocationMigration } from '../../src/db/budget-limits-schema.js';
import { reserveBudgetRequest, findBudgetRequestByModelInvocation, getBudgetRequest, dispatchBudgetRequest, abandonBudgetRequest,
  recordBudgetTerminalReceipt, readBudgetTerminalReceipt, settleBudgetRequest, type BudgetRequestBinding, type BudgetModelInvocation } from '../../src/db/budget-request-reservations.js';

isolateBudgetTestDatabase();
const time = '2026-10-04T12:00:00.000Z';
const hash = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const scope = (): BudgetModelInvocation => ({ version: 1, domain: 'owned-sdk', operationId: 'operation-1', conversationId: 1, taskId: 2,
  taskKind: 'pi.generation', phase: 'request', checkpointHash: hash({ checkpoint: 'synthetic', attempt: 1 }) });
function fixture() {
  const db = getDb();
  for (const id of ['work', 'other']) ensureBudgetWork({ id, chatJid: 'web:scope', executionKind: 'interactive' }, db);
  const binding: BudgetRequestBinding = { id: 'nonce-1', workId: 'work', chatJid: 'web:scope', providerId: 'fixture', modelId: 'model',
    accountRef: 'account', amountMicros: 60, modelInvocation: scope() };
  return { db, binding };
}
const allRows = (db: Database) => db.query('SELECT * FROM budget_request_reservations ORDER BY id').all();

// Exact pre-receipt table shape; not derived from the candidate DDL.
const oldTable = `CREATE TABLE budget_request_reservations (
  id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES budget_work(id), chat_jid TEXT NOT NULL,
  provider_id TEXT NOT NULL, model_id TEXT NOT NULL, account_ref TEXT NOT NULL, binding_sha256 TEXT NOT NULL,
  amount_microusd INTEGER CHECK(amount_microusd IS NULL OR amount_microusd >= 0),
  state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','unresolved','settled','released')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, settlement_sha256 TEXT, usage_event_id TEXT UNIQUE,
  CHECK((state='settled') = (settlement_sha256 IS NOT NULL AND usage_event_id IS NOT NULL))
) STRICT;
CREATE INDEX idx_budget_requests_work_state ON budget_request_reservations(work_id,state);
CREATE INDEX idx_budget_requests_state ON budget_request_reservations(state);`;

test('tool extension preserves all earlier owned migration bytes', () => {
  for (const [migration, expected] of [
    [budgetTerminalReceiptMigration, 'f5f89396b96f96ae9e191b948f6026161a1278d706d85d902585ea390ba0ee04'],
    [budgetModelInvocationMigration, '0c05e4ef3bfe5f978d24b003471b8c3aef5ded1216eb96a38d2d7db44e1ce60c'],
    [budgetAccountingScopeMigration, '3d011ae3dd447f0261001f78429c64546f0384b006a28170fc780dd40907daa5'],
  ] as const) expect(createHash('sha256').update(migration.sql).digest('hex')).toBe(expected);
});

test('invocation fresh schema owns order 2 after unchanged receipt migration with a unique nullable index', () => {
  const { db } = fixture();
  const before = listAppliedOwnedMigrations(db, budgetTerminalReceiptMigration.owner);
  expect(before.map(m => m.id)).toEqual(['terminal-receipt-v1', 'model-invocation-v1', 'accounting-scope-index-v1', 'tool-model-invocation-v1']);
  expect(db.query('SELECT migration_order FROM piclaw_schema_migrations WHERE owner=? ORDER BY migration_order').all(budgetTerminalReceiptMigration.owner))
    .toEqual([{ migration_order: 1 }, { migration_order: 2 }, { migration_order: 3 }, { migration_order: 4 }]);
  initializeBudgetLimitsSchema(db);
  expect(listAppliedOwnedMigrations(db, budgetTerminalReceiptMigration.owner)).toEqual(before);
  expect(db.query("SELECT name,type,\"notnull\" FROM pragma_table_info('budget_request_reservations') WHERE name LIKE 'model_invocation_%'").all()).toEqual([
    { name: 'model_invocation_json', type: 'TEXT', notnull: 0 }, { name: 'model_invocation_key_sha256', type: 'TEXT', notnull: 0 },
  ]);
  expect(db.query("SELECT \"unique\" FROM pragma_index_list('budget_request_reservations') WHERE name='idx_budget_requests_model_invocation'").get()).toEqual({ unique: 1 });
  expect(db.query('EXPLAIN QUERY PLAN SELECT * FROM budget_request_reservations WHERE model_invocation_key_sha256=?').get('a'.repeat(64)))
    .toMatchObject({ detail: 'SEARCH budget_request_reservations USING INDEX idx_budget_requests_model_invocation (model_invocation_key_sha256=?)' });
  expect(() => applyOwnedMigrations(db, [{ ...budgetModelInvocationMigration, sql: budgetModelInvocationMigration.sql + '\n' }])).toThrow('checksum mismatch');
});

test('actual old shape upgrades add only NULL columns preserving legacy hashes, states, receipts, indexes, CHECKs and FKs', () => {
  const db = new Database(':memory:');
  const legacy: BudgetRequestBinding = { id: 'reserved', workId: 'work', chatJid: 'web:scope', providerId: 'fixture', modelId: 'model', accountRef: 'account', amountMicros: 60 };
  try {
    db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE budget_work(id TEXT PRIMARY KEY, status TEXT DEFAULT 'active', chat_jid TEXT DEFAULT 'web:scope'); INSERT INTO budget_work(id) VALUES('work'); ${oldTable}`);
    for (const state of ['reserved','dispatched','unresolved','settled','released']) {
      const binding = { ...legacy, id: state, amountMicros: state === 'unresolved' ? null : 60 };
      db.query('INSERT INTO budget_request_reservations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(state, 'work', 'web:scope', 'fixture', 'model', 'account', hash(binding), binding.amountMicros,
        state, time, time, state === 'settled' ? 'untouched-settlement' : null, state === 'settled' ? 'untouched-usage' : null);
    }
    applyOwnedMigrations(db, [budgetTerminalReceiptMigration]);
    const receiptBinding = { ...legacy, id: 'unresolved', amountMicros: null };
    // Seed a real pre-invocation receipt through its then-current SQL shape.
    const payload = { version: 1, requestId: receiptBinding.id, requestBindingSha256: hash(receiptBinding), projectedOutcome: { kind: 'terminal', usage: 'unknown' } };
    const receipt = { bodyJson: canonicalJson(payload), sha256: hash(payload), receivedAt: time };
    db.query('UPDATE budget_request_reservations SET terminal_receipt_json=?,terminal_receipt_sha256=?,terminal_received_at=? WHERE id=?')
      .run(receipt.bodyJson, receipt.sha256, time, receiptBinding.id);
    const before = allRows(db);
    const indexes = db.query("SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='budget_request_reservations' ORDER BY name").all();
    applyOwnedMigrations(db, [budgetTerminalReceiptMigration, budgetModelInvocationMigration]);
    applyOwnedMigrations(db, [budgetTerminalReceiptMigration, budgetModelInvocationMigration]);
    expect(allRows(db)).toEqual(before.map(row => ({ ...row, model_invocation_json: null, model_invocation_key_sha256: null })));
    expect(db.query("SELECT name,sql FROM sqlite_schema WHERE type='index' AND tbl_name='budget_request_reservations' AND name!='idx_budget_requests_model_invocation' ORDER BY name").all()).toEqual(indexes);
    expect(reserveBudgetRequest({ ...legacy, modelInvocation: undefined }, {}, db).binding_sha256).toBe(hash(legacy));
    expect(readBudgetTerminalReceipt(receiptBinding, db)).toEqual(receipt);
    expect(findBudgetRequestByModelInvocation(scope(), db)).toBeNull();
    expect(() => reserveBudgetRequest({ ...legacy, modelInvocation: scope() }, {}, db)).toThrow('conflict');
    expect(() => db.exec("UPDATE budget_request_reservations SET state='settled' WHERE id='dispatched'")).toThrow('CHECK');
    expect(() => db.exec("UPDATE budget_request_reservations SET state='settled',settlement_sha256='x',usage_event_id='untouched-usage' WHERE id='dispatched'")).toThrow('UNIQUE');
    expect(() => db.exec("UPDATE budget_request_reservations SET amount_microusd=-1 WHERE id='reserved'")).toThrow('CHECK');
    expect(() => db.exec("UPDATE budget_request_reservations SET work_id='missing' WHERE id='reserved'")).toThrow('FOREIGN KEY');
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(allRows(db)).toEqual(before.map(row => ({ ...row, model_invocation_json: null, model_invocation_key_sha256: null })));
    const facts = allRows(db), previousMigrations = listAppliedOwnedMigrations(db, budgetTerminalReceiptMigration.owner);
    applyOwnedMigrations(db, [budgetAccountingScopeMigration]); applyOwnedMigrations(db, [budgetAccountingScopeMigration]);
    expect(allRows(db)).toEqual(facts); expect(readBudgetTerminalReceipt(receiptBinding, db)).toEqual(receipt);
    expect(listAppliedOwnedMigrations(db, budgetTerminalReceiptMigration.owner).slice(0, 2)).toEqual(previousMigrations);
    expect(db.query("SELECT name FROM sqlite_schema WHERE name IN ('idx_budget_requests_domain_state','idx_budget_work_status') ORDER BY name").all())
      .toEqual([{ name: 'idx_budget_requests_domain_state' }, { name: 'idx_budget_work_status' }]);
    expect(() => applyOwnedMigrations(db, [{ ...budgetAccountingScopeMigration, sql: budgetAccountingScopeMigration.sql + '\n' }])).toThrow('checksum mismatch');
    expect(allRows(db)).toEqual(facts);
    const prior = listAppliedOwnedMigrations(db, budgetTerminalReceiptMigration.owner);
    const trigger = db.query("SELECT sql FROM sqlite_schema WHERE name='budget_request_invocation_insert'").get();
    expect(() => applyOwnedMigrations(db, [{ ...budgetToolInvocationMigration, sql: budgetToolInvocationMigration.sql + '\nSELECT nonexistent_scope_column;' }])).toThrow();
    expect(db.query("SELECT sql FROM sqlite_schema WHERE name='budget_request_invocation_insert'").get()).toEqual(trigger);
    expect(listAppliedOwnedMigrations(db, budgetTerminalReceiptMigration.owner)).toEqual(prior); expect(allRows(db)).toEqual(facts);
    applyOwnedMigrations(db, [budgetToolInvocationMigration]); applyOwnedMigrations(db, [budgetToolInvocationMigration]);
    expect(allRows(db)).toEqual(facts); expect(readBudgetTerminalReceipt(receiptBinding, db)).toEqual(receipt);
    expect(listAppliedOwnedMigrations(db, budgetTerminalReceiptMigration.owner).slice(0, 3)).toEqual(prior);
    expect(() => applyOwnedMigrations(db, [{ ...budgetToolInvocationMigration, sql: budgetToolInvocationMigration.sql + '\n' }])).toThrow('checksum mismatch');
    expect(allRows(db)).toEqual(facts);
  } finally { db.close(); }
});

test('tool model invocation uses the same immutable indexed identity and rejects every mismatched phase', () => {
  const { db, binding } = fixture();
  const invocation: BudgetModelInvocation = { ...scope(), taskKind: 'pi.tool', phase: 'call' };
  const row = reserveBudgetRequest({ ...binding, modelInvocation: invocation }, {}, db);
  expect(findBudgetRequestByModelInvocation(invocation, db)).toEqual(row);
  expect(() => reserveBudgetRequest({ ...binding, id: 'new-nonce', modelInvocation: { ...invocation, operationId: 'different' } }, {}, db)).toThrow('conflict');
  for (const phase of ['request','summarize'] as const) {
    const before = allRows(db);
    expect(() => reserveBudgetRequest({ ...binding, id: 'invalid', modelInvocation: { ...invocation, phase } }, {}, db)).toThrow('invalid_binding');
    expect(allRows(db)).toEqual(before);
  }
});

test('invocation failed migration rolls back new columns/index/triggers and owner ledger atomically', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE budget_work(id TEXT PRIMARY KEY); ${oldTable}`);
    applyOwnedMigrations(db, [budgetTerminalReceiptMigration]);
    const before = db.query('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();
    const ledger = listAppliedOwnedMigrations(db);
    db.exec('CREATE TRIGGER budget_request_invocation_no_update BEFORE UPDATE ON budget_request_reservations BEGIN SELECT 1; END');
    expect(() => applyOwnedMigrations(db, [budgetModelInvocationMigration])).toThrow();
    db.exec('DROP TRIGGER budget_request_invocation_no_update');
    expect(db.query('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all()).toEqual(before);
    expect(listAppliedOwnedMigrations(db)).toEqual(ledger);
  } finally { db.close(); }
});

test('exact same scope/id/binding is canonical and idempotent, lookup remains passive and includes operation in binding', () => {
  const { db, binding } = fixture();
  expect(findBudgetRequestByModelInvocation(scope(), db)).toBeNull();
  expect(allRows(db)).toEqual([]);
  const first = reserveBudgetRequest(binding, { now: new Date(time) }, db);
  const metadata = scope();
  const { operationId: _operation, ...logical } = metadata;
  expect(first.model_invocation_json).toBe(canonicalJson(metadata));
  expect(first.model_invocation_key_sha256).toBe(hash(logical));
  expect(first.binding_sha256).toBe(hash(binding));
  expect(first.binding_sha256).not.toBe(hash({ ...binding, modelInvocation: undefined }));
  expect(reserveBudgetRequest({ ...binding, modelInvocation: { checkpointHash: metadata.checkpointHash, phase: metadata.phase, taskKind: metadata.taskKind,
    taskId: metadata.taskId, conversationId: metadata.conversationId, operationId: metadata.operationId, domain: metadata.domain, version: 1 } }, {}, db)).toEqual(first);
  expect(findBudgetRequestByModelInvocation(metadata, db)).toEqual(first);
  expect(allRows(db)).toEqual([first]);
  expect(db.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
});

test('same SDK logical request with changed nonce/work/account/model/provider/operation always conflicts and never adopts', () => {
  const { db, binding } = fixture();
  const first = reserveBudgetRequest(binding, {}, db);
  for (const change of [{ id: 'nonce-2' }, { workId: 'other' }, { accountRef: 'other' }, { modelId: 'other' }, { providerId: 'other' },
    { amountMicros: 61 }, { chatJid: 'web:other' }, { modelInvocation: { ...scope(), operationId: 'operation-2' } }]) {
    expect(() => reserveBudgetRequest({ ...binding, ...change }, {}, db)).toThrow('conflict');
    expect(() => reserveBudgetRequest({ ...binding, ...change, id: 'nonce-2' }, {}, db)).toThrow('conflict');
  }
  expect(() => findBudgetRequestByModelInvocation({ ...scope(), operationId: 'operation-2' }, db)).toThrow('conflict');
  expect(() => reserveBudgetRequest({ ...binding, modelInvocation: undefined }, {}, db)).toThrow('conflict');
  expect(allRows(db)).toEqual([first]);
});

test('released scope remains consumed; exact old id is only idempotent and cannot dispatch again', () => {
  const { db, binding } = fixture(); reserveBudgetRequest(binding, {}, db);
  const released = abandonBudgetRequest(binding, db);
  expect(released.state).toBe('released');
  expect(reserveBudgetRequest(binding, {}, db)).toEqual(released);
  expect(() => reserveBudgetRequest({ ...binding, id: 'replacement' }, {}, db)).toThrow('conflict');
  expect(() => dispatchBudgetRequest(binding, { authorise() {}, signal: new AbortController().signal }, db)).toThrow('invalid_state');
  expect(findBudgetRequestByModelInvocation(scope(), db)).toEqual(released);
});

for (const collision of ['rowid', 'usage id']) test(`logical invocation without a receipt resists REPLACE by ${collision}`, () => {
  const { db, binding } = fixture();
  reserveBudgetRequest(binding, {}, db);
  if (collision === 'usage id') {
    dispatchBudgetRequest(binding, { authorise() {}, signal: new AbortController().signal }, db);
    settleBudgetRequest(binding, { chat_jid: binding.chatJid, run_at: time, input_tokens: 1, output_tokens: 0,
      cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 1, cost_input: 0.00001, cost_output: 0,
      cost_cache_read: 0, cost_cache_write: 0, cost_total: 0.00001, provider: binding.providerId, model: binding.modelId,
      api_equivalent_cost_known: true, api_equivalent_cost_microusd: 10, valuation_provenance: 'catalogue_estimate' }, db);
  }
  const before = getBudgetRequest(binding.id, db);
  db.exec('PRAGMA recursive_triggers=OFF');
  const columns = 'work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at,settlement_sha256,usage_event_id';
  const rowid = collision === 'rowid' ? ',rowid' : '';
  expect(() => db.exec(`INSERT OR REPLACE INTO budget_request_reservations (id,${columns}${rowid})
    SELECT 'replacement',${columns}${rowid} FROM budget_request_reservations WHERE id='nonce-1'`)).toThrow('conflict');
  expect(getBudgetRequest(binding.id, db)).toEqual(before);
  expect(findBudgetRequestByModelInvocation(scope(), db)).toEqual(before);
  expect(getBudgetRequest('replacement', db)).toBeNull();
});

for (const collision of ['primary key', 'rowid', 'usage id']) test(`logical invocation without a receipt resists UPDATE OR REPLACE victim deletion by ${collision}`, () => {
  const { db, binding } = fixture();
  reserveBudgetRequest(binding, {}, db);
  if (collision === 'usage id') {
    // A real legacy charge has an invocation but no terminal receipt.
    dispatchBudgetRequest(binding, { authorise() {}, signal: new AbortController().signal }, db);
    settleBudgetRequest(binding, { chat_jid: binding.chatJid, run_at: time, input_tokens: 1, output_tokens: 0,
      cache_read_tokens: 0, cache_write_tokens: 0, total_tokens: 1, cost_input: 0.00001, cost_output: 0,
      cost_cache_read: 0, cost_cache_write: 0, cost_total: 0.00001, provider: binding.providerId, model: binding.modelId,
      api_equivalent_cost_known: true, api_equivalent_cost_microusd: 10, valuation_provenance: 'catalogue_estimate' }, db);
  }
  reserveBudgetRequest({ ...binding, id: 'peer', modelInvocation: undefined }, {}, db);
  const before = allRows(db);
  db.exec('PRAGMA recursive_triggers=OFF');
  const change = collision === 'primary key' ? "id='nonce-1'" : collision === 'rowid'
    ? "rowid=(SELECT rowid FROM budget_request_reservations WHERE id='nonce-1')"
    : "state='settled',settlement_sha256='peer-settlement',usage_event_id=(SELECT usage_event_id FROM budget_request_reservations WHERE id='nonce-1')";
  expect(() => db.exec(`UPDATE OR REPLACE budget_request_reservations SET ${change} WHERE id='peer'`)).toThrow('immutable');
  expect(allRows(db)).toEqual(before);
  expect(findBudgetRequestByModelInvocation(scope(), db)).toEqual(getBudgetRequest(binding.id, db));
});

test('checkpoint attempts are preserved by canonical JSON; every logical dimension participates in the key', () => {
  const { db, binding } = fixture();
  const first = reserveBudgetRequest(binding, {}, db);
  const changes: BudgetModelInvocation[] = [
    { ...scope(), checkpointHash: hash({ checkpoint: 'synthetic', attempt: 2 }) },
    { ...scope(), domain: 'other-domain' }, { ...scope(), conversationId: 2 }, { ...scope(), taskId: 3 },
    { ...scope(), taskKind: 'pi.compaction', phase: 'summarize' },
  ];
  for (const [i, metadata] of changes.entries()) {
    expect(findBudgetRequestByModelInvocation(metadata, db)).toBeNull();
    expect(() => reserveBudgetRequest({ ...binding, modelInvocation: metadata }, {}, db)).toThrow('conflict');
    const row = reserveBudgetRequest({ ...binding, id: `dimension-${i}`, modelInvocation: metadata }, {}, db);
    expect(row.model_invocation_key_sha256).not.toBe(first.model_invocation_key_sha256);
    expect(findBudgetRequestByModelInvocation(metadata, db)).toEqual(row);
  }
});

function invalidScopes(): unknown[] {
  return [null, undefined, [], {}, new Date(), new Proxy(scope(), {}), Object.create(scope()),
    ...[0, 2, '1'].map(version => ({ ...scope(), version })),
    ...['', ' ', '\u00a0', 'x\u0000', 'x\n', 'x\u007f', 'x\u009f', 'x'.repeat(257), 4].flatMap(value => [{ ...scope(), domain: value }, { ...scope(), operationId: value }]),
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1'].flatMap(value => [{ ...scope(), conversationId: value }, { ...scope(), taskId: value }]),
    ...['generation', 'pi.compaction', null].map(taskKind => ({ ...scope(), taskKind })),
    ...['summarize', 'other', null].map(phase => ({ ...scope(), phase })),
    ...['A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'a'.repeat(64) + '\u0000', 'a'.repeat(64) + '\n', null].map(checkpointHash => ({ ...scope(), checkpointHash })),
    { ...scope(), extra: true }, { ...scope(), attempt: 2 }, { ...scope(), [Symbol('extra')]: 1 },
    Object.defineProperty(scope(), 'domain', { value: 'hidden', enumerable: false }),
  ];
}

test('scope kind/phase/id/hash/extra/proxy/getter invalidity rejects before SQL without invoking accessors', () => {
  const { binding } = fixture();
  const closed = new Database(':memory:'); closed.close();
  let getters = 0;
  const getterScopes = Object.keys(scope()).map(key => Object.defineProperty(scope(), key, { get() { getters++; throw Error('getter invoked'); } }));
  for (const metadata of [...invalidScopes(), ...getterScopes]) {
    expect(() => Reflect.apply(findBudgetRequestByModelInvocation, null, [metadata, closed])).toThrow('invalid_binding');
    if (metadata !== undefined) expect(() => Reflect.apply(reserveBudgetRequest, null, [{ ...binding, modelInvocation: metadata }, {}, closed])).toThrow('invalid_binding');
  }
  const getterBinding = Object.defineProperty({ ...binding }, 'modelInvocation', { get() { getters++; throw Error('binding getter'); } });
  expect(() => reserveBudgetRequest(getterBinding, {}, closed)).toThrow('invalid_binding');
  expect(getters).toBe(0);
});

function insertRaw(db: Database, id: string, json: string | null, key: string | null) {
  db.query(`INSERT INTO budget_request_reservations
    (id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at,model_invocation_json,model_invocation_key_sha256)
    VALUES(?,'work','web:scope','fixture','model','account','raw-binding',60,'reserved',?,?,?,?)`).run(id,time,time,json,key);
}

test('SQL enforces nullable pairing, valid exact metadata, unique logical key and immutable bindings including NULL legacy', () => {
  const { db, binding } = fixture();
  const first = reserveBudgetRequest(binding, {}, db);
  const key = first.model_invocation_key_sha256;
  for (const [body, logicalKey] of [[null, key], [canonicalJson(scope()), null], [canonicalJson(scope()), 'bad'], [canonicalJson(scope()), 'a'.repeat(64) + '\u0000']] ) {
    expect(() => insertRaw(db, 'invalid', body, logicalKey)).toThrow();
  }
  for (const metadata of invalidScopes().filter(value => value !== undefined && !(value instanceof Date))) {
    // Some non-JSON inputs serialize as valid exact data (e.g. a transparent proxy); API rejects them instead.
    if (typeof metadata === 'object' && metadata !== null && (isProxy(metadata) || Object.getPrototypeOf(metadata) !== Object.prototype || Reflect.ownKeys(metadata).some(key => typeof key === 'symbol'))) continue;
    const body = JSON.stringify(metadata);
    if (body !== undefined) expect(() => insertRaw(db, 'invalid', body, 'f'.repeat(64))).toThrow();
  }
  for (const body of ['not json', canonicalJson(scope()).replace('"version":1', '"version":1,"version":1')]) {
    expect(() => insertRaw(db, 'invalid', body, 'f'.repeat(64))).toThrow('invalid model invocation');
  }
  expect(() => insertRaw(db, 'duplicate', first.model_invocation_json, key)).toThrow('conflict');
  // The UNIQUE index enforces logical identity independently of the REPLACE guard.
  expect(() => db.transaction(() => {
    db.exec('DROP TRIGGER budget_request_invocation_no_replace');
    expect(() => insertRaw(db, 'duplicate', first.model_invocation_json, key)).toThrow('UNIQUE');
    throw Error('restore guard');
  }).immediate()).toThrow('restore guard');
  insertRaw(db, 'legacy-1', null, null); insertRaw(db, 'legacy-2', null, null);
  for (const column of ['model_invocation_json','model_invocation_key_sha256','id','work_id','chat_jid','provider_id','model_id','account_ref','amount_microusd','binding_sha256']) {
    expect(() => db.exec(`UPDATE budget_request_reservations SET ${column}=NULL WHERE id='nonce-1'`)).toThrow('immutable');
  }
  expect(() => db.query("UPDATE budget_request_reservations SET model_invocation_json=?,model_invocation_key_sha256=? WHERE id='legacy-1'").run(first.model_invocation_json, key)).toThrow('immutable');
  expect(() => db.exec("DELETE FROM budget_request_reservations WHERE id='nonce-1'")).toThrow('immutable');
  db.exec('PRAGMA recursive_triggers=OFF');
  expect(() => db.exec("INSERT OR REPLACE INTO budget_request_reservations SELECT * FROM budget_request_reservations WHERE id='nonce-1'")).toThrow('conflict');
  expect(() => db.query(`INSERT OR REPLACE INTO budget_request_reservations
    (id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at)
    VALUES('nonce-1','work','web:scope','fixture','model','account','replacement',60,'reserved',?,?)`).run(time,time)).toThrow('conflict');
  expect(() => db.query(`INSERT OR REPLACE INTO budget_request_reservations
    (id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at,model_invocation_json,model_invocation_key_sha256)
    VALUES('legacy-1','work','web:scope','fixture','model','account','replacement',60,'reserved',?,?,?,?)`)
    .run(time,time,first.model_invocation_json,'e'.repeat(64))).toThrow('conflict');
  expect(getBudgetRequest(binding.id, db)).toEqual(first);
  expect(allRows(db)).toHaveLength(3);
});

test('reserve SQL fault/savepoint and outer rollback never consume a scope or create a partial hold', () => {
  const { db, binding } = fixture();
  db.exec("CREATE TRIGGER invocation_fault AFTER INSERT ON budget_request_reservations BEGIN SELECT RAISE(ABORT,'invocation fault'); END");
  db.transaction(() => {
    expect(() => reserveBudgetRequest(binding, {}, db)).toThrow('invocation fault');
    expect(findBudgetRequestByModelInvocation(scope(), db)).toBeNull();
    expect(allRows(db)).toEqual([]);
  }).immediate();
  db.exec('DROP TRIGGER invocation_fault');
  expect(() => db.transaction(() => { reserveBudgetRequest(binding, {}, db); throw Error('outer rollback'); }).immediate()).toThrow('outer rollback');
  expect(allRows(db)).toEqual([]);
  expect(findBudgetRequestByModelInvocation(scope(), db)).toBeNull();
  expect(reserveBudgetRequest(binding, {}, db).state).toBe('reserved');
});

test('lookup detects stored JSON/key/full-metadata corruption and never repairs it', () => {
  const { db, binding } = fixture();
  const first = reserveBudgetRequest(binding, {}, db);
  // Physical corruption in an owned fixture only, never a production repair path.
  db.exec('DROP TRIGGER budget_request_invocation_no_update; PRAGMA ignore_check_constraints=ON');
  expect(() => db.query('UPDATE budget_request_reservations SET model_invocation_json=? WHERE id=?').run('not json', binding.id)).toThrow('malformed JSON');
  db.exec('DROP INDEX idx_budget_requests_domain_state'); // Cross the additional expression-index integrity barrier for physical-corruption lookup tests.
  for (const body of ['not json', JSON.stringify(scope()), canonicalJson({ ...scope(), extra: true }), null,
    canonicalJson({ ...scope(), taskId: 9 }), canonicalJson({ ...scope(), operationId: 'changed' })]) {
    db.query('UPDATE budget_request_reservations SET model_invocation_json=? WHERE id=?').run(body, binding.id);
    const before = allRows(db);
    expect(() => findBudgetRequestByModelInvocation(scope(), db)).toThrow('conflict');
    expect(() => reserveBudgetRequest(binding, {}, db)).toThrow('conflict');
    expect(allRows(db)).toEqual(before);
  }
  db.query('UPDATE budget_request_reservations SET model_invocation_json=?,model_invocation_key_sha256=? WHERE id=?')
    .run(first.model_invocation_json, 'f'.repeat(64), binding.id);
  expect(() => reserveBudgetRequest(binding, {}, db)).toThrow('conflict');
  // The row is found by the corrupted index key, but its original JSON does not match it.
  const changed = { ...scope(), taskId: 9 };
  const { operationId: _operation, ...logical } = changed;
  db.query('UPDATE budget_request_reservations SET model_invocation_key_sha256=?').run(hash(logical));
  expect(() => findBudgetRequestByModelInvocation(changed, db)).toThrow('conflict');
});

test('passive invocation lookup verifies the stored reservation binding digest without repairing it', () => {
  const { db, binding } = fixture();
  const first = reserveBudgetRequest(binding, {}, db);
  db.exec('DROP TRIGGER budget_request_invocation_no_update'); // Owned corruption injection only.
  for (const [column, value] of [['account_ref', 'corrupted-account'], ['provider_id', 'other'], ['model_id', 'other'],
    ['amount_microusd', 61], ['chat_jid', 'web:other'], ['work_id', 'other'], ['binding_sha256', 'f'.repeat(64)]] as const) {
    db.query(`UPDATE budget_request_reservations SET ${column}=? WHERE id=?`).run(value, binding.id);
    const before = allRows(db);
    expect(() => findBudgetRequestByModelInvocation(scope(), db)).toThrow('conflict');
    expect(allRows(db)).toEqual(before);
    db.query(`UPDATE budget_request_reservations SET ${column}=? WHERE id=?`).run(first[column], binding.id);
  }
  expect(findBudgetRequestByModelInvocation(scope(), db)).toEqual(first);
});

test('scoped bindings reject unpersisted extra fields before admission', () => {
  const { db, binding } = fixture();
  expect(() => reserveBudgetRequest({ ...binding, ...{ extra: 'unpersisted binding data' } }, {}, db)).toThrow('invalid_binding');
  expect(allRows(db)).toEqual([]);
});

test('passive owned WAL reopen lookup preserves unresolved financial hold, receipt, original rows and no charge/permission', async () => {
  const { db, binding } = fixture(); reserveBudgetRequest(binding, {}, db);
  let authorityCalls = 0;
  dispatchBudgetRequest(binding, { authorise() { authorityCalls++; }, signal: new AbortController().signal }, db);
  abandonBudgetRequest(binding, db);
  const before = getBudgetRequest(binding.id, db)!;
  const receipt = recordBudgetTerminalReceipt(binding, { version: 1, requestId: binding.id, requestBindingSha256: before.binding_sha256,
    projectedOutcome: { kind: 'terminal', valuation: 'unknown' } }, time, db);
  saveBudgetCap({ scope: 'task', metric: 'api_usd_micros', amount: 100, workId: binding.workId }, db);
  const decision = evaluateBudget({ workId: binding.workId, now: new Date(time) }, db);
  const snapshot = allRows(db), works = db.query('SELECT * FROM budget_work ORDER BY id').all();
  const ws = createTempWorkspace('invocation-wal-reopen-'), path = join(ws.workspace, 'invocations.db');
  let disk: Database | undefined;
  try {
    await Bun.write(path, db.serialize());
    disk = new Database(path); disk.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;'); disk.close();
    disk = new Database(path, { readonly: true });
    const callsBefore = authorityCalls;
    expect(findBudgetRequestByModelInvocation(scope(), disk)).toEqual(getBudgetRequest(binding.id, db));
    expect(findBudgetRequestByModelInvocation({ ...scope(), taskId: 99 }, disk)).toBeNull();
    expect(() => findBudgetRequestByModelInvocation({ ...scope(), operationId: 'changed' }, disk)).toThrow('conflict');
    expect(readBudgetTerminalReceipt(binding, disk)).toEqual(receipt);
    expect(evaluateBudget({ workId: binding.workId, now: new Date(time) }, disk)).toEqual(decision);
    expect(decision.blockers[0].reason).toBe('unknown_pricing');
    expect(allRows(disk)).toEqual(snapshot); expect(allRows(db)).toEqual(snapshot);
    expect(disk.query('SELECT * FROM budget_work ORDER BY id').all()).toEqual(works);
    expect(disk.query('SELECT count(*) n FROM token_usage').get()).toEqual({ n: 0 });
    expect(disk.query('SELECT count(*) n FROM budget_usage_events').get()).toEqual({ n: 0 });
    expect(authorityCalls).toBe(callsBefore);
  } finally { disk?.close(); ws.cleanup(); }
});
