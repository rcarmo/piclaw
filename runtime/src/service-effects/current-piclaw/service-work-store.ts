import { admitSqliteWrite, isSqliteContention as isBusy } from '../../db/sqlite-async-admission.js';
import { getQueuedInputIntent } from "./queued-input-intent.js";
import { assertProcessAdmission } from "../../runtime/process-admission.js";
import {
  Result,
  type Result as ResultValue,
} from "../contracts/result.js";
import type Database from "bun:sqlite";
import { computeClosedSourceFrontier } from "./source-frontier.js";
import { normaliseWithdrawalRequest, normaliseQueuedSourceAttachment, type AttachQueuedSourceRequest, type WithdrawUnclaimedSourceRequest, type FinishHarnessRequest } from "./service-work-request-normalizer.js";
export type { AttachQueuedSourceRequest, WithdrawUnclaimedSourceRequest, FinishHarnessRequest } from "./service-work-request-normalizer.js";

import { hashCanonicalRequest, type CanonicalJsonValue, type NormalisedTraceInput } from "../contracts/common.js";
import type {
  AcceptCancellationRequest,
  AcceptedSourceSnapshot,
  AcceptSourceRequest,
  AppendOperationIntentRequest,
  BindHarnessRequest,
  ChatFrontierSnapshot,
  ClaimedOperation,
  ClaimNextSourceRequest,
  HarnessCorrelation,
  ListOpenOperationsRequest,
  OperationSnapshot,
  QueuedInputState,
  RecordQueuedInputRequest,
  ServiceWorkError,
  ServiceWorkErrorTag,
  ServiceWorkStore,
} from "../contracts/service-work-store.js";
import {
  normaliseListRequest,
  normaliseMutationRequest,
  normaliseReadIdentifier,
  semanticIntentHash,
  semanticSourceHash,
  type MutationMethod,
  type NormalisedMutationRequest,
} from "./service-work-request-normalizer.js";

export interface ServiceWorkAdapterRuntime {
  hitFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
    method: MutationMethod,
  ): unknown;
  recordTrace(input: NormalisedTraceInput): void;
}

/** Optional host writer fence for all new mutations. Committed replays remain observational. */
export interface ServiceWorkAcceptanceRuntime extends ServiceWorkAdapterRuntime {
  /** Synchronous, fail-closed check inside each mutation SQL transaction, before/after apply. */
  validateAcceptance?: (method?: MutationMethod, operationId?: string | null) => boolean;
  /** Host-owned persisted queue order. Reorders only the leading queued-source batch;
   * normal/internal sources remain barriers. Source IDs and receipts never change. */
  pendingQueuedSourceOrder?: (chatJid: string) => readonly string[];
}

/** Precommit failure: the transaction owner MUST let this escape and roll back. */
export class EffectAdmissionError extends Error {
  constructor(readonly tag: ServiceWorkErrorTag) {
    super(`EF-S01 admission failed: ${tag}`);
    this.name = "EffectAdmissionError";
  }
}

class AcceptanceOwnershipError extends Error {}

function mutationError(cause: unknown): ServiceWorkError {
  return cause instanceof AcceptanceOwnershipError
    ? serviceError("owner_conflict")
    : cause instanceof CorruptStateError
      ? serviceError("corrupt_state")
      : isBusy(cause)
        ? serviceError("storage_unavailable", "not_applied", true)
        : serviceError("corrupt_state");
}

type MutationRequest = NormalisedMutationRequest;
type MutationOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly duplicate: boolean }
  | { readonly ok: false; readonly error: ServiceWorkError };

type StoredDecision =
  | {
      readonly kind: "source";
      readonly chatJid: string;
      readonly sourceSeq: number;
      readonly state: AcceptedSourceSnapshot["state"];
    }
  | { readonly kind: "operation"; readonly operation: OperationSnapshot }
  | {
      readonly kind: "claim";
      readonly chatJid: string;
      readonly sourceSeq: number;
      readonly sourceState: "claimed";
      readonly operation: OperationSnapshot;
    }
  | { readonly kind: "empty" };

interface SourceRow {
  chat_jid: string;
  source_seq: number;
  source_id: string;
  source_hash: string;
  kind: AcceptedSourceSnapshot["kind"];
  state: AcceptedSourceSnapshot["state"];
  payload_ref: string;
  target_operation_id: string | null;
  parent_source_seq: number | null;
  accepted_at: string;
  disposition_reason: string | null;
  provenance_ref: string;
}

interface OperationRow {
  operation_id: string;
  chat_jid: string;
  version: number;
  phase: OperationSnapshot["phase"];
  primary_source_seq: number;
  cancellation_source_id: string | null;
  cancellation_source_seq: number | null;
  cancellation_cause: string | null;
  cancellation_requested_at: string | null;
  harness_session_id: string | null;
  harness_operation_id: string | null;
  terminal_disposition: string | null;
  terminal_message_row_id: number | null;
  terminal_error_code: string | null;
  terminal_committed_at: string | null;
}

export type ServiceWorkStoreConstructionResult = ResultValue<
  CurrentPiclawServiceWorkStore,
  ServiceWorkError
>;

/**
 * Construct only after explicit successful `installServiceWorkSchema` setup.
 * This bounded helper prevents SQLite/setup exception text crossing the effector boundary.
 */
export function createCurrentPiclawServiceWorkStore(
  database: Database,
  runtime: ServiceWorkAcceptanceRuntime,
): ServiceWorkStoreConstructionResult {
  return CurrentPiclawServiceWorkStore.create(database, runtime);
}

export class CurrentPiclawServiceWorkStore implements ServiceWorkStore {
  static create(
    database: Database,
    runtime: ServiceWorkAcceptanceRuntime,
  ): ServiceWorkStoreConstructionResult {
    try {
      return Result.ok(new CurrentPiclawServiceWorkStore(database, runtime));
    } catch (caught) {
      void caught;
      return Result.err(
        serviceError("storage_unavailable", "not_applied", true),
      );
    }
  }

  private constructor(
    readonly database: Database,
    private readonly runtime: ServiceWorkAcceptanceRuntime,
  ) {
    const foreignKeys = database.query("PRAGMA foreign_keys").get() as
      { foreign_keys?: number } | undefined;
    if (foreignKeys?.foreign_keys !== 1) {
      throw new Error("EF-S01 requires SQLite foreign-key enforcement.");
    }
  }

  acceptSource(
    input: AcceptSourceRequest,
  ): Promise<ResultValue<AcceptedSourceSnapshot, ServiceWorkError>> {
    return this.mutate("acceptSource", input, (request) =>
      this.applyAcceptSource(request as AcceptSourceRequest),
    );
  }

  /**
   * Host-only synchronous precommit receipt, NOT a public applied EffectResult.
   * Caller owns commit/rollback and acknowledgement. Pass its actual owned
   * connection; another connection's transaction is never sufficient. Failures
   * MUST escape the outer transaction. No lost-ack hook runs before commit.
   */
  acceptSourceInTransaction(
    input: AcceptSourceRequest,
    transactionDatabase: Database,
  ): AcceptedSourceSnapshot {
    if (transactionDatabase !== this.database || !this.database.inTransaction)
      throw new EffectAdmissionError("owner_conflict");
    const request = this.prepareMutation("acceptSource", input);
    if (!request) throw new EffectAdmissionError("invalid_transition");
    try {
      const fault = this.fault("acceptSource", "before_effect");
      if (!fault.ok || fault.injected)
        throw new EffectAdmissionError("storage_unavailable");
      const outcome = this.applyMutationWithinTransaction("acceptSource", request,
        value => this.applyAcceptSource(value as AcceptSourceRequest));
      if (!outcome.ok) throw new EffectAdmissionError(outcome.error._tag);
      return outcome.value;
    } catch (cause) {
      if (cause instanceof EffectAdmissionError) throw cause;
      throw new EffectAdmissionError(cause instanceof RollbackFault
        ? "storage_unavailable" : mutationError(cause)._tag);
    }
  }

