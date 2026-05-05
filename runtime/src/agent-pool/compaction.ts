/**
 * agent-pool/compaction.ts – Shared compaction helpers for orchestrated and manual compaction paths.
 */

import { type AgentSession, type AgentSessionEvent } from "@mariozechner/pi-coding-agent";

import { getCompactionRuntimeConfig } from "../core/config.js";
import {
  clearChatCompactionActive,
  clearChatCompactionBackoff,
  getChatCompactionBackoff,
  markChatCompactionActive,
  setChatCompactionBackoff,
  type ChatCompactionBackoffState,
} from "../db.js";
import { formatTimeoutDuration } from "./prompt-utils.js";
import { updateSessionCompacting } from "../extensions/session-status.js";

export interface CompactionLifecycleOptions {
  onInfo?: (message: string, details: Record<string, unknown>) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
}

const DEFAULT_IDLE_AUTO_COMPACTION_DELAY_MS = 5_000;
const idleAutoCompactionTimers = new Map<string, ReturnType<typeof setTimeout>>();

type CompactionOutcome<T> = { ok: true; result: T } | { ok: false; errorMessage: string };
type ActiveCompaction = { outcome: Promise<CompactionOutcome<unknown>> };

const activeCompactions = new Map<string, ActiveCompaction>();

type AutoCompactionReason = "threshold" | "idle";

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

export function estimateContextTokensFromSession(session: AgentSession): number {
  const context = session.sessionManager.buildSessionContext();
  const hasCompactionSummary = context.messages.some((message: any) => message?.role === "compactionSummary");

  // Assistant usage metadata is scoped to the prompt that produced that
  // assistant message. After a compaction, kept assistant messages can still
  // carry pre-compaction usage totals, so trusting getContextUsage()/last usage
  // makes the freshly compacted context look huge and triggers repeated idle
  // compactions. Once a compacted summary is present, estimate the resolved
  // compacted context directly from the messages instead.
  if (!hasCompactionSummary) {
    const usage = session.getContextUsage?.();
    if (typeof usage?.tokens === "number") return usage.tokens;
  }

  return context.messages.reduce((total: number, message: any) => total + estimateMessageTokens(message), 0);
}

/** Fallback context window when the model does not report one.
 *  Conservative enough to trigger compaction before most models overflow. */
// ── Per-session compaction counter for auto-rotation ──
const compactionSuccessCounters = new Map<string, number>();

export function getCompactionSuccessCount(chatJid: string): number {
  return compactionSuccessCounters.get(chatJid) ?? 0;
}

export function resetCompactionSuccessCount(chatJid: string): void {
  compactionSuccessCounters.delete(chatJid);
}

export const DEFAULT_FALLBACK_CONTEXT_WINDOW = 128_000;

export function getModelContextWindow(session: AgentSession): number | null {
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

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function getIdleAutoCompactionDelayMs(): number {
  return parseNonNegativeInt(process.env.PICLAW_IDLE_AUTO_COMPACTION_DELAY_MS, DEFAULT_IDLE_AUTO_COMPACTION_DELAY_MS);
}

function getCompactionBackoffBaseMs(): number {
  return getCompactionRuntimeConfig().backoffBaseMs;
}

function getCompactionBackoffMaxMs(): number {
  return getCompactionRuntimeConfig().backoffMaxMs;
}

function computeCompactionBackoffMs(failureCount: number): number {
  const normalizedFailures = Math.max(1, Math.trunc(failureCount));
  const baseMs = getCompactionBackoffBaseMs();
  const maxMs = getCompactionBackoffMaxMs();
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, normalizedFailures - 1));
}

function formatCompactionBackoffDetail(state: Pick<ChatCompactionBackoffState, "failureCount" | "backoffUntil" | "lastErrorMessage">): string {
  const parts = [
    `Skipping auto-compaction until ${state.backoffUntil}`,
    `${state.failureCount} recent failure${state.failureCount === 1 ? "" : "s"}`,
  ];
  if (state.lastErrorMessage) {
    parts.push(`Last error: ${state.lastErrorMessage.slice(0, 160)}`);
  }
  return parts.join(" — ");
}

