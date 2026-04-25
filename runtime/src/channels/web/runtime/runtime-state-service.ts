/**
 * channels/web/runtime-state-service.ts – WebChannel recovery/resume wiring and runtime state delegation.
 *
 * Owns the narrow seam around restart recovery, resume context construction,
 * persisted agent-status state, pending steering, and streamed thought/draft
 * buffer delegation so `channels/web.ts` can stay focused on request/runtime
 * orchestration without changing the public WebChannel API.
 */

import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";

const RECOVERY_REPLAY_DELAY_MS = 2000;
import { AgentBuffers } from "../agent/agent-buffers.js";
import { AgentStatusStore } from "../agent/agent-status-store.js";
import { WebChannelState } from "./channel-state.js";
import {
  getThreadRootId as getThreadRootIdForChat,
  resumeChat as resumeWebChat,
  retryFailedOnModelSwitch as retryFailedOnModelSwitchForChat,
  skipFailedOnModelSwitch as skipFailedOnModelSwitchForChat,
  type ChatRunControlStore,
  type ResumeChatContext,
} from "./chat-run-control.js";
import { PendingSteeringStore } from "./pending-steering.js";
import {
  recoverInflightRuns as recoverWebInflightRuns,
  recoverStaleInflightRun as recoverWebStaleInflightRun,
  resumePendingChats as resumeWebPendingChats,
  type PersistedDraftRecoveryEntry,
  type RecoverStaleInflightRunOptions,
  type WebRecoveryContext,
  type WebRecoveryStore,
} from "./recovery.js";

/** Runtime callbacks required to bridge recovery/resume helpers back into WebChannel orchestration. */
export interface WebChannelRuntimeStateCallbacks {
  getAssistantName(): string;
  getChatCursor(chatJid: string): string;
  enqueue(task: () => Promise<void>, key: string, laneKey?: string): void;
  processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void>;
}

/** Fixed options for a WebChannel runtime-state service instance. */
export interface WebChannelRuntimeStateOptions {
  defaultAgentId: string;
  stateKey: string;
}

interface WebChannelStateStoreLike {
  load(): void;
  save(): void;
  setAgentStatus(chatJid: string, status: Record<string, unknown> | null): void;
  getAgentStatuses(): Record<string, Record<string, unknown>>;
  setContextUsage(chatJid: string, usage: Record<string, unknown> | null): void;
  getContextUsage(chatJid: string): Record<string, unknown> | null;
  setDraftRecovery(chatJid: string, entry: PersistedDraftRecoveryEntry | null): void;
  getDraftRecovery(chatJid: string): PersistedDraftRecoveryEntry | null;
}

interface PendingSteeringStoreLike {
  queue(chatJid: string, timestamp: string | undefined): void;
  consumeAll(chatJid: string): string[];
}

interface AgentStatusStoreLike {
  load(): void;
  update(chatJid: string, status: Record<string, unknown>): void;
  get(chatJid: string): Record<string, unknown> | null;
}

interface AgentBuffersLike {
  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void;
  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean;
  updateBuffer(turnId: string, panel: "thought" | "draft", text: string, totalLines: number): void;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
}

/** Optional injected stores for seam-level tests. */
export interface WebChannelRuntimeStateServiceDeps {
  state?: WebChannelStateStoreLike;
  pendingSteeringStore?: PendingSteeringStoreLike;
  agentStatusStore?: AgentStatusStoreLike;
  agentBuffers?: AgentBuffersLike;
}

/**
 * Dedicated seam for WebChannel recovery/resume wiring and runtime state.
 *
 * WebChannel keeps the same public methods; they now forward into this service.
 */
export class WebChannelRuntimeStateService {
  private readonly state: WebChannelStateStoreLike;
  private readonly pendingSteeringStore: PendingSteeringStoreLike;
  private readonly agentStatusStore: AgentStatusStoreLike;
  private readonly agentBuffers: AgentBuffersLike;
  private readonly draftRecoveryChatByTurnId = new Map<string, string>();

  constructor(
    private readonly callbacks: WebChannelRuntimeStateCallbacks,
    private readonly options: WebChannelRuntimeStateOptions,
    deps: WebChannelRuntimeStateServiceDeps = {}
  ) {
    this.state = deps.state ?? new WebChannelState(options.stateKey);
    this.pendingSteeringStore = deps.pendingSteeringStore ?? new PendingSteeringStore();
    this.agentStatusStore = deps.agentStatusStore ?? new AgentStatusStore(this.state);
    this.agentBuffers = deps.agentBuffers ?? new AgentBuffers();
  }

