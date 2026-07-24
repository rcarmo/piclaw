/**
 * agent-pool/run-agent-orchestrator.ts – Main runAgent prompt lifecycle orchestration.
 */

import { type AgentSession, type AgentSessionEvent, type AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import type { AttachmentInfo } from "./attachments.js";
import {
  trackToolStart as trackToolStartActivity,
  trackToolEnd as trackToolEndActivity,
  updateSessionStreaming,
  updateSessionModel,
} from "../extensions/session-status.js";
import { deleteSshConfig } from "../db.js";
import { clearLiveSshConfig } from "../extensions/ssh-core.js";

import {
  decideAutomaticRecovery,
  getAutomaticRecoveryConfig,
  getAutomaticRecoveryDelayMs,
  isLengthStopFailure,
  type RecoveryAttemptSnapshot,
  type RecoveryClassifier,
  type RecoveryStrategy,
} from "./automatic-recovery.js";
import { getAgentRuntimeConfig, getMidTurnToolExecutionHardCeiling, getSessionStorageConfig, getToolUseMessageBudget } from "../core/config.js";
import { detectChannel } from "../router.js";
import { pruneOrphanToolResults } from "./orphan-tool-results.js";
import { writeAgentLog } from "./logging.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { parsePositiveIntStrict } from "../utils/strict-int.js";
import { getSessionFileLineCount, getSessionFileSize, isRotationFallbackCompactionError, rotateSession } from "../session-rotation.js";
import { getCompactionSuccessCount, resetCompactionSuccessCount } from "./compaction.js";
import { withChatContext } from "../core/chat-context.js";
import {
  formatTimeoutDuration,
  resolveSessionIdleMaxWaitMs,
  waitForSessionIdle,
} from "./prompt-utils.js";
import {
  cancelScheduledIdleAutoCompaction,
  buildFreshContextUsageUpdateEvent,
  clearCompactionFailureBackoff,
  getAutoCompactionTokenStatusForSession,
  getCompactionContextReport,
  isCompactionCancellationError,
  maybeAutoCompactSessionAfterTurn,
  maybeAutoCompactSessionBeforePrompt,
  noteCompactionFailure,
  noteCompactionSuccess,
  runCompactionWithTimeout,
} from "./compaction.js";
import { buildPiclawCompactionEventFields, type PiclawCompactionTriggerMetadata } from "./compaction-trigger-context.js";
import {
  inspectBlankTurnSessionDelta,
  isBlankTurnSessionDelta,
  snapshotSessionEntryCount,
} from "./blank-turn-detection.js";
import {
  didPromptAdvanceSession,
  getSessionLeafId,
  RECOVERY_CONTINUATION_PROMPT,
} from "./context-pressure-retry.js";
import type { AgentTurnCoordinator } from "./turn-coordinator.js";
import type { AgentOutput, AgentRecoveryDiagnosticEntry, AgentRecoveryMetadata, RetrySettingsProvider, RunAgentOptions } from "./contracts.js";
import { isPendingShutdown } from "../runtime/shutdown-registry.js";
import {
  beginTrackedPhase,
  heartbeatTrackedPhase,
  endTrackedPhase,
  getProgressWatchdogTimeoutMs,
  registerProgressWatchdogAborter,
} from "../runtime/progress-watchdog.js";

const log = createLogger("agent-pool.run-orchestrator");

/** Dependencies required to run a main agent prompt. */
export interface RunAgentOrchestratorOptions {
  getOrCreateRuntime: (chatJid: string) => Promise<AgentSessionRuntime>;
  turnCoordinator: AgentTurnCoordinator;
  clearAttachments: (chatJid: string) => void;
  takeAttachments: (chatJid: string) => AttachmentInfo[];
  logsDir: string;
  setActiveForkBaseLeaf: (chatJid: string, leafId: string | null) => void;
  clearActiveForkBaseLeaf: (chatJid: string) => void;
  onInfo?: (message: string, details: Record<string, unknown>) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await Bun.sleep(ms);
}

const MIN_TOOL_EXECUTION_WATCHDOG_HEARTBEAT_MS = 1_000;
const MAX_TOOL_EXECUTION_WATCHDOG_HEARTBEAT_MS = 15_000;
const MID_TURN_CONTEXT_CHECK_MIN_INTERVAL_MS = 1_000;
const CONTEXT_USAGE_UPDATE_MIN_INTERVAL_MS = 250;
const DEFAULT_RECOVERY_LOOP_GUARD_MAX_FAILURES = 3;
const DEFAULT_RECOVERY_LOOP_GUARD_WINDOW_MS = 10 * 60 * 1000;
const MAX_RECOVERY_LOOP_GUARD_CHATS = 512;

/**
 * Default hard ceiling on tool executions within a single prompt attempt before
 * forcing an abort for compaction. The effective value is runtime-configurable
 * via getMidTurnToolExecutionHardCeiling().
 */
const DEFAULT_MID_TURN_TOOL_EXECUTION_HARD_CEILING = 48;

/** Approximate characters-per-token ratio for projecting tool-result size onto context tokens. */
const TOOL_RESULT_CHARS_PER_TOKEN = 4;

type RecoveryFailureSignatureRecord = {
  atMs: number;
  signature: string;
};

type UpstreamAutoCompactionMethod = (...args: unknown[]) => unknown;

type UpstreamAutoCompactionSession = Record<string, unknown> & {
  _checkCompaction?: UpstreamAutoCompactionMethod;
  _runAutoCompaction?: UpstreamAutoCompactionMethod;
};

const recentRecoveryFailuresByChat = new Map<string, RecoveryFailureSignatureRecord[]>();
let warnedMissingUpstreamAutoCompactionSuppressorMethods = false;

function isPrivateUpstreamAutoCompactionSuppressorEnabled(): boolean {
  // Future experiment flag: keep the public upstream auto-compaction switch disabled at session creation,
  // but run prompts without patching upstream private methods. This lets us canary whether public controls
  // are sufficient before removing Piclaw-managed compaction boundaries and telemetry.
  return process.env.PICLAW_DISABLE_PRIVATE_UPSTREAM_AUTO_COMPACTION_SUPPRESSOR !== "1";
}

function suppressUpstreamAutoCompactionDuringPrompt(
  session: AgentSession,
  chatJid: string,
  options: Pick<RunAgentOrchestratorOptions, "onWarn">,
): () => void {
  const upstream = session as unknown as UpstreamAutoCompactionSession;
  const originalCheckCompaction = typeof upstream._checkCompaction === "function"
    ? upstream._checkCompaction
    : null;
  const originalRunAutoCompaction = typeof upstream._runAutoCompaction === "function"
    ? upstream._runAutoCompaction
    : null;

  if (!isPrivateUpstreamAutoCompactionSuppressorEnabled()) return () => {};

  if (!originalCheckCompaction && !originalRunAutoCompaction) {
    if (!warnedMissingUpstreamAutoCompactionSuppressorMethods) {
      warnedMissingUpstreamAutoCompactionSuppressorMethods = true;
      options.onWarn?.("Upstream auto-compaction private suppressor methods were not found", {
        operation: "run_agent.suppress_upstream_auto_compaction.missing_private_methods",
        chatJid,
        reason: "Piclaw still disables upstream auto-compaction through setAutoCompactionEnabled(false), but the private _checkCompaction/_runAutoCompaction canary could not be installed. Re-audit upstream AgentSession auto-compaction controls before removing Piclaw-managed compaction.",
        expectedMethods: ["_checkCompaction", "_runAutoCompaction"],
      });
    }
    return () => {};
  }

  let suppressedCount = 0;
  const warnSuppressed = (method: "_checkCompaction" | "_runAutoCompaction", args: unknown[]) => {
    suppressedCount += 1;
    const details = {
      operation: "run_agent.suppress_upstream_auto_compaction",
      chatJid,
      method,
      suppressedCount,
      reason: "Piclaw wraps compaction with its own timeout/backoff/recovery policy; upstream AgentSession auto-compaction has no wall-clock timeout.",
      upstreamReason: typeof args[0] === "string" ? args[0] : undefined,
    };
    options.onWarn?.("Suppressed upstream unbounded auto-compaction during managed prompt", details);
  };

  const checkReplacement = async (...args: unknown[]) => {
    warnSuppressed("_checkCompaction", args);
  };
  const runReplacement = async (...args: unknown[]) => {
    warnSuppressed("_runAutoCompaction", args);
  };

  if (originalCheckCompaction) upstream._checkCompaction = checkReplacement;
  if (originalRunAutoCompaction) upstream._runAutoCompaction = runReplacement;

  return () => {
    if (originalCheckCompaction && upstream._checkCompaction === checkReplacement) {
      upstream._checkCompaction = originalCheckCompaction;
    }
    if (originalRunAutoCompaction && upstream._runAutoCompaction === runReplacement) {
      upstream._runAutoCompaction = originalRunAutoCompaction;
    }
  };
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
      lastAtMs: records.length > 0 ? records[records.length - 1]!.atMs : 0,
    }))
    .sort((a, b) => a.lastAtMs - b.lastAtMs);

  const overflow = recentRecoveryFailuresByChat.size - MAX_RECOVERY_LOOP_GUARD_CHATS;
  for (let i = 0; i < overflow; i += 1) {
    const candidate = oldestChats[i];
    if (!candidate) break;
    recentRecoveryFailuresByChat.delete(candidate.chatJid);
  }
}

