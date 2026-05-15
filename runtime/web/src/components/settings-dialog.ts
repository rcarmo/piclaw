/**
 * settings-dialog.ts — Floating settings dialog shell.
 * Self-manages open/close via 'piclaw:open-settings' custom event.
 * Section components live in ./settings/*.ts submodules.
 * Extension panes register via ./settings/pane-registry.ts.
 */

// ── Performance logging ─────────────────────────────────────────────────────
const _perfLog = [];
function perf(label) { _perfLog.push({ ts: performance.now(), label }); }
function flushPerfLog() {
    if (!_perfLog.length) return;
    const first = _perfLog[0].ts;
    const lines = _perfLog.map(e => `+${(e.ts - first).toFixed(1)}ms ${e.label}`);
    console.info('[settings-dialog perf]\n' + lines.join('\n'));
    try { window.__piclawSettingsPerfLog = lines; } catch (e) { void e; }
    // Post to server for diagnostic access
    try {
        fetch('/agent/client-perf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: 'settings-dialog', lines }),
        }).catch((e) => { void e; });
    } catch (e) { void e; }
    _perfLog.length = 0;
}

// Module-level settings data cache — survives dialog close/reopen.
let _settingsDataCache: Record<string, unknown> | null = null;

perf('module-eval-start');
import { html, useState, useEffect, useCallback, useRef } from '../vendor/preact-htm.js';
import { BodyPortal } from './body-portal.js';
import { compareSettingsPanesAlphabetically, getRegisteredSettingsPanes } from './settings/pane-registry.js';
import { consumeRequestedSettingsOpenState, normalizeSettingsSectionId, peekRequestedSettingsSection, requestOpenSettingsDialog } from './settings-dialog-events.js';
// General is statically imported — it's always the first visible section.
import { GeneralSection } from './settings/general.js';
perf('imports-done');

type SettingsSectionComponent = unknown;
type BuiltinSectionId = 'general' | 'sessions' | 'recordings' | 'compaction' | 'keyboard' | 'workspace' | 'shell' | 'environment' | 'providers' | 'models' | 'theme' | 'scheduled-tasks' | 'quick-actions' | 'keychain' | 'tools' | 'addons';

const builtinSectionComponentCache = new Map<BuiltinSectionId, SettingsSectionComponent>();
const builtinSectionLoadPromiseCache = new Map<BuiltinSectionId, Promise<SettingsSectionComponent>>();

// General is pre-cached; everything else loads on demand when the user clicks the nav.
builtinSectionComponentCache.set('general', GeneralSection);

const BUILTIN_SECTION_LOADERS: Record<BuiltinSectionId, () => Promise<SettingsSectionComponent>> = {
    general: () => Promise.resolve(GeneralSection),
    sessions: () => import('./settings/sessions.js').then(mod => mod.SessionsSection),
    recordings: () => import('./settings/recordings.js').then(mod => mod.RecordingsSection),
    compaction: () => import('./settings/compaction.js').then(mod => mod.CompactionSection),
    keyboard: () => import('./settings/keyboard.js').then(mod => mod.KeyboardSection),
    workspace: () => import('./settings/workspace.js').then(mod => mod.WorkspaceSection),
    shell: () => import('./settings/shell.js').then(mod => mod.ShellSection),
    environment: () => import('./settings/environment.js').then(mod => mod.EnvironmentSection),
    providers: () => import('./settings/providers.js').then(mod => mod.ProvidersSection),
    models: () => import('./settings/models.js').then(mod => mod.ModelsSection),
    theme: () => import('./settings/appearance.js').then(mod => mod.ThemeSection),
    'scheduled-tasks': () => import('./settings/scheduled-tasks.js').then(mod => mod.ScheduledTasksSection),
    'quick-actions': () => import('./settings/quick-actions.js').then(mod => mod.QuickActionsSection),
    keychain: () => import('./settings/keychain.js').then(mod => mod.KeychainSection),
    tools: () => import('./settings/tools.js').then(mod => mod.ToolsSection),
    addons: () => import('./settings/addons.js').then(mod => mod.AddonsSection),
};

