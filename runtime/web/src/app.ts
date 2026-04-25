// @ts-nocheck
// Main authenticated web UI entry point.
import { html, render, useState, useEffect, useMemo, useCallback } from './vendor/preact-htm.js';
import { paneRegistry, TERMINAL_TAB_PATH, VNC_TAB_PREFIX, tabStore } from './panes/index.js';
import { getLocalStorageBoolean, getLocalStorageNumber, setLocalStorageItem } from './utils/storage.js';
import { dedupePosts } from './ui/timeline-utils.js';
import { useAgentState } from './ui/use-agent-state.js';
import { useSplitters } from './ui/use-splitters.js';
import {
    LAST_ACTIVITY_TTL_MS,
    SILENCE_FINALIZE_MS,
    SILENCE_REFRESH_MS,
    SILENCE_WARNING_MS,
    isIOSDevice,
} from './ui/app-helpers.js';
import { isCompactionStatus } from './ui/status-duration.js';
import { openSettingsDialog } from './components/settings-dialog.js';
import {
    useAppLocationNavigation,
} from './ui/app-location-navigation.js';
import {
    renderResolvedAppShell,
} from './ui/app-shell-render-router.js';
import { formatBranchPickerLabel } from './ui/branch-lifecycle.js';
import {
    getCurrentAppAssetVersion,
    getRenameBranchFormLock,
    readAppLocationModes,
} from './ui/app-shell-state.js';
import {
    getPanePopoutDocumentTitle,
} from './ui/app-pane-state.js';
import {
    appApi,
    initializeAppShellRuntime,
} from './ui/app-shell-bootstrap.js';
import {
    composeRenderedMainAppOptions,
} from './ui/app-main-render-composition.js';
import {
    useMainAppInteractionComposition,
} from './ui/app-main-interaction-composition.js';
import {
    useMainAppTimelineComposition,
} from './ui/app-main-timeline-composition.js';
import {
    useMainAppOrchestrationComposition,
} from './ui/app-main-orchestration-composition.js';
import {
    useMainAppSurfaceState,
} from './ui/app-main-surface-state.js';
import {
    useMainAppPaneComposition,
} from './ui/app-main-pane-composition.js';
import {
    handleOpenWorkspaceFileBrowserRequest,
} from './ui/app-extension-ui-browser-actions.js';
import {
    attachChatSwipeNavigation,
} from './ui/chat-swipe-navigation.js';
import { isLikelySafariBrowser } from './ui/app-pane-runtime-orchestration.js';
import {
    OOBE_PROVIDER_MISSING_DISMISSED_KEY,
    resolveOobePanelState,
} from './ui/oobe-state.js';

const CURRENT_APP_ASSET_VERSION = getCurrentAppAssetVersion();

await initializeAppShellRuntime();

const {
    searchPosts,
    deletePost,
    getAgents,
    getAgentThought,
    setAgentThoughtVisibility,
    getAgentStatus,
    getAgentContext,
    getAutoresearchStatus,
    stopAutoresearch,
    dismissAutoresearch,
    getAgentModels,
    getActiveChatAgents,
    getChatBranches,
    renameChatBranch,
    pruneChatBranch,
    purgeChatBranch,
    restoreChatBranch,
    getAgentQueueState,
    steerAgentQueueItem,
    removeAgentQueueItem,
    streamSidePrompt,
    getWorkspaceFile,
    getThread,
    getTimeline,
    sendAgentMessage,
    forkChatBranch,
} = appApi;

