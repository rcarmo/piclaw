import type { AgentPool } from "../../../agent-pool.js";
import type { AgentQueue } from "../../../queue.js";
import {
  getIdentityConfig,
  getWebRuntimeConfig,
  getWebServerConfig,
} from "../../../core/config.js";
import { getChatCursor, getDb, replaceMessageContent } from "../../../db.js";
import { RemoteInteropService } from "../../../remote/service.js";
import { handlePost as handlePostRequest } from "../handlers/posts.js";
import { handleAgentMessage as handleAgentMessageRequest } from "../handlers/agent.js";
import {
  WebAdaptiveCardSidePromptService,
  type WebAdaptiveCardSidePromptServiceOptions,
} from "../cards/adaptive-card-side-prompt-service.js";
import {
  createWebAgentControlPlaneService,
  type WebAgentControlPlaneService,
} from "../agent/agent-control-plane-service.js";
import {
  createWebAgentPeerMessageRelayService,
  type WebAgentPeerMessageRelayChannelLike,
  type WebAgentPeerMessageRelayService,
} from "../agent/agent-peer-message-relay-service.js";
import { ensureAvatarCache } from "../media/avatar-service.js";
import { WebAuthGateway } from "../auth/auth-gateway.js";
import {
  createWebChannelEndpointContexts,
  createWebChannelIdentitySnapshot,
  type WebChannelEndpointContexts,
  type WebChannelEndpointFactoryOptions,
} from "../endpoints/channel-endpoint-context-factory.js";
import {
  WebChannelEndpointFacadeService,
  type WebChannelEndpointFacadeOptions,
} from "../endpoints/channel-endpoint-facade-service.js";
import type { InteractionBroadcaster, InteractionBroadcasterProfile } from "../interaction-broadcaster.js";
import { createInteractionBroadcaster } from "../interaction-broadcaster.js";
import {
  createWebMessageProcessingStorageService,
  type WebMessageProcessingStorageService,
} from "../messaging/message-processing-storage-service.js";
import { WebMessageWriteService, type WebMessageWriteServiceDeps } from "../message-write-service.js";
import { QueuedFollowupLifecycleService } from "../runtime/queued-followup-lifecycle-service.js";
import { RequestRouterService } from "../request-router-service.js";
import { WebChannelRuntimeFollowupFacadeService } from "../runtime/runtime-followup-facade-service.js";
import {
  WebChannelRuntimeStateService,
  type WebChannelRuntimeStateCallbacks,
  type WebChannelRuntimeStateOptions,
} from "../runtime/runtime-state-service.js";
import {
  createWebServerLifecycleGateway,
  type WebServerLifecycleGatewayChannel,
  type WebServerLifecycleGatewayService,
} from "../server-lifecycle-gateway-service.js";
import { WebSessionBroadcastService } from "../sse/session-broadcast-service.js";
import { TerminalSessionService } from "../terminal/terminal-session-service.js";
import {
  createWebTerminalVncHttpService,
  type WebTerminalVncHttpChannel,
  type WebTerminalVncHttpService,
  type WebTerminalVncHttpServiceSurface,
} from "../terminal-vnc-http-service.js";
import { TotpFailureTracker } from "../auth/totp-failure-tracker.js";
import { VncSessionService } from "../vnc/vnc-session-service.js";
import type { WebChannelLike } from "./web-channel-contracts.js";
import { WebauthnChallengeTracker } from "../auth/webauthn-challenges.js";

type AgentPoolWithKnownChats = AgentPool & {
  listKnownChats?: (rootChatJid?: string | null, options?: { includeArchived?: boolean }) => unknown[];
};

export interface WebChannelConstructorFactoryChannel {
  queue: AgentQueue;
  agentPool: AgentPool;
  authGateway?: WebAuthGateway;
  interactionBroadcaster?: InteractionBroadcaster;
  queuedFollowupLifecycle: QueuedFollowupLifecycleService;
  terminalService: TerminalSessionService;
  vncService: VncSessionService;
  workspaceVisible: boolean;
  workspaceShowHidden: boolean;
  webauthnChallenges: WebauthnChallengeTracker;
  totpFailureTracker: TotpFailureTracker;
  json(payload: unknown, status?: number): Response;
  broadcastEvent(eventType: string, data: unknown): void;
  handleRequest(req: Request): Promise<Response>;
  loadState(): void;
  processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void>;
  storeMessage(
    chatJid: string,
    content: string,
    isBot: boolean,
    mediaIds: number[],
    options?: {
      contentBlocks?: unknown[];
      linkPreviews?: unknown[];
      threadId?: number;
      isTerminalAgentReply?: boolean;
      isSteeringMessage?: boolean;
    },
  ): ReturnType<WebChannelLike["storeMessage"]>;
}

