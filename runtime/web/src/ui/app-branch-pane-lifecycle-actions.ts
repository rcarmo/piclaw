import { useCallback, useEffect } from '../vendor/preact-htm.js';
import { createEditorPopoutTransferPayload } from '../panes/editor-popout-transfer.js';
import { createPaneHostTransferPayload } from '../panes/pane-host-transfer.js';
import { registerPaneLiveTransfer } from '../panes/pane-live-transfer.js';
import { tabStore } from '../panes/index.js';
import { watchPaneOpenEvents } from './app-browser-events.js';
import {
  closeRenameBranchForm,
  openRenameBranchForm,
  pruneCurrentBranch,
  renameCurrentBranch,
  restoreBranch,
  runBranchLoader,
} from './app-branch-actions.js';
import {
  applyStoredPaneLayout,
  closeTransferredPaneSource,
  navigateToSelectedBranch,
  resolvePanePopoutTransfer,
} from './app-branch-pane-orchestration.js';
import {
  createSessionFromCompose,
  popOutChat,
  popOutPane,
} from './app-window-actions.js';

type StateSetter<T> = (next: T | ((prev: T) => T)) => void;

interface RefBox<T> {
  current: T;
}

interface PaneTransferInstanceLike {
  beforeDetachFromHost?: (context: { path?: string; target: 'popout' }) => Promise<void> | void;
  preparePopoutTransfer?: () => Promise<Record<string, string> | null> | Record<string, string> | null;
  afterAttachToHost?: (context: { path?: string; hostMode: 'main' | 'popout'; transferState?: Record<string, unknown> | null }) => Promise<void> | void;
  moveHost?: (container: HTMLElement, context: { path?: string; hostMode: 'main' | 'popout'; transferState?: Record<string, unknown> | null }) => Promise<boolean> | boolean;
  exportHostTransferState?: () => Record<string, unknown> | null;
  getContent?: () => string | undefined;
  isDirty?: () => boolean;
}

interface BranchRecordLike {
  chat_jid?: string;
}

export function toggleWorkspaceVisibility(setWorkspaceOpen: StateSetter<boolean>): void {
  setWorkspaceOpen((prev) => !prev);
}

export interface HandleBranchPickerChangeActionOptions {
  nextChatJid: unknown;
  currentChatJid: string;
  chatOnlyMode?: boolean;
  navigate: (url: string) => void;
  hasWindow?: boolean;
  currentHref?: string;
}

export function handleBranchPickerChangeAction(options: HandleBranchPickerChangeActionOptions): boolean {
  const {
    nextChatJid,
    currentChatJid,
    chatOnlyMode,
    navigate,
    hasWindow = typeof window !== 'undefined',
    currentHref = hasWindow ? window.location.href : 'http://localhost/',
  } = options;

  return navigateToSelectedBranch({
    hasWindow,
    nextChatJid,
    currentChatJid,
    chatOnlyMode,
    currentHref,
    navigate,
  });
}

export interface OpenRenameCurrentBranchFormActionOptions {
  currentBranchRecord: BranchRecordLike | null;
  renameBranchInFlight: boolean;
  renameBranchLockUntil: number;
  getFormLock: () => number;
  setRenameBranchNameDraft: (value: string) => void;
  setIsRenameBranchFormOpen: (open: boolean) => void;
  hasWindow?: boolean;
}

export function openRenameCurrentBranchFormAction(options: OpenRenameCurrentBranchFormActionOptions): boolean {
  const {
    currentBranchRecord,
    renameBranchInFlight,
    renameBranchLockUntil,
    getFormLock,
    setRenameBranchNameDraft,
    setIsRenameBranchFormOpen,
    hasWindow = typeof window !== 'undefined',
  } = options;

  return openRenameBranchForm({
    hasWindow,
    currentBranchRecord,
    renameBranchInFlight,
    renameBranchLockUntil,
    getFormLock,
    setRenameBranchNameDraft,
    setIsRenameBranchFormOpen,
  });
}

export function closeRenameCurrentBranchFormAction(options: {
  setIsRenameBranchFormOpen: (open: boolean) => void;
  setRenameBranchNameDraft: (value: string) => void;
}): void {
  closeRenameBranchForm(options);
}

