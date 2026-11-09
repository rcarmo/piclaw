import type { InterruptedHarnessIdentity } from "../../agent-pool/durable-runtime-adapter.js";
export type { InterruptedHarnessIdentity } from "../../agent-pool/durable-runtime-adapter.js";
import { admitSqliteWrite, isSqliteContention as isBusy } from '../../db/sqlite-async-admission.js';
import type Database from "bun:sqlite";
import type { ScheduledRunRetentionOwner, ScheduledRetentionPlan, ScheduledRetentionCursor } from "./scheduled-run-retention.js";
import { writeScheduledTaskHead } from "../../db/scheduled-task-head.js";
import { projectScheduledTask } from "../../db/scheduled-task-definitions.js";
import { assertProcessAdmission } from "../../runtime/process-admission.js";
import { Result, type Result as ResultValue } from "../contracts/result.js";

import type { NormalisedTraceInput } from "../contracts/common.js";
import type { ServiceOutboxEnqueueInserter } from "../contracts/service-outbox-store.js";
import type {
  AbandonScheduledRunRequest,
  BindScheduledSourceRequest,
  ClaimDueRunsRequest,
  CleanupScheduledRunsRequest,
  CleanupScheduledRunsResult,
  CompleteScheduledRunRequest,
  ListScheduledRunsRequest,
  RenewScheduledRunRequest,
  ReconcileInterruptedScheduledRunRequest,
  InterruptedScheduledRunReconciler,
  ScheduledRunHeadDisposition,
  ScheduledRunLease,
  ScheduledRunRecord,
  ScheduledRunStore,
  ScheduledRunStoreError,
  ScheduledRunStoreErrorTag,
  ScheduledTaskSnapshot,
} from "../contracts/scheduled-run-store.js";
import {
  createServiceOutboxEnqueueInserter,
  type ServiceOutboxEnqueueStatement,
} from "./service-outbox-store.js";
import {
  addCanonicalDuration,
  canonicalInstant,
  canonicalRequestHash,
  computeScheduledSuccessor,
  decodeClaimReplayRows,
  decodeCleanupResult,
  decodeScheduledRunRecord,
  decodeTaskSnapshot,
  deriveScheduledLeaseToken,
  deriveScheduledRunId,
  hashScheduledLeaseToken,
  normaliseAbandon,
  normaliseBind,
  normaliseClaim,
  normaliseCleanup,
  normaliseComplete,
  normaliseInterruptedReconciliation,
  normaliseList,
  normaliseRenew,
  validateScheduledRunId,
  validHash,
  validId,
  validRef,
  validScheduledRunId,
} from "./scheduled-run-values.js";

import { hasScheduledHistoryProjection, projectScheduledHistory, ScheduledHistoryError } from "./scheduled-history-projection.js";

const P = "service_effect_s07_";
const TASKS = `${P}tasks`, REVISIONS = `${P}task_revisions`, RUNS = `${P}occurrences`;
const LEASES = `${P}leases`, RENEWALS = `${P}lease_renewals`, BINDINGS = `${P}source_bindings`, LOGS = `${P}run_logs`;
const NEXT = `${P}next_decisions`, ABANDONMENTS = `${P}abandonments`, LINKS = `${P}outbox_links`;
const DECISIONS = `${P}decisions`, TOMBSTONES = `${P}tombstones`;
const OUTBOX_KINDS = new Set(["wake_chat", "timeline_broadcast", "channel_delivery", "notification", "scheduler_run_log", "maintenance"]);

export type ScheduledRunMutationMethod = "claimDue" | "renew" | "bindAcceptedSource" | "complete" | "abandon" | "cleanupTerminal";
type MutationMethod = ScheduledRunMutationMethod;
export type ScheduledRunStatement =
  | "occurrence_insert" | "occurrence_reclaim_update" | "lease_insert" | "renewal_insert" | "lease_history_update" | "lease_renew"
  | "source_binding_insert" | "source_binding_update"
  | "next_decision_insert" | "run_log_insert" | "history_projection" | "outbox_link_insert"
  | "task_head_update" | "occurrence_terminal_update" | "abandonment_insert"
  | "decision_insert" | "tombstone_insert" | "retention_delete"
  | ServiceOutboxEnqueueStatement;

export interface ScheduledRunAdapterRuntime {
  /** Trusted native reader captures immutable failed SDK receipts, never input
   * admission. The returned synchronous fence is repeated under writer lock. */
  prepareInterruptedHarness?(identity: InterruptedHarnessIdentity): Promise<(() => void) | undefined>;
  hitFault(point: "before_effect" | "effect_then_lost_acknowledgement", method: MutationMethod): boolean;
  afterStatement?(statement: ScheduledRunStatement): void;
  recordTrace(input: NormalisedTraceInput): void;
  /** Read-only poll authority check; never gates already accepted work. */
  assertClaimCurrent?(): void;
  /** Optional live UTC clock for fresh renewals; durable replay bypasses it. */
  liveRenewalNow?(): string;
}

export type ScheduledRunStoreConstructionResult = ResultValue<ScheduledRunStore & InterruptedScheduledRunReconciler & ScheduledRunRetentionOwner, ScheduledRunStoreError>;

type RunRow = {
  run_id: string; task_id: string; task_revision: number; scheduled_for: string; state: ScheduledRunRecord["state"];
  attempt: number; worker_id: string | null; lease_token_hash: string | null; claimed_at: string; lease_expires_at: string | null;
  accepted_source_seq: number | null; operation_id: string | null; result_status: ScheduledRunRecord["status"];
  duration_ms: number | null; result_ref: string | null; error_code: string | null; next_run_at: string | null;
  head_disposition: ScheduledRunHeadDisposition; settled_at: string | null; abandonment_reason_tag: string | null;
};
type HeadRow = { task_id: string; current_revision: number; status: string; next_run_at: string | null };
type RevisionRow = { snapshot_json: string; config_hash: string };
type DecisionRow = { method: MutationMethod; request_hash: string; result_json: string; run_id: string | null };

class AbortMutation extends Error {
  constructor(readonly error: ScheduledRunStoreError) { super(error._tag); }
}
class CorruptState extends Error {}
function retentionFields(value:unknown,required:readonly string[],optional:readonly string[]=[]):boolean {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const keys=Reflect.ownKeys(value);return required.every(key=>Object.hasOwn(value,key))&&keys.every(key=>typeof key==="string"&&[...required,...optional].includes(key)&&"value" in Object.getOwnPropertyDescriptor(value,key)!);
}

function errorOf(
  tag: ScheduledRunStoreErrorTag,
  certainty: "not_applied" | "unknown" = "not_applied",
  retryable = tag === "storage_unavailable",
  details: Partial<ScheduledRunStoreError> = {},
): ScheduledRunStoreError {
  return Object.freeze({ _tag: tag, certainty, retryable, ...details });
}

function verify(database: Database): void {
  const required = [TASKS, REVISIONS, RUNS, LEASES, RENEWALS, BINDINGS, LOGS, NEXT, ABANDONMENTS, LINKS, DECISIONS, TOMBSTONES, "service_effect_s01_sources", "service_effect_s05_outbox"];
  const names = new Set((database.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name));
  if (required.some((name) => !names.has(name))) throw new Error("EF-S07 composition schema is incomplete.");
  const fk = database.query("PRAGMA foreign_keys").get() as { foreign_keys?: number } | undefined;
  if (fk?.foreign_keys !== 1) throw new Error("EF-S07 requires foreign keys.");
}

function parseSnapshot(row: RevisionRow | undefined): ScheduledTaskSnapshot {
  if (!row || typeof row.snapshot_json !== "string") throw new CorruptState();
  let value: unknown;
  try { value = JSON.parse(row.snapshot_json); } catch { throw new CorruptState(); }
  const snapshot = decodeTaskSnapshot(value);
  if (!snapshot || snapshot.configHash !== row.config_hash) throw new CorruptState();
  return snapshot;
}

function parseDecision(row: DecisionRow): unknown {
  try { return JSON.parse(row.result_json); } catch { throw new CorruptState(); }
}

export function createCurrentPiclawScheduledRunStore(
  database: Database,
  runtime: ScheduledRunAdapterRuntime,
): ScheduledRunStoreConstructionResult {
  try {
    verify(database);
    return Result.ok(CurrentPiclawScheduledRunStore.create(database, runtime));
  } catch {
    return Result.err(errorOf("storage_unavailable"));
  }
}

class CurrentPiclawScheduledRunStore implements ScheduledRunStore, ScheduledRunRetentionOwner {
  readonly outbox: ServiceOutboxEnqueueInserter;

  private constructor(readonly database: Database, private readonly runtime: ScheduledRunAdapterRuntime) {
    const inserted = createServiceOutboxEnqueueInserter(database, {
      afterStatement: (statement) => this.statement(statement),
    });
    if (!inserted.ok) throw new Error("EF-S07 outbox inserter unavailable.");
    this.outbox = inserted.value;
  }

  static create(database: Database, runtime: ScheduledRunAdapterRuntime): CurrentPiclawScheduledRunStore {
    return new CurrentPiclawScheduledRunStore(database, runtime);
  }

  async claimDue(input: ClaimDueRunsRequest): Promise<ResultValue<readonly ScheduledRunLease[], ScheduledRunStoreError>> {
    const request = normaliseClaim(input);
    const effectId = request ? "claimDue" : "invalid";
    this.trace("claimDue", effectId, null, null, "call", null);
    if (!request) return this.failed("claimDue", effectId, null, null, errorOf("invalid_request"));
    return this.mutate("claimDue", effectId, null, null, () => this.claim(request));
  }

  async renew(input: RenewScheduledRunRequest): Promise<ResultValue<ScheduledRunLease, ScheduledRunStoreError>> {
    const request = normaliseRenew(input);
    const effectId = request ? `renew:${request.runId}:${request.expectedAttempt}:${request.leaseExpiresAt}` : "invalid";
    this.trace("renew", effectId, null, request?.expectedTaskRevision ?? null, "call", null);
    if (!request) return this.failed("renew", effectId, null, null, errorOf("invalid_request"));
    return this.mutate("renew", effectId, null, request.expectedTaskRevision, () => this.renewLease(request));
  }

