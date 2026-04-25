import {
  applyAutoresearchStatusPayload,
  clearPendingPanelActionPrefix,
} from './app-extension-status.js';
import {
  haveSameFollowupQueueRows,
  normalizeFollowupQueueItems,
  type FollowupQueueItemLike,
} from './app-followup-queue.js';
import { isMainTimelineView } from './app-realtime-timeline.js';
import { getLocalStorageJSON, setLocalStorageItem } from '../utils/storage.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

const CONTEXT_STORAGE_PREFIX = 'piclaw:ctx:';

export function normalizeContextUsage(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const tokens = data.tokens == null ? null : Number(data.tokens);
  const contextWindow = data.contextWindow == null ? null : Number(data.contextWindow);
  const percent = data.percent == null ? null : Number(data.percent);
  return {
    tokens: Number.isFinite(tokens) ? tokens : null,
    contextWindow: Number.isFinite(contextWindow) ? contextWindow : null,
    percent: Number.isFinite(percent) ? percent : null,
  };
}

export function haveSameContextUsage(a: unknown, b: unknown): boolean {
  const left = normalizeContextUsage(a);
  const right = normalizeContextUsage(b);
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.tokens === right.tokens
    && left.contextWindow === right.contextWindow
    && left.percent === right.percent;
}

export function persistContextUsage(chatJid: string, payload: unknown): void {
  if (!chatJid || !payload || typeof payload !== 'object') return;
  const data = payload as Record<string, unknown>;
  if (data.percent == null) return;
  try {
    setLocalStorageItem(CONTEXT_STORAGE_PREFIX + chatJid, JSON.stringify(payload));
  } catch (error) {
    console.debug('[app-status-refresh] Ignoring best-effort context usage persistence failure.', error, {
      chatJid,
    });
  }
}

export function restoreContextUsage(chatJid: string): Record<string, unknown> | null {
  if (!chatJid) return null;
  return getLocalStorageJSON<Record<string, unknown>>(CONTEXT_STORAGE_PREFIX + chatJid);
}


interface RefBox<T> {
  current: T;
}

export interface RefreshQueueStateForChatOptions<TItem extends FollowupQueueItemLike = FollowupQueueItemLike> {
  currentChatJid: string;
  queueRefreshGenRef: RefBox<number>;
  activeChatJidRef: RefBox<string>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  getAgentQueueState: (chatJid: string) => Promise<{ items?: TItem[] | null | undefined }>;
  setFollowupQueueItems: StateSetter<TItem[]>;
  clearQueuedSteerStateIfStale: (remainingQueueCount: number) => void;
}

/**
 * Refresh follow-up queue state for the active chat, dropping stale responses.
 */
export async function refreshQueueStateForChat<TItem extends FollowupQueueItemLike = FollowupQueueItemLike>(
  options: RefreshQueueStateForChatOptions<TItem>,
): Promise<void> {
  const {
    currentChatJid,
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState,
    setFollowupQueueItems,
    clearQueuedSteerStateIfStale,
  } = options;

  const gen = ++queueRefreshGenRef.current;
  const targetChatJid = currentChatJid;

  try {
    const payload = await getAgentQueueState(targetChatJid);
    if (gen !== queueRefreshGenRef.current) return;
    if (activeChatJidRef.current !== targetChatJid) return;

    const dismissed = dismissedQueueRowIdsRef.current;
    const rawItems = Array.isArray(payload?.items) ? payload.items : [];
    const items = normalizeFollowupQueueItems(rawItems, dismissed);
    if (items.length) {
      setFollowupQueueItems((prev) => (haveSameFollowupQueueRows(prev, items) ? prev : items));
      return;
    }

    if (rawItems.length > 0) {
      return;
    }

    dismissed.clear();
    clearQueuedSteerStateIfStale(0);
    setFollowupQueueItems((prev) => (prev.length === 0 ? prev : []));
  } catch {
    if (gen !== queueRefreshGenRef.current) return;
    if (activeChatJidRef.current !== targetChatJid) return;
    setFollowupQueueItems((prev) => (prev.length === 0 ? prev : []));
  }
}

