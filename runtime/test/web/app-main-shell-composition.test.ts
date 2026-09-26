import { expect, test } from 'bun:test';

import { composeMainAppShellOptions } from '../../web/src/ui/app-main-shell-composition.js';

test('composeMainAppShellOptions composes pane-popout and main-shell payloads from grouped state', () => {
  const addFileRef = () => {};
  const removeFileRef = () => {};
  const result = composeMainAppShellOptions({
    routing: {
      branchLoaderMode: false,
      panePopoutMode: true,
      branchLoaderState: { status: 'idle' },
    },
    paneRuntime: {
      hidePanePopoutControls: false,
      panePopoutHasMenuActions: true,
      panePopoutTitle: 'Terminal',
      editorContainerRef: { current: null },
      editorInstanceRef: { current: { getContent: () => 'abc', onContentChange: (cb: (content: string) => void) => { cb('abc'); return () => {}; } } },
      hasDockPanes: true,
      dockVisible: true,
      toggleDock: () => {},
      showEditorPaneContainer: true,
      zenMode: false,
      toggleZenMode: () => {},
      dockContainerRef: { current: null },
    },
    splitters: {
      handleSplitterMouseDown: () => {},
    },
    branchPaneActions: {
      closeRenameCurrentBranchForm: () => {},
      handleRenameCurrentBranch: () => {},
      handleBranchPickerChange: () => {},
      toggleWorkspace: () => {},
    },
    timelineViewActions: {
      handleHashtagClick: () => {},
      isMainTimelineView: true,
    },
    composeReferenceActions: { addFileRef, removeFileRef } as any,
    sidepanelActions: {
      handleExtensionPanelAction: () => {},
    },
    shellState: {
      appShellRef: { current: null },
      workspaceOpen: true,
      editorOpen: true,
      chatOnlyMode: false,
      isRenameBranchFormOpen: false,
      renameBranchNameDraft: '',
      renameBranchNameInputRef: { current: null },
      setRenameBranchNameDraft: () => {},
      renameBranchDraftState: { canSubmit: true },
      isRenamingBranch: false,
      isWebAppMode: false,
      TERMINAL_TAB_PATH: '/terminal',
      isIOSDevice: () => false,
      currentBranchRecord: null,
      currentChatJid: 'web:default',
      currentChatBranches: [],
      formatBranchPickerLabel: () => 'label',
      activeSearchScopeLabel: 'Current branch',
      currentHashtag: 'tag',
      searchQuery: 'hello',
      oobePanelState: { kind: 'provider-missing' },
      composePrefillRequest: { token: 'prefill-1', text: '/login' },
      handleOobeSetupProvider: () => {},
      handleOobeShowModelPicker: () => {},
      handleOobeOpenWorkspace: () => {},
      handleDismissProviderMissingOobe: () => {},
      handleCompleteProviderReadyOobe: () => {},
      posts: [],
      hasMore: false,
      loadMore: () => {},
      timelineRef: { current: null },
      agents: {},
      userProfile: { name: 'You' },
      removingPostIds: new Set(),
      extensionStatusPanels: new Map(),
      pendingExtensionPanelActions: new Set(),
      searchOpen: false,
      followupQueueItems: [],
      viewStateRef: { current: {} },
      loadPosts: () => {},
      scrollToBottom: () => {},
      searchScope: 'current',
      tabStripTabs: [],
      tabStripActiveId: null,
      handleTabActivate: () => {},
      previewTabs: new Set(),
      diffTabs: new Set(),
      handleTabTogglePreview: () => {},
      handleTabToggleDiff: () => {},
      panePopoutPath: '/terminal',
      tabPaneOverrides: new Map(),
      handleTabClose: () => {},
      handleTabCloseOthers: () => {},
      handleTabCloseAll: () => {},
      handleTabTogglePin: () => {},
      handleTabEditSource: () => {},
      openEditor: () => {},
      openTerminalTab: () => {},
      openVncTab: () => {},
    },
    agentState: {
      pendingRequest: null,
      setPendingRequest: () => {},
      pendingRequestRef: { current: null },
    },
    composeState: {
      addFileRef: () => { throw new Error('legacy compose state overwrote typed action'); },
      fileRefs: [],
      messageRefs: [],
      followupQueueCount: 0,
    },
    modelState: {
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
      applyModelState: () => {},
    },
  });

  expect(result.branchLoaderMode).toBe(false);
  expect(result.panePopoutMode).toBe(true);
  expect(result.panePopoutOptions.panePopoutTitle).toBe('Terminal');
  let previewContent = '';
  const unsubscribe = result.panePopoutOptions.subscribePaneContentChange((content: string) => { previewContent = content; });
  expect(previewContent).toBe('abc');
  expect(typeof unsubscribe).toBe('function');
  expect(result.mainShellOptions.workspaceOpen).toBe(true);
  expect(result.mainShellOptions.addFileRef).toBe(addFileRef);
  expect(result.mainShellOptions.removeFileRef).toBe(removeFileRef);
  expect(result.mainShellOptions.connectionStatus).toBe('connected');
  expect(result.mainShellOptions.currentHashtag).toBe('tag');
  expect(result.mainShellOptions.searchQuery).toBe('hello');
  expect(result.mainShellOptions.oobePanelState).toEqual({ kind: 'provider-missing' });
  expect(result.mainShellOptions.composePrefillRequest).toEqual({ token: 'prefill-1', text: '/login' });
  expect(typeof result.mainShellOptions.openEditor).toBe('function');
  expect(typeof result.mainShellOptions.openTerminalTab).toBe('function');
  expect(typeof result.mainShellOptions.openVncTab).toBe('function');
  expect(typeof result.mainShellOptions.handleToggleNotifications).toBe('function');
  expect(typeof result.mainShellOptions.toggleWorkspace).toBe('function');
});
