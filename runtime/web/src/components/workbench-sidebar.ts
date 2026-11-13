// @ts-nocheck
/**
 * workbench-sidebar.ts — Classic workbench side bar.
 *
 * A Visual-style activity bar selects one view at a time: Sessions or the
 * workspace Explorer. Clicking the active view's icon collapses the side bar;
 * the activity bar stays. The activity bar can be hidden too (from the global
 * menu), leaving only the menu button: the side bar then opens as a drawer, as
 * it does on narrow screens. The global menu button sits in the activity
 * bar's top slot. The system meters, toggled from the activity bar, sit at
 * the foot of the side bar while it is shown.
 *
 * Sessions reuses the compose picker's grouping, search and pin preferences,
 * and carries the session-dashboard summaries: activity state, live previews
 * for other active sessions, the latest reply and its age, and context use.
 * Session data refreshes only while the Sessions view is visible.
 */
import { html, useCallback, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { resolveSessionPopupChats } from './compose-box.js';
import { filterSessionPickerChats, groupSessionPickerChats } from '../ui/compose-session-switcher.js';
import { getBranchLifecycleBadges, normalizeHandle } from '../ui/branch-lifecycle.js';
import {
  SESSION_PICKER_PREFERENCES_EVENT,
  readSessionPickerPreferences,
  togglePinnedSessionChatJid,
} from '../ui/session-picker-preferences.js';
import { getLocalStorageItem, setLocalStorageItem } from '../utils/storage.js';
import { getShellWidth, occupiedPaneWidth } from '../ui/use-splitters.js';
import { SystemMetersHud } from './system-meters-hud.js';
import { METERS_COLLAPSED_EVENT_NAME, readStoredMetersCollapsed, toggleMetersCollapsed } from '../ui/meters.js';
import { WINDOW_SIDEBAR_OPEN_STORAGE_KEY, persistWindowScopedPreference, readWindowScopedPreference } from '../ui/workspace-visibility.js';
import { buildChatWindowUrl } from '../ui/chat-window.js';
import { matchesKeyboardShortcutAction } from '../ui/keyboard-shortcuts.js';
import {
  cleanSessionPreviewText,
  formatSessionActivityAge,
  formatSessionActivityStatus,
  isNewTabSessionClick,
  resolveSessionContextPercent,
  resolveSessionLivePreview,
} from '../ui/session-activity.js';

export const SESSIONS_OPEN_STORAGE_KEY = 'sessionsOpen.desktop';
export const SESSIONS_WIDTH_STORAGE_KEY = 'sessionsWidth';
export const SESSIONS_DEFAULT_WIDTH = 260;
export const SESSIONS_MIN_WIDTH = 200;
export const SESSIONS_MAX_WIDTH = 420;
/** Width of the always-visible activity bar on wide screens. */
export const ACTIVITY_BAR_WIDTH = 48;
export const WORKBENCH_TOGGLE_EVENT = 'piclaw:sessions-sidebar-toggle';
/** Commands from the global menu: { command: 'view', view } | { command: 'plan' } | { command: 'activity-bar' }. */
export const WORKBENCH_COMMAND_EVENT = 'piclaw:workbench-command';
export const ACTIVITY_BAR_HIDDEN_STORAGE_KEY = 'workbench.activityBarHidden';

/** Whether the activity bar is hidden, leaving only the global menu button. */
export function readActivityBarHidden(): boolean {
  return getLocalStorageItem(ACTIVITY_BAR_HIDDEN_STORAGE_KEY) === 'true';
}

export function dispatchWorkbenchCommand(command: 'view' | 'plan' | 'activity-bar', detail: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORKBENCH_COMMAND_EVENT, { detail: { ...detail, command } }));
}
const WIDE_LAYOUT_QUERY = '(min-width: 1024px) and (orientation: landscape)';
const KEYBOARD_STEP = 16;
const KEYBOARD_LARGE_STEP = 64;
/** Session list and reply refresh while the pane is visible. */
export const SESSIONS_REFRESH_INTERVAL_MS = 15000;
/** Live preview refresh for other active sessions while the pane is visible. */
export const SESSIONS_PREVIEW_INTERVAL_MS = 3000;
/** At most this many other active sessions are polled for live previews. */
export const SESSIONS_PREVIEW_LIMIT = 8;

/** This window's side bar state; the shared value is the default for new windows. */
export function readStoredSessionsOpen(): boolean {
  return readWindowScopedPreference(WINDOW_SIDEBAR_OPEN_STORAGE_KEY, SESSIONS_OPEN_STORAGE_KEY, true);
}

export function clampSessionsWidth(width: unknown, maxWidth = SESSIONS_MAX_WIDTH): number {
  const numeric = Number(width);
  const value = Number.isFinite(numeric) ? numeric : SESSIONS_DEFAULT_WIDTH;
  const max = Math.max(SESSIONS_MIN_WIDTH, Math.min(SESSIONS_MAX_WIDTH, Math.floor(maxWidth)));
  return Math.round(Math.min(Math.max(value, SESSIONS_MIN_WIDTH), max));
}

