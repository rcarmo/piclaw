// @ts-nocheck
/**
 * settings-dialog.ts — Floating settings dialog shell.
 * Self-manages open/close via 'piclaw:open-settings' custom event.
 * Section components live in ./settings/*.ts submodules.
 * Extension panes register via ./settings/pane-registry.ts.
 */
import { html, useState, useEffect, useCallback, useRef } from '../vendor/preact-htm.js';
import { BodyPortal } from './body-portal.js';
import { GeneralSection } from './settings/general.js';
import { ProvidersSection } from './settings/providers.js';
import { ModelsSection } from './settings/models.js';
import { ThemeSection } from './settings/appearance.js';
import { ToolsSection } from './settings/tools.js';
import { QuickActionsSection } from './settings/quick-actions.js';
import { AddonsSection } from './settings/addons.js';
import { getRegisteredSettingsPanes } from './settings/pane-registry.js';

// Import extension panes (self-register on import)
import './settings/editor-settings.js';
import './settings/kanban-settings.js';
import './settings/mindmap-settings.js';
import './settings/developer-settings.js';

// ── SVG nav icons ───────────────────────────────────────────────────────────
const iconGeneral = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const iconProviders = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`;
const iconModels = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><path d="M9 15c.83.67 2 1 3 1s2.17-.33 3-1"/></svg>`;
const iconAppearance = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 0 1 0 20c-2.76 0-5-4.48-5-10S9.24 2 12 2z"/><circle cx="16.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="7.5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="16.5" cy="15.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="10" cy="7" r="1.5" fill="currentColor" stroke="none"/></svg>`;
const iconTools = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;
const iconQuickActions = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h14v14H5z"/><path d="M9 9h6"/><path d="M9 12h6"/><path d="M9 15h4"/></svg>`;
const iconAddons = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;

// Built-in sections (order 0-100)
const BUILTIN_SECTIONS = [
    { id: 'general', label: 'General', icon: iconGeneral, searchable: false, order: 10 },
    { id: 'providers', label: 'Providers', icon: iconProviders, searchable: false, order: 20 },
    { id: 'models', label: 'Models', icon: iconModels, searchable: true, placeholder: 'Filter models\u2026', order: 30 },
    { id: 'theme', label: 'Appearance', icon: iconAppearance, searchable: false, order: 40 },
    { id: 'quick-actions', label: 'Quick Actions', icon: iconQuickActions, searchable: true, placeholder: 'Filter quick actions\u2026', order: 70 },
    { id: 'tools', label: 'Tools', icon: iconTools, searchable: true, placeholder: 'Filter tools\u2026', order: 80 },
    { id: 'addons', label: 'Add-ons', icon: iconAddons, searchable: true, placeholder: 'Filter add-ons\u2026', order: 90 },
];

function SettingsDialogContent({ onClose }) {
    const [activeSection, setActiveSection] = useState('general');
    const [settingsData, setSettingsData] = useState(null);
    const [statusMessage, setStatusMessage] = useState(null);
    const [filter, setFilter] = useState('');
    const [, forceUpdate] = useState(0);
    const filterRef = useRef(null);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    // Re-render when extension panes register
    useEffect(() => {
        const handler = () => forceUpdate(n => n + 1);
        window.addEventListener('piclaw:settings-panes-changed', handler);
        return () => window.removeEventListener('piclaw:settings-panes-changed', handler);
    }, []);

    useEffect(() => {
        fetch('/agent/settings-data').then(r => r.json()).then(setSettingsData).catch(() => setSettingsData({}));
    }, []);

    const setStatus = useCallback((text, type = 'info') => {
        setStatusMessage(text ? { text, type } : null);
    }, []);

    const switchSection = useCallback((id) => {
        setActiveSection(id);
        setFilter('');
    }, []);

    // Merge built-in + extension panes, sorted by order
    const extensionPanes = getRegisteredSettingsPanes();
    const allSections = [
        ...BUILTIN_SECTIONS,
        ...extensionPanes.map(p => ({
            id: p.id,
            label: p.label,
            icon: p.icon,
            searchable: p.searchable || false,
            placeholder: p.searchPlaceholder,
            order: p.order ?? 500,
            isExtension: true,
            component: p.component,
        })),
    ].sort((a, b) => (a.order ?? 500) - (b.order ?? 500));

    const activeMeta = allSections.find(s => s.id === activeSection);

    useEffect(() => {
        if (activeMeta?.searchable) {
            requestAnimationFrame(() => filterRef.current?.focus());
        }
    }, [activeSection]);

    const mergeSettingsData = useCallback((patch) => {
        setSettingsData(prev => ({ ...(prev || {}), ...(patch || {}) }));
    }, []);

    const renderSection = () => {
        // Check extension panes first
        if (activeMeta?.isExtension && activeMeta.component) {
            const Comp = activeMeta.component;
            return html`<${Comp} filter=${filter} />`;
        }
        switch (activeSection) {
            case 'general': return html`<${GeneralSection} settingsData=${settingsData} setStatus=${setStatus} mergeSettingsData=${mergeSettingsData} />`;
            case 'providers': return html`<${ProvidersSection} providers=${settingsData?.providers} setStatus=${setStatus} />`;
            case 'models': return html`<${ModelsSection} filter=${filter} />`;
            case 'theme': return html`<${ThemeSection} themes=${settingsData?.themes} colorKeys=${settingsData?.colorKeys} />`;
            case 'quick-actions': return html`<${QuickActionsSection} filter=${filter} setStatus=${setStatus} mergeSettingsData=${mergeSettingsData} />`;
            case 'tools': return html`<${ToolsSection} toolsets=${settingsData?.toolsets} filter=${filter} />`;
            case 'addons': return html`<${AddonsSection} setStatus=${setStatus} filter=${filter} />`;
            default: return null;
        }
    };

    return html`
        <div class="settings-dialog-backdrop" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div class="settings-dialog">
                <div class="settings-dialog-header">
                    <span class="settings-dialog-title">Settings</span>
                    ${activeMeta?.searchable && html`
                        <input ref=${filterRef} type="text" class="settings-header-filter"
                            placeholder=${activeMeta.placeholder || 'Filter\u2026'}
                            value=${filter} onInput=${e => setFilter(e.target.value)} />
                    `}
                    <button class="settings-dialog-close" onClick=${onClose} title="Close (Esc)">\u2715</button>
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
                        ${settingsData === null ? html`<div class="settings-loading">Loading\u2026</div>` : renderSection()}
                    </main>
                </div>
                ${statusMessage && html`
                    <div class=${`settings-status-bar settings-status-bar-${statusMessage.type}`}>
                        ${statusMessage.type === 'info' && html`<span class="settings-spinner"></span>`}
                        <span>${statusMessage.text}</span>
                        ${statusMessage.type !== 'info' && html`<button class="settings-status-dismiss" onClick=${() => setStatusMessage(null)}>\u2715</button>`}
                    </div>
                `}
            </div>
        </div>
    `;
}

export function SettingsDialog() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        const handler = () => setOpen(true);
        window.addEventListener('piclaw:open-settings', handler);
        return () => window.removeEventListener('piclaw:open-settings', handler);
    }, []);
    if (!open) return null;
    return html`<${BodyPortal} className="settings-portal"><${SettingsDialogContent} onClose=${() => setOpen(false)} /><//>`;
}

export function openSettingsDialog() {
    window.dispatchEvent(new CustomEvent('piclaw:open-settings'));
}
