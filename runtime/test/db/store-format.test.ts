import { expect, test, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs, { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { inspectExistingStoreFormat, assertNativeStoreFormat, NATIVE_STORE_APPLICATION_ID, UnsupportedStoreFormat } from '../../src/db/store-format.js';
import { initDatabase, closeDatabase, getDb, getDatabaseBinding, initializeDatabaseSchema } from '../../src/db/connection.js';
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

test('format probe refuses an empty reservation without querying SQLite', () => {
  const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'native-reservation-probe-'));
  const path = join(directory, 'store.db');
  fs.writeFileSync(path, '', { flag: 'wx' });
  const query = spyOn(Database.prototype, 'query');
  try {
    expect(() => inspectExistingStoreFormat(path)).toThrow(UnsupportedStoreFormat);
    expect(query).not.toHaveBeenCalled();
    expect(fs.statSync(path).size).toBe(0);
  } finally { query.mockRestore(); rmSync(directory, { recursive: true, force: true }); }
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

// Publish an actual competing file at the chosen filesystem boundary. The
// original wx syscall then really loses; no synthetic EEXIST or timing lottery.
for (const boundary of ['exclusive-create', 'post-preflight'] as const) {
  for (const winner of ['empty', 'v3'] as const) test(`fresh creator collision at ${boundary} refuses ${winner} without adoption or retry`, async () => {
    await closeDatabase();
    const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'native-create-race-'));
    const path = join(directory, 'store.db'), paths = { ...getRuntimeConfigPaths(), databasePath: path };
    const open = fs.openSync, exists = fs.existsSync;
    let published = false, before: Buffer | undefined, identity: number | undefined, attempts = 0;
    const publish = () => {
      if (published) return;
      published = true;
      if (winner === 'v3') legacy(path); else fs.writeFileSync(path, '', { flag: 'wx' });
      before = readFileSync(path); identity = fs.statSync(path).ino;
    };
    const probe = spyOn(fs, 'existsSync').mockImplementation(value => {
      if (String(value) === path && boundary === 'post-preflight' && !published) { publish(); return true; }
      return exists(value);
    });
    const create = spyOn(fs, 'openSync').mockImplementation(((value: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
      if (String(value) === path && flags === 'wx') { attempts++; publish(); }
      return open(value, flags, mode);
    }) as typeof fs.openSync);
    try {
      let failure: unknown;
      try { initDatabase(paths); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(UnsupportedStoreFormat);
      expect(published).toBe(true); expect(attempts).toBe(1);
      expect(getDatabaseBinding()).toBeNull(); expect(() => getDb()).toThrow('not initialized');
      expect(fs.statSync(path).ino).toBe(identity); expect(readFileSync(path)).toEqual(before!);
      expect(exists(path + '-wal')).toBe(false); expect(exists(path + '-shm')).toBe(false);
      create.mockRestore(); probe.mockRestore();
      // A later explicit attempt still refuses the unstamped/legacy file intact.
      expect(() => initDatabase(paths)).toThrow(UnsupportedStoreFormat);
      expect(readFileSync(path)).toEqual(before!);
    } finally { create.mockRestore(); probe.mockRestore(); await closeDatabase(); rmSync(directory, { recursive: true, force: true }); }
  });
}

for (const code of ['EACCES', 'EIO']) test(`fresh exclusive-create preserves unrelated ${code} failure without retry`, async () => {
  await closeDatabase(); const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'native-create-error-'));
  const path = join(directory, 'store.db'), open = fs.openSync, error = Object.assign(new Error('fixture ' + code), { code });
  let attempts = 0;
  const create = spyOn(fs, 'openSync').mockImplementation(((value: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
    if (String(value) === path && flags === 'wx') { attempts++; throw error; }
    return open(value, flags, mode);
  }) as typeof fs.openSync);
  try {
    let failure: unknown; try { initDatabase({ ...getRuntimeConfigPaths(), databasePath: path }); } catch (caught) { failure = caught; }
    expect(failure).toBe(error); expect(attempts).toBe(1); expect(fs.existsSync(path)).toBe(false); expect(getDatabaseBinding()).toBeNull();
  } finally { create.mockRestore(); await closeDatabase(); rmSync(directory, { recursive: true, force: true }); }
});

