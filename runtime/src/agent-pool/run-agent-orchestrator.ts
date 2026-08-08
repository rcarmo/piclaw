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
import { deleteSshConfig, getChatOperation } from "../db.js";
import { clearLiveSshConfig } from "../extensions/ssh-core.js";

import { getAutomaticRecoveryConfig } from "./automatic-recovery.js";
import { getAgentRuntimeConfig, getSessionStorageConfig, getToolUseBudget } from "../core/config.js";
import { detectChannel } from "../router.js";
import { pruneOrphanToolResults } from "./orphan-tool-results.js";
import { writeAgentLog } from "./logging.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { getSessionFileLineCount, getSessionFileSize, rotateSession } from "../session-rotation.js";
import { getCompactionSuccessCount, resetCompactionSuccessCount } from "./compaction.js";
import { withChatContext } from "../core/chat-context.js";
import {
  formatTimeoutDuration,
  resolveSessionIdleMaxWaitMs,
  waitForSessionIdle,
} from "./prompt-utils.js";
import {
  cancelScheduledIdleAutoCompaction,
  clearCompactionFailureBackoff,
  isCompactionCancellationError,
  maybeAutoCompactSessionBeforePrompt,
  noteCompactionSuccess,
} from "./compaction.js";
import { snapshotSessionEntryCount } from "./blank-turn-detection.js";
import {
  didPromptAdvanceSession,
  getSessionLeafId,
} from "./context-pressure-retry.js";
import { createAttemptToolBudgetController } from "./run-agent-attempt-budget.js";
import { createAttemptContextPressureController } from "./run-agent-attempt-context.js";
import {
  finalizePromptAttemptOutput,
  readSessionStateErrorMessage,
} from "./run-agent-attempt-finalization.js";
import {
  runAgentRecoveryPhase,
  type PromptAttemptResult,
} from "./run-agent-recovery-phase.js";
import type { AgentTurnCoordinator } from "./turn-coordinator.js";
import type { AgentOutput, RetrySettingsProvider, RunAgentOptions } from "./contracts.js";
import { getDefaultActiveToolNames } from "../extensions/tool-activation.js";
import { getRememberedActiveToolSubset, rememberActiveToolSubset } from "./active-tool-subset-memory.js";
import { logToolStateTransition } from "./tool-state-transitions.js";
import { createRunToolCeilingController, type SessionWithToolControl } from "./run-tool-ceiling.js";
import { isPendingShutdown } from "../runtime/shutdown-registry.js";
import { clearAgentAbortCause, consumeAgentAbortCause, recordAgentAbortCause } from "./abort-provenance.js";
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

const MIN_TOOL_EXECUTION_WATCHDOG_HEARTBEAT_MS = 1_000;
const MAX_TOOL_EXECUTION_WATCHDOG_HEARTBEAT_MS = 15_000;
type UpstreamAutoCompactionMethod = (...args: unknown[]) => unknown;

type UpstreamAutoCompactionSession = Record<string, unknown> & {
  _checkCompaction?: UpstreamAutoCompactionMethod;
  _runAutoCompaction?: UpstreamAutoCompactionMethod;
};

let warnedMissingUpstreamAutoCompactionSuppressorMethods = false;

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

type ToolExecutionWatchdogEvent = {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  toolCallId?: unknown;
  toolName?: unknown;
};

export type ToolExecutionHeartbeatEvent = {
  type: "tool_execution_heartbeat";
  emittedAt: string;
  activeToolCount: number;
  activeToolNames: string[];
  activeTools: Array<{
    toolCallId: string;
    toolName: string | null;
    startedAt: string;
    lastEventAt: string;
  }>;
};

export function getToolExecutionWatchdogHeartbeatIntervalMs(timeoutMs = getProgressWatchdogTimeoutMs()): number {
  // Tool liveness is also user-facing status telemetry. Keep it alive even
  // when watchdog escalation is disabled so quiet buffered commands do not
  // appear hung and reconnect status remains fresh.
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return MAX_TOOL_EXECUTION_WATCHDOG_HEARTBEAT_MS;
  return Math.max(
    MIN_TOOL_EXECUTION_WATCHDOG_HEARTBEAT_MS,
    Math.min(MAX_TOOL_EXECUTION_WATCHDOG_HEARTBEAT_MS, Math.floor(timeoutMs / 3)),
  );
}

