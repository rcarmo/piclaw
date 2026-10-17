/**
 * channels/web/agent-control-plane-service.ts – WebChannel control-plane wrapper seam.
 *
 * Owns the queue-state/remove/steer wrappers, branch lifecycle wrappers, and
 * autoresearch status/stop/dismiss wrappers that used to live directly on
 * `channels/web.ts`, preserving the public WebChannel surface while shrinking
 * the coordinator.
 */

import type { AgentPool } from "../../../agent-pool.js";
import {
  clearInflightMarker,
  getDeferredQueuedFollowups,
  exportArchivedBranchDownloadData,
  getInflightMessageId,
  getInflightRuns,
  getMessageThreadRootIdById,
  getPreflightRuns,
  type InteractionRow,
} from "../../../db.js";
import { createLogger } from "../../../utils/logger.js";
import type { AgentControlCommand, AgentControlResult } from "../../../agent-control/agent-control-types.js";
import type { QueuedFollowupItem } from "../runtime/followup-placeholders.js";
import { parseJsonObjectRequest } from "../json-body.js";
import type { QueuedFollowupLifecycleService } from "../runtime/queued-followup-lifecycle-service.js";
import { completeOobeForInstance, isProviderReadyOobeCompletedForInstance } from "../oobe-instance-state.js";
import {
  getAddonStatusPanelPayload,
  runAddonStatusPanelAction,
} from "../../../addons/runtime-contributions.js";
import {
  getProgressWatchdogTimeoutMs,
  getTrackedPhasesSnapshot,
  type ProgressWatchdogEntry,
} from "../../../runtime/progress-watchdog.js";

const log = createLogger("web");

export interface StalledWorkDiagnostic {
  detected: boolean;
  phase: ProgressWatchdogEntry["phase"];
  age_ms: number;
  threshold_ms: number | null;
  started_at: string;
  last_progress_at: string;
}

export function buildStalledWorkDiagnostic(
  progress: ProgressWatchdogEntry | null | undefined,
  options: { nowMs?: number; thresholdMs?: number } = {},
): StalledWorkDiagnostic | null {
  if (!progress) return null;
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const configuredThresholdMs = options.thresholdMs ?? getProgressWatchdogTimeoutMs();
  const thresholdMs = Number.isFinite(configuredThresholdMs) && configuredThresholdMs > 0
    ? Math.floor(configuredThresholdMs)
    : null;
  const ageMs = Math.max(0, nowMs - progress.lastProgressAt);
  return {
    detected: thresholdMs !== null && ageMs >= thresholdMs,
    phase: progress.phase,
    age_ms: ageMs,
    threshold_ms: thresholdMs,
    started_at: new Date(progress.startedAt).toISOString(),
    last_progress_at: new Date(progress.lastProgressAt).toISOString(),
  };
}

interface AgentQueueLike {
  enqueue(task: () => unknown, key: string, laneKey?: string): unknown;
}

type StoreMessageOptions = {
  contentBlocks?: unknown[];
  linkPreviews?: unknown[];
  threadId?: number;
  screenHint?: string | null;
  isSteeringMessage?: boolean;
};

type ControlPlaneAgentPool = AgentPool & {
  removeQueuedFollowupMessage?: (chatJid: string, queuedContent?: string) => Promise<boolean> | boolean;
  isStreaming?: (chatJid: string) => boolean;
  queueStreamingMessage?: (chatJid: string, content: string, mode: "steer") => Promise<{ queued: boolean }>;
  createForkedChatBranch?: (chatJid: string, options?: { agentName?: string | null }) => Promise<unknown>;
  createRootChatSession?: (agentName: string) => Promise<unknown>;
  renameChatBranch?: (chatJid: string, options?: { agentName?: string | null }) => Promise<unknown>;
  renameChatJid?: (oldJid: string, newJid: string) => Promise<unknown>;
  mergeChatBranchIntoParent?: (chatJid: string) => Promise<unknown>;
  pruneChatBranch?: (chatJid: string) => Promise<unknown>;
  permanentPurgeChatBranch?: (chatJid: string) => Promise<unknown>;
  restoreChatBranch?: (chatJid: string, options?: { agentName?: string | null }) => Promise<unknown>;
  applySlashCommand?: (chatJid: string, rawText: string) => Promise<{ status: string; message?: string }>;
  applyControlCommand?: (chatJid: string, command: AgentControlCommand) => Promise<AgentControlResult>;
  listActiveChats?: () => unknown[];
};

