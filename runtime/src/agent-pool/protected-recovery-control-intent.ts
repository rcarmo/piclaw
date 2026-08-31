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
  primary_failure_category?: "timeout";
  primary_failure_detail?: string;
  primary_failure_elapsed_ms?: number;
  primary_failure_execution_tools?: boolean;
  primary_failure_had_partial_output?: boolean;
  primary_failure_had_tool_activity?: boolean;
  primary_failure_tool_executions?: number;
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
  "primary_failure_category",
  "primary_failure_detail",
  "primary_failure_elapsed_ms",
  "primary_failure_execution_tools",
  "primary_failure_had_partial_output",
  "primary_failure_had_tool_activity",
  "primary_failure_tool_executions",
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
  const primaryFailureKeys = [
    "primary_failure_category",
    "primary_failure_detail",
    "primary_failure_elapsed_ms",
    "primary_failure_execution_tools",
    "primary_failure_had_partial_output",
    "primary_failure_had_tool_activity",
    "primary_failure_tool_executions",
  ] as const;
  const primaryFailureFieldCount = primaryFailureKeys.filter((key) => Object.hasOwn(block, key)).length;
  const hasPrimaryFailure = primaryFailureFieldCount === primaryFailureKeys.length;
  const validPrimaryFailure = primaryFailureFieldCount === 0 || (
    hasPrimaryFailure
    && block.primary_failure_category === "timeout"
    && typeof block.primary_failure_detail === "string"
    && block.primary_failure_detail.trim().length <= 500
    && /^Timed out after \d+s\.$/.test(block.primary_failure_detail.trim())
    && Number.isInteger(block.primary_failure_elapsed_ms)
    && Number(block.primary_failure_elapsed_ms) >= 0
    && Number(block.primary_failure_elapsed_ms) <= 30 * 24 * 60 * 60 * 1000
    && typeof block.primary_failure_execution_tools === "boolean"
    && typeof block.primary_failure_had_partial_output === "boolean"
    && typeof block.primary_failure_had_tool_activity === "boolean"
    && Number.isInteger(block.primary_failure_tool_executions)
    && Number(block.primary_failure_tool_executions) >= 0
    && Number(block.primary_failure_tool_executions) <= 1_000_000
  );
  const semanticallyValid = structurallyValid
    && validPrimaryFailure
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
      ...(hasPrimaryFailure ? {
        primary_failure_category: "timeout" as const,
        primary_failure_detail: String(block.primary_failure_detail).trim(),
        primary_failure_elapsed_ms: Number(block.primary_failure_elapsed_ms),
        primary_failure_execution_tools: block.primary_failure_execution_tools as boolean,
        primary_failure_had_partial_output: block.primary_failure_had_partial_output as boolean,
        primary_failure_had_tool_activity: block.primary_failure_had_tool_activity as boolean,
        primary_failure_tool_executions: Number(block.primary_failure_tool_executions),
      } : {}),
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
