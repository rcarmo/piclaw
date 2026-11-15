import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { inspectExistingStoreFormat, assertNativeStoreFormat, NATIVE_STORE_APPLICATION_ID } from '../../src/db/store-format.js';
import { initDatabase, closeDatabase, getDb, initializeDatabaseSchema } from '../../src/db/connection.js';
import { getRuntimeConfigPaths } from '../../src/core/config.js';

function legacy(path: string) {
  const db = new Database(path);
  db.exec("CREATE TABLE messages(id TEXT PRIMARY KEY, content TEXT); INSERT INTO messages VALUES('source','OLD_PRIVATE_HISTORY'); CREATE TABLE chat_cursors(chat_jid TEXT PRIMARY KEY,cursor_ts TEXT); PRAGMA user_version=3;");
  db.close();
}

test('normal root startup refuses a v3 store before conversion, schema mutation, reset or publication', async () => {
  const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'store-format-v3-'));
  const path = join(directory, 'v3.db'); legacy(path); const before = readFileSync(path);
  await closeDatabase();
  try {
    expect(() => initDatabase({ ...getRuntimeConfigPaths(), databasePath: path })).toThrow('V4 never migrates a v3 store in place');
    expect(readFileSync(path).equals(before)).toBe(true);
    const readonly = new Database(path, { readonly: true });
    try { expect(readonly.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).toEqual([{ name: 'chat_cursors' }, { name: 'messages' }]); expect(readonly.query('SELECT * FROM messages').all()).toEqual([{ id: 'source', content: 'OLD_PRIVATE_HISTORY' }]); }
    finally { readonly.close(); }
  } finally { await closeDatabase(); rmSync(directory, { recursive: true, force: true }); }
});

test('the explicit idle schema boundary also refuses legacy/development stores intact', () => {
  const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'schema-format-v3-'));
  const path = join(directory, 'v3.db'); legacy(path); const before = readFileSync(path);
  const db = new Database(path);
  try {
    expect(() => initializeDatabaseSchema(db)).toThrow('V4 never migrates a v3 store in place');
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 3 });
  } finally { db.close(); }
  try { expect(readFileSync(path).equals(before)).toBe(true); } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('fresh native root initialization and ordinary supported-native reopen retain identity/history', async () => {
  const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'native-format-reopen-'));
  const path = join(directory, 'native.db'), paths = { ...getRuntimeConfigPaths(), databasePath: path };
  await closeDatabase();
  try {
    initDatabase(paths);
    expect(getDb().query('PRAGMA application_id').get()).toEqual({ application_id: NATIVE_STORE_APPLICATION_ID });
    getDb().query("INSERT INTO messages(id,chat_jid,content,timestamp) VALUES('native','web:default','NATIVE_HISTORY','2026-01-01')").run();
    await closeDatabase(); inspectExistingStoreFormat(path); initDatabase(paths);
    expect(getDb().query("SELECT content FROM messages WHERE id='native'").get()).toEqual({ content: 'NATIVE_HISTORY' });
  } finally { await closeDatabase(); rmSync(directory, { recursive: true, force: true }); }
});

test('unrecognised or partial SDK stores do not become v4 by existing table names alone', () => {
  const db = new Database(':memory:');
  try {
    for (const table of ['conversations', 'entries', 'documents', 'document_revisions', 'tasks', 'submissions']) db.exec(`CREATE TABLE ${table}(id INTEGER)`);
    expect(() => assertNativeStoreFormat(db, false)).toThrow();
  } finally { db.close(); }
});
