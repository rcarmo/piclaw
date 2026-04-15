import {
  useAgentStatusLifecycle,
} from './app-agent-status-lifecycle.js';
import {
  useChatRefreshLifecycle,
} from './app-chat-refresh-lifecycle.js';
import {
  useViewRefreshLifecycle,
} from './app-view-refresh-lifecycle.js';
import {
  useRealtimeLifecycleOrchestration,
} from './app-realtime-lifecycle-orchestration.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

interface ToastFn {
  (title: string, detail?: string | null, kind?: string, durationMs?: number): void;
}

interface ComposeAgentStatusLifecycleOptionsInput {
  currentChatJid: string;
  activeChatJidRef: RefBox<string>;
  queueRefreshGenRef: RefBox<number>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  getAgentQueueState: (chatJid: string) => Promise<any>;
  setFollowupQueueItems: StateSetter<any[]>;
  clearQueuedSteerStateIfStale: (remainingQueueCount: number) => void;
  getAgentContext: ((chatJid: string) => Promise<any>) | null;
  setContextUsage: StateSetter<any>;
  getAutoresearchStatus: ((chatJid: string) => Promise<any>) | null;
  setExtensionStatusPanels: StateSetter<Map<string, unknown>>;
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
  getAgentStatus: (chatJid: string) => Promise<any>;
  wasAgentActiveRef: RefBox<boolean>;
  viewStateRef: RefBox<Record<string, unknown> | null | undefined>;
  refreshTimeline: () => Promise<void>;
  clearAgentRunState: () => void;
  agentStatusRef: RefBox<any>;
  pendingRequestRef: RefBox<any>;
  thoughtBufferRef: RefBox<string>;
  draftBufferRef: RefBox<string>;
  setAgentStatus: StateSetter<any>;
  setAgentDraft: StateSetter<any>;
  setAgentPlan: StateSetter<any>;
  setAgentThought: StateSetter<any>;
  setPendingRequest: StateSetter<any>;
  setActiveTurn: (turnId: string | null | undefined) => void;
  noteAgentActivity: (options?: Record<string, unknown>) => void;
  clearLastActivityFlag: () => void;
  isAgentRunningRef: RefBox<boolean>;
  currentTurnIdRef: RefBox<string | null>;
  silentRecoveryRef: RefBox<{ inFlight: boolean; lastAttemptAt: number; turnId: string | null }>;
  silenceRefreshMs: number;
  lastAgentEventRef: RefBox<number | null>;
  lastSilenceNoticeRef: RefBox<number>;
  silenceWarningMs: number;
  silenceFinalizeMs: number;
  isCompactionStatus: (status: any) => boolean;
  serverVersionContext: {
    currentAppAssetVersion: string;
    staleUiVersionRef: RefBox<string | null>;
    staleUiReloadScheduledRef: RefBox<boolean>;
    tabStoreHasUnsaved: () => boolean;
    isAgentRunningRef: RefBox<boolean>;
    pendingRequestRef: RefBox<any>;
    showIntentToast: ToastFn;
  };
  setConnectionStatus: StateSetter<string>;
  hasConnectedOnceRef: RefBox<boolean>;
}

