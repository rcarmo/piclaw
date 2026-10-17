/**
 * channels/web/message-processing-storage-service.ts – WebChannel message processing/storage seam.
 *
 * Owns the thin adapter layer for WebChannel's public processChat() and
 * storeMessage() methods so WebChannel can remain a coordinator while the
 * existing handler/persistence behavior stays unchanged.
 */

import type { InteractionRow } from "../../../db.js";
import { isSlashCommandInvocation } from "../../../agent-pool/slash-command.js";
import { processChat as processAgentChat } from "../handlers/agent.js";
import type { LinkPreviewChannel } from "../media/link-previews.js";
import {
  storeWebMessage as persistWebMessage,
  admitWebUserMessage,
  type StoreWebMessageOptions,
  type WebUserMessageStoreOptions,
  type StoreWebMessageParams,
} from "./message-store.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { recordTimelineInteraction } from "../../../session-recordings/session-recordings.js";
import { createLogger, debugSuppressedError } from '../../../utils/logger.js';
const log = createLogger('web.message-processing-storage');

export interface WebChannelStoreMessageOptions {
  contentBlocks?: unknown[];
  linkPreviews?: unknown[];
  threadId?: number;
  screenHint?: string | null;
  isTerminalAgentReply?: boolean;
  isSteeringMessage?: boolean;
  removeProtectedContinuationForSourceMessageId?: string | null;
  consumeDeferredFollowupRowId?: number | null;
}

export interface WebMessageProcessingStorageChannel extends WebChannelLike, LinkPreviewChannel {}

export interface WebMessageProcessingStorageServiceOptions {
  defaultAgentId: string;
  getAssistantName(): string;
  getUserName?(): string | null | undefined;
  processChat(
    channel: WebChannelLike,
    chatJid: string,
    agentId: string,
    threadRootId?: number,
  ): Promise<void>;
  storeWebMessage(
    channel: LinkPreviewChannel,
    params: StoreWebMessageParams,
    options: StoreWebMessageOptions,
  ): InteractionRow | null;
}

export function createWebMessageProcessingStorageService(
  channel: WebMessageProcessingStorageChannel,
  defaults: { defaultAgentId: string; getAssistantName(): string; getUserName?(): string | null | undefined },
): WebMessageProcessingStorageService {
  return new WebMessageProcessingStorageService(channel, {
    defaultAgentId: defaults.defaultAgentId,
    getAssistantName: defaults.getAssistantName,
    getUserName: defaults.getUserName,
    processChat: (target, chatJid, agentId, threadRootId) =>
      processAgentChat(target, chatJid, agentId, threadRootId),
    storeWebMessage: (target, params, options) => persistWebMessage(target, params, options),
  });
}

export class WebMessageProcessingStorageService {
  constructor(
    private readonly channel: WebMessageProcessingStorageChannel,
    private readonly options: WebMessageProcessingStorageServiceOptions,
  ) {}

  processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void> {
    return this.options.processChat(this.channel, chatJid, agentId, threadRootId ?? undefined);
  }

  storeMessage(
    chatJid: string,
    content: string,
    isBot: boolean,
    mediaIds: number[],
    options: WebChannelStoreMessageOptions = {},
  ): InteractionRow | null {
    // Capture the host port before entering SQL; request fields never select it.
    const materializeQueuedSource = !isBot && typeof options.consumeDeferredFollowupRowId === 'number'
      ? this.channel.getQueuedInputMaterialization?.(chatJid) : undefined;
    const interaction = this.options.storeWebMessage(
      this.channel,
      {
        chatJid,
        content,
        isBot,
        mediaIds,
        agentId: this.options.defaultAgentId,
        agentName: this.options.getAssistantName(),
        userName: this.options.getUserName?.() ?? null,
      },
      {
        contentBlocks: options.contentBlocks,
        linkPreviews: options.linkPreviews,
        threadId: options.threadId ?? null,
        screenHint: options.screenHint,
        isTerminalAgentReply: options.isTerminalAgentReply,
        isSteeringMessage: options.isSteeringMessage,
        removeProtectedContinuationForSourceMessageId: options.removeProtectedContinuationForSourceMessageId,
        consumeDeferredFollowupRowId: options.consumeDeferredFollowupRowId,
        materializeQueuedSource,
        acceptMaterializedSource: !isBot && typeof options.consumeDeferredFollowupRowId === 'number' && !isSlashCommandInvocation(content.trim())
          ? this.channel.getInputSourceAdmission?.(chatJid) : undefined,
      },
    );
    recordTimelineInteraction(interaction);
    return interaction;
  }

  async admitUserMessage(chatJid: string, content: string, mediaIds: number[], options: WebUserMessageStoreOptions,
    authorise: () => void, signal: AbortSignal, deferBeforeInsert?: () => boolean): Promise<InteractionRow | null> {
    const interaction = await admitWebUserMessage(this.channel, {
      chatJid, content, isBot: false, mediaIds,
      agentId: this.options.defaultAgentId, agentName: this.options.getAssistantName(), userName: this.options.getUserName?.() ?? null,
    }, options, authorise, signal, deferBeforeInsert);
    if (!interaction) return null;
    try { recordTimelineInteraction(interaction); }
    catch (error) { debugSuppressedError(log, 'Optional recording failed after incoming message commit.', error, { operation: 'web_message_storage.record_after_commit', rowId: interaction.id }); }
    return interaction;
  }
}
