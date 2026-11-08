import { storeMessageInDatabase } from "../../src/db/messages.js";
// Single-root application composition; execution and recovery remain SDK-owned.
import type { Database } from "bun:sqlite";
import { admitSqliteWrite } from "../../src/db/sqlite-async-admission.js";
import { getChatCursor, setChatCursor } from "../../src/db/chat-cursors.js";
import { readScheduledDefinition } from "../../src/db/scheduled-task-definitions.js";
import { resolveAcceptedMessageThread } from "./host-message-thread.js";
import { parseModelFailure } from './host-model-failure.js';
import { getAgentRuntimeConfig } from "../../src/core/config.js";
import { readAccessConfig } from "../../src/core/config-access.js";
import { getExecutionIdentity } from "../../src/core/execution-context.js";
import { getDeferredQueuedFollowups } from "../../src/db/chat-cursors.js";
import { createHash } from "node:crypto";
import { isPromise } from "node:util/types";
import { createLogger } from "../../src/utils/logger.js";
const observerLog = createLogger("durable.side-observer");
import type { Context } from "@earendil-works/chord/context";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { RuntimeLockHandle } from "../../src/runtime/single-instance.js";
import type { RuntimeBackend } from "../../src/runtime/bootstrap.js";
import { RuntimeStartupCleanupError } from "../../src/runtime/startup-cleanup-error.js";
import type { AgentOutput, SidePromptOptions, SidePromptResult } from "../../src/agent-pool/contracts.js";
import type { WebChannelOpts } from "../../src/channels/web.js";
import type { EffectPayloadResolver } from "../../src/service-effects/contracts/payload-resolver.js";
import { createCurrentPiclawServiceWorkStore } from "../../src/service-effects/current-piclaw/service-work-store.js";
import { createCurrentPiclawTerminalSettlementStore } from "../../src/service-effects/current-piclaw/terminal-settlement-store.js";
import { createDurableConversationAdapter, durableAbortScopeKey, type DurableAbortScope } from "../../src/agent-pool/durable-runtime-adapter.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import { BunSqliteDatabase } from "./bun-sqlite.js";
import { createHostController, type HostControllerOptions } from "./host-controller.js";
import { createHostDurableBindings, createInputHandoffCompletion } from "./host-bindings.js";
import { prepareHostSchema } from "./host-schema.js";
import { readApplicationMessagePayload } from "./accepted-payload-recovery.js";
import { value, effect, sealed } from "./host-effects.js";
import { hashScheduledLeaseToken } from "../../src/service-effects/current-piclaw/scheduled-run-values.js";
import type { ScheduledRunLease } from "../../src/service-effects/contracts/scheduled-run-store.js";
import { isNativeMessageInput, type NativeMessageResult, type AcceptedInput, type RuntimeOptions } from "./host-runtime.js";
import type { ConversationId,Tx } from "@earendil-works/pi-durable";
import { nativeBackgroundIdentity,readNativeBackgroundPayload,assertNativeBackgroundRetry,type NativeBackgroundPayload } from "../../src/agent-pool/background-operation-contract.js";
import { backgroundPolicyProvenance,type NativeBackgroundContext } from "./host-background-context.js";

import { admitWebMessage } from "../../src/channels/web/messaging/message-store.js";
import { createApplicationHostInput } from "./host-application-input.js";
import { registerNativeBranchControlGuard } from "../../src/db/native-routing-policy.js";

/** Format a timeout in a compact human-readable form. */
function formatTimeoutDuration(timeoutMs: number): string {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return `${timeoutMs}ms`;
  if (timeoutMs % 1000 === 0) return `${Math.round(timeoutMs / 1000)}s`;
  return `${(timeoutMs / 1000).toFixed(1)}s`;
}

