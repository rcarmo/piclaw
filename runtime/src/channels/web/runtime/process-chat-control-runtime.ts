/**
 * web/process-chat-control-runtime.ts – extracted processChat control/runtime phases.
 *
 * Keeps deferred control execution, queued follow-up materialisation, and
 * persisted-message selection logic typed and testable without moving full
 * run orchestration out of `handlers/agent.ts`.
 */

import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { isDeepStrictEqual } from "node:util";
import { getIdentityConfig, getRoutingConfig } from "../../../core/config.js";
import { readAccessConfig } from "../../../core/config-access.js";
import { parseControlCommand } from "../../../agent-control/index.js";
import type { AgentControlCommand, AgentControlResult } from "../../../agent-control/index.js";
import {
  getChatCursor,
  getMessagesSince,
  setChatCursor,
  type InteractionRow,
} from "../../../db.js";

import { formatOutbound } from "../../../router.js";
import { createUuid } from "../../../utils/ids.js";
import { createLogger } from "../../../utils/logger.js";
import type { QueuedFollowupItem } from "../../../queued-followups.js";
import type { NewMessage } from "../../../types.js";

const log = createLogger("web.runtime.process-chat-control-runtime");

import { MODEL_COMMAND_TYPES, DEFERRED_CONTROL_COMMAND_TYPES } from "../../../agent-control/agent-control-types.js";
export { MODEL_COMMAND_TYPES, DEFERRED_CONTROL_COMMAND_TYPES };

export type ModelControlCommand = Extract<AgentControlCommand, { type: "model" | "thinking" | "cycle_model" | "cycle_thinking" }>;
export type DeferredControlCommand = Extract<AgentControlCommand, { type: "compact" | "model" | "thinking" | "cycle_model" | "cycle_thinking" }>;

export interface DeferredControlExecutionMessage {
  rowId: number;
  messageId?: string | null;
  content: string;
  timestamp: string;
  threadId?: number | null;
  queuedSource?: string;
  queuedBy?: QueuedFollowupItem["queuedBy"];
}

export interface ProcessChatMessageSelectionStore {
  getMessagesSince(chatJid: string, sinceTimestamp: string, assistantName: string): NewMessage[];
}

export interface ProcessChatCursorStore {
  getChatCursor(chatJid: string): string;
  setChatCursor(chatJid: string, ts: string): void;
  getMessagesSince(chatJid: string, sinceTimestamp: string, assistantName: string): NewMessage[];
}

export interface ProcessChatSelectedMessage {
  kind: "message";
  pendingMessages: NewMessage[];
  currentMessage: NewMessage;
  messageThreadId: number | null;
  effectiveThreadRootId: number | null;
}

export interface ProcessChatNoPendingMessages {
  kind: "no_messages";
  pendingMessages: NewMessage[];
}

export type ProcessChatMessageSelection =
  | ProcessChatSelectedMessage
  | ProcessChatNoPendingMessages;

export interface ResolvedCommandModelState {
  model: string | null;
  thinkingLevel: string | null;
  thinkingLevelLabel: string | null;
  supportsThinking: boolean | undefined;
}

export interface DeferredControlCommandRuntime {
  agentPool: Pick<WebChannelLike["agentPool"], "applyControlCommand" | "getAvailableModels" | "getCurrentModelLabel" | "getContextUsageForChat" | "getSessionGenerationForChat">;
  sendMessage: WebChannelLike["sendMessage"];
  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void;
  getAgentStatus?(chatJid: string): Record<string, unknown> | null;
  broadcastEvent(eventType: string, data: unknown): void;
  resumeChat(chatJid: string, threadRootId?: number | null): void;
}

export interface QueuedFollowupMaterializationRuntime extends DeferredControlCommandRuntime {
  expireQueuedInput?: WebChannelLike["expireQueuedInput"];
  peekQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null;
  consumeQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null;
  prependQueuedFollowupItem(chatJid: string, item: QueuedFollowupItem): void;
  admitMessage: WebChannelLike["admitMessage"];
}

export interface ExecuteDeferredControlCommandOptions {
  channel: DeferredControlCommandRuntime;
  chatJid: string;
  agentId: string;
  command: DeferredControlCommand;
  message: DeferredControlExecutionMessage;
  effectiveThreadRootId?: number | null;
  assistantName?: string;
  cursorStore?: ProcessChatCursorStore;
}

export type DeferredControlCommandAction = "continue" | "resumed";

