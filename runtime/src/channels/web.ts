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
import { QueuedFollowupLifecycleService } from "./web/runtime/queued-followup-lifecycle-service.js";
import type { WebMessageWriteService } from "./web/message-write-service.js";
import type { WebChannelRuntimeStateService } from "./web/runtime/runtime-state-service.js";
import type { WebChannelEndpointContexts } from "./web/endpoints/channel-endpoint-context-factory.js";
import type { WebChannelEndpointFacadeService } from "./web/endpoints/channel-endpoint-facade-service.js";
import type { WebAgentControlPlaneService } from "./web/agent/agent-control-plane-service.js";
import type { InteractionBroadcaster } from "./web/interaction-broadcaster.js";
import type { WebAuthGateway } from "./web/auth/auth-gateway.js";
import type { WebServerLifecycleGatewayService, WebSocketSessionData } from "./web/server-lifecycle-gateway-service.js";
import type { WebTerminalVncHttpServiceSurface } from "./web/terminal-vnc-http-service.js";
import type { WebAdaptiveCardSidePromptService } from "./web/cards/adaptive-card-side-prompt-service.js";
import type { WebAgentPeerMessageRelayService } from "./web/agent/agent-peer-message-relay-service.js";
import {
  createWebChannelRuntimePublicSurfaceService,
  type WebChannelRuntimePublicSurfaceChannel,
  type WebChannelRuntimePublicSurfaceService,
} from "./web/core/web-channel-runtime-public-surface-service.js";
import {
  createWebChannelLifecycleSpecialSurfaceService,
  type WebChannelLifecycleSpecialSurfaceChannel,
  type WebChannelLifecycleSpecialSurfaceService,
} from "./web/core/web-channel-lifecycle-special-surface-service.js";
import {
  installWebChannelPrototype,
  type WebChannelPrototypeMembers,
} from "./web/core/web-channel-prototype.js";
import { TerminalSessionService } from "./web/terminal/terminal-session-service.js";
import { VncSessionService } from "./web/vnc/vnc-session-service.js";
import { createLazyTerminalService, createLazyVncService } from "./web/lazy-session-services.js";
import type { WebMessageProcessingStorageService } from "./web/messaging/message-processing-storage-service.js";
import { initializeWebChannelConstructor } from "./web/core/web-channel-constructor-factory.js";
import { handleTimelineRequest } from "./web/endpoints/content-endpoints.js";
import { handleAgentContextRequest, handleAgentModelsRequest } from "./web/agent/agent-status.js";

const DEFAULT_CHAT_JID = "web:default";
const DEFAULT_AGENT_ID = "default";

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
// eslint-disable-next-line typescript/no-unsafe-declaration-merging, no-redeclare
export class WebChannel implements WebChannelLike {
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
    return await this.endpointFacade.handleAgents();
  }

  async handleManifest(req: Request): Promise<Response> {
    return await this.endpointFacade.handleManifest(req);
  }

  async handleAvatar(kind: "agent" | "user", req: Request): Promise<Response> {
    return await this.endpointFacade.handleAvatar(kind, req);
  }

  async handleWorkspaceVisibility(req: Request): Promise<Response> {
    return await this.endpointFacade.handleWorkspaceVisibility(req);
  }

  handleHashtag(tag: string, limit: number, offset: number, chatJid?: string): Response {
    return this.endpointFacade.handleHashtag(tag, limit, offset, chatJid);
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
    return this.endpointFacade.handleSearch(query, limit, offset, chatJid, searchScope, rootChatJid, filters);
  }

  handleThread(id: number | null, chatJid?: string): Response {
    return this.endpointFacade.handleThread(id, chatJid);
  }

  handleThought(panel: string | null, turnId: string | null): Response {
    return this.endpointFacade.handleThought(panel, turnId);
  }

  async handleThoughtVisibility(req: Request): Promise<Response> {
    return await this.endpointFacade.handleThoughtVisibility(req);
  }

  handleDeletePost(req: Request, id: number | null, cascade = false): Response {
    return this.endpointFacade.handleDeletePost(req, id, cascade);
  }

  async handleUpdatePost(req: Request, id: number | null): Promise<Response> {
    return await this.endpointFacade.handleUpdatePost(req, id);
  }

  async handleUpdatePostAnnotations(req: Request, id: number): Promise<Response> {
    return await this.endpointFacade.handleUpdatePostAnnotations(req, id);
  }

  async handleInternalPost(req: Request): Promise<Response> {
    return await this.endpointFacade.handleInternalPost(req);
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
    return await this.endpointFacade.handlePost(req, isReply);
  }

  handleAgentStatus(req: Request): Response | Promise<Response> {
    return this.endpointFacade.handleAgentStatus(req);
  }

  async handleAgentContext(req: Request): Promise<Response> {
    return await handleAgentContextRequest(req, this.endpointContexts.agentStatus());
  }

  async handleAgentDebug(req: Request): Promise<Response> {
    return await this.endpointFacade.handleAgentDebug(req);
  }

  async handleAgentCommands(req: Request): Promise<Response> {
    return await this.endpointFacade.handleAgentCommands(req);
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
    return this.endpointFacade.handleSystemMetrics();
  }

  async handleAgentActiveChats(_req: Request): Promise<Response> {
    return this.endpointFacade.handleAgentActiveChats();
  }

  async handleAgentBranches(req: Request): Promise<Response> {
    return await this.endpointFacade.handleAgentBranches(req);
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
    return await this.endpointFacade.handleAgentRespond(req);
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
  private readonly lifecycleSpecialSurfaceService!: WebChannelLifecycleSpecialSurfaceService;
  private readonly messageProcessingStorageService!: WebMessageProcessingStorageService;
  private readonly messageWriteService!: WebMessageWriteService;
  private readonly endpointFacade!: WebChannelEndpointFacadeService;
  private readonly controlPlaneService!: WebAgentControlPlaneService;

  syncWorkspaceWatcher(): Promise<void> {
    return this.serverLifecycleGateway.syncWorkspaceWatcher();
  }

  constructor(opts: WebChannelOpts) {
    initializeWebChannelConstructor(this, opts, {
      defaultChatJid: DEFAULT_CHAT_JID,
      defaultAgentId: DEFAULT_AGENT_ID,
    });
    this.runtimePublicSurfaceService = createWebChannelRuntimePublicSurfaceService(
      this as unknown as WebChannelRuntimePublicSurfaceChannel,
    );
    this.lifecycleSpecialSurfaceService = createWebChannelLifecycleSpecialSurfaceService(
      this as unknown as WebChannelLifecycleSpecialSurfaceChannel,
      { defaultChatJid: DEFAULT_CHAT_JID, defaultAgentId: DEFAULT_AGENT_ID },
    );
  }
}

// eslint-disable-next-line typescript/no-unsafe-declaration-merging, no-redeclare, typescript/no-empty-object-type
export interface WebChannel extends WebChannelPrototypeMembers {}

installWebChannelPrototype(WebChannel.prototype, {
  defaultChatJid: DEFAULT_CHAT_JID,
  defaultAgentId: DEFAULT_AGENT_ID,
});
