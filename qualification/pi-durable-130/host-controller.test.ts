import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { acceptedSteerFixture } from "./src/accepted-steer-recovery-fixture.js";
import { TestOwner, OwnedSqlite } from "./src/ownership.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { createHostController, type HostControllerOptions } from "../../runtime/durable-engine/src/host-controller.js";
import { barrier, context } from "./src/fixture.js";
import { createDurableRecoveryDispatch } from "../../runtime/src/agent-pool/durable-recovery-dispatch.js";
import { at, effect, sealed, value } from "./src/host-handoff.js";
import { AcceptedReplyThreadUnavailableError } from "../../runtime/durable-engine/src/host-message-thread.js";
import { HostCutoverController, initializeCutoverManifest } from "../../runtime/durable-engine/src/host-cutover.js";
import { backgroundPolicyFixture,backgroundPolicyReopenFixture,backgroundPolicyOwnerFixture } from "./background-policy-fixture.ts";

test('background policy SDK: paused disk reopen preserves quota and same-input replay',backgroundPolicyReopenFixture);
test('background policy SDK: document owner matches its public registration',backgroundPolicyOwnerFixture);

for(const mode of ['allowed','limit','ceiling','forged-call','revoked','expired','configuration','parallel','reused-call-id','api-change','long-call'] as const)
  test(`background policy SDK: ${mode}`,()=>backgroundPolicyFixture(mode));

