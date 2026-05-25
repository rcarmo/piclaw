import {
  useBranchPaneLifecycle,
} from './app-branch-pane-lifecycle-actions.js';
import {
  useFollowupActionsOrchestration,
} from './app-followup-actions-orchestration.js';
import {
  useSidepanelOrchestration,
} from './app-sidepanel-orchestration.js';
import {
  useAppShellShortcuts,
} from './app-shell-shortcuts.js';
import {
  resolveAdjacentSwipeChatJid,
} from './chat-swipe-navigation.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

interface ComposeFollowupActionOptionsInput {
  currentChatJid: string;
  followupQueueItemsRef: RefBox<any[]>;
  dismissedQueueRowIdsRef: RefBox<Set<string | number>>;
  setFollowupQueueItems: StateSetter<any[]>;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  clearQueuedSteerStateIfStale: () => void;
  steerAgentQueueItem: (...args: any[]) => Promise<any>;
  removeAgentQueueItem: (...args: any[]) => Promise<any>;
  refreshQueueState: () => Promise<void>;
  refreshActiveChatAgents: () => Promise<void>;
  refreshCurrentChatBranches: () => Promise<void>;
  refreshContextUsage: () => Promise<void>;
  refreshAutoresearchStatus: () => Promise<void>;
}

export function composeFollowupActionOptions(input: ComposeFollowupActionOptionsInput) {
  return {
    currentChatJid: input.currentChatJid,
    followupQueueItemsRef: input.followupQueueItemsRef,
    dismissedQueueRowIdsRef: input.dismissedQueueRowIdsRef,
    refreshQueueState: input.refreshQueueState,
    setFollowupQueueItems: input.setFollowupQueueItems,
    showIntentToast: input.showIntentToast,
    clearQueuedSteerStateIfStale: input.clearQueuedSteerStateIfStale,
    steerAgentQueueItem: input.steerAgentQueueItem,
    removeAgentQueueItem: input.removeAgentQueueItem,
    refreshActiveChatAgents: input.refreshActiveChatAgents,
    refreshCurrentChatBranches: input.refreshCurrentChatBranches,
    refreshContextUsage: input.refreshContextUsage,
    refreshAutoresearchStatus: input.refreshAutoresearchStatus,
  };
}

interface ComposeSidepanelActionOptionsInput {
  currentChatJid: string;
  currentRootChatJid: string;
  isComposeBoxAgentActive: boolean;
  setPendingExtensionPanelActions: StateSetter<Set<string>>;
  refreshAutoresearchStatus: () => Promise<void>;
  stopAutoresearch: (chatJid: string) => Promise<any>;
  dismissAutoresearch: (chatJid: string) => Promise<any>;
  streamSidePrompt: (prompt: string, options: Record<string, unknown>) => Promise<any>;
  btwAbortRef: RefBox<AbortController | null>;
  btwSession: any;
  setBtwSession: StateSetter<any>;
  plannotatorAbortRef: RefBox<AbortController | null>;
  plannotatorSession: any;
  setPlannotatorSession: StateSetter<any>;
  openEditor?: (...args: any[]) => any;
  sendAgentMessage: (agentId: string, content: string, threadId: string | null, attachments: any[], queueMode: string | null, chatJid: string) => Promise<any>;
  dismissedLiveWidgetKeysRef: RefBox<Set<string>>;
  setFloatingWidget: StateSetter<any>;
  getAgentStatus: (chatJid: string) => Promise<any>;
  getAgentContext: ((chatJid: string) => Promise<any>) | null;
  getAgentQueueState: (chatJid: string) => Promise<any>;
  getAgentModels: (chatJid: string) => Promise<any>;
  getActiveChatAgents: (chatJid: string) => Promise<any>;
  getChatBranches: (chatJid: string | null, options?: Record<string, unknown>) => Promise<any>;
  getTimeline: (chatJid: string, limit: number, offset?: number) => Promise<any>;
  rawPosts: any[];
  activeChatAgents: any[];
  currentChatBranches: any[];
  contextUsage: any;
  followupQueueItemsRef: RefBox<any[]>;
  activeModel: string | null;
  activeThinkingLevel: string | null;
  supportsThinking: boolean;
  isAgentTurnActive: boolean;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  handleMessageResponse: (response: any) => void;
}

