/**
 * timeline-menu.ts — the single global menu, position:fixed.
 *
 * With the workbench activity bar shown, its button is the bar's top item and
 * the menu opens beside the bar. With the activity bar hidden (or on narrow
 * screens) it is the only chrome left, at the top-left of the chat.
 *
 * Sections: View (side bar views, Plan, system meters, the activity bar
 * itself), Open in tab, Open recent, Workspace, then Settings, scale,
 * language and About.
 */

import { html, useState, useEffect, useRef, useCallback, useLayoutEffect, render } from '../vendor/preact-htm.js';
import {
    MAX_PWA_DISPLAY_SCALE_PERCENT,
    MIN_PWA_DISPLAY_SCALE_PERCENT,
    PWA_DISPLAY_SCALE_EVENT,
    PWA_DISPLAY_SCALE_STEP_PERCENT,
    PWA_DISPLAY_SCALE_STORAGE_KEY,
    persistPwaDisplayScalePercent,
    readStoredPwaDisplayScalePercent,
} from '../ui/pwa-display-scale.js';
import { getRecentFiles, openRecentFile } from '../ui/recent-files.js';
import { LanguageSwitcher } from './language-switcher.js';
import { AboutDialog } from './about-dialog.js';
import { useTranslation } from '../utils/i18n.js';
import { WORKBENCH_TOGGLE_EVENT, dispatchWorkbenchCommand, readActivityBarHidden } from './workbench-sidebar.js';
import { METERS_COLLAPSED_EVENT_NAME, readStoredMetersCollapsed, toggleMetersCollapsed } from '../ui/meters.js';

/** Current side bar state, read from the shell when the menu opens. */
function readWorkbenchState() {
    if (typeof document === "undefined") return { open: false, view: "sessions", activityHidden: readActivityBarHidden() };
    const shell = document.querySelector(".app-shell");
    const aside = document.querySelector(".workbench-sidebar");
    return {
        open: shell?.getAttribute("data-workbench-sidebar") === "shown",
        view: aside?.getAttribute("data-view") || "sessions",
        activityHidden: readActivityBarHidden(),
    };
}

