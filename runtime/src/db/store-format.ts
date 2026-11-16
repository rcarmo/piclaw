import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';

/** SQLite header discriminator for fresh native Core stores. It is format
 * metadata, never execution/admission authority or a migration version ledger. */
export const NATIVE_STORE_APPLICATION_ID = 0x50494334; // PIC4
export class UnsupportedStoreFormat extends Error {
  constructor() {
    super('Unsupported or incomplete store. V4 never migrates a v3 store in place. Use piclaw session-import with an explicit offline v3 JSONL source and a fresh separate destination. The existing store was left intact.');
    this.name = 'UnsupportedStoreFormat';
  }
}

/** Read-only format check. Existing native ownership/history checks still run in
 * their normal owners; this discriminator grants no execution or config rights. */
export function assertNativeStoreFormat(database: Database, allowEmpty: boolean): void {
  const names = new Set((database.query("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(row => row.name));
  const application = (database.query('PRAGMA application_id').get() as { application_id: number }).application_id;
  if (application === NATIVE_STORE_APPLICATION_ID) return;
  if (!names.size) { if (allowEmpty) return; throw new UnsupportedStoreFormat(); }
  if (application !== 0 || !['conversations', 'entries', 'documents', 'document_revisions', 'tasks', 'submissions'].every(name => names.has(name))) throw new UnsupportedStoreFormat();
  for (const [table, required] of [
    ['documents', ['id', 'kind', 'scope_kind', 'owner_id', 'retired_at']],
    ['document_revisions', ['document_id', 'kind', 'version', 'seq', 'content']],
  ] as const) {
    const columns = new Set((database.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(column => column.name));
    if (!required.every(column => columns.has(column))) throw new UnsupportedStoreFormat();
  }
  // Already-supported native stores predate PIC4. Preserve their reopen; do not
  // convert v3 tables or interpret an old importer/cutover record as authority.
  if (database.query(`SELECT 1 FROM documents WHERE kind='"app.application-conversations"'
      AND scope_kind='conversation' AND owner_id=1 AND retired_at IS NULL LIMIT 1`).get()) return;
  const imported = database.query(`SELECT id FROM documents WHERE kind='"app.session-history-import"'
    AND scope_kind='session' AND retired_at IS NULL LIMIT 1`).get() as { id: number } | null;
  if (imported) {
    const revision = database.query("SELECT content FROM document_revisions WHERE document_id=? AND kind='base' AND version=1 ORDER BY seq DESC LIMIT 1").get(imported.id) as { content: string } | null;
    if (revision) {
      let value;
      try { value = JSON.parse(revision.content); }
      catch { throw new UnsupportedStoreFormat(); }
      if (value?.complete?.format === 4) return;
    }
  }
  throw new UnsupportedStoreFormat();
}

/** Before root openSqliteRole can set WAL/pragmas or create/backfill schemas.
 * The probe neither checkpoints nor opens a legacy runtime/importer. */
export function inspectExistingStoreFormat(path: string): void {
  if (!existsSync(path)) return;
  const reader = new Database(path, { readonly: true, create: false });
  try { assertNativeStoreFormat(reader, false); }
  finally { reader.close(); }
}
