import { html } from '../vendor/preact-htm.js';
import { ComposeBox } from '../components/compose-box.js';
import { SettingsDialogLoader } from '../components/settings-dialog-loader.js';
import { TimelineQuickActions } from '../components/timeline-quick-actions.js';
import { TimelineMenu } from '../components/timeline-menu.js';
import { AgentRequestModal, AgentStatus } from '../components/status.js';
import { Timeline } from '../components/timeline.js';
import { WorkspaceExplorer } from '../components/workspace-explorer.js';
import { TabStrip } from '../components/tab-strip.js';
import { SystemMetersHud } from '../components/system-meters-hud.js';
import { listShellSurfaces, registerShellSurface } from './shell-surface-registry.js';
import { handleComposePost } from './app-main-shell-utils.js';

const BUILTIN_SHELL_SURFACE_IDS = [
  'piclaw.system-meters-hud',
  'piclaw.workspace-explorer',
  'piclaw.workspace-toggle',
  'piclaw.tab-strip',
  'piclaw.editor-host',
  'piclaw.dock-header',
  'piclaw.dock-body',
  'piclaw.timeline-menu',
  'piclaw.timeline-quick-actions',
  'piclaw.timeline-core',
  'piclaw.status-core',
  'piclaw.agent-status-extension',
  'piclaw.settings-loader',
  'piclaw.compose-box',
  'piclaw.agent-request-modal',
];

function shellOptions(context: { options?: Record<string, any> }): Record<string, any> {
  return context.options ?? {};
}

