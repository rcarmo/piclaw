import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readLegacyPlan } from '../../src/plan/legacy.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE extension_kv (extension_id TEXT,scope TEXT,scope_key TEXT,key TEXT,value TEXT,created_at TEXT,updated_at TEXT,PRIMARY KEY(extension_id,scope,scope_key,key))');
  const seed = (chat: string, value: unknown, scope = 'chat', extension = 'plan-sidebar') => db.query('INSERT INTO extension_kv VALUES (?,?,?,?,?,?,?)')
    .run(extension, scope, chat, 'plan', JSON.stringify(value), 'original creation', 'original SQL update');
  return { db, seed };
}

test('legacy adoption is exact-scope, non-creating and never rewrites metadata/history', () => {
  const { db, seed } = fixture();
  try {
    const parent = { chat_jid: 'web:x', markdown: '> authored\n\n- [-] original', updated_at: 'old timestamp' };
    const branch = { chat_jid: 'web:x:branch:one', markdown: '- [x] branch', updated_at: null };
    seed('web:x', parent); seed(branch.chat_jid, branch);
    seed('web:x', { ...parent, markdown: 'wrong global scope' }, 'global');
    seed('web:x', { ...parent, markdown: 'wrong extension' }, 'chat', 'other');
    const before = db.query('SELECT * FROM extension_kv ORDER BY extension_id,scope,scope_key').all();
    expect(readLegacyPlan(db, 'web:x')).toEqual(parent);
    expect(readLegacyPlan(db, branch.chat_jid)).toEqual(branch);
    expect(readLegacyPlan(db, 'web:x:branch:two')).toBeUndefined();
    expect(readLegacyPlan(db, 'web:missing')).toBeUndefined();
    expect(readLegacyPlan(db, 'web:x')).toEqual(parent);
    expect(db.query('SELECT * FROM extension_kv ORDER BY extension_id,scope,scope_key').all()).toEqual(before);
  } finally { db.close(); }
});

for (const value of [null, [], { chat_jid: 'web:foreign', markdown: 'foreign', updated_at: null }, { chat_jid: 'web:x', markdown: 7, updated_at: null }]) {
  test(`unsafe legacy shape is retained, not adopted or overwritten: ${JSON.stringify(value)}`, () => {
    const { db, seed } = fixture();
    try {
      seed('web:x', value);
      const before = db.query('SELECT * FROM extension_kv').all();
      expect(() => readLegacyPlan(db, 'web:x')).toThrow('requires review');
      expect(db.query('SELECT * FROM extension_kv').all()).toEqual(before);
    } finally { db.close(); }
  });
}

test('blank and formerly invalid Markdown are preserved for read, not silently defaulted', () => {
  const { db, seed } = fixture();
  try {
    seed('web:blank', { chat_jid: 'web:blank', markdown: '', updated_at: null });
    seed('web:authored', { chat_jid: 'web:authored', markdown: '- [-] first\r\n- [-] second', updated_at: null });
    expect(readLegacyPlan(db, 'web:blank')?.markdown).toBe('');
    expect(readLegacyPlan(db, 'web:authored')?.markdown).toBe('- [-] first\r\n- [-] second');
    expect(() => readLegacyPlan(db, '')).toThrow('Explicit Plan chat identity');
  } finally { db.close(); }
});

test('fresh store without legacy table is readable without schema writes', () => {
  const db = new Database(':memory:');
  try {
    expect(readLegacyPlan(db, 'web:fresh')).toBeUndefined();
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
  } finally { db.close(); }
});
