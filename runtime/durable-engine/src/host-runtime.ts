// INACTIVE application module. No bootstrap registration or production schema migration.
import { configure, AgentDoc, AssistantEntry, InboxDoc, LiveDoc, Harness, type HarnessOptions, type HarnessInspection, type Storage, type ConversationId, type SubmissionId } from "@earendil-works/pi-durable";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { awaitWithContext, withAbortSignal, withoutAbortSignal, type Context } from "@earendil-works/chord/context";
import type { CurrentPiclawServiceWorkStore, FinishHarnessRequest } from "../../../runtime/src/service-effects/current-piclaw/service-work-store.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../../runtime/src/service-effects/contracts/common.js";
import type { ServiceWorkStore, AcceptCancellationRequest, OperationSnapshot } from "../../../runtime/src/service-effects/contracts/service-work-store.js";
import type { TerminalSettlementStore, CommitTerminalRequest } from "../../../runtime/src/service-effects/contracts/terminal-settlement-store.js";
import { value, sealed, effect } from "./host-effects.js";
import { LegacyImportManifest } from "./legacy-import.js";
import { projectPublicHistory } from "./session-tree.js";
import { buildSessionTreeSnapshot, type RootSessionTreeNode, type SessionTreeSnapshot } from "../../src/agent-control/session-tree-snapshot.js";

/** Immutable host-persisted intent; never supplied as arbitrary user text. */
export interface AcceptedInput {
  readonly incarnation: string;
  readonly conversationId: ConversationId;
  readonly chatJid: string;
  readonly branchId: string;
  readonly operationId: string;
  readonly sourceSeq: number;
  readonly sourceId: string;
  readonly payloadRef: string;
  readonly requestId: string;
  readonly requestHash: string;
}
export interface HostInputBinding extends AcceptedInput {
  readonly submissionId: SubmissionId | null;
}
export interface HostDurableBindings {
  /** Optional until the host explicitly supports accepted intents. */
  readonly intents?: HostDurableBindings & { list(input: AcceptedInput): Promise<readonly HostInputBinding[]> };
  /** Host EF-S01 synchronous effect-boundary guard; never queries SDK tables. */
  assertSourceCurrent?(input: AcceptedInput): void;
  get(input: AcceptedInput): Promise<HostInputBinding | null>;
  bind(input: AcceptedInput): Promise<HostInputBinding>;
  getOrBind(input: AcceptedInput): Promise<{ content: string }>;
  recordSubmission(input: AcceptedInput, submissionId: SubmissionId): Promise<void>;
}
/** Host-private evidence, never a public timeline payload (message may contain thinking). */
export interface SettledAnswer {
  readonly message: AssistantMessage;
  readonly text: string;
}
export interface MaterializedAnswer {
  readonly contentRef: string;
  readonly contentBlocksRef: string | null;
  readonly mediaIds: readonly number[];
}
export interface RuntimeOptions {
  readonly incarnation: string;
  /** Required for model SET: shared-file SQL guard, checked inside each storage transaction. */
  readonly withIdleModelGuard?: <T>(body: () => Promise<T>) => Promise<T>;
  /** Caller already holds exclusive ownership of this entire store, not a per-chat lease.
   * Adapters/models/tools must fence effects themselves, including EF-S02 inside its SQL commit. */
  readonly owner: { assert(): void; release(): void | Promise<void> };
  readonly openStorage: () => Promise<Storage>;
  readonly harnessOptions: HarnessOptions;
  readonly work: ServiceWorkStore & Partial<Pick<CurrentPiclawServiceWorkStore, "finishHarness">>;
  readonly terminal: TerminalSettlementStore;
  /** Host-owned durable mapping. Must atomically verify the accepted source, payload and immutable
   * operation/source/hash binding in the SAME host database. No Map-based admission/dedup.
   * Production implementation/migration is NOT activated by this module. */
  readonly bindings: HostDurableBindings;
  readonly conversationFor: (chatJid: string, branchId: string) => ConversationId;
  /** Trusted persisted scheduled-source route, never a caller-selected conversation. */
  readonly operationConversationFor?: (input: AcceptedInput) => ConversationId | undefined;
  /** All IDs must come from a caller-validated, quiescent import manifest. Never creates root. */
  readonly existingConversationIds: readonly ConversationId[];
  /** Harness scheduling is store-wide. Host must validate EVERY live task/submission's current
   * authority before explicit progress (including recovered work); deny mixed/unknown authority. */
  readonly authorizeScheduling: (inspection: HarnessInspection) => void | Promise<void>;
  readonly putAnswer: (ref: string, text: string) => void | Promise<void>;
  /** Optional host authority for ALL final answers, including operation-owned tool media.
   * Publish only authorized visible content, never raw message/thinking. Refs must resolve
   * through EF-S02's existing payload resolver with the effect's exact redaction class;
   * media must already be bound to this operation. No provider execution is granted here. */
  readonly materializeAnswer?: (ref: string, answer: SettledAnswer, operation: OperationSnapshot) => Promise<MaterializedAnswer>;
  readonly sessionId: string;
  readonly lane: string;
  readonly generation: number;
  readonly now: () => string;
}

