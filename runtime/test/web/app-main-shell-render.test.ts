import { beforeEach, expect, mock, test } from 'bun:test';

import { html } from '../../web/src/vendor/preact-htm.js';
import { AgentRequestModal, AgentStatus } from '../../web/src/components/status.js';
import { ComposeBox, QueuedFollowupStack } from '../../web/src/components/compose-box.js';
import { SettingsDialogLoader } from '../../web/src/components/settings-dialog-loader.js';
import { SystemMetersHud } from '../../web/src/components/system-meters-hud.js';
import { TabStrip } from '../../web/src/components/tab-strip.js';
import { Timeline } from '../../web/src/components/timeline.js';
import { TimelineMenu } from '../../web/src/components/timeline-menu.js';
import { TimelineQuickActions } from '../../web/src/components/timeline-quick-actions.js';
import { WorkspaceExplorer } from '../../web/src/components/workspace-explorer.js';
import { registerAppShellSurfaces } from '../../web/src/ui/app-shell-builtins.js';
import {
  listShellSurfaces,
  registerShellSurface,
  resetShellSurfaceRegistryForTests,
  setShellSurfaceVisible,
} from '../../web/src/ui/shell-surface-registry.js';
import {
  buildMainShellClassName,
  extractPostedUserMessageId,
  handleComposePost,
  renderMainShell,
  scrollToPostedTimelineMessage,
} from '../../web/src/ui/app-main-shell-render.js';

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

beforeEach(() => {
  resetShellSurfaceRegistryForTests();
  globalThis.localStorage = createMemoryStorage();
});

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

function walkVNodes(node: any, visit: (entry: any, parent: any | null) => void, parent: any | null = null) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) walkVNodes(child, visit, parent);
    return;
  }
  if (typeof node !== 'object') return;
  if (!('type' in node) || !('props' in node)) return;

  visit(node, parent);
  walkVNodes((node as any).props?.children, visit, node);
}

function findVNode(tree: any, type: any): { node: any; parent: any | null } | null {
  let match: { node: any; parent: any | null } | null = null;
  walkVNodes(tree, (node, parent) => {
    if (!match && node.type === type) match = { node, parent };
  });
  return match;
}

