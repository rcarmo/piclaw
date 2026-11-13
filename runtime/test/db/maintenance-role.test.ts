import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { resolveRuntimeConfigPaths } from '../../src/core/config-paths.js';
import { closeDatabase, getDb, initDatabase, openMaintenanceDatabase } from '../../src/db/connection.js';

for (const readOnly of [true, false]) test(`existing maintenance role opens behind a writer without migrations/checkpoints; readonly=${readOnly}`, async () => {
  await closeDatabase();
  const ws = createTempWorkspace('maintenance-role-');
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const paths = resolveRuntimeConfigPaths({ env: { ...process.env, PICLAW_DB_IN_MEMORY: '0' } });
  mkdirSync(ws.store, { recursive: true });
  const writer = new Database(paths.databasePath);
  writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE sentinel(n); INSERT INTO sentinel VALUES(42); BEGIN IMMEDIATE');
  const schema = writer.query('SELECT name,sql FROM sqlite_master ORDER BY name').all();
  try {
    openMaintenanceDatabase(paths, readOnly);
    expect(getDb().query('SELECT * FROM sentinel').all()).toEqual([{ n: 42 }]);
    expect(getDb().query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 });
    expect(getDb().query('PRAGMA wal_autocheckpoint').get()).toEqual({ wal_autocheckpoint: 1000 });
    expect(getDb().query('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(schema);
    expect(() => initDatabase(paths)).toThrow('cannot become a migration owner');
    expect(() => openMaintenanceDatabase(paths, !readOnly)).toThrow('role cannot change');
    writer.exec('ROLLBACK');
    if (readOnly) expect(() => getDb().query('INSERT INTO sentinel VALUES(7)').run()).toThrow();
    else { getDb().query('INSERT INTO sentinel VALUES(7)').run(); expect(writer.query('SELECT n FROM sentinel ORDER BY n').all()).toEqual([{ n: 7 }, { n: 42 }]); }
  } finally { if (writer.inTransaction) writer.exec('ROLLBACK'); await closeDatabase(); writer.close(); restore(); ws.cleanup(); }
});

test('maintenance cannot create missing files or migrate a rollback-journal source', async () => {
  await closeDatabase(); const ws = createTempWorkspace('maintenance-existing-');
  const restore = setEnv({ PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data });
  const paths = resolveRuntimeConfigPaths({ env: { ...process.env, PICLAW_DB_IN_MEMORY: '0' } });
  try {
    expect(() => openMaintenanceDatabase(paths)).toThrow(); expect(existsSync(paths.databasePath)).toBe(false);
    mkdirSync(ws.store, { recursive: true }); const source = new Database(paths.databasePath);
    try {
      source.exec('CREATE TABLE sentinel(n)');
      expect(() => openMaintenanceDatabase(paths)).toThrow('existing WAL');
      expect(source.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'delete' });
      expect(source.query('SELECT name FROM sqlite_master').all()).toEqual([{ name: 'sentinel' }]);
    } finally { source.close(); }
  } finally { await closeDatabase(); restore(); ws.cleanup(); }
});

test('actual archived-branch dry-run opens existing metadata without migration authority', async () => {
  await closeDatabase(); const ws = createTempWorkspace('maintenance-prune-'); mkdirSync(ws.store, { recursive: true });
  const source = new Database(join(ws.store, 'messages.db'));
  source.exec('PRAGMA journal_mode=WAL; CREATE TABLE chat_branches(branch_id TEXT,chat_jid TEXT,root_chat_jid TEXT,parent_branch_id TEXT,agent_name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT); BEGIN IMMEDIATE');
  const schema = source.query('SELECT name,sql FROM sqlite_master ORDER BY name').all();
  try {
    const child = Bun.spawn([process.execPath, new URL('../../scripts/prune-archived-branches.ts', import.meta.url).pathname, '--all-archived', '--dry-run'], {
      env: { ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '0' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stderr).toBe(0); expect(stdout).toContain('"mode": "dry-run"');
    expect(source.query('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(schema); expect(source.inTransaction).toBe(true);
  } finally { source.exec('ROLLBACK'); source.close(); ws.cleanup(); }
}, 10000);

test('actual thinking purge dry-run uses an existing read-only store without root schema publication', async () => {
  await closeDatabase(); const ws = createTempWorkspace('maintenance-purge-'); mkdirSync(ws.store, { recursive: true });
  const path = join(ws.store, 'messages.db'), source = new Database(path);
  source.exec("PRAGMA journal_mode=WAL; CREATE TABLE thinking_content(id TEXT,chat_jid TEXT,created_at TEXT,text TEXT); INSERT INTO thinking_content VALUES('one','web:fixture','2026-01-01','retained'); BEGIN IMMEDIATE");
  const schema = source.query('SELECT name,sql FROM sqlite_master ORDER BY name').all();
  try {
    const child = Bun.spawn([process.execPath, new URL('../../scripts/purge-thinking-content.ts', import.meta.url).pathname, '--all', '--dry-run'], {
      env: { ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '0' }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stderr).toBe(0); expect(stdout).toContain('Dry run:      YES');
    expect(source.query('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(schema);
    expect(source.query('SELECT text FROM thinking_content').all()).toEqual([{ text: 'retained' }]); expect(source.inTransaction).toBe(true);
  } finally { source.exec('ROLLBACK'); source.close(); ws.cleanup(); }
}, 10000);