  /** Host-only exact-source admission/claim in one caller-owned transaction.
   * Receipt is precommit; failures MUST escape and roll back the outer transaction.
   * Both ordinary decision receipts retain replay/source/operation identity.
   */
  acceptAndClaimSourceInTransaction(accept: AcceptSourceRequest, claim: ClaimNextSourceRequest, transactionDatabase: Database): ClaimedOperation {
    if (transactionDatabase !== this.database || !this.database.inTransaction) throw new EffectAdmissionError("owner_conflict");
    const prepared = this.prepareMutation("claimNext", claim) as ClaimNextSourceRequest | null;
    if (!prepared || claim.chatJid !== accept.chatJid || accept.targetOperationId !== null || accept.parentSourceSeq !== null)
      throw new EffectAdmissionError("invalid_transition");
    const source = this.acceptSourceInTransaction(accept, transactionDatabase);
    try {
      const fault = this.fault("claimNext", "before_effect");
      if (!fault.ok || fault.injected) throw new EffectAdmissionError("storage_unavailable");
      const outcome = this.applyMutationWithinTransaction("claimNext", prepared, request => this.applyClaimNext(request as ClaimNextSourceRequest));
      if (!outcome.ok) throw new EffectAdmissionError(outcome.error._tag);
      const claimed = outcome.value as ClaimedOperation | null;
      if (!claimed || claimed.source.chatJid !== source.chatJid || claimed.source.sourceSeq !== source.sourceSeq ||
        claimed.source.sourceId !== source.sourceId || claimed.operation.primarySourceSeq !== source.sourceSeq)
        throw new EffectAdmissionError("owner_conflict");
      return claimed;
    } catch (cause) {
      if (cause instanceof EffectAdmissionError) throw cause;
      throw new EffectAdmissionError(cause instanceof RollbackFault ? "storage_unavailable" : mutationError(cause)._tag);
    }
  }

  /** Accept and attach a targeted cancellation so normal terminal settlement
   * retires it with the operation. Caller owns the transaction and rollback. */
  acceptAndCancelSourceInTransaction(input: AcceptSourceRequest, expectedVersion: number, cause: string, transactionDatabase: Database): OperationSnapshot {
    if (transactionDatabase !== this.database || !this.database.inTransaction) throw new EffectAdmissionError("owner_conflict");
    if (input.kind !== "cancellation" || !input.targetOperationId || input.parentSourceSeq === null) throw new EffectAdmissionError("invalid_transition");
    const source = this.acceptSourceInTransaction(input, transactionDatabase);
    const operation = this.operationRow(input.targetOperationId);
    if (!operation || source.targetOperationId !== operation.operation_id || operation.chat_jid !== source.chatJid ||
      !this.database.query("SELECT 1 FROM service_effect_s01_operation_sources WHERE operation_id=? AND chat_jid=? AND source_seq=?")
        .get(operation.operation_id, source.chatJid, input.parentSourceSeq)) throw new EffectAdmissionError("owner_conflict");
    const request: AcceptCancellationRequest = { effect: { ...input.effect, idempotencyKey: `cancel:${input.effect.idempotencyKey}`,
      requestHash: "", operationId: operation.operation_id, sourceSeq: source.sourceSeq },
      expectedVersion, sourceId: source.sourceId, sourceSeq: source.sourceSeq, cause, requestedAt: input.acceptedAt };
    const sealedRequest = { ...request, effect: { ...request.effect, requestHash: hashCanonicalRequest(request as unknown as CanonicalJsonValue) } };
    const prepared = this.prepareMutation("acceptCancellation", sealedRequest);
    if (!prepared) throw new EffectAdmissionError("invalid_transition");
    try {
      const fault = this.fault("acceptCancellation", "before_effect");
      if (!fault.ok || fault.injected) throw new EffectAdmissionError("storage_unavailable");
      this.validateAcceptance();
      const currentSource = this.sourceRow(source.chatJid, source.sourceSeq);
      if (currentSource?.state === "pending") {
        this.database.query("UPDATE service_effect_s01_sources SET state='claimed' WHERE chat_jid=? AND source_seq=? AND state='pending'")
          .run(source.chatJid, source.sourceSeq);
        this.database.query("INSERT INTO service_effect_s01_operation_sources(operation_id,chat_jid,source_seq) VALUES (?,?,?)")
          .run(operation.operation_id, source.chatJid, source.sourceSeq);
      } else if (!this.database.query("SELECT 1 FROM service_effect_s01_operation_sources WHERE operation_id=? AND chat_jid=? AND source_seq=?")
        .get(operation.operation_id, source.chatJid, source.sourceSeq)) throw new EffectAdmissionError("owner_conflict");
      const outcome = this.applyMutationWithinTransaction("acceptCancellation", prepared, value => this.applyCancellation(value as AcceptCancellationRequest));
      if (!outcome.ok) throw new EffectAdmissionError(outcome.error._tag);
      this.validateAcceptance();
      return outcome.value as OperationSnapshot;
    } catch (error) {
      if (error instanceof EffectAdmissionError) throw error;
      throw new EffectAdmissionError(error instanceof RollbackFault ? "storage_unavailable" : mutationError(error)._tag);
    }
  }

  /** Host-only precommit receipt. The caller MUST roll back on any failure. */
  withdrawUnclaimedSourceInTransaction(input: WithdrawUnclaimedSourceRequest, transactionDatabase: Database): AcceptedSourceSnapshot {
    if (transactionDatabase !== this.database || !this.database.inTransaction) throw new EffectAdmissionError("owner_conflict");
    const request = normaliseWithdrawalRequest(input);
    if (!request) throw new EffectAdmissionError("invalid_transition");
    try {
      // Unlike historical admission, withdrawal requires an explicit writer fence.
      if (!this.runtime.validateAcceptance) throw new AcceptanceOwnershipError();
      this.validateAcceptance();
      const method = "withdrawUnclaimedSource.v1";
      const replay = this.readDecision<AcceptedSourceSnapshot>(method, request.effect.idempotencyKey, request.effect.requestHash);
      if (replay) {
        if (!replay.ok) throw new EffectAdmissionError(replay.error._tag);
        this.validateAcceptance();
        return replay.value;
      }
      const raw = this.database.query("SELECT * FROM service_effect_s01_sources WHERE chat_jid=? AND source_id=?")
        .get(request.chatJid, request.sourceId) as Record<string, unknown> | null;
      if (!raw) throw new EffectAdmissionError("invalid_transition");
      const source = sourceRow(raw);
      if (source.kind !== "message" || source.source_hash !== request.sourceHash || source.payload_ref !== request.payloadRef
        || request.payloadRef !== `queued-source:${request.sourceId}` || source.state !== "pending"
        || source.target_operation_id !== null || source.disposition_reason !== null) throw new EffectAdmissionError("invalid_transition");
      const owned = this.database.query(`SELECT 1 FROM service_effect_s01_operation_sources WHERE chat_jid=? AND source_seq=?
        UNION ALL SELECT 1 FROM service_effect_s01_operations WHERE chat_jid=? AND (primary_source_seq=? OR cancellation_source_seq=?)
        UNION ALL SELECT 1 FROM service_effect_s01_queued_inputs WHERE chat_jid=? AND source_seq=? LIMIT 1`)
        .get(request.chatJid, source.source_seq, request.chatJid, source.source_seq, source.source_seq, request.chatJid, source.source_seq);
      if (owned) throw new EffectAdmissionError("owner_conflict");
      const changed = this.database.query("UPDATE service_effect_s01_sources SET state='disposed', disposition_reason='host_cancelled' WHERE chat_jid=? AND source_seq=? AND state='pending'")
        .run(request.chatJid, source.source_seq);
      if (changed.changes !== 1) throw new EffectAdmissionError("invalid_transition");
      const chat = this.chatRow(request.chatJid);
      // An active operation owns its frontier until EF-S02 releases it.
      if (!chat.activeOperationId) {
        const frontier = computeClosedSourceFrontier(this.database, request.chatJid, chat.consumedThroughSourceSeq, chat.nextSourceSeq);
        this.database.query("UPDATE service_effect_s01_chats SET consumed_through_source_seq=? WHERE chat_jid=?")
          .run(frontier, request.chatJid);
      }
      const snapshot = sourceSnapshot(this.requireSourceRow(request.chatJid, source.source_seq));
      this.writeDecision(method, request.effect.idempotencyKey, request.effect.requestHash, snapshot);
      this.validateAcceptance();
      return snapshot;
    } catch (cause) {
      if (cause instanceof EffectAdmissionError) throw cause;
      throw new EffectAdmissionError(mutationError(cause)._tag);
    }
  }

