import { useTimelineViewActions } from './app-timeline-view-actions.js';
import { useMainAppLifecycleComposition } from './app-main-lifecycle-composition.js';
import { useMainAppActionComposition } from './app-main-action-composition.js';

interface UseMainAppOrchestrationCompositionOptions {
  routeState: {
    currentChatJid: string;
    currentRootChatJid: string;
    chatOnlyMode: boolean;
    navigate: (url: string, options?: Record<string, unknown>) => void;
    branchLoaderMode: boolean;
    branchLoaderSourceChatJid: string;
    isWebAppMode: boolean;
  };
  searchState: {
    currentHashtag: string | null;
    setCurrentHashtag: (value: string | null) => void;
    searchQuery: string | null;
    setSearchQuery: (value: string | null) => void;
    searchOpen: boolean;
    setSearchOpen: (open: boolean) => void;
    searchScope: string;
    setSearchScope: (scope: string) => void;
  };
  shellState: {
    activeChatAgents: any[];
    currentChatBranches: any[];
    currentBranchRecord: any;
    contextUsage: any;
    activeModel: string | null;
    activeThinkingLevel: string | null;
    supportsThinking: boolean;
    activeModelUsage: any;
    connectionStatus: string;
    notificationsEnabled: boolean;
    notificationPermission: string;
    workspaceOpen: boolean;
    setWorkspaceOpen: (next: boolean | ((prev: boolean) => boolean)) => void;
    userProfile: any;
    agents: Record<string, unknown>;
    removingPostIds: Set<string | number>;
    btwSession: any;
    plannotatorSession: any;
  };
  timeline: Record<string, any>;
  interaction: Record<string, any>;
  paneRuntime: Record<string, any>;
  refs: Record<string, any>;
  setters: Record<string, any>;
  services: Record<string, any>;
  helpers: {
    getFormLock: () => number;
    readStoredNumber: (key: string, fallback?: number | null) => number | null;
  };
}

export function isComposeBoxAgentActiveState(isAgentTurnActive: boolean, agentStatus: any): boolean {
  return Boolean(isAgentTurnActive || agentStatus !== null);
}

export function buildMainAppOrchestrationResult(options: {
  agentStatusLifecycleBundle: Record<string, any>;
  actionBundle: Record<string, any>;
  timelineViewActions: Record<string, any>;
  isComposeBoxAgentActive: boolean;
}) {
  return {
    ...options.agentStatusLifecycleBundle,
    ...options.actionBundle,
    timelineViewActions: options.timelineViewActions,
    isComposeBoxAgentActive: options.isComposeBoxAgentActive,
  };
}

