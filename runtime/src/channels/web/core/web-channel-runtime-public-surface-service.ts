import { bindAddonLocalDispatchRequest, captureAddonLocalDispatchAdmission } from "../../../addons/local-dispatch.js";
import { bindInputRequestAuthority, releaseInputRequestAuthority, captureInputTarget } from '../messaging/input-request-authority.js';
import { readAccessConfig } from '../../../core/config-access.js';
import { getExecutionIdentity } from '../../../core/execution-context.js';
import type { InteractionRow } from "../../../db.js";
import type { WebAgentBufferEntry } from "../agent/agent-buffers.js";
import type { QueuedFollowupItem, QueuedFollowupSourceMetadata } from "../../../queued-followups.js";
import type { SendMessageOptions, WebMessageWriteService } from "../message-write-service.js";
import type { WebMessageProcessingStorageService } from "../messaging/message-processing-storage-service.js";
import type { QueuedFollowupLifecycleService } from "../runtime/queued-followup-lifecycle-service.js";
import type { WebChannelRuntimeStateService } from "../runtime/runtime-state-service.js";
import type { WebSessionBroadcastService } from "../sse/session-broadcast-service.js";

type WebChannelRuntimePublicSurfaceStorage = Pick<
  WebMessageProcessingStorageService,
  "processChat" | "storeMessage" | "admitMessage"
>;

type WebChannelRuntimePublicSurfaceBroadcast = Pick<
  WebSessionBroadcastService,
  "sse" | "uiBridge" | "broadcastEvent"
>;

type WebChannelRuntimePublicSurfaceAgentMessageEntry = {
  handleAgentMessage?: (req: Request, pathname: string) => Promise<Response>;
};

type WebChannelRuntimePublicSurfaceAgentPool = {
  getSessionGenerationForChat?: (chatJid: string) => string | null;
};

export type RuntimeAgentMessageMode = "auto" | "queue" | "steer";

export interface RuntimeAgentMessageRequest {
  chatJid: string;
  content: string;
  mode?: RuntimeAgentMessageMode;
  mediaIds?: number[];
  contentBlocks?: unknown[];
  linkPreviews?: unknown[];
  threadId?: number | string | null;
  screenHint?: string | null;
  source?: string;
  queuedBy?: QueuedFollowupSourceMetadata;
  /** Host-only cancellation, never populated from HTTP payload fields. */
  signal?: AbortSignal;
  /** Host-only admission fence, composed with normal input authority at commit. */
  admission?: { validate: () => void };
}

export interface RuntimeAgentMessageResult {
  status: "ok";
  chat_jid: string;
  row_id?: number | null;
  user_message?: InteractionRow;
  thread_id: number | null;
  queued?: "followup" | "steer";
  created: boolean;
}

export interface ExtensionWorkingStateSnapshot {
  message: string | null;
  indicator: Record<string, unknown> | null;
  visible: boolean;
}

const DEFAULT_EXTENSION_WORKING_STATE: ExtensionWorkingStateSnapshot = {
  message: null,
  indicator: null,
  visible: true,
};

function readEventChatJid(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = (data as Record<string, unknown>).chat_jid;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isClearedWorkingState(state: ExtensionWorkingStateSnapshot): boolean {
  const indicatorMode = typeof state.indicator?.mode === "string" ? state.indicator.mode : null;
  return !state.message && state.visible === true && (!state.indicator || indicatorMode === "hidden");
}

function normalizeExtensionIndicatorFrame(frame: unknown): string | null {
  if (typeof frame !== "string") return null;
  if (!frame) return null;
  // Extension-supplied working indicators are a cross-surface contract shared
  // with Pi TUI, so frames must be plain text.  Markup/SVG spinners belong to
  // frontend-owned busy states, not ctx.ui.setWorkingIndicator payloads.
  if (/<\s*\/?\s*[a-z][^>]*>/i.test(frame)) return null;
  return frame;
}

function resolveWorkingIndicatorSnapshot(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(payload.frames)) {
    return { mode: "default", frames: [], intervalMs: null };
  }
  const frames = payload.frames
    .map(normalizeExtensionIndicatorFrame)
    .filter((frame): frame is string => typeof frame === "string");
  const intervalRaw = payload.interval_ms ?? payload.intervalMs;
  const intervalMs = typeof intervalRaw === "number" && Number.isFinite(intervalRaw) && intervalRaw > 0
    ? intervalRaw
    : null;
  return frames.length > 0
    ? { mode: "custom", frames, intervalMs }
    : { mode: "hidden", frames: [], intervalMs };
}

