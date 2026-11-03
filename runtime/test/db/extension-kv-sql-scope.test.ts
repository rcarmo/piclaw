import { expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../helpers.js';
import * as publicDb from '../../src/db.js';
import { getRuntimeConfigPaths } from '../../src/core/config.js';
import { initDatabase, getDb, closeDatabase } from '../../src/db/connection.js';
import { extensionKvSet, extensionKvDelete, extensionKvClear, extensionKvGet } from '../../src/db/extension-kv.js';
import { admitSqliteWrite, type SyncSqliteOperation } from '../../src/db/sqlite-async-admission.js';
import { registerRootExtensionKvStore } from '../../src/db/register-extension-kv.js';
import { getExtensionKvStore, requireExtensionKvAuthority, resetExtensionKvStoreForTests, withExtensionKvAuthority } from '../../src/extension-kv-registry.js';

const chat = 'web:kv-scope', id = 'scope-fixture';
const snapshot = () => getDb().query('SELECT * FROM extension_kv ORDER BY extension_id,scope,scope_key,key').all();
async function fixture(run: (root: Database) => Promise<void> | void) {
  await withTempWorkspaceEnv('kv-sql-scope-', {}, async workspace => {
    await closeDatabase();
    initDatabase({ ...getRuntimeConfigPaths(), databasePath: join(workspace.store, 'kv.sqlite') });
    const root = getDb();
    root.exec('PRAGMA foreign_keys=ON');
    root.query('INSERT INTO extension_kv VALUES(?,?,?,?,?,?,?)').run(id, 'chat', chat, 'old', ' { "raw" : "\\u0061" } ', 'old-created', 'old-updated');
    registerRootExtensionKvStore();
    try { await run(root); }
    finally { resetExtensionKvStoreForTests(); await closeDatabase(); }
  });
}

for (const name of ['extensionKvSet', 'extensionKvDelete', 'extensionKvClear']) {
  test(`public DB barrel retires raw mutation export ${name}`, () => expect(publicDb).not.toHaveProperty(name));
}
for (const action of ['set', 'delete', 'clear'] as const) {
  test(`transaction-local KV body rejects standalone ${action} without changing stored bytes`, () => fixture(root => {
    const before = snapshot();
    expect(() => action === 'set' ? extensionKvSet(id, 'new', { value: 1 }, 'chat', chat)
      : action === 'delete' ? extensionKvDelete(id, 'old', 'chat', chat)
        : extensionKvClear(id, 'chat', chat)).toThrow('transaction-local');
    expect(snapshot()).toEqual(before);
    expect(root.inTransaction).toBe(false);
    expect(root.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 0 });
  }));
}
test('standalone SQL mutation rejects before invoking value conversion', () => fixture(() => {
  let converted = 0;
  expect(() => extensionKvSet(id, 'new', { toJSON() { converted++; return 'untrusted conversion'; } }, 'chat', chat)).toThrow('transaction-local');
  expect(converted).toBe(0);
}));
test('cached persistent router cannot silently write without a transaction when authority is optional', () => fixture(() => {
  const cached = getExtensionKvStore(), before = snapshot();
  expect(() => cached.set(id, 'new', 'must reject', 'chat', chat)).toThrow('transaction-local');
  expect(snapshot()).toEqual(before);
  expect(getExtensionKvStore()).toBe(cached);
}));

