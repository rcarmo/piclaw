import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { initDatabase, getDb } from '../../src/db.js';
import * as cursors from '../../src/db/chat-cursors.js';
import { initializeChatCursorStorage } from '../../src/db/chat-cursor-storage.js';
import '../helpers.js';
const archive = 'host_legacy_chat_cursor_state_v1';
const legacySql = readFileSync(new URL('../fixtures/legacy-chat-cursors.sql', import.meta.url), 'utf8');
const snapshot = (db: Database) => ({ schema: db.query('SELECT * FROM main.sqlite_schema ORDER BY type,name').all(), temp: db.query('SELECT * FROM sqlite_temp_schema ORDER BY type,name').all(),
  rows: db.query('SELECT rowid,* FROM main.chat_cursors ORDER BY rowid').all(),
  receipts: db.query("SELECT 1 FROM main.sqlite_schema WHERE name='piclaw_schema_migrations'").get() ? db.query('SELECT * FROM main.piclaw_schema_migrations ORDER BY owner,migration_order').all() : [] });

test('current native cursor is polling data only; no legacy execution/recovery APIs', () => {
  initDatabase();
  expect((getDb().query('PRAGMA table_info(chat_cursors)').all() as { name: string }[]).map(row => row.name)).toEqual(['chat_jid', 'cursor_ts', 'queued_followups_json']);
  expect(getDb().query('SELECT 1 FROM sqlite_schema WHERE name=?').get(archive)).toBeNull();
  for (const name of ['beginChatRun', 'beginChatPreflight', 'getInflightRuns', 'rollbackInflightRun', 'getFailedRun', 'getChatCompactionBackoff', 'getChatAutoCompactionWindow']) expect(cursors).not.toHaveProperty(name);
});

test('fresh/current native cursor initialization is idempotent and creates no legacy archive', () => {
  const db = new Database(':memory:');
  try {
    initializeChatCursorStorage(db); db.exec("INSERT INTO chat_cursors VALUES('fresh','unadvanced','{malformed')");
    const before = snapshot(db); initializeChatCursorStorage(db); expect(snapshot(db)).toEqual(before);
    expect(db.query('SELECT owner,id,migration_order FROM piclaw_schema_migrations').all()).toEqual([{ owner: 'host.chat-cursors', id: 'polling-frontier-v1', migration_order: 1 }]);
    expect(db.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(archive)).toBeNull();
  } finally { db.close(); }
});

test('existing native historical archive and old receipt remain data, never re-converted or mutated', () => {
  const db = new Database(':memory:');
  try {
    initializeChatCursorStorage(db);
    db.exec(legacySql.replaceAll(/\bchat_cursors\b/g, archive));
    db.query(`INSERT INTO ${archive}(chat_jid,cursor_ts,inflight_message_id) VALUES('old','old-position','unsettled-old-input')`).run();
    db.exec("UPDATE piclaw_schema_migrations SET id='native-frontier-v1',checksum='historical-checksum' WHERE owner='host.chat-cursors'");
    const before = { archive: db.query(`SELECT rowid,* FROM ${archive}`).all(), state: snapshot(db) };
    initializeChatCursorStorage(db);
    expect({ archive: db.query(`SELECT rowid,* FROM ${archive}`).all(), state: snapshot(db) }).toEqual(before);
  } finally { db.close(); }
});

for (const definition of [legacySql,
  "CREATE TABLE chat_cursors(chat_jid TEXT PRIMARY KEY,cursor_ts TEXT NOT NULL DEFAULT '',inflight_message_id TEXT)",
  "CREATE TABLE chat_cursors(chat_jid TEXT PRIMARY KEY,cursor_ts TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE chat_cursors(chat_jid TEXT PRIMARY KEY,cursor_ts TEXT NOT NULL DEFAULT 'different',queued_followups_json TEXT)",
  "CREATE TABLE chat_cursors(chat_jid TEXT PRIMARY KEY,cursor_ts TEXT NOT NULL DEFAULT '',queued_followups_json INTEGER)",
]) test('legacy/unsupported cursor declarations refuse intact instead of in-place rename/backfill/cleanup', () => {
  const db = new Database(':memory:');
  try { db.exec(definition); const before = snapshot(db); expect(() => initializeChatCursorStorage(db)).toThrow('Unsupported chat cursor'); expect(snapshot(db)).toEqual(before); expect(db.query('SELECT 1 FROM sqlite_schema WHERE name=?').get(archive)).toBeNull(); }
  finally { db.close(); }
});

for (const mutation of ['ALTER TABLE chat_cursors ADD COLUMN mystery TEXT', 'CREATE INDEX extra_cursor_index ON chat_cursors(cursor_ts)', 'CREATE TEMP TABLE CHAT_CURSORS(untouched TEXT)', 'CREATE TEMP TABLE PICLAW_SCHEMA_MIGRATIONS(untouched TEXT)']) test('active cursor shape/index/shadow drift refuses without changes', () => {
  const db = new Database(':memory:');
  try { initializeChatCursorStorage(db); db.exec(mutation); const before = snapshot(db); expect(() => initializeChatCursorStorage(db)).toThrow('Unsupported chat cursor'); expect(snapshot(db)).toEqual(before); }
  finally { db.close(); }
});
