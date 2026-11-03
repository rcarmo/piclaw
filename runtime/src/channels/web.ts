/**
 * channels/web.ts – Web channel: HTTP server, SSE, and API endpoints.
 *
 * The WebChannel class is the central coordinator for the web UI. It:
 *   - Starts the HTTP(S) server (Bun.serve) with TLS and auth support.
 *   - Routes requests to handlers (posts, media, agent, workspace).
 *   - Manages SSE connections for real-time event streaming to browsers.
 *   - Bridges agent events (drafts, thoughts, status) to the UI.
 *   - Handles inbound messages and control commands from the web compose box.
 *
 * Consumers:
 *   - runtime.ts creates and starts the WebChannel.
 *   - The web UI (web/src/) connects via SSE and REST API.
 */

import { AgentQueue } from "../queue.js";
import type { AgentPool } from "../agent-pool.js";
import { WebauthnChallengeTracker } from "./web/auth/webauthn-challenges.js";
import { TotpFailureTracker } from "./web/auth/totp-failure-tracker.js";
import type { WebChannelLike } from "./web/core/web-channel-contracts.js";
import type { RequestRouterService } from "./web/request-router-service.js";
import type { WebSessionBroadcastService } from "./web/sse/session-broadcast-service.js";
import { ResponseService } from "./web/http/response-service.js";
import { QueuedFollowupLifecycleService, type QueuedInputSourceAdmission } from "./web/runtime/queued-followup-lifecycle-service.js";
import type { WebMessageWriteService } from "./web/message-write-service.js";
import type { WebChannelRuntimeStateService } from "./web/runtime/runtime-state-service.js";
import type { WebChannelEndpointContexts } from "./web/endpoints/channel-endpoint-context-factory.js";
import type { WebAgentControlPlaneService } from "./web/agent/agent-control-plane-service.js";
import type { InteractionBroadcaster } from "./web/interaction-broadcaster.js";
import type { WebAuthGateway } from "./web/auth/auth-gateway.js";
import type { WebServerLifecycleGatewayService, WebSocketSessionData } from "./web/server-lifecycle-gateway-service.js";
import type { WebTerminalVncHttpServiceSurface } from "./web/terminal-vnc-http-service.js";
import type { WebAdaptiveCardSidePromptService } from "./web/cards/adaptive-card-side-prompt-service.js";
import type { WebAgentPeerMessageRelayService } from "./web/agent/agent-peer-message-relay-service.js";
import {
  WebChannelRuntimePublicSurfaceService,
  type WebChannelRuntimePublicSurfaceChannel,
  type RuntimeAgentMessageRequest,
  type RuntimeAgentMessageResult,
} from "./web/core/web-channel-runtime-public-surface-service.js";
import type { InteractionRow } from "../db.js";
import type { QueuedFollowupItem } from "../queued-followups.js";
import type { SendMessageOptions } from "./web/message-write-service.js";
import type { WebAgentBufferEntry } from "./web/agent/agent-buffers.js";
import { handleAgentMessage as handleAgentMessageRequest, processChat as processAgentChat } from "./web/handlers/agent.js";
import { handlePost as handlePostRequest } from "./web/handlers/posts.js";
import { TerminalSessionService } from "./web/terminal/terminal-session-service.js";
import { VncSessionService } from "./web/vnc/vnc-session-service.js";
import { createLazyTerminalService, createLazyVncService } from "./web/lazy-session-services.js";
import { admitWebMessage, type StoreWebMessageOptions } from "./web/messaging/message-store.js";
import { getIdentityConfig } from "../core/config.js";
import { isSlashCommandInvocation } from "../agent-control/agent-control-parser.js";
import { recordTimelineInteraction } from "../session-recordings/session-recordings.js";
import { createLogger, debugSuppressedError } from "../utils/logger.js";
import { initializeWebChannelConstructor } from "./web/core/web-channel-constructor-factory.js";
import { handleAgentContextRequest, handleAgentModelsRequest } from "./web/agent/agent-status.js";
import {
  handleAgentActiveChatsRequest,
  handleAgentBranchesRequest,
  handleAgentStatusRequest,
  handleAgentUiSnapshotRequest,
} from "./web/agent/agent-status.js";
import { handleAgentDebugRequest } from "./web/agent/agent-debug.js";
import { handleAgentCommandsRequest } from "./web/agent/agent-commands.js";
import { handleSystemMetricsRequest } from "./web/agent/system-metrics.js";
import {
  handleTimelineRequest,
  handleHashtagRequest,
  handleSearchRequest,
  handleThoughtRequest,
  handleThreadRequest,
} from "./web/endpoints/content-endpoints.js";
import { deletePostResponse } from "./web/timeline-service.js";
import { handleAgentsRequest, handleAvatarRequest } from "./web/endpoints/identity-endpoints.js";
import { handleManifestRequest } from "./web/manifest.js";
import { handleInternalPostRequest, handleUpdatePostAnnotationsRequest, handleUpdatePostRequest } from "./web/post-mutations.js";
import {
  handleAgentRespondRequest,
  handleThoughtVisibilityRequest,
  handleWorkspaceVisibilityRequest,
} from "./web/endpoints/ui-endpoints.js";
import { getChatProject } from "../db/chat-project.js";
import { ensureAvatarCache } from "./web/media/avatar-service.js";