export interface RefreshContextUsageForChatOptions {
  currentChatJid: string;
  activeChatJidRef: RefBox<string>;
  getAgentContext: (chatJid: string) => Promise<any>;
  setContextUsage: StateSetter<any>;
}

/** Best-effort context usage refresh tied to the currently active chat. */
export async function refreshContextUsageForChat(options: RefreshContextUsageForChatOptions): Promise<void> {
  const {
    currentChatJid,
    activeChatJidRef,
    getAgentContext,
    setContextUsage,
  } = options;

  const targetChatJid = currentChatJid;
  try {
    const contextPayload = normalizeContextUsage(await getAgentContext(targetChatJid));
    if (activeChatJidRef.current !== targetChatJid) return;
    // Only update state when the server returns meaningful context data.
    // After a reload or for inactive chats, the API returns
    // { tokens: null, contextWindow: null, percent: null } which would
    // overwrite the cached localStorage value restored on chat switch.
    if (contextPayload && contextPayload.percent != null) {
      setContextUsage((prev: unknown) => haveSameContextUsage(prev, contextPayload) ? prev : contextPayload);
      persistContextUsage(targetChatJid, contextPayload);
    }
  } catch (error) {
    if (activeChatJidRef.current !== targetChatJid) return;
    console.warn('Failed to fetch agent context:', error);
  }
}

export interface RefreshAutoresearchStatusForChatOptions {
  currentChatJid: string;
  activeChatJidRef: RefBox<string>;
  getAutoresearchStatus: (chatJid: string) => Promise<any>;
  setExtensionStatusPanels: StateSetter<Map<any, any>>;
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
}

/** Best-effort autoresearch panel refresh tied to the currently active chat. */
export async function refreshAutoresearchStatusForChat(options: RefreshAutoresearchStatusForChatOptions): Promise<void> {
  const {
    currentChatJid,
    activeChatJidRef,
    getAutoresearchStatus,
    setExtensionStatusPanels,
    setPendingExtensionPanelActions,
  } = options;

  const targetChatJid = currentChatJid;
  try {
    const payload = await getAutoresearchStatus(targetChatJid);
    if (activeChatJidRef.current !== targetChatJid) return;
    setExtensionStatusPanels((prev) => applyAutoresearchStatusPayload(prev, payload));
    setPendingExtensionPanelActions((prev) => clearPendingPanelActionPrefix(prev, 'autoresearch'));
  } catch (error) {
    if (activeChatJidRef.current !== targetChatJid) return;
    console.warn('Failed to fetch autoresearch status:', error);
  }
}

export interface RefreshModelAndQueueStateOptions {
  refreshModelState: () => void;
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  refreshQueueState: () => void;
  refreshContextUsage: () => Promise<void> | void;
  refreshAutoresearchStatus: () => Promise<void> | void;
}

/** Run the standard model/queue/status refresh bundle used on connect/wake. */
export function refreshModelAndQueueState(options: RefreshModelAndQueueStateOptions): void {
  const {
    refreshModelState,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    refreshQueueState,
    refreshContextUsage,
    refreshAutoresearchStatus,
  } = options;

  refreshModelState();
  refreshActiveChatAgents();
  refreshCurrentChatBranches();
  refreshQueueState();
  void refreshContextUsage();
  void refreshAutoresearchStatus();
}

export interface RefreshCurrentViewOptions {
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  refreshTimeline: () => Promise<void> | void;
  refreshModelAndQueueState: () => void;
}

/**
 * Refresh the current view and status panels without disturbing search/hashtag modes.
 */
export function refreshCurrentView(options: RefreshCurrentViewOptions): void {
  const {
    viewStateRef,
    refreshTimeline,
    refreshModelAndQueueState: refreshModelAndQueueStateFn,
  } = options;

  const onMainTimeline = isMainTimelineView(viewStateRef.current);
  if (onMainTimeline) {
    void refreshTimeline();
  }
  refreshModelAndQueueStateFn();
}