type ControlPlaneQueuedLifecycle = Pick<
  QueuedFollowupLifecycleService,
  "getQueuedFollowupCount" | "listQueuedStateItems" | "prependQueuedFollowupItem" | "removeQueuedFollowupForAction" | "reorderQueuedFollowupItems"
>;

export interface WebAgentControlPlaneServiceOptions {
  getAcceptedQueuedSteering?: (chatJid: string) => import('../../../agent-pool/durable-queued-steering.js').AcceptedQueuedSteering | undefined;
  getQueuedInputSourceWithdrawal?: (chatJid: string) => import('../runtime/queued-followup-lifecycle-service.js').QueuedInputSourceAdmission | undefined;
  defaultChatJid: string;
  defaultAgentId: string;
  json(payload: unknown, status?: number): Response;
  broadcastEvent(eventType: string, data: unknown): void;
  queue: AgentQueueLike;
  agentPool: ControlPlaneAgentPool;
  queuedFollowupLifecycle: ControlPlaneQueuedLifecycle;
  queuePendingSteering(chatJid: string, timestamp: string | undefined): void;
  storeMessage(
    chatJid: string,
    content: string,
    isBot: boolean,
    mediaIds: number[],
    options?: StoreMessageOptions,
  ): InteractionRow | null;
  processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void> | void;
  getAgentStatus?: (chatJid: string) => Record<string, unknown> | null;
  updateAgentStatus?: (chatJid: string, status: Record<string, unknown>) => void;
  getInflightMessageId?: typeof getInflightMessageId;
  getMessageThreadRootIdById?: typeof getMessageThreadRootIdById;
  getAutoresearchWidgetPayload?: (chatJid: string) => unknown;
  stopAutoresearchFromWeb?: (input: { chat_jid: string; generate_report: boolean }) => Promise<unknown>;
  dismissAutoresearchWidget?: (chatJid: string) => boolean;
}

export interface WebAgentControlPlaneChannelLike {
  getAcceptedQueuedSteering?: WebAgentControlPlaneServiceOptions['getAcceptedQueuedSteering'];
  getQueuedInputSourceWithdrawal?: WebAgentControlPlaneServiceOptions['getQueuedInputSourceWithdrawal'];
  json(payload: unknown, status?: number): Response;
  broadcastEvent(eventType: string, data: unknown): void;
  queue: AgentQueueLike;
  agentPool: ControlPlaneAgentPool;
  queuedFollowupLifecycle: ControlPlaneQueuedLifecycle;
  queuePendingSteering(chatJid: string, timestamp: string | undefined): void;
  storeMessage(
    chatJid: string,
    content: string,
    isBot: boolean,
    mediaIds: number[],
    options?: StoreMessageOptions,
  ): InteractionRow | null;
  processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void> | void;
  getAgentStatus?(chatJid: string): Record<string, unknown> | null;
  updateAgentStatus?(chatJid: string, status: Record<string, unknown>): void;
}

export function createWebAgentControlPlaneService(
  channel: WebAgentControlPlaneChannelLike,
  defaults: { defaultChatJid: string; defaultAgentId: string },
): WebAgentControlPlaneService {
  return new WebAgentControlPlaneService({
    defaultChatJid: defaults.defaultChatJid,
    defaultAgentId: defaults.defaultAgentId,
    json: (payload, status = 200) => channel.json(payload, status),
    broadcastEvent: (eventType, data) => channel.broadcastEvent(eventType, data),
    queue: channel.queue,
    agentPool: channel.agentPool,
    queuedFollowupLifecycle: channel.queuedFollowupLifecycle,
    get getAcceptedQueuedSteering() { return channel.getAcceptedQueuedSteering?.bind(channel); },
    get getQueuedInputSourceWithdrawal() { return channel.getQueuedInputSourceWithdrawal?.bind(channel); },
    queuePendingSteering: (chatJid, timestamp) => channel.queuePendingSteering(chatJid, timestamp),
    storeMessage: (chatJid, content, isBot, mediaIds, options) =>
      channel.storeMessage(chatJid, content, isBot, mediaIds, options),
    processChat: (chatJid, agentId, threadRootId) => channel.processChat(chatJid, agentId, threadRootId),
    getAgentStatus: (chatJid) => channel.getAgentStatus?.(chatJid) ?? null,
    updateAgentStatus: (chatJid, status) => channel.updateAgentStatus?.(chatJid, status),
  });
}