const CHECK_ICON = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>`;

function MenuCheckItem({ checked, label, hint = '', onSelect }) {
    return html`
        <button class="workspace-menu-item timeline-menu-check" role="menuitemcheckbox" aria-checked=${checked ? 'true' : 'false'} onClick=${onSelect}>
            <span class="timeline-menu-check-mark" aria-hidden="true">${checked ? CHECK_ICON : null}</span>
            <span class="timeline-menu-check-label">${label}</span>
            ${hint && html`<span class="timeline-menu-hint">${hint}</span>`}
        </button>
    `;
}

export function TimelineMenu({
    workspaceOpen,
    toggleWorkspace,
    openEditor,
    onOpenTerminalTab,
    onOpenVncTab, onOpenCdpTab,
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    const [pwaDisplayScalePercent, setPwaDisplayScalePercent] = useState(() => readStoredPwaDisplayScalePercent());
    const [pwaDisplayScaleDraft, setPwaDisplayScaleDraft] = useState(() => String(readStoredPwaDisplayScalePercent()));
    const [showHidden, setShowHidden] = useState(() => {
        try { return localStorage.getItem('workspaceShowHidden') === 'true'; } catch { return false; }
    });
    const [pos, setPos] = useState({ top: 8, left: 8 });
    const [workbench, setWorkbench] = useState(readWorkbenchState);
    const [metersOn, setMetersOn] = useState(() => !readStoredMetersCollapsed(false));

    useEffect(() => {
        const syncWorkbench = (event) => {
            const detail = event?.detail || {};
            setWorkbench((previous) => ({
                open: typeof detail.open === 'boolean' ? detail.open : previous.open,
                view: detail.view || previous.view,
                activityHidden: typeof detail.activityHidden === 'boolean' ? detail.activityHidden : previous.activityHidden,
            }));
        };
        const syncMeters = (event) => setMetersOn(!(typeof event?.detail?.collapsed === 'boolean' ? event.detail.collapsed : readStoredMetersCollapsed(false)));
        window.addEventListener(WORKBENCH_TOGGLE_EVENT, syncWorkbench);
        window.addEventListener(METERS_COLLAPSED_EVENT_NAME, syncMeters);
        return () => {
            window.removeEventListener(WORKBENCH_TOGGLE_EVENT, syncWorkbench);
            window.removeEventListener(METERS_COLLAPSED_EVENT_NAME, syncMeters);
        };
    }, []);

    const getSafeAreaTop = () => {
        if (typeof document === 'undefined') return 0;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
        document.body.appendChild(probe);
        const h = probe.offsetHeight;
        probe.remove();
        return h;
    };
    const menuRef = useRef(null);
    const btnRef = useRef(null);
    const portalRef = useRef(null);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const host = document.createElement('div');
        host.className = 'timeline-menu-portal in-chat';
        document.body.appendChild(host);
        portalRef.current = host;
        return () => { host.remove(); portalRef.current = null; };
    }, []);

    // The menu sits at the top of the workbench activity bar when it is laid
    // out (wide screens), otherwise at the top-left of the chat.
    const [inSessions, setInSessions] = useState(false);
    useEffect(() => {
        const update = () => {
            const safeTop = getSafeAreaTop();
            const topOffset = safeTop > 0 ? safeTop + 4 : 8;
            const sessions = document.querySelector('.workbench-sidebar');
            const r = sessions?.getBoundingClientRect?.();
            const visible = Boolean(r && r.width >= 40 && getComputedStyle(sessions).display !== 'none' && getComputedStyle(sessions).position !== 'fixed');
            setInSessions(visible);
            setPos(visible ? { top: r.top + safeTop, left: r.left } : { top: topOffset, left: 8 });
        };
        update();
        const observer = new ResizeObserver(update);
        const sessions = document.querySelector('.workbench-sidebar');
        if (sessions) observer.observe(sessions);
        window.addEventListener('resize', update);
        window.addEventListener('piclaw:sessions-sidebar-toggle', update);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', update);
            window.removeEventListener('piclaw:sessions-sidebar-toggle', update);
        };
    }, [workspaceOpen]);

    useEffect(() => {
        // Keep the existing state classes; in-sessions only records the anchor.
        if (portalRef.current)
            portalRef.current.className = `timeline-menu-portal ${workspaceOpen ? 'in-workspace' : 'in-chat'}${inSessions ? ' in-sessions in-activity-bar' : ''}`;
    }, [workspaceOpen, inSessions]);


    useEffect(() => {
        if (!portalRef.current) return;
        const s = portalRef.current.style;
        s.top = `${pos.top}px`;
        s.left = `${pos.left}px`;
        s.right = 'auto';
    }, [pos]);

    useEffect(() => {
        if (!open) return;
        const onClick = (e) => {
            if (menuRef.current?.contains(e.target)) return;
            if (btnRef.current?.contains(e.target)) return;
            setOpen(false);
        };
        document.addEventListener('mousedown', onClick, true);
        return () => document.removeEventListener('mousedown', onClick, true);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);

    useEffect(() => { setOpen(false); }, [workspaceOpen]);

    useEffect(() => {
        const syncPwaDisplayScale = () => {
            const next = readStoredPwaDisplayScalePercent();
            setPwaDisplayScalePercent(next);
            setPwaDisplayScaleDraft(String(next));
        };
        const onStorage = (event) => {
            if (!event || event.key === null || event.key === PWA_DISPLAY_SCALE_STORAGE_KEY) syncPwaDisplayScale();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('focus', syncPwaDisplayScale);
        window.addEventListener(PWA_DISPLAY_SCALE_EVENT, syncPwaDisplayScale);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('focus', syncPwaDisplayScale);
            window.removeEventListener(PWA_DISPLAY_SCALE_EVENT, syncPwaDisplayScale);
        };
    }, []);

    const handlePwaDisplayScaleInput = useCallback((event) => {
        setPwaDisplayScaleDraft(String(event?.currentTarget?.value ?? ''));
    }, []);

    const commitPwaDisplayScale = useCallback((value) => {
        const next = persistPwaDisplayScalePercent(value);
        setPwaDisplayScalePercent(next);
        setPwaDisplayScaleDraft(String(next));
    }, []);

    const handlePwaDisplayScaleCommit = useCallback((event) => {
        commitPwaDisplayScale(event?.currentTarget?.value);
    }, [commitPwaDisplayScale]);

    const handlePwaDisplayScaleKeyDown = useCallback((event) => {
        if (event?.key === 'Enter') {
            commitPwaDisplayScale(event?.currentTarget?.value);
            event?.currentTarget?.blur?.();
        }
    }, [commitPwaDisplayScale]);

    const run = useCallback((fn) => { setOpen(false); fn?.(); }, []);

    const content = html`
        <button ref=${btnRef} class=${`timeline-menu-btn${open ? ' active' : ''}`} data-testid="hamburger"
            onClick=${() => { setWorkbench(readWorkbenchState()); setMetersOn(!readStoredMetersCollapsed(false)); setOpen(v => !v); }} title=${t('menu.title')} aria-label=${t('menu.title')}
            aria-haspopup="menu" aria-expanded=${open ? 'true' : 'false'}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
        </button>
        ${open && html`
            <div class="workspace-menu-dropdown timeline-menu-dropdown" ref=${menuRef} role="menu">
                <div class="workspace-menu-submenu-label">View</div>
                <${MenuCheckItem} checked=${workbench.open && workbench.view === 'sessions'} label="Sessions" hint="Ctrl+Shift+B"
                    onSelect=${() => run(() => dispatchWorkbenchCommand('view', { view: 'sessions' }))} />
                <${MenuCheckItem} checked=${workbench.open && workbench.view === 'explorer'} label="Explorer" hint="Ctrl+Shift+E"
                    onSelect=${() => run(() => dispatchWorkbenchCommand('view', { view: 'explorer' }))} />
                <button class="workspace-menu-item timeline-menu-check" role="menuitem" onClick=${() => run(() => dispatchWorkbenchCommand('plan'))}>
                    <span class="timeline-menu-check-mark" aria-hidden="true"></span>
                    <span class="timeline-menu-check-label">Plan</span>
                </button>
                <${MenuCheckItem} checked=${metersOn} label="System meters" onSelect=${() => run(() => toggleMetersCollapsed())} />
                <${MenuCheckItem} checked=${!workbench.activityHidden} label="Activity bar" onSelect=${() => run(() => dispatchWorkbenchCommand('activity-bar'))} />

                ${(onOpenTerminalTab || onOpenVncTab || onOpenCdpTab) && html`
                    <div class="workspace-menu-separator"></div>
                    <div class="workspace-menu-submenu-label">Open in tab</div>
                `}
                ${onOpenTerminalTab && html`<button class="workspace-menu-item" role="menuitem" onClick=${() => run(onOpenTerminalTab)}>Terminal</button>`}
                ${onOpenCdpTab && html`<button class="workspace-menu-item" role="menuitem" onClick=${() => run(onOpenCdpTab)}>Browser</button>`}
                ${onOpenVncTab && html`<button class="workspace-menu-item" role="menuitem" onClick=${() => run(onOpenVncTab)}>VNC</button>`}
                ${(() => {
                    const recent = getRecentFiles();
                    if (recent.length === 0) return null;
                    return html`
                        <div class="workspace-menu-separator"></div>
                        <div class="workspace-menu-submenu-label">${t('menu.openRecent')}</div>
                        ${recent.map((path) => {
                            const label = path.split('/').pop() || path;
                            return html`
                                <button class="workspace-menu-item workspace-menu-recent-item" role="menuitem" title=${path} onClick=${() => run(() => openRecentFile(path, openEditor))}>${label}</button>
                            `;
                        })}
                    `;
                })()}
                <div class="workspace-menu-separator"></div>
                <div class="workspace-menu-submenu-label">Workspace</div>
                <button class="workspace-menu-item" role="menuitem" onClick=${() => run(() => window.dispatchEvent(new CustomEvent('piclaw:workspace-action', { detail: { action: 'refresh' } })))}>${t('menu.refreshTree')}</button>
                <button class="workspace-menu-item" role="menuitem" onClick=${() => run(() => window.dispatchEvent(new CustomEvent('piclaw:workspace-action', { detail: { action: 'reindex' } })))}>${t('menu.reindex')}</button>
                <${MenuCheckItem} checked=${showHidden} label="Show hidden files" onSelect=${() => run(() => {
                    const next = !showHidden;
                    setShowHidden(next);
                    try { localStorage.setItem('workspaceShowHidden', String(next)); } catch { setShowHidden(next); }
                    window.dispatchEvent(new CustomEvent('piclaw:toggle-hidden-files', { detail: { showHidden: next } }));
                })} />
                <div class="workspace-menu-separator"></div>
                <button class="workspace-menu-item" role="menuitem" onClick=${() => run(() => window.dispatchEvent(new CustomEvent('piclaw:open-settings')))}>${t('menu.settings')}…</button>
                <div class="workspace-menu-separator"></div>
                <div class="workspace-menu-scale-control" role="none">
                    <label for="timeline-pwa-display-scale">${t('menu.scale')}</label>
                    <div class="workspace-menu-scale-input-wrap">
                        <input
                            id="timeline-pwa-display-scale"
                            class="workspace-menu-scale-input"
                            type="number"
                            inputmode="numeric"
                            min=${MIN_PWA_DISPLAY_SCALE_PERCENT}
                            max=${MAX_PWA_DISPLAY_SCALE_PERCENT}
                            step=${PWA_DISPLAY_SCALE_STEP_PERCENT}
                            value=${pwaDisplayScaleDraft}
                            aria-label=${`PWA display scale percentage, currently ${pwaDisplayScalePercent}%`}
                            onClick=${(event) => event.stopPropagation()}
                            onInput=${handlePwaDisplayScaleInput}
                            onChange=${handlePwaDisplayScaleCommit}
                            onBlur=${handlePwaDisplayScaleCommit}
                            onKeyDown=${handlePwaDisplayScaleKeyDown}
                        />
                        <span aria-hidden="true">%</span>
                    </div>
                </div>
                <div class="workspace-menu-language" role="none">
                    <${LanguageSwitcher} variant="menu" />
                </div>
                <div class="workspace-menu-separator"></div>
                <button class="workspace-menu-item" role="menuitem" onClick=${() => run(() => { btnRef.current?.focus(); setAboutOpen(true); })}>About…</button>
            </div>
        `}
    `;

    useLayoutEffect(() => {
        if (portalRef.current) render(content, portalRef.current);
    });

    return aboutOpen ? html`<${AboutDialog} onClose=${() => setAboutOpen(false)} />` : null;
}
