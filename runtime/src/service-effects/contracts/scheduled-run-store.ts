import type { Result } from "./result.js";

import type {
  EffectIdentity,
  PiclawEffectError,
  RedactionClass,
} from "./common.js";
import type { EnqueueOutboxRequest } from "./service-outbox-store.js";

export type ScheduledTaskKind = "agent" | "shell" | "internal";
export type ScheduledScheduleType = "cron" | "interval" | "once";
export type ScheduledTaskAuthorityState =
  | "active"
  | "paused"
  | "completed"
  | "deleted";
export type ScheduledExecutionRepeatability =
  | "agent_source"
  | "repeatable"
  | "reconciliation_required";

export interface ScheduledInternalTaskReference {
  readonly discriminator: string;
  readonly reference: string;
}

/** Immutable, body-free task configuration captured by one occurrence. */
export interface ScheduledTaskSnapshot {
  readonly taskId: string;
  readonly revision: number;
  readonly configHash: string;
  readonly chatJid: string;
  readonly kind: ScheduledTaskKind;
  readonly payloadRef: string;
  readonly modelLabel: string | null;
  readonly scheduleType: ScheduledScheduleType;
  readonly scheduleValue: string;
  readonly timezone: string;
  readonly notifyOnComplete: boolean;
  readonly muted: boolean;
  readonly cwd: string | null;
  readonly timeoutSec: number | null;
  readonly internalTask: ScheduledInternalTaskReference | null;
  readonly redactionClass: RedactionClass;
  readonly executionRepeatability: ScheduledExecutionRepeatability;
}

export type ScheduledRunState =
  | "claimed"
  | "source_bound"
  | "completed"
  | "abandoned";
export type ScheduledRunHeadDisposition =
  | "pending"
  | "advanced"
  | "paused"
  | "deleted"
  | "superseded";
export type ScheduledRunResultStatus = "success" | "error";

export interface ScheduledRunRecord {
  readonly runId: string;
  readonly taskId: string;
  readonly taskRevision: number;
  readonly scheduledFor: string;
  readonly state: ScheduledRunState;
  readonly attempt: number;
  readonly workerId: string | null;
  readonly leaseExpiresAt: string | null;
  readonly acceptedSourceSeq: number | null;
  readonly operationId: string | null;
  readonly status: ScheduledRunResultStatus | null;
  readonly durationMs: number | null;
  readonly resultRef: string | null;
  readonly errorCode: string | null;
  readonly nextRunAt: string | null;
  readonly headDisposition: ScheduledRunHeadDisposition;
  readonly settledAt: string | null;
  readonly abandonmentReasonTag: string | null;
  readonly outboxIds: readonly string[];
  readonly retained: boolean;
}

export interface ScheduledRunLease {
  readonly record: ScheduledRunRecord & {
    readonly state: "claimed" | "source_bound";
    readonly workerId: string;
    readonly leaseExpiresAt: string;
  };
  readonly task: ScheduledTaskSnapshot;
  /** Returned only from claim/renew and never persisted in plaintext. */
  readonly leaseToken: string;
}

export type ScheduledRunReclaimAuthority =
  | {
      readonly runId: string;
      readonly expectedAttempt: number;
      readonly kind: "repeatable";
      readonly reconciliationRef: null;
    }
  | {
      readonly runId: string;
      readonly expectedAttempt: number;
      readonly kind: "reconciled_absent";
      readonly reconciliationRef: string;
    }
  | {
      /** Stable scheduled-agent sourceId is this runId; evidence proves it absent. */
      readonly runId: string;
      readonly expectedAttempt: number;
      readonly kind: "agent_reconciled_absent";
      readonly reconciliationRef: string;
    };

export interface ClaimDueRunsRequest {
  readonly now: string;
  readonly limit: number;
  readonly workerId: string;
  readonly leaseTokenPrefix: string;
  readonly leaseDurationMs: number;
  readonly reclaimAuthorities: readonly ScheduledRunReclaimAuthority[];
}

interface ScheduledRunLeaseFence {
  readonly runId: string;
  readonly workerId: string;
  readonly expectedAttempt: number;
  readonly expectedTaskRevision: number;
  readonly leaseToken: string;
  readonly now: string;
}

export interface RenewScheduledRunRequest extends ScheduledRunLeaseFence {
  readonly leaseExpiresAt: string;
}

export interface BindScheduledSourceRequest extends ScheduledRunLeaseFence {
  readonly effect: EffectIdentity;
  readonly sourceSeq: number;
  readonly operationId: string;
  readonly boundAt: string;
}

export interface ScheduledRunResultPayload {
  readonly version: 1;
  readonly result: string | null;
  readonly error: string | null;
}

export interface CompleteScheduledRunRequest extends ScheduledRunLeaseFence {
  readonly effect: EffectIdentity;
  /** Optional host result bytes. Authority remains the fenced S07 completion. */
  readonly resultPayload?: ScheduledRunResultPayload;
  readonly status: ScheduledRunResultStatus;
  readonly durationMs: number;
  readonly resultRef: string | null;
  readonly errorCode: string | null;
  readonly completedAt: string;
  readonly outboxIntents: readonly EnqueueOutboxRequest[];
}

