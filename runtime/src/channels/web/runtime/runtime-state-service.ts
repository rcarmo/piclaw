/**
 * channels/web/runtime-state-service.ts – WebChannel local UI observations.
 *
 * Public SDK watches rebuild bounded
 * process-local status and streamed model buffers; these observations are never
 * persisted as execution or recovery authority.
 */

import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";

import { registerPreShutdownHook } from "../../../runtime/shutdown-registry.js";
import { AgentBuffers } from "../agent/agent-buffers.js";
import { AgentStatusStore } from "../agent/agent-status-store.js";
import { getMessageThreadRootIdById } from "../../../db.js";

interface AgentStatusStoreLike {
  update(chatJid: string, status: Record<string, unknown>): void;
  get(chatJid: string): Record<string, unknown> | null;
  dispose(): void;
}

interface AgentBuffersLike {
  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void;
  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean;
  updateBuffer(turnId: string, panel: "thought" | "draft", text: string, totalLines: number): void;
  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined;
}

/** Optional injected stores for seam-level tests. */
export interface WebChannelRuntimeStateServiceDeps {
  agentStatusStore?: AgentStatusStoreLike;
  agentBuffers?: AgentBuffersLike;
}

/** Local UI observations only; no admission, queue, execution or recovery owner. */
export class WebChannelRuntimeStateService {
  private readonly agentStatusStore: AgentStatusStoreLike;
  private readonly agentBuffers: AgentBuffersLike;
  private readonly unregisterShutdown: () => void;
  private disposed = false;

  constructor(deps: WebChannelRuntimeStateServiceDeps = {}) {
    this.agentStatusStore = deps.agentStatusStore ?? new AgentStatusStore();
    this.agentBuffers = deps.agentBuffers ?? new AgentBuffers();
    this.unregisterShutdown = registerPreShutdownHook(() => this.dispose());
  }

  dispose(): void {
    if (this.disposed) return;
    this.agentStatusStore.dispose();
    this.unregisterShutdown();
    this.disposed = true;
  }

  getThreadRootId(chatJid: string, messageId: string): number | null {
    return getMessageThreadRootIdById(chatJid, messageId);
  }

  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void {
    // Only public SDK watch observations describe native execution. Host worker
    // lanes, control intents and terminal settlement cannot start/finish a run.
    if (this.disposed || status.sdk_observation !== true) return;
    this.agentStatusStore.update(chatJid, status);
  }

  getAgentStatus(chatJid: string): Record<string, unknown> | null {
    if (this.disposed) return null;
    return this.agentStatusStore.get(chatJid);
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

  }

  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined {
    return this.agentBuffers.getBuffer(turnId, panel);
  }
}
