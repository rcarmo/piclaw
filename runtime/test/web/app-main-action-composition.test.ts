import { expect, test } from 'bun:test';

import {
  composeBranchPaneActionOptions,
  composeFollowupActionOptions,
  composeShortcutOptions,
  composeSidepanelActionOptions,
} from '../../web/src/ui/app-main-action-composition.js';

test('composeFollowupActionOptions preserves queue refresh wiring', () => {
  const showIntentToast = () => {};
  const refreshQueueState = async () => {};

  const result = composeFollowupActionOptions({
    currentChatJid: 'chat-1',
    followupQueueItemsRef: { current: [] },
    dismissedQueueRowIdsRef: { current: new Set() },
    setFollowupQueueItems: () => {},
    showIntentToast,
    clearQueuedSteerStateIfStale: () => {},
    steerAgentQueueItem: async () => null,
    removeAgentQueueItem: async () => null,
    refreshQueueState,
    refreshActiveChatAgents: async () => {},
    refreshCurrentChatBranches: async () => {},
    refreshContextUsage: async () => {},
    refreshAutoresearchStatus: async () => {},
  });

  expect(result.currentChatJid).toBe('chat-1');
  expect(result.showIntentToast).toBe(showIntentToast);
  expect(result.refreshQueueState).toBe(refreshQueueState);
});

test('composeSidepanelActionOptions preserves widget/dashboard and btw dependencies', () => {
  const handleMessageResponse = () => {};
  const result = composeSidepanelActionOptions({
    currentChatJid: 'chat-1',
    currentRootChatJid: 'root-1',
    isComposeBoxAgentActive: true,
    setPendingExtensionPanelActions: () => {},
    refreshAutoresearchStatus: async () => {},
    stopAutoresearch: async () => {},
    dismissAutoresearch: async () => {},
    streamSidePrompt: async () => null,
    btwAbortRef: { current: null },
    btwSession: { status: 'success' },
    setBtwSession: () => {},
    sendAgentMessage: async () => null,
    dismissedLiveWidgetKeysRef: { current: new Set() },
    setFloatingWidget: () => {},
    getAgentStatus: async () => null,
    getAgentContext: async () => null,
    getAgentQueueState: async () => [],
    getAgentModels: async () => null,
    getActiveChatAgents: async () => [],
    getChatBranches: async () => [],
    getTimeline: async () => [],
    rawPosts: [{ id: 'post-1' }],
    activeChatAgents: [{ chat_jid: 'chat-1' }],
    currentChatBranches: [{ chat_jid: 'chat-1' }],
    contextUsage: { percent: 30 },
    followupQueueItemsRef: { current: [{ row_id: 1 }] },
    activeModel: 'gpt',
    activeThinkingLevel: 'high',
    supportsThinking: true,
    isAgentTurnActive: true,
    showIntentToast: () => {},
    handleMessageResponse,
  });

  expect(result.currentRootChatJid).toBe('root-1');
  expect(result.rawPosts).toEqual([{ id: 'post-1' }]);
  expect(result.handleMessageResponse).toBe(handleMessageResponse);
  expect(result.activeThinkingLevel).toBe('high');
});

test('composeBranchPaneActionOptions and composeShortcutOptions preserve pane controls', () => {
  const branchResult = composeBranchPaneActionOptions({
    currentChatJid: 'chat-1',
    navigate: () => {},
    setWorkspaceOpen: () => {},
    currentBranchRecord: { chat_jid: 'chat-1' },
    renameBranchInFlightRef: { current: false },
    renameBranchLockUntilRef: { current: 0 },
    getFormLock: () => 0,
    setRenameBranchNameDraft: () => {},
    setIsRenameBranchFormOpen: () => {},
    setIsRenamingBranch: () => {},
    renameChatBranch: async () => null,
    refreshActiveChatAgents: async () => {},
    refreshCurrentChatBranches: async () => {},
    showIntentToast: () => {},
    currentChatBranches: [],
    activeChatAgents: [],
    pruneChatBranch: async () => null,
    purgeChatBranch: async () => null,
    restoreChatBranch: async () => null,
    branchLoaderMode: false,
    branchLoaderSourceChatJid: 'chat-1',
    forkChatBranch: async () => null,
    createRootChatSession: async () => null,
    setBranchLoaderState: () => {},
    currentRootChatJid: 'root-1',
    isWebAppMode: false,
    getActiveChatAgents: async () => [],
    getChatBranches: async () => [],
    setActiveChatAgents: () => {},
    setCurrentChatBranches: () => {},
    openEditor: () => {},
    activateTab: () => {},
    tabStripActiveId: '/terminal',
    editorInstanceRef: { current: null },
    dockInstanceRef: { current: null },
    terminalTabPath: '/terminal',
    dockVisible: true,
    resolveTab: () => ({ dirty: false }),
    closeTab: () => {},
    setDockVisible: () => {},
    editorOpen: true,
    shellElement: null,
    editorWidthRef: { current: 0 },
    dockHeightRef: { current: 0 },
    sidebarWidthRef: { current: 0 },
    readStoredNumber: () => 280,
  });
  const shortcutResult = composeShortcutOptions({
    hasDockPanes: true,
    toggleDock: () => {},
    toggleZenMode: () => {},
    exitZenMode: () => {},
    zenMode: true,
  });

  expect(branchResult.terminalTabPath).toBe('/terminal');
  expect(branchResult.currentRootChatJid).toBe('root-1');
  expect(typeof branchResult.resolveTab).toBe('function');
  expect(shortcutResult.hasDockPanes).toBe(true);
  expect(shortcutResult.zenMode).toBe(true);
});
