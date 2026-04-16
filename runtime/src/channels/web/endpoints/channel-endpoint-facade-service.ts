/**
 * channels/web/channel-endpoint-facade-service.ts – Thin facade for WebChannel endpoint wrappers.
 */

import {
  handleAgentContextRequest,
  handleAgentModelsRequest,
  handleAgentStatusRequest,
} from "../agent/agent-status.js";
import { handleAgentDebugRequest } from "../agent/agent-debug.js";
import {
  handleSessionTreeRequest,
} from "../agent/session-tree.js";
import { handleSystemMetricsRequest } from "../agent/system-metrics.js";
import {
  handleHashtagRequest,
  handleSearchRequest,
  handleThoughtRequest,
  handleThreadRequest,
  handleTimelineRequest,
} from "./content-endpoints.js";
import { deletePostResponse } from "../timeline-service.js";
import { handleAgentsRequest, handleAvatarRequest } from "./identity-endpoints.js";
import { handleManifestRequest, type ManifestIconMeta } from "../manifest.js";
import { handleInternalPostRequest, handleUpdatePostRequest } from "../post-mutations.js";
import {
  handleAgentRespondRequest,
  handleThoughtVisibilityRequest,
  handleWorkspaceVisibilityRequest,
} from "./ui-endpoints.js";
import { appendServerTiming, measureSync } from "../http/server-timing.js";
import type {
  WebChannelEndpointContexts,
  WebChannelIdentitySnapshot,
} from "./channel-endpoint-context-factory.js";

/** Dependencies required by the extracted endpoint facade. */
import type { AgentPool } from "../../../agent-pool.js";

export interface WebChannelEndpointFacadeOptions {
  endpointContexts: WebChannelEndpointContexts;
  defaultChatJid: string;
  agentPool: AgentPool;
  getIdentitySnapshot(): WebChannelIdentitySnapshot;
  ensureAvatarCache(kind: "agent", source: string): Promise<ManifestIconMeta | null>;
  json(payload: unknown, status?: number): Response;
  broadcastEvent(eventType: string, data: unknown): void;
  handlePostRequest(req: Request, isReply: boolean, chatJid: string): Promise<Response>;
  listActiveChats(): unknown[];
  listKnownChats?(rootChatJid?: string | null, options?: { includeArchived?: boolean }): unknown[];
  getSessionTreeForChat?(chatJid: string): { leafId: string | null; nodes: unknown[]; flat?: boolean; total?: number; capped?: boolean } | null;
}

/**
 * Extracted facade for endpoint-wrapper methods that mostly bind shared contexts
 * or live identity state before delegating to focused handler modules.
 */
export class WebChannelEndpointFacadeService {
  constructor(private readonly options: WebChannelEndpointFacadeOptions) {}

  async handleAgents(): Promise<Response> {
    return await handleAgentsRequest(this.options.endpointContexts.agents());
  }

  async handleManifest(req: Request): Promise<Response> {
    const identity = this.options.getIdentitySnapshot();
    return await handleManifestRequest(req, {
      assistantName: identity.assistantName,
      assistantAvatar: identity.assistantAvatarRaw,
      ensureAvatarCache: this.options.ensureAvatarCache,
    });
  }

  async handleAvatar(kind: "agent" | "user", req: Request): Promise<Response> {
    return await handleAvatarRequest(kind, req, this.options.endpointContexts.avatar());
  }

  async handleWorkspaceVisibility(req: Request): Promise<Response> {
    return await handleWorkspaceVisibilityRequest(req, this.options.endpointContexts.ui());
  }

  async handlePost(req: Request, isReply: boolean): Promise<Response> {
    const url = new URL(req.url);
    const chatJid = url.searchParams.get("chat_jid")?.trim() || this.options.defaultChatJid;
    return await this.options.handlePostRequest(req, isReply, chatJid);
  }

  handleTimeline(limit: number, before?: number, chatJid?: string): Response {
    return handleTimelineRequest(limit, before, chatJid, this.options.endpointContexts.content());
  }

  handleHashtag(tag: string, limit: number, offset: number, chatJid?: string): Response {
    return handleHashtagRequest(tag, limit, offset, chatJid, this.options.endpointContexts.content());
  }

  handleSearch(
    query: string,
    limit: number,
    offset: number,
    chatJid?: string,
    searchScope?: "current" | "root" | "all",
    rootChatJid?: string,
  ): Response {
    return handleSearchRequest(
      query,
      limit,
      offset,
      chatJid,
      searchScope,
      rootChatJid,
      this.options.endpointContexts.content(),
    );
  }

  handleThread(id: number | null, chatJid?: string): Response {
    return handleThreadRequest(id, chatJid, this.options.endpointContexts.content());
  }

  handleThought(panel: string | null, turnId: string | null): Response {
    return handleThoughtRequest(panel, turnId, this.options.endpointContexts.content());
  }

  async handleThoughtVisibility(req: Request): Promise<Response> {
    return await handleThoughtVisibilityRequest(req, this.options.endpointContexts.ui());
  }