export function composeAgentStatusLifecycleOptions(input: ComposeAgentStatusLifecycleOptionsInput) {
  return {
    currentChatJid: input.currentChatJid,
    activeChatJidRef: input.activeChatJidRef,
    queueRefreshGenRef: input.queueRefreshGenRef,
    dismissedQueueRowIdsRef: input.dismissedQueueRowIdsRef,
    getAgentQueueState: input.getAgentQueueState,
    setFollowupQueueItems: input.setFollowupQueueItems,
    clearQueuedSteerStateIfStale: input.clearQueuedSteerStateIfStale,
    getAgentContext: input.getAgentContext,
    setContextUsage: input.setContextUsage,
    getAutoresearchStatus: input.getAutoresearchStatus,
    setExtensionStatusPanels: input.setExtensionStatusPanels,
    setPendingExtensionPanelActions: input.setPendingExtensionPanelActions,
    getAgentStatus: input.getAgentStatus,
    wasAgentActiveRef: input.wasAgentActiveRef,
    viewStateRef: input.viewStateRef,
    refreshTimeline: input.refreshTimeline,
    clearAgentRunState: input.clearAgentRunState,
    agentStatusRef: input.agentStatusRef,
    pendingRequestRef: input.pendingRequestRef,
    thoughtBufferRef: input.thoughtBufferRef,
    draftBufferRef: input.draftBufferRef,
    setAgentStatus: input.setAgentStatus,
    setAgentDraft: input.setAgentDraft,
    setAgentPlan: input.setAgentPlan,
    setAgentThought: input.setAgentThought,
    setPendingRequest: input.setPendingRequest,
    setActiveTurn: input.setActiveTurn,
    noteAgentActivity: input.noteAgentActivity,
    clearLastActivityFlag: input.clearLastActivityFlag,
    isAgentRunningRef: input.isAgentRunningRef,
    currentTurnIdRef: input.currentTurnIdRef,
    silentRecoveryRef: input.silentRecoveryRef,
    silenceRefreshMs: input.silenceRefreshMs,
    lastAgentEventRef: input.lastAgentEventRef,
    lastSilenceNoticeRef: input.lastSilenceNoticeRef,
    silenceWarningMs: input.silenceWarningMs,
    silenceFinalizeMs: input.silenceFinalizeMs,
    isCompactionStatus: input.isCompactionStatus,
    serverVersionContext: input.serverVersionContext,
    setConnectionStatus: input.setConnectionStatus,
    setPendingRequestForConnection: input.setPendingRequest,
    hasConnectedOnceRef: input.hasConnectedOnceRef,
  };
}

interface ComposeChatRefreshLifecycleOptionsInput {
  getAgents: () => Promise<any>;
  setAgents: StateSetter<Record<string, unknown>>;
  setUserProfile: StateSetter<any>;
  applyBranding: (name: string, avatarUrl: string | null, avatarVersion?: string | null) => void;
  readStoredNumber: (key: string, fallback?: number | null) => number | null;
  sidebarWidthRef: RefBox<number>;
  appShellRef: RefBox<HTMLElement | null>;
  currentChatJid: string;
  currentRootChatJid: string;
  getAgentModels: (chatJid: string) => Promise<any>;
  getActiveChatAgents: (chatJid: string) => Promise<any>;
  getChatBranches: (chatJid: string | null, options?: Record<string, unknown>) => Promise<any>;
  activeChatJidRef: RefBox<string>;
  setActiveChatAgents: StateSetter<any[]>;
  setCurrentChatBranches: StateSetter<any[]>;
  setActiveModel: StateSetter<string | null>;
  setActiveThinkingLevel: StateSetter<string | null>;
  setSupportsThinking: StateSetter<boolean>;
  setActiveModelUsage: StateSetter<any>;
  setAgentModelsPayload: StateSetter<any>;
  setHasLoadedAgentModels: StateSetter<boolean>;
  agentsRef: RefBox<Record<string, unknown>>;
  refreshQueueState: () => Promise<void>;
  refreshContextUsage: () => Promise<void>;
  refreshAutoresearchStatus: () => Promise<void>;
}

export function composeChatRefreshLifecycleOptions(input: ComposeChatRefreshLifecycleOptionsInput) {
  return {
    getAgents: input.getAgents,
    setAgents: input.setAgents,
    setUserProfile: input.setUserProfile,
    applyBranding: input.applyBranding,
    readStoredNumber: input.readStoredNumber,
    sidebarWidthRef: input.sidebarWidthRef,
    appShellRef: input.appShellRef,
    currentChatJid: input.currentChatJid,
    currentRootChatJid: input.currentRootChatJid,
    getAgentModels: input.getAgentModels,
    getActiveChatAgents: input.getActiveChatAgents,
    getChatBranches: input.getChatBranches,
    activeChatJidRef: input.activeChatJidRef,
    setActiveChatAgents: input.setActiveChatAgents,
    setCurrentChatBranches: input.setCurrentChatBranches,
    setActiveModel: input.setActiveModel,
    setActiveThinkingLevel: input.setActiveThinkingLevel,
    setSupportsThinking: input.setSupportsThinking,
    setActiveModelUsage: input.setActiveModelUsage,
    setAgentModelsPayload: input.setAgentModelsPayload,
    setHasLoadedAgentModels: input.setHasLoadedAgentModels,
    agentsRef: input.agentsRef,
    refreshQueueState: input.refreshQueueState,
    refreshContextUsage: input.refreshContextUsage,
    refreshAutoresearchStatus: input.refreshAutoresearchStatus,
  };
}

