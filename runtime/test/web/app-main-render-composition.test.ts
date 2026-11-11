import { expect, test } from 'bun:test';

import {
  composeRenderedMainAppOptions,
  deriveSteerQueuedState,
} from '../../web/src/ui/app-main-render-composition.js';

test('deriveSteerQueuedState only marks steering active for the current turn', () => {
  expect(deriveSteerQueuedState({
    steerQueuedTurnId: 'turn-1',
    currentTurnId: 'turn-1',
    agentStatus: null,
  })).toBe(true);

  expect(deriveSteerQueuedState({
    steerQueuedTurnId: 'turn-1',
    currentTurnId: 'turn-2',
    agentStatus: { turn_id: 'turn-2' },
  })).toBe(false);
});

test('composeRenderedMainAppOptions builds final shell options from grouped app namespaces', () => {
  const result = composeRenderedMainAppOptions({
    routeState: {
      branchLoaderMode: false,
      panePopoutMode: true,
      currentChatJid: 'web:default',
      panePopoutPath: '/terminal',
    },
    paneRuntime: {
      hidePanePopoutControls: false,
      panePopoutHasMenuActions: true,
      panePopoutTitle: 'Terminal',
      editorContainerRef: { current: null },
      editorInstanceRef: { current: { getContent: () => 'abc' } },
      hasDockPanes: true,
      dockVisible: true,
      toggleDock: () => {},
      showEditorPaneContainer: true,
      toggleZenMode: () => {},
      zenMode: false,
      dockContainerRef: { current: null },
      openTerminalTab: () => {},
      openVncTab: () => {},
    },
    splitters: { handleSplitterMouseDown: () => {} },
    orchestration: {
      branchPaneActions: {
        closeRenameCurrentBranchForm: () => {},
        handleRenameCurrentBranch: () => {},
        toggleWorkspace: () => {},
      },
      timelineViewActions: { handleSearch: () => {} },
      sidepanelActions: { handleExtensionPanelAction: () => {} },
      followupActions: {
        handleInjectQueuedFollowup: () => {},
        handleRemoveQueuedFollowup: () => {},
        handleMessageResponse: () => {},
      },
      chatRefreshLifecycle: { applyModelState: () => {} },
      isComposeBoxAgentActive: true,
    },
    interaction: {
      composeReferenceActions: { addFileRef: () => {}, removeFileRef: () => {} },
      handlePanelToggle: () => {},
    },
    timeline: {
      posts: [],
      hasMore: false,
      loadMore: () => {},
      loadPosts: () => {},
      scrollToBottom: () => {},
    },
    surface: {
      branchLoaderState: { status: 'idle' },
      appShellRef: { current: null },
      workspaceOpen: true,
      isRenameBranchFormOpen: false,
      renameBranchNameDraft: '',
      renameBranchNameInputRef: { current: null },
      setRenameBranchNameDraft: () => {},
      renameBranchDraftState: { canSubmit: true },
      isRenamingBranch: false,
      isWebAppMode: false,
      currentBranchRecord: null,
      currentChatBranches: [],
      activeSearchScopeLabel: 'Current branch',
      currentHashtag: 'tag',
      searchQuery: 'hello',
      oobePanelState: { kind: 'provider-ready' },
      composePrefillRequest: { token: 'prefill-2', text: '/model' },
      handleOobeSetupProvider: () => {},
      handleOobeShowModelPicker: () => {},
      handleOobeOpenWorkspace: () => {},
      handleDismissProviderMissingOobe: () => {},
      handleCompleteProviderReadyOobe: () => {},
      hasLoadedAgentModels: true,
      agentModelsPayload: { models: ['openai/gpt-4.1'] },
      timelineRef: { current: null },
      agents: {},
      userProfile: { name: 'You' },
      removingPostIds: new Set(),
      extensionStatusPanels: new Map(),
      pendingExtensionPanelActions: new Set(),
      searchOpen: false,
      followupQueueItems: [],
      viewStateRef: { current: {} },
      searchScope: 'current',
      intentToast: null,
      btwSession: null,
      floatingWidget: null,
      fileRefs: [],
      messageRefs: [],
      followupQueueCount: 0,
      activeChatAgents: [],
      connectionStatus: 'connected',
      activeModel: null,
      activeModelUsage: null,
      activeThinkingLevel: null,
      supportsThinking: false,
      contextUsage: null,
      notificationsEnabled: false,
      notificationPermission: 'default',
      handleToggleNotifications: () => {},
      setActiveModel: () => {},
    },
    editorState: {
      editorOpen: true,
      tabStripTabs: [],
      tabStripActiveId: null,
      handleTabActivate: () => {},
      previewTabs: new Set(),
      diffTabs: new Set(),
      handleTabTogglePreview: () => {},
      handleTabToggleDiff: () => {},
      tabPaneOverrides: {},
      handleTabClose: () => {},
      handleTabCloseOthers: () => {},
      handleTabCloseAll: () => {},
      handleTabTogglePin: () => {},
      handleTabEditSource: () => {},
      openEditor: () => {},
    },
    agentState: {
      agentStatus: { turn_id: 'turn-1' },
      agentDraft: null,
      agentPlan: null,
      agentThought: null,
      pendingRequest: null,
      currentTurnId: 'turn-1',
      steerQueuedTurnId: 'turn-1',
      setPendingRequest: () => {},
      pendingRequestRef: { current: null },
      isCompactionStatus: () => false,
    },
    helpers: {
      formatBranchPickerLabel: () => 'label',
      isIOSDevice: () => false,
      terminalTabPath: '/terminal',
    },
  });

  expect(result.branchLoaderMode).toBe(false);
  expect(result.panePopoutMode).toBe(true);
  expect(result.mainShellOptions.workspaceOpen).toBe(true);
  expect(result.mainShellOptions.connectionStatus).toBe('connected');
  expect(result.mainShellOptions.steerQueued).toBe(true);
  expect(result.mainShellOptions.currentHashtag).toBe('tag');
  expect(result.mainShellOptions.searchQuery).toBe('hello');
  expect(result.mainShellOptions.oobePanelState).toEqual({ kind: 'provider-ready' });
  expect(result.mainShellOptions.composePrefillRequest).toEqual({ token: 'prefill-2', text: '/model' });
  expect(result.mainShellOptions.agentModelsPayload).toEqual({ models: ['openai/gpt-4.1'] });
  expect(typeof result.mainShellOptions.openEditor).toBe('function');
  expect(typeof result.mainShellOptions.openTerminalTab).toBe('function');
  expect(typeof result.mainShellOptions.openVncTab).toBe('function');
  expect(typeof result.mainShellOptions.handleToggleNotifications).toBe('function');
  expect(result.mainShellOptions.TERMINAL_TAB_PATH).toBe('/terminal');
});