function MainApp({ locationParams, navigate }) {
    const {
        currentChatJid,
        chatOnlyMode,
        panePopoutMode,
        panePopoutPath,
        panePopoutLabel,
        branchLoaderMode,
        branchLoaderSourceChatJid,
    } = useMemo(() => readAppLocationModes(locationParams), [locationParams]);

    const surface = useMainAppSurfaceState({
        currentChatJid,
        branchLoaderMode,
    });
    const [providerMissingDismissed, setProviderMissingDismissed] = useState(() => getLocalStorageBoolean(OOBE_PROVIDER_MISSING_DISMISSED_KEY, false));
    const [composePrefillRequest, setComposePrefillRequest] = useState(null);
    const requestComposePrefill = useCallback((text) => {
        const nextText = typeof text === 'string' ? text : '';
        if (!nextText.trim()) return;
        setComposePrefillRequest({
            token: `prefill-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            text: nextText,
        });
    }, []);

    const {
        agentStatus,
        setAgentStatus,
        agentDraft,
        setAgentDraft,
        agentPlan,
        setAgentPlan,
        agentThought,
        setAgentThought,
        pendingRequest,
        setPendingRequest,
        currentTurnId,
        setCurrentTurnId,
        steerQueuedTurnId,
        setSteerQueuedTurnId,
        lastAgentEventRef,
        lastSilenceNoticeRef,
        isAgentRunningRef,
        draftBufferRef,
        thoughtBufferRef,
        previewResyncPendingRef,
        previewResyncGenerationRef,
        pendingRequestRef,
        stalledPostIdRef,
        currentTurnIdRef,
        steerQueuedTurnIdRef,
        thoughtExpandedRef,
        draftExpandedRef,
    } = useAgentState();

    const pane = useMainAppPaneComposition({
        panePopoutMode,
        panePopoutPath,
        panePopoutLabel,
        chatOnlyMode,
        terminalTabPath: TERMINAL_TAB_PATH,
        vncTabPrefix: VNC_TAB_PREFIX,
        getWorkspaceFile,
    });

    const timeline = useMainAppTimelineComposition({
        timelineRef: surface.timelineRef,
        viewStateRef: surface.viewStateRef,
        followupQueueRowIdsRef: surface.followupQueueRowIdsRef,
        currentChatJid,
        currentHashtag: surface.currentHashtag,
        searchQuery: surface.searchQuery,
        followupQueueItems: surface.followupQueueItems,
        onIdentity: useCallback((identity) => {
            if (!identity) return;
            const name = identity.assistant_name;
            const avatarUrl = identity.assistant_avatar_url;
            if (name || avatarUrl) {
                const agentId = 'default';
                surface.setAgents((prev) => {
                    const existing = prev[agentId] || { id: agentId };
                    const next = { ...existing };
                    if (name && !next.name) next.name = name;
                    if (avatarUrl && !next.avatar_url) next.avatar_url = avatarUrl;
                    return { ...prev, [agentId]: next };
                });
            }
            const userName = identity.user_name;
            const userAvatarUrl = identity.user_avatar_url;
            const userAvatarBg = identity.user_avatar_background;
            if (userName || userAvatarUrl) {
                surface.setUserProfile((prev) => ({
                    ...prev,
                    ...(userName && !prev.name ? { name: userName } : {}),
                    ...(userAvatarUrl && !prev.avatar_url ? { avatar_url: userAvatarUrl } : {}),
                    ...(userAvatarBg && !prev.avatar_background ? { avatar_background: userAvatarBg } : {}),
                }));
            }
        }, [surface.setAgents, surface.setUserProfile]),
    });

    const interaction = useMainAppInteractionComposition({
        environment: {
            isRenameBranchFormOpen: surface.isRenameBranchFormOpen,
            renameBranchNameInputRef: surface.renameBranchNameInputRef,
            appShellRef: surface.appShellRef,
            setIsWebAppMode: surface.setIsWebAppMode,
            workspaceOpen: surface.workspaceOpen,
            setWorkspaceOpen: surface.setWorkspaceOpen,
            btwSession: surface.btwSession,
            agents: surface.agents,
            agentsRef: surface.agentsRef,
            currentChatJid,
            activeChatJidRef: surface.activeChatJidRef,
            userProfile: surface.userProfile,
            userProfileRef: surface.userProfileRef,
            brandingRef: surface.brandingRef,
            panePopoutMode,
        },
        composeReferences: {
            setIntentToast: surface.setIntentToast,
            intentToastTimerRef: surface.intentToastTimerRef,
            editorOpen: pane.editorState.editorOpen,
            openEditor: pane.editorState.openEditor,
            resolvePane: (context) => paneRegistry.resolve(context),
            tabStripActiveId: pane.editorState.tabStripActiveId,
            setFileRefs: surface.setFileRefs,
            setMessageRefs: surface.setMessageRefs,
            currentChatJid,
            getThread,
            setPosts: timeline.setPosts,
        },
        agentActivity: {
            lastActivityTtlMs: LAST_ACTIVITY_TTL_MS,
            lastActivityTimerRef: surface.lastActivityTimerRef,
            lastActivityTokenRef: surface.lastActivityTokenRef,
            lastAgentEventRef,
            lastSilenceNoticeRef,
            isAgentRunningRef,
            setIsAgentTurnActive: surface.setIsAgentTurnActive,
            setAgentStatus,
            draftBufferRef,
            thoughtBufferRef,
            pendingRequestRef,
            lastAgentResponseRef: surface.lastAgentResponseRef,
            currentTurnIdRef,
            steerQueuedTurnIdRef,
            agentStatusRef: surface.agentStatusRef,
            silentRecoveryRef: surface.silentRecoveryRef,
            thoughtExpandedRef,
            draftExpandedRef,
            setCurrentTurnId,
            setSteerQueuedTurnId,
            currentTurnIdRefForPanel: currentTurnIdRef,
            setAgentThoughtVisibility,
            getAgentThought,
            setAgentThought,
            setAgentDraft,
        },
        chatPaneRuntime: {
            isAgentTurnActive: surface.isAgentTurnActive,
            steerQueuedTurnId,
            currentTurnId,
            steerQueuedTurnIdRef,
            setSteerQueuedTurnId,
            agentStatus,
            agentDraft,
            agentPlan,
            agentThought,
            pendingRequest,
            pendingRequestRef,
            followupQueueItems: surface.followupQueueItems,
            activeModel: surface.activeModel,
            activeThinkingLevel: surface.activeThinkingLevel,
            supportsThinking: surface.supportsThinking,
            activeModelUsage: surface.activeModelUsage,
            contextUsage: surface.contextUsage,
            isAgentRunningRef,
            wasAgentActiveRef: surface.wasAgentActiveRef,
            draftBufferRef,
            thoughtBufferRef,
            lastAgentEventRef,
            lastSilenceNoticeRef,
            lastAgentResponseRef: surface.lastAgentResponseRef,
            currentTurnIdRef,
            thoughtExpandedRef,
            draftExpandedRef,
            agentStatusRef: surface.agentStatusRef,
            silentRecoveryRef: surface.silentRecoveryRef,
            setIsAgentTurnActive: surface.setIsAgentTurnActive,
            setAgentStatus,
            setAgentDraft,
            setAgentPlan,
            setAgentThought,
            setPendingRequest,
            setCurrentTurnId,
            setFollowupQueueItems: surface.setFollowupQueueItems,
            setActiveModel: surface.setActiveModel,
            setActiveThinkingLevel: surface.setActiveThinkingLevel,
            setSupportsThinking: surface.setSupportsThinking,
            setActiveModelUsage: surface.setActiveModelUsage,
            setContextUsage: surface.setContextUsage,
            lastNotifiedIdRef: surface.lastNotifiedIdRef,
            agentsRef: surface.agentsRef,
            notify: surface.notify,
            shouldNotifyLocallyForChat: surface.shouldNotifyLocallyForChat,
        },
        recovery: {
            isAgentRunningRef,
            lastSilenceNoticeRef,
            lastAgentEventRef,
            currentTurnIdRef,
            thoughtExpandedRef,
            draftExpandedRef,
            draftBufferRef,
            thoughtBufferRef,
            pendingRequestRef,
            lastAgentResponseRef: surface.lastAgentResponseRef,
            agentStatusRef: surface.agentStatusRef,
            stalledPostIdRef,
            scrollToBottomRef: timeline.scrollToBottomRef,
            setCurrentTurnId,
            setAgentDraft,
            setAgentPlan,
            setAgentThought,
            setPendingRequest,
            setAgentStatus,
            setPosts: timeline.setPosts,
            dedupePosts,
        },
        viewState: {
            viewStateRef: surface.viewStateRef,
            currentHashtag: surface.currentHashtag,
            searchQuery: surface.searchQuery,
            searchOpen: surface.searchOpen,
        },
        removeFileRefRef: pane.removeFileRefRef,
    });

    const splitterHandlers = useSplitters({
        appShellRef: surface.appShellRef,
        sidebarWidthRef: surface.sidebarWidthRef,
        editorWidthRef: surface.editorWidthRef,
        dockHeightRef: surface.dockHeightRef,
    });

    const {
        chatRefreshLifecycle,
        timelineViewActions,
        isComposeBoxAgentActive,
        followupActions,
        sidepanelActions,
        branchPaneActions,
    } = useMainAppOrchestrationComposition({
        routeState: {
            currentChatJid,
            currentRootChatJid: surface.currentRootChatJid,
            chatOnlyMode,
            navigate,
            branchLoaderMode,
            branchLoaderSourceChatJid,
            isWebAppMode: surface.isWebAppMode,
        },
        searchState: {
            currentHashtag: surface.currentHashtag,
            setCurrentHashtag: surface.setCurrentHashtag,
            searchQuery: surface.searchQuery,
            setSearchQuery: surface.setSearchQuery,
            searchOpen: surface.searchOpen,
            setSearchOpen: surface.setSearchOpen,
            searchScope: surface.searchScope,
            setSearchScope: surface.setSearchScope,
        },
        shellState: {
            activeChatAgents: surface.activeChatAgents,
            currentChatBranches: surface.currentChatBranches,
            currentBranchRecord: surface.currentBranchRecord,
            contextUsage: surface.contextUsage,
            activeModel: surface.activeModel,
            activeThinkingLevel: surface.activeThinkingLevel,
            supportsThinking: surface.supportsThinking,
            activeModelUsage: surface.activeModelUsage,
            connectionStatus: surface.connectionStatus,
            notificationsEnabled: surface.notificationsEnabled,
            notificationPermission: surface.notificationPermission,
            workspaceOpen: surface.workspaceOpen,
            setWorkspaceOpen: surface.setWorkspaceOpen,
            userProfile: surface.userProfile,
            agents: surface.agents,
            removingPostIds: surface.removingPostIds,
            btwSession: surface.btwSession,
        },
        timeline,
        interaction,
        paneRuntime: pane.paneRuntime,
        refs: {
            activeChatJidRef: surface.activeChatJidRef,
            queueRefreshGenRef: surface.queueRefreshGenRef,
            dismissedQueueRowIdsRef: surface.dismissedQueueRowIdsRef,
            wasAgentActiveRef: surface.wasAgentActiveRef,
            viewStateRef: surface.viewStateRef,
            agentStatusRef: surface.agentStatusRef,
            pendingRequestRef,
            thoughtBufferRef,
            draftBufferRef,
            previewResyncPendingRef,
            previewResyncGenerationRef,
            isAgentRunningRef,
            currentTurnIdRef,
            silentRecoveryRef: surface.silentRecoveryRef,
            lastAgentEventRef,
            lastSilenceNoticeRef,
            staleUiVersionRef: surface.staleUiVersionRef,
            staleUiReloadScheduledRef: surface.staleUiReloadScheduledRef,
            hasConnectedOnceRef: surface.hasConnectedOnceRef,
            sidebarWidthRef: surface.sidebarWidthRef,
            appShellRef: surface.appShellRef,
            agentsRef: surface.agentsRef,
            paneStateOwnerChatJidRef: surface.paneStateOwnerChatJidRef,
            chatPaneStateByChatRef: surface.chatPaneStateByChatRef,
            dismissedLiveWidgetKeysRef: surface.dismissedLiveWidgetKeysRef,
            draftThrottleRef: surface.draftThrottleRef,
            thoughtThrottleRef: surface.thoughtThrottleRef,
            followupQueueItemsRef: surface.followupQueueItemsRef,
            lastAgentResponseRef: surface.lastAgentResponseRef,
            thoughtExpandedRef,
            draftExpandedRef,
            steerQueuedTurnIdRef,
            btwAbortRef: surface.btwAbortRef,
            renameBranchInFlightRef: surface.renameBranchInFlightRef,
            renameBranchLockUntilRef: surface.renameBranchLockUntilRef,
            editorWidthRef: surface.editorWidthRef,
            dockHeightRef: surface.dockHeightRef,
        },
        setters: {
            setFollowupQueueItems: surface.setFollowupQueueItems,
            setContextUsage: surface.setContextUsage,
            setExtensionStatusPanels: surface.setExtensionStatusPanels,
            setPendingExtensionPanelActions: surface.setPendingExtensionPanelActions,
            setExtensionWorkingState: surface.setExtensionWorkingState,
            setAgentStatus,
            setAgentDraft,
            setAgentPlan,
            setAgentThought,
            setPendingRequest,
            setConnectionStatus: surface.setConnectionStatus,
            setAgents: surface.setAgents,
            setUserProfile: surface.setUserProfile,
            setActiveChatAgents: surface.setActiveChatAgents,
            setCurrentChatBranches: surface.setCurrentChatBranches,
            setActiveModel: surface.setActiveModel,
            setActiveThinkingLevel: surface.setActiveThinkingLevel,
            setSupportsThinking: surface.setSupportsThinking,
            setActiveModelUsage: surface.setActiveModelUsage,
            setAgentModelsPayload: surface.setAgentModelsPayload,
            setHasLoadedAgentModels: surface.setHasLoadedAgentModels,
            setHasMore: timeline.setHasMore,
            setFloatingWidget: surface.setFloatingWidget,
            setSteerQueuedTurnId,
            setRemovingPostIds: surface.setRemovingPostIds,
            setBtwSession: surface.setBtwSession,
            setWorkspaceOpen: surface.setWorkspaceOpen,
            setRenameBranchNameDraft: surface.setRenameBranchNameDraft,
            setIsRenameBranchFormOpen: surface.setIsRenameBranchFormOpen,
            setIsRenamingBranch: surface.setIsRenamingBranch,
        },
        services: {
            searchPosts,
            deletePost,
            getAgentQueueState,
            getAgentContext,
            getAutoresearchStatus,
            getAgentStatus,
            getAgents,
            getAgentModels,
            getActiveChatAgents,
            getChatBranches,
            getTimeline,
            stopAutoresearch,
            dismissAutoresearch,
            streamSidePrompt,
            sendAgentMessage,
            renameChatBranch,
            pruneChatBranch,
            purgeChatBranch,
            restoreChatBranch,
            forkChatBranch,
            steerAgentQueueItem,
            removeAgentQueueItem,
            getAgentThought,
            setAgentThoughtVisibility,
            silenceRefreshMs: SILENCE_REFRESH_MS,
            silenceWarningMs: SILENCE_WARNING_MS,
            silenceFinalizeMs: SILENCE_FINALIZE_MS,
            isCompactionStatus,
            currentAppAssetVersion: CURRENT_APP_ASSET_VERSION,
            tabStoreHasUnsaved: () => tabStore.hasUnsaved(),
            agentStatus,
            isAgentTurnActive: surface.isAgentTurnActive,
            openEditor: pane.editorState.openEditor,
            activateTab: pane.editorState.handleTabActivate,
            tabStripActiveId: pane.editorState.tabStripActiveId,
            terminalTabPath: TERMINAL_TAB_PATH,
            resolveTab: (value) => tabStore.get(value),
            closeTab: pane.editorState.handleTabClose,
            editorOpen: pane.editorState.editorOpen,
        },
        helpers: {
            getFormLock: getRenameBranchFormLock,
            readStoredNumber: getLocalStorageNumber,
        },
    });

    /* ── chat swipe navigation (native touch listeners) ── */
    useEffect(() => {
        return attachChatSwipeNavigation({
            timelineRef: surface.timelineRef,
            activeChatAgents: surface.activeChatAgents,
            currentChatJid,
            onSwitch: (nextChatJid) => branchPaneActions.handleBranchPickerChange(nextChatJid),
            isIOSDevice,
            isLikelySafari: isLikelySafariBrowser,
        });
    }, [surface.timelineRef, surface.activeChatAgents, currentChatJid, branchPaneActions.handleBranchPickerChange]);

    const oobePanelState = useMemo(() => resolveOobePanelState({
        panePopoutMode,
        modelsLoaded: surface.hasLoadedAgentModels,
        modelPayload: surface.agentModelsPayload,
        providerMissingDismissed,
    }), [panePopoutMode, surface.hasLoadedAgentModels, surface.agentModelsPayload, providerMissingDismissed]);

    const handleOobeOpenSettings = useCallback(() => {
        openSettingsDialog();
    }, []);

    const handleDismissProviderMissingOobe = useCallback(() => {
        setProviderMissingDismissed(true);
        setLocalStorageItem(OOBE_PROVIDER_MISSING_DISMISSED_KEY, 'true');
    }, []);

    useEffect(() => {
        if (!panePopoutMode || typeof document === 'undefined') return;
        document.title = getPanePopoutDocumentTitle(
            panePopoutLabel,
            pane.paneRuntime.activePaneTab,
            panePopoutPath,
        );
    }, [pane.paneRuntime.activePaneTab, panePopoutLabel, panePopoutMode, panePopoutPath]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const handleExtensionUiRequest = (event: Event) => {
            void handleOpenWorkspaceFileBrowserRequest(event as CustomEvent, {
                currentChatJid,
                openEditor: pane.editorState.openEditor,
                popOutPane: branchPaneActions.handlePopOutPane,
                showIntentToast: interaction.composeReferenceActions.showIntentToast,
            });
        };
        window.addEventListener('piclaw-extension-ui:request', handleExtensionUiRequest as EventListener);
        return () => {
            window.removeEventListener('piclaw-extension-ui:request', handleExtensionUiRequest as EventListener);
        };
    }, [branchPaneActions.handlePopOutPane, currentChatJid, interaction.composeReferenceActions.showIntentToast, pane.editorState.openEditor]);

    return renderResolvedAppShell(composeRenderedMainAppOptions({
        routeState: {
            branchLoaderMode,
            panePopoutMode,
            currentChatJid,
            chatOnlyMode,
            panePopoutPath,
        },
        paneRuntime: pane.paneRuntime,
        splitters: splitterHandlers,
        orchestration: {
            branchPaneActions,
            timelineViewActions,
            sidepanelActions,
            followupActions,
            chatRefreshLifecycle,
            isComposeBoxAgentActive,
        },
        interaction,
        timeline,
        surface: {
            ...surface,
            oobePanelState,
            composePrefillRequest,
            requestComposePrefill,
            handleOobeSetupProvider: handleOobeOpenSettings,
            handleOobeShowModelPicker: handleOobeOpenSettings,
            handleOobeOpenWorkspace: handleOobeOpenSettings,
            handleDismissProviderMissingOobe,
        },
        editorState: pane.editorState,
        agentState: {
            agentStatus,
            agentDraft,
            agentPlan,
            agentThought,
            pendingRequest,
            currentTurnId,
            steerQueuedTurnId,
            setPendingRequest,
            pendingRequestRef,
            isCompactionStatus,
        },
        helpers: {
            formatBranchPickerLabel,
            isIOSDevice,
            terminalTabPath: TERMINAL_TAB_PATH,
        },
    }));
}

function App() {
    const { locationParams, navigate } = useAppLocationNavigation();
    return html`<${MainApp} locationParams=${locationParams} navigate=${navigate} />`;
}

// Mount the app
render(html`<${App} />`, document.getElementById('app'));