export function getActiveCompactionBackoff(chatJid: string, nowMs = Date.now()): ChatCompactionBackoffState | null {
  const state = getChatCompactionBackoff(chatJid);
  if (!state) return null;
  const untilMs = Date.parse(state.backoffUntil);
  if (!Number.isFinite(untilMs) || untilMs <= nowMs) return null;
  return state;
}

export function clearCompactionFailureBackoff(chatJid: string): void {
  clearChatCompactionBackoff(chatJid);
}

export function noteCompactionFailure(chatJid: string, errorMessage: string, failedAtIso = new Date().toISOString()): ChatCompactionBackoffState {
  const previous = getChatCompactionBackoff(chatJid);
  const failureCount = (previous?.failureCount ?? 0) + 1;
  const failedAtMs = Date.parse(failedAtIso);
  const backoffMs = computeCompactionBackoffMs(failureCount);
  const backoffUntil = new Date((Number.isFinite(failedAtMs) ? failedAtMs : Date.now()) + backoffMs).toISOString();
  const nextState: ChatCompactionBackoffState = {
    chatJid,
    failureCount,
    lastFailedAt: failedAtIso,
    backoffUntil,
    lastErrorMessage: errorMessage || null,
  };
  setChatCompactionBackoff(chatJid, nextState);
  return nextState;
}

export function getCompactionTimeoutMs(): number {
  return getCompactionRuntimeConfig().timeoutMs;
}

