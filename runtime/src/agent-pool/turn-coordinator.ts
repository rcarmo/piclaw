/**
 * agent-pool/turn-coordinator.ts – Tracks streaming turns and prompt lifecycle helpers.
 *
 * Extracts turn aggregation, session subscription wiring, and prompt timeout
 * handling out of AgentPool so prompt orchestration can stay focused on the
 * higher-level run flow.
 */

import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { Usage } from "@earendil-works/pi-ai";

import type { AttachmentInfo } from "./attachments.js";
import { recordAgentAbortCause } from "./abort-provenance.js";
import type { GoalDeadlineCheckpointEvidence, GoalDeadlineCheckpointLatch } from "./contracts.js";

interface AgentContentBlock {
  type?: unknown;
  text?: unknown;
  textSignature?: unknown;
}

type AssistantTextPhase = "commentary" | "final_answer" | null;

/** A single turn's output within a multi-turn agent run. */
export interface AgentTurnOutput {
  text: string;
  attachments: AttachmentInfo[];
  usage?: Usage;
  /** The completed assistant message committed immediately before tool dispatch. */
  followedByToolUse?: boolean;
}

/** A completed assistant text stream intentionally kept out of durable output. */
export interface AgentTurnDiscard {
  reason: "tool_use_commentary" | "commentary_only";
}

/** Error state captured from an assistant message with stopReason "error". */
export interface AgentTurnError {
  stopReason: "error";
  errorMessage: string;
}

/** Aggregated assistant-turn tracking state for a single prompt run. */
export interface AgentTerminalAssistantState {
  stopReason: string | null;
  rawStopReason: string | null;
  errorMessage: string | null;
  hadTextContent: boolean;
  hadToolCallContent: boolean;
  hadThinkingContent: boolean;
}

export interface AgentTurnTracker {
  handleMessageUpdate: (event: AgentSessionEvent) => void;
  /** Resolve any unterminated streamed text before the prompt attempt is finalized. */
  finalizeAttempt: () => void;
  getFinalText: () => string;
  getTurnCount: () => number;
  getError: () => AgentTurnError | null;
  getLastAssistantState: () => AgentTerminalAssistantState | null;
  getFinalUsage: () => Usage | undefined;
}

/**
 * Result of arming a prompt timeout.
 * `timedOutRef.value` flips to true only for the ordinary hard timeout. A Goal
 * pre-deadline abort resolves `settled` with typed checkpoint evidence instead.
 */
export interface PromptTimeoutState {
  timeoutId: ReturnType<typeof setTimeout> | null;
  checkpointTimeoutId: ReturnType<typeof setTimeout> | null;
  timedOutRef: { value: boolean };
  completedRef: { value: boolean };
  settled: Promise<GoalDeadlineCheckpointEvidence | null>;
  finish: () => Promise<GoalDeadlineCheckpointEvidence | null>;
}

export function getGoalDeadlineCheckpointReserveMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 2) return 0;
  return Math.min(60_000, Math.floor(timeoutMs / 2), Math.max(5_000, Math.floor(timeoutMs * 0.15)));
}

export interface PromptGoalDeadlineCheckpointOptions {
  oldTurnId: string;
  reserveMs: number;
  tryLatch: (latch: GoalDeadlineCheckpointLatch) => boolean;
}

/** Dependencies injected into AgentTurnCoordinator. */
export interface AgentTurnCoordinatorOptions {
  takeAttachments: (chatJid: string) => AttachmentInfo[];
  touchSession: (chatJid: string) => void;
  /** @deprecated Usage is now recorded once per bound session; retained for test/extension option compatibility. */
  recordMessageUsage?: (chatJid: string, message: unknown) => void;
  onInfo?: (message: string, details: Record<string, unknown>) => void;
  onWarn?: (message: string, details: Record<string, unknown>) => void;
  onError?: (message: string, details: Record<string, unknown>) => void;
}

/**
 * Coordinates per-run assistant turn tracking and event lifecycle helpers.
 */
export class AgentTurnCoordinator {
  constructor(private readonly options: AgentTurnCoordinatorOptions) {}

