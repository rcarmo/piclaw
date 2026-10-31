import { admitSqliteWrite, isSqliteContention as isBusy } from '../../db/sqlite-async-admission.js';
import { Result, type Result as ResultValue } from "../contracts/result.js";
import type Database from "bun:sqlite";
import { computeClosedSourceFrontier } from "./source-frontier.js";

import { validateServiceEffectContentBlocks } from "../../channels/web/messaging/content-block-safety.js";
import { type NormalisedTraceInput } from "../contracts/common.js";
import type { EffectPayloadResolver } from "../contracts/payload-resolver.js";
import type {
  EnqueueOutboxRequest,
  OutboxStoreError,
  ServiceOutboxEnqueueInserter,
} from "../contracts/service-outbox-store.js";
import type {
  HarnessCorrelation,
  PiclawDisposition,
  PiclawOperationPhase,
} from "../contracts/service-work-store.js";
import type {
  CommitTerminalRequest,
  TerminalCommit,
  TerminalDatabaseEffect,
  TerminalSettlementError,
  TerminalSettlementErrorTag,
  TerminalSettlementStore,
} from "../contracts/terminal-settlement-store.js";
import { resolveVerifiedPayload } from "../payloads.js";
import {
  createServiceOutboxEnqueueInserter,
  type ServiceOutboxEnqueueStatement,
} from "./service-outbox-store.js";
import {
  normaliseCommitTerminalRequest,
  normaliseTerminalLookupId,
} from "./terminal-settlement-request-normalizer.js";
import {
  insertTerminalTimeline,
  replaceTerminalTimeline,
  TerminalTimelineStatementError,
  type TerminalTimelineContent,
  type TerminalTimelineStatement,
} from "./terminal-settlement-timeline-statements.js";

const PHASES = new Set<PiclawOperationPhase>([
  "accepted",
  "claimed",
  "starting_harness",
  "executing",
  "suspended",
  "cancelling",
  "settling",
  "terminal",
]);
const DISPOSITIONS = new Set<PiclawDisposition>([
  "completed",
  "cancelled",
  "failed",
  "skipped",
  "superseded",
]);
const REQUIRED_SCHEMA = Object.freeze([
  "chats",
  "media",
  "message_media",
  "messages",
  "messages_fts",
  "messages_fts_config",
  "messages_fts_data",
  "messages_fts_docsize",
  "messages_fts_idx",
  "service_effect_media_deletions",
  "service_effect_media_upload_history",
  "service_effect_media_uploads",
  "service_effect_operation_media",
  "service_effect_outbox_media_refs",
  "service_effect_s01_chats",
  "service_effect_s01_decisions",
  "service_effect_s01_intents",
  "service_effect_s01_operation_sources",
  "service_effect_s01_operations",
  "service_effect_s01_queued_inputs",
  "service_effect_s01_sources",
  "service_effect_s01_wake_intents",
  "service_effect_s02_commit_outbox",
  "service_effect_s02_commits",
  "service_effect_s05_decisions",
  "service_effect_s05_leases",
  "service_effect_s05_outbox",
  "service_effect_s05_outcomes",
  "service_effect_s05_resolutions",
  "service_effect_timeline_writes",
]);
const REQUIRED_INDEXES = Object.freeze([
  "service_effect_draft_revision",
  "service_effect_notice_source",
  "service_effect_operation_media_id",
  "service_effect_outbox_media_id",
  "service_effect_s01_one_active_operation",
  "service_effect_s01_open_operations",
  "service_effect_s01_pending_sources",
  "service_effect_s02_commit_chat",
  "service_effect_s05_decision_outbox",
  "service_effect_s05_expired_started",
  "service_effect_s05_failed_claim",
  "service_effect_s05_lease_outbox",
  "service_effect_s05_operation_lookup",
  "service_effect_s05_pending_claim",
  "service_effect_s05_terminal_cleanup",
  "service_effect_s05_unknown_list",
  "service_effect_timeline_operation",
]);
const REQUIRED_TRIGGERS = Object.freeze([
  "messages_ad",
  "messages_ai",
  "messages_au",
]);
const REQUIRED_SCHEMA_PROBES = Object.freeze([
  "SELECT jid,name,last_message_time FROM chats LIMIT 1",
  "SELECT rowid,id,chat_jid,sender,sender_name,content,content_blocks,thread_id,timestamp,is_from_me,is_bot_message,is_terminal_agent_reply,is_steering_message FROM messages LIMIT 1",
  "SELECT rowid,content,chat_jid,sender,sender_name,timestamp,is_bot_message FROM messages_fts LIMIT 1",
  "SELECT id,filename,content_type,data,metadata FROM media LIMIT 1",
  "SELECT message_rowid,media_id FROM message_media LIMIT 1",
  "SELECT chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id FROM service_effect_s01_chats LIMIT 1",
  "SELECT chat_jid,source_seq,state,kind,target_operation_id,accepted_at,disposition_reason FROM service_effect_s01_sources LIMIT 1",
  "SELECT operation_id,chat_jid,primary_source_seq,version,phase,cancellation_source_id,cancellation_source_seq,cancellation_cause,cancellation_requested_at,harness_session_id,harness_operation_id,terminal_disposition,terminal_message_row_id,terminal_error_code,terminal_committed_at FROM service_effect_s01_operations LIMIT 1",
  "SELECT chat_jid,operation_id,source_seq FROM service_effect_s01_operation_sources LIMIT 1",
  "SELECT chat_jid,operation_id,source_seq,state FROM service_effect_s01_queued_inputs LIMIT 1",
  "SELECT operation_id,media_id,role FROM service_effect_operation_media LIMIT 1",
  "SELECT idempotency_key,request_hash,operation_id,chat_jid,operation_version,disposition,message_row_id,consumed_through_source_seq,outbox_count,media_count,committed_at,terminal_authority_present FROM service_effect_s02_commits LIMIT 1",
  "SELECT operation_id,ordinal,outbox_id FROM service_effect_s02_commit_outbox LIMIT 1",
  "SELECT outbox_id,kind,state,idempotency_key,request_hash,operation_id,source_seq,provenance_ref,redaction_class,payload_ref,destination_ref,available_at,enqueued_at,state_changed_at,repeatability,attempt,certainty FROM service_effect_s05_outbox LIMIT 1",
  "SELECT decision_key,method,request_hash,outcome,outbox_id,attempt FROM service_effect_s05_decisions LIMIT 1",
  "SELECT write_type,operation_id,revision,message_rowid,chat_jid FROM service_effect_timeline_writes LIMIT 1",
]);

export type TerminalSettlementStatement =
  | TerminalTimelineStatement
  | "settle_source"
  | "settle_queued_input"
  | "advance_frontier_release_owner"
  | "terminalise_operation"
  | "outbox_insert"
  | "outbox_decision_insert"
  | "insert_commit"
  | "link_commit_outbox";