export function readStoredSessionsWidth(): number {
  return clampSessionsWidth(getLocalStorageItem(SESSIONS_WIDTH_STORAGE_KEY) ?? SESSIONS_DEFAULT_WIDTH);
}

/** Sidebar sections: the same groups as the compose session picker, without archived sessions. */
/** Archived sessions, newest first, filtered with the same search as the other sections. */
export function buildArchivedSessions(activeChatAgents, currentChatJid, query = '') {
  const archived = resolveSessionPopupChats(activeChatAgents, currentChatJid).filter((chat) => chat?.archived_at);
  return filterSessionPickerChats(archived, query)
    .sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at)));
}

export function buildSessionsSidebarSections(activeChatAgents, currentChatJid, pinnedChatJids, query = '') {
  const chats = resolveSessionPopupChats(activeChatAgents, currentChatJid).filter((chat) => !chat?.archived_at);
  return groupSessionPickerChats(filterSessionPickerChats(chats, query), currentChatJid, pinnedChatJids)
    .filter((section) => section.key !== 'archived');
}

/** Plain /agent/status for one chat: status, data, draft and thought only. */
async function fetchSessionStatus(chatJid: string) {
  const response = await fetch(`/agent/status?chat_jid=${encodeURIComponent(chatJid)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Session status HTTP ${response.status}`);
  return response.json();
}

/** The row's model, without the context figures the ring already shows. */
function formatSessionPickerModel(chat): string {
  const model = typeof chat?.model === 'string' && chat.model.trim() ? chat.model.trim() : (typeof chat?.model_label === 'string' ? chat.model_label.trim() : '');
  return model;
}

/** Context use of one chat from /agent/context: tokens, window and percent. */
async function fetchSessionContext(chatJid: string) {
  const response = await fetch(`/agent/context?chat_jid=${encodeURIComponent(chatJid)}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Session context HTTP ${response.status}`);
  return response.json();
}

/** Context use refreshes this often while the Sessions view is visible. */
export const SESSIONS_CONTEXT_INTERVAL_MS = 60000;
/** At most this many rows read their context per refresh. */
export const SESSIONS_CONTEXT_LIMIT = 40;

/** Context percent of a row: the listed value, else the one read from /agent/context. */
export function resolveSessionRowContext(chat, fetched): { percent: number; label: string } | null {
  const listed = resolveSessionContextPercent(chat);
  const percent = listed ?? resolveSessionContextPercent({ context_percent: fetched?.percent, context_tokens: fetched?.tokens, context_window: fetched?.contextWindow });
  if (percent == null) return null;
  const tokens = Number(chat?.context_tokens ?? fetched?.tokens);
  const window = Number(chat?.context_window ?? fetched?.contextWindow);
  const compact = (value) => (value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(Math.round(value)));
  const detail = Number.isFinite(tokens) && Number.isFinite(window) && window > 0 ? ` (${compact(tokens)} / ${compact(window)} tokens)` : '';
  return { percent, label: `Context ${Math.round(percent)}%${detail}` };
}

/** Other active sessions that get a live preview, current session excluded. */
export function selectSessionsPreviewTargets(activeChatAgents, currentChatJid, limit = SESSIONS_PREVIEW_LIMIT): string[] {
  return resolveSessionPopupChats(activeChatAgents, currentChatJid)
    .filter((chat) => chat?.is_active && !chat?.archived_at && chat.chat_jid !== currentChatJid)
    .map((chat) => chat.chat_jid)
    .slice(0, limit);
}

function samePreviews(left, right): boolean {
  if (left.size !== right.size) return false;
  for (const [jid, preview] of left) {
    const other = right.get(jid);
    if (!other || other.kind !== preview.kind || other.text !== preview.text) return false;
  }
  return true;
}

/**
 * Width available to the sessions pane beside the chat minimum and the
 * right-hand panes. Below SESSIONS_MIN_WIDTH the pane hides itself.
 */
export function availableSessionsWidth({ viewportWidth, rightPanesWidth, chatMinWidth = 320, splitterWidth = 4, activityBarWidth = ACTIVITY_BAR_WIDTH }) {
  return Math.floor(viewportWidth - rightPanesWidth - splitterWidth - chatMinWidth - activityBarWidth);
}

export type WorkbenchView = 'sessions' | 'explorer';

/** Initial view: the Explorer when the workspace is already open, otherwise Sessions. */
export function resolveInitialWorkbenchView(workspaceOpen: boolean): WorkbenchView {
  return workspaceOpen ? 'explorer' : 'sessions';
}

function readWideLayout(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(WIDE_LAYOUT_QUERY).matches
    : true;
}

