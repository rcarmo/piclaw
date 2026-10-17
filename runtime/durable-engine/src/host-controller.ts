// Explicitly opt-in, inactive composition. No registration, schema setup, import or queue.
import { type Storage, type HarnessInspection } from "@earendil-works/pi-durable";
import { withoutAbortSignal, type Context } from "@earendil-works/chord/context";
import { HostConversationRuntime, type RuntimeOptions } from "./host-runtime.js";
import { reconstituteAcceptedWork } from "./host-recovery.js";
import type { HostCutoverController } from "./host-cutover.js";

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
  const { incarnation, sessionId, lane, generation } = r;
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
  let recovered: Awaited<ReturnType<typeof reconstituteAcceptedWork>> = [];
  let scanCurrent: (() => Promise<typeof recovered>) | undefined;
  const assert = () => { if (!lease) throw Error("Host owner unavailable"); lease.assertCurrentOwner(); };
  const deny = () => { throw Error("Unknown recovered candidate authority"); };
  async function authorizeRecoveredWork(inspection: HarnessInspection) {
    assert();
    if (!ready || !runtime || !storage) return deny();
    if (scanCurrent) recovered = await scanCurrent();
    const known = new Set<number>();
    for (const entry of recovered) {
      // Unbound intents stay explicit retry work; do not manufacture a binding on bootstrap.
      const binding = await recoveryBindings.findSource(entry.input.chatJid, entry.input.sourceSeq); assert();
      if (!binding) continue;
      const state = await (entry.role === "primary" ? runtime.reconcile(entry.input) : runtime.reconcileIntent(entry.input));
      assert();
      if (state.submissionId !== null) {
        if (state.operation.cancellation || state.operation.terminal) {
          if (inspection.submissions.some(s => s.id === state.submissionId)) return deny();
        } else known.add(state.submissionId);
      }
    }
    // Includes submissions in conversations absent from the host manifest, and submissions
    // with no corresponding host operation. A caller-supplied approval cannot bypass this.
    if (inspection.submissions.some(s => !known.has(s.id))) return deny();
    const roots = new Set<number>();
    const { runs } = await runtime.inspectAuthority(recovered.map(entry => entry.input)); assert();
    for (const run of runs) {
      if (!run.inputs.length || run.inputs.some(id => !known.has(id))) return deny();
      roots.add(run.taskId);
    }
    // Only exact public run roots and their ordinary owned descendants are supported.
    // Background/independent/unknown tasks never inherit blanket conversation authority.
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
      if (current.background || current.owner !== undefined) return deny();
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
        runningBinding: { sessionId, lane, watchGeneration: generation }, assertOwner: assert,
        work: recoveryWork, bindings: recoveryBindings, readAcceptedInput }));
      assert();
      return Object.freeze(all);
    }
    scanCurrent = scan;
    recovered = await scan();
    ready = true;
    // Public Harness inspection covers the entire store, including unknown conversations.
    const { inspection } = await runtime.inspectAuthority();
    if (inspection.scheduling !== "paused") throw Error("Expected paused bootstrap");
    await authorizeRecoveredWork(inspection);
    let retry: Promise<void> | undefined;
    const activeRuntime = runtime;
    // Explicit same-ID intent repair only. Never resume/wait or replay a primary model turn.
    // Rescan SQL on every call: the bootstrap snapshot is not continuing source authority.
    function reconcileRecovered(): Promise<void> {
      if (retry) return retry;
      retry = (async () => {
        const current = await scan();
        recovered = current;
        await authorizeRecoveredWork((await activeRuntime.inspectAuthority()).inspection);
        for (const entry of current) {
          assert();
          if (entry.role === "intent" && entry.binding?.submissionId == null)
            await activeRuntime.submitIntent(entry.input);
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
    function rollback(cutover: Pick<HostCutoverController, "prepareRollback" | "rollback">, revision: number) {
      if (rollbackAttempt || closing) return Promise.reject(new Error("Controller already closing"));
      const prepare = cutover.prepareRollback.bind(cutover), restore = cutover.rollback.bind(cutover);
      retainOwner = true; // Synchronous: even a concurrent runtime.close cannot release the lease.
      return rollbackAttempt = (async () => {
        assert();
        await activeRuntime.quiesceForRollback(async () => {
          assert();
          throw new Error("Candidate progress proof unavailable: public storage identity and historical commit frontier required");
        });
        assert();
        if (!closedStorage) throw Error("Candidate storage not closed");
        if (prepare(revision).disposition !== "safe_to_restore") throw Error("Reconciliation required");
        assert();
        const result = restore(revision);
        assert();
        await releaseOwner();
        return result;
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
    return Object.freeze({ runtime, recovered, reconcileRecovered, checkpointCutover, rollback,
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
