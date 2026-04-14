/**
 * agent-pool/run-agent-orchestrator.ts – Main runAgent prompt lifecycle orchestration.
 */

import { shouldCompact, type AgentSession, type AgentSessionRuntime } from "@mariozechner/pi-coding-agent";

import type { AttachmentInfo } from "./attachments.js";

import { getAgentRuntimeConfig, getSessionStorageConfig } from "../core/config.js";
import { detectChannel } from "../router.js";
import { pruneOrphanToolResults } from "./orphan-tool-results.js";
import { writeAgentLog } from "./logging.js";
import { getSessionFileSize, rotateSession } from "../session-rotation.js";
import { withChatContext } from "../core/chat-context.js";
import { formatTimeoutDuration, waitForSessionIdle } from "./prompt-utils.js";
import type { AgentTurnCoordinator } from "./turn-coordinator.js";
import type { AgentOutput, RunAgentOptions } from "./contracts.js";

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

async function maybeAutoRotateSession(
  session: AgentSession,
  runtime: AgentSessionRuntime,
  chatJid: string,
  options: Pick<RunAgentOrchestratorOptions, "onInfo" | "onWarn">,
): Promise<void> {
  const sessionStorageConfig = getSessionStorageConfig();
  const autoRotateEnabled = sessionStorageConfig.autoRotate
    || ["1", "true", "yes", "on"].includes((process.env.PICLAW_SESSION_AUTO_ROTATE || "").trim().toLowerCase());
  if (!autoRotateEnabled) return;

  const envThresholdMb = parseInt(process.env.PICLAW_SESSION_MAX_SIZE_MB || "", 10);
  const thresholdBytes = Number.isFinite(envThresholdMb) && envThresholdMb > 0
    ? envThresholdMb * 1024 * 1024
    : sessionStorageConfig.maxSizeBytes;

  const sessionFileSize = getSessionFileSize(session.sessionFile);
  if (sessionFileSize === null || sessionFileSize < thresholdBytes) return;

  const result = await rotateSession(session, runtime, { reason: "automatic" });
  if (result.status === "success") {
    options.onInfo?.("Auto-rotated oversized session", {
      operation: "maybe_auto_rotate_session",
      chatJid,
      previousSize: result.previousSize ?? sessionFileSize,
      nextSize: result.nextSize ?? "unknown",
    });
    return;
  }

  options.onWarn?.("Auto-rotation skipped", {
    operation: "maybe_auto_rotate_session",
    chatJid,
    reason: result.message,
  });
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

async function maybeAutoCompactSessionBeforePrompt(
  session: AgentSession,
  chatJid: string,
  options: Pick<RunAgentOrchestratorOptions, "onInfo" | "onWarn">,
): Promise<void> {
  if (session.isStreaming || session.isCompacting || session.isRetrying) return;
  const contextWindow = getModelContextWindow(session);
  if (contextWindow == null) return;

  const settingsManager = (session as AgentSession & {
    settingsManager?: { getCompactionSettings?: () => { enabled?: boolean; reserveTokens?: number } };
  }).settingsManager;
  const settings = typeof settingsManager?.getCompactionSettings === "function"
    ? settingsManager.getCompactionSettings()
    : null;
  if (!settings?.enabled) return;

  try {
    const contextTokens = estimateContextTokensFromSession(session);
    if (!shouldCompact(contextTokens, contextWindow, settings)) return;

    options.onInfo?.("Auto-compacting session before prompt", {
      operation: "maybe_auto_compact_session_before_prompt",
      chatJid,
      contextTokens,
      contextWindow,
      reserveTokens: settings.reserveTokens ?? null,
    });
    await session.compact();
  } catch (error) {
    options.onWarn?.("Pre-prompt auto-compaction skipped", {
      operation: "maybe_auto_compact_session_before_prompt",
      chatJid,
      error,
    });
  }
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

  try {
    const runtime = await options.getOrCreateRuntime(chatJid);
    const session = runtime.session;
    await maybeAutoRotateSession(session, runtime, chatJid, options);
    await maybeAutoCompactSessionBeforePrompt(session, chatJid, options);
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

    const tracker = options.turnCoordinator.createTracker(chatJid, runOptions.onTurnComplete);
    const unsub = options.turnCoordinator.subscribe(session, chatJid, tracker, runOptions.onEvent);
    const timeoutMs = typeof runOptions.timeoutMs === "number" ? runOptions.timeoutMs : getAgentRuntimeConfig().timeoutMs;
    const { timeoutId, timedOutRef } = options.turnCoordinator.startPromptTimeout(session, chatJid, timeoutMs);

    const channel = detectChannel(chatJid);
    return await withChatContext(chatJid, channel, async () => {
      try {
        await session.prompt(prompt);
        await waitForSessionIdle(session);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        unsub();
      }

      const duration = Date.now() - startTime;
      const finalText = tracker.getFinalText();
      const finalAttachments = options.takeAttachments(chatJid);
      const timedOut = timedOutRef.value;
      const latentStateError = !finalText ? getSessionStateErrorMessage(session) : null;
      writeAgentLog(options.logsDir, chatJid, duration, timedOut, finalText, latentStateError);

      if (timedOut) {
        return { status: "error", result: null, error: `Timed out after ${formatTimeoutDuration(timeoutMs)}` };
      }

      const turnError = tracker.getError();
      if (turnError) {
        return { status: "error", result: null, error: turnError.errorMessage };
      }

      if (latentStateError) {
        return { status: "error", result: null, error: latentStateError };
      }

      options.onInfo?.("Agent run completed", {
        operation: "run_agent.complete",
        chatJid,
        durationMs: duration,
        outputChars: finalText.length,
        turns: tracker.getTurnCount() + 1,
      });
      return {
        status: "success",
        result: finalText || null,
        attachments: finalAttachments.length ? finalAttachments : undefined,
      };
    });
  } catch (err) {
    options.clearAttachments(chatJid);
    const duration = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    writeAgentLog(options.logsDir, chatJid, duration, false, null, errorMsg);
    options.onError?.("Agent run failed", {
      operation: "run_agent",
      chatJid,
      durationMs: duration,
      errorMessage: errorMsg,
      err,
    });
    return { status: "error", result: null, error: errorMsg };
  } finally {
    options.clearActiveForkBaseLeaf(chatJid);
  }
}
