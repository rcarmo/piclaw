// Owned synthetic WAL database only; no provider or live profile.
import '../setup-filesystem-isolation.js';
import assert from 'node:assert/strict';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { initDatabase, getDb, closeDatabase } from '../../src/db/connection.js';
import { ensureBudgetWork, saveBudgetCap } from '../../src/db/budget-limits.js';
import { getStoreDir } from '../../src/core/config.js';
import { modelRequestAccounting } from '../../src/budget/model-request-accounting.js';
import { abandonBudgetRequest, getBudgetRequest, readBudgetTerminalReceipt, recordBudgetTerminalReceipt } from '../../src/db/budget-request-reservations.js';
import { admitSqliteWrite } from '../../src/db/sqlite-async-admission.js';

assert.equal(process.env.PICLAW_DB_IN_MEMORY, '0');
initDatabase();
const database = getDb(), blocker = new Database(join(getStoreDir(), 'messages.db'));
const policy = database.query('PRAGMA busy_timeout').get();
database.exec('CREATE TABLE terminal_marker (value TEXT)');
ensureBudgetWork({ id: 'terminal-parent', chatJid: 'web:terminal', executionKind: 'interactive' });
saveBudgetCap({ scope: 'task', metric: 'api_usd_micros', amount: 1000, workId: 'terminal-parent' });
let authorised = true;
const accounting = modelRequestAccounting({ authorise() { assert(authorised); }, documentedFree: false });
const binding = (id: string) => ({ id, workId: `durable-request:${id}`, chatJid: 'web:terminal', providerId: 'fixture', modelId: 'fixture', accountRef: 'fixture', amountMicros: 60 });
const message = () => ({ role: 'assistant' as const, content: [], api: 'openai-completions' as const, provider: 'fixture', model: 'fixture', stopReason: 'stop' as const, timestamp: 1,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0.00001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.00001 } } });
async function locked<T>(operation: () => Promise<T>): Promise<T> {
  blocker.exec('BEGIN IMMEDIATE');
  let released = false;
  const timer = setTimeout(() => { blocker.exec('COMMIT'); released = true; }, 40);
  try {
    const result = await operation();
    assert(released, 'settlement must yield until the competing writer releases');
    assert.deepEqual(database.query('PRAGMA busy_timeout').get(), policy);
    return result;
  } finally { clearTimeout(timer); if (blocker.inTransaction) blocker.exec('ROLLBACK'); }
}
const financialOwner = { signal: new AbortController().signal, assertCurrent() { assert.equal(getDb(), database); } };
try {
  const request = binding('terminal-settle'), abort = new AbortController();
  ensureBudgetWork({ id: request.workId, chatJid: request.chatJid, executionKind: 'interactive', parentWorkId: 'terminal-parent' });
  await accounting.reserve(request, abort.signal); await accounting.dispatch(request, abort.signal);
  authorised = false; abort.abort();
  const terminal = message();
  const receipt = recordBudgetTerminalReceipt(request, { version: 1, requestId: request.id,
    requestBindingSha256: getBudgetRequest(request.id)!.binding_sha256,
    projectedOutcome: JSON.parse(JSON.stringify(terminal)) }, new Date().toISOString());
  const settled = await locked(() => {
    const pending = accounting.settleRetainedRequest(request, financialOwner);
    request.id = 'caller-mutated'; terminal.usage.cost.input = 900;
    return pending;
  });
  assert.equal(settled.state, 'settled');
  assert.equal(getBudgetRequest('terminal-settle')?.state, 'settled');
  await accounting.settleRetainedRequest(binding('terminal-settle'), financialOwner);
  assert.deepEqual(readBudgetTerminalReceipt(binding('terminal-settle')), receipt);
  assert.equal(database.query('SELECT count(*) AS n FROM budget_usage_events').get()!.n, 1);
  assert.equal(database.query('SELECT cost_input FROM token_usage').get()!.cost_input, 0.00001);
  authorised = true;
  const unsent = binding('terminal-unsent');
  ensureBudgetWork({ id: unsent.workId, chatJid: unsent.chatJid, executionKind: 'interactive', parentWorkId: 'terminal-parent' });
  await accounting.reserve(unsent, new AbortController().signal);
  authorised = false;
  assert.equal((await locked(() => admitSqliteWrite(database, () => abandonBudgetRequest(unsent),
    () => financialOwner.assertCurrent(), financialOwner.signal)))?.state, 'released');
  let callbacks = 0;
  await assert.rejects(admitSqliteWrite(database, () => {
    callbacks++;
    database.exec("INSERT INTO terminal_marker VALUES ('rolled back')");
    throw Object.assign(Error('callback busy'), { code: 'SQLITE_BUSY' });
  }), /callback busy/);
  assert.equal(callbacks, 1); assert.equal(database.inTransaction, false);
  assert.equal(database.query('SELECT count(*) AS n FROM terminal_marker').get()!.n, 0);
  assert.deepEqual(database.query('PRAGMA busy_timeout').get(), policy);
  console.log(JSON.stringify({ settledAfterRelease: true, cancelledUsageSettled: true, snapshotPreserved: true, oneCharge: true, abandonedAfterRelease: true, noCallbackReplay: true, busyTimeoutRestored: true }));
} finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); blocker.close(); closeDatabase(); }
