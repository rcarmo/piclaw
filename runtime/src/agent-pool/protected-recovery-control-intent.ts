import { TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT } from "./context-pressure-retry.js";
import {
  isProtectedRecoveryHandoffReason,
  protectedRecoveryHandoffContentBlockFields,
  type ProtectedRecoveryCompactionOutcome,
  type ProtectedRecoveryHandoffMetadata,
  type ProtectedRecoveryHandoffReason,
} from "./protected-recovery-handoff-reason.js";

export const PROTECTED_RECOVERY_CONTROL_INTENT = "protected_recovery_continuation";
export const PROTECTED_RECOVERY_CONTROL_LABEL = "Recovery resumed with execution tools";

export interface ProtectedRecoveryControlIntentBlock {
  type: "control_intent";
  intent: typeof PROTECTED_RECOVERY_CONTROL_INTENT;
  schema_version: 1;
  label: typeof PROTECTED_RECOVERY_CONTROL_LABEL;
  source_message_id: string;
  source_row_id: number;
  thread_id: number;
  /** One-based depth of the bounded protected-recovery handoff chain. */
  handoff_depth: number;
  reason?: ProtectedRecoveryHandoffReason;
  compaction?: ProtectedRecoveryCompactionOutcome;
  tools_required?: boolean;
  retryable?: boolean;
  recovery_attempts?: number;
  recovery_source_id?: string;
  recovery_generation?: number;
}

interface MessageLike {
  content?: unknown;
  content_blocks?: unknown;
}

const HANDOFF_FIELD_KEYS = [
  "reason",
  "compaction",
  "tools_required",
  "retryable",
  "recovery_attempts",
  "recovery_source_id",
  "recovery_generation",
] as const;

function readHandoffFields(block: Record<string, unknown>): {
  valid: boolean;
  fields: Partial<ProtectedRecoveryControlIntentBlock>;
} {
  const hasTypedFields = HANDOFF_FIELD_KEYS.some((key) => Object.hasOwn(block, key));
  if (!hasTypedFields) return { valid: true, fields: {} };

  const compaction = block.compaction;
  const validCompaction = compaction === "not_attempted" || compaction === "succeeded" || compaction === "failed";
  const reason = block.reason;
  const toolsRequired = block.tools_required;
  const structurallyValid = isProtectedRecoveryHandoffReason(reason)
    && validCompaction
    && typeof toolsRequired === "boolean"
    && typeof block.retryable === "boolean"
    && Number.isInteger(block.recovery_attempts)
    && Number(block.recovery_attempts) >= 0;
  const hasRecoverySourceId = typeof block.recovery_source_id === "string" && block.recovery_source_id.trim().length > 0;
  const hasRecoveryGeneration = Number.isInteger(block.recovery_generation) && Number(block.recovery_generation) >= 0;
  const semanticallyValid = structurallyValid
    && (Object.hasOwn(block, "recovery_source_id") === Object.hasOwn(block, "recovery_generation"))
    && (!Object.hasOwn(block, "recovery_source_id") || (hasRecoverySourceId && hasRecoveryGeneration))
    && (reason !== "post_compaction_tools_required" || (compaction === "succeeded" && toolsRequired === true))
    && (reason !== "compaction_failed" || compaction === "failed")
    && (reason !== "tools_required" || toolsRequired === true)
    && (reason !== "unresolved_tool_execution" || toolsRequired === true);
  if (!semanticallyValid) return { valid: false, fields: {} };

  return {
    valid: true,
    fields: {
      reason,
      compaction,
      tools_required: toolsRequired,
      retryable: block.retryable as boolean,
      recovery_attempts: Number(block.recovery_attempts),
      ...(hasRecoverySourceId ? { recovery_source_id: String(block.recovery_source_id).trim() } : {}),
      ...(hasRecoveryGeneration ? { recovery_generation: Number(block.recovery_generation) } : {}),
    },
  };
}

function findControlIntentBlock(contentBlocks: unknown): ProtectedRecoveryControlIntentBlock | null {
  if (!Array.isArray(contentBlocks)) return null;
  const block = contentBlocks.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const value = candidate as Record<string, unknown>;
    const handoffDepth = value.handoff_depth ?? 1;
    return value.type === "control_intent"
      && value.intent === PROTECTED_RECOVERY_CONTROL_INTENT
      && value.schema_version === 1
      && typeof value.source_message_id === "string"
      && value.source_message_id.trim().length > 0
      && Number.isInteger(value.source_row_id)
      && Number(value.source_row_id) > 0
      && Number.isInteger(value.thread_id)
      && Number(value.thread_id) > 0
      && Number.isInteger(handoffDepth)
      && Number(handoffDepth) > 0
      && readHandoffFields(value).valid;
  }) as Record<string, unknown> | undefined;
  if (!block) return null;
  return {
    type: "control_intent",
    intent: PROTECTED_RECOVERY_CONTROL_INTENT,
    schema_version: 1,
    label: PROTECTED_RECOVERY_CONTROL_LABEL,
    source_message_id: String(block.source_message_id),
    source_row_id: Number(block.source_row_id),
    thread_id: Number(block.thread_id),
    handoff_depth: Number(block.handoff_depth ?? 1),
    ...readHandoffFields(block).fields,
  };
}

export function buildProtectedRecoveryControlIntentBlock(options: {
  sourceMessageId: string;
  sourceRowId: number;
  threadId: number;
  handoffDepth?: number;
  handoff?: ProtectedRecoveryHandoffMetadata;
}): ProtectedRecoveryControlIntentBlock {
  return {
    type: "control_intent",
    intent: PROTECTED_RECOVERY_CONTROL_INTENT,
    schema_version: 1,
    label: PROTECTED_RECOVERY_CONTROL_LABEL,
    source_message_id: options.sourceMessageId,
    source_row_id: options.sourceRowId,
    thread_id: options.threadId,
    handoff_depth: options.handoffDepth ?? 1,
    ...(options.handoff ? protectedRecoveryHandoffContentBlockFields(options.handoff) : {}),
  };
}

export function resolveProtectedRecoveryControlIntent(message: MessageLike): ProtectedRecoveryControlIntentBlock | null {
  return findControlIntentBlock(message.content_blocks);
}

export function isProtectedRecoveryControlMessage(message: MessageLike): boolean {
  return Boolean(resolveProtectedRecoveryControlIntent(message));
}

export function resolveProtectedRecoveryPrompt(message: MessageLike): string | null {
  return resolveProtectedRecoveryControlIntent(message)
    ? TOOL_ENABLED_RECOVERY_CONTINUATION_PROMPT
    : null;
}