// Extension panes are loaded lazily only when the user opens those sections.
// Extension pane loaders — each loads ONE module on demand, not all at once.
const EXTENSION_SETTINGS_PANE_LOADERS_MAP: Record<string, () => Promise<void>> = {
    'editor-settings': () => import('./settings/editor-settings.js').then(() => {}),
    'developer': () => import('./settings/developer-settings.js').then(() => {}),
};
const loadedExtensionPanes = new Set<string>();

function loadBuiltinSection(id) {
    const cached = builtinSectionComponentCache.get(id);
    if (cached) return Promise.resolve(cached);

    const inflight = builtinSectionLoadPromiseCache.get(id);
    if (inflight) return inflight;

    const promise = BUILTIN_SECTION_LOADERS[id]()
        .then((component) => {
            builtinSectionComponentCache.set(id, component);
            builtinSectionLoadPromiseCache.delete(id);
            return component;
        })
        .catch((error) => {
            builtinSectionLoadPromiseCache.delete(id);
            throw error;
        });

    builtinSectionLoadPromiseCache.set(id, promise);
    return promise;
}

// Extension panes are loaded individually on demand — see the nav click handler.

function renderSectionLoading(label = 'Loading…') {
    return html`
        <div class="settings-loading settings-loading-pane" role="status" aria-live="polite">
            <span class="settings-spinner"></span>
            <span>${label}</span>
        </div>
    `;
}

// ── SVG nav icons ───────────────────────────────────────────────────────────
// All icons: 24×24 viewBox, 16×16 rendered, stroke-based, stroke-width 2, round caps/joins.
const iconGeneral = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M8.5 5.9L9.6 2.3h4.8l1.1 3.6 3.7-.8 2.4 4.1-2.6 2.8 2.6 2.8-2.4 4.1-3.7-.8-1.1 3.6H9.6l-1.1-3.6-3.7.8-2.4-4.1L5 12 2.4 9.2l2.4-4.1z"/></svg>`;
const iconSessions = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`;
const iconRecordings = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="12" r="2.2"/><path d="m13 10 4-2.5v9L13 14z"/></svg>`;
const iconCompaction = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/><path d="M12 7v5l3 3"/></svg>`;
const iconWorkspace = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const iconShell = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10"/><path d="M7 13h6"/><path d="M7 17h3"/></svg>`;
const iconEnvironment = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/><path d="M8 7v10"/><path d="M16 7v10"/></svg>`;
const iconKeyboard = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01"/><path d="M10 9h.01"/><path d="M14 9h.01"/><path d="M18 9h.01"/><path d="M8 13h.01"/><path d="M12 13h.01"/><path d="M16 13h.01"/><path d="M7 17h10"/></svg>`;
const iconProviders = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;
const iconModels = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="9" width="14" height="10" rx="2"/><circle cx="9" cy="14" r="1.5" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1.5" fill="currentColor" stroke="none"/><line x1="12" y1="9" x2="12" y2="5"/><circle cx="12" cy="4" r="1.5"/></svg>`;
const iconAppearance = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.53-.21-1.01-.55-1.36-.34-.36-.55-.84-.55-1.37 0-1.1.9-2 2-2h2.36c3.08 0 5.64-2.56 5.64-5.64C22.9 5.85 18.05 2 12 2z"/><circle cx="8" cy="10" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>`;
const iconScheduledTasks = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/><path d="M7 3.5 4 6"/><path d="m17 3.5 3 2.5"/></svg>`;
const iconTools = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const iconQuickActions = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;
const iconKeychain = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14" r="3"/><path d="M11 14h9"/><path d="M16 14v-2"/><path d="M19 14v2"/></svg>`;
const iconAddons = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

