import { requestOpenSettingsDialog } from '../components/settings-dialog-events.js';
import { matchesKeyboardShortcutAction } from './keyboard-shortcuts.js';
import { WORKSPACE_TREE_TOGGLE_EVENT } from './use-splitters.js';

interface DocumentEventTargetLike {
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
}

function isEditableKeyboardTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as {
    closest?: (selector: string) => Element | null;
    isContentEditable?: boolean;
  };
  if (typeof el.closest === 'function' && el.closest('input, textarea, select, [contenteditable="true"], .compose-box, .compose-model-popup, .compose-session-popup')) {
    return true;
  }
  return Boolean(el.isContentEditable);
}

interface RuntimeLike {
  document?: DocumentEventTargetLike | null;
  window?: { addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void } | null;
}

export interface PaneOpenEventCallbacks {
  openTab?: (path: string, label?: string) => void;
  editSource?: (path: string, label?: string) => void;
  popOutPane?: (path: string, label?: string) => void;
}

/** Register document-level open-tab and popout-pane custom event handlers. */
export function watchPaneOpenEvents(callbacks: PaneOpenEventCallbacks, runtime: RuntimeLike = {}): () => void {
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};

  const openTab = callbacks?.openTab;
  const editSource = callbacks?.editSource;
  const popOutPane = callbacks?.popOutPane;

  const openTabHandler = (event: { detail?: { path?: string; label?: string } }) => {
    const path = event?.detail?.path;
    const label = typeof event?.detail?.label === 'string' && event.detail.label.trim() ? event.detail.label.trim() : undefined;
    if (path) {
      openTab?.(path, label);
    }
  };

  const editSourceHandler = (event: { detail?: { path?: string; label?: string } }) => {
    const path = event?.detail?.path;
    const label = typeof event?.detail?.label === 'string' && event.detail.label.trim() ? event.detail.label.trim() : undefined;
    if (path) {
      editSource?.(path, label);
    }
  };

  const popoutHandler = (event: { detail?: { path?: string; label?: string } }) => {
    const path = event?.detail?.path;
    const label = typeof event?.detail?.label === 'string' && event.detail.label.trim() ? event.detail.label.trim() : undefined;
    if (path) {
      popOutPane?.(path, label);
    }
  };

  const openTabEvents = [
    'pane:open-tab',
    'office-viewer:open-tab',
    'data-viewer:open-tab',
    'pdf-viewer:open-tab',
    'image-viewer:open-tab',
    'video-viewer:open-tab',
    'html-viewer:open-tab',
    'mindmap:open-tab',
    'vnc:open-tab',
  ];

  openTabEvents.forEach((type) => doc.addEventListener(type, openTabHandler));
  doc.addEventListener('html-viewer:edit-source', editSourceHandler);
  doc.addEventListener('pane:popout', popoutHandler);

  return () => {
    openTabEvents.forEach((type) => doc.removeEventListener(type, openTabHandler));
    doc.removeEventListener('html-viewer:edit-source', editSourceHandler);
    doc.removeEventListener('pane:popout', popoutHandler);
  };
}

/** Register the dock toggle shortcut. */
export function watchDockToggleShortcut(onToggle?: () => void, runtime: RuntimeLike = {}): () => void {
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};

  const onKeyDown = (event: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; key?: string; preventDefault?: () => void; target?: unknown }) => {
    if (isEditableKeyboardTarget(event?.target)) return;
    if (!matchesKeyboardShortcutAction(event, 'toggleDock')) return;
    event.preventDefault?.();
    onToggle?.();
  };

  doc.addEventListener('keydown', onKeyDown);
  return () => doc.removeEventListener('keydown', onKeyDown);
}

/**
 * Show or hide the workspace file tree (default Ctrl/Cmd+Shift+E). It also
 * works from editors and the compose box, where the chord does not insert text.
 * Tree dividers request the same toggle through WORKSPACE_TREE_TOGGLE_EVENT.
 */
