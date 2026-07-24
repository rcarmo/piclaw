/**
 * automatic-recovery.ts – Shared mid-turn recovery policy for agent runs.
 */

import type { AgentRecoveryMetadata } from "./contracts.js";

export interface RetryBackoffSettings {
  enabled: boolean;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface AutomaticRecoveryConfig {
  enabled: boolean;
  maxAttempts: number;
  totalBudgetMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type RecoveryStrategy = "retry" | "compact_then_retry";
export type RecoveryClassifier =
  | "disabled"
  | "budget_exhausted"
  | "auth_config"
  | "recovery_suppressed"
  | "stale_progress_watchdog"
  | "non_recoverable"
  | "tool_activity"
  | "completed_turn_output"
  | "context_pressure"
  | "tool_history_pressure"
  | "thinking_only_stop"
  | "length_stop"
  | "transient"
  | "compaction_failure"
  | "unknown";

export interface RecoveryAttemptSnapshot {
  hadToolActivity: boolean;
  hadPartialOutput: boolean;
  hadCompletedTurnOutput?: boolean;
  hadTerminalTurnOutput?: boolean;
  compactionErrorMessage?: string | null;
  sawCompactionIntent?: boolean;
  sawAssistantToolCall?: boolean;
  sawThinkingOnlyStop?: boolean;
  onlyReadOnlyToolActivity?: boolean;
  canDisableToolsForRecovery?: boolean;
  hadToolFailure?: boolean;
  sawTerminalSideEffectToolActivity?: boolean;
  toolUseBudgetExceeded?: boolean;
  assistantToolUseMessageCount?: number;
  toolExecutionCount?: number;
}

export interface RecoveryDecision {
  recover: boolean;
  classifier: RecoveryClassifier;
  strategy: RecoveryStrategy | null;
  reason: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TOTAL_BUDGET_MS = 30_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 2_000;
const DEFAULT_RETRY_MAX_DELAY_MS = 60_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export const DEFAULT_RETRY_BACKOFF_SETTINGS: Readonly<RetryBackoffSettings> = Object.freeze({
  enabled: true,
  maxRetries: DEFAULT_MAX_ATTEMPTS,
  baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_RETRY_MAX_DELAY_MS,
});

export const DEFAULT_AUTOMATIC_RECOVERY_CONFIG: Readonly<AutomaticRecoveryConfig> = Object.freeze({
  enabled: true,
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  totalBudgetMs: DEFAULT_TOTAL_BUDGET_MS,
  baseDelayMs: DEFAULT_RETRY_BASE_DELAY_MS,
  maxDelayMs: DEFAULT_RETRY_MAX_DELAY_MS,
});

export function normalizeRetryBackoffSettings(settings?: Partial<RetryBackoffSettings> | null): RetryBackoffSettings {
  return {
    enabled: typeof settings?.enabled === "boolean" ? settings.enabled : DEFAULT_RETRY_BACKOFF_SETTINGS.enabled,
    maxRetries: Number.isFinite(settings?.maxRetries) && (settings?.maxRetries ?? 0) > 0
      ? Number(settings?.maxRetries)
      : DEFAULT_RETRY_BACKOFF_SETTINGS.maxRetries,
    baseDelayMs: Number.isFinite(settings?.baseDelayMs) && (settings?.baseDelayMs ?? 0) > 0
      ? Number(settings?.baseDelayMs)
      : DEFAULT_RETRY_BACKOFF_SETTINGS.baseDelayMs,
    maxDelayMs: Number.isFinite(settings?.maxDelayMs) && (settings?.maxDelayMs ?? 0) > 0
      ? Number(settings?.maxDelayMs)
      : DEFAULT_RETRY_BACKOFF_SETTINGS.maxDelayMs,
  };
}

export function getAutomaticRecoveryConfig(retrySettings?: Partial<RetryBackoffSettings> | null): Readonly<AutomaticRecoveryConfig> {
  const normalizedRetry = normalizeRetryBackoffSettings(retrySettings);
  return Object.freeze({
    // The SDK retry toggle controls provider/request retries. Piclaw turn recovery
    // is a separate safety mechanism for genuine context pressure and bounded
    // transient retries. Tool-history ceilings are terminal and require an
    // explicit continue instead of automatic compaction/replay.
    enabled: parseBoolean(process.env.PICLAW_TURN_AUTO_RECOVERY_ENABLED, DEFAULT_AUTOMATIC_RECOVERY_CONFIG.enabled),
    maxAttempts: parsePositiveInt(process.env.PICLAW_TURN_AUTO_RECOVERY_MAX_ATTEMPTS, normalizedRetry.maxRetries),
    totalBudgetMs: parsePositiveInt(process.env.PICLAW_TURN_AUTO_RECOVERY_TOTAL_BUDGET_MS, DEFAULT_AUTOMATIC_RECOVERY_CONFIG.totalBudgetMs),
    baseDelayMs: normalizedRetry.baseDelayMs,
    maxDelayMs: normalizedRetry.maxDelayMs,
  });
}

export function getAutomaticRecoveryDelayMs(config: Pick<AutomaticRecoveryConfig, "baseDelayMs" | "maxDelayMs">, attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = Math.max(0, Math.round(config.baseDelayMs * 2 ** exponent));
  return Math.min(raw, Math.max(config.baseDelayMs, config.maxDelayMs));
}

export function isContextPressureFailure(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /context(?: window| length)?|maximum context length|context_length|token limit|too many tokens|prompt too long|reduce (?:the )?length|overflow|request too large/i.test(errorText);
}

export function isTransientFailure(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /timed out|timeout|before finalization|connection (?:error|ended|closed|lost)|websocket.*(?:closed|ended|1006)|fetch failed|socket hang up|econnreset|econnrefused|etimedout|enotfound|eai_again|getaddrinfo|dns lookup|502|503|504|temporary|temporarily unavailable|try again|rate limit|too many requests|\b429\b|overloaded|server error/i.test(errorText);
}

export function isLengthStopFailure(errorText: string | null | undefined): boolean {
  if (!errorText || isContextPressureFailure(errorText)) return false;
  return /finish[_ -]?reason\s*:?\s*length|stop\s*reason\s*:?\s*length|\bstopReason\s*:?\s*length|max(?:imum)? output (?:tokens?|length)|output token limit|hit (?:the )?(?:maximum )?output/i.test(errorText);
}

export function isProviderAuthConfigFailure(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /no api key for provider|no api key found|token refresh failed\s*:\s*401|authentication failed|credentials may have expired|re-authenticate|unauthorized|\b401\b|\b403\b|invalid.*api.*key|api.*key.*invalid|token.*expired|oauth.*expired|refresh.*token|provider login required|auth.*expired|missing provider credential|missing provider config|provider\.getApiKey is not a function/i.test(errorText);
}

export function isNonRecoverableFailure(errorText: string | null | undefined): boolean {
  if (!errorText) return false;
  return /request was aborted|\baborted\b|no model selected|select a model|use \/model|use \/login|model not found|deployment.*not found|policy|safety|blocked by policy|invalid_request_error|malformed|schema|unsupported model|capability mismatch|permission denied|missing required file|file not found/i.test(errorText);
}

export interface RecoveryDecisionInput {
  config: AutomaticRecoveryConfig;
  errorText: string | null | undefined;
  recoveryAttemptsUsed: number;
  elapsedMs: number;
  snapshot: RecoveryAttemptSnapshot;
}

export function formatRecoverySummary(recovery: AgentRecoveryMetadata | null | undefined): string | null {
  if (!recovery) return null;

  const attemptsUsed = Math.max(0, Number(recovery.attemptsUsed) || 0);
  const classifierSuffix = recovery.lastClassifier ? ` (${recovery.lastClassifier})` : "";
  const strategySuffix = Array.isArray(recovery.strategyHistory) && recovery.strategyHistory.length > 0
    ? ` via ${recovery.strategyHistory.join(" → ")}`
    : "";

  if (recovery.recovered) {
    return `Automatic recovery succeeded after ${attemptsUsed} attempt(s)${classifierSuffix}${strategySuffix}.`;
  }
  if (recovery.exhausted) {
    return `Automatic recovery exhausted after ${attemptsUsed} attempt(s)${classifierSuffix}${strategySuffix}.`;
  }
  if (attemptsUsed > 0) {
    return `Automatic recovery used ${attemptsUsed} attempt(s)${classifierSuffix}${strategySuffix}.`;
  }
  return null;
}

export function decideAutomaticRecovery(input: RecoveryDecisionInput): RecoveryDecision {
  const errorText = String(input.errorText || "").trim();
  const toolHistoryPressure = Boolean(input.snapshot.toolUseBudgetExceeded)
    || /tool(?:-| )use budget exceeded|tool history pressure|too many tool (?:steps|calls)/i.test(errorText);

  if (!input.config.enabled) {
    return {
      recover: false,
      classifier: "disabled",
      strategy: null,
      reason: "Automatic turn recovery is disabled.",
    };
  }

  if (/stale-progress watchdog/i.test(errorText)) {
    return {
      recover: false,
      classifier: "stale_progress_watchdog",
      strategy: null,
      reason: "Stale-progress watchdog already interrupted the active run; do not retry automatically.",
    };
  }

  if (input.recoveryAttemptsUsed >= input.config.maxAttempts || input.elapsedMs >= input.config.totalBudgetMs) {
    return {
      recover: false,
      classifier: "budget_exhausted",
      strategy: null,
      reason: "Automatic recovery budget exhausted.",
    };
  }

  if (isLengthStopFailure(errorText)) {
    return {
      recover: false,
      classifier: "length_stop",
      strategy: null,
      reason: "Provider hit the output length limit; preserve the partial answer and wait for an explicit continue.",
    };
  }

  if (isProviderAuthConfigFailure(errorText)) {
    return {
      recover: false,
      classifier: "auth_config",
      strategy: null,
      reason: "Provider authentication/configuration failure; automatic recovery suppressed until credentials or login are fixed.",
    };
  }

  if (input.snapshot.compactionErrorMessage) {
    if (isTransientFailure(errorText)) {
      return {
        recover: true,
        classifier: "compaction_failure",
        strategy: "retry",
        reason: "Transient compaction failure; retrying once without another compaction first.",
      };
    }
    return {
      recover: false,
      classifier: "compaction_failure",
      strategy: null,
      reason: isContextPressureFailure(errorText) || input.snapshot.sawCompactionIntent
        ? "Compaction itself exceeded the context window; refusing to compact-and-retry again. Start a shorter branch or compact with a larger model."
        : "Compaction failed; refusing automatic retry to avoid re-entering the same failed compaction path.",
    };
  }

  if (input.snapshot.hadToolActivity) {
    // A terminal assistant reply is the only prior output that can make a
    // tool-bearing failure complete. Text emitted before a tool call is an
    // intermediate lead-in; if the provider later stops or times out, run a
    // tools-disabled continuation so completed side effects are not replayed.
    const hadTerminalTurnOutput = input.snapshot.hadTerminalTurnOutput
      ?? Boolean(input.snapshot.hadCompletedTurnOutput);
    if (hadTerminalTurnOutput) {
      return {
        recover: false,
        classifier: "completed_turn_output",
        strategy: null,
        reason: "Automatic recovery skipped because a terminal assistant reply already completed during the failed run.",
      };
    }
    if (input.snapshot.hadToolFailure && input.snapshot.sawTerminalSideEffectToolActivity) {
      return {
        recover: false,
        classifier: "tool_activity",
        strategy: null,
        reason: "A terminal side-effect tool completed after another tool failed; preserve the mixed outcome instead of converting it to recovery success.",
      };
    }
    if (isContextPressureFailure(errorText) || input.snapshot.sawCompactionIntent) {
      return {
        recover: true,
        classifier: "context_pressure",
        strategy: "compact_then_retry",
        reason: "Failure looks context-related despite tool activity; compacting before retrying.",
      };
    }
    if (toolHistoryPressure) {
      return {
        recover: false,
        classifier: "tool_history_pressure",
        strategy: null,
        reason: "Turn exceeded the tool-history budget before finalization without context pressure; wait for an explicit continue instead of compacting.",
      };
    }
    if (isNonRecoverableFailure(errorText)) {
      return {
        recover: false,
        classifier: "non_recoverable",
        strategy: null,
        reason: "Failure classified as non-recoverable.",
      };
    }
    if (
      input.snapshot.onlyReadOnlyToolActivity
      && input.snapshot.sawAssistantToolCall
      && !hadTerminalTurnOutput
      && /without emitting an assistant reply before finalization|provider stopped after tool use without a final assistant reply/i.test(errorText)
    ) {
      return {
        recover: true,
        classifier: "transient",
        strategy: "retry",
        reason: "Provider stopped after a read-only tool call without sending a final reply; retrying once is safe.",
      };
    }
    if (
      input.snapshot.canDisableToolsForRecovery
      && (isTransientFailure(errorText) || input.snapshot.hadPartialOutput || input.snapshot.sawAssistantToolCall)
    ) {
      return {
        recover: true,
        classifier: "transient",
        strategy: "retry",
        reason: "Tool work completed without a terminal assistant reply; continuing once with tools disabled.",
      };
    }
    return {
      recover: false,
      classifier: "tool_activity",
      strategy: null,
      reason: "Automatic recovery skipped because tool activity occurred and the failure was not safely continuable.",
    };
  }

  if (input.snapshot.hadCompletedTurnOutput) {
    return {
      recover: false,
      classifier: "completed_turn_output",
      strategy: null,
      reason: "Automatic recovery skipped because a completed assistant turn was already emitted during the failed run.",
    };
  }

  if (input.snapshot.sawThinkingOnlyStop && !input.snapshot.hadToolActivity) {
    if (input.recoveryAttemptsUsed === 0) {
      return {
        recover: true,
        classifier: "thinking_only_stop",
        strategy: "retry",
        reason: "Provider stopped after emitting thinking only; retrying once before escalating.",
      };
    }
    if (input.snapshot.sawCompactionIntent) {
      return {
        recover: true,
        classifier: "context_pressure",
        strategy: "compact_then_retry",
        reason: "Thinking-only stop repeated under context pressure; compacting before one more retry.",
      };
    }
    return {
      recover: false,
      classifier: "thinking_only_stop",
      strategy: null,
      reason: "Provider stopped after emitting thinking only again after a bounded retry.",
    };
  }

  // Context pressure must be checked before tool-history/non-recoverable
  // classification. Tool-count exhaustion alone is terminal, but a turn that
  // independently crossed the model-aware threshold is recoverable by
  // compaction even when it reached the tool ceiling at the same time.
  if (isContextPressureFailure(errorText) || input.snapshot.sawCompactionIntent) {
    return {
      recover: true,
      classifier: "context_pressure",
      strategy: "compact_then_retry",
      reason: "Failure looks context-related; compacting before retrying.",
    };
  }

  if (toolHistoryPressure) {
    return {
      recover: false,
      classifier: "tool_history_pressure",
      strategy: null,
      reason: "Turn exceeded the tool-history budget before finalization without context pressure; wait for an explicit continue instead of compacting.",
    };
  }

  if (isNonRecoverableFailure(errorText)) {
    return {
      recover: false,
      classifier: "non_recoverable",
      strategy: null,
      reason: "Failure classified as non-recoverable.",
    };
  }

  if (isTransientFailure(errorText) || input.snapshot.hadPartialOutput || !errorText) {
    return {
      recover: true,
      classifier: "transient",
      strategy: "retry",
      reason: "Failure looks transient or interrupted mid-turn; retrying before compaction.",
    };
  }

  return {
    recover: true,
    classifier: "unknown",
    strategy: "retry",
    reason: "Unknown mid-turn failure without context pressure; retrying without compaction.",
  };
}
