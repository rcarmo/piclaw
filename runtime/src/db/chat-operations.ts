/** Durable accepted-source registry, active operation projection and terminal ledger. */

import type { NewMessage } from "../types.js";
import { getDb } from "./connection.js";
import { storeMessage } from "./messages.js";

export const CHAT_OPERATION_PHASES = ["pending", "preflight", "running", "waiting", "blocked"] as const;
export type ChatOperationPhase = (typeof CHAT_OPERATION_PHASES)[number];

export const CHAT_SOURCE_CLASSES = ["prompt", "control", "intent"] as const;
export type ChatSourceClass = (typeof CHAT_SOURCE_CLASSES)[number];

export const CHAT_SOURCE_KINDS = ["message", "queued_followup", "protected_continuation", "goal_continuation", "command", "steer"] as const;
export type ChatSourceKind = (typeof CHAT_SOURCE_KINDS)[number];

export const CHAT_OPERATION_OUTCOMES = [
  "succeeded", "tool_complete", "failed", "interrupted", "cancelled", "skipped", "dead_lettered",
] as const;
export type ChatOperationOutcome = (typeof CHAT_OPERATION_OUTCOMES)[number];

export interface AcceptedChatSource {
  sourceSeq: number;
  chatJid: string;
  sourceClass: ChatSourceClass;
  sourceKind: ChatSourceKind;
  sourceId: string;
  acceptedAt: string;
  selectable: boolean;
  payloadRef: string;
  frontierMessageId: string | null;
  frontierCursorTs: string | null;
  operationId: string | null;
}

export interface ChatOperationCancellation { cause: string; requestedAt: string }

export interface ChatOperationState {
  chatJid: string;
  operationId: string;
  sourceSeq: number;
  phase: ChatOperationPhase;
  generation: number;
  cancellation: ChatOperationCancellation | null;
}

export interface ChatOperationOwner {
  operationId: string;
  sourceSeq: number;
  phase: ChatOperationPhase;
  generation: number;
}

export type ChatOperationMismatch =
  | "no_operation"
  | "operation_id_mismatch"
  | "source_mismatch"
  | "phase_mismatch"
  | "generation_mismatch";

export type ChatOperationRejection = ChatOperationMismatch | "invalid_transition" | "operation_cancelled";

export interface ChatOperationDisposition {
  sourceSeq: number;
  operationId: string;
  chatJid: string;
  sourceClass: ChatSourceClass;
  sourceKind: ChatSourceKind;
  sourceId: string;
  outcome: ChatOperationOutcome;
  cause: string;
  provenance: string;
  terminalMessageChatJid: string | null;
  terminalMessageId: string | null;
  createdAt: string;
}

export type ChatOperationTransitionResult =
  | { status: "applied"; operation: ChatOperationState }
  | { status: "rejected"; reason: ChatOperationRejection; operation: ChatOperationState | null };

export type ChatOperationClaimResult =
  | { status: "claimed" | "existing"; operation: ChatOperationState; source: AcceptedChatSource }
  | { status: "none" | "legacy_conflict"; operation: null; source: null };

export type ChatOperationCancelResult =
  | { status: "applied"; operation: ChatOperationState }
  | { status: "unchanged"; reason: "already_cancelled"; operation: ChatOperationState }
  | { status: "rejected"; reason: ChatOperationMismatch; operation: ChatOperationState | null };

export type ChatOperationCompletionResult =
  | { status: "completed" | "repeated"; disposition: ChatOperationDisposition }
  | { status: "rejected"; reason: ChatOperationMismatch | "cancelled_outcome_required" | "cancellation_required"; operation: ChatOperationState | null };

export type ChatOperationMessageBindResult =
  | { status: "bound" }
  | { status: "rejected"; reason: ChatOperationMismatch | "message_missing" | "message_operation_mismatch" };

export type ChatOperationCompletionBoundary = "artifact" | "successor" | "intents" | "disposition" | "frontier" | "release";
export interface ChatOperationCompletionHooks {
  /** Synchronous transactional revalidation. Throwing rolls back every write. */
  beforeWrite?(): void;
  afterWrite?(boundary: ChatOperationCompletionBoundary): void;
}

export class ChatOperationInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatOperationInvariantError";
  }
}

const LEGAL_TRANSITIONS: Readonly<Record<ChatOperationPhase, ReadonlySet<ChatOperationPhase>>> = {
  pending: new Set(["preflight", "blocked"]),
  preflight: new Set(["running", "waiting", "blocked"]),
  running: new Set(["waiting", "blocked"]),
  waiting: new Set(["running", "blocked"]),
  blocked: new Set(["pending"]),
};

function isValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

export function isLegalChatOperationTransition(from: ChatOperationPhase, to: ChatOperationPhase): boolean {
  return LEGAL_TRANSITIONS[from].has(to);
}

export function compareChatOperationOwner(
  operation: ChatOperationState | null,
  expected: ChatOperationOwner,
): { ok: true } | { ok: false; reason: ChatOperationMismatch } {
  if (!operation) return { ok: false, reason: "no_operation" };
  if (operation.operationId !== expected.operationId) return { ok: false, reason: "operation_id_mismatch" };
  if (operation.sourceSeq !== expected.sourceSeq) return { ok: false, reason: "source_mismatch" };
  if (operation.phase !== expected.phase) return { ok: false, reason: "phase_mismatch" };
  if (operation.generation !== expected.generation) return { ok: false, reason: "generation_mismatch" };
  return { ok: true };
}

export function transitionChatOperationState(
  operation: ChatOperationState,
  expected: ChatOperationOwner,
  phase: ChatOperationPhase,
): ChatOperationTransitionResult {
  const comparison = compareChatOperationOwner(operation, expected);
  if (!comparison.ok) return { status: "rejected", reason: comparison.reason, operation };
  if (operation.cancellation) return { status: "rejected", reason: "operation_cancelled", operation };
  if (!isLegalChatOperationTransition(operation.phase, phase)) {
    return { status: "rejected", reason: "invalid_transition", operation };
  }
  return { status: "applied", operation: { ...operation, phase, generation: operation.generation + 1 } };
}

export type TerminalArtifactPolicy = "required" | "optional" | "none";
export function chatOperationTerminalArtifactPolicy(source: AcceptedChatSource, outcome: ChatOperationOutcome): TerminalArtifactPolicy {
  if (source.sourceClass === "intent") return "none";
  if (outcome === "cancelled" || outcome === "skipped" || outcome === "dead_lettered") return "none";
  return source.sourceClass === "prompt" ? "required" : "optional";
}

interface SourceRow {
  source_seq: number; chat_jid: string; source_class: string; source_kind: string; source_id: string;
  accepted_at: string; selectable: number; payload_ref: string; frontier_message_id: string | null;
  frontier_cursor_ts: string | null; operation_id: string | null;
}
interface OperationRow {
  chat_jid: string; operation_id: string | null; operation_source_seq: number | null;
  operation_phase: string | null; operation_generation: number | null;
  operation_cancel_cause: string | null; operation_cancel_requested_at: string | null;
}
interface DispositionRow {
  source_seq: number; operation_id: string; chat_jid: string; source_class: string; source_kind: string;
  source_id: string; outcome: string; cause: string; provenance: string;
  terminal_message_chat_jid: string | null; terminal_message_id: string | null; created_at: string;
}

