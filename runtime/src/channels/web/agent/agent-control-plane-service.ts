import { captureHostDatabaseBinding } from "../../../db/connection.js";
import { captureWebRequestAuthority } from "../auth/auth-gateway.js";
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
  getDeferredQueuedFollowups,
  exportArchivedBranchDownloadData,
} from "../../../db.js";
import { createLogger } from "../../../utils/logger.js";
import { parseJsonObjectRequest } from "../json-body.js";
import { completeOobeForInstance } from "../oobe-instance-state.js";
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

type ControlPlaneAgentPool = AgentPool;

export interface WebAgentControlPlaneServiceOptions {
  captureWriteAuthority?(req: Request): () => void;
  readNativeQueue?: import("../core/web-channel-contracts.js").WebChannelLike["readNativeQueue"];
  controlNativeQueue?: import("../core/web-channel-contracts.js").WebChannelLike["controlNativeQueue"];
  reorderNativeQueue?: import("../core/web-channel-contracts.js").WebChannelLike["reorderNativeQueue"];
  defaultChatJid: string;
  defaultAgentId: string;
  json(payload: unknown, status?: number): Response;
  broadcastEvent(eventType: string, data: unknown): void;
  queue: AgentQueueLike;
  agentPool: ControlPlaneAgentPool;
  getAgentStatus?: (chatJid: string) => Record<string, unknown> | null;
  getAutoresearchWidgetPayload?: (chatJid: string) => unknown;
  stopAutoresearchFromWeb?: (input: { chat_jid: string; generate_report: boolean }) => Promise<unknown>;
  dismissAutoresearchWidget?: (chatJid: string) => boolean;
}

export interface WebAgentControlPlaneChannelLike {
  authGateway?: Parameters<typeof captureWebRequestAuthority>[0];
  readNativeQueue?: WebAgentControlPlaneServiceOptions["readNativeQueue"];
  controlNativeQueue?: WebAgentControlPlaneServiceOptions["controlNativeQueue"];
  reorderNativeQueue?: WebAgentControlPlaneServiceOptions["reorderNativeQueue"];
  json(payload: unknown, status?: number): Response;
  broadcastEvent(eventType: string, data: unknown): void;
  queue: AgentQueueLike;
  agentPool: ControlPlaneAgentPool;
  getAgentStatus?(chatJid: string): Record<string, unknown> | null;
}

