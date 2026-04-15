import { useCallback, useEffect } from '../vendor/preact-htm.js';
import { runTimelineLoadFlow } from './app-boot-load-orchestration.js';
import { refreshCurrentView as refreshCurrentViewState } from './app-status-refresh-orchestration.js';
import { applyLiveFloatingWidgetUpdate } from './app-floating-widget.js';
import {
  cancelAppPerfTrace,
  completeAppPerfTraceIfReady,
  ensureAppPerfTrace,
  failAppPerfTrace,
  markAppPerfTrace,
} from './app-perf-tracing.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

export function resetExtensionPanelStateForChat(options: {
  setExtensionStatusPanels: StateSetter<Map<string, unknown>>;
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
}): void {
  const {
    setExtensionStatusPanels,
    setPendingExtensionPanelActions,
  } = options;

  setExtensionStatusPanels(new Map());
  setPendingExtensionPanelActions(new Set());
}

export function hydrateThreadStateAfterTimelineLoad(options: {
  refreshAgentStatus: () => Promise<any>;
  refreshPostPaintThreadState: () => void;
}): void {
  const {
    refreshAgentStatus,
    refreshPostPaintThreadState,
  } = options;

  refreshPostPaintThreadState();
  void refreshAgentStatus();
}

interface UseViewRefreshLifecycleOptions {
  currentChatJid: string;
  currentRootChatJid: string;
  currentHashtag: string | null;
  searchQuery: string | null;
  searchScope: string;
  loadPosts: (hashtag?: string | null) => Promise<void>;
  searchPosts: (
    query: string,
    limit: number,
    offset: number,
    chatJid: string,
    scope: string,
    rootChatJid: string,
  ) => Promise<{ results?: any[] }>;
  setPosts: StateSetter<any[] | null>;
  setHasMore: StateSetter<boolean>;
  scrollToBottom: () => void;
  setExtensionStatusPanels: StateSetter<Map<string, unknown>>;
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
  paneStateOwnerChatJidRef: RefBox<string | null>;
  chatPaneStateByChatRef: RefBox<Map<string, unknown>>;
  snapshotCurrentChatPaneState: () => unknown;
  restoreChatPaneState: (snapshot: unknown) => void;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  refreshQueueState: () => Promise<void>;
  refreshAgentStatus: () => Promise<any>;
  refreshContextUsage: () => Promise<void>;
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  refreshTimeline: () => Promise<void>;
  refreshModelAndQueueState: () => void;
  refreshPostPaintThreadState: () => void;
  setFloatingWidget: StateSetter<any>;
  dismissedLiveWidgetKeysRef: RefBox<Set<string>>;
}

