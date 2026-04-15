import { useMemo, useRef, useState } from '../vendor/preact-htm.js';
import {
  readStoredWorkspaceOpenPreference,
} from './workspace-visibility.js';
import { useNotifications } from './use-notifications.js';
import { isStandaloneWebAppMode } from './chat-window.js';
import { getBranchHandleDraftState } from './branch-lifecycle.js';
import {
  describeSearchScope,
  loadStoredBtwSession,
} from './app-shell-state.js';

export function resolveCurrentBranchRecord(options: {
  activeChatAgents: any[];
  currentChatBranches: any[];
  currentChatJid: string;
}) {
  const {
    activeChatAgents,
    currentChatBranches,
    currentChatJid,
  } = options;

  const currentBranch = currentChatBranches.find((chat) => chat?.chat_jid === currentChatJid);
  if (currentBranch) return currentBranch;
  return activeChatAgents.find((chat) => chat?.chat_jid === currentChatJid) || null;
}

export function createBranchLoaderState(branchLoaderMode: boolean) {
  return {
    status: branchLoaderMode ? 'running' : 'idle',
    message: branchLoaderMode ? 'Preparing a new chat branch…' : '',
  };
}

export function resolveStableRootChatJid(currentChatJid: string, currentBranchRecord?: { root_chat_jid?: string | null } | null): string {
  const recordRoot = typeof currentBranchRecord?.root_chat_jid === 'string'
    ? currentBranchRecord.root_chat_jid.trim()
    : '';
  if (recordRoot) return recordRoot;

  const normalizedChatJid = typeof currentChatJid === 'string' ? currentChatJid.trim() : '';
  if (!normalizedChatJid) return 'web:default';

  const branchMarkerIndex = normalizedChatJid.indexOf(':branch:');
  if (branchMarkerIndex <= 0) {
    return normalizedChatJid;
  }

  return normalizedChatJid.slice(0, branchMarkerIndex) || normalizedChatJid;
}