  createTracker(
    chatJid: string,
    onTurnComplete?: (turn: AgentTurnOutput) => void,
    onTurnDiscard?: (discard: AgentTurnDiscard) => void,
  ): AgentTurnTracker {
    let currentTurnText = "";
    let currentTurnPhase: AssistantTextPhase = null;
    let turnCount = 0;
    let messageHasDelta = false;
    let messageComplete = false;
    let currentTurnUsage: Usage | undefined;
    let lastError: AgentTurnError | null = null;
    let lastAssistantState: AgentTerminalAssistantState | null = null;

    const parseTextPhase = (signature: unknown): AssistantTextPhase => {
      if (typeof signature !== "string" || !signature.trim()) return null;
      try {
        const parsed = JSON.parse(signature) as { phase?: unknown };
        return parsed?.phase === "commentary" || parsed?.phase === "final_answer"
          ? parsed.phase
          : null;
      } catch {
        return null;
      }
    };

    const resolveTextPhaseFromBlock = (block: AgentContentBlock | undefined): AssistantTextPhase => {
      if (!block || block.type !== "text") return null;
      return parseTextPhase(block.textSignature);
    };

    const resolveTextPhaseFromPartial = (partial: unknown, contentIndex?: number): AssistantTextPhase => {
      if (!partial || typeof partial !== "object") return null;
      const content = (partial as { content?: unknown }).content;
      if (!Array.isArray(content)) return null;
      const block = typeof contentIndex === "number" ? content[contentIndex] as AgentContentBlock | undefined : undefined;
      return resolveTextPhaseFromBlock(block);
    };

    const extractAssistantTextFromContent = (content: unknown): {
      text: string;
      phase: AssistantTextPhase;
      hasText: boolean;
      hasCommentary: boolean;
      commentaryOnly: boolean;
    } => {
      if (!Array.isArray(content)) {
        const text = typeof content === "string" ? content : "";
        return {
          text,
          phase: null,
          hasText: Boolean(text.trim()),
          hasCommentary: false,
          commentaryOnly: false,
        };
      }

      const textBlocks = content.filter((block) => (block as AgentContentBlock | undefined)?.type === "text") as AgentContentBlock[];
      const finalAnswerText = textBlocks
        .filter((block) => resolveTextPhaseFromBlock(block) === "final_answer")
        .map((block) => (typeof block.text === "string" ? block.text : ""))
        .join("");
      const unphasedText = textBlocks
        .filter((block) => resolveTextPhaseFromBlock(block) === null)
        .map((block) => (typeof block.text === "string" ? block.text : ""))
        .join("");
      const commentaryText = textBlocks
        .filter((block) => resolveTextPhaseFromBlock(block) === "commentary")
        .map((block) => (typeof block.text === "string" ? block.text : ""))
        .join("");
      const allText = textBlocks
        .map((block) => (typeof block.text === "string" ? block.text : ""))
        .join("");
      const hasFinalAnswer = Boolean(finalAnswerText.trim());
      const text = hasFinalAnswer ? finalAnswerText : unphasedText;
      const hasCommentary = Boolean(commentaryText.trim());

      return {
        text,
        phase: hasFinalAnswer ? "final_answer" : null,
        hasText: Boolean(allText.trim()),
        hasCommentary,
        commentaryOnly: hasCommentary && !text.trim(),
      };
    };

    const resetCurrentTurn = () => {
      currentTurnText = "";
      currentTurnPhase = null;
      currentTurnUsage = undefined;
      messageHasDelta = false;
      messageComplete = false;
    };

    const flushTurn = (options: { followedByToolUse?: boolean } = {}) => {
      const text = currentTurnText.trim();
      if (!text && !onTurnComplete) {
        resetCurrentTurn();
        return;
      }
      if (text || turnCount > 0) {
        onTurnComplete?.({
          text,
          attachments: this.options.takeAttachments(chatJid),
          ...(currentTurnUsage ? { usage: currentTurnUsage } : {}),
          ...(options.followedByToolUse ? { followedByToolUse: true } : {}),
        });
        turnCount += 1;
      }
      resetCurrentTurn();
    };

    const handleMessageUpdate = (event: AgentSessionEvent) => {
      if (event.type === "message_update") {
        const messageEvent = event.assistantMessageEvent as {
          type?: string;
          delta?: string;
          contentIndex?: number;
          partial?: unknown;
        };
        if (messageEvent.type === "text_start") {
          const textLengthBeforeStart = currentTurnText.length;
          const hadCompletedMessage = messageComplete;
          const hadIncompleteAccumulation = !messageComplete && (messageHasDelta || currentTurnText.length > 0 || currentTurnPhase !== null);

          this.options.onInfo?.("Assistant text stream started", {
            operation: "turn_coordinator.text_start",
            chatJid,
            contentIndex: messageEvent.contentIndex ?? null,
            currentTurnTextLength: textLengthBeforeStart,
            messageHasDelta,
            messageComplete,
            currentTurnPhase,
          });

          if (messageComplete) {
            if (onTurnComplete) {
              flushTurn();
            } else {
              resetCurrentTurn();
            }
          } else if (messageHasDelta || currentTurnText || currentTurnPhase !== null) {
            // A new text stream started before the previous assistant message
            // emitted message_end. Discard the incomplete accumulation rather
            // than flushing it as a completed turn.
            resetCurrentTurn();
          }
          currentTurnPhase = resolveTextPhaseFromPartial(messageEvent.partial, messageEvent.contentIndex);

          this.options.onInfo?.("Assistant text stream boundary resolved", {
            operation: "turn_coordinator.text_start_boundary",
            chatJid,
            contentIndex: messageEvent.contentIndex ?? null,
            hadCompletedMessage,
            hadIncompleteAccumulation,
            nextTurnPhase: currentTurnPhase,
          });
        }
        if (messageEvent.type === "text_delta") {
          messageHasDelta = true;
          currentTurnPhase ??= resolveTextPhaseFromPartial(messageEvent.partial, messageEvent.contentIndex);
          currentTurnText += messageEvent.delta || "";
        }
        if (messageEvent.type === "text_end") {
          currentTurnPhase ??= resolveTextPhaseFromPartial(messageEvent.partial, messageEvent.contentIndex);
        }
        return;
      }

      if (event.type === "message_end") {
        const message = event.message as {
          role?: string;
          content?: unknown;
          stopReason?: string;
          rawStopReason?: string;
          errorMessage?: string;
          usage?: Usage;
        } | undefined;
        if (message?.role === "assistant") {
          // The latest completed assistant provider response is authoritative.
          // Keep historical errors in event logs, but do not let an earlier
          // provider error override a later successful retry in the same prompt.
          lastError = message.stopReason === "error" && message.errorMessage
            ? { stopReason: "error", errorMessage: message.errorMessage }
            : null;
          const contentBlocks = Array.isArray(message.content) ? message.content as AgentContentBlock[] : [];
          const extracted = extractAssistantTextFromContent(message.content);
          const hadTextContent = typeof message.content === "string"
            ? message.content.trim().length > 0
            : contentBlocks.some((block) => block?.type === "text" && typeof block.text === "string" && block.text.trim().length > 0);
          const hadToolCallContent = contentBlocks.some((block) => block?.type === "toolCall");
          const hadThinkingContent = contentBlocks.some((block: any) => block?.type === "thinking" && typeof block?.thinking === "string" && block.thinking.trim().length > 0);
          lastAssistantState = {
            stopReason: typeof message.stopReason === "string" && message.stopReason.trim() ? message.stopReason : null,
            rawStopReason: typeof message.rawStopReason === "string" && message.rawStopReason.trim() ? message.rawStopReason.trim() : null,
            errorMessage: typeof message.errorMessage === "string" && message.errorMessage.trim() ? message.errorMessage.trim() : null,
            hadTextContent,
            hadToolCallContent,
            hadThinkingContent,
          };
          currentTurnUsage = message.usage;
          // Prefer authoritative message_end text because extensions may
          // replace the streamed draft. Some providers omit visible text from
          // the finalized tool-call message, though, so retain the completed
          // stream as a fallback instead of silently losing what the UI showed.
          const streamedText = currentTurnText.trim();
          const authoritativeTextSeen = extracted.hasText;
          const streamedCommentaryOnly = !authoritativeTextSeen
            && Boolean(streamedText)
            && currentTurnPhase === "commentary";
          const commentaryOnly = extracted.commentaryOnly || streamedCommentaryOnly;
          currentTurnText = authoritativeTextSeen ? extracted.text.trim() : streamedText;
          currentTurnPhase = authoritativeTextSeen ? extracted.phase : currentTurnPhase;

          this.options.onInfo?.("Assistant message completed", {
            operation: "turn_coordinator.message_end",
            chatJid,
            stopReason: message.stopReason ?? null,
            rawStopReason: message.rawStopReason ?? null,
            extractedTextLength: extracted.text.length,
            phase: extracted.phase,
            hasCommentary: extracted.hasCommentary,
            commentaryOnly,
            messageHasDelta,
            currentTurnTextLength: currentTurnText.length,
            hadTextContent,
            hadToolCallContent,
            hadThinkingContent,
          });

          messageHasDelta = false;
          messageComplete = true;
          // Signed commentary is transient provider narration. Discard it at
          // every completed-message boundary, not only before a tool call: an
          // error/abort can otherwise leave it buffered for the next response
          // to flush as a durable turn.
          if (commentaryOnly) {
            onTurnDiscard?.({
              reason: message.stopReason === "toolUse" && hadToolCallContent
                ? "tool_use_commentary"
                : "commentary_only",
            });
            resetCurrentTurn();
            return;
          }
          if (message.stopReason === "toolUse" && hadToolCallContent) {
            if (onTurnComplete) {
              flushTurn({ followedByToolUse: true });
            } else {
              resetCurrentTurn();
            }
          }
          return;
        }
        messageHasDelta = false;
        messageComplete = true;
      }
    };

    const finalizeAttempt = () => {
      // Providers can throw or abort without emitting message_end. Never let a
      // dangling signed commentary stream become final text or a web draft
      // fallback when the attempt is finalized.
      if (currentTurnText.trim() && currentTurnPhase === "commentary") {
        onTurnDiscard?.({ reason: "commentary_only" });
        resetCurrentTurn();
      }
    };

    return {
      handleMessageUpdate,
      finalizeAttempt,
      getFinalText: () => currentTurnPhase === "commentary" ? "" : currentTurnText.trim(),
      getTurnCount: () => turnCount,
      getError: () => lastError,
      getLastAssistantState: () => lastAssistantState,
      getFinalUsage: () => currentTurnUsage,
    };
  }

