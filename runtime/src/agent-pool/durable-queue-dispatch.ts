// INACTIVE host-only composition. No registration, schema initialization or engine dependency.
import { hashCanonicalRequest, type CanonicalJsonValue } from "../service-effects/contracts/common.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("durable.queue-dispatch");
function matchesPayloadRef(ref: string, messageId: string, rowId: number): boolean {
  return ref === `message-row:${rowId}` || (/^source-[0-9a-f-]{36}$/i.test(messageId) && ref === `queued-source:${messageId}`);
}
import type { CurrentPiclawServiceWorkStore } from "../service-effects/current-piclaw/service-work-store.js";
import type { createDurableConversationAdapter } from "./durable-runtime-adapter.js";

export interface PendingInputIdentity { readonly chatJid: string; readonly messageId: string; readonly rowId: number }
export type AcceptedQueueDispatch = {
  (chatJid: string, messageId: string, rowId: number): (() => Promise<"settled" | "pending">) | undefined;
  waitForPending(identity: PendingInputIdentity): Promise<"settled" | "pending">;
};

/** Ordinary accepted messages only. The same SQL owner/writer fence must be supplied to
 * admission, bindings and EF terminal commit. Unsupported routes must not use admission.
 * A pending result retains the worker lane and its existing inflight recovery marker. */
