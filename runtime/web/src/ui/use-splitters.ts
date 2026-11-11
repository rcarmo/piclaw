import { useRef } from '../vendor/preact-htm.js';
import { setLocalStorageItem } from '../utils/storage.js';

const MIN_CHAT_PANE_RATIO = 0.10;
const MIN_CHAT_PANE_WIDTH = 320;
const WORKSPACE_SPLITTER_WIDTH = 4;
const EDITOR_SPLITTER_WIDTH = 4;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 1600;
const MIN_EDITOR_WIDTH = 200;
const MAX_EDITOR_WIDTH = 1600;

function getViewportWidth() {
  if (typeof window === 'undefined') return 0;
  return Number(window.innerWidth) || 0;
}

export function getMinimumChatPaneWidth(viewportWidth = getViewportWidth()) {
  return viewportWidth > 0 ? Math.min(viewportWidth, Math.max(MIN_CHAT_PANE_WIDTH, Math.floor(viewportWidth * MIN_CHAT_PANE_RATIO))) : 0;
}

export function clampSidebarWidth(width, viewportWidth = getViewportWidth(), editorWidth = 0, reservedWidth = 0) {
  const reserved = getMinimumChatPaneWidth(viewportWidth) + WORKSPACE_SPLITTER_WIDTH + Math.max(0, Number(reservedWidth) || 0) + (editorWidth > 0 ? EDITOR_SPLITTER_WIDTH + Math.max(0, editorWidth) : 0);
  const dynamicMax = viewportWidth > 0 ? Math.floor(viewportWidth - reserved) : MAX_SIDEBAR_WIDTH;
  return Math.min(Math.max(Number(width) || 0, MIN_SIDEBAR_WIDTH), Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, dynamicMax)));
}

export function clampEditorWidth(width, viewportWidth = getViewportWidth(), sidebarWidth = 0, reservedWidth = 0) {
  const reserved = getMinimumChatPaneWidth(viewportWidth) + EDITOR_SPLITTER_WIDTH + Math.max(0, Number(reservedWidth) || 0) + (sidebarWidth > 0 ? WORKSPACE_SPLITTER_WIDTH + Math.max(0, sidebarWidth) : 0);
  const dynamicMax = viewportWidth > 0 ? Math.floor(viewportWidth - reserved) : MAX_EDITOR_WIDTH;
  return Math.min(Math.max(Number(width) || 0, MIN_EDITOR_WIDTH), Math.max(MIN_EDITOR_WIDTH, Math.min(MAX_EDITOR_WIDTH, dynamicMax)));
}

export function occupiedPaneWidth(shell, selector) {
  const pane = shell.querySelector?.(selector);
  if (!pane || getComputedStyle(pane).position === 'fixed' || getComputedStyle(pane).position === 'absolute') return 0;
  return pane.getBoundingClientRect().width;
}

/** Width taken by the left workbench side bar (activity bar and view) and its divider; it constrains the right-hand panes too. */
export function occupiedSessionsWidth(shell) {
  return occupiedPaneWidth(shell, '.workbench-sidebar') + occupiedPaneWidth(shell, '.workbench-splitter');
}

/**
 * The editor and file tree sit to the right of the chat. Their dividers are on
 * their left edge, so dragging left (negative dx) widens them.
 */
export function resizeRightPaneWidth(startWidth, deltaX) {
  return startWidth - deltaX;
}

export const PANE_COLLAPSE_RATIO = 0.55;
export const WORKSPACE_TREE_TOGGLE_EVENT = 'piclaw:workspace-tree-toggle';
export const EDITOR_PANE_COLLAPSED_ATTRIBUTE = 'data-editor-collapsed';
const KEYBOARD_STEP = 16;
const KEYBOARD_LARGE_STEP = 64;

export function isEditorPaneCollapsed(shell) {
  return shell?.getAttribute?.(EDITOR_PANE_COLLAPSED_ATTRIBUTE) === 'true';
}

/** Collapse or restore the editor pane without unmounting its tabs or pane instances. */
export function setEditorPaneCollapsed(shell, collapsed) {
  if (!shell) return;
  if (collapsed) shell.setAttribute(EDITOR_PANE_COLLAPSED_ATTRIBUTE, 'true');
  else shell.removeAttribute(EDITOR_PANE_COLLAPSED_ATTRIBUTE);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('piclaw:editor-pane-collapse', { detail: { collapsed: Boolean(collapsed) } }));
    if (!collapsed) window.dispatchEvent(new CustomEvent('dock-resize'));
  }
}

interface HorizontalDragOptions {
  shell: any;
  startWidth: number;
  apply: (width: number) => void;
  finish: (width: number) => void;
  resizingClass?: string;
}