export interface WebChannelConstructorFactoryDefaults {
  defaultChatJid: string;
  defaultAgentId: string;
  stateKey: string;
}

export interface WebChannelConstructorFactoryRuntimeOpts {
  queue: AgentQueue;
  agentPool: AgentPool;
}

export interface WebChannelConstructorFactoryOptions extends WebChannelConstructorFactoryDefaults {
  webServerConfig: {
    host: string;
    port: number;
    idleTimeout: number;
    tlsCert?: string | null;
    tlsKey?: string | null;
  };
  webRuntimeConfig: {
    passkeyMode?: string;
    totpSecret?: string;
    internalSecret?: string;
    sessionTtl: number;
    terminalEnabled: boolean;
    debugCardSubmissions?: boolean;
    totpWindow?: number;
  };
}

export interface WebChannelConstructorFactoryResult {
  sessionBroadcast: WebSessionBroadcastService;
  remoteInterop: RemoteInteropService;
  runtimeState: WebChannelRuntimeStateService;
  interactionBroadcaster: InteractionBroadcaster;
  authGateway: WebAuthGateway;
  messageProcessingStorageService: WebMessageProcessingStorageService;
  messageWriteService: WebMessageWriteService;
  runtimeFollowupFacade: WebChannelRuntimeFollowupFacadeService;
  requestRouter: RequestRouterService;
  endpointContexts: WebChannelEndpointContexts;
  endpointFacade: WebChannelEndpointFacadeService;
  controlPlaneService: WebAgentControlPlaneService;
  serverLifecycleGateway: WebServerLifecycleGatewayService;
  terminalVncHttpService: WebTerminalVncHttpServiceSurface;
  adaptiveCardSidePromptService: WebAdaptiveCardSidePromptService;
  peerMessageRelayService: WebAgentPeerMessageRelayService;
}

export interface WebChannelConstructorFactoryDeps {
  getIdentityConfig(): ReturnType<typeof getIdentityConfig>;
  getChatCursor(chatJid: string): string;
  createSessionBroadcast(agentPool: AgentPool): WebSessionBroadcastService;
  createRemoteInterop(agentPool: AgentPool): RemoteInteropService;
  createRuntimeState(
    callbacks: WebChannelRuntimeStateCallbacks,
    options: WebChannelRuntimeStateOptions,
  ): WebChannelRuntimeStateService;
  createIdentitySnapshot(identity: ReturnType<typeof getIdentityConfig>): ReturnType<typeof createWebChannelIdentitySnapshot>;
  createInteractionBroadcaster(
    channel: WebChannelConstructorFactoryChannel,
    profileOrFn: InteractionBroadcasterProfile | (() => InteractionBroadcasterProfile),
  ): InteractionBroadcaster;
  createAuthGateway(
    config: ConstructorParameters<typeof WebAuthGateway>[0],
    deps: ConstructorParameters<typeof WebAuthGateway>[1],
  ): WebAuthGateway;
  createMessageProcessingStorageService(
    channel: WebChannelConstructorFactoryChannel,
    defaults: { defaultAgentId: string; getAssistantName(): string; getUserName?(): string | null | undefined },
  ): WebMessageProcessingStorageService;
  createMessageWriteService(deps: WebMessageWriteServiceDeps): WebMessageWriteService;
  createRuntimeFollowupFacade(
    deps: ConstructorParameters<typeof WebChannelRuntimeFollowupFacadeService>[0],
  ): WebChannelRuntimeFollowupFacadeService;
  createRequestRouter(channel: WebChannelConstructorFactoryChannel): RequestRouterService;
  createEndpointContexts(
    channel: WebChannelConstructorFactoryChannel,
    options: WebChannelEndpointFactoryOptions,
  ): WebChannelEndpointContexts;
  createEndpointFacade(options: WebChannelEndpointFacadeOptions): WebChannelEndpointFacadeService;
  createControlPlaneService(
    channel: WebChannelConstructorFactoryChannel,
    defaults: { defaultChatJid: string; defaultAgentId: string },
  ): WebAgentControlPlaneService;
  createServerLifecycleGateway(
    channel: WebServerLifecycleGatewayChannel,
    configs: { webServerConfig: WebChannelConstructorFactoryOptions["webServerConfig"]; webRuntimeConfig: WebChannelConstructorFactoryOptions["webRuntimeConfig"] },
  ): WebServerLifecycleGatewayService;
  createTerminalVncHttpService(
    channel: WebTerminalVncHttpChannel,
    configs: { webRuntimeConfig: WebChannelConstructorFactoryOptions["webRuntimeConfig"] },
  ): WebTerminalVncHttpService;
  createAdaptiveCardSidePromptService(options: WebAdaptiveCardSidePromptServiceOptions): WebAdaptiveCardSidePromptService;
  createPeerMessageRelayService(
    channel: WebChannelConstructorFactoryChannel,
    defaults: { defaultAgentId: string },
  ): WebAgentPeerMessageRelayService;
  replaceMessageContent: typeof replaceMessageContent;
  getDb: typeof getDb;
  ensureAvatarCache: typeof ensureAvatarCache;
  handlePostRequest(
    channel: WebChannelConstructorFactoryChannel,
    req: Request,
    isReply: boolean,
    chatJid: string,
  ): Promise<Response>;
}