export interface TerminalSettlementAdapterRuntime {
  /**
   * Optional host ownership check. Must be synchronous and must not await:
   * read the host's durable owner/incarnation binding on this same database
   * connection, not a cached entry check. Called inside BEGIN IMMEDIATE before
   * and after apply; only exact true permits commit. False, nonboolean results
   * and throws abort with owner_conflict and roll back all settlement effects.
   * Existing committed replay is observational and does not call this hook.
   */
  validateOwnership?: (operationId?: string) => boolean;
  /** Synchronous shared-database terminal effects. Runs once inside the terminal
   * transaction, after apply and before the final owner check; replay skips it.
   * Throwing rolls back ALL writes. No async work or external effects permitted. */
  applyTerminalEffects?: (commit: Readonly<TerminalCommit>, assertCurrent: (expected: Readonly<TerminalCommit>) => void) => undefined;
  hitFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
  ): unknown;
  checkpoint?(statement: TerminalSettlementStatement, occurrence: number): unknown;
  recordTrace(input: NormalisedTraceInput): void;
}

export type TerminalSettlementConstructionResult = ResultValue<
  TerminalSettlementStore,
  TerminalSettlementError
>;

interface CommitRow {
  idempotency_key: unknown;
  request_hash: unknown;
  operation_id: unknown;
  chat_jid: unknown;
  operation_version: unknown;
  disposition: unknown;
  message_row_id: unknown;
  consumed_through_source_seq: unknown;
  outbox_count: unknown;
  media_count: unknown;
  committed_at: unknown;
  terminal_authority_present: unknown;
}

interface OperationRow {
  operation_id: unknown;
  chat_jid: unknown;
  primary_source_seq: unknown;
  version: unknown;
  phase: unknown;
  cancellation_source_id: unknown;
  cancellation_source_seq: unknown;
  cancellation_cause: unknown;
  cancellation_requested_at: unknown;
  harness_session_id: unknown;
  harness_operation_id: unknown;
  terminal_disposition: unknown;
  terminal_message_row_id: unknown;
  terminal_error_code: unknown;
  terminal_committed_at: unknown;
  active_operation_id: unknown;
  consumed_through_source_seq: unknown;
  next_source_seq: unknown;
}

interface ClosedOperation {
  operationId: string;
  chatJid: string;
  version: number;
  primarySourceSeq: number;
  phase: PiclawOperationPhase;
  cancellationSourceSeq: number | null;
  cancellationRequestedAt: string | null;
  harness: HarnessCorrelation | null;
  terminalDisposition: PiclawDisposition | null;
  activeOperationId: string | null;
  consumedThroughSourceSeq: number;
  nextSourceSeq: number;
}


class SettlementAbort extends Error {
  constructor(readonly error: TerminalSettlementError) {
    super(error._tag);
  }
}
class CorruptSettlementState extends Error {}
class InjectedStatementRollback extends Error {}

export function createCurrentPiclawTerminalSettlementStore(
  database: Database,
  payloads: EffectPayloadResolver,
  runtime: TerminalSettlementAdapterRuntime,
): TerminalSettlementConstructionResult {
  try {
    return Result.ok(
      CurrentPiclawTerminalSettlementStore.create(database, payloads, runtime),
    );
  } catch (error) {
    void error;
    return Result.err(settlementError("storage_unavailable", "not_applied", true));
  }
}