export interface RenameCurrentBranchActionOptions {
  currentBranchRecord: BranchRecordLike | null;
  nextName: string;
  openRenameForm: () => void;
  renameBranchInFlightRef: RefBox<boolean>;
  renameBranchLockUntilRef: RefBox<number>;
  getFormLock: () => number;
  setIsRenamingBranch: StateSetter<boolean>;
  renameChatBranch: (chatJid: string, name: string) => Promise<any>;
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  closeRenameForm: () => void;
  hasWindow?: boolean;
}

export async function renameCurrentBranchAction(options: RenameCurrentBranchActionOptions): Promise<void> {
  const {
    hasWindow = typeof window !== 'undefined',
    ...rest
  } = options;

  await renameCurrentBranch({
    hasWindow,
    ...rest,
  });
}

export interface PruneCurrentBranchActionOptions {
  targetChatJid?: string | null;
  currentChatJid: string;
  currentBranchRecord: BranchRecordLike | null;
  currentChatBranches: any[];
  activeChatAgents: any[];
  pruneChatBranch: (chatJid: string) => Promise<any>;
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  chatOnlyMode?: boolean;
  navigate: (url: string) => void;
  hasWindow?: boolean;
  baseHref?: string;
}

export async function pruneCurrentBranchAction(options: PruneCurrentBranchActionOptions): Promise<void> {
  const {
    hasWindow = typeof window !== 'undefined',
    baseHref = hasWindow ? window.location.href : 'http://localhost/',
    ...rest
  } = options;

  await pruneCurrentBranch({
    hasWindow,
    baseHref,
    ...rest,
  });
}

export interface RestoreBranchActionOptions {
  targetChatJid: string;
  restoreChatBranch: (chatJid: string) => Promise<any>;
  currentChatBranches: any[];
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  chatOnlyMode?: boolean;
  navigate: (url: string) => void;
  hasWindow?: boolean;
  baseHref?: string;
}

export async function restoreBranchAction(options: RestoreBranchActionOptions): Promise<void> {
  const {
    hasWindow = typeof window !== 'undefined',
    baseHref = hasWindow ? window.location.href : 'http://localhost/',
    ...rest
  } = options;

  await restoreBranch({
    baseHref,
    ...rest,
  });
}

export interface RunBranchLoaderModeEffectOptions {
  branchLoaderMode: boolean;
  branchLoaderSourceChatJid: string;
  forkChatBranch: (chatJid: string) => Promise<any>;
  setBranchLoaderState: StateSetter<any>;
  navigate: (url: string, options?: Record<string, unknown>) => void;
  hasWindow?: boolean;
  baseHref?: string;
  runBranchLoaderImpl?: typeof runBranchLoader;
}

/**
 * Start the branch-loader async flow and return an effect cleanup that cancels stale writes.
 */
export function runBranchLoaderModeEffect(options: RunBranchLoaderModeEffectOptions): (() => void) | undefined {
  const {
    branchLoaderMode,
    branchLoaderSourceChatJid,
    forkChatBranch,
    setBranchLoaderState,
    navigate,
    hasWindow = typeof window !== 'undefined',
    baseHref = hasWindow ? window.location.href : 'http://localhost/',
    runBranchLoaderImpl = runBranchLoader,
  } = options;

  if (!branchLoaderMode || !hasWindow) {
    return undefined;
  }

  let cancelled = false;
  void runBranchLoaderImpl({
    branchLoaderSourceChatJid,
    forkChatBranch,
    setBranchLoaderState,
    navigate,
    baseHref,
    isCancelled: () => cancelled,
  });

  return () => {
    cancelled = true;
  };
}

export interface CreateSessionFromComposeActionOptions {
  currentChatJid: string;
  chatOnlyMode?: boolean;
  forkChatBranch: (chatJid: string) => Promise<any>;
  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  navigate: (url: string) => void;
  hasWindow?: boolean;
  baseHref?: string;
}

export async function createSessionFromComposeAction(options: CreateSessionFromComposeActionOptions): Promise<void> {
  const {
    hasWindow = typeof window !== 'undefined',
    baseHref = hasWindow ? window.location.href : 'http://localhost/',
    ...rest
  } = options;

  await createSessionFromCompose({
    baseHref,
    ...rest,
  });
}

