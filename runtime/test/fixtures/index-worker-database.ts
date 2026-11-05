import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import * as connection from '../../src/db/connection.js';
import { getRuntimeConfigPaths } from '../../src/core/config-context.js';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';

const scenario = process.argv[2], paths = getRuntimeConfigPaths();
assertPathWithinTestFilesystemIsolation(paths.storeDir, process.env, { allowRoot: false });
if (scenario === 'cached') connection.initDatabase(); // Existing parent-owned ready state.
const exec = Database.prototype.exec;
Database.prototype.exec = function(sql: string) {
  if (sql.includes('CREATE TABLE IF NOT EXISTS chats (') || /^\s*(?:VACUUM\b|PRAGMA\s+incremental_vacuum\b)/i.test(sql))
    throw Error('Index worker attempted core migration or VACUUM');
  return exec.call(this, sql);
};
try {
  if (scenario === 'file') {
    const { runWorkspaceIndexProcessFromArgs } = await import('../../src/workspace-index-process.js');
    await runWorkspaceIndexProcessFromArgs(['--scope', 'notes', '--expected-mode', 'single-user']);
  } else if (scenario === 'note') {
    const { runNoteIndexPhase } = await import('../../src/note-retrieval/coordinator.js');
    await runNoteIndexPhase();
  } else {
    const open = connection.openWorkspaceIndexDatabase;
    assert.equal(typeof open, 'function');
    if (scenario === 'crash') {
      open(); connection.getDb().exec('BEGIN IMMEDIATE'); console.log('INDEX_WORKER_HELD');
      while (true) await Bun.sleep(1000);
    } else if (scenario === 'open-locked') {
      const started = performance.now(); open();
      assert(performance.now() - started < 500, 'Worker open waited for a writer');
      assert(connection.getDb());
      console.log('INDEX_WORKER_OPEN');
      const deadline = Date.now() + 12000;
      while (!existsSync(process.argv[3])) { assert(Date.now() < deadline, 'release barrier timed out'); await Bun.sleep(20); }
    } else if (scenario === 'missing' || scenario === 'uninitialized' || scenario === 'non-wal') {
      assert.throws(() => open()); assert.throws(() => connection.getDb(), /not initialized/);
      assert.equal(connection.getDatabaseBinding(), null);
      if (scenario === 'missing') assert.equal(existsSync(paths.databasePath), false);
    } else if (scenario === 'cached') {
      const db = connection.getDb(), binding = connection.getDatabaseBinding(), exec = db.exec;
      db.exec = () => { throw Error('Worker reconfigured a borrowed root connection'); };
      try {
        open(); assert.equal(connection.getDb(), db); assert.deepEqual(connection.getDatabaseBinding(), binding);
        const denied = new RangeError('Cannot use a closed database'); let checks = 0;
        assert.throws(() => open(undefined, () => { if (++checks === 2) throw denied; }), error => error === denied);
        assert.equal(connection.getDb(), db); assert.deepEqual(connection.getDatabaseBinding(), binding);
        assert.deepEqual(db.query('SELECT 1 AS n').get(), { n: 1 });
      } finally { db.exec = exec; }
    } else if (scenario === 'escalation') {
      open(); const db = connection.getDb(), binding = connection.getDatabaseBinding();
      assert.throws(() => connection.initDatabase(), /migration owner/);
      assert.equal(connection.getDb(), db); assert.deepEqual(connection.getDatabaseBinding(), binding);
    } else if (scenario === 'revoked') {
      const denied = Error('worker admission revoked');
      assert.throws(() => open(undefined, () => { throw denied; }), error => error === denied);
      assert.throws(() => connection.getDb(), /not initialized/); assert.equal(connection.getDatabaseBinding(), null);
      assert.throws(() => open(undefined, () => {}, 'wrong:identity'), /identity changed/);
      assert.throws(() => connection.getDb(), /not initialized/);
    } else throw Error('Unknown index worker scenario');
  }
  console.log(JSON.stringify({ scenario, noCoreMigrationOrVacuum: true }));
} finally { Database.prototype.exec = exec; await connection.closeDatabase(); }
