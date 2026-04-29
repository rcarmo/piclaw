/**
 * agent-pool/run-agent-orchestrator.ts – Main runAgent prompt lifecycle orchestration.
 */

import { type AgentSession, type AgentSessionEvent, type AgentSessionRuntime } from "@mariozechner/pi-coding-agent";

import type { AttachmentInfo } from "./attachments.js";
import {
  trackToolStart as trackToolStartActivity,
  trackToolEnd as trackToolEndActivity,
  updateSessionStreaming,
  updateSessionModel,
} from "../extensions/session-status.js";

import {
  decideAutomaticRecovery,
  getAutomaticRecoveryConfig,
  getAutomaticRecoveryDelayMs,
  type RecoveryAttemptSnapshot,
  type RecoveryClassifier,
  type RecoveryStrategy,
} from "./automatic-recovery.js";
import { getAgentRuntimeConfig, getSessionStorageConfig, getToolUseMessageBudget } from "../core/config.js";
import { detectChannel } from "../router.js";
import { pruneOrphanToolResults } from "./orphan-tool-results.js";
import { writeAgentLog } from "./logging.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { getSessionFileLineCount, getSessionFileSize, rotateSession } from "../session-rotation.js";
import { withChatContext } from "../core/chat-context.js";
import {
  formatTimeoutDuration,
  resolveSessionIdleMaxWaitMs,
  waitForSessionIdle,
} from "./prompt-utils.js";
import {
  DEFAULT_FALLBACK_CONTEXT_WINDOW,
  clearCompactionFailureBackoff,
  estimateContextTokensFromSession,
  getModelContextWindow,
  maybeAutoCompactSessionBeforePrompt,
  noteCompactionFailure,
  runCompactionWithTimeout,
} from "./compaction.js";
import {
  inspectBlankTurnSessionDelta,
  isBlankTurnSessionDelta,
  snapshotSessionEntryCount,
} from "./blank-turn-detection.js";
import type { AgentTurnCoordinator } from "./turn-coordinator.js";
import type { AgentOutput, AgentRecoveryDiagnosticEntry, AgentRecoveryMetadata, RetrySettingsProvider, RunAgentOptions } from "./contracts.js";
import { isPendingShutdown } from "../runtime/shutdown-registry.js";
import {
  beginTrackedPhase,
  heartbeatTrackedPhase,
  endTrackedPhase,
  getProgressWatchdogTimeoutMs,
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

  const envThresholdMb = parseInt(process.env.PICLAW_SESSION_MAX_SIZE_MB || "", 10);
  const thresholdBytes = Number.isFinite(envThresholdMb) && envThresholdMb > 0
    ? envThresholdMb * 1024 * 1024
    : sessionStorageConfig.maxSizeBytes;

  const sessionFileSize = getSessionFileSize(session.sessionFile);
  const sessionFileLines = getSessionFileLineCount(session.sessionFile);
  const exceedsSize = sessionFileSize !== null && sessionFileSize >= thresholdBytes;
  const exceedsLines = sessionStorageConfig.maxLines > 0
    && sessionFileLines !== null
    && sessionFileLines >= sessionStorageConfig.maxLines;
  if (!exceedsSize && !exceedsLines) return session;

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

  const result = await rotateSession(session, runtime, { reason: "automatic" });
  if (result.status === "success") {
    options.onInfo?.("Auto-rotated oversized session", {
      operation: "maybe_auto_rotate_session",
      chatJid,
      previousSize: result.previousSize ?? sessionFileSize,
      previousLines: sessionFileLines,
      nextSize: result.nextSize ?? "unknown",
      trigger: exceedsLines ? "lines" : "size",
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
    sawCompactionIntent: Boolean(snapshot.sawCompactionIntent),
    compactionErrorMessage: snapshot.compactionErrorMessage ?? null,
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
  emitAgentSessionEvent(runOptions.onEvent, { type: "compaction_start", reason: "overflow" });
  const compactionResult = await runCompactionWithTimeout(
    session,
    chatJid,
    options,
    async () => await session.compact(),
  );
  if (!compactionResult.ok) {
    noteCompactionFailure(chatJid, compactionResult.errorMessage);
    const aborted = /compaction cancelled|aborterror/i.test(compactionResult.errorMessage);
    emitAgentSessionEvent(runOptions.onEvent, {
      type: "compaction_end",
      reason: "overflow",
      result: undefined,
      aborted,
      willRetry: false,
      errorMessage: aborted ? undefined : `Recovery compaction failed: ${compactionResult.errorMessage}`,
    });
    return { ok: false, errorMessage: compactionResult.errorMessage };
  }
  clearCompactionFailureBackoff(chatJid);
  emitAgentSessionEvent(runOptions.onEvent, {
    type: "compaction_end",
    reason: "overflow",
    result: undefined,
    aborted: false,
    willRetry: true,
  });
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
  let compactionErrorMessage: string | null = null;
  let sawCompactionIntent = false;
  let sawAssistantToolCallMessage = false;
  let onlyReadOnlyToolActivity = true;
  let hadToolFailure = false;
  let failedToolName: string | null = null;
  let assistantToolUseMessageCount = 0;
  let toolExecutionCount = 0;
  let toolUseBudgetExceeded = false;
  let modelResponseSequence = 0;
  let activeModelResponse: { sequence: number; startedAt: number } | null = null;
  const sessionEntryBaseline = snapshotSessionEntryCount(session);
  const toolUseMessageBudget = getToolUseMessageBudget();
  runOptions.sessionLeafId = typeof session.sessionManager?.getLeafId === "function"
    ? session.sessionManager.getLeafId() ?? undefined
    : runOptions.sessionLeafId;

  const originalOnTurnComplete = runOptions.onTurnComplete;
  const onTurnComplete = originalOnTurnComplete
    ? ((turn: { text: string; attachments: AttachmentInfo[] }) => {
        hadCompletedTurnOutput = hadCompletedTurnOutput || !!(turn.text || turn.attachments.length > 0);
        originalOnTurnComplete(turn);
      })
    : undefined;

  const tracker = options.turnCoordinator.createTracker(chatJid, onTurnComplete);
  const toolExecutionWatchdogHeartbeat = createToolExecutionWatchdogHeartbeatController(chatJid);
  const isRetrySafeToolName = (toolName: unknown): boolean => typeof toolName === "string" && [
    "read",
    "read_attachment",
    "search_workspace",
    "introspect_sql",
    "list_tools",
    "list_scripts",
  ].includes(toolName);
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
      }
      const toolName = (event as { toolName?: unknown }).toolName;
      if (!isRetrySafeToolName(toolName)) {
        onlyReadOnlyToolActivity = false;
      }
      // Track failed tool executions so recovery can make smarter decisions.
      if (event.type === "tool_execution_end" && (event as { isError?: unknown }).isError) {
        hadToolFailure = true;
        if (!failedToolName && typeof toolName === "string") {
          failedToolName = toolName;
        }
      }
      // If exit_process was called, do NOT abort immediately — let the LLM
      // finish its current text response so the agent's reply is captured and
      // persisted to the DB. The abort happens below in the message_end handler
      // when the LLM tries to issue further tool calls (stopReason === "toolUse").
    }
    if (event.type === "message_end") {
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
        activeModelResponse = null;
      }
      if (message?.role === "assistant" && Array.isArray(message.content)) {
        const hasToolCall = message.content.some((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "toolCall");
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

  let promptThrownError: string | null = null;
  try {
    heartbeatTrackedPhase(chatJid, "prompt", { eventType: "prompt_start" });
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
    finishPromptTimeout();
    toolExecutionWatchdogHeartbeat.stop();
    unsub();
  }

  const finalText = tracker.getFinalText();
  hadPartialOutput = hadPartialOutput || !!finalText;
  const finalAttachments = options.takeAttachments(chatJid);
  const timedOut = timedOutRef.value;
  const lastAssistantState = tracker.getLastAssistantState();
  const sawThinkingOnlyStop = Boolean(
    lastAssistantState?.stopReason === "stop"
      && lastAssistantState?.hadThinkingContent
      && !lastAssistantState?.hadTextContent
      && !lastAssistantState?.hadToolCallContent
  );
  const latentStateError = !finalText ? getSessionStateErrorMessage(session) : null;

  let output: AgentOutput;
  if (timedOut) {
    output = { status: "error", result: null, error: `Timed out after ${formatTimeoutDuration(timeoutMs)}` };
  } else if (toolUseBudgetExceeded && !finalText && finalAttachments.length === 0) {
    sawCompactionIntent = true;
    output = {
      status: "error",
      result: null,
      error: `Tool-use budget exceeded before finalization (${assistantToolUseMessageCount}/${toolUseMessageBudget} tool steps).`,
      toolBudgetExceeded: true,
      toolStepsUsed: assistantToolUseMessageCount,
      toolStepsBudget: toolUseMessageBudget,
    } as any;
  } else if (promptThrownError) {
    output = { status: "error", result: null, error: promptThrownError };
  } else {
    const turnError = tracker.getError();
    if (turnError) {
      output = { status: "error", result: null, error: turnError.errorMessage };
    } else if (latentStateError) {
      output = { status: "error", result: null, error: latentStateError };
    } else {
      const blankTurnDelta = inspectBlankTurnSessionDelta(session, sessionEntryBaseline);
      if (!finalText && finalAttachments.length === 0 && !hadCompletedTurnOutput) {
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
        // When the provider stopped cleanly after tool use with no other failure
        // signal, this is a tool-only completion — not an error worth alarming about.
        const isToolOnlyCompletion = hadToolActivity
          && !hadPartialOutput
          && !isBlankTurnSessionDelta(blankTurnDelta)
          && detail.includes("provider stopped after tool use");
        output = isToolOnlyCompletion
          ? {
            status: "tool_complete" as const,
            result: null,
            error: `Prompt completed without emitting an assistant reply before finalization (${detail}).`,
          }
          : {
            status: "error",
            result: null,
            error: `Prompt completed without emitting an assistant reply before finalization (${detail}).`,
          };

        // When context usage is above 60% of the model's window, flag
        // context pressure on the snapshot so recovery compacts first
        // instead of retrying into the same wall.
        try {
          const tokens = estimateContextTokensFromSession(session);
          const cw = getModelContextWindow(session) ?? DEFAULT_FALLBACK_CONTEXT_WINDOW;
          if (cw > 0 && tokens > cw * 0.6) {
            sawCompactionIntent = true;
          }
        } catch (err) { debugSuppressedError(log, "Failed to estimate context tokens for compaction heuristic; skipping pressure check.", err); }
      } else {
        output = {
          status: "success",
          result: finalText || null,
          attachments: finalAttachments.length ? finalAttachments : undefined,
        };
      }
    }
  }

  return {
    output,
    snapshot: {
      hadToolActivity,
      hadPartialOutput,
      hadCompletedTurnOutput,
      compactionErrorMessage,
      sawCompactionIntent,
      sawAssistantToolCall: sawAssistantToolCallMessage,
      sawThinkingOnlyStop,
      onlyReadOnlyToolActivity,
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
  const toolCallCapRef = { exceeded: false };
  let toolCallUnsub: (() => void) | undefined;
  type SessionWithToolControl = {
    setActiveToolsByName?: (toolNames: string[]) => void;
    getActiveToolNames?: () => string[];
  };
  let sessionCtrl: SessionWithToolControl | null = null;
  let savedToolNames: string[] | null = null;
  let originalSetActiveToolsByName: ((names: string[]) => void) | null = null;

  try {
    const runtime = await options.getOrCreateRuntime(chatJid);
    let session = runtime.session;
    session = await maybeAutoRotateSession(session, runtime, chatJid, options);
    modelLabel = session.model ? `${session.model.provider}/${session.model.id}` : null;
    updateSessionModel(chatJid, modelLabel, session.thinkingLevel ?? null);
    beginTrackedPhase(chatJid, runOptions.skipPrePromptCompaction ? "prompt" : "preprompt_compaction", {
      source: "run_agent",
    });
    if (!runOptions.skipPrePromptCompaction) {
      await maybeAutoCompactSessionBeforePrompt(session, chatJid, options, (event) => {
        if (event.type === "compaction_start") {
          heartbeatTrackedPhase(chatJid, "preprompt_compaction", { eventType: event.type });
        } else if (event.type === "compaction_end") {
          heartbeatTrackedPhase(chatJid, "prompt", { eventType: event.type });
        }
        runOptions.onEvent?.(event);
      });
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
      toolCallUnsub = session.subscribe((event) => {
        if (event.type === "tool_execution_end") {
          toolCallCount += 1;
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
    const strategyHistory: RecoveryStrategy[] = [];
    const recoveryDiagnostics: AgentRecoveryDiagnosticEntry[] = [];
    let recoveryBudgetStartedAt: number | null = null;
    const useWholeRunAsRecoveryBudget = timeoutMs > 0 && timeoutMs < baseRecoveryConfig.totalBudgetMs;
    const getRecoveryBudgetElapsedMs = () => {
      const anchor = recoveryBudgetStartedAt == null
        ? (useWholeRunAsRecoveryBudget ? startTime : Date.now())
        : recoveryBudgetStartedAt;
      return Math.max(0, Date.now() - anchor);
    };

    return await withChatContext(chatJid, channel, async () => {
      while (true) {
        const attempt = await runPromptAttempt(
          prompt,
          chatJid,
          session,
          timeoutMs,
          runOptions,
          options,
          startTime,
          modelLabel,
        );

        // If the tool-call cap was hit, abort immediately without recovery.
        if (toolCallCapRef.exceeded) {
          const duration = Date.now() - startTime;
          writeAgentLog(options.logsDir, chatJid, duration, false, null, "Tool call limit exceeded.");
          return { status: "error", result: null, error: "Tool call limit exceeded." };
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
          return attempt.output;
        }

        const errorText = attempt.output.error || "Agent error";
        const decision = decideAutomaticRecovery({
          config: recoveryConfig,
          errorText,
          recoveryAttemptsUsed,
          elapsedMs: getRecoveryBudgetElapsedMs(),
          snapshot: attempt.snapshot,
        });
        lastClassifier = decision.classifier;

        options.onWarn?.("Agent attempt failed", {
          operation: "run_agent.attempt_failed",
          chatJid,
          errorText,
          classifier: decision.classifier,
          recoveryAttemptsUsed,
          recoveryStrategy: decision.strategy,
          reason: decision.reason,
          ...getRunObservabilityDetails(runOptions),
        });

        recoveryDiagnostics.push(buildRecoveryDiagnosticEntry(
          "attempt_failure",
          recoveryAttemptsUsed + 1,
          decision.classifier,
          decision.strategy,
          decision.reason,
          errorText,
          Date.now() - startTime,
          attempt.snapshot,
        ));

        if (!decision.recover || !decision.strategy) {
          const duration = Date.now() - startTime;
          const recoveryMeta = recoveryAttemptsUsed > 0
            ? buildRecoveryMetadata(recoveryAttemptsUsed, duration, false, true, lastClassifier, strategyHistory, recoveryDiagnostics)
            : null;
          writeAgentLog(options.logsDir, chatJid, duration, false, null, errorText, recoveryMeta);
          if (recoveryAttemptsUsed > 0) {
            emitAgentSessionEvent(runOptions.onEvent, {
              type: "recovery_end",
              outcome: "exhausted",
              attemptsUsed: recoveryAttemptsUsed,
              classifier: decision.classifier,
              errorMessage: errorText,
            });
            attempt.output.recovery = buildRecoveryMetadata(
              recoveryAttemptsUsed,
              duration,
              false,
              true,
              lastClassifier,
              strategyHistory,
              recoveryDiagnostics,
            );
          }
          return attempt.output;
        }

        if (recoveryBudgetStartedAt == null) {
          recoveryBudgetStartedAt = Date.now();
        }

        recoveryAttemptsUsed += 1;
        strategyHistory.push(decision.strategy);
        const retryDelayMs = decision.strategy === "retry"
          ? getAutomaticRecoveryDelayMs(recoveryConfig, recoveryAttemptsUsed)
          : 0;
        heartbeatTrackedPhase(chatJid, "recovery", {
          eventType: "recovery_start",
          attempt: recoveryAttemptsUsed,
        });
        emitAgentSessionEvent(runOptions.onEvent, {
          type: "recovery_start",
          classifier: decision.classifier,
          strategy: decision.strategy,
          attempt: recoveryAttemptsUsed,
          maxAttempts: recoveryConfig.maxAttempts,
          totalBudgetMs: recoveryConfig.totalBudgetMs,
          delayMs: retryDelayMs,
          reason: decision.classifier === "unknown" && errorText
            ? `${decision.reason} Error: ${errorText}`
            : decision.reason,
          errorMessage: errorText,
        });

        if (retryDelayMs > 0) {
          heartbeatTrackedPhase(chatJid, "recovery", {
            eventType: "recovery_delay",
            delayMs: retryDelayMs,
          });
          await sleep(retryDelayMs);
        }

        if (decision.strategy === "compact_then_retry") {
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
    options.clearActiveForkBaseLeaf(chatJid);
  }
}