export function createWebAgentControlPlaneService(
  channel: WebAgentControlPlaneChannelLike,
  defaults: { defaultChatJid: string; defaultAgentId: string },
): WebAgentControlPlaneService {
  return new WebAgentControlPlaneService({
    defaultChatJid: defaults.defaultChatJid,
    defaultAgentId: defaults.defaultAgentId,
    captureWriteAuthority: req => {
      const binding = captureHostDatabaseBinding(), gateway = channel.authGateway, request = captureWebRequestAuthority(gateway, req);
      return () => { binding(); if (channel.authGateway !== gateway) throw Error('Control request gateway changed.'); request(); };
    },
    json: (payload, status = 200) => channel.json(payload, status),
    broadcastEvent: (eventType, data) => channel.broadcastEvent(eventType, data),
    queue: channel.queue,
    agentPool: channel.agentPool,
    get readNativeQueue(){return channel.readNativeQueue?.bind(channel);},
    get controlNativeQueue(){return channel.controlNativeQueue?.bind(channel);},
    get reorderNativeQueue(){return channel.reorderNativeQueue?.bind(channel);},
    getAgentStatus: (chatJid) => channel.getAgentStatus?.(chatJid) ?? null,
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
    const authorise = this.options.captureWriteAuthority?.(req);
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { kind?: string };
    const kind = typeof payload.kind === "string" && payload.kind.trim() ? payload.kind.trim() : "provider-ready";
    if (kind !== "provider-ready") {
      return this.options.json({ error: "Unsupported OOBE completion kind." }, 400);
    }

    const completed = await completeOobeForInstance("provider-ready", authorise, req.signal);
    return this.options.json({
      status: "ok",
      kind,
      provider_ready_completed_instance: completed,
    });
  }

  async handleAgentQueueState(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const chatJid = this.resolveChatJid(url.searchParams.get("chat_jid"));
    if (!this.options.readNativeQueue) return this.options.json({ error: "Native queue observation is unavailable." }, 503);
    const items = await this.options.readNativeQueue(chatJid);

    return this.options.json({
      count: items.length,
      items,
    });
  }

  async handleAgentQueueRemove(req: Request): Promise<Response> {
    const authorise = this.options.captureWriteAuthority?.(req);
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    try {
      const payload = parsed.payload as { chat_jid?: string; row_id?: number | string };
      const chatJid = this.resolveChatJid(payload.chat_jid);
      const rowId = this.parseRowId(payload.row_id);
      if (rowId === null) {
        return this.options.json({ error: "Missing or invalid row_id" }, 400);
      }

      if(this.options.readNativeQueue){
        if(!this.options.controlNativeQueue)throw Error('Native queue control unavailable');
        const native=await this.options.readNativeQueue(chatJid);
        const legacy=getDeferredQueuedFollowups(chatJid).some(item=>item.rowId===rowId);
        if(native.some(item=>item.row_id===rowId)){
          if(legacy)return this.options.json({error:"Ambiguous queued input; no item changed."},409);
          const removed=await this.options.controlNativeQueue(chatJid,rowId,"remove",authorise);
          if(removed)this.options.broadcastEvent("agent_followup_removed",{chat_jid:chatJid,row_id:rowId});
          return this.options.json({status:"ok",removed,row_id:rowId,count:(await this.options.readNativeQueue(chatJid)).length});
        }
        if(legacy)return this.options.json({error:"This preserved legacy queue item has no SDK submission; it was not changed."},409);
        return this.options.json({status:"ok",removed:false,count:native.length});
      }
      return this.options.json({ error: "Native queue control is unavailable." }, 503);
    } catch (error) {
      // Host selectors/callbacks can carry private engine or source details.
      return this.options.json({ error: "Unable to remove queued follow-up" }, 500);
    }
  }

  /**
   * Body: `{ chat_jid, order: [row_id, ...] }`, the whole queue in its new order,
   * or `{ chat_jid, from_index, to_index }` to move one item in the current queue.
   * An order that no longer matches the queue changes nothing and answers 409.
   */
  async handleAgentQueueReorder(req: Request): Promise<Response> {
    const authorise = this.options.captureWriteAuthority?.(req);
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);
    try {
      const payload = parsed.payload as { chat_jid?: string; order?: unknown; from_index?: unknown; to_index?: unknown };
      const chatJid = this.resolveChatJid(payload.chat_jid);
      if (!this.options.readNativeQueue || !this.options.reorderNativeQueue) {
        return this.options.json({ error: "Native queue control is unavailable." }, 503);
      }
      let ids: number[] | null = null;
      if (Array.isArray(payload.order)) {
        const order = payload.order.map((value) => this.parseRowId(value as number | string));
        if (order.length > 0 && order.every((value) => value !== null)) ids = order as number[];
      } else if (Number.isSafeInteger(payload.from_index) && Number.isSafeInteger(payload.to_index)) {
        const current = (await this.options.readNativeQueue(chatJid)).map((item) => item.row_id);
        const from = payload.from_index as number, to = payload.to_index as number;
        if (from >= 0 && to >= 0 && from < current.length && to < current.length) {
          const [moved] = current.splice(from, 1);
          current.splice(to, 0, moved!);
          ids = current;
        }
      }
      if (!ids) return this.options.json({ error: "Missing or invalid order" }, 400);
      if (getDeferredQueuedFollowups(chatJid).some((item) => ids!.includes(item.rowId))) {
        return this.options.json({ error: "Ambiguous queued input; no item changed." }, 409);
      }
      const reordered = await this.options.reorderNativeQueue(chatJid, ids, authorise);
      const items = await this.options.readNativeQueue(chatJid);
      if (!reordered) return this.options.json({ error: "The queue changed; nothing was reordered.", reordered, items, count: items.length }, 409);
      this.options.broadcastEvent("agent_followup_reordered", { chat_jid: chatJid, order: items.map((item) => item.row_id) });
      return this.options.json({ status: "ok", reordered, items, count: items.length });
    } catch {
      return this.options.json({ error: "Unable to reorder queued follow-ups" }, 500);
    }
  }

  /** Body: `{ chat_jid, call_id, note? }`. Stops one running tool; the agent continues. */
  async handleAgentToolAbort(req: Request): Promise<Response> {
    const authorise = this.options.captureWriteAuthority?.(req);
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);
    const payload = parsed.payload as { chat_jid?: string; call_id?: unknown; note?: unknown };
    const callId = typeof payload.call_id === "string" ? payload.call_id.trim() : "";
    if (!callId || callId.length > 512) return this.options.json({ error: "Missing or invalid call_id" }, 400);
    const note = typeof payload.note === "string" ? payload.note.slice(0, 2000) : undefined;
    try {
      const chatJid = this.resolveChatJid(payload.chat_jid);
      authorise?.();
      const aborted = await this.options.agentPool.abortToolCallForChat(chatJid, callId, note);
      return this.options.json({ status: "ok", call_id: callId, aborted });
    } catch {
      return this.options.json({ error: "Unable to stop the tool." }, 500);
    }
  }

  async handleAgentQueueSteer(req: Request): Promise<Response> {
    const authorise = this.options.captureWriteAuthority?.(req);
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    try {
      const payload = parsed.payload as { chat_jid?: string; row_id?: number | string };
      const chatJid = this.resolveChatJid(payload.chat_jid);
      const rowId = this.parseRowId(payload.row_id);
      if (rowId === null) {
        return this.options.json({ error: "Missing or invalid row_id" }, 400);
      }

      if(this.options.readNativeQueue){
        if(!this.options.controlNativeQueue)throw Error('Native queue control unavailable');
        const native=await this.options.readNativeQueue(chatJid);
        const legacy=getDeferredQueuedFollowups(chatJid).some(item=>item.rowId===rowId);
        if(native.some(item=>item.row_id===rowId)){
          if(legacy)return this.options.json({error:"Ambiguous queued input; no item changed."},409);
          const changed=await this.options.controlNativeQueue(chatJid,rowId,"steer",authorise);
          if(changed)this.options.broadcastEvent("agent_steer_queued",{chat_jid:chatJid,source:"queued-item"});
          return this.options.json({status:"ok",removed:false,row_id:rowId,queued:changed?"steer":undefined,count:(await this.options.readNativeQueue(chatJid)).length},changed?201:200);
        }
        if(legacy)return this.options.json({error:"This preserved legacy queue item has no SDK submission; it was not changed."},409);
        return this.options.json({status:"ok",removed:false,count:native.length});
      }
      return this.options.json({ error: "Native queue control is unavailable." }, 503);
    } catch (error) {
      return this.options.json({ error: 'Accepted steering is unavailable.' }, 500);
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
    const knownChats = this.options.agentPool.listKnownChats?.() ?? activeChats;
    const progressByChat = new Map(getTrackedPhasesSnapshot().map((entry) => [entry.chatJid, entry]));
    const chatJids = new Set<string>();
    for (const chat of knownChats as Array<{ chat_jid?: unknown }>) {
      if (typeof chat.chat_jid === "string") chatJids.add(chat.chat_jid);
    }
    if (requestedChatJid) chatJids.add(requestedChatJid);

    const runs = await Promise.all([...chatJids]
      .filter((chatJid) => !requestedChatJid || chatJid === requestedChatJid)
      .map(async (chatJid) => {
        const active = (activeChats as unknown as Array<Record<string, unknown>>).find((chat) => chat.chat_jid === chatJid) ?? null;
        const status = this.options.getAgentStatus?.(chatJid) ?? null;
        const progress = progressByChat.get(chatJid) ?? null;
        if (!this.options.readNativeQueue) throw Error("Native queue observation unavailable");
        const queued = await this.options.readNativeQueue(chatJid);
        return {
          chat_jid: chatJid,
          active,
          is_active: Boolean(status && status.type !== "done" && status.type !== "error"),
          status,
          inflight: null, // Historical response keys; never execution authority.
          preflight: null,
          progress,
          queue_count: queued.length,
          stalled_work: buildStalledWorkDiagnostic(progress),
        };
      }));

    return this.options.json({ runs, inflight: [], preflight: [] }, 200);
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

  async handleAgentRunClearStale(_req: Request): Promise<Response> {
    return this.options.json({ error: "Native execution status is supplied by the SDK and cannot be cleared by a host control." }, 409);
  }

  async handleAgentRunDrainQueue(_req: Request): Promise<Response> {
    // No bulk deletion of historical rows or inferred cancellation of SDK inputs.
    return this.options.json({ error: "Bulk drain is unavailable; remove individual native queued submissions." }, 409);
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
    const authorise = this.options.captureWriteAuthority?.(req);
    const context = { signal: req.signal, authorise };
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { agent_name?: string; root_name?: string };
    const agentName = typeof payload.agent_name === "string"
      ? payload.agent_name.trim()
      : (typeof payload.root_name === "string" ? payload.root_name.trim() : "");
    if (!agentName) return this.options.json({ error: "Missing agent_name" }, 400);

    try {
      const branch = await this.options.agentPool.createRootChatSession?.(agentName, context);
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
    const authorise = this.options.captureWriteAuthority?.(req);
    const context = { signal: req.signal, authorise };
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
        ...context,
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
    const authorise = this.options.captureWriteAuthority?.(req);
    const context = { signal: req.signal, authorise };
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { old_jid?: string; new_jid?: string; chat_jid?: string };
    const oldJid = String(payload.old_jid || payload.chat_jid || "").trim();
    const newJid = String(payload.new_jid || "").trim();
    if (!oldJid) return this.options.json({ error: "Missing old_jid (or chat_jid)" }, 400);
    if (!newJid) return this.options.json({ error: "Missing new_jid" }, 400);

    try {
      const result = await this.options.agentPool.renameChatJid?.(oldJid, newJid, context);
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
    const authorise = this.options.captureWriteAuthority?.(req);
    const context = { signal: req.signal, authorise };
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) {
      return this.options.json({ error: "Missing chat_jid" }, 400);
    }

    try {
      const result = await this.options.agentPool.mergeChatBranchIntoParent?.(chatJid, context);
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
    const authorise = this.options.captureWriteAuthority?.(req);
    const context = { signal: req.signal, authorise };
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) {
      return this.options.json({ error: "Missing chat_jid" }, 400);
    }

    try {
      const branch = await this.options.agentPool.pruneChatBranch?.(chatJid, context);
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
    const authorise = this.options.captureWriteAuthority?.(req);
    const context = { signal: req.signal, authorise };
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) {
      return this.options.json({ error: "Missing chat_jid" }, 400);
    }

    try {
      const result = await this.options.agentPool.permanentPurgeChatBranch?.(chatJid, context);
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
    const authorise = this.options.captureWriteAuthority?.(req);
    const context = { signal: req.signal, authorise };
    const parsed = await parseJsonObjectRequest(req);
    if (!parsed.ok) return this.options.json({ error: parsed.error }, 400);

    const payload = parsed.payload as { chat_jid?: string; agent_name?: string };
    const chatJid = this.resolveRequiredChatJid(payload.chat_jid);
    if (!chatJid) {
      return this.options.json({ error: "Missing chat_jid" }, 400);
    }

    try {
      const branch = await this.options.agentPool.restoreChatBranch?.(chatJid, {
        ...context,
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

}