function sourceFromRow(row: SourceRow): AcceptedChatSource {
  if (!isValue(CHAT_SOURCE_CLASSES, row.source_class) || !isValue(CHAT_SOURCE_KINDS, row.source_kind)) {
    throw new ChatOperationInvariantError(`Invalid accepted source ${row.source_seq}`);
  }
  return {
    sourceSeq: row.source_seq, chatJid: row.chat_jid, sourceClass: row.source_class, sourceKind: row.source_kind,
    sourceId: row.source_id, acceptedAt: row.accepted_at, selectable: row.selectable === 1,
    payloadRef: row.payload_ref, frontierMessageId: row.frontier_message_id,
    frontierCursorTs: row.frontier_cursor_ts, operationId: row.operation_id,
  };
}

function dispositionFromRow(row: DispositionRow | null | undefined): ChatOperationDisposition | null {
  if (!row) return null;
  if (!isValue(CHAT_SOURCE_CLASSES, row.source_class) || !isValue(CHAT_SOURCE_KINDS, row.source_kind)
    || !isValue(CHAT_OPERATION_OUTCOMES, row.outcome)) {
    throw new ChatOperationInvariantError(`Invalid disposition for source ${row.source_seq}`);
  }
  return {
    sourceSeq: row.source_seq, operationId: row.operation_id, chatJid: row.chat_jid,
    sourceClass: row.source_class, sourceKind: row.source_kind, sourceId: row.source_id,
    outcome: row.outcome, cause: row.cause, provenance: row.provenance,
    terminalMessageChatJid: row.terminal_message_chat_jid, terminalMessageId: row.terminal_message_id,
    createdAt: row.created_at,
  };
}

function operationFromRow(row: OperationRow | null | undefined): ChatOperationState | null {
  if (!row?.operation_id) return null;
  if (!row.operation_source_seq || !isValue(CHAT_OPERATION_PHASES, row.operation_phase)
    || !Number.isInteger(row.operation_generation) || row.operation_generation! < 0) {
    throw new ChatOperationInvariantError(`Invalid active operation for ${row.chat_jid}`);
  }
  const hasCause = row.operation_cancel_cause !== null;
  const hasTime = row.operation_cancel_requested_at !== null;
  if (hasCause !== hasTime) throw new ChatOperationInvariantError(`Partial cancellation for ${row.chat_jid}`);
  return {
    chatJid: row.chat_jid, operationId: row.operation_id, sourceSeq: row.operation_source_seq,
    phase: row.operation_phase, generation: row.operation_generation!,
    cancellation: hasCause ? { cause: row.operation_cancel_cause!, requestedAt: row.operation_cancel_requested_at! } : null,
  };
}

export function registerAcceptedChatSource(input: {
  chatJid: string; sourceClass: ChatSourceClass; sourceKind: ChatSourceKind; sourceId: string;
  acceptedAt: string; payloadRef: string; operationId?: string | null;
  frontier?: { messageId: string; cursorTs: string };
}): { status: "registered" | "existing"; source: AcceptedChatSource } {
  if (input.sourceClass === "intent") throw new Error("Use registerChatOperationIntent for operation-bound intent acceptance");
  if (input.sourceClass === "prompt" && input.sourceKind === "protected_continuation") {
    throw new Error("Protected continuations can only be registered by atomic operation completion");
  }
  if (input.sourceClass === "prompt" && input.sourceKind !== "message" && input.sourceKind !== "queued_followup") {
    throw new Error("Prompt sources must be messages or queued follow-ups");
  }
  if (input.sourceClass === "control" && input.sourceKind !== "command") {
    throw new Error("Control sources must be commands");
  }
  const selectable = 1;
  if (input.operationId) throw new Error("Selectable source cannot bind operation before claim");
  if (input.sourceKind === "message") {
    if (!getDb().inTransaction) throw new Error("Message sources must be stored and accepted atomically");
    if (!input.frontier || input.frontier.messageId !== input.sourceId) throw new Error("Message source requires its stable frontier message identity");
    const message = getDb().prepare("SELECT timestamp FROM messages WHERE chat_jid = ? AND id = ?")
      .get(input.chatJid, input.frontier.messageId) as { timestamp: string } | undefined;
    if (!message || message.timestamp !== input.frontier.cursorTs) {
      throw new Error(`Message frontier must match the durable accepted message (${message?.timestamp ?? "missing"})`);
    }
  } else if (input.frontier) {
    throw new Error("Only message sources can advance the compatibility message cursor");
  }
  for (const value of [input.chatJid, input.sourceId, input.acceptedAt, input.payloadRef]) {
    if (!value.trim()) throw new Error("Accepted source fields must be non-empty");
  }
  const result = getDb().prepare(`
    INSERT INTO chat_accepted_sources
      (chat_jid, source_class, source_kind, source_id, accepted_at, selectable, payload_ref,
       frontier_message_id, frontier_cursor_ts, operation_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_jid, source_kind, source_id) DO NOTHING
  `).run(input.chatJid, input.sourceClass, input.sourceKind, input.sourceId, input.acceptedAt,
    selectable, input.payloadRef, input.frontier?.messageId ?? null, input.frontier?.cursorTs ?? null, input.operationId ?? null);
  const row = getDb().prepare(`SELECT * FROM chat_accepted_sources WHERE chat_jid = ? AND source_kind = ? AND source_id = ?`)
    .get(input.chatJid, input.sourceKind, input.sourceId) as SourceRow;
  const source = sourceFromRow(row);
  if (source.sourceClass !== input.sourceClass || source.acceptedAt !== input.acceptedAt
    || source.payloadRef !== input.payloadRef || source.selectable !== true
    || source.frontierMessageId !== (input.frontier?.messageId ?? null)
    || source.frontierCursorTs !== (input.frontier?.cursorTs ?? null)) {
    throw new ChatOperationInvariantError("Accepted source identity was reused with different immutable fields");
  }
  return { status: result.changes > 0 ? "registered" : "existing", source };
}

export function acceptStoredChatMessageSource(chatJid: string, messageRowId: number): { status: "registered" | "existing"; source: AcceptedChatSource } {
  const db = getDb();
  const accept = () => {
    const message = db.prepare("SELECT id, timestamp FROM messages WHERE chat_jid = ? AND rowid = ?")
      .get(chatJid, messageRowId) as { id: string; timestamp: string } | undefined;
    if (!message) throw new ChatOperationInvariantError("Accepted web message row is missing");
    return registerAcceptedChatSource({ chatJid, sourceClass: "prompt", sourceKind: "message",
      sourceId: message.id, acceptedAt: message.timestamp, payloadRef: `message:${message.id}`,
      frontier: { messageId: message.id, cursorTs: message.timestamp } });
  };
  return db.inTransaction ? accept() : db.transaction(accept).immediate();
}