export function useMainAppSurfaceState(options: {
  currentChatJid: string;
  branchLoaderMode: boolean;
}) {
  const {
    currentChatJid,
    branchLoaderMode,
  } = options;

  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [isWebAppMode, setIsWebAppMode] = useState(() => isStandaloneWebAppMode());
  const [currentHashtag, setCurrentHashtag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchScope, setSearchScope] = useState('current');
  const [fileRefs, setFileRefs] = useState<string[]>([]);
  const [messageRefs, setMessageRefs] = useState<string[]>([]);
  const [intentToast, setIntentToast] = useState<any>(null);
  const [agents, setAgents] = useState<Record<string, unknown>>({});
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [activeThinkingLevel, setActiveThinkingLevel] = useState<string | null>(null);
  const [supportsThinking, setSupportsThinking] = useState(false);
  const [activeModelUsage, setActiveModelUsage] = useState<any>(null);
  const [agentModelsPayload, setAgentModelsPayload] = useState<any>(null);
  const [hasLoadedAgentModels, setHasLoadedAgentModels] = useState(false);
  const [activeChatAgents, setActiveChatAgents] = useState<any[]>([]);
  const [currentChatBranches, setCurrentChatBranches] = useState<any[]>([]);
  const [contextUsage, setContextUsage] = useState<any>(null);
  const [extensionStatusPanels, setExtensionStatusPanels] = useState(() => new Map());
  const [pendingExtensionPanelActions, setPendingExtensionPanelActions] = useState(() => new Set());
  const [followupQueueItems, setFollowupQueueItems] = useState<any[]>([]);
  const [isAgentTurnActive, setIsAgentTurnActive] = useState(false);
  const [btwSession, setBtwSession] = useState(() => loadStoredBtwSession());
  const [floatingWidget, setFloatingWidget] = useState<any>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<any>(null);
  const dismissedLiveWidgetKeysRef = useRef(new Set<string>());
  const currentBranchRecord = useMemo(() => resolveCurrentBranchRecord({
    activeChatAgents,
    currentChatBranches,
    currentChatJid,
  }), [activeChatAgents, currentChatBranches, currentChatJid]);
  const currentRootChatJid = useMemo(
    () => resolveStableRootChatJid(currentChatJid, currentBranchRecord),
    [currentBranchRecord, currentChatJid],
  );
  const activeSearchScopeLabel = describeSearchScope(searchScope);
  const [branchLoaderState, setBranchLoaderState] = useState(() => createBranchLoaderState(branchLoaderMode));
  const followupQueueCount = followupQueueItems.length;
  const followupQueueRowIdsRef = useRef(new Set<string | number>());
  const followupQueueItemsRef = useRef<any[]>([]);
  const dismissedQueueRowIdsRef = useRef(new Set<string | number>());
  const queueRefreshGenRef = useRef(0);
  const silentRecoveryRef = useRef({ inFlight: false, lastAttemptAt: 0, turnId: null as string | null });
  followupQueueRowIdsRef.current = new Set(followupQueueItems.map((item) => item.row_id));
  followupQueueItemsRef.current = followupQueueItems;

  const {
    notificationsEnabled,
    notificationPermission,
    toggleNotifications: handleToggleNotifications,
    notify,
    shouldNotifyLocallyForChat,
  } = useNotifications({ chatJid: currentChatJid });

  const [removingPostIds, setRemovingPostIds] = useState(() => new Set<string | number>());
  const [workspaceOpen, setWorkspaceOpen] = useState(() => readStoredWorkspaceOpenPreference({
    allowLegacyFallback: true,
    defaultValue: false,
  }));
  const [userProfile, setUserProfile] = useState({ name: 'You', avatar_url: null, avatar_background: null });
  const staleUiVersionRef = useRef<string | null>(null);
  const staleUiReloadScheduledRef = useRef(false);
  const hasConnectedOnceRef = useRef(false);
  const wasAgentActiveRef = useRef(false);
  const agentStatusRef = useRef<any>(null);
  const activeChatJidRef = useRef(currentChatJid);
  const chatPaneStateByChatRef = useRef(new Map());
  const paneStateOwnerChatJidRef = useRef(currentChatJid);
  const draftThrottleRef = useRef<any>(0);
  const thoughtThrottleRef = useRef<any>(0);
  const agentsRef = useRef<Record<string, unknown>>({});
  const userProfileRef = useRef({ name: null, avatar_url: null });
  const viewStateRef = useRef({ currentHashtag: null, searchQuery: null, searchOpen: false });
  const timelineRef = useRef<any>(null);
  const appShellRef = useRef<any>(null);
  const sidebarWidthRef = useRef(0);
  const editorWidthRef = useRef(0);
  const dockHeightRef = useRef(0);
  const lastNotifiedIdRef = useRef<any>(null);
  const lastAgentResponseRef = useRef<any>(null);
  const btwAbortRef = useRef<AbortController | null>(null);
  const lastActivityTimerRef = useRef<any>(null);
  const lastActivityTokenRef = useRef(0);
  const brandingRef = useRef({ title: null as string | null, avatarBase: null as string | null });
  const intentToastTimerRef = useRef<any>(null);
  const renameBranchInFlightRef = useRef(false);
  const [isRenamingBranch, setIsRenamingBranch] = useState(false);
  const renameBranchLockUntilRef = useRef(0);
  const [isRenameBranchFormOpen, setIsRenameBranchFormOpen] = useState(false);
  const [renameBranchNameDraft, setRenameBranchNameDraft] = useState('');
  const renameBranchDraftState = useMemo(
    () => getBranchHandleDraftState(renameBranchNameDraft, currentBranchRecord?.agent_name || ''),
    [currentBranchRecord?.agent_name, renameBranchNameDraft],
  );
  const renameBranchNameInputRef = useRef<any>(null);

  return {
    connectionStatus,
    setConnectionStatus,
    isWebAppMode,
    setIsWebAppMode,
    currentHashtag,
    setCurrentHashtag,
    searchQuery,
    setSearchQuery,
    searchOpen,
    setSearchOpen,
    searchScope,
    setSearchScope,
    fileRefs,
    setFileRefs,
    messageRefs,
    setMessageRefs,
    intentToast,
    setIntentToast,
    agents,
    setAgents,
    activeModel,
    setActiveModel,
    activeThinkingLevel,
    setActiveThinkingLevel,
    supportsThinking,
    setSupportsThinking,
    activeModelUsage,
    setActiveModelUsage,
    agentModelsPayload,
    setAgentModelsPayload,
    hasLoadedAgentModels,
    setHasLoadedAgentModels,
    activeChatAgents,
    setActiveChatAgents,
    currentChatBranches,
    setCurrentChatBranches,
    contextUsage,
    setContextUsage,
    extensionStatusPanels,
    setExtensionStatusPanels,
    pendingExtensionPanelActions,
    setPendingExtensionPanelActions,
    followupQueueItems,
    setFollowupQueueItems,
    isAgentTurnActive,
    setIsAgentTurnActive,
    btwSession,
    setBtwSession,
    floatingWidget,
    setFloatingWidget,
    attachmentPreview,
    setAttachmentPreview,
    dismissedLiveWidgetKeysRef,
    currentBranchRecord,
    currentRootChatJid,
    activeSearchScopeLabel,
    branchLoaderState,
    setBranchLoaderState,
    followupQueueCount,
    followupQueueRowIdsRef,
    followupQueueItemsRef,
    dismissedQueueRowIdsRef,
    queueRefreshGenRef,
    silentRecoveryRef,
    notificationsEnabled,
    notificationPermission,
    handleToggleNotifications,
    notify,
    shouldNotifyLocallyForChat,
    removingPostIds,
    setRemovingPostIds,
    workspaceOpen,
    setWorkspaceOpen,
    userProfile,
    setUserProfile,
    staleUiVersionRef,
    staleUiReloadScheduledRef,
    hasConnectedOnceRef,
    wasAgentActiveRef,
    agentStatusRef,
    activeChatJidRef,
    chatPaneStateByChatRef,
    paneStateOwnerChatJidRef,
    draftThrottleRef,
    thoughtThrottleRef,
    agentsRef,
    userProfileRef,
    viewStateRef,
    timelineRef,
    appShellRef,
    sidebarWidthRef,
    editorWidthRef,
    dockHeightRef,
    lastNotifiedIdRef,
    lastAgentResponseRef,
    btwAbortRef,
    lastActivityTimerRef,
    lastActivityTokenRef,
    brandingRef,
    intentToastTimerRef,
    renameBranchInFlightRef,
    isRenamingBranch,
    setIsRenamingBranch,
    renameBranchLockUntilRef,
    isRenameBranchFormOpen,
    setIsRenameBranchFormOpen,
    renameBranchNameDraft,
    setRenameBranchNameDraft,
    renameBranchDraftState,
    renameBranchNameInputRef,
  };
}
