import { closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { BACKGROUND_CONTEXT, type Context } from '@earendil-works/chord/context';
import { createSession, type ConversationId, type EntryId } from '@earendil-works/pi-durable';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { BunSqliteDatabase } from './bun-sqlite.js';
import { readOfflineSessionSource, SESSION_IMPORT_LIMITS, type OfflineSessionEntry } from '../../src/session-import/source.js';

import { SessionHistoryImportDoc, type SessionHistoryImport } from "./session-history-import-record.js";
export { SessionHistoryImportDoc } from "./session-history-import-record.js";
export type { SessionHistoryImport } from "./session-history-import-record.js";
type ImportedMapping = SessionHistoryImport["entries"][number];

/** Explicit offline data import. The SDK Session kernel commits records; no
 * Harness, model registry, scheduler, provider, tool or legacy runtime is opened.
 * Only a fresh, exclusively-created destination is allowed. A failed/uncertain
 * destination stays in place and repeat invocations refuse it, never resume it. */
export async function importSessionHistory(options: { sourceFile: string; destinationFile: string; leaves?: readonly string[] }, context: Context = BACKGROUND_CONTEXT): Promise<SessionHistoryImport> {
  context.abortSignal?.throwIfAborted();
  const sourceFile = realpathSync(options.sourceFile);
  const target = resolve(options.destinationFile);
  const destination = join(realpathSync(dirname(target)), basename(target));
  if (sourceFile === destination) throw Error('Session import requires a fresh separate destination');
  const source = openSync(sourceFile, 'r');
  let session: ReturnType<typeof createSession> | undefined;
  let database: BunSqliteDatabase | undefined;
  try {
    const identity = fstatSync(source);
    if (!identity.isFile() || identity.size > SESSION_IMPORT_LIMITS.bytes) throw Error('Session source must be a bounded regular JSONL file');
    const read = () => {
      const bytes = Buffer.alloc(SESSION_IMPORT_LIMITS.bytes + 1);
      const count = readSync(source, bytes, 0, bytes.length, 0);
      if (count !== identity.size || count > SESSION_IMPORT_LIMITS.bytes) throw Error('Session source changed or exceeds byte bound');
      return bytes.subarray(0, count);
    };
    const bytes = read(), sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const prepared = readOfflineSessionSource(decoded, options.leaves);
    const check = () => {
      context.abortSignal?.throwIfAborted();
      const file = statSync(sourceFile), descriptor = fstatSync(source);
      if (file.dev !== identity.dev || file.ino !== identity.ino || descriptor.size !== identity.size
        || createHash('sha256').update(read()).digest('hex') !== sourceSha256) throw Error('Offline session source changed during import');
    };
    check();
    // O_EXCL refuses files, hardlinks and symlinks, including dangling symlinks.
    // It runs only after complete decoding/selection/refusal checks.
    const reserved = openSync(destination, 'wx', 0o600); closeSync(reserved);
    database = new BunSqliteDatabase(destination, undefined, { create: false, checkpoint: 'builtin' });
    const storage = await SqliteStorage.open(database);
    session = createSession(storage);
    const locations = new Map<string, { conversationId: ConversationId; entryId: EntryId }>();
    const byId = new Map(prepared.entries.map(entry => [entry.id, entry]));
    const entries: ImportedMapping[] = [];
    // Public SDK forks read committed ancestry. Commit each bounded selected
    // branch before another can fork it; only the final commit marks completion.
    for (const leaf of prepared.selectedLeaves) {
      const chain: OfflineSessionEntry[] = [];
      for (let entry = byId.get(leaf); entry; entry = entry.parentId ? byId.get(entry.parentId) : undefined) chain.push(entry);
      chain.reverse();
      let start = 0; while (start < chain.length && locations.has(chain[start]!.id)) start++;
      const parent = start ? locations.get(chain[start - 1]!.id) : undefined;
      const added = await session.commit(async tx => {
        check();
        const conversationId = parent ? (await tx.forkConversation(parent.conversationId, parent.entryId, { ownership: { kind: 'ownerless' } })).id
          : (await tx.createConversation({ ownership: { kind: 'ownerless' } })).id;
        const added: ImportedMapping[] = [];
        for (const original of chain.slice(start)) {
          context.abortSignal?.throwIfAborted();
          // History/provenance only: no current instructions, model selection,
          // compaction execution, tool receipts, tasks or submissions are created.
          const record = await tx.appendEntry(conversationId, { kind: 'app.imported-history', data: { sourceEntry: original.original },
            ...(original.message && original.message.role !== 'system' ? { model: [original.message] } : {}) });
          added.push({ sourceEntryId: original.id, conversationId, entryId: record.id });
        }
        check(); return added;
      }, context);
      for (const entry of added) { entries.push(entry); locations.set(entry.sourceEntryId, { conversationId: entry.conversationId as ConversationId, entryId: entry.entryId as EntryId }); }
    }
    const result: SessionHistoryImport = { format: 4, sourceVersion: 3, sourceFile, sourceSessionId: prepared.sourceSessionId, sourceSha256,
      sourceEntries: prepared.entries.length, importedEntries: entries.length, excludedEntries: prepared.entries.length - entries.length, entries,
      leaves: prepared.selectedLeaves.map(sourceLeafId => ({ sourceLeafId, conversationId: locations.get(sourceLeafId)!.conversationId })) };
    await session.commit(async tx => { check(); (await tx.doc(SessionHistoryImportDoc)).complete = result; check(); }, context);
    await session.close(BACKGROUND_CONTEXT); session = undefined; database = undefined;
    check(); return result;
  } finally {
    try { if (session) await session.close(BACKGROUND_CONTEXT); else await database?.close(); }
    finally { closeSync(source); }
  }
}
