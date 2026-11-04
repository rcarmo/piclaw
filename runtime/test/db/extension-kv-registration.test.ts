import { afterEach, expect, test } from 'bun:test';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { withTempWorkspaceEnv } from '../helpers.js';
import { getRuntimeConfigPaths } from '../../src/core/config.js';
import { initDatabase, getDb, closeDatabase } from '../../src/db/connection.js';
import { registerRootExtensionKvStore } from '../../src/db/register-extension-kv.js';
import { extensionKvGet } from '../../src/db/extension-kv.js';
import { admitSqliteWrite, type SyncSqliteOperation } from '../../src/db/sqlite-async-admission.js';
import { getExtensionKvStore, requireExtensionKvAuthority, resetExtensionKvStoreForTests, withExtensionKvAuthority } from '../../src/extension-kv-registry.js';

const id = 'registration-fixture', chat = 'web:registration';
afterEach(async () => { resetExtensionKvStoreForTests(); await closeDatabase(); });

for (const method of ['get', 'set', 'delete', 'list', 'query', 'clear'] as const) {
  test(`unregistered Core backing rejects ${method} instead of using memory`, () => {
    resetExtensionKvStoreForTests(); const cached = getExtensionKvStore(); let conversions = 0;
    const value = { toJSON() { conversions++; return 'must not convert'; } };
    expect(() => method === 'get' ? cached.get(id, 'key', 'chat', chat)
      : method === 'set' ? cached.set(id, 'key', value, 'chat', chat)
        : method === 'delete' ? cached.delete(id, 'key', 'chat', chat)
          : method === 'list' ? cached.list(id, '', 'chat', chat)
            : method === 'query' ? cached.query(id, { scope: 'chat', scopeKey: chat, jsonPath: '$', equals: true })
              : cached.clear(id)).toThrow('backing store required');
    expect(conversions).toBe(0); expect(getExtensionKvStore()).toBe(cached);
  });
}
test('unregistered write admission cannot enter an effect callback', async () => {
  resetExtensionKvStoreForTests(); let entered = 0;
  await expect(getExtensionKvStore().write!(id, () => { entered++; return 'false success'; })).rejects.toThrow('backing store required');
  expect(entered).toBe(0);
});
test('a valid fixture grant cannot substitute for missing persistence', async () => {
  resetExtensionKvStoreForTests(); requireExtensionKvAuthority(); let admissions = 0, entered = 0;
  const grant = { extensionId: id, chatJid: chat, globalRead: true, globalWrite: true, assertCurrent() {},
    async admitWrite<T>(body: SyncSqliteOperation<T>) { admissions++; return body(); }, write<T>(body: () => T) { return body(); } };
  await expect(withExtensionKvAuthority(grant, () => getExtensionKvStore().write!(id, () => { entered++; return 7; }))).rejects.toThrow('backing store required');
  expect(admissions).toBe(0); expect(entered).toBe(0);
});

async function persistent(run: (paths: ReturnType<typeof getRuntimeConfigPaths>) => Promise<void>) {
  await withTempWorkspaceEnv('kv-registration-', {}, async workspace => {
    await closeDatabase(); resetExtensionKvStoreForTests();
    const paths = { ...getRuntimeConfigPaths(), databasePath: join(workspace.store, 'registered.sqlite') };
    try { await run(paths); }
    finally { resetExtensionKvStoreForTests(); await closeDatabase(); }
  });
}
function grant() {
  const root = getDb();
  return { extensionId: id, chatJid: chat, assertCurrent() {},
    admitWrite<T>(body: SyncSqliteOperation<T>) { return admitSqliteWrite(root, body); },
    write<T>(body: () => T) { if (!root.inTransaction) throw Error('Fixture writer required'); return body(); } };
}
test('router cached before Root registration writes persistent bytes and survives reopen without replacement', () => persistent(async paths => {
  const cached = getExtensionKvStore();
  initDatabase(paths); registerRootExtensionKvStore(); requireExtensionKvAuthority();
  await withExtensionKvAuthority(grant(), () => cached.write!(id, () => cached.set(id, 'profile', { value: 'persisted' }, 'chat', chat)));
  const before = getDb().query('SELECT * FROM extension_kv').all();
  expect(before).toHaveLength(1); expect(extensionKvGet(id, 'profile', 'chat', chat)).toEqual({ value: 'persisted' });
  await closeDatabase(); initDatabase(paths); registerRootExtensionKvStore();
  expect(getExtensionKvStore()).toBe(cached);
  expect(withExtensionKvAuthority(grant(), () => cached.get(id, 'profile', 'chat', chat))).toEqual({ value: 'persisted' });
  expect(getDb().query('SELECT * FROM extension_kv').all()).toEqual(before);
}));
test('registration lost while queued rejects before a direct SQL callback enters', () => persistent(async paths => {
  initDatabase(paths); registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const cached = getExtensionKvStore(), root = getDb(), blocker = new Database(paths.databasePath);
  let entered = 0;
  blocker.exec('BEGIN IMMEDIATE');
  const pending = withExtensionKvAuthority(grant(), () => cached.write!(id, () => {
    entered++; root.exec("INSERT INTO extension_kv(extension_id,scope,scope_key,key,value) VALUES('registration-fixture','chat','web:registration','denied','true')");
  })).then(() => null, error => error);
  try {
    await Bun.sleep(30); expect(entered).toBe(0); resetExtensionKvStoreForTests(); blocker.exec('ROLLBACK');
    expect(await pending).toBeInstanceOf(Error); expect(entered).toBe(0);
    expect(root.query('SELECT * FROM extension_kv').all()).toEqual([]);
  } finally { if (blocker.inTransaction) blocker.exec('ROLLBACK'); await pending; blocker.close(); }
}));
test('registration lost inside an admitted callback rolls back the entered SQL without retry', () => persistent(async paths => {
  initDatabase(paths); registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const cached = getExtensionKvStore(), root = getDb(); let entered = 0;
  await expect(withExtensionKvAuthority(grant(), () => cached.write!(id, () => {
    entered++; cached.set(id, 'rollback', true, 'chat', chat); resetExtensionKvStoreForTests();
  }))).rejects.toThrow('backing store required');
  expect(entered).toBe(1); expect(root.query('SELECT * FROM extension_kv').all()).toEqual([]);
  expect(root.inTransaction).toBe(false);
}));
test('reset removes test registration without manufacturing an empty store or deleting persisted bytes', () => persistent(async paths => {
  initDatabase(paths); registerRootExtensionKvStore(); requireExtensionKvAuthority();
  const cached = getExtensionKvStore();
  await withExtensionKvAuthority(grant(), () => cached.write!(id, () => cached.set(id, 'profile', 'retained', 'chat', chat)));
  const before = getDb().query('SELECT * FROM extension_kv').all();
  resetExtensionKvStoreForTests();
  expect(() => cached.get(id, 'profile', 'chat', chat)).toThrow('backing store required');
  expect(getExtensionKvStore()).toBe(cached); expect(getDb().query('SELECT * FROM extension_kv').all()).toEqual(before);
  registerRootExtensionKvStore(); requireExtensionKvAuthority();
  expect(withExtensionKvAuthority(grant(), () => cached.get(id, 'profile', 'chat', chat))).toBe('retained');
}));