interface ComposeViewRefreshLifecycleOptionsInput {
  currentChatJid: string;
  currentRootChatJid: string;
  currentHashtag: string | null;
  searchQuery: string | null;
  searchScope: string;
  loadPosts: (hashtag?: string | null) => Promise<void>;
  searchPosts: (query: string, limit: number, offset: number, chatJid: string, scope: string, rootChatJid: string) => Promise<{ results?: any[] }>;
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

export function composeViewRefreshLifecycleOptions(input: ComposeViewRefreshLifecycleOptionsInput) {
  return {
    currentChatJid: input.currentChatJid,
    currentRootChatJid: input.currentRootChatJid,
    currentHashtag: input.currentHashtag,
    searchQuery: input.searchQuery,
    searchScope: input.searchScope,
    loadPosts: input.loadPosts,
    searchPosts: input.searchPosts,
    setPosts: input.setPosts,
    setHasMore: input.setHasMore,
    scrollToBottom: input.scrollToBottom,
    setExtensionStatusPanels: input.setExtensionStatusPanels,
    setPendingExtensionPanelActions: input.setPendingExtensionPanelActions,
    paneStateOwnerChatJidRef: input.paneStateOwnerChatJidRef,
    chatPaneStateByChatRef: input.chatPaneStateByChatRef,
    snapshotCurrentChatPaneState: input.snapshotCurrentChatPaneState,
    restoreChatPaneState: input.restoreChatPaneState,
    dismissedQueueRowIdsRef: input.dismissedQueueRowIdsRef,
    refreshQueueState: input.refreshQueueState,
    refreshAgentStatus: input.refreshAgentStatus,
    refreshContextUsage: input.refreshContextUsage,
    viewStateRef: input.viewStateRef,
    refreshTimeline: input.refreshTimeline,
    refreshModelAndQueueState: input.refreshModelAndQueueState,
    refreshPostPaintThreadState: input.refreshPostPaintThreadState,
    setFloatingWidget: input.setFloatingWidget,
    dismissedLiveWidgetKeysRef: input.dismissedLiveWidgetKeysRef,
  };
}

interface ComposeRealtimeLifecycleOptionsInput {
  currentChatJid: string;
  posts: any[];
  scrollToMessage: (id: string | number, targetChatJid?: string | null) => Promise<void>;
  handleConnectionStatusChange: (status: string) => void;
  loadPosts: (hashtag?: string | null) => Promise<void>;
  refreshCurrentView: () => void;
  updateAgentProfile: (payload: any) => void;
  updateUserProfile: (payload: any) => void;
  currentTurnIdRef: RefBox<string | null>;
  activeChatJidRef: RefBox<string>;
  pendingRequestRef: RefBox<any>;
  draftBufferRef: RefBox<string>;
  thoughtBufferRef: RefBox<string>;
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
  setFloatingWidget: StateSetter<any>;
  clearLastActivityFlag: () => void;
  handleUiVersionDrift: (serverVersion: string | null | undefined) => void;
  setAgentStatus: StateSetter<any>;
  setAgentDraft: StateSetter<any>;
  setAgentPlan: StateSetter<any>;
  setAgentThought: StateSetter<any>;
  setPendingRequest: StateSetter<any>;
  clearAgentRunState: () => void;
  getAgentStatus: (chatJid: string) => Promise<any>;
  noteAgentActivity: (options?: Record<string, unknown>) => void;
  showLastActivity: (payload: any) => void;
  refreshTimeline: () => Promise<void>;
  refreshModelAndQueueState: () => void;
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  notifyForFinalResponse: (turnId: string | null | undefined) => void;
  setContextUsage: StateSetter<any>;
  refreshContextUsage: () => Promise<void>;
  refreshQueueState: () => Promise<void>;
  setFollowupQueueItems: StateSetter<any[]>;
  clearQueuedSteerStateIfStale: (remainingQueueCount: number) => void;
  setSteerQueuedTurnId: (turnId: string | null) => void;
  applyModelState: (payload: any) => void;
  getAgentContext: ((chatJid: string) => Promise<any>) | null;
  setExtensionStatusPanels: StateSetter<Map<string, unknown>>;
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
  refreshActiveEditorFromWorkspace: (updates: any) => Promise<void>;
  showIntentToast: ToastFn;
  removeStalledPost: () => void;
  setPosts: StateSetter<any[] | null>;
  preserveTimelineScrollTop: (mutate: () => void) => void;
  finalizeStalledResponse: () => void;
  connectionStatus: string;
  agentStatus: any;
  refreshAgentStatus: () => Promise<any>;
  refreshAutoresearchStatus: () => Promise<void>;
}

export function composeRealtimeLifecycleOptions(input: ComposeRealtimeLifecycleOptionsInput) {
  return {
    currentChatJid: input.currentChatJid,
    posts: input.posts,
    scrollToMessage: input.scrollToMessage,
    handleConnectionStatusChange: input.handleConnectionStatusChange,
    loadPosts: input.loadPosts,
    refreshCurrentView: input.refreshCurrentView,
    updateAgentProfile: input.updateAgentProfile,
    updateUserProfile: input.updateUserProfile,
    currentTurnIdRef: input.currentTurnIdRef,
    activeChatJidRef: input.activeChatJidRef,
    pendingRequestRef: input.pendingRequestRef,
    draftBufferRef: input.draftBufferRef,
    thoughtBufferRef: input.thoughtBufferRef,
    steerQueuedTurnIdRef: input.steerQueuedTurnIdRef,
    thoughtExpandedRef: input.thoughtExpandedRef,
    draftExpandedRef: input.draftExpandedRef,
    draftThrottleRef: input.draftThrottleRef,
    thoughtThrottleRef: input.thoughtThrottleRef,
    viewStateRef: input.viewStateRef,
    followupQueueItemsRef: input.followupQueueItemsRef,
    dismissedQueueRowIdsRef: input.dismissedQueueRowIdsRef,
    scrollToBottomRef: input.scrollToBottomRef,
    hasMoreRef: input.hasMoreRef,
    loadMoreRef: input.loadMoreRef,
    lastAgentResponseRef: input.lastAgentResponseRef,
    wasAgentActiveRef: input.wasAgentActiveRef,
    setActiveTurn: input.setActiveTurn,
    applyLiveGeneratedWidgetUpdate: input.applyLiveGeneratedWidgetUpdate,
    setFloatingWidget: input.setFloatingWidget,
    clearLastActivityFlag: input.clearLastActivityFlag,
    handleUiVersionDrift: input.handleUiVersionDrift,
    setAgentStatus: input.setAgentStatus,
    setAgentDraft: input.setAgentDraft,
    setAgentPlan: input.setAgentPlan,
    setAgentThought: input.setAgentThought,
    setPendingRequest: input.setPendingRequest,
    clearAgentRunState: input.clearAgentRunState,
    getAgentStatus: input.getAgentStatus,
    noteAgentActivity: input.noteAgentActivity,
    showLastActivity: input.showLastActivity,
    refreshTimeline: input.refreshTimeline,
    refreshModelAndQueueState: input.refreshModelAndQueueState,
    refreshActiveChatAgents: input.refreshActiveChatAgents,
    refreshCurrentChatBranches: input.refreshCurrentChatBranches,
    notifyForFinalResponse: input.notifyForFinalResponse,
    setContextUsage: input.setContextUsage,
    refreshContextUsage: input.refreshContextUsage,
    refreshQueueState: input.refreshQueueState,
    setFollowupQueueItems: input.setFollowupQueueItems,
    clearQueuedSteerStateIfStale: input.clearQueuedSteerStateIfStale,
    setSteerQueuedTurnId: input.setSteerQueuedTurnId,
    applyModelState: input.applyModelState,
    getAgentContext: input.getAgentContext,
    setExtensionStatusPanels: input.setExtensionStatusPanels,
    setPendingExtensionPanelActions: input.setPendingExtensionPanelActions,
    refreshActiveEditorFromWorkspace: input.refreshActiveEditorFromWorkspace,
    showIntentToast: input.showIntentToast,
    removeStalledPost: input.removeStalledPost,
    setPosts: input.setPosts,
    preserveTimelineScrollTop: input.preserveTimelineScrollTop,
    finalizeStalledResponse: input.finalizeStalledResponse,
    connectionStatus: input.connectionStatus,
    agentStatus: input.agentStatus,
    refreshAgentStatus: input.refreshAgentStatus,
    refreshAutoresearchStatus: input.refreshAutoresearchStatus,
  };
}

export interface UseMainAppLifecycleCompositionOptions extends ComposeAgentStatusLifecycleOptionsInput, ComposeChatRefreshLifecycleOptionsInput, ComposeViewRefreshLifecycleOptionsInput, Omit<ComposeRealtimeLifecycleOptionsInput,
  'handleConnectionStatusChange'
  | 'refreshCurrentView'
  | 'updateAgentProfile'
  | 'updateUserProfile'
  | 'applyLiveGeneratedWidgetUpdate'
  | 'refreshModelAndQueueState'
  | 'refreshActiveChatAgents'
  | 'refreshCurrentChatBranches'
  | 'applyModelState'
  | 'refreshContextUsage'
  | 'refreshQueueState'
  | 'refreshAgentStatus'
  | 'refreshAutoresearchStatus'
> {}

export function useMainAppLifecycleComposition(options: UseMainAppLifecycleCompositionOptions) {
  const agentStatusLifecycle = useAgentStatusLifecycle(composeAgentStatusLifecycleOptions(options));
  const chatRefreshLifecycle = useChatRefreshLifecycle(composeChatRefreshLifecycleOptions({
    ...options,
    refreshQueueState: agentStatusLifecycle.refreshQueueState,
    refreshContextUsage: agentStatusLifecycle.refreshContextUsage,
    refreshAutoresearchStatus: agentStatusLifecycle.refreshAutoresearchStatus,
  }));
  const viewRefreshLifecycle = useViewRefreshLifecycle(composeViewRefreshLifecycleOptions({
    ...options,
    refreshQueueState: agentStatusLifecycle.refreshQueueState,
    refreshAgentStatus: agentStatusLifecycle.refreshAgentStatus,
    refreshContextUsage: agentStatusLifecycle.refreshContextUsage,
    refreshModelAndQueueState: chatRefreshLifecycle.refreshModelAndQueueState,
    refreshPostPaintThreadState: chatRefreshLifecycle.refreshPostPaintThreadState,
  }));

  useRealtimeLifecycleOrchestration(composeRealtimeLifecycleOptions({
    ...options,
    handleConnectionStatusChange: agentStatusLifecycle.handleConnectionStatusChange,
    handleUiVersionDrift: agentStatusLifecycle.handleUiVersionDrift,
    refreshCurrentView: viewRefreshLifecycle.refreshCurrentView,
    updateAgentProfile: chatRefreshLifecycle.updateAgentProfile,
    updateUserProfile: chatRefreshLifecycle.updateUserProfile,
    applyLiveGeneratedWidgetUpdate: viewRefreshLifecycle.applyLiveGeneratedWidgetUpdate,
    refreshModelAndQueueState: chatRefreshLifecycle.refreshModelAndQueueState,
    refreshActiveChatAgents: chatRefreshLifecycle.refreshActiveChatAgents,
    refreshCurrentChatBranches: chatRefreshLifecycle.refreshCurrentChatBranches,
    refreshContextUsage: agentStatusLifecycle.refreshContextUsage,
    refreshQueueState: agentStatusLifecycle.refreshQueueState,
    applyModelState: chatRefreshLifecycle.applyModelState,
    refreshAgentStatus: agentStatusLifecycle.refreshAgentStatus,
    refreshAutoresearchStatus: agentStatusLifecycle.refreshAutoresearchStatus,
  }));

  return {
    agentStatusLifecycle,
    chatRefreshLifecycle,
    viewRefreshLifecycle,
  };
}
