export const PROTECTED_RECOVERY_HANDOFF_REASONS = [
  "post_compaction_tools_required",
  "tools_required",
  "compaction_failed",
  "recovery_budget_exhausted",
  "unresolved_tool_execution",
  "continuation_generation_exhausted",
  "provider_retry_exhausted",
] as const;

export type ProtectedRecoveryHandoffReason = typeof PROTECTED_RECOVERY_HANDOFF_REASONS[number];
export type ProtectedRecoveryCompactionOutcome = "not_attempted" | "succeeded" | "failed";
export type ProtectedRecoveryPrimaryFailureCategory = "timeout";

export interface ProtectedRecoveryPrimaryFailure {
  category: ProtectedRecoveryPrimaryFailureCategory;
  detail: string;
  elapsedMs: number;
  executionToolsEnabled: boolean;
  hadPartialOutput: boolean;
  hadToolActivity: boolean;
  toolExecutionCount: number;
}

export interface ProtectedRecoveryHandoffMetadata {
  reason: ProtectedRecoveryHandoffReason;
  compaction: ProtectedRecoveryCompactionOutcome;
  toolsRequired: boolean;
  retryable: boolean;
  recoveryAttempts: number;
  primaryFailure?: ProtectedRecoveryPrimaryFailure;
  recoverySourceId?: string;
  recoveryGeneration?: number;
}

export interface ProtectedRecoveryHandoffPresentation {
  label: string;
  title: string;
  detail: string;
  nextAction: string;
}

export interface ProtectedRecoveryHandoffContentBlockFields {
  reason: ProtectedRecoveryHandoffReason;
  compaction: ProtectedRecoveryCompactionOutcome;
  tools_required: boolean;
  retryable: boolean;
  recovery_attempts: number;
  primary_failure_category?: ProtectedRecoveryPrimaryFailureCategory;
  primary_failure_detail?: string;
  primary_failure_elapsed_ms?: number;
  primary_failure_execution_tools?: boolean;
  primary_failure_had_partial_output?: boolean;
  primary_failure_had_tool_activity?: boolean;
  primary_failure_tool_executions?: number;
  recovery_source_id?: string;
  recovery_generation?: number;
}

const MAX_PRIMARY_FAILURE_DETAIL_CHARS = 500;
const MAX_PRIMARY_FAILURE_ELAPSED_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PRIMARY_FAILURE_TOOL_EXECUTIONS = 1_000_000;