export function createDurableQueueDispatch(options: {
  work: CurrentPiclawServiceWorkStore;
  adapter: ReturnType<typeof createDurableConversationAdapter>;
  branchId: string | ((chatJid: string) => string);
  assertCurrentWriter(): void;
  /** Explicit host-owned runtime correlation; never inferred from input content. */
  runningCorrelation?(submissionId: number): import('../service-effects/contracts/service-work-store.js').HarnessCorrelation;
  /** Host outcome event/barrier, not an HTTP result or a scheduling grant. Subscribe without
   * losing already committed outcomes. Resolution only requests a fresh fenced SQL read. */
  waitForReconciliation(identity: PendingInputIdentity, signal: AbortSignal): Promise<void>;
  shutdown: AbortSignal;
}): AcceptedQueueDispatch {
  const { work, adapter, branchId: route } = options;
  const branchFor = typeof route === "function" ? route.bind(options) : () => route;
  const assert = options.assertCurrentWriter.bind(options);
  const submit = adapter.submit.bind(adapter), wait = adapter.wait.bind(adapter), settle = adapter.settle.bind(adapter);
  const sourceFor = work.getAcceptedSource.bind(work), frontierFor = work.getChatFrontier.bind(work);
  const claim = work.claimNext.bind(work), operationFor = work.getOperation.bind(work);
  const event = options.waitForReconciliation.bind(options), shutdown = options.shutdown;
  const correlation = options.runningCorrelation?.bind(options), bind = work.bindHarness.bind(work);
  const dispatch: AcceptedQueueDispatch = (chatJid, messageId, rowId) => {
    assert();
    const source = sourceFor(chatJid, messageId);
    if (!source) return undefined;
    // Read actual committed bytes, never the HTTP body or formatted legacy prompt.
    const message = work.database.query("SELECT id, chat_jid, content FROM messages WHERE rowid = ?").get(rowId) as
      { id: string; chat_jid: string; content: string } | null;
    if (!message || message.id !== messageId || message.chat_jid !== chatJid || source.kind !== "message" ||
      !matchesPayloadRef(source.payloadRef, messageId, rowId)) throw new Error("Accepted queue identity conflict");
    const branchId = branchFor(chatJid);
    const content = message.content, requestId = `message:${rowId}:${source.sourceId}`;
    const requestHash = hashCanonicalRequest({ type: "input", requestId, content });
    return async () => {
      try {
        assert();
        const frontier = await frontierFor(chatJid); assert();
        if (!frontier.ok) return "pending";
        const operationId = `message:${rowId}:${source.sourceSeq}`;
        const existing = await operationFor(operationId); assert();
        if (!existing.ok) return "pending";
        let operation = existing.value;
        if (!operation) {
          if (frontier.value.activeOperationId || frontier.value.nextPendingSourceSeq !== source.sourceSeq) return "pending";
          const input = { effect: { idempotencyKey: `claim:${operationId}`, requestHash: "", operationId: null,
            sourceSeq: source.sourceSeq, provenanceRef: source.provenanceRef, redactionClass: "private" as const },
            chatJid, expectedFrontier: frontier.value.consumedThroughSourceSeq, newOperationId: operationId,
            claimedAt: source.acceptedAt };
          input.effect.requestHash = hashCanonicalRequest(input as unknown as CanonicalJsonValue);
          const claimed = await claim(input); assert();
          if (!claimed.ok || !claimed.value) return "pending";
          operation = claimed.value.operation;
        }
        const currentSource = sourceFor(chatJid, messageId);
        if (!currentSource || currentSource.sourceSeq !== source.sourceSeq || operation.chatJid !== chatJid ||
          operation.primarySourceSeq !== source.sourceSeq || hashCanonicalRequest({ type: "input", requestId,
            content: (work.database.query("SELECT content FROM messages WHERE rowid = ?").get(rowId) as { content: string })?.content }) !== requestHash)
          return "pending";
        const accepted = { claimed: { source: currentSource, operation }, branchId, requestId, content };
        const id = await submit(accepted); assert();
        if (correlation && !operation.harness) {
          const harness = structuredClone(correlation(id));
          if (harness.state !== 'running' || harness.harnessOperationId !== String(id)) return 'pending';
          const request = { effect: { idempotencyKey: `running:${operationId}:${id}`, requestHash: '', operationId,
            sourceSeq: source.sourceSeq, provenanceRef: source.provenanceRef, redactionClass: 'private' as const },
            expectedVersion: operation.version, ...harness };
          request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
          const bound = await bind(request); assert();
          if (!bound.ok) return 'pending';
        }
        await wait(accepted, id, shutdown); assert();
        if (shutdown.aborted) return "pending";
        return await settle(accepted) ? "settled" : "pending";
      } catch {
        // Lost acknowledgements and failed waits are uncertain, never permission for legacy replay.
        return "pending";
      }
    };
  };
  dispatch.waitForPending = async identity => {
    const { chatJid, messageId, rowId } = identity;
    while (!shutdown.aborted) {
      // Subscribe BEFORE the SQL read: a terminal commit between read and registration
      // must not strand the existing worker. Recheck SQL even for an earlier missed event.
      const observation = new AbortController();
      const signal = AbortSignal.any([shutdown, observation.signal]);
      const released = new Promise<boolean>(resolve => {
        const abort = () => { signal.removeEventListener("abort", abort); resolve(false); };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) { abort(); return; }
        try {
          void event(identity, signal).then(() => {
            signal.removeEventListener("abort", abort); resolve(true);
          }, () => {
            log.warn("Accepted input reconciliation event unavailable; awaiting shutdown", {
              operation: "durable_queue.reconciliation_event_unavailable",
            });
          });
        } catch {
          log.warn("Accepted input reconciliation subscription unavailable; awaiting shutdown", {
            operation: "durable_queue.reconciliation_subscription_unavailable",
          });
        }
      });
      try {
        assert();
        const source = sourceFor(chatJid, messageId);
        const message = work.database.query('SELECT id, chat_jid FROM messages WHERE rowid = ?').get(rowId) as { id: string; chat_jid: string } | null;
        if (source?.kind === "message" && message?.id === messageId && message.chat_jid === chatJid && matchesPayloadRef(source.payloadRef, messageId, rowId)) {
          const operation = await operationFor(`message:${rowId}:${source.sourceSeq}`); assert();
          const frontier = await frontierFor(chatJid); assert();
          const current = sourceFor(chatJid, messageId);
          if (!shutdown.aborted && operation.ok && operation.value?.terminal && operation.value.version > 1 &&
            operation.value.chatJid === chatJid && operation.value.primarySourceSeq === source.sourceSeq &&
            operation.value.claimedSourceSeqs.includes(source.sourceSeq) && current?.sourceSeq === source.sourceSeq &&
            ["consumed", "disposed"].includes(current.state) && frontier.ok &&
            frontier.value.consumedThroughSourceSeq >= source.sourceSeq) {
            observation.abort();
            return "settled";
          }
        }
      } catch {
        log.warn("Accepted input observation unavailable; retaining pending ownership", {
          operation: "durable_queue.pending_observation_unavailable",
        });
      }
      const woke = await released;
      observation.abort();
      if (!woke || shutdown.aborted) return "pending";
    }
    return "pending";
  };
  return dispatch;
}
