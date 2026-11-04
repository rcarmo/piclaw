import { admitSqliteWrite } from '../../db/sqlite-async-admission.js';
import { createHash } from "node:crypto";
import type Database from "bun:sqlite";
import {
  Result,
  type Result as ResultValue,
} from "../contracts/result.js";

import type {
  EffectCertainty,
  NormalisedTraceInput,
} from "../contracts/common.js";
import {
  OUTBOX_KINDS,
  type ClaimOutboxRequest,
  type CleanupTerminalOutboxRequest,
  type CompleteOutboxRequest,
  type EnqueueOutboxRequest,
  type FailOutboxRequest,
  type ListUnknownOutboxRequest,
  type ListUnknownOutboxResult,
  type MarkOutboxUnknownRequest,
  type OutboxClaimDecision,
  type OutboxCleanupDecision,
  type OutboxEnqueueDecision,
  type OutboxKind,
  type OutboxLease,
  type OutboxMutationDecision,
  type OutboxRecord,
  type OutboxState,
  type OutboxStoreError,
  type OutboxStoreErrorTag,
  type ReclaimOutboxRequest,
  type ResolveUnknownOutboxRequest,
  type ServiceOutboxEnqueueInserter,
  type ServiceOutboxStore,
} from "../contracts/service-outbox-store.js";
import {
  hashOutboxRequest,
  normaliseOutboxId,
  normaliseOutboxList,
  normaliseOutboxMutation,
  type OutboxMutationMethod,
} from "./service-outbox-request-normalizer.js";

const OUTBOX = "service_effect_s05_outbox";
const LEASES = "service_effect_s05_leases";
const OUTCOMES = "service_effect_s05_outcomes";
const RESOLUTIONS = "service_effect_s05_resolutions";
const DECISIONS = "service_effect_s05_decisions";
const HASH = /^[0-9a-f]{64}$/;
const TAG = /^[A-Za-z0-9_.:-]{1,128}$/;
const KINDS = new Set<string>(OUTBOX_KINDS);
const STATES = new Set<string>([
  "pending",
  "started",
  "completed",
  "failed",
  "unknown",
  "cancelled",
]);
const REDACTIONS = new Set<string>(["public", "private", "secret"]);
const CERTAINTIES = new Set<string>(["not_applied", "applied", "unknown"]);

export interface ServiceOutboxAdapterRuntime {
  hitFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
    method: OutboxMutationMethod,
  ): unknown;
  recordTrace(input: NormalisedTraceInput): void;
}
interface Row {
  [key: string]: unknown;
}
interface DecisionRow {
  decision_key: unknown;
  method: unknown;
  request_hash: unknown;
  outcome: unknown;
  outbox_id: unknown;
  attempt: unknown;
  lease_token_hash: unknown;
  result_json: unknown;
}
interface LeaseRow {
  token_hash: unknown;
  request_hash: unknown;
  method: unknown;
  outbox_id: unknown;
  attempt: unknown;
  worker_id: unknown;
  claimed_at: unknown;
  lease_expires_at: unknown;
  reconciliation_ref: unknown;
}
interface OutcomeRow {
  outbox_id: unknown;
  attempt: unknown;
  method: unknown;
  request_hash: unknown;
  state: unknown;
  certainty: unknown;
  result_at: unknown;
  receipt_ref: unknown;
  error_tag: unknown;
  retry_at: unknown;
  reconciliation_ref: unknown;
}
interface ResolutionRow {
  outbox_id: unknown;
  attempt: unknown;
  request_hash: unknown;
  state: unknown;
  certainty: unknown;
  reconciled_at: unknown;
  reconciliation_ref: unknown;
  receipt_ref: unknown;
  error_tag: unknown;
  retry_at: unknown;
  cancellation_reason_tag: unknown;
}
interface MutationContext {
  readonly method: OutboxMutationMethod;
  readonly request: unknown;
}
class BeforeTransactionFault extends Error {}
class RollbackFault extends Error {}
class CorruptStateFault extends Error {}

export type ServiceOutboxStoreConstructionResult = ResultValue<
  CurrentPiclawServiceOutboxStore,
  OutboxStoreError
>;
export type ServiceOutboxInserterConstructionResult = ResultValue<
  ServiceOutboxEnqueueInserter,
  OutboxStoreError
>;

export function createCurrentPiclawServiceOutboxStore(
  database: Database,
  runtime: ServiceOutboxAdapterRuntime,
): ServiceOutboxStoreConstructionResult {
  try {
    verifyDatabase(database);
    return Result.ok(CurrentPiclawServiceOutboxStore.create(database, runtime));
  } catch (error) {
    void error;
    return Result.err(errorOf("storage_unavailable", "not_applied", true));
  }
}

export type ServiceOutboxEnqueueStatement =
  | "outbox_insert"
  | "outbox_decision_insert";

export interface ServiceOutboxEnqueueInsertObserver {
  afterStatement(statement: ServiceOutboxEnqueueStatement): void;
}

export function createServiceOutboxEnqueueInserter(
  database: Database,
  observer?: ServiceOutboxEnqueueInsertObserver,
): ServiceOutboxInserterConstructionResult {
  try {
    verifyDatabase(database);
    return Result.ok(
      Object.freeze({
        insert(
          input: EnqueueOutboxRequest,
        ): ResultValue<OutboxEnqueueDecision, OutboxStoreError> {
          if (!database.inTransaction)
            return Result.err(errorOf("invalid_transition"));
          const request = normaliseOutboxMutation(
            "enqueue",
            input,
          ) as EnqueueOutboxRequest | null;
          if (!request) return Result.err(errorOf("invalid_request"));
          try {
            return insertEnqueue(database, request, observer);
          } catch (error) {
            return Result.err(classifyDatabaseError(error));
          }
        },
      }),
    );
  } catch (error) {
    void error;
    return Result.err(errorOf("storage_unavailable", "not_applied", true));
  }
}

export class CurrentPiclawServiceOutboxStore implements ServiceOutboxStore {
  #serial: Promise<void> = Promise.resolve();
  private constructor(
    readonly database: Database,
    private readonly runtime: ServiceOutboxAdapterRuntime,
  ) {}
  static create(
    database: Database,
    runtime: ServiceOutboxAdapterRuntime,
  ): CurrentPiclawServiceOutboxStore {
    return new CurrentPiclawServiceOutboxStore(database, runtime);
  }

  enqueue(input: EnqueueOutboxRequest) {
    return this.mutate("enqueue", input, (request) =>
      insertEnqueue(this.database, request as EnqueueOutboxRequest),
    );
  }

