import { expect, mock, test } from 'bun:test';

import { QueuedFollowupStack } from '../../web/src/components/compose-box.js';
import { ChatSurface } from '../../web/src/components/chat-surface.js';
import { SessionsSidebar } from '../../web/src/components/sessions-sidebar.js';
import { SystemMetersHud } from '../../web/src/components/system-meters-hud.js';
import { WorkspaceExplorer } from '../../web/src/components/workspace-explorer.js';
import {
  buildMainShellClassName,
  extractPostedUserMessageId,
  handleComposePost,
  renderMainShell,
  scrollToPostedTimelineMessage,
} from '../../web/src/ui/app-main-shell-render.js';

test('buildMainShellClassName composes workspace/editor/chat/zen modifiers', () => {
  expect(buildMainShellClassName({
    workspaceOpen: true,
    editorOpen: false,
    chatOnlyMode: false,
    zenMode: false,
  })).toBe('app-shell');

  expect(buildMainShellClassName({
    workspaceOpen: false,
    editorOpen: true,
    chatOnlyMode: true,
    zenMode: true,
  })).toBe('app-shell workspace-collapsed editor-open chat-only zen-mode');
});

test('renderMainShell gives an open workspace a dismissible drawer backdrop', () => {
  const toggleWorkspace = mock(() => {});
  const tree = renderMainShell(createMainShellRenderOptions({
    chatOnlyMode: false,
    workspaceOpen: true,
    toggleWorkspace,
  }));
  let backdrop: any = null;
  let toggle: any = null;

  walkVNodes(tree, (node) => {
    if (node.props?.class === 'workspace-drawer-backdrop') backdrop = node;
    if (String(node.props?.class || '').split(/\s+/).includes('workspace-toggle-tab')) toggle = node;
  });

  expect(backdrop).toBeTruthy();
  expect(backdrop.type).toBe('div');
  expect(backdrop.props['aria-hidden']).toBe('true');
  expect(backdrop.props.onClick).toBe(toggleWorkspace);
  expect(toggle.props['aria-expanded']).toBe('true');
});

test('renderMainShell orders panes as sessions | chat | file tree | editor and keeps pane markup', () => {
  const tree = renderMainShell(createMainShellRenderOptions({
    chatOnlyMode: false,
    workspaceOpen: true,
    editorOpen: true,
    showEditorPaneContainer: true,
  }));
  const order: string[] = [];
  let metersInsideContainer = false;
  walkVNodes(tree, (node) => {
    const classes = String(node.props?.class || '').split(/\s+/);
    if (node.type === SessionsSidebar) order.push('sessions');
    if (node.type === WorkspaceExplorer) order.push('tree');
    for (const name of ['container', 'editor-splitter', 'editor-pane-container', 'workspace-splitter']) {
      if (classes.includes(name)) order.push(name);
    }
    if (classes.includes('container')) walkVNodes(node.props?.children, (child) => { if (child.type === SystemMetersHud) metersInsideContainer = true; });
  });
  expect(order).toEqual(['sessions', 'container', 'workspace-splitter', 'tree', 'editor-splitter', 'editor-pane-container']);
  expect(metersInsideContainer).toBe(true);
});

test('renderMainShell exposes the right-hand dividers as keyboard separators', () => {
  const tree = renderMainShell(createMainShellRenderOptions({ chatOnlyMode: false, editorOpen: true, showEditorPaneContainer: true }));
  const dividers: any[] = [];
  walkVNodes(tree, (node) => {
    const classes = String(node.props?.class || '').split(/\s+/);
    if (classes.includes('editor-splitter') || classes.includes('workspace-splitter')) dividers.push(node.props);
  });
  expect(dividers).toHaveLength(2);
  for (const props of dividers) {
    expect(props.role).toBe('separator');
    expect(props.tabIndex).toBe('0');
    expect(typeof props.onKeyDown).toBe('function');
  }
});

