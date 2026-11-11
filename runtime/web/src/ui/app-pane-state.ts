export interface PaneTabLike {
  id?: string;
  label?: string;
}

export interface PaneOverrideMapLike {
  get(key: string): string | null | undefined;
}

export interface ActivePaneFlagSetLike {
  has(key: string): boolean;
}

/** Resolve the currently active pane tab from the tab-strip collection. */
export function resolveActivePaneTab(
  tabStripTabs: PaneTabLike[] | null | undefined,
  tabStripActiveId: string | null | undefined,
): PaneTabLike | null {
  const tabs = Array.isArray(tabStripTabs) ? tabStripTabs : [];
  return tabs.find((tab) => tab?.id === tabStripActiveId) || tabs[0] || null;
}

/** Resolve the pane override id for the active tab, if any. */
export function resolveActivePaneOverrideId(
  tabPaneOverrides: PaneOverrideMapLike | null | undefined,
  tabStripActiveId: string | null | undefined,
): string | null {
  if (!tabStripActiveId || !tabPaneOverrides || typeof tabPaneOverrides.get !== 'function') {
    return null;
  }
  return tabPaneOverrides.get(tabStripActiveId) || null;
}

/** Build the label shown in pane-popout window controls. */
export function getPanePopoutTitle(
  panePopoutLabel: string | null | undefined,
  activePaneTab: PaneTabLike | null | undefined,
  panePopoutPath: string | null | undefined,
): string {
  return panePopoutLabel || activePaneTab?.label || panePopoutPath || 'Pane';
}

/** Build the document title used for standalone pane windows/tabs. */
export function getPanePopoutDocumentTitle(
  panePopoutLabel: string | null | undefined,
  activePaneTab: PaneTabLike | null | undefined,
  panePopoutPath: string | null | undefined,
): string {
  const title = getPanePopoutTitle(panePopoutLabel, activePaneTab, panePopoutPath);
  return `${title} · PiClaw`;
}

/** Determine whether the pane-popout chrome needs menu actions. */
export function hasPanePopoutMenuActions(
  tabStripTabs: PaneTabLike[] | null | undefined,
  previewTabs: ActivePaneFlagSetLike | null | undefined,
  diffTabs: ActivePaneFlagSetLike | null | undefined,
  tabStripActiveId: string | null | undefined,
): boolean {
  const tabCount = Array.isArray(tabStripTabs) ? tabStripTabs.length : 0;
  const hasPreview = Boolean(tabStripActiveId && previewTabs?.has?.(tabStripActiveId));
  const hasDiff = Boolean(tabStripActiveId && diffTabs?.has?.(tabStripActiveId));
  return tabCount > 1 || hasPreview || hasDiff;
}

/** Check whether the current pane popout points at a VNC pane. */
export function isVncPanePopoutPath(
  panePopoutPath: string | null | undefined,
  vncTabPrefix: string,
): boolean {
  const path = typeof panePopoutPath === 'string' ? panePopoutPath : '';
  return path === vncTabPrefix || path.startsWith(`${vncTabPrefix}/`);
}

/** Decide whether pane-popout controls should be hidden for the current pane. */
export function shouldHidePanePopoutControls(
  panePopoutPath: string | null | undefined,
  terminalTabPath: string,
  panePopoutHasMenuActions: boolean,
  isVncPanePopout: boolean,
): boolean {
  return (panePopoutPath === terminalTabPath && !panePopoutHasMenuActions) || isVncPanePopout;
}

/** Determine whether the editor-pane container should render in the current shell mode. */
export function shouldShowEditorPaneContainer(
  panePopoutMode: boolean,
  editorOpen: boolean,
  hasDockPanes: boolean,
  dockVisible: boolean,
): boolean {
  return panePopoutMode || editorOpen || (hasDockPanes && dockVisible);
}