  subscribe(
    session: AgentSession,
    chatJid: string,
    tracker: AgentTurnTracker,
    onEvent?: (event: AgentSessionEvent) => void,
  ): () => void {
    return session.subscribe((event: AgentSessionEvent) => {
      this.options.touchSession(chatJid);

      if (onEvent) {
        try {
          onEvent(event);
        } catch (err) {
          this.options.onWarn?.("Event handler error", {
            operation: "subscribe_to_session.on_event",
            chatJid,
            err,
          });
        }
      }

      tracker.handleMessageUpdate(event);

    });
  }

  startPromptTimeout(
    session: AgentSession,
    chatJid: string,
    timeoutMs: number,
    goalDeadline?: PromptGoalDeadlineCheckpointOptions,
  ): PromptTimeoutState {
    const timedOutRef = { value: false };
    const completedRef = { value: false };
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let checkpointTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let settlement: Promise<GoalDeadlineCheckpointEvidence | null> | null = null;
    let checkpointLatch: GoalDeadlineCheckpointLatch | null = null;
    let resolveSettled!: (value: GoalDeadlineCheckpointEvidence | null) => void;
    const settled = new Promise<GoalDeadlineCheckpointEvidence | null>((resolve) => { resolveSettled = resolve; });
    let settledResolved = false;
    const resolveOnce = (value: GoalDeadlineCheckpointEvidence | null) => {
      if (settledResolved) return;
      settledResolved = true;
      resolveSettled(value);
    };
    const clearTimers = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (checkpointTimeoutId) clearTimeout(checkpointTimeoutId);
      timeoutId = null;
      checkpointTimeoutId = null;
    };
    const finish = async (): Promise<GoalDeadlineCheckpointEvidence | null> => {
      completedRef.value = true;
      if (!settlement) {
        clearTimers();
        resolveOnce(null);
      } else if (checkpointTimeoutId) {
        clearTimeout(checkpointTimeoutId);
        checkpointTimeoutId = null;
      }
      const evidence = await settled;
      clearTimers();
      return evidence;
    };
    if (!timeoutMs || timeoutMs <= 0) {
      resolveOnce(null);
      return { timeoutId: null, checkpointTimeoutId: null, timedOutRef, completedRef, settled, finish };
    }