test('renderMainShell omits the sessions pane in chat-only and zen modes', () => {
  for (const overrides of [{ chatOnlyMode: true }, { chatOnlyMode: false, zenMode: true }]) {
    let sessions = 0;
    walkVNodes(renderMainShell(createMainShellRenderOptions(overrides)), (node) => { if (node.type === SessionsSidebar) sessions += 1; });
    expect(sessions).toBe(0);
  }
});

test('renderMainShell omits the workspace drawer backdrop in zen mode', () => {
  const tree = renderMainShell(createMainShellRenderOptions({
    chatOnlyMode: false,
    workspaceOpen: true,
    editorOpen: true,
    zenMode: true,
  }));
  let backdropCount = 0;

  walkVNodes(tree, (node) => {
    if (node.props?.class === 'workspace-drawer-backdrop') backdropCount += 1;
  });

  expect(backdropCount).toBe(0);
});

test('extractPostedUserMessageId prefers user_message.id and falls back to row_id', () => {
  expect(extractPostedUserMessageId({ user_message: { id: 42 }, row_id: 7 })).toBe(42);
  expect(extractPostedUserMessageId({ row_id: 7 })).toBe(7);
  expect(extractPostedUserMessageId({})).toBeNull();
});

test('handleComposePost scrolls to the posted user message without reloading the timeline', () => {
  const scrollToBottom = mock(() => {});
  const scrollPostedMessage = mock(() => {});

  handleComposePost({
    response: { user_message: { id: 99 } },
    viewStateRef: { current: { searchQuery: null, searchOpen: false } },
    scrollToBottom,
    scrollPostedMessage,
  });

  expect(scrollPostedMessage).toHaveBeenCalledWith(99);
  expect(scrollToBottom).not.toHaveBeenCalled();
});

test('handleComposePost falls back to scrolling to the bottom when there is no posted row id', () => {
  const scrollToBottom = mock(() => {});
  const scrollPostedMessage = mock(() => {});

  handleComposePost({
    response: { command: { type: 'model' } },
    viewStateRef: { current: { searchQuery: null, searchOpen: false } },
    scrollToBottom,
    scrollPostedMessage,
  });

  expect(scrollToBottom).toHaveBeenCalledTimes(1);
  expect(scrollPostedMessage).not.toHaveBeenCalled();
});

function walkVNodes(node: any, visit: (entry: any) => void) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) walkVNodes(child, visit);
    return;
  }
  if (typeof node !== 'object') return;
  if (!('type' in node) || !('props' in node)) return;

  visit(node);
  walkVNodes((node as any).props?.children, visit);
}

