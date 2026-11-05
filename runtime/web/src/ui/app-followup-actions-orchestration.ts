import { useCallback } from '../vendor/preact-htm.js';
import { appendAcknowledgedTimelinePost } from './app-realtime-timeline.js';
import { handleMessageResponseRefresh, type HandleMessageResponseOptions } from './app-auth-bootstrap.js';
import {
  handleInjectQueuedFollowupAction,
  handleRemoveQueuedFollowupAction,
} from './app-floating-widget-followup.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

interface ToastFn {
  (title: string, detail?: string | null, kind?: string, durationMs?: number): void;
}

export interface UseFollowupActionsOrchestrationOptions {
  currentChatJid: string;
  activeChatJidRef: RefBox<string>;
  viewStateRef: RefBox<any>;
  setPosts: StateSetter<any[] | null>;
  followupQueueItemsRef: RefBox<any[]>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  refreshQueueState: () => Promise<void>;
  setFollowupQueueItems: StateSetter<any[]>;
  showIntentToast: ToastFn;
  clearQueuedSteerStateIfStale: () => void;
  steerAgentQueueItem: (...args: any[]) => Promise<any>;
  removeAgentQueueItem: (...args: any[]) => Promise<any>;
  refreshActiveChatAgents: () => Promise<void>;
  refreshCurrentChatBranches: () => Promise<void>;
  refreshContextUsage: () => Promise<void>;
  refreshAutoresearchStatus: () => Promise<void>;
}

interface QueueActionContext {
  queuedItem: any;
  followupQueueItemsRef: RefBox<any[]>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  currentChatJid: string;
  refreshQueueState: () => Promise<void>;
  setFollowupQueueItems: StateSetter<any[]>;
  showIntentToast: ToastFn;
  clearQueuedSteerStateIfStale?: () => void;
  isCurrent?: () => boolean;
  steerAgentQueueItem: (...args: any[]) => Promise<any>;
  removeAgentQueueItem: (...args: any[]) => Promise<any>;
}

export function runInjectQueuedFollowup(
  context: QueueActionContext,
  action: (options: QueueActionContext) => void = handleInjectQueuedFollowupAction,
): void {
  action(context);
}

export function runRemoveQueuedFollowup(
  context: QueueActionContext,
  action: (options: QueueActionContext) => Promise<boolean> = handleRemoveQueuedFollowupAction,
): Promise<boolean> {
  return action(context);
}

export function runMessageResponseRefresh(
  response: any,
  context: {
    refreshActiveChatAgents: () => Promise<void>;
    refreshCurrentChatBranches: () => Promise<void>;
    refreshContextUsage: () => Promise<void>;
    refreshAutoresearchStatus: () => Promise<void>;
    refreshQueueState: () => Promise<void>;
  },
  action: (options: HandleMessageResponseOptions) => void = handleMessageResponseRefresh,
): void {
  action({
    response,
    refreshActiveChatAgents: context.refreshActiveChatAgents,
    refreshCurrentChatBranches: context.refreshCurrentChatBranches,
    refreshContextUsage: context.refreshContextUsage,
    refreshAutoresearchStatus: context.refreshAutoresearchStatus,
    refreshQueueState: context.refreshQueueState,
  });
}

export function useFollowupActionsOrchestration(options: UseFollowupActionsOrchestrationOptions) {
  const {
    currentChatJid,
    activeChatJidRef,
    viewStateRef,
    setPosts,
    followupQueueItemsRef,
    dismissedQueueRowIdsRef,
    refreshQueueState,
    setFollowupQueueItems,
    showIntentToast,
    clearQueuedSteerStateIfStale,
    steerAgentQueueItem,
    removeAgentQueueItem,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    refreshContextUsage,
    refreshAutoresearchStatus,
  } = options;

  const handleInjectQueuedFollowup = useCallback((queuedItem: any) => {
    runInjectQueuedFollowup({
      queuedItem,
      followupQueueItemsRef,
      dismissedQueueRowIdsRef,
      currentChatJid,
      refreshQueueState,
      setFollowupQueueItems,
      showIntentToast,
      steerAgentQueueItem,
      removeAgentQueueItem,
    });
  }, [currentChatJid, dismissedQueueRowIdsRef, followupQueueItemsRef, refreshQueueState, removeAgentQueueItem, setFollowupQueueItems, showIntentToast, steerAgentQueueItem]);

  const handleRemoveQueuedFollowup = useCallback((queuedItem: any) => {
    return runRemoveQueuedFollowup({
      isCurrent: () => activeChatJidRef.current === currentChatJid,
      queuedItem,
      followupQueueItemsRef,
      dismissedQueueRowIdsRef,
      currentChatJid,
      refreshQueueState,
      setFollowupQueueItems,
      showIntentToast,
      clearQueuedSteerStateIfStale,
      steerAgentQueueItem,
      removeAgentQueueItem,
    });
  }, [activeChatJidRef, clearQueuedSteerStateIfStale, currentChatJid, dismissedQueueRowIdsRef, followupQueueItemsRef, refreshQueueState, removeAgentQueueItem, setFollowupQueueItems, showIntentToast, steerAgentQueueItem]);

  const handleMoveQueuedFollowup = useCallback(async (fromIndex: number, toIndex: number) => {
    // Optimistic local reorder
    setFollowupQueueItems((prev: any[]) => {
      if (!Array.isArray(prev) || fromIndex < 0 || toIndex < 0 || fromIndex >= prev.length || toIndex >= prev.length || fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    // Persist to backend
    try {
      const { reorderAgentQueueItem } = await import('../api.js');
      await reorderAgentQueueItem(fromIndex, toIndex, currentChatJid);
    } catch (error) {
      console.warn('Failed to persist queue reorder:', error);
      // Refresh from backend to restore correct state
      void refreshQueueState();
    }
  }, [currentChatJid, refreshQueueState, setFollowupQueueItems]);

  const handleMessageResponse = useCallback((response: any) => {
    // Do not wait for SSE delivery or a refresh to echo an already stored row.
    // The ref prevents a late response from leaking into a different session.
    if (activeChatJidRef.current === currentChatJid) {
      setPosts(posts => appendAcknowledgedTimelinePost(posts, response, activeChatJidRef.current, viewStateRef.current));
    }
    runMessageResponseRefresh(response, {
      refreshActiveChatAgents,
      refreshCurrentChatBranches,
      refreshContextUsage,
      refreshAutoresearchStatus,
      refreshQueueState,
    });
  }, [activeChatJidRef, currentChatJid, setPosts, viewStateRef, refreshActiveChatAgents, refreshAutoresearchStatus, refreshContextUsage, refreshCurrentChatBranches, refreshQueueState]);

  return {
    handleInjectQueuedFollowup,
    handleRemoveQueuedFollowup,
    handleMoveQueuedFollowup,
    handleMessageResponse,
  };
}