export async function abortCompactionBestEffort(
  session: AgentSession,
  chatJid: string,
  options: Pick<CompactionLifecycleOptions, "onWarn">,
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

export async function runCompactionWithTimeout<T>(
  session: AgentSession,
  chatJid: string,
  options: Pick<CompactionLifecycleOptions, "onWarn">,
  runCompact: () => Promise<T>,
  reason = "manual",
): Promise<CompactionOutcome<T>> {
  const existing = activeCompactions.get(chatJid);
  if (existing) {
    options.onWarn?.("Compaction already in progress; joining existing compaction", {
      operation: "run_agent.join_active_compaction",
      chatJid,
    });
    return await existing.outcome as CompactionOutcome<T>;
  }

  const active: ActiveCompaction = { outcome: Promise.resolve({ ok: false, errorMessage: "Compaction did not start" }) };
  const clearActive = () => {
    if (activeCompactions.get(chatJid) === active) activeCompactions.delete(chatJid);
  };
  const outcome = runCompactionWithTimeoutExclusive(session, chatJid, options, runCompact, clearActive, reason);
  active.outcome = outcome as Promise<CompactionOutcome<unknown>>;
  activeCompactions.set(chatJid, active);
  return await outcome;
}

async function runCompactionWithTimeoutExclusive<T>(
  session: AgentSession,
  chatJid: string,
  options: Pick<CompactionLifecycleOptions, "onWarn">,
  runCompact: () => Promise<T>,
  clearActive: () => void,
  reason: string,
): Promise<CompactionOutcome<T>> {
  const timeoutMs = getCompactionTimeoutMs();
  updateSessionCompacting(chatJid, true);
  markChatCompactionActive(chatJid, new Date().toISOString(), reason);
  if (timeoutMs <= 0) {
    try {
      return { ok: true, result: await runCompact() };
    } catch (error) {
      return { ok: false, errorMessage: error instanceof Error ? error.message : String(error) };
    } finally {
      updateSessionCompacting(chatJid, false);
      clearChatCompactionActive(chatJid);
      clearActive();
    }
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const compactionOutcome = Promise.resolve()
    .then(() => runCompact())
    .then((result): CompactionOutcome<T> => ({ ok: true, result }))
    .catch((error): CompactionOutcome<T> => ({
      ok: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
      updateSessionCompacting(chatJid, false);
      clearChatCompactionActive(chatJid);
      clearActive();
    });

  const timedOut = Symbol("compaction-timeout");
  const timeoutOutcome = new Promise<typeof timedOut>((resolve) => {
    timeoutId = setTimeout(() => resolve(timedOut), timeoutMs);
  });

  const outcome = await Promise.race([compactionOutcome, timeoutOutcome]);
  if (outcome !== timedOut) {
    return outcome;
  }

  await abortCompactionBestEffort(session, chatJid, options);
  updateSessionCompacting(chatJid, false);
  clearChatCompactionActive(chatJid);
  return {
    ok: false,
    errorMessage: `Compaction timed out after ${formatTimeoutDuration(timeoutMs)}`,
  };
}

function getAutoCompactionContext(session: AgentSession, chatJid: string, options: Pick<CompactionLifecycleOptions, "onWarn">, reason: AutoCompactionReason): {
  contextTokens: number;
  contextWindow: number;
  reserveTokens: number;
} | null {
  if (session.isStreaming || session.isCompacting || session.isRetrying) return null;
  const reportedContextWindow = getModelContextWindow(session);
  const contextWindow = reportedContextWindow ?? DEFAULT_FALLBACK_CONTEXT_WINDOW;
  if (!reportedContextWindow) {
    options.onWarn?.(
      reason === "idle"
        ? "Model does not report contextWindow; using fallback for idle compaction"
        : "Model does not report contextWindow; using fallback for pre-prompt compaction",
      {
        operation: reason === "idle"
          ? "schedule_idle_auto_compaction.fallback_context_window"
          : "maybe_auto_compact_session_before_prompt.fallback_context_window",
        chatJid,
        fallbackContextWindow: DEFAULT_FALLBACK_CONTEXT_WINDOW,
        modelId: (session.model as any)?.id ?? null,
        provider: (session.model as any)?.provider ?? null,
      },
    );
  }

  const settingsManager = (session as AgentSession & {
    settingsManager?: { getCompactionSettings?: () => { enabled?: boolean; reserveTokens?: number } };
  }).settingsManager;
  const settings = typeof settingsManager?.getCompactionSettings === "function"
    ? settingsManager.getCompactionSettings()
    : null;
  if (!settings) return null;

  const contextTokens = estimateContextTokensFromSession(session);
  const compactionConfig = getCompactionRuntimeConfig();
  const thresholdTokens = Math.floor(contextWindow * (compactionConfig.thresholdPercent / 100));
  const reserveTokens = contextWindow - thresholdTokens;
  if (contextTokens <= thresholdTokens) return null;

  return { contextTokens, contextWindow, reserveTokens };
}

async function maybeAutoCompactSession(
  session: AgentSession,
  chatJid: string,
  options: Pick<CompactionLifecycleOptions, "onInfo" | "onWarn">,
  onEvent: ((event: AgentSessionEvent) => void) | undefined,
  reason: AutoCompactionReason,
): Promise<void> {
  const context = getAutoCompactionContext(session, chatJid, options, reason);
  if (!context) return;

  try {
    const activeBackoff = getActiveCompactionBackoff(chatJid);
    if (activeBackoff) {
      const detail = formatCompactionBackoffDetail(activeBackoff);
      options.onWarn?.(
        reason === "idle"
          ? "Idle auto-compaction suppressed for chat after recent failures"
          : "Pre-prompt auto-compaction suppressed for chat after recent failures",
        {
          operation: reason === "idle"
            ? "schedule_idle_auto_compaction.backoff"
            : "maybe_auto_compact_session_before_prompt.backoff",
          chatJid,
          contextTokens: context.contextTokens,
          contextWindow: context.contextWindow,
          reserveTokens: context.reserveTokens,
          failureCount: activeBackoff.failureCount,
          backoffUntil: activeBackoff.backoffUntil,
          lastErrorMessage: activeBackoff.lastErrorMessage,
        },
      );
      onEvent?.({
        type: "compaction_suppressed",
        reason: "backoff",
        until: activeBackoff.backoffUntil,
        failureCount: activeBackoff.failureCount,
        detail,
        errorMessage: activeBackoff.lastErrorMessage ?? undefined,
      } as unknown as AgentSessionEvent);
      return;
    }

    options.onInfo?.(
      reason === "idle"
        ? "Auto-compacting idle session after turn"
        : "Auto-compacting session before prompt",
      {
        operation: reason === "idle"
          ? "schedule_idle_auto_compaction"
          : "maybe_auto_compact_session_before_prompt",
        chatJid,
        contextTokens: context.contextTokens,
        contextWindow: context.contextWindow,
        reserveTokens: context.reserveTokens,
      },
    );

    onEvent?.({ type: "compaction_start", reason } as AgentSessionEvent);
    const compactionResult = await runCompactionWithTimeout(
      session,
      chatJid,
      options,
      async () => await session.compact(),
      reason,
    );
    if (!compactionResult.ok) {
      const failureState = noteCompactionFailure(chatJid, compactionResult.errorMessage);
      const aborted = /compaction cancelled|aborterror/i.test(compactionResult.errorMessage);
      onEvent?.({
        type: "compaction_end",
        reason,
        result: undefined,
        aborted,
        willRetry: false,
        errorMessage: aborted
          ? undefined
          : `${reason === "idle" ? "Idle compaction failed" : "Pre-prompt compaction failed"}: ${compactionResult.errorMessage}`,
      } as AgentSessionEvent);
      options.onWarn?.(
        reason === "idle"
          ? "Idle auto-compaction entered backoff for this chat"
          : "Pre-prompt auto-compaction entered backoff for this chat",
        {
          operation: reason === "idle"
            ? "schedule_idle_auto_compaction.backoff_recorded"
            : "maybe_auto_compact_session_before_prompt.backoff_recorded",
          chatJid,
          failureCount: failureState.failureCount,
          backoffUntil: failureState.backoffUntil,
          lastErrorMessage: failureState.lastErrorMessage,
        },
      );
      throw new Error(compactionResult.errorMessage);
    }
    clearCompactionFailureBackoff(chatJid);
    // Increment per-session compaction success counter
    const prevCount = compactionSuccessCounters.get(chatJid) ?? 0;
    compactionSuccessCounters.set(chatJid, prevCount + 1);
    options.onInfo?.("Compaction success count incremented", {
      operation: reason === "idle" ? "schedule_idle_auto_compaction.counter" : "maybe_auto_compact_session_before_prompt.counter",
      chatJid,
      compactionCount: prevCount + 1,
    });
    onEvent?.({
      type: "compaction_end",
      reason,
      result: undefined,
      aborted: false,
      willRetry: false,
    } as AgentSessionEvent);
  } catch (error) {
    options.onWarn?.(
      reason === "idle" ? "Idle auto-compaction skipped" : "Pre-prompt auto-compaction skipped",
      {
        operation: reason === "idle"
          ? "schedule_idle_auto_compaction"
          : "maybe_auto_compact_session_before_prompt",
        chatJid,
        error,
      },
    );
  }
}

export function cancelScheduledIdleAutoCompaction(chatJid: string): void {
  const pending = idleAutoCompactionTimers.get(chatJid);
  if (!pending) return;
  clearTimeout(pending);
  idleAutoCompactionTimers.delete(chatJid);
}

export function scheduleIdleAutoCompaction(
  session: AgentSession,
  chatJid: string,
  options: Pick<CompactionLifecycleOptions, "onInfo" | "onWarn">,
  onEvent?: (event: AgentSessionEvent) => void,
): void {
  cancelScheduledIdleAutoCompaction(chatJid);
  if (!getAutoCompactionContext(session, chatJid, options, "idle")) return;

  const delayMs = getIdleAutoCompactionDelayMs();
  const timer = setTimeout(() => {
    idleAutoCompactionTimers.delete(chatJid);
    void maybeAutoCompactSession(session, chatJid, options, onEvent, "idle");
  }, delayMs);
  idleAutoCompactionTimers.set(chatJid, timer);
}

export async function maybeAutoCompactSessionBeforePrompt(
  session: AgentSession,
  chatJid: string,
  options: Pick<CompactionLifecycleOptions, "onInfo" | "onWarn">,
  onEvent?: (event: AgentSessionEvent) => void,
): Promise<void> {
  cancelScheduledIdleAutoCompaction(chatJid);
  await maybeAutoCompactSession(session, chatJid, options, onEvent, "threshold");
}
