import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { CanonicalJsonValue, NormalisedEffectTrace, NormalisedTraceInput } from "../../src/service-effects/contracts/common.js";
import type { EffectPayloadResolver, ResolvedEffectPayload } from "../../src/service-effects/contracts/payload-resolver.js";
import { createServiceOutboxEnqueueInserter } from "../../src/service-effects/current-piclaw/service-outbox-store.js";
import { installTerminalSettlementCompositionSchema } from "../../src/service-effects/current-piclaw/terminal-settlement-schema.js";
import { createCurrentPiclawTerminalSettlementStore, type TerminalSettlementAdapterRuntime, type TerminalSettlementStatement } from "../../src/service-effects/current-piclaw/terminal-settlement-store.js";
import type { ContractSubjectFactory, ContractTestContext } from "../../src/service-effects/testing/contract-suite.js";
import type { TerminalSettlementContractSubject, TerminalSettlementDurableView, TerminalSettlementObserverBehavior, TerminalSettlementPayloadSeed } from "../../src/service-effects/testing/contract-suites/terminal-settlement-store-contract.js";
import { ManualEffectClock, SequenceEffectIdSource } from "../../src/service-effects/testing/deterministic-controls.js";
import { FakeTerminalSettlementStore, type FakeTerminalDraftSeed, type FakeTerminalOperationSeed } from "../../src/service-effects/testing/fakes/fake-terminal-settlement-store.js";
import { DeterministicFaultPlan } from "../../src/service-effects/testing/fault-plan.js";
import { EffectTraceRecorder } from "../../src/service-effects/testing/trace-recorder.js";

export function observerValue(behavior: TerminalSettlementObserverBehavior): unknown {
  if (behavior === "false") return false;
  if (behavior === "true") return true;
  if (behavior === "nonboolean") return "invalid";
  if (behavior === "thenable") return Object.freeze({ then() {} });
  return undefined;
}

export function context(): ContractTestContext {
  return {
    clock: new ManualEffectClock("2026-08-14T09:00:00.000Z"),
    ids: new SequenceEffectIdSource("s02"),
    faults: new DeterministicFaultPlan(),
  };
}

export class Payloads implements EffectPayloadResolver {
  readonly values = new Map<string, ResolvedEffectPayload>();
  readonly barriers = new Map<
    string,
    { started: () => void; wait: Promise<void>; release: () => void }
  >();
  resolutionCount = 0;

  constructor() {
    this.add("payload:terminal-content", "terminal content");
    this.add("payload:draft", "draft content");
  }

  add(
    ref: string,
    content: string,
    mediaType = "text/plain",
    redactionClass: ResolvedEffectPayload["redactionClass"] = "secret",
  ): void {
    const bytes = new TextEncoder().encode(content);
    this.values.set(
      ref,
      Object.freeze({
        ref,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
        mediaType,
        redactionClass,
        bytes,
      }),
    );
  }

  seed(seed: TerminalSettlementPayloadSeed): void {
    const bytes = new TextEncoder().encode(seed.content);
    this.values.set(
      seed.ref,
      Object.freeze({
        ref: seed.ref,
        sha256:
          seed.sha256 ?? createHash("sha256").update(bytes).digest("hex"),
        byteLength: seed.byteLength ?? bytes.byteLength,
        mediaType: seed.mediaType ?? "text/plain",
        redactionClass: seed.redactionClass ?? "secret",
        bytes,
      }),
    );
  }

  block(ref: string): { started: Promise<void>; release: () => void } {
    let signalStarted = () => {};
    let release = () => {};
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.barriers.set(ref, { started: signalStarted, wait, release });
    return { started, release };
  }

  async resolve(ref: string): Promise<ResolvedEffectPayload | null> {
    this.resolutionCount += 1;
    const barrier = this.barriers.get(ref);
    if (barrier) {
      barrier.started();
      await barrier.wait;
      this.barriers.delete(ref);
    }
    return this.values.get(ref) ?? null;
  }
}