// Each scenario owns its fixture and keeps the existing 15-second deadline.
for (const mode of ([["committed-answer"], ["unavailable-reply-thread"], ["unrelated-settlement-error"], ["operator-abort"], ["operator-abort-recovered"], ["happy"], ["lost-ack"], ["unknown"], ["failed-open"], ["background"],
  ["bootstrap-close-failure", "shutdown-close-failure"],
  ["rollback", "rollback-host-changed", "rollback-close-failure", "rollback-pending"],
  ["rollback-held", "rollback-held-close", "rollback-close-first", "rollback-inflight"],
  ["rollback-candidate-only", "rollback-retired-document", "rollback-terminal-records"]] as const).flat()) {
  test(`explicit owner-first host controller: ${mode}`, async () => {
    const dir = await mkdtemp(join(process.env.PICLAW_WORKSPACE!, "host-controller-"));
    const oldMemory = process.env.PICLAW_DB_IN_MEMORY;
    const committed = ["committed-answer", "unavailable-reply-thread", "unrelated-settlement-error"].includes(mode);
    const f = await acceptedSteerFixture(dir, mode === "lost-ack" || mode === "rollback-pending" || committed || mode === "operator-abort-recovered" ? "committed-ack-lost" : "before-submit");
    let controller: Awaited<ReturnType<typeof createHostController>> | undefined;
    let actualClose: (() => Promise<void>) | undefined;
    let candidate: Awaited<ReturnType<typeof SqliteStorage.open>> | undefined;
    let capturedLease: Parameters<HostControllerOptions["createStorage"]>[0] | undefined;
    const rollbackMode = mode.startsWith("rollback");
    const held = barrier(), entered = barrier();
    let holdLookup = false;
    let providerSignal: AbortSignal | undefined;
    const providerEntered = barrier();
    const closeFailure = mode === "bootstrap-close-failure" || mode === "shutdown-close-failure" || mode === "rollback-close-failure";
    try {
      const { primary, primaryId } = await f.prepare();
      if (committed) {
        const intent = (await f.ports.bindings.intents!.list(primary))[0]!;
        f.base.host.modelHold!.release();
        await f.runtime!.resume(primary, primaryId);
        for (let i = 0; (await f.runtime!.reconcileIntent(intent)).status?.status !== "done"; i++) {
          if (i > 200) throw Error("Intent did not finish before reopen");
          await Bun.sleep(5);
        }
      }
      if (mode === "operator-abort-recovered") {
        const operation = value(await f.ports.work.getOperation(primary.operationId))!;
        const id = `operator-abort:${primary.operationId}`;
        f.db.transaction(() => f.ports.work.acceptAndCancelSourceInTransaction(sealed({ effect: effect(id), chatJid: primary.chatJid,
          sourceId: id, kind: "cancellation", payloadRef: id, targetOperationId: primary.operationId,
          parentSourceSeq: primary.sourceSeq, acceptedAt: at, createWakeIntent: false }), operation.version, "operator_abort", f.db)).immediate();
      }
      await f.runtime!.close(); f.runtime = undefined;
      const originalEnter = f.base.host.onModelEnter;
      f.base.host.onModelEnter = signal => { originalEnter?.(signal); providerSignal = signal; providerEntered.release(); };
      f.db.exec("DROP TABLE recovery_fixture_identity");
      if (mode === "unknown" || mode === "bootstrap-close-failure" || mode === "background") {
        // Real public candidate admission, not a fabricated inspection. The host has no work for it.
        const s = await SqliteStorage.open(new OwnedSqlite(f.owner));
        const { Harness } = await import("../../runtime/durable-engine/qualification/durable.ts");
        const h = await Harness.open(s, { models: f.base.models, registry: f.base.registry }, context);
        const c = await h.conversation(f.base.root.id, context);
        if (mode === "background") {
          // Actual public Session admission, not inspectPending fault injection. Scheduling stays paused.
          const task = { definition: { name: "qualification-independent-background", version: 1,
            initial: (_input: null) => ({ phase: "held" as const }),
            phases: { held: async () => { throw Error("Background task must never execute"); } },
            abort: async () => { throw Error("Background task must never abort"); } } };
          const id = await h.commit(tx => tx.createTask(task, null, {
            ownership: { kind: "conversation" }, conversationId: c!.id, background: true,
          }), context);
          const inspection = await h.inspect(context);
          expect(inspection.scheduling).toBe("paused");
          expect(inspection.tasks.some(t => t.record.id === id && t.record.background && t.record.owner === undefined)).toBe(true);
          expect(inspection.submissions).toEqual([]);
        } else {
          await c!.submit({ type: "input", requestId: "unknown-public-input", content: "unowned" }, context);
        }
        await h.close(context);
      }
      f.owner.releaseAfterClose(); f.owner.closeConnection();
      const events: string[] = [];
      const options: HostControllerOptions = {
        async acquireOwnership() {
          f.owner = TestOwner.acquire(f.path); events.push("owner");
          return { assertCurrentOwner: () => f.owner.assert(), release() { events.push("release"); f.owner.releaseAfterClose(); } };
        },
        async createStorage(lease) {
          lease.assertCurrentOwner(); events.push("storage");
          expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
          const s = await SqliteStorage.open(new OwnedSqlite(f.owner));
          const close = s.close.bind(s);
          if (rollbackMode) { candidate = s; capturedLease = lease; actualClose = () => close(context); }
          if (closeFailure) {
            capturedLease = lease;
            actualClose = () => close(context);
            // Throw BEFORE actual close: resource cleanup is unconfirmed and must retain ownership.
            s.close = async () => { events.push("close-failed"); throw Error("injected storage close failure"); };
          } else s.close = async c => { await close(c); events.push("close"); };
          return s;
        },
        runtime: { incarnation: f.incarnation, ...f.ports, cancelOperationSource(input, expectedVersion) {
            f.db.transaction(() => {
              f.owner.assert();
              const row = f.db.query("SELECT version,cancellation_source_seq FROM service_effect_s01_operations WHERE operation_id=?")
                .get(input.operationId) as { version: number; cancellation_source_seq: number | null };
              if (row.version !== expectedVersion) throw Error("Abort operation changed");
              if (row.cancellation_source_seq !== null) return;
              const id = `operator-abort:${input.operationId}`;
              f.ports.work.acceptAndCancelSourceInTransaction(sealed({ effect: effect(id), chatJid: input.chatJid,
                sourceId: id, kind: "cancellation", payloadRef: id, targetOperationId: input.operationId,
                parentSourceSeq: input.sourceSeq, acceptedAt: at, createWakeIntent: false }), expectedVersion, "operator_abort", f.db);
              f.owner.assert();
            }).immediate();
          }, work: { acceptSource: f.ports.work.acceptSource.bind(f.ports.work),
            claimNext: f.ports.work.claimNext.bind(f.ports.work), appendIntent: f.ports.work.appendIntent.bind(f.ports.work),
            recordQueuedInput: f.ports.work.recordQueuedInput.bind(f.ports.work),
            getChatFrontier: f.ports.work.getChatFrontier.bind(f.ports.work),
            listOpenOperations: f.ports.work.listOpenOperations.bind(f.ports.work), getOperation: async id => {
            if (holdLookup) { entered.release(); await held.promise; }
            return f.ports.work.getOperation(id);
          }, acceptCancellation: f.ports.work.acceptCancellation.bind(f.ports.work),
          bindHarness: f.ports.work.bindHarness.bind(f.ports.work), finishHarness: f.ports.work.finishHarness!.bind(f.ports.work) }, harnessOptions: { models: f.base.models, registry: f.base.registry, settings: { retry: { enabled: false }, compaction: { enabled: false } } }, existingConversationIds: [mode === "failed-open" ? 999999 as typeof f.base.root.id : f.base.root.id], conversationFor: () => f.base.root.id, putAnswer(ref, text) { if (committed) f.putAnswer(ref, text); }, replyThreadFor() {
            if (mode === "unavailable-reply-thread") throw new AcceptedReplyThreadUnavailableError();
            if (mode === "unrelated-settlement-error") throw Error("fixture settlement failed");
            return null;
          }, sessionId: f.incarnation, now: () => at },
        recovery: { manifest: [{ chatJid: f.chatJid, branchId: "main", conversationId: f.base.root.id }],
          work: f.ports.work, bindings: f.ports.bindings,
          async readAcceptedInput(source) {
            const row = f.db.query("SELECT content FROM messages WHERE id=? AND chat_jid=?").get(source.sourceId, source.chatJid) as { content: string } | null;
            if (!row) throw Error("Missing message");
            const binding = await f.ports.bindings.findSource(source.chatJid, source.sourceSeq);
            return { claimed: { source, operation: value(await f.ports.work.getOperation(f.incarnation))! }, branchId: "main",
              requestId: binding?.requestId ?? `queued-steer:${source.sourceId}`, content: row.content };
          } },
      };
      const entries = f.providerEntries;
      const pending = createHostController(options, context);
      // Mutable caller scope/callback replacements after first await cannot change the open.
      Object.assign(options.runtime, { existingConversationIds: [] });
      options.recovery.readAcceptedInput = async () => { throw Error("replacement"); };
      if (mode === "shutdown-close-failure") {
        controller = await pending;
        const closing = controller.close();
        expect(controller.close()).toBe(closing);
        await expect(closing).rejects.toThrow("injected storage close failure");
        expect(controller.close()).toBe(closing);
        await expect(controller.close()).rejects.toThrow("injected storage close failure");
      } else if (mode === "unavailable-reply-thread" || mode === "unrelated-settlement-error") {
        controller = await pending;
        if (mode === "unrelated-settlement-error") {
          await expect(controller.reconcileRecovered()).rejects.toThrow("fixture settlement failed");
        } else {
          const beforeMessages = f.db.query("SELECT * FROM messages WHERE chat_jid=?").all(f.chatJid);
          await controller.reconcileRecovered();
          const snapshot = () => ["messages", "service_effect_s01_sources", "service_effect_s01_operations", "service_effect_s02_commits"]
            .map(table => f.db.query(`SELECT * FROM ${table}`).all());
          const retained = snapshot();
          await controller.reconcileRecovered();
          expect(snapshot()).toEqual(retained);
          expect((await controller.runtime.reconcile(primary)).operation.terminal).toBeNull();
          expect(f.ports.work.getAcceptedSource(f.chatJid, primary.sourceId)?.state).toBe("claimed");
          expect(f.db.query("SELECT * FROM messages WHERE chat_jid=?").all(f.chatJid)).toEqual(beforeMessages);
          expect(f.providerEntries).toBe(entries);
          expect((await controller.runtime.inspectAuthority()).inspection.scheduling).toBe("paused");
        }
        await controller.close();
      } else if (mode === "committed-answer") {
        controller = await pending;
        expect((await controller.runtime.inspectAuthority()).inspection.scheduling).toBe("paused");
        await controller.reconcileRecovered();
        expect((await controller.runtime.reconcile(primary)).operation.terminal?.disposition).toBe("completed");
        const published = f.db.query("SELECT * FROM messages ORDER BY rowid").all();
        await controller.reconcileRecovered();
        expect(f.db.query("SELECT * FROM messages ORDER BY rowid").all()).toEqual(published);
        expect(f.providerEntries).toBe(entries);
        expect((await controller.runtime.inspectAuthority()).inspection.scheduling).toBe("paused");
        await controller.close();
      } else if (mode === "operator-abort-recovered") {
        controller = await pending;
        expect((await controller.runtime.inspectAuthority()).inspection.scheduling).toBe("paused");
        await controller.reconcileRecovered();
        expect((await controller.runtime.reconcile(primary)).operation.terminal?.disposition).toBe("cancelled");
        await controller.reconcileRecovered();
        expect(f.providerEntries).toBe(entries);
        expect((await controller.runtime.inspectAuthority()).inspection.tasks).toHaveLength(0);
        await controller.close();
      } else if (mode === "operator-abort") {
        controller = await pending;
        await controller.reconcileRecovered();
        const before = await controller.runtime.inspectAuthority();
        expect(before.inspection.tasks.length).toBeGreaterThan(0);
        expect(await controller.runtime.abortOperation(primary)).toBe(true);
        expect((await controller.runtime.reconcile(primary)).operation.terminal?.disposition).toBe("cancelled");
        expect((await controller.runtime.inspectAuthority()).inspection.tasks).toHaveLength(0);
        await expect(controller.runtime.resume(primary, primaryId)).rejects.toThrow("Exact live submission required");
        expect(await controller.runtime.abortOperation(primary)).toBe(false);
        await controller.close();
      } else if (mode === "happy" || mode === "lost-ack" || rollbackMode) {
        controller = await pending;
        expect(controller.recovered[0]!.input).toEqual(primary);
        expect(controller.pendingIntentIds).toEqual(mode === "lost-ack" || mode === "rollback-pending" ? [] : [`queued-steer:${f.intentSourceId}`]);
        expect((await controller.runtime.inspectAuthority()).inspection.scheduling).toBe("paused");
        expect(f.providerEntries).toBe(entries);
        if (mode !== "rollback-pending" && mode !== "rollback-inflight") f.base.host.modelHold?.release();
        const intent = controller.recovered[1]!.input;
        const shutdown = new AbortController();
        const dispatch = createDurableRecoveryDispatch({ assertCurrentWriter: () => f.owner.assert(),
          shutdown: shutdown.signal, reconcileRecovered: controller.reconcileRecovered,
          async submitIntent() { throw Error('Boot recovery must use controller-owned identities'); } });
        const wake = dispatch.waitForReconciliation({}, shutdown.signal);
        const repair = dispatch.retryRecoveredWork();
        expect(dispatch.retryRecoveredWork()).toBe(repair);
        await repair;
        await wake;
        shutdown.abort();
        const id = (await controller.runtime.reconcileIntent(intent)).submissionId!;
        expect(id).not.toBeNull();
        // Lost ACK repair is deliberately not a progress grant.
        if (mode === "lost-ack") await controller.runtime.resume(primary, primaryId);
        if (mode === "rollback-inflight") {
          await providerEntered.promise;
          expect(providerSignal).toBeDefined();
          expect(providerSignal!.aborted).toBe(false);
          const live = await controller.runtime.inspectAuthority();
          expect(live.inspection.tasks.length).toBeGreaterThan(0);
          expect(live.inspection.submissions.length).toBeGreaterThan(0);
        }
        if (mode !== "rollback-pending" && mode !== "rollback-inflight") {
          let state = await controller.runtime.reconcileIntent(intent);
          for (let i = 0; i < 100 && state.status?.status !== "done"; i++) {
            await Bun.sleep(5); state = await controller.runtime.reconcileIntent(intent);
          }
          expect(state.status?.status).toBe("done");
          expect(await controller.runtime.submitIntent(intent)).toBe(id);
        }
        if (rollbackMode) {
          initializeCutoverManifest(f.db);
          const digest = "a".repeat(64), receipt = { sourceDigest: digest, receiptHash: digest };
          const cutover = new HostCutoverController(f.db, { domain: `rollback-${crypto.randomUUID()}`, incarnation: "host-A",
            ownerGeneration: f.owner.token.generation, sourceEngineId: "legacy", candidateStoreRef: "candidate" }, {
            assertOwner() { f.owner.assert(); }, assertCurrentWriter() { f.owner.assert(); },
            checkDrained() { return { sourceDigest: digest, pending: 0, inflight: 0 }; },
          });
          let m = cutover.preflight({ requestKey: "rollback-test", sourceDigest: digest, importHash: digest });
          m = await cutover.begin(m.revision, { async copy() { return receipt; }, async importCopied() { return receipt; } });
          m = await cutover.verify(m.revision, async () => receipt);
          m = cutover.commitWriter(m.revision);
          if (mode === "rollback-host-changed") f.db.exec("DELETE FROM piclaw_durable_intent_bindings_v1");
          const before = cutover.inspect();
          await expect(controller.checkpointCutover(cutover)).rejects.toThrow("Candidate progress proof unavailable");
          expect(cutover.inspect()).toEqual(before);
          if (mode === "rollback-candidate-only" || mode === "rollback-retired-document") {
            const scope = { kind: "session" as const };
            const query = { scope, at: "current" as const };
            const documentsBefore = await candidate!.scanDocuments(query, 1000, undefined, context);
            const id = await candidate!.mintId<import("../../runtime/durable-engine/qualification/durable.ts").DocumentId>();
            await candidate!.commit([{ type: "document.create", record: { id, kind: "qualification.candidate-only", scope },
              content: { kind: "base", version: 1, value: { outcome: "committed" } } }], context);
            expect((await candidate!.document(id, "current", context))!.value.outcome).toBe("committed");
            if (mode === "rollback-retired-document") {
              await candidate!.commit([{ type: "document.retire", id }], context);
              // A complete current scan has no evidence of this actual committed change.
              expect(await candidate!.scanDocuments(query, 1000, undefined, context)).toEqual(documentsBefore);
            }
          }
          if (mode === "rollback-terminal-records") {
            const tasks = await candidate!.scanTasks({ status: "terminal" }, 1000, undefined, context);
            const submissions = await candidate!.scanSubmissions({ status: "done" }, 1000, undefined, context);
            expect(tasks.items.length).toBeGreaterThan(0);
            expect(submissions.items.length).toBeGreaterThan(0);
            // Real public commits of historical terminal records, invisible to pending inspection.
            await candidate!.commit([{ type: "task", value: { ...tasks.items[0]!, memos: undefined, state: { status: "terminal",
              outcome: { status: "completed", result: "candidate-only-outcome" } } } },
              { type: "submission", value: { ...submissions.items[0]!, requestId: "candidate-only-terminal-change" } }], context);
            expect((await controller.runtime.inspectAuthority()).inspection.tasks).toEqual([]);
            expect((await controller.runtime.inspectAuthority()).inspection.submissions).toEqual([]);
          }
          expect(cutover.inspect()).toEqual(before);
          const actualRollback = cutover.rollback.bind(cutover);
          let flips = 0;
          cutover.rollback = revision => {
            f.owner.assert();
            expect(events).toEqual(["owner", "storage", "close"]);
            expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
            flips++;
            return actualRollback(revision);
          };
          let observer: Promise<void> | undefined;
          let concurrentClose: Promise<void> | undefined;
          if (mode === "rollback-held" || mode === "rollback-held-close" || mode === "rollback-close-first") {
            holdLookup = true;
            observer = controller.runtime.wait(primary, primaryId);
            void observer.catch(() => {});
            await entered.promise;
          }
          if (mode === "rollback-close-first") {
            // Normal close detaches even an entered host lookup; rollback cannot join it later.
            concurrentClose = controller.close();
            await expect(controller.rollback(cutover, m.revision)).rejects.toThrow("Controller already closing");
            await expect(observer!).rejects.toThrow();
            await concurrentClose;
            expect(flips).toBe(0);
            expect(events).toEqual(["owner", "storage", "close", "release"]);
            held.release();
            return;
          }
          const captured: string[] = [];
          if (mode === "rollback") {
            // Invalid entry callbacks fail synchronously before sealing or consuming the attempt.
            expect(() => controller!.rollback(undefined as never, m.revision)).toThrow(TypeError);
            for (const key of ["prepareRollback", "rollback"] as const) {
              const invalid = { prepareRollback: cutover.prepareRollback, rollback: cutover.rollback, [key]: undefined };
              expect(() => controller!.rollback(invalid as never, m.revision)).toThrow(TypeError);
            }
            expect((await controller.runtime.reconcile(primary)).status?.status).toBe("done");
            const prepare = cutover.prepareRollback, restore = cutover.rollback;
            Object.defineProperties(cutover, {
              prepareRollback: { configurable: true, get() { captured.push("prepare"); return prepare; } },
              rollback: { configurable: true, get() { captured.push("restore"); return restore; } },
            });
          }
          const attempt = controller.rollback(cutover, m.revision);
          if (mode === "rollback") {
            expect(captured).toEqual(["prepare", "restore"]);
            // Late mutation cannot redirect the captured callbacks or turn refusal into a flip.
            Object.defineProperties(cutover, {
              prepareRollback: { value() { throw Error("late prepare"); } },
              rollback: { value() { throw Error("late restore"); } },
            });
          }
          if (observer) {
            if (mode === "rollback-held-close") { concurrentClose = controller.close(); void concurrentClose.catch(() => {}); }
            await expect(observer).rejects.toThrow();
            // Flush detached wrapper continuations while the underlying callback stays held.
            await Bun.sleep(0);
            expect(events).toEqual(["owner", "storage"]);
            expect(cutover.inspect()).toEqual(before);
            expect(flips).toBe(0);
            f.owner.assert();
            expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
            held.release();
          }
          expect(() => controller!.runtime.reconcile(primary)).toThrow("Runtime closed");
          await expect(controller.rollback(cutover, m.revision)).rejects.toThrow("Controller already closing");
          {
            await expect(attempt).rejects.toThrow(mode === "rollback-pending" || mode === "rollback-inflight" ? "Candidate not quiescent" :
              "Candidate progress proof unavailable");
            expect(cutover.inspect()).toEqual(before);
            expect(flips).toBe(0);
            f.owner.assert();
            expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
            if (mode === "rollback-pending") {
              expect(events).toEqual(["owner", "storage"]);
              expect(f.providerEntries).toBe(entries);
            }
            if (mode === "rollback-inflight") {
              expect(events).toEqual(["owner", "storage"]);
              expect(providerSignal!.aborted).toBe(false);
            }
            // Explicit test teardown, not a rollback retry or work cancellation by the guard.
            f.base.host.modelHold?.release();
            expect(events).toEqual(["owner", "storage"]);
            if (concurrentClose) await expect(concurrentClose).rejects.toThrow("Candidate progress proof unavailable");
            await actualClose!(); actualClose = undefined;
            await capturedLease!.release(); capturedLease = undefined;
            controller = undefined;
          }
        } else await controller.close();
      } else {
        await expect(pending).rejects.toThrow(mode === "bootstrap-close-failure" ? "injected storage close failure" :
          mode === "unknown" || mode === "background" ? "Unknown recovered candidate authority" : "Missing manifest conversation");
        expect(f.providerEntries).toBe(entries);
      }
      if (closeFailure && !rollbackMode) {
        expect(events).toEqual(["owner", "storage", "close-failed"]);
        f.owner.assert();
        expect(() => TestOwner.acquire(f.path)).toThrow("owner busy");
        expect(f.providerEntries).toBe(entries);
        // Cleanup uses captured real ports, never a retry of the cached rejected controller close.
        await actualClose!(); actualClose = undefined;
        await capturedLease!.release(); capturedLease = undefined;
        expect(events).toEqual(["owner", "storage", "close-failed", "release"]);
        const contender = TestOwner.acquire(f.path);
        contender.releaseAfterClose(); contender.closeConnection();
      } else if (rollbackMode && mode !== "rollback-close-first") expect(events).toEqual(["owner", "storage", "release"]);
      else expect(events).toEqual(["owner", "storage", "close", "release"]);
    } finally {
      held.release();
      if (closeFailure || rollbackMode && controller === undefined) {
        await actualClose?.();
        await capturedLease?.release();
      } else await controller?.close();
      await f.close();
      if (oldMemory === undefined) delete process.env.PICLAW_DB_IN_MEMORY; else process.env.PICLAW_DB_IN_MEMORY = oldMemory;
      await rm(dir, { recursive: true, force: true });
    }
  }, 15000);
}