export interface MaterializeDeferredFollowupsOptions {
  channel: QueuedFollowupMaterializationRuntime;
  chatJid: string;
  agentId: string;
  assistantName?: string;
  cursorStore?: ProcessChatCursorStore;
}

export type MaterializeDeferredFollowupsResult =
  | { status: "none" }
  | { status: "resumed"; rowId: number }
  | { status: "drained" };

const defaultSelectionStore: ProcessChatMessageSelectionStore = {
  getMessagesSince,
};

const defaultCursorStore: ProcessChatCursorStore = {
  getChatCursor,
  setChatCursor,
  getMessagesSince,
};

export function isModelControlCommand(command: unknown): command is ModelControlCommand {
  return Boolean(command && typeof command === "object" && MODEL_COMMAND_TYPES.has(String((command as { type?: unknown }).type || "")));
}

export function isDeferredControlCommand(command: unknown): command is DeferredControlCommand {
  return Boolean(command && typeof command === "object" && DEFERRED_CONTROL_COMMAND_TYPES.has(String((command as { type?: unknown }).type || "")));
}

export function selectProcessChatMessage(options: {
  chatJid: string;
  prevCursor: string;
  threadRootId?: number | null;
  assistantName?: string;
  store?: ProcessChatMessageSelectionStore;
}): ProcessChatMessageSelection {
  const store = options.store ?? defaultSelectionStore;
  const assistantName = options.assistantName ?? getIdentityConfig().assistantName;
  const pendingMessages = store.getMessagesSince(options.chatJid, options.prevCursor, assistantName);

  if (pendingMessages.length === 0) {
    return {
      kind: "no_messages",
      pendingMessages,
    };
  }

  const currentMessage = pendingMessages[0]!;
  const messageThreadId = currentMessage.thread_id ?? null;
  return {
    kind: "message",
    pendingMessages,
    currentMessage,
    messageThreadId,
    effectiveThreadRootId: messageThreadId ?? options.threadRootId ?? null,
  };
}

export async function resolveAndBroadcastModelStateForCommand(
  channel: Pick<DeferredControlCommandRuntime, "agentPool" | "broadcastEvent">,
  chatJid: string,
  result: AgentControlResult,
): Promise<ResolvedCommandModelState> {
  let nextModel = typeof result.model_label === "string" ? result.model_label : null;
  let thinkingLevel = typeof result.thinking_level === "string" ? result.thinking_level : null;
  let thinkingLevelLabel = typeof result.thinking_level_label === "string" ? result.thinking_level_label : null;
  let supportsThinking: boolean | undefined = undefined;

  try {
    const modelState = await channel.agentPool.getAvailableModels(chatJid);
    if (!nextModel) nextModel = modelState.current ?? null;
    if (thinkingLevel == null) thinkingLevel = modelState.thinking_level ?? null;
    if (!thinkingLevelLabel) thinkingLevelLabel = modelState.thinking_level_label ?? thinkingLevel;
    supportsThinking = modelState.supports_thinking;
  } catch {
    if (typeof channel.agentPool.getCurrentModelLabel === "function") {
      nextModel = await channel.agentPool.getCurrentModelLabel(chatJid).catch(() => null);
    }
  }

  const state = {
    model: nextModel ?? null,
    thinkingLevel: thinkingLevel ?? null,
    thinkingLevelLabel: thinkingLevelLabel ?? thinkingLevel ?? null,
    supportsThinking,
  };
  channel.broadcastEvent("model_changed", {
    chat_jid: chatJid,
    model: state.model,
    thinking_level: state.thinkingLevel,
    thinking_level_label: state.thinkingLevelLabel,
    supports_thinking: state.supportsThinking,
  });
  return state;
}

