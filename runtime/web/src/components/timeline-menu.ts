/**
 * timeline-menu.ts — Single hamburger menu, position:fixed.
 * Tracks .container/.workspace-sidebar for positioning.
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

export function TimelineMenu({
    workspaceOpen,
    toggleWorkspace,
    chatOnlyMode,
    openEditor,
    onOpenTerminalTab,
    onOpenVncTab,
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

    useEffect(() => {
        const update = () => {
            const safeTop = getSafeAreaTop();
            const topOffset = safeTop > 0 ? safeTop + 4 : 8;
            if (workspaceOpen) {
                const sidebar = document.querySelector('.workspace-sidebar');
                if (sidebar) {
                    const r = sidebar.getBoundingClientRect();
                    setPos({ top: r.top + topOffset, left: r.left + 8 });
                }
            } else {
                setPos({ top: topOffset, left: 8 });
            }
        };
        update();
        const observer = new ResizeObserver(update);
        const sidebar = document.querySelector('.workspace-sidebar');
        if (sidebar) observer.observe(sidebar);
        window.addEventListener('resize', update);
        return () => { observer.disconnect(); window.removeEventListener('resize', update); };
    }, [workspaceOpen]);

    useEffect(() => {
        if (portalRef.current)
            portalRef.current.className = `timeline-menu-portal ${workspaceOpen ? 'in-workspace' : 'in-chat'}`;
    }, [workspaceOpen]);

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

    const toggleChatOnly = useCallback(() => {
        const url = new URL(window.location.href);
        if (chatOnlyMode) {
            url.searchParams.delete('chat_only');
        } else {
            url.searchParams.set('chat_only', '1');
        }
        window.location.href = url.toString();
    }, [chatOnlyMode]);

    const content = html`
        <button ref=${btnRef} class=${`timeline-menu-btn${open ? ' active' : ''}`} data-testid="hamburger"
            onClick=${() => setOpen(v => !v)} title=${t('menu.title')} aria-label=${t('menu.title')}
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
                <button class="workspace-menu-item" role="menuitem" onClick=${() => run(toggleWorkspace)}>
                    ${workspaceOpen ? t('menu.hideWorkspace') : t('menu.showWorkspace')}
                </button>
                ${!workspaceOpen && !chatOnlyMode && html`
                    <button class="workspace-menu-item" role="menuitem" onClick=${() => run(() => { toggleWorkspace(); })}>
                        ${t('menu.openExplorer')}
                    </button>
                `}
                <button class=${`workspace-menu-item${chatOnlyMode ? ' active' : ''}`} role="menuitem" onClick=${() => run(toggleChatOnly)}>
                    ${chatOnlyMode ? t('menu.exitChatOnly') : t('menu.chatOnly')}
                </button>

                ${(onOpenTerminalTab || onOpenVncTab) && html`<div class="workspace-menu-separator"></div>`}
                ${onOpenTerminalTab && html`<button class="workspace-menu-item" role="menuitem" onClick=${() => run(onOpenTerminalTab)}>${t('menu.openTerminal')}</button>`}
                ${onOpenVncTab && html`<button class="workspace-menu-item" role="menuitem" onClick=${() => run(onOpenVncTab)}>${t('menu.openVnc')}</button>`}

                <div class="workspace-menu-separator"></div>
                <button class="workspace-menu-item" role="menuitem" disabled=${!workspaceOpen} onClick=${() => run(() => window.dispatchEvent(new CustomEvent('piclaw:workspace-action', { detail: { action: 'new-file' } })))}>${t('menu.newFile')}</button>
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
                <button class="workspace-menu-item" role="menuitem" disabled=${!workspaceOpen} onClick=${() => run(() => window.dispatchEvent(new CustomEvent('piclaw:workspace-action', { detail: { action: 'refresh' } })))}>${t('menu.refreshTree')}</button>
                <button class="workspace-menu-item" role="menuitem" disabled=${!workspaceOpen} onClick=${() => run(() => window.dispatchEvent(new CustomEvent('piclaw:workspace-action', { detail: { action: 'reindex' } })))}>${t('menu.reindex')}</button>
                <button class=${`workspace-menu-item${showHidden ? ' active' : ''}`} role="menuitem" disabled=${!workspaceOpen} onClick=${() => run(() => {
                    const next = !showHidden;
                    setShowHidden(next);
                    try { localStorage.setItem('workspaceShowHidden', String(next)); } catch { setShowHidden(next); }
                    window.dispatchEvent(new CustomEvent('piclaw:toggle-hidden-files', { detail: { showHidden: next } }));
                })}>
                    ${showHidden ? t('menu.hideHidden') : t('menu.showHidden')}
                </button>
                <button class="workspace-menu-item" role="menuitem" onClick=${() => run(() => window.dispatchEvent(new CustomEvent('piclaw:open-settings')))}>${t('menu.settings')}</button>
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