export function createToolExecutionWatchdogHeartbeatController(
  chatJid: string,
  options: {
    heartbeat?: (chatJid: string, phase: "tool_execution", metadata?: Record<string, unknown>) => void;
    onHeartbeat?: (event: ToolExecutionHeartbeatEvent) => void;
    getIntervalMs?: () => number;
  } = {},
): {
  handleEvent: (event: ToolExecutionWatchdogEvent) => void;
  getActiveExecutionCount: () => number;
  stop: () => void;
} {
  const heartbeat = options.heartbeat ?? heartbeatTrackedPhase;
  const getIntervalMs = options.getIntervalMs ?? (() => getToolExecutionWatchdogHeartbeatIntervalMs());
  const activeTools = new Map<string, {
    toolName: string | null;
    startedAt: string;
    lastEventAt: string;
  }>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let anonymousToolCounter = 0;

  const stopTimerIfIdle = () => {
    if (activeTools.size > 0 || !timer) return;
    clearInterval(timer);
    timer = null;
  };

  const publishHeartbeat = () => {
    if (activeTools.size === 0) return;
    const emittedAt = new Date().toISOString();
    const toolNames = Array.from(new Set(
      Array.from(activeTools.values())
        .map((value) => value.toolName)
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0),
    )).slice(0, 3);
    const activeToolSnapshots = Array.from(activeTools.entries()).map(([toolCallId, state]) => ({
      toolCallId,
      toolName: state.toolName,
      startedAt: state.startedAt,
      lastEventAt: state.lastEventAt,
    }));
    heartbeat(chatJid, "tool_execution", {
      eventType: "tool_execution_watchdog_heartbeat",
      activeToolCount: activeTools.size,
      activeToolNames: toolNames,
    });
    options.onHeartbeat?.({
      type: "tool_execution_heartbeat",
      emittedAt,
      activeToolCount: activeTools.size,
      activeToolNames: toolNames,
      activeTools: activeToolSnapshots,
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
      if (targetName === null || activeName.toolName === targetName) {
        activeTools.delete(key);
        return;
      }
    }
  };

  return {
    handleEvent(event: ToolExecutionWatchdogEvent) {
      if (event.type === "tool_execution_start") {
        const now = new Date().toISOString();
        const toolName = typeof event.toolName === "string" && event.toolName.trim() ? event.toolName : null;
        activeTools.set(resolveToolKey(event), { toolName, startedAt: now, lastEventAt: now });
        ensureTimer();
        return;
      }
      if (event.type === "tool_execution_update") {
        const key = typeof event.toolCallId === "string" && event.toolCallId.trim() ? event.toolCallId : null;
        const current = key ? activeTools.get(key) : null;
        if (key && current) {
          activeTools.set(key, {
            ...current,
            toolName: typeof event.toolName === "string" && event.toolName.trim() ? event.toolName : current.toolName,
            lastEventAt: new Date().toISOString(),
          });
        }
        return;
      }
      if (event.type === "tool_execution_end") {
        removeTool(event);
        stopTimerIfIdle();
      }
    },
    getActiveExecutionCount() {
      return activeTools.size;
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
  options: Pick<RunAgentOrchestratorOptions, "onInfo" | "onWarn"> & { isCancelled?: () => boolean },
): Promise<AgentSession> {
  if (options.isCancelled?.()) return session;
  const sessionStorageConfig = getSessionStorageConfig();
  if (!sessionStorageConfig.autoRotate) return session;

  const thresholdBytes = sessionStorageConfig.maxSizeBytes;

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

  if (options.isCancelled?.()) return session;
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

function resolveToolBudgetWarningThreshold(budget: number): number {
  const normalized = Math.max(1, Math.floor(Number.isFinite(budget) ? budget : 1));
  const margin = Math.min(8, Math.max(1, Math.ceil(normalized * 0.125)));
  return Math.max(1, normalized - margin);
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

function getInitialProviderResponseGraceMs(chatJid: string): number | null {
  if (!chatJid.startsWith("dream:")) return null;
  const timeoutMs = getProgressWatchdogTimeoutMs();
  if (timeoutMs <= 0) return null;
  // Dream is an out-of-band maintenance pass with no interactive latency
  // contract. Give a slow initial provider response one bounded extra window;
  // once the first provider event arrives, normal streaming/tool thresholds
  // immediately resume.
  return Math.max(timeoutMs, Math.min(900_000, timeoutMs * 3));
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

async function runPromptAttempt(
  prompt: string,
  chatJid: string,
  session: AgentSession,
  timeoutMs: number,
  finalizationReserveMs: number,
  runOptions: RunAgentOptions,
  options: RunAgentOrchestratorOptions,
  totalRunStartedAt: number,
  modelLabel: string | null,
  toolExecutionCountAtStart: number,
): Promise<PromptAttemptResult> {
  let hadToolActivity = false;
  let hadPartialOutput = false;
  let hadCompletedTurnOutput = false;
  let hadTerminalTurnOutput = false;
  let compactionErrorMessage: string | null = null;
  let sawAssistantToolCallMessage = false;
  let onlyReadOnlyToolActivity = true;
  let assistantToolUseMessageCount = 0;
  let toolExecutionCount = toolExecutionCountAtStart;
  let modelResponseSequence = 0;
  let activeModelResponse: { sequence: number; startedAt: number } | null = null;
  const sessionEntryBaseline = snapshotSessionEntryCount(session);
  const baselineLeafId = getSessionLeafId(session);
  const toolUseMessageBudget = getToolUseBudget();
  const midTurnToolExecutionHardCeiling = toolUseMessageBudget;
  const toolBudget = createAttemptToolBudgetController({
    session,
    chatJid,
    initialToolExecutionCount: toolExecutionCountAtStart,
    toolUseMessageBudget,
    toolUseWarningThreshold: resolveToolBudgetWarningThreshold(toolUseMessageBudget),
    runOptions,
    onWarn: options.onWarn,
    getRunObservabilityDetails,
  });
  let finalizationReserveTimer: ReturnType<typeof setTimeout> | null = null;
  if (finalizationReserveMs > 0 && timeoutMs > finalizationReserveMs) {
    finalizationReserveTimer = setTimeout(() => {
      if (!toolBudget.applyFinalizationReserve()) return;
      options.onInfo?.("Recovery finalization reserve reached; disabling tools for terminal reply", {
        operation: "run_agent.recovery_finalization_reserve",
        chatJid,
        timeoutMs,
        finalizationReserveMs,
        ...getRunObservabilityDetails(runOptions),
      });
      runOptions.onEvent?.({
        type: "recovery_finalization_reserve",
        timeoutMs,
        finalizationReserveMs,
      } as unknown as AgentSessionEvent);
    }, timeoutMs - finalizationReserveMs);
    if (typeof finalizationReserveTimer.unref === "function") finalizationReserveTimer.unref();
  }
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
  const toolExecutionWatchdogHeartbeat = createToolExecutionWatchdogHeartbeatController(chatJid, {
    onHeartbeat: (event) => runOptions.onEvent?.(event as unknown as AgentSessionEvent),
  });
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

  const attemptContext = createAttemptContextPressureController({
    session,
    chatJid,
    runOptions,
    onWarn: options.onWarn,
    getRunObservabilityDetails,
    log,
  });

  const wrappedOnEvent = (event: AgentSessionEvent) => {
    if (event.type === "message_update") {
      heartbeatTrackedPhase(chatJid, "streaming", { eventType: event.type, providerEventObserved: true, model: modelLabel });
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

    if (
      event.type === "tool_execution_start"
      || event.type === "tool_execution_update"
      || event.type === "tool_execution_end"
    ) {
      toolExecutionWatchdogHeartbeat.handleEvent(event as ToolExecutionWatchdogEvent);
    }

    if (event.type === "tool_execution_start") {
      attemptContext.establishToolStartBaseline(modelResponseSequence);
    } else if (event.type === "tool_execution_update") {
      attemptContext.publishContextUsageUpdate("tool_execution_update");
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
      if (messageEvent?.type === "text_start" || messageEvent?.type === "thinking_start") {
        heartbeatTrackedPhase(chatJid, "streaming", {
          eventType: messageEvent.type,
          providerEventObserved: true,
          model: modelLabel,
        });
      }
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
        const toolCallId = (event as { toolCallId?: unknown }).toolCallId;
        const { wasBlockedByBudget } = toolBudget.consumeToolExecutionEnd(toolCallId, (event as { isError?: unknown }).isError);
        if (!wasBlockedByBudget) toolExecutionCount += 1;
        if (!wasBlockedByBudget && toolExecutionCount >= toolUseMessageBudget) {
          toolBudget.enforceCompletedExecutionBudget();
        }
        // Accumulate tool-result content size for mid-turn context projection.
        attemptContext.addToolResultContent((event as { result?: unknown }).result);
      }
      const toolName = (event as { toolName?: unknown }).toolName;
      if (!isRetrySafeToolName(toolName)) {
        onlyReadOnlyToolActivity = false;
      }
      // Track failed tool executions so recovery can make smarter decisions.
      if (event.type === "tool_execution_end" && (event as { isError?: unknown }).isError) {
        hadToolFailure = true;
      }
      if (event.type === "tool_execution_end" && !(event as { isError?: unknown }).isError && isTerminalSideEffectToolName(toolName)) {
        sawTerminalSideEffectToolActivity = true;
      }
      if (event.type === "tool_execution_end") {
        attemptContext.checkMidTurnContextAfterToolResult(toolName, (event as { isError?: unknown }).isError, toolExecutionCount, midTurnToolExecutionHardCeiling, toolUseMessageBudget);
      }
      // If exit_process was called, do NOT abort immediately — let the LLM
      // finish its current text response so the agent's reply is captured and
      // persisted to the DB. The abort happens below in the message_end handler
      // when the LLM tries to issue further tool calls (stopReason === "toolUse").
    }
    if (event.type === "message_end") {
      const estimateSnapshot = attemptContext.publishContextUsageUpdate("message_end", true);
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
            recordAgentAbortCause(chatJid, "service_shutdown", "run_agent.pending_shutdown_abort");
            void session.abort().catch((err) => {
              options.onWarn?.("Failed to abort session after exit_process (deferred to message_end)", {
                operation: "run_agent.pending_shutdown_abort",
                chatJid,
                err,
              });
            });
          }
          if (toolExecutionCount >= toolUseMessageBudget || toolBudget.state.reservedToolExecutionCount >= toolUseMessageBudget) {
            toolBudget.requestToolBudgetSoftStop(toolCallBlocks, assistantToolUseMessageCount);
          }

        }
      }
    }
    if (event.type === "compaction_start") {
      attemptContext.state.sawCompactionIntent = true;
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
  const goalDeadlineCheckpointEnabled = Boolean(
    runOptions.goalDeadlineCheckpoint && runOptions.onGoalDeadlineCheckpoint && runOptions.turnId,
  );
  const promptTimeout = options.turnCoordinator.startPromptTimeout(
    session,
    chatJid,
    timeoutMs,
    goalDeadlineCheckpointEnabled
      ? {
          oldTurnId: runOptions.turnId!,
          reserveMs: runOptions.goalDeadlineCheckpoint!.reserveMs,
          tryLatch: runOptions.goalDeadlineCheckpoint!.tryLatch,
        }
      : undefined,
  );
  const { timedOutRef } = promptTimeout;
  let goalDeadlineCheckpointEvidence: import("./contracts.js").GoalDeadlineCheckpointEvidence | null = null;
  let goalDeadlineCheckpointCommitted = false;
  const finishPromptTimeout = async () => {
    if (typeof promptTimeout.finish === "function") return await promptTimeout.finish();
    // Compatibility for injected coordinators that still implement the
    // pre-checkpoint timeout state shape.
    promptTimeout.completedRef.value = true;
    if (promptTimeout.timeoutId) clearTimeout(promptTimeout.timeoutId);
    if (promptTimeout.checkpointTimeoutId) clearTimeout(promptTimeout.checkpointTimeoutId);
    return null;
  };
  let staleProgressInterrupted = false;
  let staleProgressAbortFailed: string | null = null;
  let unresolvedToolExecutionCount: number;
  const unregisterProgressAborter = registerProgressWatchdogAborter(chatJid, async (stall) => {
    staleProgressInterrupted = true;
    recordAgentAbortCause(chatJid, "stale_progress_watchdog", "run_agent.stale_progress_abort");
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
  let promptSettled = false;
  const restoreUpstreamAutoCompaction = suppressUpstreamAutoCompactionDuringPrompt(session, chatJid, options);
  try {
    heartbeatTrackedPhase(chatJid, "prompt", { eventType: "prompt_start" });
    attemptContext.publishContextUsageUpdate("prompt_start", true);
    const promptOutcome = session.prompt(prompt).then(
      () => {
        promptSettled = true;
        return { kind: "resolved" as const };
      },
      (error: unknown) => {
        promptSettled = true;
        promptThrownError = error instanceof Error ? error.message : String(error);
        return { kind: "rejected" as const, error };
      },
    );
    const outcome = goalDeadlineCheckpointEnabled
      ? await Promise.race([
          promptOutcome,
          promptTimeout.settled.then((evidence) => ({ kind: "timeout_settled" as const, evidence })),
        ])
      : await promptOutcome;
    if (outcome.kind === "rejected") throw outcome.error;
    if (outcome.kind === "resolved") {
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
    }
  } catch (error) {
    promptThrownError = error instanceof Error ? error.message : String(error);
  } finally {
    if (finalizationReserveTimer) clearTimeout(finalizationReserveTimer);
    goalDeadlineCheckpointEvidence ??= await finishPromptTimeout();
    const checkpointEvidenceBeforeIdle = goalDeadlineCheckpointEvidence;
    if (checkpointEvidenceBeforeIdle?.settlement === "abort_requested") {
      const deadlineAtMs = Date.parse(checkpointEvidenceBeforeIdle.deadlineAt);
      let verifiedIdleAtMs: number | null = null;
      while (Date.now() <= deadlineAtMs) {
        const sessionIdle = promptSettled && !session.isStreaming && !session.isCompacting && !session.isRetrying;
        const activeToolCount = toolExecutionWatchdogHeartbeat.getActiveExecutionCount();
        if (sessionIdle && activeToolCount === 0) {
          verifiedIdleAtMs = Date.now();
          break;
        }
        const remainingMs = deadlineAtMs - Date.now();
        if (remainingMs <= 0) break;
        await Bun.sleep(Math.min(10, remainingMs));
      }
      goalDeadlineCheckpointEvidence = {
        ...checkpointEvidenceBeforeIdle,
        settledAt: new Date(verifiedIdleAtMs ?? Date.now()).toISOString(),
        settlement: verifiedIdleAtMs !== null ? "idle" : "abort_failed",
        abortError: verifiedIdleAtMs !== null
          ? null
          : "Session or active tool executions did not settle before the hard prompt deadline",
      };
    } else if (!checkpointEvidenceBeforeIdle && !promptThrownError) {
      const idleMaxWaitMs = resolveSessionIdleMaxWaitMs(session);
      try {
        await waitForSessionIdle(session, 10, (result) => {
          options.onInfo?.("Session settled after prompt", {
            operation: "run_agent.wait_for_session_idle",
            chatJid,
            maxWaitMs: idleMaxWaitMs,
            ...result,
          });
        }, idleMaxWaitMs);
      } catch (error) {
        options.onWarn?.("Session did not settle after prompt", {
          operation: "run_agent.wait_for_session_idle_failed",
          chatJid,
          maxWaitMs: idleMaxWaitMs,
          err: error,
          ...getRunObservabilityDetails(runOptions),
        });
      }
    }
    unregisterProgressAborter();
    unresolvedToolExecutionCount = toolExecutionWatchdogHeartbeat.getActiveExecutionCount();
    const checkpointEvidence = goalDeadlineCheckpointEvidence;
    if (checkpointEvidence && runOptions.onGoalDeadlineCheckpoint) {
      if (checkpointEvidence.settlement === "idle" && unresolvedToolExecutionCount === 0) {
        const queueSnapshot = session as unknown as {
          getSteeringMessages?: () => readonly string[];
          getFollowUpMessages?: () => readonly string[];
        };
        goalDeadlineCheckpointEvidence = {
          ...checkpointEvidence,
          pendingSteering: [...(queueSnapshot.getSteeringMessages?.() ?? [])],
          pendingFollowUps: [...(queueSnapshot.getFollowUpMessages?.() ?? [])],
        };
      }
      try {
        goalDeadlineCheckpointCommitted = await runOptions.onGoalDeadlineCheckpoint(goalDeadlineCheckpointEvidence ?? checkpointEvidence);
        if (goalDeadlineCheckpointCommitted) {
          (session as unknown as { clearQueue?: () => unknown }).clearQueue?.();
        }
      } catch (err) {
        options.onWarn?.("Goal deadline checkpoint callback failed", {
          operation: "run_agent.goal_deadline_checkpoint",
          chatJid,
          err,
          ...getRunObservabilityDetails(runOptions),
        });
      }
    }
    toolBudget.restoreToolBudgetGuard();
    toolBudget.restoreToolBudgetSoftStop();
    restoreUpstreamAutoCompaction();
    toolExecutionWatchdogHeartbeat.stop();
    unsub();
  }

  tracker.finalizeAttempt();
  const trackedFinalText = tracker.getFinalText();
  const finalUsage = tracker.getFinalUsage();
  if (goalDeadlineCheckpointEvidence && goalDeadlineCheckpointCommitted) {
    return {
      output: {
        status: "tool_complete",
        result: null,
        goalDeadlineCheckpoint: goalDeadlineCheckpointEvidence,
        abortCause: "goal_deadline_checkpoint",
        abortOperation: "start_prompt_timeout.goal_deadline_checkpoint",
      },
      promptWasPersisted: didPromptAdvanceSession(session, baselineLeafId),
      timedOut: false,
      toolExecutionCount,
      snapshot: {
        hadToolActivity,
        hadPartialOutput: hadPartialOutput || Boolean(trackedFinalText),
        hadCompletedTurnOutput,
        hadTerminalTurnOutput,
        compactionErrorMessage,
        sawCompactionIntent: attemptContext.state.sawCompactionIntent,
        sawAssistantToolCall: sawAssistantToolCallMessage,
        onlyReadOnlyToolActivity,
        hasUnresolvedToolExecution: false,
        hadToolFailure,
        sawTerminalSideEffectToolActivity,
        toolUseBudgetExceeded: toolBudget.state.toolUseBudgetExceeded,
        assistantToolUseMessageCount,
        toolExecutionCount,
        toolUseMessageBudget,
      },
    };
  }
  hadPartialOutput = hadPartialOutput || !!trackedFinalText;
  const finalAttachments = options.takeAttachments(chatJid);
  const timedOut = timedOutRef.value;
  const lastAssistantState = tracker.getLastAssistantState();
  // A completed message with authoritative text is a normal final result.
  // Streamed text omitted from message_end remains eligible for intermediate
  // turn flushing and handler draft fallback, but it must not reclassify an
  // otherwise tool-only terminal stop from tool_complete to success.
  const finalText = lastAssistantState && !lastAssistantState.hadTextContent ? "" : trackedFinalText;
  const latentStateError = !finalText ? readSessionStateErrorMessage(session) : null;

  const finalized = finalizePromptAttemptOutput({
    session,
    sessionEntryBaseline,
    chatJid,
    timeoutMs,
    timedOut,
    staleProgressAbortFailed,
    staleProgressInterrupted,
    finalText,
    finalAttachments,
    finalUsage,
    lastAssistantState,
    promptThrownError,
    turnError: tracker.getError(),
    latentStateError,
    hadToolActivity,
    hadPartialOutput,
    hadCompletedTurnOutput,
    hadTerminalTurnOutput,
    sawAssistantToolCallMessage,
    onlyReadOnlyToolActivity,
    hasUnresolvedToolExecution: unresolvedToolExecutionCount > 0,
    sawTerminalSideEffectToolActivity,
    hadToolFailure,
    hadToolFailureBeforeSoftStop: toolBudget.state.hadToolFailureBeforeSoftStop,
    hadToolFailureAfterSoftStop: toolBudget.state.hadToolFailureAfterSoftStop,
    toolUseSoftStopApplied: toolBudget.state.toolUseSoftStopApplied,
    toolUseBudgetExceeded: toolBudget.state.toolUseBudgetExceeded,
    toolExecutionCount,
    assistantToolUseMessageCount,
    toolUseMessageBudget,
    compactionErrorMessage,
    sawCompactionIntent: attemptContext.state.sawCompactionIntent,
    runOptions,
    onWarn: options.onWarn,
    getRunObservabilityDetails,
    formatTimeoutDuration,
    getProgressWatchdogTimeoutMs,
    log,
  });

  return {
    output: finalized.output,
    promptWasPersisted: didPromptAdvanceSession(session, baselineLeafId),
    timedOut,
    toolExecutionCount,
    snapshot: finalized.snapshot,
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
  // Abort provenance belongs to one active turn. Commands issued while no
  // prompt is running, or an earlier exceptional exit, must not label this run.
  clearAgentAbortCause(chatJid);
  options.clearAttachments(chatJid);
  updateSessionStreaming(chatJid, true);
  let modelLabel: string | null = null;
  const isCancelled = (): boolean => {
    if (!runOptions.operationOwner) return false;
    const current = getChatOperation(chatJid);
    return current?.operationId !== runOptions.operationOwner.operationId || Boolean(current.cancellation);
  };
  const cancelledOutput = (): AgentOutput => ({
    status: "error",
    result: null,
    error: "Operation cancelled.",
    failureCategory: "aborted",
  });

  // Tool-cap and tool-ceiling state – declared outside try so cleanup
  // can run in finally regardless of how the try exits.
  const toolCallCapRef = { exceeded: false, count: 0, cap: undefined as number | undefined };
  let toolCallUnsub: (() => void) | undefined;
  let sessionCtrl: SessionWithToolControl | null = null;
  const toolCeiling = createRunToolCeilingController({
    chatJid,
    runOptions,
    onWarn: options.onWarn,
  });

  try {
    if (runOptions.scheduleIdleAutoCompaction) {
      cancelScheduledIdleAutoCompaction(chatJid);
    }

    const runtime = await options.getOrCreateRuntime(chatJid);
    if (isCancelled()) return cancelledOutput();
    let session = runtime.session;
    session = await maybeAutoRotateSession(session, runtime, chatJid, { ...options, isCancelled });
    if (isCancelled()) return cancelledOutput();
    // Protected recovery/finalization attempts deliberately clear tools. An
    // ordinary subsequent turn must never inherit that empty set: it is not a
    // user-selectable steady state and otherwise makes the agent appear broken
    // until a human discovers reset_active_tools. Do not override explicit
    // per-run ceilings (Dream and other restricted runners own those scopes).
    const ordinaryToolControl = session as unknown as {
      getActiveToolNames?: () => string[];
      setActiveToolsByName?: (names: string[]) => void;
    };
    if (!runOptions.toolCeilingFilter
      && typeof ordinaryToolControl.getActiveToolNames === "function"
      && typeof ordinaryToolControl.setActiveToolsByName === "function") {
      const activeToolNames = ordinaryToolControl.getActiveToolNames();
      if (activeToolNames.length > 0) {
        rememberActiveToolSubset(session, activeToolNames);
      } else {
        const rememberedToolNames = getRememberedActiveToolSubset(session);
        const restoredToolNames = rememberedToolNames ?? getDefaultActiveToolNames();
        ordinaryToolControl.setActiveToolsByName(restoredToolNames);
        rememberActiveToolSubset(session, restoredToolNames);
        logToolStateTransition({
          chatJid,
          turnId: runOptions.turnId,
          phase: "ordinary_turn",
          cause: "restore_leaked_empty_set",
          previous: [],
          next: restoredToolNames,
          restored: true,
        });
        const restorationSource = rememberedToolNames ? "remembered_subset" : "defaults";
        options.onWarn?.(
          rememberedToolNames
            ? "Restored the previous active-tool subset after an empty set leaked into an ordinary turn"
            : "Restored default tools after an empty active-tool set leaked into an ordinary turn",
          {
            operation: "run_agent.restore_empty_tool_set",
            chatJid,
            restorationSource,
            restoredTools: restoredToolNames,
            ...getRunObservabilityDetails(runOptions),
          },
        );
      }
    }
    modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : null;
    updateSessionModel(chatJid, modelLabel, session.thinkingLevel ?? null);
    const initialProviderResponseGraceMs = getInitialProviderResponseGraceMs(chatJid);
    beginTrackedPhase(chatJid, runOptions.skipPrePromptCompaction ? "prompt" : "preprompt_compaction", {
      source: "run_agent",
      model: modelLabel,
      ...(initialProviderResponseGraceMs ? { initialProviderResponseGraceMs, providerEventObserved: false } : {}),
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
      if (isCancelled()) return cancelledOutput();
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
    if (isCancelled()) return cancelledOutput();
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

    // Tool ceiling enforcement is owner-bound. Recovery can replace the
    // active session, so a saved setter must never be restored onto another
    // session object.
    sessionCtrl = session as unknown as SessionWithToolControl;
    toolCeiling.apply(sessionCtrl);

    const channel = detectChannel(chatJid);
    const retrySettings = ((runtime.services?.settingsManager as RetrySettingsProvider | undefined)?.getRetrySettings?.()) || undefined;
    const baseRecoveryConfig = getAutomaticRecoveryConfig(retrySettings);
    const recoveryConfig = timeoutMs > 0
      ? { ...baseRecoveryConfig, totalBudgetMs: Math.min(baseRecoveryConfig.totalBudgetMs, timeoutMs) }
      : baseRecoveryConfig;

    const runResult: AgentOutput = await withChatContext(chatJid, channel, async () => await runAgentRecoveryPhase({
      prompt,
      chatJid,
      session,
      sessionCtrl,
      timeoutMs,
      startTime,
      modelLabel,
      recoveryConfig,
      runOptions,
      logsDir: options.logsDir,
      onInfo: options.onInfo,
      onWarn: options.onWarn,
      clearAttachments: options.clearAttachments,
      isCancelled,
      toolCallCap: toolCallCapRef,
      rotateAfterInsufficientCompaction: async (reason) => {
        if (isCancelled()) return { ok: false, errorMessage: "Operation cancelled." };
        const rotation = await rotateSession(session, runtime, {
          reason: "automatic",
          skipCompaction: true,
          emergencyReason: reason,
          chatJid,
        });
        if (rotation.status !== "success") return { ok: false, errorMessage: rotation.message };
        clearCompactionFailureBackoff(chatJid);
        resetCompactionSuccessCount(chatJid);
        session = runtime.session;
        sessionCtrl = session as unknown as SessionWithToolControl;
        toolCeiling.apply(sessionCtrl);
        noteCompactionSuccess(session, chatJid, "rotation", {
          ...options,
          countSuccess: false,
          clearBackoff: false,
        });
        modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : null;
        updateSessionModel(chatJid, modelLabel, session.thinkingLevel ?? null);
        return { ok: true, session, sessionCtrl };
      },
      rotateAfterCompactionFailure: async (reason) => {
        if (isCancelled()) return { ok: false, errorMessage: "Operation cancelled." };
        const rotation = await rotateSession(session, runtime, {
          reason: "automatic",
          skipCompaction: true,
          emergencyReason: reason,
          chatJid,
        });
        if (rotation.status !== "success") return { ok: false, errorMessage: rotation.message };
        clearCompactionFailureBackoff(chatJid);
        resetCompactionSuccessCount(chatJid);
        session = runtime.session;
        sessionCtrl = session as unknown as SessionWithToolControl;
        toolCeiling.apply(sessionCtrl);
        noteCompactionSuccess(session, chatJid, "rotation", {
          ...options,
          countSuccess: false,
          clearBackoff: false,
        });
        modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : null;
        updateSessionModel(chatJid, modelLabel, session.thinkingLevel ?? null);
        return { ok: true, session, sessionCtrl };
      },
      runPromptAttempt: async (attemptPrompt, attemptTimeoutMs, turnToolExecutionCount, finalizationReserveMs = 0) => await runPromptAttempt(
        attemptPrompt,
        chatJid,
        session,
        attemptTimeoutMs,
        finalizationReserveMs,
        runOptions,
        options,
        startTime,
        modelLabel,
        turnToolExecutionCount,
      ),
    }), { turnId: runOptions.turnId });

    return runResult;
  } catch (err) {
    options.clearAttachments(chatJid);
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    writeAgentLog(options.logsDir, chatJid, duration, false, null, errorMsg, null, consumeAgentAbortCause(chatJid));
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
    toolCeiling.release();
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