export async function executeDeferredControlCommand(
  options: ExecuteDeferredControlCommandOptions,
): Promise<DeferredControlCommandAction> {
  const {
    channel,
    chatJid,
    agentId,
    command,
    message,
    effectiveThreadRootId,
  } = options;
  const assistantName = options.assistantName ?? getIdentityConfig().assistantName;
  const cursorStore = options.cursorStore ?? defaultCursorStore;

  log.info("processChat executing deferred control command", {
    operation: "process_chat.deferred_control_command",
    chatJid,
    cursor: cursorStore.getChatCursor(chatJid),
    messageId: message.messageId ?? null,
    rowId: message.rowId,
    commandType: command.type,
    queuedSource: message.queuedSource ?? null,
    queuedBy: message.queuedBy ?? null,
    contentPreview: message.content.slice(0, 80),
  });

  const compactTurn = command.type === "compact" ? createUuid("turn") : null;
  const compactStatus = (type: string, title: string) => {
    if (!compactTurn) return;
    const status = { chat_jid: chatJid, agent_id: agentId, turn_id: compactTurn,
      thread_id: message.threadId ?? message.rowId, type, title, intent_key: "compaction" };
    channel.updateAgentStatus(chatJid, status);
    channel.broadcastEvent("agent_status", status);
  };
  compactStatus("intent", "Compacting context");
  const result = await channel.agentPool.applyControlCommand(chatJid, command);
  const formatted = formatOutbound(result.message, "web");
  const commandThreadId = message.threadId ?? effectiveThreadRootId ?? message.rowId ?? null;

  if (result.status === "success" && result.sessionGenerationChanged && result.sessionGeneration) {
    const boundaryUsage = {
      tokens: null,
      contextWindow: null,
      percent: null,
      sessionGeneration: result.sessionGeneration,
      contextUpdate: "replace",
    };
    const statusPayload = {
      chat_jid: chatJid,
      thread_id: commandThreadId,
      agent_id: agentId,
      turn_id: compactTurn ?? createUuid("turn"),
      type: "context_usage",
      context_reset: true,
      sessionGeneration: result.sessionGeneration,
      context_usage: boundaryUsage,
    };
    channel.updateAgentStatus(chatJid, statusPayload);
    channel.broadcastEvent("agent_status", statusPayload);
  }

  if (result.status === "success" && !result.sessionGenerationChanged && command.type === "compact") {
    let contextUsage = result.contextUsage;
    if (!contextUsage?.tokensAreAuthoritative && (contextUsage?.tokens === null || contextUsage?.tokens === undefined)) {
      const current = typeof channel.agentPool.getContextUsageForChat === "function"
        ? await channel.agentPool.getContextUsageForChat(chatJid).catch(() => null)
        : null;
      if (current?.tokens !== null && current?.tokens !== undefined) {
        contextUsage = {
          tokens: current.tokens,
          contextWindow: current.contextWindow,
          percent: current.percent,
          ...(typeof current.sessionGeneration === "string" ? { sessionGeneration: current.sessionGeneration } : {}),
          source: "agent_pool",
          phase: "after_command",
        };
      }
    }
    if (contextUsage && (contextUsage.tokensAreAuthoritative || contextUsage.tokens !== null && contextUsage.tokens !== undefined)) {
      const activeGeneration = typeof channel.agentPool.getSessionGenerationForChat === "function"
        ? channel.agentPool.getSessionGenerationForChat(chatJid)
        : null;
      const usageGeneration = typeof contextUsage.sessionGeneration === "string"
        ? contextUsage.sessionGeneration
        : result.sessionGeneration ?? null;
      if (usageGeneration && activeGeneration && usageGeneration !== activeGeneration) {
        contextUsage = undefined;
      }
      const sessionGeneration = usageGeneration ?? activeGeneration;
      if (contextUsage && sessionGeneration) {
        const contextSnapshot = {
          tokens: contextUsage.tokens,
          contextWindow: contextUsage.contextWindow,
          percent: contextUsage.percent,
          sessionGeneration,
          contextUpdate: "replace",
        };
        const statusPayload = {
          chat_jid: chatJid,
          thread_id: commandThreadId,
          agent_id: agentId,
          turn_id: compactTurn ?? createUuid("turn"),
          type: "context_usage",
          context_usage: {
            ...contextSnapshot,
            estimated: contextUsage.estimated === true,
            source: contextUsage.source ?? null,
            phase: contextUsage.phase ?? null,
          },
        };
        channel.updateAgentStatus(chatJid, statusPayload);
        channel.broadcastEvent("agent_status", statusPayload);
      }
    }
  }

  if (formatted || result.contentBlocks?.length) {
    const sendOptions: Record<string, unknown> = { threadId: commandThreadId };
    if (result.mediaIds?.length) sendOptions.mediaIds = result.mediaIds;
    if (result.contentBlocks?.length) sendOptions.contentBlocks = result.contentBlocks;
    await channel.sendMessage(chatJid, formatted || "", sendOptions);
  }

  if (result.status === "success" && isModelControlCommand(command)) {
    await resolveAndBroadcastModelStateForCommand(channel, chatJid, result);
  }

  if (!channel.getAgentStatus || channel.getAgentStatus(chatJid)?.turn_id === compactTurn) {
    compactStatus(result.status === "success" ? "done" : "error", result.message);
  }
  cursorStore.setChatCursor(chatJid, message.timestamp);

  const cursorNow = cursorStore.getChatCursor(chatJid);
  const remainingPersisted = cursorStore.getMessagesSince(chatJid, cursorNow, assistantName);
  if (remainingPersisted.length > 0) {
    channel.resumeChat(chatJid);
    return "resumed";
  }

  return "continue";
}

