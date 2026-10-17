// INACTIVE host-only composition. No default registration or legacy dispatch.
import { hashCanonicalRequest, type CanonicalJsonValue } from '../service-effects/contracts/common.js';
import type { CurrentPiclawServiceWorkStore } from '../service-effects/current-piclaw/service-work-store.js';
import type { createDurableConversationAdapter, DurableConversationOperation } from './durable-runtime-adapter.js';
import type { QueuedInputMaterialization } from '../channels/web/messaging/message-store.js';
import type { InteractionRow } from '../db.js';
import type { QueuedFollowupItem } from '../queued-followups.js';

export interface AcceptedQueuedSteering {
  accept(rowId: number): Promise<{ interaction: InteractionRow; dispatch(): Promise<void> }>;
}

/** The materializer must run the actual message-store transaction with this SQL-only
 * callback and consumeDeferredFollowupRowId. No precommit receipt may escape it. */
export function createDurableQueuedSteering(options: {
  work: CurrentPiclawServiceWorkStore;
  adapter: ReturnType<typeof createDurableConversationAdapter>;
  chatJid: string;
  branchId: string;
  assertCurrentWriter(): void;
  runningBinding: Readonly<{ sessionId: string; lane: string; watchGeneration: number }>;
  readQueued(rowId: number): QueuedFollowupItem | undefined;
  materialize(item: QueuedFollowupItem, accept: QueuedInputMaterialization): InteractionRow | null;
  /** Verify the original accepted immutable input digest, not just current queue bytes. */
  validatePayload: QueuedInputMaterialization;
  /** Host controller owns retry/settlement and must retain this committed identity on uncertainty. */
  onPendingIntent?(input: DurableConversationOperation): void;
}): AcceptedQueuedSteering {
  const { work, chatJid, branchId, adapter } = options;
  const assert = options.assertCurrentWriter.bind(options), read = options.readQueued.bind(options);
  const materialize = options.materialize.bind(options), validate = options.validatePayload.bind(options);
  const submit = adapter.submitIntent.bind(adapter), supported = adapter.supportsIntent;
  const pending = options.onPendingIntent?.bind(options);
  const validateIntent = adapter.validateIntent.bind(adapter), binding = Object.freeze({ ...options.runningBinding });
  const frontierFor = work.getChatFrontier.bind(work), operationFor = work.getOperation.bind(work);
  const sourceFor = work.getAcceptedSource.bind(work), attach = work.attachQueuedSourceInTransaction.bind(work);
  return Object.freeze({ async accept(rowId: number) {
    assert();
    if (!supported) throw Error('Accepted steering unavailable');
    const frontier = await frontierFor(chatJid); assert();
    if (!frontier.ok || !frontier.value.activeOperationId) throw Error('No active host operation');
    const selected = await operationFor(frontier.value.activeOperationId); assert();
    if (!selected.ok || !selected.value?.harness || selected.value.harness.state !== 'running')
      throw Error('No running host binding');
    // Snapshot all authority before materialization; attachment repeats the full SQL CAS.
    const target = structuredClone(selected.value);
    if (target.harness!.sessionId !== binding.sessionId || target.harness!.lane !== binding.lane ||
      target.harness!.watchGeneration !== binding.watchGeneration || !target.harness!.harnessOperationId)
      throw Error('Host harness binding conflict');
    const item = read(rowId);
    if (!item?.source_accepted || !item.source_id) throw Error('Accepted queue item unavailable');
    const expected = structuredClone(item);
    let accepted: DurableConversationOperation | undefined;
    const interaction = materialize(expected, stored => {
      assert();
      if (stored.database !== work.database || !stored.database.inTransaction || stored.chatJid !== chatJid ||
        stored.item.rowId !== rowId || JSON.stringify(stored.item) !== JSON.stringify(expected) ||
        stored.message.id !== expected.source_id) throw Error('Accepted queue identity conflict');
      const result: unknown = validate(stored);
      if (result !== undefined) throw Error('Payload validation must be synchronous');
      const source = sourceFor(chatJid, stored.item.source_id);
      const hash = stored.database.query('SELECT source_hash FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?')
        .get(chatJid, stored.item.source_id) as { source_hash: string } | null;
      if (!source || !hash) throw Error('Missing accepted source');
      const request = { effect: { idempotencyKey: `queued-steer:${source.sourceId}`, requestHash: '',
        operationId: target.operationId, sourceSeq: source.sourceSeq, provenanceRef: source.provenanceRef,
        redactionClass: 'private' as const }, chatJid, sourceId: source.sourceId, sourceHash: hash.source_hash,
        payloadRef: source.payloadRef, expectedVersion: target.version, expectedHarness: target.harness!, createdAt: source.acceptedAt };
      request.effect.requestHash = hashCanonicalRequest({ method: 'attachQueuedSource.v1', ...request } as unknown as CanonicalJsonValue);
      const operation = attach(request, stored.database);
      const claimed = sourceFor(chatJid, source.sourceId)!;
      accepted = { claimed: { source: claimed, operation }, branchId,
        requestId: `queued-steer:${source.sourceId}`, content: stored.message.content };
      validateIntent(accepted);
      assert();
    });
    if (!interaction || !accepted) throw Error('Accepted steering materialization failed');
    const workInput = structuredClone(accepted);
    return { interaction, async dispatch() {
      // A lost ACK is uncertain. Never restore the consumed queue row or call legacy.
      try { assert(); await submit(workInput); assert(); }
      catch { pending?.(structuredClone(workInput)); }
    } };
  } });
}
