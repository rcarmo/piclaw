import { useCallback, useEffect } from '../vendor/preact-htm.js';
import { useSseConnection } from './use-sse-connection.js';
import { handleAppSseEvent } from './app-sse-events.js';
import { runBackstopRefreshTick } from './app-connection-lifecycle.js';
import { watchReturnToApp } from './app-resume.js';

interface RefBox<T> {
  current: T;
}

export function resolveBackstopIntervalMs(isAgentActive: boolean): number {
  return isAgentActive ? 15_000 : 60_000;
}

interface UseRealtimeLifecycleOrchestrationOptions {
  currentChatJid: string;
  posts: any[] | null;
  scrollToMessage: (id: string | number, targetChatJid?: string | null) => Promise<void>;

  handleConnectionStatusChange: (status: string) => void;
  loadPosts: (hashtag?: string | null) => Promise<void>;
  refreshCurrentView: () => void;

  // SSE event routing context
  updateAgentProfile: (payload: any) => void;
  updateUserProfile: (payload: any) => void;
  currentTurnIdRef: RefBox<string | null>;
  activeChatJidRef: RefBox<string>;
  pendingRequestRef: RefBox<any>;
  draftBufferRef: RefBox<string>;
  thoughtBufferRef: RefBox<string>;
  previewResyncPendingRef: RefBox<boolean>;
  previewResyncGenerationRef: RefBox<number>;
  steerQueuedTurnIdRef: RefBox<string | null>;
  thoughtExpandedRef: RefBox<boolean>;
  draftExpandedRef: RefBox<boolean>;
  draftThrottleRef: RefBox<ReturnType<typeof setTimeout> | null>;
  thoughtThrottleRef: RefBox<ReturnType<typeof setTimeout> | null>;
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  followupQueueItemsRef: RefBox<any[]>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  scrollToBottomRef: RefBox<(() => void) | null>;
  hasMoreRef: RefBox<boolean>;
  loadMoreRef: RefBox<((options?: Record<string, unknown>) => void) | null>;
  lastAgentResponseRef: RefBox<any>;
  wasAgentActiveRef: RefBox<boolean>;
  setActiveTurn: (turnId: string | null | undefined) => void;
  applyLiveGeneratedWidgetUpdate: (data: any, fallbackStatus?: string) => void;
  setFloatingWidget: (next: any) => void;
  clearLastActivityFlag: () => void;
  handleUiVersionDrift: (serverVersion: string | null | undefined) => void;
  setAgentStatus: (next: any) => void;
  setAgentDraft: (next: any) => void;
  setAgentPlan: (next: any) => void;
  setAgentThought: (next: any) => void;
  setPendingRequest: (next: any) => void;
  clearAgentRunState: () => void;
  getAgentStatus: (chatJid: string) => Promise<any>;
  noteAgentActivity: (options?: Record<string, unknown>) => void;
  showLastActivity: (payload: any) => void;
  refreshTimeline: () => Promise<void>;
  refreshModelAndQueueState: () => void;
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  notifyForFinalResponse: (turnId: string | null | undefined) => void;
  setContextUsage: (next: any) => void;
  refreshContextUsage: () => Promise<void>;
  refreshQueueState: () => Promise<void>;
  setFollowupQueueItems: (next: any) => void;
  clearQueuedSteerStateIfStale: (remainingQueueCount: number) => void;
  setSteerQueuedTurnId: (turnId: string | null) => void;
  applyModelState: (payload: any) => void;
  getAgentContext: ((chatJid: string) => Promise<any>) | null;
  setExtensionStatusPanels: (next: any) => void;
  setPendingExtensionPanelActions: (next: any) => void;
  setExtensionWorkingState: (next: any) => void;
  refreshActiveEditorFromWorkspace: (updates: any) => Promise<void>;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  removeStalledPost: () => void;
  setPosts: (next: any) => void;
  preserveTimelineScrollTop: (mutate: () => void) => void;
  openEditor?: (path: string, options?: { label?: string }) => void;

  // test-api + reset
  finalizeStalledResponse: () => void;