  /**
   * Host-only precommit attachment of an EXISTING accepted queue source. The
   * caller owns the same SQL transaction for queue removal/user materialization
   * and MUST roll back on failure. This receipt is not candidate dispatch or ACK.
   * No runtime/UI caller is enabled until exact-target dispatch is supported.
   */
  attachQueuedSourceInTransaction(input: AttachQueuedSourceRequest, transactionDatabase: Database): OperationSnapshot {
    if (transactionDatabase !== this.database || !this.database.inTransaction) throw new EffectAdmissionError("owner_conflict");
    const request = normaliseQueuedSourceAttachment(input);
    if (!request) throw new EffectAdmissionError("invalid_transition");
    try {
      if (!this.runtime.validateAcceptance) throw new AcceptanceOwnershipError();
      this.validateAcceptance();
      const method = "attachQueuedSource.v1";
      const replay = this.readDecision<OperationSnapshot>(method, request.effect.idempotencyKey, request.effect.requestHash);
      if (replay) {
        if (!replay.ok) throw new EffectAdmissionError(replay.error._tag);
        this.validateAcceptance();
        return replay.value;
      }
      const operation = this.operationRow(request.effect.operationId);
      if (!operation || operation.chat_jid !== request.chatJid
        || this.chatRow(request.chatJid).activeOperationId !== operation.operation_id
        || operation.phase !== "executing" || operation.cancellation_source_seq !== null) throw new EffectAdmissionError("owner_conflict");
      if (operation.version !== request.expectedVersion) throw new EffectAdmissionError("version_mismatch");
      const harness = request.expectedHarness;
      if (operation.harness_session_id !== harness.sessionId || operation.harness_operation_id !== harness.harnessOperationId) throw new EffectAdmissionError("owner_conflict");
      const source = this.sourceRow(request.chatJid, request.effect.sourceSeq);
      if (!source || source.source_id !== request.sourceId || source.source_hash !== request.sourceHash
        || source.kind !== "message" || source.payload_ref !== request.payloadRef || request.payloadRef !== `queued-source:${request.sourceId}`
        || source.state !== "pending" || source.target_operation_id !== null || source.disposition_reason !== null) throw new EffectAdmissionError("invalid_transition");
      const owned = this.database.query(`SELECT 1 FROM service_effect_s01_operation_sources WHERE chat_jid=? AND source_seq=?
        UNION ALL SELECT 1 FROM service_effect_s01_operations WHERE chat_jid=? AND (primary_source_seq=? OR cancellation_source_seq=?)
        UNION ALL SELECT 1 FROM service_effect_s01_queued_inputs WHERE chat_jid=? AND source_seq=? LIMIT 1`)
        .get(request.chatJid, source.source_seq, request.chatJid, source.source_seq, source.source_seq, request.chatJid, source.source_seq);
      const intentId = `queued-steer:${request.sourceId}`;
      if (owned || this.database.query("SELECT 1 FROM service_effect_s01_intents WHERE operation_id=? AND intent_id=?")
        .get(operation.operation_id, intentId)) throw new EffectAdmissionError("owner_conflict");
      this.database.query(`UPDATE service_effect_s01_sources SET state='claimed', target_operation_id=?
        WHERE chat_jid=? AND source_seq=? AND source_id=? AND source_hash=? AND state='pending' AND target_operation_id IS NULL AND disposition_reason IS NULL`)
        .run(operation.operation_id, request.chatJid, source.source_seq, request.sourceId, request.sourceHash);
      // Bun's run().changes can include trigger writes on the full host schema.
      // SQLite changes() is the direct CAS row count, excluding those triggers.
      if ((this.database.query('SELECT changes() AS n').get() as { n: number }).n !== 1)
        throw new EffectAdmissionError("invalid_transition");
      this.database.query("INSERT INTO service_effect_s01_operation_sources(chat_jid, operation_id, source_seq) VALUES (?, ?, ?)")
        .run(request.chatJid, operation.operation_id, source.source_seq);
      // Reuse S01 intent application/version CAS, without accepting another source.
      const outcome = this.applyAppendIntent({ effect: request.effect, expectedVersion: request.expectedVersion,
        intentId, kind: "queue_input", payloadRef: request.payloadRef, createdAt: request.createdAt });
      if (!outcome.ok) throw new EffectAdmissionError(outcome.error._tag);
      this.writeDecision(method, request.effect.idempotencyKey, request.effect.requestHash, outcome.value);
      this.validateAcceptance();
      return outcome.value;
    } catch (cause) {
      if (cause instanceof EffectAdmissionError) throw cause;
      throw new EffectAdmissionError(mutationError(cause)._tag);
    }
  }

  claimNext(
    input: ClaimNextSourceRequest,
  ): Promise<ResultValue<ClaimedOperation | null, ServiceWorkError>> {
    return this.mutate("claimNext", input, (request) =>
      this.applyClaimNext(request as ClaimNextSourceRequest),
    );
  }

  appendIntent(
    input: AppendOperationIntentRequest,
  ): Promise<ResultValue<OperationSnapshot, ServiceWorkError>> {
    return this.mutate("appendIntent", input, (request) =>
      this.applyAppendIntent(request as AppendOperationIntentRequest),
    );
  }

  acceptCancellation(
    input: AcceptCancellationRequest,
  ): Promise<ResultValue<OperationSnapshot, ServiceWorkError>> {
    return this.mutate("acceptCancellation", input, (request) =>
      this.applyCancellation(request as AcceptCancellationRequest),
    );
  }

  bindHarness(
    input: BindHarnessRequest,
  ): Promise<ResultValue<OperationSnapshot, ServiceWorkError>> {
    return this.mutate("bindHarness", input, (request) =>
      this.applyHarnessBinding(request as BindHarnessRequest),
    );
  }

  /**
   * Host-only synchronous precommit receipt, NOT execution authority or an applied
   * EffectResult. Caller owns commit/rollback and acknowledgement on this exact
   * connection. Failures MUST escape the outer transaction. No lost-ack hook runs
   * before commit; replay, validation and CAS use the ordinary mutation path.
   */
  bindHarnessInTransaction(
    input: BindHarnessRequest,
    transactionDatabase: Database,
  ): OperationSnapshot {
    if (transactionDatabase !== this.database || !this.database.inTransaction)
      throw new EffectAdmissionError("owner_conflict");
    const request = this.prepareMutation("bindHarness", input);
    if (!request) throw new EffectAdmissionError("invalid_transition");
    try {
      const fault = this.fault("bindHarness", "before_effect");
      if (!fault.ok || fault.injected)
        throw new EffectAdmissionError("storage_unavailable");
      const outcome = this.applyMutationWithinTransaction("bindHarness", request,
        value => this.applyHarnessBinding(value as BindHarnessRequest));
      if (!outcome.ok) throw new EffectAdmissionError(outcome.error._tag);
      return outcome.value;
    } catch (cause) {
      if (cause instanceof EffectAdmissionError) throw cause;
      throw new EffectAdmissionError(cause instanceof RollbackFault
        ? "storage_unavailable" : mutationError(cause)._tag);
    }
  }

  /** Host-only settlement CAS, not candidate execution authority. The current owner must
   * first verify committed outcomes for EVERY claimed input; this store cannot read
   * candidate storage. Version + immutable execution binding fence late completions.
   * Cancellation may finish only once the candidate has actually stopped. */
  finishHarness(input: FinishHarnessRequest): Promise<ResultValue<OperationSnapshot, ServiceWorkError>> {
    return this.mutate("finishHarness", input, request => this.applyHarnessFinish(request as FinishHarnessRequest));
  }

  recordQueuedInput(
    input: RecordQueuedInputRequest,
  ): Promise<ResultValue<OperationSnapshot, ServiceWorkError>> {
    return this.mutate("recordQueuedInput", input, (request) =>
      this.applyQueuedInput(request as RecordQueuedInputRequest),
    );
  }

  getOperation(
    operationId: string,
  ): Promise<ResultValue<OperationSnapshot | null, ServiceWorkError>> {
    const id = normaliseReadIdentifier(operationId);
    return this.read("getOperation", id, () =>
      id === null ? invalidRead() : this.operationSnapshot(id),
    );
  }

  /** Concrete host lookup; does not admit work or create wake intents. */
  getAcceptedSource(chatJid: string, sourceId: string): AcceptedSourceSnapshot | null {
    const row = this.database.query(
      "SELECT * FROM service_effect_s01_sources WHERE chat_jid = ? AND source_id = ?",
    ).get(chatJid, sourceId);
    return row ? sourceSnapshot(sourceRow(row as Record<string, unknown>)) : null;
  }

  /** Concrete recovery lookup by the operation's persisted claimed-source sequence. */
  getSourceBySeq(chatJid: string, sourceSeq: number): AcceptedSourceSnapshot | null {
    const row = this.database.query(
      "SELECT * FROM service_effect_s01_sources WHERE chat_jid = ? AND source_seq = ?",
    ).get(chatJid, sourceSeq);
    return row ? sourceSnapshot(sourceRow(row as Record<string, unknown>)) : null;
  }

  /** Read-only host recovery proof, scoped to the exact operation/source membership. */
  getQueuedInputIntent(operationId: string, source: AcceptedSourceSnapshot): Readonly<{
    operationId: string; sourceSeq: number; sourceId: string; intentId: string;
    kind: "queue_input"; payloadRef: string; createdAt: string; intentHash: string; sourceHash: string;
  }> | null {
    return getQueuedInputIntent(this.database, operationId, source);
  }

  getChatFrontier(
    chatJid: string,
  ): Promise<ResultValue<ChatFrontierSnapshot, ServiceWorkError>> {
    const id = normaliseReadIdentifier(chatJid);
    return this.read("getChatFrontier", id, () => {
      if (id === null) return invalidRead();
      this.ensureChat(id);
      const chat = this.chatRow(id);
      const nextPendingSourceSeq = this.nextPendingSource(id)?.source_seq ?? null;
      return Object.freeze({
        chatJid: id,
        consumedThroughSourceSeq: chat.consumedThroughSourceSeq,
        activeOperationId: chat.activeOperationId,
        nextPendingSourceSeq,
      });
    });
  }