  async bindAcceptedSource(input: BindScheduledSourceRequest): Promise<ResultValue<ScheduledRunRecord, ScheduledRunStoreError>> {
    const request = normaliseBind(input);
    const effectId = request?.effect.idempotencyKey ?? "invalid";
    this.trace("bindAcceptedSource", effectId, request?.operationId ?? null, request?.expectedTaskRevision ?? null, "call", null, request?.sourceSeq ?? null);
    if (!request) return this.failed("bindAcceptedSource", effectId, null, null, errorOf("invalid_request"));
    return this.mutate("bindAcceptedSource", effectId, request.operationId, request.expectedTaskRevision, () => this.bind(request), request.sourceSeq);
  }

  async complete(input: CompleteScheduledRunRequest): Promise<ResultValue<ScheduledRunRecord, ScheduledRunStoreError>> {
    const request = normaliseComplete(input);
    const effectId = request?.effect.idempotencyKey ?? "invalid";
    this.trace("complete", effectId, request?.effect.operationId ?? null, request?.expectedTaskRevision ?? null, "call", null, request?.effect.sourceSeq ?? null);
    if (!request) return this.failed("complete", effectId, null, null, errorOf("invalid_request"));
    return this.mutate("complete", effectId, request.effect.operationId, request.expectedTaskRevision, () => this.completeRun(request), request.effect.sourceSeq);
  }

  async reconcileInterruptedAgentSource(input: ReconcileInterruptedScheduledRunRequest): Promise<ResultValue<ScheduledRunRecord, ScheduledRunStoreError>> {
    const request=normaliseInterruptedReconciliation(input), effectId=request?.effect.idempotencyKey??'invalid';
    this.trace('complete',effectId,request?.effect.operationId??null,request?.expectedTaskRevision??null,'call',null,request?.effect.sourceSeq??null);
    if (!request) return this.failed('complete',effectId,null,null,errorOf('invalid_request'));
    let captured: { identity: InterruptedHarnessIdentity; assertCurrent(): void } | undefined;
    try {
      const run = this.readRunRow(request.runId);
      if (run?.state === 'source_bound') {
        const proof = this.interruptedSourceProof(run, this.readSnapshot(run.task_id, run.task_revision));
        if (proof?.harness) {
          const assertCurrent = await this.runtime.prepareInterruptedHarness?.(proof.harness);
          if (typeof assertCurrent !== 'function') return this.failed('complete',effectId,request.effect.operationId,request.expectedTaskRevision,errorOf('invalid_transition'),request.effect.sourceSeq);
          captured = { identity: proof.harness, assertCurrent };
        }
      }
    } catch {
      return this.failed('complete',effectId,request.effect.operationId,request.expectedTaskRevision,errorOf('invalid_transition'),request.effect.sourceSeq);
    }
    return this.mutate('complete',effectId,request.effect.operationId,request.expectedTaskRevision,()=>this.reconcileInterruptedRun(request,captured),request.effect.sourceSeq);
  }

  async abandon(input: AbandonScheduledRunRequest): Promise<ResultValue<ScheduledRunRecord, ScheduledRunStoreError>> {
    const request = normaliseAbandon(input);
    const effectId = request?.effect.idempotencyKey ?? "invalid";
    this.trace("abandon", effectId, request?.effect.operationId ?? null, request?.expectedTaskRevision ?? null, "call", null, request?.effect.sourceSeq ?? null);
    if (!request) return this.failed("abandon", effectId, null, null, errorOf("invalid_request"));
    return this.mutate("abandon", effectId, request.effect.operationId, request.expectedTaskRevision, () => this.abandonRun(request), request.effect.sourceSeq);
  }

  async get(runId: string): Promise<ResultValue<ScheduledRunRecord | null, ScheduledRunStoreError>> {
    if (!validScheduledRunId(runId)) return Result.err(errorOf("invalid_request"));
    try { return Result.ok(this.readRecord(runId)); }
    catch (error) { return Result.err(error instanceof CorruptState ? errorOf("corrupt_state") : errorOf("storage_unavailable")); }
  }

  async listRuns(input: ListScheduledRunsRequest = {}): Promise<ResultValue<readonly ScheduledRunRecord[], ScheduledRunStoreError>> {
    const request = normaliseList(input);
    if (!request) return Result.err(errorOf("invalid_request"));
    try {
      const predicates: string[] = [], values: Array<string | number> = [];
      if (request.taskId) { predicates.push("task_id=?"); values.push(request.taskId); }
      if (request.state) { predicates.push("state=?"); values.push(request.state); }
      if (request.afterScheduledFor && request.afterRunId) {
        predicates.push("(scheduled_for>? OR (scheduled_for=? AND run_id>?))");
        values.push(request.afterScheduledFor, request.afterScheduledFor, request.afterRunId);
      }
      const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
      const ids = this.database.query(`SELECT run_id,scheduled_for FROM (SELECT run_id,scheduled_for,task_id,state FROM ${RUNS} UNION ALL SELECT run_id,scheduled_for,task_id,state FROM ${TOMBSTONES}) ${where} ORDER BY scheduled_for,run_id LIMIT ?`).all(...values, request.limit ?? 50) as Array<{ run_id: string; scheduled_for: string }>;
      return Result.ok(Object.freeze(ids.map((row) => this.readRecord(row.run_id)!)));
    } catch (error) {
      return Result.err(error instanceof CorruptState ? errorOf("corrupt_state") : errorOf("storage_unavailable"));
    }
  }

  async cleanupTerminal(input: CleanupScheduledRunsRequest): Promise<ResultValue<CleanupScheduledRunsResult, ScheduledRunStoreError>> {
    const request = normaliseCleanup(input);
    const effectId = request ? `cleanup:${request.settledBefore}:${request.limit}` : "invalid";
    this.trace("cleanupTerminal", effectId, null, null, "call", null);
    if (!request) return this.failed("cleanupTerminal", effectId, null, null, errorOf("invalid_request"));
    return this.mutate("cleanupTerminal", effectId, null, null, () => this.cleanup(request));
  }

  async planRetention(input:{settledBefore:string;limit:number;after?:ScheduledRetentionCursor|null}):Promise<ResultValue<ScheduledRetentionPlan,ScheduledRunStoreError>> {
    if(!retentionFields(input,["settledBefore","limit"],["after"]))return Result.err(errorOf("invalid_request"));
    const request=normaliseCleanup({settledBefore:input.settledBefore,limit:input.limit}),rawAfter=input.after??null;
    if(!request||rawAfter&&(!retentionFields(rawAfter,["settledAt","runId"])||!canonicalInstant(rawAfter.settledAt)||!validScheduledRunId(rawAfter.runId)||rawAfter.settledAt>=request.settledBefore))return Result.err(errorOf("invalid_request"));
    const after=rawAfter?Object.freeze({...rawAfter}):null;
    try{return Result.ok(this.database.transaction(()=>{
      this.assertRetentionSchema();
      const page=this.database.query(`SELECT * FROM main.${RUNS} WHERE state IN ('completed','abandoned') AND settled_at<?
        AND (? IS NULL OR settled_at>? OR (settled_at=? AND run_id>?)) ORDER BY settled_at,run_id LIMIT ?`)
        .all(request.settledBefore,after?.settledAt??null,after?.settledAt??"",after?.settledAt??"",after?.runId??"",request.limit+1) as RunRow[];
      const inspected=page.slice(0,request.limit),rows:ScheduledRetentionPlan["rows"][number][]=[];
      for(const row of inspected)if(this.retentionEligible(row)){
        const record=this.readRecord(row.run_id);if(!record)throw new CorruptState();
        rows.push(Object.freeze({runId:row.run_id,settledAt:row.settled_at!,sha256:canonicalRequestHash(record),serializedBytes:Buffer.byteLength(JSON.stringify(record))}));
      }
      const last=inspected.at(-1),through=last?Object.freeze({settledAt:last.settled_at!,runId:last.run_id}):after;
      return Object.freeze({version:1 as const,owner:"scheduled-run-history" as const,settledBefore:request.settledBefore,after,through,
        examined:inspected.length,rows:Object.freeze(rows),nextCursor:page.length>request.limit?through:null});
    })());}catch(error){return Result.err(errorOf(error instanceof CorruptState?"corrupt_state":"storage_unavailable"));}
  }