    const startedAtMs = Date.now();
    const deadlineAtMs = startedAtMs + timeoutMs;
    timeoutId = setTimeout(() => {
      if (settlement && checkpointLatch) {
        timedOutRef.value = true;
        resolveOnce({
          ...checkpointLatch,
          settledAt: new Date().toISOString(),
          settlement: "abort_failed",
          abortError: "Goal deadline checkpoint did not settle before the hard prompt deadline",
          pendingSteering: [],
          pendingFollowUps: [],
        });
        return;
      }
      if (completedRef.value || settlement) return;
      timedOutRef.value = true;
      this.options.onError?.("Prompt timed out; aborting session", {
        operation: "start_prompt_timeout",
        chatJid,
        timeoutMs,
      });
      recordAgentAbortCause(chatJid, "prompt_timeout", "start_prompt_timeout");
      // Preserve the legacy non-checkpoint timeout path: request abort without
      // making prompt finalization wait for the abort promise itself. Only a
      // latched Goal checkpoint uses the bounded settlement promise above.
      void session.abort().catch((err) => {
        if (!completedRef.value) {
          this.options.onWarn?.("Failed to abort timed-out prompt", {
            operation: "start_prompt_timeout.abort",
            chatJid,
            timeoutMs,
            err,
          });
        }
      });
      resolveOnce(null);
    }, timeoutMs);

