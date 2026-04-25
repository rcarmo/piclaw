import type { InteractionRow } from "../../../db.js";
import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";
import type { QueuedFollowupItem } from "../runtime/followup-placeholders.js";
import type { SendMessageOptions } from "../messaging/message-write-flows.js";
import type { WebMessageProcessingStorageService } from "../messaging/message-processing-storage-service.js";
import type { WebChannelRuntimeFollowupFacadeService } from "../runtime/runtime-followup-facade-service.js";
import type { WebSessionBroadcastService } from "../sse/session-broadcast-service.js";

type WebChannelRuntimePublicSurfaceFollowupFacade = Pick<
  WebChannelRuntimeFollowupFacadeService,
  | "sendMessage"
  | "postDashboardWidget"
  | "queueFollowupPlaceholder"
  | "enqueueQueuedFollowupItem"
  | "consumeQueuedFollowupItem"
  | "prependQueuedFollowupItem"
  | "consumeQueuedFollowupPlaceholder"
  | "getQueuedFollowupCount"
  | "getQueuedFollowupItems"
  | "removeQueuedFollowupItem"
  | "queuePendingSteering"
  | "consumePendingSteering"
  | "updateAgentStatus"
  | "getAgentStatus"
  | "replaceQueuedFollowupPlaceholder"
  | "getThreadRootId"
  | "resumeChat"
  | "skipFailedOnModelSwitch"
  | "retryFailedOnModelSwitch"
  | "recoverInflightRuns"
  | "recoverStaleInflightRun"
  | "resumePendingChats"
  | "loadState"
  | "saveState"
  | "setPanelExpanded"
  | "isPanelExpanded"
  | "updateThoughtBuffer"
  | "updateDraftBuffer"
  | "getBuffer"
  | "setContextUsage"
  | "getContextUsage"
>;

type WebChannelRuntimePublicSurfaceStorage = Pick<
  WebMessageProcessingStorageService,
  "processChat" | "storeMessage"
>;

type WebChannelRuntimePublicSurfaceBroadcast = Pick<
  WebSessionBroadcastService,
  "sse" | "uiBridge" | "broadcastEvent"
>;

export interface WebChannelRuntimePublicSurfaceChannel {
  runtimeFollowupFacade: WebChannelRuntimePublicSurfaceFollowupFacade;
  messageProcessingStorageService: WebChannelRuntimePublicSurfaceStorage;
  sessionBroadcast: WebChannelRuntimePublicSurfaceBroadcast;
}

export interface WebChannelRuntimePublicSurfaceServiceCarrier {
  runtimePublicSurfaceService?: WebChannelRuntimePublicSurfaceService;
}

export class WebChannelRuntimePublicSurfaceService {
  constructor(private readonly channel: WebChannelRuntimePublicSurfaceChannel) {}

  get sse(): WebSessionBroadcastService["sse"] {
    return this.channel.sessionBroadcast.sse;
  }

  get uiBridge(): WebSessionBroadcastService["uiBridge"] {
    return this.channel.sessionBroadcast.uiBridge;
  }

  async sendMessage(chatJid: string, text: string, options?: SendMessageOptions): Promise<void> {
    await this.channel.runtimeFollowupFacade.sendMessage(chatJid, text, options);
  }

  async postDashboardWidget(
    chatJid: string,
    options?: { threadId?: number | null; text?: string; widgetId?: string },
  ): Promise<void> {
    await this.channel.runtimeFollowupFacade.postDashboardWidget(chatJid, options);
  }

  queueFollowupPlaceholder(chatJid: string, text: string, threadId?: number, queuedContent?: string): InteractionRow | null {
    return this.channel.runtimeFollowupFacade.queueFollowupPlaceholder(chatJid, text, threadId, queuedContent);
  }

