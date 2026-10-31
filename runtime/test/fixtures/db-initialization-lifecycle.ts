import assert from 'node:assert/strict';
import { existsSync, renameSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import { spyOn } from 'bun:test';
import * as checkpoints from '../../src/db/sqlite-checkpoint.js';
import { getRuntimeConfigPaths } from '../../src/core/config-context.js';
import { initDatabase, getDb, closeDatabase, getDatabaseBinding } from '../../src/db/connection.js';
import { RuntimeStartupCleanupError } from '../../src/runtime/startup-cleanup-error.js';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';

const scenario = process.argv[2];
const paths = getRuntimeConfigPaths(), file = paths.databasePath;
assert.notEqual(file, ':memory:');
assertPathWithinTestFilesystemIsolation(file, process.env, { allowRoot: false });
const exec = Database.prototype.exec, close = Database.prototype.close, transaction = Database.prototype.transaction, prepare = Database.prototype.prepare;
const primary = Error('injected schema failure'), restoration = Error('injected FK restoration failure'), disposal = Error('injected close failure');
let candidate: Database | undefined;
let closed = 0;
let registration: ReturnType<typeof spyOn> | undefined;
function failSchema() {
  Database.prototype.exec = function(sql: string) {
    if (sql.includes('CREATE TABLE IF NOT EXISTS chats')) {
      candidate = this;
      assert.throws(() => getDb(), /not initialized/);
      assert.equal(getDatabaseBinding(), null);
      exec.call(this, sql);
      throw primary;
    }
    if (scenario === 'restoration-failure' && sql === 'PRAGMA foreign_keys = OFF;') throw restoration;
    return exec.call(this, sql);
  };
  Database.prototype.close = function(throwOnError?: boolean) {
    if (this === candidate) { closed++; if (scenario === 'schema-and-close-failure') throw disposal; }
    return close.call(this, throwOnError);
  };
}
try {
  if (scenario === 'schema-lock') {
    const blocker = new Database(file);
    blocker.exec("PRAGMA journal_mode=WAL; CREATE TABLE legacy_sentinel(value TEXT); INSERT INTO legacy_sentinel VALUES('keep'); BEGIN IMMEDIATE");
    Database.prototype.close = function(throwOnError?: boolean) {
      if (this !== blocker) { candidate = this; closed++; }
      return close.call(this, throwOnError);
    };
    // Isolate schema-lock publication failure without spending the existing
    // test deadline on Root's still-separate 5s policy (#1818 remains open).
    Database.prototype.transaction = function(this: Database, body: (...args: any[]) => any) {
      if (this !== blocker) this.exec('PRAGMA busy_timeout=0');
      return transaction.call(this, body);
    } as typeof Database.prototype.transaction;
    try {
      let failure: unknown;
      try { initDatabase(paths); } catch (error) { failure = error; }
      assert.equal((failure as { code?: string })?.code, 'SQLITE_BUSY');
      assert.equal(closed, 1); assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
      assert.throws(() => candidate!.query('SELECT 1'), /closed/);
    } finally {
      Database.prototype.close = close; Database.prototype.transaction = transaction;
      blocker.exec('ROLLBACK'); blocker.close(true);
    }
    initDatabase(paths);
    assert.deepEqual(getDb().query('SELECT value FROM legacy_sentinel').all(), [{ value: 'keep' }]);
    assert(getDatabaseBinding());
  } else if (['token-column-failure', 'scheduled-column-failure', 'thinking-column-failure', 'thinking-inspection-failure', 'column-and-close-failure'].includes(scenario)) {
    // Representative pre-column schemas, owned by this disposable fixture.
    // Keep the historically nullable scheduled task_kind contract intact.
    const kind = scenario === 'column-and-close-failure' ? 'token' : scenario.split('-')[0];
    const legacy = {
      token: { table: 'token_usage', column: 'response_model',
        sql: `CREATE TABLE token_usage (id INTEGER PRIMARY KEY AUTOINCREMENT,chat_jid TEXT NOT NULL,run_at TEXT NOT NULL,
          input_tokens INTEGER DEFAULT 0,output_tokens INTEGER DEFAULT 0,cache_read_tokens INTEGER DEFAULT 0,cache_write_tokens INTEGER DEFAULT 0,
          total_tokens INTEGER DEFAULT 0,cost_input REAL DEFAULT 0,cost_output REAL DEFAULT 0,cost_cache_read REAL DEFAULT 0,
          cost_cache_write REAL DEFAULT 0,cost_total REAL DEFAULT 0,model TEXT,provider TEXT,api TEXT,turns INTEGER DEFAULT 0);
          INSERT INTO token_usage(chat_jid,run_at,input_tokens,total_tokens,cost_input,cost_total,model,provider,api)
          VALUES('web:legacy','2026-10-01T00:00:00.000Z',1,1,0.00001,0.00001,'synthetic','fixture','fixture');`,
        select: 'SELECT id,chat_jid,run_at,input_tokens,total_tokens,cost_input,cost_total,model,provider,api FROM token_usage' },
      scheduled: { table: 'scheduled_tasks', column: 'model',
        sql: `CREATE TABLE scheduled_tasks(id TEXT PRIMARY KEY,chat_jid TEXT NOT NULL,prompt TEXT NOT NULL,task_kind TEXT DEFAULT 'agent',
          schedule_type TEXT NOT NULL,schedule_value TEXT NOT NULL,next_run TEXT,last_run TEXT,last_result TEXT,status TEXT DEFAULT 'active',created_at TEXT NOT NULL);
          INSERT INTO scheduled_tasks(id,chat_jid,prompt,task_kind,schedule_type,schedule_value,status,created_at)
          VALUES('legacy-task','web:legacy','do not execute','agent','once','2027-01-01T00:00:00.000Z','paused','2026-10-01T00:00:00.000Z');`,
        select: 'SELECT id,chat_jid,prompt,task_kind,schedule_type,schedule_value,status,created_at FROM scheduled_tasks' },
      thinking: { table: 'thinking_content', column: 'duration_ms',
        sql: `CREATE TABLE thinking_content(message_id TEXT PRIMARY KEY,text TEXT NOT NULL,lines INTEGER NOT NULL DEFAULT 0,
          model TEXT,truncated INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
          INSERT INTO thinking_content VALUES('legacy-message','preserve legacy thought',1,'synthetic',0,'2026-10-01T00:00:00.000Z');`,
        select: 'SELECT message_id,text,lines,model,truncated,created_at FROM thinking_content' },
    }[kind as 'token' | 'scheduled' | 'thinking'];
    const seed = new Database(file); seed.exec(legacy.sql);
    const rows = seed.query(legacy.select).all();
    const schemaSql = "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name";
    const schema = seed.query(schemaSql).all(); seed.close(true);
    let injected = 0;
    Database.prototype.prepare = function(this: Database, sql: string, ...args: any[]) {
      if (scenario === 'thinking-inspection-failure' && sql === 'PRAGMA table_info(thinking_content)') {
        candidate = this; injected++;
        assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
        throw primary;
      }
      return prepare.call(this, sql, ...args);
    } as typeof Database.prototype.prepare;
    Database.prototype.exec = function(sql: string) {
      if (scenario !== 'thinking-inspection-failure' && sql.startsWith(`ALTER TABLE ${legacy.table} ADD COLUMN ${legacy.column} `)) {
        candidate = this; injected++;
        assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
        throw primary;
      }
      return exec.call(this, sql);
    };
    Database.prototype.close = function(throwOnError?: boolean) {
      if (this === candidate) { closed++; if (scenario === 'column-and-close-failure') throw disposal; }
      return close.call(this, throwOnError);
    };
    let failure: unknown;
    try { initDatabase(paths); } catch (error) { failure = error; }
    assert.equal(injected, 1);
    if (scenario === 'column-and-close-failure') {
      assert(failure instanceof RuntimeStartupCleanupError); assert.deepEqual(failure.errors, [primary, disposal]);
    } else assert.equal(failure, primary);
    assert.equal(closed, 1); assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    Database.prototype.exec = exec; Database.prototype.close = close; Database.prototype.prepare = prepare;
    const inspect = new Database(file, { readonly: true });
    try { assert.deepEqual(inspect.query(schemaSql).all(), schema); assert.deepEqual(inspect.query(legacy.select).all(), rows); }
    finally { inspect.close(true); }
    if (scenario === 'column-and-close-failure') {
      assert.throws(() => initDatabase(paths), error => error === failure); close.call(candidate!, true);
    } else {
      assert.throws(() => candidate!.query('SELECT 1'), /closed/);
      initDatabase(paths); assert.deepEqual(getDb().query(legacy.select).all(), rows);
      assert((getDb().query(`PRAGMA table_info(${legacy.table})`).all() as {name:string}[]).some(column => column.name === legacy.column));
      if (kind === 'scheduled') assert.equal((getDb().query('PRAGMA table_info(scheduled_tasks)').all() as {name:string;notnull:number}[]).find(column => column.name === 'task_kind')!.notnull, 0);
    }
  } else if (['schema-failure', 'restoration-failure', 'schema-and-close-failure'].includes(scenario)) {
    failSchema();
    let failure: unknown;
    try { initDatabase(paths); } catch (error) { failure = error; }
    assert(failure);
    assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    assert.equal(closed, 1);
    if (scenario === 'schema-failure') assert.equal(failure, primary);
    else {
      assert(failure instanceof RuntimeStartupCleanupError);
      assert.deepEqual(failure.errors, [primary, scenario === 'restoration-failure' ? restoration : disposal]);
    }
    Database.prototype.exec = exec; Database.prototype.close = close;
    if (scenario === 'schema-and-close-failure') {
      assert.throws(() => initDatabase(paths), error => error === failure);
      close.call(candidate!, true);
    } else {
      assert.throws(() => candidate!.query('SELECT 1'), /closed/);
      const inspect = new Database(file, { readonly: true });
      try { assert.deepEqual(inspect.query("SELECT name FROM sqlite_schema WHERE type='table'").all(), []); }
      finally { inspect.close(true); }
      initDatabase(paths); assert(getDb()); assert(getDatabaseBinding());
    }
  } else if (scenario === 'reuse-behind-writer') {
    initDatabase(paths); const db = getDb(), binding = getDatabaseBinding();
    db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=0');
    const blocker = new Database(file, { create: false }); blocker.exec('BEGIN IMMEDIATE');
    const transaction = db.transaction, execute = db.exec;
    db.transaction = (() => { throw Error('unexpected schema transaction on reuse'); }) as typeof db.transaction;
    db.exec = (() => { throw Error('unexpected policy write on reuse'); }) as typeof db.exec;
    try {
      initDatabase(paths); assert.equal(getDb(), db); assert.deepEqual(getDatabaseBinding(), binding);
      assert.deepEqual(db.query('PRAGMA foreign_keys').get(), { foreign_keys: 1 });
      assert.deepEqual(db.query('PRAGMA busy_timeout').get(), { timeout: 0 });
    } finally { db.transaction = transaction; db.exec = execute; blocker.exec('ROLLBACK'); blocker.close(true); }
  } else if (scenario === 'inspection-failure') {
    initDatabase(paths); const db = getDb(), binding = getDatabaseBinding(), prepare = db.prepare;
    const io = Error('injected inspection IO failure');
    db.prepare = function(sql: string, ...args: any[]) { if (sql === 'SELECT 1;') throw io; return prepare.call(this, sql, ...args); } as typeof db.prepare;
    try { assert.throws(() => initDatabase(paths), error => error === io); assert.equal(getDb(), db); assert.deepEqual(getDatabaseBinding(), binding); }
    finally { db.prepare = prepare; }
  } else if (scenario === 'replacement' || scenario === 'missing') {
    initDatabase(paths); const db = getDb(); db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    if (scenario === 'replacement') {
      const replacement = new Database(file + '.replacement');
      replacement.exec('CREATE TABLE sentinel(value);INSERT INTO sentinel VALUES(42)'); replacement.close(true);
      renameSync(file, file + '.old'); renameSync(file + '.replacement', file);
    } else renameSync(file, file + '.old');
    assert.throws(() => initDatabase(paths), /identity changed/);
    assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    if (scenario === 'replacement') {
      const inspect = new Database(file, { readonly: true });
      try { assert.deepEqual(inspect.query("SELECT name FROM sqlite_schema WHERE type='table'").all(), [{ name: 'sentinel' }]); }
      finally { inspect.close(true); }
    } else assert.equal(existsSync(file), false);
  } else if (scenario === 'prepared-close') {
    initDatabase(paths); const db = getDb(), statement = db.prepare('SELECT 1 AS retained');
    let maintenance = 0;
    db.exec = ((sql: string) => {
      if (/VACUUM|optimize|shrink_memory/i.test(sql)) { maintenance++; throw Error('unexpected close maintenance'); }
      assert.throws(() => getDb(), /not initialized/); // Checkpoint policy release follows unpublication.
      return exec.call(db, sql);
    }) as typeof db.exec;
    closeDatabase();
    assert.equal(maintenance, 0);
    assert.throws(() => statement.get(), /closed/);
    assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    initDatabase(paths); assert.notEqual(getDb(), db);
  } else if (scenario === 'registration-failure') {
    registration = spyOn(checkpoints, 'registerSqliteCheckpoint').mockImplementation((db: Database) => { candidate = db; throw primary; });
    Database.prototype.close = function(throwOnError?: boolean) { if (this === candidate) closed++; return close.call(this, throwOnError); };
    assert.throws(() => initDatabase(paths), error => error === primary);
    assert.equal(closed, 1); assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    assert.throws(() => candidate!.query('SELECT 1'), /closed/);
    registration.mockRestore(); Database.prototype.close = close;
    initDatabase(paths); assert(getDb()); assert(getDatabaseBinding());
  } else if (scenario === 'disposer-failure') {
    registration = spyOn(checkpoints, 'registerSqliteCheckpoint').mockImplementation((db: Database) => {
      candidate = db;
      return () => { assert.throws(() => getDb(), /not initialized/); throw disposal; };
    });
    Database.prototype.close = function(throwOnError?: boolean) { if (this === candidate) closed++; return close.call(this, throwOnError); };
    initDatabase(paths);
    let failure: unknown;
    try { closeDatabase(); } catch (error) { failure = error; }
    assert(failure instanceof RuntimeStartupCleanupError); assert.deepEqual(failure.errors, [disposal]);
    assert.equal(closed, 1); assert.throws(() => candidate!.query('SELECT 1'), /closed/);
    assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    assert.throws(() => initDatabase(paths), error => error === failure);
  } else if (scenario === 'published-close-failure') {
    initDatabase(paths); candidate = getDb();
    Database.prototype.close = function(throwOnError?: boolean) { if (this === candidate) { closed++; throw disposal; } return close.call(this, throwOnError); };
    let failure: unknown;
    try { closeDatabase({ shrinkMemory: false }); } catch (error) { failure = error; }
    assert(failure instanceof RuntimeStartupCleanupError); assert.deepEqual(failure.errors, [disposal]);
    assert.equal(closed, 1); assert.throws(() => getDb(), /not initialized/); assert.equal(getDatabaseBinding(), null);
    assert.throws(() => initDatabase(paths), error => error === failure);
    Database.prototype.close = close; close.call(candidate, true);
  } else throw Error('Unknown lifecycle scenario');
  console.log(JSON.stringify({ scenario, privatePublicationAndLifetime: true }));
} finally {
  registration?.mockRestore();
  Database.prototype.exec = exec; Database.prototype.close = close; Database.prototype.transaction = transaction; Database.prototype.prepare = prepare;
  closeDatabase({ shrinkMemory: false });
}