// Built-in sections (order 0-100)
const BUILTIN_SECTIONS = [
    { id: 'general', label: 'General', icon: iconGeneral, searchable: false, order: 10 },
    { id: 'sessions', label: 'Sessions', icon: iconSessions, searchable: false, order: 12 },
    { id: 'recordings', label: 'Recordings', icon: iconRecordings, searchable: true, placeholder: 'Filter recordings…', order: 12.5 },
    { id: 'compaction', label: 'Compaction', icon: iconCompaction, searchable: false, order: 13 },
    { id: 'keyboard', label: 'Keyboard', icon: iconKeyboard, searchable: true, placeholder: 'Filter shortcuts…', order: 14 },
    { id: 'workspace', label: 'Workspace', icon: iconWorkspace, searchable: false, order: 15 },
    { id: 'shell', label: 'Shell', icon: iconShell, searchable: true, placeholder: 'Filter shell surfaces…', order: 15.5 },
    { id: 'environment', label: 'Environment', icon: iconEnvironment, searchable: true, placeholder: 'Filter environment…', order: 16 },
    { id: 'providers', label: 'Providers', icon: iconProviders, searchable: false, order: 20 },
    { id: 'models', label: 'Models', icon: iconModels, searchable: true, placeholder: 'Filter models…', order: 30 },
    { id: 'theme', label: 'Appearance', icon: iconAppearance, searchable: false, order: 40 },
    { id: 'scheduled-tasks', label: 'Scheduled Tasks', icon: iconScheduledTasks, searchable: true, placeholder: 'Filter scheduled tasks…', order: 65 },
    { id: 'quick-actions', label: 'Quick Actions', icon: iconQuickActions, searchable: true, placeholder: 'Filter quick actions…', order: 70 },
    { id: 'keychain', label: 'Keychain', icon: iconKeychain, searchable: true, placeholder: 'Filter entries…', order: 75 },
    { id: 'tools', label: 'Tools', icon: iconTools, searchable: true, placeholder: 'Filter tools…', order: 80 },
    { id: 'addons', label: 'Add-ons', icon: iconAddons, searchable: true, placeholder: 'Filter add-ons…', order: 90 },
];

