/**
 * channels/web/message-processing-storage-service.ts – WebChannel message processing/storage seam.
 *
 * Owns the thin adapter layer for WebChannel's public processChat() and
 * admitMessage() methods so WebChannel can remain a coordinator while the
 * existing handler/persistence behavior stays unchanged.
 */

import type { InteractionRow } from "../../../db.js";
import { isSlashCommandInvocation } from "../../../agent-control/agent-control-parser.js";
import { processChat as processAgentChat } from "../handlers/agent.js";
import type { LinkPreviewChannel } from "../media/link-previews.js";
import {
  admitWebMessage,
  type StoreWebMessageOptions,
} from "./message-store.js";
import type { WebChannelLike } from "../core/web-channel-contracts.js";
import { recordTimelineInteraction } from "../../../session-recordings/session-recordings.js";
import { createLogger, debugSuppressedError } from '../../../utils/logger.js';
const log = createLogger('web.message-processing-storage');

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

  async admitMessage(chatJid: string, content: string, isBot: boolean, mediaIds: number[], options: StoreWebMessageOptions,
    authorise?: (phase?: 'before' | 'after') => void, signal?: AbortSignal, deferBeforeInsert?: () => boolean): Promise<InteractionRow | null> {
    if (!isBot && typeof options.consumeDeferredFollowupRowId === "number") {
      options = { ...options, materializeQueuedSource: this.channel.getQueuedInputMaterialization?.(chatJid),
        acceptMaterializedSource: !isSlashCommandInvocation(content.trim()) ? this.channel.getInputSourceAdmission?.(chatJid) : undefined };
    }
    const interaction = await admitWebMessage(this.channel, {
      chatJid, content, isBot, mediaIds, agentId: this.options.defaultAgentId,
      agentName: this.options.getAssistantName(), userName: this.options.getUserName?.() ?? null,
    }, options, authorise, signal, deferBeforeInsert);
    if (!interaction) return null;
    try { recordTimelineInteraction(interaction); }
    catch (error) { debugSuppressedError(log, 'Optional recording failed after message commit.', error, { operation: 'web_message_storage.record_after_commit', rowId: interaction.id }); }
    return interaction;
  }

}
