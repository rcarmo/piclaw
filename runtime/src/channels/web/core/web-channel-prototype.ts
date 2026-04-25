import type { InteractionRow } from "../../../db.js";
import type { QueuedFollowupItem } from "../runtime/followup-placeholders.js";
import type { SendMessageOptions } from "../messaging/message-write-flows.js";
import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";
import type { WebSessionBroadcastService } from "../sse/session-broadcast-service.js";
import type { WebChannelLike } from "./web-channel-contracts.js";
import {
  getWebChannelHttpSurfaceService,
  type WebChannelHttpSurfaceChannel,
  type WebChannelHttpSurfaceService,
  type WebChannelHttpSurfaceServiceCarrier,
} from "./web-channel-http-surface-service.js";
import {
  getWebChannelRuntimePublicSurfaceService,
  type WebChannelRuntimePublicSurfaceChannel,
  type WebChannelRuntimePublicSurfaceService,
  type WebChannelRuntimePublicSurfaceServiceCarrier,
} from "./web-channel-runtime-public-surface-service.js";
import {
  getWebChannelLifecycleSpecialSurfaceService,
  type WebChannelLifecycleSpecialSurfaceChannel,
  type WebChannelLifecycleSpecialSurfaceService,
  type WebChannelLifecycleSpecialSurfaceServiceCarrier,
} from "./web-channel-lifecycle-special-surface-service.js";
import type { WebSocketSessionData } from "../server-lifecycle-gateway-service.js";

interface WebChannelLifecycleDefaults {
  defaultChatJid: string;
  defaultAgentId: string;
}

export interface WebChannelPrototypeMembers extends WebChannelLike {
  readonly sse: WebSessionBroadcastService["sse"];
  readonly uiBridge: WebSessionBroadcastService["uiBridge"];
  readonly server: Bun.Server<WebSocketSessionData> | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  handleFetch(req: Request, server?: Bun.Server<WebSocketSessionData>): Promise<Response | undefined>;
  handleRequest(req: Request): Promise<Response>;
  recoverInflightRuns(): void;
  recoverStaleInflightRun(chatJid: string, options?: { hasActiveStatus?: boolean; minAgeMs?: number }): boolean;
  resumePendingChats(chatJid?: string): void;
  loadState(): void;
  processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void>;
}

function getHttpSurfaceService(channel: object): WebChannelHttpSurfaceService {
  return getWebChannelHttpSurfaceService(
    channel as WebChannelHttpSurfaceChannel & WebChannelHttpSurfaceServiceCarrier,
  );
}

function getRuntimePublicSurfaceService(channel: object): WebChannelRuntimePublicSurfaceService {
  return getWebChannelRuntimePublicSurfaceService(
    channel as WebChannelRuntimePublicSurfaceChannel & WebChannelRuntimePublicSurfaceServiceCarrier,
  );
}

function getLifecycleSpecialSurfaceService(
  channel: object,
  defaults: WebChannelLifecycleDefaults,
): WebChannelLifecycleSpecialSurfaceService {
  return getWebChannelLifecycleSpecialSurfaceService(
    channel as WebChannelLifecycleSpecialSurfaceChannel & WebChannelLifecycleSpecialSurfaceServiceCarrier,
    defaults,
  );
}

function withHttpSurface<Args extends unknown[], Result>(
  callback: (service: WebChannelHttpSurfaceService, ...args: Args) => Result,
): (this: object, ...args: Args) => Result {
  return function delegateHttpSurface(this: object, ...args: Args): Result {
    return callback(getHttpSurfaceService(this), ...args);
  };
}

function withRuntimePublicSurface<Args extends unknown[], Result>(
  callback: (service: WebChannelRuntimePublicSurfaceService, ...args: Args) => Result,
): (this: object, ...args: Args) => Result {
  return function delegateRuntimePublicSurface(this: object, ...args: Args): Result {
    return callback(getRuntimePublicSurfaceService(this), ...args);
  };
}

function withLifecycleSpecialSurface<Args extends unknown[], Result>(
  defaults: WebChannelLifecycleDefaults,
  callback: (service: WebChannelLifecycleSpecialSurfaceService, ...args: Args) => Result,
): (this: object, ...args: Args) => Result {
  return function delegateLifecycleSpecialSurface(this: object, ...args: Args): Result {
    return callback(getLifecycleSpecialSurfaceService(this, defaults), ...args);
  };
}

