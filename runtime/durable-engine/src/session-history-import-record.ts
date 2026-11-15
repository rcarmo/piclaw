import { defineDoc } from '@earendil-works/pi-durable';
import type { Database } from 'bun:sqlite';

type ImportedMapping = { sourceEntryId: string; conversationId: number; entryId: number };
export type SessionHistoryImport = {
  format: 4; sourceVersion: 3; sourceFile: string; sourceSessionId: string; sourceSha256: string;
  sourceEntries: number; importedEntries: number; excludedEntries: number;
  entries: ImportedMapping[]; leaves: { sourceLeafId: string; conversationId: number }[];
};
export const SessionHistoryImportDoc = defineDoc<{ complete: SessionHistoryImport | null }>({
  kind: 'app.session-history-import', version: 1, scope: 'session',
  initial: () => ({ complete: null }), checkpointWhen: () => true,
});

/** Already-native completion/provenance only. No v3 reader, path discovery,
 * source-file access, SDK open, actor configuration or mutation. */
export function readCompletedSessionImport(database: Database): SessionHistoryImport | undefined {
  const docs = database.query(`SELECT id FROM documents WHERE kind='"app.session-history-import"'
    AND scope_kind='session' AND retired_at IS NULL`).all() as { id: number }[];
  if (!docs.length) return undefined;
  const fail = () => { throw Error('Invalid or incomplete native session import; use a fresh separate destination'); };
  if (docs.length !== 1) return fail();
  const revisions = database.query('SELECT kind,version,content FROM document_revisions WHERE document_id=? ORDER BY seq').all(docs[0]!.id) as { kind: string; version: number; content: string }[];
  if (revisions.length !== 1 || revisions[0]!.kind !== 'base' || revisions[0]!.version !== 1) return fail();
  let imported: SessionHistoryImport;
  try { imported = JSON.parse(revisions[0]!.content).complete; } catch { return fail(); }
  if (!imported || imported.format !== 4 || imported.sourceVersion !== 3 || typeof imported.sourceFile !== 'string' || typeof imported.sourceSessionId !== 'string' || !imported.sourceSessionId || !/^[a-f0-9]{64}$/.test(imported.sourceSha256)
    || !Number.isSafeInteger(imported.sourceEntries) || !Number.isSafeInteger(imported.importedEntries) || imported.importedEntries < 1 || imported.sourceEntries < imported.importedEntries || imported.sourceEntries > 1000
    || imported.excludedEntries !== imported.sourceEntries - imported.importedEntries || !Array.isArray(imported.entries) || imported.entries.length !== imported.importedEntries
    || !Array.isArray(imported.leaves) || !imported.leaves.length || imported.leaves.length > 16) return fail();
  if (new Set(imported.entries.map(entry => entry.sourceEntryId)).size !== imported.entries.length || new Set(imported.entries.map(entry => entry.entryId)).size !== imported.entries.length
    || new Set(imported.leaves.map(leaf => leaf.sourceLeafId)).size !== imported.leaves.length || new Set(imported.leaves.map(leaf => leaf.conversationId)).size !== imported.leaves.length) return fail();
  const conversations = new Set<number>();
  for (const entry of imported.entries) {
    if (typeof entry.sourceEntryId !== 'string' || !entry.sourceEntryId || !Number.isSafeInteger(entry.entryId) || entry.entryId < 1 || !Number.isSafeInteger(entry.conversationId) || entry.conversationId <= 1) return fail();
    const native = database.query('SELECT record FROM entries WHERE id=? AND conversation_id=?').get(entry.entryId, entry.conversationId) as { record: string } | null;
    if (!native) return fail();
    const record = JSON.parse(native.record);
    if (record.kind !== 'app.imported-history' || record.byTaskId !== undefined || record.data?.sourceEntry?.id !== entry.sourceEntryId) return fail();
    conversations.add(entry.conversationId);
  }
  if ((database.query('SELECT COUNT(*) AS count FROM entries').get() as { count: number }).count !== imported.entries.length
    || database.query('SELECT 1 FROM tasks UNION ALL SELECT 1 FROM submissions LIMIT 1').get()
    || database.query('SELECT 1 FROM documents WHERE id<>? LIMIT 1').get(docs[0]!.id)) return fail();
  for (const table of ['messages', 'scheduled_tasks', 'extension_kv', 'service_effect_s01_sources', 'service_effect_s01_operations', 'service_effect_s07_tasks', 'service_effect_s07_occurrences']) {
    if (database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) && database.query(`SELECT 1 FROM ${table} LIMIT 1`).get()) return fail();
  }
  const rows = database.query('SELECT id,record FROM conversations').all() as { id: number; record: string }[];
  if (rows.length !== conversations.size) return fail();
  for (const row of rows) {
    const record = JSON.parse(row.record);
    if (!conversations.has(row.id) || record.owner || record.parent && !imported.entries.some(entry => entry.conversationId === record.parent.conversationId && entry.entryId === record.parent.at)) return fail();
  }
  if (imported.leaves.some(leaf => !imported.entries.some(entry => entry.sourceEntryId === leaf.sourceLeafId && entry.conversationId === leaf.conversationId))) return fail();
  return imported;
}
