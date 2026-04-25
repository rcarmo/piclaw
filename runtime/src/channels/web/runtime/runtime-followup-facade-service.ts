/**
 * channels/web/runtime-followup-facade-service.ts – extracted WebChannel runtime/follow-up facade seam.
 *
 * Keeps the remaining queued-followup, runtime-state, and queued-placeholder
 * facade methods behind a narrower service so `channels/web.ts` can stay a thin
 * coordinator without changing its public method signatures.
 */

import type { InteractionRow } from "../../../db.js";
import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";
import type { QueuedFollowupItem } from "./followup-placeholders.js";
import type { SendMessageOptions } from "../messaging/message-write-flows.js";
import type { WebMessageWriteService } from "../message-write-service.js";
import type { QueuedFollowupLifecycleService } from "./queued-followup-lifecycle-service.js";
import type { WebChannelRuntimeStateService } from "./runtime-state-service.js";

type RuntimeFollowupMessageWriteService = Pick<
  WebMessageWriteService,
  "sendMessage" | "postDashboardWidget" | "queueFollowupPlaceholder" | "replaceQueuedFollowupPlaceholder"
>;

type RuntimeFollowupQueuedLifecycle = Pick<
  QueuedFollowupLifecycleService,
  | "enqueueQueuedFollowupItem"
  | "consumeQueuedFollowupItem"
  | "prependQueuedFollowupItem"
  | "consumeQueuedFollowupPlaceholder"
  | "getQueuedFollowupCount"
  | "getQueuedFollowupItems"
  | "removeQueuedFollowupItem"
>;

type RuntimeFollowupRuntimeState = Pick<
  WebChannelRuntimeStateService,
  | "queuePendingSteering"
  | "consumePendingSteering"
  | "updateAgentStatus"
  | "getAgentStatus"
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

export interface WebChannelRuntimeFollowupFacadeServiceDeps {
  getMessageWriteService(): RuntimeFollowupMessageWriteService;
  getQueuedFollowupLifecycle(): RuntimeFollowupQueuedLifecycle;
  getRuntimeState(): RuntimeFollowupRuntimeState;
}

export class WebChannelRuntimeFollowupFacadeService {
  constructor(private readonly deps: WebChannelRuntimeFollowupFacadeServiceDeps) {}

  async sendMessage(chatJid: string, text: string, options?: SendMessageOptions): Promise<void> {
    await this.deps.getMessageWriteService().sendMessage(chatJid, text, options);
  }

  async postDashboardWidget(
    chatJid: string,
    options?: { threadId?: number | null; text?: string; widgetId?: string },
  ): Promise<void> {
    await this.deps.getMessageWriteService().postDashboardWidget(chatJid, options);
  }

  queueFollowupPlaceholder(
    chatJid: string,
    text: string,
    threadId?: number,
    queuedContent?: string,
  ): InteractionRow | null {
    return this.deps.getMessageWriteService().queueFollowupPlaceholder(chatJid, text, threadId, queuedContent);
  }

  enqueueQueuedFollowupItem(
    chatJid: string,
    rowId: number,
    queuedContent: string,
    threadId?: number | null,
    queuedAt?: string,
    extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[] },
  ): number {
    return this.deps.getQueuedFollowupLifecycle().enqueueQueuedFollowupItem(
      chatJid,
      rowId,
      queuedContent,
      threadId,
      queuedAt,
      extras,
    );
  }

  consumeQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null {
    return this.deps.getQueuedFollowupLifecycle().consumeQueuedFollowupItem(chatJid);
  }

  prependQueuedFollowupItem(chatJid: string, item: QueuedFollowupItem): void {
    this.deps.getQueuedFollowupLifecycle().prependQueuedFollowupItem(chatJid, item);
  }

  consumeQueuedFollowupPlaceholder(chatJid: string): number | null {
    return this.deps.getQueuedFollowupLifecycle().consumeQueuedFollowupPlaceholder(chatJid);
  }

  getQueuedFollowupCount(chatJid: string): number {
    return this.deps.getQueuedFollowupLifecycle().getQueuedFollowupCount(chatJid);
  }

  getQueuedFollowupItems(chatJid: string): QueuedFollowupItem[] {
    return this.deps.getQueuedFollowupLifecycle().getQueuedFollowupItems(chatJid);
  }

  removeQueuedFollowupItem(chatJid: string, rowId: number): QueuedFollowupItem | null {
    return this.deps.getQueuedFollowupLifecycle().removeQueuedFollowupItem(chatJid, rowId);
  }

  queuePendingSteering(chatJid: string, timestamp: string | undefined): void {
    this.deps.getRuntimeState().queuePendingSteering(chatJid, timestamp);
  }

  consumePendingSteering(chatJid: string): string[] {
    return this.deps.getRuntimeState().consumePendingSteering(chatJid);
  }

  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void {
    this.deps.getRuntimeState().updateAgentStatus(chatJid, status);
  }

  getAgentStatus(chatJid: string): Record<string, unknown> | null {
    return this.deps.getRuntimeState().getAgentStatus(chatJid);
  }

  setContextUsage(chatJid: string, usage: Record<string, unknown> | null): void {
    this.deps.getRuntimeState().setContextUsage(chatJid, usage);
  }

  getContextUsage(chatJid: string): Record<string, unknown> | null {
    return this.deps.getRuntimeState().getContextUsage(chatJid);
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
    return this.deps.getMessageWriteService().replaceQueuedFollowupPlaceholder(
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
    return this.deps.getRuntimeState().getThreadRootId(chatJid, messageId);
  }

  resumeChat(chatJid: string, threadRootId?: number | null): void {
    this.deps.getRuntimeState().resumeChat(chatJid, threadRootId);
  }

  skipFailedOnModelSwitch(chatJid: string): boolean {
    return this.deps.getRuntimeState().skipFailedOnModelSwitch(chatJid);
  }

  retryFailedOnModelSwitch(chatJid: string): boolean {
    return this.deps.getRuntimeState().retryFailedOnModelSwitch(chatJid);
  }

  recoverInflightRuns(): void {
    this.deps.getRuntimeState().recoverInflightRuns();
  }

  recoverStaleInflightRun(chatJid: string, options?: { hasActiveStatus?: boolean; minAgeMs?: number }): boolean {
    return this.deps.getRuntimeState().recoverStaleInflightRun(chatJid, options);
  }

  resumePendingChats(chatJid?: string): void {
    this.deps.getRuntimeState().resumePendingChats(chatJid);
  }

  loadState(): void {
    this.deps.getRuntimeState().loadState();
  }

  saveState(): void {
    this.deps.getRuntimeState().saveState();
  }

  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void {
    this.deps.getRuntimeState().setPanelExpanded(turnId, panel, expanded);
  }

  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean {
    return this.deps.getRuntimeState().isPanelExpanded(turnId, panel);
  }

  updateThoughtBuffer(turnId: string, text: string, totalLines: number): void {
    this.deps.getRuntimeState().updateThoughtBuffer(turnId, text, totalLines);
  }

  updateDraftBuffer(turnId: string, text: string, totalLines: number): void {
    this.deps.getRuntimeState().updateDraftBuffer(turnId, text, totalLines);
  }

  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined {
    return this.deps.getRuntimeState().getBuffer(turnId, panel);
  }
}