  async applyRetention(input:ScheduledRetentionPlan):Promise<ResultValue<CleanupScheduledRunsResult,ScheduledRunStoreError>> {
    let plan:ScheduledRetentionPlan;try{plan=structuredClone(input);}catch{return Result.err(errorOf("invalid_request"));}
    const cursor=(value:ScheduledRetentionCursor|null)=>value===null||retentionFields(value,["settledAt","runId"])&&!!canonicalInstant(value.settledAt)&&validScheduledRunId(value.runId)&&value.settledAt<plan.settledBefore;
    const compare=(a:ScheduledRetentionCursor,b:ScheduledRetentionCursor)=>a.settledAt<b.settledAt?-1:a.settledAt>b.settledAt?1:a.runId<b.runId?-1:a.runId>b.runId?1:0;
    if(!retentionFields(plan,["version","owner","settledBefore","after","through","examined","rows","nextCursor"])||plan.version!==1||plan.owner!=="scheduled-run-history"||!canonicalInstant(plan.settledBefore)||!Number.isSafeInteger(plan.examined)||plan.examined<0||plan.examined>100||
      !Array.isArray(plan.rows)||plan.rows.length>plan.examined||!cursor(plan.after)||!cursor(plan.through)||!cursor(plan.nextCursor)||
      (plan.examined===0?(plan.after===null?plan.through!==null:!plan.through||compare(plan.through,plan.after)!==0):!plan.through||plan.after!==null&&compare(plan.through,plan.after)<=0)||
      plan.nextCursor!==null&&(!plan.through||compare(plan.nextCursor,plan.through)!==0))return Result.err(errorOf("invalid_request"));
    let previous=plan.after;
    for(const row of plan.rows){if(!retentionFields(row,["runId","settledAt","sha256","serializedBytes"]))return Result.err(errorOf("invalid_request"));const position={settledAt:row.settledAt,runId:row.runId};
      if(!cursor(position)||typeof row.sha256!=="string"||row.sha256.length!==64||!validHash(row.sha256)||!Number.isSafeInteger(row.serializedBytes)||row.serializedBytes<1||previous&&compare(position,previous)<=0||!plan.through||compare(position,plan.through)>0)return Result.err(errorOf("invalid_request"));previous=position;}
    if(plan.rows.length===0)return Result.ok(Object.freeze({removed:0,runIds:Object.freeze([])})); // No effect and no receipt growth for held/empty pages.
    const requestHash=canonicalRequestHash(plan),key=`retention-v1:${requestHash}`;
    this.trace("cleanupTerminal",key,null,null,"call",null);
    return this.mutate("cleanupTerminal",key,null,null,()=>{
      assertProcessAdmission();this.assertRetentionSchema();
      const replay=this.replay(key,requestHash,"cleanupTerminal",null);
      if(replay!==undefined){const result=decodeCleanupResult(replay);if(!result)throw new CorruptState();return Result.ok(result);}
      const selected:RunRow[]=[];
      for(const expected of plan.rows){const row=this.readRunRow(expected.runId),record=row&&this.readRecord(expected.runId);
        if(!row||!record||row.settled_at!==expected.settledAt||canonicalRequestHash(record)!==expected.sha256||Buffer.byteLength(JSON.stringify(record))!==expected.serializedBytes||!this.retentionEligible(row))throw new AbortMutation(errorOf("invalid_transition"));
        selected.push(row);}
      for(const row of selected)this.retireRun(row);
      const result=Object.freeze({removed:selected.length,runIds:Object.freeze(selected.map(row=>row.run_id))});
      this.writeDecision(key,"cleanupTerminal",requestHash,null,result,plan.settledBefore);
      const saved=this.replay(key,requestHash,"cleanupTerminal",null);if(saved===undefined||canonicalRequestHash(saved)!==canonicalRequestHash(result))throw new CorruptState();
      return Result.ok(result);
    });
  }

  private assertRetentionSchema(){
    if(this.database.query(`SELECT 1 FROM sqlite_temp_schema WHERE name LIKE 'service_effect_s07_%' OR name IN ('task_run_logs','budget_work','budget_request_reservations','service_effect_s05_outbox')`).get())throw new CorruptState();
  }
  private retentionEligible(row:RunRow):boolean {
    if(!['completed','abandoned'].includes(row.state)||row.operation_id!==null||row.result_ref!==null)return false; // Retain native accepted sources and opaque external result dependencies.
    if(this.readSnapshot(row.task_id,row.task_revision).executionRepeatability!=="repeatable")return false;
    if(this.database.query(`SELECT 1 FROM main.${TASKS} WHERE task_id=? AND current_revision=? AND status='paused' AND next_run_at=?`).get(row.task_id,row.task_revision,row.scheduled_for))return false;
    if(hasScheduledHistoryProjection(this.database)&&this.database.query("SELECT 1 FROM main.task_run_logs WHERE occurrence_id=? OR (task_id=? AND ?='task_run_log:'||id)").get(row.run_id,row.task_id,row.result_ref))return false;
    if(this.database.query(`SELECT 1 FROM main.${LINKS} l JOIN main.service_effect_s05_outbox o ON o.outbox_id=l.outbox_id WHERE l.run_id=? AND
      (o.state IN ('pending','started','unknown') OR o.certainty='unknown' OR o.retry_at IS NOT NULL)`).get(row.run_id))return false;
    return !this.hasHistoricalTaskReference(row.task_id);
  }
  private hasHistoricalTaskReference(taskId:string):boolean {
    // Historical task references are data, not a financial lifecycle. Missing
    // work mapping with a retained request table cannot prove safe deletion.
    const history=this.database.query("SELECT name FROM main.sqlite_schema WHERE type='table' AND name IN ('budget_work','budget_request_reservations')").all() as {name:string}[];
    return history.length>0&&(!history.some(table=>table.name==='budget_work')||!!this.database.query("SELECT 1 FROM main.budget_work WHERE scheduled_task_id=?").get(taskId));
  }

  private async mutate<T>(
    method: MutationMethod,
    effectId: string,
    operationId: string | null,
    version: number | null,
    action: () => ResultValue<T, ScheduledRunStoreError>,
    sourceSeq: number | null = null,
  ): Promise<ResultValue<T, ScheduledRunStoreError>> {
    // Preserve asynchronous entry without waiting behind unrelated mutations.
    await Promise.resolve();
    try {
      if (this.runtime.hitFault("before_effect", method)) return this.failed(method, effectId, operationId, version, errorOf("storage_unavailable"), sourceSeq);
      const result = await admitSqliteWrite(this.database, action, undefined, undefined, undefined,
        () => { if (method === "claimDue") this.runtime.assertClaimCurrent?.(); });
      if (!result.ok) return this.failed(method, effectId, operationId, version, result.error, sourceSeq);
      let lostAcknowledgement: boolean;
      try { lostAcknowledgement = this.runtime.hitFault("effect_then_lost_acknowledgement", method); }
      catch { lostAcknowledgement = true; } // A committed hook failure is unknown, never not_applied.
      if (lostAcknowledgement) return this.failed(method, effectId, operationId, version, errorOf("storage_unavailable", "unknown", true), sourceSeq);
      this.trace(method, effectId, operationId, version, "applied", "applied", sourceSeq);
      return result;
    } catch (error) {
      const bounded = error instanceof CorruptState ? errorOf("corrupt_state") : error instanceof ScheduledHistoryError ? errorOf(error.tag) : error instanceof AbortMutation ? error.error : errorOf("storage_unavailable", "not_applied", isBusy(error));
      return this.failed(method, effectId, operationId, version, bounded, sourceSeq);
    }
  }

  private claim(request: ClaimDueRunsRequest): ResultValue<readonly ScheduledRunLease[], ScheduledRunStoreError> {
    const prefixHash = hashScheduledLeaseToken(request.leaseTokenPrefix);
    const key = `claim:${prefixHash}`;
    const requestHash = canonicalRequestHash(request);
      // Check inside SQLite writer admission, including replay.
      assertProcessAdmission();
      const replay = this.replay(key, requestHash, "claimDue", null);
      if (replay !== undefined) return Result.ok(this.restoreClaimReplay(request, replay));

      type Candidate = { kind: "new" | "expired"; taskId: string; scheduledFor: string; runId: string | null };
      const due = this.database.query(
        `SELECT t.task_id AS taskId,t.next_run_at AS scheduledFor,NULL AS runId FROM ${TASKS} t WHERE t.status='active' AND t.next_run_at IS NOT NULL AND t.next_run_at<=?
         AND NOT EXISTS (SELECT 1 FROM ${RUNS} r WHERE r.task_id=t.task_id AND r.task_revision=t.current_revision AND r.scheduled_for=t.next_run_at)
         AND NOT EXISTS (SELECT 1 FROM ${TOMBSTONES} r WHERE r.task_id=t.task_id AND r.task_revision=t.current_revision AND r.scheduled_for=t.next_run_at) ORDER BY t.next_run_at,t.task_id LIMIT 100`,
      ).all(request.now) as Candidate[];
      const expired = this.database.query(
        `SELECT r.task_id AS taskId,r.scheduled_for AS scheduledFor,r.run_id AS runId FROM json_each(?) a CROSS JOIN ${RUNS} r
         WHERE r.run_id=json_extract(a.value,'$.runId') AND r.attempt=json_extract(a.value,'$.expectedAttempt')
         AND r.state IN ('claimed','source_bound') AND r.lease_expires_at<=? ORDER BY r.scheduled_for,r.task_id,r.run_id`,
      ).all(JSON.stringify(request.reclaimAuthorities), request.now) as Candidate[];
      const candidates = [
        ...due.map((row) => ({ ...row, kind: "new" as const })),
        ...expired.map((row) => ({ ...row, kind: "expired" as const })),
      ].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || a.taskId.localeCompare(b.taskId) || a.kind.localeCompare(b.kind));