function startHorizontalDrag(e, { shell, startWidth, apply, finish, resizingClass }: HorizontalDragOptions) {
  const touch = e.touches?.[0];
  const startX = touch ? touch.clientX : e.clientX;
  const splitter = e.currentTarget;
  splitter.classList.add('dragging');
  if (resizingClass) shell.classList.add(resizingClass);
  if (!touch) document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  let lastX = startX;
  const moveEvent = touch ? 'touchmove' : 'mousemove';
  const endEvents = touch ? ['touchend', 'touchcancel'] : ['mouseup'];
  const onMove = (event) => {
    const point = touch ? event.touches?.[0] : event;
    if (!point) return;
    if (touch) event.preventDefault();
    lastX = point.clientX;
    apply(resizeRightPaneWidth(startWidth, lastX - startX));
  };
  const onUp = () => {
    splitter.classList.remove('dragging');
    if (resizingClass) shell.classList.remove(resizingClass);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    finish(resizeRightPaneWidth(startWidth, lastX - startX));
    document.removeEventListener(moveEvent, onMove);
    for (const name of endEvents) document.removeEventListener(name, onUp);
  };
  document.addEventListener(moveEvent, onMove, touch ? { passive: false } : undefined);
  for (const name of endEvents) document.addEventListener(name, onUp);
}

/** Keyboard step for a right-hand pane divider: ArrowLeft widens, ArrowRight narrows. */
export interface RightPaneKeyboardOptions {
  shiftKey?: boolean;
  min?: number;
  max?: number;
}

export function resolveRightPaneKeyboardWidth(key: string, current: number, { shiftKey = false, min, max }: RightPaneKeyboardOptions = {}): number | null {
  const step = shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
  if (key === 'ArrowLeft') return current + step;
  if (key === 'ArrowRight') return current - step;
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return null;
}

/**
 * Width available to the shell. Add-ons that dock on the right (for example the
 * plan sidebar) shrink it through --piclaw-shell-inset-right, so the viewport
 * width alone would over-allow pane widths.
 */
export function getShellWidth(shell) {
  const width = shell?.getBoundingClientRect?.().width;
  return Number.isFinite(width) && width > 0 ? width : getViewportWidth();
}