// Copy only contract data, never serialize caller objects (or invoke toJSON).
function plainData(value: object) {
  if (!value || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    throw new TypeError("Expected plain contract data");
}
function freezeTree<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
function materializedSnapshot(answer: MaterializedAnswer): MaterializedAnswer {
  plainData(answer);
  const { contentRef, contentBlocksRef, mediaIds } = answer;
  const ids = Array.isArray(mediaIds) ? [...mediaIds] : null;
  const validRef = (ref: unknown) => typeof ref === "string" && ref.length > 0 && ref.length <= 2048;
  if (!validRef(contentRef) || (contentBlocksRef !== null && !validRef(contentBlocksRef)) ||
    !ids || ids.length > 100 ||
    ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
    throw new TypeError("Invalid materialized answer");
  return Object.freeze({ contentRef, contentBlocksRef, mediaIds: Object.freeze(ids) });
}
export function inputSnapshot(i: AcceptedInput): AcceptedInput {
  plainData(i);
  const copy = { incarnation: i.incarnation, conversationId: i.conversationId, chatJid: i.chatJid,
    branchId: i.branchId, operationId: i.operationId, sourceSeq: i.sourceSeq, sourceId: i.sourceId,
    payloadRef: i.payloadRef, requestId: i.requestId, requestHash: i.requestHash };
  for (const [key, value] of Object.entries(copy)) {
    if (key === "conversationId" || key === "sourceSeq") {
      if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError("Expected integer input identity");
    } else if (typeof value !== "string" || !value.length || value.length > (key === "requestId" ? 1024 : 2048)) throw new TypeError("Expected string input identity");
  }
  if (!/^[a-f0-9]{64}$/.test(copy.requestHash)) throw new TypeError("Invalid input hash");
  return Object.freeze(copy);
}
function cancellationSnapshot(r: AcceptCancellationRequest): AcceptCancellationRequest {
  plainData(r);
  const e = r.effect; plainData(e);
  const effect = { idempotencyKey: e.idempotencyKey, requestHash: e.requestHash, operationId: e.operationId,
    sourceSeq: e.sourceSeq, provenanceRef: e.provenanceRef, redactionClass: e.redactionClass };
  const copy = { effect: Object.freeze(effect), expectedVersion: r.expectedVersion, sourceId: r.sourceId,
    sourceSeq: r.sourceSeq, cause: r.cause, requestedAt: r.requestedAt };
  for (const [key, value] of [...Object.entries(effect), ...Object.entries(copy).filter(([key]) => key !== "effect")]) {
    if (key === "sourceSeq" || key === "expectedVersion") {
      if (!(key === "sourceSeq" && value === null) && !Number.isSafeInteger(value)) throw new TypeError("Expected integer cancellation identity");
    } else if (typeof value !== "string") throw new TypeError("Expected string cancellation identity");
  }
  return Object.freeze(copy);
}
// Private snapshot type cannot be confused with caller-owned RuntimeOptions.
type RuntimeSnapshot = Omit<RuntimeOptions, "work" | "terminal"> & {
  readonly captured: true;
  readonly work: Pick<ServiceWorkStore, "getOperation" | "acceptCancellation" | "bindHarness"> & Partial<Pick<CurrentPiclawServiceWorkStore, "finishHarness">>;
  readonly terminal: Pick<TerminalSettlementStore, "getTerminal" | "commitTerminal">;
};
function runtimeSnapshot(o: RuntimeOptions): RuntimeSnapshot {
  const { owner, work, terminal, bindings, harnessOptions: h, existingConversationIds,
    openStorage, conversationFor, authorizeScheduling, putAnswer, materializeAnswer, now, incarnation, sessionId, lane, generation } = o;
  return Object.freeze({ incarnation, sessionId, lane, generation, captured: true as const,
    withIdleModelGuard: o.withIdleModelGuard?.bind(o),
    openStorage: openStorage.bind(o), conversationFor: conversationFor.bind(o),
    operationConversationFor: o.operationConversationFor?.bind(o),
    authorizeScheduling: authorizeScheduling.bind(o), putAnswer: putAnswer.bind(o),
    materializeAnswer: materializeAnswer?.bind(o), now: now.bind(o),
    owner: Object.freeze({ assert: owner.assert.bind(owner), release: owner.release.bind(owner) }),
    work: Object.freeze({ getOperation: work.getOperation.bind(work), acceptCancellation: work.acceptCancellation.bind(work), bindHarness: work.bindHarness.bind(work), finishHarness: work.finishHarness?.bind(work) }),
    terminal: Object.freeze({ getTerminal: terminal.getTerminal.bind(terminal), commitTerminal: terminal.commitTerminal.bind(terminal) }),
    bindings: Object.freeze({ assertSourceCurrent: bindings.assertSourceCurrent?.bind(bindings),
      get: bindings.get.bind(bindings), bind: bindings.bind.bind(bindings),
      getOrBind: bindings.getOrBind.bind(bindings), recordSubmission: bindings.recordSubmission.bind(bindings),
      intents: bindings.intents && Object.freeze({ get: bindings.intents.get.bind(bindings.intents),
        bind: bindings.intents.bind.bind(bindings.intents), getOrBind: bindings.intents.getOrBind.bind(bindings.intents),
        recordSubmission: bindings.intents.recordSubmission.bind(bindings.intents), list: bindings.intents.list.bind(bindings.intents) }) }),
    existingConversationIds: [...existingConversationIds],
    // Catalogs and settings are intentionally live host APIs; detach their containing options only.
    harnessOptions: Object.freeze({ models: h.models, registry: h.registry, settings: h.settings,
      env: h.env?.bind(h), conversationCreated: h.conversationCreated?.bind(h), now: h.now?.bind(h), onReport: h.onReport?.bind(h) }),
  });
}

/** One caller-owned authority domain, not a global chat/user router. */
export class HostConversationRuntime {
  private closed = false;
  private changingModel = false;
  private authorizingMaintenance = false;
  private maintenance?: Promise<unknown>;
  private maintenanceTaskId?: number;
  private pendingMaintenance?: {
    binding: { incarnation: string; chatJid: string; branchId: string; conversationId: number };
    reconcile: () => Promise<void>;
    attempt?: Promise<void>;
  };
  private closing?: Promise<void>;
  // Lifecycle joins only: not an input queue or admission/dedup authority.
  private readonly active = new Set<Promise<unknown>>();
  // Observer detachment is not completion of an already-entered host callback.
  // Only rollback joins these; ordinary close must keep its detach semantics.
  private readonly underlyingWaits = new Set<Promise<unknown>>();
  private readonly observations = new AbortController();
  private observe<T>(body: () => Promise<T>, authorityRead = false): Promise<T> {
    this.fence();
    if (this.changingModel && !(authorityRead && this.authorizingMaintenance)) throw new Error("Runtime maintenance in progress");
    const promise = body();
    this.active.add(promise);
    void promise.finally(() => this.active.delete(promise)).catch(() => {});
    return promise;
  }
  private constructor(private readonly options: RuntimeSnapshot, private readonly harness: Harness,
    private readonly storage: Storage, private readonly context: Context) {}

  static async open(config: RuntimeOptions, context: Context): Promise<HostConversationRuntime> {
    const options = runtimeSnapshot(config);
    options.owner.assert(); // Before storage normalization/construction, including SQLite open recovery.
    if (!options.incarnation || !Number.isSafeInteger(options.generation) || options.generation < 1 || !options.existingConversationIds.length)
      throw new Error("Explicit store identity, generation and existing manifest required");
    const storage = await options.openStorage();
    let harness: Harness | undefined;
    try {
      options.owner.assert();
      harness = await Harness.open(storage, options.harnessOptions, context);
      options.owner.assert();
      for (const id of options.existingConversationIds) {
        if (!await harness.conversation(id, context)) throw new Error("Missing manifest conversation");
        options.owner.assert();
      }
      return new HostConversationRuntime(options, harness, storage, context);
    } catch (error) {
      // Failed/uncertain cleanup never releases ownership.
      if (harness) await harness.close(context); else await storage.close(context);
      throw error;
    }
  }
  /** Backend-owned public commit; publish only after storage accepts the whole transaction. */
  addConversation<T extends { conversationId: ConversationId }>(create: (tx: import("@earendil-works/pi-durable").Tx) => Promise<T>, beforeCommit?: () => void): Promise<T> {
    return this.observe(async () => {
      const root = await this.harness.conversation(1 as ConversationId, this.context); this.fence();
      if (!root) throw Error("Missing application root");
      beforeCommit?.();
      const binding = await root.commit(async tx => { this.fence(); const result = await create(tx); this.fence(); return result; }, this.context);
      this.fence();
      (this.options.existingConversationIds as ConversationId[]).push(binding.conversationId);
      return binding;
    });
  }
  /** Allocation only; EF-S07 continues to own execution, result and recurrence. */
  allocateScheduledFork(parentId: ConversationId, allocated: (id: ConversationId) => void): Promise<ConversationId> {
    return this.observe(() => this.harness.commit(async tx => {
      this.fence();
      if (!this.options.existingConversationIds.includes(parentId)) throw Error("Unknown scheduled root");
      const page = await tx.scanEntries({ conversationId: parentId, order: "descending" }, 1);
      const head = page.items[0];
      const fork = head ? await tx.forkConversation(parentId, head.id, { ownership: { kind: "ownerless" } })
        : await tx.createConversation({ ownership: { kind: "ownerless" } });
      // Empty roots have no public fork point. Copy only configuration, never fabricate an entry.
      const agent = await tx.doc(AgentDoc, parentId);
      const isolated = await tx.doc(AgentDoc, fork.id);
      Object.assign(isolated, JSON.parse(JSON.stringify(agent)));
      this.fence(); allocated(fork.id);
      return fork.id;
    }, this.context));
  }
  private routed(input: AcceptedInput): boolean {
    const o = this.options;
    return o.operationConversationFor?.(input) === input.conversationId ||
      (o.existingConversationIds.includes(input.conversationId) && o.conversationFor(input.chatJid, input.branchId) === input.conversationId);
  }
  private async assertPublicRoute(input: AcceptedInput): Promise<void> {
    if (this.options.existingConversationIds.includes(input.conversationId)) return;
    const record = await this.harness.commit(tx => tx.conversation(input.conversationId), this.context);
    this.fence();
    const root = this.options.conversationFor(input.chatJid, input.branchId);
    // Empty-root allocations have no public fork point; their atomic host binding is identity.
    if (!record || (record.parent && record.parent.conversationId !== root)) throw Error("Host binding conflict");
  }
  private fence() {
    if (this.closed) throw new Error("Runtime closed");
    this.options.owner.assert();
  }
  /** Read the current public history head, never instantiate a legacy SDK session. */
  async readSessionPosition(binding: { incarnation: string; chatJid: string; branchId: string; conversationId: number }): Promise<string | null> {
    return this.observe(async () => {
      const o = this.options;
      const id = o.existingConversationIds.find(id => id === binding.conversationId);
      if (binding.incarnation !== o.incarnation || id === undefined ||
        o.conversationFor(binding.chatJid, binding.branchId) !== id) throw new Error("Host binding conflict");
      const conversation = await this.harness.conversation(id, this.context); this.fence();
      if (!conversation) throw new Error("Missing existing conversation");
      const page = await conversation.entries({ order: "descending" }, 1, undefined, this.context); this.fence();
      return page.items[0] ? String(page.items[0].id) : null;
    });
  }
  /** Fork-aware public history across the explicit imported host-session bindings only. */
  readSessionTree(binding: { incarnation: string; chatJid: string; branchId: string; conversationId: number }): Promise<SessionTreeSnapshot> {
    const copy = Object.freeze({ incarnation: binding.incarnation, chatJid: binding.chatJid,
      branchId: binding.branchId, conversationId: binding.conversationId });
    return this.observe(async () => {
      const o = this.options;
      if (copy.incarnation !== o.incarnation || !o.existingConversationIds.some(id => id === copy.conversationId) ||
        o.conversationFor(copy.chatJid, copy.branchId) !== copy.conversationId) throw new Error("Host binding conflict");
      this.fence();
      const active = await this.harness.snapshot(LegacyImportManifest, copy.conversationId as unknown as ConversationId, this.context); this.fence();
      const source = active?.binding;
      const all = new Map<string, RootSessionTreeNode>();
      let leafId: string | null = null;
      let visibleLeafId: string | null = null;
      for (const id of o.existingConversationIds) {
        this.fence();
        const manifest = await this.harness.snapshot(LegacyImportManifest, id, this.context); this.fence();
        const imported = manifest?.binding ?? null;
        if (id !== copy.conversationId && (!source || imported?.sourceSessionId !== source.sourceSessionId || imported.sourceHash !== source.sourceHash)) continue;
        // Imported host identities are provenance, not the current host routing keys.
        if (imported && imported.engineConversationId !== id) throw new Error("Host binding conflict");
        const conversation = await this.harness.conversation(id, this.context); this.fence();
        if (!conversation) throw new Error("Missing existing conversation");
        const rows: import("@earendil-works/pi-durable").EntryRecord[] = [];
        let cursor: import("@earendil-works/pi-durable").Cursor | undefined;
        do {
          this.fence();
          const page = await conversation.entries({ order: "ascending" }, 100, cursor, this.context); this.fence();
          rows.push(...page.items); cursor = page.next;
        } while (cursor);
        if (id === copy.conversationId) leafId = rows.length ? String(rows[rows.length - 1]!.id) : null;
        const projected = projectPublicHistory(rows, imported);
        if (id === copy.conversationId) visibleLeafId = projected.at(-1)?.entry.id ?? null;
        for (const node of projected) {
          const prior = all.get(node.entry.id);
          if (prior && prior.entry.parentId !== node.entry.parentId) throw new Error("Conflicting durable tree ancestry");
          if (!prior) all.set(node.entry.id, node);
        }
      }
      const roots: RootSessionTreeNode[] = [];
      for (const node of all.values()) {
        const parent = node.entry.parentId === null ? undefined : all.get(node.entry.parentId);
        if (node.entry.parentId !== null && !parent) throw new Error("Missing durable tree parent");
        if (parent) parent.children.push(node); else roots.push(node);
      }
      this.fence();
      return buildSessionTreeSnapshot({ getLeafId: () => leafId, getTree: () => roots }, { visibleLeafId });
    });
  }
  /** Read only the public persisted agent choice, not resolved host defaults or response metadata. */
  readSessionModel(binding: { incarnation: string; chatJid: string; branchId: string; conversationId: number }): Promise<string | null> {
    const copy = Object.freeze({ incarnation: binding.incarnation, chatJid: binding.chatJid,
      branchId: binding.branchId, conversationId: binding.conversationId });
    return this.observe(async () => {
      const o = this.options;
      const id = o.existingConversationIds.find(id => id === copy.conversationId);
      if (copy.incarnation !== o.incarnation || id === undefined ||
        o.conversationFor(copy.chatJid, copy.branchId) !== id) throw new Error("Host binding conflict");
      const conversation = await this.harness.conversation(id, this.context); this.fence();
      if (!conversation) throw new Error("Missing existing conversation");
      const label = await conversation.commit(async tx => {
        const state = await tx.doc(AgentDoc, id);
        return state.model ? `${state.model.provider}/${state.model.modelId}` : null;
      }, this.context); this.fence();
      return label;
    });
  }
  async setSessionModel(binding: { incarnation: string; chatJid: string; branchId: string; conversationId: number }, model: { provider: string; modelId: string }): Promise<void> {
    this.fence();
    const o = this.options;
    const id = o.existingConversationIds.find(id => id === binding.conversationId);
    if (binding.incarnation !== o.incarnation || id === undefined || o.conversationFor(binding.chatJid, binding.branchId) !== id) throw new Error("Host binding conflict");
    if (!o.withIdleModelGuard) throw new Error("Idle model guard unavailable");
    if (this.changingModel || this.active.size) throw new Error("Runtime is not idle");
    const choice = Object.freeze({ provider: model.provider, modelId: model.modelId });
    const target = o.harnessOptions.models.getModel(choice.provider, choice.modelId);
    if (!target || !Number.isFinite(target.contextWindow) || target.contextWindow <= 0 ||
      !Number.isFinite(target.maxTokens) || target.maxTokens < 0) throw new Error("Model context unavailable");
    this.changingModel = true;
    const operation = (async () => {
      const inspection = await this.harness.inspect(this.context); this.fence();
      if (inspection.tasks.length || inspection.submissions.length) throw new Error("Runtime is not idle");
      const conversation = await this.harness.conversation(id, this.context); this.fence();
      if (!conversation) throw new Error("Missing existing conversation");
      const view = await conversation.context(this.context); this.fence();
      await o.withIdleModelGuard!(() => conversation.commit(async tx => {
        this.fence();
        for (const conversationId of o.existingConversationIds) {
          if ((await tx.doc(InboxDoc, conversationId)).items.length || (await tx.doc(LiveDoc, conversationId)).run) throw new Error("Runtime is not idle");
        }
        // Candidate-only admission bound, NOT proof that the host's next full prompt fits.
        // Dynamic sections cannot be bounded here without executing host prompt callbacks.
        const registry = o.harnessOptions.registry.snapshot();
        if (registry.sections().length) throw new Error("Dynamic prompt overhead unavailable");
        const agent = await tx.doc(AgentDoc, id);
        const tools = registry.tools().map(({ tool }) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
        const bytes = new TextEncoder().encode(JSON.stringify([view.messages, agent, tools])).length;
        const usage = view.messages.reduce((max, message) => message.role === "assistant"
          ? Math.max(max, message.usage.input + message.usage.output + message.usage.cacheRead + message.usage.cacheWrite) : max, 0);
        // One token per serialized UTF-8 byte plus framing and full output reserve is
        // deliberately pessimistic for text; non-text/provider-specific overhead is unknown.
        if (view.messages.some(message => typeof message.content !== "string" && message.content.some(block => block.type === "image")))
          throw new Error("Non-text context overhead unavailable");
        if (!Number.isFinite(usage) || Math.max(bytes, usage) + 8192 + target.maxTokens > target.contextWindow)
          throw new Error("Candidate context bound exceeded; compact first");
        await configure(tx, id, { model: choice });
        this.fence();
      }, this.context));
    })();
    this.active.add(operation);
    try { await operation; } finally { this.active.delete(operation); this.changingModel = false; }
  }
  /** Explicit idle-only maintenance. Observer cancellation never cancels or releases the owned task. */
  compactSession(binding: { incarnation: string; chatJid: string; branchId: string; conversationId: number }, instructions?: string, signal?: AbortSignal): Promise<{ compacted: boolean }> {
    this.fence();
    const o = this.options;
    const copy = Object.freeze({ incarnation: binding.incarnation, chatJid: binding.chatJid, branchId: binding.branchId, conversationId: binding.conversationId });
    const id = o.existingConversationIds.find(id => id === copy.conversationId);
    if (copy.incarnation !== o.incarnation || id === undefined || o.conversationFor(copy.chatJid, copy.branchId) !== id) throw new Error("Host binding conflict");
    if (instructions !== undefined && (typeof instructions !== "string" || instructions.length > 65536)) throw new Error("Invalid compact instructions");
    if (!o.withIdleModelGuard) throw new Error("Idle model guard unavailable");
    if (this.changingModel || this.active.size) throw new Error("Runtime is not idle");
    signal?.throwIfAborted();
    this.changingModel = true; // Claim before the first await, across the entire authority domain.
    const context = withoutAbortSignal(this.context);
    const assertOwner = () => o.owner.assert(); // Close seals callers but joins this maintenance.
    let admitted = false, terminalFailure = false;
    let settleTask: (() => Promise<{ compacted: boolean }>) | undefined;
    const operation = (async () => {
      const inspection = await this.harness.inspect(context); assertOwner();
      if (inspection.tasks.length || inspection.submissions.length) throw new Error("Runtime is not idle");
      this.authorizingMaintenance = true;
      try { await o.authorizeScheduling(inspection); } finally { this.authorizingMaintenance = false; }
      assertOwner();
      const conversation = await this.harness.conversation(id, context); assertOwner();
      if (!conversation) throw new Error("Missing existing conversation");
      const taskId = await o.withIdleModelGuard!(async () => {
        // Same Session line and same-file BEGIN IMMEDIATE checks before task admission.
        await conversation.commit(async tx => {
          assertOwner();
          for (const conversationId of o.existingConversationIds) {
            if ((await tx.doc(InboxDoc, conversationId)).items.length || (await tx.doc(LiveDoc, conversationId)).run) throw new Error("Runtime is not idle");
          }
        }, context);
        const current = await this.harness.inspect(context); assertOwner();
        if (current.tasks.length || current.submissions.length) throw new Error("Runtime is not idle");
        admitted = true; // A lost admission ACK is also uncertain, never permission to resubmit.
        return conversation.compact(instructions, context);
      }); // Release SQL guard at admission, never across provider execution or summary writes.
      this.maintenanceTaskId = taskId;
      assertOwner();
      settleTask = async () => {
        const task = await this.harness.waitForTask(taskId, context); assertOwner();
        if (task.state.outcome.status !== "completed") {
          terminalFailure = true;
          throw new Error("Compaction did not complete");
        }
        const result = task.state.outcome.result;
        let entryId = result.entryId;
        if (result.submissionId !== undefined) {
          const submission = await this.harness.submission(result.submissionId, context); assertOwner();
          if (!submission) throw new Error("Missing compaction write");
          const settled = await submission.wait(context); assertOwner();
          if (settled.type === "write" && settled.status === "unanswered") {
            terminalFailure = true;
            throw new Error("Compaction write failed");
          }
          if (settled.type !== "write" || settled.status !== "done" || settled.conversationId !== id || settled.entry === undefined) throw new Error("Compaction write not placed");
          entryId = settled.entry;
        }
        if (entryId !== undefined) {
          const entry = await conversation.commit(tx => tx.entry(entryId!), context); assertOwner();
          const view = await conversation.context(context); assertOwner();
          if (!entry || entry.conversationId !== id || entry.kind !== "pi.compaction" || view.head?.id !== entryId) throw new Error("Compaction context not committed");
        }
        return { compacted: entryId !== undefined };
      };
      return settleTask();
    })();
    this.active.add(operation);
    // Observe both outcomes without creating an unhandled rejected cleanup promise.
    void operation.then(() => this.active.delete(operation), () => this.active.delete(operation));
    const settlement = operation.catch(error => {
      if (!admitted || terminalFailure) throw error;
      // Infrastructure observations cannot finish the command. Retain its original
      // promise, command protection and queue worker until explicit same-task repair.
      return new Promise<{ compacted: boolean }>((resolve, reject) => {
        this.pendingMaintenance = { binding: copy, reconcile: async () => {
          if (!settleTask) throw new Error("Compaction admission uncertain; owner retained");
          try {
            const result = await settleTask();
            this.pendingMaintenance = undefined;
            resolve(result);
          } catch (error) {
            if (terminalFailure) { this.pendingMaintenance = undefined; reject(error); }
            else throw error; // Leave the owned command pending on another read failure.
          }
        } };
      });
    });
    this.maintenance = settlement.then(() => { this.changingModel = false; }, async () => {
      try {
        const current = await this.harness.inspect(context); assertOwner();
        if (!current.tasks.length && !current.submissions.length) this.changingModel = false;
      } catch { this.changingModel = true; } // An unreadable domain retains exclusion and ownership.
    });
    return awaitWithContext(settlement, withAbortSignal(signal ?? new AbortController().signal, context));
  }
  /** Explicit observation repair only: no task submission, provider retry or new queue. */
  reconcileMaintenance(binding: { incarnation: string; chatJid: string; branchId: string; conversationId: number }): Promise<void> {
    this.fence();
    const pending = this.pendingMaintenance;
    if (!pending) return Promise.resolve();
    if (binding.incarnation !== pending.binding.incarnation || binding.chatJid !== pending.binding.chatJid ||
      binding.branchId !== pending.binding.branchId || binding.conversationId !== pending.binding.conversationId)
      throw new Error("Host binding conflict");
    if (pending.attempt) return pending.attempt;
    const attempt = pending.reconcile().finally(() => {
      pending.attempt = undefined;
      this.active.delete(attempt);
    });
    pending.attempt = attempt;
    this.active.add(attempt);
    return attempt;
  }
  /** Qualify a MODEL tool against its public live slot and every accepted run
   * input. Busy-chat lookup alone is never source authority. No new ledger. */
  captureToolSource(conversationId: ConversationId, taskId: import("@earendil-works/pi-durable").TaskId, callId: string) {
    return this.captureSource(conversationId, taskId, callId);
  }
  /** Recheck captured source routing synchronously at a host effect boundary. */
  assertCapturedSourceCurrent(inputs: readonly HostInputBinding[]): void {
    this.fence();
    for (const input of inputs) {
      if (!this.routed(input)) throw Error("Host binding conflict");
      this.options.bindings.assertSourceCurrent?.(input);
    }
  }
  /** Read-only generation provenance, including the first request before host ACK. */
  captureRunSource(conversationId: ConversationId, taskId: import("@earendil-works/pi-durable").TaskId) {
    return this.captureSource(conversationId, taskId);
  }
  private captureSource(conversationId: ConversationId, taskId: import("@earendil-works/pi-durable").TaskId, callId?: string): Promise<{
    inputs: readonly HostInputBinding[]; operation: OperationSnapshot;
    delegateModel?: { provider: string; modelId: string };
  }> {
    return this.observe(async () => {
      const o = this.options;
      const live = await this.harness.snapshot(LiveDoc, conversationId, this.context); this.fence();
      if (!live?.run || !(callId === undefined ? live.run.taskId === taskId : live.tools?.some(slot => slot.taskId === taskId && slot.callId === callId && slot.status === "running")) || !live.run.inputs.length)
        throw Error("Exact host tool run required");
      // A native foreground child has its own pi.user input, not a new host
      // acceptance. Follow only public task ownership back to the exact live
      // MODEL Delegate slot; neither ancestry nor a busy parent grants authority.
      const owned = await this.harness.commit(async tx => {
        const conversation = await tx.conversation(conversationId);
        if (!conversation?.owner) return undefined;
        const owner = conversation.owner;
        const task = await tx.task(owner.taskId);
        if (!task || task.kind !== "pi.tool" || task.conversationId !== owner.conversationId ||
          task.state.status === "terminal" || task.abortRequested) throw Error("Live Delegate owner required");
        const input = task.input as Partial<import("@earendil-works/pi-durable").ToolTaskInput>;
        if (input.kind !== "model" || !input.callId || input.assistant === undefined) throw Error("Model Delegate owner required");
        const assistant = await tx.entry(input.assistant);
        const calls = assistant?.model?.flatMap(message => message.role === "assistant" ? message.content.filter(part => part.type === "toolCall") : []) ?? [];
        if (assistant?.conversationId !== owner.conversationId || !calls.some(call => call.id === input.callId && call.name === "delegate"))
          throw Error("Exact Delegate owner required");
        // Delegation is foreground and non-recursive. A task-owned parent cannot
        // manufacture an accepted-input chain through another Delegate call.
        if ((await tx.conversation(owner.conversationId))?.owner) throw Error("Recursive Delegate source denied");
        const model = (await tx.doc(AgentDoc, conversationId)).model;
        if (!model) throw Error("Delegate model required");
        return { ...owner, callId: input.callId, model: Object.freeze({ ...model }) };
      }, this.context); this.fence();
      if (owned) return { ...await this.captureSource(owned.conversationId, owned.taskId, owned.callId), delegateModel: owned.model };
      const inputs: HostInputBinding[] = [];
      let operation: OperationSnapshot | undefined;
      for (const submissionId of live.run.inputs) {
        const submission = await this.harness.submission(submissionId, this.context); this.fence();
        const record = await submission?.status(this.context); this.fence();
        if (!record || record.type !== "input" || record.conversationId !== conversationId || record.entry === undefined)
          throw Error("Exact host accepted input required");
        const entry = await this.harness.commit(tx => tx.entry(record.entry!), this.context); this.fence();
        const data = entry?.data as Record<string, unknown> | undefined;
        if (entry?.kind !== "host.accepted" || !data || (data.role !== "primary" && data.role !== "intent"))
          throw Error("Exact host accepted input required");
        const input = inputSnapshot(data as unknown as AcceptedInput);
        if (input.conversationId !== conversationId || input.requestId !== record.requestId || input.incarnation !== o.incarnation ||
          !this.routed(input)) throw Error("Host binding conflict");
        await this.assertPublicRoute(input);
        const bound = await this.port(data.role === "intent").get(input); this.fence();
        if (!bound || (bound.submissionId !== submissionId && !(callId === undefined && bound.submissionId === null && data.role === "primary"))) throw Error("Host binding conflict");
        const current = value(await o.work.getOperation(input.operationId)); this.fence();
        if (!current || current.chatJid !== input.chatJid || current.phase !== "executing" || current.cancellation ||
          !current.claimedSourceSeqs.includes(input.sourceSeq) || (operation && (operation.operationId !== current.operationId || operation.version !== current.version)))
          throw Error("Host operation authority unavailable");
        if (current.harness ? current.harness.sessionId !== o.sessionId || current.harness.lane !== o.lane ||
          current.harness.watchGeneration !== o.generation || current.harness.state !== "running" ||
          !live.run.inputs.some(id => String(id) === current.harness!.harnessOperationId)
          : callId !== undefined || data.role !== "primary" || current.primarySourceSeq !== input.sourceSeq)
          throw Error("Exact host harness required");
        operation = current; inputs.push(bound);
      }
      if (!operation || !inputs.some(input => input.sourceSeq === operation!.primarySourceSeq)) throw Error("Host primary input required");
      return { inputs: Object.freeze(inputs), operation };
    });
  }
  private port(intent: boolean) {
    const port = intent ? this.options.bindings.intents : this.options.bindings;
    if (!port) throw new Error("Accepted intent bindings required");
    return port;
  }
  private async checked(input: AcceptedInput, intent = false) {
    this.fence();
    const o = this.options;
    if (input.incarnation !== o.incarnation || !this.routed(input)) throw new Error("Host binding conflict");
    await this.assertPublicRoute(input);
    const operation = value(await o.work.getOperation(input.operationId)); this.fence();
    if (!operation || operation.chatJid !== input.chatJid ||
      (intent ? operation.primarySourceSeq === input.sourceSeq : operation.primarySourceSeq !== input.sourceSeq) ||
      !operation.claimedSourceSeqs.includes(input.sourceSeq)) throw new Error("Unaccepted operation/source");
    if (intent && (!operation.harness || operation.harness.sessionId !== o.sessionId || operation.harness.lane !== o.lane ||
      operation.harness.watchGeneration !== o.generation || !operation.harness.harnessOperationId ||
      (!operation.terminal && operation.harness.state !== "running" && !(operation.phase === "settling" && operation.harness.state === "finished")))) throw new Error("Exact host harness required");
    if (intent) {
      const primary = await this.harness.submission(Number(operation.harness!.harnessOperationId) as SubmissionId, this.context); this.fence();
      const status = await primary?.status(this.context); this.fence();
      if (!status || status.type !== "input" || status.conversationId !== input.conversationId || status.entry === undefined)
        throw new Error("Exact host harness required");
      const entry = await this.harness.commit(tx => tx.entry(status.entry!), this.context); this.fence();
      const data = entry?.data as Record<string, unknown> | undefined;
      if (entry?.kind !== "host.accepted" || data?.role !== "primary" || data.operationId !== input.operationId ||
        data.sourceSeq !== operation.primarySourceSeq || data.incarnation !== input.incarnation) throw new Error("Exact host harness required");
    }
    const { content } = await this.port(intent).getOrBind(input); this.fence();
    if (typeof content !== "string") throw new TypeError("Expected string payload");
    if (hashCanonicalRequest({ type: "input", requestId: input.requestId, content }) !== input.requestHash)
      throw new Error("Host payload hash conflict");
    const conversation = await this.harness.conversation(input.conversationId, this.context); this.fence();
    if (!conversation) throw new Error("Missing existing conversation");
    return { operation, conversation, content };
  }
  private async record(input: AcceptedInput, intent = false) {
    const conflict = () => new Error("Submission binding conflict");
    const binding = await this.port(intent).get(input); this.fence();
    if (!binding) throw conflict();
    // Read status AND its original input evidence in one public transaction. Request IDs
    // alone are candidate dedup keys, not proof of content or accepted host provenance.
    const record = await this.harness.commit(async tx => {
      const record = await tx.submissionByRequest(input.conversationId, input.requestId);
      if (binding.submissionId !== null && binding.submissionId !== record?.id) throw conflict();
      if (!record) return record;
      if (record.type !== "input" || record.conversationId !== input.conversationId || record.requestId !== input.requestId) throw conflict();
      let content: unknown, entry: { kind: string; data?: unknown } | undefined;
      if (record.entry !== undefined) {
        const placed = await tx.entry(record.entry);
        if (!placed || placed.conversationId !== input.conversationId || placed.model?.length !== 1 || placed.model[0]?.role !== "user") throw conflict();
        content = placed.model[0].content; entry = placed;
      } else if (record.status === "queued") {
        const inbox = await tx.doc(InboxDoc, input.conversationId);
        const item = inbox.items.find(item => item.id === record.id);
        if (!item || item.mode === "write") throw conflict();
        content = item.content; entry = item.entry;
      } else {
        // Withdrawal removes queued evidence. Only an ID already durably recorded AFTER
        // validation may reconcile that terminal state; lost-ack unbound records fail closed.
        if (record.status !== "unanswered" || binding.submissionId !== record.id) throw conflict();
        return record;
      }
      const data = entry?.data;
      if (entry?.kind !== "host.accepted" || !data || typeof data !== "object" || Array.isArray(data) ||
        (data as Record<string, unknown>).role !== (intent ? "intent" : "primary") ||
        Object.entries(input).some(([key, value]) => (data as Record<string, unknown>)[key] !== value) ||
        typeof content !== "string" || hashCanonicalRequest({ type: "input", requestId: input.requestId, content }) !== input.requestHash) throw conflict();
      return record;
    }, this.context); this.fence();
    return record;
  }
  private async progress() {
    const inspection = await this.harness.inspect(this.context); this.fence();
    await this.options.authorizeScheduling(inspection); this.fence();
  }
  submit(input: AcceptedInput) { const copy = inputSnapshot(input); return this.admitInput(copy); }
  /** Targets the accepted host operation, NOT an exact physical model generation. */
  submitIntent(input: AcceptedInput) { const copy = inputSnapshot(input); return this.admitInput(copy, true); }
  private async admitInput(input: AcceptedInput, intent = false) {
    this.fence();
    // Join only owned compaction completion, never its detachable observer. This wait
    // is not active work: maintenance must finish before normal admission can begin.
    // A failed/uncertain maintenance keeps changingModel set and observe rejects;
    // close seals this waiter too. checked() revalidates the captured source/owner.
    while (this.changingModel && this.maintenance) {
      const maintenance = this.maintenance;
      await maintenance;
      this.fence();
      if (this.maintenance === maintenance) break;
    }
    return this.observe(() => this.submitInput(input, intent));
  }
  private async submitInput(input: AcceptedInput, intent = false) {
    const port = this.port(intent);
    const { operation, conversation, content } = await this.checked(input, intent);
    const prior = await this.record(input, intent);
    if (prior) {
      await port.recordSubmission(input, prior.id); this.fence();
      return prior.id; // Acknowledgement repair is not permission to resume.
    }
    if (operation.terminal || operation.cancellation) throw new Error("Operation no longer executable");
    await this.progress();
    const submission = await conversation.submit({ type: "input", requestId: input.requestId, content,
      ...(intent ? { whenBusy: "steer" as const } : {}),
      entry: { kind: "host.accepted", data: { ...input, role: intent ? "intent" : "primary" } } }, this.context);
    this.fence();
    // Recheck the returned durable evidence too: submit itself deduplicates by request ID.
    const admitted = await this.record(input, intent);
    if (!admitted || admitted.id !== submission.id) throw new Error("Submission binding conflict");
    await port.recordSubmission(input, submission.id); this.fence();
    return submission.id;
  }
  /** Pure lookup/status/committed-entry reads. No wait/resume, terminal write or payload publication. */
  reconcile(input: AcceptedInput) { const copy = inputSnapshot(input); return this.observe(() => this.readState(copy), true); }
  /** Inspection and live documents are separate public observations. A task that
   * retired between them is no longer scheduling authority; require its durable receipt. */
  isTaskTerminal(id: import("@earendil-works/pi-durable").TaskId) {
    return this.observe(async () => {
      const task = await this.harness.getTask(id, this.context); this.fence();
      return task?.state.status === "terminal";
    }, true);
  }
  inspectAuthority(additional: readonly AcceptedInput[] = []) {
    return this.observe(async () => {
      const inspection = await this.harness.inspect(this.context); this.fence();
      const runs = [];
      const ids = new Set(this.options.existingConversationIds);
      for (const input of additional) {
        if (!ids.has(input.conversationId)) {
          await this.checked(inputSnapshot(input)); ids.add(input.conversationId);
        }
      }
      for (const id of ids) {
        const live = await this.harness.snapshot(LiveDoc, id, this.context); this.fence();
        if (live?.run) runs.push(live.run);
      }
      return { inspection, runs };
    }, true);
  }
  reconcileIntent(input: AcceptedInput) { const copy = inputSnapshot(input); return this.observe(() => this.readState(copy, true), true); }
  private async readState(input: AcceptedInput, intent = false) {
    const { operation, conversation } = await this.checked(input, intent);
    const record = await this.record(input, intent);
    if (!record) return { operation, submissionId: null, status: null, answer: null };
    const handle = await this.harness.submission(record.id, this.context); this.fence();
    if (!handle) throw new Error("Missing submission");
    const status = await handle.status(this.context); this.fence();
    let answer: SettledAnswer | null = null;
    if (status.type === "input" && status.status === "done") {
      const entry = await conversation.commit(tx => tx.entry(AssistantEntry, status.answer), this.context); this.fence();
      if (!entry || entry.conversationId !== input.conversationId) throw new Error("Missing committed answer");
      const messages = entry.model ?? [];
      if (messages.length !== 1 || messages[0]!.role !== "assistant") throw new Error("Unsupported answer shape");
      const message = messages[0]!;
      // Public pi-ai 1.3 AssistantMessage supports text/thinking/toolCall, NOT image.
      // A tool-call generation is not a final answer. Tool media belongs to the host port.
      if (!Array.isArray(message.content) || message.content.some(part => part.type !== "text" && part.type !== "thinking"))
        throw new Error("Unsupported final assistant content");
      if (message.stopReason !== "stop" && message.stopReason !== "length") throw new Error("Unsupported final assistant stop reason");
      const text = message.content.map(part => part.type === "text" ? part.text : "").join("");
      if (text.length > 65536) throw new Error("Answer exceeds qualification bound");
      answer = freezeTree({ message: structuredClone(message), text });
    }
    return { operation, submissionId: record.id, status, answer };
  }
  cancel(input: AcceptedInput, submissionId: SubmissionId, request: AcceptCancellationRequest) {
    const copy = inputSnapshot(input), cancellation = cancellationSnapshot(request);
    return this.observe(() => this.cancelInput(copy, submissionId, cancellation));
  }
  private async cancelInput(input: AcceptedInput, submissionId: SubmissionId, request: AcceptCancellationRequest) {
    const { operation } = await this.checked(input);
    const record = await this.record(input);
    if (!record || record.id !== submissionId || request.effect.operationId !== operation.operationId ||
      request.effect.sourceSeq !== request.sourceSeq)
      throw new Error("Exact cancellation binding required");
    // EF-S01 owns version validation AND replay of a persisted decision after version advancement.
    value(await this.options.work.acceptCancellation(request)); this.fence();
    await this.progress();
    const result = await this.harness.abortSubmission(submissionId, this.context, input.conversationId);
    this.fence();
    // Placement is not exact task ownership: a generation may include other accepted steers.
    // Withdraw queued input only; never escalate to task/conversation-wide abort.
    return result;
  }
  /** Explicit progress grant after caller has revalidated the entire ownership domain. */
  resume(input: AcceptedInput, submissionId: SubmissionId) {
    input = inputSnapshot(input);
    return this.observe(async () => {
      const { operation } = await this.checked(input);
      const record = await this.record(input);
      if (!record || record.id !== submissionId || operation.terminal || operation.cancellation) throw new Error("Exact live submission required");
      await this.progress(); this.harness.resume();
    });
  }
  /** Waiting grants store-wide scheduling, like resume; no timeout aborts running work. */
  wait(input: AcceptedInput, submissionId: SubmissionId, signal?: AbortSignal): Promise<void> {
    const copy = inputSnapshot(input);
    const observation = withAbortSignal(signal ? AbortSignal.any([signal, this.observations.signal]) : this.observations.signal, this.context);
    return this.observe(() => {
      observation.abortSignal?.throwIfAborted();
      const pending = (async () => {
        await this.checked(copy); observation.abortSignal?.throwIfAborted();
        const record = await this.record(copy); observation.abortSignal?.throwIfAborted();
        if (!record || record.id !== submissionId) throw new Error("Exact submission required");
        await this.progress(); observation.abortSignal?.throwIfAborted();
        const handle = await this.harness.submission(submissionId, observation); this.fence();
        observation.abortSignal?.throwIfAborted();
        if (!handle) throw new Error("Missing submission");
        await handle.wait(observation); this.fence();
      })();
      this.underlyingWaits.add(pending);
      // Observe even a synchronous host callback's abort before awaitWithContext attaches.
      void pending.finally(() => this.underlyingWaits.delete(pending)).catch(() => {});
      // Detach the whole observer, including host authorization/lookup, not just handle.wait.
      // Late continuations are fenced above; cancellation never aborts durable work.
      return awaitWithContext(pending, observation);
    });
  }
  settle(input: AcceptedInput) { const copy = inputSnapshot(input); return this.observe(() => this.settleInput(copy)); }
  private async settleInput(input: AcceptedInput) {
    let state = await this.readState(input); const o = this.options;
    if (state.operation.terminal) {
      const terminal = value(await o.terminal.getTerminal(input.operationId)); this.fence(); return terminal;
    }
    const initialVersion = state.operation.version;
    const primarySubmissionId = state.submissionId;
    const claimed = state.operation.claimedSourceSeqs.filter(seq => seq !== state.operation.primarySourceSeq);
    if (claimed.length) {
      const port = o.bindings.intents;
      if (!port) throw new Error("Accepted intent bindings required");
      const bindings = await port.list(input); this.fence();
      if (bindings.some(b => !claimed.includes(b.sourceSeq))) return null;
      const states = [state];
      for (const seq of claimed) {
        const matches = bindings.filter(b => b.sourceSeq === seq);
        if (matches.length !== 1 || matches[0]!.submissionId === null) return null;
        const next = await this.readState(inputSnapshot(matches[0]!), true);
        if (next.operation.version !== initialVersion || next.status?.status !== "done" || !next.answer) return null;
        states.push(next);
      }
      if (states.some(s => s.status?.status !== "done" || !s.answer)) return null;
      // Public entry IDs are transcript positions (EntryQuery's documented ID ordering).
      const positions = states.map(s => s.status!.entry!);
      if (positions.some(p => !Number.isSafeInteger(p)) || new Set(positions).size !== positions.length)
        throw new Error("Ambiguous accepted input placement");
      state = states.reduce((latest, s) => s.status!.entry! > latest.status!.entry! ? s : latest);
    }
    const aborted = state.operation.cancellation !== null && state.status?.status === "unanswered";
    if ((!aborted && state.answer === null) || !state.submissionId) return null;
    let operation = value(await o.work.getOperation(input.operationId)); this.fence();
    if (!operation) throw new Error("Missing operation");
    // Never refresh away an attachment/version fence after inspecting accepted inputs.
    if (operation.version !== initialVersion) return null;
    if (operation.harness?.state === "running") {
      if (!o.work.finishHarness) throw new Error("Host harness completion API required");
      if (operation.harness.sessionId !== o.sessionId || operation.harness.lane !== o.lane ||
        operation.harness.watchGeneration !== o.generation || operation.harness.harnessOperationId !== String(primarySubmissionId))
        throw new Error("Exact host harness required");
      const request = {
        effect: { ...effect(`runtime:finish:${input.requestId}:${operation.version}`, input.operationId, input.sourceSeq), operationId: input.operationId },
        expectedVersion: operation.version, expectedHarness: operation.harness,
      } satisfies FinishHarnessRequest;
      request.effect.requestHash = hashCanonicalRequest({ method: "finishHarness.v1", ...request } as unknown as CanonicalJsonValue);
      this.fence();
      operation = value(await o.work.finishHarness(request)); this.fence();
    }
    if (!operation.harness) {
      operation = value(await o.work.bindHarness(sealed({ effect: effect(`runtime:bind:${input.requestId}:${o.generation}`, input.operationId, input.sourceSeq),
        expectedVersion: operation.version, sessionId: o.sessionId, lane: o.lane, harnessOperationId: String(state.submissionId),
        state: "finished" as const, watchGeneration: o.generation }))); this.fence();
    }
    const cancelled = operation.cancellation !== null, ref = `runtime-answer:${o.incarnation}:${state.submissionId}`;
    let materialized: MaterializedAnswer = Object.freeze({ contentRef: ref, contentBlocksRef: null, mediaIds: Object.freeze([]) });
    if (!cancelled) {
      // Capture and validate returned refs BEFORE the next await. Host exceptions may contain secrets.
      try {
        if (o.materializeAnswer) materialized = materializedSnapshot(await o.materializeAnswer(ref, state.answer!, freezeTree(structuredClone(operation))));
        else await o.putAnswer(ref, state.answer!.text);
      } catch { throw new Error("Host answer materialization failed"); }
      this.fence();
      // Do not refresh expectedVersion: cancellation/version changes must reject this stale
      // completion. EF-S02 repeats owner/version checks inside its terminal SQL transaction.
      const current = value(await o.work.getOperation(input.operationId)); this.fence();
      if (!current || current.version !== operation.version || current.cancellation || current.terminal)
        throw new Error("Operation changed during answer materialization");
    }
    // Scheduled delivery belongs to EF-S07, not the ordinary-message terminal publisher.
    const scheduled = o.operationConversationFor?.(input) === input.conversationId;
    const timeline: CommitTerminalRequest["timeline"] = cancelled || scheduled
      ? { mode: "none", placeholderRowId: null, chatJid: input.chatJid, contentRef: null, threadId: null, mediaIds: [], contentBlocksRef: null }
      : { mode: "insert", placeholderRowId: null, chatJid: input.chatJid, ...materialized, threadId: null };
    const request: CommitTerminalRequest = sealed({ effect: effect(`runtime:terminal:${input.requestId}`, input.operationId, input.sourceSeq),
      expectedChatJid: input.chatJid, expectedVersion: operation.version, expectedHarness: operation.harness,
      disposition: cancelled ? "cancelled" as const : "completed" as const, errorCode: null, terminalAuthorityRef: null,
      timeline, sourceDispositions: operation.claimedSourceSeqs.map(sourceSeq => ({ sourceSeq, state: "consumed" as const, reason: "runtime committed answer" })),
      outboxIntents: [], committedAt: o.now() });
    const terminal = value(await o.terminal.commitTerminal(request)); this.fence(); return terminal;
  }
  /** Rollback-only shutdown: seal before yielding, join host calls, then reject ANY live
   * public task/submission before Harness.close can cancel work. Failure stays sealed.
   * This proves quiescence, NOT absence of historical candidate-only commits. */
  quiesceForRollback(beforeStorageClose?: () => Promise<void>): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Runtime already closing"));
    return this.shutdown(true, beforeStorageClose);
  }
  close(): Promise<void> { return this.shutdown(false); }
  private shutdown(requireQuiescent: boolean, beforeStorageClose?: () => Promise<void>): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true; // Seal admissions, preserve pending/unknown work; close does not enable scheduling.
    this.observations.abort();
    return this.closing = (async () => {
      // An uncertain observation repair may itself be waiting on a held task.
      // Reject before joining it; known in-progress maintenance still joins below.
      if (this.pendingMaintenance) throw new Error(`Maintenance settlement uncertain (task ${this.maintenanceTaskId ?? "admission uncertain"}); owner retained`);
      await Promise.allSettled([...this.active]);
      if (this.pendingMaintenance) throw new Error(`Maintenance settlement uncertain (task ${this.maintenanceTaskId ?? "admission uncertain"}); owner retained`);
      if (this.maintenance) {
        await this.maintenance;
        this.options.owner.assert();
        const inspection = await this.harness.inspect(withoutAbortSignal(this.context));
        if (inspection.tasks.length || inspection.submissions.length)
          throw new Error(`Maintenance not quiescent (task ${this.maintenanceTaskId ?? "admission uncertain"}); owner retained`);
      }
      if (requireQuiescent) {
        await Promise.allSettled([...this.underlyingWaits]);
        this.options.owner.assert();
        const inspection = await this.harness.inspect(withoutAbortSignal(this.context));
        this.options.owner.assert();
        if (inspection.tasks.length || inspection.submissions.length) throw new Error("Candidate not quiescent");
        await beforeStorageClose?.();
        this.options.owner.assert();
      }
      await this.harness.close(withoutAbortSignal(this.context)); // May wait for cooperative providers/tools; no bounded-close claim.
      await this.options.owner.release(); // Only after confirmed resource cleanup.
    })();
  }
}