function createMainShellRenderOptions(overrides: Record<string, unknown> = {}) {
  const noop = () => {};
  return {
    appShellRef: { current: null },
    workspaceOpen: false,
    editorOpen: false,
    chatOnlyMode: true,
    zenMode: false,
    isRenameBranchFormOpen: false,
    closeRenameCurrentBranchForm: noop,
    handleRenameCurrentBranch: noop,
    renameBranchNameDraft: '',
    renameBranchNameInputRef: { current: null },
    setRenameBranchNameDraft: noop,
    renameBranchDraftState: { kind: 'info', message: '', canSubmit: false },
    isRenamingBranch: false,
    addFileRef: noop,
    addFolderRef: noop,
    openEditor: noop,
    openTerminalTab: noop,
    openVncTab: noop,
    hasDockPanes: false,
    toggleDock: noop,
    dockVisible: false,
    handleSplitterMouseDown: noop,
    handleSplitterKeyDown: noop,
    handleSplitterDoubleClick: noop,
    handleSplitterTouchStart: noop,
    showEditorPaneContainer: false,
    tabStripTabs: [],
    tabStripActiveId: null,
    handleTabActivate: noop,
    handleTabClose: noop,
    handleTabCloseOthers: noop,
    handleTabCloseAll: noop,
    handleTabTogglePin: noop,
    handleTabTogglePreview: noop,
    handleTabToggleDiff: noop,
    handleTabEditSource: noop,
    handleReattachPane: noop,
    previewTabs: new Set(),
    diffTabs: new Set(),
    tabPaneOverrides: new Map(),
    toggleZenMode: noop,
    handlePopOutPane: noop,
    isWebAppMode: false,
    editorContainerRef: { current: null },
    editorInstanceRef: { current: null },
    detachedTabs: [],
    activeDetachedTab: null,
    detachedDockPane: null,
    handleDockSplitterMouseDown: noop,
    handleDockSplitterTouchStart: noop,
    TERMINAL_TAB_PATH: 'terminal',
    dockContainerRef: { current: null },
    handleEditorSplitterMouseDown: noop,
    handleEditorSplitterKeyDown: noop,
    handleEditorSplitterDoubleClick: noop,
    handleEditorSplitterTouchStart: noop,
    searchQuery: null,
    isIOSDevice: () => false,
    currentBranchRecord: null,
    currentChatJid: 'web:default',
    currentChatBranches: [],
    handleBranchPickerChange: noop,
    formatBranchPickerLabel: () => '',
    openRenameCurrentBranchForm: noop,
    handlePruneCurrentBranch: noop,
    handlePurgeArchivedBranch: noop,
    currentHashtag: null,
    handleBackToTimeline: noop,
    activeSearchScopeLabel: 'Current chat',
    oobePanelState: null,
    composePrefillRequest: null,
    requestComposePrefill: noop,
    handleOobeSetupProvider: noop,
    handleOobeShowModelPicker: noop,
    handleOobeOpenWorkspace: noop,
    handleDismissProviderMissingOobe: noop,
    handleCompleteProviderReadyOobe: noop,
    posts: [],
    isMainTimelineView: true,
    hasMore: false,
    loadMore: noop,
    timelineRef: { current: null },
    handleHashtagClick: noop,
    addMessageRef: noop,
    scrollToMessage: noop,
    openFileFromPill: noop,
    openTimelineFileFromPill: noop,
    handleDeletePost: noop,
    handleOpenFloatingWidget: noop,
    agents: [],
    userProfile: null,
    removingPostIds: new Set(),
    agentStatus: null,
    isCompactionStatus: () => false,
    agentDraft: null,
    agentPlan: null,
    agentThought: null,
    pendingRequest: null,
    intentToast: null,
    currentTurnId: null,
    steerQueued: null,
    handlePanelToggle: noop,
    btwSession: null,
    closeBtwPanel: noop,
    handleBtwRetry: noop,
    handleBtwInject: noop,
    floatingWidget: null,
    handleCloseFloatingWidget: noop,
    handleFloatingWidgetEvent: noop,
    attachmentPreview: null,
    setAttachmentPreview: noop,
    extensionStatusPanels: new Map(),
    pendingExtensionPanelActions: new Set(),
    handleExtensionPanelAction: noop,
    searchOpen: false,
    followupQueueItems: [],
    handleInjectQueuedFollowup: noop,
    handleRemoveQueuedFollowup: noop,
    handleMoveQueuedFollowup: noop,
    viewStateRef: { current: null },
    loadPosts: noop,
    scrollToBottom: noop,
    searchScope: 'current',
    handleSearch: noop,
    handleSearchScopeChange: noop,
    setSearchScope: noop,
    enterSearchMode: noop,
    exitSearchMode: noop,
    fileRefs: [],
    removeFileRef: noop,
    clearFileRefs: noop,
    setFileRefsFromCompose: noop,
    folderRefs: [],
    removeFolderRef: noop,
    clearFolderRefs: noop,
    setFolderRefsFromCompose: noop,
    messageRefs: [],
    removeMessageRef: noop,
    clearMessageRefs: noop,
    setMessageRefsFromCompose: noop,
    handleCreateSessionFromCompose: noop,
    handleCreateRootSessionFromCompose: noop,
    handleRestoreBranch: noop,
    attachActiveEditorFile: noop,
    followupQueueCount: 0,
    handleBtwIntercept: noop,
    handleMessageResponse: noop,
    handleComposeSubmitError: noop,
    isComposeBoxAgentActive: false,
    activeChatAgents: [],
    connectionStatus: 'connected',
    stateAccessFailed: false,
    activeModel: null,
    agentModelsPayload: null,
    activeModelUsage: null,
    activeThinkingLevel: null,
    supportsThinking: false,
    contextUsage: null,
    extensionWorkingState: null,
    notificationsEnabled: false,
    notificationPermission: 'default',
    handleToggleNotifications: noop,
    setActiveModel: noop,
    applyModelState: noop,
    setPendingRequest: noop,
    pendingRequestRef: { current: null },
    toggleWorkspace: noop,
    ...overrides,
  };
}