const ACTIVITY_ICONS = {
  sessions: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8M8 13h5" /></svg>`,
  explorer: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V7z" /><path d="M14 3v4h4" /><path d="M9 21h9a2 2 0 0 0 2-2V9" /></svg>`,
  meters: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>`,
  plan: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.2 1.2L7 5" /><path d="m3.5 12 1.2 1.2L7 11" /><circle cx="5" cy="18" r="1.4" /></svg>`,
  settings: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>`,
};

const SESSION_ICONS = {
  add: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>`,
  fork: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="12" cy="19" r="2" /><path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5" /></svg>`,
  refresh: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>`,
  more: html`<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>`,
  restore: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>`,
  pin: html`<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6l-1 6 4 4H6l4-4z" /><path d="M12 13v8" /></svg>`,
  trash: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>`,
};

const WORKBENCH_VIEWS: Array<{ id: WorkbenchView; label: string }> = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'explorer', label: 'Explorer' },
];

export function WorkbenchSidebar({
  activeChatAgents,
  currentChatJid,
  onSwitchChat,
  appShellRef,
  chatMinWidth = 320,
  onRefreshSessions = null,
  loadSessionStatus = fetchSessionStatus,
  loadSessionContext = fetchSessionContext,
  explorer = null,
  workspaceOpen = false,
  setWorkspaceVisible = null,
  onOpenSettings = null,
  onOpenPlan = null,
  sessionActions = null,
}) {
  const [storedOpen, setOpen] = useState(readStoredSessionsOpen);
  const [view, setView] = useState(() => resolveInitialWorkbenchView(workspaceOpen));
  const [wide, setWide] = useState(readWideLayout);
  const [activityHidden, setActivityHidden] = useState(readActivityBarHidden);
  // Narrow screens, and wide ones with the activity bar hidden, open the side bar as a drawer.
  const drawerMode = !wide || activityHidden;
  const [drawerOpen, setDrawerOpen] = useState(() => (!readWideLayout() || readActivityBarHidden()) && workspaceOpen);
  const [metersOn, setMetersOn] = useState(() => !readStoredMetersCollapsed(false));
  // When the window cannot fit sessions, chat and the right-hand panes, hide
  // sessions first without changing the saved preference. Showing them again
  // explicitly overrides this until the layout changes.
  const [autoHidden, setAutoHidden] = useState(false);
  const [override, setOverride] = useState(false);
  const open = storedOpen && (!autoHidden || override);
  // Shown: the view host is visible (desktop side bar or narrow drawer).
  const shown = drawerMode ? drawerOpen : open;
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState(() => readSessionPickerPreferences().pinnedChatJids);
  // widthRef is the saved preference; the rendered width may be narrower when space is short.
  const widthRef = useRef(readStoredSessionsWidth());
  const availableRef = useRef(Infinity);
  const splitterRef = useRef(null);
  const asideRef = useRef(null);
  const [previews, setPreviews] = useState(() => new Map());
  const [contexts, setContexts] = useState(() => new Map());
  const retainedPreviewsRef = useRef(new Map());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sync = (event) => setPinned(event?.detail?.pinnedChatJids || readSessionPickerPreferences().pinnedChatJids);
    window.addEventListener(SESSION_PICKER_PREFERENCES_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SESSION_PICKER_PREFERENCES_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const applyWidth = useCallback((width) => {
    widthRef.current = width;
    const rendered = Math.max(SESSIONS_MIN_WIDTH, Math.min(width, availableRef.current));
    appShellRef?.current?.style?.setProperty('--workbench-sidebar-width', `${rendered}px`);
    const splitter = splitterRef.current;
    if (splitter) splitter.setAttribute('aria-valuenow', String(open ? rendered : 0));
  }, [appShellRef, open]);

  useEffect(() => { applyWidth(widthRef.current); }, [applyWidth]);

  const setOpenPersisted = useCallback((next) => {
    setOpen(next);
    setOverride(Boolean(next) && autoHidden);
    persistWindowScopedPreference(WINDOW_SIDEBAR_OPEN_STORAGE_KEY, SESSIONS_OPEN_STORAGE_KEY, Boolean(next));
  }, [autoHidden]);

  const rightPanesWidth = useCallback(() => {
    const shell = appShellRef?.current;
    if (!shell) return 0;
    return ['.editor-pane-container', '.editor-splitter']
      .reduce((sum, selector) => sum + occupiedPaneWidth(shell, selector), 0);
  }, [appShellRef]);

  const maxWidth = useCallback(() => {
    const viewport = appShellRef?.current ? getShellWidth(appShellRef.current) : 0;
    if (!viewport) return SESSIONS_MAX_WIDTH;
    return viewport - rightPanesWidth() - chatMinWidth - ACTIVITY_BAR_WIDTH - 8;
  }, [appShellRef, chatMinWidth, rightPanesWidth]);

  useEffect(() => {
    const shell = appShellRef?.current;
    if (!shell || typeof window === 'undefined') return undefined;
    let frame = 0;
    let settle = 0;
    const measure = () => {
      const available = availableSessionsWidth({ viewportWidth: getShellWidth(shell), rightPanesWidth: rightPanesWidth(), chatMinWidth });
      const fits = available >= SESSIONS_MIN_WIDTH;
      if (available !== availableRef.current) {
        availableRef.current = available;
        applyWidth(widthRef.current);
      }
        setAutoHidden((previous) => {
          if (previous === !fits) return previous;
          setOverride(false);
          return !fits;
        });
    };
    // Re-measure after pane width transitions finish as well as on the next frame.
    const update = () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      frame = requestAnimationFrame(measure);
      settle = setTimeout(measure, 320);
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(shell);
    const mutation = typeof MutationObserver === 'function' ? new MutationObserver(update) : null;
    mutation?.observe(shell, { attributes: true, attributeFilter: ['class', 'style', 'data-editor-collapsed'], childList: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      observer?.disconnect();
      mutation?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [appShellRef, applyWidth, chatMinWidth, rightPanesWidth]);

  useEffect(() => {
    // Right-hand panes keep room for the activity bar, and for the side bar at its minimum while it is open.
    const reserved = drawerMode ? 0 : ACTIVITY_BAR_WIDTH + (open ? SESSIONS_MIN_WIDTH + 4 : 0);
    appShellRef?.current?.style?.setProperty('--workbench-reserved', `${reserved}px`);
    appShellRef?.current?.setAttribute?.('data-workbench-sidebar', shown ? 'shown' : 'hidden');
    appShellRef?.current?.setAttribute?.('data-workbench-activity', activityHidden ? 'hidden' : 'shown');
    window.dispatchEvent(new CustomEvent(WORKBENCH_TOGGLE_EVENT, { detail: { open: shown, view, activityHidden } }));
  }, [activityHidden, appShellRef, drawerMode, open, shown, view]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(WIDE_LAYOUT_QUERY);
    const sync = () => {
      setWide(query.matches);
      if (query.matches) setDrawerOpen(false);
    };
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  const setShown = useCallback((next: boolean) => {
    if (drawerMode) setDrawerOpen(next);
    else setOpenPersisted(next);
  }, [drawerMode, setOpenPersisted]);

  // The workspace explorer is visible exactly when the Explorer view is shown.
  // Keep the app's workspaceOpen state in step with the side bar, and follow
  // external toggles (file-tree shortcut, timeline menu, quick actions).
  const previousRef = useRef({ workspaceOpen, shown, view });
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { workspaceOpen, shown, view };
    if (workspaceOpen !== previous.workspaceOpen) {
      if (workspaceOpen) {
        if (view !== 'explorer') setView('explorer');
        if (!shown) setShown(true);
      } else if (view === 'explorer' && shown) {
        setShown(false);
      }
      return;
    }
    const explorerShown = shown && view === 'explorer';
    if (explorerShown !== workspaceOpen) setWorkspaceVisible?.(explorerShown);
  }, [setShown, setView, setWorkspaceVisible, shown, view, workspaceOpen]);

  const selectView = useCallback((next: WorkbenchView) => {
    if (shown && view === next) {
      setShown(false);
      return;
    }
    setView(next);
    if (!shown) setShown(true);
  }, [setShown, setView, shown, view]);

  const toggleActivityBar = useCallback(() => {
    setDrawerOpen(false);
    setActivityHidden((hidden) => {
      setLocalStorageItem(ACTIVITY_BAR_HIDDEN_STORAGE_KEY, hidden ? 'false' : 'true');
      return !hidden;
    });
  }, []);

  // Global menu commands: views, the Plan tab and the activity bar itself.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onCommand = (event) => {
      const { command, view: target } = event?.detail || {};
      if (command === 'view' && (target === 'sessions' || target === 'explorer')) selectView(target);
      else if (command === 'plan') onOpenPlan?.();
      else if (command === 'activity-bar') toggleActivityBar();
    };
    window.addEventListener(WORKBENCH_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(WORKBENCH_COMMAND_EVENT, onCommand);
  }, [onOpenPlan, selectView, toggleActivityBar]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sync = (event) => setMetersOn(!(typeof event?.detail?.collapsed === 'boolean' ? event.detail.collapsed : readStoredMetersCollapsed(false)));
    window.addEventListener(METERS_COLLAPSED_EVENT_NAME, sync);
    return () => window.removeEventListener(METERS_COLLAPSED_EVENT_NAME, sync);
  }, []);

  const resizeTo = useCallback((raw, persist = true) => {
    if (raw < SESSIONS_MIN_WIDTH * 0.55) {
      if (persist) setOpenPersisted(false);
      return;
    }
    if (!open) setOpenPersisted(true);
    const width = clampSessionsWidth(raw, maxWidth());
    applyWidth(width);
    if (persist) setLocalStorageItem(SESSIONS_WIDTH_STORAGE_KEY, String(width));
  }, [applyWidth, maxWidth, open, setOpenPersisted]);

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const splitter = event.currentTarget;
    const shell = appShellRef?.current;
    splitter.setPointerCapture?.(event.pointerId);
    splitter.classList.add('dragging');
    shell?.classList.add('workbench-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const startX = event.clientX;
    const startWidth = open ? widthRef.current : 0;
    let last = startWidth;
    const onMove = (moveEvent) => {
      last = startWidth + (moveEvent.clientX - startX);
      if (last >= SESSIONS_MIN_WIDTH * 0.55) {
        if (!open) setOpen(true);
        applyWidth(clampSessionsWidth(last, maxWidth()));
      }
    };
    const onUp = () => {
      splitter.classList.remove('dragging');
      shell?.classList.remove('workbench-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      splitter.removeEventListener('pointermove', onMove);
      splitter.removeEventListener('pointerup', onUp);
      splitter.removeEventListener('pointercancel', onUp);
      resizeTo(last);
    };
    splitter.addEventListener('pointermove', onMove);
    splitter.addEventListener('pointerup', onUp);
    splitter.addEventListener('pointercancel', onUp);
  }, [appShellRef, applyWidth, maxWidth, open, resizeTo]);

  const onSplitterKeyDown = useCallback((event) => {
    const step = event.shiftKey ? KEYBOARD_LARGE_STEP : KEYBOARD_STEP;
    const current = open ? widthRef.current : 0;
    if (event.key === 'ArrowLeft') resizeTo(current - step);
    else if (event.key === 'ArrowRight') resizeTo(open ? current + step : SESSIONS_MIN_WIDTH);
    else if (event.key === 'Home') resizeTo(SESSIONS_MIN_WIDTH);
    else if (event.key === 'End') resizeTo(maxWidth());
    else if (event.key === 'Enter' || event.key === ' ') setOpenPersisted(!open);
    else return;
    event.preventDefault();
  }, [maxWidth, open, resizeTo, setOpenPersisted]);

  const onSplitterDoubleClick = useCallback(() => resizeTo(SESSIONS_DEFAULT_WIDTH), [resizeTo]);

  // Sessions data refreshes only while the Sessions view is laid out in a visible tab.
  const sessionsVisible = shown && view === 'sessions';
  const isShown = useCallback(() => {
    if (!sessionsVisible || typeof document === 'undefined' || document.visibilityState === 'hidden') return false;
    return Boolean(asideRef.current?.getClientRects?.().length);
  }, [sessionsVisible]);

  useEffect(() => {
    if (!sessionsVisible || typeof window === 'undefined') return undefined;
    const refresh = () => {
      if (!isShown()) return;
      setNow(Date.now());
      onRefreshSessions?.();
    };
    const timer = setInterval(refresh, SESSIONS_REFRESH_INTERVAL_MS);
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isShown, onRefreshSessions, sessionsVisible]);

  const previewTargets = useMemo(
    () => selectSessionsPreviewTargets(activeChatAgents, currentChatJid),
    [activeChatAgents, currentChatJid],
  );
  const previewTargetsKey = previewTargets.join('\n');

  useEffect(() => {
    const targets = previewTargetsKey ? previewTargetsKey.split('\n') : [];
    if (!sessionsVisible || targets.length === 0) {
      retainedPreviewsRef.current = new Map();
      setPreviews((previous) => (previous.size ? new Map() : previous));
      return undefined;
    }
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || !isShown()) return;
      inFlight = true;
      try {
        const results = await Promise.all(targets.map(async (jid) => {
          try {
            return [jid, { ok: true, status: await loadSessionStatus(jid) }];
          } catch {
            // A failed poll keeps the last preview rather than blanking the row.
            return [jid, { ok: false, status: null }];
          }
        }));
        if (cancelled) return;
        setPreviews((previous) => {
          const next = new Map();
          const retained = retainedPreviewsRef.current;
          for (const [jid, result] of results) {
            if (!result.ok) {
              if (previous.has(jid)) next.set(jid, previous.get(jid));
              continue;
            }
            const resolved = resolveSessionLivePreview(result.status, retained.get(jid) || null);
            if (resolved.retained) retained.set(jid, resolved.retained);
            else retained.delete(jid);
            if (resolved.preview) next.set(jid, resolved.preview);
          }
          for (const jid of [...retained.keys()]) if (!targets.includes(jid)) retained.delete(jid);
          return samePreviews(previous, next) ? previous : next;
        });
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), SESSIONS_PREVIEW_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isShown, loadSessionStatus, previewTargetsKey, sessionsVisible]);

  // Context use per row: rows the list does not size are read from /agent/context while visible.
  const contextTargetsKey = useMemo(() => resolveSessionPopupChats(activeChatAgents, currentChatJid)
    .filter((chat) => !chat?.archived_at && resolveSessionContextPercent(chat) == null)
    .map((chat) => chat.chat_jid)
    .slice(0, SESSIONS_CONTEXT_LIMIT)
    .join('\n'), [activeChatAgents, currentChatJid]);

  useEffect(() => {
    const targets = contextTargetsKey ? contextTargetsKey.split('\n') : [];
    if (!sessionsVisible || targets.length === 0) return undefined;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || !isShown()) return;
      inFlight = true;
      try {
        for (const jid of targets) {
          if (cancelled) return;
          try {
            const usage = await loadSessionContext(jid);
            if (cancelled) return;
            setContexts((previous) => {
              const current = previous.get(jid);
              if (current && current.percent === usage?.percent && current.tokens === usage?.tokens) return previous;
              const next = new Map(previous);
              next.set(jid, { percent: usage?.percent ?? null, tokens: usage?.tokens ?? null, contextWindow: usage?.contextWindow ?? null });
              return next;
            });
          } catch (error) {
            // Keep the last known value; an unreadable chat shows no meter.
            console.debug('[sessions] Context use unavailable; keeping the last value.', jid, error);
          }
        }
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), SESSIONS_CONTEXT_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [contextTargetsKey, currentChatJid, isShown, loadSessionContext, sessionsVisible]);

  // Configurable toggle (default Ctrl/Cmd+Shift+B) for the Sessions view.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onKeyDown = (event) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (!matchesKeyboardShortcutAction(event, 'toggleSessions')) return;
      // A hidden activity bar or a narrow screen opens the Sessions drawer.
      if (!asideRef.current) return;
      event.preventDefault();
      selectView('sessions');
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectView]);

  // Row menu (right-click or the row's ⋯ button) and header actions.
  const [menuFor, setMenuFor] = useState(null);
  const menuForRef = useRef(null);
  menuForRef.current = menuFor;
  // Registered once so a key or click right after opening is never missed.
  // Window capture runs before other Escape handlers (zen mode, dialogs) can stop it.
  useEffect(() => {
    const close = (event) => {
      if (!menuForRef.current) return;
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      if (event.type === 'pointerdown' && event.target?.closest?.('.sessions-row-menu, .sessions-sidebar-more')) return;
      setMenuFor(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, []);

  const runMenu = useCallback((action) => {
    setMenuFor(null);
    void action?.();
  }, []);

  const createRootSession = useCallback(() => {
    const name = window.prompt('Name for the new session');
    if (name && name.trim()) void sessionActions?.createRoot?.(name.trim());
  }, [sessionActions]);

  const openSession = useCallback((event, jid, current) => {
    if (isNewTabSessionClick(event)) {
      event.preventDefault();
      window.open(buildChatWindowUrl(window.location.href, jid), '_blank', 'noopener');
      return;
    }
    if (event.button === 0 && !current) onSwitchChat?.(jid);
  }, [onSwitchChat]);

  const sections = useMemo(
    () => buildSessionsSidebarSections(activeChatAgents, currentChatJid, pinned, query),
    [activeChatAgents, currentChatJid, pinned, query],
  );
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const archived = useMemo(
    () => buildArchivedSessions(activeChatAgents, currentChatJid, query),
    [activeChatAgents, currentChatJid, query],
  );
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  const activeCount = useMemo(
    () => resolveSessionPopupChats(activeChatAgents, currentChatJid).filter((chat) => chat?.is_active && !chat?.archived_at).length,
    [activeChatAgents, currentChatJid],
  );

  return html`
    <aside ref=${asideRef} class=${`workbench-sidebar${shown ? '' : ' collapsed'}${drawerMode ? ' drawer' : ''}`} data-view=${view} aria-label="Side bar">
      <nav class="workbench-activity-bar" role="tablist" aria-orientation="vertical" aria-label="Views">
        ${WORKBENCH_VIEWS.map((item) => html`
          <button
            key=${item.id}
            type="button"
            role="tab"
            class=${`workbench-activity-button${view === item.id && shown ? ' is-active' : ''}`}
            aria-selected=${view === item.id && shown ? 'true' : 'false'}
            aria-controls=${`workbench-view-${item.id}`}
            title=${item.id === 'explorer' ? `${item.label} (Ctrl/Cmd+Shift+E)` : `${item.label} (Ctrl/Cmd+Shift+B)`}
            aria-label=${item.label}
            onClick=${() => selectView(item.id)}
          >
            ${ACTIVITY_ICONS[item.id]}
            ${item.id === 'sessions' && activeCount > 0 && html`<span class="workbench-activity-badge" aria-label=${`${activeCount} active`}>${activeCount}</span>`}
          </button>
        `)}
        ${onOpenPlan && html`
          <button type="button" class="workbench-activity-button workbench-activity-plan" title="Plan — opens in the editor area" aria-label="Plan" onClick=${() => onOpenPlan()}>
            ${ACTIVITY_ICONS.plan}
          </button>
        `}
        <button type="button" class=${`workbench-activity-button workbench-activity-meters${metersOn ? ' is-on' : ''}`} aria-pressed=${metersOn ? 'true' : 'false'}
          title=${metersOn ? 'Hide system meters' : 'Show system meters'} aria-label="System meters" onClick=${() => toggleMetersCollapsed()}>
          ${ACTIVITY_ICONS.meters}
        </button>
        <span class="workbench-activity-spacer"></span>
        ${onOpenSettings && html`
          <button type="button" class="workbench-activity-button workbench-activity-settings" title="Settings" aria-label="Settings" onClick=${() => onOpenSettings()}>
            ${ACTIVITY_ICONS.settings}
          </button>
        `}
      </nav>
      <div class="workbench-view-host" aria-hidden=${shown ? undefined : 'true'} inert=${shown ? undefined : true}>
      <section id="workbench-view-sessions" class="workbench-view workbench-view-sessions" role="tabpanel" aria-label="Sessions" hidden=${view !== 'sessions'}>
      <div class="sessions-sidebar-header">
        <span class="sessions-sidebar-title">Sessions</span>
        ${activeCount > 0 && html`<span class="sessions-sidebar-active-count" title=${`${activeCount} active`}>${activeCount} active</span>`}
        <span class="sessions-sidebar-toolbar">
          ${sessionActions?.createRoot && html`<button type="button" class="sessions-sidebar-tool" title="New session" aria-label="New session" onClick=${createRootSession}>${SESSION_ICONS.add}</button>`}
          ${sessionActions?.fork && html`<button type="button" class="sessions-sidebar-tool" title="Fork the current session" aria-label="Fork the current session" onClick=${() => void sessionActions.fork()}>${SESSION_ICONS.fork}</button>`}
          ${onRefreshSessions && html`<button type="button" class="sessions-sidebar-tool" title="Refresh sessions" aria-label="Refresh sessions" onClick=${() => { setNow(Date.now()); onRefreshSessions(); }}>${SESSION_ICONS.refresh}</button>`}
        </span>
      </div>
      <label class="sessions-sidebar-search">
        <span class="sessions-sidebar-sr-only">Search sessions</span>
        <input type="search" value=${query} placeholder="Search sessions" autocomplete="off" onInput=${(event) => setQuery(event.currentTarget.value)} />
      </label>
      <nav class="sessions-sidebar-list" aria-label="Session list">
        ${total === 0 && html`<div class="sessions-sidebar-empty">${query ? `No sessions match “${query}”.` : 'No sessions.'}</div>`}
        ${sections.map((section) => html`
          <section key=${section.key} class=${`sessions-sidebar-section sessions-sidebar-section-${section.key}`} aria-label=${section.label}>
            <h2 class="sessions-sidebar-section-heading">${section.label}</h2>
            <ul class="sessions-sidebar-items">
              ${section.items.map((chat) => {
                const jid = chat.chat_jid;
                const current = jid === currentChatJid;
                const isPinned = pinnedSet.has(jid);
                const handle = normalizeHandle(chat.agent_name) || jid;
                const handleLabel = handle.startsWith("@") ? handle : `@${handle}`;
                // The activity label and dot already say a session is active.
                const badges = getBranchLifecycleBadges(chat, { currentChatJid }).filter((badge) => badge !== 'current' && badge !== 'active');
                const meta = [badges.join(' · '), formatSessionPickerModel(chat)].filter(Boolean).join(' · ');
                const activity = formatSessionActivityStatus(chat);
                const age = formatSessionActivityAge(chat.last_activity_at, now);
                const live = !current ? previews.get(jid) : null;
                const reply = live ? '' : cleanSessionPreviewText(chat.last_reply);
                const context = resolveSessionRowContext(chat, contexts.get(jid));
                return html`
                  <li key=${jid} class=${`sessions-sidebar-item${current ? ' current' : ''}${chat.is_active ? ' active' : ''}${menuFor === jid ? ' menu-open' : ''}`}
                    onContextMenu=${(event) => { event.preventDefault(); setMenuFor(jid); }}>
                    <button type="button" class="sessions-sidebar-open" title=${`${jid} — Ctrl/Cmd-click opens a new tab`} aria-current=${current ? 'page' : undefined}
                      onClick=${(event) => openSession(event, jid, current)}
                      onAuxClick=${(event) => { if (event.button === 1) openSession(event, jid, current); }}>
                      <span class="sessions-sidebar-line">
                        ${chat.is_active && html`<span class="sessions-sidebar-activity" aria-hidden="true"></span>`}
                        <span class="sessions-sidebar-handle">${handleLabel}</span>
                        ${isPinned && html`<span class="sessions-sidebar-pinned" title="Pinned" aria-label="Pinned">${SESSION_ICONS.pin}</span>`}
                        ${(activity || age) && html`<span class=${`sessions-sidebar-age${activity ? ' active' : ''}`}>${activity || age}</span>`}
                        ${context && html`<span class="sessions-sidebar-context-ring" role="meter" aria-label=${context.label} title=${context.label} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(context.percent)}
                          style=${`--session-context: ${context.percent.toFixed(1)}%`}></span>`}
                      </span>
                      ${live && html`<span class=${`sessions-sidebar-preview live ${live.kind}`}><span class="sessions-sidebar-preview-label">${live.label}</span> ${live.text}</span>`}
                      ${reply && html`<span class="sessions-sidebar-preview">${reply}</span>`}
                      ${meta && html`<span class="sessions-sidebar-meta">${meta}</span>`}
                    </button>
                    <button type="button" class="sessions-sidebar-more" aria-haspopup="menu" aria-expanded=${menuFor === jid ? 'true' : 'false'}
                      title=${`Actions for ${handleLabel}`} aria-label=${`Actions for ${handleLabel}`}
                      onClick=${() => setMenuFor(menuFor === jid ? null : jid)}>${SESSION_ICONS.more}</button>
                    ${menuFor === jid && html`
                      <div class="sessions-row-menu workspace-menu-dropdown" role="menu" aria-label=${`Actions for ${handleLabel}`}>
                        <button type="button" class="workspace-menu-item" role="menuitem" aria-pressed=${isPinned ? 'true' : 'false'}
                          onClick=${() => runMenu(() => setPinned(togglePinnedSessionChatJid(jid).pinnedChatJids))}>${isPinned ? 'Unpin' : 'Pin'}</button>
                        <button type="button" class="workspace-menu-item" role="menuitem" onClick=${() => runMenu(() => window.open(buildChatWindowUrl(window.location.href, jid), '_blank', 'noopener'))}>Open in new tab</button>
                        <button type="button" class="workspace-menu-item" role="menuitem" onClick=${() => runMenu(() => window.open(buildChatWindowUrl(window.location.href, jid, { chatOnly: true }), '_blank', 'noopener,popup'))}>Open in new window</button>
                        ${current && sessionActions?.rename && html`<button type="button" class="workspace-menu-item" role="menuitem" onClick=${() => runMenu(sessionActions.rename)}>Rename…</button>`}
                        ${current && sessionActions?.fork && html`<button type="button" class="workspace-menu-item" role="menuitem" onClick=${() => runMenu(sessionActions.fork)}>Fork</button>`}
                        ${sessionActions?.archive && html`<button type="button" class="workspace-menu-item danger" role="menuitem" onClick=${() => runMenu(() => sessionActions.archive(jid))}>Archive</button>`}
                      </div>
                    `}
                  </li>
                `;
              })}
            </ul>
          </section>
        `)}
        ${archived.length > 0 && html`
          <details class="sessions-sidebar-section sessions-sidebar-section-archived">
            <summary class="sessions-sidebar-section-heading">Archived (${archived.length})</summary>
            <ul class="sessions-sidebar-items">
              ${archived.map((chat) => {
                const jid = chat.chat_jid;
                const handle = normalizeHandle(chat.agent_name) || jid;
                const handleLabel = handle.startsWith('@') ? handle : `@${handle}`;
                return html`
                  <li key=${jid} class="sessions-sidebar-item archived">
                    <button type="button" class="sessions-sidebar-open" title=${jid} onClick=${(event) => openSession(event, jid, jid === currentChatJid)}>
                      <span class="sessions-sidebar-line"><span class="sessions-sidebar-handle">${handleLabel}</span></span>
                    </button>
                    ${(sessionActions?.restore || sessionActions?.purge) && html`<span class="sessions-sidebar-row-actions">
                      ${sessionActions?.restore && html`<button type="button" class="sessions-sidebar-tool" title=${`Restore ${handleLabel}`} aria-label=${`Restore ${handleLabel}`} onClick=${() => void sessionActions.restore(jid)}>${SESSION_ICONS.restore}</button>`}
                      ${sessionActions?.purge && html`<button type="button" class="sessions-sidebar-tool danger" title=${`Delete ${handleLabel} permanently`} aria-label=${`Delete ${handleLabel} permanently`} onClick=${() => void sessionActions.purge(jid)}>${SESSION_ICONS.trash}</button>`}
                    </span>`}
                  </li>
                `;
              })}
            </ul>
          </details>
        `}
      </nav>
      </section>
      <section id="workbench-view-explorer" class="workbench-view workbench-view-explorer" role="tabpanel" aria-label="Explorer" hidden=${view !== 'explorer'}>
        ${explorer}
      </section>
      ${shown && metersOn && html`<footer class="workbench-sidebar-footer"><${SystemMetersHud} mode="sidebar" /></footer>`}
      </div>
    </aside>
    ${!drawerMode && html`
      <div
        ref=${splitterRef}
        class=${`workbench-splitter${open ? '' : ' at-edge'}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize side bar"
        aria-valuemin="0"
        aria-valuemax=${SESSIONS_MAX_WIDTH}
        aria-valuenow=${open ? widthRef.current : 0}
        tabIndex="0"
        title="Drag to resize the side bar; Enter to show or hide"
        onPointerDown=${onPointerDown}
        onKeyDown=${onSplitterKeyDown}
        onDblClick=${onSplitterDoubleClick}
      ></div>
    `}
    ${drawerMode && drawerOpen && html`<div class="workbench-drawer-backdrop" aria-hidden="true" onClick=${() => setShown(false)}></div>`}
  `;
}