export class WebAgentControlPlaneService {
  constructor(private readonly options: WebAgentControlPlaneServiceOptions) {}

  async handleAutoresearchStatus(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const chatJid = this.resolveChatJid(url.searchParams.get("chat_jid"));
    try {
      if (this.options.getAutoresearchWidgetPayload) {
        return this.options.json(this.options.getAutoresearchWidgetPayload(chatJid));
      }
      return this.options.json(await getAddonStatusPanelPayload("autoresearch", chatJid));
    } catch (error) {
      log.warn("Failed to read autoresearch status", {
        operation: "handle_autoresearch_status",
        err: error,
      });
      return this.options.json(null);
    }
  }

  async handleAutoresearchStop(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string; generate_report?: boolean };
    const chatJid = this.resolveChatJid(payload.chat_jid);
    try {
      const result = this.options.stopAutoresearchFromWeb
        ? await this.options.stopAutoresearchFromWeb({
            chat_jid: chatJid,
            generate_report: payload.generate_report !== false,
          })
        : await runAddonStatusPanelAction("autoresearch", "stop", {
            chat_jid: chatJid,
            generate_report: payload.generate_report !== false,
          });
      return this.options.json({
        status: "ok",
        chat_jid: chatJid,
        result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.options.json({ error: message || "Failed to stop autoresearch experiment." }, 500);
    }
  }

  async handleAutoresearchDismiss(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string };
    const chatJid = this.resolveChatJid(payload.chat_jid);
    try {
      const result = this.options.dismissAutoresearchWidget
        ? this.options.dismissAutoresearchWidget(chatJid)
        : await runAddonStatusPanelAction("autoresearch", "dismiss", {
            chat_jid: chatJid,
          });
      return this.options.json({
        status: result ? "ok" : "noop",
        chat_jid: chatJid,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.options.json({ error: message || "Failed to dismiss autoresearch panel." }, 500);
    }
  }

  async handleAgentOobeComplete(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { kind?: string };
    const kind = typeof payload.kind === "string" && payload.kind.trim() ? payload.kind.trim() : "provider-ready";
    if (kind !== "provider-ready") {
      return this.options.json({ error: "Unsupported OOBE completion kind." }, 400);
    }

    completeOobeForInstance("provider-ready");
    return this.options.json({
      status: "ok",
      kind,
      provider_ready_completed_instance: isProviderReadyOobeCompletedForInstance(),
    });
  }

  async handleAgentQueueState(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const chatJid = this.resolveChatJid(url.searchParams.get("chat_jid"));
    const items = this.options.queuedFollowupLifecycle.listQueuedStateItems(chatJid);

    return this.options.json({
      count: items.length,
      items,
    });
  }

  async handleAgentQueueRemove(req: Request): Promise<Response> {
    const selectWithdrawal = this.options.getQueuedInputSourceWithdrawal;
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    try {
      const payload = parsed.payload as { chat_jid?: string; row_id?: number | string };
      const chatJid = this.resolveChatJid(payload.chat_jid);
      const rowId = this.parseRowId(payload.row_id);
      if (rowId === null) {
        return this.options.json({ error: "Missing or invalid row_id" }, 400);
      }

      const withdrawAcceptedSource = selectWithdrawal?.(chatJid);
      const { removed } = await this.options.queuedFollowupLifecycle.removeQueuedFollowupForAction(chatJid, rowId, {
        withdrawAcceptedSource,
        removeQueuedFollowupMessage: (jid, content) => this.options.agentPool.removeQueuedFollowupMessage?.(jid, content) ?? false,
      });
      if (!removed) {
        return this.options.json({ status: "ok", removed: false, count: this.options.queuedFollowupLifecycle.getQueuedFollowupCount(chatJid) }, 200);
      }

      this.options.broadcastEvent("agent_followup_removed", {
        chat_jid: chatJid,
        row_id: removed.rowId,
        thread_id: removed.threadId ?? null,
      });

      return this.options.json({
        status: "ok",
        removed: true,
        row_id: removed.rowId,
        count: this.options.queuedFollowupLifecycle.getQueuedFollowupCount(chatJid),
      });
    } catch (error) {
      // Host selectors/callbacks can carry private engine or source details.
      return this.options.json({ error: "Unable to remove queued follow-up" }, 500);
    }
  }

  async handleAgentQueueReorder(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    try {
      const payload = parsed.payload as { chat_jid?: string; from_index?: number; to_index?: number };
      const chatJid = this.resolveChatJid(payload.chat_jid);
      const fromIndex = typeof payload.from_index === "number" ? payload.from_index : -1;
      const toIndex = typeof payload.to_index === "number" ? payload.to_index : -1;

      const reordered = this.options.queuedFollowupLifecycle.reorderQueuedFollowupItems(chatJid, fromIndex, toIndex);
      return this.options.json({ status: "ok", reordered });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.options.json({ error: message }, 500);
    }
  }

  async handleAgentQueueSteer(req: Request): Promise<Response> {
    const selectSteering = this.options.getAcceptedQueuedSteering;
    let acceptedSteering = false;
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    try {
      const payload = parsed.payload as { chat_jid?: string; row_id?: number | string };
      const chatJid = this.resolveChatJid(payload.chat_jid);
      const rowId = this.parseRowId(payload.row_id);
      if (rowId === null) {
        return this.options.json({ error: "Missing or invalid row_id" }, 400);
      }

      // Detect protected accepted input before any legacy removal or SDK call.
      const queued = getDeferredQueuedFollowups(chatJid).find(item => item.rowId === rowId);
      if (queued?.source_accepted) {
        acceptedSteering = true;
        const host = selectSteering?.(chatJid);
        if (!host) return this.options.json({ error: 'Accepted input requires host cancellation' }, 500);
        const accept = host.accept.bind(host);
        const { interaction, dispatch } = await accept(rowId);
        void dispatch().catch((error) => {
          log.warn("Accepted steering dispatch remains pending", { err: error, chatJid });
        });
        this.options.broadcastEvent('agent_followup_removed', { chat_jid: chatJid, row_id: rowId, thread_id: queued.threadId ?? null });
        this.options.broadcastEvent('new_post', interaction);
        this.options.queuePendingSteering(chatJid, interaction.timestamp);
        this.options.broadcastEvent('agent_steer_queued', { chat_jid: chatJid,
          thread_id: interaction.data?.thread_id ?? null, source: 'queued-item' });
        // Host intent accepted; this does not promise provider placement/execution.
        return this.options.json({ status: 'ok', removed: true, row_id: rowId,
          queued: 'steer', steering_delivery: 'pending', user_message: interaction,
          count: this.options.queuedFollowupLifecycle.getQueuedFollowupCount(chatJid) }, 201);
      }
      const { removed } = await this.removeQueuedFollowupForAction(chatJid, rowId);
      if (!removed) {
        return this.options.json({ status: "ok", removed: false, count: this.options.queuedFollowupLifecycle.getQueuedFollowupCount(chatJid) }, 200);
      }

      this.options.broadcastEvent("agent_followup_removed", {
        chat_jid: chatJid,
        row_id: removed.rowId,
        thread_id: removed.threadId ?? null,
      });

      const steerContent = typeof removed.queuedContent === "string" ? removed.queuedContent.trim() : "";
      if (!steerContent) {
        return this.options.json({ status: "ok", removed: true, queued: false, count: this.options.queuedFollowupLifecycle.getQueuedFollowupCount(chatJid) }, 200);
      }

      const isStreaming = typeof this.options.agentPool.isStreaming === "function"
        ? this.options.agentPool.isStreaming(chatJid)
        : false;
      const inflightMessageId = (this.options.getInflightMessageId ?? getInflightMessageId)(chatJid);
      const activeThreadRootId = inflightMessageId
        ? (this.options.getMessageThreadRootIdById ?? getMessageThreadRootIdById)(chatJid, inflightMessageId)
        : null;
      const steerThreadId = removed.threadId ?? activeThreadRootId ?? null;

      const interaction = this.options.storeMessage(
        chatJid,
        steerContent,
        false,
        removed.mediaIds ?? [],
        {
          contentBlocks: Array.isArray(removed.contentBlocks) ? removed.contentBlocks : undefined,
          linkPreviews: Array.isArray(removed.linkPreviews) ? removed.linkPreviews : undefined,
          threadId: steerThreadId ?? undefined,
          screenHint: removed.screenHint,
          isSteeringMessage: isStreaming,
        }
      );
      if (!interaction) {
        this.options.queuedFollowupLifecycle.prependQueuedFollowupItem(chatJid, removed);
        this.options.broadcastEvent("agent_followup_queued", {
          chat_jid: chatJid,
          thread_id: removed.threadId ?? null,
          row_id: removed.rowId,
          content: removed.queuedContent,
          timestamp: removed.queuedAt,
        });
        return this.options.json({ error: "Failed to store message" }, 500);
      }

      this.options.broadcastEvent("new_post", interaction);

      if (isStreaming && typeof this.options.agentPool.queueStreamingMessage === "function") {
        const steerResult = await this.options.agentPool.queueStreamingMessage(chatJid, steerContent, "steer");
        if (steerResult.queued) {
          this.options.queuePendingSteering(chatJid, interaction.timestamp);
          const queuedAt = new Date().toISOString();
          this.options.broadcastEvent("agent_steer_queued", {
            chat_jid: chatJid,
            thread_id: interaction.data?.thread_id ?? steerThreadId ?? null,
            source: "queued-item",
            timestamp: queuedAt,
            content: steerContent,
          });
          return this.options.json({
            status: "ok",
            removed: true,
            row_id: removed.rowId,
            user_message: interaction,
            thread_id: interaction.data?.thread_id ?? steerThreadId ?? null,
            queued: "steer",
            count: this.options.queuedFollowupLifecycle.getQueuedFollowupCount(chatJid),
          }, 201);
        }
      }

      this.options.queue.enqueue(async () => {
        await this.options.processChat(chatJid, this.options.defaultAgentId, interaction.data?.thread_id ?? interaction.id);
      }, `chat:${chatJid}:${interaction.id}`, `chat:${chatJid}`);

      return this.options.json({
        status: "ok",
        removed: true,
        row_id: removed.rowId,
        user_message: interaction,
        thread_id: interaction.data?.thread_id ?? interaction.id ?? null,
        count: this.options.queuedFollowupLifecycle.getQueuedFollowupCount(chatJid),
      }, 201);
    } catch (error) {
      const message = acceptedSteering ? 'Accepted steering is unavailable.' : error instanceof Error ? error.message : String(error);
      return this.options.json({ error: message }, 500);
    }
  }

  async handleAgentRuns(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const requestedChatJid = typeof url.searchParams.get("chat_jid") === "string"
      ? url.searchParams.get("chat_jid")!.trim()
      : "";
    const activeChats = typeof this.options.agentPool.listActiveChats === "function"
      ? this.options.agentPool.listActiveChats()
      : [];
    const inflightRuns = getInflightRuns();
    const preflightRuns = getPreflightRuns();
    const progressByChat = new Map(getTrackedPhasesSnapshot().map((entry) => [entry.chatJid, entry]));
    const chatJids = new Set<string>();
    for (const chat of activeChats as Array<{ chat_jid?: unknown }>) {
      if (typeof chat.chat_jid === "string") chatJids.add(chat.chat_jid);
    }
    for (const run of inflightRuns) chatJids.add(run.chatJid);
    for (const run of preflightRuns) chatJids.add(run.chatJid);
    if (requestedChatJid) chatJids.add(requestedChatJid);

    const runs = [...chatJids]
      .filter((chatJid) => !requestedChatJid || chatJid === requestedChatJid)
      .map((chatJid) => {
        const active = (activeChats as unknown as Array<Record<string, unknown>>).find((chat) => chat.chat_jid === chatJid) ?? null;
        const status = this.options.getAgentStatus?.(chatJid) ?? null;
        const inflight = inflightRuns.find((run) => run.chatJid === chatJid) ?? null;
        const preflight = preflightRuns.find((run) => run.chatJid === chatJid) ?? null;
        const progress = progressByChat.get(chatJid) ?? null;
        const queued = this.options.queuedFollowupLifecycle.listQueuedStateItems(chatJid);
        return {
          chat_jid: chatJid,
          active,
          is_active: Boolean((active as { is_active?: unknown } | null)?.is_active || status || progress),
          status,
          inflight,
          preflight,
          progress,
          queue_count: queued.length,
          stalled_work: buildStalledWorkDiagnostic(progress),
        };
      });

    return this.options.json({ runs, inflight: inflightRuns, preflight: preflightRuns }, 200);
  }

  async handleAgentRunAbort(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);
    const payload = parsed.payload as { chat_jid?: string; turn_id?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) return this.options.json({ error: "Missing chat_jid" }, 400);

    const expectedTurnId = typeof payload.turn_id === "string" ? payload.turn_id.trim() : "";
    const status = this.options.getAgentStatus?.(chatJid) ?? null;
    const activeTurnId = typeof status?.turn_id === "string"
      ? status.turn_id
      : typeof status?.turnId === "string"
        ? status.turnId
        : "";
    if (expectedTurnId && activeTurnId && expectedTurnId !== activeTurnId) {
      return this.options.json({ error: "turn_id does not match the active run", chat_jid: chatJid, active_turn_id: activeTurnId }, 409);
    }
    if (typeof this.options.agentPool.applyControlCommand !== "function") {
      return this.options.json({ error: "Run abort is not available." }, 501);
    }

    log.warn("Operator requested agent run abort", {
      operation: "operator_run.abort",
      chatJid,
      requestedTurnId: expectedTurnId || null,
      activeTurnId: activeTurnId || null,
    });
    try {
      const result = await this.options.agentPool.applyControlCommand(chatJid, { type: "abort", raw: "/abort" });
      if (result.status === "error") {
        return this.options.json({ status: "error", error: result.message, chat_jid: chatJid, turn_id: activeTurnId || null, result }, 500);
      }
      return this.options.json({ status: "ok", chat_jid: chatJid, turn_id: activeTurnId || null, result }, 200);
    } catch (error) {
      log.error("Agent run abort failed", { operation: "operator_run.abort_failed", chatJid, error });
      return this.options.json({ status: "error", error: "Run abort failed.", chat_jid: chatJid, turn_id: activeTurnId || null }, 500);
    }
  }

  async handleAgentRunClearStale(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);
    const payload = parsed.payload as { chat_jid?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) return this.options.json({ error: "Missing chat_jid" }, 400);
    const hadInflight = getInflightRuns().some((run) => run.chatJid === chatJid);
    const hadPreflight = getPreflightRuns().some((run) => run.chatJid === chatJid);
    const hadStatus = Boolean(this.options.getAgentStatus?.(chatJid));
    clearInflightMarker(chatJid);
    if (hadStatus) {
      this.options.updateAgentStatus?.(chatJid, { type: "done", title: "Idle", source: "operator_clear_stale" });
    }
    log.warn("Operator cleared stale run markers", {
      operation: "operator_run.clear_stale",
      chatJid,
      hadInflight,
      hadPreflight,
      hadStatus,
    });
    return this.options.json({
      status: "ok",
      chat_jid: chatJid,
      cleared: hadInflight || hadPreflight || hadStatus,
      had_inflight: hadInflight,
      had_preflight: hadPreflight,
      had_status: hadStatus,
    }, 200);
  }