function normalizeRecoverySignatureText(value: string | null | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\b\d{2,}\b/g, "#")
    .replace(/[0-9a-f]{8,}/gi, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRecoveryLoopGuardEnabled(): boolean {
  const normalized = String(process.env.PICLAW_RECOVERY_LOOP_GUARD_ENABLED || "").trim().toLowerCase();
  if (!normalized) return true;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return true;
}

function parseRecoveryLoopGuardMaxFailures(): number {
  return parsePositiveIntStrict(process.env.PICLAW_RECOVERY_LOOP_GUARD_MAX_FAILURES, DEFAULT_RECOVERY_LOOP_GUARD_MAX_FAILURES);
}

function parseRecoveryLoopGuardWindowMs(): number {
  return parsePositiveIntStrict(process.env.PICLAW_RECOVERY_LOOP_GUARD_WINDOW_MS, DEFAULT_RECOVERY_LOOP_GUARD_WINDOW_MS);
}

function shouldSuppressRecoveryLoop(options: {
  chatJid: string;
  modelLabel: string | null;
  classifier: string;
  strategy: string | null;
  errorText: string;
}): { suppress: boolean; attemptsInWindow: number; maxFailures: number; windowMs: number } {
  const maxFailures = parseRecoveryLoopGuardMaxFailures();
  const windowMs = parseRecoveryLoopGuardWindowMs();
  if (!parseRecoveryLoopGuardEnabled()) {
    return {
      suppress: false,
      attemptsInWindow: 0,
      maxFailures,
      windowMs,
    };
  }

  const now = Date.now();
  pruneRecoveryFailureMap(now, windowMs);

  const signature = [
    normalizeRecoverySignatureText(options.modelLabel),
    normalizeRecoverySignatureText(options.classifier),
    normalizeRecoverySignatureText(options.strategy),
    normalizeRecoverySignatureText(options.errorText),
  ].join("|");

  const current = recentRecoveryFailuresByChat.get(options.chatJid) ?? [];
  const filtered = current.filter((entry) => (now - entry.atMs) <= windowMs);
  filtered.push({ atMs: now, signature });
  recentRecoveryFailuresByChat.set(options.chatJid, filtered.slice(-200));

  const attemptsInWindow = filtered.filter((entry) => entry.signature === signature).length;
  return {
    suppress: attemptsInWindow >= maxFailures,
    attemptsInWindow,
    maxFailures,
    windowMs,
  };
}

type ToolExecutionWatchdogEvent = {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  toolCallId?: unknown;
  toolName?: unknown;
};

function getToolExecutionWatchdogHeartbeatIntervalMs(timeoutMs = getProgressWatchdogTimeoutMs()): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 0;
  return Math.max(
    MIN_TOOL_EXECUTION_WATCHDOG_HEARTBEAT_MS,
    Math.min(MAX_TOOL_EXECUTION_WATCHDOG_HEARTBEAT_MS, Math.floor(timeoutMs / 3)),
  );
}

function buildContextUsageUpdateEvent(
  tokens: number,
  contextWindow: number,
  phase: string,
): AgentSessionEvent {
  return {
    type: "context_usage_update",
    tokens,
    contextWindow,
    percent: contextWindow > 0 ? (tokens / contextWindow) * 100 : null,
    estimated: true,
    source: "agent_orchestrator",
    phase,
  } as unknown as AgentSessionEvent;
}