  listOpenOperations(
    input: ListOpenOperationsRequest = {},
  ): Promise<ResultValue<readonly OperationSnapshot[], ServiceWorkError>> {
    const request = normaliseListRequest(input);
    return this.read("listOpenOperations", "list", () => {
      if (request === null) return invalidRead();
      const rows = this.database
        .query(
          `
        SELECT operation_id
        FROM service_effect_s01_operations
        WHERE phase <> 'terminal'
          AND (? IS NULL OR chat_jid = ?)
          AND operation_id > ?
        ORDER BY operation_id
        LIMIT ?
      `,
        )
        .all(
          request.chatJid ?? null,
          request.chatJid ?? null,
          request.afterOperationId ?? "",
          request.limit ?? 100,
        ) as Array<{ operation_id?: unknown }>;
      return Object.freeze(
        rows.map((row) => {
          const id = requiredText(row.operation_id);
          const operation = this.operationSnapshot(id);
          if (!operation) throw new CorruptStateError();
          return operation;
        }),
      );
    });
  }

  private applyAcceptSource(
    request: AcceptSourceRequest,
  ): MutationOutcome<AcceptedSourceSnapshot> {
    // Cancellation is an explicit reconciliation control, not new executable work.
    if (request.kind !== "cancellation") assertProcessAdmission();
    this.ensureChat(request.chatJid);
    const known = this.database
      .query(
        `
      SELECT * FROM service_effect_s01_sources WHERE chat_jid = ? AND source_id = ?
    `,
      )
      .get(request.chatJid, request.sourceId) as
      Record<string, unknown> | undefined;
    if (known) {
      const row = sourceRow(known);
      return row.source_hash === semanticSourceHash(request)
        ? this.applied(sourceSnapshot(row), true)
        : this.rejected("idempotency_conflict");
    }
    if (
      request.parentSourceSeq !== null &&
      !this.sourceRow(request.chatJid, request.parentSourceSeq)
    ) {
      return this.rejected("not_found");
    }
    if (request.targetOperationId !== null) {
      const target = this.operationRow(request.targetOperationId);
      if (
        !target ||
        target.chat_jid !== request.chatJid ||
        target.phase === "terminal"
      ) {
        return this.rejected("owner_conflict", {
          conflictingOperationId: request.targetOperationId,
        });
      }
    }

    const chat = this.chatRow(request.chatJid);
    const sourceSeq = chat.nextSourceSeq;
    const allocation = this.database
      .query(
        `
      UPDATE service_effect_s01_chats
      SET next_source_seq = next_source_seq + 1
      WHERE chat_jid = ? AND next_source_seq = ?
    `,
      )
      .run(request.chatJid, sourceSeq);
    if (allocation.changes !== 1)
      return this.rejected("frontier_mismatch", {
        observedFrontier: chat.consumedThroughSourceSeq,
      });

    this.database
      .query(
        `
      INSERT INTO service_effect_s01_sources (
        chat_jid, source_seq, source_id, source_hash, kind, state, payload_ref,
        target_operation_id, parent_source_seq, accepted_at, disposition_reason,
        provenance_ref, create_wake_intent
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL, ?, ?)
    `,
      )
      .run(
        request.chatJid,
        sourceSeq,
        request.sourceId,
        semanticSourceHash(request),
        request.kind,
        request.payloadRef,
        request.targetOperationId,
        request.parentSourceSeq,
        request.acceptedAt,
        request.effect.provenanceRef,
        request.createWakeIntent ? 1 : 0,
      );
    if (request.createWakeIntent) {
      this.database
        .query(
          `
        INSERT INTO service_effect_s01_wake_intents(chat_jid, source_seq) VALUES (?, ?)
      `,
        )
        .run(request.chatJid, sourceSeq);
    }
    return this.applied(
      sourceSnapshot(this.requireSourceRow(request.chatJid, sourceSeq)),
      false,
    );
  }

  private nextPendingSource(chatJid: string): SourceRow | null {
    const rows = this.database.query("SELECT * FROM service_effect_s01_sources WHERE chat_jid=? AND state='pending' ORDER BY source_seq")
      .all(chatJid) as Record<string, unknown>[];
    const first = rows[0] ? sourceRow(rows[0]) : null;
    if (!first || !this.runtime.pendingQueuedSourceOrder) return first;
    const queued = new Map<string, SourceRow>();
    for (const row of rows) {
      const source = sourceRow(row);
      if (source.kind !== "message" || source.target_operation_id !== null || source.payload_ref !== `queued-source:${source.source_id}`) break;
      queued.set(source.source_id, source);
    }
    if (!queued.size) return first;
    const order = this.runtime.pendingQueuedSourceOrder(chatJid);
    for (const id of order) {
      const source = queued.get(id);
      if (source) return source;
    }
    return first;
  }

  private applyClaimNext(
    request: ClaimNextSourceRequest,
  ): MutationOutcome<ClaimedOperation | null> {
    this.ensureChat(request.chatJid);
    const chat = this.chatRow(request.chatJid);
    if (chat.consumedThroughSourceSeq !== request.expectedFrontier) {
      return this.rejected("frontier_mismatch", {
        observedFrontier: chat.consumedThroughSourceSeq,
      });
    }
    if (chat.activeOperationId) {
      return this.rejected("owner_conflict", {
        conflictingOperationId: chat.activeOperationId,
      });
    }
    const source = this.nextPendingSource(request.chatJid);
    if (!source) return this.applied(null, false);
    // The caller may have observed an older queue order before this transaction.
    // Reject rather than claim a different source under the requested operation ID.
    if (request.effect.sourceSeq !== null && request.effect.sourceSeq !== source.source_seq)
      return this.rejected("owner_conflict");
    if (this.operationRow(request.newOperationId)) {
      return this.rejected("owner_conflict", {
        conflictingOperationId: request.newOperationId,
      });
    }

    const claim = this.database
      .query(
        `
      UPDATE service_effect_s01_sources SET state = 'claimed'
      WHERE chat_jid = ? AND source_seq = ? AND state = 'pending'
    `,
      )
      .run(request.chatJid, source.source_seq);
    if (claim.changes !== 1) return this.rejected("owner_conflict");

    this.database
      .query(
        `
      INSERT INTO service_effect_s01_operations(operation_id, chat_jid, version, phase, primary_source_seq)
      VALUES (?, ?, 1, 'claimed', ?)
    `,
      )
      .run(request.newOperationId, request.chatJid, source.source_seq);
    this.database
      .query(
        `
      INSERT INTO service_effect_s01_operation_sources(chat_jid, operation_id, source_seq)
      VALUES (?, ?, ?)
    `,
      )
      .run(request.chatJid, request.newOperationId, source.source_seq);
    const owner = this.database
      .query(
        `
      UPDATE service_effect_s01_chats SET active_operation_id = ?
      WHERE chat_jid = ? AND active_operation_id IS NULL
    `,
      )
      .run(request.newOperationId, request.chatJid);
    if (owner.changes !== 1) return this.rejected("owner_conflict");

    const claimed = sourceSnapshot(
      this.requireSourceRow(request.chatJid, source.source_seq),
    );
    const operation = this.requireOperationSnapshot(request.newOperationId);
    return this.applied(Object.freeze({ source: claimed, operation }), false);
  }