  async handleAgentRunDrainQueue(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);
    const payload = parsed.payload as { chat_jid?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) return this.options.json({ error: "Missing chat_jid" }, 400);
    const items = this.options.queuedFollowupLifecycle.listQueuedStateItems(chatJid) as Array<{ rowId?: unknown; row_id?: unknown }>;
    let removedCount = 0;
    for (const item of items) {
      const rowId = this.parseRowId((item.rowId ?? item.row_id) as number | string | undefined);
      if (rowId === null) continue;
      const { removed } = await this.removeQueuedFollowupForAction(chatJid, rowId);
      if (removed) removedCount += 1;
    }
    log.warn("Operator drained queued follow-ups", {
      operation: "operator_run.drain_queue",
      chatJid,
      queuedCount: items.length,
      removedCount,
    });
    this.options.broadcastEvent("agent_followup_drained", { chat_jid: chatJid, removed_count: removedCount });
    return this.options.json({ status: "ok", chat_jid: chatJid, removed_count: removedCount }, 200);
  }

  async handleAgentBranchFork(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { source_chat_jid?: string; agent_name?: string };
    const sourceChatJid = this.resolveChatJid(payload.source_chat_jid);
    const agentName = typeof payload.agent_name === "string" ? payload.agent_name.trim() : "";

    try {
      const branch = await this.options.agentPool.createForkedChatBranch?.(sourceChatJid, {
        agentName: agentName || null,
      });
      if (!branch) {
        return this.options.json({ error: "Branch forking is not available." }, 501);
      }
      return this.options.json({ status: "ok", branch }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Failed to fork branch.");
      return this.options.json({ error: message || "Failed to fork branch." }, 400);
    }
  }

  async handleAgentRootSessionCreate(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { agent_name?: string; root_name?: string };
    const agentName = typeof payload.agent_name === "string"
      ? payload.agent_name.trim()
      : (typeof payload.root_name === "string" ? payload.root_name.trim() : "");
    if (!agentName) return this.options.json({ error: "Missing agent_name" }, 400);

    try {
      const branch = await this.options.agentPool.createRootChatSession?.(agentName);
      if (!branch) {
        return this.options.json({ error: "Root session creation is not available." }, 501);
      }
      return this.options.json({ status: "ok", branch }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Failed to create root session.");
      return this.options.json({ error: message || "Failed to create root session." }, 400);
    }
  }

  async handleAgentBranchRename(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string; agent_name?: string };
    const chatJid = this.resolveChatJid(payload.chat_jid);
    const hasAgentName = typeof payload.agent_name === "string";
    if (!hasAgentName) {
      return this.options.json({ error: "Missing agent_name" }, 400);
    }

    try {
      const branch = await this.options.agentPool.renameChatBranch?.(chatJid, {
        agentName: payload.agent_name ?? null,
      });
      if (!branch) {
        return this.options.json({ error: "Branch renaming is not available." }, 501);
      }
      // Broadcast so all connected clients refresh their branch/agent lists.
      const effectiveChatJid = branch.chat_jid || chatJid;
      this.options.broadcastEvent("extension_ui_title", {
        chat_jid: effectiveChatJid,
        title: branch.agent_name || "",
      });
      return this.options.json({ status: "ok", branch }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Failed to rename branch.");
      return this.options.json({ error: message || "Failed to rename branch." }, 400);
    }
  }

  async handleAgentRenameJid(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { old_jid?: string; new_jid?: string; chat_jid?: string };
    const oldJid = String(payload.old_jid || payload.chat_jid || "").trim();
    const newJid = String(payload.new_jid || "").trim();
    if (!oldJid) return this.options.json({ error: "Missing old_jid (or chat_jid)" }, 400);
    if (!newJid) return this.options.json({ error: "Missing new_jid" }, 400);

    try {
      const result = await this.options.agentPool.renameChatJid?.(oldJid, newJid);
      if (!result) {
        return this.options.json({ error: "JID renaming is not available." }, 501);
      }
      // Broadcast so all connected clients refresh their branch/agent lists.
      this.options.broadcastEvent("extension_ui_title", {
        chat_jid: result.newJid || newJid,
        title: result.branch?.agent_name || "",
      });
      return this.options.json({ status: "ok", ...result }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Failed to rename JID.");
      return this.options.json({ error: message || "Failed to rename JID." }, 400);
    }
  }

  async handleAgentBranchMergeParent(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) {
      return this.options.json({ error: "Missing chat_jid" }, 400);
    }

    try {
      const result = await this.options.agentPool.mergeChatBranchIntoParent?.(chatJid);
      if (!result) {
        return this.options.json({ error: "Branch merge is not available." }, 501);
      }
      return this.options.json({ status: "ok", ...result }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Failed to merge branch into parent.");
      return this.options.json({ error: message || "Failed to merge branch into parent." }, 400);
    }
  }

  async handleAgentBranchPrune(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) {
      return this.options.json({ error: "Missing chat_jid" }, 400);
    }

    try {
      const branch = await this.options.agentPool.pruneChatBranch?.(chatJid);
      if (!branch) {
        return this.options.json({ error: "Branch pruning is not available." }, 501);
      }
      return this.options.json({ status: "ok", branch }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Failed to prune branch.");
      return this.options.json({ error: message || "Failed to prune branch." }, 400);
    }
  }

  handleAgentBranchDownload(req: Request): Response {
    const url = new URL(req.url);
    const chatJid = this.resolveRequiredChatJid(url.searchParams.get("chat_jid") || undefined);
    if (!chatJid) {
      return this.options.json({ error: "Missing chat_jid" }, 400);
    }

    try {
      const payload = exportArchivedBranchDownloadData(chatJid);
      const safeName = String(payload.branch.agent_name || payload.branch.chat_jid || "archived-session")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "archived-session";
      return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="piclaw-archived-session-${safeName}.json"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Failed to download archived branch.");
      return this.options.json({ error: message || "Failed to download archived branch." }, 400);
    }
  }

  async handleAgentBranchPurge(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) {
      return this.options.json({ error: "Missing chat_jid" }, 400);
    }

    try {
      const result = await this.options.agentPool.permanentPurgeChatBranch?.(chatJid);
      if (!result) {
        return this.options.json({ error: "Archived-branch purge is not available." }, 501);
      }
      return this.options.json({ status: "ok", ...result }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Failed to permanently delete archived branch.");
      return this.options.json({ error: message || "Failed to permanently delete archived branch." }, 400);
    }
  }

  async handleAgentBranchRestore(req: Request): Promise<Response> {
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string; agent_name?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) {
      return this.options.json({ error: "Missing chat_jid" }, 400);
    }

    try {
      const branch = await this.options.agentPool.restoreChatBranch?.(chatJid, {
        ...(typeof payload.agent_name === "string" ? { agentName: payload.agent_name } : {}),
      });
      if (!branch) {
        return this.options.json({ error: "Branch restore is not available." }, 501);
      }
      return this.options.json({ status: "ok", branch }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Failed to restore branch.");
      return this.options.json({ error: message || "Failed to restore branch." }, 400);
    }
  }

  private resolveChatJid(chatJid: string | null | undefined): string {
    return typeof chatJid === "string" && chatJid.trim() ? chatJid.trim() : this.options.defaultChatJid;
  }

  private resolveRequiredChatJid(chatJid: string | null | undefined): string {
    return typeof chatJid === "string" && chatJid.trim() ? chatJid.trim() : "";
  }

  private parseRowId(rawRowId: number | string | undefined): number | null {
    const rowId = typeof rawRowId === "string" ? Number(rawRowId) : rawRowId;
    if (!Number.isFinite(rowId)) return null;
    if (!Number.isInteger(rowId)) return null;
    if (rowId === 0) return null;
    return Number(rowId);
  }

  private async removeQueuedFollowupForAction(
    chatJid: string,
    rowId: number,
  ): Promise<{ removed: QueuedFollowupItem | null; source: "deferred" | "placeholder" | null }> {
    return await this.options.queuedFollowupLifecycle.removeQueuedFollowupForAction(chatJid, rowId, {
      removeQueuedFollowupMessage: (queuedChatJid, queuedContent) =>
        this.options.agentPool.removeQueuedFollowupMessage?.(queuedChatJid, queuedContent) ?? false,
    });
  }
}