  enqueueQueuedFollowupItem(
    chatJid: string,
    rowId: number,
    queuedContent: string,
    threadId?: number | null,
    queuedAt?: string,
    extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[] },
  ): number {
    return this.channel.runtimeFollowupFacade.enqueueQueuedFollowupItem(
      chatJid,
      rowId,
      queuedContent,
      threadId,
      queuedAt,
      extras,
    );
  }

  consumeQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null {
    return this.channel.runtimeFollowupFacade.consumeQueuedFollowupItem(chatJid);
  }

  prependQueuedFollowupItem(chatJid: string, item: QueuedFollowupItem): void {
    this.channel.runtimeFollowupFacade.prependQueuedFollowupItem(chatJid, item);
  }

  consumeQueuedFollowupPlaceholder(chatJid: string): number | null {
    return this.channel.runtimeFollowupFacade.consumeQueuedFollowupPlaceholder(chatJid);
  }

  getQueuedFollowupCount(chatJid: string): number {
    return this.channel.runtimeFollowupFacade.getQueuedFollowupCount(chatJid);
  }

  getQueuedFollowupItems(chatJid: string): QueuedFollowupItem[] {
    return this.channel.runtimeFollowupFacade.getQueuedFollowupItems(chatJid);
  }

  removeQueuedFollowupItem(chatJid: string, rowId: number): QueuedFollowupItem | null {
    return this.channel.runtimeFollowupFacade.removeQueuedFollowupItem(chatJid, rowId);
  }

  queuePendingSteering(chatJid: string, timestamp: string | undefined): void {
    this.channel.runtimeFollowupFacade.queuePendingSteering(chatJid, timestamp);
  }

  consumePendingSteering(chatJid: string): string[] {
    return this.channel.runtimeFollowupFacade.consumePendingSteering(chatJid);
  }

  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void {
    this.channel.runtimeFollowupFacade.updateAgentStatus(chatJid, status);
  }

  getAgentStatus(chatJid: string): Record<string, unknown> | null {
    return this.channel.runtimeFollowupFacade.getAgentStatus(chatJid);
  }

  setContextUsage(chatJid: string, usage: Record<string, unknown> | null): void {
    this.channel.runtimeFollowupFacade.setContextUsage(chatJid, usage);
  }

  getContextUsage(chatJid: string): Record<string, unknown> | null {
    return this.channel.runtimeFollowupFacade.getContextUsage(chatJid);
  }

  replaceQueuedFollowupPlaceholder(
    chatJid: string,
    rowId: number,
    text: string,
    mediaIds: number[],
    contentBlocks: Array<Record<string, unknown>> | undefined,
    threadId?: number,
    isTerminalAgentReply?: boolean,
  ): InteractionRow | null {
    return this.channel.runtimeFollowupFacade.replaceQueuedFollowupPlaceholder(
      chatJid,
      rowId,
      text,
      mediaIds,
      contentBlocks,
      threadId,
      isTerminalAgentReply,
    );
  }

  getThreadRootId(chatJid: string, messageId: string): number | null {
    return this.channel.runtimeFollowupFacade.getThreadRootId(chatJid, messageId);
  }

  resumeChat(chatJid: string, threadRootId?: number | null): void {
    this.channel.runtimeFollowupFacade.resumeChat(chatJid, threadRootId);
  }

  skipFailedOnModelSwitch(chatJid: string): boolean {
    return this.channel.runtimeFollowupFacade.skipFailedOnModelSwitch(chatJid);
  }

  retryFailedOnModelSwitch(chatJid: string): boolean {
    return this.channel.runtimeFollowupFacade.retryFailedOnModelSwitch(chatJid);
  }

  recoverInflightRuns(): void {
    this.channel.runtimeFollowupFacade.recoverInflightRuns();
  }

  recoverStaleInflightRun(chatJid: string, options?: { hasActiveStatus?: boolean; minAgeMs?: number }): boolean {
    return this.channel.runtimeFollowupFacade.recoverStaleInflightRun(chatJid, options);
  }

  resumePendingChats(chatJid?: string): void {
    this.channel.runtimeFollowupFacade.resumePendingChats(chatJid);
  }

  loadState(): void {
    this.channel.runtimeFollowupFacade.loadState();
  }

  saveState(): void {
    this.channel.runtimeFollowupFacade.saveState();
  }

  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void {
    this.channel.runtimeFollowupFacade.setPanelExpanded(turnId, panel, expanded);
  }

  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean {
    return this.channel.runtimeFollowupFacade.isPanelExpanded(turnId, panel);
  }

  updateThoughtBuffer(turnId: string, text: string, totalLines: number): void {
    this.channel.runtimeFollowupFacade.updateThoughtBuffer(turnId, text, totalLines);
  }

  updateDraftBuffer(turnId: string, text: string, totalLines: number): void {
    this.channel.runtimeFollowupFacade.updateDraftBuffer(turnId, text, totalLines);
  }

  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined {
    return this.channel.runtimeFollowupFacade.getBuffer(turnId, panel);
  }

  broadcastEvent(eventType: string, data: unknown): void {
    this.channel.sessionBroadcast.broadcastEvent(eventType, data);
  }

  async processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void> {
    return this.channel.messageProcessingStorageService.processChat(chatJid, agentId, threadRootId);
  }

  storeMessage(
    chatJid: string,
    content: string,
    isBot: boolean,
    mediaIds: number[],
    options: {
      contentBlocks?: unknown[];
      linkPreviews?: unknown[];
      threadId?: number;
      isTerminalAgentReply?: boolean;
      isSteeringMessage?: boolean;
    } = {},
  ): InteractionRow | null {
    return this.channel.messageProcessingStorageService.storeMessage(chatJid, content, isBot, mediaIds, options);
  }
}

export function createWebChannelRuntimePublicSurfaceService(
  channel: WebChannelRuntimePublicSurfaceChannel,
): WebChannelRuntimePublicSurfaceService {
  return new WebChannelRuntimePublicSurfaceService(channel);
}

export function getWebChannelRuntimePublicSurfaceService(
  channel: WebChannelRuntimePublicSurfaceChannel & WebChannelRuntimePublicSurfaceServiceCarrier,
): WebChannelRuntimePublicSurfaceService {
  return channel.runtimePublicSurfaceService ?? createWebChannelRuntimePublicSurfaceService(channel);
}
