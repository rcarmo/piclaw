import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashCanonicalRequest, type CanonicalJsonValue, type NormalisedEffectTrace, type NormalisedTraceInput } from "../../src/service-effects/contracts/common.js";
import { OUTBOX_KINDS } from "../../src/service-effects/contracts/service-outbox-store.js";
import type { CompleteScheduledRunRequest, ScheduledRunLease, ScheduledTaskAuthorityInput } from "../../src/service-effects/contracts/scheduled-run-store.js";
import { computeNextRun } from "../../src/task-scheduler-utils.js";
import { createCurrentPiclawScheduledRunStore, type ScheduledRunAdapterRuntime, type ScheduledRunMutationMethod, type ScheduledRunStatement } from "../../src/service-effects/current-piclaw/scheduled-run-store.js";
import { createCurrentPiclawServiceOutboxStore, createServiceOutboxEnqueueInserter } from "../../src/service-effects/current-piclaw/service-outbox-store.js";
import { installScheduledRunCompositionSchema } from "../../src/service-effects/current-piclaw/scheduled-run-schema.js";
import { createScheduledTaskAuthority } from "../../src/service-effects/current-piclaw/scheduled-task-authority.js";
import type { ContractSubjectFactory, ContractTestContext } from "../../src/service-effects/testing/contract-suite.js";
import { defineScheduledRunStoreContract, type ScheduledRunContractSubject, type ScheduledRunInspection } from "../../src/service-effects/testing/contract-suites/scheduled-run-store-contract.js";
import { ManualEffectClock, SequenceEffectIdSource } from "../../src/service-effects/testing/deterministic-controls.js";
import { FakeScheduledRunBackend, FakeScheduledRunStore, createFakeScheduledTaskAuthority } from "../../src/service-effects/testing/fakes/fake-scheduled-run-store.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { EffectTraceRecorder } from "../../src/service-effects/testing/trace-recorder.js";

function context(): ContractTestContext {
  return { clock: new ManualEffectClock("2026-08-16T00:00:00.000Z"), ids: new SequenceEffectIdSource("s07"), faults: new DeterministicFaultPlan() };
}

class Runtime implements ScheduledRunAdapterRuntime {
  readonly trace: EffectTraceRecorder;
  readonly planned = new Map<string, Set<number>>();
  readonly counts = new Map<string, number>();
  private statementFault: ScheduledRunStatement | null = null;
  private tracePoisoned = false;
  constructor(trace: readonly NormalisedEffectTrace[] = []) { this.trace = EffectTraceRecorder.fromSnapshot(trace); }
  failAfterStatement(statement: ScheduledRunStatement): void { this.statementFault = statement; }
  poisonTraceObserver(): void { this.tracePoisoned = true; }
  afterStatement(statement: ScheduledRunStatement): void {
    if (this.statementFault === statement) { this.statementFault = null; throw new Error(`fault:${statement}`); }
  }
  plan(method: ScheduledRunMutationMethod, point: "before_effect" | "effect_then_lost_acknowledgement", occurrence: number) {
    const key = `${method}:${point}`, base = this.counts.get(key) ?? 0;
    this.planned.set(key, new Set([base + occurrence]));
  }
  hitFault(point: "before_effect" | "effect_then_lost_acknowledgement", method: ScheduledRunMutationMethod): boolean {
    const key = `${method}:${point}`, occurrence = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, occurrence);
    return this.planned.get(key)?.has(occurrence) ?? false;
  }
  recordTrace(input: NormalisedTraceInput): void {
    if (this.tracePoisoned) throw new Error("malformed trace observer");
    if (input.resultTag === "call") this.trace.recordCall(input); else this.trace.recordResult(input);
  }
}