test('renderMainShell passes queue controls through ChatSurface and does not render a top-level queue stack', () => {
  const followupQueueItems = [{ row_id: 7, content: 'queued item' }];
  const handleRemoveQueuedFollowup = mock(() => {});

  const tree = renderMainShell(createMainShellRenderOptions({
    followupQueueItems,
    handleRemoveQueuedFollowup,
  }));

  let chatSurfaceVNode: any = null;
  let topLevelQueueStackCount = 0;

  walkVNodes(tree, (node) => {
    if (node.type === ChatSurface) chatSurfaceVNode = node;
    if (node.type === QueuedFollowupStack) topLevelQueueStackCount += 1;
  });

  expect(chatSurfaceVNode).toBeTruthy();
  expect(chatSurfaceVNode.props.composeProps.followupQueueItems).toBe(followupQueueItems);
  expect(chatSurfaceVNode.props.composeProps.onRemoveQueuedFollowup).toBe(handleRemoveQueuedFollowup);
  expect(chatSurfaceVNode.props.composeProps.showQueueStack).toBeUndefined();
  expect(topLevelQueueStackCount).toBe(0);
});

test('handleComposePost does nothing while search is active', () => {
  const scrollToBottom = mock(() => {});
  const scrollPostedMessage = mock(() => {});

  handleComposePost({
    response: { user_message: { id: 99 } },
    viewStateRef: { current: { searchQuery: 'foo', searchOpen: true } },
    scrollToBottom,
    scrollPostedMessage,
  });

  expect(scrollToBottom).not.toHaveBeenCalled();
  expect(scrollPostedMessage).not.toHaveBeenCalled();
});

test('scrollToPostedTimelineMessage waits for the existing row and highlights it without reloading', () => {
  const element = {
    scrollIntoView: mock(() => {}),
    classList: {
      add: mock(() => {}),
      remove: mock(() => {}),
    },
  } as any;
  let reveals = 0;
  // Simulate an acknowledgement before the row enters the rendered post list:
  // only a later reveal can move the virtual window and mount it.
  const requestReveal = mock(() => { reveals += 1; });
  const getElementById = mock((id: string) => id === 'post-77' && reveals >= 3 ? element : null);
  const rafQueue: Array<() => void> = [];
  const timeoutQueue: Array<() => void> = [];
  const scrollToBottom = mock(() => {});

  scrollToPostedTimelineMessage({
    id: 77,
    scrollToBottom,
    requestReveal,
    getElementById,
    scheduleRaf: (callback) => { rafQueue.push(callback); },
    scheduleTimeout: (callback, delayMs) => {
      if (delayMs === 2000) {
        callback();
        return;
      }
      timeoutQueue.push(callback);
    },
    maxAttempts: 4,
  });

  while (rafQueue.length > 0 || timeoutQueue.length > 0) {
    const raf = rafQueue.shift();
    if (raf) raf();
    const timeout = timeoutQueue.shift();
    if (timeout) timeout();
  }

  expect(getElementById).toHaveBeenCalled();
  expect(requestReveal).toHaveBeenCalledTimes(3);
  expect(element.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  expect(element.classList.add).toHaveBeenCalledWith('post-highlight');
  expect(element.classList.remove).toHaveBeenCalledWith('post-highlight');
  expect(scrollToBottom).not.toHaveBeenCalled();
});