export function watchWorkspaceTreeShortcut(onToggle?: () => void, runtime: RuntimeLike = {}): () => void {
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  const win = runtime.window ?? (typeof window !== 'undefined' ? window : null);
  if (!doc) return () => {};

  const onKeyDown = (event: { isComposing?: boolean; defaultPrevented?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; key?: string; preventDefault?: () => void }) => {
    if (event?.isComposing || event?.defaultPrevented) return;
    if (!matchesKeyboardShortcutAction(event, 'toggleWorkspace')) return;
    event.preventDefault?.();
    onToggle?.();
  };
  const onRequest = () => onToggle?.();

  doc.addEventListener('keydown', onKeyDown);
  win?.addEventListener?.(WORKSPACE_TREE_TOGGLE_EVENT, onRequest);
  return () => {
    doc.removeEventListener('keydown', onKeyDown);
    win?.removeEventListener?.(WORKSPACE_TREE_TOGGLE_EVENT, onRequest);
  };
}

export interface ZenModeShortcutCallbacks {
  toggleZenMode?: () => void;
  exitZenMode?: () => void;
  zenMode?: boolean;
  isZenModeActive?: () => boolean;
}

export interface ChatSwitchShortcutCallbacks {
  previousChat?: () => void;
  nextChat?: () => void;
}

/** Register Ctrl+Shift+Z and Escape shortcuts for zen-mode control. */
export function watchZenModeShortcuts(callbacks: ZenModeShortcutCallbacks, runtime: RuntimeLike = {}): () => void {
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};

  const toggleZenMode = callbacks?.toggleZenMode;
  const exitZenMode = callbacks?.exitZenMode;
  const isZenModeActive = typeof callbacks?.isZenModeActive === 'function'
    ? callbacks.isZenModeActive
    : () => Boolean(callbacks?.zenMode);

  const onKeyDown = (event: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; key?: string; preventDefault?: () => void; target?: unknown }) => {
    // Ctrl+Shift+Z must work even when focus is in the compose editor; otherwise
    // the primary zen-mode shortcut is swallowed by the editable-target guard.
    if (matchesKeyboardShortcutAction(event, 'toggleZenMode')) {
      event.preventDefault?.();
      toggleZenMode?.();
      return;
    }
    if (isEditableKeyboardTarget(event?.target)) return;
    if (event?.key === 'Escape' && isZenModeActive()) {
      event.preventDefault?.();
      exitZenMode?.();
    }
  };

  doc.addEventListener('keydown', onKeyDown);
  return () => doc.removeEventListener('keydown', onKeyDown);
}

export function watchChatSwitchShortcuts(callbacks: ChatSwitchShortcutCallbacks, runtime: RuntimeLike = {}): () => void {
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};

  const onKeyDown = (event: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean; altKey?: boolean; key?: string; preventDefault?: () => void; target?: unknown }) => {
    if (isEditableKeyboardTarget(event?.target)) return;
    if (matchesKeyboardShortcutAction(event, 'previousChat')) {
      event.preventDefault?.();
      callbacks?.previousChat?.();
      return;
    }
    if (matchesKeyboardShortcutAction(event, 'nextChat')) {
      event.preventDefault?.();
      callbacks?.nextChat?.();
    }
  };

  doc.addEventListener('keydown', onKeyDown);
  return () => doc.removeEventListener('keydown', onKeyDown);
}

/** Register browser settings shortcuts. */
export function watchSettingsShortcut(runtime: RuntimeLike = {}): () => void {
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};

  const onKeyDown = (event: KeyboardEvent) => {
    if (isEditableKeyboardTarget(event?.target)) return;
    if (!matchesKeyboardShortcutAction(event, 'openSettings')) return;
    event.preventDefault();
    requestOpenSettingsDialog();
  };

  doc.addEventListener('keydown', onKeyDown as EventListener);
  return () => doc.removeEventListener('keydown', onKeyDown as EventListener);
}

/** Register the keyboard-help shortcut. */
export function watchKeyboardHelpShortcut(runtime: RuntimeLike = {}): () => void {
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};

  const onKeyDown = (event: KeyboardEvent) => {
    if (isEditableKeyboardTarget(event?.target)) return;
    if (!matchesKeyboardShortcutAction(event, 'openHelp')) return;
    event.preventDefault();
    requestOpenSettingsDialog({ section: 'keyboard' });
  };

  doc.addEventListener('keydown', onKeyDown as EventListener);
  return () => doc.removeEventListener('keydown', onKeyDown as EventListener);
}