const DEFAULT_CHAT_JID = "web:default";
const DEFAULT_AGENT_ID = "default";
const messageLog = createLogger("web.message-processing-storage");

/** Construction options for WebChannel: queue and agentPool references. */
export interface WebChannelOpts {
  queue: AgentQueue;
  agentPool: AgentPool;
  /** Internal host coordinator only; never derived from request fields. */
  prepareInputSourceAdmission?: WebChannelLike["prepareInputSourceAdmission"];
  prepareInputText?: WebChannelLike["prepareInputText"];
  expireQueuedInput?: WebChannelLike["expireQueuedInput"];
  getInputSourceAdmission?: WebChannelLike["getInputSourceAdmission"];
  getQueuedInputSourceAdmission?: WebChannelLike["getQueuedInputSourceAdmission"];
  getQueuedInputSourceWithdrawal?: WebChannelLike["getQueuedInputSourceWithdrawal"];
  getAcceptedQueuedSteering?: WebChannelLike["getAcceptedQueuedSteering"];
  getQueuedInputMaterialization?: WebChannelLike["getQueuedInputMaterialization"];
  dispatchAcceptedInput?: WebChannelLike["dispatchAcceptedInput"];
}

/** Web channel: HTTP/SSE server, API endpoints, and agent event bridge. */
export class WebChannel implements WebChannelLike {
  get sse(): WebSessionBroadcastService["sse"] {
    return this.sessionBroadcast.sse;
  }

  get uiBridge(): WebSessionBroadcastService["uiBridge"] {
    return this.sessionBroadcast.uiBridge;
  }

  get server(): Bun.Server<WebSocketSessionData> | null {
    return this.serverLifecycleGateway.server;
  }

  async start(): Promise<void> {
    await this.serverLifecycleGateway.start();
  }

  stop(): Promise<void> {
    return this.serverLifecycleGateway.stop();
  }

  sealAdmissions(): Promise<void> {
    return this.serverLifecycleGateway.sealAdmissions();
  }

  runInternalDispatch<T>(dispatch: () => T | Promise<T>): Promise<T> {
    return this.serverLifecycleGateway.runInternalDispatch(dispatch);
  }

  async sendMessage(chatJid: string, text: string, options?: SendMessageOptions): Promise<void> {
    await this.messageWriteService.sendMessage(chatJid, text, options);
  }

  async postDashboardWidget(
    chatJid: string,
    options?: { threadId?: number | null; text?: string; widgetId?: string },
  ): Promise<void> {
    await this.messageWriteService.postDashboardWidget(chatJid, options);
  }

  enqueueAgentMessage(request: RuntimeAgentMessageRequest): Promise<RuntimeAgentMessageResult> {
    return this.runInternalDispatch(() => this.runtimePublicSurfaceService.enqueueAgentMessage(request));
  }

