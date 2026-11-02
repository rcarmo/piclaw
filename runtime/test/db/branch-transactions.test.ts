import { expect, test } from 'bun:test';
import { admitSqliteWrite } from '../../src/db/sqlite-async-admission.js';
import { importFresh, withTempWorkspaceEnv } from '../helpers.js';

type Store = typeof import('../../src/db.js');
const parent = 'web:sql-parent', child = `${parent}:child`, renamed = 'web:sql-renamed';

async function fixture(run: (store: Store) => Promise<void> | void) {
  return withTempWorkspaceEnv('branch-transactions-', {}, async () => {
    const store = await importFresh<Store>('../src/db.js');
    store.initDatabase();
    store.storeChatMetadata(parent, new Date().toISOString(), 'Parent');
    const root = store.getChatBranchByChatJid(parent)!;
    store.storeChatMetadata(child, new Date().toISOString(), 'Child');
    store.ensureChatBranch({ chat_jid: child, root_chat_jid: parent,
      parent_branch_id: root.branch_id, agent_name: 'child' });
    const db = store.getDb();
    db.query('INSERT INTO messages(id,chat_jid,content,timestamp) VALUES(?,?,?,?)')
      .run('child-message', child, 'branchneedle', new Date().toISOString());
    try { await run(store); }
    finally { if (db.inTransaction) db.exec('ROLLBACK'); }
  });
}

function search(store: Store) {
  return store.getDb().query("SELECT chat_jid FROM messages_fts WHERE messages_fts MATCH 'branchneedle'").all();
}

for (const operation of ['rename', 'merge', 'purge'] as const) {
  for (const mode of ['standalone', 'host-admission', 'outer-rollback'] as const) {
    test(`branch SQL helper preserves physical transaction ownership: ${operation}/${mode}`, () => fixture(async store => {
      const db = store.getDb();
      if (operation === 'purge') store.archiveChatBranch(child);
      const before = store.getChatBranchByChatJid(child)!;
      const mutate = () => operation === 'rename' ? store.renameChatJid(parent, renamed)
        : operation === 'merge' ? store.mergeChatBranchIntoParent(child)
          : store.permanentDeleteArchivedBranch(child);
      if (mode === 'outer-rollback') db.exec('BEGIN IMMEDIATE');
      if (mode === 'host-admission') await admitSqliteWrite(db, mutate);
      else mutate();
      expect(db.inTransaction).toBe(mode === 'outer-rollback');
      expect(store.getChatBranchByChatJid(child)).toBeNull();
      expect(search(store)).toEqual(operation === 'purge' ? []
        : [{ chat_jid: operation === 'rename' ? `${renamed}:child` : parent }]);
      if (mode === 'outer-rollback') {
        db.exec('ROLLBACK');
        expect(store.getChatBranchByChatJid(child)).toEqual(before);
        expect(store.getChatBranchByChatJid(parent)).not.toBeNull();
        expect(store.getChatBranchByChatJid(renamed)).toBeNull();
        expect(search(store)).toEqual([{ chat_jid: child }]);
        expect(db.inTransaction).toBe(false);
      }
    }));
  }
}

test('rename relies on transactional FTS update triggers without rebuilding the whole index', () => fixture(store => {
  const db = store.getDb(), exec = db.exec.bind(db);
  let rebuilds = 0;
  db.exec = ((sql: string) => {
    if (/messages_fts\s*\(messages_fts\).*rebuild/i.test(sql)) rebuilds++;
    return exec(sql);
  }) as typeof db.exec;
  try {
    store.renameChatJid(parent, renamed);
    expect(search(store)).toEqual([{ chat_jid: `${renamed}:child` }]);
    expect(rebuilds).toBe(0);
    expect(db.inTransaction).toBe(false);
  } finally { db.exec = exec; }
}));

for (const fault of [false, true]) {
  test(`borrowed rename keeps foreign-key enforcement at outer commit after nested work: fault=${fault}`, () => fixture(store => {
    const db = store.getDb();
    db.exec('PRAGMA foreign_keys=ON');
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    if (fault) db.exec(`CREATE TRIGGER reject_nested_rename BEFORE UPDATE OF chat_jid ON messages
      BEGIN SELECT RAISE(ABORT, 'injected nested rename'); END`);
    db.exec('BEGIN IMMEDIATE');
    try {
      if (fault) {
        expect(() => store.renameChatJid(parent, renamed)).toThrow('injected nested rename');
        expect(store.getChatBranchByChatJid(parent)).not.toBeNull();
        expect(store.getChatBranchByChatJid(renamed)).toBeNull();
        expect(search(store)).toEqual([{ chat_jid: child }]);
      } else store.renameChatJid(parent, renamed);
      expect(db.inTransaction).toBe(true);
      // defer_foreign_keys belongs to the physical transaction, not a savepoint.
      expect(db.query('PRAGMA defer_foreign_keys').get()).toEqual({ defer_foreign_keys: 1 });
      db.query('INSERT INTO messages(id,chat_jid,content,timestamp) VALUES(?,?,?,?)')
        .run('bad-reference', 'web:missing', 'invalid', new Date().toISOString());
      expect(() => db.exec('COMMIT')).toThrow('FOREIGN KEY');
      expect(db.inTransaction).toBe(true);
    } finally { if (db.inTransaction) db.exec('ROLLBACK'); }
    expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(db.query('PRAGMA defer_foreign_keys').get()).toEqual({ defer_foreign_keys: 0 });
    expect(db.query("SELECT id FROM messages WHERE id='bad-reference'").get()).toBeNull();
    expect(search(store)).toEqual([{ chat_jid: child }]);
  }));
}