class CurrentPiclawTerminalSettlementStore
  implements TerminalSettlementStore
{
  private checkpointOccurrence = 0;

  private constructor(
    readonly database: Database,
    private readonly payloads: EffectPayloadResolver,
    private readonly runtime: TerminalSettlementAdapterRuntime,
    private readonly outbox: ServiceOutboxEnqueueInserter,
  ) {}

  static create(
    database: Database,
    payloads: EffectPayloadResolver,
    runtime: TerminalSettlementAdapterRuntime,
  ): CurrentPiclawTerminalSettlementStore {
    validateConstruction(database);
    let observe: (statement: ServiceOutboxEnqueueStatement) => void = () => {
      throw new Error("EF-S02 outbox observer is not initialised.");
    };
    const inserter = createServiceOutboxEnqueueInserter(database, {
      afterStatement: (statement) => observe(statement),
    });
    if (!inserter.ok) throw new Error("EF-S02 outbox inserter unavailable.");
    const store = new CurrentPiclawTerminalSettlementStore(
      database,
      payloads,
      runtime,
      inserter.value,
    );
    observe = (statement) => store.afterStatement(statement);
    return store;
  }

  async commitTerminal(
    input: CommitTerminalRequest,
    applyEffect?: TerminalDatabaseEffect,
  ): Promise<ResultValue<TerminalCommit, TerminalSettlementError>> {
    const request = normaliseCommitTerminalRequest(input);
    const effectId = request?.effect.idempotencyKey ?? "invalid";
    const operationId = request?.effect.operationId ?? null;
    this.trace(
      "commitTerminal",
      effectId,
      operationId,
      request?.expectedVersion ?? null,
      "call",
      null,
    );
    if (!request) {
      return this.failure(
        "commitTerminal",
        effectId,
        operationId,
        null,
        settlementError("invalid_request"),
      );
    }

    try {
      const fast = this.reconcile(request);
      if (fast) return this.finishReconciliation(request, fast);
    } catch (error) {
      return this.caught("commitTerminal", request, error);
    }

    if (beforeEffectInjected(this.runtime)) {
      return this.failure(
        "commitTerminal",
        effectId,
        operationId,
        request.expectedVersion,
        settlementError("storage_unavailable", "not_applied", true),
      );
    }

    const resolved = await this.resolveTimeline(request);
    if (!resolved.ok) {
      return this.failure(
        "commitTerminal",
        effectId,
        operationId,
        request.expectedVersion,
        resolved.error,
      );
    }

    try {
      const outcome = await admitSqliteWrite(this.database, () => {
          this.checkpointOccurrence = 0;
          const reconciled = this.reconcile(request);
          if (reconciled) {
            if (reconciled.kind === "replay") return reconciled.commit;
            throw new SettlementAbort(reconciled.error);
          }
          this.validateOwnership(request.effect.operationId);
          const commit = this.apply(request, resolved.value);
          if (this.runtime.applyTerminalEffects || applyEffect) {
            let active = true;
            const assertCurrent = (expected: Readonly<TerminalCommit>) => {
              if (!active || !this.database.inTransaction) throw new Error("Terminal effect scope ended");
              if (expected !== commit) throw new Error("Exact terminal effect commit required");
              this.validateOwnership(commit.operationId);
            };
            try {
              if (this.runtime.applyTerminalEffects?.(commit, assertCurrent) !== undefined || applyEffect?.(commit, assertCurrent) !== undefined)
                throw new SettlementAbort(settlementError("invalid_request", "not_applied", false));
            } finally { active = false; }
          }
          this.validateOwnership(commit.operationId);
          return commit;
        });

      if (lostAcknowledgement(this.runtime)) {
        return this.failure(
          "commitTerminal",
          effectId,
          operationId,
          request.expectedVersion,
          settlementError("storage_unavailable", "unknown", true),
        );
      }
      return this.success(
        "commitTerminal",
        effectId,
        operationId,
        request.expectedVersion,
        outcome,
        "applied",
      );
    } catch (error) {
      return this.caught("commitTerminal", request, error);
    }
  }

  async getTerminal(
    operationId: string,
  ): Promise<ResultValue<TerminalCommit | null, TerminalSettlementError>> {
    const id = normaliseTerminalLookupId(operationId);
    if (!id) return Result.err(settlementError("invalid_request"));
    try {
      const row = this.commitByOperation(id);
      if (!row) {
        const operation = this.database
          .query(
            "SELECT phase FROM service_effect_s01_operations WHERE operation_id=?",
          )
          .get(id) as { phase?: unknown } | undefined;
        if (operation?.phase === "terminal") {
          return Result.err(settlementError("corrupt_state"));
        }
        return Result.ok(null);
      }
      return Result.ok(this.materialiseCommit(row));
    } catch (error) {
      return Result.err(
        error instanceof CorruptSettlementState
          ? settlementError("corrupt_state")
          : settlementError("storage_unavailable", "not_applied", true),
      );
    }
  }

  async getTerminalByKey(
    idempotencyKey: string,
  ): Promise<ResultValue<TerminalCommit | null, TerminalSettlementError>> {
    const key = normaliseTerminalLookupId(idempotencyKey);
    if (!key) return Result.err(settlementError("invalid_request"));
    try {
      const row = this.commitByKey(key);
      if (!row) return Result.ok(null);
      return Result.ok(this.materialiseCommit(row));
    } catch (error) {
      return Result.err(
        error instanceof CorruptSettlementState
          ? settlementError("corrupt_state")
          : settlementError("storage_unavailable", "not_applied", true),
      );
    }
  }

  private apply(
    request: CommitTerminalRequest,
    resolved: TerminalTimelineContent | null,
  ): TerminalCommit {
    const operation = this.readOperation(request.effect.operationId);
    this.authoriseOperation(request, operation);
    this.validateTemporalAuthority(request, operation);
    this.validateOutboxAuthority(request, operation);
    this.validateSources(request, operation);
    if (request.timeline.mode !== "none") this.validateMedia(request);

    // The surrounding BEGIN IMMEDIATE owns the writer reservation. These reads
    // are authoritative until the final exact CAS writes below; no no-op UPDATE
    // is issued merely to manufacture a checkpoint or row lock.
    const messageRowId = this.writeTimeline(request, resolved);
    this.settleSources(request, operation);
    const consumedThroughSourceSeq = this.computeFrontier(operation);
    const operationVersion = operation.version + 1;

    const terminalised = this.database
      .prepare(
        `UPDATE service_effect_s01_operations
         SET version=?, phase='terminal', terminal_disposition=?, terminal_message_row_id=?,
             terminal_error_code=?, terminal_committed_at=?
         WHERE operation_id=? AND chat_jid=? AND version=? AND phase=?
           AND terminal_disposition IS NULL AND terminal_message_row_id IS NULL
           AND terminal_error_code IS NULL AND terminal_committed_at IS NULL`,
      )
      .run(
        operationVersion,
        request.disposition,
        messageRowId,
        request.errorCode,
        request.committedAt,
        operation.operationId,
        operation.chatJid,
        operation.version,
        operation.phase,
      );
    if (!changedExactlyOne(terminalised.changes)) {
      throw new SettlementAbort(settlementError("version_mismatch"));
    }
    this.afterStatement("terminalise_operation");

    const released = this.database
      .prepare(
        `UPDATE service_effect_s01_chats
         SET consumed_through_source_seq=?, active_operation_id=NULL
         WHERE chat_jid=? AND consumed_through_source_seq=? AND active_operation_id=?
         RETURNING chat_jid`,
      )
      .get(
        consumedThroughSourceSeq,
        operation.chatJid,
        operation.consumedThroughSourceSeq,
        operation.operationId,
      ) as { chat_jid?: unknown } | undefined;
    if (released?.chat_jid !== operation.chatJid) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    this.afterStatement("advance_frontier_release_owner");

    for (const intent of request.outboxIntents) this.insertOutbox(intent);

    const commit: TerminalCommit = freezeCommit({
      operationId: operation.operationId,
      operationVersion,
      disposition: request.disposition,
      messageRowId,
      consumedThroughSourceSeq,
      outboxIds: request.outboxIntents.map((intent) => intent.outboxId),
      committedAt: request.committedAt,
    });
    const insertedCommit = this.database
      .prepare(
        `INSERT INTO service_effect_s02_commits(
           idempotency_key,request_hash,operation_id,chat_jid,operation_version,
           disposition,message_row_id,consumed_through_source_seq,outbox_count,media_count,
           committed_at,terminal_authority_present
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        request.effect.idempotencyKey,
        request.effect.requestHash,
        operation.operationId,
        operation.chatJid,
        operationVersion,
        request.disposition,
        messageRowId,
        consumedThroughSourceSeq,
        request.outboxIntents.length,
        request.timeline.mediaIds.length,
        request.committedAt,
        request.terminalAuthorityRef === null ? 0 : 1,
      );
    if (!changedExactlyOne(insertedCommit.changes)) throw new CorruptSettlementState();
    this.afterStatement("insert_commit");

    request.outboxIntents.forEach((intent, ordinal) => {
      const linked = this.database
        .prepare(
          `INSERT INTO service_effect_s02_commit_outbox(operation_id,ordinal,outbox_id)
           VALUES (?,?,?)`,
        )
        .run(operation.operationId, ordinal, intent.outboxId);
      if (!changedExactlyOne(linked.changes)) throw new CorruptSettlementState();
      this.afterStatement("link_commit_outbox");
    });
    return commit;
  }

  private writeTimeline(
    request: CommitTerminalRequest,
    resolved: TerminalTimelineContent | null,
  ): number | null {
    const timeline = request.timeline;
    if (timeline.mode === "none") return null;
    if (!resolved) throw new CorruptSettlementState();
    try {
      return timeline.mode === "replace_placeholder"
        ? replaceTerminalTimeline(
            this.database,
            request.effect.operationId,
            timeline,
            resolved,
            (statement) => this.afterStatement(statement),
          )
        : insertTerminalTimeline(
            this.database,
            request.effect.operationId,
            request.committedAt,
            timeline,
            resolved,
            (statement) => this.afterStatement(statement),
          );
    } catch (error) {
      if (error instanceof TerminalTimelineStatementError) {
        throw new SettlementAbort(settlementError(error.tag));
      }
      throw error;
    }
  }

  private insertOutbox(intent: EnqueueOutboxRequest): void {
    const inserted = this.outbox.insert(intent);
    if (!inserted.ok) {
      throw new SettlementAbort(mapOutboxError(inserted.error));
    }
    const { decision, record } = inserted.value;
    if (decision !== "applied") {
      throw new SettlementAbort(settlementError("idempotency_conflict"));
    }
    if (
      record.outboxId !== intent.outboxId ||
      record.kind !== intent.kind ||
      record.idempotencyKey !== intent.effect.idempotencyKey ||
      record.requestHash !== intent.effect.requestHash ||
      record.operationId !== intent.effect.operationId ||
      record.sourceSeq !== intent.effect.sourceSeq ||
      record.provenanceRef !== intent.effect.provenanceRef ||
      record.redactionClass !== intent.effect.redactionClass ||
      record.payloadRef !== intent.payloadRef ||
      record.destinationRef !== intent.destinationRef ||
      record.availableAt !== intent.availableAt ||
      record.enqueuedAt !== intent.enqueuedAt ||
      record.repeatability !== intent.repeatability ||
      record.state !== "pending"
    ) {
      throw new CorruptSettlementState();
    }
  }

  private validateMedia(request: CommitTerminalRequest): void {
    for (const mediaId of request.timeline.mediaIds) {
      const row = this.database
        .query(
          `SELECT 1 AS present
           FROM service_effect_media_uploads u
           JOIN service_effect_operation_media b ON b.media_id=u.media_id
           WHERE u.media_id=? AND b.operation_id=? AND b.role='terminal'`,
        )
        .get(mediaId, request.effect.operationId) as
        | { present?: unknown }
        | undefined;
      if (!row || requiredInteger(row.present, 1) !== 1) {
        throw new SettlementAbort(settlementError("missing_media"));
      }
    }
  }

  private validateSources(
    request: CommitTerminalRequest,
    operation: ClosedOperation,
  ): void {
    const memberships = this.database
      .prepare(
        `SELECT s.source_seq,s.state,q.state queue_state
         FROM service_effect_s01_operation_sources os
         JOIN service_effect_s01_sources s
           ON s.chat_jid=os.chat_jid AND s.source_seq=os.source_seq
         LEFT JOIN service_effect_s01_queued_inputs q
           ON q.operation_id=os.operation_id AND q.source_seq=os.source_seq
         WHERE os.operation_id=? ORDER BY s.source_seq`,
      )
      .all(operation.operationId) as Array<{
        source_seq?: unknown;
        state?: unknown;
        queue_state?: unknown;
      }>;
    const expected = memberships.map((row) => requiredInteger(row.source_seq, 1));
    const supplied = request.sourceDispositions.map((entry) => entry.sourceSeq);
    if (
      expected.length === 0 ||
      expected.length !== supplied.length ||
      expected.some((sourceSeq, index) => sourceSeq !== supplied[index])
    ) {
      throw new SettlementAbort(settlementError("invalid_source_disposition"));
    }
    for (const row of memberships) {
      if (row.state !== "claimed" && row.state !== "queued") {
        throw new CorruptSettlementState();
      }
      requiredInteger(row.source_seq, 1);
      if (row.state === "queued" && row.queue_state !== "queued") {
        throw new CorruptSettlementState();
      }
      if (
        row.state === "claimed" &&
        row.queue_state !== null &&
        row.queue_state !== undefined &&
        row.queue_state !== "accepted"
      ) {
        throw new CorruptSettlementState();
      }
    }
  }

  private settleSources(
    request: CommitTerminalRequest,
    operation: ClosedOperation,
  ): void {
    for (const disposition of request.sourceDispositions) {
      const owned = this.database
        .query(
          `SELECT s.state source_state,q.state queue_state
           FROM service_effect_s01_sources s
           JOIN service_effect_s01_operation_sources os
             ON os.chat_jid=s.chat_jid AND os.source_seq=s.source_seq
           LEFT JOIN service_effect_s01_queued_inputs q
             ON q.operation_id=os.operation_id AND q.source_seq=os.source_seq
           WHERE s.chat_jid=? AND s.source_seq=? AND os.operation_id=?`,
        )
        .get(
          operation.chatJid,
          disposition.sourceSeq,
          operation.operationId,
        ) as
        | { source_state?: unknown; queue_state?: unknown }
        | undefined;
      if (
        !owned ||
        (owned.source_state !== "claimed" && owned.source_state !== "queued")
      ) {
        throw new SettlementAbort(settlementError("invalid_source_disposition"));
      }
      const expectedQueueState =
        owned.source_state === "queued" ? "queued" : "accepted";
      if (
        (owned.source_state === "queued" &&
          owned.queue_state !== expectedQueueState) ||
        (owned.queue_state !== null &&
          owned.queue_state !== undefined &&
          owned.queue_state !== expectedQueueState)
      ) {
        throw new SettlementAbort(settlementError("invalid_source_disposition"));
      }

      const settledSource = this.database
        .prepare(
          `UPDATE service_effect_s01_sources
           SET state=?,disposition_reason=?
           WHERE chat_jid=? AND source_seq=? AND state=?`,
        )
        .run(
          disposition.state,
          disposition.reason,
          operation.chatJid,
          disposition.sourceSeq,
          owned.source_state,
        );
      if (!changedExactlyOne(settledSource.changes)) {
        throw new SettlementAbort(settlementError("invalid_source_disposition"));
      }
      this.afterStatement("settle_source");

      if (owned.queue_state === null || owned.queue_state === undefined) continue;
      const settledQueue = this.database
        .prepare(
          `UPDATE service_effect_s01_queued_inputs SET state=?
           WHERE operation_id=? AND source_seq=? AND state=?`,
        )
        .run(
          disposition.state,
          operation.operationId,
          disposition.sourceSeq,
          expectedQueueState,
        );
      if (!changedExactlyOne(settledQueue.changes)) {
        throw new SettlementAbort(settlementError("invalid_source_disposition"));
      }
      this.afterStatement("settle_queued_input");
    }
  }

  private computeFrontier(operation: ClosedOperation): number {
    try {
      return computeClosedSourceFrontier(this.database, operation.chatJid, operation.consumedThroughSourceSeq, operation.nextSourceSeq);
    } catch { throw new CorruptSettlementState(); }
  }

  private validateOutboxAuthority(
    request: CommitTerminalRequest,
    operation: ClosedOperation,
  ): void {
    const operationSources = new Set(
      (
        this.database
          .query(
            "SELECT source_seq FROM service_effect_s01_operation_sources WHERE operation_id=?",
          )
          .all(operation.operationId) as Array<{ source_seq?: unknown }>
      ).map((row) => requiredInteger(row.source_seq, 1)),
    );
    if (
      request.effect.sourceSeq !== null &&
      !operationSources.has(request.effect.sourceSeq)
    ) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    for (const intent of request.outboxIntents) {
      if (intent.effect.operationId !== operation.operationId) {
        throw new SettlementAbort(settlementError("owner_conflict"));
      }
      if (
        intent.effect.sourceSeq !== null &&
        !operationSources.has(intent.effect.sourceSeq)
      ) {
        throw new SettlementAbort(settlementError("owner_conflict"));
      }
    }
  }

  private validateTemporalAuthority(
    request: CommitTerminalRequest,
    operation: ClosedOperation,
  ): void {
    // S01 operations have no accepted/claimed lifecycle timestamp. The durable
    // lower bounds available here are source accepted_at, cancellation
    // requested_at, and the latest replaced draft written_at. The request
    // normalizer separately requires every outbox enqueued_at === committedAt.
    const row = this.database
      .prepare(
        `SELECT MAX(accepted_at) latest_accepted_at
         FROM service_effect_s01_sources
         WHERE chat_jid=? AND source_seq IN (
           SELECT source_seq FROM service_effect_s01_operation_sources
           WHERE operation_id=?
         )`,
      )
      .get(operation.chatJid, operation.operationId) as
      | { latest_accepted_at?: unknown }
      | undefined;
    const latestAcceptedAt =
      row?.latest_accepted_at === null || row?.latest_accepted_at === undefined
        ? null
        : requiredInstant(row.latest_accepted_at);
    const latestDraft =
      request.timeline.mode === "replace_placeholder"
        ? (this.database
            .prepare(
              `SELECT written_at FROM service_effect_timeline_writes
               WHERE write_type='draft' AND operation_id=?
               ORDER BY revision DESC LIMIT 1`,
            )
            .get(operation.operationId) as { written_at?: unknown } | undefined)
        : undefined;
    const latestDraftAt =
      latestDraft?.written_at === undefined
        ? null
        : requiredInstant(latestDraft.written_at);
    if (
      (latestAcceptedAt !== null && request.committedAt < latestAcceptedAt) ||
      (latestDraftAt !== null && request.committedAt < latestDraftAt) ||
      (operation.cancellationRequestedAt !== null &&
        request.committedAt < operation.cancellationRequestedAt)
    ) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
  }

  private authoriseOperation(
    request: CommitTerminalRequest,
    operation: ClosedOperation,
  ): void {
    if (operation.chatJid !== request.expectedChatJid) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    if (operation.version !== request.expectedVersion) {
      throw new SettlementAbort(settlementError("version_mismatch"));
    }
    if (
      operation.phase === "terminal" ||
      operation.terminalDisposition !== null
    ) {
      throw new CorruptSettlementState();
    }
    if (operation.activeOperationId !== operation.operationId) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    if (!equalHarness(operation.harness, request.expectedHarness)) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    if (request.timeline.chatJid !== operation.chatJid) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
    if (!dispositionAllowed(request, operation)) {
      throw new SettlementAbort(settlementError("owner_conflict"));
    }
  }

  private readOperation(operationId: string): ClosedOperation {
    const row = this.database
      .query(
        `SELECT o.*,c.active_operation_id,c.consumed_through_source_seq,c.next_source_seq
         FROM service_effect_s01_operations o
         JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid
         WHERE o.operation_id=?`,
      )
      .get(operationId) as OperationRow | undefined;
    if (!row) throw new SettlementAbort(settlementError("not_found"));
    return closeOperation(row);
  }

  private async resolveTimeline(
    request: CommitTerminalRequest,
  ): Promise<
    | { ok: true; value: TerminalTimelineContent | null }
    | { ok: false; error: TerminalSettlementError }
  > {
    if (request.timeline.mode === "none") return { ok: true, value: null };
    try {
      const content = await resolveVerifiedPayload(
        this.payloads,
        request.timeline.contentRef,
      );
      if (
        !content ||
        content.redactionClass !== request.effect.redactionClass ||
        (content.mediaType !== "text/plain" &&
          content.mediaType !== "text/markdown") ||
        content.byteLength > 1_048_576
      ) {
        return {
          ok: false,
          error: settlementError("storage_unavailable", "not_applied", true),
        };
      }
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(content.bytes);
      } catch (error) {
        void error;
        return { ok: false, error: settlementError("corrupt_state") };
      }
      if (text.length > 1_048_576) {
        return { ok: false, error: settlementError("corrupt_state") };
      }
      let blocks: readonly Readonly<Record<string, unknown>>[] | null = null;
      if (request.timeline.contentBlocksRef !== null) {
        const payload = await resolveVerifiedPayload(
          this.payloads,
          request.timeline.contentBlocksRef,
        );
        if (
          !payload ||
          payload.redactionClass !== request.effect.redactionClass ||
          payload.mediaType !== "application/json" ||
          payload.byteLength > 262_144
        ) {
          return {
            ok: false,
            error: settlementError("storage_unavailable", "not_applied", true),
          };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(payload.bytes),
          );
        } catch (error) {
          void error;
          return { ok: false, error: settlementError("corrupt_state") };
        }
        blocks = validateServiceEffectContentBlocks(parsed);
        if (!blocks) return { ok: false, error: settlementError("corrupt_state") };
      }
      return { ok: true, value: Object.freeze({ content: text, blocks }) };
    } catch (error) {
      void error;
      return {
        ok: false,
        error: settlementError("storage_unavailable", "not_applied", true),
      };
    }
  }

  private reconcile(request: CommitTerminalRequest): Reconciliation | null {
    const byKey = this.commitByKey(request.effect.idempotencyKey);
    if (byKey) {
      const commit = this.materialiseCommit(byKey);
      if (
        requiredText(byKey.request_hash, 64) === request.effect.requestHash &&
        commit.operationId === request.effect.operationId
      ) {
        return { kind: "replay", commit };
      }
      return {
        kind: "error",
        error: settlementError("idempotency_conflict"),
      };
    }
    const byOperation = this.commitByOperation(request.effect.operationId);
    if (!byOperation) return null;
    const commit = this.materialiseCommit(byOperation);
    if (
      requiredText(byOperation.idempotency_key, 512) ===
        request.effect.idempotencyKey &&
      requiredText(byOperation.request_hash, 64) === request.effect.requestHash
    ) {
      return { kind: "replay", commit };
    }
    return {
      kind: "error",
      error: settlementError("already_terminal_conflict", "not_applied", false, commit),
    };
  }

  private finishReconciliation(
    request: CommitTerminalRequest,
    reconciliation: Reconciliation,
  ): ResultValue<TerminalCommit, TerminalSettlementError> {
    return reconciliation.kind === "replay"
      ? this.success(
          "commitTerminal",
          request.effect.idempotencyKey,
          request.effect.operationId,
          request.expectedVersion,
          reconciliation.commit,
          "replayed",
        )
      : this.failure(
          "commitTerminal",
          request.effect.idempotencyKey,
          request.effect.operationId,
          request.expectedVersion,
          reconciliation.error,
        );
  }

  private commitByKey(key: string): CommitRow | undefined {
    return this.database
      .query("SELECT * FROM service_effect_s02_commits WHERE idempotency_key=?")
      .get(key) as CommitRow | undefined;
  }

  private commitByOperation(operationId: string): CommitRow | undefined {
    return this.database
      .query("SELECT * FROM service_effect_s02_commits WHERE operation_id=?")
      .get(operationId) as CommitRow | undefined;
  }

  private materialiseCommit(row: CommitRow): TerminalCommit {
    const operationId = requiredText(row.operation_id, 512);
    requiredText(row.idempotency_key, 512);
    requiredHash(row.request_hash);
    const chatJid = requiredText(row.chat_jid, 512);
    const disposition = requiredDisposition(row.disposition);
    const authorityPresent = requiredInteger(
      row.terminal_authority_present,
      0,
    );
    const authorityRequired =
      disposition === "skipped" || disposition === "superseded";
    if (authorityPresent > 1 || authorityRequired !== (authorityPresent === 1)) {
      throw new CorruptSettlementState();
    }
    const expectedOutboxCount = requiredInteger(row.outbox_count, 0);
    const expectedMediaCount = requiredInteger(row.media_count, 0);
    if (expectedOutboxCount > 100 || expectedMediaCount > 100) {
      throw new CorruptSettlementState();
    }
    const ownedMedia = this.database.query("SELECT COUNT(*) n FROM service_effect_operation_media WHERE operation_id=? AND role='terminal'").get(operationId) as { n: number };
    if (ownedMedia.n !== expectedMediaCount) throw new CorruptSettlementState();
    const ledgerCommittedAt = requiredInstant(row.committed_at);
    const outboxIds = (
      this.database
        .query(
          `SELECT l.ordinal,l.outbox_id,o.operation_id outbox_operation_id,
                  o.kind,o.state,o.idempotency_key,o.request_hash,o.source_seq,
                  o.provenance_ref,o.redaction_class,o.payload_ref,o.destination_ref,
                  o.available_at,o.enqueued_at,o.state_changed_at,o.repeatability,
                  o.attempt,o.certainty,d.decision_key,d.method,d.request_hash decision_hash,
                  d.outcome,d.outbox_id decision_outbox_id,d.attempt decision_attempt
           FROM service_effect_s02_commit_outbox l
           JOIN service_effect_s05_outbox o ON o.outbox_id=l.outbox_id
           JOIN service_effect_s05_decisions d ON d.outbox_id=o.outbox_id
           WHERE l.operation_id=? ORDER BY l.ordinal`,
        )
        .all(operationId) as Array<{
        ordinal?: unknown;
        outbox_id?: unknown;
        outbox_operation_id?: unknown;
        kind?: unknown;
        state?: unknown;
        idempotency_key?: unknown;
        request_hash?: unknown;
        source_seq?: unknown;
        provenance_ref?: unknown;
        redaction_class?: unknown;
        payload_ref?: unknown;
        destination_ref?: unknown;
        available_at?: unknown;
        enqueued_at?: unknown;
        state_changed_at?: unknown;
        repeatability?: unknown;
        attempt?: unknown;
        certainty?: unknown;
        decision_key?: unknown;
        method?: unknown;
        decision_hash?: unknown;
        outcome?: unknown;
        decision_outbox_id?: unknown;
        decision_attempt?: unknown;
      }>
    ).map((entry, index) => {
      const outboxId = requiredText(entry.outbox_id, 512);
      const enqueuedAt = requiredInstant(entry.enqueued_at);
      const availableAt = requiredInstant(entry.available_at);
      const sourceSeq =
        entry.source_seq === null
          ? null
          : requiredInteger(entry.source_seq, 0);
      if (
        sourceSeq !== null &&
        !this.database
          .prepare(
            `SELECT 1 FROM service_effect_s01_operation_sources
             WHERE operation_id=? AND source_seq=?`,
          )
          .get(operationId, sourceSeq)
      ) {
        throw new CorruptSettlementState();
      }
      if (
        requiredInteger(entry.ordinal, 0) !== index ||
        nullableText(entry.outbox_operation_id, 512) !== operationId ||
        !["wake_chat", "timeline_broadcast", "channel_delivery", "notification", "scheduler_run_log", "maintenance"].includes(requiredText(entry.kind, 64)) ||
        entry.state !== "pending" ||
        requiredText(entry.idempotency_key, 512).length < 1 ||
        requiredHash(entry.request_hash).length !== 64 ||
        (sourceSeq !== null && sourceSeq < 0) ||
        requiredText(entry.provenance_ref, 2048).length < 1 ||
        !["public", "private", "secret"].includes(requiredText(entry.redaction_class, 16)) ||
        requiredText(entry.payload_ref, 2048).length < 1 ||
        (entry.destination_ref !== null && nullableText(entry.destination_ref, 2048) === null) ||
        availableAt < enqueuedAt ||
        enqueuedAt !== ledgerCommittedAt ||
        requiredInstant(entry.state_changed_at) !== enqueuedAt ||
        !["repeatable", "reconciliation_required"].includes(requiredText(entry.repeatability, 64)) ||
        requiredInteger(entry.attempt, 0) !== 0 ||
        entry.certainty !== "not_applied" ||
        requiredText(entry.decision_key, 1200) !== `enqueue:${requiredText(entry.kind, 64)}:${requiredText(entry.idempotency_key, 512)}` ||
        entry.method !== "enqueue" ||
        requiredHash(entry.decision_hash) !== requiredHash(entry.request_hash) ||
        entry.outcome !== "applied" ||
        requiredText(entry.decision_outbox_id, 512) !== outboxId ||
        requiredInteger(entry.decision_attempt, 0) !== 0
      ) {
        throw new CorruptSettlementState();
      }
      return outboxId;
    });
    if (outboxIds.length !== expectedOutboxCount) {
      throw new CorruptSettlementState();
    }
    const operationVersion = requiredInteger(row.operation_version, 2);
    const consumedThroughSourceSeq = requiredInteger(
      row.consumed_through_source_seq,
      0,
    );
    const committedAt = ledgerCommittedAt;
    const messageRowId = nullableInteger(row.message_row_id, 1);
    const terminal = this.database
      .query(
        `SELECT o.chat_jid,o.version,o.phase,o.terminal_disposition,
                o.terminal_message_row_id,o.terminal_error_code,
                o.terminal_committed_at,o.cancellation_source_seq
         FROM service_effect_s01_operations o
         WHERE o.operation_id=?`,
      )
      .get(operationId) as
      | {
          chat_jid?: unknown;
          version?: unknown;
          phase?: unknown;
          terminal_disposition?: unknown;
          terminal_message_row_id?: unknown;
          terminal_error_code?: unknown;
          terminal_committed_at?: unknown;
          cancellation_source_seq?: unknown;
        }
      | undefined;
    const terminalErrorCode = terminal
      ? nullableDiagnostic(terminal.terminal_error_code)
      : null;
    if (
      !terminal ||
      requiredText(terminal.chat_jid, 512) !== chatJid ||
      requiredInteger(terminal.version, 2) !== operationVersion ||
      terminal.phase !== "terminal" ||
      requiredDisposition(terminal.terminal_disposition) !== disposition ||
      nullableInteger(terminal.terminal_message_row_id, 1) !== messageRowId ||
      requiredInstant(terminal.terminal_committed_at) !== committedAt ||
      (disposition === "failed") !== (terminalErrorCode !== null) ||
      (disposition === "cancelled") !==
        (nullableInteger(terminal.cancellation_source_seq, 1) !== null)
    ) {
      throw new CorruptSettlementState();
    }
    const memberships = this.database
      .prepare(
        `SELECT s.source_seq,s.state,q.state queue_state
         FROM service_effect_s01_operation_sources os
         JOIN service_effect_s01_sources s
           ON s.chat_jid=os.chat_jid AND s.source_seq=os.source_seq
         LEFT JOIN service_effect_s01_queued_inputs q
           ON q.operation_id=os.operation_id AND q.source_seq=os.source_seq
         WHERE os.operation_id=? ORDER BY s.source_seq`,
      )
      .all(operationId) as Array<{
      source_seq?: unknown;
      state?: unknown;
      queue_state?: unknown;
    }>;
    if (
      memberships.length === 0 ||
      memberships.some((membership) => {
        requiredInteger(membership.source_seq, 1);
        return (
          (membership.state !== "consumed" && membership.state !== "disposed") ||
          (membership.queue_state !== null &&
            membership.queue_state !== undefined &&
            membership.queue_state !== membership.state)
        );
      })
    ) {
      throw new CorruptSettlementState();
    }
    const chat = this.database
      .prepare(
        `SELECT consumed_through_source_seq FROM service_effect_s01_chats
         WHERE chat_jid=?`,
      )
      .get(chatJid) as { consumed_through_source_seq?: unknown } | undefined;
    if (
      !chat ||
      requiredInteger(chat.consumed_through_source_seq, 0) <
        consumedThroughSourceSeq
    ) {
      throw new CorruptSettlementState();
    }
    const prefix = this.database
      .prepare(
        `SELECT count(*) n,min(source_seq) first,max(source_seq) last
         FROM service_effect_s01_sources
         WHERE chat_jid=? AND source_seq<=?`,
      )
      .get(chatJid, consumedThroughSourceSeq) as
      | { n?: unknown; first?: unknown; last?: unknown }
      | undefined;
    if (
      !prefix ||
      requiredInteger(prefix.n, 0) !== consumedThroughSourceSeq ||
      (consumedThroughSourceSeq > 0 &&
        (requiredInteger(prefix.first, 1) !== 1 ||
          requiredInteger(prefix.last, 1) !== consumedThroughSourceSeq))
    ) {
      throw new CorruptSettlementState();
    }
    return freezeCommit({
      operationId,
      operationVersion,
      disposition,
      messageRowId,
      consumedThroughSourceSeq,
      outboxIds,
      committedAt,
    });
  }

  private validateOwnership(operationId?: string): void {
    try {
      if (!this.runtime.validateOwnership) return;
      const observed: unknown = this.runtime.validateOwnership(operationId);
      if (observed === true) return;
      // Invalid asynchronous guards must be denied, but their rejections still need an observer.
      if ((typeof observed === "object" && observed !== null) || typeof observed === "function")
        void Promise.resolve(observed).then(() => undefined, () => undefined);
    } catch (error) {
      void error;
    }
    throw new SettlementAbort(settlementError("owner_conflict"));
  }

  private afterStatement(statement: TerminalSettlementStatement): void {
    this.checkpointOccurrence += 1;
    if (!this.runtime.checkpoint) return;
    try {
      const decision = this.runtime.checkpoint(statement, this.checkpointOccurrence);
      if (decision === false) return;
      throw new InjectedStatementRollback();
    } catch (error) {
      if (error instanceof InjectedStatementRollback) throw error;
      throw new InjectedStatementRollback();
    }
  }

  private caught(
    method: string,
    request: CommitTerminalRequest,
    error: unknown,
  ): ResultValue<never, TerminalSettlementError> {
    let mapped: TerminalSettlementError;
    if (error instanceof SettlementAbort) mapped = error.error;
    else if (error instanceof CorruptSettlementState) {
      mapped = settlementError("corrupt_state");
    } else if (error instanceof InjectedStatementRollback || isBusy(error)) {
      mapped = settlementError("storage_unavailable", "not_applied", true);
    } else {
      mapped = settlementError("storage_unavailable", "not_applied", true);
    }
    return this.failure(
      method,
      request.effect.idempotencyKey,
      request.effect.operationId,
      request.expectedVersion,
      mapped,
    );
  }

  private success(
    method: string,
    effectId: string,
    operationId: string | null,
    version: number | null,
    value: TerminalCommit,
    resultTag: string,
  ): ResultValue<TerminalCommit, never> {
    this.trace(method, effectId, operationId, version, resultTag, "applied");
    return Result.ok(value);
  }

  private failure(
    method: string,
    effectId: string,
    operationId: string | null,
    version: number | null,
    error: TerminalSettlementError,
  ): ResultValue<never, TerminalSettlementError> {
    this.trace(method, effectId, operationId, version, error._tag, error.certainty);
    return Result.err(error);
  }

  private trace(
    method: string,
    effectId: string,
    operationId: string | null,
    version: number | null,
    resultTag: string,
    certainty: TerminalSettlementError["certainty"] | null,
  ): void {
    try {
      this.runtime.recordTrace({
        contract: "EF-S02",
        method,
        effectId,
        operationId,
        sourceSeq: null,
        version,
        resultTag,
        certainty,
      });
    } catch (error) {
      void error;
    }
  }
}

type Reconciliation =
  | { readonly kind: "replay"; readonly commit: TerminalCommit }
  | { readonly kind: "error"; readonly error: TerminalSettlementError };

function validateConstruction(database: Database): void {
  const foreignKeys = database.query("PRAGMA foreign_keys").get() as
    | { foreign_keys?: number }
    | undefined;
  if (foreignKeys?.foreign_keys !== 1) throw new Error("foreign keys disabled");
  const objects = database
    .query(
      "SELECT name,type,sql FROM sqlite_master WHERE name IN (" +
        REQUIRED_SCHEMA.map(() => "?").join(",") +
        ")",
    )
    .all(...REQUIRED_SCHEMA) as Array<{
      name?: unknown;
      type?: unknown;
      sql?: unknown;
    }>;
  const tables = new Set(
    objects
      .filter(
        (row) =>
          row.type === "table" &&
          typeof row.sql === "string" &&
          row.sql.length > 0,
      )
      .map((row) => String(row.name)),
  );
  if (REQUIRED_SCHEMA.some((name) => !tables.has(name))) {
    throw new Error("schema");
  }
  const indexes = database
    .query(
      "SELECT name,sql FROM sqlite_master WHERE type='index' AND name IN (" +
        REQUIRED_INDEXES.map(() => "?").join(",") +
        ")",
    )
    .all(...REQUIRED_INDEXES) as Array<{ name?: unknown; sql?: unknown }>;
  const indexNames = new Set(
    indexes
      .filter((row) => typeof row.sql === "string" && row.sql.length > 0)
      .map((row) => String(row.name)),
  );
  if (REQUIRED_INDEXES.some((name) => !indexNames.has(name))) {
    throw new Error("indexes");
  }
  const triggers = database
    .query(
      "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN (?,?,?)",
    )
    .all(...REQUIRED_TRIGGERS) as Array<{ name?: unknown }>;
  const triggerNames = new Set(triggers.map((row) => String(row.name)));
  if (REQUIRED_TRIGGERS.some((name) => !triggerNames.has(name))) {
    throw new Error("triggers");
  }
  for (const sql of REQUIRED_SCHEMA_PROBES) database.query(sql).get();
  // Validate required tables, not unrelated historical application data.
  const foreignKeyViolations = database
    .query("PRAGMA foreign_key_check")
    .all()
    .filter((row) => tables.has((row as { table: string }).table));
  if (foreignKeyViolations.length !== 0) throw new Error("foreign key state");
  const quickCheck = database.query("PRAGMA quick_check").get() as
    | { quick_check?: unknown }
    | undefined;
  if (quickCheck?.quick_check !== "ok") throw new Error("database state");
}

function closeOperation(row: OperationRow): ClosedOperation {
  const phase = row.phase;
  if (typeof phase !== "string" || !PHASES.has(phase as PiclawOperationPhase)) {
    throw new CorruptSettlementState();
  }
  const harnessSessionId = nullableText(row.harness_session_id, 512);
  const harness =
    harnessSessionId === null
      ? null
      : Object.freeze({
          sessionId: harnessSessionId,
          harnessOperationId: nullableText(row.harness_operation_id, 512),
        });
  if (
    harnessSessionId === null &&
    [
      row.harness_operation_id,
    ].some((value) => value !== null)
  ) {
    throw new CorruptSettlementState();
  }
  const cancellationSourceId = nullableText(row.cancellation_source_id, 512);
  const cancellationSourceSeq = nullableInteger(row.cancellation_source_seq, 1);
  const cancellationCause = nullableText(row.cancellation_cause, 512);
  const cancellationRequestedAt =
    row.cancellation_requested_at === null
      ? null
      : requiredInstant(row.cancellation_requested_at);
  const cancellationFields = [
    cancellationSourceId,
    cancellationSourceSeq,
    cancellationCause,
    cancellationRequestedAt,
  ];
  if (
    cancellationFields.some((value) => value === null) &&
    cancellationFields.some((value) => value !== null)
  ) {
    throw new CorruptSettlementState();
  }
  const terminalDisposition =
    row.terminal_disposition === null
      ? null
      : requiredDisposition(row.terminal_disposition);
  if (
    terminalDisposition === null &&
    [row.terminal_message_row_id, row.terminal_error_code, row.terminal_committed_at].some(
      (value) => value !== null,
    )
  ) {
    throw new CorruptSettlementState();
  }
  return Object.freeze({
    operationId: requiredText(row.operation_id, 512),
    chatJid: requiredText(row.chat_jid, 512),
    version: requiredInteger(row.version, 1),
    primarySourceSeq: requiredInteger(row.primary_source_seq, 1),
    phase: phase as PiclawOperationPhase,
    cancellationSourceSeq,
    cancellationRequestedAt,
    harness,
    terminalDisposition,
    activeOperationId: nullableText(row.active_operation_id, 512),
    consumedThroughSourceSeq: requiredInteger(row.consumed_through_source_seq, 0),
    nextSourceSeq: requiredInteger(row.next_source_seq, 1),
  });
}

function dispositionAllowed(
  request: CommitTerminalRequest,
  operation: ClosedOperation,
): boolean {
  const cancellation = operation.cancellationSourceSeq !== null;
  switch (request.disposition) {
    case "completed":
      return operation.phase === "settling" && !cancellation && request.errorCode === null;
    case "cancelled":
      return (
        cancellation &&
        (operation.phase === "cancelling" || operation.phase === "settling") &&
        request.errorCode === null
      );
    case "failed":
      return (
        !cancellation &&
        request.errorCode !== null &&
        ["executing", "suspended", "cancelling", "settling"].includes(
          operation.phase,
        )
      );
    case "skipped":
      return (
        !cancellation &&
        request.errorCode === null &&
        request.terminalAuthorityRef !== null &&
        (operation.phase === "claimed" || operation.phase === "starting_harness") &&
        (operation.harness === null ||
          operation.harness.harnessOperationId === null)
      );
    case "superseded":
      return (
        !cancellation &&
        request.errorCode === null &&
        request.terminalAuthorityRef !== null &&
        ["claimed", "starting_harness", "suspended"].includes(operation.phase)
      );
  }
}

function equalHarness(
  left: HarnessCorrelation | null,
  right: HarnessCorrelation | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.sessionId === right.sessionId &&
    left.harnessOperationId === right.harnessOperationId
  );
}

function mapOutboxError(error: OutboxStoreError): TerminalSettlementError {
  if (error._tag === "idempotency_conflict") {
    return settlementError("idempotency_conflict");
  }
  if (error._tag === "storage_unavailable") {
    return settlementError(
      "storage_unavailable",
      error.certainty,
      error.retryable,
    );
  }
  return settlementError("corrupt_state");
}

function settlementError(
  tag: TerminalSettlementErrorTag,
  certainty: TerminalSettlementError["certainty"] = "not_applied",
  retryable = false,
  existing?: TerminalCommit,
): TerminalSettlementError {
  return Object.freeze({
    _tag: tag,
    certainty,
    retryable,
    ...(existing ? { existing } : {}),
  });
}

function freezeCommit(input: TerminalCommit): TerminalCommit {
  return Object.freeze({
    ...input,
    outboxIds: Object.freeze([...input.outboxIds]),
  });
}

function beforeEffectInjected(runtime: TerminalSettlementAdapterRuntime): boolean {
  try {
    const decision = runtime.hitFault("before_effect");
    if (decision === false) return false;
    return true;
  } catch (error) {
    void error;
    return true;
  }
}

function lostAcknowledgement(runtime: TerminalSettlementAdapterRuntime): boolean {
  try {
    return runtime.hitFault("effect_then_lost_acknowledgement") === true;
  } catch (error) {
    void error;
    return false;
  }
}

// Every use is singleton DML narrowed by a PK/unique predicate. The statement
// must report exactly one direct row; trigger work is validated independently.
function changedExactlyOne(changes: number): boolean {
  return Number.isSafeInteger(changes) && changes === 1;
}

function nullableDiagnostic(input: unknown): string | null {
  if (input === null) return null;
  const value = requiredText(input, 128);
  if (!/^[A-Za-z0-9_.:-]+$/.test(value)) {
    throw new CorruptSettlementState();
  }
  return value;
}

function requiredHash(input: unknown): string {
  const value = requiredText(input, 64);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new CorruptSettlementState();
  return value;
}

function requiredText(input: unknown, maxLength: number): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.trim().length === 0 ||
    input.length > maxLength
  ) {
    throw new CorruptSettlementState();
  }
  return input;
}

function nullableText(input: unknown, maxLength: number): string | null {
  return input === null ? null : requiredText(input, maxLength);
}

function requiredInteger(input: unknown, minimum: number): number {
  if (!Number.isSafeInteger(input) || (input as number) < minimum) {
    throw new CorruptSettlementState();
  }
  return input as number;
}

function nullableInteger(input: unknown, minimum: number): number | null {
  return input === null ? null : requiredInteger(input, minimum);
}

function requiredInstant(input: unknown): string {
  if (typeof input !== "string") throw new CorruptSettlementState();
  const milliseconds = Date.parse(input);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== input) {
    throw new CorruptSettlementState();
  }
  return input;
}

function requiredDisposition(input: unknown): PiclawDisposition {
  if (typeof input !== "string" || !DISPOSITIONS.has(input as PiclawDisposition)) {
    throw new CorruptSettlementState();
  }
  return input as PiclawDisposition;
}