export function createToolExecutionWatchdogHeartbeatController(
  chatJid: string,
  options: {
    heartbeat?: (chatJid: string, phase: "tool_execution", metadata?: Record<string, unknown>) => void;
    getIntervalMs?: () => number;
  } = {},
): { handleEvent: (event: ToolExecutionWatchdogEvent) => void; stop: () => void } {
  const heartbeat = options.heartbeat ?? heartbeatTrackedPhase;
  const getIntervalMs = options.getIntervalMs ?? (() => getToolExecutionWatchdogHeartbeatIntervalMs());
  const activeTools = new Map<string, string | null>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let anonymousToolCounter = 0;

  const stopTimerIfIdle = () => {
    if (activeTools.size > 0 || !timer) return;
    clearInterval(timer);
    timer = null;
  };

  const publishHeartbeat = () => {
    if (activeTools.size === 0) return;
    const toolNames = Array.from(new Set(
      Array.from(activeTools.values()).filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    )).slice(0, 3);
    heartbeat(chatJid, "tool_execution", {
      eventType: "tool_execution_watchdog_heartbeat",
      activeToolCount: activeTools.size,
      activeToolNames: toolNames,
    });
  };

  const ensureTimer = () => {
    if (timer || activeTools.size === 0) return;
    const intervalMs = getIntervalMs();
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return;
    timer = setInterval(() => {
      publishHeartbeat();
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  };

  const resolveToolKey = (event: ToolExecutionWatchdogEvent): string => {
    if (typeof event.toolCallId === "string" && event.toolCallId.trim()) return event.toolCallId;
    anonymousToolCounter += 1;
    return `anonymous-tool:${anonymousToolCounter}`;
  };

  const removeTool = (event: ToolExecutionWatchdogEvent) => {
    if (typeof event.toolCallId === "string" && event.toolCallId.trim()) {
      activeTools.delete(event.toolCallId);
      return;
    }
    const targetName = typeof event.toolName === "string" && event.toolName.trim() ? event.toolName : null;
    for (const [key, activeName] of activeTools) {
      if (targetName === null || activeName === targetName) {
        activeTools.delete(key);
        return;
      }
    }
  };

  return {
    handleEvent(event: ToolExecutionWatchdogEvent) {
      if (event.type === "tool_execution_start") {
        const toolName = typeof event.toolName === "string" && event.toolName.trim() ? event.toolName : null;
        activeTools.set(resolveToolKey(event), toolName);
        ensureTimer();
        return;
      }
      if (event.type === "tool_execution_end") {
        removeTool(event);
        stopTimerIfIdle();
      }
    },
    stop() {
      activeTools.clear();
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

async function maybeAutoRotateSession(
  session: AgentSession,
  runtime: AgentSessionRuntime,
  chatJid: string,
  options: Pick<RunAgentOrchestratorOptions, "onInfo" | "onWarn">,
): Promise<AgentSession> {
  const sessionStorageConfig = getSessionStorageConfig();
  const autoRotateEnabled = sessionStorageConfig.autoRotate
    || ["1", "true", "yes", "on"].includes((process.env.PICLAW_SESSION_AUTO_ROTATE || "").trim().toLowerCase());
  if (!autoRotateEnabled) return session;

  const envThresholdMb = parsePositiveIntStrict(process.env.PICLAW_SESSION_MAX_SIZE_MB, 0);
  const thresholdBytes = envThresholdMb > 0
    ? envThresholdMb * 1024 * 1024
    : sessionStorageConfig.maxSizeBytes;

  const sessionFileSize = getSessionFileSize(session.sessionFile);
  const sessionFileLines = getSessionFileLineCount(session.sessionFile);
  const exceedsSize = sessionFileSize !== null && sessionFileSize >= thresholdBytes;
  const exceedsLines = sessionStorageConfig.maxLines > 0
    && sessionFileLines !== null
    && sessionFileLines >= sessionStorageConfig.maxLines;
  const compactionCount = getCompactionSuccessCount(chatJid);
  const exceedsCompactions = sessionStorageConfig.maxCompactionsBeforeRotation > 0
    && compactionCount >= sessionStorageConfig.maxCompactionsBeforeRotation;
  if (!exceedsSize && !exceedsLines && !exceedsCompactions) return session;

  if (session.isStreaming || session.isCompacting || session.isRetrying) {
    const idleMaxWaitMs = resolveSessionIdleMaxWaitMs(session);
    try {
      await waitForSessionIdle(session, 10, (result) => {
        options.onInfo?.("Oversized session settled before auto-rotation", {
          operation: "maybe_auto_rotate_session.wait_for_idle",
          chatJid,
          waitMs: result.totalWaitMs,
          settleTicks: result.settleTicks,
        });
      }, idleMaxWaitMs);
    } catch (error) {
      options.onWarn?.("Auto-rotation skipped", {
        operation: "maybe_auto_rotate_session",
        chatJid,
        reason: error instanceof Error ? error.message : String(error),
      });
      return session;
    }
  }

  const result = await rotateSession(session, runtime, {
    reason: "automatic",
    fallbackOnCompactionFailure: true,
    chatJid,
  });
  if (result.status === "success") {
    resetCompactionSuccessCount(chatJid);
    noteCompactionSuccess(runtime.session, chatJid, "rotation", {
      ...options,
      countSuccess: false,
      clearBackoff: false,
    });
    options.onInfo?.("Auto-rotated oversized session", {
      operation: "maybe_auto_rotate_session",
      chatJid,
      previousSize: result.previousSize ?? sessionFileSize,
      previousLines: sessionFileLines,
      nextSize: result.nextSize ?? "unknown",
      trigger: exceedsCompactions ? "compactions" : exceedsLines ? "lines" : "size",
    });
    return runtime.session;
  }

  options.onWarn?.("Auto-rotation skipped", {
    operation: "maybe_auto_rotate_session",
    chatJid,
    reason: result.message,
  });
  return session;
}

function getSessionStateErrorMessage(session: AgentSession): string | null {
  const errorMessage = (session as AgentSession & {
    agent?: { state?: { errorMessage?: unknown } };
  }).agent?.state?.errorMessage;
  return typeof errorMessage === "string" && errorMessage.trim() ? errorMessage.trim() : null;
}

interface PromptAttemptResult {
  output: AgentOutput;
  snapshot: RecoveryAttemptSnapshot;
  promptWasPersisted: boolean;
  timedOut: boolean;
}

function buildRecoveryDiagnosticEntry(
  phase: AgentRecoveryDiagnosticEntry["phase"],
  attempt: number,
  classifier: string,
  strategy: string | null,
  reason: string,
  error: string,
  elapsedMs: number,
  snapshot: RecoveryAttemptSnapshot,
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
    sawCompactionIntent: Boolean(snapshot.sawCompactionIntent),
    compactionErrorMessage: snapshot.compactionErrorMessage ?? null,
    toolUseBudgetExceeded: Boolean(snapshot.toolUseBudgetExceeded),
    assistantToolUseMessageCount: Number.isFinite(snapshot.assistantToolUseMessageCount)
      ? snapshot.assistantToolUseMessageCount
      : undefined,
    toolExecutionCount: Number.isFinite(snapshot.toolExecutionCount)
      ? snapshot.toolExecutionCount
      : undefined,
  };
}

function resolveToolBudgetSoftStopThreshold(budget: number): number {
  const normalized = Math.max(1, Math.floor(Number.isFinite(budget) ? budget : 1));
  const margin = Math.min(8, Math.max(1, Math.ceil(normalized * 0.125)));
  return Math.max(1, normalized - margin);
}

function isAbortFailureText(errorText: string): boolean {
  return /\b(?:aborterror|aborted|operation was aborted|request was aborted)\b/i.test(errorText);
}

function buildLengthStopError(partialText: string | null | undefined): string {
  const partialDetail = partialText && partialText.trim()
    ? " The partial answer was preserved; ask me to continue to resume from it."
    : " Ask me to continue and I will retry with a shorter final answer.";
  return `Provider stopped because it hit the maximum output length before finalization (finish reason: length).${partialDetail}`;
}

function findToolBudgetDiagnostic(diagnostics: AgentRecoveryDiagnosticEntry[]): AgentRecoveryDiagnosticEntry | null {
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    const entry = diagnostics[index];
    const toolExecutionCeilingReached = entry.sawCompactionIntent
      && Number.isFinite(entry.toolExecutionCount)
      && (entry.toolExecutionCount ?? 0) > 0;
    if (entry.toolUseBudgetExceeded
      || entry.classifier === "tool_history_pressure"
      || /tool(?:-| )use budget exceeded/i.test(entry.error)
      || toolExecutionCeilingReached) {
      return entry;
    }
  }
  return null;
}

function buildToolBudgetRecoveryTerminalError(
  budgetDiagnostic: AgentRecoveryDiagnosticEntry,
  retryErrorText: string,
): { error: string; toolStepsUsed?: number; toolStepsBudget?: number; nextAction: string } {
  const parsed = /\((\d+)\/(\d+) tool steps\)/i.exec(budgetDiagnostic.error);
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
      : parsed ? Number(parsed[1]) : undefined;
  const toolStepsBudget = parsed ? Number(parsed[2]) : undefined;
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

function buildRecoveryMetadata(
  attemptsUsed: number,
  totalElapsedMs: number,
  recovered: boolean,
  exhausted: boolean,
  lastClassifier: string | null,
  strategyHistory: string[],
  diagnostics: AgentRecoveryDiagnosticEntry[],
): AgentRecoveryMetadata {
  return {
    attemptsUsed,
    totalElapsedMs,
    recovered,
    exhausted,
    lastClassifier,
    strategyHistory,
    diagnostics,
  };
}

function emitAgentSessionEvent(onEvent: RunAgentOptions["onEvent"], event: Record<string, unknown>): void {
  onEvent?.(event as AgentSessionEvent);
}

function estimatePendingInputTokens(prompt: string): number {
  return Math.max(0, Math.ceil(String(prompt || "").length / 4));
}

function getUsageInputTokens(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  const record = usage as Record<string, unknown>;
  const candidates = [record.input, record.inputTokens, record.input_tokens, record.prompt_tokens];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
  }
  return null;
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

async function runRecoveryCompaction(
  session: AgentSession,
  chatJid: string,
  runOptions: RunAgentOptions,
  options: Pick<RunAgentOrchestratorOptions, "onInfo" | "onWarn">,
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
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
    const benign = isRotationFallbackCompactionError(compactionResult.errorMessage);
    if (!compactionResult.joined && !aborted && !benign) {
      noteCompactionFailure(chatJid, compactionResult.errorMessage);
    }
    if (benign) {
      // "Nothing to compact (session too small)" etc. — not a real failure,
      // skip compaction and let the retry proceed without it.
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
        willRetry: true,
      } as unknown as AgentSessionEvent);
      return { ok: true };
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
  return { ok: true };
}

async function runPromptAttempt(
  prompt: string,
  chatJid: string,
  session: AgentSession,
  timeoutMs: number,
  runOptions: RunAgentOptions,
  options: RunAgentOrchestratorOptions,
  totalRunStartedAt: number,
  modelLabel: string | null,
): Promise<PromptAttemptResult> {
  let hadToolActivity = false;
  let hadPartialOutput = false;
  let hadCompletedTurnOutput = false;
  let hadTerminalTurnOutput = false;
  let compactionErrorMessage: string | null = null;
  let sawCompactionIntent = false;
  let sawAssistantToolCallMessage = false;
  let onlyReadOnlyToolActivity = true;
  let assistantToolUseMessageCount = 0;
  let toolExecutionCount = 0;
  let midTurnToolResultChars = 0;
  let midTurnProjectionBaselineRawTokens: number | null = null;
  let midTurnProjectionBaselineToolResultChars = 0;
  let midTurnProjectionModelResponseSequence = -1;
  let toolUseBudgetExceeded = false;
  let toolExecutionCeilingExceeded = false;
  let modelResponseSequence = 0;
  let activeModelResponse: { sequence: number; startedAt: number } | null = null;
  let lastMidTurnContextUpdateAt = 0;
  let lastContextUsageUpdateAt = 0;
  let midTurnContextAbortRequested = false;
  const sessionEntryBaseline = snapshotSessionEntryCount(session);
  const baselineLeafId = getSessionLeafId(session);
  const toolUseMessageBudget = getToolUseMessageBudget();
  const toolUseSoftStopThreshold = resolveToolBudgetSoftStopThreshold(toolUseMessageBudget);
  const midTurnToolExecutionHardCeiling = getMidTurnToolExecutionHardCeiling();
  let toolUseSoftStopRequested = false;
  let toolUseSoftStopApplied = false;
  let softStopSavedToolNames: string[] | null = null;
  const pendingSoftStopToolCallIds = new Set<string>();
  let pendingSoftStopAnonymousToolCallCount = 0;
  let hadToolFailureBeforeSoftStop = false;
  let hadToolFailureAfterSoftStop = false;
  const applyToolBudgetSoftStop = () => {
    if (toolUseSoftStopApplied) return;
    toolUseSoftStopApplied = true;
    const toolControl = session as unknown as {
      getActiveToolNames?: () => string[];
      setActiveToolsByName?: (toolNames: string[]) => void;
    };
    if (typeof toolControl.getActiveToolNames === "function" && typeof toolControl.setActiveToolsByName === "function") {
      softStopSavedToolNames = toolControl.getActiveToolNames();
      toolControl.setActiveToolsByName([]);
      options.onWarn?.("Tool-use budget soft threshold reached; disabling tools to force terminal reply", {
        operation: "run_agent.tool_use_budget_soft_stop",
        chatJid,
        assistantToolUseMessageCount,
        toolUseMessageBudget,
        toolUseSoftStopThreshold,
        ...getRunObservabilityDetails(runOptions),
      });
    } else {
      options.onWarn?.("Tool-use budget soft threshold reached but active tools could not be disabled", {
        operation: "run_agent.tool_use_budget_soft_stop_unavailable",
        chatJid,
        assistantToolUseMessageCount,
        toolUseMessageBudget,
        toolUseSoftStopThreshold,
        ...getRunObservabilityDetails(runOptions),
      });
    }
  };
  const maybeApplyPendingToolBudgetSoftStop = () => {
    if (!toolUseSoftStopRequested) return;
    if (pendingSoftStopToolCallIds.size > 0 || pendingSoftStopAnonymousToolCallCount > 0) return;
    applyToolBudgetSoftStop();
  };
  const requestToolBudgetSoftStop = (toolCallBlocks: Array<Record<string, unknown>>) => {
    if (toolUseSoftStopRequested || assistantToolUseMessageCount < toolUseSoftStopThreshold) return;
    toolUseSoftStopRequested = true;
    for (const block of toolCallBlocks) {
      const id = typeof block.id === "string" && block.id.trim() ? block.id : null;
      if (id) {
        pendingSoftStopToolCallIds.add(id);
      } else {
        pendingSoftStopAnonymousToolCallCount += 1;
      }
    }
    // The message_end event for an assistant tool-use message is emitted
    // before the SDK dispatches that message's tool calls. Do not remove
    // tools from the local dispatcher yet: doing so makes the just-generated
    // call fail as "Tool <name> not found". Wait until those calls end, then
    // stop advertising tools for the next model response so it can finalize.
    maybeApplyPendingToolBudgetSoftStop();
  };
  const restoreToolBudgetSoftStop = () => {
    if (!softStopSavedToolNames) return;
    const toolControl = session as unknown as { setActiveToolsByName?: (toolNames: string[]) => void };
    if (typeof toolControl.setActiveToolsByName === "function") {
      toolControl.setActiveToolsByName(softStopSavedToolNames);
    }
    softStopSavedToolNames = null;
  };
  runOptions.sessionLeafId = typeof session.sessionManager?.getLeafId === "function"
    ? session.sessionManager.getLeafId() ?? undefined
    : runOptions.sessionLeafId;

  const originalOnTurnComplete = runOptions.onTurnComplete;
  const onTurnComplete = originalOnTurnComplete
    ? ((turn: { text: string; attachments: AttachmentInfo[]; usage?: unknown; followedByToolUse?: boolean }) => {
        const hadOutput = !!(turn.text || turn.attachments.length > 0);
        hadCompletedTurnOutput = hadCompletedTurnOutput || hadOutput;
        hadTerminalTurnOutput = hadTerminalTurnOutput || (hadOutput && !turn.followedByToolUse);
        originalOnTurnComplete(turn as Parameters<NonNullable<RunAgentOptions["onTurnComplete"]>>[0]);
      })
    : undefined;

  const tracker = options.turnCoordinator.createTracker(chatJid, onTurnComplete, runOptions.onTurnDiscard);
  const toolExecutionWatchdogHeartbeat = createToolExecutionWatchdogHeartbeatController(chatJid);
  const isRetrySafeToolName = (toolName: unknown): boolean => typeof toolName === "string" && [
    "read",
    "read_attachment",
    "search_workspace",
    "introspect_sql",
    "list_tools",
    "list_scripts",
  ].includes(toolName);
  const isTerminalSideEffectToolName = (toolName: unknown): boolean => typeof toolName === "string" && [
    "send_adaptive_card",
    "send_dashboard_widget",
    "exit_process",
  ].includes(toolName);
  let sawTerminalSideEffectToolActivity = false;
  let hadToolFailure = false;

  const readContextUsageSnapshot = (projectedAdditionalRawTokens = 0): {
    tokens: number;
    rawTokens: number;
    projectedAdditionalRawTokens: number;
    contextWindow: number;
    effectiveContextWindow: number;
    overheadTokens: number;
    thresholdTokens: number;
    thresholdPercent: number;
    hardCeilingTokens: number;
    hardCeilingReached: boolean;
    autoCompactionScope: string;
    autoCompactionScopeTokens: number;
    autoCompactionScopeLimit: number;
    autoCompactionWindowOrdinal: number | null;
    autoCompactionBaselineTokens: number | null;
    autoCompactionPrefillTokens: number | null;
    overThreshold: boolean;
  } | null => {
    const status = getAutoCompactionTokenStatusForSession(session, chatJid, { projectedAdditionalRawTokens });
    if (!status) return null;
    return {
      tokens: status.contextTokens,
      rawTokens: status.rawContextTokens,
      projectedAdditionalRawTokens: status.projectedAdditionalRawTokens,
      contextWindow: status.contextWindow,
      effectiveContextWindow: status.effectiveContextWindow,
      overheadTokens: status.overheadTokens,
      thresholdTokens: status.tokenStatus.autoCompactionScopeLimit,
      thresholdPercent: status.thresholdPercent,
      hardCeilingTokens: status.tokenStatus.fullContextWindowLimit,
      hardCeilingReached: status.tokenStatus.fullContextWindowLimitReached,
      autoCompactionScope: status.tokenStatus.scope,
      autoCompactionScopeTokens: status.tokenStatus.autoCompactionScopeTokens,
      autoCompactionScopeLimit: status.tokenStatus.autoCompactionScopeLimit,
      autoCompactionWindowOrdinal: status.tokenStatus.windowOrdinal,
      autoCompactionBaselineTokens: status.tokenStatus.baselineTokens,
      autoCompactionPrefillTokens: status.tokenStatus.prefillTokens,
      overThreshold: status.tokenStatus.tokenLimitReached,
    };
  };

  const publishContextUsageUpdate = (
    phase: string,
    force = false,
    projectedAdditionalRawTokens = 0,
  ): ReturnType<typeof readContextUsageSnapshot> => {
    try {
      const snapshot = readContextUsageSnapshot(projectedAdditionalRawTokens);
      if (!snapshot) return null;
      const now = Date.now();
      if (force || now - lastContextUsageUpdateAt >= CONTEXT_USAGE_UPDATE_MIN_INTERVAL_MS) {
        lastContextUsageUpdateAt = now;
        runOptions.onEvent?.(buildContextUsageUpdateEvent(snapshot.tokens, snapshot.contextWindow, phase));
      }
      return snapshot;
    } catch (err) {
      debugSuppressedError(log, "Failed to publish context usage update.", err, { chatJid, phase });
      return null;
    }
  };

  const abortForToolExecutionCeiling = (toolName: unknown, contextDetails: Record<string, unknown> = {}): void => {
    toolUseBudgetExceeded = true;
    toolExecutionCeilingExceeded = true;
    midTurnContextAbortRequested = true;
    options.onWarn?.("Configured mid-turn tool execution hard ceiling reached without context pressure; aborting turn without requesting compaction", {
      operation: "run_agent.mid_turn_tool_ceiling",
      reason: "mid_turn_tool_execution_hard_ceiling",
      chatJid,
      toolExecutionCount,
      ceiling: midTurnToolExecutionHardCeiling,
      defaultCeiling: DEFAULT_MID_TURN_TOOL_EXECUTION_HARD_CEILING,
      midTurnToolResultChars,
      toolName: typeof toolName === "string" ? toolName : null,
      ...contextDetails,
      ...getRunObservabilityDetails(runOptions),
    });
    void session.abort().catch((err) => {
      options.onWarn?.("Failed to abort session after mid-turn tool ceiling", {
        operation: "run_agent.mid_turn_tool_ceiling_abort_failed",
        chatJid,
        err,
        ...getRunObservabilityDetails(runOptions),
      });
    });
  };

  const checkMidTurnContextAfterToolResult = (toolName: unknown, isError: unknown): void => {
    try {
      if (midTurnContextAbortRequested) return;

      const toolExecutionCeilingReached = toolExecutionCount >= midTurnToolExecutionHardCeiling;

      const now = Date.now();
      const forceUsageUpdate = now - lastMidTurnContextUpdateAt >= MID_TURN_CONTEXT_CHECK_MIN_INTERVAL_MS;
      if (forceUsageUpdate) lastMidTurnContextUpdateAt = now;
      const estimatorSnapshot = readContextUsageSnapshot();
      if (!estimatorSnapshot) {
        if (toolExecutionCeilingReached) abortForToolExecutionCeiling(toolName);
        return;
      }

      // Maintain a raw-token floor from the context observed before tool
      // results plus every result emitted during this prompt. As the session
      // estimator catches up, reduce the projection instead of adding the same
      // historical results again. Feed the remaining raw projection through
      // the shared policy so safety margins and scoped thresholds are applied
      // exactly once.
      if (midTurnProjectionBaselineRawTokens == null) {
        midTurnProjectionBaselineRawTokens = estimatorSnapshot.rawTokens;
      }
      const toolResultCharsSinceBaseline = Math.max(0, midTurnToolResultChars - midTurnProjectionBaselineToolResultChars);
      const toolResultRawTokensSinceBaseline = Math.ceil(toolResultCharsSinceBaseline / TOOL_RESULT_CHARS_PER_TOKEN);
      const projectedRawFloor = midTurnProjectionBaselineRawTokens + toolResultRawTokensSinceBaseline;
      const projectedAdditionalRawTokens = Math.max(0, projectedRawFloor - estimatorSnapshot.rawTokens);
      const snapshot = publishContextUsageUpdate(
        "mid_turn_tool_result",
        forceUsageUpdate,
        projectedAdditionalRawTokens,
      );
      if (!snapshot) {
        if (toolExecutionCeilingReached) abortForToolExecutionCeiling(toolName);
        return;
      }

      if (!snapshot.overThreshold) {
        if (toolExecutionCeilingReached) {
          abortForToolExecutionCeiling(toolName, {
            contextTokens: snapshot.tokens,
            estimatorReportedTokens: estimatorSnapshot.tokens,
            projectedAdditionalRawTokens,
            contextWindow: snapshot.contextWindow,
            thresholdTokens: snapshot.thresholdTokens,
            thresholdPercent: snapshot.thresholdPercent,
            hardCeilingTokens: snapshot.hardCeilingTokens,
            autoCompactionScope: snapshot.autoCompactionScope,
            autoCompactionScopeTokens: snapshot.autoCompactionScopeTokens,
            estimatorReportedAutoCompactionScopeTokens: estimatorSnapshot.autoCompactionScopeTokens,
            autoCompactionScopeLimit: snapshot.autoCompactionScopeLimit,
          });
        }
        return;
      }

      sawCompactionIntent = true;
      midTurnContextAbortRequested = true;
      runOptions.onEvent?.(buildContextUsageUpdateEvent(snapshot.tokens, snapshot.contextWindow, "mid_turn_tool_result_over_threshold"));
      options.onWarn?.("Mid-turn context pressure detected after tool result; aborting for compaction", {
        operation: "run_agent.mid_turn_context_pressure",
        chatJid,
        contextTokens: snapshot.tokens,
        estimatorReportedTokens: estimatorSnapshot.tokens,
        projectedAdditionalRawTokens,
        midTurnToolResultChars,
        toolExecutionCount,
        contextWindow: snapshot.contextWindow,
        thresholdTokens: snapshot.thresholdTokens,
        thresholdPercent: snapshot.thresholdPercent,
        hardCeilingTokens: snapshot.hardCeilingTokens,
        hardCeilingReached: snapshot.hardCeilingReached,
        autoCompactionScope: snapshot.autoCompactionScope,
        autoCompactionScopeTokens: snapshot.autoCompactionScopeTokens,
        estimatorReportedAutoCompactionScopeTokens: estimatorSnapshot.autoCompactionScopeTokens,
        autoCompactionScopeLimit: snapshot.autoCompactionScopeLimit,
        autoCompactionWindowOrdinal: snapshot.autoCompactionWindowOrdinal,
        autoCompactionBaselineTokens: snapshot.autoCompactionBaselineTokens,
        autoCompactionPrefillTokens: snapshot.autoCompactionPrefillTokens,
        toolName: typeof toolName === "string" ? toolName : null,
        toolErrored: isError === true,
        ...getRunObservabilityDetails(runOptions),
      });
      void session.abort().catch((err) => {
        options.onWarn?.("Failed to abort session after mid-turn context pressure", {
          operation: "run_agent.mid_turn_context_pressure_abort_failed",
          chatJid,
          err,
          ...getRunObservabilityDetails(runOptions),
        });
      });
    } catch (err) {
      debugSuppressedError(log, "Failed to check mid-turn context pressure after tool result.", err, { chatJid });
    }
  };

  const wrappedOnEvent = (event: AgentSessionEvent) => {
    if (event.type === "message_update") {
      heartbeatTrackedPhase(chatJid, "streaming", { eventType: event.type });
    } else if (
      event.type === "tool_execution_start"
      || event.type === "tool_execution_update"
      || event.type === "tool_execution_end"
    ) {
      heartbeatTrackedPhase(chatJid, "tool_execution", {
        eventType: event.type,
        toolName: (event as { toolName?: unknown }).toolName,
      });
    } else if (event.type === "compaction_start" || event.type === "compaction_end") {
      heartbeatTrackedPhase(chatJid, event.type === "compaction_start" ? "preprompt_compaction" : "prompt", {
        eventType: event.type,
      });
    }

    if (event.type === "tool_execution_start" || event.type === "tool_execution_end") {
      toolExecutionWatchdogHeartbeat.handleEvent(event as ToolExecutionWatchdogEvent);
    }

    if (event.type === "tool_execution_start") {
      const snapshot = publishContextUsageUpdate("tool_execution_start", true);
      // Each assistant response establishes a fresh projection baseline after
      // its tool-call message has entered context. Results from that batch are
      // then measured independently, so intervening assistant growth cannot
      // mask a newly appended result.
      if (
        snapshot
        && (midTurnProjectionBaselineRawTokens == null || midTurnProjectionModelResponseSequence !== modelResponseSequence)
      ) {
        midTurnProjectionBaselineRawTokens = snapshot.rawTokens;
        midTurnProjectionBaselineToolResultChars = midTurnToolResultChars;
        midTurnProjectionModelResponseSequence = modelResponseSequence;
      }
    } else if (event.type === "tool_execution_update") {
      publishContextUsageUpdate("tool_execution_update");
    }

    if (event.type === "thinking_level_changed") {
      const level = typeof (event as { level?: unknown }).level === "string"
        ? (event as { level: string }).level
        : session.thinkingLevel ?? null;
      updateSessionModel(chatJid, modelLabel, level);
      options.onInfo?.("Thinking level changed", {
        operation: "model.thinking_level_changed",
        chatJid,
        model: modelLabel,
        thinkingLevel: level,
        ...getRunObservabilityDetails(runOptions),
      });
    }

    // Track session activity for cross-session visibility
    if (event.type === "tool_execution_start") {
      const e = event as { toolCallId?: string; toolName?: string; args?: unknown };
      if (e.toolCallId && e.toolName) {
        trackToolStartActivity(chatJid, e.toolCallId, e.toolName, e.args);
        options.onInfo?.("Tool execution started", {
          operation: "tool.call.start",
          chatJid,
          toolName: e.toolName,
          toolCallId: e.toolCallId,
          ...getRunObservabilityDetails(runOptions),
        });
      }
    }
    if (event.type === "tool_execution_end") {
      const e = event as { toolCallId?: string; toolName?: string; isError?: boolean; durationMs?: number };
      if (e.toolCallId) trackToolEndActivity(chatJid, e.toolCallId);
      options.onInfo?.("Tool execution ended", {
        operation: "tool.call.end",
        chatJid,
        toolName: e.toolName ?? null,
        toolCallId: e.toolCallId ?? null,
        isError: Boolean(e.isError),
        durationMs: typeof e.durationMs === "number" ? e.durationMs : null,
        ...getRunObservabilityDetails(runOptions),
      });
    }

    if (event.type === "message_start") {
      const message = (event as { message?: { role?: unknown } }).message;
      if (message?.role === "assistant" && !activeModelResponse) {
        modelResponseSequence += 1;
        activeModelResponse = { sequence: modelResponseSequence, startedAt: Date.now() };
        options.onInfo?.("Assistant model response started", {
          operation: "model.response.start",
          chatJid,
          model: modelLabel,
          sequence: modelResponseSequence,
          ...getRunObservabilityDetails(runOptions),
        });
      }
    }
    if (event.type === "message_update") {
      const messageEvent = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
      if ((messageEvent?.type === "text_start" || messageEvent?.type === "thinking_start") && !activeModelResponse) {
        modelResponseSequence += 1;
        activeModelResponse = { sequence: modelResponseSequence, startedAt: Date.now() };
        options.onInfo?.("Assistant model response started", {
          operation: "model.response.start",
          chatJid,
          model: modelLabel,
          sequence: modelResponseSequence,
          phase: messageEvent.type,
          ...getRunObservabilityDetails(runOptions),
        });
      }
      if (messageEvent?.type === "text_delta" && typeof messageEvent.delta === "string" && messageEvent.delta.length > 0) {
        hadPartialOutput = true;
      }
    }
    if (
      event.type === "tool_execution_start"
      || event.type === "tool_execution_update"
      || event.type === "tool_execution_end"
    ) {
      hadToolActivity = true;
      if (event.type === "tool_execution_end") {
        toolExecutionCount += 1;
        // Accumulate tool-result content size for mid-turn context projection.
        const toolResult = (event as { result?: unknown }).result;
        if (toolResult && typeof toolResult === "object") {
          const content = (toolResult as { content?: unknown[] }).content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
                const text = (block as { text?: unknown }).text;
                if (typeof text === "string") {
                  midTurnToolResultChars += text.length;
                }
              }
            }
          }
        }
      }
      const toolName = (event as { toolName?: unknown }).toolName;
      if (!isRetrySafeToolName(toolName)) {
        onlyReadOnlyToolActivity = false;
      }
      // Track failed tool executions so recovery can make smarter decisions.
      if (event.type === "tool_execution_end" && (event as { isError?: unknown }).isError) {
        hadToolFailure = true;
        if (toolUseSoftStopApplied) {
          hadToolFailureAfterSoftStop = true;
        } else {
          hadToolFailureBeforeSoftStop = true;
        }
      }
      if (event.type === "tool_execution_end" && !(event as { isError?: unknown }).isError && isTerminalSideEffectToolName(toolName)) {
        sawTerminalSideEffectToolActivity = true;
      }
      if (event.type === "tool_execution_end") {
        const toolCallId = (event as { toolCallId?: unknown }).toolCallId;
        if (typeof toolCallId === "string" && pendingSoftStopToolCallIds.delete(toolCallId)) {
          // matched the threshold-crossing tool-use message
        } else if (pendingSoftStopAnonymousToolCallCount > 0) {
          pendingSoftStopAnonymousToolCallCount -= 1;
        }
        maybeApplyPendingToolBudgetSoftStop();
        checkMidTurnContextAfterToolResult(toolName, (event as { isError?: unknown }).isError);
      }
      // If exit_process was called, do NOT abort immediately — let the LLM
      // finish its current text response so the agent's reply is captured and
      // persisted to the DB. The abort happens below in the message_end handler
      // when the LLM tries to issue further tool calls (stopReason === "toolUse").
    }
    if (event.type === "message_end") {
      const estimateSnapshot = publishContextUsageUpdate("message_end", true);
      const message = (event as { message?: { role?: unknown; content?: unknown; stopReason?: unknown; errorMessage?: unknown; usage?: Record<string, unknown> } }).message;
      if (message?.role === "assistant") {
        const durationMs = activeModelResponse ? Math.max(0, Date.now() - activeModelResponse.startedAt) : null;
        options.onInfo?.("Assistant model response completed", {
          operation: "model.response.end",
          chatJid,
          model: modelLabel,
          sequence: activeModelResponse?.sequence ?? null,
          durationMs,
          stopReason: typeof message.stopReason === "string" ? message.stopReason : null,
          errorMessage: typeof message.errorMessage === "string" ? message.errorMessage : null,
          usage: message.usage ?? null,
          ...getRunObservabilityDetails(runOptions),
        });
        const actualInputTokens = getUsageInputTokens(message.usage);
        if (actualInputTokens != null && estimateSnapshot) {
          options.onInfo?.("Context-token estimator calibration", {
            operation: "compaction.estimator_calibration",
            chatJid,
            model: modelLabel,
            estimatedContextTokens: estimateSnapshot.tokens,
            estimatedRawContextTokens: estimateSnapshot.rawTokens,
            actualInputTokens,
            deltaTokens: estimateSnapshot.tokens - actualInputTokens,
            ratio: actualInputTokens > 0 ? estimateSnapshot.tokens / actualInputTokens : null,
            contextWindow: estimateSnapshot.contextWindow,
            autoCompactionScope: estimateSnapshot.autoCompactionScope,
            ...getRunObservabilityDetails(runOptions),
          });
        }
        activeModelResponse = null;
      }
      if (message?.role === "assistant" && Array.isArray(message.content)) {
        const toolCallBlocks = message.content.filter((block): block is Record<string, unknown> => (
          Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "toolCall"
        ));
        const hasToolCall = toolCallBlocks.length > 0;
        sawAssistantToolCallMessage = sawAssistantToolCallMessage || hasToolCall;
        if (hasToolCall && message.stopReason === "toolUse") {
          assistantToolUseMessageCount += 1;
          // If exit_process was called earlier in this turn, abort now before
          // any further tool calls execute. The LLM's text reply has already
          // been streamed and captured by onTurnComplete, so the agent's
          // response will be persisted to the DB by finalizeSuccessfulRun.
          if (isPendingShutdown()) {
            void session.abort().catch((err) => {
              options.onWarn?.("Failed to abort session after exit_process (deferred to message_end)", {
                operation: "run_agent.pending_shutdown_abort",
                chatJid,
                err,
              });
            });
          }
          requestToolBudgetSoftStop(toolCallBlocks);
          if (!toolUseBudgetExceeded && assistantToolUseMessageCount > toolUseMessageBudget) {
            toolUseBudgetExceeded = true;
            void session.abort().catch((err) => {
              options.onWarn?.("Failed to abort tool-loop budget overflow", {
                operation: "run_agent.tool_use_budget_abort",
                chatJid,
                assistantToolUseMessageCount,
                toolUseMessageBudget,
                err,
              });
            });
          }
        }
      }
    }
    if (event.type === "compaction_start") {
      sawCompactionIntent = true;
    }
    if (event.type === "compaction_end") {
      const errorMessage = (event as { errorMessage?: unknown }).errorMessage;
      if (typeof errorMessage === "string" && errorMessage.trim()) {
        compactionErrorMessage = errorMessage.trim();
      }
    }
    runOptions.onEvent?.(event);
  };

  const unsub = options.turnCoordinator.subscribe(session, chatJid, tracker, wrappedOnEvent);
  const { timeoutId, timedOutRef, completedRef } = options.turnCoordinator.startPromptTimeout(session, chatJid, timeoutMs);
  const finishPromptTimeout = () => {
    if (!completedRef.value) completedRef.value = true;
    if (timeoutId) clearTimeout(timeoutId);
  };
  let staleProgressInterrupted = false;
  let staleProgressAbortFailed: string | null = null;
  const unregisterProgressAborter = registerProgressWatchdogAborter(chatJid, async (stall) => {
    staleProgressInterrupted = true;
    options.onWarn?.("Stale-progress watchdog aborting stalled agent run", {
      operation: "run_agent.stale_progress_abort",
      chatJid,
      phase: stall.phase,
      ageMs: stall.ageMs,
      timeoutMs: stall.timeoutMs,
      startedAt: new Date(stall.startedAt).toISOString(),
      lastProgressAt: new Date(stall.lastProgressAt).toISOString(),
      ...getRunObservabilityDetails(runOptions),
    });
    try {
      await session.abort();
    } catch (error) {
      staleProgressAbortFailed = error instanceof Error ? error.message : String(error);
      throw error;
    }
  });

  let promptThrownError: string | null = null;
  const restoreUpstreamAutoCompaction = suppressUpstreamAutoCompactionDuringPrompt(session, chatJid, options);
  try {
    heartbeatTrackedPhase(chatJid, "prompt", { eventType: "prompt_start" });
    publishContextUsageUpdate("prompt_start", true);
    await session.prompt(prompt);
    finishPromptTimeout();
    heartbeatTrackedPhase(chatJid, "prompt", { eventType: "prompt_resolved" });
    options.onInfo?.("session.prompt() resolved", {
      operation: "run_agent.prompt_resolved",
      chatJid,
      promptDurationMs: Date.now() - totalRunStartedAt,
      sessionIsStreaming: Boolean(session.isStreaming),
      sessionIsCompacting: Boolean(session.isCompacting),
      sessionIsRetrying: Boolean(session.isRetrying),
      ...getRunObservabilityDetails(runOptions),
    });
    const idleMaxWaitMs = resolveSessionIdleMaxWaitMs(session);
    await waitForSessionIdle(session, 10, (result) => {
      options.onInfo?.("Session settled after prompt", {
        operation: "run_agent.wait_for_session_idle",
        chatJid,
        maxWaitMs: idleMaxWaitMs,
        ...result,
      });
    }, idleMaxWaitMs);
  } catch (error) {
    promptThrownError = error instanceof Error ? error.message : String(error);
  } finally {
    restoreToolBudgetSoftStop();
    restoreUpstreamAutoCompaction();
    finishPromptTimeout();
    unregisterProgressAborter();
    toolExecutionWatchdogHeartbeat.stop();
    unsub();
  }

  const trackedFinalText = tracker.getFinalText();
  const finalUsage = tracker.getFinalUsage();
  hadPartialOutput = hadPartialOutput || !!trackedFinalText;
  const finalAttachments = options.takeAttachments(chatJid);
  const timedOut = timedOutRef.value;
  const lastAssistantState = tracker.getLastAssistantState();
  // A completed message with authoritative text is a normal final result.
  // Streamed text omitted from message_end remains eligible for intermediate
  // turn flushing and handler draft fallback, but it must not reclassify an
  // otherwise tool-only terminal stop from tool_complete to success.
  const finalText = lastAssistantState && !lastAssistantState.hadTextContent ? "" : trackedFinalText;
  const sawThinkingOnlyStop = Boolean(
    lastAssistantState?.stopReason === "stop"
      && lastAssistantState?.hadThinkingContent
      && !lastAssistantState?.hadTextContent
      && !lastAssistantState?.hadToolCallContent
  );
  const latentStateError = !finalText ? getSessionStateErrorMessage(session) : null;

  let output: AgentOutput;
  if (staleProgressAbortFailed) {
    output = { status: "error", result: null, error: `Stale-progress watchdog detected no progress and failed to abort the run: ${staleProgressAbortFailed}` };
  } else if (staleProgressInterrupted) {
    output = { status: "error", result: null, error: `Stale-progress watchdog interrupted the run after no progress for ${formatTimeoutDuration(getProgressWatchdogTimeoutMs())}.` };
  } else if (timedOut) {
    output = { status: "error", result: null, error: `Timed out after ${formatTimeoutDuration(timeoutMs)}` };
  } else if (toolUseBudgetExceeded && !finalText && finalAttachments.length === 0) {
    const reportedToolSteps = toolExecutionCeilingExceeded
      ? toolExecutionCount
      : assistantToolUseMessageCount > 0 ? assistantToolUseMessageCount : toolExecutionCount;
    const reportedToolBudget = toolExecutionCeilingExceeded ? midTurnToolExecutionHardCeiling : toolUseMessageBudget;
    output = {
      status: "error",
      result: null,
      error: `Tool-use budget exceeded before finalization (${reportedToolSteps}/${reportedToolBudget} tool steps). Ask me to continue; I will resume from the latest known partial state instead of replaying the whole turn.`,
      toolBudgetExceeded: true,
      toolStepsUsed: reportedToolSteps,
      toolStepsBudget: reportedToolBudget,
      nextAction: "Ask me to continue; I will resume from the latest known partial state instead of replaying the whole turn.",
    };
  } else if (promptThrownError) {
    output = { status: "error", result: null, error: promptThrownError };
  } else {
    const turnError = tracker.getError();
    if (turnError) {
      output = { status: "error", result: null, error: turnError.errorMessage };
    } else if (latentStateError) {
      output = { status: "error", result: null, error: latentStateError };
    } else if (lastAssistantState?.stopReason === "length" || isLengthStopFailure(lastAssistantState?.errorMessage)) {
      output = {
        status: "error",
        result: null,
        error: buildLengthStopError(finalText),
        ...(finalUsage ? { usage: finalUsage } : {}),
      };
    } else {
      const blankTurnDelta = inspectBlankTurnSessionDelta(session, sessionEntryBaseline);
      if (!finalText && finalAttachments.length === 0 && !hadTerminalTurnOutput) {
        let detail: string;
        if (!hadPartialOutput && !hadToolActivity && isBlankTurnSessionDelta(blankTurnDelta)) {
          detail = [
            `${blankTurnDelta?.appendedUserMessageCount ?? 0} user message(s)`,
            `${blankTurnDelta?.appendedAssistantMessageCount ?? 0} assistant message(s)`,
            `${blankTurnDelta?.appendedToolResultMessageCount ?? 0} tool-result message(s)`,
          ].join(", ");
          options.onWarn?.("Prompt resolved with a blank user-only session delta", {
            operation: "run_agent.blank_turn_delta",
            chatJid,
            detail,
            blankTurnDelta,
          });
        } else {
          const providerStoppedAfterToolUse = hadToolActivity
            && sawAssistantToolCallMessage
            && lastAssistantState?.stopReason === "stop"
            && !lastAssistantState?.hadTextContent;
          detail = [
            sawThinkingOnlyStop ? "provider stopped after emitting thinking without a final assistant reply" : null,
            providerStoppedAfterToolUse ? "provider stopped after tool use without a final assistant reply" : null,
            hadPartialOutput ? "partial output seen" : null,
            hadToolActivity ? "tool activity seen" : null,
            lastAssistantState?.stopReason ? `last stop reason: ${lastAssistantState.stopReason}` : null,
            blankTurnDelta ? `session delta: ${blankTurnDelta.appendedEntryCount} appended entries` : null,
          ].filter(Boolean).join(", ") || "no completed assistant turn was emitted";
          options.onWarn?.("Prompt resolved without a completed assistant reply", {
            operation: "run_agent.no_terminal_reply",
            chatJid,
            detail,
            hadPartialOutput,
            hadToolActivity,
            hadCompletedTurnOutput,
            blankTurnDelta,
            ...getRunObservabilityDetails(runOptions),
          });
        }
        // Some UI/process tools intentionally terminate the turn through their
        // side effect (for example posting an Adaptive Card/dashboard widget or
        // requesting process exit). If such a tool completed successfully, a
        // missing closing assistant text is informational, not a failed turn.
        // This must remain true even if the assistant streamed a short lead-in
        // before the tool call; otherwise the UI side effect can be hidden by
        // recovery/error handling. A failed tool in the same attempt still
        // requires an error or continuation; a later terminal side effect must
        // not mask it.
        // Read-only tool-only stops remain recoverable so we can retry and ask
        // the provider for the final prose reply.
        const isTerminalSideEffectCompletion = hadToolActivity
          && !hadToolFailure
          && !isBlankTurnSessionDelta(blankTurnDelta)
          && sawTerminalSideEffectToolActivity;
        const isDraftBackedSoftStopCompletion = hadToolActivity
          && hadPartialOutput
          && !hadToolFailureBeforeSoftStop
          && hadToolFailureAfterSoftStop
          && toolUseSoftStopApplied
          && !isBlankTurnSessionDelta(blankTurnDelta)
          && detail.includes("provider stopped after tool use");
        const isToolOnlyCompletion = isTerminalSideEffectCompletion || isDraftBackedSoftStopCompletion;
        output = isToolOnlyCompletion
          ? {
            status: "tool_complete" as const,
            result: null,
            ...(finalUsage ? { usage: finalUsage } : {}),
          }
          : {
            status: "error",
            result: null,
            error: `Prompt completed without emitting an assistant reply before finalization (${detail}).`,
          };

        // Flag context pressure only when the shared model-aware token policy
        // says the configured threshold was reached. A blank/unknown failure
        // below that threshold may retry, but must not use compaction as a
        // generic recovery strategy.
        try {
          const status = getAutoCompactionTokenStatusForSession(session, chatJid);
          if (status?.tokenStatus.tokenLimitReached) sawCompactionIntent = true;
        } catch (err) { debugSuppressedError(log, "Failed to estimate context tokens for compaction policy; skipping pressure check.", err); }
      } else {
        output = {
          status: "success",
          result: finalText || null,
          attachments: finalAttachments.length ? finalAttachments : undefined,
          ...(finalUsage ? { usage: finalUsage } : {}),
        };
      }
    }
  }

  return {
    output,
    promptWasPersisted: didPromptAdvanceSession(session, baselineLeafId),
    timedOut,
    snapshot: {
      hadToolActivity,
      hadPartialOutput,
      hadCompletedTurnOutput,
      hadTerminalTurnOutput,
      compactionErrorMessage,
      sawCompactionIntent,
      sawAssistantToolCall: sawAssistantToolCallMessage,
      sawThinkingOnlyStop,
      onlyReadOnlyToolActivity,
      canDisableToolsForRecovery: typeof (session as unknown as { getActiveToolNames?: unknown }).getActiveToolNames === "function"
        && typeof (session as unknown as { setActiveToolsByName?: unknown }).setActiveToolsByName === "function",
      hadToolFailure,
      sawTerminalSideEffectToolActivity,
      toolUseBudgetExceeded,
      assistantToolUseMessageCount,
      toolExecutionCount,
    },
  };
}

