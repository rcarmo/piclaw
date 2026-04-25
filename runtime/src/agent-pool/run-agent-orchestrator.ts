/**
 * agent-pool/run-agent-orchestrator.ts – Main runAgent prompt lifecycle orchestration.
 */

import { type AgentSession, type AgentSessionEvent, type AgentSessionRuntime } from "@mariozechner/pi-coding-agent";

import type { AttachmentInfo } from "./attachments.js";

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
  inspectBlankTurnSessionDelta,
  isBlankTurnSessionDelta,
  snapshotSessionEntryCount,
} from "./blank-turn-detection.js";
import type { AgentTurnCoordinator } from "./turn-coordinator.js";
import type { AgentOutput, AgentRecoveryDiagnosticEntry, AgentRecoveryMetadata, RetrySettingsProvider, RunAgentOptions } from "./contracts.js";

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

function estimateMessageTokens(message: any): number {
  if (!message || typeof message !== "object") return 0;

  const countText = (value: unknown): number => {
    if (typeof value === "string") return value.length;
    if (!Array.isArray(value)) return 0;
    let chars = 0;
    for (const block of value) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string") chars += block.text.length;
      if (block.type === "thinking" && typeof block.thinking === "string") chars += block.thinking.length;
      if (block.type === "toolCall") {
        chars += typeof block.name === "string" ? block.name.length : 0;
        if (block.arguments !== undefined) chars += JSON.stringify(block.arguments).length;
      }
      if (block.type === "image") chars += 4800;
    }
    return chars;
  };

  switch (message.role) {
    case "assistant":
    case "custom":
    case "toolResult":
      return Math.ceil(countText(message.content) / 4);
    case "user":
      return Math.ceil(countText(message.content) / 4);
    case "bashExecution": {
      const chars = (typeof message.command === "string" ? message.command.length : 0)
        + (typeof message.output === "string" ? message.output.length : 0);
      return Math.ceil(chars / 4);
    }
    case "branchSummary":
    case "compactionSummary":
      return Math.ceil(((typeof message.summary === "string" ? message.summary.length : 0)) / 4);
    default:
      return 0;
  }
}

function estimateContextTokensFromSession(session: AgentSession): number {
  const usage = session.getContextUsage?.();
  if (typeof usage?.tokens === "number") return usage.tokens;

  const context = session.sessionManager.buildSessionContext();
  return context.messages.reduce((total: number, message: any) => total + estimateMessageTokens(message), 0);
}

/** Fallback context window when the model does not report one.
 *  Conservative enough to trigger compaction before most models overflow. */
const DEFAULT_FALLBACK_CONTEXT_WINDOW = 128_000;

function getModelContextWindow(session: AgentSession): number | null {
  const model = session.model as (AgentSession["model"] & { contextLength?: number }) | undefined;
  const contextWindow = typeof model?.contextWindow === "number"
    ? model.contextWindow
    : typeof model?.contextLength === "number"
      ? model.contextLength
      : null;
  if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }
  return contextWindow;
}

function getSessionStateErrorMessage(session: AgentSession): string | null {
  const errorMessage = (session as AgentSession & {
    agent?: { state?: { errorMessage?: unknown } };
  }).agent?.state?.errorMessage;
  return typeof errorMessage === "string" && errorMessage.trim() ? errorMessage.trim() : null;
}

const DEFAULT_COMPACTION_TIMEOUT_MS = 180_000;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCompactionTimeoutMs(): number {
  return parsePositiveInt(process.env.PICLAW_COMPACTION_TIMEOUT_MS, DEFAULT_COMPACTION_TIMEOUT_MS);
}

async function abortCompactionBestEffort(
  session: AgentSession,
  chatJid: string,
  options: Pick<RunAgentOrchestratorOptions, "onWarn">,
): Promise<void> {
  try {
    const compactingSession = session as AgentSession & {
      abortCompaction?: () => void;
      abort?: () => Promise<void>;
    };
    if (typeof compactingSession.abortCompaction === "function" && session.isCompacting) {
      compactingSession.abortCompaction();
      return;
    }
    if (typeof compactingSession.abort === "function") {
      await compactingSession.abort();
    }
  } catch (error) {
    options.onWarn?.("Failed to abort stuck compaction", {
      operation: "run_agent.abort_stuck_compaction",
      chatJid,
      err: error,
    });
  }
}

