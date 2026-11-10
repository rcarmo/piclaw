import type { Context } from '@earendil-works/chord/context';
import type { Storage, SubmissionId, ConversationId, Cursor } from '@earendil-works/pi-durable';
import type { InterruptedHarnessIdentity } from '../../src/service-effects/current-piclaw/scheduled-run-store.js';

/** Read committed public SDK records only. No Harness.open/resume, admissions,
 * cancellation or provider calls. The caller owns the storage/database lifetime.
 * Terminal receipts are immutable; the host fence and S07 identity/version/lease
 * are rechecked by the writer before changing the occurrence. */
export async function captureInterruptedScheduledHarness(storage: Storage, context: Context,
  identity: InterruptedHarnessIdentity, assertCurrent: () => void): Promise<() => void> {
  identity = Object.freeze({ ...identity });
  context.abortSignal?.throwIfAborted(); assertCurrent();
  const id = Number(identity.submissionId);
  if (!/^[1-9]\d*$/.test(identity.submissionId) || !Number.isSafeInteger(id)) throw Error('Invalid scheduled submission');
  const record = await storage.submission(id as SubmissionId, context); assertCurrent();
  const native=identity.operationId===`native-scheduled:${identity.runId}`;
  if (!record || record.id !== id || record.type !== 'input' || record.status !== 'unanswered' || (record.reason !== 'model_error' && !(native&&record.reason==='aborted')) ||
    record.requestId !== `scheduled:${identity.runId}` || record.entry === undefined) throw Error('Failed scheduled SDK receipt required');
  const placed = await storage.entry(record.conversationId, record.entry, context); assertCurrent();
  const data = placed?.entry.data as Record<string, unknown> | undefined;
  if (placed?.entry.kind !== 'host.accepted' || placed.entry.conversationId !== record.conversationId || data?.role !== 'primary' ||
    data.incarnation !== identity.sessionId || data.conversationId !== record.conversationId || data.chatJid !== identity.chatJid ||
    data.operationId !== identity.operationId || data.sourceSeq !== identity.sourceSeq || data.sourceId !== identity.runId ||
    data.requestId !== record.requestId) throw Error('Scheduled SDK source identity conflict');
  const pending = [record.conversationId], seen = new Set<ConversationId>();
  let failedGeneration = false, taskCount = 0;
  while (pending.length) {
    const conversationId = pending.pop()!;
    if (seen.has(conversationId) || seen.size >= 256) throw Error('Invalid scheduled ownership tree');
    seen.add(conversationId);
    let cursor: Cursor | undefined;
    do {
      const page = await storage.scanTasks({ conversationId }, 100, cursor, context); assertCurrent();
      for (const task of page.items) {
        if (task.conversationId !== conversationId || task.state.status !== 'terminal' || ++taskCount > 10000) throw Error('Scheduled SDK work is not terminal');
        if (conversationId === record.conversationId && task.kind === 'pi.generation' &&
          (record.reason==='aborted' ? task.state.outcome.status==='aborted' : task.state.outcome.status==='failed'&&task.state.outcome.error.message===record.detail)) failedGeneration = true;
      }
      cursor = page.next;
    } while (cursor);
    cursor = undefined;
    do {
      const page = await storage.scanSubmissions({ conversationId }, 100, cursor, context); assertCurrent();
      if (page.items.some(item => item.status === 'queued' || item.status === 'placed')) throw Error('Scheduled SDK input is unsettled');
      cursor = page.next;
    } while (cursor);
    cursor = undefined;
    do {
      const page = await storage.scanConversations({ ownerConversationId: conversationId }, 100, cursor, context); assertCurrent();
      for (const child of page.items) {
        if (child.owner?.conversationId !== conversationId) throw Error('Scheduled child ownership conflict');
        if (pending.length + seen.size >= 256) throw Error('Scheduled ownership tree exceeds limit');
        pending.push(child.id);
      }
      cursor = page.next;
    } while (cursor);
  }
  if (!failedGeneration) throw Error('Failed scheduled generation receipt required');
  assertCurrent();
  return () => { context.abortSignal?.throwIfAborted(); assertCurrent(); };
}