export function registerAppShellSurfaces(): void {
  const registeredIds = new Set(listShellSurfaces().map((surface) => surface.id));
  if (BUILTIN_SHELL_SURFACE_IDS.every((id) => registeredIds.has(id))) return;

  registerShellSurface({
    id: 'piclaw.system-meters-hud',
    slot: 'app.overlay',
    label: 'System meters HUD',
    owner: 'core',
    kind: 'configurable',
    order: 10,
    defaultVisible: true,
    render: () => html`<${SystemMetersHud} mode="overlay" />`,
  });

  registerShellSurface({
    id: 'piclaw.workspace-explorer',
    slot: 'workspace.sidebar',
    label: 'Workspace explorer',
    owner: 'core',
    kind: 'configurable',
    order: 10,
    defaultVisible: true,
    canRender: (context) => !shellOptions(context).chatOnlyMode,
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <${WorkspaceExplorer}
          onFileSelect=${options.addFileRef}
          onFolderSelect=${options.addFolderRef}
          visible=${options.workspaceOpen}
          active=${options.workspaceOpen || options.editorOpen}
          onOpenEditor=${options.openEditor}
          onOpenTerminalTab=${options.openTerminalTab}
          onOpenVncTab=${options.openVncTab}
          onToggleTerminal=${options.hasDockPanes ? options.toggleDock : undefined}
          terminalVisible=${Boolean(options.hasDockPanes && options.dockVisible)}
        />
      `;
    },
  });

  registerShellSurface({
    id: 'piclaw.workspace-toggle',
    slot: 'workspace.toggle',
    label: 'Workspace toggle',
    owner: 'core',
    kind: 'configurable',
    order: 10,
    defaultVisible: true,
    canRender: (context) => !shellOptions(context).chatOnlyMode,
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <button
          class=${`workspace-toggle-tab${options.workspaceOpen ? ' open' : ' closed'}`}
          onClick=${options.toggleWorkspace}
          title=${options.workspaceOpen ? 'Hide workspace' : 'Show workspace'}
          aria-label=${options.workspaceOpen ? 'Hide workspace' : 'Show workspace'}
        >
          <svg class="workspace-toggle-tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="6 3 11 8 6 13" />
          </svg>
        </button>
      `;
    },
  });

  registerShellSurface({
    id: 'piclaw.tab-strip',
    slot: 'editor.tabbar',
    label: 'Editor tab strip',
    owner: 'core',
    kind: 'configurable',
    order: 10,
    defaultVisible: true,
    canRender: (context) => Boolean(shellOptions(context).editorOpen),
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <${TabStrip}
          tabs=${options.tabStripTabs}
          activeId=${options.tabStripActiveId}
          onActivate=${options.handleTabActivate}
          onClose=${options.handleTabClose}
          onCloseOthers=${options.handleTabCloseOthers}
          onCloseAll=${options.handleTabCloseAll}
          onTogglePin=${options.handleTabTogglePin}
          onTogglePreview=${options.handleTabTogglePreview}
          onToggleDiff=${options.handleTabToggleDiff}
          onEditSource=${options.handleTabEditSource}
          previewTabs=${options.previewTabs}
          diffTabs=${options.diffTabs}
          paneOverrides=${options.tabPaneOverrides}
          detachedTabs=${options.detachedTabs}
          onReattachTab=${options.handleReattachPane}
          onToggleDock=${options.hasDockPanes ? options.toggleDock : undefined}
          dockVisible=${options.hasDockPanes && options.dockVisible}
          onToggleZen=${options.toggleZenMode}
          zenMode=${options.zenMode}
          onPopOutTab=${options.isWebAppMode ? undefined : options.handlePopOutPane}
        />
      `;
    },
  });

  registerShellSurface({
    id: 'piclaw.editor-host',
    slot: 'editor.host',
    label: 'Editor host',
    owner: 'core',
    kind: 'required',
    order: 10,
    defaultVisible: true,
    canRender: (context) => Boolean(shellOptions(context).editorOpen),
    render: (context) => {
      const options = shellOptions(context);
      if (options.activeDetachedTab) {
        return html`
          <div class="editor-pane-host editor-pane-detached-host">
            <div class="editor-empty-state">
              <div class="editor-empty-state-title">${options.activeDetachedTab.label || options.activeDetachedTab.panePath || 'Detached pane'}</div>
              <div class="editor-empty-state-body">This pane is detached into another window.</div>
              <div class="editor-empty-state-actions">
                <button class="editor-empty-state-button" onClick=${() => options.handleReattachPane(options.activeDetachedTab.panePath)}>Reattach here</button>
              </div>
            </div>
          </div>
        `;
      }
      return html`<div class="editor-pane-host" ref=${options.editorContainerRef}></div>`;
    },
  });

  registerShellSurface({
    id: 'piclaw.dock-header',
    slot: 'dock.header',
    label: 'Dock header',
    owner: 'core',
    kind: 'configurable',
    order: 10,
    defaultVisible: true,
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <div class="dock-panel-header">
          <span class="dock-panel-title">Terminal</span>
          <div class="dock-panel-actions">
            ${!options.isWebAppMode && !options.detachedDockPane && html`
              <button class="dock-panel-action" onClick=${() => options.handlePopOutPane(options.TERMINAL_TAB_PATH, 'Terminal')} title="Open terminal in window" aria-label="Open terminal in window">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2.25" y="2.25" width="8.5" height="8.5" rx="1.5"/>
                  <path d="M8.5 2.25h5.25v5.25"/>
                  <path d="M13.75 2.25 7.75 8.25"/>
                </svg>
              </button>
            `}
            ${options.detachedDockPane && html`
              <button class="dock-panel-action" onClick=${() => options.handleReattachPane(options.TERMINAL_TAB_PATH)} title="Reattach terminal" aria-label="Reattach terminal">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="1.5"/>
                  <path d="M5.25 8h5.5"/>
                  <path d="M8 5.25v5.5"/>
                </svg>
              </button>
            `}
            <button class="dock-panel-close" onClick=${options.toggleDock} title=${'Hide terminal (Ctrl+`)'} aria-label="Hide terminal">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                <line x1="4" y1="4" x2="12" y2="12"/>
                <line x1="12" y1="4" x2="4" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    },
  });

  registerShellSurface({
    id: 'piclaw.dock-body',
    slot: 'dock.body',
    label: 'Dock body',
    owner: 'core',
    kind: 'required',
    order: 10,
    defaultVisible: true,
    render: (context) => {
      const options = shellOptions(context);
      if (options.detachedDockPane) {
        return html`
          <div class="dock-panel-body dock-panel-body-detached">
            <div class="editor-empty-state">
              <div class="editor-empty-state-title">Terminal detached</div>
              <div class="editor-empty-state-body">The terminal is open in another window.</div>
              <div class="editor-empty-state-actions">
                <button class="editor-empty-state-button" onClick=${() => options.handleReattachPane(options.TERMINAL_TAB_PATH)}>Reattach here</button>
              </div>
            </div>
          </div>
        `;
      }
      return html`<div class="dock-panel-body" ref=${options.dockContainerRef}></div>`;
    },
  });

  registerShellSurface({
    id: 'piclaw.timeline-menu',
    slot: 'timeline.menu',
    label: 'Timeline menu',
    owner: 'core',
    kind: 'configurable',
    order: 10,
    defaultVisible: true,
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <${TimelineMenu}
          workspaceOpen=${options.workspaceOpen}
          toggleWorkspace=${options.toggleWorkspace}
          chatOnlyMode=${options.chatOnlyMode}
          onOpenTerminalTab=${options.openTerminalTab}
          onOpenVncTab=${options.openVncTab}
          onToggleTerminal=${options.hasDockPanes ? options.toggleDock : undefined}
          terminalVisible=${Boolean(options.hasDockPanes && options.dockVisible)}
        />
      `;
    },
  });

  registerShellSurface({
    id: 'piclaw.timeline-quick-actions',
    slot: 'timeline.quick-actions',
    label: 'Timeline quick actions',
    owner: 'core',
    kind: 'configurable',
    order: 10,
    defaultVisible: true,
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <${TimelineQuickActions}
          activeChatAgents=${options.activeChatAgents}
          currentChatJid=${options.currentChatJid}
          workspaceOpen=${options.workspaceOpen}
          chatOnlyMode=${options.chatOnlyMode}
          terminalVisible=${Boolean(options.hasDockPanes && options.dockVisible)}
          onSwitchChat=${options.handleBranchPickerChange}
          onToggleWorkspace=${options.toggleWorkspace}
          onOpenTerminalTab=${options.openTerminalTab}
          onOpenVncTab=${options.openVncTab}
          onToggleTerminalDock=${options.hasDockPanes ? options.toggleDock : undefined}
          onPrefillCompose=${options.requestComposePrefill}
        />
      `;
    },
  });

  registerShellSurface({
    id: 'piclaw.timeline-core',
    slot: 'timeline.core',
    label: 'Timeline',
    owner: 'core',
    kind: 'required',
    order: 10,
    defaultVisible: true,
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <${Timeline}
          posts=${options.posts}
          hasMore=${options.isMainTimelineView ? options.hasMore : false}
          onLoadMore=${options.isMainTimelineView ? options.loadMore : undefined}
          timelineRef=${options.timelineRef}
          onHashtagClick=${options.handleHashtagClick}
          onMessageRef=${options.addMessageRef}
          onScrollToMessage=${options.scrollToMessage}
          onFileRef=${options.openTimelineFileFromPill || options.openFileFromPill}
          onPostClick=${undefined}
          onDeletePost=${options.handleDeletePost}
          onOpenWidget=${options.handleOpenFloatingWidget}
          onOpenAttachmentPreview=${options.setAttachmentPreview}
          emptyMessage=${options.currentHashtag ? `No posts with #${options.currentHashtag}` : options.searchQuery ? `No results for "${options.searchQuery}"` : undefined}
          agents=${options.agents}
          user=${options.userProfile}
          reverse=${options.isMainTimelineView}
          removingPostIds=${options.removingPostIds}
          searchQuery=${options.searchQuery}
        />
      `;
    },
  });

  registerShellSurface({
    id: 'piclaw.status-core',
    slot: 'status.core',
    label: 'Agent status',
    owner: 'core',
    kind: 'required',
    order: 10,
    defaultVisible: true,
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <${AgentStatus}
          status=${options.isCompactionStatus(options.agentStatus) ? null : options.agentStatus}
          draft=${options.agentDraft}
          plan=${options.agentPlan}
          thought=${options.agentThought}
          pendingRequest=${options.pendingRequest}
          intent=${options.intentToast}
          turnId=${options.currentTurnId}
          steerQueued=${options.steerQueued}
          onPanelToggle=${options.handlePanelToggle}
          showExtensionPanels=${false}
        />
      `;
    },
  });

  registerShellSurface({
    id: 'piclaw.agent-status-extension',
    slot: 'status.extension',
    label: 'Extension status panels',
    owner: 'core',
    kind: 'configurable',
    order: 10,
    defaultVisible: true,
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <${AgentStatus}
          extensionPanels=${Array.from(options.extensionStatusPanels.values())}
          pendingPanelActions=${options.pendingExtensionPanelActions}
          onExtensionPanelAction=${options.handleExtensionPanelAction}
          turnId=${options.currentTurnId}
          steerQueued=${options.steerQueued}
          onPanelToggle=${options.handlePanelToggle}
          showCorePanels=${false}
        />
      `;
    },
  });

  registerShellSurface({
    id: 'piclaw.settings-loader',
    slot: 'settings.loader',
    label: 'Settings dialog loader',
    owner: 'core',
    kind: 'required',
    order: 10,
    defaultVisible: true,
    render: () => html`<${SettingsDialogLoader} />`,
  });

  registerShellSurface({
    id: 'piclaw.compose-box',
    slot: 'compose.box',
    label: 'Compose box',
    owner: 'core',
    kind: 'required',
    order: 10,
    defaultVisible: true,
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <${ComposeBox}
          onPost=${(response: unknown) => {
            handleComposePost({
              response,
              viewStateRef: options.viewStateRef,
              scrollToBottom: options.scrollToBottom,
            });
          }}
          onFocus=${options.handleComposeFocus}
          searchMode=${options.searchOpen}
          searchScope=${options.searchScope}
          onSearch=${options.handleSearch}
          onSearchScopeChange=${options.handleSearchScopeChange || options.setSearchScope}
          onEnterSearch=${options.enterSearchMode}
          onExitSearch=${options.exitSearchMode}
          fileRefs=${options.fileRefs}
          onRemoveFileRef=${options.removeFileRef}
          onClearFileRefs=${options.clearFileRefs}
          onSetFileRefs=${options.setFileRefsFromCompose}
          folderRefs=${options.folderRefs}
          onRemoveFolderRef=${options.removeFolderRef}
          onClearFolderRefs=${options.clearFolderRefs}
          onSetFolderRefs=${options.setFolderRefsFromCompose}
          messageRefs=${options.messageRefs}
          onRemoveMessageRef=${options.removeMessageRef}
          onClearMessageRefs=${options.clearMessageRefs}
          onSetMessageRefs=${options.setMessageRefsFromCompose}
          onSwitchChat=${options.handleBranchPickerChange}
          onRenameSession=${options.handleRenameCurrentBranch}
          isRenameSessionInProgress=${options.isRenamingBranch}
          onCreateSession=${options.handleCreateSessionFromCompose}
          onCreateRootSession=${options.handleCreateRootSessionFromCompose}
          onDeleteSession=${options.handlePruneCurrentBranch}
          onPurgeArchivedSession=${options.handlePurgeArchivedBranch}
          onRestoreSession=${options.handleRestoreBranch}
          activeEditorPath=${options.chatOnlyMode ? null : options.tabStripActiveId}
          onAttachEditorFile=${options.chatOnlyMode ? undefined : options.attachActiveEditorFile}
          onOpenFilePill=${options.openFileFromPill}
          followupQueueCount=${options.followupQueueCount}
          followupQueueItems=${options.followupQueueItems}
          onInjectQueuedFollowup=${options.handleInjectQueuedFollowup}
          onRemoveQueuedFollowup=${options.handleRemoveQueuedFollowup}
          onMoveQueuedFollowup=${options.handleMoveQueuedFollowup}
          onSubmitIntercept=${options.handleBtwIntercept}
          onMessageResponse=${options.handleMessageResponse}
          onSubmitError=${options.handleComposeSubmitError}
          isAgentActive=${options.isComposeBoxAgentActive}
          activeChatAgents=${options.activeChatAgents}
          currentChatJid=${options.currentChatJid}
          connectionStatus=${options.connectionStatus}
          stateAccessFailed=${options.stateAccessFailed}
          activeModel=${options.activeModel}
          agentModelsPayload=${options.agentModelsPayload}
          modelUsage=${options.activeModelUsage}
          thinkingLevel=${options.activeThinkingLevel}
          supportsThinking=${options.supportsThinking}
          contextUsage=${options.contextUsage}
          notificationsEnabled=${options.notificationsEnabled}
          notificationPermission=${options.notificationPermission}
          onToggleNotifications=${options.handleToggleNotifications}
          onModelChange=${options.setActiveModel}
          onModelStateChange=${options.applyModelState}
          statusNotice=${options.isCompactionStatus(options.agentStatus) ? options.agentStatus : null}
          extensionWorkingState=${options.extensionWorkingState}
          prefillRequest=${options.composePrefillRequest}
        />
      `;
    },
  });

  registerShellSurface({
    id: 'piclaw.agent-request-modal',
    slot: 'app.modal',
    label: 'Agent request modal',
    owner: 'core',
    kind: 'required',
    order: 10,
    defaultVisible: true,
    render: (context) => {
      const options = shellOptions(context);
      return html`
        <${AgentRequestModal}
          request=${options.pendingRequest}
          onRespond=${() => {
            options.setPendingRequest(null);
            options.pendingRequestRef.current = null;
          }}
        />
      `;
    },
  });
}