  claimNext(input: ClaimOutboxRequest) {
    return this.mutate("claimNext", input, (candidate) => {
      const request = candidate as ClaimOutboxRequest;
      const requestHash = hashOutboxRequest(request);
      const tokenHash = hashToken(request.leaseToken);
      const replay = this.readClaimReplay(request, requestHash, tokenHash);
      if (replay) return replay;
      const row = this.selectEligible(request);
      if (!row) {
        const decision = freeze({ decision: "empty" as const, lease: null });
        this.writeDecision({
          key: `claim:${tokenHash}`,
          method: "claimNext",
          requestHash,
          outcome: "empty",
          outboxId: null,
          attempt: null,
          tokenHash,
          resultJson: null,
        });
        return Result.ok(decision);
      }
      const current = decodeRecord(row);
      const attempt = current.attempt + 1;
      const changed = this.database
        .query(
          `UPDATE ${OUTBOX} SET state='started',state_changed_at=?,attempt=?,worker_id=?,claimed_at=?,lease_token=?,lease_expires_at=?,certainty=NULL,retry_at=NULL,receipt_ref=NULL,last_error_tag=NULL,result_at=NULL,reconciled_at=NULL,cancellation_reason_tag=NULL WHERE outbox_id=? AND attempt=? AND ((state='pending' AND available_at<=?) OR (state='failed' AND retry_at IS NOT NULL AND retry_at<=?))`,
        )
        .run(
          request.now,
          attempt,
          request.workerId,
          request.now,
          request.leaseToken,
          request.leaseExpiresAt,
          current.outboxId,
          current.attempt,
          request.now,
          request.now,
        );
      if (changed.changes !== 1) {
        const decision = freeze({ decision: "empty" as const, lease: null });
        this.writeDecision({
          key: `claim:${tokenHash}`,
          method: "claimNext",
          requestHash,
          outcome: "empty",
          outboxId: null,
          attempt: null,
          tokenHash,
          resultJson: null,
        });
        return Result.ok(decision);
      }
      this.writeLease(
        tokenHash,
        requestHash,
        "claimNext",
        current.outboxId,
        attempt,
        request.workerId,
        request.now,
        request.leaseExpiresAt,
        null,
      );
      this.writeDecision({
        key: `claim:${tokenHash}`,
        method: "claimNext",
        requestHash,
        outcome: "applied",
        outboxId: current.outboxId,
        attempt,
        tokenHash,
        resultJson: null,
      });
      return Result.ok(
        freeze({
          decision: "applied" as const,
          lease: leaseOf(
            this.requireRecord(current.outboxId),
            request.leaseToken,
          ),
        }),
      );
    });
  }

  reclaim(input: ReclaimOutboxRequest) {
    return this.mutate("reclaim", input, (candidate) => {
      const request = candidate as ReclaimOutboxRequest;
      const requestHash = hashOutboxRequest(request);
      const tokenHash = hashToken(request.leaseToken);
      const replay = this.readRecordReplay(
        "reclaim",
        `reclaim:${request.outboxId}:${request.expectedAttempt}`,
        requestHash,
        request,
      );
      if (replay) return replay;
      if (this.readLease(tokenHash))
        return Result.err(errorOf("idempotency_conflict"));
      const row = this.readRecord(request.outboxId);
      if (!row) return Result.err(errorOf("not_found"));
      const authorised =
        row.state === "started" &&
        row.attempt === request.expectedAttempt &&
        row.leaseExpiresAt !== null &&
        row.claimedAt !== null &&
        request.now >= row.leaseExpiresAt &&
        request.now >= row.claimedAt &&
        ((request.authority.kind === "repeatable" &&
          row.repeatability === "repeatable") ||
          request.authority.kind === "reconciled_absent");
      let decision: OutboxMutationDecision = stale();
      if (authorised) {
        const attempt = row.attempt + 1;
        const reconciliationRef =
          request.authority.kind === "reconciled_absent"
            ? request.authority.reconciliationRef
            : row.reconciliationRef;
        const changed = this.database
          .query(
            `UPDATE ${OUTBOX} SET state_changed_at=?,attempt=?,worker_id=?,claimed_at=?,lease_token=?,lease_expires_at=?,reconciliation_ref=? WHERE outbox_id=? AND state='started' AND attempt=? AND lease_expires_at<=? AND claimed_at<=?`,
          )
          .run(
            request.now,
            attempt,
            request.workerId,
            request.now,
            request.leaseToken,
            request.leaseExpiresAt,
            reconciliationRef,
            request.outboxId,
            request.expectedAttempt,
            request.now,
            request.now,
          );
        if (changed.changes === 1) {
          this.writeLease(
            tokenHash,
            requestHash,
            "reclaim",
            request.outboxId,
            attempt,
            request.workerId,
            request.now,
            request.leaseExpiresAt,
            reconciliationRef,
          );
          decision = applied(this.requireRecord(request.outboxId));
        }
      }
      this.writeDecision({
        key: `reclaim:${request.outboxId}:${request.expectedAttempt}`,
        method: "reclaim",
        requestHash,
        outcome: decision.decision === "applied" ? "applied" : "stale",
        outboxId: request.outboxId,
        attempt:
          decision.decision === "applied"
            ? decision.record.attempt
            : request.expectedAttempt,
        tokenHash: decision.decision === "applied" ? tokenHash : null,
        resultJson: null,
      });
      return Result.ok(decision);
    });
  }

  complete(input: CompleteOutboxRequest) {
    return this.workerResult("complete", input, {
      state: "completed",
      certainty: "applied",
      at: input.completedAt,
      receiptRef: input.receiptRef,
      errorTag: null,
      retryAt: null,
    });
  }
  fail(input: FailOutboxRequest) {
    return this.workerResult("fail", input, {
      state: "failed",
      certainty: "not_applied",
      at: input.failedAt,
      receiptRef: null,
      errorTag: input.errorTag,
      retryAt: input.retryAt,
    });
  }
  markUnknown(input: MarkOutboxUnknownRequest) {
    return this.workerResult("markUnknown", input, {
      state: "unknown",
      certainty: "unknown",
      at: input.observedAt,
      receiptRef: null,
      errorTag: input.errorTag,
      retryAt: null,
    });
  }