export interface PopOutPaneActionOptions {
  isWebAppMode: boolean;
  path: string;
  label?: string | null;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  currentChatJid: string;
  activateTab: (path: string) => void;
  tabStripActiveId: string | null;
  editorInstanceRef: RefBox<PaneTransferInstanceLike | null>;
  dockInstanceRef: RefBox<PaneTransferInstanceLike | null>;
  terminalTabPath: string;
  tabPaneOverrides?: Map<string, string> | null;
  buildPaneDetachTransfer?: (path: string) => { params: Record<string, string>; paneInstanceId: string; paneWindowId: string } | null;
  registerDetachedPaneWindow?: (path: string, label?: string | null, handle?: any, params?: Record<string, string> | null) => void;
  dockVisible: boolean;
  resolveTab: (path: string) => { dirty?: boolean } | null | undefined;
  closeTab: (path: string) => void;
  setDockVisible: (visible: boolean) => void;
  hasWindow?: boolean;
  baseHref?: string;
}

export async function popOutPaneAction(options: PopOutPaneActionOptions): Promise<boolean> {
  const {
    isWebAppMode,
    path,
    label,
    showIntentToast,
    currentChatJid,
    activateTab,
    tabStripActiveId,
    editorInstanceRef,
    dockInstanceRef,
    terminalTabPath,
    tabPaneOverrides,
    buildPaneDetachTransfer,
    registerDetachedPaneWindow,
    dockVisible,
    resolveTab,
    closeTab,
    setDockVisible,
    hasWindow = typeof window !== 'undefined',
    baseHref = hasWindow ? window.location.href : 'http://localhost/',
  } = options;

  const detachTransfer = buildPaneDetachTransfer?.(path) || null;

  return await popOutPane({
    hasWindow,
    isWebAppMode,
    path,
    label,
    showIntentToast,
    currentChatJid,
    baseHref,
    resolveSourceTransfer: async (panePath: string) => {
      const sourceTransfer = await resolvePanePopoutTransfer({
        panePath,
        activateTab,
        getActiveTabId: () => tabStore.getActiveId(),
        tabStripActiveId,
        editorInstanceRef,
        dockInstanceRef,
        terminalTabPath,
        resolveTab,
        buildEditorPopoutTransfer: (panePath: string) => {
          if (!panePath || panePath === terminalTabPath) return null;
          const instance = editorInstanceRef.current;
          const content = typeof instance?.getContent === 'function' ? instance.getContent() : undefined;
          const isDirty = typeof instance?.isDirty === 'function' ? instance.isDirty() : false;
          const paneOverrideId = tabPaneOverrides instanceof Map ? (tabPaneOverrides.get(panePath) || null) : null;
          const viewState = tabStore.getViewState(panePath) || null;
          return createEditorPopoutTransferPayload({
            path: panePath,
            content: isDirty ? content : undefined,
            paneOverrideId,
            viewState,
          });
        },
      });
      const sourceInstance = panePath === terminalTabPath && !resolveTab(panePath)
        ? dockInstanceRef.current
        : editorInstanceRef.current;
      const exportedHostTransfer = typeof sourceInstance?.exportHostTransferState === 'function'
        ? sourceInstance.exportHostTransferState()
        : null;
      const hostTransfer = exportedHostTransfer
        ? createPaneHostTransferPayload({
          path: panePath,
          payload: exportedHostTransfer,
        })
        : null;
      if (
        detachTransfer?.paneInstanceId
        && detachTransfer?.paneWindowId
        && sourceInstance
        && panePath !== terminalTabPath
        && exportedHostTransfer?.kind !== 'terminal'
      ) {
        registerPaneLiveTransfer({
          panePath,
          paneInstanceId: detachTransfer.paneInstanceId,
          paneWindowId: detachTransfer.paneWindowId,
          instance: sourceInstance as any,
          releaseSourceHost: () => {
            if (panePath === terminalTabPath) {
              if (dockInstanceRef.current === sourceInstance) {
                dockInstanceRef.current = null;
              }
              if (editorInstanceRef.current === sourceInstance) {
                editorInstanceRef.current = null;
              }
              return;
            }
            if (editorInstanceRef.current === sourceInstance) {
              editorInstanceRef.current = null;
            }
          },
        });
      }
      return {
        ...(sourceTransfer || {}),
        ...(hostTransfer || {}),
        ...(detachTransfer?.params || {}),
      };
    },
    onPaneWindowOpened: registerDetachedPaneWindow
      ? (panePath: string, handle: any, params: Record<string, string> | null) => {
        registerDetachedPaneWindow(panePath, label, handle, params);
      }
      : undefined,
    closeSourcePaneIfTransferred: registerDetachedPaneWindow
      ? undefined
      : (panePath: string) => {
        closeTransferredPaneSource({
          panePath,
          terminalTabPath,
          dockVisible,
          resolveTab,
          closeTab,
          setDockVisible,
        });
      },
  });
}

