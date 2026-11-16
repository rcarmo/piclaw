import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { withTempWorkspaceEnv } from '../helpers.js';
import { getRuntimeConfigPaths } from '../../src/core/config.js';
import * as store from '../../src/db.js';
import * as kv from '../../src/db/extension-kv.js';

const parent = 'web:kv-parent', child = `${parent}:child`, other = 'web:kv-other';
const old = '2001-02-03T04:05:06.007Z';
const raw = ' { "historical" : "\\u0061", "unicode" : "旧" } ';
const rows = () => store.getDb().query('SELECT * FROM extension_kv ORDER BY extension_id,scope,scope_key,key').all();

async function fixture(run: (paths: ReturnType<typeof getRuntimeConfigPaths>) => Promise<void>) {
  await withTempWorkspaceEnv('kv-mutation-retirement-', {}, async workspace => {
    await store.closeDatabase();
    const paths = { ...getRuntimeConfigPaths(), databasePath: join(workspace.store, 'kv.sqlite') };
    store.initDatabase(paths);
    try {
      for (const chat of [parent, child, other]) store.storeChatMetadata(chat, old, chat);
      store.ensureChatBranch({ chat_jid: child, root_chat_jid: parent,
        parent_branch_id: store.getChatBranchByChatJid(parent)!.branch_id, agent_name: 'child' });
      const insert = store.getDb().query('INSERT INTO extension_kv VALUES(?,?,?,?,?,?,?)');
      for (const [id, scope, chat, key] of [
        ['one', 'chat', parent, 'override'], ['one', 'chat', child, 'override'],
        ['two', 'chat', child, 'child-only'], ['two', 'chat', other, 'unrelated'],
        ['two', 'global', '', 'global'],
      ]) insert.run(id!, scope!, chat!, key!, chat === parent ? '{"parent":"kept"}' : raw, old, old);
      await run(paths);
    } finally {
      await store.closeDatabase();
    }
  });
}

for (const name of ['extensionKvDeleteByChatJid', 'extensionKvPrune']) {
  test(`unused synchronous KV mutation is absent from leaf and public barrel: ${name}`, () => {
    expect(kv).not.toHaveProperty(name);
    expect(store).not.toHaveProperty(name);
  });
}

test('Root reopen retains stale chat/global KV bytes and timestamps without automatic pruning', () => fixture(async paths => {
  const before = rows();
  await store.closeDatabase();
  store.initDatabase(paths);
  expect(rows()).toEqual(before);
  expect(rows()).toHaveLength(5);
}));

test('retired branch writers cannot move or delete KV through the old public barrel', () => fixture(async () => {
  const before = rows();
  expect(store).not.toHaveProperty('mergeChatBranchIntoParent'); expect(store).not.toHaveProperty('permanentDeleteArchivedBranch');
  expect(rows()).toEqual(before);
}));
