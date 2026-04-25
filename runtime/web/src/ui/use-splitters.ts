import { useRef } from '../vendor/preact-htm.js';
import { setLocalStorageItem } from '../utils/storage.js';

const MIN_CHAT_PANE_RATIO = 0.10;
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
  return viewportWidth > 0 ? Math.floor(viewportWidth * MIN_CHAT_PANE_RATIO) : 0;
}

export function clampSidebarWidth(width, viewportWidth = getViewportWidth(), editorWidth = 0) {
  const reserved = getMinimumChatPaneWidth(viewportWidth) + WORKSPACE_SPLITTER_WIDTH + (editorWidth > 0 ? EDITOR_SPLITTER_WIDTH + Math.max(0, editorWidth) : 0);
  const dynamicMax = viewportWidth > 0 ? Math.floor(viewportWidth - reserved) : MAX_SIDEBAR_WIDTH;
  return Math.min(Math.max(Number(width) || 0, MIN_SIDEBAR_WIDTH), Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, dynamicMax)));
}

export function clampEditorWidth(width, viewportWidth = getViewportWidth(), sidebarWidth = 0) {
  const reserved = getMinimumChatPaneWidth(viewportWidth) + EDITOR_SPLITTER_WIDTH + (sidebarWidth > 0 ? WORKSPACE_SPLITTER_WIDTH + Math.max(0, sidebarWidth) : 0);
  const dynamicMax = viewportWidth > 0 ? Math.floor(viewportWidth - reserved) : MAX_EDITOR_WIDTH;
  return Math.min(Math.max(Number(width) || 0, MIN_EDITOR_WIDTH), Math.max(MIN_EDITOR_WIDTH, Math.min(MAX_EDITOR_WIDTH, dynamicMax)));
}

export function useSplitters({ appShellRef, sidebarWidthRef, editorWidthRef, dockHeightRef }) {
  const handleSplitterMouseDown = useRef((e) => {
    e.preventDefault();
    const shell = appShellRef.current;
    if (!shell) return;
    const startX = e.clientX;
    const startW = sidebarWidthRef.current || 280;
    const splitter = e.currentTarget;
    splitter.classList.add('dragging');
    shell.classList.add('sidebar-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    let lastX = startX;
    const onMove = (me) => {
      lastX = me.clientX;
      const w = clampSidebarWidth(startW + (me.clientX - startX), getViewportWidth(), editorWidthRef?.current || 0);
      shell.style.setProperty('--sidebar-width', `${w}px`);
      sidebarWidthRef.current = w;
    };
    const onUp = () => {
      const w = clampSidebarWidth(startW + (lastX - startX), getViewportWidth(), editorWidthRef?.current || 0);
      sidebarWidthRef.current = w;
      splitter.classList.remove('dragging');
      shell.classList.remove('sidebar-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLocalStorageItem('sidebarWidth', String(Math.round(w)));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }).current;

  const handleSplitterTouchStart = useRef((e) => {
    e.preventDefault();
    const shell = appShellRef.current;
    if (!shell) return;
    const touch = e.touches[0];
    if (!touch) return;
    const startX = touch.clientX;
    const startW = sidebarWidthRef.current || 280;
    const splitter = e.currentTarget;
    splitter.classList.add('dragging');
    shell.classList.add('sidebar-resizing');
    document.body.style.userSelect = 'none';

    const onMove = (te) => {
      const t = te.touches[0];
      if (!t) return;
      te.preventDefault();
      const w = clampSidebarWidth(startW + (t.clientX - startX), getViewportWidth(), editorWidthRef?.current || 0);
      shell.style.setProperty('--sidebar-width', `${w}px`);
      sidebarWidthRef.current = w;
    };
    const onUp = () => {
      splitter.classList.remove('dragging');
      shell.classList.remove('sidebar-resizing');
      document.body.style.userSelect = '';
      setLocalStorageItem('sidebarWidth', String(Math.round(sidebarWidthRef.current || startW)));
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('touchcancel', onUp);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);
  }).current;

  const handleEditorSplitterMouseDown = useRef((e) => {
    e.preventDefault();
    const shell = appShellRef.current;
    if (!shell) return;
    const startX = e.clientX;
    const startW = editorWidthRef.current || sidebarWidthRef.current || 280;
    const splitter = e.currentTarget;
    splitter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    let lastX = startX;
    const onMove = (me) => {
      lastX = me.clientX;
      const w = clampEditorWidth(startW + (me.clientX - startX), getViewportWidth(), sidebarWidthRef?.current || 0);
      shell.style.setProperty('--editor-width', `${w}px`);
      editorWidthRef.current = w;
    };
    const onUp = () => {
      const w = clampEditorWidth(startW + (lastX - startX), getViewportWidth(), sidebarWidthRef?.current || 0);
      editorWidthRef.current = w;
      splitter.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setLocalStorageItem('editorWidth', String(Math.round(w)));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }).current;

  const handleEditorSplitterTouchStart = useRef((e) => {
    e.preventDefault();
    const shell = appShellRef.current;
    if (!shell) return;
    const touch = e.touches[0];
    if (!touch) return;
    const startX = touch.clientX;
    const startW = editorWidthRef.current || sidebarWidthRef.current || 280;
    const splitter = e.currentTarget;
    splitter.classList.add('dragging');
    document.body.style.userSelect = 'none';

    const onMove = (te) => {
      const t = te.touches[0];
      if (!t) return;
      te.preventDefault();
      const w = clampEditorWidth(startW + (t.clientX - startX), getViewportWidth(), sidebarWidthRef?.current || 0);
      shell.style.setProperty('--editor-width', `${w}px`);
      editorWidthRef.current = w;
    };
    const onUp = () => {
      splitter.classList.remove('dragging');
      document.body.style.userSelect = '';
      setLocalStorageItem('editorWidth', String(Math.round(editorWidthRef.current || startW)));
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('touchcancel', onUp);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);
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
    handleEditorSplitterMouseDown,
    handleEditorSplitterTouchStart,
    handleDockSplitterMouseDown,
    handleDockSplitterTouchStart,
  };
}