export interface WatchPaneOpenEventBridgeOptions {
  openEditor: (path: string, options?: Record<string, unknown>) => void;
  popOutPane: (path: string, label?: string | null) => void;
  watchPaneOpenEventsImpl?: typeof watchPaneOpenEvents;
}

export function watchPaneOpenEventBridge(options: WatchPaneOpenEventBridgeOptions): (() => void) | undefined {
  const {
    openEditor,
    popOutPane,
    watchPaneOpenEventsImpl = watchPaneOpenEvents,
  } = options;

  return watchPaneOpenEventsImpl({
    openTab: (path, label) => openEditor(path, label ? { label } : undefined),
    popOutPane: (path, label) => {
      popOutPane(path, label);
    },
  });
}

export interface PopOutChatActionOptions {
  isWebAppMode: boolean;
  currentChatJid: string;
  currentRootChatJid: string;
  forkChatBranch: (chatJid: string) => Promise<any>;
  getActiveChatAgents: (chatJid: string) => Promise<any>;
  getChatBranches: (chatJid: string) => Promise<any>;
  setActiveChatAgents: StateSetter<any[]>;
  setCurrentChatBranches: StateSetter<any[]>;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;
  hasWindow?: boolean;
  baseHref?: string;
}

export async function popOutChatAction(options: PopOutChatActionOptions): Promise<void> {
  const {
    hasWindow = typeof window !== 'undefined',
    baseHref = hasWindow ? window.location.href : 'http://localhost/',
    ...rest
  } = options;

  await popOutChat({
    hasWindow,
    baseHref,
    ...rest,
  });
}

export interface ApplyStoredPaneLayoutActionOptions {
  editorOpen: boolean;
  shellElement: HTMLElement | null;
  editorWidthRef: RefBox<number>;
  dockHeightRef: RefBox<number>;
  sidebarWidthRef: RefBox<number>;
  readStoredNumber: (key: string, fallback?: number | null) => number | null;
  hasWindow?: boolean;
}

export function applyStoredPaneLayoutAction(options: ApplyStoredPaneLayoutActionOptions): void {
  const {
    hasWindow = typeof window !== 'undefined',
    ...rest
  } = options;

  applyStoredPaneLayout({
    hasWindow,
    ...rest,
  });
}

export interface UseBranchPaneLifecycleOptions {
  setWorkspaceOpen: StateSetter<boolean>;
  currentChatJid: string;
  chatOnlyMode?: boolean;
  navigate: (url: string, options?: Record<string, unknown>) => void;

  currentBranchRecord: BranchRecordLike | null;
  renameBranchInFlightRef: RefBox<boolean>;
  renameBranchLockUntilRef: RefBox<number>;
  getFormLock: () => number;
  setRenameBranchNameDraft: (value: string) => void;
  setIsRenameBranchFormOpen: (open: boolean) => void;
  setIsRenamingBranch: StateSetter<boolean>;
  renameChatBranch: (chatJid: string, name: string) => Promise<any>;

  refreshActiveChatAgents: () => void;
  refreshCurrentChatBranches: () => void;
  showIntentToast: (title: string, detail?: string | null, kind?: string, durationMs?: number) => void;