export function composeMainAppLifecycleCompositionOptions(options: UseMainAppOrchestrationCompositionOptions, showIntentToast: (...args: any[]) => void) {
  const {
    routeState,
    searchState,
    shellState,
    timeline,
    interaction,
    paneRuntime,
    refs,
    setters,
    services,
    helpers,
  } = options;

  return {
    currentChatJid: routeState.currentChatJid,
    activeChatJidRef: refs.activeChatJidRef,
    queueRefreshGenRef: refs.queueRefreshGenRef,
    dismissedQueueRowIdsRef: refs.dismissedQueueRowIdsRef,
    getAgentQueueState: services.getAgentQueueState,
    setFollowupQueueItems: setters.setFollowupQueueItems,
    clearQueuedSteerStateIfStale: interaction.clearQueuedSteerStateIfStale,
    getAgentContext: services.getAgentContext,
    setContextUsage: setters.setContextUsage,
    getAutoresearchStatus: services.getAutoresearchStatus,
    setExtensionStatusPanels: setters.setExtensionStatusPanels,
    setPendingExtensionPanelActions: setters.setPendingExtensionPanelActions,
    setExtensionWorkingState: setters.setExtensionWorkingState,
    getAgentStatus: services.getAgentStatus,
    wasAgentActiveRef: refs.wasAgentActiveRef,
    viewStateRef: refs.viewStateRef,
    refreshTimeline: timeline.refreshTimeline,
    clearAgentRunState: interaction.clearAgentRunState,
    agentStatusRef: refs.agentStatusRef,
    pendingRequestRef: refs.pendingRequestRef,
    thoughtBufferRef: refs.thoughtBufferRef,
    draftBufferRef: refs.draftBufferRef,
    previewResyncPendingRef: refs.previewResyncPendingRef,
    previewResyncGenerationRef: refs.previewResyncGenerationRef,
    setAgentStatus: setters.setAgentStatus,
    setAgentDraft: setters.setAgentDraft,
    setAgentPlan: setters.setAgentPlan,
    setAgentThought: setters.setAgentThought,
    setPendingRequest: setters.setPendingRequest,
    setActiveTurn: interaction.setActiveTurn,
    noteAgentActivity: interaction.noteAgentActivity,
    showLastActivity: interaction.showLastActivity,
    clearLastActivityFlag: interaction.clearLastActivityFlag,
    isAgentRunningRef: refs.isAgentRunningRef,
    currentTurnIdRef: refs.currentTurnIdRef,
    silentRecoveryRef: refs.silentRecoveryRef,
    silenceRefreshMs: services.silenceRefreshMs,
    lastAgentEventRef: refs.lastAgentEventRef,
    lastSilenceNoticeRef: refs.lastSilenceNoticeRef,
    silenceWarningMs: services.silenceWarningMs,
    silenceFinalizeMs: services.silenceFinalizeMs,
    isCompactionStatus: services.isCompactionStatus,
    serverVersionContext: {
      currentAppAssetVersion: services.currentAppAssetVersion,
      staleUiVersionRef: refs.staleUiVersionRef,
      staleUiReloadScheduledRef: refs.staleUiReloadScheduledRef,
      tabStoreHasUnsaved: services.tabStoreHasUnsaved,
      isAgentRunningRef: refs.isAgentRunningRef,
      pendingRequestRef: refs.pendingRequestRef,
      showIntentToast,
    },
    setConnectionStatus: setters.setConnectionStatus,
    hasConnectedOnceRef: refs.hasConnectedOnceRef,
    getAgents: services.getAgents,
    setAgents: setters.setAgents,
    setUserProfile: setters.setUserProfile,
    applyBranding: interaction.applyBranding,
    readStoredNumber: helpers.readStoredNumber,
    sidebarWidthRef: refs.sidebarWidthRef,
    appShellRef: refs.appShellRef,
    currentRootChatJid: routeState.currentRootChatJid,
    getAgentModels: services.getAgentModels,
    getActiveChatAgents: services.getActiveChatAgents,
    getChatBranches: services.getChatBranches,
    setActiveChatAgents: setters.setActiveChatAgents,
    setCurrentChatBranches: setters.setCurrentChatBranches,
    setActiveModel: setters.setActiveModel,
    setActiveThinkingLevel: setters.setActiveThinkingLevel,
    setSupportsThinking: setters.setSupportsThinking,
    setActiveModelUsage: setters.setActiveModelUsage,
    setAgentModelsPayload: setters.setAgentModelsPayload,
    setHasLoadedAgentModels: setters.setHasLoadedAgentModels,
    agentsRef: refs.agentsRef,
    currentHashtag: searchState.currentHashtag,
    searchQuery: searchState.searchQuery,
    searchScope: searchState.searchScope,
    loadPosts: timeline.loadPosts,
    searchPosts: services.searchPosts,
    setPosts: timeline.setPosts,
    setHasMore: timeline.setHasMore,
    scrollToBottom: timeline.scrollToBottom,
    paneStateOwnerChatJidRef: refs.paneStateOwnerChatJidRef,
    chatPaneStateByChatRef: refs.chatPaneStateByChatRef,
    snapshotCurrentChatPaneState: interaction.snapshotCurrentChatPaneState,
    restoreChatPaneState: interaction.restoreChatPaneState,
    setFloatingWidget: setters.setFloatingWidget,
    dismissedLiveWidgetKeysRef: refs.dismissedLiveWidgetKeysRef,
    posts: timeline.posts,
    scrollToMessage: interaction.composeReferenceActions.scrollToMessage,
    draftThrottleRef: refs.draftThrottleRef,
    thoughtThrottleRef: refs.thoughtThrottleRef,
    followupQueueItemsRef: refs.followupQueueItemsRef,
    scrollToBottomRef: timeline.scrollToBottomRef,
    hasMoreRef: timeline.hasMoreRef,
    loadMoreRef: timeline.loadMoreRef,
    lastAgentResponseRef: refs.lastAgentResponseRef,
    notifyForFinalResponse: interaction.notifyForFinalResponse,
    setSteerQueuedTurnId: setters.setSteerQueuedTurnId,
    refreshActiveEditorFromWorkspace: paneRuntime.refreshActiveEditorFromWorkspace,
    showIntentToast,
    removeStalledPost: interaction.recoveryCallbacks.removeStalledPost,
    preserveTimelineScrollTop: timeline.preserveTimelineScrollTop,
    // Wrap finalizeStalledResponse to also clear transient extension working
    // state (working message + indicator) which the stall finalizer doesn't
    // reach through the normal SSE done/error path.
    finalizeStalledResponse: () => {
      setters.setExtensionWorkingState({ message: null, indicator: null, visible: true });
      interaction.recoveryCallbacks.finalizeStalledResponse();
    },
    connectionStatus: shellState.connectionStatus,
    agentStatus: services.agentStatus,
    thoughtExpandedRef: refs.thoughtExpandedRef,
    draftExpandedRef: refs.draftExpandedRef,
    steerQueuedTurnIdRef: refs.steerQueuedTurnIdRef,
    openEditor: services.openEditor,
    setPlannotatorSession: setters.setPlannotatorSession,
  };
}

