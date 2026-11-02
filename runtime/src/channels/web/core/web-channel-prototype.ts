import type { InteractionRow } from "../../../db.js";
import type { QueuedFollowupItem } from "../runtime/followup-placeholders.js";
import type { SendMessageOptions } from "../messaging/message-write-flows.js";
import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";
import type { WebSessionBroadcastService } from "../sse/session-broadcast-service.js";
import type { WebChannelLike } from "./web-channel-contracts.js";
import {
  getWebChannelRuntimePublicSurfaceService,
  type RuntimeAgentMessageRequest,
  type RuntimeAgentMessageResult,
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
  admitMessage: WebChannelRuntimePublicSurfaceService["admitMessage"];
  readonly sse: WebSessionBroadcastService["sse"];
  readonly uiBridge: WebSessionBroadcastService["uiBridge"];
  readonly server: Bun.Server<WebSocketSessionData> | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  sealAdmissions(): Promise<void>;
  runInternalDispatch<T>(dispatch: () => T | Promise<T>): Promise<T>;
  handleFetch(req: Request, server?: Bun.Server<WebSocketSessionData>): Promise<Response | undefined>;
  handleRequest(req: Request): Promise<Response>;
  enqueueAgentMessage(request: RuntimeAgentMessageRequest): Promise<RuntimeAgentMessageResult>;
  resumePendingChats(chatJid?: string): void;
  processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void>;
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
      value: withLifecycleSpecialSurface(defaults, (service) => service.stop()),
    },
    sealAdmissions: {
      configurable: true,
      writable: true,
      value: withLifecycleSpecialSurface(defaults, (service) => service.sealAdmissions()),
    },
    runInternalDispatch: {
      configurable: true,
      writable: true,
      value: withLifecycleSpecialSurface(defaults, <T>(service: WebChannelLifecycleSpecialSurfaceService, dispatch: () => T | Promise<T>) =>
        service.runInternalDispatch(dispatch)),
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
    enqueueAgentMessage: {
      configurable: true,
      writable: true,
      value: function(this: WebChannelPrototypeMembers, request: RuntimeAgentMessageRequest): Promise<RuntimeAgentMessageResult> {
        return this.runInternalDispatch(() => getRuntimePublicSurfaceService(this).enqueueAgentMessage(request));
      },
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
        extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[]; screenHint?: string; source?: string; queuedBy?: QueuedFollowupItem["queuedBy"] },
      ): number => service.enqueueQueuedFollowupItem(chatJid, rowId, queuedContent, threadId, queuedAt, extras)),
    },
    peekQueuedFollowupItem: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface(
        (service, chatJid: string): QueuedFollowupItem | null => service.peekQueuedFollowupItem(chatJid),
      ),
    },
    admitQueuedFollowupItem: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, args: Parameters<WebChannelRuntimePublicSurfaceService['enqueueQueuedFollowupItem']>, authorise: () => void, signal: AbortSignal, acceptSource?: import('../runtime/queued-followup-lifecycle-service.js').QueuedInputSourceAdmission) => service.admitQueuedFollowupItem(args, authorise, signal, acceptSource)),
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
    replaceQueuedFollowupItem: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string, item: QueuedFollowupItem): boolean =>
        service.replaceQueuedFollowupItem(chatJid, item)),
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
    getExtensionWorkingState: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid: string): Record<string, unknown> | null => {
        const state = service.getExtensionWorkingState(chatJid);
        return state as unknown as Record<string, unknown> | null;
      }),
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
    resumePendingChats: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, chatJid?: string): void => {
        service.resumePendingChats(chatJid);
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
    broadcastEvent: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, eventType: string, data: unknown): void => {
        service.broadcastEvent(eventType, data);
      }),
    },
    handleAgentPeerMessage: {
      configurable: true,
      writable: true,
      value: withLifecycleSpecialSurface(defaults, async (service, req: Request) => await service.handleAgentPeerMessage(req)),
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
          threadToSelf?: boolean;
          screenHint?: string | null;
          isTerminalAgentReply?: boolean;
          isSteeringMessage?: boolean;
          removeProtectedContinuationForSourceMessageId?: string | null;
          consumeDeferredFollowupRowId?: number | null;
        } = {},
      ): InteractionRow | null => service.storeMessage(chatJid, content, isBot, mediaIds, options)),
    },
    admitMessage: {
      configurable: true, writable: true,
      value: withRuntimePublicSurface((service, ...args: Parameters<WebChannelRuntimePublicSurfaceService["admitMessage"]>) => service.admitMessage(...args)),
    },
    admitUserMessage: {
      configurable: true,
      writable: true,
      value: withRuntimePublicSurface((service, ...args: Parameters<WebChannelRuntimePublicSurfaceService['admitUserMessage']>) => service.admitUserMessage(...args)),
    },
  });
}
