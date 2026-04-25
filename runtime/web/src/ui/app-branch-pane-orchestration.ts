import { buildChatWindowUrl } from './chat-window.js';
import { clampEditorWidth } from './use-splitters.js';

interface RefBox<T> {
  current: T;
}

interface PaneTransferInstanceLike {
  beforeDetachFromHost?: (context: { path?: string; target: 'popout' }) => Promise<void> | void;
  preparePopoutTransfer?: () => Promise<Record<string, string> | null> | Record<string, string> | null;
}

interface EditorPopoutTransferBuilder {
  (panePath: string): Record<string, string> | null;
}

export interface NavigateToSelectedBranchOptions {
  hasWindow?: boolean;
  nextChatJid: unknown;
  currentChatJid: string;
  chatOnlyMode?: boolean;
  currentHref: string;
  navigate?: (url: string) => void;
}

/** Navigate to a selected branch from the branch picker when it differs from the current chat. */
export function navigateToSelectedBranch(options: NavigateToSelectedBranchOptions): boolean {
  const {
    hasWindow = typeof window !== 'undefined',
    nextChatJid,
    currentChatJid,
    chatOnlyMode,
    currentHref,
    navigate,
  } = options;

  if (!hasWindow) return false;
  const normalized = typeof nextChatJid === 'string' ? nextChatJid.trim() : '';
  if (!normalized || normalized === currentChatJid) return false;
  const url = buildChatWindowUrl(currentHref, normalized, { chatOnly: chatOnlyMode });
  navigate?.(url);
  return true;
}

export interface ResolvePanePopoutTransferOptions {
  panePath: string;
  tabStripActiveId: string | null;
  editorInstanceRef: RefBox<PaneTransferInstanceLike | null>;
  dockInstanceRef: RefBox<PaneTransferInstanceLike | null>;
  terminalTabPath: string;
  activateTab?: (path: string) => void;
  getActiveTabId?: () => string | null;
  resolveTab?: (path: string) => { dirty?: boolean } | null | undefined;
  buildEditorPopoutTransfer?: EditorPopoutTransferBuilder;
}

function normalizePanePath(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function invokePaneBeforeDetachFromHost(
  instance: PaneTransferInstanceLike | null | undefined,
  panePath: string,
): Promise<void> {
  if (typeof instance?.beforeDetachFromHost !== 'function') return;
  await instance.beforeDetachFromHost({
    path: panePath,
    target: 'popout',
  });
}

/** Resolve optional popout transfer payload from the active editor/dock source pane instance. */
export async function resolvePanePopoutTransfer(options: ResolvePanePopoutTransferOptions): Promise<Record<string, string> | null> {
  const {
    panePath,
    tabStripActiveId,
    editorInstanceRef,
    dockInstanceRef,
    terminalTabPath,
    activateTab,
    getActiveTabId,
    resolveTab,
    buildEditorPopoutTransfer,
  } = options;

  const useTerminalTabSource = panePath === terminalTabPath && Boolean(resolveTab?.(panePath));
  if (panePath === terminalTabPath && !useTerminalTabSource) {
    const dockInstance = dockInstanceRef.current;
    await invokePaneBeforeDetachFromHost(dockInstance, panePath);
    if (typeof dockInstance?.preparePopoutTransfer !== 'function') {
      return null;
    }
    return await dockInstance.preparePopoutTransfer();
  }

  const readActivePath = () => normalizePanePath(getActiveTabId?.() ?? tabStripActiveId);
  const initialActivePath = readActivePath();
  const previousInstance = editorInstanceRef.current;

  if (initialActivePath !== panePath) {
    activateTab?.(panePath);
  }

  let sourceInstance = initialActivePath === panePath ? editorInstanceRef.current : null;
  if (typeof sourceInstance?.preparePopoutTransfer !== 'function') {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (attempt > 0) {
        await sleep(16);
      } else {
        await Promise.resolve();
      }
      const activePath = readActivePath();
      const candidate = editorInstanceRef.current;
      const becameActive = activePath === panePath;
      const instanceChanged = candidate !== previousInstance;
      if (!becameActive || typeof candidate?.preparePopoutTransfer !== 'function') continue;
      if (initialActivePath === panePath || instanceChanged || attempt > 0) {
        sourceInstance = candidate;
        break;
      }
    }
  }

  await invokePaneBeforeDetachFromHost(sourceInstance, panePath);

  if (typeof sourceInstance?.preparePopoutTransfer === 'function') {
    const explicitTransfer = await sourceInstance.preparePopoutTransfer();
    if (explicitTransfer) {
      return explicitTransfer;
    }
  }

  return buildEditorPopoutTransfer?.(panePath) ?? null;
}

export interface CloseTransferredPaneSourceOptions {
  panePath: string;
  terminalTabPath: string;
  dockVisible: boolean;
  resolveTab: (path: string) => { dirty?: boolean } | null | undefined;
  closeTab: (path: string) => void;
  setDockVisible: (visible: boolean) => void;
}

/** Close local pane source after a successful transfer when safe (clean tab or visible dock). */
export function closeTransferredPaneSource(options: CloseTransferredPaneSourceOptions): void {
  const {
    panePath,
    terminalTabPath,
    dockVisible,
    resolveTab,
    closeTab,
    setDockVisible,
  } = options;

  const sourceTab = resolveTab(panePath);
  if (sourceTab && !sourceTab.dirty) {
    closeTab(panePath);
    return;
  }

  if (panePath === terminalTabPath && dockVisible) {
    setDockVisible(false);
  }
}

export interface ApplyStoredPaneLayoutOptions {
  hasWindow?: boolean;
  editorOpen: boolean;
  shellElement: HTMLElement | null;
  editorWidthRef: RefBox<number>;
  dockHeightRef: RefBox<number>;
  sidebarWidthRef: RefBox<number>;
  readStoredNumber: (key: string, fallback?: number | null) => number | null;
}

/** Apply persisted editor/dock layout vars onto the shell element once editor mode is active. */
export function applyStoredPaneLayout(options: ApplyStoredPaneLayoutOptions): void {
  const {
    hasWindow = typeof window !== 'undefined',
    editorOpen,
    shellElement,
    editorWidthRef,
    dockHeightRef,
    sidebarWidthRef,
    readStoredNumber,
  } = options;

  if (!editorOpen || !hasWindow || !shellElement) return;

  if (!editorWidthRef.current) {
    const stored = readStoredNumber('editorWidth', null);
    const fallback = sidebarWidthRef.current || 280;
    const resolved = Number.isFinite(stored) ? Number(stored) : fallback;
    editorWidthRef.current = clampEditorWidth(resolved, typeof window !== 'undefined' ? window.innerWidth : 0, sidebarWidthRef.current || 0);
  }
  shellElement.style.setProperty('--editor-width', `${editorWidthRef.current}px`);

  if (!dockHeightRef.current) {
    const stored = readStoredNumber('dockHeight', null);
    dockHeightRef.current = Number.isFinite(stored) ? Number(stored) : 200;
  }
  shellElement.style.setProperty('--dock-height', `${dockHeightRef.current}px`);
}