function sqliteInspect(database: Database): ScheduledRunInspection {
  const count = (table: string) => (database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  return { occurrences: count("service_effect_s07_occurrences"), runLogs: count("service_effect_s07_run_logs"), nextDecisions: count("service_effect_s07_next_decisions"), outboxRows: count("service_effect_s05_outbox"), tombstones: count("service_effect_s07_tombstones") };
}

async function markSqliteOutboxUnknown(database: Database, outboxId: string): Promise<void> {
  const built = createCurrentPiclawServiceOutboxStore(database, { hitFault() { return false; }, recordTrace() {} });
  if (!built.ok) throw new Error("S05 fixture unavailable.");
  const claimed = await built.value.claimNext({ kinds: OUTBOX_KINDS, workerId: "worker:s07-outbox", leaseToken: `lease:${outboxId}`, now: "2026-08-16T01:00:11.000Z", leaseExpiresAt: "2026-08-16T01:01:11.000Z" });
  if (!claimed.ok || !claimed.value.lease || claimed.value.lease.record.outboxId !== outboxId) throw new Error("S05 fixture claim failed.");
  const lease = claimed.value.lease;
  const unknown = await built.value.markUnknown({ outboxId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, leaseToken: lease.record.leaseToken, errorTag: "delivery_unknown", certainty: "unknown", observedAt: "2026-08-16T01:00:12.000Z" });
  if (!unknown.ok || unknown.value.decision === "stale") throw new Error("S05 fixture unknown failed.");
}

function acceptSqliteSource(database: Database, input: { runId: string; chatJid: string; sourceSeq: number; operationId: string }): void {
  database.transaction(() => {
    database.query("INSERT OR IGNORE INTO service_effect_s01_chats(chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id) VALUES(?,2,0,NULL)").run(input.chatJid);
    database.query("INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,target_operation_id,parent_source_seq,accepted_at,disposition_reason,provenance_ref,create_wake_intent) VALUES(?,?,?,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','scheduled_agent','claimed','payload:scheduled',NULL,NULL,'2026-08-16T01:00:01.000Z',NULL,'provenance:scheduled',0)").run(input.chatJid, input.sourceSeq, input.runId);
    database.query("INSERT INTO service_effect_s01_operations(operation_id,chat_jid,version,phase,primary_source_seq) VALUES(?,?,1,'claimed',?)").run(input.operationId, input.chatJid, input.sourceSeq);
    database.query("INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq) VALUES(?,?,?)").run(input.chatJid, input.operationId, input.sourceSeq);
    database.query("UPDATE service_effect_s01_chats SET active_operation_id=? WHERE chat_jid=?").run(input.operationId, input.chatJid);
  }).immediate();
}

type SqliteSubject = ScheduledRunContractSubject & { database: Database; runtime: Runtime; root: string; path: string };
function openSqliteSubject(path: string, root: string, trace: readonly NormalisedEffectTrace[] = []): SqliteSubject {
  const database = new Database(path, { create: true });
  database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON");
  installScheduledRunCompositionSchema(database);
  const runtime = new Runtime(trace), built = createCurrentPiclawScheduledRunStore(database, runtime);
  if (!built.ok) throw new Error(`SQLite EF-S07 construction failed: ${built.error._tag}`);
  return {
    store: built.value,
    authority: createScheduledTaskAuthority(database),
    database, runtime, root, path,
    peerStore() { const peer = createCurrentPiclawScheduledRunStore(database, new Runtime()); if (!peer.ok) throw new Error("peer construction failed"); return peer.value; },
    acceptAgentSource(input) { acceptSqliteSource(database, input); },
    markOutboxUnknown(outboxId) { return markSqliteOutboxUnknown(database, outboxId); },
    async outboxState(outboxId) { const row = database.query("SELECT state FROM service_effect_s05_outbox WHERE outbox_id=?").get(outboxId) as { state: string } | undefined; return row?.state ?? null; },
    poisonTraceObserver() { runtime.poisonTraceObserver(); },
    inspect() { return sqliteInspect(database); },
    planFault(method, point, occurrence) { runtime.plan(method, point, occurrence); },
    dispose() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

const sqliteFactory: ContractSubjectFactory<SqliteSubject> = {
  name: "isolated SQLite EF-S07 adapter",
  create() {
    const root = mkdtempSync(join(tmpdir(), "piclaw-s07-")), path = join(root, "store.sqlite");
    return openSqliteSubject(path, root);
  },
  crashAndRestore(subject) {
    const trace = subject.runtime.trace.snapshot();
    subject.database.close();
    return { subject: openSqliteSubject(subject.path, subject.root, trace), context: context() };
  },
  inspectTrace(subject) { return subject.runtime.trace.snapshot(); },
};

type FakeSubject = ScheduledRunContractSubject & { backend: FakeScheduledRunBackend; fake: FakeScheduledRunStore };
function fakeSubject(ctx: ContractTestContext, snapshot?: ReturnType<FakeScheduledRunStore["snapshot"]>): FakeSubject {
  const backend = new FakeScheduledRunBackend();
  if (snapshot) backend.restore(snapshot);
  const fake = new FakeScheduledRunStore(backend, ctx, snapshot?.trace);
  return {
    store: fake, authority: createFakeScheduledTaskAuthority(backend), backend, fake,
    peerStore() { return new FakeScheduledRunStore(backend, ctx); },
    acceptAgentSource(input) { backend.acceptScheduledAgentSource({ sourceId: input.runId, kind: "scheduled_agent", chatJid: input.chatJid, sourceSeq: input.sourceSeq, operationId: input.operationId, primary: true }); },
    async markOutboxUnknown(outboxId) { backend.markOutboxUnknown(outboxId); },
    async outboxState(outboxId) { return backend.outboxStates.get(outboxId) ?? null; },
    poisonTraceObserver() { fake.poisonTraceObserver(); },
    inspect() { return { occurrences: backend.runs.size, runLogs: [...backend.runs.values()].filter((run) => run.record.state === "completed").length, nextDecisions: [...backend.runs.values()].filter((run) => run.record.state === "completed" || run.record.state === "abandoned").length, outboxRows: backend.outboxIds.size, tombstones: backend.tombstones.size }; },
    planFault(method, point, occurrence) { fake.planFault(method, point, occurrence); },
  };
}
const fakeFactory: ContractSubjectFactory<FakeSubject> = {
  name: "independent in-memory EF-S07 fake",
  create(ctx) { return fakeSubject(ctx); },
  crashAndRestore(subject, ctx) { return { subject: fakeSubject(ctx, subject.fake.snapshot()), context: ctx }; },
  inspectTrace(subject) { return subject.fake.trace.snapshot(); },
};

for (const [label, factory] of [["SQLite", sqliteFactory], ["fake", fakeFactory]] as const) {
  test(`paused current-slot cleanup retains its successor receipt until resume: ${label}`, async () => {
    const subject = await factory.create(context());
    try {
      subject.authority.create(authorityTask("task:paused-cleanup"));
      const claimed = await subject.store.claimDue(dueClaim("paused-cleanup"));
      if (!claimed.ok) throw Error(claimed.error._tag);
      subject.authority.pause("task:paused-cleanup");
      const completed = await subject.store.complete(completion(claimed.value[0]!,"complete:paused-cleanup"));
      if (!completed.ok) throw Error(completed.error._tag);
      expect(completed.value.headDisposition).toBe("paused");
      const held = await subject.store.cleanupTerminal({ settledBefore: "2026-08-16T01:01:00.000Z", limit: 10 });
      expect(held.ok && held.value.removed).toBe(0);
      expect(subject.inspect().nextDecisions).toBe(1);
      subject.authority.resume("task:paused-cleanup");
      const retired = await subject.store.cleanupTerminal({ settledBefore: "2026-08-16T01:02:00.000Z", limit: 10 });
      expect(retired.ok && retired.value.removed).toBe(1);
      const next = await subject.store.claimDue(dueClaim("paused-resumed",completed.value.nextRunAt!));
      expect(next.ok && next.value.length).toBe(1);
      expect(next.ok && next.value[0]?.record.scheduledFor).toBe(completed.value.nextRunAt);
    } finally { subject.dispose?.(); }
  });
}

describe("EF-S07 ScheduledRunStore shared contract", () => {
  test("independent fake", async () => { const results = await defineScheduledRunStoreContract(fakeFactory, context); expect(results.length).toBe(21); });
  test("isolated SQLite adapter", { timeout: 20000 }, async () => { const results = await defineScheduledRunStoreContract(sqliteFactory, context); expect(results.length).toBe(21); });
});

function authorityTask(taskId: string, overrides: Partial<ScheduledTaskAuthorityInput> = {}): ScheduledTaskAuthorityInput {
  return { taskId, chatJid: "web:hardening", kind: "shell", payloadRef: `payload:${taskId}`, modelLabel: null, scheduleType: "interval", scheduleValue: "60000", timezone: "UTC", notifyOnComplete: true, muted: false, cwd: null, timeoutSec: null, internalTask: null, redactionClass: "private", executionRepeatability: "repeatable", nextRunAt: "2026-08-16T01:00:00.000Z", authoredAt: "2026-08-16T00:00:00.000Z", ...overrides };
}
function dueClaim(prefix: string, now = "2026-08-16T01:00:00.000Z") {
  return { now, limit: 10, workerId: `worker:${prefix}`, leaseTokenPrefix: `prefix:${prefix}`, leaseDurationMs: 60000, reclaimAuthorities: [] as const };
}
function deliveryIntent(id: string) {
  const intent = { effect: { idempotencyKey: `outbox:${id}`, requestHash: "", operationId: null, sourceSeq: null, provenanceRef: `provenance:${id}`, redactionClass: "private" as const }, outboxId: `outbox:${id}`, kind: "channel_delivery" as const, payloadRef: `payload:${id}`, destinationRef: "destination:web", availableAt: "2026-08-16T01:00:10.000Z", enqueuedAt: "2026-08-16T01:00:10.000Z", repeatability: "reconciliation_required" as const };
  intent.effect.requestHash = hashCanonicalRequest(intent as unknown as CanonicalJsonValue);
  return intent;
}
function agentDeliveryIntent(id: string, operationId: string, sourceSeq: number) {
  const base = deliveryIntent(id);
  const intent = { ...base, effect: { ...base.effect, operationId: operationId as string | null, sourceSeq: sourceSeq as number | null, requestHash: "" } };
  intent.effect.requestHash = hashCanonicalRequest(intent as unknown as CanonicalJsonValue);
  return intent;
}
function completion(lease: ScheduledRunLease, key: string, completedAt = "2026-08-16T01:00:10.000Z", intents: readonly ReturnType<typeof deliveryIntent>[] = []): CompleteScheduledRunRequest {
  const request: CompleteScheduledRunRequest = { effect: { idempotencyKey: key, requestHash: "", operationId: lease.record.operationId, sourceSeq: lease.record.acceptedSourceSeq, provenanceRef: `provenance:${key}`, redactionClass: "private" }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: completedAt, status: "success", durationMs: 10, resultRef: `result:${key}`, errorCode: null, completedAt, outboxIntents: intents };
  request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
  return request;
}

function isolated(): SqliteSubject {
  const root = mkdtempSync(join(tmpdir(), "piclaw-s07-hardening-"));
  return openSqliteSubject(join(root, "store.sqlite"), root);
}

describe("EF-S07 SQLite hardening", () => {
  test("post-claim pause, delete, and revision preserve the frozen occurrence authority", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:pause"));
      let claimed = await subject.store.claimDue(dueClaim("pause"));
      expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      subject.authority.pause("task:pause");
      const paused = await subject.store.complete(completion(claimed.value[0], "complete:pause"));
      expect(paused.ok && paused.value.headDisposition).toBe("paused");
      expect(paused.ok && paused.value.nextRunAt).toBe("2026-08-16T01:01:10.000Z");
      subject.authority.resume("task:pause");
      const resumed = await subject.store.claimDue(dueClaim("pause-resume", "2026-08-16T01:01:10.000Z"));
      expect(resumed.ok && resumed.value.length).toBe(1);

      subject.authority.create(authorityTask("task:delete"));
      claimed = await subject.store.claimDue(dueClaim("delete")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      subject.authority.delete("task:delete");
      const deleted = await subject.store.complete(completion(claimed.value[0], "complete:delete"));
      expect(deleted.ok && deleted.value.headDisposition).toBe("deleted");
      expect(deleted.ok && deleted.value.nextRunAt).toBeNull();

      subject.authority.create(authorityTask("task:revision"));
      claimed = await subject.store.claimDue(dueClaim("revision")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      subject.authority.update({ ...authorityTask("task:revision", { payloadRef: "payload:revision:v2", nextRunAt: "2026-08-16T02:00:00.000Z", authoredAt: "2026-08-16T01:00:05.000Z" }), expectedRevision: 1 });
      const superseded = await subject.store.complete(completion(claimed.value[0], "complete:revision"));
      expect(superseded.ok && superseded.value.headDisposition).toBe("superseded");
      expect(superseded.ok && superseded.value.nextRunAt).toBeNull();
    } finally { subject.dispose?.(); }
  });

  test("same scheduledFor across revisions derives distinct durable occurrence identities", async () => {
    const subject = isolated();
    try {
      const scheduledFor = "2026-08-16T01:00:00.000Z";
      subject.authority.create(authorityTask("task:revision-identity", { nextRunAt: scheduledFor }));
      const first = await subject.store.claimDue(dueClaim("revision-identity-v1"));
      expect(first.ok && first.value.length).toBe(1);
      if (!first.ok) return;

      subject.authority.update({
        ...authorityTask("task:revision-identity", {
          payloadRef: "payload:revision-identity:v2",
          nextRunAt: scheduledFor,
          authoredAt: "2026-08-16T01:00:05.000Z",
        }),
        expectedRevision: 1,
      });
      const second = await subject.store.claimDue(dueClaim("revision-identity-v2", "2026-08-16T01:00:06.000Z"));
      expect(second.ok && second.value.length).toBe(1);
      if (!second.ok) return;
      expect(second.value[0].record.taskRevision).toBe(2);
      expect(first.value[0].record.runId).not.toBe(second.value[0].record.runId);
      expect(first.value[0].record.scheduledFor).toBe(second.value[0].record.scheduledFor);
    } finally { subject.dispose?.(); }
  });

  test("abandon writes no run log, retention tombstones identity, and exact replay remains stable", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:abandon", { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
      const claimed = await subject.store.claimDue(dueClaim("abandon")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const lease = claimed.value[0];
      const request = { effect: { idempotencyKey: "abandon:key", requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "provenance:abandon", redactionClass: "private" as const }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", reasonTag: "pre_effect_failure", abandonedAt: "2026-08-16T01:00:10.000Z", retryAt: "2026-08-16T01:05:00.000Z" };
      request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
      const abandoned = await subject.store.abandon(request);
      expect(abandoned.ok && abandoned.value.nextRunAt).toBe("2026-08-16T01:05:00.000Z");
      expect(subject.inspect().runLogs).toBe(0);
      const cleaned = await subject.store.cleanupTerminal({ settledBefore: "2026-08-16T01:01:00.000Z", limit: 10 });
      expect(cleaned.ok && cleaned.value.removed).toBe(1);
      const retained = await subject.store.get(lease.record.runId);
      expect(retained.ok && retained.value?.retained).toBe(true);
      expect(retained.ok && retained.value?.resultRef).toBeNull();
      const replay = await subject.store.abandon(request);
      expect(replay.ok && replay.value.retained).toBe(true);
      const later = await subject.store.claimDue(dueClaim("abandon-retry", "2026-08-16T01:05:00.000Z"));
      expect(later.ok && later.value.length).toBe(1);
    } finally { subject.dispose?.(); }
  });

  test("expired shell occurrences require explicit reclaim authority and preserve attempt fencing", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:reclaim"));
      const claimed = await subject.store.claimDue({ ...dueClaim("reclaim"), leaseDurationMs: 1000 }); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const first = claimed.value[0];
      const denied = await subject.store.claimDue(dueClaim("reclaim-denied", "2026-08-16T01:00:02.000Z"));
      expect(denied.ok && denied.value.length).toBe(0);
      const allowed = await subject.store.claimDue({ ...dueClaim("reclaim-allowed", "2026-08-16T01:00:02.000Z"), reclaimAuthorities: [{ runId: first.record.runId, expectedAttempt: 1, kind: "repeatable" as const, reconciliationRef: null }] });
      expect(allowed.ok && allowed.value[0].record.attempt).toBe(2);
      const stale = await subject.store.complete(completion(first, "complete:stale"));
      expect(!stale.ok && stale.error._tag).toBe("lease_conflict");
    } finally { subject.dispose?.(); }
  });

  test("agent reclaim persists exact reconciled-absence authority", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:agent-reclaim", { kind: "agent", executionRepeatability: "agent_source" }));
      const claimed = await subject.store.claimDue({ ...dueClaim("agent-reclaim"), leaseDurationMs: 1000 }); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const lease = claimed.value[0];
      const denied = await subject.store.claimDue(dueClaim("agent-reclaim-denied", "2026-08-16T01:00:02.000Z"));
      expect(denied.ok && denied.value.length).toBe(0);
      const reference = "reconciliation:agent-source-absent";
      const reclaimed = await subject.store.claimDue({ ...dueClaim("agent-reclaim-allowed", "2026-08-16T01:00:02.000Z"), reclaimAuthorities: [{ runId: lease.record.runId, expectedAttempt: 1, kind: "agent_reconciled_absent" as const, reconciliationRef: reference }] });
      expect(reclaimed.ok && reclaimed.value[0].record.attempt).toBe(2);
      expect(subject.database.query("SELECT authority_kind,reconciliation_ref FROM service_effect_s07_leases WHERE run_id=? AND attempt=2").get(lease.record.runId)).toEqual({ authority_kind: "agent_reconciled_absent", reconciliation_ref: reference });
    } finally { subject.dispose?.(); }
  });

  test("renewal history and claim replay agree with the effective lease after restore", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:renewal-history"));
      const claimRequest = dueClaim("renewal-history"), claimed = await subject.store.claimDue(claimRequest); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const lease = claimed.value[0], renewal = { runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", leaseExpiresAt: "2026-08-16T01:02:00.000Z" };
      const renewed = await subject.store.renew(renewal); expect(renewed.ok).toBe(true);
      const row = subject.database.query("SELECT l.lease_expires_at,r.previous_expires_at,r.lease_expires_at AS renewed_expires_at FROM service_effect_s07_leases l JOIN service_effect_s07_lease_renewals r ON r.run_id=l.run_id AND r.attempt=l.attempt WHERE l.run_id=?").get(lease.record.runId) as { lease_expires_at: string; previous_expires_at: string; renewed_expires_at: string };
      expect(row).toEqual({ lease_expires_at: renewal.leaseExpiresAt, previous_expires_at: lease.record.leaseExpiresAt, renewed_expires_at: renewal.leaseExpiresAt });
      const restored = sqliteFactory.crashAndRestore ? await sqliteFactory.crashAndRestore(subject, context()) : null;
      expect(restored).not.toBeNull(); if (!restored) return;
      const replay = await restored.subject.store.claimDue(claimRequest);
      expect(replay.ok && replay.value[0].record.leaseExpiresAt).toBe(renewal.leaseExpiresAt);
      restored.subject.dispose?.();
    } finally {
      try { subject.database.close(); } catch (error) { void error; /* restored connection owns cleanup */ }
      rmSync(subject.root, { recursive: true, force: true });
    }
  });

  for (const [index, checkpoint] of (["next_decision_insert", "run_log_insert", "outbox_insert", "outbox_decision_insert", "outbox_link_insert", "task_head_update", "occurrence_terminal_update", "decision_insert"] as ScheduledRunStatement[]).entries()) test(`every completion statement checkpoint rolls back and a clean retry commits once: ${checkpoint}`, async () => {
    const subject = isolated();
    try {
      const id = `rollback-${index}`;
      subject.authority.create(authorityTask(`task:${id}`));
      const claimed = await subject.store.claimDue(dueClaim(id)); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const request = completion(claimed.value[0], `complete:${id}`, "2026-08-16T01:00:10.000Z", [deliveryIntent(id)]);
      subject.runtime.failAfterStatement(checkpoint);
      const failed = await subject.store.complete(request);
      expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
      const restored = await sqliteFactory.crashAndRestore!(subject, context());
      expect(restored.subject.inspect()).toMatchObject({ runLogs: 0, nextDecisions: 0, outboxRows: 0 });
      const retry = await restored.subject.store.complete(request);
      expect(retry.ok).toBe(true);
      expect(restored.subject.inspect()).toMatchObject({ runLogs: 1, nextDecisions: 1, outboxRows: 1 });
      restored.subject.dispose?.();
    } finally { subject.dispose?.(); }
  });

  for (const [index, checkpoint] of (["next_decision_insert", "run_log_insert", "outbox_insert", "outbox_decision_insert", "outbox_link_insert", "task_head_update", "occurrence_terminal_update", "decision_insert"] as ScheduledRunStatement[]).entries()) test(`agent-bound completion checkpoints restore binding without terminal or outbox partials: ${checkpoint}`, async () => {
    const subject = isolated();
    try {
      const id = `agent-rollback-${index}`;
      subject.authority.create(authorityTask(`task:${id}`, { chatJid: `chat:${id}`, kind: "agent", executionRepeatability: "agent_source" }));
      const claimed = await subject.store.claimDue(dueClaim(id)); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const lease = claimed.value[0], operationId = `operation:${id}`, sourceSeq = 1;
      acceptSqliteSource(subject.database, { runId: lease.record.runId, chatJid: lease.task.chatJid, sourceSeq, operationId });
      const binding = { effect: { idempotencyKey: `bind:${id}`, requestHash: "", operationId, sourceSeq, provenanceRef: `provenance:${id}`, redactionClass: "private" as const }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: 1, expectedTaskRevision: 1, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:05.000Z", sourceSeq, operationId, boundAt: "2026-08-16T01:00:05.000Z" };
      binding.effect.requestHash = hashCanonicalRequest(binding as unknown as CanonicalJsonValue);
      const bound = await subject.store.bindAcceptedSource(binding); expect(bound.ok).toBe(true); if (!bound.ok) return;
      const boundLease = { ...lease, record: bound.value as ScheduledRunLease["record"] };
      const request = completion(boundLease, `complete:${id}`, "2026-08-16T01:00:10.000Z", [agentDeliveryIntent(id, operationId, sourceSeq)]);
      subject.runtime.failAfterStatement(checkpoint);
      const failed = await subject.store.complete(request);
      expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
      const restored = await sqliteFactory.crashAndRestore!(subject, context());
      const current = await restored.subject.store.get(lease.record.runId);
      expect(current.ok && current.value?.state).toBe("source_bound");
      expect(restored.subject.inspect()).toMatchObject({ runLogs: 0, nextDecisions: 0, outboxRows: 0 });
      expect((restored.subject.database.query("SELECT COUNT(*) AS count FROM service_effect_s07_source_bindings WHERE run_id=?").get(lease.record.runId) as { count: number }).count).toBe(1);
      const retry = await restored.subject.store.complete(request);
      expect(retry.ok).toBe(true);
      expect(restored.subject.inspect()).toMatchObject({ runLogs: 1, nextDecisions: 1, outboxRows: 1 });
      restored.subject.dispose?.();
    } finally { subject.dispose?.(); }
  });

  test("claim checkpoints are atomic", async () => {
    for (const [index, checkpoint] of (["occurrence_insert", "lease_insert", "decision_insert"] as ScheduledRunStatement[]).entries()) {
      const subject = isolated();
      try {
        subject.authority.create(authorityTask(`task:claim-fault-${index}`));
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.claimDue(dueClaim(`claim-fault-${index}`));
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        expect(subject.inspect().occurrences).toBe(0);
      } finally { subject.dispose?.(); }
    }

  });

  test("source binding checkpoints are atomic", async () => {
    for (const checkpoint of ["source_binding_insert", "source_binding_update", "decision_insert"] as ScheduledRunStatement[]) {
      const subject = isolated();
      try {
        const task = authorityTask(`task:bind-fault-${checkpoint}`);
        subject.authority.create({ ...task, kind: "agent", payloadRef: `payload:agent:${checkpoint}`, executionRepeatability: "agent_source" });
        const claimed = await subject.store.claimDue(dueClaim(`bind-fault-${checkpoint}`)); expect(claimed.ok).toBe(true); if (!claimed.ok) continue;
        const lease = claimed.value[0], sourceSeq = 1, operationId = `operation:${checkpoint}`;
        acceptSqliteSource(subject.database, { runId: lease.record.runId, chatJid: lease.task.chatJid, sourceSeq, operationId });
        const request = { effect: { idempotencyKey: `bind:${checkpoint}`, requestHash: "", operationId, sourceSeq, provenanceRef: "provenance:bind-fault", redactionClass: "private" as const }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", sourceSeq, operationId, boundAt: "2026-08-16T01:00:10.000Z" };
        request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.bindAcceptedSource(request);
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        const restored = await sqliteFactory.crashAndRestore!(subject, context());
        const current = await restored.subject.store.get(lease.record.runId);
        expect(current.ok && current.value?.state).toBe("claimed");
        expect((restored.subject.database.query("SELECT COUNT(*) AS count FROM service_effect_s07_source_bindings").get() as { count: number }).count).toBe(0);
        const retry = await restored.subject.store.bindAcceptedSource(request);
        expect(retry.ok && retry.value.state).toBe("source_bound");
        restored.subject.dispose?.();
      } finally { subject.dispose?.(); }
    }

  });

  test("renewal checkpoints are atomic", async () => {
    for (const checkpoint of ["renewal_insert", "lease_history_update", "lease_renew", "decision_insert"] as ScheduledRunStatement[]) {
      const subject = isolated();
      try {
        subject.authority.create(authorityTask(`task:renew-fault-${checkpoint}`));
        const claimed = await subject.store.claimDue(dueClaim(`renew-fault-${checkpoint}`)); expect(claimed.ok).toBe(true); if (!claimed.ok) continue;
        const lease = claimed.value[0], expiry = lease.record.leaseExpiresAt;
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.renew({ runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", leaseExpiresAt: "2026-08-16T01:02:00.000Z" });
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        const current = await subject.store.get(lease.record.runId);
        expect(current.ok && current.value?.leaseExpiresAt).toBe(expiry);
        const history = subject.database.query("SELECT lease_expires_at FROM service_effect_s07_leases WHERE run_id=? AND attempt=?").get(lease.record.runId, lease.record.attempt) as { lease_expires_at: string };
        expect(history.lease_expires_at).toBe(expiry);
        expect((subject.database.query("SELECT COUNT(*) AS count FROM service_effect_s07_lease_renewals WHERE run_id=?").get(lease.record.runId) as { count: number }).count).toBe(0);
      } finally { subject.dispose?.(); }
    }

  });

  test("abandonment checkpoints are atomic", async () => {
    for (const checkpoint of ["next_decision_insert", "abandonment_insert", "task_head_update", "occurrence_terminal_update", "decision_insert"] as ScheduledRunStatement[]) {
      const subject = isolated();
      try {
        subject.authority.create(authorityTask(`task:abandon-fault-${checkpoint}`));
        const claimed = await subject.store.claimDue(dueClaim(`abandon-fault-${checkpoint}`)); expect(claimed.ok).toBe(true); if (!claimed.ok) continue;
        const lease = claimed.value[0], request = { effect: { idempotencyKey: `abandon:${checkpoint}`, requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "provenance:abandon-fault", redactionClass: "private" as const }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: 1, expectedTaskRevision: 1, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:10.000Z", reasonTag: "fault", abandonedAt: "2026-08-16T01:00:10.000Z", retryAt: null };
        request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.abandon(request);
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        const current = await subject.store.get(lease.record.runId);
        expect(current.ok && current.value?.state).toBe("claimed");
        expect(subject.inspect().nextDecisions).toBe(0);
      } finally { subject.dispose?.(); }
    }

  });

  test("retention cleanup checkpoints are atomic", async () => {
    for (const checkpoint of ["tombstone_insert", "retention_delete", "decision_insert"] as ScheduledRunStatement[]) {
      const subject = isolated();
      try {
        subject.authority.create(authorityTask(`task:cleanup-fault-${checkpoint}`));
        const claimed = await subject.store.claimDue(dueClaim(`cleanup-fault-${checkpoint}`)); expect(claimed.ok).toBe(true); if (!claimed.ok) continue;
        const done = await subject.store.complete(completion(claimed.value[0], `complete:cleanup-fault-${checkpoint}`)); expect(done.ok).toBe(true);
        subject.runtime.failAfterStatement(checkpoint);
        const failed = await subject.store.cleanupTerminal({ settledBefore: "2026-08-16T01:01:00.000Z", limit: 1 });
        expect(!failed.ok && failed.error._tag).toBe("storage_unavailable");
        const current = await subject.store.get(claimed.value[0].record.runId);
        expect(current.ok && current.value?.retained).toBe(false);
        expect(subject.inspect().tombstones).toBe(0);
      } finally { subject.dispose?.(); }
    }
  });

  test("two SQLite connections share one occurrence authority", async () => {
    const root = mkdtempSync(join(tmpdir(), "piclaw-s07-two-connections-")), path = join(root, "store.sqlite");
    const leftDb = new Database(path, { create: true }), rightDb = new Database(path);
    try {
      for (const database of [leftDb, rightDb]) database.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0; PRAGMA foreign_keys=ON");
      installScheduledRunCompositionSchema(leftDb);
      createScheduledTaskAuthority(leftDb).create(authorityTask("task:two-connections"));
      const left = createCurrentPiclawScheduledRunStore(leftDb, new Runtime()), right = createCurrentPiclawScheduledRunStore(rightDb, new Runtime());
      expect(left.ok && right.ok).toBe(true); if (!left.ok || !right.ok) return;
      const [a, b] = await Promise.all([left.value.claimDue(dueClaim("two-left")), right.value.claimDue(dueClaim("two-right"))]);
      expect(a.ok && b.ok).toBe(true);
      expect((a.ok ? a.value.length : 0) + (b.ok ? b.value.length : 0)).toBe(1);
      const first = a.ok && a.value.length ? a.value[0] : b.ok ? b.value[0] : null; expect(first).not.toBeNull(); if (!first) return;
      expect((leftDb.query("SELECT COUNT(*) AS count FROM service_effect_s07_occurrences").get() as { count: number }).count).toBe(1);
      const reclaimAuthority = [{ runId: first.record.runId, expectedAttempt: 1, kind: "repeatable" as const, reconciliationRef: null }];
      const [reclaimLeft, reclaimRight] = await Promise.all([
        left.value.claimDue({ ...dueClaim("two-reclaim-left", "2026-08-16T01:01:01.000Z"), reclaimAuthorities: reclaimAuthority }),
        right.value.claimDue({ ...dueClaim("two-reclaim-right", "2026-08-16T01:01:01.000Z"), reclaimAuthorities: reclaimAuthority }),
      ]);
      expect(reclaimLeft.ok && reclaimRight.ok).toBe(true);
      expect((reclaimLeft.ok ? reclaimLeft.value.length : 0) + (reclaimRight.ok ? reclaimRight.value.length : 0)).toBe(1);
      const second = reclaimLeft.ok && reclaimLeft.value.length ? reclaimLeft.value[0] : reclaimRight.ok ? reclaimRight.value[0] : null; expect(second?.record.attempt).toBe(2); if (!second) return;
      const [terminalLeft, terminalRight] = await Promise.all([
        left.value.complete(completion(second, "two-terminal-left", "2026-08-16T01:01:10.000Z")),
        right.value.complete(completion(second, "two-terminal-right", "2026-08-16T01:01:10.000Z")),
      ]);
      expect(Number(terminalLeft.ok) + Number(terminalRight.ok)).toBe(1);
      const loser = terminalLeft.ok ? terminalRight : terminalLeft;
      expect(!loser.ok && loser.error._tag).toBe("invalid_transition");
      expect((leftDb.query("SELECT COUNT(*) AS count FROM service_effect_s07_run_logs").get() as { count: number }).count).toBe(1);
      expect((leftDb.query("SELECT COUNT(*) AS count FROM service_effect_s07_next_decisions").get() as { count: number }).count).toBe(1);
      expect((leftDb.query("SELECT COUNT(*) AS count FROM service_effect_s07_leases WHERE run_id=?").get(first.record.runId) as { count: number }).count).toBe(2);
      expect((await left.value.listRuns({ limit: 10 })).ok).toBe(true);
      expect((await right.value.listRuns({ limit: 10 })).ok).toBe(true);
    } finally { rightDb.close(); leftDb.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test("composition installation is atomic and repeatable", () => {
    const database = new Database(":memory:"); database.exec("PRAGMA foreign_keys=ON");
    expect(() => installScheduledRunCompositionSchema(database, { afterBoundary(boundary) { if (boundary === "service_outbox") throw new Error("stop"); } })).toThrow();
    const partial = database.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'service_effect_%'").all();
    expect(partial).toHaveLength(0);
    installScheduledRunCompositionSchema(database); installScheduledRunCompositionSchema(database);
    expect((database.query("SELECT COUNT(*) AS count FROM service_effect_s07_tasks").get() as { count: number }).count).toBe(0);
    database.close();
  });

  test("pre-existing equal EF-S05 rows are rejected before the first S07 completion", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:preexisting-outbox"));
      const claimed = await subject.store.claimDue(dueClaim("preexisting-outbox")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const intent = { effect: { idempotencyKey: "outbox:preexisting", requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "provenance:preexisting", redactionClass: "private" as const }, outboxId: "outbox:preexisting", kind: "channel_delivery" as const, payloadRef: "payload:preexisting", destinationRef: "destination:web", availableAt: "2026-08-16T01:00:10.000Z", enqueuedAt: "2026-08-16T01:00:10.000Z", repeatability: "reconciliation_required" as const };
      intent.effect.requestHash = hashCanonicalRequest(intent as unknown as CanonicalJsonValue);
      const inserter = createServiceOutboxEnqueueInserter(subject.database); expect(inserter.ok).toBe(true); if (!inserter.ok) return;
      subject.database.transaction(() => { const inserted = inserter.value.insert(intent); expect(inserted.ok).toBe(true); }).immediate();
      const base = completion(claimed.value[0], "complete:preexisting");
      const request: CompleteScheduledRunRequest = { ...base, effect: { ...base.effect, requestHash: "" }, outboxIntents: [intent] };
      request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
      const result = await subject.store.complete(request);
      expect(!result.ok && result.error._tag).toBe("idempotency_conflict");
      expect(subject.inspect().runLogs).toBe(0);
    } finally { subject.dispose?.(); }
  });

  test("global effect keys conflict across terminal methods", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:global-key"));
      const claimed = await subject.store.claimDue(dueClaim("global-key")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const lease = claimed.value[0], completed = await subject.store.complete(completion(lease, "shared:effect-key"));
      expect(completed.ok).toBe(true);
      const abandon = { effect: { idempotencyKey: "shared:effect-key", requestHash: "", operationId: null, sourceSeq: null, provenanceRef: "provenance:collision", redactionClass: "private" as const }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: lease.record.attempt, expectedTaskRevision: lease.record.taskRevision, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:11.000Z", reasonTag: "collision", abandonedAt: "2026-08-16T01:00:11.000Z", retryAt: null };
      abandon.effect.requestHash = hashCanonicalRequest(abandon as unknown as CanonicalJsonValue);
      const conflict = await subject.store.abandon(abandon);
      expect(!conflict.ok && conflict.error._tag).toBe("idempotency_conflict");
    } finally { subject.dispose?.(); }
  });

  test("malformed durable occurrence identity is a bounded corrupt_state", async () => {
    const subject = isolated();
    try {
      subject.authority.create(authorityTask("task:corrupt"));
      const claimed = await subject.store.claimDue(dueClaim("corrupt")); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      subject.database.exec("PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON");
      subject.database.query("UPDATE service_effect_s07_occurrences SET task_id='task:tampered' WHERE run_id=?").run(claimed.value[0].record.runId);
      const result = await subject.store.get(claimed.value[0].record.runId);
      expect(!result.ok && result.error._tag).toBe("corrupt_state");
    } finally { subject.dispose?.(); }
  });

  // Each independent disk-backed vector keeps the default five-second deadline.
  const probes: Array<(subject: SqliteSubject, lease: ScheduledRunLease, request: CompleteScheduledRunRequest) => Promise<void> | void> = [
    (subject, lease) => { subject.database.exec("PRAGMA ignore_check_constraints=ON"); subject.database.query("UPDATE service_effect_s07_leases SET lease_expires_at='2026-08-16T01:03:00.000Z' WHERE run_id=?").run(lease.record.runId); },
    async (subject, _lease, request) => { const done = await subject.store.complete(request); expect(done.ok).toBe(true); subject.database.query("UPDATE service_effect_s07_decisions SET result_json='{}' WHERE decision_key=?").run(`effect:${request.effect.idempotencyKey}`); },
    async (subject, lease, request) => { const done = await subject.store.complete(request); expect(done.ok).toBe(true); const cleanup = await subject.store.cleanupTerminal({ settledBefore: "2026-08-16T01:01:00.000Z", limit: 1 }); expect(cleanup.ok).toBe(true); subject.database.exec("PRAGMA ignore_check_constraints=ON"); subject.database.query("UPDATE service_effect_s07_tombstones SET status=NULL WHERE run_id=?").run(lease.record.runId); },
    async (subject, lease, request) => { const intent = deliveryIntent("corrupt-link"); const composed = completion(lease, request.effect.idempotencyKey, request.completedAt, [intent]); const done = await subject.store.complete(composed); expect(done.ok).toBe(true); subject.database.exec("PRAGMA foreign_keys=OFF; PRAGMA ignore_check_constraints=ON"); subject.database.query("UPDATE service_effect_s07_outbox_links SET ordinal=9 WHERE run_id=?").run(lease.record.runId); },
  ];
  for (const [index, probe] of probes.entries()) {
    test(`malformed projection ${["lease", "decision", "tombstone", "outbox link"][index]} is bounded corrupt_state`, async () => {
      const subject = isolated();
      try {
        subject.authority.create(authorityTask(`task:projection-corrupt-${index}`, { scheduleType: "once", scheduleValue: "2026-08-16T01:00:00.000Z" }));
        const claimed = await subject.store.claimDue(dueClaim(`projection-corrupt-${index}`)); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
        const lease = claimed.value[0], request = completion(lease, `projection-corrupt-${index}`);
        await probe(subject, lease, request);
        const result = index === 1 ? await subject.store.complete(request) : await subject.store.get(lease.record.runId);
        expect(!result.ok && result.error._tag).toBe("corrupt_state");
      } finally { subject.dispose?.(); }
    });
  }

  test("malformed attempt overflow is bounded corrupt_state", async () => {
    const overflowSubject = isolated();
    try {
      overflowSubject.authority.create(authorityTask("task:attempt-overflow"));
      const claimed = await overflowSubject.store.claimDue({ ...dueClaim("attempt-overflow"), leaseDurationMs: 1000 }); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
      const lease = claimed.value[0];
      overflowSubject.database.query("UPDATE service_effect_s07_occurrences SET attempt=?,lease_expires_at=? WHERE run_id=?").run(Number.MAX_SAFE_INTEGER, "2026-08-16T01:00:01.000Z", lease.record.runId);
      const overflow = await overflowSubject.store.claimDue({ ...dueClaim("attempt-overflow-reclaim", "2026-08-16T01:00:02.000Z"), reclaimAuthorities: [{ runId: lease.record.runId, expectedAttempt: Number.MAX_SAFE_INTEGER, kind: "repeatable", reconciliationRef: null }] });
      expect(!overflow.ok && overflow.error._tag).toBe("corrupt_state");
    } finally { overflowSubject.dispose?.(); }
  });

  for (const variant of ["binding", "source_owner", "primary_source", "outbox_operation", "outbox_source"] as const) {
    test(`malformed source projection ${variant} is bounded corrupt_state`, async () => {
      const sourceSubject = isolated();
      try {
        sourceSubject.authority.create(authorityTask(`task:${variant}-corrupt`, { kind: "agent", executionRepeatability: "agent_source" }));
        const claimed = await sourceSubject.store.claimDue(dueClaim(`${variant}-corrupt`)); expect(claimed.ok).toBe(true); if (!claimed.ok) return;
        const lease = claimed.value[0], operationId = `operation:${variant}-corrupt`, sourceSeq = 1;
        acceptSqliteSource(sourceSubject.database, { runId: lease.record.runId, chatJid: lease.task.chatJid, sourceSeq, operationId });
        const request = { effect: { idempotencyKey: `bind:${variant}-corrupt`, requestHash: "", operationId, sourceSeq, provenanceRef: "provenance:source-corrupt", redactionClass: "private" as const }, runId: lease.record.runId, workerId: lease.record.workerId, expectedAttempt: 1, expectedTaskRevision: 1, leaseToken: lease.leaseToken, now: "2026-08-16T01:00:05.000Z", sourceSeq, operationId, boundAt: "2026-08-16T01:00:05.000Z" };
        request.effect.requestHash = hashCanonicalRequest(request as unknown as CanonicalJsonValue);
        const bound = await sourceSubject.store.bindAcceptedSource(request); expect(bound.ok).toBe(true); if (!bound.ok) return;
        const boundLease = { ...lease, record: bound.value as ScheduledRunLease["record"] };
        if (variant.startsWith("outbox")) {
          const done = await sourceSubject.store.complete(completion(boundLease, `complete:${variant}`, "2026-08-16T01:00:10.000Z", [agentDeliveryIntent(variant, operationId, sourceSeq)]));
          expect(done.ok).toBe(true);
        }
        sourceSubject.database.exec("PRAGMA foreign_keys=OFF");
        if (variant === "binding") sourceSubject.database.query("UPDATE service_effect_s07_source_bindings SET operation_id='operation:tampered' WHERE run_id=?").run(lease.record.runId);
        else if (variant === "source_owner") sourceSubject.database.query("UPDATE service_effect_s01_sources SET source_id='scheduled_run:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE chat_jid=? AND source_seq=?").run(lease.task.chatJid, sourceSeq);
        else if (variant === "primary_source") sourceSubject.database.query("UPDATE service_effect_s01_operations SET primary_source_seq=2 WHERE operation_id=?").run(operationId);
        else if (variant === "outbox_operation") sourceSubject.database.query("UPDATE service_effect_s05_outbox SET operation_id='operation:tampered' WHERE outbox_id=?").run(`outbox:${variant}`);
        else sourceSubject.database.query("UPDATE service_effect_s05_outbox SET source_seq=2 WHERE outbox_id=?").run(`outbox:${variant}`);
        const corrupt = await sourceSubject.store.get(lease.record.runId);
        expect(!corrupt.ok && corrupt.error._tag).toBe("corrupt_state");
      } finally { sourceSubject.dispose?.(); }
    });
  }

  test("current recurrence utility pins UTC and Lisbon DST vectors", () => {
    expect(computeNextRun("cron", "*/5 * * * *", { currentDate: "2024-01-01T00:00:00.000Z", timezone: "UTC" })).toBe("2024-01-01T00:05:00.000Z");
    expect(computeNextRun("cron", "30 1 * * *", { currentDate: "2024-03-30T01:30:00.000Z", timezone: "Europe/Lisbon" })).toBe("2024-03-31T01:30:00.000Z");
    expect(computeNextRun("cron", "30 1 * * *", { currentDate: "2024-10-27T00:30:00.000Z", timezone: "Europe/Lisbon" })).toBe("2024-10-28T01:30:00.000Z");
  });
});

// Synthetic historical state: the scheduler lost its lease after source binding,
// while the host interrupted and disposed the never-harness-bound source.
async function interruptedScheduledFixture() {
  const root=mkdtempSync(join(tmpdir(),"piclaw-s07-reconcile-"));
  const f=openSqliteSubject(join(root,"store.sqlite"),root);
  await f.authority.create(authorityTask('task:interrupted',{kind:'agent',executionRepeatability:'agent_source',scheduleType:'cron',scheduleValue:'0 1 * * *'}));
  const lease=(await f.store.claimDue(dueClaim('interrupted'))).value![0]!;
  const operationId='operation:interrupted';
  f.acceptAgentSource({runId:lease.record.runId,chatJid:lease.task.chatJid,sourceSeq:1,operationId});
  const bind={effect:{idempotencyKey:'bind:interrupted',requestHash:'',operationId,sourceSeq:1,provenanceRef:lease.record.runId,redactionClass:'private' as const},runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:lease.record.attempt,expectedTaskRevision:lease.record.taskRevision,leaseToken:lease.leaseToken,now:'2026-08-16T01:00:01.000Z',boundAt:'2026-08-16T01:00:01.000Z',sourceSeq:1,operationId};
  bind.effect.requestHash=hashCanonicalRequest(bind as unknown as CanonicalJsonValue);
  expect((await f.store.bindAcceptedSource(bind)).ok).toBe(true);
  f.database.transaction(()=>{
    f.database.query("UPDATE service_effect_s01_operations SET version=2,phase='terminal',terminal_disposition='failed',terminal_error_code='scheduled_run_interrupted',terminal_committed_at='2026-08-16T01:02:00.000Z' WHERE operation_id=?").run(operationId);
    f.database.query("UPDATE service_effect_s01_sources SET state='disposed',disposition_reason='scheduled_run_interrupted' WHERE source_id=?").run(lease.record.runId);
    f.database.query('UPDATE service_effect_s01_chats SET active_operation_id=NULL,consumed_through_source_seq=1 WHERE chat_jid=?').run(lease.task.chatJid);
  }).immediate();
  const built=createCurrentPiclawScheduledRunStore(f.database,f.runtime);if(!built.ok)throw Error(built.error._tag);
  const request={effect:{idempotencyKey:'reconcile:interrupted',requestHash:'',operationId,sourceSeq:1,provenanceRef:lease.record.runId,redactionClass:'private' as const},runId:lease.record.runId,expectedAttempt:1,expectedTaskRevision:1,expectedOperationVersion:2,expectedLeaseExpiresAt:lease.record.leaseExpiresAt,now:'2026-08-20T12:00:00.000Z'};
  const seal=()=>{request.effect.requestHash=hashCanonicalRequest(request as unknown as CanonicalJsonValue);return request;};
  const rows=(table:string)=>f.database.query(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const immutable=()=>['service_effect_s01_sources','service_effect_s01_operations','service_effect_s01_operation_sources','service_effect_s07_leases','service_effect_s07_source_bindings'].map(rows);
  const snapshot=()=>['service_effect_s07_occurrences','service_effect_s07_tasks','service_effect_s07_next_decisions','service_effect_s07_run_logs','service_effect_s07_decisions','service_effect_s05_outbox'].map(rows);
  return {...f,native:built.value,lease,request,seal,immutable,snapshot};
}

describe('expired interrupted agent terminal reconciliation',()=>{
  test('retains original identities and lease history, skips missed cron runs, and replays completion exactly once',async()=>{
    const f=await interruptedScheduledFixture();try{
      const before=f.immutable();
      const oldComplete=completion(f.lease,'expired-complete',f.request.now);
      expect((await f.store.complete(oldComplete)).ok).toBe(false);
      const result=await f.native.reconcileInterruptedAgentSource(f.seal());expect(result.ok).toBe(true);
      expect(result.value).toMatchObject({state:'completed',status:'error',errorCode:'scheduled_run_interrupted',attempt:1,operationId:f.request.effect.operationId,acceptedSourceSeq:1,headDisposition:'advanced',nextRunAt:'2026-08-21T01:00:00.000Z'});
      expect(f.immutable()).toEqual(before);
      const after=f.snapshot();expect((await f.native.reconcileInterruptedAgentSource(f.seal())).value).toEqual(result.value);expect(f.snapshot()).toEqual(after);
      expect(f.inspect()).toMatchObject({occurrences:1,runLogs:1,nextDecisions:1,outboxRows:0});
      expect((await f.store.claimDue(dueClaim('after-reconcile',f.request.now))).value).toEqual([]);
      expect((await f.store.get(f.request.runId)).value).toEqual(result.value);
    }finally{f.dispose();}
  });

  for(const fault of ['before_effect','effect_then_lost_acknowledgement'] as const)test(`reconciliation ${fault} preserves exact-once receipts`,async()=>{
    const f=await interruptedScheduledFixture();try{
      const before=f.immutable();f.runtime.plan('complete',fault,1);
      expect((await f.native.reconcileInterruptedAgentSource(f.seal())).ok).toBe(false);
      expect((await f.native.reconcileInterruptedAgentSource(f.seal())).ok).toBe(true);
      expect(f.inspect()).toMatchObject({occurrences:1,runLogs:1,nextDecisions:1,outboxRows:0});expect(f.immutable()).toEqual(before);
    }finally{f.dispose();}
  });

  for(const statement of ['next_decision_insert','run_log_insert','task_head_update','occurrence_terminal_update','decision_insert'] as const)test(`reconciliation rolls back ${statement}`,async()=>{
    const f=await interruptedScheduledFixture();try{
      const before=f.snapshot(),immutable=f.immutable();f.runtime.failAfterStatement(statement);
      expect((await f.native.reconcileInterruptedAgentSource(f.seal())).ok).toBe(false);expect(f.snapshot()).toEqual(before);expect(f.immutable()).toEqual(immutable);
      expect((await f.native.reconcileInterruptedAgentSource(f.seal())).ok).toBe(true);expect(f.inspect().runLogs).toBe(1);
    }finally{f.dispose();}
  });

  for(const malformed of ['attempt','revision','operation-version','expiry','unexpired','source-seq','source-state','operation-state','harness','error-code','active-link','source-kind'] as const)test(`reconciliation refuses ${malformed} without mutation`,async()=>{
    const f=await interruptedScheduledFixture();try{
      if(malformed==='attempt')f.request.expectedAttempt=2;
      if(malformed==='revision')f.request.expectedTaskRevision=2;
      if(malformed==='operation-version')f.request.expectedOperationVersion=3;
      if(malformed==='expiry')f.request.expectedLeaseExpiresAt='2026-08-16T01:02:00.000Z';
      if(malformed==='unexpired')f.request.now='2026-08-16T01:00:10.000Z';
      if(malformed==='source-seq')f.request.effect.sourceSeq=2;
      if(malformed==='source-state')f.database.exec("UPDATE service_effect_s01_sources SET state='claimed',disposition_reason=NULL");
      if(malformed==='operation-state')f.database.exec("UPDATE service_effect_s01_operations SET phase='claimed',terminal_disposition=NULL,terminal_error_code=NULL,terminal_committed_at=NULL");
      if(malformed==='harness')f.database.exec("UPDATE service_effect_s01_operations SET harness_session_id='old',harness_operation_id='old'");
      if(malformed==='error-code')f.database.exec("UPDATE service_effect_s01_operations SET terminal_error_code='other_failure'");
      if(malformed==='active-link')f.database.query('UPDATE service_effect_s01_chats SET active_operation_id=?').run(f.request.effect.operationId);
      if(malformed==='source-kind')f.database.exec("UPDATE service_effect_s01_sources SET kind='message'");
      const before=f.snapshot(),immutable=f.immutable();expect((await f.native.reconcileInterruptedAgentSource(f.seal())).ok).toBe(false);expect(f.snapshot()).toEqual(before);expect(f.immutable()).toEqual(immutable);
    }finally{f.dispose();}
  });

  test('paused head is preserved and no notification is invented',async()=>{
    const f=await interruptedScheduledFixture();try{
      f.authority.pause(f.lease.task.taskId);
      const head=f.database.query('SELECT * FROM service_effect_s07_tasks').all();
      const result=await f.native.reconcileInterruptedAgentSource(f.seal());expect(result.ok).toBe(true);expect(result.value?.headDisposition).toBe('paused');
      expect(f.database.query('SELECT * FROM service_effect_s07_tasks').all()).toEqual(head);expect(f.inspect().outboxRows).toBe(0);
    }finally{f.dispose();}
  });
});


test('terminal reconciliation preserves a newer task revision',async()=>{
  const f=await interruptedScheduledFixture();try{
    f.authority.update({...authorityTask(f.lease.task.taskId,{kind:'agent',executionRepeatability:'agent_source',scheduleType:'cron',scheduleValue:'30 3 * * *',nextRunAt:'2026-08-22T03:30:00.000Z',authoredAt:'2026-08-20T11:59:00.000Z'}),expectedRevision:1});
    const head=f.database.query('SELECT * FROM service_effect_s07_tasks').all();
    const result=await f.native.reconcileInterruptedAgentSource(f.seal());expect(result.ok).toBe(true);expect(result.value?.headDisposition).toBe('superseded');expect(result.value?.nextRunAt).toBeNull();
    expect(f.database.query('SELECT * FROM service_effect_s07_tasks').all()).toEqual(head);
  }finally{f.dispose();}
});

test('terminal reconciliation remains idempotent after native retention',async()=>{
  const f=await interruptedScheduledFixture();try{
    expect((await f.native.reconcileInterruptedAgentSource(f.seal())).ok).toBe(true);
    expect((await f.store.cleanupTerminal({settledBefore:'2026-08-21T00:00:00.000Z',limit:1})).value?.removed).toBe(1);
    const before=f.snapshot(),immutable=f.immutable();
    const replay=await f.native.reconcileInterruptedAgentSource(f.seal());expect(replay.ok).toBe(true);expect(replay.value).toMatchObject({state:'completed',status:'error',retained:true,attempt:1});
    expect(f.snapshot()).toEqual(before);expect(f.immutable()).toEqual(immutable);
  }finally{f.dispose();}
});

test('terminal reconciliation rejects altered request bytes before any mutation',async()=>{
  const f=await interruptedScheduledFixture();try{
    const request=f.seal(),before=f.snapshot();
    expect((await f.native.reconcileInterruptedAgentSource({...request,expectedOperationVersion:3})).ok).toBe(false);
    expect((await f.native.reconcileInterruptedAgentSource({...request,unqualified:true} as any)).ok).toBe(false);
    expect(f.snapshot()).toEqual(before);
  }finally{f.dispose();}
});

for (const busy of [false, true]) test(`scheduled admission regression: throwing post-commit hook retains unknown completion and exact receipt, busy=${busy}`, async () => {
  const subject = isolated();
  try {
    subject.authority.create(authorityTask(`task:throwing-ack-${busy}`));
    const claimed = await subject.store.claimDue(dueClaim(`throwing-ack-${busy}`));
    expect(claimed.ok).toBe(true); if (!claimed.ok) return;
    const lease = claimed.value[0]!, request = completion(lease, `complete:throwing-ack-${busy}`);
    const original = subject.runtime.hitFault.bind(subject.runtime);
    let throws = 0;
    subject.runtime.hitFault = (point, method) => {
      if (point === 'effect_then_lost_acknowledgement' && method === 'complete' && throws++ === 0)
        throw Object.assign(new Error('lost completion acknowledgement'), busy ? {code:'SQLITE_BUSY'} : {});
      return original(point, method);
    };
    const outcome = await subject.store.complete(request);
    expect(outcome).toMatchObject({ok:false,error:{_tag:'storage_unavailable',certainty:'unknown',retryable:true}});
    const observed = await subject.store.get(lease.record.runId);
    expect(observed.ok && observed.value).toMatchObject({state:'completed',status:'success',resultRef:request.resultRef,attempt:lease.record.attempt});
    expect(subject.inspect()).toMatchObject({occurrences:1,runLogs:1,nextDecisions:1});
    // Retry only the sealed completion identity, never shell/model/tool execution.
    const replay = await subject.peerStore().complete(request);
    expect(replay.ok && replay.value).toEqual(observed.ok && observed.value);
    expect(subject.inspect()).toMatchObject({occurrences:1,runLogs:1,nextDecisions:1});
  } finally {subject.dispose?.();}
});

test('scheduled admission regression: each competing WAL wait owns its existing five-second deadline', {timeout:15000}, async () => {
  const subject = isolated(), writer = new Database(subject.path);
  let ticks = 0, releaseTimer:ReturnType<typeof setTimeout>|undefined;
  const pulse = setInterval(()=>{ticks++;},10);
  try {
    subject.authority.create(authorityTask('task:bounded-acquisition'));
    writer.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
    const released = Promise.withResolvers<void>();
    releaseTimer = setTimeout(()=>{writer.exec('ROLLBACK');released.resolve();},6000);
    const started = performance.now();
    const outcomes = await Promise.all(['first','second'].map(prefix=>subject.store.claimDue(dueClaim(`bounded:${prefix}`))));
    const completedAfter = performance.now()-started;
    for (const result of outcomes) expect(result).toMatchObject({ok:false,error:{_tag:'storage_unavailable',certainty:'not_applied',retryable:true}});
    expect(completedAfter).toBeLessThan(5750);
    expect(ticks).toBeGreaterThan(50);
    expect(subject.inspect()).toMatchObject({occurrences:0,runLogs:0,nextDecisions:0});
    await released.promise; // Keep the real writer held beyond both five-second budgets.
    expect(subject.inspect()).toMatchObject({occurrences:0,runLogs:0,nextDecisions:0});
    expect(subject.database.query('PRAGMA busy_timeout').get()).toEqual({timeout:0});
  } finally {
    if (releaseTimer) clearTimeout(releaseTimer);
    clearInterval(pulse);
    if (writer.inTransaction) writer.exec('ROLLBACK');
    writer.close(); subject.dispose?.();
  }
});

test('scheduled mutation entry remains asynchronous without a private serial tail', async () => {
  const subject = isolated();
  try {
    subject.authority.create(authorityTask('task:async-entry'));
    const pending = subject.store.claimDue(dueClaim('async-entry'));
    expect(subject.inspect().occurrences).toBe(0);
    expect(subject.database.inTransaction).toBe(false);
    const claimed = await pending;
    expect(claimed.ok && claimed.value.length).toBe(1);
    expect(subject.inspect().occurrences).toBe(1);
  } finally {subject.dispose?.();}
});