export class Runtime implements TerminalSettlementAdapterRuntime {
  readonly trace: EffectTraceRecorder;
  readonly faults = new Map<string, Set<number>>();
  readonly faultCounts = new Map<string, number>();
  readonly statementFaults = new Set<number>();
  readonly statements: string[] = [];
  beforeValue: unknown = undefined;
  acknowledgementValue: unknown = undefined;
  throwBefore = false;
  throwAcknowledgement = false;
  checkpointValue: unknown = undefined;
  throwCheckpoint = false;

  constructor(snapshot: readonly NormalisedEffectTrace[] = []) {
    this.trace = EffectTraceRecorder.fromSnapshot(snapshot);
  }

  plan(
    point: "before_effect" | "effect_then_lost_acknowledgement",
    occurrence = 1,
  ): void {
    const current = this.faultCounts.get(point) ?? 0;
    this.faults.set(point, new Set([current + occurrence]));
  }

  hitFault(
    point: "before_effect" | "effect_then_lost_acknowledgement",
  ): unknown {
    if (point === "before_effect") {
      if (this.throwBefore) throw new Error("protected-before-fault");
      if (this.beforeValue !== undefined) return this.beforeValue;
    } else {
      if (this.throwAcknowledgement) throw new Error("protected-ack-fault");
      if (this.acknowledgementValue !== undefined) {
        return this.acknowledgementValue;
      }
    }
    const occurrence = (this.faultCounts.get(point) ?? 0) + 1;
    this.faultCounts.set(point, occurrence);
    return this.faults.get(point)?.delete(occurrence) ?? false;
  }

  checkpoint(
    statement: TerminalSettlementStatement,
    occurrence: number,
  ): unknown {
    if (occurrence === 1) this.statements.length = 0;
    this.statements.push(`${occurrence}:${statement}`);
    if (this.throwCheckpoint) throw new Error("protected-checkpoint-fault");
    if (this.checkpointValue !== undefined) return this.checkpointValue;
    return this.statementFaults.delete(occurrence);
  }

  recordTrace(input: NormalisedTraceInput): void {
    if (input.resultTag === "call") this.trace.recordCall(input);
    else this.trace.recordResult(input);
  }
}

export interface SqliteSubject extends TerminalSettlementContractSubject {
  readonly database: Database;
  readonly path: string;
  readonly runtime: Runtime;
  readonly payloads: Payloads;
  ownsDirectory: boolean;
}

export function openSqliteSubject(
  path: string,
  trace: readonly NormalisedEffectTrace[] = [],
  ownsDirectory = true,
): SqliteSubject {
  const database = new Database(path, { strict: true });
  database.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=0",
  );
  installTerminalSettlementCompositionSchema(database);
  const runtime = new Runtime(trace);
  const payloads = new Payloads();
  const made = createCurrentPiclawTerminalSettlementStore(
    database,
    payloads,
    runtime,
  );
  if (!made.ok) throw new Error("EF-S02 construction failed");

  return {
    database,
    path,
    runtime,
    payloads,
    ownsDirectory,
    store: made.value,
    seedOperation: (seed) => seedSqliteOperation(database, seed),
    seedDraft: (seed) => seedSqliteDraft(database, seed),
    seedMedia: (operationId, mediaId, role) =>
      seedSqliteMedia(database, operationId, mediaId, role),
    seedOutbox(request) {
      const inserter = createServiceOutboxEnqueueInserter(database);
      if (!inserter.ok) throw new Error("outbox seed construction");
      database.exec("BEGIN IMMEDIATE");
      const inserted = inserter.value.insert(request);
      if (!inserted.ok) {
        database.exec("ROLLBACK");
        throw new Error("outbox seed");
      }
      database.exec("COMMIT");
    },
    planFault: (point, occurrence) => runtime.plan(point, occurrence),
    planStatementFault(occurrence) {
      runtime.statementFaults.add(occurrence);
    },
    setFaultBehavior(point, behavior) {
      if (point === "before_effect") {
        runtime.throwBefore = behavior === "throw";
        runtime.beforeValue = observerValue(behavior);
      } else {
        runtime.throwAcknowledgement = behavior === "throw";
        runtime.acknowledgementValue = observerValue(behavior);
      }
    },
    setCheckpointBehavior(behavior) {
      runtime.throwCheckpoint = behavior === "throw";
      runtime.checkpointValue = observerValue(behavior);
    },
    seedPayload: (seed) => payloads.seed(seed),
    mutatePayloadBytes(ref, byte) {
      const payload = payloads.values.get(ref);
      if (!payload) throw new Error("missing payload mutation target");
      payload.bytes.fill(byte);
    },
    blockPayload: (ref) => payloads.block(ref),
    holdWriterLock() {
      if (path === ":memory:") {
        runtime.beforeValue = true;
        return { release: () => (runtime.beforeValue = false) };
      }
      const blocker = new Database(path, { strict: true });
      blocker.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=50; BEGIN IMMEDIATE");
      return {
        release() {
          if (blocker.inTransaction) blocker.exec("ROLLBACK");
          blocker.close();
        },
      };
    },
    removePayload: (ref) => payloads.values.delete(ref),
    payloadResolutionCount: () => payloads.resolutionCount,
    inspectStatements: () => [...runtime.statements],
    corruptCommitRequestHash(operationId) {
      database.exec("PRAGMA ignore_check_constraints=ON");
      database
        .prepare(
          "UPDATE service_effect_s02_commits SET request_hash='malformed' WHERE operation_id=?",
        )
        .run(operationId);
    },
    inspectDurable: (operationId) =>
      inspectSqlite(database, operationId ?? "operation-1"),
    dispose() {
      if (database.open) database.close();
      if (this.ownsDirectory) {
        rmSync(dirname(path), { recursive: true, force: true });
      }
    },
  };
}