function broadcastConsumedFollowup(
  channel: Pick<QueuedFollowupMaterializationRuntime, "broadcastEvent">,
  chatJid: string,
  item: QueuedFollowupItem,
): void {
  channel.broadcastEvent("agent_followup_consumed", {
    chat_jid: chatJid,
    thread_id: item.threadId ?? null,
    row_id: item.rowId,
    content: item.queuedContent,
    timestamp: item.queuedAt,
    ...(item.source ? { source: item.source } : {}),
  });
}

export async function materializeDeferredFollowups(
  options: MaterializeDeferredFollowupsOptions,
): Promise<MaterializeDeferredFollowupsResult> {
  if (readAccessConfig().mode !== "single-user") return { status: "none" };
  const {
    channel,
    chatJid,
    agentId,
  } = options;
  const assistantName = options.assistantName ?? getIdentityConfig().assistantName;
  const cursorStore = options.cursorStore ?? defaultCursorStore;
  let consumedAny = false;
  const expire = channel.expireQueuedInput?.bind(channel);
  const admit = channel.admitMessage.bind(channel);

  while (true) {
    const nextQueued = channel.peekQueuedFollowupItem(chatJid);
    if (!nextQueued) {
      return consumedAny ? { status: "drained" } : { status: "none" };
    }

    if (expire) {
      if (await expire(chatJid, nextQueued)) {
        consumedAny = true;
        broadcastConsumedFollowup(channel, chatJid, nextQueued);
        continue;
      }
      // The expiry check may yield; never materialize an obsolete head or a
      // reused negative row ID after a concurrent delete/reorder.
      if (!isDeepStrictEqual(channel.peekQueuedFollowupItem(chatJid), nextQueued)) continue;
    }
    let queuedInteraction: InteractionRow | null, headChanged: Error | undefined;
    try {
      queuedInteraction = await admit(chatJid, nextQueued.queuedContent, false, nextQueued.mediaIds ?? [], {
        contentBlocks: Array.isArray(nextQueued.contentBlocks) ? nextQueued.contentBlocks : undefined,
        linkPreviews: Array.isArray(nextQueued.linkPreviews) ? nextQueued.linkPreviews : undefined,
        threadId: nextQueued.threadId ?? undefined, screenHint: nextQueued.screenHint,
        consumeDeferredFollowupRowId: nextQueued.rowId,
      }, phase => {
        if (phase === "before" && !isDeepStrictEqual(channel.peekQueuedFollowupItem(chatJid), nextQueued))
          throw (headChanged ??= Error("Queued materialization head changed."));
      });
      if (!queuedInteraction) throw Error("Queued materialization requires a committed row");
    } catch (error) {
      if (headChanged && error === headChanged) continue;
      let expired: boolean;
      try { expired = expire ? await expire(chatJid, nextQueued) : false; }
      catch { throw error; } // A secondary expiry failure cannot replace the admission failure.
      if (expired) { consumedAny = true; broadcastConsumedFollowup(channel, chatJid, nextQueued); continue; }
      throw error;
    }

    consumedAny = true;
    broadcastConsumedFollowup(channel, chatJid, nextQueued);
    channel.broadcastEvent("new_post", queuedInteraction);

    const queuedCommand = parseControlCommand(String(nextQueued.queuedContent || ""), getRoutingConfig().triggerPattern);
    if (isDeferredControlCommand(queuedCommand)) {
      const action = await executeDeferredControlCommand({
        channel,
        chatJid,
        agentId,
        command: queuedCommand,
        message: {
          rowId: queuedInteraction.id,
          content: nextQueued.queuedContent,
          timestamp: queuedInteraction.timestamp,
          threadId: queuedInteraction.data?.thread_id ?? queuedInteraction.id ?? null,
          queuedSource: nextQueued.source,
          queuedBy: nextQueued.queuedBy,
        },
        effectiveThreadRootId: queuedInteraction.data?.thread_id ?? queuedInteraction.id ?? null,
        assistantName,
        cursorStore,
      });
      if (action === "continue") {
        continue;
      }
      return { status: "resumed", rowId: queuedInteraction.id };
    }

    channel.resumeChat(chatJid, queuedInteraction.id);
    return { status: "resumed", rowId: queuedInteraction.id };
  }
}
