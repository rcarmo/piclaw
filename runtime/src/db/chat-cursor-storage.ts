import type { Database } from 'bun:sqlite';
import { applyOwnedMigrations, type OwnedSchemaMigration } from './migrations.js';

const activeCursorSql = "CREATE TABLE main.chat_cursors (chat_jid TEXT PRIMARY KEY, cursor_ts TEXT NOT NULL DEFAULT '', queued_followups_json TEXT)";
const fresh: OwnedSchemaMigration = { owner: 'host.chat-cursors', id: 'polling-frontier-v1', order: 1, sql: activeCursorSql };
function fail(): never { throw Error('Unsupported chat cursor schema; no in-place legacy retirement or conversion is performed'); }
function normalise(text: string): string {
  const tokens = (text.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-zA-Z_][a-zA-Z_0-9$]*|[^\s]/g) ?? [])
    .filter(token => !token.startsWith('--') && !token.startsWith('/*'))
    .map(token => /^['"`\[]/.test(token) ? token : token.toLowerCase());
  if (tokens[2] === 'if' && tokens[3] === 'not' && tokens[4] === 'exists') tokens.splice(2, 3);
  if (tokens.at(-1) === ';') tokens.pop();
  return tokens.join(' ');
}
function assertActive(db: Database): void {
  const schema = db.query("SELECT type,sql FROM main.sqlite_schema WHERE name='chat_cursors' COLLATE NOCASE").get() as { type: string; sql: string } | null;
  if (!schema || schema.type !== 'table' || normalise(schema.sql) !== normalise(activeCursorSql.replace('main.', ''))) fail();
  const rows = db.query('PRAGMA main.table_xinfo(chat_cursors)').all() as { name: string; type: string; notnull: number; dflt_value: string | null; pk: number; hidden: number }[];
  if (rows.length !== 3 || rows.map(row => row.name).join(',') !== 'chat_jid,cursor_ts,queued_followups_json'
    || rows.some(row => row.type.toUpperCase() !== 'TEXT' || row.pk !== (row.name === 'chat_jid' ? 1 : 0) || row.hidden !== 0
      || row.notnull !== (row.name === 'cursor_ts' ? 1 : 0) || row.dflt_value !== (row.name === 'cursor_ts' ? "''" : null))) fail();
  if ((db.query('PRAGMA main.index_list(chat_cursors)').all() as { origin: string }[]).some(index => index.origin !== 'pk')) fail();
  for (const schema of ['main.sqlite_schema', 'sqlite_temp_schema']) {
    if (db.query(`SELECT 1 FROM ${schema} WHERE type IN ('trigger','view') AND
      (tbl_name='chat_cursors' COLLATE NOCASE OR instr(lower(coalesce(sql,'')),'chat_cursors')>0) LIMIT 1`).get()) fail();
  }
  if (db.query(`SELECT 1 FROM main.sqlite_schema s,pragma_foreign_key_list(s.name,'main') f
    WHERE s.type='table' AND lower(f."table")='chat_cursors' LIMIT 1`).get()) fail();
}

/** Fresh/current native polling storage only. Old cursor schemas, dependent
 * ownership triggers and version branches are refused without archive, rename,
 * DROP or backfill. Existing already-native archived objects/receipts stay intact;
 * they are historical data and are never read for runtime authority. */
export function initializeChatCursorStorage(db: Database): void {
  db.transaction(() => {
    if (db.query("SELECT 1 FROM sqlite_temp_schema WHERE name COLLATE NOCASE IN ('chat_cursors','piclaw_schema_migrations') LIMIT 1").get()) fail();
    const current = db.query("SELECT 1 FROM main.sqlite_schema WHERE name='chat_cursors' COLLATE NOCASE").get();
    if (current) { assertActive(db); return; }
    applyOwnedMigrations(db, [fresh]);
    assertActive(db);
  }).immediate();
}
