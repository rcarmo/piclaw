// Shared helper/utility functions for message-list modules

import type { ContentBlock, Interaction } from "./types";
import { formatRelativeTime } from "../../utils/format";

export function relativeTime(isoDate: string): string {
  return formatRelativeTime(isoDate);
}

export function getBlockKey(block: ContentBlock, index: number): string {
  return block.id ?? `block-${index}`;
}

const PROTECTED_RECOVERY_REASONS = new Set([
  "post_compaction_tools_required",
  "tools_required",
  "compaction_failed",
  "recovery_budget_exhausted",
  "unresolved_tool_execution",
  "continuation_generation_exhausted",
  "provider_retry_exhausted",
]);
const PROTECTED_RECOVERY_TYPED_KEYS = [
  "reason",
  "compaction",
  "tools_required",
  "retryable",
  "recovery_attempts",
] as const;
const PRIMARY_FAILURE_KEYS = [
  "primary_failure_category",
  "primary_failure_detail",
  "primary_failure_elapsed_ms",
  "primary_failure_execution_tools",
  "primary_failure_had_partial_output",
  "primary_failure_had_tool_activity",
  "primary_failure_tool_executions",
] as const;

function hasValidPrimaryFailureFields(block: ContentBlock): boolean {
  const record = block as Record<string, unknown>;
  const count = PRIMARY_FAILURE_KEYS.filter((key) => Object.hasOwn(record, key)).length;
  if (count === 0) return true;
  return count === PRIMARY_FAILURE_KEYS.length
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
    && Number(block.primary_failure_tool_executions) <= 1_000_000;
}

function hasValidProtectedRecoveryHandoffFields(block: ContentBlock): boolean {
  const record = block as Record<string, unknown>;
  const hasTypedFields = PROTECTED_RECOVERY_TYPED_KEYS.some((key) => Object.hasOwn(record, key));
  if (!hasTypedFields) return true;
  const valid = PROTECTED_RECOVERY_REASONS.has(String(block.reason))
    && (block.compaction === "not_attempted" || block.compaction === "succeeded" || block.compaction === "failed")
    && typeof block.tools_required === "boolean"
    && typeof block.retryable === "boolean"
    && Number.isInteger(block.recovery_attempts)
    && Number(block.recovery_attempts) >= 0;
  if (!valid || !hasValidPrimaryFailureFields(block)) return false;
  if (block.reason === "post_compaction_tools_required") {
    return block.compaction === "succeeded" && block.tools_required === true;
  }
  if (block.reason === "compaction_failed") return block.compaction === "failed";
  if (block.reason === "tools_required" || block.reason === "unresolved_tool_execution") {
    return block.tools_required === true;
  }
  return true;
}

export function getProtectedRecoveryControlIntent(
  blocks: ContentBlock[] | undefined,
): ContentBlock | null {
  if (!Array.isArray(blocks)) return null;
  return blocks.find((block) => (
    Boolean(block)
    && typeof block === "object"
    && block.type === "control_intent"
    && block.intent === "protected_recovery_continuation"
    && block.schema_version === 1
    && typeof block.source_message_id === "string"
    && block.source_message_id.trim().length > 0
    && Number.isInteger(block.source_row_id)
    && Number(block.source_row_id) > 0
    && Number.isInteger(block.thread_id)
    && Number(block.thread_id) > 0
    && Number.isInteger(block.handoff_depth ?? 1)
    && Number(block.handoff_depth ?? 1) > 0
    && hasValidProtectedRecoveryHandoffFields(block)
  )) ?? null;
}

export function getTurnOutcomeMarker(
  blocks: ContentBlock[] | undefined,
): ContentBlock | null {
  if (!Array.isArray(blocks)) return null;
  return blocks.find((block) => (
    Boolean(block)
    && typeof block === "object"
    && block.type === "turn_outcome_marker"
  )) ?? null;
}

export function shouldHideTimelineInteraction(interaction: Interaction): boolean {
  if (getProtectedRecoveryControlIntent(interaction.content_blocks)) return true;
  const outcome = getTurnOutcomeMarker(interaction.content_blocks);
  return interaction.type === "agent"
    && !interaction.content.trim()
    && outcome?.kind === "recovery"
    && outcome.severity === "info";
}

export function normalizePost(raw: Record<string, unknown>): Interaction {
  const data =
    raw.data && typeof raw.data === "object"
      ? (raw.data as Record<string, unknown>)
      : undefined;
  const rawType = raw.type ?? data?.type;

  return {
    id: Number(raw.id ?? 0),
    type: (rawType === "user" || rawType === "user_message"
      ? "user"
      : "agent") as "user" | "agent",
    content: String(raw.content ?? data?.content ?? ""),
    content_blocks: (raw.content_blocks ?? data?.content_blocks) as
      | ContentBlock[]
      | undefined,
    media_ids: (raw.media_ids ?? data?.media_ids) as number[] | undefined,
    created_at: String(raw.created_at ?? raw.timestamp ?? ""),
    data,
  };
}

export function mergeInteractions(
  existing: Interaction[],
  incoming: Interaction[]
): Interaction[] {
  const byId = new Map<number, Interaction>();
  for (const msg of existing) {
    byId.set(msg.id, msg);
  }
  for (const msg of incoming) {
    byId.set(msg.id, msg);
  }
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}
