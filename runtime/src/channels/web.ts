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
import type { WebServerLifecycleGatewayService } from "./web/server-lifecycle-gateway-service.js";
import type { WebTerminalVncHttpServiceSurface } from "./web/terminal-vnc-http-service.js";
import type { WebAdaptiveCardSidePromptService } from "./web/cards/adaptive-card-side-prompt-service.js";
import type { WebAgentPeerMessageRelayService } from "./web/agent/agent-peer-message-relay-service.js";
import {
  createWebChannelHttpSurfaceService,
  type WebChannelHttpSurfaceChannel,
  type WebChannelHttpSurfaceService,
} from "./web/core/web-channel-http-surface-service.js";
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
import type { TerminalSocketData } from "./web/terminal/terminal-session-service.js";
import { VncSessionService } from "./web/vnc/vnc-session-service.js";
import type { VncSocketData } from "./web/vnc/vnc-session-service.js";
import type { WebMessageProcessingStorageService } from "./web/messaging/message-processing-storage-service.js";
import type { WebChannelRuntimeFollowupFacadeService } from "./web/runtime/runtime-followup-facade-service.js";
import { initializeWebChannelConstructor } from "./web/core/web-channel-constructor-factory.js";

const DEFAULT_CHAT_JID = "web:default";
const DEFAULT_AGENT_ID = "default";
const STATE_KEY = "last_agent_timestamp_web";

function createLazyTerminalService(factory: () => TerminalSessionService): TerminalSessionService {
  let instance: TerminalSessionService | null = null;
  const get = (): TerminalSessionService => {
    instance ??= factory();
    return instance;
  };
  return {
    resolveOwnerFromRequest(req: Request, allowUnauthenticated = false) {
      return get().resolveOwnerFromRequest(req, allowUnauthenticated);
    },
    getSessionInfo(owner: { token: string; userId: string }) {
      return get().getSessionInfo(owner);
    },
    attachClient(ws: Bun.ServerWebSocket<TerminalSocketData>) {
      return get().attachClient(ws);
    },
    handleMessage(ws: Bun.ServerWebSocket<TerminalSocketData>, rawMessage: string | Buffer | Uint8Array) {
      return get().handleMessage(ws, rawMessage);
    },
    detachClient(ws: Bun.ServerWebSocket<TerminalSocketData>) {
      return get().detachClient(ws);
    },
    createHandoffFromRequest(req: Request, allowUnauthenticated = false) {
      return get().createHandoffFromRequest(req, allowUnauthenticated);
    },
    shutdown() {
      return get().shutdown();
    },
  } as unknown as TerminalSessionService;
}

function createLazyVncService(factory: () => VncSessionService): VncSessionService {
  let instance: VncSessionService | null = null;
  const get = (): VncSessionService => {
    instance ??= factory();
    return instance;
  };
  return {
    prepareTargetReference(targetRef: string) {
      return get().prepareTargetReference(targetRef);
    },
    resolveTargetReference(targetRef: string) {
      return get().resolveTargetReference(targetRef);
    },
    resolveOwnerFromRequest(req: Request, targetRef: string, allowUnauthenticated = false) {
      return get().resolveOwnerFromRequest(req, targetRef, allowUnauthenticated);
    },
    createHandoffFromRequest(req: Request, targetRef: string, allowUnauthenticated = false) {
      return get().createHandoffFromRequest(req, targetRef, allowUnauthenticated);
    },
    getSessionInfo(targetRef?: string | null) {
      return get().getSessionInfo(targetRef);
    },
    attachClient(ws: Bun.ServerWebSocket<VncSocketData>) {
      return get().attachClient(ws);
    },
    handleMessage(ws: Bun.ServerWebSocket<VncSocketData>, message: string | Buffer | Uint8Array) {
      return get().handleMessage(ws, message);
    },
    detachClient(ws: Bun.ServerWebSocket<VncSocketData>) {
      return get().detachClient(ws);
    },
    shutdown() {
      return get().shutdown();
    },
  } as unknown as VncSessionService;
}

/** Construction options for WebChannel: queue and agentPool references. */
export interface WebChannelOpts {
  queue: AgentQueue;
  agentPool: AgentPool;
}

/** Web channel: HTTP/SSE server, API endpoints, and agent event bridge. */
// eslint-disable-next-line typescript/no-unsafe-declaration-merging, no-redeclare
export class WebChannel implements WebChannelLike {
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
  private readonly httpSurfaceService!: WebChannelHttpSurfaceService;
  private readonly runtimePublicSurfaceService!: WebChannelRuntimePublicSurfaceService;
  private readonly lifecycleSpecialSurfaceService!: WebChannelLifecycleSpecialSurfaceService;
  private readonly messageProcessingStorageService!: WebMessageProcessingStorageService;
  private readonly messageWriteService!: WebMessageWriteService;
  private readonly runtimeFollowupFacade!: WebChannelRuntimeFollowupFacadeService;
  private readonly endpointFacade!: WebChannelEndpointFacadeService;
  private readonly controlPlaneService!: WebAgentControlPlaneService;

  syncWorkspaceWatcher(): Promise<void> {
    return this.serverLifecycleGateway.syncWorkspaceWatcher();
  }

  constructor(opts: WebChannelOpts) {
    initializeWebChannelConstructor(this, opts, {
      defaultChatJid: DEFAULT_CHAT_JID,
      defaultAgentId: DEFAULT_AGENT_ID,
      stateKey: STATE_KEY,
    });
    this.httpSurfaceService = createWebChannelHttpSurfaceService(this as unknown as WebChannelHttpSurfaceChannel);
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
