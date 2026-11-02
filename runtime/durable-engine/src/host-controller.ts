// Explicitly opt-in, inactive composition. No registration, schema setup, import or queue.
import { type Storage, type HarnessInspection } from "@earendil-works/pi-durable";
import { withoutAbortSignal, type Context } from "@earendil-works/chord/context";
import { HostConversationRuntime, type AcceptedInput, type RuntimeOptions } from "./host-runtime.js";
import { reconstituteAcceptedWork } from "./host-recovery.js";
import type { HostCutoverController } from "./host-cutover.js";
import { AcceptedReplyThreadUnavailableError } from "./host-message-thread.js";
import { createLogger } from "../../src/utils/logger.js";
const log = createLogger("durable.controller");

type Recovery = Parameters<typeof reconstituteAcceptedWork>[0];
export interface HostOwnership {
  assertCurrentOwner(): void;
  release(): void | Promise<void>;
}
export interface HostControllerOptions {
  acquireOwnership(): Promise<HostOwnership>;
  /** Construct the actual candidate storage only after exclusive domain ownership. A rejected
   * create must clean up its own partially allocated resources before rejecting. */
  createStorage(lease: HostOwnership): Promise<Storage>;
  runtime: Omit<RuntimeOptions, "owner" | "openStorage" | "authorizeScheduling">;
  recovery: Omit<Recovery, "incarnation" | "binding" | "runningBinding" | "assertOwner"> & {
    manifest: readonly Recovery["binding"][];
  };
}

/** Opens paused, proves the entire public live domain, then permits explicit existing worker
 * progress. No automatic resume or intent dispatch. Unsupported independent tasks fail closed. */