  enqueueQueuedFollowupItem(
    chatJid: string,
    rowId: number,
    queuedContent: string,
    threadId?: number | null,
    queuedAt?: string,
    extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[]; screenHint?: string; source?: string; queuedBy?: QueuedFollowupItem["queuedBy"] },
  ): number {
    return this.queuedFollowupLifecycle.enqueueQueuedFollowupItem(
      chatJid,
      rowId,
      queuedContent,
      threadId,
      queuedAt,
      extras,
    );
  }

  peekQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null {
    return this.queuedFollowupLifecycle.peekQueuedFollowupItem(chatJid);
  }

  admitQueuedFollowupItem(args: Parameters<WebChannel["enqueueQueuedFollowupItem"]>, authorise: () => void, signal: AbortSignal, acceptSource?: QueuedInputSourceAdmission): Promise<number> {
    return this.queuedFollowupLifecycle.admitQueuedFollowupItem(args, authorise, signal, acceptSource);
  }

  getQueuedFollowupCount(chatJid: string): number {
    return this.queuedFollowupLifecycle.getQueuedFollowupCount(chatJid);
  }

  getQueuedFollowupItems(chatJid: string): QueuedFollowupItem[] {
    return this.queuedFollowupLifecycle.getQueuedFollowupItems(chatJid);
  }

  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void {
    this.runtimePublicSurfaceService.updateAgentStatus(chatJid, status);
  }

  getAgentStatus(chatJid: string): Record<string, unknown> | null {
    return this.runtimePublicSurfaceService.runtimeState.getAgentStatus(chatJid);
  }

  getExtensionWorkingState(chatJid: string): Record<string, unknown> | null {
    const state = this.runtimePublicSurfaceService.getExtensionWorkingState(chatJid);
    return state as unknown as Record<string, unknown> | null;
  }

  getThreadRootId(chatJid: string, messageId: string): number | null {
    return this.runtimePublicSurfaceService.runtimeState.getThreadRootId(chatJid, messageId);
  }

  resumeChat(chatJid: string, threadRootId?: number | null): void {
    this.runtimePublicSurfaceService.runtimeState.resumeChat(chatJid, threadRootId);
  }

  resumePendingChats(chatJid?: string): void {
    this.runtimePublicSurfaceService.runtimeState.resumePendingChats(chatJid);
  }

  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void {
    this.runtimePublicSurfaceService.runtimeState.setPanelExpanded(turnId, panel, expanded);
  }

  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean {
    return this.runtimePublicSurfaceService.runtimeState.isPanelExpanded(turnId, panel);
  }

  updateThoughtBuffer(turnId: string, text: string, totalLines: number): void {
    this.runtimePublicSurfaceService.runtimeState.updateThoughtBuffer(turnId, text, totalLines);
  }

  updateDraftBuffer(turnId: string, text: string, totalLines: number): void {
    this.runtimePublicSurfaceService.runtimeState.updateDraftBuffer(turnId, text, totalLines);
  }

  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined {
    return this.runtimePublicSurfaceService.runtimeState.getBuffer(turnId, panel);
  }

  broadcastEvent(eventType: string, data: unknown): void {
    this.runtimePublicSurfaceService.broadcastEvent(eventType, data);
  }

  async handleAgentPeerMessage(req: Request): Promise<Response> {
    return await this.peerMessageRelayService.handleAgentPeerMessage(req);
  }

  async handleAdaptiveCardAction(req: Request): Promise<Response> {
    return await this.adaptiveCardSidePromptService.handleAdaptiveCardAction(req);
  }

  async handleAgentSidePrompt(req: Request): Promise<Response> {
    return await this.adaptiveCardSidePromptService.handleAgentSidePrompt(req);
  }

  async handleAgentSidePromptStream(req: Request): Promise<Response> {
    return await this.adaptiveCardSidePromptService.handleAgentSidePromptStream(req);
  }

  handleAgentMessage(req: Request, pathname: string): Promise<Response> {
    return this.serverLifecycleGateway.handleRequest(req, () => handleAgentMessageRequest(
      this, req, pathname, new URL(req.url).searchParams.get("chat_jid")?.trim() || DEFAULT_CHAT_JID, DEFAULT_AGENT_ID,
    ));
  }

  async processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void> {
    return processAgentChat(this, chatJid, agentId, threadRootId ?? undefined);
  }

  async admitMessage(chatJid: string, content: string, isBot: boolean, mediaIds: number[], options: StoreWebMessageOptions,
    authorise?: (phase?: 'before' | 'after') => void, signal?: AbortSignal, deferBeforeInsert?: () => boolean): Promise<InteractionRow | null> {
    if (!isBot && typeof options.consumeDeferredFollowupRowId === "number") {
      options = { ...options, materializeQueuedSource: this.getQueuedInputMaterialization?.(chatJid),
        acceptMaterializedSource: !isSlashCommandInvocation(content.trim()) ? this.getInputSourceAdmission?.(chatJid) : undefined };
    }
    const identity = getIdentityConfig();
    const interaction = await admitWebMessage(this, {
      chatJid, content, isBot, mediaIds, agentId: DEFAULT_AGENT_ID,
      agentName: identity.assistantName, userName: identity.userName ?? null,
    }, options, authorise, signal, deferBeforeInsert);
    if (!interaction) return null;
    try { recordTimelineInteraction(interaction); }
    catch (error) { try { debugSuppressedError(messageLog, 'Optional recording failed after message commit.', error, { operation: 'web_message_storage.record_after_commit', rowId: interaction.id }); } catch { return interaction; } }
    return interaction;
  }

  requestWorkspaceFileOpen(chatJid: string, path: string, label: string): Promise<unknown> {
    return this.uiBridge.openWorkspaceFile(chatJid, path, label);
  }

  handleTimeline(limit: number, before?: number, chatJid?: string): Response {
    return handleTimelineRequest(limit, before, chatJid, this.endpointContexts.content());
  }

  async handleFetch(req: Request, server?: Bun.Server<WebSocketSessionData>): Promise<Response | undefined> {
    return this.serverLifecycleGateway.handleFetch(req, server);
  }

  async handleRequest(req: Request): Promise<Response> {
    return this.serverLifecycleGateway.handleRequest(req, () => this.requestRouter.handle(req));
  }

  async handleAgents(): Promise<Response> {
    return await handleAgentsRequest(this.endpointContexts.agents());
  }

  async handleManifest(req: Request): Promise<Response> {
    const identity = this.endpointContexts.identity();
    return await handleManifestRequest(req, {
      assistantName: identity.assistantName,
      assistantAvatar: identity.assistantAvatarRaw,
      ensureAvatarCache: ensureAvatarCache,
    });
  }

  async handleAvatar(kind: "agent" | "user", req: Request): Promise<Response> {
    return await handleAvatarRequest(kind, req, this.endpointContexts.avatar());
  }

  async handleWorkspaceVisibility(req: Request): Promise<Response> {
    return await handleWorkspaceVisibilityRequest(req, this.endpointContexts.ui());
  }

  handleHashtag(tag: string, limit: number, offset: number, chatJid?: string): Response {
    return handleHashtagRequest(tag, limit, offset, chatJid, this.endpointContexts.content());
  }

  handleSearch(
    query: string,
    limit: number,
    offset: number,
    chatJid?: string,
    searchScope?: "current" | "root" | "all",
    rootChatJid?: string,
    filters?: { images?: boolean; attachments?: boolean } | null,
  ): Response {
    return handleSearchRequest(
      query,
      limit,
      offset,
      chatJid,
      searchScope,
      rootChatJid,
      this.endpointContexts.content(),
      filters,
    );
  }

  handleThread(id: number | null, chatJid?: string): Response {
    return handleThreadRequest(id, chatJid, this.endpointContexts.content());
  }

  handleThought(panel: string | null, turnId: string | null): Response {
    return handleThoughtRequest(panel, turnId, this.endpointContexts.content());
  }

  async handleThoughtVisibility(req: Request): Promise<Response> {
    return await handleThoughtVisibilityRequest(req, this.endpointContexts.ui());
  }

  handleDeletePost(req: Request, id: number | null, cascade = false): Response {
    const url = new URL(req.url);
    const chatJid = url.searchParams.get("chat_jid")?.trim() || DEFAULT_CHAT_JID;
    const result = deletePostResponse(chatJid, id, cascade);
    if (result.deletedIds.length > 0) {
      this.broadcastEvent("interaction_deleted", { chat_jid: chatJid, ids: result.deletedIds });
    }
    return this.json(result.body, result.status);
  }

  async handleUpdatePost(req: Request, id: number | null): Promise<Response> {
    return await handleUpdatePostRequest(this, req, id, DEFAULT_CHAT_JID);
  }

  async handleUpdatePostAnnotations(req: Request, id: number): Promise<Response> {
    return await handleUpdatePostAnnotationsRequest(this, req, id, DEFAULT_CHAT_JID);
  }

  async handleInternalPost(req: Request): Promise<Response> {
    return await handleInternalPostRequest(this, req, DEFAULT_CHAT_JID);
  }

  handleSse(req: Request, authorisation?: import("./web/sse/sse.js").SseAuthorisation): Response {
    return this.sessionBroadcast.handleSse(req, authorisation);
  }

  handleTerminalSession(req: Request): Response {
    return this.terminalVncHttpService.handleTerminalSession(req);
  }

  handleTerminalHandoff(req: Request): Promise<Response> {
    return this.terminalVncHttpService.handleTerminalHandoff(req);
  }

  handleVncSession(req: Request): Promise<Response> {
    return this.terminalVncHttpService.handleVncSession(req);
  }

  handleVncHandoff(req: Request): Promise<Response> {
    return this.terminalVncHttpService.handleVncHandoff(req);
  }

  async handlePost(req: Request, isReply: boolean): Promise<Response> {
    const url = new URL(req.url);
    const chatJid = url.searchParams.get("chat_jid")?.trim() || DEFAULT_CHAT_JID;
    return await handlePostRequest(this, req, isReply, chatJid);
  }

  handleAgentStatus(req: Request): Response | Promise<Response> {
    if (new URL(req.url).searchParams.get("ui") === "1") {
      return handleAgentUiSnapshotRequest(req, this.endpointContexts.agentStatus(), {
        getSystemMetrics: async () => handleSystemMetricsRequest({ json: (payload, status = 200) => this.json(payload, status),
          getRuntimeMemorySnapshot: () => this.agentPool.getMemoryInstrumentationSnapshot() }, undefined, null).json(),
        getAgentName: () => this.endpointContexts.identity().assistantName,
        getProjectRepository: getChatProject,
      });
    }
    return handleAgentStatusRequest(req, this.endpointContexts.agentStatus());
  }

  async handleAgentContext(req: Request): Promise<Response> {
    return await handleAgentContextRequest(req, this.endpointContexts.agentStatus());
  }

  async handleAgentDebug(req: Request): Promise<Response> {
    return await handleAgentDebugRequest(req, {
      defaultChatJid: DEFAULT_CHAT_JID,
      agentPool: this.agentPool,
      json: (payload: unknown, status = 200) => this.json(payload, status),
    });
  }

  async handleAgentCommands(req: Request): Promise<Response> {
    return await handleAgentCommandsRequest(req, {
      defaultChatJid: DEFAULT_CHAT_JID,
      agentPool: this.agentPool,
      json: (payload: unknown, status = 200) => this.json(payload, status),
    });
  }

  async handleAutoresearchStatus(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAutoresearchStatus(req);
  }

  async handleAutoresearchStop(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAutoresearchStop(req);
  }

  async handleAutoresearchDismiss(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAutoresearchDismiss(req);
  }

  async handleAgentOobeComplete(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentOobeComplete(req);
  }

  async handleAgentQueueState(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentQueueState(req);
  }

  async handleAgentRuns(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentRuns(req);
  }

  async handleAgentRunAbort(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentRunAbort(req);
  }

  async handleAgentRunClearStale(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentRunClearStale(req);
  }

  async handleAgentRunDrainQueue(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentRunDrainQueue(req);
  }

  async handleAgentQueueRemove(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentQueueRemove(req);
  }

  async handleAgentQueueSteer(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentQueueSteer(req);
  }

  async handleAgentQueueReorder(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentQueueReorder(req);
  }

  async handleAgentModels(req: Request): Promise<Response> {
    return await handleAgentModelsRequest(req, this.endpointContexts.agentStatus());
  }

  handleSystemMetrics(_req: Request): Response {
    return handleSystemMetricsRequest({
      json: (payload, status = 200) => this.json(payload, status),
      getRuntimeMemorySnapshot: () => this.agentPool.getMemoryInstrumentationSnapshot(),
    }, undefined, undefined);
  }

  async handleAgentActiveChats(_req: Request): Promise<Response> {
    return handleAgentActiveChatsRequest(this);
  }

  async handleAgentBranches(req: Request): Promise<Response> {
    return handleAgentBranchesRequest(req, this);
  }

  async handleAgentBranchFork(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentBranchFork(req);
  }

  async handleAgentRootSessionCreate(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentRootSessionCreate(req);
  }

  async handleAgentBranchRename(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentBranchRename(req);
  }

  async handleAgentRenameJid(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentRenameJid(req);
  }

  async handleAgentBranchMergeParent(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentBranchMergeParent(req);
  }

  async handleAgentBranchPrune(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentBranchPrune(req);
  }

  handleAgentBranchDownload(req: Request): Response {
    return this.controlPlaneService.handleAgentBranchDownload(req);
  }

  async handleAgentBranchPurge(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentBranchPurge(req);
  }

  async handleAgentBranchRestore(req: Request): Promise<Response> {
    return await this.controlPlaneService.handleAgentBranchRestore(req);
  }

  async handleAgentRespond(req: Request): Promise<Response> {
    return await handleAgentRespondRequest(req, this.endpointContexts.ui());
  }

  async serveStatic(relPath: string, req?: Request): Promise<Response> {
    return this.responses.serveStatic(relPath, req);
  }

  async serveDocsStatic(relPath: string): Promise<Response> {
    return this.responses.serveDocsStatic(relPath);
  }

  json(data: unknown, status = 200): Response {
    return this.responses.json(data, status);
  }

  clampInt(value: string | null, fallback: number, min: number, max: number): number {
    return this.responses.clampInt(value, fallback, min, max);
  }

  parseOptionalInt(value: string | null): number | null {
    return this.responses.parseOptionalInt(value);
  }

  private _terminalService: TerminalSessionService | null = null;
  private _vncService: VncSessionService | null = null;

  queue!: AgentQueue;
  agentPool!: AgentPool;
  declare prepareInputSourceAdmission?: WebChannelOpts["prepareInputSourceAdmission"];
  declare prepareInputText?: WebChannelOpts["prepareInputText"];
  declare expireQueuedInput?: WebChannelOpts["expireQueuedInput"];
  declare getInputSourceAdmission?: WebChannelOpts["getInputSourceAdmission"];
  declare getQueuedInputSourceAdmission?: WebChannelOpts["getQueuedInputSourceAdmission"];
  declare getQueuedInputSourceWithdrawal?: WebChannelOpts["getQueuedInputSourceWithdrawal"];
  declare getAcceptedQueuedSteering?: WebChannelOpts["getAcceptedQueuedSteering"];
  declare getQueuedInputMaterialization?: WebChannelOpts["getQueuedInputMaterialization"];
  declare dispatchAcceptedInput?: WebChannelOpts["dispatchAcceptedInput"];
  responses = new ResponseService();
  requestRouter!: RequestRouterService;
  endpointContexts!: WebChannelEndpointContexts;
  pendingLinkPreviews = new Set<number>();
  workspaceVisible = false;
  workspaceShowHidden = false;
  queuedFollowupLifecycle = new QueuedFollowupLifecycleService();
  interactionBroadcaster!: InteractionBroadcaster;
  lastCommandInteractionId: number | null = null;
  webauthnChallenges = new WebauthnChallengeTracker();
  totpFailureTracker = new TotpFailureTracker();
  authGateway!: WebAuthGateway;
  terminalService = createLazyTerminalService(() => {
    this._terminalService ??= new TerminalSessionService();
    return this._terminalService;
  });
  vncService = createLazyVncService(() => {
    this._vncService ??= new VncSessionService();
    return this._vncService;
  });
  private readonly sessionBroadcast!: WebSessionBroadcastService;
  private readonly runtimeState!: WebChannelRuntimeStateService;
  private readonly serverLifecycleGateway!: WebServerLifecycleGatewayService;
  private readonly terminalVncHttpService!: WebTerminalVncHttpServiceSurface;
  private readonly adaptiveCardSidePromptService!: WebAdaptiveCardSidePromptService;
  private readonly peerMessageRelayService!: WebAgentPeerMessageRelayService;
  private readonly runtimePublicSurfaceService!: WebChannelRuntimePublicSurfaceService;
  private readonly messageWriteService!: WebMessageWriteService;
  private readonly controlPlaneService!: WebAgentControlPlaneService;

  syncWorkspaceWatcher(): Promise<void> {
    return this.serverLifecycleGateway.syncWorkspaceWatcher();
  }

  constructor(opts: WebChannelOpts) {
    initializeWebChannelConstructor(this, opts, {
      defaultChatJid: DEFAULT_CHAT_JID,
      defaultAgentId: DEFAULT_AGENT_ID,
    });
    this.runtimePublicSurfaceService = new WebChannelRuntimePublicSurfaceService(
      this as unknown as WebChannelRuntimePublicSurfaceChannel,
    );
  }
}