      const leases: ScheduledRunLease[] = [];
      const replayRows: Array<{ runId: string; attempt: number; state: "claimed" | "source_bound" }> = [];
      for (const candidate of candidates) {
        if (leases.length >= request.limit) break;
        if (candidate.kind === "new") {
          const head = this.readHead(candidate.taskId);
          if (!head || head.status !== "active" || head.next_run_at !== candidate.scheduledFor) continue;
          const runId = deriveScheduledRunId(candidate.taskId, head.current_revision, candidate.scheduledFor);
          const existing = this.readRunRow(runId);
          const tombstone = this.readTombstone(runId);
          if (existing || tombstone) continue;
          const snapshot = this.readSnapshot(candidate.taskId, head.current_revision);
          const expires = addCanonicalDuration(request.now, request.leaseDurationMs);
          if (!expires) throw new AbortMutation(errorOf("invalid_request"));
          const token = deriveScheduledLeaseToken(request.leaseTokenPrefix, runId, 1);
          const tokenHash = hashScheduledLeaseToken(token);
          this.database.query(
            `INSERT INTO ${RUNS}(run_id,task_id,task_revision,scheduled_for,state,attempt,worker_id,lease_token_hash,claimed_at,lease_expires_at,head_disposition) VALUES(?,?,?,?,'claimed',1,?,?,?,?, 'pending')`,
          ).run(runId, candidate.taskId, snapshot.revision, candidate.scheduledFor, request.workerId, tokenHash, request.now, expires);
          this.statement("occurrence_insert");
          this.database.query(
            `INSERT INTO ${LEASES}(run_id,attempt,token_hash,worker_id,claimed_at,lease_expires_at,authority_kind,reconciliation_ref) VALUES(?,1,?,?,?,?, 'new',NULL)`,
          ).run(runId, tokenHash, request.workerId, request.now, expires);
          this.statement("lease_insert");
          const record = this.requireActiveRecord(this.readRecord(runId));
          leases.push(this.lease(record, snapshot, token)); replayRows.push({ runId, attempt: 1, state: "claimed" });
        } else {
          const run = candidate.runId ? this.readRunRow(candidate.runId) : null;
          if (!run || run.lease_expires_at! > request.now) continue;
          const snapshot = this.readSnapshot(run.task_id, run.task_revision);
          const authority = request.reclaimAuthorities.find((item) => item.runId === run.run_id && item.expectedAttempt === run.attempt);
          let authorityKind: "agent_reconciled_absent" | "repeatable" | "reconciled_absent" | null = null;
          let reconciliationRef: string | null = null;
          if (snapshot.executionRepeatability === "agent_source" && authority?.kind === "agent_reconciled_absent") {
            authorityKind = "agent_reconciled_absent"; reconciliationRef = authority.reconciliationRef;
          } else if (snapshot.executionRepeatability === "repeatable" && authority?.kind === "repeatable") authorityKind = "repeatable";
          else if (snapshot.executionRepeatability === "reconciliation_required" && authority?.kind === "reconciled_absent") {
            authorityKind = "reconciled_absent"; reconciliationRef = authority.reconciliationRef;
          }
          if (!authorityKind) continue;
          const attempt = run.attempt + 1;
          if (!Number.isSafeInteger(attempt)) throw new CorruptState();
          const expires = addCanonicalDuration(request.now, request.leaseDurationMs);
          if (!expires) throw new AbortMutation(errorOf("invalid_request"));
          const token = deriveScheduledLeaseToken(request.leaseTokenPrefix, run.run_id, attempt);
          const tokenHash = hashScheduledLeaseToken(token);
          const changed = this.database.query(
            `UPDATE ${RUNS} SET attempt=?,worker_id=?,lease_token_hash=?,claimed_at=?,lease_expires_at=? WHERE run_id=? AND attempt=? AND state IN ('claimed','source_bound') AND lease_expires_at<=?`,
          ).run(attempt, request.workerId, tokenHash, request.now, expires, run.run_id, run.attempt, request.now);
          if (changed.changes !== 1) continue;
          this.statement("occurrence_reclaim_update");
          this.database.query(
            `INSERT INTO ${LEASES}(run_id,attempt,token_hash,worker_id,claimed_at,lease_expires_at,authority_kind,reconciliation_ref) VALUES(?,?,?,?,?,?,?,?)`,
          ).run(run.run_id, attempt, tokenHash, request.workerId, request.now, expires, authorityKind, reconciliationRef);
          this.statement("lease_insert");
          const record = this.requireActiveRecord(this.readRecord(run.run_id));
          leases.push(this.lease(record, snapshot, token)); replayRows.push({ runId: run.run_id, attempt, state: run.state === "source_bound" ? "source_bound" : "claimed" });
        }
      }
      this.writeDecision(key, "claimDue", requestHash, null, replayRows, request.now);
      return Result.ok(Object.freeze(leases));
  }

  private restoreClaimReplay(request: ClaimDueRunsRequest, value: unknown): readonly ScheduledRunLease[] {
    const rows = decodeClaimReplayRows(value);
    if (!rows) throw new CorruptState();
    return Object.freeze(rows.map(({ runId, attempt, state }) => {
      const run = this.readRunRow(runId), tomb = this.readTombstone(runId);
      if ((!run && tomb) || (run && (run.state !== state || run.attempt !== attempt))) throw new AbortMutation(errorOf("invalid_transition"));
      if (!run) throw new CorruptState();
      const leaseRow = this.database.query(`SELECT token_hash,worker_id,claimed_at,lease_expires_at FROM ${LEASES} WHERE run_id=? AND attempt=?`).get(runId, attempt) as { token_hash: unknown; worker_id: unknown; claimed_at: unknown; lease_expires_at: unknown } | undefined;
      const claimedAt = leaseRow && canonicalInstant(leaseRow.claimed_at), leaseExpiresAt = leaseRow && canonicalInstant(leaseRow.lease_expires_at);
      if (!leaseRow || !claimedAt || !leaseExpiresAt || !validHash(leaseRow.token_hash) || !validId(leaseRow.worker_id)
        || claimedAt > request.now || leaseExpiresAt !== run.lease_expires_at
        || run.worker_id !== leaseRow.worker_id || run.lease_token_hash !== leaseRow.token_hash) throw new CorruptState();
      const snapshot = this.readSnapshot(run.task_id, run.task_revision);
      const token = deriveScheduledLeaseToken(request.leaseTokenPrefix, runId, attempt);
      if (hashScheduledLeaseToken(token) !== leaseRow.token_hash) throw new CorruptState();
      return this.lease(this.requireActiveRecord(this.recordFromRun(run)), snapshot, token);
    }));
  }

  private renewLease(request: RenewScheduledRunRequest): ResultValue<ScheduledRunLease, ScheduledRunStoreError> {
    const tokenHash = hashScheduledLeaseToken(request.leaseToken);
    const key = `renew:${request.runId}:${request.expectedAttempt}:${tokenHash}:${request.leaseExpiresAt}`;
    const requestHash = canonicalRequestHash(request);
      const replay = this.replay(key, requestHash, "renew", request.runId);
      if (replay !== undefined) {
        const saved = decodeScheduledRunRecord(replay);
        if (!saved || (saved.state !== "claimed" && saved.state !== "source_bound") || saved.leaseExpiresAt !== request.leaseExpiresAt) throw new CorruptState();
        const currentRow = this.readRunRow(saved.runId);
        if (!currentRow) {
          if (this.readTombstone(saved.runId)) throw new AbortMutation(errorOf("invalid_transition"));
          throw new CorruptState();
        }
        if (currentRow.state === "completed" || currentRow.state === "abandoned" || currentRow.attempt !== saved.attempt
          || currentRow.task_revision !== saved.taskRevision) throw new AbortMutation(errorOf("invalid_transition"));
        const current = this.requireActiveRecord(this.recordFromRun(currentRow));
        if (current.workerId !== request.workerId || currentRow.lease_token_hash !== tokenHash) throw new AbortMutation(errorOf("invalid_transition"));
        if (current.leaseExpiresAt < request.leaseExpiresAt) throw new CorruptState();
        return Result.ok(this.lease(current, this.readSnapshot(current.taskId, current.taskRevision), request.leaseToken));
      }
      const run = this.requireFencedRun(request, tokenHash);
      if (!run.lease_expires_at || request.leaseExpiresAt <= run.lease_expires_at) throw new AbortMutation(errorOf("invalid_request"));
      if (this.runtime.liveRenewalNow && run.lease_expires_at <= this.runtime.liveRenewalNow()) throw new AbortMutation(errorOf("lease_expired", "not_applied", false, { observedAttempt: run.attempt }));
      const ordinalRow = this.database.query(`SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM ${RENEWALS} WHERE run_id=? AND attempt=?`).get(request.runId, request.expectedAttempt) as { ordinal: number };
      if (!Number.isSafeInteger(ordinalRow.ordinal) || ordinalRow.ordinal < 1) throw new CorruptState();
      this.database.query(`INSERT INTO ${RENEWALS}(run_id,attempt,ordinal,request_hash,previous_expires_at,lease_expires_at,renewed_at) VALUES(?,?,?,?,?,?,?)`).run(request.runId, request.expectedAttempt, ordinalRow.ordinal, requestHash, run.lease_expires_at, request.leaseExpiresAt, request.now);
      this.statement("renewal_insert");
      const history = this.database.query(`UPDATE ${LEASES} SET lease_expires_at=? WHERE run_id=? AND attempt=? AND token_hash=? AND lease_expires_at=?`).run(request.leaseExpiresAt, request.runId, request.expectedAttempt, tokenHash, run.lease_expires_at);
      if (history.changes !== 1) throw new CorruptState();
      this.statement("lease_history_update");
      const changed = this.database.query(
        `UPDATE ${RUNS} SET lease_expires_at=? WHERE run_id=? AND worker_id=? AND attempt=? AND task_revision=? AND lease_token_hash=? AND lease_expires_at=? AND lease_expires_at>? AND state IN ('claimed','source_bound')`,
      ).run(request.leaseExpiresAt, request.runId, request.workerId, request.expectedAttempt, request.expectedTaskRevision, tokenHash, run.lease_expires_at, request.now);
      if (changed.changes !== 1) throw new AbortMutation(errorOf("lease_conflict"));
      this.statement("lease_renew");
      const record = this.requireActiveRecord(this.readRecord(request.runId));
      const lease = this.lease(record, this.readSnapshot(run.task_id, run.task_revision), request.leaseToken);
      this.writeDecision(key, "renew", requestHash, request.runId, lease.record, request.now);
      if (this.runtime.liveRenewalNow && run.lease_expires_at <= this.runtime.liveRenewalNow()) throw new AbortMutation(errorOf("lease_expired", "not_applied", false, { observedAttempt: run.attempt }));
      return Result.ok(lease);
  }

  private bind(request: BindScheduledSourceRequest): ResultValue<ScheduledRunRecord, ScheduledRunStoreError> {
    const key = `effect:${request.effect.idempotencyKey}`;
      const replay = this.replayRecordOrRetained(key, "bindAcceptedSource", request.effect.requestHash, request.runId);
      if (replay) return Result.ok(replay);
      const run = this.requireFencedRun(request, hashScheduledLeaseToken(request.leaseToken));
      const snapshot = this.readSnapshot(run.task_id, run.task_revision);
      if (run.state === "source_bound") throw new AbortMutation(errorOf("idempotency_conflict"));
      if (snapshot.kind !== "agent" || run.state !== "claimed") throw new AbortMutation(errorOf("invalid_transition"));
      if (request.effect.operationId !== request.operationId || request.effect.sourceSeq !== request.sourceSeq) throw new AbortMutation(errorOf("invalid_request"));
      const owner = this.database.query(
        `SELECT s.source_id,s.kind,s.chat_jid,o.primary_source_seq FROM service_effect_s01_sources s JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq JOIN service_effect_s01_operations o ON o.operation_id=os.operation_id WHERE s.chat_jid=? AND s.source_seq=? AND o.operation_id=?`,
      ).get(snapshot.chatJid, request.sourceSeq, request.operationId) as { source_id: string; kind: string; chat_jid: string; primary_source_seq: number } | undefined;
      if (!owner) throw new AbortMutation(errorOf("not_found"));
      if (owner.source_id !== request.runId || owner.kind !== "scheduled_agent" || owner.chat_jid !== snapshot.chatJid || owner.primary_source_seq !== request.sourceSeq) throw new AbortMutation(errorOf("invalid_transition"));
      this.database.query(
        `INSERT INTO ${BINDINGS}(run_id,request_hash,idempotency_key,chat_jid,source_seq,operation_id,bound_at) VALUES(?,?,?,?,?,?,?)`,
      ).run(request.runId, request.effect.requestHash, request.effect.idempotencyKey, snapshot.chatJid, request.sourceSeq, request.operationId, request.boundAt);
      this.statement("source_binding_insert");
      const changed = this.database.query(
        `UPDATE ${RUNS} SET state='source_bound',accepted_source_seq=?,operation_id=? WHERE run_id=? AND state='claimed' AND worker_id=? AND attempt=? AND lease_token_hash=?`,
      ).run(request.sourceSeq, request.operationId, request.runId, request.workerId, request.expectedAttempt, hashScheduledLeaseToken(request.leaseToken));
      if (changed.changes !== 1) throw new AbortMutation(errorOf("lease_conflict"));
      this.statement("source_binding_update");
      const record = this.readRecord(request.runId)!;
      this.writeDecision(key, "bindAcceptedSource", request.effect.requestHash, request.runId, record, request.boundAt);
      return Result.ok(record);
  }

  private completeRun(request: CompleteScheduledRunRequest): ResultValue<ScheduledRunRecord, ScheduledRunStoreError> {
    const key=`effect:${request.effect.idempotencyKey}`;
      const replay=this.replayRecordOrRetained(key,'complete',request.effect.requestHash,request.runId);
      if(replay){
        projectScheduledTask(this.database,replay.taskId,replay.runId);
        if(request.resultPayload && replay.durationMs !== null){
          projectScheduledHistory(this.database,request.runId,request);
          this.statement('history_projection');
          projectScheduledTask(this.database,replay.taskId,replay.runId);
        }
        return Result.ok(replay);
      }
      const run=this.requireFencedRun(request,hashScheduledLeaseToken(request.leaseToken));
      const snapshot=this.readSnapshot(run.task_id,run.task_revision);
      this.validateCompletionShape(request,run,snapshot);
      const completed = this.finishCompletion(request,run,snapshot);
      if(completed.ok && request.resultPayload){
        projectScheduledHistory(this.database,request.runId,request);
        this.statement('history_projection');
        projectScheduledTask(this.database,run.task_id,run.run_id);
      }
      return completed;
  }

  private reconcileInterruptedRun(request: ReconcileInterruptedScheduledRunRequest, captured?: { identity: InterruptedHarnessIdentity; assertCurrent(): void }): ResultValue<ScheduledRunRecord, ScheduledRunStoreError> {
      assertProcessAdmission();
      const replay=this.replayRecordOrRetained(`effect:${request.effect.idempotencyKey}`,'complete',request.effect.requestHash,request.runId);
      if(replay)return Result.ok(replay);
      const run=this.readRunRow(request.runId);
      if(!run)throw new AbortMutation(errorOf('not_found'));
      this.recordFromRun(run);
      if(run.task_revision!==request.expectedTaskRevision)throw new AbortMutation(errorOf('task_revision_mismatch'));
      if(run.state!=='source_bound'||run.attempt!==request.expectedAttempt||run.lease_expires_at!==request.expectedLeaseExpiresAt||!run.lease_expires_at||run.lease_expires_at>request.now)throw new AbortMutation(errorOf('lease_conflict'));
      if(run.operation_id!==request.effect.operationId||run.accepted_source_seq!==request.effect.sourceSeq)throw new AbortMutation(errorOf('invalid_request'));
      const snapshot=this.readSnapshot(run.task_id,run.task_revision), proof=this.interruptedSourceProof(run,snapshot);
      if(!proof||proof.version!==request.expectedOperationVersion||proof.committedAt>request.now||proof.committedAt<run.claimed_at)throw new AbortMutation(errorOf('invalid_transition'));
      if (proof.harness) {
        if (!captured || JSON.stringify(captured.identity) !== JSON.stringify(proof.harness)) throw new AbortMutation(errorOf('invalid_transition'));
        try {
          const checked: unknown = captured.assertCurrent();
          if (checked !== undefined) { void Promise.resolve(checked).catch(() => undefined); throw Error('Synchronous native receipt fence required'); }
        } catch { throw new AbortMutation(errorOf('invalid_transition')); }
      }
      const durationMs=Date.parse(proof.committedAt)-Date.parse(run.claimed_at);
      if(!Number.isSafeInteger(durationMs)||durationMs<0)throw new CorruptState();
      return this.finishCompletion({effect:request.effect,status:'error',durationMs,resultRef:null,errorCode:'scheduled_run_interrupted',completedAt:request.now,outboxIntents:[]},run,snapshot,true);
  }

  /** Immutable host evidence only; never claim, submit or replay the agent source. */
  private interruptedSourceProof(run: RunRow,snapshot: ScheduledTaskSnapshot): {version:number;committedAt:string;harness:InterruptedHarnessIdentity|null}|null {
    if(snapshot.kind!=='agent'||snapshot.executionRepeatability!=='agent_source'||!run.operation_id||run.accepted_source_seq===null)return null;
    const row=this.database.query(`SELECT o.version,o.terminal_committed_at,o.harness_session_id,o.harness_operation_id FROM service_effect_s01_operations o
      JOIN service_effect_s01_sources s ON s.chat_jid=o.chat_jid AND s.source_seq=o.primary_source_seq
      JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid
      WHERE o.operation_id=? AND o.chat_jid=? AND o.primary_source_seq=? AND s.source_id=? AND s.kind='scheduled_agent'
      AND o.phase='terminal' AND o.terminal_disposition='failed' AND o.terminal_error_code='scheduled_run_interrupted'
      AND s.state='disposed' AND s.disposition_reason='scheduled_run_interrupted'
      AND ((o.harness_session_id IS NULL AND o.harness_operation_id IS NULL) OR (o.harness_session_id IS NOT NULL AND o.harness_operation_id IS NOT NULL))
      AND o.cancellation_source_seq IS NULL AND o.terminal_message_row_id IS NULL
      AND (c.active_operation_id IS NULL OR c.active_operation_id<>o.operation_id)
      AND (SELECT COUNT(*) FROM service_effect_s01_operation_sources os WHERE os.operation_id=o.operation_id)=1`).get(run.operation_id,snapshot.chatJid,run.accepted_source_seq,run.run_id) as {version:number;terminal_committed_at:string;harness_session_id:string|null;harness_operation_id:string|null}|null;
    const committedAt=row&&canonicalInstant(row.terminal_committed_at);
    if (!row || !Number.isSafeInteger(row.version) || row.version<=0 || !committedAt) return null;
    const harness=row.harness_session_id===null?null:Object.freeze({sessionId:row.harness_session_id,submissionId:row.harness_operation_id!,runId:run.run_id,operationId:run.operation_id,sourceSeq:run.accepted_source_seq,chatJid:snapshot.chatJid});
    return {version:row.version,committedAt,harness};
  }

  private finishCompletion(request: Pick<CompleteScheduledRunRequest,'effect'|'status'|'durationMs'|'resultRef'|'errorCode'|'completedAt'|'outboxIntents'>,run: RunRow,snapshot: ScheduledTaskSnapshot,skipMissedOccurrences=false): ResultValue<ScheduledRunRecord,ScheduledRunStoreError> {
      for (const intent of request.outboxIntents) {
        const existing = this.database.query("SELECT outbox_id FROM service_effect_s05_outbox WHERE outbox_id=? OR (kind=? AND idempotency_key=?) LIMIT 1").get(intent.outboxId, intent.kind, intent.effect.idempotencyKey);
        if (existing) throw new AbortMutation(errorOf("idempotency_conflict"));
      }
      const decision = this.decideHead(run, snapshot, request.completedAt, null, skipMissedOccurrences);
      this.writeNextDecision(run, decision, request.completedAt, request.effect.requestHash);
      this.database.query(
        `INSERT INTO ${LOGS}(run_id,task_id,task_revision,scheduled_for,task_kind,completed_at,duration_ms,status,result_ref,error_code) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      ).run(run.run_id, run.task_id, run.task_revision, run.scheduled_for, snapshot.kind, request.completedAt, request.durationMs, request.status, request.resultRef, request.errorCode);
      this.statement("run_log_insert");
      request.outboxIntents.forEach((intent, ordinal) => {
        const inserted = this.outbox.insert(intent);
        if (!inserted.ok) throw new AbortMutation(errorOf(inserted.error._tag === "idempotency_conflict" ? "idempotency_conflict" : "storage_unavailable"));
        this.database.query(`INSERT INTO ${LINKS}(run_id,ordinal,outbox_id) VALUES(?,?,?)`).run(run.run_id, ordinal, intent.outboxId);
        this.statement("outbox_link_insert");
      });
      this.applyHeadDecision(run, decision, request.completedAt);
      const changed = this.database.query(
        `UPDATE ${RUNS} SET state='completed',worker_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,result_status=?,duration_ms=?,result_ref=?,error_code=?,next_run_at=?,head_disposition=?,settled_at=? WHERE run_id=? AND worker_id=? AND attempt=? AND task_revision=? AND lease_token_hash=? AND state IN ('claimed','source_bound')`,
      ).run(request.status, request.durationMs, request.resultRef, request.errorCode, decision.recordNext, decision.disposition, request.completedAt, run.run_id, run.worker_id, run.attempt, run.task_revision, run.lease_token_hash);
      if (changed.changes !== 1) throw new AbortMutation(errorOf("lease_conflict"));
      this.statement("occurrence_terminal_update");
      const record = this.readRecord(run.run_id)!;
      this.writeDecision(`effect:${request.effect.idempotencyKey}`, "complete", request.effect.requestHash, run.run_id, record, request.completedAt);
      projectScheduledTask(this.database,run.task_id,run.run_id);
      return Result.ok(record);
  }

  private abandonRun(request: AbandonScheduledRunRequest): ResultValue<ScheduledRunRecord, ScheduledRunStoreError> {
    const key = `effect:${request.effect.idempotencyKey}`;
      const replay = this.replayRecordOrRetained(key, "abandon", request.effect.requestHash, request.runId);
      if (replay) { projectScheduledTask(this.database,replay.taskId,replay.runId); return Result.ok(replay); }
      const run = this.requireFencedRun(request, hashScheduledLeaseToken(request.leaseToken));
      const snapshot = this.readSnapshot(run.task_id, run.task_revision);
      const decision = this.decideHead(run, snapshot, request.abandonedAt, request.retryAt);
      this.writeNextDecision(run, decision, request.abandonedAt, request.effect.requestHash);
      this.database.query(
        `INSERT INTO ${ABANDONMENTS}(run_id,request_hash,reason_tag,abandoned_at,retry_at) VALUES(?,?,?,?,?)`,
      ).run(run.run_id, request.effect.requestHash, request.reasonTag, request.abandonedAt, request.retryAt);
      this.statement("abandonment_insert");
      this.applyHeadDecision(run, decision, request.abandonedAt);
      const changed = this.database.query(
        `UPDATE ${RUNS} SET state='abandoned',worker_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,next_run_at=?,head_disposition=?,settled_at=?,abandonment_reason_tag=? WHERE run_id=? AND worker_id=? AND attempt=? AND task_revision=? AND lease_token_hash=? AND state IN ('claimed','source_bound')`,
      ).run(decision.recordNext, decision.disposition, request.abandonedAt, request.reasonTag, run.run_id, request.workerId, request.expectedAttempt, request.expectedTaskRevision, hashScheduledLeaseToken(request.leaseToken));
      if (changed.changes !== 1) throw new AbortMutation(errorOf("lease_conflict"));
      this.statement("occurrence_terminal_update");
      const record = this.readRecord(run.run_id)!;
      this.writeDecision(key, "abandon", request.effect.requestHash, run.run_id, record, request.abandonedAt);
      projectScheduledTask(this.database,run.task_id,run.run_id);
      return Result.ok(record);
  }

  private cleanup(request: CleanupScheduledRunsRequest): ResultValue<CleanupScheduledRunsResult, ScheduledRunStoreError> {
    const key = `cleanupTerminal:${request.settledBefore}:${request.limit}`;
    const requestHash = canonicalRequestHash(request);
      assertProcessAdmission();this.assertRetentionSchema();
      const replay = this.replay(key, requestHash, "cleanupTerminal", null);
      if (replay !== undefined) {
        const result = decodeCleanupResult(replay);
        if (!result) throw new CorruptState();
        return Result.ok(result);
      }
      // Exact existing decisions still replay above. Fresh native retention must
      // use the explicit dry-run plan; this older selection API has no approval
      // snapshot or advancing restart cursor and cannot bypass that owner.
      if(this.database.query("SELECT 1 FROM main.sqlite_schema WHERE type='table' AND name='piclaw_durable_bindings_v1'").get())throw new AbortMutation(errorOf("invalid_transition"));
      // Retain canonical rebuild/replay authority while an explicitly linked
      // host payload survives, or the current paused head still references its
      // successor decision. Legacy unlinked rows are never guessed into it.
      const protectedHistory = hasScheduledHistoryProjection(this.database)
        ? `AND NOT EXISTS (SELECT 1 FROM main.task_run_logs h WHERE h.occurrence_id=r.run_id OR (h.task_id=r.task_id AND r.result_ref='task_run_log:' || h.id))` : "";
      const rows = this.database.query(
        `SELECT r.* FROM ${RUNS} r WHERE r.state IN ('completed','abandoned') AND r.settled_at<? ${protectedHistory}
          AND NOT EXISTS (SELECT 1 FROM main.${LINKS} l JOIN main.service_effect_s05_outbox o ON o.outbox_id=l.outbox_id
            WHERE l.run_id=r.run_id AND (o.state IN ('pending','started','unknown') OR o.certainty='unknown' OR o.retry_at IS NOT NULL))
          AND NOT EXISTS (SELECT 1 FROM ${TASKS} t WHERE t.task_id=r.task_id AND t.current_revision=r.task_revision
            AND t.status='paused' AND t.next_run_at=r.scheduled_for)
          ORDER BY r.settled_at,r.run_id LIMIT ?`,
      ).all(request.settledBefore, request.limit) as RunRow[];
      const runIds: string[] = [];
      for (const row of rows) {
        if(this.hasHistoricalTaskReference(row.task_id))continue;
        this.retireRun(row);
        runIds.push(row.run_id);
      }
      const result = Object.freeze({ removed: runIds.length, runIds: Object.freeze(runIds) });
      this.writeDecision(key, "cleanupTerminal", requestHash, null, result, request.settledBefore);
      return Result.ok(result);
  }

  private retireRun(row:RunRow):void {
    const next = this.database.query(`SELECT decision_hash FROM ${NEXT} WHERE run_id=?`).get(row.run_id) as { decision_hash: string } | undefined;
    if (!next) throw new CorruptState();
    this.database.query(
      `INSERT INTO ${TOMBSTONES}(run_id,task_id,task_revision,scheduled_for,state,attempt,status,next_run_at,head_disposition,settled_at,decision_method,decision_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(row.run_id, row.task_id, row.task_revision, row.scheduled_for, row.state, row.attempt, row.result_status, row.next_run_at, row.head_disposition, row.settled_at, row.state === "completed" ? "complete" : "abandon", next.decision_hash);
    this.statement("tombstone_insert");
    if(!this.readTombstone(row.run_id))throw new CorruptState();
    this.database.query(`DELETE FROM ${DECISIONS} WHERE run_id=?`).run(row.run_id); this.statement("retention_delete");
    this.database.query(`DELETE FROM ${LINKS} WHERE run_id=?`).run(row.run_id); this.statement("retention_delete");
    this.database.query(`DELETE FROM ${BINDINGS} WHERE run_id=?`).run(row.run_id); this.statement("retention_delete");
    this.database.query(`DELETE FROM ${LOGS} WHERE run_id=?`).run(row.run_id); this.statement("retention_delete");
    this.database.query(`DELETE FROM ${ABANDONMENTS} WHERE run_id=?`).run(row.run_id); this.statement("retention_delete");
    this.database.query(`DELETE FROM ${NEXT} WHERE run_id=?`).run(row.run_id); this.statement("retention_delete");
    this.database.query(`DELETE FROM ${RENEWALS} WHERE run_id=?`).run(row.run_id); this.statement("retention_delete");
    this.database.query(`DELETE FROM ${LEASES} WHERE run_id=?`).run(row.run_id); this.statement("retention_delete");
    this.database.query(`DELETE FROM ${RUNS} WHERE run_id=?`).run(row.run_id);
    const removed=this.database.query("SELECT changes() AS n").get() as {n:number};
    if(removed.n!==1)throw new CorruptState();
    this.statement("retention_delete");
  }

  private requireFencedRun(
    request: { runId: string; workerId: string; expectedAttempt: number; expectedTaskRevision: number; now: string },
    tokenHash: string,
  ): RunRow {
    const run = this.readRunRow(request.runId);
    if (!run) {
      if (this.readTombstone(request.runId)) throw new AbortMutation(errorOf("invalid_transition"));
      throw new AbortMutation(errorOf("not_found"));
    }
    this.recordFromRun(run);
    if (run.task_revision !== request.expectedTaskRevision) throw new AbortMutation(errorOf("task_revision_mismatch", "not_applied", false, { observedTaskRevision: run.task_revision }));
    if (run.state === "completed" || run.state === "abandoned") throw new AbortMutation(errorOf("invalid_transition"));
    if (run.worker_id !== request.workerId || run.attempt !== request.expectedAttempt || run.lease_token_hash !== tokenHash) {
      throw new AbortMutation(errorOf("lease_conflict", "not_applied", false, { observedAttempt: run.attempt }));
    }
    if (!run.lease_expires_at || run.lease_expires_at <= request.now) throw new AbortMutation(errorOf("lease_expired", "not_applied", false, { observedAttempt: run.attempt }));
    return run;
  }

  private validateCompletionShape(request: CompleteScheduledRunRequest, run: RunRow, snapshot: ScheduledTaskSnapshot): void {
    if (request.status === "success" ? (request.resultRef === null || request.errorCode !== null) : (request.resultRef !== null || request.errorCode === null)) throw new AbortMutation(errorOf("invalid_request"));
    if (snapshot.kind === "agent") {
      if (run.state !== "source_bound" || run.accepted_source_seq === null || run.operation_id === null) throw new AbortMutation(errorOf("invalid_transition"));
      if (request.effect.operationId !== run.operation_id || request.effect.sourceSeq !== run.accepted_source_seq) throw new AbortMutation(errorOf("invalid_request"));
    } else {
      if (run.state !== "claimed" || run.accepted_source_seq !== null || run.operation_id !== null) throw new AbortMutation(errorOf("invalid_transition"));
      if (request.effect.operationId !== null || request.effect.sourceSeq !== null) throw new AbortMutation(errorOf("invalid_request"));
    }
    for (const intent of request.outboxIntents) {
      if (snapshot.kind === "agent") {
        if (intent.effect.operationId !== run.operation_id || intent.effect.sourceSeq !== run.accepted_source_seq) throw new AbortMutation(errorOf("invalid_request"));
      } else if (intent.effect.operationId !== null || intent.effect.sourceSeq !== null) throw new AbortMutation(errorOf("invalid_request"));
      if ((!snapshot.notifyOnComplete || snapshot.muted || snapshot.kind === "internal") && intent.kind === "notification") throw new AbortMutation(errorOf("invalid_request"));
    }
  }

  private decideHead(run: RunRow, snapshot: ScheduledTaskSnapshot, settledAt: string, retryAt: string | null, skipMissedOccurrences=false) {
    const computed = retryAt ?? computeScheduledSuccessor(snapshot, skipMissedOccurrences?settledAt:run.scheduled_for, settledAt);
    if (snapshot.scheduleType !== "once" && !computed) throw new CorruptState();
    const head = this.readHead(run.task_id);
    let disposition: Exclude<ScheduledRunHeadDisposition, "pending">;
    let recordNext: string | null;
    let effectiveNext: string | null;
    if (!head) throw new AbortMutation(errorOf("task_not_found"));
    if (head.status === "deleted") { disposition = "deleted"; recordNext = null; effectiveNext = null; }
    else if (head.current_revision !== run.task_revision || head.next_run_at !== run.scheduled_for) { disposition = "superseded"; recordNext = null; effectiveNext = null; }
    else if (head.status === "paused") { disposition = "paused"; recordNext = computed; effectiveNext = null; }
    else if (head.status === "active") { disposition = "advanced"; recordNext = computed; effectiveNext = computed; }
    else throw new AbortMutation(errorOf("task_inactive"));
    return { computed, recordNext, effectiveNext, disposition } as const;
  }

  private writeNextDecision(run: RunRow, decision: ReturnType<CurrentPiclawScheduledRunStore["decideHead"]>, decidedAt: string, requestHash: string): void {
    const decisionHash = requestHash;
    this.database.query(
      `INSERT INTO ${NEXT}(run_id,task_id,task_revision,scheduled_for,computed_next_run_at,effective_next_run_at,head_disposition,decided_at,decision_hash) VALUES(?,?,?,?,?,?,?,?,?)`,
    ).run(run.run_id, run.task_id, run.task_revision, run.scheduled_for, decision.computed, decision.effectiveNext, decision.disposition, decidedAt, decisionHash);
    this.statement("next_decision_insert");
  }

  private applyHeadDecision(run: RunRow, decision: ReturnType<CurrentPiclawScheduledRunStore["decideHead"]>, at: string): void {
    if (decision.disposition !== "advanced") return;
    const previous = { taskId: run.task_id, revision: run.task_revision, status: "active" as const, nextRunAt: run.scheduled_for };
    if (!writeScheduledTaskHead(this.database,previous,{ ...previous, nextRunAt: decision.effectiveNext,
      status: decision.effectiveNext === null ? "completed" : "active" },at)) throw new AbortMutation(errorOf("task_revision_mismatch"));
    this.statement("task_head_update");
  }

  private readHead(taskId: string): HeadRow | null {
    return (this.database.query(`SELECT task_id,current_revision,status,next_run_at FROM ${TASKS} WHERE task_id=?`).get(taskId) as HeadRow | undefined) ?? null;
  }
  private readRunRow(runId: string): RunRow | null {
    const row = this.database.query(`SELECT * FROM ${RUNS} WHERE run_id=?`).get(runId) as RunRow | undefined;
    if (row && !validateScheduledRunId(row.run_id, row.task_id, row.task_revision, row.scheduled_for)) throw new CorruptState();
    return row ?? null;
  }
  private readSnapshot(taskId: string, revision: number): ScheduledTaskSnapshot {
    return parseSnapshot(this.database.query(`SELECT snapshot_json,config_hash FROM ${REVISIONS} WHERE task_id=? AND revision=?`).get(taskId, revision) as RevisionRow | undefined);
  }
  private readTombstone(runId: string): Record<string, unknown> | null {
    const row = this.database.query(`SELECT * FROM ${TOMBSTONES} WHERE run_id=?`).get(runId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const method = row.decision_method;
    if ((method !== "complete" && method !== "abandon") || !validHash(row.decision_hash)) throw new CorruptState();
    const record = decodeScheduledRunRecord({
      runId: row.run_id, taskId: row.task_id, taskRevision: row.task_revision, scheduledFor: row.scheduled_for,
      state: row.state, attempt: row.attempt, workerId: null, leaseExpiresAt: null, acceptedSourceSeq: null,
      operationId: null, status: row.status, durationMs: null, resultRef: null, errorCode: null,
      nextRunAt: row.next_run_at, headDisposition: row.head_disposition, settledAt: row.settled_at,
      abandonmentReasonTag: null, outboxIds: [], retained: true,
    });
    if (!record || (record.state === "completed" ? method !== "complete" : method !== "abandon")) throw new CorruptState();
    return { ...row, record };
  }

  private readRecord(runId: string): ScheduledRunRecord | null {
    const run = this.readRunRow(runId);
    if (run) return this.recordFromRun(run);
    const row = this.readTombstone(runId);
    return row ? row.record as ScheduledRunRecord : null;
  }

  private recordFromRun(run: RunRow): ScheduledRunRecord {
    if (!validateScheduledRunId(run.run_id, run.task_id, run.task_revision, run.scheduled_for)) throw new CorruptState();
    const links = this.database.query(`SELECT ordinal,outbox_id FROM ${LINKS} WHERE run_id=? ORDER BY ordinal`).all(run.run_id) as Array<{ ordinal: unknown; outbox_id: unknown }>;
    const outboxIds: string[] = [];
    for (const [index, link] of links.entries()) {
      if (link.ordinal !== index || !validId(link.outbox_id) || outboxIds.includes(link.outbox_id)) throw new CorruptState();
      const target = this.database.query(
        "SELECT o.outbox_id,o.kind,o.idempotency_key,o.request_hash,o.operation_id,o.source_seq,d.decision_key,d.method,d.request_hash AS decision_request_hash,d.outcome,d.outbox_id AS decision_outbox_id,d.attempt,d.lease_token_hash,d.result_json FROM service_effect_s05_outbox o LEFT JOIN service_effect_s05_decisions d ON d.decision_key=('enqueue:' || o.kind || ':' || o.idempotency_key) WHERE o.outbox_id=?",
      ).get(link.outbox_id) as Record<string, unknown> | undefined;
      const expectedDecisionKey = target && `enqueue:${String(target.kind)}:${String(target.idempotency_key)}`;
      if (!target || target.outbox_id !== link.outbox_id || !OUTBOX_KINDS.has(target.kind as string) || !validId(target.idempotency_key)
        || !validHash(target.request_hash) || target.operation_id !== run.operation_id || target.source_seq !== run.accepted_source_seq
        || target.decision_key !== expectedDecisionKey || target.method !== "enqueue" || target.decision_request_hash !== target.request_hash
        || target.outcome !== "applied" || target.decision_outbox_id !== link.outbox_id || target.attempt !== 0
        || target.lease_token_hash !== null || target.result_json !== null) throw new CorruptState();
      outboxIds.push(link.outbox_id);
    }
    const record = decodeScheduledRunRecord({
      runId: run.run_id, taskId: run.task_id, taskRevision: run.task_revision, scheduledFor: run.scheduled_for,
      state: run.state, attempt: run.attempt, workerId: run.worker_id, leaseExpiresAt: run.lease_expires_at,
      acceptedSourceSeq: run.accepted_source_seq, operationId: run.operation_id, status: run.result_status,
      durationMs: run.duration_ms, resultRef: run.result_ref, errorCode: run.error_code, nextRunAt: run.next_run_at,
      headDisposition: run.head_disposition, settledAt: run.settled_at, abandonmentReasonTag: run.abandonment_reason_tag,
      outboxIds, retained: false,
    });
    if (!record) throw new CorruptState();
    const snapshot = this.readSnapshot(run.task_id, run.task_revision);
    if ((snapshot.kind !== "agent" && record.acceptedSourceSeq !== null)
      || (snapshot.kind === "agent" && (record.state === "source_bound" || record.state === "completed") && record.acceptedSourceSeq === null)) throw new CorruptState();
    this.validateLeaseEvidence(run, snapshot, record.state === "claimed" || record.state === "source_bound");
    if (record.acceptedSourceSeq !== null) this.validateSourceBinding(run, record);
    if (record.state === "completed" || record.state === "abandoned") this.validateTerminalEvidence(run, record);
    return record;
  }

  private recordFromJson(value: unknown): ScheduledRunRecord {
    const saved = decodeScheduledRunRecord(value);
    if (!saved) throw new CorruptState();
    const current = this.readRecord(saved.runId);
    if (!current || current.taskId !== saved.taskId || current.taskRevision !== saved.taskRevision
      || current.scheduledFor !== saved.scheduledFor || current.attempt < saved.attempt) throw new CorruptState();
    return current.retained ? current : saved;
  }

  private validateLeaseEvidence(run: RunRow, snapshot: ScheduledTaskSnapshot, active: boolean): void {
    const leases = this.database.query(`SELECT attempt,token_hash,worker_id,claimed_at,lease_expires_at,authority_kind,reconciliation_ref FROM ${LEASES} WHERE run_id=? ORDER BY attempt`).all(run.run_id) as Array<Record<string, unknown>>;
    if (leases.length !== run.attempt) throw new CorruptState();
    for (const [index, row] of leases.entries()) {
      const attempt = index + 1, claimedAt = canonicalInstant(row.claimed_at), leaseExpiresAt = canonicalInstant(row.lease_expires_at);
      if (row.attempt !== attempt || !claimedAt || !leaseExpiresAt || !validHash(row.token_hash) || !validId(row.worker_id) || claimedAt >= leaseExpiresAt) throw new CorruptState();
      const authorityValid = attempt === 1
        ? row.authority_kind === "new" && row.reconciliation_ref === null
        : snapshot.executionRepeatability === "agent_source"
          ? row.authority_kind === "agent_reconciled_absent" && validRef(row.reconciliation_ref)
          : snapshot.executionRepeatability === "repeatable"
            ? row.authority_kind === "repeatable" && row.reconciliation_ref === null
            : row.authority_kind === "reconciled_absent" && validRef(row.reconciliation_ref);
      if (!authorityValid) throw new CorruptState();
      const renewals = this.database.query(`SELECT ordinal,request_hash,previous_expires_at,lease_expires_at,renewed_at FROM ${RENEWALS} WHERE run_id=? AND attempt=? ORDER BY ordinal`).all(run.run_id, attempt) as Array<Record<string, unknown>>;
      let previous: string | null = null;
      for (const [renewalIndex, renewal] of renewals.entries()) {
        const previousExpiresAt = canonicalInstant(renewal.previous_expires_at), renewedExpiresAt = canonicalInstant(renewal.lease_expires_at), renewedAt = canonicalInstant(renewal.renewed_at);
        if (renewal.ordinal !== renewalIndex + 1 || !validHash(renewal.request_hash) || !previousExpiresAt || !renewedExpiresAt || !renewedAt
          || (previous === null ? previousExpiresAt <= claimedAt : previousExpiresAt !== previous) || renewedExpiresAt <= previousExpiresAt
          || renewedAt < claimedAt || renewedAt >= renewedExpiresAt) throw new CorruptState();
        previous = renewedExpiresAt;
      }
      if (previous !== null && previous !== leaseExpiresAt) throw new CorruptState();
      if (active && attempt === run.attempt && (row.token_hash !== run.lease_token_hash || row.worker_id !== run.worker_id
        || claimedAt !== run.claimed_at || leaseExpiresAt !== run.lease_expires_at)) throw new CorruptState();
    }
  }

  private validateSourceBinding(run: RunRow, record: ScheduledRunRecord): void {
    const snapshot = this.readSnapshot(run.task_id, run.task_revision);
    const row = this.database.query(`SELECT request_hash,idempotency_key,chat_jid,source_seq,operation_id,bound_at FROM ${BINDINGS} WHERE run_id=?`).get(run.run_id) as Record<string, unknown> | undefined;
    if (!row || !validHash(row.request_hash) || !validId(row.idempotency_key) || row.chat_jid !== snapshot.chatJid
      || row.source_seq !== record.acceptedSourceSeq || row.operation_id !== record.operationId || !canonicalInstant(row.bound_at)) throw new CorruptState();
    const owner = this.database.query(
      "SELECT s.source_id,s.kind,s.chat_jid AS source_chat,s.source_seq,o.operation_id,o.chat_jid AS operation_chat,o.primary_source_seq,os.chat_jid AS membership_chat,os.source_seq AS membership_source_seq FROM service_effect_s01_sources s JOIN service_effect_s01_operation_sources os ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq JOIN service_effect_s01_operations o ON o.operation_id=os.operation_id AND o.chat_jid=os.chat_jid WHERE s.chat_jid=? AND s.source_seq=? AND o.operation_id=?",
    ).get(snapshot.chatJid, record.acceptedSourceSeq, record.operationId) as Record<string, unknown> | undefined;
    if (!owner || owner.source_id !== run.run_id || owner.kind !== "scheduled_agent" || owner.source_chat !== snapshot.chatJid
      || owner.source_seq !== record.acceptedSourceSeq || owner.operation_id !== record.operationId || owner.operation_chat !== snapshot.chatJid
      || owner.primary_source_seq !== record.acceptedSourceSeq || owner.membership_chat !== snapshot.chatJid
      || owner.membership_source_seq !== record.acceptedSourceSeq) throw new CorruptState();
  }

  private validateTerminalEvidence(run: RunRow, record: ScheduledRunRecord): void {
    const next = this.database.query(`SELECT task_id,task_revision,scheduled_for,computed_next_run_at,effective_next_run_at,head_disposition,decided_at,decision_hash FROM ${NEXT} WHERE run_id=?`).get(run.run_id) as Record<string, unknown> | undefined;
    if (!next || next.task_id !== run.task_id || next.task_revision !== run.task_revision || next.scheduled_for !== run.scheduled_for
      || next.head_disposition !== run.head_disposition || next.decided_at !== record.settledAt || !validHash(next.decision_hash)
      || (next.computed_next_run_at !== null && !canonicalInstant(next.computed_next_run_at))
      || (next.effective_next_run_at !== null && !canonicalInstant(next.effective_next_run_at))) throw new CorruptState();
    const expectedRecordNext = record.headDisposition === "advanced" || record.headDisposition === "paused" ? next.computed_next_run_at : null;
    const expectedEffective = record.headDisposition === "advanced" ? next.computed_next_run_at : null;
    if (record.nextRunAt !== expectedRecordNext || next.effective_next_run_at !== expectedEffective) throw new CorruptState();
    const snapshot = this.readSnapshot(run.task_id, run.task_revision);
    let retryAt: string | null = null;
    if (record.state === "completed") {
      const log = this.database.query(`SELECT task_id,task_revision,scheduled_for,task_kind,completed_at,duration_ms,status,result_ref,error_code FROM ${LOGS} WHERE run_id=?`).get(run.run_id) as Record<string, unknown> | undefined;
      if (!log || log.task_id !== run.task_id || log.task_revision !== run.task_revision || log.scheduled_for !== run.scheduled_for
        || log.task_kind !== snapshot.kind || log.completed_at !== record.settledAt || log.duration_ms !== record.durationMs
        || log.status !== record.status || log.result_ref !== record.resultRef || log.error_code !== record.errorCode) throw new CorruptState();
    } else {
      const abandonment = this.database.query(`SELECT request_hash,reason_tag,abandoned_at,retry_at FROM ${ABANDONMENTS} WHERE run_id=?`).get(run.run_id) as Record<string, unknown> | undefined;
      retryAt = abandonment?.retry_at === null ? null : canonicalInstant(abandonment?.retry_at);
      if (!abandonment || !validHash(abandonment.request_hash) || abandonment.reason_tag !== record.abandonmentReasonTag
        || abandonment.abandoned_at !== record.settledAt || (abandonment.retry_at !== null && !retryAt)) throw new CorruptState();
    }
    const computed = retryAt ?? computeScheduledSuccessor(snapshot, run.scheduled_for, record.settledAt!);
    const recoveredNext=record.state==='completed'&&record.status==='error'&&record.errorCode==='scheduled_run_interrupted'&&this.interruptedSourceProof(run,snapshot)
      ?computeScheduledSuccessor(snapshot,record.settledAt!,record.settledAt!):undefined;
    if ((snapshot.scheduleType !== 'once'&&!computed)||(next.computed_next_run_at!==computed&&next.computed_next_run_at!==recoveredNext))throw new CorruptState();
  }

  private requireActiveRecord(record: ScheduledRunRecord | null): ScheduledRunLease["record"] {
    if (!record || (record.state !== "claimed" && record.state !== "source_bound") || record.workerId === null || record.leaseExpiresAt === null) throw new CorruptState();
    return record as ScheduledRunLease["record"];
  }

  private lease(record: ScheduledRunLease["record"], task: ScheduledTaskSnapshot, token: string): ScheduledRunLease {
    return Object.freeze({ record, task, leaseToken: token });
  }

  private replay(key: string, requestHash: string, method: MutationMethod, expectedRunId: string | null): unknown | undefined {
    const row = this.database.query(`SELECT method,request_hash,result_json,run_id FROM ${DECISIONS} WHERE decision_key=?`).get(key) as DecisionRow | undefined;
    if (!row) return undefined;
    if (row.method !== method || row.request_hash !== requestHash || !validHash(row.request_hash)) throw new AbortMutation(errorOf("idempotency_conflict"));
    if (row.run_id !== expectedRunId || (row.run_id !== null && !validScheduledRunId(row.run_id))) throw new CorruptState();
    return parseDecision(row);
  }

  private replayRecordOrRetained(key: string, method: "bindAcceptedSource" | "complete" | "abandon", requestHash: string, runId: string): ScheduledRunRecord | null {
    const replay = this.replay(key, requestHash, method, runId);
    if (replay !== undefined) return this.recordFromJson(replay);
    const tombstone = this.readTombstone(runId);
    if (!tombstone) return null;
    if (tombstone.decision_method !== method || tombstone.decision_hash !== requestHash) throw new AbortMutation(errorOf("idempotency_conflict"));
    return tombstone.record as ScheduledRunRecord;
  }

  private writeDecision(key: string, method: MutationMethod, requestHash: string, runId: string | null, result: unknown, at: string): void {
    this.database.query(`INSERT INTO ${DECISIONS}(decision_key,method,request_hash,run_id,result_json,decided_at) VALUES(?,?,?,?,?,?)`).run(key, method, requestHash, runId, JSON.stringify(result), at);
    this.statement("decision_insert");
  }

  private statement(value: ScheduledRunStatement): void { this.runtime.afterStatement?.(value); }
  private trace(method: string, effectId: string, operationId: string | null, version: number | null, resultTag: string, certainty: "not_applied" | "applied" | "unknown" | null, sourceSeq: number | null = null): void {
    try { this.runtime.recordTrace({ contract: "EF-S07", method, effectId, operationId, sourceSeq, version, certainty, resultTag }); } catch (error) { void error; /* observers never own outcomes */ }
  }
  private failed<T>(method: string, effectId: string, operationId: string | null, version: number | null, error: ScheduledRunStoreError, sourceSeq: number | null = null): ResultValue<T, ScheduledRunStoreError> {
    this.trace(method, effectId, operationId, version, error._tag, error.certainty, sourceSeq);
    return Result.err(error);
  }
}
