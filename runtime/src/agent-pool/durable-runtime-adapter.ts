// Explicit native application seam. No engine imports, implicit registration or AgentSession emulation.
import { hashCanonicalRequest } from "../service-effects/contracts/common.js";
import type { AcceptCancellationRequest, ClaimedOperation, OperationSnapshot } from "../service-effects/contracts/service-work-store.js";
import type { TerminalCommit } from "../service-effects/contracts/terminal-settlement-store.js";

/** Data-only subset of the durable package's public AcceptedInput contract. */
export interface DurableAcceptedInput {
  readonly incarnation: string;
  readonly conversationId: number;
  readonly chatJid: string;
  readonly branchId: string;
  readonly operationId: string;
  readonly sourceSeq: number;
  readonly sourceId: string;
  readonly payloadRef: string;
  readonly requestId: string;
  readonly requestHash: string;
}

/** Explicit internal binding for the existing application session-position reader. */
export interface DurableSessionMetadata {
  backend: "durable";
  conversationId: number;
  extensions: string[];
  tools: { name: string; description: string }[];
}

export interface DurableSessionState {
  readonly position: string | null;
  readonly model: string | null;
  readonly thinkingLevel: string | null;
}

export interface DurableSessionReport {
  readonly activeEntries: number;
  readonly userMessages: number;
  readonly assistantMessages: number;
  readonly contextWindow: number | null;
  /** Last committed assistant usage, not a prediction of the next request. */
  readonly observedTokens: number | null;
  readonly observedModel: string | null;
  readonly lastAnswer: string | null;
  readonly usage: { readonly input: number; readonly output: number; readonly cacheRead: number; readonly cacheWrite: number; readonly cost: number };
}

/** Current active model context, using the SDK usage-plus-trailing estimate.
 * Never cumulative conversation spend or a legacy stored counter.
 */
export interface DurableContextUsage {
  readonly tokens: number | null;
  readonly contextWindow: number | null;
}

export interface DurableAbortScope {
  readonly operationId: string;
  readonly conversationId: number;
  readonly sourceSeq: number;
}

export interface DurableSessionPositionPort {
  readonly readContextUsage?: () => Promise<DurableContextUsage>;
  readonly readMetadata?: () => Promise<DurableSessionMetadata>;
  readonly readReport?: () => Promise<DurableSessionReport>;
  readonly sessionId: string;
  readonly branchId: string;
  readonly readState?: () => Promise<DurableSessionState>;
  readonly readPosition: () => Promise<string | null>;
  /** Host-owned scope for credential controls; never an SDK session or input admission. */
  readonly assertCurrent?: () => void;
  readonly lifetimeSignal?: AbortSignal;
  readonly runOwnedControl?: <T>(operation: () => Promise<T>) => Promise<T>;
  /** Persisted conversation choice only; never infer a model from provider responses. */
  readonly readModel?: () => Promise<string | null>;
  readonly readThinkingLevel?: () => Promise<string | null>;
  readonly setThinkingLevel?: (level: string) => Promise<void>;
  readonly setModel?: (model: { provider: string; modelId: string }) => Promise<void>;
  readonly reset?: () => Promise<void>;
  /** Capture the operator target before touching the SDK; retries cannot cancel a successor. */
  readonly readAbortScope?: () => Promise<DurableAbortScope | null>;
  readonly abort?: (expected?: DurableAbortScope) => Promise<boolean>;
  readonly abortRetry?: (expected?: DurableAbortScope) => Promise<boolean>;
  readonly restart?: () => Promise<void>;
  readonly runBash?: (command: string) => Promise<{output: string; exitCode: number | null; cancelled: boolean}>;
  readonly abortBash?: () => Promise<boolean>;
  readonly readExecutionPolicy?: () => Promise<{autoCompact: boolean; autoRetry: boolean}>;
  readonly setExecutionPolicy?: (name: "autoCompact" | "autoRetry", enabled: boolean) => Promise<void>;
  /** Direct user shutdown, guarded by current host ownership and global idle. */
  readonly requestExit?: (reason: string) => Promise<void>;
  readonly compact?: (instructions?: string) => Promise<{ compacted: boolean }>;
  /** Observe the same owned maintenance; never admit a new compaction. */
  readonly reconcileMaintenance?: () => Promise<void>;
  readonly readTree?: () => Promise<import("../agent-control/session-tree-snapshot.js").SessionTreeSnapshot>;
}

export interface DurableConversationBinding {
  readonly chatJid: string;
  readonly branchId: string;
  readonly conversationId: number;
}