export function useViewRefreshLifecycle(options: UseViewRefreshLifecycleOptions) {
  const {
    currentChatJid,
    currentRootChatJid,
    currentHashtag,
    searchQuery,
    searchScope,
    loadPosts,
    searchPosts,
    setPosts,
    setHasMore,
    scrollToBottom,
    setExtensionStatusPanels,
    setPendingExtensionPanelActions,
    paneStateOwnerChatJidRef,
    chatPaneStateByChatRef,
    snapshotCurrentChatPaneState,
    restoreChatPaneState,
    dismissedQueueRowIdsRef,
    refreshAgentStatus,
    viewStateRef,
    refreshTimeline,
    refreshModelAndQueueState,
    refreshPostPaintThreadState,
    setFloatingWidget,
    dismissedLiveWidgetKeysRef,
  } = options;

  useEffect(() => {
    resetExtensionPanelStateForChat({
      setExtensionStatusPanels,
      setPendingExtensionPanelActions,
    });
  }, [currentChatJid, setExtensionStatusPanels, setPendingExtensionPanelActions]);

  useEffect(() => {
    let cancelled = false;
    const traceId = ensureAppPerfTrace('thread-switch', currentChatJid, {
      currentRootChatJid,
      currentHashtag: currentHashtag || null,
      searchQuery: searchQuery || null,
      searchScope,
    });
    markAppPerfTrace(traceId, 'route-effect-start', {
      currentChatJid,
      currentRootChatJid,
    });

    void runTimelineLoadFlow({
      currentHashtag,
      searchQuery,
      searchScope,
      currentChatJid,
      currentRootChatJid,
      loadPosts,
      searchPosts,
      setPosts,
      setHasMore,
      scrollToBottom,
      isCancelled: () => cancelled,
      onTimelineLoadStart: (detail) => {
        markAppPerfTrace(traceId, 'timeline-load-start', detail || null);
      },
      onTimelineDataReady: (detail) => {
        markAppPerfTrace(traceId, 'timeline-data-ready', detail || null);
      },
      onTimelineFirstPaint: (detail) => {
        markAppPerfTrace(traceId, 'timeline-first-paint', detail || null);
        completeAppPerfTraceIfReady(traceId, ['runtime-hydration-ready', 'timeline-first-paint'], 'settled', detail || null);
        hydrateThreadStateAfterTimelineLoad({
          refreshAgentStatus,
          refreshPostPaintThreadState,
        });
      },
      onTimelineError: (error, detail) => {
        failAppPerfTrace(traceId, error, 'timeline-load-failed', detail || null);
        hydrateThreadStateAfterTimelineLoad({
          refreshAgentStatus,
          refreshPostPaintThreadState,
        });
      },
    });

    return () => {
      cancelled = true;
      cancelAppPerfTrace(traceId, 'route-effect-cancelled', {
        currentChatJid,
      });
    };
  }, [
    currentChatJid,
    currentHashtag,
    searchQuery,
    searchScope,
    currentRootChatJid,
    loadPosts,
    scrollToBottom,
    searchPosts,
    setHasMore,
    setPosts,
    refreshAgentStatus,
    refreshPostPaintThreadState,
  ]);

  useEffect(() => {
    const ownerChatJid = paneStateOwnerChatJidRef.current || currentChatJid;
    chatPaneStateByChatRef.current.set(ownerChatJid, snapshotCurrentChatPaneState());
  }, [chatPaneStateByChatRef, currentChatJid, paneStateOwnerChatJidRef, snapshotCurrentChatPaneState]);

  useEffect(() => {
    const ownerChatJid = paneStateOwnerChatJidRef.current || currentChatJid;
    if (ownerChatJid === currentChatJid) return;

    chatPaneStateByChatRef.current.set(ownerChatJid, snapshotCurrentChatPaneState());
    paneStateOwnerChatJidRef.current = currentChatJid;
    dismissedQueueRowIdsRef.current.clear();
    restoreChatPaneState(chatPaneStateByChatRef.current.get(currentChatJid) || null);
  }, [
    chatPaneStateByChatRef,
    currentChatJid,
    dismissedQueueRowIdsRef,
    paneStateOwnerChatJidRef,
    restoreChatPaneState,
    snapshotCurrentChatPaneState,
  ]);

  const refreshCurrentView = useCallback(() => {
    refreshCurrentViewState({
      viewStateRef,
      refreshTimeline,
      refreshModelAndQueueState,
    });
  }, [refreshModelAndQueueState, refreshTimeline, viewStateRef]);

  const applyLiveGeneratedWidgetUpdate = useCallback((data: any, fallbackStatus = 'streaming') => {
    const updatedAt = new Date().toISOString();
    setFloatingWidget((current: any) => applyLiveFloatingWidgetUpdate(current, data, {
      fallbackStatus,
      currentChatJid,
      dismissedSessionKeys: dismissedLiveWidgetKeysRef.current,
      updatedAt,
    }));
  }, [currentChatJid, dismissedLiveWidgetKeysRef, setFloatingWidget]);

  return {
    refreshCurrentView,
    applyLiveGeneratedWidgetUpdate,
  };
}