export const sqliteFactory: ContractSubjectFactory<TerminalSettlementContractSubject> =
  {
    name: "current-piclaw-terminal-settlement",
    create() {
      const directory = mkdtempSync(join(tmpdir(), "piclaw-s02-"));
      return openSqliteSubject(join(directory, "store.sqlite"));
    },
    crashAndRestore(subject) {
      const old = subject as SqliteSubject;
      const trace = old.runtime.trace.snapshot();
      old.database.close();
      old.ownsDirectory = false;
      return {
        subject: openSqliteSubject(old.path, trace, true),
        context: context(),
      };
    },
    inspectTrace(subject) {
      return (subject as SqliteSubject).runtime.trace.inspect();
    },
  };

export const fakeFactory: ContractSubjectFactory<TerminalSettlementContractSubject> = {
  name: "fake-terminal-settlement",
  create() {
    return fakeSubject(new FakeTerminalSettlementStore());
  },
  crashAndRestore(subject) {
    const old = subject.store as FakeTerminalSettlementStore;
    const store = new FakeTerminalSettlementStore();
    store.restore(old.snapshot());
    return { subject: fakeSubject(store), context: context() };
  },
  inspectTrace(subject) {
    return (subject.store as FakeTerminalSettlementStore).trace.inspect();
  },
};

export function fakeSubject(
  store: FakeTerminalSettlementStore,
): TerminalSettlementContractSubject {
  return {
    store,
    seedOperation: (seed) => store.seedOperation(seed),
    seedDraft: (seed) => store.seedDraft(seed),
    seedMedia: (operationId, mediaId, role) =>
      store.seedMedia(operationId, mediaId, role),
    seedOutbox: (request) => store.seedOutbox(request),
    planFault: (point, occurrence) => store.planFault(point, occurrence),
    planStatementFault: (occurrence) => store.planStatementFault(occurrence),
    setFaultBehavior(point, behavior) {
      if (behavior === "throw") store.setFaultThrow(point);
      else store.setFaultObservation(point, observerValue(behavior));
    },
    setCheckpointBehavior(behavior) {
      if (behavior === "throw") store.setCheckpointThrow();
      else store.setCheckpointObservation(observerValue(behavior));
    },
    seedPayload: (seed) => store.seedResolvedPayload(seed),
    mutatePayloadBytes: (ref, byte) => store.mutatePayloadBytes(ref, byte),
    blockPayload: (ref) => store.blockPayload(ref),
    holdWriterLock() {
      store.setFaultObservation("before_effect", true);
      return {
        release: () => store.setFaultObservation("before_effect", false),
      };
    },
    removePayload: (ref) => store.removePayload(ref),
    payloadResolutionCount: () => store.payloadResolutionCount(),
    inspectStatements: () => store.inspectStatements(),
    corruptCommitRequestHash: (operationId) =>
      store.corruptCommitRequestHash(operationId),
    inspectDurable: (operationId) =>
      inspectFake(store, operationId ?? "operation-1"),
  };
}