function normalizePrimaryFailure(value: ProtectedRecoveryPrimaryFailure | undefined): ProtectedRecoveryPrimaryFailure | undefined {
  if (!value || value.category !== "timeout") return undefined;
  const detail = value.detail.trim().slice(0, MAX_PRIMARY_FAILURE_DETAIL_CHARS);
  if (!/^Timed out after \d+s\.$/.test(detail)) return undefined;
  return {
    category: "timeout",
    detail,
    elapsedMs: Number.isFinite(value.elapsedMs)
      ? Math.min(MAX_PRIMARY_FAILURE_ELAPSED_MS, Math.max(0, Math.trunc(value.elapsedMs)))
      : 0,
    executionToolsEnabled: value.executionToolsEnabled === true,
    hadPartialOutput: value.hadPartialOutput === true,
    hadToolActivity: value.hadToolActivity === true,
    toolExecutionCount: Number.isFinite(value.toolExecutionCount)
      ? Math.min(MAX_PRIMARY_FAILURE_TOOL_EXECUTIONS, Math.max(0, Math.trunc(value.toolExecutionCount)))
      : 0,
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

const PRESENTATION: Record<ProtectedRecoveryHandoffReason, Omit<ProtectedRecoveryHandoffPresentation, "nextAction">> = {
  post_compaction_tools_required: {
    label: "tools required",
    title: "Automatic recovery paused after successful compaction",
    detail: "After the provider stopped following tool activity, compaction succeeded, but the unfinished task still requires execution tools. The session is preserved.",
  },
  tools_required: {
    label: "tools required",
    title: "Automatic recovery requires execution tools",
    detail: "The protected recovery path cannot authoritatively finish the unfinished task without execution tools. The session is preserved.",
  },
  compaction_failed: {
    label: "compaction failed",
    title: "Automatic recovery paused because compaction failed",
    detail: "The context could not be compacted safely. The session is preserved.",
  },
  recovery_budget_exhausted: {
    label: "recovery budget",
    title: "Automatic recovery budget exhausted",
    detail: "The bounded automatic-recovery budget ended before the task reached a terminal reply. The session is preserved.",
  },
  unresolved_tool_execution: {
    label: "tool unresolved",
    title: "Automatic recovery paused with an unresolved tool execution",
    detail: "A tool execution did not reach a durable resolved state, so automatic continuation stopped. The session is preserved.",
  },
  continuation_generation_exhausted: {
    label: "continuation limit",
    title: "Automatic recovery reached its continuation limit",
    detail: "The bounded continuation generation was exhausted. The session is preserved.",
  },
  provider_retry_exhausted: {
    label: "provider retries",
    title: "Provider recovery retries exhausted",
    detail: "The provider did not produce an authoritative terminal reply within the bounded retry path. The session is preserved.",
  },
};

export function isProtectedRecoveryHandoffReason(value: unknown): value is ProtectedRecoveryHandoffReason {
  return typeof value === "string" && (PROTECTED_RECOVERY_HANDOFF_REASONS as readonly string[]).includes(value);
}

export function buildProtectedRecoveryHandoffMetadata(
  reason: ProtectedRecoveryHandoffReason,
  options: {
    recoveryAttempts: number;
    compaction?: ProtectedRecoveryCompactionOutcome;
    toolsRequired?: boolean;
    retryable?: boolean;
    primaryFailure?: ProtectedRecoveryPrimaryFailure;
    recoverySourceId?: string;
    recoveryGeneration?: number;
  },
): ProtectedRecoveryHandoffMetadata {
  const primaryFailure = normalizePrimaryFailure(options.primaryFailure);
  return {
    reason,
    compaction: options.compaction
      ?? (reason === "post_compaction_tools_required"
        ? "succeeded"
        : reason === "compaction_failed" ? "failed" : "not_attempted"),
    toolsRequired: options.toolsRequired
      ?? (reason === "post_compaction_tools_required"
        || reason === "tools_required"
        || reason === "unresolved_tool_execution"),
    retryable: options.retryable ?? true,
    recoveryAttempts: Math.max(0, Math.trunc(options.recoveryAttempts)),
    ...(primaryFailure ? { primaryFailure } : {}),
    ...(options.recoverySourceId?.trim() ? { recoverySourceId: options.recoverySourceId.trim() } : {}),
    ...(Number.isInteger(options.recoveryGeneration) && (options.recoveryGeneration ?? -1) >= 0
      ? { recoveryGeneration: Number(options.recoveryGeneration) }
      : {}),
  };
}

export function formatProtectedRecoveryHandoff(
  metadata: ProtectedRecoveryHandoffMetadata,
): ProtectedRecoveryHandoffPresentation {
  const secondary = PRESENTATION[metadata.reason];
  const primary = normalizePrimaryFailure(metadata.primaryFailure);
  return {
    label: primary?.category ?? secondary.label,
    title: primary ? `Tool-enabled continuation timed out after ${formatDuration(primary.elapsedMs)}` : secondary.title,
    detail: primary
      ? `${primary.detail} ${secondary.title}. ${secondary.detail}`
      : secondary.detail,
    nextAction: metadata.retryable
      ? "Send “continue” to resume from the preserved session state."
      : "Start a new session or repair the provider configuration before retrying.",
  };
}

export function protectedRecoveryHandoffContentBlockFields(
  metadata: ProtectedRecoveryHandoffMetadata,
): ProtectedRecoveryHandoffContentBlockFields {
  const primaryFailure = normalizePrimaryFailure(metadata.primaryFailure);
  return {
    reason: metadata.reason,
    compaction: metadata.compaction,
    tools_required: metadata.toolsRequired,
    retryable: metadata.retryable,
    recovery_attempts: metadata.recoveryAttempts,
    ...(primaryFailure ? {
      primary_failure_category: primaryFailure.category,
      primary_failure_detail: primaryFailure.detail,
      primary_failure_elapsed_ms: primaryFailure.elapsedMs,
      primary_failure_execution_tools: primaryFailure.executionToolsEnabled,
      primary_failure_had_partial_output: primaryFailure.hadPartialOutput,
      primary_failure_had_tool_activity: primaryFailure.hadToolActivity,
      primary_failure_tool_executions: primaryFailure.toolExecutionCount,
    } : {}),
    ...(metadata.recoverySourceId ? { recovery_source_id: metadata.recoverySourceId } : {}),
    ...(Number.isInteger(metadata.recoveryGeneration) ? { recovery_generation: metadata.recoveryGeneration } : {}),
  };
}
