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

export interface ProtectedRecoveryHandoffMetadata {
  reason: ProtectedRecoveryHandoffReason;
  compaction: ProtectedRecoveryCompactionOutcome;
  toolsRequired: boolean;
  retryable: boolean;
  recoveryAttempts: number;
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
  recovery_source_id?: string;
  recovery_generation?: number;
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
    recoverySourceId?: string;
    recoveryGeneration?: number;
  },
): ProtectedRecoveryHandoffMetadata {
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
    ...(options.recoverySourceId?.trim() ? { recoverySourceId: options.recoverySourceId.trim() } : {}),
    ...(Number.isInteger(options.recoveryGeneration) && (options.recoveryGeneration ?? -1) >= 0
      ? { recoveryGeneration: Number(options.recoveryGeneration) }
      : {}),
  };
}

export function formatProtectedRecoveryHandoff(
  metadata: ProtectedRecoveryHandoffMetadata,
): ProtectedRecoveryHandoffPresentation {
  return {
    ...PRESENTATION[metadata.reason],
    nextAction: metadata.retryable
      ? "Send “continue” to resume from the preserved session state."
      : "Start a new session or repair the provider configuration before retrying.",
  };
}

export function protectedRecoveryHandoffContentBlockFields(
  metadata: ProtectedRecoveryHandoffMetadata,
): ProtectedRecoveryHandoffContentBlockFields {
  return {
    reason: metadata.reason,
    compaction: metadata.compaction,
    tools_required: metadata.toolsRequired,
    retryable: metadata.retryable,
    recovery_attempts: metadata.recoveryAttempts,
    ...(metadata.recoverySourceId ? { recovery_source_id: metadata.recoverySourceId } : {}),
    ...(Number.isInteger(metadata.recoveryGeneration) ? { recovery_generation: metadata.recoveryGeneration } : {}),
  };
}
