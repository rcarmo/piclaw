import { expect, test } from 'bun:test';

import {
  buildMainAppOrchestrationResult,
  composeMainAppLifecycleCompositionOptions,
  isComposeBoxAgentActiveState,
} from '../../web/src/ui/app-main-orchestration-composition.js';

test('isComposeBoxAgentActiveState stays active for either in-flight turn or live agent status', () => {
  expect(isComposeBoxAgentActiveState(true, null)).toBe(true);
  expect(isComposeBoxAgentActiveState(false, { type: 'active' })).toBe(true);
  expect(isComposeBoxAgentActiveState(false, null)).toBe(false);
});

test('buildMainAppOrchestrationResult merges lifecycle/action bundles with timeline actions', () => {
  const result = buildMainAppOrchestrationResult({
    agentStatusLifecycleBundle: {
      agentStatusLifecycle: { refreshQueueState: () => {} },
      chatRefreshLifecycle: { applyModelState: () => {} },
      viewRefreshLifecycle: { refreshCurrentView: () => {} },
    },
    actionBundle: {
      followupActions: { handleMessageResponse: () => {} },
      sidepanelActions: { handleExtensionPanelAction: () => {} },
      branchPaneActions: { toggleWorkspace: () => {} },
    },
    timelineViewActions: { handleSearch: () => {} },
    isComposeBoxAgentActive: true,
  });

  expect(typeof result.agentStatusLifecycle.refreshQueueState).toBe('function');
  expect(typeof result.chatRefreshLifecycle.applyModelState).toBe('function');
  expect(typeof result.followupActions.handleMessageResponse).toBe('function');
  expect(typeof result.timelineViewActions.handleSearch).toBe('function');
  expect(result.isComposeBoxAgentActive).toBe(true);
});

test('composeMainAppLifecycleCompositionOptions forwards model bootstrap setters', () => {
  const noop = () => {};
  const setAgentModelsPayload = () => {};
  const setHasLoadedAgentModels = () => {};
  const options: any = {
    routeState: {
      currentChatJid: 'chat-1',
      currentRootChatJid: 'root-1',
      navigate: noop,
      branchLoaderMode: false,
      branchLoaderSourceChatJid: 'chat-1',
      isWebAppMode: true,
    },
    searchState: {
      currentHashtag: null,
      setCurrentHashtag: noop,
      searchQuery: null,
      setSearchQuery: noop,
      searchOpen: false,
      setSearchOpen: noop,
      searchScope: 'current',
      setSearchScope: noop,
    },
    shellState: {
      activeChatAgents: [],
      currentChatBranches: [],
      currentBranchRecord: null,
      contextUsage: null,
      activeModel: null,
      activeThinkingLevel: null,
      supportsThinking: false,
      activeModelUsage: null,
      connectionStatus: 'connected',
      notificationsEnabled: false,
      notificationPermission: 'default',
      workspaceOpen: false,
      setWorkspaceOpen: noop,
      userProfile: null,
      agents: {},
      removingPostIds: new Set(),
      btwSession: null,
    },
    timeline: {
      posts: [],
      loadPosts: async () => [],
      setPosts: noop,
      setHasMore: noop,
      scrollToBottom: noop,
      scrollToBottomRef: { current: null },
      hasMoreRef: { current: false },
      loadMoreRef: { current: null },
      refreshTimeline: async () => {},
      preserveTimelineScrollTop: noop,
    },
    interaction: {
      clearQueuedSteerStateIfStale: noop,
      clearAgentRunState: noop,
      setActiveTurn: noop,
      noteAgentActivity: noop,
      showLastActivity: noop,
      clearLastActivityFlag: noop,
      applyBranding: noop,
      snapshotCurrentChatPaneState: () => ({}),
      restoreChatPaneState: noop,
      notifyForFinalResponse: noop,
      composeReferenceActions: { showIntentToast: noop, scrollToMessage: async () => {} },
      recoveryCallbacks: { removeStalledPost: noop, finalizeStalledResponse: noop },
    },
    paneRuntime: {
      refreshActiveEditorFromWorkspace: async () => {},
    },
    refs: {
      activeChatJidRef: { current: 'chat-1' },
      queueRefreshGenRef: { current: 0 },
      dismissedQueueRowIdsRef: { current: new Set() },
      wasAgentActiveRef: { current: false },
      viewStateRef: { current: {} },
      agentStatusRef: { current: null },
      pendingRequestRef: { current: null },
      thoughtBufferRef: { current: '' },
      draftBufferRef: { current: '' },
      isAgentRunningRef: { current: false },
      currentTurnIdRef: { current: null },
      silentRecoveryRef: { current: { inFlight: false, lastAttemptAt: 0, turnId: null } },
      lastAgentEventRef: { current: 0 },
      lastSilenceNoticeRef: { current: 0 },
      staleUiVersionRef: { current: null },
      staleUiReloadScheduledRef: { current: false },
      hasConnectedOnceRef: { current: true },
      sidebarWidthRef: { current: 320 },
      appShellRef: { current: null },
      agentsRef: { current: {} },
      paneStateOwnerChatJidRef: { current: 'chat-1' },
      chatPaneStateByChatRef: { current: new Map() },
      dismissedLiveWidgetKeysRef: { current: new Set() },
      draftThrottleRef: { current: null },
      thoughtThrottleRef: { current: null },
      followupQueueItemsRef: { current: [] },
      lastAgentResponseRef: { current: null },
      thoughtExpandedRef: { current: false },
      draftExpandedRef: { current: false },
      steerQueuedTurnIdRef: { current: null },
    },
    setters: {
      setFollowupQueueItems: noop,
      setContextUsage: noop,
      setExtensionStatusPanels: noop,
      setPendingExtensionPanelActions: noop,
      setAgentStatus: noop,
      setAgentDraft: noop,
      setAgentPlan: noop,
      setAgentThought: noop,
      setPendingRequest: noop,
      setConnectionStatus: noop,
      setAgents: noop,
      setUserProfile: noop,
      setActiveChatAgents: noop,
      setCurrentChatBranches: noop,
      setActiveModel: noop,
      setActiveThinkingLevel: noop,
      setSupportsThinking: noop,
      setActiveModelUsage: noop,
      setAgentModelsPayload,
      setHasLoadedAgentModels,
      setFloatingWidget: noop,
      setSteerQueuedTurnId: noop,
      setRemovingPostIds: noop,
    },
    services: {
      getAgentQueueState: async () => [],
      getAgentContext: async () => null,
      getAutoresearchStatus: async () => null,
      getAgentStatus: async () => null,
      silenceRefreshMs: 2500,
      silenceWarningMs: 5000,
      silenceFinalizeMs: 10000,
      isCompactionStatus: () => false,
      currentAppAssetVersion: 'web-1',
      tabStoreHasUnsaved: () => false,
      getAgents: async () => ({}),
      getAgentModels: async () => ({}),
      getActiveChatAgents: async () => [],
      getChatBranches: async () => [],
      searchPosts: async () => ({ results: [] }),
      agentStatus: null,
    },
    helpers: {
      getFormLock: () => 0,
      readStoredNumber: () => 320,
    },
  };

  const result = composeMainAppLifecycleCompositionOptions(options, noop);

  expect(result.setAgentModelsPayload).toBe(setAgentModelsPayload);
  expect(result.setHasLoadedAgentModels).toBe(setHasLoadedAgentModels);
});
