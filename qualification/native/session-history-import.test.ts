import './src/test-guard.js';
import { expect, test, spyOn } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, linkSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { createSession, type ConversationId, type EntryId } from '../../runtime/durable-engine/qualification/durable.js';
import { SqliteStorage } from '../../runtime/durable-engine/qualification/sqlite.js';
import { BACKGROUND_CONTEXT as context, withAbortSignal } from '../../runtime/durable-engine/qualification/context.js';
import { BunSqliteDatabase } from '../../runtime/durable-engine/src/bun-sqlite.js';
import { importSessionHistory, SessionHistoryImportDoc } from '../../runtime/durable-engine/src/session-history-import.js';
import { projectPublicHistory } from '../../runtime/durable-engine/src/session-tree.js';

const timestamp = '2026-01-01T00:00:00.000Z';
const sourceRecords = () => [
  { type: 'session', version: 3, id: 'offline-session', timestamp, cwd: '/old/offline' },
  { type: 'message', id: 'u', parentId: null, timestamp, message: { role: 'user', content: 'OFFLINE_USER_TEXT', timestamp: 1 } },
  ...['a', 'b'].map(id => ({ type: 'message', id, parentId: 'u', timestamp, message: { role: 'assistant', api: 'openai-completions', provider: 'offline', model: 'recorded', content: [{ type: 'text', text: `OLD_BRANCH_${id}` }], timestamp: 2, stopReason: 'stop', usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } })),
];
const encode = (records = sourceRecords()) => records.map(record => JSON.stringify(record)).join('\n') + '\n';
for (const leaves of [['a'], ['a', 'b']]) test(`fresh SDK history-only import preserves actual source lineage and native reopen: ${leaves.join(',')}`, async () => {
  const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'session-history-import-'));
  const sourceFile = join(directory, 'source.jsonl'), destinationFile = join(directory, 'fresh-v4.sqlite');
  writeFileSync(sourceFile, encode()); const before = readFileSync(sourceFile);
  try {
    const result = await importSessionHistory({ sourceFile, destinationFile, leaves });
    expect(readFileSync(sourceFile).equals(before)).toBe(true);
    expect(result).toMatchObject({ format: 4, sourceVersion: 3, sourceSessionId: 'offline-session', sourceEntries: 3, importedEntries: leaves.length + 1, excludedEntries: 2 - leaves.length });
    const session = createSession(await SqliteStorage.open(new BunSqliteDatabase(destinationFile)));
    try {
      expect(await session.snapshot(SessionHistoryImportDoc, context)).toEqual({ complete: result });
      const records = await session.commit(async tx => {
        const conversations = await tx.scanConversations({}, 10), tasks = await tx.scanTasks({}, 10);
        const visible = (await Promise.all(conversations.items.map(conversation => tx.scanEntries({ conversationId: conversation.id, order: 'ascending' }, 10)))).flatMap(page => page.items);
        const entries = [...new Map(visible.map(entry => [entry.id, entry])).values()];
        return { conversations, entries, tasks };
      }, context);
      expect(records.tasks.items).toEqual([]);
      expect(records.entries).toHaveLength(leaves.length + 1);
      expect(records.entries.every(record => record.kind === 'app.imported-history' && record.byTaskId === undefined)).toBe(true);
      expect(records.conversations.items.every(record => !record.owner)).toBe(true);
      for (const conversation of records.conversations.items) {
        const visible = await session.commit(tx => tx.scanEntries({ conversationId: conversation.id, order: 'ascending' }, 10), context);
        const tree = projectPublicHistory(visible.items, null);
        expect(tree.map(node => node.entry.id)).toEqual(visible.items.map(entry => String(entry.id)));
        expect(tree.every(node => node.entry.type === 'message')).toBe(true);
      }
      if (leaves.length === 2) {
        const fork = records.conversations.items.find(record => record.parent);
        const common = result.entries.find(entry => entry.sourceEntryId === 'u')!;
        expect(fork?.parent).toEqual({ conversationId: common.conversationId as ConversationId, at: common.entryId as EntryId });
      }
      const sourceById = new Map(sourceRecords().slice(1).map(entry => [(entry as any).id, entry]));
      for (const imported of records.entries) expect((imported.data as any).sourceEntry).toEqual(sourceById.get(result.entries.find(entry => entry.entryId === imported.id)!.sourceEntryId));
    } finally { await session.close(context); }
    const inspection = new Database(destinationFile, { readonly: true });
    try {
      expect(inspection.query('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 0 });
      expect(inspection.query('SELECT COUNT(*) AS count FROM submissions').get()).toEqual({ count: 0 });
      expect(inspection.query("SELECT kind FROM documents WHERE kind IN ('\"pi.agent\"','\"pi.live\"','\"app.copied-legacy-import\"','\"app.copied-legacy-tree-import\"')").all()).toEqual([]);
      expect(inspection.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('messages','chats','chat_cursors','extension_kv','host_cutover_manifest')").all()).toEqual([]);
    } finally { inspection.close(); }
    await expect(importSessionHistory({ sourceFile, destinationFile, leaves })).rejects.toThrow();
    expect(readFileSync(sourceFile).equals(before)).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

for (const mode of ['same', 'existing', 'hardlink', 'symlink', 'malformed', 'version', 'ambiguous', 'cancelled'] as const) test(`one-shot importer refuses ${mode} without changing source or existing destination`, async () => {
  const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'session-import-refusal-'));
  const sourceFile = join(directory, 'source.jsonl'); let destinationFile = join(directory, 'destination.sqlite');
  writeFileSync(sourceFile, mode === 'malformed' ? 'PRIVATE_BROKEN_JSON' : mode === 'version' ? encode([{ ...sourceRecords()[0]!, version: 2 }, ...sourceRecords().slice(1)] as any) : encode());
  if (mode === 'same') destinationFile = sourceFile;
  else if (mode === 'existing') writeFileSync(destinationFile, 'EXISTING_DESTINATION_UNCHANGED');
  else if (mode === 'hardlink') linkSync(sourceFile, destinationFile);
  else if (mode === 'symlink') symlinkSync(sourceFile, destinationFile);
  const sourceBefore = readFileSync(sourceFile), destinationBefore = existsSync(destinationFile) ? readFileSync(destinationFile) : undefined;
  const abort = new AbortController(); if (mode === 'cancelled') abort.abort(Error('Import cancelled'));
  try {
    await expect(importSessionHistory({ sourceFile, destinationFile, ...(mode === 'ambiguous' ? {} : { leaves: ['a'] }) }, withAbortSignal(abort.signal, context))).rejects.toThrow();
    expect(readFileSync(sourceFile).equals(sourceBefore)).toBe(true);
    if (destinationBefore) expect(readFileSync(destinationFile).equals(destinationBefore)).toBe(true);
    else expect(existsSync(destinationFile)).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('interrupted branch import leaves explicit incomplete history and refuses repeat instead of resuming or duplicating', async () => {
  const directory = mkdtempSync(join(process.env.PICLAW_WORKSPACE!, 'session-import-interrupted-'));
  const sourceFile = join(directory, 'source.jsonl'), destinationFile = join(directory, 'partial-v4.sqlite');
  writeFileSync(sourceFile, encode()); const sourceBefore = readFileSync(sourceFile), abort = new AbortController();
  const actual = await import(import.meta.resolve('@earendil-works/pi-durable', new URL('../../runtime/durable-engine/package.json', import.meta.url).href));
  const original = actual.createSession; let commits = 0;
  const hook = spyOn(actual, 'createSession').mockImplementation((storage: any, options: any) => {
    const session = original(storage, options);
    return new Proxy(session, { get(target, key) {
      if (key === 'commit') return async (...args: any[]) => { const result = await (target.commit as any)(...args); if (++commits === 1) abort.abort(Error('Interrupted after committed branch')); return result; };
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  try {
    await expect(importSessionHistory({ sourceFile, destinationFile, leaves: ['a', 'b'] }, withAbortSignal(abort.signal, context))).rejects.toThrow();
    expect(commits).toBe(1); expect(readFileSync(sourceFile).equals(sourceBefore)).toBe(true);
  } finally { hook.mockRestore(); }
  try {
    const session = createSession(await SqliteStorage.open(new BunSqliteDatabase(destinationFile)));
    try { expect(await session.snapshot(SessionHistoryImportDoc, context)).toBeUndefined(); }
    finally { await session.close(context); }
    const database = new Database(destinationFile, { readonly: true });
    try { expect(database.query('SELECT COUNT(*) AS count FROM entries').get()).toEqual({ count: 2 }); expect(database.query('SELECT COUNT(*) AS count FROM tasks').get()).toEqual({ count: 0 }); }
    finally { database.close(); }
    await expect(importSessionHistory({ sourceFile, destinationFile, leaves: ['a', 'b'] })).rejects.toThrow();
    expect(readFileSync(sourceFile).equals(sourceBefore)).toBe(true);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