  private getResumeChatContext(): ResumeChatContext {
    return {
      defaultAgentId: this.options.defaultAgentId,
      enqueue: (task, key, laneKey) => this.callbacks.enqueue(task, key, laneKey),
      processChat: (chatJid, agentId, threadRootId) => this.callbacks.processChat(chatJid, agentId, threadRootId),
    };
  }

  private getRecoveryContext(): WebRecoveryContext {
    return {
      assistantName: this.callbacks.getAssistantName(),
      defaultAgentId: this.options.defaultAgentId,
      enqueue: (task, key, laneKey) => this.callbacks.enqueue(task, key, laneKey),
      processChat: (chatJid, agentId, threadRootId) =>
        this.callbacks.processChat(chatJid, agentId, threadRootId ?? undefined),
      getDraftRecovery: (chatJid) => this.state.getDraftRecovery(chatJid),
      clearDraftRecovery: (chatJid) => {
        this.state.setDraftRecovery(chatJid, null);
        this.state.save();
      },
      recoveryDelayMs: RECOVERY_REPLAY_DELAY_MS,
      sleep: (ms) => Bun.sleep(ms),
    };
  }

  getThreadRootId(chatJid: string, messageId: string, store?: ChatRunControlStore): number | null {
    return getThreadRootIdForChat(chatJid, messageId, store);
  }

  resumeChat(chatJid: string, threadRootId?: number | null): void {
    resumeWebChat(chatJid, threadRootId, this.getResumeChatContext());
  }

  skipFailedOnModelSwitch(chatJid: string, store?: ChatRunControlStore): boolean {
    return skipFailedOnModelSwitchForChat(chatJid, store);
  }

  retryFailedOnModelSwitch(chatJid: string, store?: ChatRunControlStore): boolean {
    return retryFailedOnModelSwitchForChat(chatJid, store);
  }

  recoverInflightRuns(store?: WebRecoveryStore): void {
    recoverWebInflightRuns(this.getRecoveryContext(), store);
  }

  recoverStaleInflightRun(chatJid: string, options?: RecoverStaleInflightRunOptions, store?: WebRecoveryStore): boolean {
    return recoverWebStaleInflightRun(this.getRecoveryContext(), chatJid, options, store);
  }

  resumePendingChats(chatJid?: string, store?: WebRecoveryStore): void {
    resumeWebPendingChats(this.getRecoveryContext(), chatJid, store);
  }

  loadState(): void {
    this.agentStatusStore.load();
  }

  saveState(): void {
    this.state.save();
  }

  queuePendingSteering(chatJid: string, timestamp: string | undefined): void {
    this.pendingSteeringStore.queue(chatJid, timestamp);
  }

  consumePendingSteering(chatJid: string): string[] {
    return this.pendingSteeringStore.consumeAll(chatJid);
  }

  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void {
    const turnId = typeof status?.turn_id === "string"
      ? status.turn_id
      : typeof status?.turnId === "string"
        ? status.turnId
        : "";
    if (turnId) {
      this.draftRecoveryChatByTurnId.set(turnId, chatJid);
    }
    if (status?.type === "done" || status?.type === "error") {
      if (turnId) {
        this.draftRecoveryChatByTurnId.delete(turnId);
      }
      this.state.setDraftRecovery(chatJid, null);
      this.state.save();
    }
    this.agentStatusStore.update(chatJid, status);
  }

  getAgentStatus(chatJid: string): Record<string, unknown> | null {
    return this.agentStatusStore.get(chatJid);
  }

  setContextUsage(chatJid: string, usage: Record<string, unknown> | null): void {
    this.state.setContextUsage(chatJid, usage);
    this.state.save();
  }

  getContextUsage(chatJid: string): Record<string, unknown> | null {
    return this.state.getContextUsage(chatJid);
  }

  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void {
    this.agentBuffers.setPanelExpanded(turnId, panel, expanded);
  }

  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean {
    return this.agentBuffers.isPanelExpanded(turnId, panel);
  }

  updateThoughtBuffer(turnId: string, text: string, totalLines: number): void {
    this.agentBuffers.updateBuffer(turnId, "thought", text, totalLines);
  }

  updateDraftBuffer(turnId: string, text: string, totalLines: number): void {
    this.agentBuffers.updateBuffer(turnId, "draft", text, totalLines);
    const chatJid = this.draftRecoveryChatByTurnId.get(turnId);
    if (!chatJid) return;
    const normalizedText = typeof text === "string" ? text : "";
    if (!normalizedText.trim()) {
      this.state.setDraftRecovery(chatJid, null);
      this.state.save();
      return;
    }
    this.state.setDraftRecovery(chatJid, {
      turnId,
      text: normalizedText,
      totalLines,
      updatedAt: Date.now(),
    });
    this.state.save();
  }

  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined {
    return this.agentBuffers.getBuffer(turnId, panel);
  }
}