for (const state of ['reserved', 'completed'] as const) test(`${state} native winner is validated and reopened after an exclusive-create collision`, async () => {
  await closeDatabase(); const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'native-create-winner-'));
  const path = join(directory, 'store.db'), open = fs.openSync, native = new Database(':memory:');
  native.exec('PRAGMA auto_vacuum=INCREMENTAL');
  if (state === 'completed') {
    initializeDatabaseSchema(native);
    native.exec("INSERT INTO messages(id,chat_jid,content,timestamp) VALUES('winner','web:default','PRESERVED_WINNER','2026-01-01')");
  } else {
    // Allocate the header only: a prior native creator may fail before its
    // first schema transaction. PIC4 is format intent, never execution authority.
    native.exec(`PRAGMA user_version=4; PRAGMA application_id=${NATIVE_STORE_APPLICATION_ID}`);
    expect(native.query('PRAGMA application_id').get()).toEqual({ application_id: NATIVE_STORE_APPLICATION_ID });
    expect(native.query('SELECT name FROM sqlite_schema').all()).toEqual([]);
  }
  const bytes = native.serialize(); native.close(); let attempts = 0, identity: number | undefined;
  const create = spyOn(fs, 'openSync').mockImplementation(((value: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
    if (String(value) === path && flags === 'wx') {
      attempts++; fs.writeFileSync(path, bytes, { flag: 'wx' }); identity = fs.statSync(path).ino;
    }
    return open(value, flags, mode);
  }) as typeof fs.openSync);
  try {
    initDatabase({ ...getRuntimeConfigPaths(), databasePath: path });
    expect(attempts).toBe(1); expect(fs.statSync(path).ino).toBe(identity);
    expect(getDb().query("SELECT content FROM messages WHERE id='winner'").get()).toEqual(state === 'completed' ? { content: 'PRESERVED_WINNER' } : null);
    expect(getDb().query('PRAGMA quick_check').get()).toEqual({ quick_check: 'ok' });
    expect(getDb().query('PRAGMA application_id').get()).toEqual({ application_id: NATIVE_STORE_APPLICATION_ID });
  } finally { create.mockRestore(); await closeDatabase(); rmSync(directory, { recursive: true, force: true }); }
});

for (const targetState of ['v3', 'missing'] as const) test.skipIf(process.platform === 'win32')(`exclusive-create collision leaves a ${targetState} symlink target untouched`, async () => {
  await closeDatabase(); const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'native-create-link-'));
  const path = join(directory, 'store.db'), target = join(directory, 'target.db'), open = fs.openSync;
  if (targetState === 'v3') legacy(target);
  const before = targetState === 'v3' ? readFileSync(target) : undefined; let attempts = 0;
  const create = spyOn(fs, 'openSync').mockImplementation(((value: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode) => {
    if (String(value) === path && flags === 'wx') { attempts++; fs.symlinkSync(target, path); }
    return open(value, flags, mode);
  }) as typeof fs.openSync);
  try {
    expect(() => initDatabase({ ...getRuntimeConfigPaths(), databasePath: path })).toThrow();
    expect(attempts).toBe(1); expect(fs.readlinkSync(path)).toBe(target); expect(getDatabaseBinding()).toBeNull();
    if (before) expect(readFileSync(target)).toEqual(before); else expect(fs.existsSync(target)).toBe(false);
    expect(fs.existsSync(target + '-wal')).toBe(false); expect(fs.existsSync(target + '-shm')).toBe(false);
  } finally { create.mockRestore(); await closeDatabase(); rmSync(directory, { recursive: true, force: true }); }
});

test('unrecognised or partial SDK stores do not become v4 by existing table names alone', () => {
  const db = new Database(':memory:');
  try {
    for (const table of ['conversations', 'entries', 'documents', 'document_revisions', 'tasks', 'submissions']) db.exec(`CREATE TABLE ${table}(id INTEGER)`);
    expect(() => assertNativeStoreFormat(db, false)).toThrow();
  } finally { db.close(); }
});