/** Reconcile only an expired, source-bound agent occurrence whose original
 * interrupted operation and source are already terminal. No lease is fabricated. */
export interface ReconcileInterruptedScheduledRunRequest {
  readonly effect: EffectIdentity;
  readonly runId: string;
  readonly expectedAttempt: number;
  readonly expectedTaskRevision: number;
  readonly expectedOperationVersion: number;
  readonly expectedLeaseExpiresAt: string;
  readonly now: string;
}

/** Native host capability; generic stores need not support historical repair. */
export interface InterruptedScheduledRunReconciler {
  reconcileInterruptedAgentSource(request: ReconcileInterruptedScheduledRunRequest): Promise<Result<ScheduledRunRecord, ScheduledRunStoreError>>;
}

export interface AbandonScheduledRunRequest extends ScheduledRunLeaseFence {
  readonly effect: EffectIdentity;
  readonly reasonTag: string;
  readonly abandonedAt: string;
  readonly retryAt: string | null;
}

export interface ListScheduledRunsRequest {
  readonly taskId?: string;
  readonly state?: ScheduledRunState;
  readonly limit?: number;
  readonly afterScheduledFor?: string;
  readonly afterRunId?: string;
}

export interface CleanupScheduledRunsRequest {
  readonly settledBefore: string;
  readonly limit: number;
}

export interface CleanupScheduledRunsResult {
  readonly removed: number;
  readonly runIds: readonly string[];
}

export type ScheduledRunStoreErrorTag =
  | "invalid_request"
  | "idempotency_conflict"
  | "task_not_found"
  | "task_inactive"
  | "task_revision_mismatch"
  | "lease_conflict"
  | "lease_expired"
  | "not_found"
  | "invalid_transition"
  | "corrupt_state"
  | "storage_unavailable";

export interface ScheduledRunStoreError
  extends PiclawEffectError<ScheduledRunStoreErrorTag> {
  readonly _tag: ScheduledRunStoreErrorTag;
  readonly observedAttempt?: number;
  readonly observedTaskRevision?: number;
}

export interface ScheduledRunStore {
  claimDue(
    request: ClaimDueRunsRequest,
  ): Promise<Result<readonly ScheduledRunLease[], ScheduledRunStoreError>>;
  renew(
    request: RenewScheduledRunRequest,
    context?: { signal?: AbortSignal; assertCurrent?: () => void },
  ): Promise<Result<ScheduledRunLease, ScheduledRunStoreError>>;
  bindAcceptedSource(
    request: BindScheduledSourceRequest,
  ): Promise<Result<ScheduledRunRecord, ScheduledRunStoreError>>;
  complete(
    request: CompleteScheduledRunRequest,
  ): Promise<Result<ScheduledRunRecord, ScheduledRunStoreError>>;
  abandon(
    request: AbandonScheduledRunRequest,
  ): Promise<Result<ScheduledRunRecord, ScheduledRunStoreError>>;
  get(
    runId: string,
  ): Promise<Result<ScheduledRunRecord | null, ScheduledRunStoreError>>;
  listRuns(
    request?: ListScheduledRunsRequest,
  ): Promise<Result<readonly ScheduledRunRecord[], ScheduledRunStoreError>>;
  cleanupTerminal(
    request: CleanupScheduledRunsRequest,
  ): Promise<Result<CleanupScheduledRunsResult, ScheduledRunStoreError>>;
}

export interface ScheduledTaskAuthorityInput {
  readonly taskId: string;
  readonly chatJid: string;
  readonly kind: ScheduledTaskKind;
  readonly payloadRef: string;
  readonly modelLabel: string | null;
  readonly scheduleType: ScheduledScheduleType;
  readonly scheduleValue: string;
  readonly timezone: string;
  readonly notifyOnComplete: boolean;
  readonly muted: boolean;
  readonly cwd: string | null;
  readonly timeoutSec: number | null;
  readonly internalTask: ScheduledInternalTaskReference | null;
  readonly redactionClass: RedactionClass;
  readonly executionRepeatability: ScheduledExecutionRepeatability;
  readonly nextRunAt: string;
  readonly authoredAt: string;
}

export interface UpdateScheduledTaskAuthorityRequest
  extends ScheduledTaskAuthorityInput {
  readonly expectedRevision: number;
}

/** Explicit setup seam for isolated tests; not part of ScheduledRunStore. */
export interface ScheduledTaskAuthority {
  create(input: ScheduledTaskAuthorityInput): ScheduledTaskSnapshot;
  update(input: UpdateScheduledTaskAuthorityRequest): ScheduledTaskSnapshot;
  pause(taskId: string): void;
  resume(taskId: string): void;
  delete(taskId: string): void;
  get(taskId: string): ScheduledTaskSnapshot | null;
}