export async function createHostController(config: HostControllerOptions, context: Context) {
  // Capture all callbacks and scopes before acquiring (the first await). Runtime.open performs
  // its own deep contract snapshot synchronously below, before this function first yields.
  const acquire = config.acquireOwnership.bind(config), create = config.createStorage.bind(config);
  const r = config.runtime, recovery = config.recovery;
  const { incarnation, sessionId } = r;
  const existingConversationIds = Object.freeze([...r.existingConversationIds]);
  const manifest = recovery.manifest.map(b => Object.freeze({ ...b }));
  const readAcceptedInput = recovery.readAcceptedInput.bind(recovery);
  const work = recovery.work;
  const recoveryWork = Object.freeze({ listOpenOperations: work.listOpenOperations.bind(work),
    getOperation: work.getOperation.bind(work), getSourceBySeq: work.getSourceBySeq.bind(work),
    getQueuedInputIntent: work.getQueuedInputIntent.bind(work) });
  const bindings = recovery.bindings;
  const recoveryBindings = Object.freeze({ ...bindings, findSource: bindings.findSource.bind(bindings),
    get: bindings.get.bind(bindings), intents: bindings.intents && Object.freeze({ ...bindings.intents,
      get: bindings.intents.get.bind(bindings.intents) }) });
  let lease: HostOwnership | undefined, storage: Storage | undefined, runtime: HostConversationRuntime | undefined;
  let closedStorage = false, ready = false, retainOwner = false, released = false;
  async function releaseOwner() {
    assert();
    if (!released) { await lease!.release(); released = true; }
  }
  let bootstrapApproval = true;
  let maintenance: { taskId: import("@earendil-works/pi-durable").TaskId<import("@earendil-works/pi-durable").CompactionResult>; binding: Recovery["binding"] } | undefined;
  let recovered: Awaited<ReturnType<typeof reconstituteAcceptedWork>> = [];
  let scanCurrent: (() => Promise<typeof recovered>) | undefined;
  const assert = () => { if (!lease) throw Error("Host owner unavailable"); lease.assertCurrentOwner(); };
  const deny = () => { throw Error("Unknown recovered candidate authority"); };
  async function authorizeRecoveredWork(inspection: HarnessInspection, aborting?: AcceptedInput) {
    assert();
    if (!ready || !runtime || !storage) return deny();
    if (scanCurrent) recovered = await scanCurrent();
    // Only an explicit runtime abort may progress its already-cancelled scope.
    // Recovery never projects the cancellation source into a model submission.
    const abortScope = aborting && recovered.find(entry => entry.role === "primary" &&
      entry.work.claimed.operation.cancellation && Object.entries(aborting).every(([key, value]) =>
        entry.input[key as keyof AcceptedInput] === value));
    if (aborting && !abortScope) return deny();
    const known = new Set<number>();
    for (const entry of recovered) {
      // Unbound intents stay explicit retry work; do not manufacture a binding on bootstrap.
      const binding = await recoveryBindings.findSource(entry.input.chatJid, entry.input.sourceSeq); assert();
      if (!binding) continue;
      const state = await (entry.role === "primary" ? runtime.reconcile(entry.input) : runtime.reconcileIntent(entry.input));
      assert();
      if (state.submissionId !== null) {
        if (state.operation.terminal || (state.operation.cancellation && !bootstrapApproval &&
            (!abortScope || entry.input.operationId !== abortScope.input.operationId))) {
          if (inspection.submissions.some(s => s.id === state.submissionId)) return deny();
        } else known.add(state.submissionId);
      }
    }
    // Foreground Delegate children have SDK inputs, not independent host sources.
    // Qualify their exact task/request ownership back to ALREADY known host inputs;
    // neither a conversation ancestor nor a child-supplied request grants authority.
    const hostInputs = new Set(known), delegateRoots = new Set<number>();
    for (const submission of inspection.submissions) {
      if (known.has(submission.id)) continue;
      if (await runtime.ownsMaintenanceSubmission(submission, maintenance?.taskId, maintenance?.binding.conversationId)) { assert(); known.add(submission.id); continue; }
      const child = await runtime.inspectOwnedDelegateAuthority(submission); assert();
      if (!child || !child.inputs.length || child.inputs.some(input => input.submissionId === null || !hostInputs.has(input.submissionId))) return deny();
      known.add(submission.id);
      if (child.taskId !== undefined) delegateRoots.add(child.taskId);
    }
    const roots = new Set<number>(delegateRoots);
    if (maintenance) {
      if (!bootstrapApproval && inspection.tasks.some(t => t.record.id === maintenance!.taskId) && !runtime.ownsMaintenance(maintenance.taskId) && inspection.scheduling !== "paused") return deny();
      const task = inspection.tasks.find(t => t.record.id === maintenance!.taskId)?.record;
      if (task && (task.kind !== "pi.compaction" || task.conversationId !== maintenance.binding.conversationId || task.owner !== undefined || task.background ||
        (task.input as { reason?: string }).reason !== "manual")) return deny();
      if (task) roots.add(task.id);
    }
    const { runs, compactions } = await runtime.inspectAuthority(recovered.map(entry => entry.input)); assert();
    const backgroundCompactions = new Set<number>();
    for (const { record } of inspection.tasks) {
      if (record.kind === "pi.compaction" && record.owner === undefined && !record.background &&
          (record.input as { reason?: string }).reason === "manual" && runtime.ownsMaintenance(record.id)) {
        roots.add(record.id); continue;
      }
      if (record.kind !== "pi.compaction" || !record.background || record.owner !== undefined ||
        (record.input as { reason?: string }).reason !== "threshold" || !manifest.some(binding => binding.conversationId === record.conversationId)) continue;
      if (!compactions.some(status => status.conversationId === record.conversationId && status.taskId === record.id && status.reason === "threshold" && !status.blocking)) continue;
      roots.add(record.id); backgroundCompactions.add(record.id);
    }
    for (const run of runs) {
      if (!run.inputs.length || run.inputs.some(id => !known.has(id))) return deny();
      roots.add(run.taskId);
    }
    // Only exact public run roots and their ordinary owned descendants are supported.
    // Only exact SDK background compactions additionally root themselves through
    // public LiveDoc status and the host manifest; unknown tasks remain denied.
    const tasks = new Map(inspection.tasks.map(t => [Number(t.record.id), t.record]));
    for (const { record } of inspection.tasks) {
      // A running harness may retire this inspected task before LiveDoc is read.
      // Only a persisted terminal receipt removes it from the live authority domain.
      if (await runtime.isTaskTerminal(record.id)) { assert(); continue; }
      assert();
      let current = record;
      const seen = new Set<number>();
      while (!roots.has(current.id)) {
        if (seen.has(current.id) || current.background || current.owner === undefined) return deny();
        seen.add(current.id);
        const parent = tasks.get(Number(current.owner));
        if (!parent) return deny();
        current = parent;
      }
      if ((current.background && !backgroundCompactions.has(current.id)) || current.owner !== undefined) return deny();
    }
    assert();
  }
  // Start Runtime.open now: its existing snapshot captures runtime ports/options before await.
  // openStorage itself waits for acquisition, so no storage or Harness can precede ownership.
  const opening = HostConversationRuntime.open({ ...r,
    owner: { assert() { if (lease) assert(); }, async release() { assert(); if (!retainOwner) await releaseOwner(); } },
    async openStorage() {
      const acquired = await acquire();
      lease = Object.freeze({ assertCurrentOwner: acquired.assertCurrentOwner.bind(acquired), release: acquired.release.bind(acquired) });
      assert();
      storage = await create(lease); assert();
      const close = storage.close.bind(storage);
      let closing: Promise<void> | undefined;
      storage.close = c => closing ??= (async () => { await close(c); closedStorage = true; })();
      return storage;
    }, authorizeScheduling: authorizeRecoveredWork,
  }, context);
  try {
    runtime = await opening;
    assert();
    if (manifest.length !== existingConversationIds.length || new Set(manifest.map(b => b.conversationId)).size !== manifest.length ||
      manifest.some(b => !existingConversationIds.includes(b.conversationId))) throw Error("Exact recovery manifest required");
    async function scan() {
      assert();
      const all: (typeof recovered)[number][] = [];
      for (const binding of manifest) all.push(...await reconstituteAcceptedWork({ incarnation, binding,
        runningBinding: { sessionId }, assertOwner: assert,
        work: recoveryWork, bindings: recoveryBindings, readAcceptedInput }));
      assert();
      return Object.freeze(all);
    }
    scanCurrent = scan;
    recovered = await scan();
    // Only answers already committed at this cold start lost their dispatcher.
    // Work that completes after scheduling resumes retains its normal owner.
    const completedSources = new Set<string>();
    for (const entry of recovered) {
      if (entry.binding?.submissionId == null) continue;
      const state = await (entry.role === "primary" ? runtime.reconcile(entry.input) : runtime.reconcileIntent(entry.input));
      if (state.status?.status === "done") completedSources.add(`${entry.input.operationId}:${entry.input.sourceSeq}`);
    }
    const startupAnswers = new Set(recovered.filter(entry => entry.role === "primary" &&
      entry.work.claimed.operation.claimedSourceSeqs.every(seq => completedSources.has(`${entry.input.operationId}:${seq}`)))
      .map(entry => entry.input.operationId));
    ready = true;
    // Public Harness inspection covers the entire store, including unknown conversations.
    const { inspection } = await runtime.inspectAuthority();
    if (inspection.scheduling !== "paused") throw Error("Expected paused bootstrap");
    // Manual maintenance has no accepted-input operation. Admit one exact
    // manifest task, including its terminal summary write, alongside proven work.
    const manualTasks = await runtime.inspectRecoverableMaintenance(inspection); assert();
    if (manualTasks.length === 1) {
      const task = manualTasks[0]!;
      const binding = manifest.find(b => b.conversationId === task.conversationId);
      if (binding && task.kind === "pi.compaction" && task.owner === undefined && !task.background &&
        (task.input as { reason?: string }).reason === "manual") maintenance = { taskId: task.id as import("@earendil-works/pi-durable").TaskId<import("@earendil-works/pi-durable").CompactionResult>, binding };
    }
    await authorizeRecoveredWork(inspection);
    bootstrapApproval = false;
    let retry: Promise<void> | undefined;
    const unavailableReplyThreads = new Set<string>();
    const activeRuntime = runtime;
    // Explicit same-ID intent repair only. Never resume/wait or replay a primary model turn.
    // Rescan SQL on every call: the bootstrap snapshot is not continuing source authority.
    function reconcileRecovered(): Promise<void> {
      if (retry) return retry;
      retry = (async () => {
        // Restore manual-compaction provider authority before another accepted
        // input can resume this same SDK scheduler. Do not block startup on a
        // summary write waiting for an independently recovered run to finish.
        if (r.withCompactionGuard && maintenance) void resumeRecoveredMaintenance().catch(error => log.error("Recovered maintenance remains pending", { err: error }));
        let current = await scan();
        recovered = current;
        // Complete an already accepted cancellation, never resume it as model work.
        // Startup inspection above is paused; cancellation progress starts only here.
        for (const entry of current) {
          if (entry.role !== "primary" || !entry.work.claimed.operation.cancellation) continue;
          if (!await activeRuntime.settle(entry.input)) await activeRuntime.abortOperation(entry.input);
        }
        if (current.some(entry => entry.work.claimed.operation.cancellation)) recovered = current = await scan();
        await authorizeRecoveredWork((await activeRuntime.inspectAuthority()).inspection);
        for (const entry of current) {
          assert();
          if (entry.role === "intent" && entry.binding?.submissionId == null)
            await activeRuntime.submitIntent(entry.input);
        }
        // Release terminal model errors without replay. Recover committed answers
        // only for cold-start operations: their previous dispatcher no longer exists.
        for (const entry of current) {
          assert();
          if (entry.role !== "primary" || entry.binding?.submissionId == null || unavailableReplyThreads.has(entry.input.operationId)) continue;
          const state = await activeRuntime.reconcile(entry.input);
          if ((state.status?.status === "unanswered" && state.status.reason === "model_error") ||
              (startupAnswers.has(entry.input.operationId) && state.status?.status === "done")) {
            try {
              if (await activeRuntime.settle(entry.input)) startupAnswers.delete(entry.input.operationId);
            } catch (error) {
              assert();
              if (!(error instanceof AcceptedReplyThreadUnavailableError)) throw error;
              // Retain the accepted source and committed answer. Never fabricate
              // a replacement thread or let one unavailable root crash all chats.
              unavailableReplyThreads.add(entry.input.operationId);
              log.warn("Recovered reply thread unavailable; accepted input retained", {
                operation: "durable_recovery.reply_thread_unavailable", operationId: entry.input.operationId, chatJid: entry.input.chatJid,
              });
            }
          }
        }
        assert();
        // A new intent uses submitInput's existing whole-domain scheduling gate.
        // Bound ACK repair never resumes. Do not inspect a running, changing task tree
        // as though inspection and live snapshots were one atomic storage observation.
      })().finally(() => { retry = undefined; });
      return retry;
    }
    let rollbackAttempt: Promise<ReturnType<HostCutoverController["rollback"]>> | undefined;
    let closing: Promise<void> | undefined;
    /** No qualified public storage identity/global historical frontier exists in 1.3.0.
     * Current history/tasks/submissions/documents are insufficient: retired latest-only
     * documents disappear from scans. Never persist those snapshots as a rollback proof.
     * No caller boolean/hash or host-only checkpoint can authorize this factory path. */
    async function checkpointCutover(_cutover: HostCutoverController): Promise<never> {
      assert();
      throw new Error("Candidate progress proof unavailable: public storage identity and historical commit frontier required");
    }
    /** Explicit inactive composition, one attempt only. Seal/join/inspect under the actual
     * owner, then fail BEFORE closing storage if historical proof is unavailable.
     * The independent host-only controller remains usable by its existing fixtures. */
    function rollback(cutover: Pick<HostCutoverController, "prepareRollback" | "rollback">, _revision: number) {
      if (rollbackAttempt || closing) return Promise.reject(new Error("Controller already closing"));
      // Preserve entry-time getter/bind validation before sealing or consuming the attempt.
      cutover.prepareRollback.bind(cutover); cutover.rollback.bind(cutover);
      retainOwner = true; // Synchronous: even a concurrent runtime.close cannot release the lease.
      return rollbackAttempt = (async () => {
        assert();
        return activeRuntime.quiesceForRollback(async () => {
          assert();
          throw new Error("Candidate progress proof unavailable: public storage identity and historical commit frontier required");
        });
      })();
    }
    function close(): Promise<void> {
      return closing ??= (async () => {
        // Explicit abort after a failed SQL rollback may release only confirmed closed storage.
        // Unknown/pending work or failed cleanup retains the owner and the cached failure.
        if (rollbackAttempt) await rollbackAttempt.catch(() => {});
        await activeRuntime.close();
        if (retainOwner && !released && closedStorage) await releaseOwner();
      })();
    }
    let maintenanceAttempt: Promise<{ compacted: boolean }> | undefined;
    function resumeRecoveredMaintenance() {
      assert();
      if (maintenanceAttempt) return maintenanceAttempt;
      if (!maintenance) return Promise.reject(Error("No recovered maintenance"));
      return maintenanceAttempt = activeRuntime.recoverMaintenance({ ...maintenance.binding, incarnation }, maintenance.taskId)
        .then(result => { maintenance = undefined; return result; });
    }
    return Object.freeze({ runtime, recovered, reconcileRecovered, get recoveredMaintenanceChat() { return maintenance?.binding.chatJid; }, resumeRecoveredMaintenance, checkpointCutover, rollback,
      async addConversation<T extends Recovery["binding"]>(create: Parameters<typeof activeRuntime.addConversation<T>>[0], beforeCommit?: () => void) {
        assert();
        const binding = await activeRuntime.addConversation(create, beforeCommit); assert();
        manifest.push(Object.freeze({ ...binding }));
        return binding;
      },
      pendingIntentIds: Object.freeze(recovered.filter(e => e.role === "intent" && e.binding?.submissionId == null).map(e => e.input.requestId)),
      close });
  } catch (error) {
    if (runtime) await runtime.close();
    else {
      if (storage && !closedStorage) await storage.close(withoutAbortSignal(context));
      if (lease && (!storage || closedStorage)) await lease.release();
    }
    throw error;
  }
}
