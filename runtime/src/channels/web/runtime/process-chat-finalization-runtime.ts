import { getIdentityConfig } from "../../../core/config.js";
import { endChatRun, getChatCursor, getMessagesSince, peekNextAcceptedChatSource, type ChatOperationOwner } from "../../../db.js";
import { checkPendingShutdown } from "../../../runtime/shutdown-registry.js";
import { createLogger } from "../../../utils/logger.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import type { AgentEventEmitter } from "../sse/agent-events.js";
import { storeAgentTurn } from "../messaging/agent-message-store.js";
import { materializeDeferredFollowups } from "./process-chat-control-runtime.js";
import type { AttachmentInfo } from "../../../agent-pool/attachments.js";
import type { ChatChannel } from "../../../router.js";

const log = createLogger("web.runtime.process-chat-finalization");

export interface ProcessChatFinalizationRuntime {
  channel: Pick<WebChannelLike,
    | "agentPool"
    | "consumePendingSteering"
    | "saveState"
    | "setContextUsage"
    | "resumeChat"
    | "peekQueuedFollowupItem"
    | "consumeQueuedFollowupItem"
    | "prependQueuedFollowupItem"
    | "replaceQueuedFollowupItem"
    | "storeMessage"
    | "broadcastEvent"
    | "sendMessage"
    | "updateAgentStatus"
    | "retryFailedOnModelSwitch"
  >;
  emitter: AgentEventEmitter;
  chatJid: string;
  agentId: string;
  turnId: string;
  threadId: string | number | null;
  prevCursor: string;
  recovery: { attemptsUsed?: number; recovered?: boolean; exhausted?: boolean; lastClassifier?: string | null } | null;
  durableOperationCompleted?: boolean;
}

/** Finalise a successfully persisted terminal outcome, then resume persisted/queued work. */
export async function finalizeSuccessfulProcessChatRun(options: ProcessChatFinalizationRuntime): Promise<void> {
  const { channel, chatJid } = options;
  // Stale protected intent was removed atomically with terminal persistence.
  // This update only clears inflight/failed run state.
  if (!options.durableOperationCompleted) endChatRun(chatJid);
  const cursorAfterEnd = getChatCursor(chatJid);
  const pendingSteerTimestamps = channel.consumePendingSteering(chatJid);
  const cursorAfterSteer = getChatCursor(chatJid);

  channel.saveState();
  const contextUsage = await channel.agentPool.getContextUsageForChat(chatJid);
  channel.setContextUsage(chatJid, contextUsage
    ? { tokens: contextUsage.tokens, contextWindow: contextUsage.contextWindow, percent: contextUsage.percent }
    : null);
  options.emitter.status({
    thread_id: options.threadId,
    agent_id: options.agentId,
    type: "done",
    turn_id: options.turnId,
    context_usage: contextUsage
      ? { tokens: contextUsage.tokens, contextWindow: contextUsage.contextWindow, percent: contextUsage.percent }
      : null,
    recovery: options.recovery,
  });

  const cursorNow = getChatCursor(chatJid);
  const remainingPersisted = getMessagesSince(chatJid, cursorNow, getIdentityConfig().assistantName);
  const pendingDurableSource = ["message", "protected_continuation", "goal_continuation"]
    .includes(peekNextAcceptedChatSource(chatJid)?.sourceKind ?? "");
  log.info("finalizeSuccessfulRun advanced cursor", {
    operation: "process_chat.finalize_successful_run",
    chatJid,
    cursorBefore: options.prevCursor,
    cursorAfterEnd,
    pendingSteerCount: pendingSteerTimestamps.length,
    pendingSteerTimestamps,
    cursorAfterSteer,
    cursorNow,
    remainingCount: remainingPersisted.length,
    pendingDurableSource,
    remainingMessages: remainingPersisted.map((message) => `${message.id}@${message.timestamp}`),
  });

  if (remainingPersisted.length > 0 || pendingDurableSource) {
    channel.resumeChat(chatJid);
    return;
  }

  await materializeDeferredFollowups({ channel: channel as WebChannelLike, chatJid, agentId: options.agentId });
  checkPendingShutdown();
}

export interface PersistIntermediateTurnOptions {
  channel: WebChannelLike;
  emitter: AgentEventEmitter;
  chatJid: string;
  text: string;
  attachments: AttachmentInfo[];
  channelName: ChatChannel;
  threadId: number | null;
  skipPlaceholder: boolean;
  timingBlock: Record<string, unknown>;
  followedByToolUse?: boolean;
  operationOwner?: ChatOperationOwner;
  clearCommittedDraft(): void;
}

/** Persist one non-terminal agent turn while preserving placeholder and draft ordering. */
export function persistIntermediateProcessChatTurn(options: PersistIntermediateTurnOptions): number | null {
  return storeAgentTurn(options.channel, options.emitter, {
    chatJid: options.chatJid,
    text: options.text,
    attachments: options.attachments,
    channelName: options.channelName,
    threadId: options.threadId,
    skipPlaceholder: options.skipPlaceholder,
    extraContentBlocks: [options.timingBlock],
    operationOwner: options.operationOwner,
    onMessageStored: options.followedByToolUse ? options.clearCommittedDraft : undefined,
  });
}