function authority(root: Database, signal?: AbortSignal, check = () => {}) {
  return { extensionId: id, chatJid: chat, globalRead: true, globalWrite: true, assertCurrent: check,
    admitWrite<T>(body: SyncSqliteOperation<T>) { return admitSqliteWrite(root, body, check, signal, undefined, check); },
    write<T>(body: () => T): T {
      check(); if (!root.inTransaction) throw Error('fixture requires admitted transaction');
      const result = body(); check(); return result;
    } };
}
test('existing admitted port executes nested scoped mutations under one physical owner', () => fixture(async root => {
  requireExtensionKvAuthority(); const store = getExtensionKvStore(), grant = authority(root), tx = spyOn(root, 'transaction');
  try {
    const value = await withExtensionKvAuthority(grant, () => store.write!(id, () => {
      expect(root.inTransaction).toBe(true);
      store.set(id, 'global', { value: 2 }, 'global');
      store.set(id, 'chat', { value: 3 }, 'chat', chat);
      expect(store.delete(id, 'old', 'chat', chat)).toBe(true);
      return 7;
    }));
    expect(value).toBe(7); expect(tx).toHaveBeenCalledTimes(1);
    expect(extensionKvGet(id, 'global', 'global')).toEqual({ value: 2 });
    expect(extensionKvGet(id, 'chat', 'chat', chat)).toEqual({ value: 3 });
    expect(root.inTransaction).toBe(false);
  } finally { tx.mockRestore(); }
}));
test('transaction-local clear preserves namespace and scope selection under the existing caller owner', () => fixture(async root => {
  await admitSqliteWrite(root, () => {
    extensionKvSet(id, 'global', true, 'global');
    extensionKvSet('unrelated', 'keep', true, 'global');
    expect(extensionKvClear(id, 'chat', chat)).toBe(1);
    expect(extensionKvGet(id, 'global', 'global')).toBe(true);
    expect(extensionKvClear(id, 'global')).toBe(1);
    expect(extensionKvClear(id)).toBe(0);
    expect(extensionKvGet('unrelated', 'keep', 'global')).toBe(true);
  });
  expect(root.inTransaction).toBe(false);
}));
test('entered callback rollback remains terminal and cannot retry after a busy-shaped error', () => fixture(async root => {
  requireExtensionKvAuthority(); const store = getExtensionKvStore(), before = snapshot(), grant = authority(root);
  let entered = 0; const failure = Object.assign(Error('entered SQL scope'), { code: 'SQLITE_BUSY' });
  await expect(withExtensionKvAuthority(grant, () => store.write!(id, () => {
    entered++; store.set(id, 'rollback', true, 'chat', chat); throw failure;
  }))).rejects.toBe(failure);
  expect(entered).toBe(1); expect(snapshot()).toEqual(before); expect(root.inTransaction).toBe(false);
}));
test('persistent backing failure propagates through a cached router without memory fallback', () => fixture(async root => {
  const cached = getExtensionKvStore(); requireExtensionKvAuthority(); const grant = authority(root), before = snapshot();
  root.exec("CREATE TRIGGER reject_scope BEFORE INSERT ON extension_kv BEGIN SELECT RAISE(ABORT,'persistent sink denied'); END");
  await expect(withExtensionKvAuthority(grant, () => cached.write!(id, () => cached.set(id, 'denied', true, 'chat', chat)))).rejects.toThrow('persistent sink denied');
  expect(snapshot()).toEqual(before); expect(getExtensionKvStore()).toBe(cached);
  root.exec('DROP TRIGGER reject_scope');
  await withExtensionKvAuthority(grant, () => cached.write!(id, () => cached.set(id, 'accepted', true, 'chat', chat)));
  expect(extensionKvGet(id, 'accepted', 'chat', chat)).toBe(true);
}));
test('scoped SQL keeps JSON limits and key limits inside the caller transaction', () => fixture(async root => {
  await expect(admitSqliteWrite(root, () => extensionKvSet(id, 'oversize', 'x'.repeat(65_536), 'chat', chat))).rejects.toThrow('maximum size');
  await expect(admitSqliteWrite(root, () => extensionKvSet(id, 'undefined', undefined, 'chat', chat))).rejects.toThrow('JSON-serializable');
  await admitSqliteWrite(root, () => {
    const add = root.query('INSERT INTO extension_kv(extension_id,scope,scope_key,key,value) VALUES(?,?,?,?,?)');
    for (let i = 0; i < 999; i++) add.run(id, 'chat', chat, `limit-${i}`, '1');
  });
  await expect(admitSqliteWrite(root, () => extensionKvSet(id, 'over-limit', true, 'chat', chat))).rejects.toThrow('key limit');
  await admitSqliteWrite(root, () => extensionKvSet(id, 'old', { overwritten: true }, 'chat', chat));
  expect(extensionKvGet(id, 'old', 'chat', chat)).toEqual({ overwritten: true });
  expect(snapshot()).toHaveLength(1000);
}));
for (const terminal of ['cancel', 'revoke'] as const) {
  test(`fixture-owned admitted port rejects ${terminal} while a writer remains held`, () => fixture(async root => {
    requireExtensionKvAuthority(); const path = (root.query('PRAGMA database_list').all() as { name: string; file: string }[]).find(row => row.name === 'main')!.file;
    const blocker = new Database(path), controller = new AbortController(); let current = true, entered = 0;
    const grant = authority(root, controller.signal, () => { if (!current) throw Error('fixture revoked'); });
    blocker.exec('BEGIN IMMEDIATE'); const store = getExtensionKvStore(), before = snapshot();
    const pending = withExtensionKvAuthority(grant, () => store.write!(id, () => { entered++; store.set(id, 'denied', true, 'chat', chat); })).then(() => null, error => error);
    try {
      await Bun.sleep(30); if (terminal === 'cancel') controller.abort(Error('fixture cancelled')); else current = false;
      expect(await Promise.race([pending, Bun.sleep(400).then(() => 'did not settle')])).toBeInstanceOf(Error);
      expect(blocker.inTransaction).toBe(true); expect(entered).toBe(0); expect(snapshot()).toEqual(before);
    } finally { current = false; controller.abort(); if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close(); }
  }));
}