  handleDeletePost(req: Request, id: number | null, cascade = false): Response {
    const url = new URL(req.url);
    const chatJid = url.searchParams.get("chat_jid")?.trim() || this.options.defaultChatJid;
    const result = deletePostResponse(chatJid, id, cascade);
    if (result.deletedIds.length > 0) {
      this.options.broadcastEvent("interaction_deleted", { chat_jid: chatJid, ids: result.deletedIds });
    }
    return this.options.json(result.body, result.status);
  }

  async handleUpdatePost(req: Request, id: number | null): Promise<Response> {
    return await handleUpdatePostRequest(req, id, this.options.endpointContexts.postMutations());
  }

  async handleInternalPost(req: Request): Promise<Response> {
    return await handleInternalPostRequest(req, this.options.endpointContexts.postMutations());
  }

  handleAgentStatus(req: Request): Response {
    return handleAgentStatusRequest(req, this.options.endpointContexts.agentStatus());
  }

  async handleAgentContext(req: Request): Promise<Response> {
    return await handleAgentContextRequest(req, this.options.endpointContexts.agentStatus());
  }

  async handleAgentModels(req: Request): Promise<Response> {
    return await handleAgentModelsRequest(req, this.options.endpointContexts.agentStatus());
  }

  async handleAgentDebug(req: Request): Promise<Response> {
    return await handleAgentDebugRequest(req, {
      defaultChatJid: this.options.defaultChatJid,
      agentPool: this.options.agentPool,
      json: (payload: unknown, status = 200) => this.options.json(payload, status),
    });
  }

  handleSessionTree(req: Request): Response {
    const defaultChatJid = this.options.defaultChatJid;
    return handleSessionTreeRequest(req, {
      defaultChatJid,
      json: (payload, status = 200) => this.options.json(payload, status),
      getSessionTreeForChat: (chatJid) => this.options.getSessionTreeForChat?.(chatJid) ?? null,
    });
  }

  handleSystemMetrics(): Response {
    return handleSystemMetricsRequest({
      json: (payload, status = 200) => this.options.json(payload, status),
    });
  }

  handleAgentActiveChats(): Response {
    const { result, durationMs } = measureSync(() => this.options.json({ chats: this.options.listActiveChats() }, 200));
    return appendServerTiming(result, {
      name: "agent_active_chats",
      durationMs,
    });
  }

  handleAgentBranches(req: Request): Response {
    const { result, durationMs } = measureSync(() => {
      const url = new URL(req.url);
      const rootChatJid = typeof url.searchParams.get("root_chat_jid") === "string"
        ? url.searchParams.get("root_chat_jid")!.trim()
        : "";
      const includeArchived = ["1", "true", "yes", "on"].includes(
        String(url.searchParams.get("include_archived") || "").trim().toLowerCase(),
      );
      const prewarmRecent = ["1", "true", "yes", "on"].includes(
        String(url.searchParams.get("prewarm_recent") || "").trim().toLowerCase(),
      );
      const prewarmLimitRaw = Number.parseInt(String(url.searchParams.get("prewarm_limit") || "").trim(), 10);
      const prewarmLimit = Number.isFinite(prewarmLimitRaw)
        ? Math.max(1, Math.min(8, prewarmLimitRaw))
        : 3;
      const excludeChatJid = typeof url.searchParams.get("exclude_chat_jid") === "string"
        ? url.searchParams.get("exclude_chat_jid")!.trim()
        : "";
      const prewarmChatJid = typeof url.searchParams.get("prewarm_chat_jid") === "string"
        ? url.searchParams.get("prewarm_chat_jid")!.trim()
        : "";

      const chats = typeof this.options.listKnownChats === "function"
        ? this.options.listKnownChats(rootChatJid || null, { includeArchived })
        : this.options.listActiveChats();
      const knownChatJids = typeof this.options.listKnownChats === "function"
        ? new Set(
            chats
              .map((chat) => (typeof (chat as { chat_jid?: unknown })?.chat_jid === "string" ? (chat as { chat_jid: string }).chat_jid.trim() : ""))
              .filter(Boolean),
          )
        : null;

      // Reserve the priority warmup slot before queueing the recent batch so the
      // explicit `prewarm_chat_jid` is not shadowed by an earlier recent enqueue
      // (AgentSessionManager.prewarm rejects a later priority call for a chat
      // that is already queued as a normal warmup).
      if (prewarmChatJid && knownChatJids?.has(prewarmChatJid)) {
        this.options.agentPool.scheduleChatWarmup(prewarmChatJid, { priority: true });
      }
      if (!rootChatJid && prewarmRecent) {
        this.options.agentPool.scheduleRecentChatWarmup({
          limit: prewarmLimit,
          excludeChatJids: [
            ...(excludeChatJid ? [excludeChatJid] : []),
            ...(prewarmChatJid ? [prewarmChatJid] : []),
          ],
        });
      }
      return this.options.json({ chats }, 200);
    });
    return appendServerTiming(result, {
      name: "agent_branches",
      durationMs,
    });
  }

  async handleAgentRespond(req: Request): Promise<Response> {
    return await handleAgentRespondRequest(req, this.options.endpointContexts.ui());
  }
}