type Manifest = HostControllerOptions["recovery"]["manifest"];
/** Stable caller request identity, independent of financial work. */
export function sidePromptSourceId(chatJid: string, requestId: string): string {
  const digest = createHash("sha256").update(JSON.stringify([chatJid, requestId])).digest("hex");
  return `side-prompt:${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
}
/** Validate existing host routing before any import/journal/schema write. */
export function assertApplicationBranchRoutes(root: Database, manifest: readonly { chatJid: string; branchId: string }[], historicalBindings = false) {
  for (const binding of manifest) {
    const row = root.query("SELECT branch_id, archived_at FROM chat_branches WHERE chat_jid=?").get(binding.chatJid) as
      { branch_id: string; archived_at: string | null } | null;
    // Keep the existing explicit synthetic main binding contract unchanged.
    if (binding.branchId !== "main" && (!row || row.branch_id !== binding.branchId || !historicalBindings && row.archived_at !== null))
      throw Error("Exact application branch manifest required");
  }
}
/** Borrowing seals only this controller scope. The application keeps the original lock
 * handle and releases it AFTER all services, root DB and other components shut down. */
export function applicationOwnership(lock: RuntimeLockHandle) {
  const assert = () => {
    if (!lock.enabled || !lock.strictOwnership) throw Error("Strict application ownership required");
    lock.assertCurrentOwner();
  };
  assert();
  return Object.freeze({ borrow() {
    assert(); let sealed = false;
    return Object.freeze({ assertCurrentOwner() { if (sealed) throw Error("Borrowed ownership sealed"); assert(); },
      release() { sealed = true; } });
  } });
}

export interface ApplicationBootstrapOptions {
  root: Database;
  path: string;
  /** Live acquisition follows this caller lifetime; preparation retains its finite cap. */
  contentionSignal?: AbortSignal;
  background?: {
    contexts:readonly NativeBackgroundContext[];
    payloads:ReadonlyMap<string,NativeBackgroundPayload>;
    assertCurrent(payload:NativeBackgroundPayload):void;
    put(payload:NativeBackgroundPayload):void|Promise<void>;
    publish(tx:Tx,payload:NativeBackgroundPayload):Promise<NativeBackgroundContext>;
  };
  ownership: ReturnType<typeof applicationOwnership>;
  manifest: Manifest;
  /** Original host session identities, not a new bootstrap-generated identity. */
  sessions: ReadonlyMap<string, string>;
  offlineInitialize?: boolean;
  /** Validated default manifest retains archived historical bindings. Admission
   * still requires current active host policy; copied/import plans stay strict. */
  historicalBindings?: boolean;
  /** Publish the existing runtime before recovery can schedule any provider. */
  onMaintenanceSettled?: (workId: string) => void | Promise<void>;
  onOperationSettled?: RuntimeOptions["onOperationSettled"];
  /** Idempotent timeline/Goal projection of an actual immutable SDK result. */
  onMessageResult?(input: AcceptedInput, result: NativeMessageResult): Promise<void>;
  prepareTerminalEffect?: RuntimeOptions["prepareTerminalEffect"];
  materializeAnswer?: RuntimeOptions["materializeAnswer"];
  dispatchHostCommand?: import("../../src/agent-pool/contracts.js").AgentPoolOptions["dispatchHostCommand"];
  prepareInterruptedScheduledHarness?: import("../../src/agent-pool/contracts.js").AgentPoolOptions["prepareInterruptedScheduledHarness"];
  requestProcessExit?: (reason: string) => Promise<void>;
  readExecutionPolicy?: () => {autoCompact: boolean; autoRetry: boolean};
  setExecutionPolicy?: (name: "autoCompact" | "autoRetry", enabled: boolean) => void | Promise<void>;
  onRuntime?: (runtime: import("./host-runtime.js").HostConversationRuntime) => void;
  assertConversationAvailable?: () => void;
  assertAdmission?: RuntimeOptions["assertAdmission"];
  /** Host-owned physical catalog approval; no credentials or provider execution. */
  resolveScheduledModel?: (label: string) => { provider: string; modelId: string };
  observeSidePrompt?: (sourceId: string, observer: NonNullable<SidePromptOptions["onEvent"]>) => () => void;
  /** Synchronous final admission check on already materialised immutable input. */
  assertInputAdmission?: (chatJid: string, content: string) => void;
  prepareInputText?: NonNullable<WebChannelOpts["prepareInputText"]>;
  createConversation?: (tx: import("@earendil-works/pi-durable").Tx, chatJid: string, branchId: string) => Promise<Manifest[number] & { sessionId: string }>;
  runtime: Pick<HostControllerOptions["runtime"], "incarnation" | "sessionId" | "harnessOptions" | "now" | "codemodeExecute" | "onStorageFailure">;
  /** Existing application payload store, with immutable answer references. */
  answers: { resolver: EffectPayloadResolver; put(ref: string, text: string): void | Promise<void> };
  /** Optional acknowledgement boundary; the supplied operation still performs the real wait. */
  wrapWait?: (wait: NonNullable<import("../../src/agent-pool/durable-runtime-adapter.js").DurableConversationRuntimePort["wait"]>) => NonNullable<import("../../src/agent-pool/durable-runtime-adapter.js").DurableConversationRuntimePort["wait"]>;
}

export async function createApplicationBootstrapBundle(config: ApplicationBootstrapOptions, context: Context) {
  const lease = config.ownership.borrow(), assert = () => lease.assertCurrentOwner();
  assert();
  const root = config.root, path = config.path, r = { ...config.runtime };
  const contentionSignal = config.contentionSignal, shutdown = new AbortController();
  const wrapWait = config.wrapWait;
  const createConversation = config.createConversation?.bind(config);
  const resolveScheduledModel = config.resolveScheduledModel?.bind(config);
  const assertInputAdmission = config.assertInputAdmission?.bind(config);
  const prepareInputText = config.prepareInputText?.bind(config);
  let database: BunSqliteDatabase | undefined;
  let controller: Awaited<ReturnType<typeof createHostController>> | undefined;
  let releaseBranchControlGuard: (() => void) | undefined;
  try {
  const manifest = Object.freeze(config.manifest.map(b => Object.freeze({ ...b })));
  const sessions = new Map(config.sessions);
  const chats = new Set(manifest.map(b => b.chatJid));
  // Capture and validate the complete scope before the first await or port construction.
  // Never normalize identities here: session keys must match the canonical manifest exactly.
  const canonical = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id === id.trim();
  if (!manifest.length || chats.size !== manifest.length || sessions.size !== chats.size ||
    [...sessions].some(([chat, session]) => !canonical(chat) || !chats.has(chat) || !canonical(session)) ||
    new Set(manifest.map(b => b.conversationId)).size !== manifest.length ||
    manifest.some(b => !canonical(b.chatJid) || !canonical(b.branchId) || !sessions.has(b.chatJid) || !Number.isSafeInteger(b.conversationId) || b.conversationId <= 0))
    throw Error("Exact application branch manifest required");
  // Root branches already have distinct chat JIDs (UNIQUE in chat_branches).
  // Never invent a branch or choose a first/default row for an existing chat.
  assertApplicationBranchRoutes(root, manifest, config.historicalBindings === true);
  const routeIndex = new Map(manifest.map(b => [b.chatJid, Object.freeze({ ...b, sessionId: sessions.get(b.chatJid)! })]));
  const backgroundSource = config.background;
  const background = backgroundSource&&Object.freeze({contexts:backgroundSource.contexts.map(entry=>Object.freeze({...entry})),payloads:new Map(backgroundSource.payloads),
    assertCurrent:backgroundSource.assertCurrent.bind(backgroundSource),put:backgroundSource.put.bind(backgroundSource),publish:backgroundSource.publish.bind(backgroundSource)});
  const privateIndex = new Map((background?.contexts??[]).map(b=>[b.chatJid,Object.freeze({...b})]));
  const backgroundPayloads = new Map(background?.payloads??[]);
  // Lifetime joins and immutable SDK/source lookup only, never execution state.
  const dreamInvocations = new Set<Promise<AgentOutput>>();
  const dreamSources = new Map<number,Readonly<{context:NativeBackgroundContext;payload:NativeBackgroundPayload}>>();
  for(const payload of backgroundPayloads.values())if(payload.policy.origin.kind==='dream'){
    const context=privateIndex.get(nativeBackgroundIdentity(payload.policy).chatJid);
    if(!context)throw Error('Dream SDK context identity missing');
    dreamSources.set(context.conversationId,Object.freeze({context,payload}));
  }
  if(privateIndex.size!==(background?.contexts.length??0)||new Set([...privateIndex.values()].map(entry=>entry.conversationId)).size!==privateIndex.size)throw Error('Duplicate private background identity');
  if([...privateIndex.values()].some(b=>routeIndex.has(b.chatJid)||manifest.some(publicBinding=>publicBinding.conversationId===b.conversationId||publicBinding.branchId===b.branchId)))throw Error('Private background context overlaps a public route');
  const recoveryManifest = [...manifest,...privateIndex.values()].map(({chatJid,branchId,conversationId})=>({chatJid,branchId,conversationId}));
  const scopeFor = (chat:string)=>routeIndex.get(chat)??privateIndex.get(chat);
  const lookup = (chat: string, branch: string) => {
    const binding = scopeFor(chat);
    if (binding?.branchId !== branch) return undefined;
    if(privateIndex.get(chat)===binding)return binding;
    // Match the explicit synthetic-main contract used by branch preflight.
    if (branch !== "main" && !root.query(
      "SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL",
    ).get(chat, branch)) return undefined;
    return binding;
  };
  if (root.inTransaction || (root.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys !== 1)
    throw Error("Open idle FK-enabled root connection required");
  // Verify physical identity BEFORE any optional host schema mutation.
  const databaseGuard = { root, assertOwner: assert, fenceTransactions: true, contentionSignal: undefined as AbortSignal | undefined };
  database = new BunSqliteDatabase(path, databaseGuard);
  const candidateDatabase = database;
    await prepareHostSchema(root, assert, config.offlineInitialize === true, context.abortSignal, () => candidateDatabase.assertApplicationRoot(root));
    const work = value(createCurrentPiclawServiceWorkStore(root, { hitFault: () => false, recordTrace() {}, validateAcceptance(method, operationId) {
      assert(); return true;
    },
    }));
    const terminal = value(createCurrentPiclawTerminalSettlementStore(root, config.answers.resolver,
      { hitFault: () => false, recordTrace() {}, validateOwnership(operationId) { assert(); return true; } }));
    // Resolve only actual root messages and verify both accepted reference and source identity.
    async function content(ref: string, input: AcceptedInput | { chatJid: string; sourceId: string }) {
      assert();
      if(input.sourceId.startsWith('background:')){
        const payload=backgroundPayloads.get(input.sourceId);
        if(!payload||ref!==payload.policy.sourceId||nativeBackgroundIdentity(payload.policy).chatJid!==input.chatJid||!(privateIndex.has(input.chatJid)))throw Error('Unverified background input payload');
        return payload.prompt;
      }
      if (input.sourceId.startsWith("side-prompt:") && ref === input.sourceId &&
        (!("conversationId" in input) || bindings.resolveConversation(input) === input.conversationId)) {
        const payload = await config.answers.resolver.resolve(ref); assert();
        if (!payload || payload.ref !== ref || payload.mediaType !== "text/plain" || payload.redactionClass !== "private") throw Error("Unverified side prompt payload");
        const bytes = Uint8Array.from(payload.bytes);
        if (bytes.byteLength !== payload.byteLength || createHash("sha256").update(bytes).digest("hex") !== payload.sha256) throw Error("Unverified side prompt payload");
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      }
      if ("conversationId" in input && bindings.resolveConversation(input) === input.conversationId) {
        const row = root.query(`SELECT r.task_id,r.task_revision FROM main.service_effect_s07_occurrences r
          JOIN main.service_effect_s07_tasks h ON h.task_id=r.task_id AND h.current_revision=r.task_revision
            AND h.next_run_at=r.scheduled_for AND h.status='active'
          WHERE r.run_id=? AND r.operation_id=? AND r.accepted_source_seq=?`).get(input.sourceId, input.operationId, input.sourceSeq) as
          { task_id: string; task_revision: number } | null;
        if (!row) throw Error("Unverified scheduled payload");
        const definition = readScheduledDefinition(root, row.task_id, row.task_revision);
        if (!definition.body || definition.body.chat_jid !== input.chatJid || definition.snapshot.payloadRef !== ref) throw Error("Unverified scheduled payload");
        return definition.body.prompt;
      }
      return readApplicationMessagePayload(root, r.incarnation, input, ref);
    }
    const resolveBackground = (input:AcceptedInput) => {
      if(!input.sourceId.startsWith('background:'))return undefined;
      const payload=backgroundPayloads.get(input.sourceId),scope=privateIndex.get(input.chatJid);
      if(!payload||!scope)return undefined;
      const id=nativeBackgroundIdentity(payload.policy);
      if(id.contextKey!==scope.contextKey||id.chatJid!==input.chatJid||id.branchId!==input.branchId||id.operationId!==input.operationId||id.sourceId!==input.sourceId||input.payloadRef!==id.payloadRef||input.requestId!==id.requestId||input.conversationId!==scope.conversationId||
        input.requestHash!==hashCanonicalRequest({type:'input',requestId:id.requestId,content:payload.prompt}))throw Error('Background native binding conflict');
      const proof=root.query(`SELECT 1 FROM service_effect_s01_sources s JOIN service_effect_s01_operations o ON o.chat_jid=s.chat_jid AND o.primary_source_seq=s.source_seq
        JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq AND os.operation_id=o.operation_id
        WHERE s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=? AND s.kind='internal' AND s.provenance_ref=? AND o.operation_id=?`)
        .get(input.chatJid,input.sourceSeq,id.sourceId,id.payloadRef,backgroundPolicyProvenance(payload),id.operationId);
      if(!proof)throw Error('Background accepted source proof missing');return scope.conversationId;
    };
    const bindings = createHostDurableBindings(root, { domain: r.incarnation, incarnation: r.incarnation, manifest:recoveryManifest, getConversationBinding: lookup,
      assertOwner: assert, resolveContent: content,resolveBackground });
    controller = await createHostController({ acquireOwnership: async () => lease,
      createStorage: async () => SqliteStorage.open(candidateDatabase),
      runtime: { ...r, work, terminal, bindings,
        completeInputHandoff: createInputHandoffCompletion(root, { domain: r.incarnation, incarnation: r.incarnation,
          sessionId: r.sessionId, bindings, work, assertCurrent(input) { assert(); config.assertAdmission?.(input); } }),
        assertAdmission: config.assertAdmission, materializeAnswer: config.materializeAnswer, prepareTerminalEffect: config.prepareTerminalEffect, onOperationSettled: config.onOperationSettled, onMaintenanceSettled: config.onMaintenanceSettled, putAnswer: config.answers.put.bind(config.answers),
        replyThreadFor(input) { assert(); return resolveAcceptedMessageThread(root, input); },
        async cancelOperationSource(input, expectedVersion, retryTaskId) {
          await admitSqliteWrite(root, () => {
            assert();
            const operation = root.query("SELECT version,phase,cancellation_source_seq FROM service_effect_s01_operations WHERE operation_id=? AND chat_jid=?")
              .get(input.operationId, input.chatJid) as { version: number; phase: string; cancellation_source_seq: number | null } | null;
            if (!operation || operation.version !== expectedVersion || operation.phase === "terminal") throw Error("Abort operation changed");
            if (operation.cancellation_source_seq !== null) return;
            if (retryTaskId !== undefined) {
              const row = root.query("SELECT record FROM tasks WHERE id=? AND abort_requested=0 AND status<>'terminal'").get(retryTaskId) as {record:string} | null;
              const task = row && JSON.parse(row.record);
              if (!task || task.kind !== "pi.generation" || task.conversationId !== input.conversationId || task.state.checkpoint?.phase !== "retry") throw Error("Retry backoff already changed; no operation was cancelled");
            }
            const id = `operator-abort:${input.operationId}`;
            work.acceptAndCancelSourceInTransaction(sealed({ effect: effect(id), chatJid: input.chatJid, sourceId: id,
              kind: "cancellation", payloadRef: id, targetOperationId: input.operationId, parentSourceSeq: input.sourceSeq,
              acceptedAt: r.now(), createWakeIntent: false }), expectedVersion, "operator_abort", root);
            assert();
          }, assert);
        },
        async cancelSideSource(input) {
          await admitSqliteWrite(root, () => {
            assert();
            const operation = root.query("SELECT version,cancellation_source_seq FROM service_effect_s01_operations WHERE operation_id=?").get(input.operationId) as { version: number; cancellation_source_seq: number | null } | null;
            if (!operation) throw Error("Missing side operation");
            if (operation.cancellation_source_seq !== null) return;
            const id = `side-cancel:${input.sourceId}`;
            work.acceptAndCancelSourceInTransaction(sealed({ effect: effect(id), chatJid: input.chatJid, sourceId: id,
              kind: "cancellation", payloadRef: id, targetOperationId: input.operationId, parentSourceSeq: input.sourceSeq,
              acceptedAt: r.now(), createWakeIntent: false }), operation.version, "side_prompt_cancelled", root);
            assert();
          }, assert);
        },
        withPromptContextGuard: (check, body) => candidateDatabase.withAdmissionGuard(check, body),
        withIdleModelGuard: body => candidateDatabase.withAdmissionGuard(() => { assert(); config.assertAdmission?.(); },
          () => candidateDatabase.withIdleModelGuard(body)),
        withCompactionGuard: body => candidateDatabase.withAdmissionGuard(() => { assert(); config.assertAdmission?.(); },
          () => candidateDatabase.withCompactionGuard(body)),
        withSessionResetGuard: (chatJid, body) => candidateDatabase.withAdmissionGuard(() => { assert(); config.assertAdmission?.(); },
          () => candidateDatabase.withSessionResetGuard(chatJid, body)),
        existingConversationIds: recoveryManifest.map(b => b.conversationId),
        operationConversationFor: input => bindings.resolveConversation(input),
        conversationFor(chat, branch) { const b = lookup(chat, branch); if (!b) throw Error("Unbound conversation"); return b.conversationId; } },
      recovery: { manifest:recoveryManifest, work, bindings, async readAcceptedInput(source) {
        assert();
        if (source.kind !== "message" && source.kind !== "scheduled_agent" && source.kind !== "internal") throw Error("Unsupported recovered source");
        const binding = await bindings.findSource(source.chatJid, source.sourceSeq);
        const pendingSideOperation = !binding && source.kind === "internal" ? root.query(`SELECT o.operation_id FROM service_effect_s01_operations o
          JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=o.chat_jid AND os.source_seq=o.primary_source_seq
          JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid AND c.active_operation_id=o.operation_id
          WHERE o.chat_jid=? AND o.primary_source_seq=? AND o.phase='claimed' AND o.harness_session_id IS NULL`).get(source.chatJid, source.sourceSeq) as { operation_id: string } | null : null;
        const operationId = binding?.operationId ?? pendingSideOperation?.operation_id ?? source.targetOperationId;
        if (!operationId) throw Error("Missing recovered operation identity");
        const operation = value(await work.getOperation(operationId));
        const scope = scopeFor(source.chatJid);
        if (!operation || !scope) throw Error("Missing recovered operation");
        return { claimed: { source, operation }, branchId: scope.branchId,
          requestId: binding?.requestId ?? (pendingSideOperation ? source.sourceId : `queued-steer:${source.sourceId}`), content: await content(source.payloadRef, (source.kind === "scheduled_agent" || source.kind === "internal") && binding ? binding : source) };
      } },
    }, context);
    const activeController = controller;
    const runtime = activeController.runtime;
    // Controller/Harness construction is paused and finite. Activate only after
    // its internal failure drains finish, before runtime exposure or recovery.
    databaseGuard.contentionSignal = contentionSignal ? AbortSignal.any([contentionSignal, shutdown.signal]) : undefined;
    config.onRuntime?.(runtime);
    const adapter = createDurableConversationAdapter({ incarnation: r.incarnation, manifest, getConversationBinding: lookup, runtime,
      wait: wrapWait?.(runtime.wait.bind(runtime)),
      reconcileMaintenance(binding) {
        assertLive();
        if (activeController.recoveredMaintenanceChat === binding.chatJid) {
          const current = lookup(binding.chatJid, binding.branchId);
          if (binding.incarnation !== r.incarnation || current?.conversationId !== binding.conversationId) throw Error("Host binding conflict");
          return activeController.resumeRecoveredMaintenance().then(() => {});
        }
        return runtime.reconcileMaintenance(binding);
      } });
    const hostControls = new Map<Promise<unknown>, {chatJid:string;sourceId?:string}>();
    const messageObservers = new Set<Promise<void>>(), observedMessages = new Set<number>();
    const observeMessage = (input: AcceptedInput, submissionId: import("@earendil-works/pi-durable").SubmissionId) => {
      if (observedMessages.has(submissionId)) return;
      observedMessages.add(submissionId);
      const observer = runtime.waitForMessage(input, submissionId, shutdown.signal).then(async () => {
        const result = await runtime.readMessageResult(input);
        if (result) await config.onMessageResult?.(input,result);
      }).catch(error => {
        observedMessages.delete(submissionId);
        if (!shutdown.signal.aborted) observerLog.warn("Native result projection is unavailable; SDK result retained", {operation:"application.message_projection_pending",chatJid:input.chatJid,err:error});
      }).finally(()=>{messageObservers.delete(observer);observedMessages.delete(submissionId);});
      messageObservers.add(observer);
    };
    const dispatch: NonNullable<WebChannelOpts["dispatchAcceptedInput"]> = (chat, messageId, rowId, whenBusy="followUp") => {
      const admission=(async()=>{
      assertLive(); config.assertAdmission?.();
      const scope = routeIndex.get(chat);
      if (!scope || !lookup(chat,scope.branchId)) throw Error("Unbound native message conversation");
      const source = work.getAcceptedSource(chat,messageId);
      const row = root.query("SELECT id,chat_jid,content,timestamp,is_bot_message FROM messages WHERE rowid=?").get(rowId) as {id:string;chat_jid:string;content:string;timestamp:string;is_bot_message:number}|null;
      if (!source || source.kind!=="message" || !row || row.id!==messageId || row.chat_jid!==chat || row.is_bot_message!==0 ||
        ![`message-row:${rowId}`,`queued-source:${messageId}`].includes(source.payloadRef)) throw Error("Native accepted message identity conflict");
      const previous = await bindings.findSource(chat,source.sourceSeq); assertLive();
      if (previous && !isNativeMessageInput(previous)) throw Error("Existing host input cannot be resubmitted");
      if (!previous && (source.state!=="pending" || !/^application:pi-durable(?::|$)/.test(source.provenanceRef))) throw Error("Unsubmitted native source required");
      const requestId = `message:${rowId}:${messageId}`;
      const input: AcceptedInput = Object.freeze({incarnation:r.incarnation,conversationId:scope.conversationId as ConversationId,
        chatJid:chat,branchId:scope.branchId,operationId:`native-message:${scope.conversationId}:${source.sourceSeq}`,sourceSeq:source.sourceSeq,
        sourceId:messageId,payloadRef:source.payloadRef,requestId,requestHash:hashCanonicalRequest({type:"input",requestId,content:row.content})});
      const id = await runtime.submitMessage(input,whenBusy); assertLive();
      // Observe accepted SDK work even if a later Root cursor ACK is uncertain.
      // No callback here submits or resumes another input.
      observeMessage(input,id);
      // Transfer the new accepted source to its durable SDK submission. This is
      // an admission ACK/cursor, never host execution or terminal settlement.
      let pendingAck: {error:unknown}|undefined;
      try {
        await admitSqliteWrite(root,()=>{
          assertLive();
          const current = work.getAcceptedSource(chat,messageId);
          if (!current || current.sourceSeq!==source.sourceSeq || !["pending","consumed"].includes(current.state)) throw Error("Native source acknowledgement changed");
          root.query("UPDATE service_effect_s01_sources SET state='consumed' WHERE chat_jid=? AND source_seq=? AND state='pending'").run(chat,source.sourceSeq);
          root.query(`UPDATE service_effect_s01_chats SET consumed_through_source_seq=COALESCE(
            (SELECT MIN(source_seq)-1 FROM service_effect_s01_sources WHERE chat_jid=? AND state NOT IN ('consumed','disposed')),next_source_seq-1)
            WHERE chat_jid=?`).run(chat,chat);
          if(getChatCursor(chat)<row.timestamp)setChatCursor(chat,row.timestamp);
        },assertLive,shutdown.signal);
      } catch(error) { pendingAck={error}; }
      // A Root source/cursor ACK does not own SDK admission or placement. Read
      // exact immutable SDK evidence, then recheck current route/source/owner;
      // neither an ACK failure nor a request ID alone grants a successful reply.
      const state = await runtime.messageSubmissionStatus(input); assertLive();config.assertAdmission?.(input);
      bindings.assertSourceCurrent?.(input);
      if(!state||state.id!==id||lookup(chat,scope.branchId)?.conversationId!==scope.conversationId)throw Error("Native SDK admission evidence changed");
      if(pendingAck)observerLog.warn("SDK input accepted; Root source/cursor acknowledgement pending",{operation:"application.message_cursor_ack_pending",chatJid:chat,submissionId:id,err:pendingAck.error});
      return {submission_id:id,queued:state.status==="queued"};
      })();
      // Resource join only: this calls the SDK directly, never retains input
      // for retry, owns placement, or waits for model/operation settlement.
      hostControls.set(admission,{chatJid:chat,sourceId:messageId});
      void admission.finally(()=>hostControls.delete(admission)).catch(()=>{});
      return admission;
    };
    const filterNativeTimeline:NonNullable<WebChannelOpts["filterNativeTimeline"]>=async(chat,ids)=>{
      assertLive();if(!ids.length)return [];
      const rows=root.query(`SELECT m.rowid,b.conversation_id,b.submission_id,b.source_seq FROM messages m
        JOIN piclaw_durable_bindings_v1 b ON b.chat_jid=m.chat_jid AND b.source_id=m.id
        WHERE m.chat_jid=? AND m.rowid IN (${ids.map(()=>"?").join(",")}) AND b.domain=? AND b.incarnation=?
          AND b.operation_id LIKE 'native-message:%'`).all(chat,...ids,r.incarnation,r.incarnation) as {rowid:number;conversation_id:number;submission_id:number|null;source_seq:number}[];
      const hidden:number[]=[],pending=new Map<number,Set<number>>();
      for(const row of rows){
        if(row.submission_id===null){
          // A lost secondary ACK cannot turn an actual SDK queued input into a
          // timeline post. Qualify its public inbox identity/content, read-only.
          if(!pending.has(row.conversation_id)){
            const scope=routeIndex.get(chat);if(!scope||scope.conversationId!==row.conversation_id)throw Error("Native timeline binding changed");
            const inbox=await runtime.readMessageInbox({incarnation:r.incarnation,...scope});assertLive();
            pending.set(row.conversation_id,new Set(inbox.map(item=>item.input.sourceSeq)));
          }
          if(pending.get(row.conversation_id)!.has(row.source_seq))hidden.push(row.rowid);
          continue;
        }
        const record=await runtime.readSubmissionStatus(row.conversation_id,row.submission_id);assertLive();
        if(record?.type==="input"&&(record.status==="queued"||record.status==="unanswered"&&record.entry===undefined))hidden.push(row.rowid);
      }
      return hidden;
    };
    const readNativeQueue:NonNullable<WebChannelOpts["readNativeQueue"]>=async chat=>{
      assertLive();const scope=routeIndex.get(chat);if(!scope||!lookup(chat,scope.branchId))throw Error("Unbound native queue");
      const items=await runtime.readMessageInbox({incarnation:r.incarnation,...scope});assertLive();
      return items.map(item=>{
        const row=root.query("SELECT timestamp,thread_id FROM messages WHERE chat_jid=? AND id=?").get(chat,item.input.sourceId) as {timestamp:string;thread_id:number|null}|null;
        return {row_id:item.submissionId,content:item.content,timestamp:row?.timestamp??r.now(),thread_id:row?.thread_id??null,source:"native_sdk"};
      });
    };
    const controlNativeQueue:NonNullable<WebChannelOpts["controlNativeQueue"]>=async(chat,id,action,authorise)=>{
      const scope=routeIndex.get(chat);if(!scope||!lookup(chat,scope.branchId))throw Error("Unbound native queue");
      const check=()=>{assertLive();authorise?.();if(routeIndex.get(chat)!==scope||!lookup(chat,scope.branchId))throw Error("Native queue authority changed");};check();
      return candidateDatabase.withAdmissionGuard(check,()=>action==="remove"?runtime.removeQueuedMessage({incarnation:r.incarnation,...scope},id):runtime.steerQueuedMessage({incarnation:r.incarnation,...scope},id));
    };
    const getInputSourceAdmission = (chat: string, provenanceRef="application:pi-durable"): ReturnType<NonNullable<WebChannelOpts["getInputSourceAdmission"]>> => {
      const current = () => { const binding = routeIndex.get(chat); return binding && lookup(chat, binding.branchId); };
      assert(); if (!current()) throw Error("Unbound application conversation");
      return ({ message, rowId, database: connection }) => {
        assert(); if (!current()) throw Error("Unbound application conversation");
        if (connection !== root || !root.inTransaction) throw Error("Root admission transaction required");
        if (message.chat_jid !== chat) throw Error("Input admission chat mismatch");
        const stored = root.query("SELECT id, chat_jid, is_bot_message FROM messages WHERE rowid=?").get(rowId) as { id: string; chat_jid: string; is_bot_message: number } | null;
        if (!Number.isSafeInteger(rowId) || rowId <= 0 || stored?.id !== message.id || stored.chat_jid !== chat || stored.is_bot_message !== 0)
          throw Error("Input admission message row mismatch");
        const input = { effect: { idempotencyKey: message.id, requestHash: "", operationId: null, sourceSeq: null,
          provenanceRef, redactionClass: "private" as const }, chatJid: chat, sourceId: message.id,
          kind: "message" as const, payloadRef: `message-row:${rowId}`, targetOperationId: null, parentSourceSeq: null,
          acceptedAt: message.timestamp, createWakeIntent: false };
        input.effect.requestHash = hashCanonicalRequest(input as unknown as CanonicalJsonValue);
        const checkInput = () => {
          const result = assertInputAdmission?.(chat, message.content);
          if (result !== undefined) {
            void Promise.resolve(result).catch(() => {});
            throw Error("Input admission guard must be synchronous");
          }
        };
        checkInput();
        work.acceptSourceInTransaction(input, connection);
        checkInput();
        assert();
      };
    };
    const getDurableSession = (chat: string) => {
      const binding = routeIndex.get(chat);
      if (!binding || !lookup(chat, binding.branchId)) return undefined;
      const assertCurrent = () => {
        assertLive();
        if (routeIndex.get(chat) !== binding || lookup(chat, binding.branchId)?.conversationId !== binding.conversationId) throw Error("Host control binding changed");
      };
      const readAbortScope = async (): Promise<DurableAbortScope | null> => {
        assertCurrent();
        const native=await runtime.readMessageAbortScope({incarnation:r.incarnation,...binding});assertCurrent();
        if(native)return native;
        const frontier = value(await work.getChatFrontier(chat)); assertCurrent();
        if (!frontier.activeOperationId) return null;
        const operation = value(await work.getOperation(frontier.activeOperationId)); assertCurrent();
        if (!operation || operation.terminal) return null;
        return Object.freeze({ operationId: operation.operationId, conversationId: binding.conversationId, sourceSeq: operation.primarySourceSeq });
      };
      const abort = async (retryOnly = false, expected?: DurableAbortScope) => {
          assertCurrent();
          const native=await runtime.readMessageAbortScope({incarnation:r.incarnation,...binding},retryOnly);assertCurrent();
          if(native){
            if(expected&&durableAbortScopeKey(expected)!==durableAbortScopeKey(native))return false;
            await runtime.abortMessages({incarnation:r.incarnation,...binding},native);assertCurrent();return true;
          }
          if(expected?.kind==="sdk")return false;
          const frontier = value(await work.getChatFrontier(chat)); assertLive();
          if (!frontier.activeOperationId) return false;
          const operation = value(await work.getOperation(frontier.activeOperationId)); assertLive();
          if (!operation || operation.terminal) return false;
          if (expected && (expected.operationId !== operation.operationId || expected.conversationId !== binding.conversationId || expected.sourceSeq !== operation.primarySourceSeq)) return false;
          const input = await bindings.findSource(chat, operation.primarySourceSeq); assertLive();
          if (!input || input.operationId !== operation.operationId || input.conversationId !== binding.conversationId)
            throw Error("Exact ordinary abort binding required");
          return runtime.abortOperation(input, retryOnly);
      };
      return Object.freeze({ ...adapter.sessionPosition(chat, binding.branchId, binding.sessionId),
        assertCurrent, lifetimeSignal: shutdown.signal,
        ...(config.readExecutionPolicy && config.setExecutionPolicy ? {
          readExecutionPolicy: async () => { assertCurrent(); return config.readExecutionPolicy!(); },
          setExecutionPolicy: async (name: "autoCompact" | "autoRetry", enabled: boolean) => { assertCurrent(); config.assertAdmission?.(); await config.setExecutionPolicy!(name, enabled); assertCurrent(); },
        } : {}),
        ...(config.requestProcessExit ? { requestExit: async (reason: string) => {
          assertCurrent(); config.assertAdmission?.();
          await config.requestProcessExit!(reason);
        } } : {}),
        runOwnedControl<T>(operation: () => Promise<T>): Promise<T> {
          assertCurrent(); config.assertAdmission?.();
          // Register before callback entry so close can join credential writes.
          const running = Promise.resolve().then(() => { assertCurrent(); config.assertAdmission?.(); return operation(); });
          hostControls.set(running, {chatJid:chat});
          void running.finally(() => hostControls.delete(running)).catch(() => {});
          return running;
        },
        readAbortScope, abort: (expected?: DurableAbortScope) => abort(false, expected), abortRetry: (expected?: DurableAbortScope) => abort(true, expected),
        runBash: (command: string) => { assertCurrent(); return runtime.runSessionBash({incarnation:r.incarnation,...binding}, command); },
        abortBash: () => { assertCurrent(); return runtime.abortSessionBash({incarnation:r.incarnation,...binding}); },
        async restart() {
          assertCurrent(); config.assertAdmission?.();
          await runtime.abortSessionBash({incarnation:r.incarnation,...binding}, true);
          await abort();
          const deadline = Date.now() + 5000;
          while (root.query("SELECT 1 FROM service_effect_s01_operations WHERE chat_jid=? AND phase<>'terminal'").get(chat)) {
            assertCurrent();
            if (Date.now() >= deadline) throw Error("Native abort is still settling; restart refused without replay. Try /restart after Idle.");
            await new Promise(resolve => setTimeout(resolve,100));
          }
          assertCurrent(); await runtime.reloadSession({incarnation:r.incarnation,...binding});
        } });
    };
    const preparing = new Map<string, Promise<void>>();
    const assertLive = () => { assert(); if (closing || shutdown.signal.aborted) throw Error("Application closing"); };
    function dreamSourceFor(conversationId:number){
      assertLive();
      const source=dreamSources.get(conversationId);
      if(!source&&[...privateIndex.values()].some(entry=>entry.conversationId===conversationId))throw Error('Retired or unknown private execution source');
      return source;
    }
    function dispatchDreamPayload(raw:NativeBackgroundPayload,signal:AbortSignal):Promise<AgentOutput>{
      const payload=readNativeBackgroundPayload(raw);
      if(payload.policy.origin.kind!=='dream')throw Error('Only native Dream execution is supported');
      const running=(async():Promise<AgentOutput>=>{
        assertLive();config.assertAdmission?.();signal.throwIfAborted();
        if(!background)throw Error('Dream SDK ports unavailable');
        const check=()=>{assertLive();signal.throwIfAborted();background.assertCurrent(payload);};check();
        const identity=nativeBackgroundIdentity(payload.policy),prior=backgroundPayloads.get(payload.policy.sourceId);
        if(prior)assertNativeBackgroundRetry(prior.policy,payload.policy);
        if(routeIndex.has(identity.chatJid))throw Error('Private Dream identity overlaps public context');
        await background.put(payload);check();
        let context=privateIndex.get(identity.chatJid);
        if(!context){
          const created=await candidateDatabase.withAdmissionGuard(check,()=>activeController.addConversation(tx=>background.publish(tx,payload),check));check();
          if(created.contextKey!==identity.contextKey||created.chatJid!==identity.chatJid||created.branchId!==identity.branchId)throw Error('Dream publication identity changed');
          context=Object.freeze({...created});privateIndex.set(identity.chatJid,context);
        }
        if(context.contextKey!==identity.contextKey||context.branchId!==identity.branchId)throw Error('Dream SDK context changed');
        backgroundPayloads.set(payload.policy.sourceId,payload);
        dreamSources.set(context.conversationId,Object.freeze({context,payload}));
        const result=await runtime.runDreamConversation(context,payload,check,signal);
        if(result.status.type==='input'&&result.status.status==='done'&&result.answer)return{status:'success',result:result.answer.text,usage:result.answer.message.usage};
        const category=result.status.type==='input'&&result.status.status==='unanswered'?parseModelFailure(result.status.detail)?.category:undefined;
        return{status:'error',result:null,error:result.timedOut?'Native Dream deadline expired':'Native Dream did not complete',failureCategory:result.timedOut||category==='timeout'?'timeout':category==='aborted'?'aborted':category==='budget'?'provider_budget':'provider'};
      })();
      dreamInvocations.add(running);void running.finally(()=>dreamInvocations.delete(running)).catch(()=>{});return running;
    }
    function prepareInputSourceAdmission(chat: string): Promise<void> {
      assert(); config.assertAdmission?.();
      if (closing || shutdown.signal.aborted) return Promise.reject(Error("Application closing"));
      const published = routeIndex.get(chat);
      if (published) return lookup(chat, published.branchId) ? Promise.resolve() : Promise.reject(Error("Native branch is archived or changed"));
      const pending = preparing.get(chat); if (pending) return pending;
      let committedPossible = false;
      const promise = (async () => {
        config.assertConversationAvailable?.();
        if (!createConversation) throw Error("Unbound application conversation");
        const row = root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND root_chat_jid=? AND parent_branch_id IS NULL AND archived_at IS NULL").get(chat, chat) as { branch_id: string } | null;
        if (!row || !canonical(chat)) throw Error("Existing root branch required");
        const assertRoot = () => {
          assertLive(); config.assertAdmission?.();
          const current = root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND root_chat_jid=? AND parent_branch_id IS NULL AND archived_at IS NULL").get(chat, chat) as { branch_id: string } | null;
          if (current?.branch_id !== row.branch_id) throw Error("Root branch changed");
        };
        const binding = await candidateDatabase.withAdmissionGuard(assertRoot,
          () => activeController.addConversation(async tx => {
          assertLive(); config.assertAdmission?.();
          const current = root.query("SELECT branch_id FROM chat_branches WHERE chat_jid=? AND root_chat_jid=? AND parent_branch_id IS NULL AND archived_at IS NULL").get(chat, chat) as { branch_id: string } | null;
          if (current?.branch_id !== row.branch_id) throw Error("Root branch changed");
          const created = await createConversation(tx, chat, row.branch_id);
          assertRoot();
          return created;
        }, () => { assertRoot(); committedPossible = true; }));
        assertRoot();
        // One publication point. Every ingress and session lookup uses this record.
        routeIndex.set(chat, Object.freeze({ ...binding }));
      })().then(() => { if (preparing.get(chat) === promise) preparing.delete(chat); }, error => {
        // Only failures proven to precede the public commit attempt are retryable.
        // Any rejection after that boundary (including publication) is uncertain.
        if (!committedPossible && preparing.get(chat) === promise) preparing.delete(chat);
        throw error;
      });
      // Uncertain failures require reopening from the canonical SDK mapping.
      preparing.set(chat, promise); return promise;
    }
    let bound = false, closing: Promise<void> | undefined;
    releaseBranchControlGuard = registerNativeBranchControlGuard(root, chats => {
      assertLive(); runtime.assertBranchControlsIdle(chats);
      if ([...hostControls.values()].some(control => chats.includes(control.chatJid))) throw Error("Native branch has active native controls");
      return undefined;
    });
    async function allocateSidePromptConversation(raw: AcceptedInput): Promise<AcceptedInput> {
      const input = Object.freeze({ ...raw });
      const scope = routeIndex.get(input.chatJid);
      const check = () => {
        assertLive(); config.assertAdmission?.();
        if (!scope || routeIndex.get(input.chatJid) !== scope || lookup(input.chatJid, scope.branchId) !== scope || input.incarnation !== r.incarnation || input.branchId !== scope.branchId ||
          !/^side-prompt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.sourceId) ||
          input.requestId !== input.sourceId || input.payloadRef !== input.sourceId) throw Error("Side prompt source authority unavailable");
        const source = root.query(`SELECT 1 FROM service_effect_s01_sources s
          JOIN service_effect_s01_operations o ON o.operation_id=? AND o.chat_jid=s.chat_jid AND o.primary_source_seq=s.source_seq
          JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
          JOIN service_effect_s01_chats c ON c.chat_jid=s.chat_jid AND c.active_operation_id=o.operation_id
          WHERE s.chat_jid=? AND s.source_seq=? AND s.source_id=? AND s.payload_ref=? AND s.kind='internal' AND s.state='claimed'
            AND o.phase IN ('claimed','executing')`).get(input.operationId, input.chatJid, input.sourceSeq, input.sourceId, input.payloadRef);
        if (!source) throw Error("Side prompt source authority unavailable");
      };
      check();
      const prior = await bindings.findSource(input.chatJid, input.sourceSeq); check();
      if (prior) {
        if (Object.entries(input).some(([key, value]) => key !== "conversationId" && prior[key as keyof typeof prior] !== value) ||
          bindings.resolveConversation({ ...input, conversationId: prior.conversationId }) !== prior.conversationId) throw Error("Side prompt binding conflict");
        return Object.freeze({ ...input, conversationId: prior.conversationId });
      }
      if (input.conversationId !== scope!.conversationId) throw Error("Side prompt parent mismatch");
      let allocated: AcceptedInput | undefined;
      await candidateDatabase.withHostSourceGuard(check, async tx => {
        if (!allocated) return;
        const b = allocated;
        await tx.run(`INSERT INTO piclaw_durable_bindings_v1
          (domain,incarnation,conversation_id,chat_jid,branch_id,operation_id,source_seq,source_id,payload_ref,request_id,request_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, r.incarnation, r.incarnation, b.conversationId, b.chatJid, b.branchId,
          b.operationId, b.sourceSeq, b.sourceId, b.payloadRef, b.requestId, b.requestHash);
      }, () => runtime.allocateSidePromptFork(scope!.conversationId as ConversationId, id => { allocated = Object.freeze({ ...input, conversationId: id }); }));
      check();
      if (!allocated) throw Error("Side prompt fork not published");
      return allocated;
    }
    async function allocateScheduledConversation(raw: ScheduledRunLease): Promise<AcceptedInput> {
      const lease = structuredClone(raw), record = lease.record;
      const scope = routeIndex.get(lease.task.chatJid);
      if (!scope || lease.task.kind !== "agent") throw Error("Unbound scheduled root");
      const read = () => {
        assertLive();
        const row = root.query(`SELECT s.source_seq,s.source_id,s.payload_ref,o.operation_id,v.snapshot_json
          FROM service_effect_s07_occurrences r
          JOIN service_effect_s07_tasks h ON h.task_id=r.task_id AND h.current_revision=r.task_revision AND h.status='active' AND h.next_run_at=r.scheduled_for
          JOIN service_effect_s07_task_revisions v ON v.task_id=r.task_id AND v.revision=r.task_revision
          JOIN service_effect_s01_sources s ON s.source_seq=r.accepted_source_seq AND s.source_id=r.run_id
          JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq AND os.operation_id=r.operation_id
          JOIN service_effect_s01_operations o ON o.operation_id=r.operation_id AND o.primary_source_seq=s.source_seq AND o.phase IN ('claimed','executing')
          JOIN service_effect_s01_chats c ON c.chat_jid=s.chat_jid AND c.active_operation_id=o.operation_id
          WHERE r.run_id=? AND r.state='source_bound' AND r.worker_id=? AND r.attempt=? AND r.task_revision=?
            AND r.lease_token_hash=? AND r.lease_expires_at>? AND s.kind='scheduled_agent' AND s.state='claimed'
            AND s.chat_jid=? AND s.payload_ref=?`)
          .get(record.runId, record.workerId, record.attempt, record.taskRevision, hashScheduledLeaseToken(lease.leaseToken), r.now(),
            scope.chatJid, lease.task.payloadRef) as
            { source_seq: number; source_id: string; payload_ref: string; operation_id: string; snapshot_json: string } | null;
        if (!row || hashCanonicalRequest(JSON.parse(row.snapshot_json)) !== hashCanonicalRequest(lease.task as unknown as CanonicalJsonValue)) throw Error("Scheduled source authority unavailable");
        const definition = readScheduledDefinition(root, record.taskId, record.taskRevision);
        if (!definition.body || definition.body.chat_jid !== scope.chatJid || definition.snapshot.payloadRef !== lease.task.payloadRef) throw Error("Scheduled payload unavailable");
        return { ...row, prompt: definition.body.prompt };
      };
      const source = read(), requestId = `scheduled:${record.runId}`;
      const label = lease.task.modelLabel;
      let model: Readonly<{ provider: string; modelId: string }> | undefined;
      const checkModel = () => {
        if (label === null) return;
        const slash = label.indexOf("/");
        if (slash <= 0 || slash === label.length - 1 || /\s/.test(label)) throw Error("Malformed scheduled model");
        if (!resolveScheduledModel) throw Error("Scheduled model override unavailable");
        const resolved = resolveScheduledModel(label);
        if (resolved.provider !== label.slice(0, slash) || resolved.modelId !== label.slice(slash + 1)) throw Error("Scheduled model resolution conflict");
        if (model && (model.provider !== resolved.provider || model.modelId !== resolved.modelId)) throw Error("Scheduled model changed");
        model ??= Object.freeze({ provider: resolved.provider, modelId: resolved.modelId });
      };
      checkModel();
      const base = { incarnation: r.incarnation, chatJid: scope.chatJid, branchId: scope.branchId,
        operationId: source.operation_id, sourceSeq: source.source_seq, sourceId: source.source_id,
        payloadRef: source.payload_ref, requestId,
        requestHash: hashCanonicalRequest({ type: "input", requestId, content: source.prompt }) };
      const prior = await bindings.findSource(scope.chatJid, source.source_seq);
      read();
      if (prior) {
        if (Object.entries(base).some(([key, val]) => prior[key as keyof AcceptedInput] !== val)) throw Error("Scheduled binding conflict");
        return prior;
      }
      let conversationId: import("@earendil-works/pi-durable").ConversationId | undefined, persisted = false;
      await candidateDatabase.withHostSourceGuard(() => { read(); checkModel(); }, async tx => {
        if (conversationId === undefined || persisted) return;
        await tx.run(`INSERT INTO piclaw_durable_bindings_v1
          (domain,incarnation,conversation_id,chat_jid,branch_id,operation_id,source_seq,source_id,payload_ref,request_id,request_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, r.incarnation, r.incarnation, conversationId, base.chatJid, base.branchId,
          base.operationId, base.sourceSeq, base.sourceId, base.payloadRef, base.requestId, base.requestHash);
        persisted = true;
      }, () => runtime.allocateScheduledFork(scope.conversationId, id => { conversationId = id; }, model));
      if (conversationId === undefined || !persisted) throw Error("Scheduled fork not published");
      return Object.freeze({ ...base, conversationId });
    }
    const sideContinuations = new Map<string, { identity: string; promise: Promise<SidePromptResult> }>();
    function continueSidePrompt(raw: AcceptedInput, signal?: AbortSignal): Promise<SidePromptResult> {
      assertLive();
      const input = Object.freeze({ ...raw });
      const key = JSON.stringify([input.chatJid, input.sourceId]);
      const identity = hashCanonicalRequest(input as unknown as CanonicalJsonValue);
      const pending = sideContinuations.get(key);
      if (pending) {
        if (pending.identity !== identity) throw Error("Side prompt continuation conflict");
        return pending.promise;
      }
      const continuing = (async () => {
        const allocated = await allocateSidePromptConversation(input);
        const id = await runtime.submit(allocated);
        const operation = value(await work.getOperation(allocated.operationId)); assertLive();
        if (operation?.harness?.sessionId !== r.sessionId || operation.harness.harnessOperationId !== String(id))
          throw Error('Exact completed side handoff required');
        let cancelling: Promise<void> | undefined;
        let timedOut = false;
        const timeoutMs = getAgentRuntimeConfig().timeoutMs;
        const cancel = () => {
          cancelling ??= runtime.abortSidePrompt(allocated);
          void cancelling.catch(() => {}); // Joined below; never leave listener rejection unobserved.
        };
        const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; cancel(); }, timeoutMs) : undefined;
        signal?.addEventListener("abort", cancel, { once: true });
        let waitFailed = false, waitError: unknown;
        try {
          if (signal?.aborted) cancel();
          if (cancelling) await cancelling;
          else await runtime.wait(allocated, id, shutdown.signal);
          if (cancelling) await cancelling;
        } catch (error) {
          waitFailed = true; waitError = error;
        } finally {
          signal?.removeEventListener("abort", cancel);
          if (timer !== undefined) clearTimeout(timer);
          if (cancelling) {
            try { await cancelling; }
            catch (error) {
              if (waitFailed && error !== waitError) throw new AggregateError([waitError, error], "Side wait and cancellation failed");
              throw error;
            }
          }
        }
        if (waitFailed) throw waitError;
        const state = await runtime.reconcile(allocated);
        if (state.operation.cancellation) {
          if (!await runtime.settle(allocated)) throw Error("Side cancellation settlement pending");
          return { status: "error" as const, result: null, thinking: null, model: null, error: timedOut ? `Timed out after ${formatTimeoutDuration(timeoutMs)}` : "Side prompt cancelled", stopReason: "aborted" };
        }
        if (!state.answer) throw Error("Side prompt answer unavailable");
        const result = { status: "success" as const, result: state.answer.text, thinking: state.answer.message.content
          .filter(block => block.type === "thinking").map(block => block.thinking).join(""),
          model: `${state.answer.message.provider}/${state.answer.message.model}`, usage: state.answer.message.usage, stopReason: state.answer.message.stopReason };
        await config.answers.put(`side-result:${allocated.sourceId}`, JSON.stringify(result)); assertLive();
        if (!await runtime.settle(allocated)) throw Error("Side prompt settlement pending");
        return result;
      })();
      const promise = continuing.then(result => {
        sideContinuations.delete(key);
        return result;
      });
      sideContinuations.set(key, { identity, promise });
      // Keep unknown failures owned until reopen; do not replay a failed storage
      // admission in a possibly sealed SDK instance. No second request identity.
      return promise;
    }
    async function reconcileSidePrompt(chatJid: string, sourceId: string): Promise<SidePromptResult> {
      assertLive();
      const scope = routeIndex.get(chatJid);
      const source = work.getAcceptedSource(chatJid, sourceId);
      if (!scope || !source || source.kind !== "internal" || source.state !== "claimed" || source.payloadRef !== sourceId ||
        !/^side-prompt:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(sourceId)) throw Error("Unverified side prompt recovery");
      const row = root.query(`SELECT o.operation_id FROM service_effect_s01_operations o
        JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=o.chat_jid AND os.source_seq=o.primary_source_seq
        JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid AND c.active_operation_id=o.operation_id
        WHERE o.chat_jid=? AND o.primary_source_seq=? AND o.phase IN ('claimed','executing')`).get(chatJid, source.sourceSeq) as { operation_id: string } | null;
      if (!row) throw Error("Unverified side prompt recovery");
      const prompt = await content(source.payloadRef, source); assertLive();
      return continueSidePrompt({ incarnation: r.incarnation, conversationId: scope.conversationId as ConversationId,
        chatJid, branchId: scope.branchId, operationId: row.operation_id, sourceSeq: source.sourceSeq, sourceId, payloadRef: sourceId,
        requestId: sourceId, requestHash: hashCanonicalRequest({ type: "input", requestId: sourceId, content: prompt }) });
    }
    async function dispatchSidePrompt(chatJid: string, prompt: string, options: SidePromptOptions = {}): Promise<SidePromptResult> {
      const origin=getExecutionIdentity();
      const assertOrigin=()=>{
        assertLive();config.assertAdmission?.();
        if(readAccessConfig().mode!=='single-user'||(origin&&origin.mode!=='single-user')||getExecutionIdentity()!==origin)throw Error('Side prompt caller authority unavailable');
      };
      assertOrigin();
      options.signal?.throwIfAborted();
      if (((options.onEvent || options.onTextDelta || options.onThinkingDelta) && !config.observeSidePrompt))
        throw Error("Native side prompt options unavailable");
      if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 100_000 ||
        (options.systemPrompt !== undefined && typeof options.systemPrompt !== "string")) throw Error("Invalid side prompt");
      // Match the existing side-session composition; do not mutate parent instructions.
      prompt = options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt;
      if (prompt.length > 100_000) throw Error("Invalid side prompt");
      const scope = routeIndex.get(chatJid);
      if (!scope) throw Error("Unbound side prompt chat");
      const checkScope = () => {
        assertOrigin();
        if (!scope || routeIndex.get(chatJid) !== scope || lookup(chatJid, scope.branchId) !== scope) throw Error("Unbound side prompt chat");
      };
      checkScope();
      if (await runtime.readSessionPosition({ incarnation: r.incarnation, ...scope }) === null) throw Error("Side prompt history unavailable");
      checkScope();
      const retryId = options.requestId;
      if (retryId !== undefined && (typeof retryId !== "string" || !retryId.trim() || retryId !== retryId.trim() || retryId.length > 1024)) throw Error("Invalid side prompt request identity");
      const sourceId = retryId ? sidePromptSourceId(chatJid, retryId) : `side-prompt:${crypto.randomUUID()}`;
      const prior = work.getAcceptedSource(chatJid, sourceId);
      if (prior) {
        const storedPrompt = await content(sourceId, prior); checkScope();
        if (storedPrompt !== prompt || prior.kind !== "internal") throw Error("Side prompt retry identity conflict");
        const row = root.query(`SELECT o.operation_id FROM service_effect_s01_operations o
          JOIN service_effect_s01_operation_sources os ON os.operation_id=o.operation_id AND os.chat_jid=o.chat_jid AND os.source_seq=o.primary_source_seq
          WHERE o.chat_jid=? AND o.primary_source_seq=?`).get(chatJid, prior.sourceSeq) as { operation_id: string } | null;
        if (!row) throw Error("Side prompt retry identity conflict");
        const committed = value(await terminal.getTerminal(row.operation_id)); checkScope();
        if (!committed) { return reconcileSidePrompt(chatJid, sourceId); }
        if (committed.disposition !== "completed") return { status: "error", result: null, thinking: null, model: null, error: "Side prompt cancelled", stopReason: "aborted" };
        const payload = await config.answers.resolver.resolve(`side-result:${sourceId}`); checkScope();
        if (!payload || payload.ref !== `side-result:${sourceId}` || payload.mediaType !== "text/plain" || payload.redactionClass !== "private") throw Error("Side prompt result unavailable");
        const bytes = Uint8Array.from(payload.bytes);
        if (bytes.byteLength !== payload.byteLength || createHash("sha256").update(bytes).digest("hex") !== payload.sha256) throw Error("Side prompt result unavailable");
        const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as SidePromptResult;
        if (!result || result.status !== "success" || typeof result.result !== "string" ||
          (result.thinking !== null && typeof result.thinking !== "string") || typeof result.model !== "string" ||
          (result.stopReason !== "stop" && result.stopReason !== "length") ||
          !result.usage || [result.usage.input, result.usage.output, result.usage.cacheRead, result.usage.cacheWrite, result.usage.totalTokens,
            result.usage.cost?.input, result.usage.cost?.output, result.usage.cost?.cacheRead, result.usage.cost?.cacheWrite, result.usage.cost?.total]
            .some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) throw Error("Invalid side prompt stored result");
        return result;
      }
      // Immutable payload may outlive denied admission; it never grants authority.
      await config.answers.put(sourceId, prompt); checkScope(); options.signal?.throwIfAborted();
      const claimed = await admitSqliteWrite(root, () => {
        checkScope();
        const busy = root.query(`SELECT consumed_through_source_seq,active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?`).get(chatJid) as
          { consumed_through_source_seq: number; active_operation_id: string | null } | null;
        if (busy?.active_operation_id) throw Error("Side prompt chat is busy");
        const accepted = work.acceptAndClaimSourceInTransaction(sealed({ effect: { ...effect(`accept:${sourceId}`), provenanceRef: "application:side-prompt" },
          chatJid, sourceId, kind: "internal" as const, payloadRef: sourceId, targetOperationId: null, parentSourceSeq: null,
          acceptedAt: r.now(), createWakeIntent: false }), sealed({ effect: { ...effect(`claim:${sourceId}`), provenanceRef: "application:side-prompt" },
          chatJid, expectedFrontier: busy?.consumed_through_source_seq ?? 0, newOperationId: `operation:${sourceId}`, claimedAt: r.now() }), root);
        checkScope(); return accepted;
      }, () => { checkScope();  }, options.signal);
      let observerFailed = false;
      const synchronous = (value: unknown) => {
        if (isPromise(value)) {
          void Promise.prototype.catch.call(value, () => {});
          throw new TypeError("Side prompt observers must be synchronous");
        }
      };
      const unobserve = config.observeSidePrompt?.(sourceId, event => {
        assertLive();
        if (observerFailed || options.signal?.aborted) return;
        try {
          const text = event.type === "text_delta" ? event.delta : undefined;
          const thinking = event.type === "thinking_delta" ? event.delta : undefined;
          synchronous(options.onEvent?.(event));
          if (text !== undefined) synchronous(options.onTextDelta?.(text));
          if (thinking !== undefined) synchronous(options.onThinkingDelta?.(thinking));
        } catch {
          // Callback failures detach this observer, not provider execution.
          observerFailed = true;
          observerLog.warn("Side prompt observer detached", { operation: "application.side_observer_failed", sourceId });
        }
      });
      try {
        return await continueSidePrompt({ incarnation: r.incarnation, conversationId: scope.conversationId as ConversationId,
          chatJid, branchId: scope.branchId, operationId: claimed.operation.operationId, sourceSeq: claimed.source.sourceSeq,
          sourceId, payloadRef: sourceId, requestId: sourceId, requestHash: hashCanonicalRequest({ type: "input", requestId: sourceId, content: prompt }) }, options.signal);
      } finally { unobserve?.(); }
    }
    async function dispatchScheduledAgent(lease: ScheduledRunLease): Promise<import("../../src/agent-pool.js").AgentOutput> {
      assertLive(); config.assertAdmission?.();
      const input = await allocateScheduledConversation(lease);
      const id = await runtime.submit(input); assertLive();
      const operation = value(await work.getOperation(input.operationId));
      if (!operation) throw Error("Missing scheduled operation");
      if (operation.harness?.sessionId !== r.sessionId || operation.harness.harnessOperationId !== String(id))
        throw Error('Exact completed scheduled handoff required');
      await runtime.wait(input, id, shutdown.signal); assertLive();
      const state = await runtime.reconcile(input);
      if (!state.answer) throw Error("Scheduled answer unavailable");
      if (!await runtime.settle(input)) throw Error("Scheduled settlement pending");
      return { status: "success", result: state.answer.text };
    }
    let inputProjection: Parameters<typeof admitWebMessage>[0] | undefined;
    const applicationInput = createApplicationHostInput({root,domain:r.incarnation,assertCurrent:assertLive,
      routes:()=>[...routeIndex.values()].filter(binding=>lookup(binding.chatJid,binding.branchId)),
      admission:getInputSourceAdmission,submit:dispatch});
    return Object.freeze({
      ...applicationInput,
      // Inventory only. The process coordinator supplies the original owner
      // fence, including its final check after the borrowed SDK lease closes.
      assertProcessControlIdle(input?:AcceptedInput) {
        const otherControl=[...hostControls.values()].some(control=>!input||control.chatJid!==input.chatJid||control.sourceId!==input.sourceId);
        if (preparing.size || otherControl || dreamInvocations.size) throw Error("Host admission or credential/control work is active or uncertain");
      },
      bindInputProjection(projection: Parameters<typeof admitWebMessage>[0] | undefined) {
        if (projection) { assertLive(); if (inputProjection) throw Error("Application input projection already bound"); }
        inputProjection = projection;
      },
      /** Existing native dispatcher; call only after ordinary queue materialisation. */
      dispatchAcceptedInput: dispatch,
      /** Construct pool first from this snapshot, then bind its existing channel constructor. */
      admitHostFollowup(input: { sourceId: string; chatJid: string; text: string; queuedAt: string }) {
        assertLive();config.assertAdmission?.();
        return root.transaction(()=>{
          const accept=getInputSourceAdmission(input.chatJid);if(!accept)throw Error("Native Goal source admission unavailable");
          const prior=root.query("SELECT rowid,content,is_bot_message FROM messages WHERE chat_jid=? AND id=?").get(input.chatJid,input.sourceId) as {rowid:number;content:string;is_bot_message:number}|null;
          if(prior){
            const source=work.getAcceptedSource(input.chatJid,input.sourceId);
            if(prior.is_bot_message!==0||prior.content!==input.text||source?.provenanceRef!=="application:pi-durable")throw Error("Native Goal input identity conflict");
            return prior.rowid;
          }
          const message={id:input.sourceId,chat_jid:input.chatJid,sender:"goal",sender_name:"User",content:input.text,
            timestamp:input.queuedAt,is_from_me:false,is_bot_message:false};
          const rowId=storeMessageInDatabase(root,message);
          accept({message,rowId,database:root});
          return rowId;
        }).immediate();
      },
      dispatchDreamPayload,dreamSourceFor,
      sessionOptions: Object.freeze({ getDurableSession, dispatchScheduledAgent, dispatchSidePrompt,
        prepareInterruptedScheduledHarness: config.prepareInterruptedScheduledHarness ? async identity => { assertLive(); const fence = await config.prepareInterruptedScheduledHarness!(identity); assertLive(); return fence ? () => { assertLive(); fence(); } : undefined; } : undefined,
        dispatchHostCommand: config.dispatchHostCommand ? (chat: string, text: string) => { assertLive(); if (!routeIndex.has(chat)) throw Error("Unbound command chat"); return config.dispatchHostCommand!(chat, text); } : undefined }),
      allocateScheduledConversation, allocateSidePromptConversation, dispatchSidePrompt, reconcileSidePrompt,
      bind(options: Pick<WebChannelOpts, "queue" | "agentPool">): Readonly<WebChannelOpts> {
        assert(); if (bound || closing) throw Error("Application bundle already bound or closing");
        bound = true;
        return Object.freeze({ ...options, prepareInputSourceAdmission, getInputSourceAdmission,
          prepareInputText: prepareInputText ? (chat: string, text: string) => { assertLive(); if (!routeIndex.has(chat)) throw Error("Unbound input preparation"); return prepareInputText(chat, text); } : undefined,
          dispatchAcceptedInput: dispatch, filterNativeTimeline, readNativeQueue, controlNativeQueue });
      },
      /** Continue the existing command worker's same-task settlement; no queue replay. */
      reconcileMaintenance(chatJid: string): Promise<void> {
        assertLive();
        const position = getDurableSession(chatJid);
        if (!position?.reconcileMaintenance) throw Error("Unbound maintenance reconciliation");
        return position.reconcileMaintenance();
      },
      retryRecoveredWork: activeController.reconcileRecovered,
      stop() { inputProjection = undefined; shutdown.abort(); },
      close() { inputProjection = undefined; return closing ??= (async () => {
        shutdown.abort();
        await Promise.allSettled([...hostControls.keys(), ...messageObservers]);
        await activeController.close();
        await Promise.allSettled([...dreamInvocations]);
        releaseBranchControlGuard?.();
      })(); },
    } satisfies RuntimeBackend & ReturnType<typeof createApplicationHostInput> & {
      assertProcessControlIdle(input?:AcceptedInput): void;
      dispatchDreamPayload(payload:NativeBackgroundPayload,signal:AbortSignal):Promise<AgentOutput>;
      dreamSourceFor(conversationId:number):Readonly<{context:NativeBackgroundContext;payload:NativeBackgroundPayload}>|undefined;
      bindInputProjection(projection: Parameters<typeof admitWebMessage>[0] | undefined): void;
      dispatchAcceptedInput: typeof dispatch;
      admitHostFollowup(input: { sourceId: string; chatJid: string; text: string; queuedAt: string }): number;
      allocateScheduledConversation(lease: ScheduledRunLease): Promise<AcceptedInput>;
      allocateSidePromptConversation(input: AcceptedInput): Promise<AcceptedInput>;
      dispatchSidePrompt(chatJid: string, prompt: string, options?: SidePromptOptions): Promise<SidePromptResult>;
      reconcileSidePrompt(chatJid: string, sourceId: string): Promise<SidePromptResult>;
      reconcileMaintenance(chatJid: string): Promise<void>;
      retryRecoveredWork: typeof activeController.reconcileRecovered;
    });
  } catch (error) {
    shutdown.abort(error);
    try {
      if (controller) await controller.close();
      else await database?.close();
      releaseBranchControlGuard?.();
      lease.release();
    } catch (cleanupError) {
      throw new RuntimeStartupCleanupError([error, cleanupError], "Application backend preparation cleanup uncertain");
    }
    throw error;
  }
}