export function useSplitters({ appShellRef, sidebarWidthRef, editorWidthRef, dockHeightRef }) {
  const sidebarClamp = (shell, width) => clampSidebarWidth(width, getShellWidth(shell), occupiedPaneWidth(shell, '.editor-pane-container'), occupiedSessionsWidth(shell));
  const editorClamp = (shell, width) => clampEditorWidth(width, getShellWidth(shell), occupiedPaneWidth(shell, '.workspace-sidebar'), occupiedSessionsWidth(shell));

  const applySidebarWidth = (shell, width, persist) => {
    const w = sidebarClamp(shell, width);
    shell.style.setProperty('--sidebar-width', `${w}px`);
    sidebarWidthRef.current = w;
    if (persist) setLocalStorageItem('sidebarWidth', String(Math.round(w)));
    return w;
  };
  const applyEditorWidth = (shell, width, persist) => {
    const w = editorClamp(shell, width);
    shell.style.setProperty('--editor-width', `${w}px`);
    editorWidthRef.current = w;
    if (persist) setLocalStorageItem('editorWidth', String(Math.round(w)));
    window.dispatchEvent(new CustomEvent('dock-resize'));
    return w;
  };
  const toggleTree = () => window.dispatchEvent(new CustomEvent(WORKSPACE_TREE_TOGGLE_EVENT));

  const startSidebarDrag = (e) => {
    e.preventDefault();
    const shell = appShellRef.current;
    if (!shell) return;
    const startWidth = sidebarWidthRef.current || 280;
    startHorizontalDrag(e, {
      shell,
      startWidth,
      resizingClass: 'sidebar-resizing',
      apply: (width) => { if (width >= MIN_SIDEBAR_WIDTH * PANE_COLLAPSE_RATIO) applySidebarWidth(shell, width, false); },
      finish: (width) => {
        if (width < MIN_SIDEBAR_WIDTH * PANE_COLLAPSE_RATIO) {
          applySidebarWidth(shell, startWidth, false);
          toggleTree();
          return;
        }
        applySidebarWidth(shell, width, true);
      },
    });
  };

  const startEditorDrag = (e) => {
    e.preventDefault();
    const shell = appShellRef.current;
    if (!shell) return;
    const collapsed = isEditorPaneCollapsed(shell);
    const startWidth = collapsed ? 0 : (occupiedPaneWidth(shell, '.editor-pane-container') || editorWidthRef.current || 280);
    startHorizontalDrag(e, {
      shell,
      startWidth,
      apply: (width) => {
        if (width < MIN_EDITOR_WIDTH * PANE_COLLAPSE_RATIO) return;
        if (isEditorPaneCollapsed(shell)) setEditorPaneCollapsed(shell, false);
        applyEditorWidth(shell, width, false);
      },
      finish: (width) => {
        if (width < MIN_EDITOR_WIDTH * PANE_COLLAPSE_RATIO) {
          setEditorPaneCollapsed(shell, true);
          return;
        }
        if (isEditorPaneCollapsed(shell)) setEditorPaneCollapsed(shell, false);
        applyEditorWidth(shell, width, true);
      },
    });
  };

  const handleSplitterMouseDown = useRef(startSidebarDrag).current;
  const handleSplitterTouchStart = useRef(startSidebarDrag).current;
  const handleEditorSplitterMouseDown = useRef(startEditorDrag).current;
  const handleEditorSplitterTouchStart = useRef(startEditorDrag).current;

  const handleSplitterKeyDown = useRef((e) => {
    const shell = appShellRef.current;
    if (!shell) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleTree();
      return;
    }
    const current = sidebarWidthRef.current || 280;
    const next = resolveRightPaneKeyboardWidth(e.key, current, { shiftKey: e.shiftKey, min: MIN_SIDEBAR_WIDTH, max: MAX_SIDEBAR_WIDTH });
    if (next === null) return;
    e.preventDefault();
    applySidebarWidth(shell, next, true);
  }).current;

  const handleEditorSplitterKeyDown = useRef((e) => {
    const shell = appShellRef.current;
    if (!shell) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setEditorPaneCollapsed(shell, !isEditorPaneCollapsed(shell));
      return;
    }
    const collapsed = isEditorPaneCollapsed(shell);
    const current = collapsed ? 0 : (occupiedPaneWidth(shell, '.editor-pane-container') || editorWidthRef.current || 280);
    const next = resolveRightPaneKeyboardWidth(e.key, current, { shiftKey: e.shiftKey, min: MIN_EDITOR_WIDTH, max: MAX_EDITOR_WIDTH });
    if (next === null) return;
    e.preventDefault();
    if (next < MIN_EDITOR_WIDTH * PANE_COLLAPSE_RATIO) {
      setEditorPaneCollapsed(shell, true);
      return;
    }
    if (collapsed) setEditorPaneCollapsed(shell, false);
    applyEditorWidth(shell, collapsed ? Math.max(next, MIN_EDITOR_WIDTH) : next, true);
  }).current;

  const handleSplitterDoubleClick = useRef(() => {
    const shell = appShellRef.current;
    if (shell) applySidebarWidth(shell, 280, true);
  }).current;

  const handleEditorSplitterDoubleClick = useRef(() => {
    const shell = appShellRef.current;
    if (!shell) return;
    if (isEditorPaneCollapsed(shell)) setEditorPaneCollapsed(shell, false);
    applyEditorWidth(shell, Math.round(getShellWidth(shell) * 0.4), true);
  }).current;

  const handleDockSplitterMouseDown = useRef((e) => {
    e.preventDefault();
    const shell = appShellRef.current;
    if (!shell) return;
    const startY = e.clientY;
    const startH = dockHeightRef?.current || 200;
    const splitter = e.currentTarget;
    splitter.classList.add('dragging');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    let lastY = startY;
    const onMove = (me) => {
      lastY = me.clientY;
      // Dragging up increases dock height
      const h = Math.min(Math.max(startH - (me.clientY - startY), 100), window.innerHeight * 0.5);
      shell.style.setProperty('--dock-height', `${h}px`);
      if (dockHeightRef) dockHeightRef.current = h;
      window.dispatchEvent(new CustomEvent('dock-resize'));
    };
    const onUp = () => {
      const h = Math.min(Math.max(startH - (lastY - startY), 100), window.innerHeight * 0.5);
      if (dockHeightRef) dockHeightRef.current = h;
      splitter.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLocalStorageItem('dockHeight', String(Math.round(h)));
      // Notify dock pane of resize
      window.dispatchEvent(new CustomEvent('dock-resize'));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }).current;

  const handleDockSplitterTouchStart = useRef((e) => {
    e.preventDefault();
    const shell = appShellRef.current;
    if (!shell) return;
    const touch = e.touches[0];
    if (!touch) return;
    const startY = touch.clientY;
    const startH = dockHeightRef?.current || 200;
    const splitter = e.currentTarget;
    splitter.classList.add('dragging');
    document.body.style.userSelect = 'none';

    const onMove = (te) => {
      const t = te.touches[0];
      if (!t) return;
      te.preventDefault();
      const h = Math.min(Math.max(startH - (t.clientY - startY), 100), window.innerHeight * 0.5);
      shell.style.setProperty('--dock-height', `${h}px`);
      if (dockHeightRef) dockHeightRef.current = h;
      window.dispatchEvent(new CustomEvent('dock-resize'));
    };
    const onUp = () => {
      splitter.classList.remove('dragging');
      document.body.style.userSelect = '';
      setLocalStorageItem('dockHeight', String(Math.round(dockHeightRef?.current || startH)));
      window.dispatchEvent(new CustomEvent('dock-resize'));
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('touchcancel', onUp);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);
  }).current;

  return {
    handleSplitterMouseDown,
    handleSplitterTouchStart,
    handleSplitterKeyDown,
    handleSplitterDoubleClick,
    handleEditorSplitterMouseDown,
    handleEditorSplitterTouchStart,
    handleEditorSplitterKeyDown,
    handleEditorSplitterDoubleClick,
    handleDockSplitterMouseDown,
    handleDockSplitterTouchStart,
  };
}