/** Already accepted/claimed host work, not a prompt or an admission request. */
export interface DurableConversationOperation {
  readonly claimed: ClaimedOperation;
  readonly branchId: string;
  readonly requestId: string;
  /** Used only to hash the existing payload; the engine resolves and verifies payloadRef itself. */
  readonly content: string;
}

export interface DurableConversationState {
  readonly operation: OperationSnapshot;
  readonly submissionId: number | null;
  readonly status: { readonly type: string; readonly status: string } | null;
}

/** Structurally satisfied by the public HostConversationRuntime. Construction stays with the
 * caller: owner, EF-S01/02, SQL bindings, manifest, storage, policy and private 1.3 context/models
 * must already be configured there. No 1.2 Models, SDK session or context crosses this port.
 * Reconciliation deliberately does not expose the engine's private answer/thinking evidence. */
export interface DurableConversationRuntimePort {
  readSessionState?(binding: DurableConversationBinding & { readonly incarnation: string }): Promise<DurableSessionState>;
  readSessionContextUsage?(binding: DurableConversationBinding & { readonly incarnation: string }): Promise<DurableContextUsage>;
  resetSession?(binding: DurableConversationBinding & { readonly incarnation: string }): Promise<void>;
  compactSession?(binding: DurableConversationBinding & { readonly incarnation: string }, instructions?: string): Promise<{ compacted: boolean }>;
  reconcileMaintenance?(binding: DurableConversationBinding & { readonly incarnation: string }): Promise<void>;
  readSessionMetadata?(binding: DurableConversationBinding & { readonly incarnation: string }): Promise<DurableSessionMetadata>;
  readSessionReport?(binding: DurableConversationBinding & { readonly incarnation: string }): Promise<DurableSessionReport>;
  readSessionTree?(binding: DurableConversationBinding & { readonly incarnation: string }): Promise<import("../agent-control/session-tree-snapshot.js").SessionTreeSnapshot>;
  setSessionThinkingLevel?(binding: { incarnation: string; chatJid: string; branchId: string; conversationId: number }, level: string): Promise<void>;
  setSessionModel?(binding: DurableConversationBinding & { readonly incarnation: string }, model: { provider: string; modelId: string }): Promise<void>;
  submit(input: DurableAcceptedInput): Promise<number>;
  submitIntent?(input: DurableAcceptedInput): Promise<number>;
  reconcile(input: DurableAcceptedInput): Promise<DurableConversationState>;
  cancel(input: DurableAcceptedInput, submissionId: number, request: AcceptCancellationRequest): Promise<"aborted" | "already_placed" | "settled" | "not_found">;
  resume(input: DurableAcceptedInput, submissionId: number): Promise<void>;
  wait?(input: DurableAcceptedInput, submissionId: number, signal?: AbortSignal): Promise<void>;
  settle(input: DurableAcceptedInput): Promise<TerminalCommit | null>;
  close(): Promise<void>;
}

/** Map existing host work to one explicitly opened authority domain. The supplied manifest must
 * be the same validated import manifest used to open the runtime; no root conversation is created.
 * This does not admit work, queue/poll, grant scheduling, publish output or select an engine.
 * All durable authority and replay/version checks remain in the runtime's host effects.
 * close delegates store cleanup/owner release to that runtime, never releases ownership itself. */
