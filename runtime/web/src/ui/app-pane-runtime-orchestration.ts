import { useCallback, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import {
  consumeEditorPopoutState,
  consumePanePopoutTransferToken,
  createEditorPopoutTransferPayload,
  type EditorPopoutTransferState,
} from '../panes/editor-popout-transfer.js';
import {
  createPaneDetachTransferParams,
  generatePaneDetachId,
  hasPaneDetachTransferState,
  readPaneDetachTransferState,
  type PaneDetachTransferState,
} from '../panes/pane-detach-transfer.js';
import {
  createPendingPaneOwnershipState,
  finalizePendingPaneOwnership,
  matchesPaneDetachClaim,
  type PendingPaneOwnershipState,
} from '../panes/pane-detach-state.js';
import {
  consumePaneHostTransferFromLocation,
  consumePaneHostTransferState,
  createPaneHostTransferPayload,
  type PaneHostTransferEnvelope,
} from '../panes/pane-host-transfer.js';
import { claimPaneLiveTransfer, clearPaneLiveTransferForPath, registerPaneLiveTransfer } from '../panes/pane-live-transfer.js';
import { paneRegistry, tabStore } from '../panes/index.js';
import {
  getPanePopoutTitle,
  hasPanePopoutMenuActions,
  isVncPanePopoutPath,
  resolveActivePaneOverrideId,
  resolveActivePaneTab,
  shouldHidePanePopoutControls,
  shouldShowEditorPaneContainer,
} from './app-pane-state.js';
import { closeWindowBestEffort, postMessageToWindowBestEffort } from './window-bridge-safety.js';

interface UsePaneRuntimeOrchestrationOptions {
  panePopoutMode: boolean;
  panePopoutPath: string;
  panePopoutLabel: string;
  chatOnlyMode: boolean;
  editorOpen: boolean;
  tabStripTabs: any[];
  tabStripActiveId: string | null;
  previewTabs: Set<string>;
  diffTabs: Set<string>;
  tabPaneOverrides: Map<string, string> | Record<string, string>;
  terminalTabPath: string;
  vncTabPrefix: string;
  openEditor: (path: string, options?: Record<string, unknown>) => void;
  closeEditor: () => void;
  getWorkspaceFile: (path: string, maxBytes: number, mode: string) => Promise<any>;
}

export function shouldRetainPaneDetachState(options: {
  panePath: string;
  openTabIds: Set<string>;
  pendingDetachedTabPaths?: Set<string>;
  detachedTabPaths?: Set<string>;
  terminalTabPath: string;
  hasPendingDetachedDockPane?: boolean;
  hasDetachedDockPane?: boolean;
}): boolean {
  const panePath = typeof options?.panePath === 'string' ? options.panePath.trim() : '';
  if (!panePath) return false;
  if (options.openTabIds?.has(panePath)) return true;
  if (options.pendingDetachedTabPaths?.has?.(panePath)) return true;
  if (options.detachedTabPaths?.has?.(panePath)) return true;
  if (panePath === options.terminalTabPath) {
    return Boolean(options.hasPendingDetachedDockPane || options.hasDetachedDockPane);
  }
  return false;
}

export function removeSourcePaneAfterDetachClaim(options: {
  panePath: string;
  terminalTabPath: string;
  closeTab?: (panePath: string) => void;
  setDockVisible?: (visible: boolean) => void;
  sourceHost?: 'tab' | 'dock' | null;
}): void {
  const panePath = typeof options?.panePath === 'string' ? options.panePath.trim() : '';
  if (!panePath) return;
  const sourceHost = options?.sourceHost === 'dock' ? 'dock' : 'tab';
  if (panePath === options.terminalTabPath && sourceHost === 'dock') {
    options.setDockVisible?.(false);
    return;
  }
  options.closeTab?.(panePath);
}

interface DetachedPaneState {
  panePath: string;
  paneInstanceId: string;
  ownerWindowId: string;
  detachedAt: string;
  label?: string | null;
}

interface ReattachPaneOptions {
  closeDetachedWindow?: boolean;
}

const TERMINAL_CLOSE_RECOVERY_DELAY_MS = 400;

function normalizeChangedPaths(update: any): string[] {
  const changedPaths = Array.isArray(update?.changed_paths)
    ? update.changed_paths
      .map((value: unknown) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean)
    : [];

  if (changedPaths.length > 0) {
    return changedPaths;
  }

  const fallbackPath = typeof update?.path === 'string' ? update.path.trim() : '';
  return fallbackPath ? [fallbackPath] : ['.'];
}

export function isWorkspaceUpdateRelevantForPath(activePath: string, updates: unknown): boolean {
  if (!activePath) return false;
  if (!Array.isArray(updates) || updates.length === 0) return true;

  return updates.some((update) => {
    const changedPaths = normalizeChangedPaths(update);
    return changedPaths.some((changedPath) => changedPath === '.' || changedPath === activePath);
  });
}

export async function invokePaneAfterAttachToHost(
  instance: { afterAttachToHost?: (context: { path?: string; hostMode: 'main' | 'popout'; transferState?: Record<string, unknown> | null }) => Promise<void> | void } | null | undefined,
  context: { path?: string; hostMode: 'main' | 'popout'; transferState?: Record<string, unknown> | null },
): Promise<void> {
  if (typeof instance?.afterAttachToHost !== 'function') return;
  await instance.afterAttachToHost(context);
}

export function canRecoverDetachedPaneInForeground(runtimeDocument: Document | null | undefined = typeof document !== 'undefined' ? document : null): boolean {
  if (!runtimeDocument) return true;
  const visibilityState = typeof runtimeDocument.visibilityState === 'string' ? runtimeDocument.visibilityState : '';
  return !visibilityState || visibilityState === 'visible';
}

export function isLikelySafariBrowser(runtimeNavigator: Navigator | null | undefined = typeof navigator !== 'undefined' ? navigator : null): boolean {
  if (!runtimeNavigator) return false;
  const userAgent = String(runtimeNavigator.userAgent || '');
  const vendor = String((runtimeNavigator as any).vendor || '');
  const isAppleWebKit = /AppleWebKit/i.test(userAgent);
  const isSafariToken = /Safari/i.test(userAgent);
  const isExcluded = /Chrome|Chromium|CriOS|EdgiOS|EdgA|Edg\//i.test(userAgent);
  const isFirefoxiOS = /FxiOS/i.test(userAgent);
  return isAppleWebKit && (vendor.includes('Apple') || isSafariToken) && !isExcluded && !isFirefoxiOS;
}

export function shouldDelayPaneReattachAfterWindowClose(options: {
  panePath: string;
  terminalTabPath: string;
  allowLiveTransfer?: boolean | null;
  reason?: 'message' | 'closed-window' | null;
}): boolean {
  const panePath = typeof options?.panePath === 'string' ? options.panePath.trim() : '';
  if (!panePath) return false;
  if (panePath !== options.terminalTabPath) return false;
  const reason = options?.reason === 'message' ? 'message' : 'closed-window';
  if (reason === 'closed-window') return true;
  return options?.allowLiveTransfer === false;
}

export function shouldRequireManualTerminalCloseRecovery(options: {
  panePath: string;
  terminalTabPath: string;
  allowLiveTransfer?: boolean | null;
  reason?: 'message' | 'closed-window' | null;
  runtimeNavigator?: Navigator | null;
}): boolean {
  if (!shouldDelayPaneReattachAfterWindowClose(options)) return false;
  return isLikelySafariBrowser(options?.runtimeNavigator);
}

export function shouldDisableTerminalReattach(options: {
  panePath: string;
  terminalTabPath: string;
  runtimeNavigator?: Navigator | null;
}): boolean {
  const panePath = typeof options?.panePath === 'string' ? options.panePath.trim() : '';
  if (!panePath || panePath !== options?.terminalTabPath) return false;
  return isLikelySafariBrowser(options?.runtimeNavigator);
}

function shouldUseLivePaneTransfer(options: {
  panePath: string;
  terminalTabPath: string;
}): boolean {
  const panePath = typeof options?.panePath === 'string' ? options.panePath.trim() : '';
  if (!panePath) return false;
  return panePath !== options?.terminalTabPath;
}

export interface PanePopoutReattachRequestMessage {
  type: 'piclaw-pane-reattach-request';
  panePath: string;
  paneInstanceId?: string;
  editorPopoutToken?: string;
  paneTransferToken?: string;
  paneTransferPayload?: Record<string, unknown>;
  allowLiveTransfer?: boolean;
}

export function buildPanePopoutReattachRequestMessage(options: {
  panePath: string;
  paneInstanceId?: string | null;
  paneOverrideId?: string | null;
  terminalTabPath: string;
  viewState?: Record<string, unknown> | null;
  allowLiveTransfer?: boolean;
  instance?: {
    exportHostTransferState?: () => Record<string, unknown> | null;
    getContent?: () => string | undefined;
    isDirty?: () => boolean;
  } | null;
  runtime?: any;
  nowMs?: number;
}): PanePopoutReattachRequestMessage | null {
  const panePath = typeof options?.panePath === 'string' ? options.panePath.trim() : '';
  if (!panePath) return null;

  const runtime = options?.runtime ?? globalThis;
  const nowMs = typeof options?.nowMs === 'number' ? options.nowMs : Date.now();
  const paneInstanceId = typeof options?.paneInstanceId === 'string' ? options.paneInstanceId.trim() : '';
  const paneOverrideId = typeof options?.paneOverrideId === 'string' ? options.paneOverrideId.trim() : '';
  const terminalTabPath = typeof options?.terminalTabPath === 'string' ? options.terminalTabPath : 'piclaw://terminal';
  const allowLiveTransfer = options?.allowLiveTransfer !== false;
  const instance = options?.instance || null;
  const exportedHostTransfer = typeof instance?.exportHostTransferState === 'function'
    ? instance.exportHostTransferState()
    : null;
  const useInlineHostTransfer = panePath === terminalTabPath;
  const paneTransfer = exportedHostTransfer && !useInlineHostTransfer
    ? createPaneHostTransferPayload({
      path: panePath,
      payload: exportedHostTransfer,
    }, runtime, nowMs)
    : null;

  let editorTransfer: Record<string, string> | null = null;
  if (panePath !== terminalTabPath) {
    const exportedMtime = exportedHostTransfer && typeof exportedHostTransfer === 'object'
      ? (typeof (exportedHostTransfer as Record<string, unknown>).mtime === 'string'
        ? (exportedHostTransfer as Record<string, unknown>).mtime as string
        : ((exportedHostTransfer as Record<string, unknown>).mtime === null ? null : undefined))
      : undefined;
    const isDirty = typeof instance?.isDirty === 'function' ? instance.isDirty() : false;
    const content = typeof instance?.getContent === 'function' ? instance.getContent() : undefined;
    editorTransfer = createEditorPopoutTransferPayload({
      path: panePath,
      content: isDirty ? content : undefined,
      mtime: exportedMtime,
      paneOverrideId: paneOverrideId || null,
      viewState: options?.viewState || null,
    }, runtime, nowMs);
  }

  return {
    type: 'piclaw-pane-reattach-request',
    panePath,
    ...(paneInstanceId ? { paneInstanceId } : {}),
    ...(editorTransfer?.editor_popout ? { editorPopoutToken: editorTransfer.editor_popout } : {}),
    ...(paneTransfer?.pane_transfer ? { paneTransferToken: paneTransfer.pane_transfer } : {}),
    ...(useInlineHostTransfer && exportedHostTransfer ? { paneTransferPayload: exportedHostTransfer } : {}),
    ...(allowLiveTransfer ? {} : { allowLiveTransfer: false }),
  };
}

export function consumePanePopoutReattachRequestMessage(options: {
  payload: any;
  runtime?: any;
  nowMs?: number;
}): {
  panePath: string;
  paneInstanceId: string | null;
  editorTransfer: EditorPopoutTransferState | null;
  hostTransfer: PaneHostTransferEnvelope | null;
  allowLiveTransfer: boolean;
} | null {
  const panePath = typeof options?.payload?.panePath === 'string' ? options.payload.panePath.trim() : '';
  if (!panePath) return null;
  const runtime = options?.runtime ?? globalThis;
  const nowMs = typeof options?.nowMs === 'number' ? options.nowMs : Date.now();
  const paneInstanceId = typeof options?.payload?.paneInstanceId === 'string' && options.payload.paneInstanceId.trim()
    ? options.payload.paneInstanceId.trim()
    : null;
  const editorPopoutToken = typeof options?.payload?.editorPopoutToken === 'string' ? options.payload.editorPopoutToken.trim() : '';
  const paneTransferToken = typeof options?.payload?.paneTransferToken === 'string' ? options.payload.paneTransferToken.trim() : '';
  const inlineHostTransferPayload = options?.payload?.paneTransferPayload && typeof options.payload.paneTransferPayload === 'object' && !Array.isArray(options.payload.paneTransferPayload)
    ? options.payload.paneTransferPayload as Record<string, unknown>
    : null;

  const editorTransfer = editorPopoutToken
    ? consumeEditorPopoutState(editorPopoutToken, runtime, nowMs)
    : null;
  const hostTransfer = inlineHostTransferPayload
    ? { panePath, path: panePath, payload: inlineHostTransferPayload, capturedAt: nowMs }
    : (paneTransferToken
      ? consumePaneHostTransferState(paneTransferToken, runtime, nowMs)
      : null);

  return {
    panePath,
    paneInstanceId,
    editorTransfer: editorTransfer?.path === panePath ? editorTransfer : null,
    hostTransfer: hostTransfer?.path === panePath ? hostTransfer : null,
    allowLiveTransfer: options?.payload?.allowLiveTransfer !== false,
  };
}

export function usePaneRuntimeOrchestration(options: UsePaneRuntimeOrchestrationOptions) {
  const {
    panePopoutMode,
    panePopoutPath,
    panePopoutLabel,
    chatOnlyMode,
    editorOpen,
    tabStripTabs,
    tabStripActiveId,
    previewTabs,
    diffTabs,
    tabPaneOverrides,
    terminalTabPath,
    vncTabPrefix,
    openEditor,
    closeEditor,
    getWorkspaceFile,
  } = options;

  const editorContainerRef = useRef<any>(null);
  const editorInstanceRef = useRef<any>(null);
  const dockContainerRef = useRef<any>(null);
  const dockInstanceRef = useRef<any>(null);

  const pendingEditorPopoutTransferRef = useRef<EditorPopoutTransferState | null>((() => {
    if (!panePopoutMode) return null;
    const token = consumePanePopoutTransferToken('editor_popout');
    return consumeEditorPopoutState(token);
  })());
  const pendingPaneHostTransferRef = useRef<PaneHostTransferEnvelope | null>((() => {
    if (!panePopoutMode) return null;
    return consumePaneHostTransferFromLocation();
  })());
  const paneDetachTransferRef = useRef<PaneDetachTransferState>(readPaneDetachTransferState({
    search: typeof window !== 'undefined' ? window.location.search : '',
    panePath: panePopoutPath,
    paneLabel: panePopoutLabel,
  }));
  const currentWindowIdRef = useRef<string>(paneDetachTransferRef.current.paneWindowId || generatePaneDetachId('pane-window'));
  const pendingReattachEditorTransfersRef = useRef<Map<string, EditorPopoutTransferState>>(new Map());
  const pendingReattachPaneHostTransfersRef = useRef<Map<string, PaneHostTransferEnvelope>>(new Map());
  const pendingReattachPaneSourceWindowsRef = useRef<Map<string, any>>(new Map());
  const pendingReattachPaneClaimsRef = useRef<Map<string, { panePath: string; paneInstanceId: string; paneWindowId: string }>>(new Map());
  const panePopoutReattachSentRef = useRef(false);
  const tabPaneInstanceIdsRef = useRef<Map<string, string>>(new Map());
  const dockPaneInstanceIdRef = useRef<string>(generatePaneDetachId('pane-instance'));
  const detachedWindowHandlesRef = useRef<Map<string, any>>(new Map());
  const deferredPaneCloseRecoveryRef = useRef<Map<string, number>>(new Map());
  const manualPaneCloseRecoveryRef = useRef<Set<string>>(new Set());
  const [pendingDetachedTabs, setPendingDetachedTabs] = useState<Map<string, PendingPaneOwnershipState>>(() => new Map());
  const pendingDetachedTabsRef = useRef(pendingDetachedTabs);
  pendingDetachedTabsRef.current = pendingDetachedTabs;
  const [detachedTabs, setDetachedTabs] = useState<Map<string, DetachedPaneState>>(() => new Map());
  const detachedTabsRef = useRef(detachedTabs);
  detachedTabsRef.current = detachedTabs;
  const [pendingDetachedDockPane, setPendingDetachedDockPane] = useState<PendingPaneOwnershipState | null>(null);
  const pendingDetachedDockPaneRef = useRef<PendingPaneOwnershipState | null>(pendingDetachedDockPane);
  pendingDetachedDockPaneRef.current = pendingDetachedDockPane;
  const [detachedDockPane, setDetachedDockPane] = useState<DetachedPaneState | null>(null);
  const detachedDockPaneRef = useRef<DetachedPaneState | null>(detachedDockPane);
  detachedDockPaneRef.current = detachedDockPane;

  const hasDockPanes = paneRegistry.getDockPanes().length > 0;
  const [dockVisible, setDockVisible] = useState(false);
  const toggleDock = useCallback(() => setDockVisible((visible) => !visible), []);

  const openTerminalTab = useCallback(() => {
    openEditor(terminalTabPath, { label: 'Terminal' });
  }, [openEditor, terminalTabPath]);

  const openVncTab = useCallback(() => {
    openEditor(vncTabPrefix, { label: 'VNC' });
  }, [openEditor, vncTabPrefix]);

  const ensurePaneInstanceId = useCallback((panePath: string) => {
    const normalizedPath = typeof panePath === 'string' ? panePath.trim() : '';
    if (!normalizedPath) return generatePaneDetachId('pane-instance');
    const useDockInstanceId = normalizedPath === terminalTabPath && !tabStore.get(normalizedPath);
    if (useDockInstanceId) {
      if (!dockPaneInstanceIdRef.current) {
        dockPaneInstanceIdRef.current = generatePaneDetachId('pane-instance');
      }
      return dockPaneInstanceIdRef.current;
    }
    const existing = tabPaneInstanceIdsRef.current.get(normalizedPath);
    if (existing) return existing;
    const next = generatePaneDetachId('pane-instance');
    tabPaneInstanceIdsRef.current.set(normalizedPath, next);
    return next;
  }, [terminalTabPath]);

  const activeDetachedTab = useMemo(
    () => (!panePopoutMode && tabStripActiveId ? detachedTabs.get(tabStripActiveId) || null : null),
    [detachedTabs, panePopoutMode, tabStripActiveId],
  );
  const dockPaneDetached = !panePopoutMode ? detachedDockPane : null;

  const clearPendingDetachedPane = useCallback((panePath: string) => {
    if (!panePath) return;
    clearPaneLiveTransferForPath(panePath);
    deferredPaneCloseRecoveryRef.current.delete(panePath);
    manualPaneCloseRecoveryRef.current.delete(panePath);
    setPendingDetachedDockPane((current) => (current?.panePath === panePath ? null : current));
    setPendingDetachedTabs((current) => {
      if (!current.has(panePath)) return current;
      const next = new Map(current);
      next.delete(panePath);
      return next;
    });
  }, []);

  const clearDetachedPane = useCallback((panePath: string) => {
    if (!panePath) return;
    detachedWindowHandlesRef.current.delete(panePath);
    deferredPaneCloseRecoveryRef.current.delete(panePath);
    manualPaneCloseRecoveryRef.current.delete(panePath);
    clearPendingDetachedPane(panePath);
    setDetachedDockPane((current) => (current?.panePath === panePath ? null : current));
    setDetachedTabs((current) => {
      if (!current.has(panePath)) return current;
      const next = new Map(current);
      next.delete(panePath);
      return next;
    });
  }, [clearPendingDetachedPane]);

  const reattachPane = useCallback((panePath: string, options: ReattachPaneOptions = {}) => {
    const normalizedPath = typeof panePath === 'string' ? panePath.trim() : '';
    if (!normalizedPath) return false;
    if (shouldDisableTerminalReattach({ panePath: normalizedPath, terminalTabPath })) return false;

    const handle = detachedWindowHandlesRef.current.get(normalizedPath);
    const wasDetachedTab = Boolean(detachedTabsRef.current.get(normalizedPath));
    const wasDetachedDockPane = Boolean(detachedDockPaneRef.current?.panePath === normalizedPath);
    clearDetachedPane(normalizedPath);

    if (normalizedPath === terminalTabPath && wasDetachedDockPane && !wasDetachedTab) {
      setDockVisible(true);
    } else if (normalizedPath === terminalTabPath && wasDetachedTab) {
      openEditor(normalizedPath, { label: 'Terminal' });
    } else {
      const activeTab = tabStore.get(normalizedPath);
      if (activeTab) {
        tabStore.activate(normalizedPath);
      } else {
        openEditor(normalizedPath);
      }
    }

    if (options.closeDetachedWindow !== false && handle && typeof handle.close === 'function') {
      closeWindowBestEffort(handle);
    }

    return true;
  }, [clearDetachedPane, openEditor, setDockVisible, terminalTabPath]);

  const flushDeferredPaneCloseRecoveries = useCallback(() => {
    if (panePopoutMode) return;
    if (!canRecoverDetachedPaneInForeground()) return;
    const now = Date.now();
    for (const [panePath, readyAt] of deferredPaneCloseRecoveryRef.current.entries()) {
      if (readyAt > now) continue;
      deferredPaneCloseRecoveryRef.current.delete(panePath);
      reattachPane(panePath, { closeDetachedWindow: false });
    }
  }, [panePopoutMode, reattachPane]);

  const schedulePaneCloseRecoveryReattach = useCallback((panePath: string, options: {
    allowLiveTransfer?: boolean | null;
    reason?: 'message' | 'closed-window' | null;
  } = {}) => {
    const normalizedPath = typeof panePath === 'string' ? panePath.trim() : '';
    if (!normalizedPath) return false;
    const closeRecoveryOptions = {
      panePath: normalizedPath,
      terminalTabPath,
      allowLiveTransfer: options.allowLiveTransfer,
      reason: options.reason,
    };
    if (shouldRequireManualTerminalCloseRecovery(closeRecoveryOptions)) {
      detachedWindowHandlesRef.current.delete(normalizedPath);
      deferredPaneCloseRecoveryRef.current.delete(normalizedPath);
      manualPaneCloseRecoveryRef.current.add(normalizedPath);
      return true;
    }
    if (!shouldDelayPaneReattachAfterWindowClose(closeRecoveryOptions)) {
      return reattachPane(normalizedPath, { closeDetachedWindow: false });
    }
    deferredPaneCloseRecoveryRef.current.set(normalizedPath, Date.now() + TERMINAL_CLOSE_RECOVERY_DELAY_MS);
    flushDeferredPaneCloseRecoveries();
    return true;
  }, [flushDeferredPaneCloseRecoveries, reattachPane, terminalTabPath]);

  const buildPaneDetachTransfer = useCallback((panePath: string) => {
    const normalizedPath = typeof panePath === 'string' ? panePath.trim() : '';
    if (!normalizedPath) return null;
    const paneInstanceId = ensurePaneInstanceId(normalizedPath);
    const paneWindowId = generatePaneDetachId('pane-window');
    return {
      paneInstanceId,
      paneWindowId,
      params: createPaneDetachTransferParams({
        paneInstanceId,
        paneWindowId,
        paneSourceWindowId: currentWindowIdRef.current,
      }),
    };
  }, [ensurePaneInstanceId]);

  const registerDetachedPaneWindow = useCallback((panePath: string, label?: string | null, openedWindow?: any, detachParams?: Record<string, string> | null) => {
    const normalizedPath = typeof panePath === 'string' ? panePath.trim() : '';
    if (!normalizedPath || !detachParams) return;
    const pendingState = createPendingPaneOwnershipState({
      panePath: normalizedPath,
      paneInstanceId: detachParams.pane_instance_id,
      ownerWindowId: detachParams.pane_window_id,
      sourceWindowId: detachParams.pane_source_window_id,
      label,
    });
    if (!pendingState) return;

    detachedWindowHandlesRef.current.set(normalizedPath, openedWindow || null);
    const treatAsDockPane = normalizedPath === terminalTabPath && !tabStore.get(normalizedPath);
    if (treatAsDockPane) {
      setPendingDetachedDockPane(pendingState);
      return;
    }

    setPendingDetachedTabs((current) => {
      const next = new Map(current);
      next.set(normalizedPath, pendingState);
      return next;
    });
  }, [terminalTabPath]);

  const claimDetachedPaneWindow = useCallback((claim: { panePath?: string | null; paneInstanceId?: string | null; paneWindowId?: string | null }, sourceWindow?: any) => {
    const panePath = typeof claim?.panePath === 'string' ? claim.panePath.trim() : '';
    if (!panePath) return false;

    const expectedHandle = detachedWindowHandlesRef.current.get(panePath);
    if (expectedHandle && sourceWindow && expectedHandle !== sourceWindow) return false;

    const pendingTab = pendingDetachedTabsRef.current.get(panePath) || null;
    if (matchesPaneDetachClaim(pendingTab, claim)) {
      const preservedInstance = editorInstanceRef.current;
      const useLiveTransfer = shouldUseLivePaneTransfer({ panePath, terminalTabPath });
      if (useLiveTransfer && preservedInstance && typeof preservedInstance.moveHost === 'function') {
        registerPaneLiveTransfer({
          panePath,
          paneInstanceId: pendingTab.paneInstanceId,
          paneWindowId: pendingTab.ownerWindowId,
          instance: preservedInstance,
          releaseSourceHost: () => {
            if (editorInstanceRef.current === preservedInstance) {
              editorInstanceRef.current = null;
            }
          },
        });
      }
      if (useLiveTransfer && editorInstanceRef.current) {
        editorInstanceRef.current = null;
      }
      const nextState = finalizePendingPaneOwnership(pendingTab);
      if (!nextState) return false;
      setPendingDetachedTabs((current) => {
        if (!current.has(panePath)) return current;
        const next = new Map(current);
        next.delete(panePath);
        return next;
      });
      setDetachedTabs((current) => {
        const next = new Map(current);
        next.set(panePath, nextState);
        return next;
      });
      removeSourcePaneAfterDetachClaim({
        panePath,
        terminalTabPath,
        closeTab: (path) => tabStore.close(path),
        sourceHost: 'tab',
      });
      return true;
    }

    if (panePath !== terminalTabPath) return false;

    const pendingDock = pendingDetachedDockPaneRef.current;
    const preservedDockInstance = dockInstanceRef.current;
    const useLiveTransfer = shouldUseLivePaneTransfer({ panePath, terminalTabPath });
    if (useLiveTransfer && pendingDock && preservedDockInstance && typeof preservedDockInstance.moveHost === 'function') {
      registerPaneLiveTransfer({
        panePath,
        paneInstanceId: pendingDock.paneInstanceId,
        paneWindowId: pendingDock.ownerWindowId,
        instance: preservedDockInstance,
        releaseSourceHost: () => {
          if (dockInstanceRef.current === preservedDockInstance) {
            dockInstanceRef.current = null;
          }
        },
      });
    }
    if (useLiveTransfer && dockInstanceRef.current) {
      dockInstanceRef.current = null;
    }
    if (!matchesPaneDetachClaim(pendingDock, claim)) return false;
    const nextState = finalizePendingPaneOwnership(pendingDock);
    if (!nextState) return false;
    setPendingDetachedDockPane(null);
    setDetachedDockPane(nextState);
    removeSourcePaneAfterDetachClaim({
      panePath,
      terminalTabPath,
      setDockVisible,
      sourceHost: 'dock',
    });
    return true;
  }, [setDockVisible, terminalTabPath]);

  const sendPanePopoutReattachRequest = useCallback((closeWindow = false, allowLiveTransfer = true) => {
    if (!panePopoutMode) return false;
    const detachState = paneDetachTransferRef.current;
    if (!hasPaneDetachTransferState(detachState)) return false;
    if (typeof window === 'undefined' || !window.opener || window.opener.closed) return false;
    if (panePopoutReattachSentRef.current) {
      if (closeWindow) {
        closeWindowBestEffort(window);
      }
      return true;
    }

    const panePath = detachState.panePath || panePopoutPath;
    const instance = panePath === terminalTabPath
      ? (dockInstanceRef.current || editorInstanceRef.current)
      : editorInstanceRef.current;
    const effectiveAllowLiveTransfer = allowLiveTransfer && shouldUseLivePaneTransfer({ panePath, terminalTabPath });
    const payload = buildPanePopoutReattachRequestMessage({
      panePath,
      paneInstanceId: detachState.paneInstanceId,
      paneOverrideId: panePath === terminalTabPath
        ? null
        : (typeof (tabPaneOverrides as any)?.get === 'function' ? ((tabPaneOverrides as any).get(panePath) || null) : null),
      terminalTabPath,
      viewState: panePath === terminalTabPath ? null : (tabStore.getViewState(panePath) || null),
      allowLiveTransfer: effectiveAllowLiveTransfer,
      instance,
    });
    if (!payload) return false;

    if (effectiveAllowLiveTransfer && payload.paneTransferToken && typeof instance?.moveHost === 'function') {
      if (dockInstanceRef.current === instance) {
        dockInstanceRef.current = null;
      }
      if (editorInstanceRef.current === instance) {
        editorInstanceRef.current = null;
      }
    }

    if (!postMessageToWindowBestEffort(window.opener, payload, window.location.origin)) {
      return false;
    }
    panePopoutReattachSentRef.current = true;

    if (closeWindow) {
      closeWindowBestEffort(window);
    }
    return true;
  }, [panePopoutMode, panePopoutPath, tabPaneOverrides, terminalTabPath]);

  const requestPanePopoutReattach = useCallback(() => sendPanePopoutReattachRequest(true, true), [sendPanePopoutReattachRequest]);

  useEffect(() => {
    if (!panePopoutMode || typeof window === 'undefined') return undefined;

    const flushReattachState = () => {
      const detachState = paneDetachTransferRef.current;
      const panePath = hasPaneDetachTransferState(detachState)
        ? (detachState.panePath || panePopoutPath || '')
        : '';
      if (shouldRequireManualTerminalCloseRecovery({
        panePath,
        terminalTabPath,
        allowLiveTransfer: false,
        reason: 'closed-window',
      })) {
        return;
      }
      sendPanePopoutReattachRequest(false, false);
    };

    window.addEventListener('pagehide', flushReattachState);
    window.addEventListener('beforeunload', flushReattachState);
    return () => {
      window.removeEventListener('pagehide', flushReattachState);
      window.removeEventListener('beforeunload', flushReattachState);
    };
  }, [panePopoutMode, sendPanePopoutReattachRequest]);

  const activePaneTab = useMemo(
    () => resolveActivePaneTab(tabStripTabs, tabStripActiveId),
    [tabStripActiveId, tabStripTabs],
  );

  const activePaneOverrideId = useMemo(
    () => resolveActivePaneOverrideId(tabPaneOverrides, tabStripActiveId),
    [tabPaneOverrides, tabStripActiveId],
  );

  const panePopoutTitle = useMemo(
    () => getPanePopoutTitle(panePopoutLabel, activePaneTab, panePopoutPath),
    [activePaneTab, panePopoutLabel, panePopoutPath],
  );

  const activeDiffMode = useMemo(
    () => (tabStripActiveId && diffTabs.has(tabStripActiveId) ? 'saved' : null),
    [diffTabs, tabStripActiveId],
  );
  const activeDiffModeRef = useRef<string | null>(activeDiffMode);

  useEffect(() => {
    activeDiffModeRef.current = activeDiffMode;
  }, [activeDiffMode]);

  const panePopoutHasMenuActions = useMemo(
    () => hasPanePopoutMenuActions(tabStripTabs, previewTabs, diffTabs, tabStripActiveId),
    [diffTabs, previewTabs, tabStripActiveId, tabStripTabs],
  );

  const isVncPanePopout = useMemo(
    () => isVncPanePopoutPath(panePopoutPath, vncTabPrefix),
    [panePopoutPath, vncTabPrefix],
  );

  const hidePanePopoutControls = useMemo(
    () => shouldHidePanePopoutControls(panePopoutPath, terminalTabPath, panePopoutHasMenuActions, isVncPanePopout),
    [isVncPanePopout, panePopoutHasMenuActions, panePopoutPath, terminalTabPath],
  );

  const showEditorPaneContainer = shouldShowEditorPaneContainer(
    panePopoutMode,
    chatOnlyMode,
    editorOpen,
    hasDockPanes,
    dockVisible,
  );

  const [zenMode, setZenMode] = useState(false);
  const zenDockWasVisibleRef = useRef(false);

  const enterZenMode = useCallback(() => {
    if (!editorOpen || chatOnlyMode) return;
    zenDockWasVisibleRef.current = dockVisible;
    if (dockVisible) setDockVisible(false);
    setZenMode(true);
  }, [chatOnlyMode, dockVisible, editorOpen]);

  const exitZenMode = useCallback(() => {
    if (!zenMode) return;
    setZenMode(false);
    if (zenDockWasVisibleRef.current) {
      setDockVisible(true);
      zenDockWasVisibleRef.current = false;
    }
  }, [zenMode]);

  const toggleZenMode = useCallback(() => {
    if (zenMode) {
      exitZenMode();
      return;
    }
    enterZenMode();
  }, [enterZenMode, exitZenMode, zenMode]);

  useEffect(() => {
    if (zenMode && !editorOpen) {
      exitZenMode();
    }
  }, [editorOpen, exitZenMode, zenMode]);

  useEffect(() => {
    const openTabIds = new Set(tabStripTabs.map((tab) => tab.id));
    const pendingDetachedTabPaths = new Set(pendingDetachedTabsRef.current.keys());
    const detachedTabPaths = new Set(detachedTabsRef.current.keys());
    for (const path of Array.from(tabPaneInstanceIdsRef.current.keys())) {
      if (!shouldRetainPaneDetachState({
        panePath: path,
        openTabIds,
        pendingDetachedTabPaths,
        detachedTabPaths,
        terminalTabPath,
        hasPendingDetachedDockPane: Boolean(pendingDetachedDockPaneRef.current),
        hasDetachedDockPane: Boolean(detachedDockPaneRef.current),
      })) {
        tabPaneInstanceIdsRef.current.delete(path);
      }
    }
  }, [tabStripTabs, terminalTabPath]);

  useEffect(() => {
    if (panePopoutMode || typeof window === 'undefined') return undefined;

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const payload = event.data;
      if (!payload || typeof payload !== 'object') return;
      if (payload.type === 'piclaw-pane-detach-claim') {
        claimDetachedPaneWindow({
          panePath: payload.panePath,
          paneInstanceId: payload.paneInstanceId,
          paneWindowId: payload.paneWindowId,
        }, event.source);
        return;
      }
      if (payload.type !== 'piclaw-pane-reattach-request') return;
      const transfer = consumePanePopoutReattachRequestMessage({ payload });
      const panePath = transfer?.panePath || '';
      if (!panePath) return;
      if (transfer?.editorTransfer) {
        pendingReattachEditorTransfersRef.current.set(panePath, transfer.editorTransfer);
      }
      if (transfer?.hostTransfer) {
        pendingReattachPaneHostTransfersRef.current.set(panePath, transfer.hostTransfer);
        if (transfer.allowLiveTransfer && event.source) {
          pendingReattachPaneSourceWindowsRef.current.set(panePath, event.source);
        } else {
          pendingReattachPaneSourceWindowsRef.current.delete(panePath);
        }
      }

      const detachedTab = detachedTabsRef.current.get(panePath) || null;
      const detachedDock = panePath === terminalTabPath ? detachedDockPaneRef.current : null;
      const useLiveTransfer = shouldUseLivePaneTransfer({ panePath, terminalTabPath });
      const detached = detachedTab || detachedDock;
      if (!detached) return;
      if (transfer?.paneInstanceId && transfer.paneInstanceId !== detached.paneInstanceId) return;
      if (shouldDisableTerminalReattach({ panePath, terminalTabPath })) {
        pendingReattachPaneSourceWindowsRef.current.delete(panePath);
        pendingReattachPaneClaimsRef.current.delete(panePath);
        pendingReattachPaneHostTransfersRef.current.delete(panePath);
        pendingReattachEditorTransfersRef.current.delete(panePath);
        return;
      }
      if (transfer?.hostTransfer && transfer.allowLiveTransfer && useLiveTransfer) {
        pendingReattachPaneClaimsRef.current.set(panePath, {
          panePath,
          paneInstanceId: detached.paneInstanceId,
          paneWindowId: detached.ownerWindowId,
        });
      } else {
        pendingReattachPaneClaimsRef.current.delete(panePath);
      }
      if (shouldRequireManualTerminalCloseRecovery({
        panePath,
        terminalTabPath,
        allowLiveTransfer: transfer?.allowLiveTransfer,
        reason: 'message',
      })) {
        pendingReattachPaneSourceWindowsRef.current.delete(panePath);
        detachedWindowHandlesRef.current.delete(panePath);
        deferredPaneCloseRecoveryRef.current.delete(panePath);
        manualPaneCloseRecoveryRef.current.add(panePath);
        return;
      }
      schedulePaneCloseRecoveryReattach(panePath, {
        allowLiveTransfer: transfer?.allowLiveTransfer,
        reason: 'message',
      });
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [claimDetachedPaneWindow, panePopoutMode, schedulePaneCloseRecoveryReattach, terminalTabPath]);

  useEffect(() => {
    if (panePopoutMode || typeof window === 'undefined' || typeof document === 'undefined') return undefined;
    const onForegroundReturn = () => flushDeferredPaneCloseRecoveries();
    window.addEventListener('focus', onForegroundReturn);
    window.addEventListener('pageshow', onForegroundReturn);
    document.addEventListener('visibilitychange', onForegroundReturn);
    const timer = setInterval(() => {
      flushDeferredPaneCloseRecoveries();
      for (const [panePath, handle] of detachedWindowHandlesRef.current.entries()) {
        if (!handle || !handle.closed) continue;
        const isPending = panePath === terminalTabPath
          ? Boolean(pendingDetachedDockPaneRef.current)
          : pendingDetachedTabsRef.current.has(panePath);
        if (isPending) {
          detachedWindowHandlesRef.current.delete(panePath);
          clearPendingDetachedPane(panePath);
          continue;
        }
        if (shouldDisableTerminalReattach({ panePath, terminalTabPath })) {
          clearDetachedPane(panePath);
          continue;
        }
        if (shouldRequireManualTerminalCloseRecovery({
          panePath,
          terminalTabPath,
          allowLiveTransfer: false,
          reason: 'closed-window',
        })) {
          detachedWindowHandlesRef.current.delete(panePath);
          deferredPaneCloseRecoveryRef.current.delete(panePath);
          manualPaneCloseRecoveryRef.current.add(panePath);
          continue;
        }
        if (manualPaneCloseRecoveryRef.current.has(panePath)) {
          detachedWindowHandlesRef.current.delete(panePath);
          continue;
        }
        schedulePaneCloseRecoveryReattach(panePath, {
          allowLiveTransfer: false,
          reason: 'closed-window',
        });
      }
    }, 750);
    return () => {
      window.removeEventListener('focus', onForegroundReturn);
      window.removeEventListener('pageshow', onForegroundReturn);
      document.removeEventListener('visibilitychange', onForegroundReturn);
      clearInterval(timer);
    };
  }, [clearDetachedPane, clearPendingDetachedPane, flushDeferredPaneCloseRecoveries, panePopoutMode, schedulePaneCloseRecoveryReattach, terminalTabPath]);

  useEffect(() => {
    if (!panePopoutMode || !panePopoutPath) return;
    const activeId = tabStore.getActiveId();
    if (activeId === panePopoutPath) return;
    const transfer = pendingEditorPopoutTransferRef.current?.path === panePopoutPath
      ? pendingEditorPopoutTransferRef.current
      : null;
    const hostTransfer = pendingPaneHostTransferRef.current?.path === panePopoutPath
      ? pendingPaneHostTransferRef.current
      : null;
    openEditor(panePopoutPath, {
      ...(panePopoutLabel ? { label: panePopoutLabel } : {}),
      ...(transfer?.paneOverrideId ? { paneOverrideId: transfer.paneOverrideId } : {}),
      ...(transfer?.viewState ? { viewState: transfer.viewState } : {}),
      ...(hostTransfer?.payload?.diffMode ? { diffMode: hostTransfer.payload.diffMode } : {}),
    });
  }, [openEditor, panePopoutLabel, panePopoutMode, panePopoutPath]);

  useEffect(() => {
    if (!panePopoutMode) return;
    const detachState = paneDetachTransferRef.current;
    if (!hasPaneDetachTransferState(detachState)) return;
    if (typeof window === 'undefined' || !window.opener || window.opener.closed) return;
    postMessageToWindowBestEffort(window.opener, {
      type: 'piclaw-pane-detach-claim',
      panePath: detachState.panePath,
      paneInstanceId: detachState.paneInstanceId,
      paneWindowId: detachState.paneWindowId,
    }, window.location.origin);
  }, [panePopoutMode]);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    if (editorInstanceRef.current) {
      editorInstanceRef.current.dispose();
      editorInstanceRef.current = null;
    }

    const activeId = tabStripActiveId;
    if (!activeId) return;
    if (!panePopoutMode && activeDetachedTab?.panePath === activeId) {
      container.innerHTML = '';
      return;
    }

    const pendingPopoutTransfer = pendingEditorPopoutTransferRef.current?.path === activeId
      ? pendingEditorPopoutTransferRef.current
      : null;
    const pendingReattachTransfer = pendingReattachEditorTransfersRef.current.get(activeId) || null;
    const pendingTransfer = pendingPopoutTransfer || pendingReattachTransfer;
    const pendingPopoutHostTransfer = pendingPaneHostTransferRef.current?.path === activeId
      ? pendingPaneHostTransferRef.current
      : null;
    const pendingReattachHostTransfer = pendingReattachPaneHostTransfersRef.current.get(activeId) || null;
    const pendingHostTransfer = pendingPopoutHostTransfer || pendingReattachHostTransfer;
    const effectivePaneOverrideId = activePaneOverrideId || pendingTransfer?.paneOverrideId || null;
    let resolvedTransferState = pendingHostTransfer?.payload ? { ...pendingHostTransfer.payload } : null;
    if (activeDiffModeRef.current) {
      resolvedTransferState = {
        ...(resolvedTransferState || {}),
        diffMode: activeDiffModeRef.current,
      };
    } else if (resolvedTransferState && 'diffMode' in resolvedTransferState) {
      delete resolvedTransferState.diffMode;
    }
    const context = {
      path: activeId,
      mode: 'edit',
      ...(pendingTransfer?.content !== undefined ? { content: pendingTransfer.content } : {}),
      ...(pendingTransfer?.mtime !== undefined ? { mtime: pendingTransfer.mtime } : {}),
      ...(resolvedTransferState ? { transferState: resolvedTransferState } : {}),
    };
    const ext = (effectivePaneOverrideId ? paneRegistry.get(effectivePaneOverrideId) : null)
      || paneRegistry.resolve(context)
      || paneRegistry.get('editor');

    if (!ext) {
      container.innerHTML = '<div style="padding:2em;color:var(--text-secondary);text-align:center;">No editor available for this file.</div>';
      return;
    }

    let instance: any = null;
    let disposed = false;

    const bindInstance = (nextInstance: any) => {
      instance = nextInstance;
      editorInstanceRef.current = nextInstance;

      nextInstance.onDirtyChange?.((dirty: boolean) => {
        tabStore.setDirty(activeId, dirty);
      });

      nextInstance.onSaveRequest?.(() => {
        // Save is handled internally by pane extensions.
      });

      nextInstance.onClose?.(() => {
        closeEditor();
      });

      const viewState = tabStore.getViewState(activeId);
      if (viewState && typeof nextInstance.restoreViewState === 'function') {
        requestAnimationFrame(() => nextInstance.restoreViewState(viewState));
      }

      if (typeof nextInstance.onViewStateChange === 'function') {
        nextInstance.onViewStateChange((state: unknown) => {
          tabStore.saveViewState(activeId, state);
        });
      }

      const detachState = paneDetachTransferRef.current;
      if (
        panePopoutMode
        && hasPaneDetachTransferState(detachState)
        && typeof nextInstance?.moveHost === 'function'
        && shouldUseLivePaneTransfer({ panePath: activeId, terminalTabPath })
      ) {
        registerPaneLiveTransfer({
          panePath: activeId,
          paneInstanceId: detachState.paneInstanceId || '',
          paneWindowId: detachState.paneWindowId || '',
          instance: nextInstance,
          releaseSourceHost: () => {
            if (dockInstanceRef.current === nextInstance) {
              dockInstanceRef.current = null;
            }
            if (editorInstanceRef.current === nextInstance) {
              editorInstanceRef.current = null;
            }
          },
        });
      }

      void invokePaneAfterAttachToHost(nextInstance, {
        path: activeId,
        hostMode: panePopoutMode ? 'popout' : 'main',
        transferState: resolvedTransferState,
      }).catch((error) => {
        console.warn('[pane-attach] afterAttachToHost failed:', error);
      });

      requestAnimationFrame(() => nextInstance.focus?.());
    };

    void (async () => {
      const detachState = paneDetachTransferRef.current;
      const popoutClaim = panePopoutMode && hasPaneDetachTransferState(detachState) && detachState.panePath === activeId
        ? {
          panePath: activeId,
          paneInstanceId: detachState.paneInstanceId || '',
          paneWindowId: detachState.paneWindowId || '',
        }
        : null;
      const reattachClaim = pendingReattachPaneClaimsRef.current.get(activeId) || null;
      const liveTransferClaim = shouldUseLivePaneTransfer({ panePath: activeId, terminalTabPath })
        ? (popoutClaim || reattachClaim)
        : null;
      const liveTransferSourceWindow = panePopoutMode
        ? (typeof window !== 'undefined' && window.opener && !window.opener.closed ? window.opener : null)
        : (pendingReattachPaneSourceWindowsRef.current.get(activeId) || null);
      const liveTransferHostMode = panePopoutMode ? 'popout' : 'main';

      if (pendingHostTransfer && liveTransferClaim && liveTransferSourceWindow) {
        try {
          const claimedInstance = await claimPaneLiveTransfer(liveTransferSourceWindow, liveTransferClaim, container, {
            path: activeId,
            hostMode: liveTransferHostMode,
            transferState: resolvedTransferState,
          });
          if (!disposed && claimedInstance) {
            bindInstance(claimedInstance);
            if (pendingPopoutTransfer) {
              pendingEditorPopoutTransferRef.current = null;
            }
            if (pendingReattachTransfer) {
              pendingReattachEditorTransfersRef.current.delete(activeId);
            }
            if (pendingPopoutHostTransfer) {
              pendingPaneHostTransferRef.current = null;
            }
            if (pendingReattachHostTransfer) {
              pendingReattachPaneHostTransfersRef.current.delete(activeId);
            }
            pendingReattachPaneSourceWindowsRef.current.delete(activeId);
            pendingReattachPaneClaimsRef.current.delete(activeId);
            return;
          }
        } catch (error) {
          console.warn('[pane-live-transfer] Failed to claim live pane instance:', error);
        }
      }

      if (disposed) return;
      bindInstance(ext.mount(container, context));
      if (pendingPopoutTransfer) {
        pendingEditorPopoutTransferRef.current = null;
      }
      if (pendingReattachTransfer) {
        pendingReattachEditorTransfersRef.current.delete(activeId);
      }
      if (pendingPopoutHostTransfer) {
        pendingPaneHostTransferRef.current = null;
      }
      if (pendingReattachHostTransfer) {
        pendingReattachPaneHostTransfersRef.current.delete(activeId);
      }
      pendingReattachPaneSourceWindowsRef.current.delete(activeId);
      pendingReattachPaneClaimsRef.current.delete(activeId);
    })();

    return () => {
      disposed = true;
      if (editorInstanceRef.current === instance) {
        instance.dispose();
        editorInstanceRef.current = null;
      }
    };
  }, [activeDetachedTab, activePaneOverrideId, closeEditor, panePopoutMode, tabStripActiveId]);

  useEffect(() => {
    const activeId = tabStripActiveId;
    const instance = editorInstanceRef.current;
    if (!activeId || typeof instance?.setDiffMode !== 'function') return;
    instance.setDiffMode(activeDiffMode);
  }, [activeDiffMode, tabStripActiveId]);

  const refreshActiveEditorFromWorkspace = useCallback(async (updates: unknown) => {
    const activePath = typeof tabStripActiveId === 'string' ? tabStripActiveId.trim() : '';
    const instance = editorInstanceRef.current;
    if (!activePath || !instance?.setContent) return;
    if (typeof instance.isDirty === 'function' && instance.isDirty()) return;
    if (!isWorkspaceUpdateRelevantForPath(activePath, updates)) return;

    try {
      const payload = await getWorkspaceFile(activePath, 1_000_000, 'edit');
      const nextText = typeof payload?.text === 'string' ? payload.text : '';
      const nextMtime = typeof payload?.mtime === 'string' && payload.mtime.trim()
        ? payload.mtime.trim()
        : new Date().toISOString();
      instance.setContent(nextText, nextMtime);
    } catch (error) {
      console.warn('[workspace_update] Failed to refresh active pane:', error);
    }
  }, [getWorkspaceFile, tabStripActiveId]);

  useEffect(() => {
    const container = dockContainerRef.current;

    if (dockInstanceRef.current) {
      dockInstanceRef.current.dispose();
      dockInstanceRef.current = null;
    }

    if (!container || !hasDockPanes || !dockVisible) return;
    if (!panePopoutMode && dockPaneDetached?.panePath === terminalTabPath) {
      container.innerHTML = '';
      return;
    }

    const ext = paneRegistry.getDockPanes()[0];
    if (!ext) {
      container.innerHTML = '<div class="terminal-placeholder">No dock pane available.</div>';
      return;
    }

    const pendingPopoutHostTransfer = pendingPaneHostTransferRef.current?.path === terminalTabPath
      ? pendingPaneHostTransferRef.current
      : null;
    const pendingReattachHostTransfer = pendingReattachPaneHostTransfersRef.current.get(terminalTabPath) || null;
    const pendingHostTransfer = pendingPopoutHostTransfer || pendingReattachHostTransfer;

    const instance = ext.mount(container, {
      mode: 'view',
      ...(pendingHostTransfer?.payload ? { transferState: pendingHostTransfer.payload } : {}),
    });
    dockInstanceRef.current = instance;
    void invokePaneAfterAttachToHost(instance, {
      path: terminalTabPath,
      hostMode: panePopoutMode ? 'popout' : 'main',
      transferState: pendingHostTransfer?.payload || null,
    }).catch((error) => {
      console.warn('[pane-attach] afterAttachToHost failed:', error);
    });
    if (pendingPopoutHostTransfer) {
      pendingPaneHostTransferRef.current = null;
    }
    if (pendingReattachHostTransfer) {
      pendingReattachPaneHostTransfersRef.current.delete(terminalTabPath);
    }
    requestAnimationFrame(() => instance.focus?.());

    return () => {
      if (dockInstanceRef.current === instance) {
        instance.dispose();
        dockInstanceRef.current = null;
      }
    };
  }, [dockPaneDetached, dockVisible, hasDockPanes, panePopoutMode, terminalTabPath]);

  return {
    editorContainerRef,
    editorInstanceRef,
    dockContainerRef,
    dockInstanceRef,
    hasDockPanes,
    dockVisible,
    setDockVisible,
    toggleDock,
    openTerminalTab,
    openVncTab,
    panePopoutTitle,
    panePopoutHasMenuActions,
    hidePanePopoutControls,
    showEditorPaneContainer,
    zenMode,
    exitZenMode,
    toggleZenMode,
    refreshActiveEditorFromWorkspace,
    detachedTabs,
    activeDetachedTab,
    detachedDockPane: dockPaneDetached,
    buildPaneDetachTransfer,
    registerDetachedPaneWindow,
    reattachPane,
    requestPanePopoutReattach,
    canReattachPanePopout: panePopoutMode
      && hasPaneDetachTransferState(paneDetachTransferRef.current)
      && !shouldDisableTerminalReattach({ panePath: panePopoutPath || '', terminalTabPath }),
  };
}