function runtimePublicGetter<Result>(
  callback: (service: WebChannelRuntimePublicSurfaceService) => Result,
): (this: object) => Result {
  return function getRuntimePublicValue(this: object): Result {
    return callback(getRuntimePublicSurfaceService(this));
  };
}

function lifecycleSpecialGetter<Result>(
  defaults: WebChannelLifecycleDefaults,
  callback: (service: WebChannelLifecycleSpecialSurfaceService) => Result,
): (this: object) => Result {
  return function getLifecycleSpecialValue(this: object): Result {
    return callback(getLifecycleSpecialSurfaceService(this, defaults));
  };
}

export function installWebChannelPrototype(
  target: object,
  defaults: WebChannelLifecycleDefaults,
): void {
  Object.defineProperties(target, {
    sse: {
      configurable: true,
      get: runtimePublicGetter((service) => service.sse),
    },
    uiBridge: {
      configurable: true,
      get: runtimePublicGetter((service) => service.uiBridge),
    },
    server: {
      configurable: true,
      get: lifecycleSpecialGetter(defaults, (service) => service.server),
    },
    start: {
      configurable: true,
      writable: true,
      value: withLifecycleSpecialSurface(defaults, async (service) => await service.start()),
    },
    stop: {
      configurable: true,
      writable: true,
      value: withLifecycleSpecialSurface(defaults, async (service) => await service.stop()),
    },
    sendMessage: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface(async (service, chatJid: string, text: string, options?: SendMessageOptions) =>
        await service.sendMessage(chatJid, text, options)),
    },
    postDashboardWidget: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface(async (
        service,
        chatJid: string,
        options?: { threadId?: number | null; text?: string; widgetId?: string },
      ) => await service.postDashboardWidget(chatJid, options)),
    },
    queueFollowupPlaceholder: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface(
        (service, chatJid: string, text: string, threadId?: number, queuedContent?: string): InteractionRow | null =>
          service.queueFollowupPlaceholder(chatJid, text, threadId, queuedContent),
      ),
    },
    enqueueQueuedFollowupItem: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((
        service,
        chatJid: string,
        rowId: number,
        queuedContent: string,
        threadId?: number | null,
        queuedAt?: string,
        extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[] },
      ): number => service.enqueueQueuedFollowupItem(chatJid, rowId, queuedContent, threadId, queuedAt, extras)),
    },
    consumeQueuedFollowupItem: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface(
        (service, chatJid: string): QueuedFollowupItem | null => service.consumeQueuedFollowupItem(chatJid),
      ),
    },
    prependQueuedFollowupItem: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string, item: QueuedFollowupItem): void => {
        service.prependQueuedFollowupItem(chatJid, item);
      }),
    },
    consumeQueuedFollowupPlaceholder: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string): number | null =>
        service.consumeQueuedFollowupPlaceholder(chatJid)),
    },
    getQueuedFollowupCount: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string): number => service.getQueuedFollowupCount(chatJid)),
    },
    getQueuedFollowupItems: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string): QueuedFollowupItem[] => service.getQueuedFollowupItems(chatJid)),
    },
    removeQueuedFollowupItem: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string, rowId: number): QueuedFollowupItem | null =>
        service.removeQueuedFollowupItem(chatJid, rowId)),
    },
    queuePendingSteering: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string, timestamp: string | undefined): void => {
        service.queuePendingSteering(chatJid, timestamp);
      }),
    },
    consumePendingSteering: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string): string[] => service.consumePendingSteering(chatJid)),
    },
    updateAgentStatus: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string, status: Record<string, unknown>): void => {
        service.updateAgentStatus(chatJid, status);
      }),
    },
    getAgentStatus: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string): Record<string, unknown> | null =>
        service.getAgentStatus(chatJid)),
    },
    setContextUsage: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string, usage: Record<string, unknown> | null): void => {
        service.setContextUsage(chatJid, usage);
      }),
    },
    getContextUsage: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string): Record<string, unknown> | null =>
        service.getContextUsage(chatJid)),
    },
    replaceQueuedFollowupPlaceholder: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((
        service,
        chatJid: string,
        rowId: number,
        text: string,
        mediaIds: number[],
        contentBlocks: Array<Record<string, unknown>> | undefined,
        threadId?: number,
        isTerminalAgentReply?: boolean,
      ): InteractionRow | null =>
        service.replaceQueuedFollowupPlaceholder(
          chatJid,
          rowId,
          text,
          mediaIds,
          contentBlocks,
          threadId,
          isTerminalAgentReply,
        )),
    },
    getThreadRootId: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string, messageId: string): number | null =>
        service.getThreadRootId(chatJid, messageId)),
    },
    resumeChat: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string, threadRootId?: number | null): void => {
        service.resumeChat(chatJid, threadRootId);
      }),
    },
    skipFailedOnModelSwitch: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string): boolean => (
        service.skipFailedOnModelSwitch(chatJid)
      )),
    },
    retryFailedOnModelSwitch: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string): boolean => (
        service.retryFailedOnModelSwitch(chatJid)
      )),
    },
    recoverInflightRuns: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service): void => {
        service.recoverInflightRuns();
      }),
    },
    recoverStaleInflightRun: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string, options?: { hasActiveStatus?: boolean; minAgeMs?: number }): boolean => (
        service.recoverStaleInflightRun(chatJid, options)
      )),
    },
    resumePendingChats: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid?: string): void => {
        service.resumePendingChats(chatJid);
      }),
    },
    loadState: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service): void => {
        service.loadState();
      }),
    },
    saveState: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service): void => {
        service.saveState();
      }),
    },
    setPanelExpanded: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, turnId: string, panel: "thought" | "draft", expanded: boolean): void => {
        service.setPanelExpanded(turnId, panel, expanded);
      }),
    },
    isPanelExpanded: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, turnId: string, panel: "thought" | "draft"): boolean =>
        service.isPanelExpanded(turnId, panel)),
    },
    updateThoughtBuffer: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, turnId: string, text: string, totalLines: number): void => {
        service.updateThoughtBuffer(turnId, text, totalLines);
      }),
    },
    updateDraftBuffer: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, turnId: string, text: string, totalLines: number): void => {
        service.updateDraftBuffer(turnId, text, totalLines);
      }),
    },
    getBuffer: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined =>
        service.getBuffer(turnId, panel)),
    },
    handleFetch: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request, server?: Bun.Server<WebSocketSessionData>) =>
        service.handleFetch(req, server)),
    },
    handleRequest: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request) => service.handleRequest(req)),
    },
    handleAgents: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service) => await service.handleAgents()),
    },
    handleManifest: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleManifest(req)),
    },
    handleAvatar: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, kind: "agent" | "user", req: Request) => await service.handleAvatar(kind, req)),
    },
    handleWorkspaceVisibility: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleWorkspaceVisibility(req)),
    },
    handleTimeline: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, limit: number, before?: number, chatJid?: string) =>
        service.handleTimeline(limit, before, chatJid)),
    },
    handleHashtag: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, tag: string, limit: number, offset: number, chatJid?: string) =>
        service.handleHashtag(tag, limit, offset, chatJid)),
    },
    handleSearch: {
      configurable: true,
      writable: true,
      value: withHttpSurface((
        service,
        query: string,
        limit: number,
        offset: number,
        chatJid?: string,
        searchScope?: "current" | "root" | "all",
        rootChatJid?: string,
      ) => service.handleSearch(query, limit, offset, chatJid, searchScope, rootChatJid)),
    },
    handleThread: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, id: number | null, chatJid?: string) => service.handleThread(id, chatJid)),
    },
    handleThought: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, panel: string | null, turnId: string | null) => service.handleThought(panel, turnId)),
    },
    handleThoughtVisibility: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleThoughtVisibility(req)),
    },
    handleDeletePost: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request, id: number | null, cascade: boolean = false) =>
        service.handleDeletePost(req, id, cascade)),
    },
    handleUpdatePost: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request, id: number | null) => await service.handleUpdatePost(req, id)),
    },
    handleInternalPost: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleInternalPost(req)),
    },
    handleSse: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request) => service.handleSse(req)),
    },
    handleTerminalSession: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request) => service.handleTerminalSession(req)),
    },
    handleTerminalHandoff: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request) => service.handleTerminalHandoff(req)),
    },
    handleVncSession: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request) => service.handleVncSession(req)),
    },
    handleVncHandoff: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request) => service.handleVncHandoff(req)),
    },
    broadcastEvent: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, eventType: string, data: unknown): void => {
        service.broadcastEvent(eventType, data);
      }),
    },
    handlePost: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request, isReply: boolean) => await service.handlePost(req, isReply)),
    },
    handleAgentStatus: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request) => service.handleAgentStatus(req)),
    },
    handleAgentContext: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentContext(req)),
    },
    handleAgentDebug: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentDebug(req)),
    },
    handleAgentCommands: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentCommands(req)),
    },
    handleAutoresearchStatus: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAutoresearchStatus(req)),
    },
    handleAutoresearchStop: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAutoresearchStop(req)),
    },
    handleAutoresearchDismiss: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAutoresearchDismiss(req)),
    },
    handleAgentOobeComplete: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentOobeComplete(req)),
    },
    handleAgentQueueState: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentQueueState(req)),
    },
    handleAgentQueueRemove: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentQueueRemove(req)),
    },
    handleAgentQueueSteer: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentQueueSteer(req)),
    },
    handleAgentQueueReorder: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentQueueReorder(req)),
    },
    handleAgentModels: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentModels(req)),
    },
    handleSessionTree: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request) => service.handleSessionTree(req)),
    },
    handleSystemMetrics: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, req: Request) => service.handleSystemMetrics(req)),
    },
    handleAgentActiveChats: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentActiveChats(req)),
    },
    handleAgentBranches: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentBranches(req)),
    },
    handleAgentBranchFork: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentBranchFork(req)),
    },
    handleAgentBranchRename: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentBranchRename(req)),
    },
    handleAgentRenameJid: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentRenameJid(req)),
    },
    handleAgentBranchPrune: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentBranchPrune(req)),
    },
    handleAgentBranchRestore: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentBranchRestore(req)),
    },
    handleAgentPeerMessage: {
      configurable: true,
      writable: true,
      value: withLifecycleSpecialSurface(defaults, async (service, req: Request) => await service.handleAgentPeerMessage(req)),
    },
    handleAgentRespond: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleAgentRespond(req)),
    },
    handleAdaptiveCardAction: {
      configurable: true,
      writable: true,
      value: withLifecycleSpecialSurface(defaults, async (service, req: Request) => await service.handleAdaptiveCardAction(req)),
    },
    handleAgentSidePrompt: {
      configurable: true,
      writable: true,
      value: withLifecycleSpecialSurface(defaults, async (service, req: Request) => await service.handleAgentSidePrompt(req)),
    },
    handleAgentSidePromptStream: {
      configurable: true,
      writable: true,
      value: withLifecycleSpecialSurface(defaults, async (service, req: Request) => await service.handleAgentSidePromptStream(req)),
    },
    handleAgentMessage: {
      configurable: true,
      writable: true,
      value: withLifecycleSpecialSurface(defaults, (service, req: Request, pathname: string) =>
        service.handleAgentMessage(req, pathname)),
    },
    processChat: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface(async (service, chatJid: string, agentId: string, threadRootId?: number | null) =>
        await service.processChat(chatJid, agentId, threadRootId)),
    },
    storeMessage: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((
        service,
        chatJid: string,
        content: string,
        isBot: boolean,
        mediaIds: number[],
        options: {
          contentBlocks?: unknown[];
          linkPreviews?: unknown[];
          threadId?: number;
          isTerminalAgentReply?: boolean;
          isSteeringMessage?: boolean;
        } = {},
      ): InteractionRow | null => service.storeMessage(chatJid, content, isBot, mediaIds, options)),
    },
    handleRemote: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, req: Request) => await service.handleRemote(req)),
    },
    serveStatic: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, relPath: string) => await service.serveStatic(relPath)),
    },
    serveDocsStatic: {
      configurable: true,
      writable: true,
      value: withHttpSurface(async (service, relPath: string) => await service.serveDocsStatic(relPath)),
    },
    json: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, data: unknown, status: number = 200) => service.json(data, status)),
    },
    clampInt: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, value: string | null, fallback: number, min: number, max: number) =>
        service.clampInt(value, fallback, min, max)),
    },
    parseOptionalInt: {
      configurable: true,
      writable: true,
      value: withHttpSurface((service, value: string | null): number | null => service.parseOptionalInt(value)),
    },
  });
}