export function composeSidepanelActionOptions(input: ComposeSidepanelActionOptionsInput) {
  return {
    currentChatJid: input.currentChatJid,
    currentRootChatJid: input.currentRootChatJid,
    isComposeBoxAgentActive: input.isComposeBoxAgentActive,
    showIntentToast: input.showIntentToast,
    setPendingExtensionPanelActions: input.setPendingExtensionPanelActions,
    refreshAutoresearchStatus: input.refreshAutoresearchStatus,
    stopAutoresearch: input.stopAutoresearch,
    dismissAutoresearch: input.dismissAutoresearch,
    streamSidePrompt: input.streamSidePrompt,
    btwAbortRef: input.btwAbortRef,
    btwSession: input.btwSession,
    setBtwSession: input.setBtwSession,
    plannotatorAbortRef: input.plannotatorAbortRef,
    plannotatorSession: input.plannotatorSession,
    setPlannotatorSession: input.setPlannotatorSession,
    openEditor: input.openEditor,
    sendAgentMessage: input.sendAgentMessage,
    handleMessageResponse: input.handleMessageResponse,
    dismissedLiveWidgetKeysRef: input.dismissedLiveWidgetKeysRef,
    setFloatingWidget: input.setFloatingWidget,
    getAgentStatus: input.getAgentStatus,
    getAgentContext: input.getAgentContext,
    getAgentQueueState: input.getAgentQueueState,
    getAgentModels: input.getAgentModels,
    getActiveChatAgents: input.getActiveChatAgents,
    getChatBranches: input.getChatBranches,
    getTimeline: input.getTimeline,
    rawPosts: input.rawPosts,
    activeChatAgents: input.activeChatAgents,
    currentChatBranches: input.currentChatBranches,
    contextUsage: input.contextUsage,
    followupQueueItemsRef: input.followupQueueItemsRef,
    activeModel: input.activeModel,
    activeThinkingLevel: input.activeThinkingLevel,
    supportsThinking: input.supportsThinking,
    isAgentTurnActive: input.isAgentTurnActive,
  };
}

interface ComposeBranchPaneActionOptionsInput {
  currentChatJid: string;
  chatOnlyMode: boolean;
  navigate: (url: string, options?: Record<string, unknown>) => void;
  setWorkspaceOpen: StateSetter<boolean>;
  currentBranchRecord: any;
  renameBranchInFlightRef: RefBox<boolean>;
  renameBranchLockUntilRef: RefBox<number>;
  getFormLock: () => number;
  setRenameBranchNameDraft: (value: string) => void;
  setIsRenameBranchFormOpen: (open: boolean) => void;
  setIsRenamingBranch: StateSetter<boolean>;
  renameChatBranch: (chatJid: string, name: string) => Promise<any>;
  refreshActiveChatAgents: () => Promise<void>;
  refreshCurrentChatBranches: () => Promise<void>;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  currentChatBranches: any[];
  activeChatAgents: any[];
  pruneChatBranch: (chatJid: string) => Promise<any>;
  purgeChatBranch: (chatJid: string) => Promise<any>;
  restoreChatBranch: (chatJid: string) => Promise<any>;
  branchLoaderMode: boolean;
  branchLoaderSourceChatJid: string;
  forkChatBranch: (chatJid: string) => Promise<any>;
  createRootChatSession: (agentName: string) => Promise<any>;
  setBranchLoaderState: StateSetter<any>;
  currentRootChatJid: string;
  isWebAppMode: boolean;
  getActiveChatAgents: (chatJid: string) => Promise<any>;
  getChatBranches: (chatJid: string | null, options?: Record<string, unknown>) => Promise<any>;
  setActiveChatAgents: StateSetter<any[]>;
  setCurrentChatBranches: StateSetter<any[]>;
  openEditor: (path: string, options?: Record<string, unknown>) => void;
  activateTab: (path: string) => void;
  tabStripActiveId: string | null;
  editorInstanceRef: RefBox<any>;
  dockInstanceRef: RefBox<any>;
  terminalTabPath: string;
  tabPaneOverrides: Map<string, string> | null;
  buildPaneDetachTransfer: (path: string) => { params: Record<string, string>; paneInstanceId: string; paneWindowId: string } | null;
  registerDetachedPaneWindow: (path: string, label?: string | null, handle?: any, params?: Record<string, string> | null) => void;
  dockVisible: boolean;
  resolveTab: (path: string) => { dirty?: boolean } | null | undefined;
  closeTab: (path: string) => void;
  setDockVisible: (visible: boolean) => void;
  editorOpen: boolean;
  shellElement: HTMLElement | null;
  editorWidthRef: RefBox<number>;
  dockHeightRef: RefBox<number>;
  sidebarWidthRef: RefBox<number>;
  readStoredNumber: (key: string, fallback?: number | null) => number | null;
}