    const reserveMs = goalDeadline
      ? Math.max(1, Math.min(Math.floor(timeoutMs / 2), Math.floor(goalDeadline.reserveMs)))
      : 0;
    if (goalDeadline && reserveMs > 0 && timeoutMs > reserveMs) {
      checkpointTimeoutId = setTimeout(() => {
        if (completedRef.value || settlement) return;
        const triggeredAt = new Date().toISOString();
        const latch: GoalDeadlineCheckpointLatch = {
          checkpointId: crypto.randomUUID(),
          oldTurnId: goalDeadline.oldTurnId,
          timeoutMs,
          reserveMs,
          deadlineAt: new Date(deadlineAtMs).toISOString(),
          triggeredAt,
        };
        let latched = false;
        try {
          latched = goalDeadline.tryLatch(latch);
        } catch (err) {
          this.options.onWarn?.("Goal deadline checkpoint latch failed", {
            operation: "start_prompt_timeout.goal_deadline_latch",
            chatJid,
            timeoutMs,
            reserveMs,
            err,
          });
        }
        if (!latched) return;
        checkpointLatch = latch;
        settlement = (async () => {
          recordAgentAbortCause(chatJid, "goal_deadline_checkpoint", "start_prompt_timeout.goal_deadline_checkpoint");
          let abortError: string | null = null;
          try {
            await session.abort();
          } catch (err) {
            abortError = err instanceof Error ? err.message : String(err);
            this.options.onWarn?.("Failed to settle Goal deadline checkpoint abort", {
              operation: "start_prompt_timeout.goal_deadline_abort",
              chatJid,
              timeoutMs,
              reserveMs,
              err,
            });
          }
          const evidence: GoalDeadlineCheckpointEvidence = {
            ...latch,
            settledAt: new Date().toISOString(),
            settlement: abortError ? "abort_failed" : "abort_requested",
            abortError,
            pendingSteering: [],
            pendingFollowUps: [],
          };
          resolveOnce(evidence);
          return evidence;
        })();
      }, timeoutMs - reserveMs);
    }

    return { timeoutId, checkpointTimeoutId, timedOutRef, completedRef, settled, finish };
  }
}
