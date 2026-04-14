/**
 * agent-pool/turn-coordinator.ts – Tracks streaming turns and prompt lifecycle helpers.
 *
 * Extracts turn aggregation, session subscription wiring, and prompt timeout
 * handling out of AgentPool so prompt orchestration can stay focused on the
 * higher-level run flow.
 */

import type { AgentSession, AgentSessionEvent } from "@mariozechner/pi-coding-agent";

import type { AttachmentInfo } from "./attachments.js";

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
}

/** Error state captured from an assistant message with stopReason "error". */
export interface AgentTurnError {
  stopReason: "error";
  errorMessage: string;
}

/** Aggregated assistant-turn tracking state for a single prompt run. */
export interface AgentTurnTracker {
  handleMessageUpdate: (event: AgentSessionEvent) => void;
  getFinalText: () => string;
  getTurnCount: () => number;
  getError: () => AgentTurnError | null;
}

/**
 * Result of arming a prompt timeout.
 * `timedOutRef.value` flips to true once the timeout abort fires.
 */
export interface PromptTimeoutState {
  timeoutId: ReturnType<typeof setTimeout> | null;
  timedOutRef: { value: boolean };
}

/** Dependencies injected into AgentTurnCoordinator. */
export interface AgentTurnCoordinatorOptions {
  takeAttachments: (chatJid: string) => AttachmentInfo[];
  touchSession: (chatJid: string) => void;
  recordMessageUsage: (chatJid: string, message: unknown) => void;
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
  ): AgentTurnTracker {
    let currentTurnText = "";
    let currentTurnPhase: AssistantTextPhase = null;
    let turnCount = 0;
    let messageHasDelta = false;
    let lastError: AgentTurnError | null = null;

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

    const extractAssistantTextFromContent = (content: unknown): { text: string; phase: AssistantTextPhase } => {
      if (!Array.isArray(content)) {
        return {
          text: typeof content === "string" ? content : "",
          phase: null,
        };
      }

      const textBlocks = content.filter((block) => (block as AgentContentBlock | undefined)?.type === "text") as AgentContentBlock[];
      const nonCommentaryText = textBlocks
        .filter((block) => resolveTextPhaseFromBlock(block) !== "commentary")
        .map((block) => (typeof block.text === "string" ? block.text : ""))
        .join("");
      if (nonCommentaryText) {
        const lastNonCommentaryPhase = [...textBlocks]
          .reverse()
          .map((block) => resolveTextPhaseFromBlock(block))
          .find((phase) => phase !== "commentary") ?? null;
        return { text: nonCommentaryText, phase: lastNonCommentaryPhase };
      }

      return { text: "", phase: textBlocks.some((block) => resolveTextPhaseFromBlock(block) === "commentary") ? "commentary" : null };
    };

    const flushTurn = () => {
      const text = currentTurnText.trim();
      if ((!text || currentTurnPhase === "commentary") && !onTurnComplete) {
        currentTurnText = "";
        currentTurnPhase = null;
        messageHasDelta = false;
        return;
      }
      if ((text && currentTurnPhase !== "commentary") || turnCount > 0) {
        onTurnComplete?.({
          text: currentTurnPhase === "commentary" ? "" : text,
          attachments: this.options.takeAttachments(chatJid),
        });
        turnCount += 1;
      }
      currentTurnText = "";
      currentTurnPhase = null;
      messageHasDelta = false;
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
          if (onTurnComplete) {
            flushTurn();
          } else {
            messageHasDelta = false;
            currentTurnText = "";
          }
          currentTurnPhase = resolveTextPhaseFromPartial(messageEvent.partial, messageEvent.contentIndex);
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
          errorMessage?: string;
        } | undefined;
        if (message?.role === "assistant") {
          if (message.stopReason === "error" && message.errorMessage) {
            lastError = { stopReason: "error", errorMessage: message.errorMessage };
          }
          const extracted = extractAssistantTextFromContent(message.content);
          if (!messageHasDelta) {
            currentTurnText = extracted.text;
          }
          currentTurnPhase = extracted.phase;
          if (currentTurnPhase === "commentary") {
            currentTurnText = "";
          }
        }
        messageHasDelta = false;
      }
    };

    return {
      handleMessageUpdate,
      getFinalText: () => currentTurnPhase === "commentary" ? "" : currentTurnText.trim(),
      getTurnCount: () => turnCount,
      getError: () => lastError,
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

      if (event.type === "message_end") {
        try {
          this.options.recordMessageUsage(chatJid, (event as { message?: unknown }).message);
        } catch (err) {
          this.options.onWarn?.("Failed to persist message usage", {
            operation: "subscribe_to_session.record_usage",
            chatJid,
            err,
          });
        }
      }
    });
  }

  startPromptTimeout(
    session: AgentSession,
    chatJid: string,
    timeoutMs: number,
  ): PromptTimeoutState {
    const timedOutRef = { value: false };
    if (!timeoutMs || timeoutMs <= 0) {
      return { timeoutId: null, timedOutRef };
    }

    const timeoutId = setTimeout(async () => {
      timedOutRef.value = true;
      this.options.onError?.("Prompt timed out; aborting session", {
        operation: "start_prompt_timeout",
        chatJid,
        timeoutMs,
      });
      await session.abort();
    }, timeoutMs);

    return { timeoutId, timedOutRef };
  }
}
