/**
 * channels/web/runtime-followup-facade-service.ts – extracted WebChannel runtime/follow-up facade seam.
 *
 * Keeps the remaining queued-followup and runtime-state
 * facade methods behind a narrower service so `channels/web.ts` can stay a thin
 * coordinator without changing its public method signatures.
 */

import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";
import type { QueuedFollowupItem } from "../../../queued-followups.js";
import type { SendMessageOptions, WebMessageWriteService } from "../message-write-service.js";
import type { QueuedFollowupLifecycleService } from "./queued-followup-lifecycle-service.js";
import type { WebChannelRuntimeStateService } from "./runtime-state-service.js";

type RuntimeFollowupMessageWriteService = Pick<
  WebMessageWriteService,
  "sendMessage" | "postDashboardWidget"
>;

type RuntimeFollowupQueuedLifecycle = Pick<
  QueuedFollowupLifecycleService,
  | "enqueueQueuedFollowupItem"
  | "admitQueuedFollowupItem"
  | "peekQueuedFollowupItem"
  | "consumeQueuedFollowupItem"
  | "prependQueuedFollowupItem"
  | "replaceQueuedFollowupItem"
  | "getQueuedFollowupCount"
  | "getQueuedFollowupItems"
  | "removeQueuedFollowupItem"
>;

type RuntimeFollowupRuntimeState = Pick<
  WebChannelRuntimeStateService,
  | "updateAgentStatus"
  | "getAgentStatus"
  | "getThreadRootId"
  | "resumeChat"
  | "resumePendingChats"
  | "setPanelExpanded"
  | "isPanelExpanded"
  | "updateThoughtBuffer"
  | "updateDraftBuffer"
  | "getBuffer"
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

  enqueueQueuedFollowupItem(
    chatJid: string,
    rowId: number,
    queuedContent: string,
    threadId?: number | null,
    queuedAt?: string,
    extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[]; screenHint?: string; source?: string; queuedBy?: QueuedFollowupItem["queuedBy"] },
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

  admitQueuedFollowupItem(args: Parameters<QueuedFollowupLifecycleService['enqueueQueuedFollowupItem']>, authorise: () => void, signal: AbortSignal, acceptSource?: import('./queued-followup-lifecycle-service.js').QueuedInputSourceAdmission): Promise<number> {
    return this.deps.getQueuedFollowupLifecycle().admitQueuedFollowupItem(args, authorise, signal, acceptSource);
  }

  peekQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null {
    return this.deps.getQueuedFollowupLifecycle().peekQueuedFollowupItem(chatJid);
  }

  consumeQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null {
    return this.deps.getQueuedFollowupLifecycle().consumeQueuedFollowupItem(chatJid);
  }

  prependQueuedFollowupItem(chatJid: string, item: QueuedFollowupItem): void {
    this.deps.getQueuedFollowupLifecycle().prependQueuedFollowupItem(chatJid, item);
  }

  replaceQueuedFollowupItem(chatJid: string, item: QueuedFollowupItem): boolean {
    return this.deps.getQueuedFollowupLifecycle().replaceQueuedFollowupItem(chatJid, item);
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

  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void {
    this.deps.getRuntimeState().updateAgentStatus(chatJid, status);
  }

  getAgentStatus(chatJid: string): Record<string, unknown> | null {
    return this.deps.getRuntimeState().getAgentStatus(chatJid);
  }

  getThreadRootId(chatJid: string, messageId: string): number | null {
    return this.deps.getRuntimeState().getThreadRootId(chatJid, messageId);
  }

  resumeChat(chatJid: string, threadRootId?: number | null): void {
    this.deps.getRuntimeState().resumeChat(chatJid, threadRootId);
  }

  resumePendingChats(chatJid?: string): void {
    this.deps.getRuntimeState().resumePendingChats(chatJid);
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