export function storeAcceptedChatMessageSource(message: NewMessage, acceptedAt = message.timestamp): { status: "registered" | "existing"; source: AcceptedChatSource } {
  const db = getDb();
  return db.transaction(() => {
    const existingRow = db.prepare(`SELECT * FROM chat_accepted_sources
      WHERE chat_jid = ? AND source_kind = 'message' AND source_id = ?`)
      .get(message.chat_jid, message.id) as SourceRow | undefined;
    if (existingRow) {
      const source = sourceFromRow(existingRow);
      const persisted = db.prepare("SELECT timestamp FROM messages WHERE chat_jid = ? AND id = ?")
        .get(message.chat_jid, message.id) as { timestamp: string } | undefined;
      if (!persisted || source.sourceClass !== "prompt" || source.acceptedAt !== acceptedAt
        || source.payloadRef !== `message:${message.id}` || source.frontierMessageId !== message.id
        || source.frontierCursorTs !== persisted.timestamp) {
        throw new ChatOperationInvariantError("Accepted message source identity was reused with different immutable fields");
      }
      return { status: "existing", source } as const;
    }
    const alreadyStored = db.prepare("SELECT timestamp FROM messages WHERE chat_jid = ? AND id = ?")
      .get(message.chat_jid, message.id) as { timestamp: string } | undefined;
    if (!alreadyStored) storeMessage(message);
    const persisted = alreadyStored ?? db.prepare("SELECT timestamp FROM messages WHERE chat_jid = ? AND id = ?")
      .get(message.chat_jid, message.id) as { timestamp: string };
    return registerAcceptedChatSource({ chatJid: message.chat_jid, sourceClass: "prompt", sourceKind: "message",
      sourceId: message.id, acceptedAt, payloadRef: `message:${message.id}`,
      frontier: { messageId: message.id, cursorTs: persisted.timestamp } });
  }).immediate();
}

export function registerChatOperationIntent(chatJid: string, expected: ChatOperationOwner, input: {
  sourceKind: "steer"; sourceId: string; acceptedAt: string; payloadRef: string;
}): { status: "registered" | "existing"; source: AcceptedChatSource } | { status: "rejected"; reason: ChatOperationMismatch | "operation_cancelled" } {
  for (const value of [chatJid, input.sourceId, input.acceptedAt, input.payloadRef]) {
    if (!value.trim()) throw new Error("Accepted intent fields must be non-empty");
  }
  const db = getDb();
  return db.transaction(() => {
    const active = getChatOperation(chatJid);
    const comparison = compareChatOperationOwner(active, expected);
    if (!comparison.ok) return { status: "rejected", reason: comparison.reason } as const;
    if (active!.cancellation) return { status: "rejected", reason: "operation_cancelled" } as const;
    const inserted = db.prepare(`INSERT INTO chat_accepted_sources
      (chat_jid, source_class, source_kind, source_id, accepted_at, selectable, payload_ref,
       frontier_message_id, frontier_cursor_ts, operation_id)
      VALUES (?, 'intent', ?, ?, ?, 0, ?, NULL, NULL, ?)
      ON CONFLICT(chat_jid, source_kind, source_id) DO NOTHING`)
      .run(chatJid, input.sourceKind, input.sourceId, input.acceptedAt, input.payloadRef, active!.operationId);
    const source = sourceFromRow(db.prepare(`SELECT * FROM chat_accepted_sources
      WHERE chat_jid = ? AND source_kind = ? AND source_id = ?`).get(chatJid, input.sourceKind, input.sourceId) as SourceRow);
    if (source.sourceClass !== "intent" || source.selectable || source.acceptedAt !== input.acceptedAt
      || source.payloadRef !== input.payloadRef || source.operationId !== active!.operationId) {
      throw new ChatOperationInvariantError("Intent identity was reused with different immutable fields");
    }
    return { status: inserted.changes > 0 ? "registered" : "existing", source } as const;
  }).immediate();
}

export function getChatOperationIntentSources(operationId: string): AcceptedChatSource[] {
  if (!operationId.trim()) return [];
  return (getDb().prepare(`SELECT * FROM chat_accepted_sources
    WHERE operation_id = ? AND selectable = 0 ORDER BY source_seq`).all(operationId) as SourceRow[]).map(sourceFromRow);
}

export function getAcceptedChatSource(sourceSeq: number): AcceptedChatSource | null {
  const row = getDb().prepare("SELECT * FROM chat_accepted_sources WHERE source_seq = ?").get(sourceSeq) as SourceRow | undefined;
  return row ? sourceFromRow(row) : null;
}

const PROTECTED_CONTINUATION_SOURCE_PREFIX = "source:";
const PROTECTED_CONTINUATION_PAYLOAD_PREFIX = "accepted-source:";

function protectedContinuationIdentity(rootSourceSeq: number): { sourceId: string; payloadRef: string } {
  if (!Number.isInteger(rootSourceSeq) || rootSourceSeq <= 0) {
    throw new ChatOperationInvariantError("Protected continuation root source must be a positive integer");
  }
  return {
    sourceId: `${PROTECTED_CONTINUATION_SOURCE_PREFIX}${rootSourceSeq}`,
    payloadRef: `${PROTECTED_CONTINUATION_PAYLOAD_PREFIX}${rootSourceSeq}`,
  };
}

const GOAL_CONTINUATION_SOURCE_PREFIX = "goal:";
const GOAL_CONTINUATION_PAYLOAD_PREFIX = "goal-continuation:";

function goalContinuationIdentity(input: GoalContinuationLineage): { sourceId: string; payloadRef: string } {
  for (const value of [input.goalId, input.checkpointId, input.oldTurnId]) {
    if (!value.trim()) throw new ChatOperationInvariantError("Goal continuation identity fields must be non-empty");
  }
  for (const value of [input.rootSourceSeq, input.parentSourceSeq, input.parentGeneration, input.generation]) {
    if (!Number.isInteger(value) || value < 0) throw new ChatOperationInvariantError("Goal continuation lineage must use non-negative integers");
  }
  if (input.rootSourceSeq <= 0 || input.parentSourceSeq <= 0 || input.generation <= 0) {
    throw new ChatOperationInvariantError("Goal continuation lineage source and generation must be positive");
  }
  const lineage: GoalContinuationLineage = {
    rootSourceSeq: input.rootSourceSeq,
    parentSourceSeq: input.parentSourceSeq,
    parentGeneration: input.parentGeneration,
    generation: input.generation,
    goalId: input.goalId,
    checkpointId: input.checkpointId,
    oldTurnId: input.oldTurnId,
  };
  return {
    sourceId: `${GOAL_CONTINUATION_SOURCE_PREFIX}${input.rootSourceSeq}:${input.generation}`,
    payloadRef: `${GOAL_CONTINUATION_PAYLOAD_PREFIX}${JSON.stringify(lineage)}`,
  };
}

