/**
 * agent-pool/run-agent-recovery-phase.ts – Automatic recovery retry-loop phase.
 *
 * Keeps the recovery budgeting/diagnostic state machine out of the main
 * run-agent orchestrator while leaving prompt-attempt event/watchdog handling
 * in run-agent-orchestrator.ts.
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import {
  classifyOpaqueAgentFailure,
  decideAutomaticRecovery,
  getAutomaticRecoveryDelayMs,
  type AutomaticRecoveryConfig,
  type RecoveryAttemptSnapshot,
  type RecoveryClassifier,
  type RecoveryDecision,
  type RecoveryStrategy,
} from "./automatic-recovery.js";
import {
  buildFreshContextUsageUpdateEvent,
  getAutoCompactionTokenStatusForSession,
  getCompactionContextReport,
  isCompactionCancellationError,
  noteCompactionFailure,
  noteCompactionSuccess,
  runCompactionWithTimeout,
} from "./compaction.js";
import { buildPiclawCompactionEventFields, type PiclawCompactionTriggerMetadata } from "./compaction-trigger-context.js";
import { RECOVERY_CONTINUATION_PROMPT } from "./context-pressure-retry.js";
import type { AgentFailureCategory, AgentOutput, AgentRecoveryDiagnosticEntry, AgentRecoveryMetadata, RunAgentOptions } from "./contracts.js";
import { getRecoveryPolicyConfig } from "../core/config.js";
import {
  decideOpenRouterAffordabilityRetry,
  type OpenRouterOutputBudgetState,
} from "../core/openrouter-output-budget.js";
import { writeAgentLog } from "./logging.js";
import { heartbeatTrackedPhase } from "../runtime/progress-watchdog.js";
import { rememberActiveToolSubset } from "./active-tool-subset-memory.js";
import { logToolStateTransition } from "./tool-state-transitions.js";
import {
  buildProtectedRecoveryHandoffMetadata,
  type ProtectedRecoveryHandoffReason,
} from "./protected-recovery-handoff-reason.js";

const MAX_RECOVERY_LOOP_GUARD_CHATS = 512;
export const MAX_RECOVERY_GENERATIONS_PER_SOURCE = 3;
const MIN_RECOVERY_FINALIZATION_RESERVE_MS = 5_000;
const MAX_RECOVERY_FINALIZATION_RESERVE_MS = 60_000;
const RECOVERY_FINALIZATION_RESERVE_RATIO = 0.15;

interface RecoveryFailureSignatureRecord {
  atMs: number;
  signature: string;
}

const recentRecoveryFailuresByChat = new Map<string, RecoveryFailureSignatureRecord[]>();

export interface PromptAttemptResult {
  output: AgentOutput;
  snapshot: RecoveryAttemptSnapshot;
  promptWasPersisted: boolean;
  timedOut: boolean;
  toolExecutionCount: number;
}

export type RunPromptAttemptCallback = (
  prompt: string,
  timeoutMs: number,
  toolExecutionCountAtStart: number,
  finalizationReserveMs?: number,
) => Promise<PromptAttemptResult>;

export interface SessionWithToolControl {
  getActiveToolNames?: () => string[];
  setActiveToolsByName?: (names: string[]) => void;
}

export interface RunAgentRecoveryPhaseOptions {
  prompt: string;
  chatJid: string;
  session: AgentSession;
  sessionCtrl: SessionWithToolControl | null;
  timeoutMs: number;
  startTime: number;
  modelLabel: string | null;
  recoveryConfig: AutomaticRecoveryConfig;
  runOptions: RunAgentOptions;
  logsDir: string;
  runPromptAttempt: RunPromptAttemptCallback;
  openRouterOutputBudgetState?: OpenRouterOutputBudgetState;
  onInfo?: (message: string, data: Record<string, unknown>) => void;
  onWarn?: (message: string, data: Record<string, unknown>) => void;
  clearAttachments(chatJid: string): void;
  toolCallCap?: {
    exceeded: boolean;
    count: number;
    cap: number | undefined;
  };
  rotateAfterInsufficientCompaction?: (reason: string) => Promise<
    | { ok: true; session: AgentSession; sessionCtrl: SessionWithToolControl | null }
    | { ok: false; errorMessage: string }
  >;
  rotateAfterCompactionFailure?: (reason: string) => Promise<
    | { ok: true; session: AgentSession; sessionCtrl: SessionWithToolControl | null }
    | { ok: false; errorMessage: string }
  >;
}

function emitAgentSessionEvent(onEvent: RunAgentOptions["onEvent"], event: Record<string, unknown>): void {
  onEvent?.(event as AgentSessionEvent);
}

function getRunObservabilityDetails(
  runOptions: RunAgentOptions,
  extras: { sessionLeafId?: string | null } = {},
): Record<string, unknown> {
  const sessionLeafId = extras.sessionLeafId ?? runOptions.sessionLeafId ?? null;
  return {
    ...(runOptions.turnId ? { turnId: runOptions.turnId } : {}),
    ...(runOptions.userId ? { userId: runOptions.userId } : {}),
    ...(runOptions.sessionId ? { sessionId: runOptions.sessionId } : {}),
    ...(runOptions.clientId ? { clientId: runOptions.clientId } : {}),
    ...(sessionLeafId ? { sessionLeafId } : {}),
  };
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await Bun.sleep(ms);
}

export function getRecoveryFinalizationReserveMs(attemptTimeoutMs: number): number {
  if (!Number.isFinite(attemptTimeoutMs) || attemptTimeoutMs < 2) return 0;
  return Math.min(
    MAX_RECOVERY_FINALIZATION_RESERVE_MS,
    Math.floor(attemptTimeoutMs / 2),
    Math.max(MIN_RECOVERY_FINALIZATION_RESERVE_MS, Math.floor(attemptTimeoutMs * RECOVERY_FINALIZATION_RESERVE_RATIO)),
  );
}

function pruneRecoveryFailureMap(now: number, windowMs: number): void {
  for (const [chatJid, records] of recentRecoveryFailuresByChat.entries()) {
    const filtered = records.filter((entry) => (now - entry.atMs) <= windowMs);
    if (filtered.length === 0) {
      recentRecoveryFailuresByChat.delete(chatJid);
      continue;
    }
    if (filtered.length !== records.length) {
      recentRecoveryFailuresByChat.set(chatJid, filtered.slice(-200));
    }
  }

  if (recentRecoveryFailuresByChat.size <= MAX_RECOVERY_LOOP_GUARD_CHATS) return;

  const oldestChats = Array.from(recentRecoveryFailuresByChat.entries())
    .map(([chatJid, records]) => ({
      chatJid,
      lastAtMs: Math.max(...records.map((entry) => entry.atMs)),
    }))
    .sort((a, b) => a.lastAtMs - b.lastAtMs);

  const overflow = recentRecoveryFailuresByChat.size - MAX_RECOVERY_LOOP_GUARD_CHATS;
  for (let i = 0; i < overflow; i += 1) {
    const candidate = oldestChats[i];
    if (!candidate) break;
    recentRecoveryFailuresByChat.delete(candidate.chatJid);
  }
}

export function shouldSuppressRecoveryLoop(options: {
  chatJid: string;
  recoverySourceId?: string;
  recoveryGeneration?: number;
  modelLabel: string | null;
  failureCategory: AgentFailureCategory;
  classifier: RecoveryClassifier;
  strategy: RecoveryStrategy;
  now?: number;
}): { suppress: boolean; attemptsInWindow: number; windowMs: number } {
  const recoveryPolicy = getRecoveryPolicyConfig();
  if (!recoveryPolicy.loopGuardEnabled) {
    return { suppress: false, attemptsInWindow: 0, windowMs: recoveryPolicy.loopGuardWindowMs };
  }

  const now = options.now ?? Date.now();
  const windowMs = Math.max(1, recoveryPolicy.loopGuardWindowMs);
  pruneRecoveryFailureMap(now, windowMs);

  const signature = [
    options.recoverySourceId?.trim() || "legacy-source",
    Math.max(0, Math.trunc(options.recoveryGeneration ?? 0)),
    options.modelLabel ?? "unknown-model",
    options.failureCategory,
    options.classifier,
    options.strategy,
  ].join("|");

  const current = recentRecoveryFailuresByChat.get(options.chatJid) ?? [];
  const filtered = current.filter((entry) => (now - entry.atMs) <= windowMs);
  filtered.push({ atMs: now, signature });
  recentRecoveryFailuresByChat.set(options.chatJid, filtered.slice(-200));

  const attemptsInWindow = filtered.filter((entry) => entry.signature === signature).length;
  const maxFailures = Math.max(1, recoveryPolicy.loopGuardMaxFailures);
  return {
    suppress: attemptsInWindow >= maxFailures,
    attemptsInWindow,
    windowMs,
  };
}

export function resetRecoveryLoopGuardForTests(): void {
  recentRecoveryFailuresByChat.clear();
}

export function shouldAdvanceRecoveryGeneration(options: {
  recoveryGeneration: number;
  successfulRecoveryCompaction: boolean;
  promptWasPersisted: boolean;
  hadCompletedTurnOutput: boolean;
  attemptRanWithExecutionTools: boolean;
  toolExecutionCountAtStart: number;
  toolExecutionCountAtEnd: number;
  hasUnresolvedToolExecution: boolean;
  hadToolFailure: boolean;
  decision: RecoveryDecision;
}): boolean {
  return options.recoveryGeneration + 1 < MAX_RECOVERY_GENERATIONS_PER_SOURCE
    && options.successfulRecoveryCompaction
    && options.promptWasPersisted
    && options.hadCompletedTurnOutput
    && options.attemptRanWithExecutionTools
    && options.toolExecutionCountAtEnd > options.toolExecutionCountAtStart
    && !options.hasUnresolvedToolExecution
    && !options.hadToolFailure
    && options.decision.recover
    && options.decision.strategy !== null;
}

export function shouldDisableToolsForRecoveryAttempt(
  decision: RecoveryDecision,
  snapshot: RecoveryAttemptSnapshot,
  config: AutomaticRecoveryConfig,
): boolean {
  if (decision.classifier === "context_pressure") return Boolean(snapshot.hadToolActivity);
  if (decision.classifier !== "transient") return false;
  return !config.transientRecoveryToolsEnabled || Boolean(snapshot.hasUnresolvedToolExecution);
}

export function buildRecoveryDiagnosticEntry(
  phase: AgentRecoveryDiagnosticEntry["phase"],
  attempt: number,
  classifier: RecoveryClassifier,
  strategy: RecoveryStrategy | null,
  reason: string,
  error: string,
  elapsedMs: number,
  snapshot: RecoveryAttemptSnapshot,
  failureCategory?: AgentFailureCategory,
): AgentRecoveryDiagnosticEntry {
  return {
    phase,
    attempt,
    classifier,
    strategy,
    reason,
    error,
    elapsedMs,
    hadToolActivity: Boolean(snapshot.hadToolActivity),
    hadPartialOutput: Boolean(snapshot.hadPartialOutput),
    hadCompletedTurnOutput: Boolean(snapshot.hadCompletedTurnOutput),
    hadTerminalTurnOutput: Boolean(snapshot.hadTerminalTurnOutput),
    hasUnresolvedToolExecution: Boolean(snapshot.hasUnresolvedToolExecution),
    sawCompactionIntent: Boolean(snapshot.sawCompactionIntent),
    compactionErrorMessage: snapshot.compactionErrorMessage ?? null,
    toolUseBudgetExceeded: Boolean(snapshot.toolUseBudgetExceeded),
    assistantToolUseMessageCount: Number.isFinite(snapshot.assistantToolUseMessageCount)
      ? snapshot.assistantToolUseMessageCount
      : undefined,
    toolExecutionCount: Number.isFinite(snapshot.toolExecutionCount)
      ? snapshot.toolExecutionCount
      : undefined,
    toolUseMessageBudget: Number.isFinite(snapshot.toolUseMessageBudget)
      ? snapshot.toolUseMessageBudget
      : undefined,
    failureCategory,
  };
}

function findToolBudgetDiagnostic(diagnostics: AgentRecoveryDiagnosticEntry[]): AgentRecoveryDiagnosticEntry | null {
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    const entry = diagnostics[index];
    if (entry.toolUseBudgetExceeded
      || entry.classifier === "tool_history_pressure"
      || entry.failureCategory === "tool_budget") {
      return entry;
    }
  }
  return null;
}

function buildToolBudgetRecoveryTerminalError(
  budgetDiagnostic: AgentRecoveryDiagnosticEntry,
  retryErrorText: string,
): { error: string; toolStepsUsed?: number; toolStepsBudget?: number; nextAction: string } {
  const assistantToolUseCount = Number.isFinite(budgetDiagnostic.assistantToolUseMessageCount)
    ? budgetDiagnostic.assistantToolUseMessageCount
    : undefined;
  const toolExecutionCount = Number.isFinite(budgetDiagnostic.toolExecutionCount)
    ? budgetDiagnostic.toolExecutionCount
    : undefined;
  const toolStepsUsed = Number.isFinite(assistantToolUseCount) && (assistantToolUseCount ?? 0) > 0
    ? assistantToolUseCount
    : Number.isFinite(toolExecutionCount) && (toolExecutionCount ?? 0) > 0
      ? toolExecutionCount
      : undefined;
  const toolStepsBudget = Number.isFinite(budgetDiagnostic.toolUseMessageBudget)
    ? budgetDiagnostic.toolUseMessageBudget
    : undefined;
  const budgetDetail = Number.isFinite(toolStepsUsed) && Number.isFinite(toolStepsBudget)
    ? `Tool-use budget exceeded before finalization (${toolStepsUsed}/${toolStepsBudget} tool steps).`
    : Number.isFinite(toolStepsUsed)
      ? `Tool-use budget exceeded before finalization after ${toolStepsUsed} tool execution(s).`
      : "Tool-use budget exceeded before finalization.";
  const retryDetail = retryErrorText.trim()
    ? ` Automatic recovery compacted context and retried, but the retry still produced no terminal assistant reply: ${retryErrorText}`
    : " Automatic recovery compacted context and retried, but the retry still produced no terminal assistant reply.";
  const nextAction = "Ask me to continue; I will resume from the latest known partial state instead of replaying the whole turn.";
  return {
    error: `${budgetDetail}${retryDetail} ${nextAction}`,
    toolStepsUsed: Number.isFinite(toolStepsUsed) ? toolStepsUsed : undefined,
    toolStepsBudget: Number.isFinite(toolStepsBudget) ? toolStepsBudget : undefined,
    nextAction,
  };
}

export function buildRecoveryMetadata(
  attemptsUsed: number,
  totalElapsedMs: number,
  recovered: boolean,
  exhausted: boolean,
  lastClassifier: RecoveryClassifier | null,
  strategyHistory: RecoveryStrategy[],
  diagnostics: AgentRecoveryDiagnosticEntry[],
): AgentRecoveryMetadata {
  return {
    attemptsUsed,
    totalElapsedMs,
    recovered,
    exhausted,
    lastClassifier,
    strategyHistory: [...strategyHistory],
    diagnostics: diagnostics.map((entry) => ({ ...entry })),
  };
}

async function runRecoveryCompaction(
  session: AgentSession,
  chatJid: string,
  runOptions: RunAgentOptions,
  options: Pick<RunAgentRecoveryPhaseOptions, "onInfo" | "onWarn">,
): Promise<{ ok: true; stillOverThreshold: boolean; compacted: boolean } | { ok: false; errorMessage: string }> {
  options.onInfo?.("Compacting before automatic recovery retry", {
    operation: "run_agent.recovery_compact",
    chatJid,
  });
  const retryMetadata: PiclawCompactionTriggerMetadata = {
    chatJid,
    trigger: "recovery",
    willRetry: true,
    source: "automatic_recovery",
  };
  const retryEventFields = buildPiclawCompactionEventFields(retryMetadata, { reason: "overflow", willRetry: true });
  emitAgentSessionEvent(runOptions.onEvent, { type: "compaction_start", ...retryEventFields } as unknown as AgentSessionEvent);
  heartbeatTrackedPhase(chatJid, "preprompt_compaction", {
    eventType: "recovery_compaction_start",
    source: "automatic_recovery",
    ...getRunObservabilityDetails(runOptions),
  });
  const compactionResult = await runCompactionWithTimeout(
    session,
    chatJid,
    options,
    async () => await session.compact(),
    "recovery",
    { trigger: "recovery", willRetry: true, source: "automatic_recovery" },
  );
  heartbeatTrackedPhase(chatJid, "recovery", {
    eventType: "recovery_compaction_end",
    ok: compactionResult.ok,
    ...getRunObservabilityDetails(runOptions),
  });
  if (!compactionResult.ok) {
    const aborted = isCompactionCancellationError(compactionResult.errorMessage);
    const benign = [
      "Already compacted",
      "Nothing to compact (session too small)",
    ].includes(compactionResult.errorMessage);
    if (!compactionResult.joined && !aborted && !benign) {
      noteCompactionFailure(chatJid, compactionResult.errorMessage);
    }
    if (benign) {
      options.onInfo?.("Recovery compaction skipped (benign: session too small or already compacted)", {
        operation: "run_agent.recovery_compact_benign_skip",
        chatJid,
        errorMessage: compactionResult.errorMessage,
      });
      emitAgentSessionEvent(runOptions.onEvent, {
        type: "compaction_end",
        ...retryEventFields,
        result: undefined,
        aborted: false,
        skipped: true,
        willRetry: false,
      } as unknown as AgentSessionEvent);
      return { ok: true, stillOverThreshold: false, compacted: false };
    }
    emitAgentSessionEvent(runOptions.onEvent, {
      type: "compaction_end",
      ...buildPiclawCompactionEventFields(retryMetadata, { reason: "overflow", willRetry: false }),
      result: undefined,
      aborted,
      willRetry: false,
      errorMessage: aborted ? undefined : `Recovery compaction failed: ${compactionResult.errorMessage}`,
    } as unknown as AgentSessionEvent);
    return { ok: false, errorMessage: compactionResult.errorMessage };
  }
  if (!compactionResult.joined) {
    noteCompactionSuccess(session, chatJid, "recovery", {
      ...options,
      countSuccess: false,
    });
  }
  const contextReport = getCompactionContextReport(session, compactionResult.result as { tokensBefore?: unknown; estimatedTokensAfter?: unknown });
  emitAgentSessionEvent(runOptions.onEvent, {
    type: "compaction_end",
    ...retryEventFields,
    result: compactionResult.result,
    aborted: false,
    willRetry: true,
    tokensBefore: contextReport.tokensBefore ?? undefined,
    estimatedTokensAfter: contextReport.estimatedTokensAfter,
    estimatedTokensAfterSource: contextReport.estimatedTokensAfterSource,
    safetyAdjustedTokensAfter: contextReport.safetyAdjustedTokensAfter,
    reductionPercent: contextReport.reductionPercent ?? undefined,
  } as unknown as AgentSessionEvent);
  const usageEvent = buildFreshContextUsageUpdateEvent(session, chatJid, "after_recovery_compaction", {
    source: "compaction_recovery",
  });
  if (usageEvent) emitAgentSessionEvent(runOptions.onEvent, usageEvent);
  const tokenStatus = getAutoCompactionTokenStatusForSession(session, chatJid);
  return { ok: true, stillOverThreshold: Boolean(tokenStatus?.tokenStatus.tokenLimitReached), compacted: true };
}

export async function runAgentRecoveryPhase(options: RunAgentRecoveryPhaseOptions): Promise<AgentOutput> {
  const {
    prompt,
    chatJid,
    timeoutMs,
    startTime,
    modelLabel,
    recoveryConfig,
    runOptions,
  } = options;

  let activeSession = options.session;
  let activeSessionCtrl = options.sessionCtrl;
  let attemptPrompt = prompt;
  let recoveryContinuationWithoutTools = false;
  const protectedPostCompactionToolRetry = { available: Boolean(runOptions.protectedRecoveryContinuation) };
  let lastAttemptWasGenericProtected = false;
  let turnToolExecutionCount = 0;
  let recoveryAttemptsUsed = 0;
  let lastClassifier: RecoveryClassifier | null = null;
  let lastRecoveryErrorText: string | null = null;
  const protectedRecoveryHandoffContext = runOptions.protectedRecoveryHandoffContext;
  const protectedRecoveryPriorAttempts = protectedRecoveryHandoffContext?.recoveryAttempts ?? 0;
  let lastRecoveryCompactionOutcome: "not_attempted" | "succeeded" | "failed" =
    protectedRecoveryHandoffContext?.compaction ?? "not_attempted";
  let hasFreshSuccessfulRecoveryCompaction = false;
  let generationAdvanceAvailableAfterCompaction = false;
  const recoverySourceId = runOptions.recoverySourceId
    ?? protectedRecoveryHandoffContext?.recoverySourceId
    ?? runOptions.turnId
    ?? chatJid;
  let recoveryGeneration = Math.max(0, Math.trunc(
    runOptions.recoveryGeneration
      ?? protectedRecoveryHandoffContext?.recoveryGeneration
      ?? 0,
  ));
  let protectedRecoveryToolsRequired = protectedRecoveryHandoffContext?.toolsRequired ?? false;
  let protectedRecoveryHasUnresolvedToolExecution =
    protectedRecoveryHandoffContext?.reason === "unresolved_tool_execution";
  const strategyHistory: RecoveryStrategy[] = [];
  const recoveryDiagnostics: AgentRecoveryDiagnosticEntry[] = [];
  let recoveryBudgetStartedAt: number | null = null;
  let recoveryBudgetAccumulatedMs = 0;
  let allowPostTimeoutRecoveryWindow = false;

  const getRecoveryBudgetElapsedMs = () => {
    if (recoveryBudgetStartedAt != null) {
      return Math.max(0, recoveryBudgetAccumulatedMs + Date.now() - recoveryBudgetStartedAt);
    }
    if (recoveryBudgetAccumulatedMs > 0) return recoveryBudgetAccumulatedMs;
    return timeoutMs <= 0 || allowPostTimeoutRecoveryWindow
      ? 0
      : Math.max(0, Date.now() - startTime);
  };
  const getRecoveryDecisionElapsedMs = (failureCategory: AgentFailureCategory | undefined, snapshot: RecoveryAttemptSnapshot) => {
    // #778: context-pressure compact_then_retry has two bounded phases:
    // recovery compaction is bounded by the compaction timeout; the
    // continuation prompt receives a fresh recovery budget after compaction.
    // Therefore the initial prompt duration must not exhaust the recovery
    // decision before compaction can run.
    if (recoveryAttemptsUsed === 0 && (failureCategory === "context_pressure" || snapshot.sawCompactionIntent)) return 0;
    return getRecoveryBudgetElapsedMs();
  };
  const startRecoveryBudget = () => {
    if (recoveryBudgetStartedAt == null) recoveryBudgetStartedAt = Date.now();
  };
  const pauseRecoveryBudget = () => {
    if (recoveryBudgetStartedAt == null) return;
    recoveryBudgetAccumulatedMs += Math.max(0, Date.now() - recoveryBudgetStartedAt);
    recoveryBudgetStartedAt = null;
  };
  const buildHandoffMetadata = (reason: ProtectedRecoveryHandoffReason) => buildProtectedRecoveryHandoffMetadata(reason, {
    recoveryAttempts: protectedRecoveryPriorAttempts + recoveryAttemptsUsed,
    compaction: reason === "compaction_failed" ? "failed" : lastRecoveryCompactionOutcome,
    toolsRequired: protectedRecoveryToolsRequired
      || reason === "post_compaction_tools_required"
      || reason === "tools_required"
      || reason === "unresolved_tool_execution",
    retryable: protectedRecoveryHandoffContext?.retryable,
    recoverySourceId,
    recoveryGeneration,
  });
  const inferProtectedHandoffReason = (): ProtectedRecoveryHandoffReason => {
    const latestDiagnostic = recoveryDiagnostics.at(-1);
    if (protectedRecoveryHasUnresolvedToolExecution
      || latestDiagnostic?.hasUnresolvedToolExecution) return "unresolved_tool_execution";
    if (lastRecoveryCompactionOutcome === "failed" || latestDiagnostic?.compactionErrorMessage) return "compaction_failed";
    if (hasFreshSuccessfulRecoveryCompaction
      && lastRecoveryCompactionOutcome === "succeeded") return "post_compaction_tools_required";
    return "tools_required";
  };
  const buildProtectedHandoff = (
    duration: number,
    detail: string,
    finalText: string | null = null,
    reason: ProtectedRecoveryHandoffReason = inferProtectedHandoffReason(),
  ): AgentOutput => {
    const error = `Protected recovery cannot authoritatively complete tool-dependent work: ${detail}`;
    lastClassifier = "tool_activity";
    const recovery = buildRecoveryMetadata(
      recoveryAttemptsUsed,
      duration,
      false,
      true,
      lastClassifier,
      strategyHistory,
      recoveryDiagnostics,
    );
    writeAgentLog(options.logsDir, chatJid, duration, false, finalText, error, recovery);
    emitAgentSessionEvent(runOptions.onEvent, {
      type: "recovery_end",
      outcome: "handoff",
      attemptsUsed: recoveryAttemptsUsed,
      classifier: lastClassifier,
      errorMessage: error,
    });
    return {
      status: "error",
      result: null,
      error,
      failureCategory: "no_terminal_output",
      nextAction: reason === "unresolved_tool_execution"
        ? "Review the unresolved tool side effects before explicitly continuing."
        : "Continue automatically in one ordinary turn with the restored tool baseline.",
      requiresToolEnabledContinuation: true,
      protectedRecoveryHandoff: buildHandoffMetadata(reason),
      recovery,
    };
  };

  while (true) {
    // Yield to the event loop on every iteration. Prevents synchronous-
    // throw + catch + retry from starving the event loop when the error
    // path never reaches an await that actually suspends.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Generic tools-disabled retries cannot authoritatively complete work and
    // their output is intentionally discarded by the protected handoff. Do
    // not spend a provider call producing prose that cannot be committed.
    const pendingGenericProtectedHandoff = recoveryContinuationWithoutTools
      && recoveryAttemptsUsed > 0
      && strategyHistory.at(-1) !== "finalize";
    if (pendingGenericProtectedHandoff) {
      const duration = Date.now() - startTime;
      options.onInfo?.("Skipped unauthoritative tools-disabled recovery provider attempt", {
        operation: "run_agent.recovery_provider_attempt_skipped",
        chatJid,
        recoveryAttempt: recoveryAttemptsUsed,
        recoveryStrategy: strategyHistory.at(-1),
        ...getRunObservabilityDetails(runOptions),
      });
      return buildProtectedHandoff(duration, "the runtime skipped an unauthoritative tools-disabled provider attempt");
    }

    if (recoveryAttemptsUsed > 0 && getRecoveryBudgetElapsedMs() >= recoveryConfig.totalBudgetMs) {
      const duration = Date.now() - startTime;
      if (lastAttemptWasGenericProtected) {
        return buildProtectedHandoff(
          duration,
          lastRecoveryErrorText || "the recovery budget was exhausted",
          null,
          protectedRecoveryHasUnresolvedToolExecution
            ? "unresolved_tool_execution"
            : "recovery_budget_exhausted",
        );
      }
      const error = lastRecoveryErrorText || "Automatic recovery budget exhausted before the next attempt could start.";
      lastClassifier = "budget_exhausted";
      const recovery = buildRecoveryMetadata(
        recoveryAttemptsUsed,
        duration,
        false,
        true,
        lastClassifier,
        strategyHistory,
        recoveryDiagnostics,
      );
      writeAgentLog(options.logsDir, chatJid, duration, false, null, error, recovery);
      emitAgentSessionEvent(runOptions.onEvent, {
        type: "recovery_end",
        outcome: "exhausted",
        attemptsUsed: recoveryAttemptsUsed,
        classifier: lastClassifier,
        errorMessage: error,
      });
      return {
        status: "error" as const,
        result: null,
        error,
        failureCategory: "timeout",
        recovery,
        protectedRecoveryHandoff: runOptions.protectedRecoveryContinuation
          ? buildHandoffMetadata(protectedRecoveryHasUnresolvedToolExecution
            ? "unresolved_tool_execution"
            : "recovery_budget_exhausted")
          : undefined,
      };
    }

    // The configured turn timeout bounds the initial attempt. Once that
    // attempt fails after tool activity, automatic recovery gets its own
    // smaller total budget; otherwise a timeout failure can never reach its
    // bounded continuation decision.
    if (timeoutMs > 0 && recoveryAttemptsUsed === 0) {
      const loopElapsedMs = Date.now() - startTime;
      if (loopElapsedMs > timeoutMs) {
        const duration = Date.now() - startTime;
        writeAgentLog(options.logsDir, chatJid, duration, false, null,
          `Agent run exceeded timeout before recovery (${loopElapsedMs}ms > ${timeoutMs}ms)`);
        return {
          status: "error" as const,
          result: null,
          failureCategory: "timeout",
          error: `Agent run timed out after ${Math.round(loopElapsedMs / 1000)}s`,
        };
      }
    }

    const remainingRecoveryBudgetMs = Math.max(1, recoveryConfig.totalBudgetMs - getRecoveryBudgetElapsedMs());
    const attemptTimeoutMs = recoveryAttemptsUsed > 0
      ? (timeoutMs > 0 ? Math.min(timeoutMs, remainingRecoveryBudgetMs) : remainingRecoveryBudgetMs)
      : timeoutMs;
    let recoverySavedToolNames: string[] | null = null;
    let recoveryOriginalSetActiveToolsByName: ((names: string[]) => void) | null = null;
    let recoveryToolReactivationAttempts = 0;
    const toolControl = activeSessionCtrl;
    const canControlTools = toolControl !== null
      && typeof toolControl.getActiveToolNames === "function"
      && typeof toolControl.setActiveToolsByName === "function";
    if (recoveryContinuationWithoutTools && !canControlTools) {
      const duration = Date.now() - startTime;
      const error = "Automatic recovery requires a tools-disabled continuation, but the active session cannot control tools safely. Ask me to continue in a fresh turn.";
      writeAgentLog(options.logsDir, chatJid, duration, false, null, error);
      return { status: "error", result: null, failureCategory: "provider", error };
    }
    if (recoveryContinuationWithoutTools && canControlTools && toolControl) {
      recoverySavedToolNames = toolControl.getActiveToolNames!();
      rememberActiveToolSubset(activeSession, recoverySavedToolNames);
      recoveryOriginalSetActiveToolsByName = toolControl.setActiveToolsByName!.bind(toolControl);
      recoveryOriginalSetActiveToolsByName([]);
      logToolStateTransition({
        chatJid,
        turnId: runOptions.turnId,
        phase: "recovery",
        cause: "recovery_tools_disabled",
        previous: recoverySavedToolNames,
        next: [],
      });
      // Keep the continuation tools-disabled for the entire attempt. Extension
      // before_agent_start hooks (notably delegate auto-activation) run inside
      // session.prompt() and may call setActiveToolsByName after the initial
      // clear. Without this ceiling they can re-enable long-running tools and
      // consume the whole automatic-recovery budget.
      toolControl.setActiveToolsByName = (names: string[]) => {
        recoveryOriginalSetActiveToolsByName?.([]);
        if (names.length > 0) {
          recoveryToolReactivationAttempts += 1;
          if (recoveryToolReactivationAttempts === 1) {
            options.onWarn?.("Blocked tool reactivation during tools-disabled recovery continuation", {
              operation: "run_agent.recovery_tool_reelevation_blocked",
              chatJid,
              requestedTools: names,
              recoveryAttempt: recoveryAttemptsUsed,
            });
          }
        }
      };
    }
    const finalizationReserveMs = recoveryAttemptsUsed > 0 && !recoveryContinuationWithoutTools
      ? getRecoveryFinalizationReserveMs(attemptTimeoutMs)
      : 0;
    const currentAttemptWasGenericProtected = recoveryContinuationWithoutTools
      && recoveryAttemptsUsed > 0
      && strategyHistory.at(-1) !== "finalize";
    lastAttemptWasGenericProtected = currentAttemptWasGenericProtected;
    const toolExecutionCountAtStart = turnToolExecutionCount;
    const attemptRanWithExecutionTools = !recoveryContinuationWithoutTools
      && Boolean(activeSessionCtrl?.getActiveToolNames?.().length);
    const successfulRecoveryCompactionBeforeAttempt = generationAdvanceAvailableAfterCompaction;
    let attempt: PromptAttemptResult;
    try {
      attempt = await options.runPromptAttempt(attemptPrompt, attemptTimeoutMs, turnToolExecutionCount, finalizationReserveMs);
      turnToolExecutionCount = attempt.toolExecutionCount;
      protectedRecoveryToolsRequired ||= Boolean(
        attempt.snapshot.hadToolActivity || attempt.snapshot.hasUnresolvedToolExecution,
      );
      protectedRecoveryHasUnresolvedToolExecution ||=
        Boolean(attempt.snapshot.hasUnresolvedToolExecution);
    } finally {
      if (recoveryOriginalSetActiveToolsByName && activeSessionCtrl) {
        activeSessionCtrl.setActiveToolsByName = recoveryOriginalSetActiveToolsByName;
      }
      if (recoverySavedToolNames && recoveryOriginalSetActiveToolsByName) {
        recoveryOriginalSetActiveToolsByName(recoverySavedToolNames);
        logToolStateTransition({
          chatJid,
          turnId: runOptions.turnId,
          phase: "recovery",
          cause: "recovery_tools_restore",
          previous: [],
          next: recoverySavedToolNames,
          restored: true,
        });
      }
    }

    if (protectedRecoveryHasUnresolvedToolExecution) {
      return buildProtectedHandoff(
        Date.now() - startTime,
        "a tool execution did not reach a durable resolved state",
        null,
        "unresolved_tool_execution",
      );
    }

    // If the tool-call cap was hit, abort immediately without recovery.
    if (options.toolCallCap?.exceeded) {
      const duration = Date.now() - startTime;
      const used = Number.isFinite(options.toolCallCap.count) ? options.toolCallCap.count : undefined;
      const cap = Number.isFinite(options.toolCallCap.cap) ? options.toolCallCap.cap : undefined;
      const budgetDetail = Number.isFinite(used) && Number.isFinite(cap)
        ? `Tool-use budget exceeded before finalization (${used}/${cap} tool calls).`
        : Number.isFinite(used)
          ? `Tool-use budget exceeded before finalization after ${used} tool call(s).`
          : "Tool-use budget exceeded before finalization.";
      const nextAction = "Ask me to continue; I will resume from the latest known partial state instead of replaying the whole turn.";
      const error = `${budgetDetail} ${nextAction}`;
      writeAgentLog(options.logsDir, chatJid, duration, false, null, error);
      return {
        status: "error",
        result: null,
        error,
        failureCategory: "tool_budget",
        toolBudgetExceeded: true,
        toolStepsUsed: used,
        toolStepsBudget: cap,
        nextAction,
      };
    }

    if (attempt.output.status === "success") {
      const duration = Date.now() - startTime;
      const finalText = typeof attempt.output.result === "string" ? attempt.output.result : null;
      // A generic retry with tools disabled can summarize or explain the
      // interruption, but it cannot prove that tool-dependent work completed.
      // Only the dedicated finalize strategy starts from a structurally
      // complete tool outcome and may accept a tools-disabled closing reply.
      if (currentAttemptWasGenericProtected) {
        return buildProtectedHandoff(duration, "the terminal attempt ran without execution tools", finalText);
      }
      const recoveryMeta = recoveryAttemptsUsed > 0
        ? buildRecoveryMetadata(recoveryAttemptsUsed, duration, true, false, lastClassifier, strategyHistory, recoveryDiagnostics)
        : null;
      writeAgentLog(options.logsDir, chatJid, duration, false, finalText, null, recoveryMeta);
      options.onInfo?.("Agent run completed", {
        operation: "run_agent.complete",
        chatJid,
        model: modelLabel,
        durationMs: duration,
        outputChars: finalText?.length ?? 0,
        recoveryAttemptsUsed,
        recovered: recoveryAttemptsUsed > 0,
        ...getRunObservabilityDetails(runOptions),
      });
      if (recoveryAttemptsUsed > 0) {
        emitAgentSessionEvent(runOptions.onEvent, {
          type: "recovery_end",
          outcome: "recovered",
          attemptsUsed: recoveryAttemptsUsed,
          classifier: lastClassifier,
        });
        attempt.output.recovery = buildRecoveryMetadata(
          recoveryAttemptsUsed,
          duration,
          true,
          false,
          lastClassifier,
          strategyHistory,
          recoveryDiagnostics,
        );
      }
      recentRecoveryFailuresByChat.delete(chatJid);
      return attempt.output;
    }

    if (attempt.output.status === "tool_complete") {
      const duration = Date.now() - startTime;
      if (currentAttemptWasGenericProtected) {
        return buildProtectedHandoff(duration, "the terminal attempt reported tool completion while execution tools were suppressed");
      }
      writeAgentLog(options.logsDir, chatJid, duration, false, null, null, null);
      options.onInfo?.("Agent run completed via terminal tool", {
        operation: "run_agent.tool_complete",
        chatJid,
        model: modelLabel,
        durationMs: duration,
        ...getRunObservabilityDetails(runOptions),
      });
      recentRecoveryFailuresByChat.delete(chatJid);
      return attempt.output;
    }

    let errorText = attempt.output.error || "Agent error";
    const openRouterBudgetDecision = decideOpenRouterAffordabilityRetry(
      errorText,
      modelLabel,
      options.openRouterOutputBudgetState,
    );
    if (openRouterBudgetDecision.kind !== "not_applicable") {
      errorText = openRouterBudgetDecision.detail;
      attempt.output.error = errorText;
      attempt.output.failureCategory = "provider_budget";
    }
    // Runtime attempts normally carry a typed category from finalization. The
    // fallback is only for injected/legacy attempt implementations that expose
    // an opaque error string at this compatibility boundary.
    const failureCategory = attempt.output.failureCategory ?? classifyOpaqueAgentFailure(errorText);
    attempt.output.failureCategory = failureCategory;
    lastRecoveryErrorText = errorText;
    allowPostTimeoutRecoveryWindow = recoveryAttemptsUsed === 0
      && attempt.snapshot.hadToolActivity
      && attempt.timedOut;
    const decision: RecoveryDecision = openRouterBudgetDecision.kind === "retry"
      ? {
          recover: true,
          classifier: "provider_budget",
          strategy: "retry",
          reason: `OpenRouter reported ${openRouterBudgetDecision.affordable} affordable output tokens; retrying once with ${openRouterBudgetDecision.appliedLimit}.`,
        }
      : openRouterBudgetDecision.kind === "terminal"
        ? {
            recover: false,
            classifier: "provider_budget",
            strategy: null,
            reason: `OpenRouter affordability retry stopped: ${openRouterBudgetDecision.reason}.`,
          }
        : decideAutomaticRecovery({
            config: recoveryConfig,
            failureCategory,
            recoveryAttemptsUsed,
            elapsedMs: getRecoveryDecisionElapsedMs(failureCategory, attempt.snapshot),
            snapshot: attempt.snapshot,
          });

    let effectiveDecision = decision;
    if (shouldAdvanceRecoveryGeneration({
      recoveryGeneration,
      successfulRecoveryCompaction: successfulRecoveryCompactionBeforeAttempt,
      promptWasPersisted: attempt.promptWasPersisted,
      hadCompletedTurnOutput: Boolean(attempt.snapshot.hadCompletedTurnOutput),
      attemptRanWithExecutionTools,
      toolExecutionCountAtStart,
      toolExecutionCountAtEnd: attempt.toolExecutionCount,
      hasUnresolvedToolExecution: Boolean(attempt.snapshot.hasUnresolvedToolExecution),
      hadToolFailure: Boolean(attempt.snapshot.hadToolFailure),
      decision,
    })) {
      recoveryGeneration += 1;
      options.onInfo?.("Advanced bounded recovery generation after durable post-compaction progress", {
        operation: "run_agent.recovery_generation_advanced",
        chatJid,
        recoverySourceId,
        recoveryGeneration,
        ...getRunObservabilityDetails(runOptions),
      });
    }
    generationAdvanceAvailableAfterCompaction = false;
    // This retry is already turn-scoped, one-shot, and parameter-changing.
    // The generic cross-turn loop guard must not suppress its first safe use.
    if (decision.recover && decision.strategy && decision.classifier !== "provider_budget") {
      const guard = shouldSuppressRecoveryLoop({
        chatJid,
        recoverySourceId,
        recoveryGeneration,
        modelLabel,
        failureCategory,
        classifier: decision.classifier,
        strategy: decision.strategy,
      });
      if (guard.suppress) {
        effectiveDecision = {
          recover: false,
          classifier: "recovery_suppressed",
          strategy: null,
          reason: `Automatic recovery suppressed after ${guard.attemptsInWindow} repeated failures within ${Math.max(1, Math.round(guard.windowMs / 60000))} minute(s).`,
        };
      }
    }

    lastClassifier = effectiveDecision.classifier;

    options.onWarn?.("Agent attempt failed", {
      operation: "run_agent.attempt_failed",
      chatJid,
      errorText,
      failureCategory: attempt.output.failureCategory ?? "unknown",
      classifier: effectiveDecision.classifier,
      recoveryAttemptsUsed,
      recoveryStrategy: effectiveDecision.strategy,
      reason: effectiveDecision.reason,
      hasUnresolvedToolExecution: Boolean(attempt.snapshot.hasUnresolvedToolExecution),
      transientRecoveryToolsEnabled: recoveryConfig.transientRecoveryToolsEnabled,
      ...getRunObservabilityDetails(runOptions),
    });

    recoveryDiagnostics.push(buildRecoveryDiagnosticEntry(
      "attempt_failure",
      recoveryAttemptsUsed + 1,
      effectiveDecision.classifier,
      effectiveDecision.strategy,
      effectiveDecision.reason,
      errorText,
      Date.now() - startTime,
      attempt.snapshot,
      attempt.output.failureCategory,
    ));

    if (!effectiveDecision.recover || !effectiveDecision.strategy) {
      const duration = Date.now() - startTime;
      if (currentAttemptWasGenericProtected) {
        return buildProtectedHandoff(duration, errorText);
      }
      const toolBudgetDiagnostic = recoveryAttemptsUsed > 0 ? findToolBudgetDiagnostic(recoveryDiagnostics) : null;
      const terminalBudgetFailure = toolBudgetDiagnostic
        && (attempt.output.failureCategory === "no_terminal_output" || attempt.output.failureCategory === "aborted")
        ? buildToolBudgetRecoveryTerminalError(toolBudgetDiagnostic, errorText)
        : null;
      const finalErrorText = terminalBudgetFailure?.error ?? errorText;
      const finalClassifier = terminalBudgetFailure && toolBudgetDiagnostic ? toolBudgetDiagnostic.classifier as RecoveryClassifier : lastClassifier;
      const recoveryMeta = (recoveryAttemptsUsed > 0 || Boolean(finalClassifier))
        ? buildRecoveryMetadata(recoveryAttemptsUsed, duration, false, true, finalClassifier, strategyHistory, recoveryDiagnostics)
        : null;
      writeAgentLog(options.logsDir, chatJid, duration, false, null, finalErrorText, recoveryMeta);
      if (recoveryAttemptsUsed > 0 || effectiveDecision.classifier === "recovery_suppressed") {
        emitAgentSessionEvent(runOptions.onEvent, {
          type: "recovery_end",
          outcome: "exhausted",
          attemptsUsed: recoveryAttemptsUsed,
          classifier: finalClassifier ?? effectiveDecision.classifier,
          errorMessage: finalErrorText,
        });
      }
      if (recoveryMeta) {
        attempt.output.recovery = recoveryMeta;
      }
      if (terminalBudgetFailure) {
        attempt.output.error = finalErrorText;
        attempt.output.failureCategory = "tool_budget";
        attempt.output.toolBudgetExceeded = true;
        attempt.output.toolStepsUsed = terminalBudgetFailure.toolStepsUsed;
        attempt.output.toolStepsBudget = terminalBudgetFailure.toolStepsBudget;
        attempt.output.nextAction = terminalBudgetFailure.nextAction;
      }
      const providerRetryExhausted = recoveryAttemptsUsed > 0
        && (attempt.output.failureCategory === "rate_limit"
          || attempt.output.failureCategory === "network"
          || attempt.output.failureCategory === "timeout"
          || attempt.output.failureCategory === "provider"
          || attempt.output.failureCategory === "provider_unavailable"
          || attempt.output.failureCategory === "unknown");
      if (runOptions.protectedRecoveryContinuation
        && (protectedRecoveryHasUnresolvedToolExecution || providerRetryExhausted)) {
        attempt.output.protectedRecoveryHandoff = buildHandoffMetadata(
          protectedRecoveryHasUnresolvedToolExecution
            ? "unresolved_tool_execution"
            : "provider_retry_exhausted",
        );
      }
      return attempt.output;
    }

    recoveryAttemptsUsed += 1;
    strategyHistory.push(effectiveDecision.strategy);
    const retryDelayMs = effectiveDecision.strategy === "retry" && effectiveDecision.classifier !== "provider_budget"
      ? getAutomaticRecoveryDelayMs(recoveryConfig, recoveryAttemptsUsed)
      : 0;
    heartbeatTrackedPhase(chatJid, "recovery", {
      eventType: "recovery_start",
      attempt: recoveryAttemptsUsed,
    });
    emitAgentSessionEvent(runOptions.onEvent, {
      type: "recovery_start",
      classifier: effectiveDecision.classifier,
      failureCategory: attempt.output.failureCategory,
      strategy: effectiveDecision.strategy,
      attempt: recoveryAttemptsUsed,
      maxAttempts: recoveryConfig.maxAttempts,
      totalBudgetMs: recoveryConfig.totalBudgetMs,
      delayMs: retryDelayMs,
      reason: effectiveDecision.classifier,
    });

    if (effectiveDecision.strategy !== "compact_then_retry"
      && recoveryBudgetStartedAt == null
      && recoveryBudgetAccumulatedMs === 0
      && (timeoutMs <= 0 || allowPostTimeoutRecoveryWindow)) {
      startRecoveryBudget();
    }

    const nextAttemptWouldBeGenericProtected = effectiveDecision.strategy !== "finalize"
      && shouldDisableToolsForRecoveryAttempt(
        effectiveDecision,
        attempt.snapshot,
        recoveryConfig,
      );
    // A regular retry needs no compaction or rotation before its ordinary
    // continuation. Hand it off immediately instead of waiting and then
    // making a disposable tools-disabled provider request.
    if (nextAttemptWouldBeGenericProtected && effectiveDecision.strategy !== "compact_then_retry") {
      const duration = Date.now() - startTime;
      options.onInfo?.("Skipped unauthoritative tools-disabled recovery provider attempt", {
        operation: "run_agent.recovery_provider_attempt_skipped",
        chatJid,
        recoveryAttempt: recoveryAttemptsUsed,
        recoveryStrategy: effectiveDecision.strategy,
        ...getRunObservabilityDetails(runOptions),
      });
      return buildProtectedHandoff(duration, "the runtime skipped an unauthoritative tools-disabled provider attempt");
    }

    if (retryDelayMs > 0) {
      heartbeatTrackedPhase(chatJid, "recovery", {
        eventType: "recovery_delay",
        delayMs: retryDelayMs,
      });
      await sleep(retryDelayMs);
    }

    // AgentSession persists the user message before invoking the provider.
    // Replaying the original text after a failed attempt duplicates the
    // instruction and can repeat side-effecting tools. Resume persisted
    // turns with a neutral continuation; only replay when no branch state
    // was appended (for example, a synchronous pre-prompt throw).
    if (attempt.promptWasPersisted || attempt.snapshot.hadToolActivity) {
      attemptPrompt = RECOVERY_CONTINUATION_PROMPT;
    }
    recoveryContinuationWithoutTools = effectiveDecision.strategy === "finalize"
      || shouldDisableToolsForRecoveryAttempt(
        effectiveDecision,
        attempt.snapshot,
        recoveryConfig,
      );


    if (effectiveDecision.strategy === "compact_then_retry") {
      pauseRecoveryBudget();
      // A new compaction attempt must establish fresh authority of its own;
      // a benign skip cannot reuse an earlier successful compaction.
      hasFreshSuccessfulRecoveryCompaction = false;
      const compactionResult = await runRecoveryCompaction(activeSession, chatJid, runOptions, options);
      if (compactionResult.ok && compactionResult.compacted) {
        hasFreshSuccessfulRecoveryCompaction = true;
        generationAdvanceAvailableAfterCompaction = true;
      }
      lastRecoveryCompactionOutcome = !compactionResult.ok
        ? "failed"
        : compactionResult.compacted || hasFreshSuccessfulRecoveryCompaction
          ? "succeeded"
          : "not_attempted";
      heartbeatTrackedPhase(chatJid, "preprompt_compaction", {
        eventType: "recovery_compaction",
        attempt: recoveryAttemptsUsed,
      });
      if (!compactionResult.ok) {
        const compactionFailureCategory = classifyOpaqueAgentFailure(compactionResult.errorMessage);
        const compactDecision = decideAutomaticRecovery({
          config: recoveryConfig,
          failureCategory: compactionFailureCategory,
          recoveryAttemptsUsed,
          elapsedMs: getRecoveryBudgetElapsedMs(),
          snapshot: {
            hadToolActivity: false,
            hadPartialOutput: attempt.snapshot.hadPartialOutput,
            hadCompletedTurnOutput: attempt.snapshot.hadCompletedTurnOutput,
            hadTerminalTurnOutput: attempt.snapshot.hadTerminalTurnOutput,
            compactionErrorMessage: compactionResult.errorMessage,
            sawCompactionIntent: true,
            toolUseBudgetExceeded: attempt.snapshot.toolUseBudgetExceeded,
            assistantToolUseMessageCount: attempt.snapshot.assistantToolUseMessageCount,
            toolExecutionCount: attempt.snapshot.toolExecutionCount,
            toolUseMessageBudget: attempt.snapshot.toolUseMessageBudget,
          },
        });
        lastClassifier = compactDecision.classifier;
        if (!compactDecision.recover || compactDecision.strategy !== "retry") {
          const rotationReason = `Recovery compaction failed: ${compactionResult.errorMessage}`;
          const rotation = await options.rotateAfterCompactionFailure?.(rotationReason);
          if (rotation?.ok) {
            activeSession = rotation.session;
            activeSessionCtrl = rotation.sessionCtrl;
            recoveryContinuationWithoutTools = true;
            options.onWarn?.("Emergency-rotated session after recovery compaction failure", {
              operation: "run_agent.recovery_compaction_failure_emergency_rotate",
              chatJid,
              reason: rotationReason,
            });
            startRecoveryBudget();
            options.clearAttachments(chatJid);
            continue;
          }
          const terminalError = rotation && !rotation.ok
            ? `${rotationReason} Emergency rotation failed: ${rotation.errorMessage}`
            : compactionResult.errorMessage;
          recoveryDiagnostics.push(buildRecoveryDiagnosticEntry(
            "compaction_failure",
            recoveryAttemptsUsed,
            compactDecision.classifier,
            compactDecision.strategy,
            compactDecision.reason,
            terminalError,
            Date.now() - startTime,
            {
              hadToolActivity: false,
              hadPartialOutput: attempt.snapshot.hadPartialOutput,
              hadCompletedTurnOutput: attempt.snapshot.hadCompletedTurnOutput,
              hadTerminalTurnOutput: attempt.snapshot.hadTerminalTurnOutput,
              compactionErrorMessage: compactionResult.errorMessage,
              sawCompactionIntent: true,
              toolUseBudgetExceeded: attempt.snapshot.toolUseBudgetExceeded,
              assistantToolUseMessageCount: attempt.snapshot.assistantToolUseMessageCount,
              toolExecutionCount: attempt.snapshot.toolExecutionCount,
              toolUseMessageBudget: attempt.snapshot.toolUseMessageBudget,
            },
            compactionFailureCategory,
          ));
          const duration = Date.now() - startTime;
          const recoveryMeta = buildRecoveryMetadata(
            recoveryAttemptsUsed,
            duration,
            false,
            true,
            lastClassifier,
            strategyHistory,
            recoveryDiagnostics,
          );
          writeAgentLog(options.logsDir, chatJid, duration, false, null, terminalError, recoveryMeta);
          emitAgentSessionEvent(runOptions.onEvent, {
            type: "recovery_end",
            outcome: "exhausted",
            attemptsUsed: recoveryAttemptsUsed,
            classifier: compactDecision.classifier,
            errorMessage: terminalError,
          });
          return {
            status: "error",
            result: null,
            error: terminalError,
            recovery: recoveryMeta,
            protectedRecoveryHandoff: buildHandoffMetadata(protectedRecoveryHasUnresolvedToolExecution
              ? "unresolved_tool_execution"
              : "compaction_failed"),
          };
        }
      } else if (compactionResult.stillOverThreshold) {
        const reason = "Recovery compaction completed but the session remains above the context threshold.";
        if (!options.rotateAfterInsufficientCompaction) {
          const duration = Date.now() - startTime;
          writeAgentLog(options.logsDir, chatJid, duration, false, null, reason);
          return { status: "error", result: null, error: `${reason} Refusing to retry in the same session.` };
        }
        const rotation = await options.rotateAfterInsufficientCompaction(reason);
        if (!rotation.ok) {
          const duration = Date.now() - startTime;
          const error = `${reason} Emergency rotation failed: ${rotation.errorMessage}`;
          writeAgentLog(options.logsDir, chatJid, duration, false, null, error);
          return { status: "error", result: null, failureCategory: "provider", error };
        }
        activeSession = rotation.session;
        activeSessionCtrl = rotation.sessionCtrl;
        options.onWarn?.("Emergency-rotated session after insufficient recovery compaction", {
          operation: "run_agent.recovery_compaction_emergency_rotate",
          chatJid,
          reason,
        });
      }
      if (compactionResult.ok
        && compactionResult.compacted
        && recoveryContinuationWithoutTools
        && !protectedRecoveryHasUnresolvedToolExecution
        && protectedPostCompactionToolRetry.available) {
        recoveryContinuationWithoutTools = false;
        protectedPostCompactionToolRetry.available = false;
        options.onInfo?.("Re-armed one tool-enabled retry after protected recovery compaction", {
          operation: "run_agent.protected_recovery_post_compaction_retry",
          chatJid,
          recoveryAttempt: recoveryAttemptsUsed,
          ...getRunObservabilityDetails(runOptions),
        });
      }
      startRecoveryBudget();
    }

    heartbeatTrackedPhase(chatJid, "prompt", {
      eventType: "recovery_retry_ready",
      attempt: recoveryAttemptsUsed,
    });
    options.clearAttachments(chatJid);
  }
}