const defaultDeps: WebChannelConstructorFactoryDeps = {
  getIdentityConfig,
  getChatCursor,
  createSessionBroadcast: (agentPool) => new WebSessionBroadcastService(agentPool),
  createRemoteInterop: (agentPool) => new RemoteInteropService(agentPool),
  createRuntimeState: (callbacks, options) => new WebChannelRuntimeStateService(callbacks, options),
  createIdentitySnapshot: (identity) => createWebChannelIdentitySnapshot(identity),
  createInteractionBroadcaster,
  createAuthGateway: (config, deps) => new WebAuthGateway(config, deps),
  createMessageProcessingStorageService: (channel, defaults) =>
    createWebMessageProcessingStorageService(channel as unknown as Parameters<typeof createWebMessageProcessingStorageService>[0], defaults),
  createMessageWriteService: (deps) => new WebMessageWriteService(deps),
  createRuntimeFollowupFacade: (deps) => new WebChannelRuntimeFollowupFacadeService(deps),
  createRequestRouter: (channel) => new RequestRouterService(channel as unknown as WebChannelLike),
  createEndpointContexts: (channel, options) =>
    createWebChannelEndpointContexts(channel as unknown as WebChannelLike, options),
  createEndpointFacade: (options) => new WebChannelEndpointFacadeService(options),
  createControlPlaneService: (channel, defaults) =>
    createWebAgentControlPlaneService(channel as unknown as Parameters<typeof createWebAgentControlPlaneService>[0], defaults),
  createServerLifecycleGateway: (channel, configs) => createWebServerLifecycleGateway(channel, configs),
  createTerminalVncHttpService: (channel, configs) => createWebTerminalVncHttpService(channel, configs),
  createAdaptiveCardSidePromptService: (options) => new WebAdaptiveCardSidePromptService(options),
  createPeerMessageRelayService: (channel, defaults) =>
    createWebAgentPeerMessageRelayService(channel as unknown as WebAgentPeerMessageRelayChannelLike, defaults),
  replaceMessageContent,
  getDb,
  ensureAvatarCache,
  handlePostRequest: (channel, req, isReply, chatJid) =>
    handlePostRequest(channel as unknown as WebChannelLike, req, isReply, chatJid),
};

function resolveListKnownChats(agentPool: AgentPool): WebChannelEndpointFacadeOptions["listKnownChats"] {
  return typeof (agentPool as AgentPoolWithKnownChats).listKnownChats === "function"
    ? (rootChatJid, options) => (agentPool as AgentPoolWithKnownChats).listKnownChats!(rootChatJid, options)
    : undefined;
}

export function initializeWebChannelConstructor(
  channel: WebChannelConstructorFactoryChannel,
  runtimeOpts: WebChannelConstructorFactoryRuntimeOpts,
  defaults: WebChannelConstructorFactoryDefaults,
  deps: WebChannelConstructorFactoryDeps = defaultDeps,
): void {
  Object.assign(channel, runtimeOpts);
  Object.assign(channel, createDefaultWebChannelConstructorFactory(channel, defaults, deps));
}

export function createDefaultWebChannelConstructorFactory(
  channel: WebChannelConstructorFactoryChannel,
  defaults: WebChannelConstructorFactoryDefaults,
  deps: WebChannelConstructorFactoryDeps = defaultDeps,
): WebChannelConstructorFactoryResult {
  return createWebChannelConstructorFactory(channel, {
    ...defaults,
    webServerConfig: getWebServerConfig(),
    webRuntimeConfig: getWebRuntimeConfig(),
  }, deps);
}

