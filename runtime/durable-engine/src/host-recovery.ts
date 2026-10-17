// INACTIVE, passive reconstitution only. No scheduling grant, queue, storage open or registration.
import type { ConversationId } from "@earendil-works/pi-durable";
import type { CurrentPiclawServiceWorkStore } from "../../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import type { AcceptedSourceSnapshot } from "../../../runtime/src/service-effects/contracts/service-work-store.js";
import type { DurableConversationOperation } from "../../../runtime/src/agent-pool/durable-runtime-adapter.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../../runtime/src/service-effects/contracts/common.js";
import { inputSnapshot, type AcceptedInput, type HostInputBinding } from "./host-runtime.js";
import type { createHostDurableBindings } from "./host-bindings.js";

/** One already imported conversation. Call under exclusive ownership with the runtime paused.
 * The reader MUST load actual persisted message bytes and validate accepted payload references;
 * it is not a caller-supplied recovery snapshot. Missing primary bindings fail closed: request
 * identities cannot be invented from a source sequence. Attached, not-yet-bound queued inputs
 * retain the existing coordinator's immutable queued-steer identity.
 *
 * This is deliberately NOT a recovery controller or permission to resume. The caller still
 * must reconcile public candidate evidence and authorize the entire live authority domain.
 */
export async function reconstituteAcceptedWork(options: {
  incarnation: string;
  binding: Readonly<{ chatJid: string; branchId: string; conversationId: ConversationId }>;
  runningBinding: Readonly<{ sessionId: string; lane: string; watchGeneration: number }>;
  assertOwner(): void;
  work: Pick<CurrentPiclawServiceWorkStore, "listOpenOperations" | "getOperation" | "getSourceBySeq" | "getQueuedInputIntent">;
  bindings: Omit<ReturnType<typeof createHostDurableBindings>, "resolveConversation"> & Partial<Pick<ReturnType<typeof createHostDurableBindings>, "resolveConversation">>;
  readAcceptedInput(source: AcceptedSourceSnapshot): Promise<DurableConversationOperation>;
}): Promise<readonly Readonly<{ role: "primary" | "intent"; input: AcceptedInput; binding: HostInputBinding | null; work: DurableConversationOperation }>[]> {
  const incarnation = options.incarnation, scope = Object.freeze({ ...options.binding });
  const running = Object.freeze({ ...options.runningBinding });
  const assert = options.assertOwner.bind(options), read = options.readAcceptedInput.bind(options);
  const list = options.work.listOpenOperations.bind(options.work), operationFor = options.work.getOperation.bind(options.work);
  const sourceFor = options.work.getSourceBySeq.bind(options.work), find = options.bindings.findSource.bind(options.bindings);
  const queuedIntent = options.work.getQueuedInputIntent.bind(options.work);
  const proofs = new Map<string, NonNullable<ReturnType<typeof queuedIntent>>>();
  const primaryGet = options.bindings.get.bind(options.bindings), intentGet = options.bindings.intents!.get.bind(options.bindings.intents);
  const digest = (value: unknown) => hashCanonicalRequest(value as CanonicalJsonValue);
  const deny = () => { throw new Error("Unverified recovered authority"); };
  assert();
  inputSnapshot({ incarnation, ...scope, operationId: "validate", sourceSeq: 1, sourceId: "validate",
    payloadRef: "validate", requestId: "validate", requestHash: "0".repeat(64) });
  const recovered: Readonly<{ role: "primary" | "intent"; input: AcceptedInput; binding: HostInputBinding | null; work: DurableConversationOperation }>[] = [];
  let afterOperationId: string | undefined;
  for (;;) {
    const page = await list({ chatJid: scope.chatJid, limit: 100, afterOperationId }); assert();
    if (!page.ok) return deny();
    for (const original of page.value) {
      const operation = structuredClone(original);
      if (operation.chatJid !== scope.chatJid || operation.terminal ||
        !operation.claimedSourceSeqs.includes(operation.primarySourceSeq) ||
        new Set(operation.claimedSourceSeqs).size !== operation.claimedSourceSeqs.length) return deny();
      const h = operation.harness;
      if (h && (h.sessionId !== running.sessionId || h.lane !== running.lane ||
        h.watchGeneration !== running.watchGeneration || !h.harnessOperationId)) return deny();
      for (const seq of operation.claimedSourceSeqs) {
        const source = sourceFor(scope.chatJid, seq); assert();
        const role = seq === operation.primarySourceSeq ? "primary" : "intent";
        if (!source || !["claimed", "consumed"].includes(source.state) || (source.kind !== "message" && !(role === "primary" && source.kind === "scheduled_agent")) ||
          (role === "intent" && (!h || source.targetOperationId !== operation.operationId ||
            source.payloadRef !== `queued-source:${source.sourceId}`))) return deny();
        const proof = role === "intent" ? queuedIntent(operation.operationId, source) : null;
        if (role === "intent" && !proof) return deny();
        if (proof) proofs.set(proof.intentId, proof);
        const sourceCopy = Object.freeze(structuredClone(source));
        const stored = await find(scope.chatJid, seq); assert();
        if (role === "primary" && !stored) return deny();
        const loaded = structuredClone(await read(sourceCopy)); assert();
        if (digest(loaded.claimed.source) !== digest(sourceCopy) || digest(loaded.claimed.operation) !== digest(operation) ||
          loaded.branchId !== scope.branchId || typeof loaded.content !== "string") return deny();
        const requestId = stored?.requestId ?? proof!.intentId;
        if (loaded.requestId !== requestId || (role === "intent" && requestId !== proof!.intentId)) return deny();
        const scheduledId = source.kind === "scheduled_agent" && stored && options.bindings.resolveConversation?.(stored);
        if (source.kind === "scheduled_agent" && !scheduledId) return deny();
        const input = inputSnapshot({ incarnation, ...scope, ...(scheduledId ? { conversationId: scheduledId } : {}), operationId: operation.operationId,
          sourceSeq: seq, sourceId: source.sourceId, payloadRef: source.payloadRef, requestId,
          requestHash: hashCanonicalRequest({ type: "input", requestId, content: loaded.content }) });
        if (stored && (Object.entries(input).some(([key, value]) => stored[key as keyof AcceptedInput] !== value) ||
          !await (role === "primary" ? primaryGet(input) : intentGet(input)))) return deny();
        assert();
        recovered.push(Object.freeze({ role, input, binding: stored, work: loaded }));
      }
      const current = await operationFor(operation.operationId); assert();
      if (!current.ok || digest(current.value) !== digest(operation) || operation.claimedSourceSeqs.some(seq =>
        digest(sourceFor(scope.chatJid, seq)) !== digest(recovered.find(r => r.input.operationId === operation.operationId && r.input.sourceSeq === seq)!.work.claimed.source))) return deny();
    }
    if (page.value.length < 100) break;
    afterOperationId = page.value.at(-1)!.operationId;
  }
  // No awaits after this pass: later readers/binding lookups must not stale an earlier proof.
  for (const entry of recovered) {
    const source = sourceFor(scope.chatJid, entry.input.sourceSeq);
    if (!source || digest(source) !== digest(entry.work.claimed.source)) return deny();
    if (entry.role === "intent") {
      const proof = queuedIntent(entry.input.operationId, source);
      if (!proof || proof.intentId !== entry.input.requestId || digest(proof) !== digest(proofs.get(entry.input.requestId))) return deny();
    }
  }
  assert();
  return Object.freeze(recovered);
}