  private applyAppendIntent(
    request: AppendOperationIntentRequest,
  ): MutationOutcome<OperationSnapshot> {
    const row = this.operationRow(request.effect.operationId);
    if (!row) return this.rejected("not_found");
    if (row.phase === "terminal")
      return this.rejected("owner_conflict", {
        conflictingOperationId: row.operation_id,
      });
    const known = this.database
      .query(
        `
      SELECT intent_hash FROM service_effect_s01_intents WHERE operation_id = ? AND intent_id = ?
    `,
      )
      .get(request.effect.operationId, request.intentId) as
      { intent_hash?: unknown } | undefined;
    if (known) {
      return requiredHash(known.intent_hash) === semanticIntentHash(request)
        ? this.applied(
            this.requireOperationSnapshot(request.effect.operationId),
            true,
          )
        : this.rejected("idempotency_conflict");
    }
    if (row.version !== request.expectedVersion)
      return this.rejected("version_mismatch", {
        observedVersion: row.version,
      });
    this.database
      .query(
        `
      INSERT INTO service_effect_s01_intents(operation_id, intent_id, intent_hash, kind, payload_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        request.effect.operationId,
        request.intentId,
        semanticIntentHash(request),
        request.kind,
        request.payloadRef,
        request.createdAt,
      );
    if (!this.bumpVersion(request.effect.operationId, request.expectedVersion))
      return this.rejected("version_mismatch");
    return this.applied(
      this.requireOperationSnapshot(request.effect.operationId),
      false,
    );
  }

  private applyCancellation(
    request: AcceptCancellationRequest,
  ): MutationOutcome<OperationSnapshot> {
    const row = this.operationRow(request.effect.operationId);
    if (!row) return this.rejected("not_found");
    if (row.phase === "terminal")
      return this.rejected("owner_conflict", {
        conflictingOperationId: row.operation_id,
      });
    if (row.cancellation_source_seq !== null) {
      const equal =
        row.cancellation_source_id === request.sourceId &&
        row.cancellation_source_seq === request.sourceSeq &&
        row.cancellation_cause === request.cause &&
        row.cancellation_requested_at === request.requestedAt;
      return equal
        ? this.applied(this.requireOperationSnapshot(row.operation_id), true)
        : this.rejected("owner_conflict", {
            conflictingOperationId: row.operation_id,
          });
    }
    if (row.version !== request.expectedVersion)
      return this.rejected("version_mismatch", {
        observedVersion: row.version,
      });
    const source = this.sourceRow(row.chat_jid, request.sourceSeq);
    if (
      !source ||
      source.source_id !== request.sourceId ||
      source.target_operation_id !== row.operation_id
    ) {
      return this.rejected("owner_conflict", {
        conflictingOperationId: row.operation_id,
      });
    }
    const update = this.database
      .query(
        `
      UPDATE service_effect_s01_operations
      SET cancellation_source_id = ?, cancellation_source_seq = ?, cancellation_cause = ?,
          cancellation_requested_at = ?, phase = 'cancelling', version = version + 1
      WHERE operation_id = ? AND version = ? AND phase <> 'terminal' AND cancellation_source_seq IS NULL
    `,
      )
      .run(
        request.sourceId,
        request.sourceSeq,
        request.cause,
        request.requestedAt,
        row.operation_id,
        request.expectedVersion,
      );
    if (update.changes !== 1)
      return this.rejected("version_mismatch", {
        observedVersion: this.requireOperationRow(row.operation_id).version,
      });
    return this.applied(this.requireOperationSnapshot(row.operation_id), false);
  }

  private applyHarnessBinding(
    request: BindHarnessRequest,
  ): MutationOutcome<OperationSnapshot> {
    const row = this.operationRow(request.effect.operationId);
    if (!row) return this.rejected("not_found");
    if (row.phase === "terminal")
      return this.rejected("owner_conflict", {
        conflictingOperationId: row.operation_id,
      });
    if (row.harness_session_id !== null) {
      const equal =
        row.harness_session_id === request.sessionId &&
        row.harness_operation_id === request.harnessOperationId;
      return equal
        ? this.applied(this.requireOperationSnapshot(row.operation_id), true)
        : this.rejected("owner_conflict", {
            conflictingOperationId: row.operation_id,
          });
    }
    if (row.version !== request.expectedVersion)
      return this.rejected("version_mismatch", {
        observedVersion: row.version,
      });
    const update = this.database
      .query(
        `
      UPDATE service_effect_s01_operations
      SET harness_session_id = ?, harness_operation_id = ?,
          phase = CASE WHEN cancellation_source_seq IS NULL THEN 'executing' ELSE 'cancelling' END, version = version + 1
      WHERE operation_id = ? AND version = ? AND phase <> 'terminal' AND harness_session_id IS NULL
    `,
      )
      .run(
        request.sessionId,
        request.harnessOperationId,
        row.operation_id,
        request.expectedVersion,
      );
    if (update.changes !== 1)
      return this.rejected("version_mismatch", {
        observedVersion: this.requireOperationRow(row.operation_id).version,
      });
    return this.applied(this.requireOperationSnapshot(row.operation_id), false);
  }

  private applyHarnessFinish(request: FinishHarnessRequest): MutationOutcome<OperationSnapshot> {
    const row = this.operationRow(request.effect.operationId);
    if (!row) return this.rejected("not_found");
    if (row.version !== request.expectedVersion)
      return this.rejected("version_mismatch", { observedVersion: row.version });
    const h = request.expectedHarness;
    if (this.chatRow(row.chat_jid).activeOperationId !== row.operation_id ||
      !["executing", "cancelling"].includes(row.phase) ||
      row.harness_session_id !== h.sessionId || row.harness_operation_id !== h.harnessOperationId)
      return this.rejected("owner_conflict", { conflictingOperationId: row.operation_id });
    const update = this.database.query(`UPDATE service_effect_s01_operations
      SET phase = 'settling', version = version + 1
      WHERE operation_id = ? AND version = ? AND phase IN ('executing', 'cancelling')`)
      .run(row.operation_id, request.expectedVersion);
    if (update.changes !== 1) return this.rejected("version_mismatch");
    return this.applied(this.requireOperationSnapshot(row.operation_id), false);
  }

  private applyQueuedInput(
    request: RecordQueuedInputRequest,
  ): MutationOutcome<OperationSnapshot> {
    const checked = this.requireMutableVersion(
      request.effect.operationId,
      request.expectedVersion,
    );
    if (!checked.ok) return checked;
    const operation = checked.row;
    const source = this.sourceRow(operation.chat_jid, request.sourceSeq);
    if (!source) return this.rejected("not_found");
    if (
      source.target_operation_id !== operation.operation_id &&
      source.source_seq !== operation.primary_source_seq
    ) {
      return this.rejected("owner_conflict", {
        conflictingOperationId:
          source.target_operation_id ?? operation.operation_id,
      });
    }

    const known = this.database
      .query(
        `
      SELECT queue_kind, harness_entry_id, state
      FROM service_effect_s01_queued_inputs
      WHERE operation_id = ? AND source_seq = ?
    `,
      )
      .get(operation.operation_id, request.sourceSeq) as
      | { queue_kind?: unknown; harness_entry_id?: unknown; state?: unknown }
      | undefined;

    if (!known) {
      if (
        request.state !== "accepted" ||
        request.harnessEntryId !== null ||
        source.state !== "pending"
      ) {
        return this.rejected("invalid_transition");
      }
      const existingMembership = this.database
        .query(
          `
        SELECT operation_id FROM service_effect_s01_operation_sources WHERE chat_jid = ? AND source_seq = ?
      `,
        )
        .get(operation.chat_jid, request.sourceSeq) as
        { operation_id?: unknown } | undefined;
      if (
        existingMembership &&
        requiredText(existingMembership.operation_id) !== operation.operation_id
      ) {
        return this.rejected("owner_conflict", {
          conflictingOperationId: requiredText(existingMembership.operation_id),
        });
      }
      if (!existingMembership) {
        const membership = this.database
          .query(
            `
          INSERT INTO service_effect_s01_operation_sources(chat_jid, operation_id, source_seq)
          VALUES (?, ?, ?)
        `,
          )
          .run(operation.chat_jid, operation.operation_id, request.sourceSeq);
        if (membership.changes !== 1) return this.rejected("owner_conflict");
      }
      const sourceUpdate = this.database
        .query(
          `
        UPDATE service_effect_s01_sources SET state = 'claimed'
        WHERE chat_jid = ? AND source_seq = ? AND state = 'pending'
      `,
        )
        .run(operation.chat_jid, request.sourceSeq);
      if (sourceUpdate.changes !== 1)
        return this.rejected("invalid_transition");
      this.database
        .query(
          `
        INSERT INTO service_effect_s01_queued_inputs(
          chat_jid, operation_id, source_seq, queue_kind, harness_entry_id, state
        ) VALUES (?, ?, ?, ?, NULL, 'accepted')
      `,
        )
        .run(
          operation.chat_jid,
          operation.operation_id,
          request.sourceSeq,
          request.queueKind,
        );
    } else {
      const priorState = queueState(known.state);
      const priorKind = queueKind(known.queue_kind);
      const priorEntry = nullableText(known.harness_entry_id);
      if (
        priorKind !== request.queueKind ||
        !queueTransition(priorState, request.state) ||
        !validQueueEntryTransition(
          priorState,
          priorEntry,
          request.state,
          request.harnessEntryId,
        ) ||
        source.state !== sourceStateForQueue(priorState)
      ) {
        return this.rejected("invalid_transition");
      }
      const queueUpdate = this.database
        .query(
          `
        UPDATE service_effect_s01_queued_inputs SET state = ?, harness_entry_id = ?
        WHERE operation_id = ? AND source_seq = ? AND state = ?
      `,
        )
        .run(
          request.state,
          request.harnessEntryId,
          operation.operation_id,
          request.sourceSeq,
          priorState,
        );
      if (queueUpdate.changes !== 1) return this.rejected("invalid_transition");
      const sourceUpdate = this.database
        .query(
          `
        UPDATE service_effect_s01_sources SET state = ?
        WHERE chat_jid = ? AND source_seq = ? AND state = ?
      `,
        )
        .run(
          sourceStateForQueue(request.state),
          operation.chat_jid,
          request.sourceSeq,
          sourceStateForQueue(priorState),
        );
      if (sourceUpdate.changes !== 1) return this.rejected("corrupt_state");
    }
    if (!this.bumpVersion(operation.operation_id, request.expectedVersion))
      return this.rejected("version_mismatch");
    return this.applied(
      this.requireOperationSnapshot(operation.operation_id),
      false,
    );
  }

  private async mutate<T>(
    method: MutationMethod,
    input: unknown,
    apply: (request: MutationRequest) => MutationOutcome<T>,
  ): Promise<ResultValue<T, ServiceWorkError>> {
    const request = this.prepareMutation(method, input);
    const effect = request?.effect;
    if (!request || !effect)
      return this.fail(method, effect, serviceError("invalid_transition"));

    const beforeFault = this.fault(method, "before_effect");
    if (!beforeFault.ok) return this.fail(method, effect, beforeFault.error);
    if (beforeFault.injected)
      return this.fail(
        method,
        effect,
        serviceError("storage_unavailable", "not_applied", true),
      );

    try {
      const outcome = await admitSqliteWrite(this.database, () => this.applyMutationWithinTransaction(method, request, apply));
      if (!outcome.ok) return this.fail(method, effect, outcome.error);

      const acknowledgementFault = this.fault(
        method,
        "effect_then_lost_acknowledgement",
      );
      if (acknowledgementFault.ok && acknowledgementFault.injected) {
        return this.fail(
          method,
          effect,
          serviceError("storage_unavailable", "unknown", true),
        );
      }
      // Invalid acknowledgement observers cannot make a known commit uncertain.
      return this.success(
        method,
        effect,
        outcome.value,
        outcome.duplicate ? "duplicate" : "ok",
      );
    } catch (cause) {
      return this.fail(method, effect, mutationError(cause));
    }
  }

  private prepareMutation(method: MutationMethod, input: unknown): MutationRequest | null {
    const request = normaliseMutationRequest(method, input);
    const effect = request?.effect;
    this.trace(method, effect?.idempotencyKey ?? "invalid", effect?.operationId ?? null,
      effect?.sourceSeq ?? null, null, "call");
    return request;
  }

  private applyMutationWithinTransaction<T>(
    method: MutationMethod,
    request: MutationRequest,
    apply: (request: MutationRequest) => MutationOutcome<T>,
  ): MutationOutcome<T> {
    const effect = request.effect;
    const replay = this.readDecision<T>(method, effect.idempotencyKey, effect.requestHash);
    if (replay) return replay;
    this.validateAcceptance(method, effect.operationId);
    const value = apply(request);
    if (!value.ok) return value;
    const transactionFault = this.fault(method, "before_effect");
    if (!transactionFault.ok || transactionFault.injected) throw new RollbackFault();
    this.writeDecision(method, effect.idempotencyKey, effect.requestHash, value.value);
    this.validateAcceptance(method, effect.operationId);
    return value;
  }

  private validateAcceptance(method?: MutationMethod, operationId?: string | null): void {
    try {
      if (!this.runtime.validateAcceptance) return;
      const observed: unknown = this.runtime.validateAcceptance(method, operationId);
      if (observed === true) return;
      // Invalid asynchronous guards must be denied, but their rejections still need an observer.
      if ((typeof observed === "object" && observed !== null) || typeof observed === "function")
        void Promise.resolve(observed).then(() => undefined, () => undefined);
    } catch (error) {
      void error;
    }
    throw new AcceptanceOwnershipError();
  }

  private async read<T>(
    method: string,
    effectId: string | null,
    run: () => T | { readonly invalid: true },
  ): Promise<ResultValue<T, ServiceWorkError>> {
    this.trace(method, effectId ?? "invalid", null, null, null, "call");
    try {
      const value = run();
      if (isInvalidRead(value)) {
        const error = serviceError("invalid_transition");
        this.trace(
          method,
          effectId ?? "invalid",
          null,
          null,
          null,
          error._tag,
          error.certainty,
        );
        return Result.err(error);
      }
      this.trace(
        method,
        effectId ?? "invalid",
        null,
        null,
        null,
        "ok",
        "applied",
      );
      return Result.ok(value);
    } catch (cause) {
      const error =
        cause instanceof CorruptStateError
          ? serviceError("corrupt_state")
          : isBusy(cause)
            ? serviceError("storage_unavailable", "not_applied", true)
            : serviceError("corrupt_state");
      this.trace(
        method,
        effectId ?? "invalid",
        null,
        null,
        null,
        error._tag,
        error.certainty,
      );
      return Result.err(error);
    }
  }

  private readDecision<T>(
    method: string,
    key: string,
    hash: string,
  ): MutationOutcome<T> | null {
    const raw = this.database
      .query(
        `
      SELECT method, request_hash, result_json
      FROM service_effect_s01_decisions WHERE idempotency_key = ?
    `,
      )
      .get(key) as
      | { method?: unknown; request_hash?: unknown; result_json?: unknown }
      | undefined;
    if (!raw) {
      const reused = this.database
        .query(
          `SELECT method FROM service_effect_s01_decisions WHERE idempotency_key = ?`,
        )
        .get(key) as { method?: unknown } | undefined;
      if (reused && requiredText(reused.method) !== method)
        return this.rejected("idempotency_conflict");
      return null;
    }
    if (
      requiredText(raw.method) !== method ||
      requiredHash(raw.request_hash) !== hash
    ) {
      return this.rejected("idempotency_conflict");
    }
    if (typeof raw.result_json !== "string")
      return this.rejected("corrupt_state");
    try {
      const stored = normaliseStoredDecision(JSON.parse(raw.result_json));
      return this.applied(this.materialiseDecision(stored, method) as T, true);
    } catch (caught) {
      void caught;
      return this.rejected("corrupt_state");
    }
  }

  private writeDecision(
    method: string,
    key: string,
    hash: string,
    value: unknown,
  ): void {
    const decision = decisionForValue(value);
    this.database
      .query(
        `
      INSERT INTO service_effect_s01_decisions(idempotency_key, method, request_hash, result_json)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(key, method, hash, JSON.stringify(decision));
  }

  private materialiseDecision(
    decision: StoredDecision,
    method: string,
  ): unknown {
    if (decision.kind === "empty") return null;
    if (decision.kind === "operation")
      return method === "claimNext"
        ? this.claimFromOperation(decision.operation)
        : decision.operation;
    const source = sourceSnapshot(
      this.requireSourceRow(decision.chatJid, decision.sourceSeq),
      decision.kind === "claim" ? decision.sourceState : decision.state,
    );
    if (decision.kind === "source") return source;
    return Object.freeze({ source, operation: decision.operation });
  }

  private claimFromOperation(operation: OperationSnapshot): ClaimedOperation {
    const source = sourceSnapshot(
      this.requireSourceRow(operation.chatJid, operation.primarySourceSeq),
      "claimed",
    );
    return Object.freeze({ source, operation });
  }

  private ensureChat(chatJid: string): void {
    this.database
      .query(
        `INSERT OR IGNORE INTO service_effect_s01_chats(chat_jid) VALUES (?)`,
      )
      .run(chatJid);
  }

  private chatRow(chatJid: string): {
    nextSourceSeq: number;
    consumedThroughSourceSeq: number;
    activeOperationId: string | null;
  } {
    const raw = this.database
      .query(
        `
      SELECT next_source_seq, consumed_through_source_seq, active_operation_id
      FROM service_effect_s01_chats WHERE chat_jid = ?
    `,
      )
      .get(chatJid) as
      | {
          next_source_seq?: unknown;
          consumed_through_source_seq?: unknown;
          active_operation_id?: unknown;
        }
      | undefined;
    if (!raw) throw new CorruptStateError();
    return {
      nextSourceSeq: requiredInteger(raw.next_source_seq, 1),
      consumedThroughSourceSeq: requiredInteger(
        raw.consumed_through_source_seq,
        0,
      ),
      activeOperationId: nullableText(raw.active_operation_id),
    };
  }

  private sourceRow(chatJid: string, sourceSeq: number): SourceRow | undefined {
    const raw = this.database
      .query(
        `
      SELECT * FROM service_effect_s01_sources WHERE chat_jid = ? AND source_seq = ?
    `,
      )
      .get(chatJid, sourceSeq) as Record<string, unknown> | undefined;
    return raw ? sourceRow(raw) : undefined;
  }

  private requireSourceRow(chatJid: string, sourceSeq: number): SourceRow {
    const row = this.sourceRow(chatJid, sourceSeq);
    if (!row) throw new CorruptStateError();
    return row;
  }

  private operationRow(operationId: string): OperationRow | undefined {
    const raw = this.database
      .query(
        `
      SELECT * FROM service_effect_s01_operations WHERE operation_id = ?
    `,
      )
      .get(operationId) as Record<string, unknown> | undefined;
    return raw ? operationRow(raw) : undefined;
  }

  private requireOperationRow(operationId: string): OperationRow {
    const row = this.operationRow(operationId);
    if (!row) throw new CorruptStateError();
    return row;
  }

  private operationSnapshot(operationId: string): OperationSnapshot | null {
    const row = this.operationRow(operationId);
    if (!row) return null;
    const claimed = this.database
      .query(
        `
      SELECT source_seq FROM service_effect_s01_operation_sources
      WHERE operation_id = ? ORDER BY source_seq
    `,
      )
      .all(operationId) as Array<{ source_seq?: unknown }>;
    return operationSnapshot(
      row,
      claimed.map((entry) => requiredInteger(entry.source_seq, 1)),
    );
  }

  private requireOperationSnapshot(operationId: string): OperationSnapshot {
    const snapshot = this.operationSnapshot(operationId);
    if (!snapshot) throw new CorruptStateError();
    return snapshot;
  }

  private requireMutableVersion(
    operationId: string,
    version: number,
  ):
    | { readonly ok: true; readonly row: OperationRow }
    | { readonly ok: false; readonly error: ServiceWorkError } {
    const row = this.operationRow(operationId);
    if (!row) return this.rejected("not_found");
    if (row.phase === "terminal")
      return this.rejected("owner_conflict", {
        conflictingOperationId: operationId,
      });
    if (row.version !== version)
      return this.rejected("version_mismatch", {
        observedVersion: row.version,
      });
    return { ok: true, row };
  }

  private bumpVersion(operationId: string, version: number): boolean {
    return (
      this.database
        .query(
          `
      UPDATE service_effect_s01_operations SET version = version + 1
      WHERE operation_id = ? AND version = ? AND phase <> 'terminal'
    `,
        )
        .run(operationId, version).changes === 1
    );
  }

  private fault(
    method: MutationMethod,
    point: "before_effect" | "effect_then_lost_acknowledgement",
  ):
    | { readonly ok: true; readonly injected: boolean }
    | { readonly ok: false; readonly error: ServiceWorkError } {
    try {
      const value = this.runtime.hitFault(point, method);
      if (value === true || value === false)
        return { ok: true, injected: value };
      return {
        ok: false,
        error: serviceError("storage_unavailable", "not_applied", true),
      };
    } catch (caught) {
      void caught;
      return {
        ok: false,
        error: serviceError("storage_unavailable", "not_applied", true),
      };
    }
  }

  private trace(
    method: string,
    effectId: string,
    operationId: string | null,
    sourceSeq: number | null,
    version: number | null,
    resultTag: string,
    certainty?: ServiceWorkError["certainty"],
  ): void {
    try {
      this.runtime.recordTrace({
        contract: "EF-S01",
        method,
        effectId,
        operationId,
        sourceSeq,
        version,
        ...(certainty ? { certainty } : {}),
        resultTag,
      });
    } catch (caught) {
      void caught;
      // Tracing is observational and cannot change durable semantics.
    }
  }

  private applied<T>(value: T, duplicate: boolean): MutationOutcome<T> {
    return { ok: true, value: deepFreeze(value), duplicate };
  }

  private rejected(
    tag: ServiceWorkErrorTag,
    details: Partial<ServiceWorkError> = {},
  ): { readonly ok: false; readonly error: ServiceWorkError } {
    return {
      ok: false,
      error: serviceError(tag, "not_applied", false, details),
    };
  }

  private success<T>(
    method: string,
    effect: MutationRequest["effect"],
    value: T,
    tag: string,
  ): ResultValue<T, never> {
    this.trace(
      method,
      effect.idempotencyKey,
      effect.operationId,
      effect.sourceSeq,
      operationVersion(value),
      tag,
      "applied",
    );
    return Result.ok(value);
  }

  private fail(
    method: string,
    effect: MutationRequest["effect"] | undefined,
    error: ServiceWorkError,
  ): ResultValue<never, ServiceWorkError> {
    this.trace(
      method,
      effect?.idempotencyKey ?? "invalid",
      effect?.operationId ?? null,
      effect?.sourceSeq ?? null,
      null,
      error._tag,
      error.certainty,
    );
    return Result.err(error);
  }
}

class CorruptStateError extends Error {}
class RollbackFault extends Error {}

const INVALID_READ = Object.freeze({ invalid: true as const });
function invalidRead(): typeof INVALID_READ {
  return INVALID_READ;
}
function isInvalidRead(value: unknown): value is typeof INVALID_READ {
  return value === INVALID_READ;
}

function sourceRow(raw: Record<string, unknown>): SourceRow {
  const kind = sourceKind(raw.kind);
  const state = sourceState(raw.state);
  return {
    chat_jid: requiredText(raw.chat_jid),
    source_seq: requiredInteger(raw.source_seq, 1),
    source_id: requiredText(raw.source_id),
    source_hash: requiredHash(raw.source_hash),
    kind,
    state,
    payload_ref: requiredText(raw.payload_ref),
    target_operation_id: nullableText(raw.target_operation_id),
    parent_source_seq: nullableInteger(raw.parent_source_seq, 1),
    accepted_at: requiredInstant(raw.accepted_at),
    disposition_reason: nullableText(raw.disposition_reason),
    provenance_ref: requiredText(raw.provenance_ref),
  };
}

function operationRow(raw: Record<string, unknown>): OperationRow {
  const phase = operationPhase(raw.phase);
  const cancellationSourceSeq = nullableInteger(raw.cancellation_source_seq, 1);
  const harnessSessionId = nullableText(raw.harness_session_id);
  const terminalDisposition = nullableText(raw.terminal_disposition);
  return {
    operation_id: requiredText(raw.operation_id),
    chat_jid: requiredText(raw.chat_jid),
    version: requiredInteger(raw.version, 1),
    phase,
    primary_source_seq: requiredInteger(raw.primary_source_seq, 1),
    cancellation_source_id:
      cancellationSourceSeq === null
        ? null
        : requiredText(raw.cancellation_source_id),
    cancellation_source_seq: cancellationSourceSeq,
    cancellation_cause:
      cancellationSourceSeq === null
        ? null
        : requiredText(raw.cancellation_cause),
    cancellation_requested_at:
      cancellationSourceSeq === null
        ? null
        : requiredInstant(raw.cancellation_requested_at),
    harness_session_id: harnessSessionId,
    harness_operation_id: nullableText(raw.harness_operation_id),
    terminal_disposition: terminalDisposition,
    terminal_message_row_id: nullableInteger(raw.terminal_message_row_id, 1),
    terminal_error_code: nullableText(raw.terminal_error_code),
    terminal_committed_at:
      terminalDisposition === null
        ? null
        : requiredInstant(raw.terminal_committed_at),
  };
}

function sourceSnapshot(
  row: SourceRow,
  state: AcceptedSourceSnapshot["state"] = row.state,
): AcceptedSourceSnapshot {
  return Object.freeze({
    chatJid: row.chat_jid,
    sourceSeq: row.source_seq,
    sourceId: row.source_id,
    kind: row.kind,
    state,
    payloadRef: row.payload_ref,
    targetOperationId: row.target_operation_id,
    parentSourceSeq: row.parent_source_seq,
    acceptedAt: row.accepted_at,
    dispositionReason: row.disposition_reason,
    provenanceRef: row.provenance_ref,
  });
}

function operationSnapshot(
  row: OperationRow,
  claimedSourceSeqs: readonly number[],
): OperationSnapshot {
  const cancellation =
    row.cancellation_source_seq === null
      ? null
      : Object.freeze({
          sourceSeq: row.cancellation_source_seq,
          cause: row.cancellation_cause!,
          requestedAt: row.cancellation_requested_at!,
        });
  const harness =
    row.harness_session_id === null
      ? null
      : Object.freeze({
          sessionId: row.harness_session_id,
          harnessOperationId: row.harness_operation_id,
        });
  const terminal =
    row.terminal_disposition === null
      ? null
      : Object.freeze({
          disposition: row.terminal_disposition as NonNullable<
            OperationSnapshot["terminal"]
          >["disposition"],
          messageRowId: row.terminal_message_row_id,
          errorCode: row.terminal_error_code,
          committedAt: row.terminal_committed_at!,
        });
  return Object.freeze({
    operationId: row.operation_id,
    chatJid: row.chat_jid,
    version: row.version,
    phase: row.phase,
    primarySourceSeq: row.primary_source_seq,
    claimedSourceSeqs: Object.freeze([...claimedSourceSeqs]),
    cancellation,
    harness,
    terminal,
  });
}

function decisionForValue(value: unknown): StoredDecision {
  if (value === null) return { kind: "empty" };
  if (isClaimedOperation(value)) {
    return {
      kind: "claim",
      chatJid: value.source.chatJid,
      sourceSeq: value.source.sourceSeq,
      sourceState: "claimed",
      operation: value.operation,
    };
  }
  if (isOperation(value)) return { kind: "operation", operation: value };
  if (isAcceptedSource(value))
    return {
      kind: "source",
      chatJid: value.chatJid,
      sourceSeq: value.sourceSeq,
      state: value.state,
    };
  throw new CorruptStateError();
}

function normaliseStoredDecision(input: unknown): StoredDecision {
  if (!plainRecord(input)) throw new CorruptStateError();
  if (input.kind === "empty" && exactKeys(input, ["kind"]))
    return { kind: "empty" };
  if (
    input.kind === "source" &&
    exactKeys(input, ["kind", "chatJid", "sourceSeq", "state"])
  ) {
    return {
      kind: "source",
      chatJid: requiredText(input.chatJid),
      sourceSeq: requiredInteger(input.sourceSeq, 1),
      state: sourceState(input.state),
    };
  }
  if (input.kind === "operation" && exactKeys(input, ["kind", "operation"])) {
    return {
      kind: "operation",
      operation: normaliseStoredOperation(input.operation),
    };
  }
  if (
    input.kind === "claim" &&
    exactKeys(input, [
      "kind",
      "chatJid",
      "sourceSeq",
      "sourceState",
      "operation",
    ]) &&
    input.sourceState === "claimed"
  ) {
    return {
      kind: "claim",
      chatJid: requiredText(input.chatJid),
      sourceSeq: requiredInteger(input.sourceSeq, 1),
      sourceState: "claimed",
      operation: normaliseStoredOperation(input.operation),
    };
  }
  throw new CorruptStateError();
}

function normaliseStoredOperation(input: unknown): OperationSnapshot {
  if (
    !plainRecord(input) ||
    !exactKeys(input, [
      "operationId",
      "chatJid",
      "version",
      "phase",
      "primarySourceSeq",
      "claimedSourceSeqs",
      "cancellation",
      "harness",
      "terminal",
    ])
  )
    throw new CorruptStateError();
  if (
    !Array.isArray(input.claimedSourceSeqs) ||
    input.claimedSourceSeqs.some(
      (entry) => !Number.isSafeInteger(entry) || (entry as number) < 1,
    )
  )
    throw new CorruptStateError();
  const cancellation =
    input.cancellation === null
      ? null
      : normaliseCancellation(input.cancellation);
  const harness =
    input.harness === null ? null : normaliseHarness(input.harness);
  if (input.terminal !== null) throw new CorruptStateError();
  return Object.freeze({
    operationId: requiredText(input.operationId),
    chatJid: requiredText(input.chatJid),
    version: requiredInteger(input.version, 1),
    phase: operationPhase(input.phase),
    primarySourceSeq: requiredInteger(input.primarySourceSeq, 1),
    claimedSourceSeqs: Object.freeze(
      input.claimedSourceSeqs.map((entry) => requiredInteger(entry, 1)),
    ),
    cancellation,
    harness,
    terminal: null,
  });
}

function normaliseCancellation(
  input: unknown,
): NonNullable<OperationSnapshot["cancellation"]> {
  if (
    !plainRecord(input) ||
    !exactKeys(input, ["sourceSeq", "cause", "requestedAt"])
  )
    throw new CorruptStateError();
  return Object.freeze({
    sourceSeq: requiredInteger(input.sourceSeq, 1),
    cause: requiredText(input.cause),
    requestedAt: requiredInstant(input.requestedAt),
  });
}

/** Historical decision JSON is evidence, never a new mutation or SDK observation. */
function normaliseHarness(input: unknown): NonNullable<OperationSnapshot["harness"]> {
  if (!plainRecord(input)) throw new CorruptStateError();
  if (exactKeys(input,["sessionId","lane","harnessOperationId","state","watchGeneration"])) {
    requiredText(input.lane); requiredInteger(input.watchGeneration,0); legacyHarnessState(input.state);
  } else if (!exactKeys(input,["sessionId","harnessOperationId"])) throw new CorruptStateError();
  return Object.freeze({sessionId:requiredText(input.sessionId),harnessOperationId:nullableText(input.harnessOperationId)});
}

function serviceError(
  tag: ServiceWorkErrorTag,
  certainty: ServiceWorkError["certainty"] = "not_applied",
  retryable = false,
  details: Partial<ServiceWorkError> = {},
): ServiceWorkError {
  return Object.freeze({
    _tag: tag,
    certainty,
    retryable,
    ...(Number.isSafeInteger(details.observedVersion)
      ? { observedVersion: details.observedVersion }
      : {}),
    ...(Number.isSafeInteger(details.observedFrontier)
      ? { observedFrontier: details.observedFrontier }
      : {}),
    ...(typeof details.conflictingOperationId === "string" &&
    details.conflictingOperationId.length > 0
      ? { conflictingOperationId: details.conflictingOperationId }
      : {}),
  });
}
function requiredText(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim().length === 0
  )
    throw new CorruptStateError();
  return value;
}
function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return requiredText(value);
}
function requiredHash(value: unknown): string {
  const result = requiredText(value);
  if (!/^[0-9a-f]{64}$/.test(result)) throw new CorruptStateError();
  return result;
}
function requiredInteger(value: unknown, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new CorruptStateError();
  return value as number;
}
function nullableInteger(value: unknown, minimum: number): number | null {
  return value === null || value === undefined
    ? null
    : requiredInteger(value, minimum);
}
function requiredInstant(value: unknown): string {
  const result = requiredText(value);
  const parsed = Date.parse(result);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== result)
    throw new CorruptStateError();
  return result;
}
function sourceKind(value: unknown): AcceptedSourceSnapshot["kind"] {
  if (
    typeof value !== "string" ||
    ![
      "message",
      "steer",
      "follow_up",
      "continuation",
      "control",
      "cancellation",
      "scheduled_agent",
      "internal",
    ].includes(value)
  )
    throw new CorruptStateError();
  return value as AcceptedSourceSnapshot["kind"];
}
function sourceState(value: unknown): AcceptedSourceSnapshot["state"] {
  if (
    typeof value !== "string" ||
    !["pending", "claimed", "queued", "consumed", "disposed"].includes(value)
  )
    throw new CorruptStateError();
  return value as AcceptedSourceSnapshot["state"];
}
function operationPhase(value: unknown): OperationSnapshot["phase"] {
  if (
    typeof value !== "string" ||
    ![
      "accepted",
      "claimed",
      "starting_harness",
      "executing",
      "suspended",
      "cancelling",
      "settling",
      "terminal",
    ].includes(value)
  )
    throw new CorruptStateError();
  return value as OperationSnapshot["phase"];
}
function legacyHarnessState(value: unknown): void {
  if (
    typeof value !== "string" ||
    !["not_started", "running", "suspended", "aborting", "finished"].includes(
      value,
    )
  )
    throw new CorruptStateError();

}
function queueState(value: unknown): QueuedInputState {
  if (
    typeof value !== "string" ||
    !["accepted", "queued", "consumed", "disposed"].includes(value)
  )
    throw new CorruptStateError();
  return value as QueuedInputState;
}
function queueKind(value: unknown): RecordQueuedInputRequest["queueKind"] {
  if (
    typeof value !== "string" ||
    !["steer", "follow_up", "next_run"].includes(value)
  )
    throw new CorruptStateError();
  return value as RecordQueuedInputRequest["queueKind"];
}
function queueTransition(
  from: QueuedInputState,
  to: QueuedInputState,
): boolean {
  return (
    (from === "accepted" && (to === "queued" || to === "disposed")) ||
    (from === "queued" && (to === "consumed" || to === "disposed"))
  );
}
function validQueueEntryTransition(
  from: QueuedInputState,
  previous: string | null,
  to: QueuedInputState,
  next: string | null,
): boolean {
  return from === "accepted" && to === "queued"
    ? previous === null && next !== null
    : previous === next;
}
function sourceStateForQueue(
  state: QueuedInputState,
): AcceptedSourceSnapshot["state"] {
  return state === "accepted" ? "claimed" : state;
}
function operationVersion(value: unknown): number | null {
  if (isOperation(value)) return value.version;
  if (isClaimedOperation(value)) return value.operation.version;
  return null;
}
function isAcceptedSource(value: unknown): value is AcceptedSourceSnapshot {
  return (
    plainRecord(value) &&
    typeof value.chatJid === "string" &&
    Number.isSafeInteger(value.sourceSeq) &&
    typeof value.sourceId === "string" &&
    typeof value.state === "string"
  );
}
function isOperation(value: unknown): value is OperationSnapshot {
  return (
    plainRecord(value) &&
    typeof value.operationId === "string" &&
    Number.isSafeInteger(value.version) &&
    Array.isArray(value.claimedSourceSeqs)
  );
}
function isClaimedOperation(value: unknown): value is ClaimedOperation {
  return (
    plainRecord(value) &&
    isAcceptedSource(value.source) &&
    isOperation(value.operation)
  );
}
function plainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}
function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}