export function createDurableConversationAdapter(options: {
  readonly incarnation: string;
  readonly manifest: readonly DurableConversationBinding[];
  readonly getConversationBinding?: (chat: string, branch: string) => DurableConversationBinding | undefined;
  readonly runtime: DurableConversationRuntimePort;
}) {
  const { incarnation, runtime } = options;
  if (!incarnation || !options.manifest.length) throw new Error("Explicit durable identity and manifest required");
  const manifest = options.manifest.map(({ chatJid, branchId, conversationId }) => {
    if (!chatJid || !branchId || !Number.isSafeInteger(conversationId) || conversationId <= 0)
      throw new Error("Invalid durable conversation binding");
    return Object.freeze({ chatJid, branchId, conversationId });
  });
  if (manifest.some((binding, index) => manifest.slice(0, index).some(prior =>
    prior.chatJid === binding.chatJid && prior.branchId === binding.branchId)))
    throw new Error("Ambiguous durable conversation binding");

  const lookup = options.getConversationBinding?.bind(options) ?? ((chat: string, branch: string) => manifest.find(b => b.chatJid === chat && b.branchId === branch));
  // Capture receivers: later replacement of caller properties cannot redirect this adapter.
  const submit = runtime.submit.bind(runtime), reconcile = runtime.reconcile.bind(runtime);
  const cancel = runtime.cancel.bind(runtime), resume = runtime.resume.bind(runtime);
  const settle = runtime.settle.bind(runtime), close = runtime.close.bind(runtime);
  const wait = runtime.wait?.bind(runtime), submitIntent = runtime.submitIntent?.bind(runtime);
  const readState = runtime.readSessionState?.bind(runtime);
  const readContextUsage = runtime.readSessionContextUsage?.bind(runtime);
  const setThinkingLevel = runtime.setSessionThinkingLevel?.bind(runtime);
  const setModel = runtime.setSessionModel?.bind(runtime);
  const reset = runtime.resetSession?.bind(runtime);
  const compact = runtime.compactSession?.bind(runtime);
  const reconcileMaintenance = runtime.reconcileMaintenance?.bind(runtime);
  const readTree = runtime.readSessionTree?.bind(runtime);
  const readMetadata = runtime.readSessionMetadata?.bind(runtime);
  const readReport = runtime.readSessionReport?.bind(runtime);
  function input(work: DurableConversationOperation, intent = false): DurableAcceptedInput {
    const { source, operation } = work.claimed;
    const binding = lookup(source.chatJid, work.branchId);
    if (!binding) throw new Error("Unknown durable conversation binding");
    if (!["message", "scheduled_agent"].includes(source.kind) ||
      !["claimed", "consumed"].includes(source.state) || operation.chatJid !== source.chatJid ||
      (intent ? operation.primarySourceSeq === source.sourceSeq : operation.primarySourceSeq !== source.sourceSeq) ||
      !operation.claimedSourceSeqs.includes(source.sourceSeq))
      throw new Error("Expected claimed primary durable input");
    if (!work.requestId || work.requestId.length > 1024 || typeof work.content !== "string")
      throw new Error("Invalid durable request");
    return Object.freeze({ incarnation, conversationId: binding.conversationId, chatJid: source.chatJid,
      branchId: binding.branchId, operationId: operation.operationId, sourceSeq: source.sourceSeq,
      sourceId: source.sourceId, payloadRef: source.payloadRef, requestId: work.requestId,
      requestHash: hashCanonicalRequest({ type: "input", requestId: work.requestId, content: work.content }) });
  }
  return Object.freeze({
    sessionPosition(chatJid: string, branchId: string, sessionId: string): DurableSessionPositionPort {
      const binding = lookup(chatJid, branchId);
      if (!binding || !sessionId || !readState) throw new Error("Durable session position unavailable");
      const target = Object.freeze({ incarnation, chatJid: binding.chatJid, branchId: binding.branchId, conversationId: binding.conversationId });
      return Object.freeze({ sessionId, branchId,
        readState: () => readState(target),
        readContextUsage: readContextUsage ? () => readContextUsage(target) : undefined,
        readPosition: async () => (await readState(target)).position,
        readModel: async () => (await readState(target)).model,
        readThinkingLevel: async () => (await readState(target)).thinkingLevel,
        setThinkingLevel: setThinkingLevel ? (level: string) => setThinkingLevel(target, level) : undefined,
        setModel: setModel ? (model: { provider: string; modelId: string }) => setModel(target, { provider: model.provider, modelId: model.modelId }) : undefined,
        reset: reset ? () => reset(target) : undefined,
        compact: compact ? (instructions?: string) => compact(target, instructions) : undefined,
        reconcileMaintenance: reconcileMaintenance ? () => reconcileMaintenance(target) : undefined,
        readTree: readTree ? () => readTree(target) : undefined,
        readMetadata: readMetadata ? () => readMetadata(target) : undefined,
        readReport: readReport ? () => readReport(target) : undefined });
    },
    supportsIntent: !!submitIntent,
    validateIntent(work: DurableConversationOperation) { input(work, true); },
    async submitIntent(work: DurableConversationOperation) {
      if (!submitIntent) throw new Error("Durable intent unsupported");
      return submitIntent(input(work, true));
    },
    async submit(work: DurableConversationOperation) { return submit(input(work)); },
    async reconcile(work: DurableConversationOperation): Promise<DurableConversationState> {
      const state = await reconcile(input(work));
      // Project the reviewed root contract, not the engine's raw private answer object.
      return { operation: state.operation, submissionId: state.submissionId,
        status: state.status === null ? null : { type: state.status.type, status: state.status.status } };
    },
    async cancel(work: DurableConversationOperation, submissionId: number, request: AcceptCancellationRequest) {
      return cancel(input(work), submissionId, request);
    },
    async resume(work: DurableConversationOperation, submissionId: number) { return resume(input(work), submissionId); },
    async wait(work: DurableConversationOperation, submissionId: number, signal?: AbortSignal) {
      if (!wait) throw new Error("Durable wait unsupported");
      await wait(input(work), submissionId, signal);
    },
    async settle(work: DurableConversationOperation) { return settle(input(work)); },
    close,
  });
}