  currentChatBranches: any[];
  activeChatAgents: any[];
  pruneChatBranch: (chatJid: string) => Promise<any>;
  restoreChatBranch: (chatJid: string) => Promise<any>;

  branchLoaderMode: boolean;
  branchLoaderSourceChatJid: string;
  forkChatBranch: (chatJid: string) => Promise<any>;
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
  editorInstanceRef: RefBox<PaneTransferInstanceLike | null>;
  dockInstanceRef: RefBox<PaneTransferInstanceLike | null>;
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

export function useBranchPaneLifecycle(options: UseBranchPaneLifecycleOptions) {
  const {
    setWorkspaceOpen,
    currentChatJid,
    chatOnlyMode,
    navigate,
    currentBranchRecord,
    renameBranchInFlightRef,
    renameBranchLockUntilRef,
    getFormLock,
    setRenameBranchNameDraft,
    setIsRenameBranchFormOpen,
    setIsRenamingBranch,
    renameChatBranch,
    refreshActiveChatAgents,
    refreshCurrentChatBranches,
    showIntentToast,
    currentChatBranches,
    activeChatAgents,
    pruneChatBranch,
    restoreChatBranch,
    branchLoaderMode,
    branchLoaderSourceChatJid,
    forkChatBranch,
    setBranchLoaderState,
    currentRootChatJid,
    isWebAppMode,
    getActiveChatAgents,
    getChatBranches,
    setActiveChatAgents,
    setCurrentChatBranches,
    openEditor,
    activateTab,
    tabStripActiveId,
    editorInstanceRef,
    dockInstanceRef,
    terminalTabPath,
    tabPaneOverrides,
    buildPaneDetachTransfer,
    registerDetachedPaneWindow,
    dockVisible,
    resolveTab,
    closeTab,
    setDockVisible,
    editorOpen,
    shellElement,
    editorWidthRef,
    dockHeightRef,
    sidebarWidthRef,
    readStoredNumber,
  } = options;

  const toggleWorkspace = useCallback(() => {
    toggleWorkspaceVisibility(setWorkspaceOpen);
  }, [setWorkspaceOpen]);

  const handleBranchPickerChange = useCallback((nextChatJid: unknown) => {
    handleBranchPickerChangeAction({
      nextChatJid,
      currentChatJid,
      chatOnlyMode,
      navigate,
    });
  }, [chatOnlyMode, currentChatJid, navigate]);

  const openRenameCurrentBranchForm = useCallback(() => {
    openRenameCurrentBranchFormAction({
      currentBranchRecord,
      renameBranchInFlight: renameBranchInFlightRef.current,
      renameBranchLockUntil: renameBranchLockUntilRef.current,
      getFormLock,
      setRenameBranchNameDraft,
      setIsRenameBranchFormOpen,
    });
  }, [currentBranchRecord, getFormLock, renameBranchInFlightRef, renameBranchLockUntilRef, setIsRenameBranchFormOpen, setRenameBranchNameDraft]);

  const closeRenameCurrentBranchForm = useCallback(() => {
    closeRenameCurrentBranchFormAction({
      setIsRenameBranchFormOpen,
      setRenameBranchNameDraft,
    });
  }, [setIsRenameBranchFormOpen, setRenameBranchNameDraft]);

  const handleRenameCurrentBranch = useCallback(async (nextName: string) => {
    await renameCurrentBranchAction({
      currentBranchRecord,
      nextName,
      openRenameForm: openRenameCurrentBranchForm,
      renameBranchInFlightRef,
      renameBranchLockUntilRef,
      getFormLock,
      setIsRenamingBranch,
      renameChatBranch,
      refreshActiveChatAgents,
      refreshCurrentChatBranches,
      showIntentToast,
      closeRenameForm: closeRenameCurrentBranchForm,
    });
  }, [closeRenameCurrentBranchForm, currentBranchRecord, getFormLock, openRenameCurrentBranchForm, refreshActiveChatAgents, refreshCurrentChatBranches, renameBranchInFlightRef, renameBranchLockUntilRef, renameChatBranch, setIsRenamingBranch, showIntentToast]);

  const handlePruneCurrentBranch = useCallback(async (targetChatJid: string | null = null) => {
    await pruneCurrentBranchAction({
      targetChatJid,
      currentChatJid,
      currentBranchRecord,
      currentChatBranches,
      activeChatAgents,
      pruneChatBranch,
      refreshActiveChatAgents,
      refreshCurrentChatBranches,
      showIntentToast,
      chatOnlyMode,
      navigate,
    });
  }, [activeChatAgents, chatOnlyMode, currentBranchRecord, currentChatBranches, currentChatJid, navigate, pruneChatBranch, refreshActiveChatAgents, refreshCurrentChatBranches, showIntentToast]);

  const handleRestoreBranch = useCallback(async (targetChatJid: string) => {
    await restoreBranchAction({
      targetChatJid,
      restoreChatBranch,
      currentChatBranches,
      refreshActiveChatAgents,
      refreshCurrentChatBranches,
      showIntentToast,
      chatOnlyMode,
      navigate,
    });
  }, [chatOnlyMode, currentChatBranches, navigate, refreshActiveChatAgents, refreshCurrentChatBranches, restoreChatBranch, showIntentToast]);

  useEffect(() => runBranchLoaderModeEffect({
    branchLoaderMode,
    branchLoaderSourceChatJid,
    forkChatBranch,
    setBranchLoaderState,
    navigate,
  }), [branchLoaderMode, branchLoaderSourceChatJid, forkChatBranch, navigate, setBranchLoaderState]);

  const handleCreateSessionFromCompose = useCallback(async () => {
    await createSessionFromComposeAction({
      currentChatJid,
      chatOnlyMode,
      forkChatBranch,
      refreshActiveChatAgents,
      refreshCurrentChatBranches,
      showIntentToast,
      navigate,
    });
  }, [chatOnlyMode, currentChatJid, forkChatBranch, navigate, refreshActiveChatAgents, refreshCurrentChatBranches, showIntentToast]);

  const handlePopOutPane = useCallback(async (path: string, label?: string | null) => {
    return await popOutPaneAction({
      isWebAppMode,
      path,
      label,
      showIntentToast,
      currentChatJid,
      activateTab,
      tabStripActiveId,
      editorInstanceRef,
      dockInstanceRef,
      terminalTabPath,
      tabPaneOverrides,
      buildPaneDetachTransfer,
      registerDetachedPaneWindow,
      dockVisible,
      resolveTab,
      closeTab,
      setDockVisible,
    });
  }, [activateTab, buildPaneDetachTransfer, closeTab, currentChatJid, dockInstanceRef, dockVisible, editorInstanceRef, isWebAppMode, registerDetachedPaneWindow, resolveTab, setDockVisible, showIntentToast, tabPaneOverrides, tabStripActiveId, terminalTabPath]);

  useEffect(() => watchPaneOpenEventBridge({
    openEditor,
    popOutPane: (path, label) => {
      void handlePopOutPane(path, label);
    },
  }), [handlePopOutPane, openEditor]);

  const handlePopOutChat = useCallback(async () => {
    await popOutChatAction({
      isWebAppMode,
      currentChatJid,
      currentRootChatJid,
      forkChatBranch,
      getActiveChatAgents,
      getChatBranches,
      setActiveChatAgents,
      setCurrentChatBranches,
      showIntentToast,
    });
  }, [currentChatJid, currentRootChatJid, forkChatBranch, getActiveChatAgents, getChatBranches, isWebAppMode, setActiveChatAgents, setCurrentChatBranches, showIntentToast]);

  useEffect(() => {
    applyStoredPaneLayoutAction({
      editorOpen,
      shellElement,
      editorWidthRef,
      dockHeightRef,
      sidebarWidthRef,
      readStoredNumber,
    });
  }, [dockHeightRef, editorOpen, editorWidthRef, readStoredNumber, shellElement, sidebarWidthRef]);

  return {
    toggleWorkspace,
    handleBranchPickerChange,
    openRenameCurrentBranchForm,
    closeRenameCurrentBranchForm,
    handleRenameCurrentBranch,
    handlePruneCurrentBranch,
    handleRestoreBranch,
    handleCreateSessionFromCompose,
    handlePopOutPane,
    handlePopOutChat,
  };
}