export function useMainAppOrchestrationComposition(options: UseMainAppOrchestrationCompositionOptions) {
  const {
    routeState,
    searchState,
    shellState,
    timeline,
    interaction,
    paneRuntime,
    refs,
    setters,
    services,
    helpers,
  } = options;

  const showIntentToast = interaction.composeReferenceActions.showIntentToast;

  const timelineViewActions = useTimelineViewActions({
    currentHashtag: searchState.currentHashtag,
    searchQuery: searchState.searchQuery,
    searchOpen: searchState.searchOpen,
    searchScope: searchState.searchScope,
    currentChatJid: routeState.currentChatJid,
    currentRootChatJid: routeState.currentRootChatJid,
    posts: timeline.posts,
    loadPosts: timeline.loadPosts,
    searchPosts: services.searchPosts,
    setCurrentHashtag: searchState.setCurrentHashtag,
    setSearchQuery: searchState.setSearchQuery,
    setSearchOpen: searchState.setSearchOpen,
    setSearchScope: searchState.setSearchScope,
    setPosts: timeline.setPosts,
    setHasMore: timeline.setHasMore,
    preserveTimelineScrollTop: timeline.preserveTimelineScrollTop,
    setRemovingPostIds: setters.setRemovingPostIds,
    deletePost: services.deletePost,
    hasMoreRef: timeline.hasMoreRef,
    loadMoreRef: timeline.loadMoreRef,
  });

  const agentStatusLifecycleBundle = useMainAppLifecycleComposition(
    composeMainAppLifecycleCompositionOptions(options, showIntentToast),
  );

  const isComposeBoxAgentActive = isComposeBoxAgentActiveState(services.isAgentTurnActive, services.agentStatus);

  const actionBundle = useMainAppActionComposition({
    currentChatJid: routeState.currentChatJid,
    followupQueueItemsRef: refs.followupQueueItemsRef,
    dismissedQueueRowIdsRef: refs.dismissedQueueRowIdsRef,
    setFollowupQueueItems: setters.setFollowupQueueItems,
    showIntentToast,
    clearQueuedSteerStateIfStale: interaction.clearQueuedSteerStateIfStale,
    steerAgentQueueItem: services.steerAgentQueueItem,
    removeAgentQueueItem: services.removeAgentQueueItem,
    refreshQueueState: agentStatusLifecycleBundle.agentStatusLifecycle.refreshQueueState,
    refreshActiveChatAgents: agentStatusLifecycleBundle.chatRefreshLifecycle.refreshActiveChatAgents,
    refreshCurrentChatBranches: agentStatusLifecycleBundle.chatRefreshLifecycle.refreshCurrentChatBranches,
    refreshContextUsage: agentStatusLifecycleBundle.agentStatusLifecycle.refreshContextUsage,
    refreshAutoresearchStatus: agentStatusLifecycleBundle.agentStatusLifecycle.refreshAutoresearchStatus,
    currentRootChatJid: routeState.currentRootChatJid,
    isComposeBoxAgentActive,
    setPendingExtensionPanelActions: setters.setPendingExtensionPanelActions,
    stopAutoresearch: services.stopAutoresearch,
    dismissAutoresearch: services.dismissAutoresearch,
    streamSidePrompt: services.streamSidePrompt,
    btwAbortRef: refs.btwAbortRef,
    btwSession: shellState.btwSession,
    setBtwSession: setters.setBtwSession,
    plannotatorAbortRef: refs.plannotatorAbortRef,
    plannotatorSession: shellState.plannotatorSession,
    setPlannotatorSession: setters.setPlannotatorSession,
    openEditor: (shellState as any).openEditor,
    sendAgentMessage: services.sendAgentMessage,
    dismissedLiveWidgetKeysRef: refs.dismissedLiveWidgetKeysRef,
    setFloatingWidget: setters.setFloatingWidget,
    getAgentStatus: services.getAgentStatus,
    getAgentContext: services.getAgentContext,
    getAgentQueueState: services.getAgentQueueState,
    getAgentModels: services.getAgentModels,
    getActiveChatAgents: services.getActiveChatAgents,
    getChatBranches: services.getChatBranches,
    getTimeline: services.getTimeline,
    rawPosts: timeline.rawPosts,
    activeChatAgents: shellState.activeChatAgents,
    currentChatBranches: shellState.currentChatBranches,
    contextUsage: shellState.contextUsage,
    activeModel: shellState.activeModel,
    activeThinkingLevel: shellState.activeThinkingLevel,
    supportsThinking: shellState.supportsThinking,
    isAgentTurnActive: services.isAgentTurnActive,
    chatOnlyMode: routeState.chatOnlyMode,
    navigate: routeState.navigate,
    setWorkspaceOpen: shellState.setWorkspaceOpen,
    currentBranchRecord: shellState.currentBranchRecord,
    renameBranchInFlightRef: refs.renameBranchInFlightRef,
    renameBranchLockUntilRef: refs.renameBranchLockUntilRef,
    getFormLock: helpers.getFormLock,
    setRenameBranchNameDraft: setters.setRenameBranchNameDraft,
    setIsRenameBranchFormOpen: setters.setIsRenameBranchFormOpen,
    setIsRenamingBranch: setters.setIsRenamingBranch,
    renameChatBranch: services.renameChatBranch,
    pruneChatBranch: services.pruneChatBranch,
    purgeChatBranch: services.purgeChatBranch,
    restoreChatBranch: services.restoreChatBranch,
    branchLoaderMode: routeState.branchLoaderMode,
    branchLoaderSourceChatJid: routeState.branchLoaderSourceChatJid,
    forkChatBranch: services.forkChatBranch,
    createRootChatSession: services.createRootChatSession,
    setBranchLoaderState: setters.setBranchLoaderState,
    isWebAppMode: routeState.isWebAppMode,
    setActiveChatAgents: setters.setActiveChatAgents,
    setCurrentChatBranches: setters.setCurrentChatBranches,
    openEditor: services.openEditor,
    tabStripActiveId: services.tabStripActiveId,
    editorInstanceRef: paneRuntime.editorInstanceRef,
    dockInstanceRef: paneRuntime.dockInstanceRef,
    terminalTabPath: services.terminalTabPath,
    tabPaneOverrides: services.tabPaneOverrides,
    buildPaneDetachTransfer: paneRuntime.buildPaneDetachTransfer,
    registerDetachedPaneWindow: paneRuntime.registerDetachedPaneWindow,
    dockVisible: paneRuntime.dockVisible,
    resolveTab: services.resolveTab,
    closeTab: services.closeTab,
    setDockVisible: paneRuntime.setDockVisible,
    editorOpen: services.editorOpen,
    shellElement: refs.appShellRef.current,
    editorWidthRef: refs.editorWidthRef,
    dockHeightRef: refs.dockHeightRef,
    sidebarWidthRef: refs.sidebarWidthRef,
    readStoredNumber: helpers.readStoredNumber,
    hasDockPanes: paneRuntime.hasDockPanes,
    toggleDock: paneRuntime.toggleDock,
    toggleZenMode: paneRuntime.toggleZenMode,
    exitZenMode: paneRuntime.exitZenMode,
    zenMode: paneRuntime.zenMode,
  });

  return buildMainAppOrchestrationResult({
    agentStatusLifecycleBundle,
    actionBundle,
    timelineViewActions,
    isComposeBoxAgentActive,
  });
}
