import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { initializeChatCursorStorage } from '../../src/db/chat-cursor-storage.js';
import '../helpers.js';
const ddl = readFileSync(new URL('../fixtures/chat-cursors-s01-owner-v1.sql', import.meta.url), 'utf8');
const snapshot = (db: Database) => ({ schema: db.query('SELECT * FROM sqlite_schema ORDER BY type,name').all(), rows: db.query('SELECT rowid,* FROM chat_cursors ORDER BY rowid').all() });

for (const variant of ['original', 'missing-guard', 'altered-guard', 'extra-column', 'missing-column'] as const) test(`old S01 cursor generation is refused intact without rename/DROP/backfill: ${variant}`, () => {
  const db = new Database(':memory:');
  try {
    db.exec(ddl);
    const columns = db.query('PRAGMA table_info(chat_cursors)').all() as { name: string; type: string }[];
    const values = columns.map(column => column.name === 'chat_jid' ? 'historical' : column.type === 'INTEGER' ? 71 : `Original ${column.name}`);
    db.query(`INSERT INTO chat_cursors(${columns.map(column => column.name).join(',')}) VALUES(${columns.map(() => '?').join(',')})`).run(...values);
    if (variant === 'missing-guard') db.exec('DROP TRIGGER chat_cursors_legacy_owner_exclusion');
    if (variant === 'extra-column') db.exec('ALTER TABLE chat_cursors ADD COLUMN unknown_owner TEXT');
    if (variant === 'missing-column') db.exec('ALTER TABLE chat_cursors DROP COLUMN operation_generation');
    if (variant === 'altered-guard') { db.exec('DROP TRIGGER chat_cursors_active_owner_delete_exclusion'); db.exec("CREATE TRIGGER chat_cursors_active_owner_delete_exclusion BEFORE DELETE ON chat_cursors BEGIN SELECT RAISE(ABORT,'changed'); END"); }
    const before = snapshot(db);
    expect(() => initializeChatCursorStorage(db)).toThrow('Unsupported chat cursor'); expect(snapshot(db)).toEqual(before);
    expect(db.query("SELECT 1 FROM sqlite_schema WHERE name='host_legacy_chat_cursor_state_v1'").get()).toBeNull();
  } finally { db.close(); }
});

for (const dependent of ['CREATE VIEW cursor_view AS SELECT * FROM chat_cursors', 'CREATE TABLE child(chat TEXT REFERENCES chat_cursors(chat_jid))', 'CREATE TRIGGER cursor_guard BEFORE DELETE ON chat_cursors BEGIN SELECT 1; END']) test('current native cursor rejects undeclared dependency without schema/row changes', () => {
  const db = new Database(':memory:');
  try {
    initializeChatCursorStorage(db); db.exec(dependent); const before = snapshot(db);
    expect(() => initializeChatCursorStorage(db)).toThrow('Unsupported chat cursor'); expect(snapshot(db)).toEqual(before);
  } finally { db.close(); }
});