export function createWebChannelConstructorFactory(
  channel: WebChannelConstructorFactoryChannel,
  options: WebChannelConstructorFactoryOptions,
  deps: WebChannelConstructorFactoryDeps = defaultDeps,
): WebChannelConstructorFactoryResult {
  const sessionBroadcast = deps.createSessionBroadcast(channel.agentPool);
  let remoteInteropInstance: RemoteInteropService | null = null;
  const getRemoteInterop = (): RemoteInteropService => {
    remoteInteropInstance ??= deps.createRemoteInterop(channel.agentPool);
    return remoteInteropInstance;
  };
  const remoteInterop: RemoteInteropService = {
    async handleRequest(req: Request): Promise<Response> {
      return await getRemoteInterop().handleRequest(req);
    },
  } as RemoteInteropService;
  const runtimeState = deps.createRuntimeState(
    {
      getAssistantName: () => deps.getIdentityConfig().assistantName,
      getChatCursor: (chatJid) => deps.getChatCursor(chatJid),
      enqueue: (task, key, laneKey) => channel.queue.enqueue(task, key, laneKey),
      processChat: (chatJid, agentId, threadRootId) => channel.processChat(chatJid, agentId, threadRootId),
    },
    {
      defaultAgentId: options.defaultAgentId,
      stateKey: options.stateKey,
    },
  );

  const getIdentitySnapshot = () => deps.createIdentitySnapshot(deps.getIdentityConfig());

  const interactionBroadcaster = deps.createInteractionBroadcaster(channel, () => {
    const identity = getIdentitySnapshot();
    return {
      agentName: identity.assistantName,
      agentAvatar: identity.agentAvatarUrl,
      userName: identity.userName,
      userAvatar: identity.userAvatarUrl,
      userAvatarBackground: identity.userAvatarBackground,
    };
  });

  const authGateway = deps.createAuthGateway(
    {
      passkeyMode: options.webRuntimeConfig.passkeyMode || "",
      totpSecret: options.webRuntimeConfig.totpSecret || "",
      internalSecret: options.webRuntimeConfig.internalSecret || "",
      sessionTtlSeconds: options.webRuntimeConfig.sessionTtl,
      hasTls: Boolean(options.webServerConfig.tlsCert && options.webServerConfig.tlsKey),
    },
    {
      json: (payload, status = 200) => channel.json(payload, status),
      challenges: channel.webauthnChallenges,
      failureTracker: channel.totpFailureTracker,
    },
  );

  const messageProcessingStorageService = deps.createMessageProcessingStorageService(channel, {
    defaultAgentId: options.defaultAgentId,
    getAssistantName: () => deps.getIdentityConfig().assistantName,
    getUserName: () => deps.getIdentityConfig().userName,
  });

  const messageWriteService = deps.createMessageWriteService({
    defaultAgentId: options.defaultAgentId,
    storeMessage: (chatJid, content, isBot, mediaIds, writeOptions) =>
      channel.storeMessage(chatJid, content, isBot, mediaIds, writeOptions),
    replaceMessageContent: (chatJid, rowId, text, mediaIds, contentBlocks, isTerminalAgentReply) =>
      deps.replaceMessageContent(chatJid, rowId, text, { contentBlocks, mediaIds, isTerminalAgentReply }) ?? null,
    setMessageThreadToSelf: (messageId) => {
      deps.getDb().prepare("UPDATE messages SET thread_id = ? WHERE rowid = ?").run(messageId, messageId);
    },
    broadcastAgentResponse: (interaction) => interactionBroadcaster.broadcastAgentResponse(interaction),
    broadcastInteractionUpdated: (interaction) => interactionBroadcaster.broadcastInteractionUpdated(interaction),
    enqueueFollowupPlaceholder: (chatJid, rowId, queuedContent, threadId, queuedAt) =>
      channel.queuedFollowupLifecycle.enqueuePlaceholder(chatJid, rowId, queuedContent, threadId, queuedAt),
  });

  const runtimeFollowupFacade = deps.createRuntimeFollowupFacade({
    getMessageWriteService: () => {
      const dynamicChannel = channel as typeof channel & { messageWriteService?: typeof messageWriteService };
      return dynamicChannel.messageWriteService ?? messageWriteService;
    },
    getQueuedFollowupLifecycle: () => channel.queuedFollowupLifecycle,
    getRuntimeState: () => runtimeState,
  });

  const requestRouter = deps.createRequestRouter(channel);
  const endpointContexts = deps.createEndpointContexts(channel, {
    defaultChatJid: options.defaultChatJid,
    defaultAgentId: options.defaultAgentId,
    getIdentitySnapshot,
  });

  const endpointFacade = deps.createEndpointFacade({
    endpointContexts,
    defaultChatJid: options.defaultChatJid,
    agentPool: channel.agentPool,
    getIdentitySnapshot,
    ensureAvatarCache: deps.ensureAvatarCache,
    json: (payload, status = 200) => channel.json(payload, status),
    broadcastEvent: (eventType, data) => channel.broadcastEvent(eventType, data),
    handlePostRequest: (req, isReply, chatJid) => deps.handlePostRequest(channel, req, isReply, chatJid),
    listActiveChats: () => channel.agentPool.listActiveChats(),
    listKnownChats: resolveListKnownChats(channel.agentPool),
    getSessionTreeForChat: (chatJid: string) =>
      (channel.agentPool as { getSessionTreeForChat?: (chatJid: string) => { leafId: string | null; nodes: unknown[] } | null }).getSessionTreeForChat?.(chatJid) ?? null,
  });

  const controlPlaneService = deps.createControlPlaneService(channel, {
    defaultChatJid: options.defaultChatJid,
    defaultAgentId: options.defaultAgentId,
  });

  const serverLifecycleGateway = deps.createServerLifecycleGateway(
    {
      json: (payload, status = 200) => channel.json(payload, status),
      loadState: () => channel.loadState(),
      handleRequest: (req) => channel.handleRequest(req),
      authGateway,
      terminalService: channel.terminalService,
      vncService: channel.vncService,
      get workspaceVisible() {
        return channel.workspaceVisible;
      },
      get workspaceShowHidden() {
        return channel.workspaceShowHidden;
      },
      broadcastEvent: (eventType, data) => channel.broadcastEvent(eventType, data),
      uiBridge: sessionBroadcast.uiBridge,
      sse: sessionBroadcast.sse,
    },
    {
      webServerConfig: options.webServerConfig,
      webRuntimeConfig: options.webRuntimeConfig,
    },
  );

  let terminalVncHttpServiceInstance: WebTerminalVncHttpService | null = null;
  const getTerminalVncHttpService = (): WebTerminalVncHttpService => {
    terminalVncHttpServiceInstance ??= deps.createTerminalVncHttpService(
      {
        json: (payload, status = 200) => channel.json(payload, status),
        authGateway,
        terminalService: channel.terminalService,
        vncService: channel.vncService,
      },
      {
        webRuntimeConfig: options.webRuntimeConfig,
      },
    );
    return terminalVncHttpServiceInstance;
  };

  const terminalVncHttpService: WebTerminalVncHttpServiceSurface = {
    handleTerminalSession(req: Request): Response {
      return getTerminalVncHttpService().handleTerminalSession(req);
    },
    async handleTerminalHandoff(req: Request): Promise<Response> {
      return await getTerminalVncHttpService().handleTerminalHandoff(req);
    },
    handleVncSession(req: Request): Response {
      return getTerminalVncHttpService().handleVncSession(req);
    },
    async handleVncHandoff(req: Request): Promise<Response> {
      return await getTerminalVncHttpService().handleVncHandoff(req);
    },
  };

  const adaptiveCardSidePromptService = deps.createAdaptiveCardSidePromptService({
    defaultChatJid: options.defaultChatJid,
    defaultAgentId: options.defaultAgentId,
    json: (payload, status = 200) => channel.json(payload, status),
    webRuntimeConfig: options.webRuntimeConfig,
    agentPool: channel.agentPool,
    authGateway,
    interactionBroadcaster,
    sendMessage: (chatJid, text, sendOptions) => runtimeFollowupFacade.sendMessage(chatJid, text, sendOptions),
    broadcastEvent: (eventType, data) => channel.broadcastEvent(eventType, data),
    skipFailedOnModelSwitch: (chatJid) => runtimeState.skipFailedOnModelSwitch(chatJid),
    forwardAgentMessage: async (req, pathname, chatJid, agentId) => {
      return await handleAgentMessageRequest(
        channel as unknown as WebChannelLike,
        req,
        pathname,
        chatJid,
        agentId,
      );
    },
  });

  const peerMessageRelayService = deps.createPeerMessageRelayService(channel, {
    defaultAgentId: options.defaultAgentId,
  });

  return {
    sessionBroadcast,
    remoteInterop,
    runtimeState,
    interactionBroadcaster,
    authGateway,
    messageProcessingStorageService,
    messageWriteService,
    runtimeFollowupFacade,
    requestRouter,
    endpointContexts,
    endpointFacade,
    controlPlaneService,
    serverLifecycleGateway,
    terminalVncHttpService,
    adaptiveCardSidePromptService,
    peerMessageRelayService,
  };
}