/** Run a prompt against the persistent session for one chat. */
export async function runAgentPrompt(
  prompt: string,
  chatJid: string,
  runOptions: RunAgentOptions,
  options: RunAgentOrchestratorOptions,
): Promise<AgentOutput> {
  const startTime = Date.now();
  options.clearAttachments(chatJid);
  updateSessionStreaming(chatJid, true);
  let modelLabel: string | null = null;

  // Tool-cap and tool-ceiling state – declared outside try so cleanup
  // can run in finally regardless of how the try exits.
  const toolCallCapRef = { exceeded: false, count: 0, cap: undefined as number | undefined };
  let toolCallUnsub: (() => void) | undefined;
  type SessionWithToolControl = {
    setActiveToolsByName?: (toolNames: string[]) => void;
    getActiveToolNames?: () => string[];
  };
  let sessionCtrl: SessionWithToolControl | null = null;
  let savedToolNames: string[] | null = null;
  let originalSetActiveToolsByName: ((names: string[]) => void) | null = null;

  try {
    if (runOptions.scheduleIdleAutoCompaction) {
      cancelScheduledIdleAutoCompaction(chatJid);
    }

    const runtime = await options.getOrCreateRuntime(chatJid);
    let session = runtime.session;
    session = await maybeAutoRotateSession(session, runtime, chatJid, options);
    modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : null;
    updateSessionModel(chatJid, modelLabel, session.thinkingLevel ?? null);
    beginTrackedPhase(chatJid, runOptions.skipPrePromptCompaction ? "prompt" : "preprompt_compaction", {
      source: "run_agent",
    });
    if (!runOptions.skipPrePromptCompaction) {
      let prePromptCompactionFailure: string | null = null;
      const projectedPendingInputTokens = estimatePendingInputTokens(prompt);
      await maybeAutoCompactSessionBeforePrompt(session, chatJid, options, (event) => {
        const eventAny = event as { type?: string; errorMessage?: unknown };
        if (eventAny.type === "compaction_start") {
          heartbeatTrackedPhase(chatJid, "preprompt_compaction", { eventType: eventAny.type });
        } else if (eventAny.type === "compaction_end") {
          heartbeatTrackedPhase(chatJid, "prompt", { eventType: eventAny.type });
          const errorMessage = typeof eventAny.errorMessage === "string"
            ? String(eventAny.errorMessage).trim()
            : "";
          if (errorMessage) prePromptCompactionFailure = errorMessage;
        } else if (eventAny.type === "compaction_suppressed") {
          const errorMessage = typeof eventAny.errorMessage === "string"
            ? String(eventAny.errorMessage).trim()
            : "";
          if (errorMessage) prePromptCompactionFailure = errorMessage;
        }
        runOptions.onEvent?.(event);
      }, projectedPendingInputTokens);
      if (prePromptCompactionFailure && !isCompactionCancellationError(prePromptCompactionFailure)) {
        const rotation = await rotateSession(session, runtime, {
          reason: "automatic",
          skipCompaction: true,
          emergencyReason: prePromptCompactionFailure,
          chatJid,
        });
        if (rotation.status === "success") {
          clearCompactionFailureBackoff(chatJid);
          resetCompactionSuccessCount(chatJid);
          session = runtime.session;
          noteCompactionSuccess(session, chatJid, "rotation", {
            ...options,
            countSuccess: false,
            clearBackoff: false,
          });
          modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : null;
          updateSessionModel(chatJid, modelLabel, session.thinkingLevel ?? null);
          options.onWarn?.("Emergency-rotated session after pre-prompt compaction failure", {
            operation: "run_agent.preprompt_compaction_emergency_rotate",
            chatJid,
            errorMessage: prePromptCompactionFailure,
            archivePath: rotation.archivePath ?? null,
            newSessionFile: rotation.newSessionFile ?? null,
          });
        } else {
          options.onWarn?.("Emergency rotation after pre-prompt compaction failure failed", {
            operation: "run_agent.preprompt_compaction_emergency_rotate_failed",
            chatJid,
            errorMessage: prePromptCompactionFailure,
            reason: rotation.message,
          });
          const error = `Pre-prompt compaction failed and emergency rotation could not detach the active session: ${rotation.message}. Refusing to prompt a session that may still be physically compacting; rotate or restart before retrying.`;
          writeAgentLog(options.logsDir, chatJid, Date.now() - startTime, false, null, error);
          return { status: "error", result: null, error };
        }
      }
    } else {
      heartbeatTrackedPhase(chatJid, "prompt", { eventType: "preprompt_compaction_skipped" });
    }
    pruneOrphanToolResults(session, chatJid);
    const forkBaseLeafId = typeof session.sessionManager?.getLeafId === "function"
      ? session.sessionManager.getLeafId()
      : null;
    options.setActiveForkBaseLeaf(chatJid, forkBaseLeafId ?? null);
    runOptions.sessionLeafId = forkBaseLeafId ?? undefined;
    options.onInfo?.("Prompting session", {
      operation: "run_agent.prompt",
      chatJid,
      model: modelLabel,
      promptLength: prompt.length,
      ...getRunObservabilityDetails(runOptions),
    });

    const timeoutMs = typeof runOptions.timeoutMs === "number" ? runOptions.timeoutMs : getAgentRuntimeConfig().timeoutMs;

    if (typeof runOptions.maxToolCalls === "number" && runOptions.maxToolCalls > 0) {
      let toolCallCount = 0;
      const cap = runOptions.maxToolCalls;
      toolCallCapRef.cap = cap;
      toolCallUnsub = session.subscribe((event) => {
        if (event.type === "tool_execution_end") {
          toolCallCount += 1;
          toolCallCapRef.count = toolCallCount;
          if (toolCallCount >= cap) {
            toolCallCapRef.exceeded = true;
            session.abort().catch((err) => { debugSuppressedError(log, "Failed to abort session after tool-call cap exceeded.", err, {}); });
          }
        }
      });
    }

    // Tool ceiling enforcement – clamp active tools and prevent LLM self-escalation.
    sessionCtrl = session as unknown as SessionWithToolControl;

    if (runOptions.toolCeilingFilter) {
      const ceilingFilter = runOptions.toolCeilingFilter;
      if (typeof sessionCtrl.getActiveToolNames === "function") {
        savedToolNames = sessionCtrl.getActiveToolNames();
        originalSetActiveToolsByName =
          typeof sessionCtrl.setActiveToolsByName === "function"
            ? sessionCtrl.setActiveToolsByName.bind(session)
            : null;

        if (originalSetActiveToolsByName) {
          // Apply ceiling to the initial active set.
          originalSetActiveToolsByName(savedToolNames.filter(ceilingFilter));
          // Patch to block the LLM from re-escalating via activate_tools.
          sessionCtrl.setActiveToolsByName = (names: string[]) => {
            originalSetActiveToolsByName!(names.filter(ceilingFilter));
          };
        }
      } else {
        options.onWarn?.("Tool ceiling requested but session lacks getActiveToolNames; ceiling not enforced", {
          operation: "run_agent.tool_ceiling",
          chatJid,
        });
      }
    }

    const channel = detectChannel(chatJid);
    const retrySettings = ((runtime.services?.settingsManager as RetrySettingsProvider | undefined)?.getRetrySettings?.()) || undefined;
    const baseRecoveryConfig = getAutomaticRecoveryConfig(retrySettings);
    const recoveryConfig = timeoutMs > 0
      ? { ...baseRecoveryConfig, totalBudgetMs: Math.min(baseRecoveryConfig.totalBudgetMs, timeoutMs) }
      : baseRecoveryConfig;
    let recoveryAttemptsUsed = 0;
    let lastClassifier: RecoveryClassifier | null = null;
    let lastRecoveryErrorText: string | null = null;
    const strategyHistory: RecoveryStrategy[] = [];
    const recoveryDiagnostics: AgentRecoveryDiagnosticEntry[] = [];
    let recoveryBudgetStartedAt: number | null = null;
    let allowPostTimeoutRecoveryWindow = false;
    const getRecoveryBudgetElapsedMs = () => {
      if (recoveryBudgetStartedAt != null) {
        return Math.max(0, Date.now() - recoveryBudgetStartedAt);
      }
      // A timed-out tool-bearing attempt needs a fresh bounded continuation
      // window because the original prompt has already consumed its timeout.
      // Generic configured timeouts keep the historical whole-run budget
      // semantics; runs without a configured timeout start their recovery
      // budget after the first failed attempt.
      return timeoutMs <= 0 || allowPostTimeoutRecoveryWindow
        ? 0
        : Math.max(0, Date.now() - startTime);
    };

    const runResult: AgentOutput = await withChatContext(chatJid, channel, async () => {
      let attemptPrompt = prompt;
      let recoveryContinuationWithoutTools = false;
      while (true) {
        // Yield to the event loop on every iteration. Prevents synchronous-
        // throw + catch + retry from starving the event loop when the error
        // path never reaches an await that actually suspends.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        if (recoveryAttemptsUsed > 0 && getRecoveryBudgetElapsedMs() >= recoveryConfig.totalBudgetMs) {
          const duration = Date.now() - startTime;
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
          return { status: "error" as const, result: null, error, recovery };
        }

        // The configured turn timeout bounds the initial attempt. Once that
        // attempt fails after tool activity, automatic recovery gets its own
        // smaller total budget; otherwise a timeout failure can never start
        // its safe tools-disabled continuation.
        if (timeoutMs > 0 && recoveryAttemptsUsed === 0) {
          const loopElapsedMs = Date.now() - startTime;
          if (loopElapsedMs > timeoutMs) {
            const duration = Date.now() - startTime;
            writeAgentLog(options.logsDir, chatJid, duration, false, null,
              `Agent run exceeded timeout before recovery (${loopElapsedMs}ms > ${timeoutMs}ms)`);
            return {
              status: "error" as const,
              result: null,
              error: `Agent run timed out after ${Math.round(loopElapsedMs / 1000)}s`,
            };
          }
        }

        const remainingRecoveryBudgetMs = Math.max(1, recoveryConfig.totalBudgetMs - getRecoveryBudgetElapsedMs());
        const attemptTimeoutMs = recoveryAttemptsUsed > 0
          ? (timeoutMs > 0 ? Math.min(timeoutMs, remainingRecoveryBudgetMs) : remainingRecoveryBudgetMs)
          : timeoutMs;
        let recoverySavedToolNames: string[] | null = null;
        if (recoveryContinuationWithoutTools && sessionCtrl && typeof sessionCtrl.getActiveToolNames === "function" && typeof sessionCtrl.setActiveToolsByName === "function") {
          recoverySavedToolNames = sessionCtrl.getActiveToolNames();
          sessionCtrl.setActiveToolsByName([]);
        }
        let attempt: PromptAttemptResult;
        try {
          attempt = await runPromptAttempt(
            attemptPrompt,
            chatJid,
            session,
            attemptTimeoutMs,
            runOptions,
            options,
            startTime,
            modelLabel,
          );
        } finally {
          if (recoverySavedToolNames && sessionCtrl && typeof sessionCtrl.setActiveToolsByName === "function") {
            sessionCtrl.setActiveToolsByName(recoverySavedToolNames);
          }
        }

        // If the tool-call cap was hit, abort immediately without recovery.
        if (toolCallCapRef.exceeded) {
          const duration = Date.now() - startTime;
          const used = Number.isFinite(toolCallCapRef.count) ? toolCallCapRef.count : undefined;
          const cap = Number.isFinite(toolCallCapRef.cap) ? toolCallCapRef.cap : undefined;
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
            toolBudgetExceeded: true,
            toolStepsUsed: used,
            toolStepsBudget: cap,
            nextAction,
          };
        }

        if (attempt.output.status === "success") {
          const duration = Date.now() - startTime;
          const finalText = typeof attempt.output.result === "string" ? attempt.output.result : null;
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

        const errorText = attempt.output.error || "Agent error";
        lastRecoveryErrorText = errorText;
        allowPostTimeoutRecoveryWindow = recoveryAttemptsUsed === 0
          && attempt.snapshot.hadToolActivity
          && attempt.timedOut;
        const decision = decideAutomaticRecovery({
          config: recoveryConfig,
          errorText,
          recoveryAttemptsUsed,
          elapsedMs: getRecoveryBudgetElapsedMs(),
          snapshot: attempt.snapshot,
        });

        let effectiveDecision = decision;
        if (decision.recover && decision.strategy) {
          const guard = shouldSuppressRecoveryLoop({
            chatJid,
            modelLabel,
            classifier: decision.classifier,
            strategy: decision.strategy,
            errorText,
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
          classifier: effectiveDecision.classifier,
          recoveryAttemptsUsed,
          recoveryStrategy: effectiveDecision.strategy,
          reason: effectiveDecision.reason,
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
        ));

        if (!effectiveDecision.recover || !effectiveDecision.strategy) {
          const duration = Date.now() - startTime;
          const toolBudgetDiagnostic = recoveryAttemptsUsed > 0 ? findToolBudgetDiagnostic(recoveryDiagnostics) : null;
          const terminalBudgetFailure = toolBudgetDiagnostic
            && (/Prompt completed without emitting an assistant reply before finalization/i.test(errorText) || isAbortFailureText(errorText))
            ? buildToolBudgetRecoveryTerminalError(toolBudgetDiagnostic, errorText)
            : null;
          const finalErrorText = terminalBudgetFailure?.error ?? errorText;
          const finalClassifier = terminalBudgetFailure && toolBudgetDiagnostic ? toolBudgetDiagnostic.classifier : lastClassifier;
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
            attempt.output.toolBudgetExceeded = true;
            attempt.output.toolStepsUsed = terminalBudgetFailure.toolStepsUsed;
            attempt.output.toolStepsBudget = terminalBudgetFailure.toolStepsBudget;
            attempt.output.nextAction = terminalBudgetFailure.nextAction;
          }
          return attempt.output;
        }

        if (recoveryBudgetStartedAt == null && (timeoutMs <= 0 || allowPostTimeoutRecoveryWindow)) {
          recoveryBudgetStartedAt = Date.now();
        }

        recoveryAttemptsUsed += 1;
        strategyHistory.push(effectiveDecision.strategy);
        const retryDelayMs = effectiveDecision.strategy === "retry"
          ? getAutomaticRecoveryDelayMs(recoveryConfig, recoveryAttemptsUsed)
          : 0;
        heartbeatTrackedPhase(chatJid, "recovery", {
          eventType: "recovery_start",
          attempt: recoveryAttemptsUsed,
        });
        emitAgentSessionEvent(runOptions.onEvent, {
          type: "recovery_start",
          classifier: effectiveDecision.classifier,
          strategy: effectiveDecision.strategy,
          attempt: recoveryAttemptsUsed,
          maxAttempts: recoveryConfig.maxAttempts,
          totalBudgetMs: recoveryConfig.totalBudgetMs,
          delayMs: retryDelayMs,
          reason: effectiveDecision.classifier === "unknown" && errorText
            ? `${effectiveDecision.reason} Error: ${errorText}`
            : effectiveDecision.reason,
          errorMessage: errorText,
        });

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
        recoveryContinuationWithoutTools = recoveryContinuationWithoutTools || attempt.snapshot.hadToolActivity;

        if (effectiveDecision.strategy === "compact_then_retry") {
          const compactionResult = await runRecoveryCompaction(session, chatJid, runOptions, options);
          heartbeatTrackedPhase(chatJid, "preprompt_compaction", {
            eventType: "recovery_compaction",
            attempt: recoveryAttemptsUsed,
          });
          if (!compactionResult.ok) {
            const compactDecision = decideAutomaticRecovery({
              config: recoveryConfig,
              errorText: compactionResult.errorMessage,
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
              },
            });
            lastClassifier = compactDecision.classifier;
            if (!compactDecision.recover || compactDecision.strategy !== "retry") {
              recoveryDiagnostics.push(buildRecoveryDiagnosticEntry(
                "compaction_failure",
                recoveryAttemptsUsed,
                compactDecision.classifier,
                compactDecision.strategy,
                compactDecision.reason,
                compactionResult.errorMessage,
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
                },
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
              writeAgentLog(options.logsDir, chatJid, duration, false, null, compactionResult.errorMessage, recoveryMeta);
              emitAgentSessionEvent(runOptions.onEvent, {
                type: "recovery_end",
                outcome: "exhausted",
                attemptsUsed: recoveryAttemptsUsed,
                classifier: compactDecision.classifier,
                errorMessage: compactionResult.errorMessage,
              });
              return {
                status: "error",
                result: null,
                error: compactionResult.errorMessage,
                recovery: buildRecoveryMetadata(
                  recoveryAttemptsUsed,
                  duration,
                  false,
                  true,
                  lastClassifier,
                  strategyHistory,
                  recoveryDiagnostics,
                ),
              };
            }
          }
        }

        heartbeatTrackedPhase(chatJid, "prompt", {
          eventType: "recovery_retry_ready",
          attempt: recoveryAttemptsUsed,
        });
        options.clearAttachments(chatJid);
      }
    });

    if (runOptions.scheduleIdleAutoCompaction && (runResult.status === "success" || runResult.status === "tool_complete")) {
      await maybeAutoCompactSessionAfterTurn(session, chatJid, options, (event) => {
        const eventAny = event as { type?: string };
        if (eventAny.type === "compaction_start") {
          heartbeatTrackedPhase(chatJid, "preprompt_compaction", { eventType: "post_turn_compaction_start" });
        } else if (eventAny.type === "compaction_end") {
          heartbeatTrackedPhase(chatJid, "prompt", { eventType: "post_turn_compaction_end" });
        }
        runOptions.onEvent?.(event);
      });
    }

    return runResult;
  } catch (err) {
    options.clearAttachments(chatJid);
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    writeAgentLog(options.logsDir, chatJid, duration, false, null, errorMsg, null);
    options.onError?.("Agent run failed", {
      operation: "run_agent",
      chatJid,
      model: modelLabel,
      durationMs: duration,
      errorMessage: errorMsg,
      err,
    });
    return { status: "error", result: null, error: errorMsg };
  } finally {
    endTrackedPhase(chatJid);
    updateSessionStreaming(chatJid, false);
    toolCallUnsub?.();
    if (sessionCtrl && savedToolNames !== null && originalSetActiveToolsByName) {
      sessionCtrl.setActiveToolsByName = originalSetActiveToolsByName;
      originalSetActiveToolsByName(savedToolNames);
    }
    try {
      await clearLiveSshConfig(chatJid);
      deleteSshConfig(chatJid);
    } catch (error) {
      options.onWarn?.("Failed to clear turn-scoped SSH profile", {
        operation: "run_agent.ssh_clear_turn_scope",
        chatJid,
        error,
      });
      debugSuppressedError(log, "Failed to clear turn-scoped SSH profile.", error, { chatJid });
    }
    options.clearActiveForkBaseLeaf(chatJid);
  }
}