  resolveUnknown(input: ResolveUnknownOutboxRequest) {
    return this.mutate("resolveUnknown", input, (candidate) => {
      const request = candidate as ResolveUnknownOutboxRequest;
      const requestHash = hashOutboxRequest(request);
      const key = `resolve:${request.outboxId}:${request.expectedAttempt}`;
      const replay = this.readRecordReplay(
        "resolveUnknown",
        key,
        requestHash,
        request,
      );
      if (replay) return replay;
      const row = this.readRecord(request.outboxId);
      if (!row) return Result.err(errorOf("not_found"));
      let decision: OutboxMutationDecision = stale();
      if (
        row.state === "unknown" &&
        row.attempt === request.expectedAttempt &&
        row.resultAt !== null &&
        request.reconciledAt >= row.resultAt &&
        validResolutionTime(request)
      ) {
        const resolution = request.resolution;
        const state =
          resolution.kind === "applied"
            ? "completed"
            : resolution.kind === "not_applied"
              ? "failed"
              : "cancelled";
        const certainty =
          resolution.kind === "applied" ? "applied" : "not_applied";
        const receiptRef =
          resolution.kind === "applied" ? resolution.receiptRef : null;
        const errorTag =
          resolution.kind === "not_applied" ? resolution.errorTag : null;
        const retryAt =
          resolution.kind === "not_applied" ? resolution.retryAt : null;
        const reason =
          resolution.kind === "cancelled" ? resolution.reasonTag : null;
        const changed = this.database
          .query(
            `UPDATE ${OUTBOX} SET state=?,state_changed_at=?,certainty=?,retry_at=?,receipt_ref=?,last_error_tag=?,result_at=?,reconciliation_ref=?,reconciled_at=?,cancellation_reason_tag=? WHERE outbox_id=? AND state='unknown' AND attempt=? AND result_at<=?`,
          )
          .run(
            state,
            request.reconciledAt,
            certainty,
            retryAt,
            receiptRef,
            errorTag,
            request.reconciledAt,
            request.reconciliationRef,
            request.reconciledAt,
            reason,
            request.outboxId,
            request.expectedAttempt,
            request.reconciledAt,
          );
        if (changed.changes === 1) {
          this.database
            .query(
              `INSERT INTO ${RESOLUTIONS}(outbox_id,attempt,request_hash,state,certainty,reconciled_at,reconciliation_ref,receipt_ref,error_tag,retry_at,cancellation_reason_tag) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              request.outboxId,
              request.expectedAttempt,
              requestHash,
              state,
              certainty,
              request.reconciledAt,
              request.reconciliationRef,
              receiptRef,
              errorTag,
              retryAt,
              reason,
            );
          decision = applied(this.requireRecord(request.outboxId));
        }
      }
      this.writeDecision({
        key,
        method: "resolveUnknown",
        requestHash,
        outcome: decision.decision === "applied" ? "applied" : "stale",
        outboxId: request.outboxId,
        attempt: request.expectedAttempt,
        tokenHash: null,
        resultJson: null,
      });
      return Result.ok(decision);
    });
  }

  async get(
    input: string,
  ): Promise<ResultValue<OutboxRecord | null, OutboxStoreError>> {
    const id = normaliseOutboxId(input);
    if (!id) return Result.err(errorOf("invalid_request"));
    try {
      return Result.ok(this.readRecord(id));
    } catch (error) {
      void error;
      return Result.err(errorOf("corrupt_state"));
    }
  }

  async listUnknown(
    input: ListUnknownOutboxRequest,
  ): Promise<ResultValue<ListUnknownOutboxResult, OutboxStoreError>> {
    const request = normaliseOutboxList(input);
    if (!request) return Result.err(errorOf("invalid_request"));
    try {
      const marks = request.kinds.map(() => "?").join(",");
      const after = request.after;
      const rows = this.database
        .query(
          `SELECT * FROM ${OUTBOX} WHERE state='unknown' AND kind IN (${marks}) AND (? IS NULL OR state_changed_at>? OR (state_changed_at=? AND outbox_id>?)) ORDER BY state_changed_at,outbox_id LIMIT ?`,
        )
        .all(
          ...request.kinds,
          after?.stateChangedAt ?? null,
          after?.stateChangedAt ?? "",
          after?.stateChangedAt ?? "",
          after?.outboxId ?? "",
          request.limit,
        ) as Row[];
      const records = Object.freeze(rows.map(decodeRecord));
      const last =
        records.length === request.limit ? (records.at(-1) ?? null) : null;
      return Result.ok(
        freeze({
          records,
          nextCursor: last
            ? { stateChangedAt: last.stateChangedAt, outboxId: last.outboxId }
            : null,
        }),
      );
    } catch (error) {
      void error;
      return Result.err(errorOf("corrupt_state"));
    }
  }

  cleanupTerminal(input: CleanupTerminalOutboxRequest) {
    return this.mutate("cleanupTerminal", input, (candidate) => {
      const request = candidate as CleanupTerminalOutboxRequest;
      const requestHash = hashOutboxRequest(request);
      const key = `cleanup:${request.cleanupId}`;
      const replay = this.readCleanupReplay(key, requestHash);
      if (replay) return replay;
      const after = request.after;
      const rows = this.database
        .query(
          `SELECT outbox_id,state_changed_at FROM ${OUTBOX} WHERE state_changed_at<? AND (state='cancelled' OR (state='failed' AND certainty='not_applied' AND retry_at IS NULL)) AND (? IS NULL OR state_changed_at>? OR (state_changed_at=? AND outbox_id>?)) ORDER BY state_changed_at,outbox_id LIMIT ?`,
        )
        .all(
          request.before,
          after?.stateChangedAt ?? null,
          after?.stateChangedAt ?? "",
          after?.stateChangedAt ?? "",
          after?.outboxId ?? "",
          request.limit,
        ) as Array<{ outbox_id: string; state_changed_at: string }>;
      for (const row of rows) {
        this.database
          .query(`DELETE FROM ${DECISIONS} WHERE outbox_id=?`)
          .run(row.outbox_id);
        this.database
          .query(`DELETE FROM ${OUTCOMES} WHERE outbox_id=?`)
          .run(row.outbox_id);
        this.database
          .query(`DELETE FROM ${RESOLUTIONS} WHERE outbox_id=?`)
          .run(row.outbox_id);
        const removed = this.database
          .query(
            `DELETE FROM ${OUTBOX} WHERE outbox_id=? AND state_changed_at=? AND (state='cancelled' OR (state='failed' AND certainty='not_applied' AND retry_at IS NULL))`,
          )
          .run(row.outbox_id, row.state_changed_at);
        if (removed.changes !== 1) throw new CorruptStateFault();
      }
      const last = rows.length === request.limit ? (rows.at(-1) ?? null) : null;
      const result = freeze({
        deletedIds: Object.freeze(rows.map((row) => row.outbox_id)),
        deletedCount: rows.length,
        nextCursor: last
          ? { stateChangedAt: last.state_changed_at, outboxId: last.outbox_id }
          : null,
      });
      this.writeDecision({
        key,
        method: "cleanupTerminal",
        requestHash,
        outcome: "applied",
        outboxId: null,
        attempt: null,
        tokenHash: null,
        resultJson: JSON.stringify(result),
      });
      return Result.ok(freeze({ decision: "applied" as const, result }));
    });
  }

  private workerResult<
    T extends
      | CompleteOutboxRequest
      | FailOutboxRequest
      | MarkOutboxUnknownRequest,
  >(
    method: "complete" | "fail" | "markUnknown",
    input: T,
    outcome: {
      state: "completed" | "failed" | "unknown";
      certainty: EffectCertainty;
      at: string;
      receiptRef: string | null;
      errorTag: string | null;
      retryAt: string | null;
    },
  ) {
    return this.mutate(method, input, (candidate) => {
      const request = candidate as T;
      const requestHash = hashOutboxRequest(request);
      const key = `outcome:${request.outboxId}:${request.expectedAttempt}`;
      const known = this.readOutcome(request.outboxId, request.expectedAttempt);
      if (known) {
        if (known.method === method && known.requestHash === requestHash)
          return Result.ok(
            freeze({
              decision: "replayed" as const,
              record: recordFromOutcome(
                this.requireRecord(request.outboxId),
                known,
              ),
            }),
          );
        return Result.ok(stale());
      }
      const previousDecision = this.readDecision(key);
      if (
        previousDecision?.method === method &&
        previousDecision.requestHash === requestHash &&
        previousDecision.outcome === "stale"
      ) {
        return Result.ok(stale());
      }
      if (previousDecision && previousDecision.outcome !== "stale") {
        return Result.ok(stale());
      }

      const row = this.readRecord(request.outboxId);
      if (!row) return Result.err(errorOf("not_found"));
      const temporal =
        row.claimedAt !== null &&
        row.leaseExpiresAt !== null &&
        outcome.at >= row.claimedAt &&
        outcome.at < row.leaseExpiresAt &&
        (outcome.retryAt === null || outcome.retryAt > outcome.at);
      const ownsAttempt =
        row.state === "started" &&
        row.workerId === request.workerId &&
        row.attempt === request.expectedAttempt &&
        row.leaseToken === request.leaseToken;
      if (!temporal || !ownsAttempt) return Result.ok(stale());

      const changed = this.database
        .query(
          `UPDATE ${OUTBOX} SET state=?,state_changed_at=?,worker_id=NULL,claimed_at=NULL,lease_token=NULL,lease_expires_at=NULL,certainty=?,retry_at=?,receipt_ref=?,last_error_tag=?,result_at=?,reconciled_at=NULL,cancellation_reason_tag=NULL WHERE outbox_id=? AND state='started' AND worker_id=? AND attempt=? AND lease_token=? AND claimed_at<=? AND lease_expires_at>?`,
        )
        .run(
          outcome.state,
          outcome.at,
          outcome.certainty,
          outcome.retryAt,
          outcome.receiptRef,
          outcome.errorTag,
          outcome.at,
          request.outboxId,
          request.workerId,
          request.expectedAttempt,
          request.leaseToken,
          outcome.at,
          outcome.at,
        );
      if (changed.changes !== 1) return Result.ok(stale());

      if (previousDecision) {
        const removed = this.database
          .query(
            `DELETE FROM ${DECISIONS} WHERE decision_key=? AND method=? AND request_hash=? AND outcome='stale'`,
          )
          .run(key, previousDecision.method, previousDecision.requestHash);
        if (removed.changes !== 1) throw new CorruptStateFault();
      }

      this.database
        .query(
          `INSERT INTO ${OUTCOMES}(outbox_id,attempt,method,request_hash,state,certainty,result_at,receipt_ref,error_tag,retry_at,reconciliation_ref) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          request.outboxId,
          request.expectedAttempt,
          method,
          requestHash,
          outcome.state,
          outcome.certainty,
          outcome.at,
          outcome.receiptRef,
          outcome.errorTag,
          outcome.retryAt,
          row.reconciliationRef,
        );
      const decision = applied(this.requireRecord(request.outboxId));
      this.writeDecision({
        key,
        method,
        requestHash,
        outcome: "applied",
        outboxId: request.outboxId,
        attempt: request.expectedAttempt,
        tokenHash: null,
        resultJson: null,
      });
      return Result.ok(decision);
    });
  }

  private async mutate<T>(
    method: OutboxMutationMethod,
    input: unknown,
    apply: (request: unknown) => ResultValue<T, OutboxStoreError>,
  ): Promise<ResultValue<T, OutboxStoreError>> {
    const request = normaliseOutboxMutation(method, input);
    const context: MutationContext = { method, request };
    const previous = this.#serial;
    let release!: () => void;
    this.#serial = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      this.trace(context, "call", null);
      if (!request)
        return this.finish(context, Result.err(errorOf("invalid_request")));
      const faultObservation = this.readBeforeEffectFault(method);
      if (
        !faultObservation.ok ||
        faultObservation.checkpoint === "pre_transaction"
      ) {
        throw new BeforeTransactionFault();
      }
      const outcome = await admitSqliteWrite(this.database, () => {
          const value = apply(request);
          if (!value.ok) return value;
          if (faultObservation.checkpoint === "in_transaction")
            throw new RollbackFault();
          return value;
        });
      if (!outcome.ok) return this.finish(context, outcome);
      if (this.exactLostAcknowledgement(method))
        return this.finish(
          context,
          Result.err(errorOf("storage_unavailable", "unknown", true)),
        );
      return this.finish(context, Result.ok(outcome.value));
    } catch (error) {
      const bounded =
        error instanceof CorruptStateFault
          ? errorOf("corrupt_state")
          : error instanceof BeforeTransactionFault ||
              error instanceof RollbackFault
            ? errorOf("storage_unavailable", "not_applied", true)
            : classifyDatabaseError(error);
      return this.finish(context, Result.err(bounded));
    } finally {
      release();
    }
  }

  private readBeforeEffectFault(method: OutboxMutationMethod):
    | {
        readonly ok: true;
        readonly checkpoint: "pre_transaction" | "in_transaction" | null;
      }
    | { readonly ok: false } {
    try {
      const value = this.runtime.hitFault("before_effect", method);
      if (value === false) return { ok: true, checkpoint: null };
      if (value === true) return { ok: true, checkpoint: "pre_transaction" };
      if (value === "in_transaction") {
        return { ok: true, checkpoint: "in_transaction" };
      }
      return { ok: false };
    } catch (error) {
      void error;
      return { ok: false };
    }
  }
  private exactLostAcknowledgement(method: OutboxMutationMethod): boolean {
    try {
      return (
        this.runtime.hitFault("effect_then_lost_acknowledgement", method) ===
        true
      );
    } catch (error) {
      void error;
      return false;
    }
  }
  private trace(
    context: MutationContext,
    resultTag: string,
    certainty: EffectCertainty | null,
  ): void {
    const request = context.request as {
      outboxId?: string;
      effect?: { operationId?: string | null; sourceSeq?: number | null };
      expectedAttempt?: number;
    } | null;
    try {
      this.runtime.recordTrace({
        contract: "EF-S05",
        method: context.method,
        effectId: request?.outboxId ?? "invalid",
        operationId: request?.effect?.operationId ?? null,
        sourceSeq: request?.effect?.sourceSeq ?? null,
        version: request?.expectedAttempt ?? null,
        certainty,
        resultTag,
      });
    } catch (error) {
      void error;
    }
  }
  private finish<T>(
    context: MutationContext,
    result: ResultValue<T, OutboxStoreError>,
  ): ResultValue<T, OutboxStoreError> {
    this.trace(
      context,
      result.ok ? decisionTag(result.value) : result.error._tag,
      result.ok ? decisionCertainty(result.value) : result.error.certainty,
    );
    return result;
  }

  private selectEligible(request: ClaimOutboxRequest): Row | null {
    const marks = request.kinds.map(() => "?").join(",");
    return this.database
      .query(
        `SELECT * FROM ${OUTBOX} WHERE kind IN (${marks}) AND ((state='pending' AND available_at<=?) OR (state='failed' AND retry_at IS NOT NULL AND retry_at<=?)) ORDER BY CASE WHEN state='pending' THEN available_at ELSE retry_at END,outbox_id LIMIT 1`,
      )
      .get(...request.kinds, request.now, request.now) as Row | null;
  }
  private readRecord(id: string): OutboxRecord | null {
    const row = this.database
      .query(`SELECT * FROM ${OUTBOX} WHERE outbox_id=?`)
      .get(id) as Row | null;
    return row ? decodeRecord(row) : null;
  }
  private requireRecord(id: string): OutboxRecord {
    const record = this.readRecord(id);
    if (!record) throw new CorruptStateFault();
    return record;
  }
  private readDecision(key: string): ReturnType<typeof decodeDecision> | null {
    const row = this.database
      .query(`SELECT * FROM ${DECISIONS} WHERE decision_key=?`)
      .get(key) as DecisionRow | null;
    return row ? decodeDecision(row) : null;
  }
  private readLease(hash: string): ReturnType<typeof decodeLease> | null {
    const row = this.database
      .query(`SELECT * FROM ${LEASES} WHERE token_hash=?`)
      .get(hash) as LeaseRow | null;
    return row ? decodeLease(row) : null;
  }
  private readOutcome(
    id: string,
    attempt: number,
  ): ReturnType<typeof decodeOutcome> | null {
    const row = this.database
      .query(`SELECT * FROM ${OUTCOMES} WHERE outbox_id=? AND attempt=?`)
      .get(id, attempt) as OutcomeRow | null;
    return row ? decodeOutcome(row) : null;
  }
  private readResolution(
    id: string,
    attempt: number,
  ): ReturnType<typeof decodeResolution> | null {
    const row = this.database
      .query(`SELECT * FROM ${RESOLUTIONS} WHERE outbox_id=? AND attempt=?`)
      .get(id, attempt) as ResolutionRow | null;
    return row ? decodeResolution(row) : null;
  }
  private readClaimReplay(
    request: ClaimOutboxRequest,
    requestHash: string,
    tokenHash: string,
  ): ResultValue<OutboxClaimDecision, OutboxStoreError> | null {
    const lease = this.readLease(tokenHash);
    const decision = this.readDecision(`claim:${tokenHash}`);
    if (!decision) {
      if (!lease) return null;
      return lease.method === "claimNext" && lease.requestHash === requestHash
        ? Result.ok(
            freeze({
              decision: "replayed" as const,
              lease: leaseFromAuthority(
                this.requireRecord(lease.outboxId),
                lease,
                request.leaseToken,
              ),
            }),
          )
        : Result.err(errorOf("idempotency_conflict"));
    }
    if (decision.method !== "claimNext" || decision.requestHash !== requestHash)
      return Result.err(errorOf("idempotency_conflict"));
    if (decision.outcome === "empty")
      return Result.ok(freeze({ decision: "replayed" as const, lease: null }));
    if (
      !lease ||
      lease.requestHash !== requestHash ||
      lease.method !== "claimNext"
    )
      return Result.err(errorOf("corrupt_state"));
    const identity = this.requireRecord(lease.outboxId);
    return Result.ok(
      freeze({
        decision: "replayed" as const,
        lease: leaseFromAuthority(identity, lease, request.leaseToken),
      }),
    );
  }
  private readRecordReplay(
    method: "reclaim" | "resolveUnknown",
    key: string,
    requestHash: string,
    request: ReclaimOutboxRequest | ResolveUnknownOutboxRequest,
  ): ResultValue<OutboxMutationDecision, OutboxStoreError> | null {
    const decision = this.readDecision(key);
    if (!decision) return null;
    if (decision.method !== method || decision.requestHash !== requestHash)
      return Result.err(errorOf("idempotency_conflict"));
    if (decision.outcome === "stale") return Result.ok(stale());
    if (method === "reclaim") {
      const tokenHash = hashToken((request as ReclaimOutboxRequest).leaseToken);
      const lease = this.readLease(tokenHash);
      if (!lease) return Result.err(errorOf("corrupt_state"));
      return Result.ok(
        freeze({
          decision: "replayed" as const,
          record: recordFromLease(
            this.requireRecord(lease.outboxId),
            lease,
            (request as ReclaimOutboxRequest).leaseToken,
          ),
        }),
      );
    }
    const resolution = this.readResolution(
      request.outboxId,
      request.expectedAttempt,
    );
    if (!resolution || resolution.requestHash !== requestHash)
      return Result.err(errorOf("corrupt_state"));
    return Result.ok(
      freeze({
        decision: "replayed" as const,
        record: recordFromResolution(
          this.requireRecord(request.outboxId),
          resolution,
        ),
      }),
    );
  }
  private readCleanupReplay(
    key: string,
    requestHash: string,
  ): ResultValue<OutboxCleanupDecision, OutboxStoreError> | null {
    const decision = this.readDecision(key);
    if (!decision) return null;
    if (
      decision.method !== "cleanupTerminal" ||
      decision.requestHash !== requestHash
    )
      return Result.err(errorOf("idempotency_conflict"));
    const result = parseCleanup(decision.resultJson);
    return result
      ? Result.ok(freeze({ decision: "replayed" as const, result }))
      : Result.err(errorOf("corrupt_state"));
  }
  private writeLease(
    tokenHash: string,
    requestHash: string,
    method: "claimNext" | "reclaim",
    outboxId: string,
    attempt: number,
    workerId: string,
    claimedAt: string,
    expiresAt: string,
    reconciliationRef: string | null,
  ): void {
    this.database
      .query(
        `INSERT INTO ${LEASES}(token_hash,request_hash,method,outbox_id,attempt,worker_id,claimed_at,lease_expires_at,reconciliation_ref) VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        tokenHash,
        requestHash,
        method,
        outboxId,
        attempt,
        workerId,
        claimedAt,
        expiresAt,
        reconciliationRef,
      );
  }
  private writeDecision(input: {
    key: string;
    method: OutboxMutationMethod;
    requestHash: string;
    outcome: "applied" | "stale" | "empty";
    outboxId: string | null;
    attempt: number | null;
    tokenHash: string | null;
    resultJson: string | null;
  }): void {
    this.database
      .query(
        `INSERT INTO ${DECISIONS}(decision_key,method,request_hash,outcome,outbox_id,attempt,lease_token_hash,result_json) VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.key,
        input.method,
        input.requestHash,
        input.outcome,
        input.outboxId,
        input.attempt,
        input.tokenHash,
        input.resultJson,
      );
  }
}

function insertEnqueue(
  database: Database,
  request: EnqueueOutboxRequest,
  observer?: ServiceOutboxEnqueueInsertObserver,
): ResultValue<OutboxEnqueueDecision, OutboxStoreError> {
  const key = `enqueue:${request.kind}:${request.effect.idempotencyKey}`;
  const knownRow = database
    .query(`SELECT * FROM ${DECISIONS} WHERE decision_key=?`)
    .get(key) as DecisionRow | null;
  if (knownRow) {
    const known = decodeDecision(knownRow);
    if (
      known.method !== "enqueue" ||
      known.requestHash !== request.effect.requestHash
    )
      return Result.err(errorOf("idempotency_conflict"));
    const record = readRecordFrom(database, known.outboxId);
    return record
      ? Result.ok(
          freeze({
            decision: "replayed" as const,
            record: recordFromEnqueue(record),
          }),
        )
      : Result.err(errorOf("corrupt_state"));
  }
  if (
    database
      .query(`SELECT 1 FROM ${OUTBOX} WHERE outbox_id=?`)
      .get(request.outboxId)
  )
    return Result.err(errorOf("idempotency_conflict"));
  const inserted = database
    .query(
      `INSERT INTO ${OUTBOX}(outbox_id,kind,state,idempotency_key,request_hash,operation_id,source_seq,provenance_ref,redaction_class,payload_ref,destination_ref,available_at,enqueued_at,state_changed_at,repeatability,attempt,worker_id,claimed_at,lease_token,lease_expires_at,certainty,retry_at,receipt_ref,last_error_tag,result_at,reconciliation_ref,reconciled_at,cancellation_reason_tag) VALUES (?,?, 'pending',?,?,?,?,?,?,?,?,?,?,?,?,0,NULL,NULL,NULL,NULL,'not_applied',NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
    )
    .run(
      request.outboxId,
      request.kind,
      request.effect.idempotencyKey,
      request.effect.requestHash,
      request.effect.operationId,
      request.effect.sourceSeq,
      request.effect.provenanceRef,
      request.effect.redactionClass,
      request.payloadRef,
      request.destinationRef,
      request.availableAt,
      request.enqueuedAt,
      request.enqueuedAt,
      request.repeatability,
    );
  if (!changedExactlyOne(inserted.changes)) throw new CorruptStateFault();
  observer?.afterStatement("outbox_insert");
  const decided = database
    .query(
      `INSERT INTO ${DECISIONS}(decision_key,method,request_hash,outcome,outbox_id,attempt,lease_token_hash,result_json) VALUES (?, 'enqueue', ?, 'applied', ?, 0, NULL, NULL)`,
    )
    .run(key, request.effect.requestHash, request.outboxId);
  if (!changedExactlyOne(decided.changes)) throw new CorruptStateFault();
  observer?.afterStatement("outbox_decision_insert");
  const record = readRecordFrom(database, request.outboxId);
  return record
    ? Result.ok(freeze({ decision: "applied" as const, record }))
    : Result.err(errorOf("corrupt_state"));
}

function changedExactlyOne(changes: number): boolean {
  return Number.isSafeInteger(changes) && changes === 1;
}

function verifyDatabase(database: Database): void {
  const fk = database.query("PRAGMA foreign_keys").get() as
    | { foreign_keys?: number }
    | undefined;
  if (fk?.foreign_keys !== 1) throw new Error("foreign keys");
  for (const table of [OUTBOX, LEASES, OUTCOMES, RESOLUTIONS, DECISIONS])
    database.query(`SELECT * FROM ${table} LIMIT 1`).get();
}
function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
function classifyDatabaseError(error: unknown): OutboxStoreError {
  if (error instanceof CorruptStateFault) return errorOf("corrupt_state");
  const code = readErrorCode(error);
  if (code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code === 5)
    return errorOf("storage_unavailable", "not_applied", true);
  if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT"))
    return errorOf("corrupt_state");
  return errorOf("storage_unavailable", "not_applied", true);
}
function readErrorCode(error: unknown): unknown {
  try {
    return error && typeof error === "object"
      ? Object.getOwnPropertyDescriptor(error, "code")?.value
      : null;
  } catch (caught) {
    void caught;
    return null;
  }
}
function errorOf(
  _tag: OutboxStoreErrorTag,
  certainty: EffectCertainty = "not_applied",
  retryable = false,
): OutboxStoreError {
  return freeze({ _tag, certainty, retryable });
}
function applied(record: OutboxRecord): OutboxMutationDecision {
  return freeze({ decision: "applied", record });
}
function stale(): OutboxMutationDecision {
  return freeze({ decision: "stale", record: null });
}
function leaseOf(record: OutboxRecord, token: string): OutboxLease {
  if (record.state !== "started" || !record.workerId)
    throw new CorruptStateFault();
  return freeze({
    record: freeze({ ...record, leaseToken: token }) as OutboxLease["record"],
    workerId: record.workerId,
  });
}
function leaseFromAuthority(
  identity: OutboxRecord,
  lease: ReturnType<typeof decodeLease>,
  token: string,
): OutboxLease {
  return leaseOf(recordFromLease(identity, lease, token), token);
}
function recordFromEnqueue(identity: OutboxRecord): OutboxRecord {
  return freeze({
    ...identity,
    state: "pending",
    stateChangedAt: identity.enqueuedAt,
    attempt: 0,
    workerId: null,
    claimedAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    certainty: "not_applied",
    retryAt: null,
    receiptRef: null,
    lastErrorTag: null,
    resultAt: null,
    reconciliationRef: null,
    reconciledAt: null,
    cancellationReasonTag: null,
  });
}
function recordFromLease(
  identity: OutboxRecord,
  lease: ReturnType<typeof decodeLease>,
  token: string,
): OutboxRecord {
  return freeze({
    ...identity,
    state: "started",
    stateChangedAt: lease.claimedAt,
    attempt: lease.attempt,
    workerId: lease.workerId,
    claimedAt: lease.claimedAt,
    leaseToken: token,
    leaseExpiresAt: lease.leaseExpiresAt,
    certainty: null,
    retryAt: null,
    receiptRef: null,
    lastErrorTag: null,
    resultAt: null,
    reconciliationRef: lease.reconciliationRef,
    reconciledAt: null,
    cancellationReasonTag: null,
  });
}
function recordFromOutcome(
  identity: OutboxRecord,
  outcome: ReturnType<typeof decodeOutcome>,
): OutboxRecord {
  return freeze({
    ...identity,
    state: outcome.state,
    stateChangedAt: outcome.resultAt,
    attempt: outcome.attempt,
    workerId: null,
    claimedAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    certainty: outcome.certainty,
    retryAt: outcome.retryAt,
    receiptRef: outcome.receiptRef,
    lastErrorTag: outcome.errorTag,
    resultAt: outcome.resultAt,
    reconciliationRef: outcome.reconciliationRef,
    reconciledAt: null,
    cancellationReasonTag: null,
  });
}
function recordFromResolution(
  identity: OutboxRecord,
  resolution: ReturnType<typeof decodeResolution>,
): OutboxRecord {
  return freeze({
    ...identity,
    state: resolution.state,
    stateChangedAt: resolution.reconciledAt,
    attempt: resolution.attempt,
    workerId: null,
    claimedAt: null,
    leaseToken: null,
    leaseExpiresAt: null,
    certainty: resolution.certainty,
    retryAt: resolution.retryAt,
    receiptRef: resolution.receiptRef,
    lastErrorTag: resolution.errorTag,
    resultAt: resolution.reconciledAt,
    reconciliationRef: resolution.reconciliationRef,
    reconciledAt: resolution.reconciledAt,
    cancellationReasonTag: resolution.cancellationReasonTag,
  });
}
function readRecordFrom(
  database: Database,
  id: string | null,
): OutboxRecord | null {
  if (!id) return null;
  const row = database
    .query(`SELECT * FROM ${OUTBOX} WHERE outbox_id=?`)
    .get(id) as Row | null;
  return row ? decodeRecord(row) : null;
}

function decodeRecord(row: Row): OutboxRecord {
  const value: OutboxRecord = {
    outboxId: text(row.outbox_id),
    kind: enumOf(row.kind, KINDS) as OutboxKind,
    state: enumOf(row.state, STATES) as OutboxState,
    idempotencyKey: text(row.idempotency_key),
    requestHash: hashOf(row.request_hash),
    operationId: nullableText(row.operation_id),
    sourceSeq: nullableInteger(row.source_seq, 0),
    provenanceRef: text(row.provenance_ref),
    redactionClass: enumOf(
      row.redaction_class,
      REDACTIONS,
    ) as OutboxRecord["redactionClass"],
    payloadRef: text(row.payload_ref),
    destinationRef: nullableText(row.destination_ref),
    availableAt: instant(row.available_at),
    enqueuedAt: instant(row.enqueued_at),
    stateChangedAt: instant(row.state_changed_at),
    repeatability: enumOf(
      row.repeatability,
      new Set(["repeatable", "reconciliation_required"]),
    ) as OutboxRecord["repeatability"],
    attempt: integer(row.attempt, 0),
    workerId: nullableText(row.worker_id),
    claimedAt: nullableInstant(row.claimed_at),
    leaseToken: nullableText(row.lease_token),
    leaseExpiresAt: nullableInstant(row.lease_expires_at),
    certainty:
      row.certainty === null
        ? null
        : (enumOf(row.certainty, CERTAINTIES) as OutboxRecord["certainty"]),
    retryAt: nullableInstant(row.retry_at),
    receiptRef: nullableText(row.receipt_ref),
    lastErrorTag: nullableTag(row.last_error_tag),
    resultAt: nullableInstant(row.result_at),
    reconciliationRef: nullableText(row.reconciliation_ref),
    reconciledAt: nullableInstant(row.reconciled_at),
    cancellationReasonTag: nullableTag(row.cancellation_reason_tag),
  };
  validateRecord(value);
  return freeze(value);
}
function validateRecord(v: OutboxRecord): void {
  if (v.availableAt < v.enqueuedAt) throw new CorruptStateFault();
  const started = v.state === "started";
  if (
    started !==
    (v.workerId !== null &&
      v.claimedAt !== null &&
      v.leaseToken !== null &&
      v.leaseExpiresAt !== null)
  )
    throw new CorruptStateFault();
  if (started && (!(v.claimedAt! < v.leaseExpiresAt!) || v.certainty !== null))
    throw new CorruptStateFault();
  const expected =
    v.state === "pending"
      ? "not_applied"
      : v.state === "completed"
        ? "applied"
        : v.state === "failed" || v.state === "cancelled"
          ? "not_applied"
          : v.state === "unknown"
            ? "unknown"
            : null;
  if (v.certainty !== expected) throw new CorruptStateFault();
  if (v.state === "pending" && v.attempt !== 0) throw new CorruptStateFault();
  if (v.state !== "pending" && v.attempt < 1) throw new CorruptStateFault();
  if (v.retryAt && (!v.resultAt || v.retryAt <= v.resultAt))
    throw new CorruptStateFault();
}
function decodeDecision(row: DecisionRow) {
  const method = enumOf(
    row.method,
    new Set([
      "enqueue",
      "claimNext",
      "reclaim",
      "complete",
      "fail",
      "markUnknown",
      "resolveUnknown",
      "cleanupTerminal",
    ]),
  ) as OutboxMutationMethod;
  const outcome = enumOf(
    row.outcome,
    new Set(["applied", "stale", "empty"]),
  ) as "applied" | "stale" | "empty";
  return freeze({
    key: text(row.decision_key),
    method,
    requestHash: hashOf(row.request_hash),
    outcome,
    outboxId: nullableText(row.outbox_id),
    attempt: nullableInteger(row.attempt, 0),
    tokenHash:
      row.lease_token_hash === null ? null : hashOf(row.lease_token_hash),
    resultJson: nullableText(row.result_json),
  });
}
function decodeLease(row: LeaseRow) {
  return freeze({
    tokenHash: hashOf(row.token_hash),
    requestHash: hashOf(row.request_hash),
    method: enumOf(row.method, new Set(["claimNext", "reclaim"])) as
      | "claimNext"
      | "reclaim",
    outboxId: text(row.outbox_id),
    attempt: integer(row.attempt, 1),
    workerId: text(row.worker_id),
    claimedAt: instant(row.claimed_at),
    leaseExpiresAt: instant(row.lease_expires_at),
    reconciliationRef: nullableText(row.reconciliation_ref),
  });
}
function decodeOutcome(row: OutcomeRow) {
  return freeze({
    outboxId: text(row.outbox_id),
    attempt: integer(row.attempt, 1),
    method: enumOf(row.method, new Set(["complete", "fail", "markUnknown"])) as
      | "complete"
      | "fail"
      | "markUnknown",
    requestHash: hashOf(row.request_hash),
    state: enumOf(row.state, new Set(["completed", "failed", "unknown"])) as
      | "completed"
      | "failed"
      | "unknown",
    certainty: enumOf(row.certainty, CERTAINTIES) as EffectCertainty,
    resultAt: instant(row.result_at),
    receiptRef: nullableText(row.receipt_ref),
    errorTag: nullableTag(row.error_tag),
    retryAt: nullableInstant(row.retry_at),
    reconciliationRef: nullableText(row.reconciliation_ref),
  });
}
function decodeResolution(row: ResolutionRow) {
  return freeze({
    outboxId: text(row.outbox_id),
    attempt: integer(row.attempt, 1),
    requestHash: hashOf(row.request_hash),
    state: enumOf(row.state, new Set(["completed", "failed", "cancelled"])) as
      | "completed"
      | "failed"
      | "cancelled",
    certainty: enumOf(row.certainty, new Set(["applied", "not_applied"])) as
      | "applied"
      | "not_applied",
    reconciledAt: instant(row.reconciled_at),
    reconciliationRef: text(row.reconciliation_ref),
    receiptRef: nullableText(row.receipt_ref),
    errorTag: nullableTag(row.error_tag),
    retryAt: nullableInstant(row.retry_at),
    cancellationReasonTag: nullableTag(row.cancellation_reason_tag),
  });
}
function parseCleanup(json: string | null) {
  try {
    if (!json || json.length > 65536) return null;
    const value = JSON.parse(json) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const v = value as Record<string, unknown>;
    if (
      !Array.isArray(v.deletedIds) ||
      !v.deletedIds.every((x) => typeof x === "string") ||
      v.deletedCount !== v.deletedIds.length
    )
      return null;
    const cursor =
      v.nextCursor === null
        ? null
        : v.nextCursor &&
            typeof v.nextCursor === "object" &&
            !Array.isArray(v.nextCursor)
          ? {
              stateChangedAt: instant((v.nextCursor as Row).stateChangedAt),
              outboxId: text((v.nextCursor as Row).outboxId),
            }
          : null;
    return freeze({
      deletedIds: Object.freeze([...v.deletedIds] as string[]),
      deletedCount: v.deletedIds.length,
      nextCursor: cursor,
    });
  } catch (error) {
    void error;
    return null;
  }
}
function validResolutionTime(r: ResolveUnknownOutboxRequest): boolean {
  return (
    r.resolution.kind !== "not_applied" ||
    r.resolution.retryAt === null ||
    r.resolution.retryAt > r.reconciledAt
  );
}
function text(v: unknown): string {
  if (typeof v !== "string" || v.length < 1) throw new CorruptStateFault();
  return v;
}
function nullableText(v: unknown): string | null {
  return v === null ? null : text(v);
}
function enumOf(v: unknown, set: ReadonlySet<string>): string {
  const x = text(v);
  if (!set.has(x)) throw new CorruptStateFault();
  return x;
}
function hashOf(v: unknown): string {
  const x = text(v);
  if (!HASH.test(x)) throw new CorruptStateFault();
  return x;
}
function integer(v: unknown, min: number): number {
  if (!Number.isSafeInteger(v) || (v as number) < min)
    throw new CorruptStateFault();
  return v as number;
}
function nullableInteger(v: unknown, min: number): number | null {
  return v === null ? null : integer(v, min);
}
function instant(v: unknown): string {
  const x = text(v),
    ms = Date.parse(x);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== x)
    throw new CorruptStateFault();
  return x;
}
function nullableInstant(v: unknown): string | null {
  return v === null ? null : instant(v);
}
function nullableTag(v: unknown): string | null {
  if (v === null) return null;
  const x = text(v);
  if (!TAG.test(x)) throw new CorruptStateFault();
  return x;
}
function freeze<T>(v: T): T {
  if (v && typeof v === "object") {
    for (const x of Object.values(v)) freeze(x);
    Object.freeze(v);
  }
  return v;
}
function decisionTag(v: unknown): string {
  try {
    return typeof (v as { decision?: unknown })?.decision === "string"
      ? (v as { decision: string }).decision
      : "ok";
  } catch (error) {
    void error;
    return "ok";
  }
}
function decisionCertainty(v: unknown): EffectCertainty | null {
  try {
    const x = v as { record?: OutboxRecord; lease?: OutboxLease };
    return (x.record ?? x.lease?.record)?.certainty ?? null;
  } catch (error) {
    void error;
    return null;
  }
}