async function runCompactionWithTimeout(
  session: AgentSession,
  chatJid: string,
  options: Pick<RunAgentOrchestratorOptions, "onWarn">,
  runCompact: () => Promise<unknown>,
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  const timeoutMs = getCompactionTimeoutMs();
  if (timeoutMs <= 0) {
    try {
      await runCompact();
      return { ok: true };
    } catch (error) {
      return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) };
    }
  }

  const compactionOutcome = new Promise<{ ok: true } | { ok: false; errorMessage: string }>((resolve) => {
    void Promise.resolve()
      .then(() => runCompact())
      .then(() => resolve({ ok: true }))
      .catch((error) => resolve({
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      }));
  });

  const timedOut = Symbol("compaction-timeout");
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutOutcome = new Promise<typeof timedOut>((resolve) => {
    timeoutId = setTimeout(() => resolve(timedOut), timeoutMs);
  });

  const outcome = await Promise.race([compactionOutcome, timeoutOutcome]);
  if (timeoutId) clearTimeout(timeoutId);
  if (outcome !== timedOut) {
    return outcome;
  }

  await abortCompactionBestEffort(session, chatJid, options);
  return {
    ok: false,
    errorMessage: `Compaction timed out after ${formatTimeoutDuration(timeoutMs)}`,
  };
}

