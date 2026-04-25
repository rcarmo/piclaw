import { composeMainAppShellOptions } from './app-main-shell-composition.js';

export function deriveSteerQueuedState(options: {
  steerQueuedTurnId: string | null;
  currentTurnId: string | null;
  agentStatus: any;
}): boolean {
  const { steerQueuedTurnId, currentTurnId, agentStatus } = options;
  return Boolean(steerQueuedTurnId && (steerQueuedTurnId === (agentStatus?.turn_id || currentTurnId)));
}

export function composeRenderedMainAppOptions(input: {
  routeState: {
    branchLoaderMode: boolean;
    panePopoutMode: boolean;
    currentChatJid: string;
    chatOnlyMode: boolean;
    panePopoutPath: string | null;
  };
  paneRuntime: Record<string, any>;
  splitters: Record<string, any>;
  orchestration: {
    branchPaneActions: Record<string, any>;
    timelineViewActions: Record<string, any>;
    sidepanelActions: Record<string, any>;
    followupActions: Record<string, any>;
    chatRefreshLifecycle: Record<string, any>;
    isComposeBoxAgentActive: boolean;
  };
  interaction: Record<string, any>;
  timeline: Record<string, any>;
  surface: Record<string, any>;
  editorState: {
    editorOpen: boolean;
    tabStripTabs: any[];
    tabStripActiveId: string | null;
    handleTabActivate: (...args: any[]) => any;
    previewTabs: Set<string>;
    diffTabs: Set<string>;
    handleTabTogglePreview: (...args: any[]) => any;
    handleTabToggleDiff: (...args: any[]) => any;
    tabPaneOverrides: Record<string, unknown>;
    handleTabClose: (...args: any[]) => any;
    handleTabCloseOthers: (...args: any[]) => any;
    handleTabCloseAll: (...args: any[]) => any;
    handleTabTogglePin: (...args: any[]) => any;
    handleTabEditSource: (...args: any[]) => any;
    openEditor: (...args: any[]) => any;
  };
  agentState: {
    agentStatus: any;
    agentDraft: any;
    agentPlan: any;
    agentThought: any;
    pendingRequest: any;
    currentTurnId: string | null;
    steerQueuedTurnId: string | null;
    setPendingRequest: (...args: any[]) => any;
    pendingRequestRef: any;
    isCompactionStatus: (status: any) => boolean;
  };
  helpers: {
    formatBranchPickerLabel: (...args: any[]) => any;
    isIOSDevice: (...args: any[]) => any;
    terminalTabPath: string;
  };
}) {
  const steerQueued = deriveSteerQueuedState({
    steerQueuedTurnId: input.agentState.steerQueuedTurnId,
    currentTurnId: input.agentState.currentTurnId,
    agentStatus: input.agentState.agentStatus,
  });

  return composeMainAppShellOptions({
    routing: {
      branchLoaderMode: input.routeState.branchLoaderMode,
      panePopoutMode: input.routeState.panePopoutMode,
      branchLoaderState: input.surface.branchLoaderState,
    },
    paneRuntime: input.paneRuntime,
    splitters: input.splitters,
    branchPaneActions: input.orchestration.branchPaneActions,
    timelineViewActions: input.orchestration.timelineViewActions,
    composeReferenceActions: input.interaction.composeReferenceActions,
    sidepanelActions: input.orchestration.sidepanelActions,
    shellState: {
      appShellRef: input.surface.appShellRef,
      workspaceOpen: input.surface.workspaceOpen,
      editorOpen: input.editorState.editorOpen,
      chatOnlyMode: input.routeState.chatOnlyMode,
      isRenameBranchFormOpen: input.surface.isRenameBranchFormOpen,
      renameBranchNameDraft: input.surface.renameBranchNameDraft,
      renameBranchNameInputRef: input.surface.renameBranchNameInputRef,
      setRenameBranchNameDraft: input.surface.setRenameBranchNameDraft,
      renameBranchDraftState: input.surface.renameBranchDraftState,
      isRenamingBranch: input.surface.isRenamingBranch,
      isWebAppMode: input.surface.isWebAppMode,
      TERMINAL_TAB_PATH: input.helpers.terminalTabPath,
      isIOSDevice: input.helpers.isIOSDevice,
      currentBranchRecord: input.surface.currentBranchRecord,
      currentChatJid: input.routeState.currentChatJid,
      currentChatBranches: input.surface.currentChatBranches,
      formatBranchPickerLabel: input.helpers.formatBranchPickerLabel,
      activeSearchScopeLabel: input.surface.activeSearchScopeLabel,
      currentHashtag: input.surface.currentHashtag,
      searchQuery: input.surface.searchQuery,
      oobePanelState: input.surface.oobePanelState,
      composePrefillRequest: input.surface.composePrefillRequest,
      requestComposePrefill: input.surface.requestComposePrefill,
      handleOobeSetupProvider: input.surface.handleOobeSetupProvider,
      handleOobeShowModelPicker: input.surface.handleOobeShowModelPicker,
      handleOobeOpenWorkspace: input.surface.handleOobeOpenWorkspace,
      handleDismissProviderMissingOobe: input.surface.handleDismissProviderMissingOobe,
      handleCompleteProviderReadyOobe: input.surface.handleCompleteProviderReadyOobe,
      posts: input.timeline.posts,
      hasMore: input.timeline.hasMore,
      loadMore: input.timeline.loadMore,
      timelineRef: input.surface.timelineRef,
      agents: input.surface.agents,
      userProfile: input.surface.userProfile,
      removingPostIds: input.surface.removingPostIds,
      extensionStatusPanels: input.surface.extensionStatusPanels,
      pendingExtensionPanelActions: input.surface.pendingExtensionPanelActions,
      searchOpen: input.surface.searchOpen,
      followupQueueItems: input.surface.followupQueueItems,
      viewStateRef: input.surface.viewStateRef,
      loadPosts: input.timeline.loadPosts,
      scrollToBottom: input.timeline.scrollToBottom,
      searchScope: input.surface.searchScope,
      tabStripTabs: input.editorState.tabStripTabs,
      tabStripActiveId: input.editorState.tabStripActiveId,
      handleTabActivate: input.editorState.handleTabActivate,
      previewTabs: input.editorState.previewTabs,
      diffTabs: input.editorState.diffTabs,
      handleTabTogglePreview: input.editorState.handleTabTogglePreview,
      handleTabToggleDiff: input.editorState.handleTabToggleDiff,
      panePopoutPath: input.routeState.panePopoutPath,
      tabPaneOverrides: input.editorState.tabPaneOverrides,
      handleTabClose: input.editorState.handleTabClose,
      handleTabCloseOthers: input.editorState.handleTabCloseOthers,
      handleTabCloseAll: input.editorState.handleTabCloseAll,
      handleTabTogglePin: input.editorState.handleTabTogglePin,
      handleTabEditSource: input.editorState.handleTabEditSource,
      openEditor: input.editorState.openEditor,
      openTerminalTab: input.paneRuntime.openTerminalTab,
      openVncTab: input.paneRuntime.openVncTab,
    },
    agentState: {
      agentStatus: input.agentState.agentStatus,
      isCompactionStatus: input.agentState.isCompactionStatus,
      agentDraft: input.agentState.agentDraft,
      agentPlan: input.agentState.agentPlan,
      agentThought: input.agentState.agentThought,
      pendingRequest: input.agentState.pendingRequest,
      intentToast: input.surface.intentToast,
      currentTurnId: input.agentState.currentTurnId,
      steerQueued,
      handlePanelToggle: input.interaction.handlePanelToggle,
      setPendingRequest: input.agentState.setPendingRequest,
      pendingRequestRef: input.agentState.pendingRequestRef,
      handleInjectQueuedFollowup: input.orchestration.followupActions.handleInjectQueuedFollowup,
      handleRemoveQueuedFollowup: input.orchestration.followupActions.handleRemoveQueuedFollowup,
      handleMoveQueuedFollowup: input.orchestration.followupActions.handleMoveQueuedFollowup,
    },
    composeState: {
      btwSession: input.surface.btwSession,
      floatingWidget: input.surface.floatingWidget,
      fileRefs: input.surface.fileRefs,
      messageRefs: input.surface.messageRefs,
      followupQueueCount: input.surface.followupQueueCount,
      attachmentPreview: input.surface.attachmentPreview,
      setAttachmentPreview: input.surface.setAttachmentPreview,
      handleMessageResponse: input.orchestration.followupActions.handleMessageResponse,
      isComposeBoxAgentActive: input.orchestration.isComposeBoxAgentActive,
      extensionWorkingState: input.surface.extensionWorkingState,
    },
    modelState: {
      activeChatAgents: input.surface.activeChatAgents,
      connectionStatus: input.surface.connectionStatus,
      activeModel: input.surface.activeModel,
      agentModelsPayload: input.surface.agentModelsPayload,
      activeModelUsage: input.surface.activeModelUsage,
      activeThinkingLevel: input.surface.activeThinkingLevel,
      supportsThinking: input.surface.supportsThinking,
      contextUsage: input.surface.contextUsage,
      notificationsEnabled: input.surface.notificationsEnabled,
      notificationPermission: input.surface.notificationPermission,
      handleToggleNotifications: input.surface.handleToggleNotifications,
      setActiveModel: input.surface.setActiveModel,
      applyModelState: input.orchestration.chatRefreshLifecycle.applyModelState,
    },
  });
}
