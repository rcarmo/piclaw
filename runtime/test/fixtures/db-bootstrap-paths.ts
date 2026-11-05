import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getRuntimeConfigPaths } from '../../src/core/config-context.js';
import { initDatabase, getDb, closeDatabase, getDatabaseBinding, backupDatabase, isLikelyTestHarnessProcess } from '../../src/db/connection.js';
import { assertPathWithinTestFilesystemIsolation } from '../../scripts/test-filesystem-isolation.js';

const scenario = process.argv[2];
assert(['before', 'snapshot', 'bound', 'memory', 'memory-guard', 'cli'].includes(scenario));
const originalStore = process.env.PICLAW_STORE!;
assertPathWithinTestFilesystemIsolation(originalStore, process.env, { allowRoot: false });
const alternateStore = join(originalStore, 'alternate');
const actualPath = () => (getDb().query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file;
const refusal = 'Database bootstrap target changed; close the database before selecting another target.';
try {
  if (scenario === 'before') {
    process.env.PICLAW_STORE = alternateStore;
    const paths = getRuntimeConfigPaths(); initDatabase(paths);
    assert.equal(actualPath(), join(alternateStore, 'messages.db'));
    assert.equal(getDatabaseBinding()!.path, actualPath());
    const database = getDb(), binding = getDatabaseBinding();
    initDatabase(paths); assert.equal(getDb(), database); assert.deepEqual(getDatabaseBinding(), binding);
  } else if (scenario === 'snapshot') {
    const paths = getRuntimeConfigPaths();
    process.env.PICLAW_STORE = alternateStore; process.env.PICLAW_DB_IN_MEMORY = '1';
    initDatabase(paths);
    assert.equal(actualPath(), join(originalStore, 'messages.db'));
    assert(!existsSync(join(alternateStore, 'messages.db')));
    const database = getDb(); initDatabase(paths); assert.equal(getDb(), database);
  } else if (scenario === 'bound') {
    initDatabase(getRuntimeConfigPaths());
    const database = getDb(), binding = getDatabaseBinding();
    database.exec("CREATE TABLE fixture_binding(value TEXT); INSERT INTO fixture_binding VALUES('keep')");
    assert.equal(backupDatabase(join(originalStore, 'verified-bootstrap.db')).integrityCheck, 'ok');
    process.env.PICLAW_STORE = alternateStore;
    assert.throws(() => initDatabase(getRuntimeConfigPaths()), { message: refusal });
    assert.equal(getDb(), database); assert.deepEqual(getDatabaseBinding(), binding);
    assert.deepEqual(database.query('SELECT * FROM fixture_binding').all(), [{ value: 'keep' }]);
    assert(!existsSync(join(alternateStore, 'messages.db')));
    process.env.PICLAW_DB_IN_MEMORY = 'true';
    assert.throws(() => initDatabase(getRuntimeConfigPaths()), { message: refusal });
    assert.equal(getDb(), database); assert.deepEqual(getDatabaseBinding(), binding);
    await closeDatabase(); initDatabase(getRuntimeConfigPaths());
    assert.equal(actualPath(), ''); assert.equal(getDatabaseBinding(), null);
  } else if (scenario === 'memory') {
    for (const flag of ['1', 'true']) {
      process.env.PICLAW_DB_IN_MEMORY = flag; initDatabase(getRuntimeConfigPaths());
      assert.equal(actualPath(), ''); assert.equal(getDatabaseBinding(), null);
      assert.throws(() => backupDatabase(join(originalStore, 'not-a-backup.db')), /file-backed database/);
      await closeDatabase();
    }
    process.env.PICLAW_DB_IN_MEMORY = '0'; process.env.PICLAW_STORE = ':memory:';
    initDatabase(getRuntimeConfigPaths()); assert.equal(actualPath(), '');
    getDb().exec('CREATE TABLE fixture_old_memory(value TEXT)');
    process.env.PICLAW_STORE = alternateStore; process.env.PICLAW_DB_IN_MEMORY = '1';
    initDatabase(getRuntimeConfigPaths());
    assert.equal(actualPath(), '');
    assert.deepEqual(getDb().query("SELECT name FROM sqlite_schema WHERE name='fixture_old_memory'").all(), []);
    process.env.PICLAW_DB_IN_MEMORY = '0';
    assert.throws(() => initDatabase(getRuntimeConfigPaths()), { message: refusal });
    await closeDatabase(); initDatabase(getRuntimeConfigPaths()); assert.equal(actualPath(), join(alternateStore, 'messages.db'));
  } else if (scenario === 'memory-guard') {
    process.env.PICLAW_DB_IN_MEMORY = '1'; initDatabase(getRuntimeConfigPaths());
    const database = getDb(), argv = [...process.argv], bunArgv = [...Bun.argv];
    try {
      process.argv.splice(0, process.argv.length, process.execPath, 'production-entry.js');
      Bun.argv.splice(0, Bun.argv.length, process.execPath, 'production-entry.js');
      assert.equal(isLikelyTestHarnessProcess(), false);
      process.env.PICLAW_STORE = alternateStore;
      assert.throws(() => initDatabase(getRuntimeConfigPaths()), { message: refusal });
      assert.equal(getDb(), database); assert.equal(actualPath(), '');
    } finally { process.argv.splice(0, process.argv.length, ...argv); Bun.argv.splice(0, Bun.argv.length, ...bunArgv); }
  } else {
    const paths = getRuntimeConfigPaths(); initDatabase(paths);
    assert.equal(actualPath(), join(paths.workspaceDir, '.piclaw/store/messages.db'));
    assert.notEqual(paths.storeDir, originalStore);
    await closeDatabase(); process.env.PICLAW_STORE = ':memory:';
    initDatabase(getRuntimeConfigPaths()); assert.equal(actualPath(), '');
  }
  console.log(JSON.stringify({ scenario, actualOpenedPathsVerified: true, explicitSnapshot: true, boundTargetPreserved: true }));
} finally { await closeDatabase(); }