export function getGoalContinuationLineage(source: AcceptedChatSource): GoalContinuationLineage | null {
  if (source.sourceClass !== "prompt" || source.sourceKind !== "goal_continuation" || !source.selectable
    || !source.payloadRef.startsWith(GOAL_CONTINUATION_PAYLOAD_PREFIX)) return null;
  try {
    const parsed = JSON.parse(source.payloadRef.slice(GOAL_CONTINUATION_PAYLOAD_PREFIX.length)) as GoalContinuationLineage;
    const identity = goalContinuationIdentity(parsed);
    if (identity.sourceId !== source.sourceId || identity.payloadRef !== source.payloadRef) return null;
    const root = getAcceptedChatSource(parsed.rootSourceSeq);
    const parent = getAcceptedChatSource(parsed.parentSourceSeq);
    if (!root || !parent || root.chatJid !== source.chatJid || parent.chatJid !== source.chatJid
      || root.sourceClass !== "prompt" || !root.selectable || root.sourceKind === "goal_continuation") return null;
    if (parsed.parentGeneration === 0) {
      const parentRoot = parent.sourceKind === "protected_continuation"
        ? getProtectedContinuationRootSource(parent)?.sourceSeq
        : parent.sourceSeq;
      if (parentRoot !== parsed.rootSourceSeq || parsed.generation !== 1) return null;
    } else {
      if (parent.sourceKind !== "goal_continuation") return null;
      const parentPayload = JSON.parse(parent.payloadRef.slice(GOAL_CONTINUATION_PAYLOAD_PREFIX.length)) as GoalContinuationLineage;
      if (parentPayload.rootSourceSeq !== parsed.rootSourceSeq || parentPayload.generation !== parsed.parentGeneration
        || parentPayload.goalId !== parsed.goalId || parsed.generation !== parsed.parentGeneration + 1) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function getGoalContinuationCarriedIntentSources(sourceSeq: number): AcceptedChatSource[] {
  const rows = getDb().prepare(`SELECT source.* FROM chat_goal_continuation_intents carried
    JOIN chat_accepted_sources source ON source.source_seq = carried.intent_source_seq
    WHERE carried.continuation_source_seq = ? ORDER BY carried.ordinal`)
    .all(sourceSeq) as SourceRow[];
  return rows.map(sourceFromRow);
}

/** Resolve and transactionally revalidate a protected continuation's immutable root lineage. */
export function getProtectedContinuationRootSource(source: AcceptedChatSource): AcceptedChatSource | null {
  if (source.sourceClass !== "prompt" || source.sourceKind !== "protected_continuation" || !source.selectable) return null;
  const sourceIdSeq = Number(source.sourceId.slice(PROTECTED_CONTINUATION_SOURCE_PREFIX.length));
  const payloadSeq = Number(source.payloadRef.slice(PROTECTED_CONTINUATION_PAYLOAD_PREFIX.length));
  if (!source.sourceId.startsWith(PROTECTED_CONTINUATION_SOURCE_PREFIX)
    || !source.payloadRef.startsWith(PROTECTED_CONTINUATION_PAYLOAD_PREFIX)
    || !Number.isInteger(sourceIdSeq) || sourceIdSeq <= 0 || sourceIdSeq !== payloadSeq) return null;
  const identity = protectedContinuationIdentity(sourceIdSeq);
  if (source.sourceId !== identity.sourceId || source.payloadRef !== identity.payloadRef) return null;
  const root = getAcceptedChatSource(sourceIdSeq);
  if (!root || root.chatJid !== source.chatJid || root.sourceSeq !== sourceIdSeq
    || root.sourceClass !== "prompt" || !root.selectable || root.sourceKind === "protected_continuation") return null;
  return root;
}

export function getResumableDurableChatJids(): string[] {
  const rows = getDb().prepare(`
    SELECT cursor.chat_jid FROM chat_cursors cursor
    JOIN chat_accepted_sources source ON source.source_seq = cursor.operation_source_seq
    WHERE cursor.operation_id IS NOT NULL AND cursor.operation_phase IN ('pending', 'preflight', 'running', 'waiting')
      AND source.source_kind IN ('message', 'protected_continuation', 'goal_continuation')
    UNION
    SELECT source.chat_jid
    FROM chat_accepted_sources source
    LEFT JOIN chat_operation_dispositions disposition ON disposition.source_seq = source.source_seq
    LEFT JOIN chat_cursors cursor ON cursor.chat_jid = source.chat_jid
    WHERE source.source_kind IN ('message', 'protected_continuation', 'goal_continuation') AND source.selectable = 1
      AND disposition.source_seq IS NULL AND cursor.operation_id IS NULL
    ORDER BY 1
  `).all() as Array<{ chat_jid: string }>;
  return rows.map((row) => row.chat_jid);
}

export function getBlockedDurableChatJids(): string[] {
  const rows = getDb().prepare(`SELECT cursor.chat_jid FROM chat_cursors cursor
    JOIN chat_accepted_sources source ON source.source_seq = cursor.operation_source_seq
    WHERE cursor.operation_id IS NOT NULL AND cursor.operation_phase = 'blocked'
      AND source.source_kind IN ('message', 'protected_continuation', 'goal_continuation') ORDER BY cursor.chat_jid`)
    .all() as Array<{ chat_jid: string }>;
  return rows.map((row) => row.chat_jid);
}

export function getChatOperation(chatJid: string): ChatOperationState | null {
  const row = getDb().prepare(`SELECT chat_jid, operation_id, operation_source_seq, operation_phase,
    operation_generation, operation_cancel_cause, operation_cancel_requested_at FROM chat_cursors WHERE chat_jid = ?`)
    .get(chatJid) as OperationRow | undefined;
  return operationFromRow(row);
}

export function getChatOperationDisposition(sourceSeq: number): ChatOperationDisposition | null {
  return dispositionFromRow(getDb().prepare("SELECT * FROM chat_operation_dispositions WHERE source_seq = ?")
    .get(sourceSeq) as DispositionRow | undefined);
}

export function peekNextAcceptedChatSource(chatJid: string): AcceptedChatSource | null {
  const row = getDb().prepare(`
    SELECT s.* FROM chat_accepted_sources s
    LEFT JOIN chat_operation_dispositions d ON d.source_seq = s.source_seq
    WHERE s.chat_jid = ? AND s.selectable = 1 AND d.source_seq IS NULL
    ORDER BY s.source_seq ASC LIMIT 1
  `).get(chatJid) as SourceRow | undefined;
  return row ? sourceFromRow(row) : null;
}

export function claimNextChatOperation(chatJid: string): ChatOperationClaimResult {
  const db = getDb();
  return db.transaction(() => {
    const active = getChatOperation(chatJid);
    if (active) {
      const source = getAcceptedChatSource(active.sourceSeq);
      if (!source) throw new ChatOperationInvariantError("Active operation source is missing");
      return { status: "existing", operation: active, source } as const;
    }
    const cursor = db.prepare(`SELECT preflight_message_id, inflight_message_id, failed_ts,
      compaction_active_started_at FROM chat_cursors WHERE chat_jid = ?`).get(chatJid) as {
        preflight_message_id: string | null; inflight_message_id: string | null; failed_ts: string | null;
        compaction_active_started_at: string | null;
      } | undefined;
    if (cursor && (cursor.preflight_message_id || cursor.inflight_message_id || cursor.failed_ts || cursor.compaction_active_started_at)) {
      return { status: "legacy_conflict", operation: null, source: null } as const;
    }
    const row = db.prepare(`
      SELECT s.* FROM chat_accepted_sources s
      LEFT JOIN chat_operation_dispositions d ON d.source_seq = s.source_seq
      WHERE s.chat_jid = ? AND s.selectable = 1 AND d.source_seq IS NULL
      ORDER BY s.source_seq ASC LIMIT 1
    `).get(chatJid) as SourceRow | undefined;
    if (!row) return { status: "none", operation: null, source: null } as const;
    const operationId = row.operation_id ?? crypto.randomUUID();
    if (!row.operation_id) {
      const bound = db.prepare("UPDATE chat_accepted_sources SET operation_id = ? WHERE source_seq = ? AND operation_id IS NULL")
        .run(operationId, row.source_seq);
      if (bound.changes !== 1) throw new ChatOperationInvariantError("Frontier source claim lost operation binding");
    }
    const claimed = db.prepare(`
      INSERT INTO chat_cursors (chat_jid, cursor_ts, operation_id, operation_source_seq, operation_phase, operation_generation)
      VALUES (?, '', ?, ?, 'pending', 0)
      ON CONFLICT(chat_jid) DO UPDATE SET operation_id = excluded.operation_id,
        operation_source_seq = excluded.operation_source_seq, operation_phase = excluded.operation_phase,
        operation_generation = excluded.operation_generation,
        operation_cancel_cause = NULL, operation_cancel_requested_at = NULL
      WHERE chat_cursors.operation_id IS NULL AND chat_cursors.preflight_message_id IS NULL
        AND chat_cursors.inflight_message_id IS NULL AND chat_cursors.failed_ts IS NULL
        AND chat_cursors.compaction_active_started_at IS NULL
    `).run(chatJid, operationId, row.source_seq);
    if (claimed.changes !== 1) throw new ChatOperationInvariantError("Frontier source claim lost active projection");
    const source = sourceFromRow({ ...row, operation_id: operationId });
    return { status: "claimed", operation: getChatOperation(chatJid)!, source } as const;
  }).immediate();
}

function applyTransition(chatJid: string, expected: ChatOperationOwner, phase: ChatOperationPhase): ChatOperationTransitionResult {
  const current = getChatOperation(chatJid);
  if (!current) return { status: "rejected", reason: "no_operation", operation: null };
  const planned = transitionChatOperationState(current, expected, phase);
  if (planned.status === "rejected") return planned;
  const next = planned.operation;
  const result = getDb().prepare(`UPDATE chat_cursors SET operation_phase = ?, operation_generation = ?
    WHERE chat_jid = ? AND operation_id = ? AND operation_source_seq = ? AND operation_phase = ? AND operation_generation = ?`)
    .run(next.phase, next.generation, chatJid, expected.operationId, expected.sourceSeq, expected.phase, expected.generation);
  if (result.changes === 1) return planned;
  const observed = getChatOperation(chatJid);
  const mismatch = compareChatOperationOwner(observed, expected);
  return { status: "rejected", reason: mismatch.ok ? "generation_mismatch" : mismatch.reason, operation: observed };
}

export const promoteChatOperation = (chatJid: string, owner: ChatOperationOwner, phase: "preflight" | "running") =>
  applyTransition(chatJid, owner, phase);
export const waitChatOperation = (chatJid: string, owner: ChatOperationOwner) => applyTransition(chatJid, owner, "waiting");
export const resumeChatOperation = (chatJid: string, owner: ChatOperationOwner) => applyTransition(chatJid, owner, "running");
export const blockChatOperation = (chatJid: string, owner: ChatOperationOwner) => applyTransition(chatJid, owner, "blocked");
export const retryBlockedChatOperation = (chatJid: string, owner: ChatOperationOwner) => applyTransition(chatJid, owner, "pending");

/** Bind a non-terminal bot artifact to the exact active owner without advancing or releasing it. */
export function bindChatOperationMessage(
  chatJid: string,
  messageRowId: number,
  expected: ChatOperationOwner,
): ChatOperationMessageBindResult {
  const db = getDb();
  const current = getChatOperation(chatJid);
  const comparison = compareChatOperationOwner(current, expected);
  if (!comparison.ok) return { status: "rejected", reason: comparison.reason };
  const message = db.prepare(`SELECT operation_id, is_bot_message FROM messages WHERE chat_jid = ? AND rowid = ?`)
    .get(chatJid, messageRowId) as { operation_id: string | null; is_bot_message: number } | undefined;
  if (!message || message.is_bot_message !== 1) return { status: "rejected", reason: "message_missing" };
  if (message.operation_id && message.operation_id !== expected.operationId) {
    return { status: "rejected", reason: "message_operation_mismatch" };
  }
  db.prepare(`UPDATE messages SET operation_id = ?
    WHERE chat_jid = ? AND rowid = ? AND (operation_id IS NULL OR operation_id = ?)
      AND EXISTS (
        SELECT 1 FROM chat_cursors cursor
        WHERE cursor.chat_jid = ? AND cursor.operation_id = ? AND cursor.operation_source_seq = ?
          AND cursor.operation_phase = ? AND cursor.operation_generation = ?
      )`).run(expected.operationId, chatJid, messageRowId, expected.operationId, chatJid,
      expected.operationId, expected.sourceSeq, expected.phase, expected.generation);
  const bound = db.prepare(`SELECT operation_id FROM messages WHERE chat_jid = ? AND rowid = ?`)
    .get(chatJid, messageRowId) as { operation_id: string | null } | undefined;
  if (bound?.operation_id === expected.operationId && compareChatOperationOwner(getChatOperation(chatJid), expected).ok) {
    return { status: "bound" };
  }
  const observed = compareChatOperationOwner(getChatOperation(chatJid), expected);
  return { status: "rejected", reason: observed.ok ? "message_operation_mismatch" : observed.reason };
}

export function cancelChatOperation(chatJid: string, expected: ChatOperationOwner, cancellation: ChatOperationCancellation): ChatOperationCancelResult {
  const current = getChatOperation(chatJid);
  if (!current) return { status: "rejected", reason: "no_operation", operation: null };
  if (current.operationId !== expected.operationId) return { status: "rejected", reason: "operation_id_mismatch", operation: current };
  if (current.cancellation) return { status: "unchanged", reason: "already_cancelled", operation: current };
  const comparison = compareChatOperationOwner(current, expected);
  if (!comparison.ok) return { status: "rejected", reason: comparison.reason, operation: current };
  const result = getDb().prepare(`UPDATE chat_cursors SET operation_cancel_cause = ?, operation_cancel_requested_at = ?,
    operation_generation = operation_generation + 1 WHERE chat_jid = ? AND operation_id = ? AND operation_source_seq = ?
    AND operation_phase = ? AND operation_generation = ? AND operation_cancel_cause IS NULL`)
    .run(cancellation.cause, cancellation.requestedAt, chatJid, expected.operationId, expected.sourceSeq, expected.phase, expected.generation);
  if (result.changes !== 1) {
    const observed = getChatOperation(chatJid);
    if (observed?.operationId === expected.operationId && observed.cancellation) {
      return { status: "unchanged", reason: "already_cancelled", operation: observed };
    }
    const mismatch = compareChatOperationOwner(observed, expected);
    return { status: "rejected", reason: mismatch.ok ? "generation_mismatch" : mismatch.reason, operation: observed };
  }
  return { status: "applied", operation: getChatOperation(chatJid)! };
}

function sameDisposition(
  existing: ChatOperationDisposition,
  source: AcceptedChatSource | null,
  chatJid: string,
  request: ChatOperationCompletion,
): boolean {
  const terminalMessageId = request.artifact?.messageId ?? request.artifact?.message?.id ?? null;
  const terminalChatJid = terminalMessageId ? (request.artifact?.message?.chat_jid ?? chatJid) : null;
  return source !== null
    && existing.operationId === request.owner.operationId
    && existing.sourceSeq === request.owner.sourceSeq
    && existing.chatJid === chatJid
    && existing.sourceClass === source.sourceClass
    && existing.sourceKind === source.sourceKind
    && existing.sourceId === source.sourceId
    && source.operationId === existing.operationId
    && existing.outcome === request.outcome
    && existing.cause === request.cause
    && existing.provenance === request.provenance
    && existing.terminalMessageChatJid === terminalChatJid
    && existing.terminalMessageId === terminalMessageId;
}

export interface BlockedChatOperationSkip {
  cause: string;
  provenance: string;
  createdAt: string;
}

export interface ProtectedContinuationSuccessor {
  sourceKind: "protected_continuation";
  rootSourceSeq: number;
}

export interface GoalContinuationSuccessor {
  sourceKind: "goal_continuation";
  rootSourceSeq: number;
  parentSourceSeq: number;
  parentGeneration: number;
  generation: number;
  goalId: string;
  checkpointId: string;
  oldTurnId: string;
  carriedIntentSourceSeqs: number[];
}

export type ChatOperationSuccessor = ProtectedContinuationSuccessor | GoalContinuationSuccessor;

export interface GoalContinuationLineage {
  rootSourceSeq: number;
  parentSourceSeq: number;
  parentGeneration: number;
  generation: number;
  goalId: string;
  checkpointId: string;
  oldTurnId: string;
}

export interface ChatOperationCompletion {
  owner: ChatOperationOwner;
  outcome: ChatOperationOutcome;
  cause: string;
  provenance: string;
  createdAt: string;
  artifact?: { messageId: string; message?: never } | { message: NewMessage; messageId?: never };
  successor?: ChatOperationSuccessor;
  intentDispositions?: Array<{ sourceSeq: number; outcome: ChatOperationOutcome; cause: string; provenance: string }>;
}

function insertDisposition(source: AcceptedChatSource, operationId: string, outcome: ChatOperationOutcome,
  cause: string, provenance: string, createdAt: string, artifact: { chatJid: string; messageId: string } | null): ChatOperationDisposition {
  getDb().prepare(`INSERT INTO chat_operation_dispositions (source_seq, operation_id, chat_jid, source_class,
    source_kind, source_id, outcome, cause, provenance, terminal_message_chat_jid, terminal_message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(source.sourceSeq, operationId, source.chatJid, source.sourceClass, source.sourceKind, source.sourceId,
      outcome, cause, provenance, artifact?.chatJid ?? null, artifact?.messageId ?? null, createdAt);
  return getChatOperationDisposition(source.sourceSeq)!;
}

export function skipBlockedChatOperation(
  chatJid: string,
  owner: ChatOperationOwner,
  resolution: BlockedChatOperationSkip,
  hooks: ChatOperationCompletionHooks = {},
): ChatOperationCompletionResult {
  const db = getDb();
  return db.transaction(() => {
    const existing = getChatOperationDisposition(owner.sourceSeq);
    if (!existing) {
      const active = getChatOperation(chatJid);
      const comparison = compareChatOperationOwner(active, owner);
      if (!comparison.ok) return { status: "rejected", reason: comparison.reason, operation: active } as const;
      if (active!.phase !== "blocked") {
        return { status: "rejected", reason: "phase_mismatch", operation: active } as const;
      }
    }
    const intentDispositions = (db.prepare(`SELECT source_seq FROM chat_accepted_sources
      WHERE operation_id = ? AND selectable = 0 ORDER BY source_seq`).all(owner.operationId) as Array<{ source_seq: number }>)
      .map(({ source_seq: sourceSeq }) => ({
        sourceSeq,
        outcome: "skipped" as const,
        cause: resolution.cause,
        provenance: resolution.provenance,
      }));
    return completeChatOperation(chatJid, {
      owner,
      outcome: "skipped",
      cause: resolution.cause,
      provenance: resolution.provenance,
      createdAt: resolution.createdAt,
      intentDispositions,
    }, hooks);
  }).immediate();
}

export function completeChatOperation(
  chatJid: string,
  request: ChatOperationCompletion,
  hooks: ChatOperationCompletionHooks = {},
): ChatOperationCompletionResult {
  const db = getDb();
  return db.transaction(() => {
    const existing = getChatOperationDisposition(request.owner.sourceSeq);
    if (existing) {
      const source = getAcceptedChatSource(request.owner.sourceSeq);
      if (!sameDisposition(existing, source, chatJid, request)) {
        throw new ChatOperationInvariantError("Conflicting repeated completion");
      }
      if (!request.successor) {
        const unexpected = db.prepare(`SELECT source_kind FROM chat_accepted_sources
          WHERE chat_jid = ? AND ((source_kind = 'protected_continuation' AND source_id = ?)
            OR (source_kind = 'goal_continuation' AND payload_ref LIKE ?)) LIMIT 1`)
          .get(chatJid, protectedContinuationIdentity(request.owner.sourceSeq).sourceId,
            `%\"parentSourceSeq\":${request.owner.sourceSeq},%`) as { source_kind: string } | undefined;
        if (unexpected) {
          const label = unexpected.source_kind === "protected_continuation" ? "protected continuation" : "Goal continuation";
          throw new ChatOperationInvariantError(`Conflicting repeated ${label} successor`);
        }
        return { status: "repeated", disposition: existing } as const;
      }
      if (request.successor.sourceKind === "protected_continuation"
        && (request.successor.rootSourceSeq !== source?.sourceSeq || source?.sourceClass !== "prompt"
          || !source.selectable || source.sourceKind === "protected_continuation")) {
        throw new ChatOperationInvariantError("Protected continuation lineage conflicts with the completed source");
      }
      if (request.successor.sourceKind === "goal_continuation") {
        const currentLineage = source?.sourceKind === "goal_continuation" ? getGoalContinuationLineage(source) : null;
        const protectedRoot = source?.sourceKind === "protected_continuation" ? getProtectedContinuationRootSource(source) : null;
        const expectedRoot = currentLineage?.rootSourceSeq ?? protectedRoot?.sourceSeq ?? source?.sourceSeq;
        const expectedParentGeneration = currentLineage?.generation ?? 0;
        if (!source || source.sourceClass !== "prompt" || !source.selectable
          || request.successor.rootSourceSeq !== expectedRoot
          || request.successor.parentSourceSeq !== source.sourceSeq
          || request.successor.parentGeneration !== expectedParentGeneration
          || request.successor.generation !== expectedParentGeneration + 1
          || (currentLineage && request.successor.goalId !== currentLineage.goalId)) {
          throw new ChatOperationInvariantError("Goal continuation lineage is not the exact next generation");
        }
      }
      const requestedIdentity = request.successor.sourceKind === "protected_continuation"
        ? protectedContinuationIdentity(request.successor.rootSourceSeq)
        : goalContinuationIdentity(request.successor);
      const successorRow = db.prepare(`SELECT * FROM chat_accepted_sources
        WHERE chat_jid = ? AND source_kind = ? AND source_id = ?`)
        .get(chatJid, request.successor.sourceKind, requestedIdentity.sourceId) as SourceRow | undefined;
      if (!successorRow) throw new ChatOperationInvariantError("Conflicting repeated completion successor");
      const successor = sourceFromRow(successorRow);
      if (successor.payloadRef !== requestedIdentity.payloadRef || successor.acceptedAt !== existing.createdAt
        || successor.operationId !== null || successor.frontierMessageId !== null || successor.frontierCursorTs !== null) {
        throw new ChatOperationInvariantError("Conflicting repeated completion successor");
      }
      if (request.successor.sourceKind === "goal_continuation") {
        const requestedCarried = request.successor.carriedIntentSourceSeqs;
        const carried = getGoalContinuationCarriedIntentSources(successor.sourceSeq).map((item) => item.sourceSeq);
        if (carried.length !== requestedCarried.length
          || carried.some((value, index) => value !== requestedCarried[index])) {
          throw new ChatOperationInvariantError("Conflicting repeated Goal continuation carried intents");
        }
      }
      return { status: "repeated", disposition: existing } as const;
    }
    const active = getChatOperation(chatJid);
    if (!active) return { status: "rejected", reason: "no_operation", operation: null } as const;
    const comparison = compareChatOperationOwner(active, request.owner);
    if (!comparison.ok) return { status: "rejected", reason: comparison.reason, operation: active } as const;
    if (active.cancellation && request.outcome !== "cancelled") {
      return { status: "rejected", reason: "cancelled_outcome_required", operation: active } as const;
    }
    if (!active.cancellation && request.outcome === "cancelled") {
      return { status: "rejected", reason: "cancellation_required", operation: active } as const;
    }
    const source = getAcceptedChatSource(active.sourceSeq);
    if (!source || source.operationId !== active.operationId) throw new ChatOperationInvariantError("Active source binding mismatch");
    hooks.beforeWrite?.();

    const artifactPolicy = chatOperationTerminalArtifactPolicy(source, request.outcome);
    if (artifactPolicy === "required" && !request.artifact) throw new ChatOperationInvariantError("Terminal message is required");
    if (artifactPolicy === "none" && request.artifact) throw new ChatOperationInvariantError("Terminal message is prohibited for this outcome");
    let artifact: { chatJid: string; messageId: string } | null = null;
    if (request.artifact) {
      const messageId = request.artifact.messageId ?? request.artifact.message.id;
      if (request.artifact.message) {
        const message = request.artifact.message;
        if (message.chat_jid !== chatJid || !message.is_bot_message || !message.is_terminal_agent_reply) {
          throw new ChatOperationInvariantError("Terminal message is not eligible");
        }
        if (message.operation_id && message.operation_id !== active.operationId) throw new ChatOperationInvariantError("Terminal message operation mismatch");
        storeMessage({ ...message, operation_id: active.operationId });
      } else {
        const row = db.prepare(`SELECT chat_jid, id, is_bot_message, operation_id FROM messages WHERE chat_jid = ? AND id = ?`)
          .get(chatJid, messageId) as { chat_jid: string; id: string; is_bot_message: number; operation_id: string | null } | undefined;
        if (!row || row.is_bot_message !== 1) throw new ChatOperationInvariantError("Terminal message is not eligible");
        if (row.operation_id && row.operation_id !== active.operationId) throw new ChatOperationInvariantError("Terminal message operation mismatch");
        db.prepare("UPDATE messages SET is_terminal_agent_reply = 1, operation_id = ? WHERE chat_jid = ? AND id = ?")
          .run(active.operationId, chatJid, messageId);
      }
      artifact = { chatJid, messageId };
    }
    hooks.afterWrite?.("artifact");

    if (request.successor) {
      if (request.outcome !== "interrupted") {
        throw new ChatOperationInvariantError("Continuation successor requires an interrupted outcome");
      }
      const schedulingArtifact = artifact
        ? db.prepare("SELECT content FROM messages WHERE chat_jid = ? AND id = ?")
          .get(artifact.chatJid, artifact.messageId) as { content: string | null } | undefined
        : undefined;
      if (!schedulingArtifact || !String(schedulingArtifact.content ?? "").trim()) {
        throw new ChatOperationInvariantError("Continuation successor requires one non-blank scheduling artifact");
      }
      if (request.successor.sourceKind === "protected_continuation") {
        if (request.cause !== "protected_recovery_continuation_registered") {
          throw new ChatOperationInvariantError("Protected continuation requires the interrupted protected handoff outcome");
        }
        if (request.successor.rootSourceSeq !== source.sourceSeq || source.sourceClass !== "prompt"
          || !source.selectable || source.sourceKind === "protected_continuation") {
          throw new ChatOperationInvariantError("Protected continuation requires a non-continuation selectable prompt root");
        }
        const identity = protectedContinuationIdentity(source.sourceSeq);
        const inserted = db.prepare(`INSERT INTO chat_accepted_sources
          (chat_jid, source_class, source_kind, source_id, accepted_at, selectable, payload_ref,
           frontier_message_id, frontier_cursor_ts, operation_id)
          VALUES (?, 'prompt', 'protected_continuation', ?, ?, 1, ?, NULL, NULL, NULL)
          ON CONFLICT(chat_jid, source_kind, source_id) DO NOTHING`)
          .run(chatJid, identity.sourceId, request.createdAt, identity.payloadRef);
        const successor = sourceFromRow(db.prepare(`SELECT * FROM chat_accepted_sources
          WHERE chat_jid = ? AND source_kind = 'protected_continuation' AND source_id = ?`)
          .get(chatJid, identity.sourceId) as SourceRow);
        if (inserted.changes !== 1 || successor.acceptedAt !== request.createdAt
          || successor.sourceClass !== "prompt" || !successor.selectable
          || successor.payloadRef !== identity.payloadRef || successor.operationId !== null
          || successor.frontierMessageId !== null || successor.frontierCursorTs !== null
          || getProtectedContinuationRootSource(successor)?.sourceSeq !== source.sourceSeq) {
          throw new ChatOperationInvariantError("Protected continuation identity was reused with different immutable lineage");
        }
      } else {
        if (request.cause !== "goal_deadline_checkpoint") {
          throw new ChatOperationInvariantError("Goal continuation requires the Goal deadline checkpoint cause");
        }
        const currentLineage = source.sourceKind === "goal_continuation" ? getGoalContinuationLineage(source) : null;
        const protectedRoot = source.sourceKind === "protected_continuation" ? getProtectedContinuationRootSource(source) : null;
        const expectedRoot = currentLineage?.rootSourceSeq ?? protectedRoot?.sourceSeq ?? source.sourceSeq;
        const expectedParentGeneration = currentLineage?.generation ?? 0;
        if (source.sourceClass !== "prompt" || !source.selectable
          || request.successor.rootSourceSeq !== expectedRoot
          || request.successor.parentSourceSeq !== source.sourceSeq
          || request.successor.parentGeneration !== expectedParentGeneration
          || request.successor.generation !== expectedParentGeneration + 1
          || (currentLineage && request.successor.goalId !== currentLineage.goalId)) {
          throw new ChatOperationInvariantError("Goal continuation lineage is not the exact next generation");
        }
        const carried = request.successor.carriedIntentSourceSeqs;
        if (new Set(carried).size !== carried.length || carried.some((value, index) => index > 0 && value <= carried[index - 1])) {
          throw new ChatOperationInvariantError("Goal continuation carried intents must be unique source-sequence order");
        }
        const identity = goalContinuationIdentity(request.successor);
        const inserted = db.prepare(`INSERT INTO chat_accepted_sources
          (chat_jid, source_class, source_kind, source_id, accepted_at, selectable, payload_ref,
           frontier_message_id, frontier_cursor_ts, operation_id)
          VALUES (?, 'prompt', 'goal_continuation', ?, ?, 1, ?, NULL, NULL, NULL)`)
          .run(chatJid, identity.sourceId, request.createdAt, identity.payloadRef);
        if (inserted.changes !== 1) throw new ChatOperationInvariantError("Goal continuation identity already exists");
        const successor = sourceFromRow(db.prepare(`SELECT * FROM chat_accepted_sources
          WHERE chat_jid = ? AND source_kind = 'goal_continuation' AND source_id = ?`)
          .get(chatJid, identity.sourceId) as SourceRow);
        for (let ordinal = 0; ordinal < carried.length; ordinal += 1) {
          const intentSource = getAcceptedChatSource(carried[ordinal]);
          if (!intentSource || intentSource.chatJid !== chatJid || intentSource.sourceClass !== "intent"
            || intentSource.sourceKind !== "steer" || intentSource.operationId !== active.operationId) {
            throw new ChatOperationInvariantError("Carried Goal continuation steer does not belong to the completed operation");
          }
          const disposition = request.intentDispositions?.find((item) => item.sourceSeq === intentSource.sourceSeq);
          if (!disposition || disposition.outcome !== "interrupted" || disposition.cause !== "goal_deadline_steer_carried") {
            throw new ChatOperationInvariantError("Carried Goal continuation steer requires an explicit carried disposition");
          }
          db.prepare(`INSERT INTO chat_goal_continuation_intents
            (continuation_source_seq, intent_source_seq, ordinal) VALUES (?, ?, ?)`)
            .run(successor.sourceSeq, intentSource.sourceSeq, ordinal);
        }
      }
    }
    hooks.afterWrite?.("successor");

    const pendingIntentRows = db.prepare(`SELECT source_seq FROM chat_accepted_sources
      WHERE operation_id = ? AND selectable = 0 ORDER BY source_seq`)
      .all(active.operationId) as Array<{ source_seq: number }>;
    const requestedIntentSeqs = new Set((request.intentDispositions ?? []).map((intent) => intent.sourceSeq));
    if (requestedIntentSeqs.size !== (request.intentDispositions ?? []).length
      || pendingIntentRows.some((row) => !requestedIntentSeqs.has(row.source_seq))
      || requestedIntentSeqs.size !== pendingIntentRows.length) {
      throw new ChatOperationInvariantError("Completion must dispose every pending operation intent exactly once");
    }
    for (const intent of request.intentDispositions ?? []) {
      const intentSource = getAcceptedChatSource(intent.sourceSeq);
      if (!intentSource || intentSource.sourceClass !== "intent" || intentSource.operationId !== active.operationId) {
        throw new ChatOperationInvariantError("Intent does not belong to active operation");
      }
      const existing = getChatOperationDisposition(intent.sourceSeq);
      if (existing) {
        if (existing.operationId !== active.operationId || existing.outcome !== intent.outcome
          || existing.cause !== intent.cause || existing.provenance !== intent.provenance) {
          throw new ChatOperationInvariantError("Conflicting repeated intent disposition");
        }
        continue;
      }
      insertDisposition(intentSource, active.operationId, intent.outcome, intent.cause, intent.provenance, request.createdAt, null);
    }
    hooks.afterWrite?.("intents");

    const disposition = insertDisposition(source, active.operationId, request.outcome, request.cause,
      request.provenance, request.createdAt, artifact);
    hooks.afterWrite?.("disposition");

    db.prepare(`UPDATE chat_cursors SET cursor_ts = CASE
        WHEN ? IS NULL OR cursor_ts > ? THEN cursor_ts ELSE ? END,
      operation_id = NULL, operation_source_seq = NULL,
      operation_phase = NULL, operation_generation = NULL, operation_cancel_cause = NULL,
      operation_cancel_requested_at = NULL WHERE chat_jid = ? AND operation_id = ? AND operation_source_seq = ?
      AND operation_phase = ? AND operation_generation = ?`)
      .run(source.frontierCursorTs, source.frontierCursorTs, source.frontierCursorTs,
        chatJid, active.operationId, active.sourceSeq, active.phase, active.generation);
    const released = db.prepare("SELECT changes() AS changes").get() as { changes: number };
    if (released.changes !== 1) throw new ChatOperationInvariantError("Active release lost owner comparison");
    hooks.afterWrite?.("frontier");
    hooks.afterWrite?.("release");
    return { status: "completed", disposition } as const;
  }).immediate();
}