export function composeBranchPaneActionOptions(input: ComposeBranchPaneActionOptionsInput) {
  return {
    setWorkspaceOpen: input.setWorkspaceOpen,
    currentChatJid: input.currentChatJid,
    chatOnlyMode: input.chatOnlyMode,
    navigate: input.navigate,
    currentBranchRecord: input.currentBranchRecord,
    renameBranchInFlightRef: input.renameBranchInFlightRef,
    renameBranchLockUntilRef: input.renameBranchLockUntilRef,
    getFormLock: input.getFormLock,
    setRenameBranchNameDraft: input.setRenameBranchNameDraft,
    setIsRenameBranchFormOpen: input.setIsRenameBranchFormOpen,
    setIsRenamingBranch: input.setIsRenamingBranch,
    renameChatBranch: input.renameChatBranch,
    refreshActiveChatAgents: input.refreshActiveChatAgents,
    refreshCurrentChatBranches: input.refreshCurrentChatBranches,
    showIntentToast: input.showIntentToast,
    currentChatBranches: input.currentChatBranches,
    activeChatAgents: input.activeChatAgents,
    pruneChatBranch: input.pruneChatBranch,
    purgeChatBranch: input.purgeChatBranch,
    restoreChatBranch: input.restoreChatBranch,
    branchLoaderMode: input.branchLoaderMode,
    branchLoaderSourceChatJid: input.branchLoaderSourceChatJid,
    forkChatBranch: input.forkChatBranch,
    createRootChatSession: input.createRootChatSession,
    setBranchLoaderState: input.setBranchLoaderState,
    currentRootChatJid: input.currentRootChatJid,
    isWebAppMode: input.isWebAppMode,
    getActiveChatAgents: input.getActiveChatAgents,
    getChatBranches: input.getChatBranches,
    setActiveChatAgents: input.setActiveChatAgents,
    setCurrentChatBranches: input.setCurrentChatBranches,
    openEditor: input.openEditor,
    activateTab: input.activateTab,
    tabStripActiveId: input.tabStripActiveId,
    editorInstanceRef: input.editorInstanceRef,
    dockInstanceRef: input.dockInstanceRef,
    terminalTabPath: input.terminalTabPath,
    tabPaneOverrides: input.tabPaneOverrides,
    buildPaneDetachTransfer: input.buildPaneDetachTransfer,
    registerDetachedPaneWindow: input.registerDetachedPaneWindow,
    dockVisible: input.dockVisible,
    resolveTab: input.resolveTab,
    closeTab: input.closeTab,
    setDockVisible: input.setDockVisible,
    editorOpen: input.editorOpen,
    shellElement: input.shellElement,
    editorWidthRef: input.editorWidthRef,
    dockHeightRef: input.dockHeightRef,
    sidebarWidthRef: input.sidebarWidthRef,
    readStoredNumber: input.readStoredNumber,
  };
}

interface ComposeShortcutOptionsInput {
  hasDockPanes: boolean;
  chatOnlyMode: boolean;
  toggleDock: () => void;
  toggleZenMode: () => void;
  exitZenMode: () => void;
  zenMode: boolean;
  activeChatAgents: any[];
  currentChatJid: string;
}

export function composeShortcutOptions(input: ComposeShortcutOptionsInput & { handleBranchPickerChange?: (nextChatJid: unknown) => void }) {
  return {
    hasDockPanes: input.hasDockPanes,
    chatOnlyMode: input.chatOnlyMode,
    toggleDock: input.toggleDock,
    toggleZenMode: input.toggleZenMode,
    exitZenMode: input.exitZenMode,
    zenMode: input.zenMode,
    previousChat: () => {
      const nextChatJid = resolveAdjacentSwipeChatJid({
        candidates: input.activeChatAgents,
        currentChatJid: input.currentChatJid,
        direction: 'prev',
      });
      if (nextChatJid) input.handleBranchPickerChange?.(nextChatJid);
    },
    nextChat: () => {
      const nextChatJid = resolveAdjacentSwipeChatJid({
        candidates: input.activeChatAgents,
        currentChatJid: input.currentChatJid,
        direction: 'next',
      });
      if (nextChatJid) input.handleBranchPickerChange?.(nextChatJid);
    },
  };
}

export interface UseMainAppActionCompositionOptions extends ComposeFollowupActionOptionsInput, ComposeSidepanelActionOptionsInput, ComposeBranchPaneActionOptionsInput, ComposeShortcutOptionsInput {}

export function useMainAppActionComposition(options: UseMainAppActionCompositionOptions) {
  const followupActions = useFollowupActionsOrchestration(composeFollowupActionOptions(options));
  const sidepanelActions = useSidepanelOrchestration(composeSidepanelActionOptions({
    ...options,
    handleMessageResponse: followupActions.handleMessageResponse,
  }));
  const branchPaneActions = useBranchPaneLifecycle(composeBranchPaneActionOptions(options));

  useAppShellShortcuts(composeShortcutOptions({
    ...options,
    handleBranchPickerChange: branchPaneActions.handleBranchPickerChange,
  }));

  return {
    followupActions,
    sidepanelActions,
    branchPaneActions,
  };
}
