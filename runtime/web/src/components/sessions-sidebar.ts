// @ts-nocheck
/**
 * sessions-sidebar.ts — Classic left sessions pane (#1987).
 *
 * Desktop-only list of the current, pinned and other sessions. It reuses the
 * compose session picker's grouping, search and pin preferences so both
 * surfaces stay in sync. Narrow layouts keep using the compose @session picker.
 */
import { html, useCallback, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { resolveSessionPopupChats } from './compose-box.js';
import { filterSessionPickerChats, formatSessionPickerMetrics, groupSessionPickerChats } from '../ui/compose-session-switcher.js';
import { getBranchLifecycleBadges, normalizeHandle } from '../ui/branch-lifecycle.js';
import {
  SESSION_PICKER_PREFERENCES_EVENT,
  readSessionPickerPreferences,
  togglePinnedSessionChatJid,
} from '../ui/session-picker-preferences.js';
import { getLocalStorageItem, setLocalStorageItem } from '../utils/storage.js';
import { getShellWidth } from '../ui/use-splitters.js';

export const SESSIONS_OPEN_STORAGE_KEY = 'sessionsOpen.desktop';
export const SESSIONS_WIDTH_STORAGE_KEY = 'sessionsWidth';
export const SESSIONS_DEFAULT_WIDTH = 260;
export const SESSIONS_MIN_WIDTH = 200;
export const SESSIONS_MAX_WIDTH = 420;
const KEYBOARD_STEP = 16;
const KEYBOARD_LARGE_STEP = 64;

export function readStoredSessionsOpen(): boolean {
  return getLocalStorageItem(SESSIONS_OPEN_STORAGE_KEY) !== 'false';
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
export function buildSessionsSidebarSections(activeChatAgents, currentChatJid, pinnedChatJids, query = '') {
  const chats = resolveSessionPopupChats(activeChatAgents, currentChatJid).filter((chat) => !chat?.archived_at);
  return groupSessionPickerChats(filterSessionPickerChats(chats, query), currentChatJid, pinnedChatJids)
    .filter((section) => section.key !== 'archived');
}

/**
 * Width available to the sessions pane beside the chat minimum and the
 * right-hand panes. Below SESSIONS_MIN_WIDTH the pane hides itself.
 */
export function availableSessionsWidth({ viewportWidth, rightPanesWidth, chatMinWidth = 320, splitterWidth = 4 }) {
  return Math.floor(viewportWidth - rightPanesWidth - splitterWidth - chatMinWidth);
}

export function SessionsSidebar({ activeChatAgents, currentChatJid, onSwitchChat, appShellRef, chatMinWidth = 320 }) {
  const [storedOpen, setOpen] = useState(readStoredSessionsOpen);
  // When the window cannot fit sessions, chat and the right-hand panes, hide
  // sessions first without changing the saved preference. Showing them again
  // explicitly overrides this until the layout changes.
  const [autoHidden, setAutoHidden] = useState(false);
  const [override, setOverride] = useState(false);
  const open = storedOpen && (!autoHidden || override);
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState(() => readSessionPickerPreferences().pinnedChatJids);
  // widthRef is the saved preference; the rendered width may be narrower when space is short.
  const widthRef = useRef(readStoredSessionsWidth());
  const availableRef = useRef(Infinity);
  const splitterRef = useRef(null);

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
    appShellRef?.current?.style?.setProperty('--sessions-width', `${rendered}px`);
    const splitter = splitterRef.current;
    if (splitter) splitter.setAttribute('aria-valuenow', String(open ? rendered : 0));
  }, [appShellRef, open]);

  useEffect(() => { applyWidth(widthRef.current); }, [applyWidth]);

  const setOpenPersisted = useCallback((next) => {
    setOpen(next);
    setOverride(Boolean(next) && autoHidden);
    setLocalStorageItem(SESSIONS_OPEN_STORAGE_KEY, String(next));
    window.dispatchEvent(new CustomEvent('piclaw:sessions-sidebar-toggle', { detail: { open: next } }));
  }, [autoHidden]);

  const rightPanesWidth = useCallback(() => {
    const shell = appShellRef?.current;
    if (!shell) return 0;
    return Array.from(shell.children)
      .filter((child) => child.matches?.('.editor-pane-container, .editor-splitter, .workspace-sidebar, .workspace-splitter'))
      .reduce((sum, child) => sum + (getComputedStyle(child).position === 'static' ? child.getBoundingClientRect().width : 0), 0);
  }, [appShellRef]);

  const maxWidth = useCallback(() => {
    const viewport = appShellRef?.current ? getShellWidth(appShellRef.current) : 0;
    if (!viewport) return SESSIONS_MAX_WIDTH;
    return viewport - rightPanesWidth() - chatMinWidth - 8;
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
    // Right-hand panes keep room for the sessions pane at its minimum while it is shown.
    appShellRef?.current?.style?.setProperty('--sessions-reserved', open ? `${SESSIONS_MIN_WIDTH + 4}px` : '0px');
    window.dispatchEvent(new CustomEvent('piclaw:sessions-sidebar-toggle', { detail: { open } }));
  }, [appShellRef, open]);

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
    shell?.classList.add('sessions-resizing');
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
      shell?.classList.remove('sessions-resizing');
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

  const sections = useMemo(
    () => buildSessionsSidebarSections(activeChatAgents, currentChatJid, pinned, query),
    [activeChatAgents, currentChatJid, pinned, query],
  );
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);

  return html`
    <aside class=${`sessions-sidebar${open ? '' : ' collapsed'}`} aria-label="Sessions" aria-hidden=${open ? undefined : 'true'} inert=${open ? undefined : true}>
      <div class="sessions-sidebar-header">
        <span class="sessions-sidebar-title">Sessions</span>
        <button type="button" class="sessions-sidebar-collapse" onClick=${() => setOpenPersisted(false)} title="Hide sessions" aria-label="Hide sessions">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="10 3 5 8 10 13" /></svg>
        </button>
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
                const badges = getBranchLifecycleBadges(chat, { currentChatJid }).filter((badge) => badge !== 'current');
                const meta = [badges.join(' · '), formatSessionPickerMetrics(chat)].filter(Boolean).join(' · ');
                return html`
                  <li key=${jid} class=${`sessions-sidebar-item${current ? ' current' : ''}${chat.is_active ? ' active' : ''}`}>
                    <button type="button" class="sessions-sidebar-open" title=${jid} aria-current=${current ? 'page' : undefined}
                      onClick=${() => { if (!current) onSwitchChat?.(jid); }}>
                      <span class="sessions-sidebar-handle">${handleLabel}</span>
                      ${meta && html`<span class="sessions-sidebar-meta">${meta}</span>`}
                    </button>
                    <button type="button" class=${`sessions-sidebar-pin${isPinned ? ' pinned' : ''}`} aria-pressed=${isPinned ? 'true' : 'false'}
                      title=${isPinned ? `Unpin ${handleLabel}` : `Pin ${handleLabel}`} aria-label=${isPinned ? `Unpin ${handleLabel}` : `Pin ${handleLabel}`}
                      onClick=${() => setPinned(togglePinnedSessionChatJid(jid).pinnedChatJids)}>
                      <svg viewBox="0 0 24 24" fill=${isPinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3h6l-1 6 4 4H6l4-4z" /><path d="M12 13v8" /></svg>
                    </button>
                  </li>
                `;
              })}
            </ul>
          </section>
        `)}
      </nav>
    </aside>
    <div
      ref=${splitterRef}
      class=${`sessions-splitter${open ? '' : ' at-edge'}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sessions"
      aria-valuemin="0"
      aria-valuemax=${SESSIONS_MAX_WIDTH}
      aria-valuenow=${open ? widthRef.current : 0}
      tabIndex="0"
      title="Drag to resize sessions; Enter to show or hide"
      onPointerDown=${onPointerDown}
      onKeyDown=${onSplitterKeyDown}
      onDblClick=${onSplitterDoubleClick}
    ></div>
    ${!open && html`
      <button type="button" class="sessions-toggle-tab" onClick=${() => setOpenPersisted(true)} title="Show sessions" aria-label="Show sessions" aria-expanded="false">
        <svg class="sessions-toggle-tab-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 3 11 8 6 13" /></svg>
      </button>
    `}
  `;
}