  // backstop / return-to-app
  connectionStatus: string;
  agentStatus: any;
  refreshAgentStatus: () => Promise<any>;
  refreshAutoresearchStatus: () => Promise<void>;
}

export function useRealtimeLifecycleOrchestration(options: UseRealtimeLifecycleOrchestrationOptions) {
  const {
    currentChatJid,
    posts,
    scrollToMessage,
    handleConnectionStatusChange,
    loadPosts,
    refreshCurrentView,

    updateAgentProfile,
    updateUserProfile,
    currentTurnIdRef,
    activeChatJidRef,
    pendingRequestRef,
    draftBufferRef,
    thoughtBufferRef,
    previewResyncPendingRef,
    previewResyncGenerationRef,
    steerQueuedTurnIdRef,
    thoughtExpandedRef,
    draftExpandedRef,
    draftThrottleRef,
    thoughtThrottleRef,
    viewStateRef,
    followupQueueItemsRef,
    dismissedQueueRowIdsRef,
    scrollToBottomRef,
    hasMoreRef,
    loadMoreRef,
    lastAgentResponseRef,
    wasAgentActiveRef,
    setActiveTurn,
    applyLiveGeneratedWidgetUpdate,
    setFloatingWidget,
    clearLastActivityFlag,
    handleUiVersionDrift,
    setAgentStatus,
    setAgentDraft,
    setAgentPlan,
    setAgentThought,
    setPendingRequest,
    clearAgentRunState,
    getAgentStatus,
    noteAgentActivity,
    showLastActivity,
    refreshTimeline,
    refreshModelAndQueueState,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    notifyForFinalResponse,
    setContextUsage,
    refreshContextUsage,
    refreshQueueState,
    setFollowupQueueItems,
    clearQueuedSteerStateIfStale,
    setSteerQueuedTurnId,
    applyModelState,
    getAgentContext,
    setExtensionStatusPanels,
    setPendingExtensionPanelActions,
    setExtensionWorkingState,
    refreshActiveEditorFromWorkspace,
    showIntentToast,
    removeStalledPost,
    setPosts,
    preserveTimelineScrollTop,
    openEditor,
    finalizeStalledResponse,

    connectionStatus,
    agentStatus,
    refreshAgentStatus,
    refreshAutoresearchStatus,
  } = options;

  const handleSseEvent = useCallback((eventType: string, data: any) => {
    handleAppSseEvent(eventType, data, {
      currentChatJid,
      updateAgentProfile,
      updateUserProfile,
      currentTurnIdRef,
      activeChatJidRef,
      pendingRequestRef,
      draftBufferRef,
      thoughtBufferRef,
      previewResyncPendingRef,
      previewResyncGenerationRef,
      steerQueuedTurnIdRef,
      thoughtExpandedRef,
      draftExpandedRef,
      draftThrottleRef,
      thoughtThrottleRef,
      viewStateRef,
      followupQueueItemsRef,
      dismissedQueueRowIdsRef,
      scrollToBottomRef,
      hasMoreRef,
      loadMoreRef,
      lastAgentResponseRef,
      wasAgentActiveRef,
      setActiveTurn,
      applyLiveGeneratedWidgetUpdate,
      setFloatingWidget,
      clearLastActivityFlag,
      handleUiVersionDrift,
      setAgentStatus,
      setAgentDraft,
      setAgentPlan,
      setAgentThought,
      setPendingRequest,
      clearAgentRunState,
      getAgentStatus,
      noteAgentActivity,
      showLastActivity,
      refreshTimeline,
      refreshModelAndQueueState,
      refreshActiveChatAgents,
      refreshCurrentChatBranches,
      notifyForFinalResponse,
      setContextUsage,
      refreshContextUsage,
      refreshQueueState,
      setFollowupQueueItems,
      clearQueuedSteerStateIfStale,
      setSteerQueuedTurnId,
      applyModelState,
      getAgentContext,
      setExtensionStatusPanels,
      setPendingExtensionPanelActions,
      setExtensionWorkingState,
      refreshActiveEditorFromWorkspace,
      showIntentToast,
      removeStalledPost,
      setPosts,
      preserveTimelineScrollTop,
      openEditor,
    });
  }, [
    activeChatJidRef,
    applyLiveGeneratedWidgetUpdate,
    applyModelState,
    clearAgentRunState,
    clearLastActivityFlag,
    clearQueuedSteerStateIfStale,
    currentChatJid,
    currentTurnIdRef,
    dismissedQueueRowIdsRef,
    draftBufferRef,
    draftExpandedRef,
    draftThrottleRef,
    followupQueueItemsRef,
    getAgentContext,
    getAgentStatus,
    handleUiVersionDrift,
    hasMoreRef,
    lastAgentResponseRef,
    loadMoreRef,
    noteAgentActivity,
    notifyForFinalResponse,
    pendingRequestRef,
    preserveTimelineScrollTop,
    previewResyncGenerationRef,
    previewResyncPendingRef,
    refreshActiveChatAgents,
    refreshActiveEditorFromWorkspace,
    refreshContextUsage,
    refreshCurrentChatBranches,
    refreshModelAndQueueState,
    refreshQueueState,
    refreshTimeline,
    removeStalledPost,
    scrollToBottomRef,
    setActiveTurn,
    setAgentDraft,
    setAgentPlan,
    setAgentStatus,
    setAgentThought,
    setContextUsage,
    setExtensionStatusPanels,
    setExtensionWorkingState,
    setFloatingWidget,
    setFollowupQueueItems,
    setPendingExtensionPanelActions,
    setPendingRequest,
    setPosts,
    setSteerQueuedTurnId,
    showIntentToast,
    showLastActivity,
    steerQueuedTurnIdRef,
    thoughtBufferRef,
    thoughtExpandedRef,
    thoughtThrottleRef,
    updateAgentProfile,
    updateUserProfile,
    viewStateRef,
    wasAgentActiveRef,
    openEditor,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const api = window.__PICLAW_TEST_API || {};
    api.emit = handleSseEvent;
    api.reset = () => {
      removeStalledPost();
      clearAgentRunState();
      setAgentStatus(null);
      setAgentDraft({ text: '', totalLines: 0 });
      setAgentPlan('');
      setAgentThought({ text: '', totalLines: 0 });
      setExtensionWorkingState({ message: null, indicator: null });
      setPendingRequest(null);
    };
    api.finalize = () => finalizeStalledResponse();
    window.__PICLAW_TEST_API = api;
    return () => {
      if (window.__PICLAW_TEST_API === api) {
        window.__PICLAW_TEST_API = undefined;
      }
    };
  }, [clearAgentRunState, finalizeStalledResponse, handleSseEvent, removeStalledPost, setAgentDraft, setAgentPlan, setAgentStatus, setAgentThought, setExtensionWorkingState, setPendingRequest]);

  useSseConnection({
    handleSseEvent,
    handleConnectionStatusChange,
    loadPosts,
    onWake: refreshCurrentView,
    chatJid: currentChatJid,
  });

  useEffect(() => {
    if (!posts || posts.length === 0) return;
    const hash = location.hash;
    if (!hash || !hash.startsWith('#msg-')) return;
    const msgId = hash.slice(5);
    void scrollToMessage(msgId);
    history.replaceState(null, '', location.pathname + location.search);
  }, [posts, scrollToMessage]);

  const isAgentActive = agentStatus !== null;
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    const intervalMs = resolveBackstopIntervalMs(isAgentActive);
    const interval = setInterval(() => {
      runBackstopRefreshTick({
        viewStateRef,
        isAgentActive,
        refreshTimeline,
        refreshQueueState,
        refreshAgentStatus,
        refreshContextUsage,
        refreshAutoresearchStatus,
      });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [connectionStatus, isAgentActive, refreshAgentStatus, refreshAutoresearchStatus, refreshContextUsage, refreshQueueState, refreshTimeline, viewStateRef]);

  useEffect(() => {
    return watchReturnToApp(() => {
      void refreshAgentStatus();
      void refreshContextUsage();
      void refreshQueueState();
      void refreshAutoresearchStatus();
    });
  }, [refreshAgentStatus, refreshAutoresearchStatus, refreshContextUsage, refreshQueueState]);
}
