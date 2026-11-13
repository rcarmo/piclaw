import './src/test-guard.js';
import { expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTempWorkspace } from '../../runtime/test/helpers.js';
import { resolveRuntimeConfigPaths } from '../../runtime/src/core/config-paths.js';
import { initDatabase, getDb, closeDatabase } from '../../runtime/src/db/connection.js';
import { BunSqliteDatabase } from '../../runtime/durable-engine/src/bun-sqlite.js';
import { SqliteStorage, CURRENT_SQLITE_SCHEMA_VERSION } from '../../runtime/durable-engine/qualification/sqlite.ts';
import { Harness } from '../../runtime/durable-engine/qualification/durable.ts';
import { context, openFixture } from './src/fixture.js';

// This is an owned synthetic recovery unit. No Restic repository, live store,
// credential, retention setting or deployment is touched.
test('existing Restic staging restores actual SDK history and atomic WAL pairs on the same supported format', async () => {
  await closeDatabase(); const ws = createTempWorkspace('native-restic-restore-');
  const paths = resolveRuntimeConfigPaths({ env: { ...process.env, PICLAW_WORKSPACE: ws.workspace, PICLAW_STORE: ws.store, PICLAW_DATA: ws.data, PICLAW_DB_IN_MEMORY: '0' } });
  initDatabase(paths); const source = getDb(); source.exec('PRAGMA foreign_keys=ON');
  const f = await openFixture({ acquired: true }, () => {}, () => SqliteStorage.open(new BunSqliteDatabase(paths.databasePath, { root: source, assertOwner() {}, fenceTransactions: true })));
  let staging: { directory: string; manifest: any; cleanup(): void } | undefined, restored: Database | undefined, reopened: Harness | undefined;
  let pulse: ReturnType<typeof setInterval> | undefined, batches = 0;
  try {
    const submission = await f.root.submit({ type: 'input', requestId: 'snapshot-original', content: 'Keep this exact historical result' }, context);
    expect((await submission.wait(context)).status).toBe('done'); await f.settlement(submission);
    const original = JSON.stringify(source.query('SELECT * FROM submissions ORDER BY id').all());
    const entries = JSON.stringify(source.query('SELECT * FROM entries ORDER BY id').all());
    const calls = f.host.modelCalls;
    source.exec('CREATE TABLE restore_left(id INTEGER PRIMARY KEY,value TEXT); CREATE TABLE restore_right(id INTEGER PRIMARY KEY REFERENCES restore_left(id),value TEXT); PRAGMA wal_autocheckpoint=0');
    const write = source.transaction(() => {
      batches++;
      source.query('INSERT INTO restore_left VALUES(?,?)').run(batches, 'batch:' + batches);
      source.query('INSERT INTO restore_right VALUES(?,?)').run(batches, 'batch:' + batches);
    });
    write(); pulse = setInterval(write, 2);
    const module = pathToFileURL(join(process.env.DURABLE_ADDONS_ROOT!, 'addons/restic/staging.ts')).href;
    const { stageSources, verifyRestore } = await import(module);
    staging = await stageSources([{ name: 'store', path: ws.store }], join(ws.base, 'restored'), []);
    clearInterval(pulse); pulse = undefined;
    expect(batches).toBeGreaterThan(1);
    expect(staging!.manifest.files.filter((file: any) => file.sqlite).map((file: any) => file.path)).toEqual(['store/messages.db']);
    expect(staging!.manifest.files.some((file: any) => /messages\.db-(?:wal|shm)$/.test(file.path))).toBe(false);
    await expect(verifyRestore(staging!.directory)).resolves.toHaveProperty('databases', 1);
    const path = join(staging!.directory, 'store/messages.db'); restored = new Database(path);
    expect(restored.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    expect(restored.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(restored.query('SELECT count(*) n FROM restore_left').get()).toEqual(restored.query('SELECT count(*) n FROM restore_right').get());
    expect(restored.query('SELECT l.id FROM restore_left l JOIN restore_right r ON r.id=l.id WHERE l.value<>r.value').all()).toEqual([]);
    expect(JSON.stringify(restored.query('SELECT * FROM submissions ORDER BY id').all())).toBe(original);
    expect(JSON.stringify(restored.query('SELECT * FROM entries ORDER BY id').all())).toBe(entries);
    const before = statSync(path), root = restored;
    const storage = await SqliteStorage.open(new BunSqliteDatabase(path, { root, assertOwner() { const now = statSync(path); if (now.dev !== before.dev || now.ino !== before.ino) throw Error('Owned restore fixture changed'); }, fenceTransactions: true }));
    reopened = await Harness.open(storage, { models: f.models, registry: f.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, context);
    const same = await storage.submissionByRequest(f.root.id, 'snapshot-original', context);
    expect(same?.status).toBe('done'); expect(f.host.modelCalls).toBe(calls);
    expect(restored.query('SELECT version FROM durable_schema').get()).toEqual({ version: CURRENT_SQLITE_SCHEMA_VERSION });
  } finally {
    if (pulse) clearInterval(pulse); await reopened?.close(context); restored?.close(); staging?.cleanup(); await f.close(); await closeDatabase(); ws.cleanup();
  }
}, 30000);