function findVNodeByClass(tree: any, className: string): { node: any; parent: any | null } | null {
  let match: { node: any; parent: any | null } | null = null;
  walkVNodes(tree, (node, parent) => {
    if (!match && node.props?.class === className) match = { node, parent };
  });
  return match;
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

test('renderMainShell registers built-in shell surfaces idempotently', () => {
  registerAppShellSurfaces();
  registerAppShellSurfaces();

  const ids = listShellSurfaces().map((surface) => surface.id);
  expect(ids.filter((id) => id === 'piclaw.timeline-core')).toHaveLength(1);
  expect(ids.filter((id) => id === 'piclaw.compose-box')).toHaveLength(1);
  expect(ids).toContain('piclaw.system-meters-hud');
  expect(ids).toContain('piclaw.agent-request-modal');
});

test('renderMainShell renders default built-in surfaces in the existing shell containers', () => {
  const tree = renderMainShell(createMainShellRenderOptions({
    chatOnlyMode: false,
    workspaceOpen: true,
    editorOpen: true,
    showEditorPaneContainer: true,
    hasDockPanes: true,
    dockVisible: true,
  }));

  const systemMeters = findVNode(tree, SystemMetersHud);
  const workspaceExplorer = findVNode(tree, WorkspaceExplorer);
  const tabStrip = findVNode(tree, TabStrip);
  const timelineMenu = findVNode(tree, TimelineMenu);
  const timelineQuickActions = findVNode(tree, TimelineQuickActions);
  const timeline = findVNode(tree, Timeline);
  const agentStatus = findVNode(tree, AgentStatus);
  const settingsLoader = findVNode(tree, SettingsDialogLoader);
  const composeBox = findVNode(tree, ComposeBox);
  const agentRequestModal = findVNode(tree, AgentRequestModal);

  expect(systemMeters?.parent?.props.class).toBe('app-shell editor-open');
  expect(workspaceExplorer?.parent?.props.class).toBe('app-shell editor-open');
  expect(tabStrip?.parent?.props.class).toBe('editor-pane-container');
  expect(timelineMenu?.parent?.props.class).toBe('app-shell editor-open');
  expect(timelineQuickActions?.parent?.props.class).toBe('app-shell editor-open');
  expect(timeline?.parent?.props.class).toBe('container');
  expect(agentStatus?.parent?.props.class).toBe('container');
  expect(settingsLoader?.parent?.props.class).toBe('container');
  expect(composeBox?.parent?.props.class).toBe('container');
  expect(agentRequestModal?.parent?.props.class).toBe('container');
});

test('renderMainShell renders additive shell slots inside the existing container', () => {
  registerShellSurface({
    id: 'addon.timeline-above',
    slot: 'timeline.above',
    label: 'Timeline Above',
    owner: 'addon',
    kind: 'additive',
    order: 300,
    defaultVisible: true,
    render: () => html`<div class="addon-timeline-above">above</div>`,
  });
  registerShellSurface({
    id: 'addon.compose-after',
    slot: 'compose.after',
    label: 'Compose After',
    owner: 'addon',
    kind: 'additive',
    order: 300,
    defaultVisible: true,
    render: () => html`<div class="addon-compose-after">after</div>`,
  });

  const tree = renderMainShell(createMainShellRenderOptions());

  expect(findVNodeByClass(tree, 'addon-timeline-above')?.parent?.props.class).toBe('container');
  expect(findVNodeByClass(tree, 'addon-compose-after')?.parent?.props.class).toBe('container');
});

test('configurable built-in visibility can hide surfaces while required surfaces remain', () => {
  registerAppShellSurfaces();
  setShellSurfaceVisible('piclaw.timeline-menu', false);
  setShellSurfaceVisible('piclaw.timeline-core', false);

  const tree = renderMainShell(createMainShellRenderOptions());

  expect(findVNode(tree, TimelineMenu)).toBeNull();
  expect(findVNode(tree, Timeline)).toBeTruthy();
});

test('renderMainShell passes queue controls to ComposeBox and does not render a top-level queue stack', () => {
  const followupQueueItems = [{ row_id: 7, content: 'queued item' }];
  const handleRemoveQueuedFollowup = mock(() => {});

  const tree = renderMainShell(createMainShellRenderOptions({
    followupQueueItems,
    handleRemoveQueuedFollowup,
  }));

  let composeVNode: any = null;
  let topLevelQueueStackCount = 0;

  walkVNodes(tree, (node) => {
    if (node.type === ComposeBox) composeVNode = node;
    if (node.type === QueuedFollowupStack) topLevelQueueStackCount += 1;
  });

  expect(composeVNode).toBeTruthy();
  expect(composeVNode.props.followupQueueItems).toBe(followupQueueItems);
  expect(composeVNode.props.onRemoveQueuedFollowup).toBe(handleRemoveQueuedFollowup);
  expect(composeVNode.props.showQueueStack).toBeUndefined();
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
  let lookups = 0;
  const getElementById = mock((id: string) => {
    lookups += 1;
    if (id !== 'post-77') return null;
    return lookups >= 3 ? element : null;
  });
  const rafQueue: Array<() => void> = [];
  const timeoutQueue: Array<() => void> = [];
  const scrollToBottom = mock(() => {});

  scrollToPostedTimelineMessage({
    id: 77,
    scrollToBottom,
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
  expect(element.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
  expect(element.classList.add).toHaveBeenCalledWith('post-highlight');
  expect(element.classList.remove).toHaveBeenCalledWith('post-highlight');
  expect(scrollToBottom).not.toHaveBeenCalled();
});
