/**
 * web/channel-state.ts – Persistent state for the web channel.
 *
 * After moving cursor positions and failed-run records into the `chat_cursors`
 * DB table (db/chat-cursors.ts), this class is responsible only for
 * transient per-chat agent status payloads that the UI polls for.
 *
 * Most persisted agentStatuses are cleared on startup because they are just
 * ephemeral UI hints from the previous process. The one intentional exception
 * is the restart-restorable compaction indicator, whose original started_at
 * timestamp lets the web UI keep showing a meaningful elapsed timer while
 * recovery resumes the interrupted turn.
 *
 * Consumers: channels/web.ts reads/writes state during agent run
 *            orchestration and SSE broadcasting.
 */

import { getRouterState, setRouterState } from "../../../db.js";

export interface PersistedDraftRecoveryEntry {
  turnId?: string;
  text: string;
  totalLines: number;
  updatedAt: number;
}

/** Persistent per-chat state manager for the web channel. */
export class WebChannelState {
  agentStatuses: Record<string, Record<string, unknown>> = {};
  contextUsages: Record<string, Record<string, unknown>> = {};
  draftRecoveries: Record<string, PersistedDraftRecoveryEntry> = {};

  constructor(private stateKey: string) {}

  load(): void {
    const data = getRouterState(this.stateKey);
    try {
      const parsed = data ? JSON.parse(data) : {};
      this.agentStatuses =
        parsed && typeof parsed === "object" && typeof parsed.agentStatuses === "object"
          ? (parsed.agentStatuses as Record<string, Record<string, unknown>>)
          : {};
      this.contextUsages =
        parsed && typeof parsed === "object" && typeof parsed.contextUsages === "object"
          ? (parsed.contextUsages as Record<string, Record<string, unknown>>)
          : {};
      this.draftRecoveries =
        parsed && typeof parsed === "object" && typeof parsed.draftRecoveries === "object"
          ? (parsed.draftRecoveries as Record<string, PersistedDraftRecoveryEntry>)
          : {};
    } catch {
      this.agentStatuses = {};
      this.contextUsages = {};
      this.draftRecoveries = {};
    }
  }

  save(): void {
    setRouterState(
      this.stateKey,
      JSON.stringify({ agentStatuses: this.agentStatuses, contextUsages: this.contextUsages, draftRecoveries: this.draftRecoveries })
    );
  }

  setAgentStatus(chatJid: string, status: Record<string, unknown> | null): void {
    if (!status) {
      delete this.agentStatuses[chatJid];
      return;
    }
    this.agentStatuses[chatJid] = status;
  }

  getAgentStatuses(): Record<string, Record<string, unknown>> {
    return { ...this.agentStatuses };
  }

  setContextUsage(chatJid: string, usage: Record<string, unknown> | null): void {
    if (!usage) {
      delete this.contextUsages[chatJid];
      return;
    }
    this.contextUsages[chatJid] = usage;
  }

  getContextUsage(chatJid: string): Record<string, unknown> | null {
    return this.contextUsages[chatJid] ?? null;
  }

  setDraftRecovery(chatJid: string, entry: PersistedDraftRecoveryEntry | null): void {
    if (!entry) {
      delete this.draftRecoveries[chatJid];
      return;
    }
    this.draftRecoveries[chatJid] = entry;
  }

  getDraftRecovery(chatJid: string): PersistedDraftRecoveryEntry | null {
    return this.draftRecoveries[chatJid] ?? null;
  }
}
