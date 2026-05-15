import { html } from '../vendor/preact-htm.js';
import { OobePanel } from '../components/oobe-panel.js';
import { BtwPanel } from '../components/btw-panel.js';
import { FloatingWidgetPane } from '../components/floating-widget-pane.js';
import { AttachmentPreviewModal } from '../components/attachment-preview-modal.js';
import { MarkdownPreview } from '../components/markdown-preview.js';
import { registerAppShellSurfaces } from './app-shell-builtins.js';
import { getShellSurfaceVisible, renderShellSlot } from './shell-surface-registry.js';
export {
  buildMainShellClassName,
  extractPostedUserMessageId,
  handleComposePost,
  scrollToPostedTimelineMessage,
} from './app-main-shell-utils.js';
import { buildMainShellClassName } from './app-main-shell-utils.js';

export interface MainShellRenderOptions {
  [key: string]: any;
}

export function renderMainShell(options: MainShellRenderOptions): any {
  const {
    appShellRef,
    workspaceOpen,
    editorOpen,
    chatOnlyMode,
    zenMode,
    isRenameBranchFormOpen,
    closeRenameCurrentBranchForm,
    handleRenameCurrentBranch,
    renameBranchNameDraft,
    renameBranchNameInputRef,
    setRenameBranchNameDraft,
    renameBranchDraftState,
    isRenamingBranch,
    addFileRef,
    addFolderRef,
    openEditor,
    openTerminalTab,
    openVncTab,
    hasDockPanes,
    toggleDock,
    dockVisible,
    handleSplitterMouseDown,
    handleSplitterTouchStart,
    showEditorPaneContainer,
    tabStripTabs,
    tabStripActiveId,
    handleTabActivate,
    handleTabClose,
    handleTabCloseOthers,
    handleTabCloseAll,
    handleTabTogglePin,
    handleTabTogglePreview,
    handleTabToggleDiff,
    handleTabEditSource,
    handleReattachPane,
    previewTabs,
    diffTabs,
    tabPaneOverrides,
    toggleZenMode,
    handlePopOutPane,
    isWebAppMode,
    editorContainerRef,
    editorInstanceRef,
    detachedTabs,
    activeDetachedTab,
    detachedDockPane,
    handleDockSplitterMouseDown,
    handleDockSplitterTouchStart,
    TERMINAL_TAB_PATH,
    dockContainerRef,
    handleEditorSplitterMouseDown,
    handleEditorSplitterTouchStart,
    searchQuery,
    isIOSDevice,
    currentBranchRecord,
    currentChatJid,
    currentChatBranches,
    handleBranchPickerChange,
    formatBranchPickerLabel,
    openRenameCurrentBranchForm,
    handlePruneCurrentBranch,
    handlePurgeArchivedBranch,
    currentHashtag,
    handleBackToTimeline,
    activeSearchScopeLabel,
    oobePanelState,
    composePrefillRequest,
    requestComposePrefill,
    handleOobeSetupProvider,
    handleOobeShowModelPicker,
    handleOobeOpenWorkspace,
    handleDismissProviderMissingOobe,
    handleCompleteProviderReadyOobe,
    posts,
    isMainTimelineView,
    hasMore,
    loadMore,
    timelineRef,
    handleHashtagClick,
    addMessageRef,
    scrollToMessage,
    openFileFromPill,
    openTimelineFileFromPill,
    handleDeletePost,
    handleOpenFloatingWidget,
    agents,
    userProfile,
    removingPostIds,
    agentStatus,
    isCompactionStatus,
    agentDraft,
    agentPlan,
    agentThought,
    pendingRequest,
    intentToast,
    currentTurnId,
    steerQueued,
    handlePanelToggle,
    btwSession,
    closeBtwPanel,
    handleBtwRetry,
    handleBtwInject,
    floatingWidget,
    handleCloseFloatingWidget,
    handleFloatingWidgetEvent,
    attachmentPreview,
    setAttachmentPreview,
    extensionStatusPanels,
    pendingExtensionPanelActions,
    handleExtensionPanelAction,
    searchOpen,
    followupQueueItems,
    handleInjectQueuedFollowup,
    handleRemoveQueuedFollowup,
    handleMoveQueuedFollowup,
    viewStateRef,
    loadPosts,
    scrollToBottom,
    searchScope,
    handleSearch,
    handleSearchScopeChange,
    setSearchScope,
    enterSearchMode,
    exitSearchMode,
    fileRefs,
    removeFileRef,
    clearFileRefs,
    setFileRefsFromCompose,
    folderRefs,
    removeFolderRef,
    clearFolderRefs,
    setFolderRefsFromCompose,
    messageRefs,
    removeMessageRef,
    clearMessageRefs,
    setMessageRefsFromCompose,
    handleCreateSessionFromCompose,
    handleCreateRootSessionFromCompose,
    handleRestoreBranch,
    attachActiveEditorFile,
    followupQueueCount,
    handleBtwIntercept,
    handleMessageResponse,
    handleComposeSubmitError,
    isComposeBoxAgentActive,
    activeChatAgents,
    connectionStatus,
    stateAccessFailed,
    activeModel,
    agentModelsPayload,
    activeModelUsage,
    activeThinkingLevel,
    supportsThinking,
    contextUsage,
    extensionWorkingState,
    notificationsEnabled,
    notificationPermission,
    handleToggleNotifications,
    setActiveModel,
    applyModelState,
    setPendingRequest,
    pendingRequestRef,
    toggleWorkspace,
  } = options;

  const handleComposeFocus = () => {
    if (isIOSDevice()) return;
    scrollToBottom();
  };

  registerAppShellSurfaces();
  const shellRenderOptions = {
    ...options,
    handleComposeFocus,
  };
  const workspaceSidebarVisible = getShellSurfaceVisible('piclaw.workspace-explorer', true);

  return html`
    <div class=${buildMainShellClassName({ workspaceOpen, editorOpen, chatOnlyMode, zenMode })} ref=${appShellRef}>
      ${renderShellSlot('app.overlay', { options: shellRenderOptions })}
      ${isRenameBranchFormOpen && html`
        <div class="rename-branch-overlay" onPointerDown=${(event: any) => {
          if (event.target === event.currentTarget) {
            closeRenameCurrentBranchForm();
          }
        }}>
          <form
            class="rename-branch-panel"
            onSubmit=${(event: any) => {
              event.preventDefault();
              void handleRenameCurrentBranch(renameBranchNameDraft);
            }}
          >
            <div class="rename-branch-title">Rename session</div>
            <input
              ref=${renameBranchNameInputRef}
              value=${renameBranchNameDraft}
              onInput=${(event: any) => {
                const next = event.currentTarget?.value ?? '';
                setRenameBranchNameDraft(String(next));
              }}
              onKeyDown=${(event: any) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeRenameCurrentBranchForm();
                }
              }}
              autocomplete="off"
              placeholder="Session handle (letters, numbers, - and _ only)"
            />
            <div class=${`rename-branch-help ${renameBranchDraftState.kind || 'info'}`}>
              ${renameBranchDraftState.message}
            </div>
            <div class="rename-branch-actions">
              <button type="submit" class="compose-model-popup-btn primary" disabled=${isRenamingBranch || !renameBranchDraftState.canSubmit}>
                ${isRenamingBranch ? 'Renaming\u2026' : 'Save'}
              </button>
              <button
                type="button"
                class="compose-model-popup-btn"
                onClick=${closeRenameCurrentBranchForm}
                disabled=${isRenamingBranch}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      `}
      ${renderShellSlot('workspace.sidebar', { options: shellRenderOptions })}
      ${renderShellSlot('workspace.toggle', { options: shellRenderOptions })}
      ${!chatOnlyMode && workspaceSidebarVisible && html`<div class="workspace-splitter" onMouseDown=${handleSplitterMouseDown} onTouchStart=${handleSplitterTouchStart}></div>`}
      ${showEditorPaneContainer && html`
        <div class="editor-pane-container">
          ${zenMode && html`<div class="zen-hover-zone"></div>`}
          ${renderShellSlot('editor.tabbar', { options: shellRenderOptions })}
          ${renderShellSlot('editor.host', { options: shellRenderOptions })}
          ${editorOpen && !activeDetachedTab && tabStripActiveId && previewTabs.has(tabStripActiveId) && html`
            <${MarkdownPreview}
              getContent=${() => editorInstanceRef.current?.getContent?.()}
              subscribeContentChange=${(cb) => editorInstanceRef.current?.onContentChange?.(cb)}
              path=${tabStripActiveId}
              onClose=${() => handleTabTogglePreview(tabStripActiveId)}
            />
          `}
          ${hasDockPanes && dockVisible && html`<div class="dock-splitter" onMouseDown=${handleDockSplitterMouseDown} onTouchStart=${handleDockSplitterTouchStart}></div>`}
          ${hasDockPanes && html`<div class=${`dock-panel${dockVisible ? '' : ' hidden'}${editorOpen ? '' : ' standalone'}`}>
            ${renderShellSlot('dock.header', { options: shellRenderOptions })}
            ${renderShellSlot('dock.body', { options: shellRenderOptions })}
          </div>`}
        </div>
        <div class="editor-splitter" onMouseDown=${handleEditorSplitterMouseDown} onTouchStart=${handleEditorSplitterTouchStart}></div>
      `}
      ${renderShellSlot('timeline.menu', { options: shellRenderOptions })}
      ${renderShellSlot('timeline.quick-actions', { options: shellRenderOptions })}
      <div class="container">
        ${searchQuery && isIOSDevice() && html`<div class="search-results-spacer"></div>`}
        ${(currentHashtag || searchQuery) && html`
          <div class="hashtag-header">
            <button class="back-btn" onClick=${handleBackToTimeline}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <span>${currentHashtag ? `#${currentHashtag}` : `Search: ${searchQuery} \u00B7 ${activeSearchScopeLabel}`}</span>
          </div>
        `}
        ${oobePanelState?.kind && oobePanelState.kind !== 'hidden' && html`
          <${OobePanel}
            kind=${oobePanelState.kind}
            onSetupProvider=${handleOobeSetupProvider}
            onShowModelPicker=${handleOobeShowModelPicker}
            onOpenWorkspace=${handleOobeOpenWorkspace}
            onDismiss=${oobePanelState.kind === 'provider-missing' ? handleDismissProviderMissingOobe : handleCompleteProviderReadyOobe}
          />
        `}
        ${renderShellSlot('timeline.above', { options: shellRenderOptions })}
        ${renderShellSlot('timeline.core', { options: shellRenderOptions })}
        ${renderShellSlot('timeline.below', { options: shellRenderOptions })}
        ${renderShellSlot('status.core', { options: shellRenderOptions })}
        <${BtwPanel}
          session=${btwSession}
          onClose=${closeBtwPanel}
          onRetry=${handleBtwRetry}
          onInject=${handleBtwInject}
        />
        <${FloatingWidgetPane}
          widget=${floatingWidget}
          onClose=${handleCloseFloatingWidget}
          onWidgetEvent=${handleFloatingWidgetEvent}
        />
        ${attachmentPreview && html`
          <${AttachmentPreviewModal}
            mediaId=${attachmentPreview.mediaId}
            info=${attachmentPreview.info}
            onClose=${() => setAttachmentPreview(null)}
          />
        `}
        ${renderShellSlot('settings.loader', { options: shellRenderOptions })}
        ${renderShellSlot('status.extension', { options: shellRenderOptions })}
        ${renderShellSlot('compose.before', { options: shellRenderOptions })}
        ${renderShellSlot('compose.box', { options: shellRenderOptions })}
        ${renderShellSlot('compose.after', { options: shellRenderOptions })}
        ${renderShellSlot('app.modal', { options: shellRenderOptions })}
      </div>
    </div>
  `;
}