async function maybeAutoCompactSessionBeforePrompt(
  session: AgentSession,
  chatJid: string,
  options: Pick<RunAgentOrchestratorOptions, "onInfo" | "onWarn">,
  onEvent?: (event: AgentSessionEvent) => void,
): Promise<void> {
  if (session.isStreaming || session.isCompacting || session.isRetrying) return;
  const reportedContextWindow = getModelContextWindow(session);
  const contextWindow = reportedContextWindow ?? DEFAULT_FALLBACK_CONTEXT_WINDOW;
  if (!reportedContextWindow) {
    options.onWarn?.("Model does not report contextWindow; using fallback for pre-prompt compaction", {
      operation: "maybe_auto_compact_session_before_prompt.fallback_context_window",
      chatJid,
      fallbackContextWindow: DEFAULT_FALLBACK_CONTEXT_WINDOW,
      modelId: (session.model as any)?.id ?? null,
      provider: (session.model as any)?.provider ?? null,
    });
  }

  const settingsManager = (session as AgentSession & {
    settingsManager?: { getCompactionSettings?: () => { enabled?: boolean; reserveTokens?: number } };
  }).settingsManager;
  const settings = typeof settingsManager?.getCompactionSettings === "function"
    ? settingsManager.getCompactionSettings()
    : null;
  // Piclaw manages compaction at safe pre-prompt boundaries regardless of
  // upstream auto-compaction being disabled.  Only bail when there is no
  // settings object at all (no model / no session).
  if (!settings) return;

  try {
    const contextTokens = estimateContextTokensFromSession(session);
    // Inline threshold check — bypasses upstream settings.enabled flag since
    // piclaw disables upstream auto-compaction and owns the compaction schedule.
    const reserveTokens = settings.reserveTokens ?? 16384;
    if (contextTokens <= contextWindow - reserveTokens) return;

    options.onInfo?.("Auto-compacting session before prompt", {
      operation: "maybe_auto_compact_session_before_prompt",
      chatJid,
      contextTokens,
      contextWindow,
      reserveTokens: settings.reserveTokens ?? null,
    });

    // Upstream 0.67.6 removed compaction_start/end events from the manual
    // compact() path. Emit them locally so the web UI still shows the
    // "Compacting context" status pill during what can be a 30-60s operation.
    onEvent?.({ type: "compaction_start", reason: "threshold" } as AgentSessionEvent);
    const compactionResult = await runCompactionWithTimeout(
      session,
      chatJid,
      options,
      async () => await session.compact(),
    );
    if (!compactionResult.ok) {
      const aborted = /compaction cancelled|aborterror/i.test(compactionResult.errorMessage);
      onEvent?.({
        type: "compaction_end",
        reason: "threshold",
        result: undefined,
        aborted,
        willRetry: false,
        errorMessage: aborted ? undefined : `Pre-prompt compaction failed: ${compactionResult.errorMessage}`,
      } as AgentSessionEvent);
      throw new Error(compactionResult.errorMessage);
    }
    onEvent?.({
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
    } as AgentSessionEvent);
  } catch (error) {
    options.onWarn?.("Pre-prompt auto-compaction skipped", {
      operation: "maybe_auto_compact_session_before_prompt",
      chatJid,
      error,
    });
  }
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
  let toolUseBudgetExceeded = false;
  const sessionEntryBaseline = snapshotSessionEntryCount(session);
  const toolUseMessageBudget = getToolUseMessageBudget();

  const originalOnTurnComplete = runOptions.onTurnComplete;
  const onTurnComplete = originalOnTurnComplete
    ? ((turn: { text: string; attachments: AttachmentInfo[] }) => {
        hadCompletedTurnOutput = hadCompletedTurnOutput || !!(turn.text || turn.attachments.length > 0);
        originalOnTurnComplete(turn);
      })
    : undefined;

  const tracker = options.turnCoordinator.createTracker(chatJid, onTurnComplete);
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
      const messageEvent = (event as { assistantMessageEvent?: { type?: string; delta?: string } }).assistantMessageEvent;
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
    }
    if (event.type === "message_end") {
      const message = (event as { message?: { role?: unknown; content?: unknown; stopReason?: unknown } }).message;
      if (message?.role === "assistant" && Array.isArray(message.content)) {
        const hasToolCall = message.content.some((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "toolCall");
        sawAssistantToolCallMessage = sawAssistantToolCallMessage || hasToolCall;
        if (hasToolCall && message.stopReason === "toolUse") {
          assistantToolUseMessageCount += 1;
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
    await session.prompt(prompt);
    finishPromptTimeout();
    options.onInfo?.("session.prompt() resolved", {
      operation: "run_agent.prompt_resolved",
      chatJid,
      promptDurationMs: Date.now() - totalRunStartedAt,
      sessionIsStreaming: Boolean(session.isStreaming),
      sessionIsCompacting: Boolean(session.isCompacting),
      sessionIsRetrying: Boolean(session.isRetrying),
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
    unsub();
  }

  const finalText = tracker.getFinalText();
  hadPartialOutput = hadPartialOutput || !!finalText;
  const finalAttachments = options.takeAttachments(chatJid);
  const timedOut = timedOutRef.value;
  const lastAssistantState = tracker.getLastAssistantState();
  const latentStateError = !finalText ? getSessionStateErrorMessage(session) : null;

  let output: AgentOutput;
  if (timedOut) {
    output = { status: "error", result: null, error: `Timed out after ${formatTimeoutDuration(timeoutMs)}` };
  } else if (toolUseBudgetExceeded && !finalText && finalAttachments.length === 0) {
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
          });
        }
        // When the provider stopped cleanly after tool use with no other failure
        // signal, this is a tool-only completion — not an error worth alarming about.
        const isToolOnlyCompletion = hadToolActivity
          && !hadPartialOutput
          && !blankTurnDelta
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
      onlyReadOnlyToolActivity,
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
    await maybeAutoCompactSessionBeforePrompt(session, chatJid, options, runOptions.onEvent);
    pruneOrphanToolResults(session, chatJid);
    const forkBaseLeafId = typeof session.sessionManager?.getLeafId === "function"
      ? session.sessionManager.getLeafId()
      : null;
    options.setActiveForkBaseLeaf(chatJid, forkBaseLeafId ?? null);
    options.onInfo?.("Prompting session", {
      operation: "run_agent.prompt",
      chatJid,
      promptLength: prompt.length,
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
            durationMs: duration,
            outputChars: finalText?.length ?? 0,
            recoveryAttemptsUsed,
            recovered: recoveryAttemptsUsed > 0,
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
        emitAgentSessionEvent(runOptions.onEvent, {
          type: "recovery_start",
          classifier: decision.classifier,
          strategy: decision.strategy,
          attempt: recoveryAttemptsUsed,
          maxAttempts: recoveryConfig.maxAttempts,
          totalBudgetMs: recoveryConfig.totalBudgetMs,
          delayMs: retryDelayMs,
          reason: decision.reason,
        });

        if (retryDelayMs > 0) {
          await sleep(retryDelayMs);
        }

        if (decision.strategy === "compact_then_retry") {
          const compactionResult = await runRecoveryCompaction(session, chatJid, runOptions, options);
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
      durationMs: duration,
      errorMessage: errorMsg,
      err,
    });
    return { status: "error", result: null, error: errorMsg };
  } finally {
    toolCallUnsub?.();
    if (sessionCtrl && savedToolNames !== null && originalSetActiveToolsByName) {
      sessionCtrl.setActiveToolsByName = originalSetActiveToolsByName;
      originalSetActiveToolsByName(savedToolNames);
    }
    options.clearActiveForkBaseLeaf(chatJid);
  }
}
