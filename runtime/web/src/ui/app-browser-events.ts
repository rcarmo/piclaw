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
    'csv-viewer:open-tab',
    'pdf-viewer:open-tab',
    'image-viewer:open-tab',
    'video-viewer:open-tab',
    'html-viewer:open-tab',
    'mindmap:open-tab',
    'kanban:open-tab',
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

/** Register the Ctrl+` dock toggle shortcut. */
export function watchDockToggleShortcut(onToggle?: () => void, runtime: RuntimeLike = {}): () => void {
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};

  const onKeyDown = (event: { ctrlKey?: boolean; key?: string; preventDefault?: () => void }) => {
    if (event?.ctrlKey && event.key === '`') {
      event.preventDefault?.();
      onToggle?.();
    }
  };

  doc.addEventListener('keydown', onKeyDown);
  return () => doc.removeEventListener('keydown', onKeyDown);
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

  const onKeyDown = (event: { ctrlKey?: boolean; shiftKey?: boolean; key?: string; preventDefault?: () => void; target?: unknown }) => {
    if (isEditableKeyboardTarget(event?.target)) return;
    if (event?.ctrlKey && event.shiftKey && (event.key === 'Z' || event.key === 'z')) {
      event.preventDefault?.();
      toggleZenMode?.();
      return;
    }
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
    if (!event?.ctrlKey || !event?.shiftKey || event?.metaKey || event?.altKey) return;
    // Shift+[ = '{' and Shift+] = '}' on macOS; also accept the unshifted forms
    if (event.key === '[' || event.key === '{') {
      event.preventDefault?.();
      callbacks?.previousChat?.();
      return;
    }
    if (event.key === ']' || event.key === '}') {
      event.preventDefault?.();
      callbacks?.nextChat?.();
    }
  };

  doc.addEventListener('keydown', onKeyDown);
  return () => doc.removeEventListener('keydown', onKeyDown);
}

/** Register Cmd/Ctrl+, shortcut to open the settings dialog. */
export function watchSettingsShortcut(runtime: RuntimeLike = {}): () => void {
  const doc = runtime.document ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('piclaw:open-settings'));
    }
  };

  doc.addEventListener('keydown', onKeyDown as EventListener);
  return () => doc.removeEventListener('keydown', onKeyDown as EventListener);
}
