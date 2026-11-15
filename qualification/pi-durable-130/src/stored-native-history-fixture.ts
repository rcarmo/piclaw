import { type Conversation, type ConversationId, type EntryId, type Harness, SystemEntry, CompactionEntry } from '../../../runtime/durable-engine/qualification/durable.js';
import { type Message } from '../../../runtime/durable-engine/qualification/ai.js';
import { type Context } from '../../../runtime/durable-engine/qualification/context.js';
import { LegacyImportManifest, LegacyTreeImportManifest, type LegacyImportBinding, type LegacyTreeImportBinding } from '../../../runtime/durable-engine/src/legacy-import-schema.js';
import type { JsonValue } from '../../../runtime/durable-engine/qualification/chord.js';

type FixtureRecord = { id: string; parentId: string | null; type: string; [key: string]: unknown };
/** Test-only synthetic ALREADY-NATIVE historical data. No source file/JSONL
 * decoder, resident authority, migration callback, cutover, execution or config
 * adoption. Preserves old persisted document shapes to test native reopen/readers. */
export async function storedNativeHistoryFixture(harness: Harness, root: Conversation, records: FixtureRecord[],
  leaves: { id: string; chatJid: string; branchId: string; incarnation: string }[], sourceSessionId: string, baseline: string, context: Context): Promise<LegacyTreeImportBinding> {
  const byId = new Map(records.map(record => [record.id, record]));
  const locations = new Map<string, { id: EntryId; conversationId: ConversationId }>();
  const branches: LegacyImportBinding[] = [], sourceHash = 'a'.repeat(64);
  for (const leaf of leaves) {
    const chain: FixtureRecord[] = [];
    for (let record = byId.get(leaf.id); record; record = record.parentId ? byId.get(record.parentId) : undefined) chain.push(record);
    chain.reverse(); let start = 0; while (start < chain.length && locations.has(chain[start]!.id)) start++;
    const parent = start ? locations.get(chain[start - 1]!.id) : undefined;
    const result = await root.commit(async tx => {
      const id = parent ? (await tx.forkConversation(parent.conversationId, parent.id, { ownership: { kind: 'ownerless' } })).id : root.id;
      if (!parent) await tx.appendEntry(SystemEntry, id, { model: [{ role: 'system', content: baseline, timestamp: 0 }] });
      const mapping = chain.slice(0, start).map(record => ({ sourceEntryId: record.id, durableEntryId: locations.get(record.id)!.id as number }));
      const added: { sourceEntryId: string; durableEntryId: number }[] = [];
      for (const original of chain.slice(start)) {
        const audit = await tx.appendEntry(id, { kind: 'app.legacy-source', data: original as JsonValue }); let at = audit.id;
        if (original.type === 'message') at = (await tx.appendEntry(id, { kind: 'app.legacy-message', model: [original.message as Message] })).id;
        if (original.type === 'compaction') {
          const head = mapping.find(item => item.sourceEntryId === original.firstKeptEntryId)!.durableEntryId as EntryId;
          at = (await tx.appendEntry(CompactionEntry, id, { head, data: { reason: 'manual' }, model: [{ role: 'system', content: baseline, timestamp: 0 }, { role: 'user', content: String(original.summary), timestamp: Date.parse(String(original.timestamp)) }] })).id;
          if (original.systemMessage) at = (await tx.appendEntry(SystemEntry, id, { model: [original.systemMessage as Message] })).id;
        }
        const entry = { sourceEntryId: original.id, durableEntryId: at as number }; mapping.push(entry); added.push(entry);
      }
      const binding: LegacyImportBinding = { schemaVersion: 3, importerVersion: 2, sourceHash, chatJid: leaf.chatJid, chatIncarnation: leaf.incarnation,
        branchId: leaf.branchId, sourceSessionId, sourceLeafId: leaf.id, engineConversationId: id, originalEntries: chain as JsonValue[], entries: mapping };
      (await tx.doc(LegacyImportManifest, id)).binding = binding;
      return { binding, added };
    }, context);
    for (const entry of result.added) locations.set(entry.sourceEntryId, { id: entry.durableEntryId as EntryId, conversationId: result.binding.engineConversationId as ConversationId });
    branches.push(result.binding);
  }
  const result: LegacyTreeImportBinding = { importerVersion: 2, sourceHash, sourceSessionId, originalEntries: records as JsonValue[],
    plannedBranches: leaves.map(leaf => ({ sourceLeafId: leaf.id, chatJid: leaf.chatJid, chatIncarnation: leaf.incarnation, branchId: leaf.branchId, hostBaseline: baseline })),
    branches, entries: [...locations].map(([sourceEntryId, location]) => ({ sourceEntryId, durableEntryId: location.id as number })) };
  await root.commit(async tx => { (await tx.doc(LegacyTreeImportManifest, root.id)).binding = result; }, context);
  return result;
}