export function seedSqliteOperation(
  database: Database,
  seed: FakeTerminalOperationSeed,
): void {
  const maximum = Math.max(...seed.sources.map((source) => source.sourceSeq));
  database.transaction(() => {
    database
      .query(
        `INSERT INTO service_effect_s01_chats(
           chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id
         ) VALUES (?,?,?,NULL)`,
      )
      .run(seed.chatJid, maximum + 1, seed.consumedThroughSourceSeq ?? 0);
    for (const source of seed.sources) {
      database
        .query(
          `INSERT INTO service_effect_s01_sources(
             chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,
             target_operation_id,parent_source_seq,accepted_at,disposition_reason,
             provenance_ref,create_wake_intent
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          seed.chatJid,
          source.sourceSeq,
          `source-${source.sourceSeq}`,
          "a".repeat(64),
          source.kind ?? "message",
          source.state,
          `payload:source-${source.sourceSeq}`,
          null,
          null,
          source.acceptedAt ?? "2026-08-14T09:00:00.000Z",
          source.state === "consumed" || source.state === "disposed"
            ? "seed-closed"
            : null,
          "opaque:source-provenance",
          0,
        );
    }
    const primary =
      seed.sources.find((source) => source.sourceSeq === seed.primarySourceSeq) ??
      seed.sources.find((source) => source.operationId === seed.operationId) ??
      seed.sources[0];
    if (!primary) throw new Error("operation requires source");
    const harness = seed.harness ?? null;
    database
      .query(
        `INSERT INTO service_effect_s01_operations(
           operation_id,chat_jid,version,phase,primary_source_seq,
           cancellation_source_id,cancellation_source_seq,cancellation_cause,
           cancellation_requested_at,harness_session_id,harness_operation_id,
           terminal_disposition,terminal_message_row_id,terminal_error_code,
           terminal_committed_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        seed.operationId,
        seed.chatJid,
        seed.version,
        seed.phase,
        primary.sourceSeq,
        seed.cancellationSourceSeq == null ? null : `source-${seed.cancellationSourceSeq}`,
        seed.cancellationSourceSeq ?? null,
        seed.cancellationSourceSeq == null ? null : "user",
        seed.cancellationSourceSeq == null
          ? null
          : seed.cancellationRequestedAt ?? "2026-08-14T09:30:00.000Z",
        harness?.sessionId ?? null,
        harness?.harnessOperationId ?? null,
        null,
        null,
        null,
        null,
      );
    for (const source of seed.sources.filter(
      (entry) => entry.operationId === seed.operationId,
    )) {
      database
        .query(
          `INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq)
           VALUES (?,?,?)`,
        )
        .run(seed.chatJid, seed.operationId, source.sourceSeq);
      database
        .query(
          `UPDATE service_effect_s01_sources SET target_operation_id=?
           WHERE chat_jid=? AND source_seq=?`,
        )
        .run(seed.operationId, seed.chatJid, source.sourceSeq);
      if (source.queuedState) {
        database
          .query(
            `INSERT INTO service_effect_s01_queued_inputs(
               chat_jid,operation_id,source_seq,queue_kind,harness_entry_id,state
             ) VALUES (?,?,?,?,?,?)`,
          )
          .run(
            seed.chatJid,
            seed.operationId,
            source.sourceSeq,
            "steer",
            "harness-entry",
            source.queuedState,
          );
      }
    }
    database
      .query(
        "UPDATE service_effect_s01_chats SET active_operation_id=? WHERE chat_jid=?",
      )
      .run(seed.activeOperationId ?? seed.operationId, seed.chatJid);
  }).immediate();
}

export function seedSqliteDraft(database: Database, seed: FakeTerminalDraftSeed): void {
  const writtenAt = seed.writtenAt ?? "2026-08-14T09:00:00.000Z";
  database.transaction(() => {
    database
      .query(
        `INSERT INTO chats(jid,name,last_message_time) VALUES (?,?,?)
         ON CONFLICT(jid) DO NOTHING`,
      )
      .run(seed.chatJid, seed.chatJid, writtenAt);
    database
      .query(
        `INSERT INTO messages(
           rowid,id,chat_jid,sender,sender_name,content,thread_id,timestamp,
           is_from_me,is_bot_message,is_terminal_agent_reply
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        seed.rowId,
        `service-draft:${seed.operationId}:${seed.revision}`,
        seed.chatJid,
        "web-agent",
        "Piclaw",
        "draft content",
        seed.threadId,
        writtenAt,
        0,
        1,
        0,
      );
    for (const mediaId of seed.mediaIds ?? []) {
      database
        .prepare(
          "INSERT INTO message_media(message_rowid,media_id) VALUES (?,?)",
        )
        .run(seed.rowId, mediaId);
    }
    if ((seed.mediaIds?.length ?? 0) > 0) {
      const mediaText = (seed.mediaIds ?? [])
        .map((mediaId) => `media-${mediaId}-text`)
        .join("\n");
      database
        .prepare(
          `INSERT INTO messages_fts(
             messages_fts,rowid,content,chat_jid,sender,sender_name,timestamp,is_bot_message
           ) VALUES ('delete',?,?,?,?,?,?,?)`,
        )
        .run(
          seed.rowId,
          "draft content",
          seed.chatJid,
          "web-agent",
          "Piclaw",
          writtenAt,
          1,
        );
      database
        .prepare(
          `INSERT INTO messages_fts(
             rowid,content,chat_jid,sender,sender_name,timestamp,is_bot_message
           ) VALUES (?,?,?,?,?,?,?)`,
        )
        .run(
          seed.rowId,
          `draft content\n\n${mediaText}`,
          seed.chatJid,
          "web-agent",
          "Piclaw",
          writtenAt,
          1,
        );
    }
    database
      .query(
        `INSERT INTO service_effect_timeline_writes(
           idempotency_key,request_hash,write_type,operation_id,draft_kind,
           revision,notice_kind,source_id,message_rowid,chat_jid,written_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        `draft-key:${seed.operationId}:${seed.revision}`,
        "b".repeat(64),
        "draft",
        seed.operationId,
        "assistant",
        seed.revision,
        null,
        null,
        seed.rowId,
        seed.chatJid,
        writtenAt,
      );
  }).immediate();
}

export function seedSqliteMedia(
  database: Database,
  operationId: string,
  mediaId: number,
  role = "terminal",
): void {
  database.transaction(() => {
    database
      .query(
        "INSERT INTO media(id,filename,content_type,data) VALUES (?,?,?,?)",
      )
      .run(
        mediaId,
        `media-${mediaId}.txt`,
        "text/plain",
        new TextEncoder().encode(`media-${mediaId}-text`),
      );
    database
      .query(
        `INSERT INTO service_effect_media_uploads(
           idempotency_key,request_hash,upload_id,media_id,sha256,byte_length,
           data_ref,thumbnail_ref,metadata_ref,created_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        `upload-key:${mediaId}`,
        "c".repeat(64),
        `upload-${mediaId}`,
        mediaId,
        "d".repeat(64),
        1,
        `payload:media-${mediaId}`,
        null,
        null,
        "2026-08-14T09:00:00.000Z",
      );
    database
      .query(
        `INSERT INTO service_effect_operation_media(
           idempotency_key,request_hash,operation_id,media_id,role,bound_at
         ) VALUES (?,?,?,?,?,?)`,
      )
      .run(
        `bind-key:${mediaId}`,
        "e".repeat(64),
        operationId,
        mediaId,
        role,
        "2026-08-14T09:00:00.000Z",
      );
  }).immediate();
}

export function inspectSqlite(
  database: Database,
  operationId: string,
): TerminalSettlementDurableView {
  const operation = database
    .query(
      `SELECT o.operation_id,o.phase,o.version,o.terminal_disposition,
              o.terminal_message_row_id,c.active_operation_id,
              c.consumed_through_source_seq
       FROM service_effect_s01_operations o
       JOIN service_effect_s01_chats c ON c.chat_jid=o.chat_jid
       WHERE o.operation_id=?`,
    )
    .get(operationId) as
    | {
        operation_id: string;
        phase: string;
        version: number;
        terminal_disposition: string | null;
        terminal_message_row_id: number | null;
        active_operation_id: string | null;
        consumed_through_source_seq: number;
      }
    | undefined;
  const sources = database
    .query(
      `SELECT s.source_seq,s.state,q.state queued_state
       FROM service_effect_s01_sources s
       LEFT JOIN service_effect_s01_queued_inputs q
         ON q.chat_jid=s.chat_jid AND q.source_seq=s.source_seq
       WHERE s.chat_jid=(SELECT chat_jid FROM service_effect_s01_operations WHERE operation_id=?)
       ORDER BY s.source_seq`,
    )
    .all(operationId) as Array<{
    source_seq: number;
    state: string;
    queued_state: string | null;
  }>;
  const messageRows = database
    .query(
      `SELECT rowid,thread_id,is_terminal_agent_reply,content,content_blocks
       FROM messages
       WHERE chat_jid=(SELECT chat_jid FROM service_effect_s01_operations WHERE operation_id=?)
       ORDER BY rowid`,
    )
    .all(operationId) as Array<{
    rowid: number;
    thread_id: number | null;
    is_terminal_agent_reply: number;
    content: string;
    content_blocks: string | null;
  }>;
  const messages = messageRows.map((row) => ({
    rowId: row.rowid,
    terminal: row.is_terminal_agent_reply === 1,
    threadId: row.thread_id,
    content: row.content,
    contentBlocks:
      row.content_blocks === null
        ? null
        : (JSON.parse(row.content_blocks) as CanonicalJsonValue),
    mediaIds: (
      database
        .query(
          "SELECT media_id FROM message_media WHERE message_rowid=? ORDER BY media_id",
        )
        .all(row.rowid) as Array<{ media_id: number }>
    ).map((entry) => entry.media_id),
  }));
  return {
    operation: operation
      ? {
          operationId: operation.operation_id,
          phase: operation.phase,
          version: operation.version,
          activeOperationId: operation.active_operation_id,
          disposition: operation.terminal_disposition,
          messageRowId: operation.terminal_message_row_id,
          consumedThroughSourceSeq: operation.consumed_through_source_seq,
        }
      : null,
    sources: sources.map((row) => ({
      sourceSeq: row.source_seq,
      state: row.state,
      queuedState: row.queued_state,
    })),
    messages,
    outboxIds: (
      database
        .query("SELECT outbox_id FROM service_effect_s05_outbox ORDER BY outbox_id")
        .all() as Array<{ outbox_id: string }>
    ).map((row) => row.outbox_id),
    commitCount: (
      database
        .query(
          "SELECT count(*) n FROM service_effect_s02_commits WHERE operation_id=?",
        )
        .get(operationId) as { n: number }
    ).n,
    projectionCount: 0,
  };
}

export function inspectFake(
  store: FakeTerminalSettlementStore,
  operationId: string,
): TerminalSettlementDurableView {
  const state = store.inspectDurable();
  const operation = state.operations.find(
    (entry) => entry.operationId === operationId,
  );
  const chatJid = operation?.chatJid;
  return {
    operation: operation
      ? {
          operationId: operation.operationId,
          phase: operation.phase,
          version: operation.version,
          activeOperationId: operation.activeOperationId,
          disposition: operation.terminalDisposition,
          messageRowId: operation.terminalMessageRowId,
          consumedThroughSourceSeq: operation.consumedThroughSourceSeq,
        }
      : null,
    sources: state.sources
      .filter((entry) => entry.chatJid === chatJid)
      .sort((left, right) => left.sourceSeq - right.sourceSeq)
      .map((entry) => ({
        sourceSeq: entry.sourceSeq,
        state: entry.state,
        queuedState: entry.queuedState,
      })),
    messages: state.messages
      .filter((entry) => entry.chatJid === chatJid)
      .map((entry) => ({
        rowId: entry.rowId,
        terminal: entry.terminal,
        threadId: entry.threadId,
        content: entry.content,
        contentBlocks: entry.contentBlocks,
        mediaIds: [...entry.mediaIds],
      })),
    outboxIds: state.outbox.map((entry) => entry.outboxId).sort(),
    commitCount: state.decisions.filter(
      (entry) => entry.operationId === operationId,
    ).length,
    projectionCount: 0,
  };
}