export function SettingsDialogContent({ onClose }) {
    perf('SettingsDialogContent-render-start');
    const [activeSection, setActiveSection] = useState(() => peekRequestedSettingsSection() || 'general');
    const [settingsData, setSettingsData] = useState(_settingsDataCache);
    const [statusMessage, setStatusMessage] = useState(null);
    const [filter, setFilter] = useState('');
    const [, forceUpdate] = useState(0);
    const [builtinSectionComponents, setBuiltinSectionComponents] = useState(() => Object.fromEntries(builtinSectionComponentCache.entries()));
    const [loadingSectionId, setLoadingSectionId] = useState(null);

    const [layoutMode, setLayoutMode] = useState({ compact: false, narrow: false });
    const filterRef = useRef(null);
    const dialogRef = useRef(null);

    useEffect(() => {
        perf('SettingsDialogContent-mounted');
        flushPerfLog();
    }, []);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    useEffect(() => {
        const onOpenSettings = (event) => {
            const requestedSection = typeof event?.detail?.section === 'string' ? event.detail.section.trim() : '';
            if (requestedSection) {
                setActiveSection(requestedSection);
                setFilter('');
            }
        };
        window.addEventListener('piclaw:open-settings', onOpenSettings);
        return () => window.removeEventListener('piclaw:open-settings', onOpenSettings);
    }, []);

    // Re-render when extension panes register
    useEffect(() => {
        const handler = () => forceUpdate(n => n + 1);
        window.addEventListener('piclaw:settings-panes-changed', handler);
        return () => window.removeEventListener('piclaw:settings-panes-changed', handler);
    }, []);

    useEffect(() => {
        fetch('/agent/settings-data').then(r => r.json()).then(data => {
            _settingsDataCache = data;
            setSettingsData(data);
        }).catch(() => setSettingsData({}));
    }, []);

    useEffect(() => {
        const element = dialogRef.current;
        if (!element) return;

        const updateLayoutMode = () => {
            const width = element.clientWidth || 0;
            setLayoutMode((prev) => {
                const next = {
                    compact: width > 0 && width <= 860,
                    narrow: width > 0 && width <= 720,
                };
                return prev.compact === next.compact && prev.narrow === next.narrow ? prev : next;
            });
        };

        updateLayoutMode();
        if (typeof ResizeObserver === 'function') {
            const observer = new ResizeObserver(() => updateLayoutMode());
            observer.observe(element);
            return () => observer.disconnect();
        }

        window.addEventListener('resize', updateLayoutMode);
        return () => window.removeEventListener('resize', updateLayoutMode);
    }, []);

    const builtinSections = [...BUILTIN_SECTIONS].sort((a, b) => (a.order ?? 500) - (b.order ?? 500));
    const extensionPanes = getRegisteredSettingsPanes();
    const extensionSections = extensionPanes
        .map(p => ({
            id: p.id,
            label: p.label,
            icon: p.icon,
            searchable: p.searchable || false,
            placeholder: p.searchPlaceholder,
            order: p.order ?? 500,
            isExtension: true,
            component: p.component,
        }))
        .sort(compareSettingsPanesAlphabetically);
    const allSections = [...builtinSections, ...extensionSections];

    const activeMeta = allSections.find(s => s.id === activeSection) || BUILTIN_SECTIONS.find(s => s.id === activeSection);

    useEffect(() => {
        if (activeMeta?.searchable) {
            requestAnimationFrame(() => filterRef.current?.focus());
        }
    }, [activeSection]);

    useEffect(() => {
        if (activeMeta?.isExtension) {
            setLoadingSectionId(null);
            return;
        }
        let cancelled = false;
        if (builtinSectionComponents[activeSection]) {
            setLoadingSectionId(null);
            return;
        }
        setLoadingSectionId(activeSection);
        loadBuiltinSection(activeSection)
            .then((component) => {
                if (cancelled) return;
                setBuiltinSectionComponents(prev => prev?.[activeSection] ? prev : { ...(prev || {}), [activeSection]: component });
            })
            .catch((error) => {
                if (cancelled) return;
                console.error(`[settings-dialog] Failed to lazy-load section "${activeSection}".`, error);
            })
            .finally(() => {
                if (!cancelled) setLoadingSectionId(current => current === activeSection ? null : current);
            });
        return () => { cancelled = true; };
    }, [activeSection, activeMeta?.isExtension, builtinSectionComponents]);

    const setStatus = useCallback((text, type = 'info') => {
        setStatusMessage(text ? { text, type } : null);
    }, []);

    const switchSection = useCallback((id) => {
        setActiveSection(id);
        setFilter('');
        // Lazy-load extension pane module if not yet loaded
        const extLoader = EXTENSION_SETTINGS_PANE_LOADERS_MAP[id];
        if (extLoader && !loadedExtensionPanes.has(id)) {
            loadedExtensionPanes.add(id);
            extLoader().then(() => forceUpdate(n => n + 1)).catch((e) => { void e; });
        }
    }, []);

    const mergeSettingsData = useCallback((patch) => {
        setSettingsData(prev => ({ ...(prev || {}), ...(patch || {}) }));
    }, []);

    const renderSection = () => {
        if (activeMeta?.isExtension) {
            if (!activeMeta.component) return renderSectionLoading('Loading pane…');
            const Comp = activeMeta.component;
            return html`<${Comp} filter=${filter} />`;
        }

        const Comp = builtinSectionComponents[activeSection];
        if (!Comp || loadingSectionId === activeSection) {
            return renderSectionLoading(`Loading ${activeMeta?.label || 'settings'}…`);
        }

        switch (activeSection) {
            case 'general': return html`<${Comp} settingsData=${settingsData} setStatus=${setStatus} mergeSettingsData=${mergeSettingsData} />`;
            case 'sessions': return html`<${Comp} settingsData=${settingsData} setStatus=${setStatus} mergeSettingsData=${mergeSettingsData} />`;
            case 'recordings': return html`<${Comp} filter=${filter} setStatus=${setStatus} />`;
            case 'compaction': return html`<${Comp} settingsData=${settingsData} setStatus=${setStatus} mergeSettingsData=${mergeSettingsData} />`;
            case 'keyboard': return html`<${Comp} filter=${filter} setStatus=${setStatus} />`;
            case 'workspace': return html`<${Comp} settingsData=${settingsData} setStatus=${setStatus} mergeSettingsData=${mergeSettingsData} />`;
            case 'shell': return html`<${Comp} filter=${filter} setStatus=${setStatus} />`;
            case 'environment': return html`<${Comp} settingsData=${settingsData} filter=${filter} setStatus=${setStatus} mergeSettingsData=${mergeSettingsData} />`;
            case 'providers': return html`<${Comp} providers=${settingsData?.providers} setStatus=${setStatus} />`;
            case 'models': return html`<${Comp} filter=${filter} />`;
            case 'theme': return html`<${Comp} themes=${settingsData?.themes} colorKeys=${settingsData?.colorKeys} settingsData=${settingsData} setStatus=${setStatus} mergeSettingsData=${mergeSettingsData} />`;
            case 'scheduled-tasks': return html`<${Comp} filter=${filter} setStatus=${setStatus} />`;
            case 'quick-actions': return html`<${Comp} filter=${filter} setStatus=${setStatus} mergeSettingsData=${mergeSettingsData} />`;
            case 'keychain': return html`<${Comp} filter=${filter} />`;
            case 'tools': return html`<${Comp} toolsets=${settingsData?.toolsets} filter=${filter} settingsData=${settingsData} mergeSettingsData=${mergeSettingsData} />`;
            case 'addons': return html`<${Comp} setStatus=${setStatus} filter=${filter} />`;
            default: return renderSectionLoading('Loading settings…');
        }
    };

    const showRootLoading = !activeMeta;
    perf('SettingsDialogContent-render-end');

    return html`
        <div class="settings-dialog-backdrop" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div ref=${dialogRef} data-testid="settings-dialog" class=${`settings-dialog${layoutMode.compact ? ' settings-dialog-compact' : ''}${layoutMode.narrow ? ' settings-dialog-narrow' : ''}`}>
                <div class="settings-dialog-header">
                    <span class="settings-dialog-title">Settings</span>
                    ${activeMeta?.searchable && html`
                        <input ref=${filterRef} type="text" class="settings-header-filter"
                            placeholder=${activeMeta.placeholder || 'Filter…'}
                            value=${filter} onInput=${e => setFilter(e.target.value)} />
                    `}
                    <button class="settings-dialog-close" onClick=${onClose} title="Close (Esc)">✕</button>
                </div>
                <div class="settings-dialog-body">
                    <nav class="settings-nav">
                        ${allSections.map((s, i) => {
                            const prevIsBuiltin = i > 0 && !allSections[i - 1].isExtension;
                            const showSep = s.isExtension && prevIsBuiltin;
                            return html`
                                ${showSep && html`<div class="settings-nav-separator"></div>`}
                                <button class=${`settings-nav-item ${s.id === activeSection ? 'active' : ''}`} onClick=${() => switchSection(s.id)}>
                                    <span class="settings-nav-icon">${s.icon}</span>
                                    <span class="settings-nav-label">${s.label}</span>
                                </button>
                            `;
                        })}
                    </nav>
                    <main class="settings-content">
                        ${showRootLoading ? renderSectionLoading('Loading settings…') : renderSection()}
                    </main>
                </div>
                ${statusMessage && html`
                    <div class=${`settings-status-bar settings-status-bar-${statusMessage.type}`}>
                        ${statusMessage.type === 'info' && html`<span class="settings-spinner"></span>`}
                        <span>${statusMessage.text}</span>
                        ${statusMessage.type !== 'info' && html`<button class="settings-status-dismiss" onClick=${() => setStatusMessage(null)}>✕</button>`}
                    </div>
                `}
            </div>
        </div>
    `;
}

export function SettingsDialog() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const handler = (event) => {
            const section = normalizeSettingsSectionId(event?.detail?.section);
            if (section) {
                try { window.__piclawSettingsRequestedSection = section; } catch (e) { void e; }
            }
            setOpen(true);
        };
        window.addEventListener('piclaw:open-settings', handler);
        const pending = consumeRequestedSettingsOpenState();
        if (pending.open) {
            if (pending.section) {
                try { window.__piclawSettingsRequestedSection = pending.section; } catch (e) { void e; }
            }
            setOpen(true);
        }
        return () => window.removeEventListener('piclaw:open-settings', handler);
    }, []);
    if (!open) return null;
    return html`<${BodyPortal} className="settings-portal"><${SettingsDialogContent} onClose=${() => setOpen(false)} /><//>`;
}

export function openSettingsDialog(options = {}) {
    requestOpenSettingsDialog(options);
}