function normalizeRuntimeMessageMode(value: unknown): RuntimeAgentMessageMode {
  return value === "queue" || value === "steer" || value === "auto" ? value : "auto";
}

function normalizeRuntimeMessageChatJid(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRuntimeMessageContent(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeRuntimeMessageMediaIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "number" ? item : Number.parseInt(String(item ?? ""), 10))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function normalizeRuntimeMessageThreadId(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeRuntimeMessageScreenHint(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cloneRuntimeMessageArray<T = unknown>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? [...value] as T[] : undefined;
}

function hasRuntimeMessagePayload(input: {
  content: string;
  mediaIds: number[];
  contentBlocks?: unknown[];
  linkPreviews?: unknown[];
}): boolean {
  return input.content.trim().length > 0 || input.mediaIds.length > 0 || Boolean(input.contentBlocks?.length) || Boolean(input.linkPreviews?.length);
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function readRuntimeMessageResultThreadId(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readRuntimeMessageResultRowId(payload: Record<string, unknown>, userMessage: unknown): number | null {
  if (typeof payload.row_id === "number" && Number.isInteger(payload.row_id) && payload.row_id > 0) return payload.row_id;
  if (isRuntimeRecord(userMessage) && typeof userMessage.id === "number" && Number.isInteger(userMessage.id) && userMessage.id > 0) return userMessage.id;
  return null;
}

function normalizeRuntimeHandlerMessageResult(chatJid: string, payload: unknown): RuntimeAgentMessageResult {
  const data = isRuntimeRecord(payload) ? payload : {};
  const userMessage = data.user_message;
  const rowId = readRuntimeMessageResultRowId(data, userMessage);
  const queued = data.queued === "followup" || data.queued === "steer" ? data.queued : undefined;
  const threadId = readRuntimeMessageResultThreadId(data.thread_id);
  return {
    status: "ok",
    chat_jid: typeof data.chat_jid === "string" && data.chat_jid.trim() ? data.chat_jid.trim() : chatJid,
    ...(rowId ? { row_id: rowId } : {}),
    ...(isRuntimeRecord(userMessage) ? { user_message: userMessage as unknown as InteractionRow } : {}),
    thread_id: threadId,
    ...(queued ? { queued } : {}),
    created: isRuntimeRecord(userMessage),
  };
}

async function readRuntimeHandlerError(response: Response): Promise<string> {
  const payload = await response.clone().json().catch(() => null);
  if (isRuntimeRecord(payload) && typeof payload.error === "string" && payload.error.trim()) return payload.error.trim();
  const text = await response.text().catch(() => "");
  return text.trim().slice(0, 500);
}

export interface WebChannelRuntimePublicSurfaceChannel extends WebChannelRuntimePublicSurfaceAgentMessageEntry {
  messageWriteService: Pick<WebMessageWriteService, "sendMessage" | "postDashboardWidget">;
  queuedFollowupLifecycle: Pick<QueuedFollowupLifecycleService,
    "enqueueQueuedFollowupItem" | "admitQueuedFollowupItem" | "peekQueuedFollowupItem" | "consumeQueuedFollowupItem" |
    "prependQueuedFollowupItem" | "replaceQueuedFollowupItem" | "getQueuedFollowupCount" | "getQueuedFollowupItems" | "removeQueuedFollowupItem">;
  readonly runtimeState: Pick<WebChannelRuntimeStateService,
    "updateAgentStatus" | "getAgentStatus" | "getThreadRootId" | "resumeChat" | "resumePendingChats" |
    "setPanelExpanded" | "isPanelExpanded" | "updateThoughtBuffer" | "updateDraftBuffer" | "getBuffer">;
  messageProcessingStorageService: WebChannelRuntimePublicSurfaceStorage;
  sessionBroadcast: WebChannelRuntimePublicSurfaceBroadcast;
  agentPool?: WebChannelRuntimePublicSurfaceAgentPool;
}

export interface WebChannelRuntimePublicSurfaceServiceCarrier {
  runtimePublicSurfaceService?: WebChannelRuntimePublicSurfaceService;
}

export class WebChannelRuntimePublicSurfaceService {
  private readonly extensionWorkingStates = new Map<string, ExtensionWorkingStateSnapshot>();

  private readonly runtimeState: WebChannelRuntimePublicSurfaceChannel["runtimeState"];

  constructor(private readonly channel: WebChannelRuntimePublicSurfaceChannel) {
    this.runtimeState = channel.runtimeState;
  }

  private updateExtensionWorkingStateFromEvent(eventType: string, data: unknown): void {
    const chatJid = readEventChatJid(data);
    if (!chatJid || !data || typeof data !== "object") return;
    const payload = data as Record<string, unknown>;

    if (eventType === "agent_response") {
      this.extensionWorkingStates.delete(chatJid);
      return;
    }
    if (eventType === "agent_status" && (payload.type === "done" || payload.type === "error")) {
      this.extensionWorkingStates.delete(chatJid);
      return;
    }

    if (
      eventType !== "extension_ui_working" &&
      eventType !== "extension_ui_status" &&
      eventType !== "extension_ui_working_indicator" &&
      eventType !== "extension_ui_working_visible"
    ) {
      return;
    }

    const previous = this.extensionWorkingStates.get(chatJid) ?? DEFAULT_EXTENSION_WORKING_STATE;

    const next: ExtensionWorkingStateSnapshot = eventType === "extension_ui_working"
      ? {
        ...previous,
        message: typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : null,
      }
      : eventType === "extension_ui_status"
        ? (() => {
          if (payload.key === "context_usage") return previous;
          return {
            ...previous,
            message: typeof payload.text === "string" && payload.text.trim() ? payload.text.trim() : null,
          };
        })()
        : eventType === "extension_ui_working_visible"
          ? { ...previous, visible: payload.visible !== false }
          : { ...previous, indicator: resolveWorkingIndicatorSnapshot(payload) };

    if (isClearedWorkingState(next)) {
      this.extensionWorkingStates.delete(chatJid);
      return;
    }
    this.extensionWorkingStates.set(chatJid, next);
  }

  getExtensionWorkingState(chatJid: string): ExtensionWorkingStateSnapshot | null {
    const state = this.extensionWorkingStates.get(chatJid);
    return state ? { ...state, indicator: state.indicator ? { ...state.indicator } : null } : null;
  }

  get sse(): WebSessionBroadcastService["sse"] {
    return this.channel.sessionBroadcast.sse;
  }

  get uiBridge(): WebSessionBroadcastService["uiBridge"] {
    return this.channel.sessionBroadcast.uiBridge;
  }

  async sendMessage(chatJid: string, text: string, options?: SendMessageOptions): Promise<void> {
    await this.channel.messageWriteService.sendMessage(chatJid, text, options);
  }

  async postDashboardWidget(
    chatJid: string,
    options?: { threadId?: number | null; text?: string; widgetId?: string },
  ): Promise<void> {
    await this.channel.messageWriteService.postDashboardWidget(chatJid, options);
  }

  async enqueueAgentMessage(request: RuntimeAgentMessageRequest): Promise<RuntimeAgentMessageResult> {
    const handleMessage = this.channel.handleAgentMessage?.bind(this.channel);
    const chatJid = normalizeRuntimeMessageChatJid(request?.chatJid);
    if (!chatJid) throw new Error("enqueueAgentMessage requires a target chatJid.");
    if (!chatJid.startsWith("web:")) throw new Error(`enqueueAgentMessage only supports web chats; got ${chatJid}.`);

    const content = normalizeRuntimeMessageContent(request?.content);
    const mediaIds = normalizeRuntimeMessageMediaIds(request?.mediaIds);
    const contentBlocks = cloneRuntimeMessageArray(request?.contentBlocks);
    const linkPreviews = cloneRuntimeMessageArray(request?.linkPreviews);
    if (!hasRuntimeMessagePayload({ content, mediaIds, contentBlocks, linkPreviews })) {
      throw new Error("enqueueAgentMessage requires content or attachments.");
    }

    const mode = normalizeRuntimeMessageMode(request?.mode);
    const screenHint = normalizeRuntimeMessageScreenHint(request?.screenHint);

    if (handleMessage) {
      const body = {
        content,
        mode,
        media_ids: mediaIds,
        ...(contentBlocks ? { content_blocks: contentBlocks } : {}),
        ...(linkPreviews ? { link_previews: linkPreviews } : {}),
        ...(request?.threadId !== undefined ? { thread_id: normalizeRuntimeMessageThreadId(request?.threadId) ?? null } : {}),
        ...(screenHint !== undefined ? { screen_hint: screenHint } : {}),
      };
      const encodedBody = JSON.stringify(body);
      const scopedAdmission = captureAddonLocalDispatchAdmission(chatJid, content);
      request.admission?.validate();
      const origin = getExecutionIdentity();
      if (readAccessConfig().mode !== 'single-user' || (origin && origin.mode !== 'single-user')) throw Error('Host input authority is unavailable.');
      const validateTarget = captureInputTarget(chatJid);
      const req = new Request(
        `http://internal/agent/default/message?chat_jid=${encodeURIComponent(chatJid)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: encodedBody,
          ...((scopedAdmission?.signal || request.signal) ? { signal: AbortSignal.any([...(scopedAdmission?.signal ? [scopedAdmission.signal] : []), ...(request.signal ? [request.signal] : [])]) } : {}) },
      );
      bindAddonLocalDispatchRequest(req, chatJid, content);
      bindInputRequestAuthority(req, chatJid, encodedBody, phase => {
        if (readAccessConfig().mode !== 'single-user' || (origin && origin.mode !== 'single-user') || getExecutionIdentity() !== origin
          ) throw Error('Host input authority changed.');
        scopedAdmission?.validate();
        request.admission?.validate();
        validateTarget(phase);
      });
      let response: Response;
      try { response = await handleMessage(req, "/agent/default/message"); }
      finally { releaseInputRequestAuthority(req); }
      const responsePayload = await response.clone().json().catch(() => null);
      if (!response.ok) {
        const detail = await readRuntimeHandlerError(response);
        throw new Error(`enqueueAgentMessage failed: ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
      }
      return normalizeRuntimeHandlerMessageResult(chatJid, responsePayload);
    }

    throw new Error("Runtime agent messages require the host input handler.");
  }

  enqueueQueuedFollowupItem(
    chatJid: string,
    rowId: number,
    queuedContent: string,
    threadId?: number | null,
    queuedAt?: string,
    extras?: { mediaIds?: number[]; contentBlocks?: unknown[]; linkPreviews?: unknown[]; screenHint?: string; source?: string; queuedBy?: QueuedFollowupItem["queuedBy"] },
  ): number {
    return this.channel.queuedFollowupLifecycle.enqueueQueuedFollowupItem(
      chatJid,
      rowId,
      queuedContent,
      threadId,
      queuedAt,
      extras,
    );
  }

  peekQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null {
    return this.channel.queuedFollowupLifecycle.peekQueuedFollowupItem(chatJid);
  }

  admitQueuedFollowupItem(args: Parameters<import('../runtime/queued-followup-lifecycle-service.js').QueuedFollowupLifecycleService['enqueueQueuedFollowupItem']>, authorise: () => void, signal: AbortSignal, acceptSource?: import('../runtime/queued-followup-lifecycle-service.js').QueuedInputSourceAdmission): Promise<number> {
    return this.channel.queuedFollowupLifecycle.admitQueuedFollowupItem(args, authorise, signal, acceptSource);
  }

  consumeQueuedFollowupItem(chatJid: string): QueuedFollowupItem | null {
    return this.channel.queuedFollowupLifecycle.consumeQueuedFollowupItem(chatJid);
  }

  prependQueuedFollowupItem(chatJid: string, item: QueuedFollowupItem): void {
    this.channel.queuedFollowupLifecycle.prependQueuedFollowupItem(chatJid, item);
  }

  replaceQueuedFollowupItem(chatJid: string, item: QueuedFollowupItem): boolean {
    return this.channel.queuedFollowupLifecycle.replaceQueuedFollowupItem(chatJid, item);
  }

  getQueuedFollowupCount(chatJid: string): number {
    return this.channel.queuedFollowupLifecycle.getQueuedFollowupCount(chatJid);
  }

  getQueuedFollowupItems(chatJid: string): QueuedFollowupItem[] {
    return this.channel.queuedFollowupLifecycle.getQueuedFollowupItems(chatJid);
  }

  removeQueuedFollowupItem(chatJid: string, rowId: number): QueuedFollowupItem | null {
    return this.channel.queuedFollowupLifecycle.removeQueuedFollowupItem(chatJid, rowId);
  }

  updateAgentStatus(chatJid: string, status: Record<string, unknown>): void {
    if (status?.type === "done" || status?.type === "error") {
      this.extensionWorkingStates.delete(chatJid);
    }
    this.runtimeState.updateAgentStatus(chatJid, status);
  }

  getAgentStatus(chatJid: string): Record<string, unknown> | null {
    return this.runtimeState.getAgentStatus(chatJid);
  }

  getThreadRootId(chatJid: string, messageId: string): number | null {
    return this.runtimeState.getThreadRootId(chatJid, messageId);
  }

  resumeChat(chatJid: string, threadRootId?: number | null): void {
    this.runtimeState.resumeChat(chatJid, threadRootId);
  }

  resumePendingChats(chatJid?: string): void {
    this.runtimeState.resumePendingChats(chatJid);
  }

  setPanelExpanded(turnId: string, panel: "thought" | "draft", expanded: boolean): void {
    this.runtimeState.setPanelExpanded(turnId, panel, expanded);
  }

  isPanelExpanded(turnId: string, panel: "thought" | "draft"): boolean {
    return this.runtimeState.isPanelExpanded(turnId, panel);
  }

  updateThoughtBuffer(turnId: string, text: string, totalLines: number): void {
    this.runtimeState.updateThoughtBuffer(turnId, text, totalLines);
  }

  updateDraftBuffer(turnId: string, text: string, totalLines: number): void {
    this.runtimeState.updateDraftBuffer(turnId, text, totalLines);
  }

  getBuffer(turnId: string, panel: "thought" | "draft"): WebAgentBufferEntry | undefined {
    return this.runtimeState.getBuffer(turnId, panel);
  }

  broadcastEvent(eventType: string, data: unknown): void {
    let payload = data;
    if (eventType === "extension_ui_status" && data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      const chatJid = readEventChatJid(record);
      if (record.key === "context_usage" && chatJid) {
        const sessionGeneration = this.channel.agentPool?.getSessionGenerationForChat?.(chatJid) ?? null;
        if (sessionGeneration) payload = { ...record, sessionGeneration };
      }
    }
    this.updateExtensionWorkingStateFromEvent(eventType, payload);
    this.channel.sessionBroadcast.broadcastEvent(eventType, payload);
  }

  async processChat(chatJid: string, agentId: string, threadRootId?: number | null): Promise<void> {
    return this.channel.messageProcessingStorageService.processChat(chatJid, agentId, threadRootId);
  }

  admitMessage(...args: Parameters<WebMessageProcessingStorageService["admitMessage"]>): Promise<InteractionRow | null> {
    return this.channel.messageProcessingStorageService.admitMessage(...args);
  }

  storeMessage(
    chatJid: string,
    content: string,
    isBot: boolean,
    mediaIds: number[],
    options: {
      contentBlocks?: unknown[];
      linkPreviews?: unknown[];
      threadId?: number;
      screenHint?: string | null;
      isTerminalAgentReply?: boolean;
      isSteeringMessage?: boolean;
      removeProtectedContinuationForSourceMessageId?: string | null;
      consumeDeferredFollowupRowId?: number | null;
    } = {},
  ): InteractionRow | null {
    return this.channel.messageProcessingStorageService.storeMessage(chatJid, content, isBot, mediaIds, options);
  }
}

export function createWebChannelRuntimePublicSurfaceService(
  channel: WebChannelRuntimePublicSurfaceChannel,
): WebChannelRuntimePublicSurfaceService {
  return new WebChannelRuntimePublicSurfaceService(channel);
}

export function getWebChannelRuntimePublicSurfaceService(
  channel: WebChannelRuntimePublicSurfaceChannel & WebChannelRuntimePublicSurfaceServiceCarrier,
): WebChannelRuntimePublicSurfaceService {
  return channel.runtimePublicSurfaceService ?? createWebChannelRuntimePublicSurfaceService(channel);
}
