// @ts-nocheck
/**
 * settings-pane.ts — Settings pane extension.
 *
 * Two-column layout: side nav + content area.
 * Sections: General, Model & Provider, Appearance, Tools, Add-ons.
 * Launched via /settings slash command or workspace menu.
 */

import type { WebPaneExtension, PaneContext, PaneInstance } from './pane-types.js';
import { html, render, useState, useEffect, useCallback } from '../vendor/preact-htm.js';
import { getAgentModels } from '../api.js';

export const SETTINGS_TAB_PATH = 'piclaw://settings';

const SECTIONS = [
    { id: 'general', label: 'General', icon: '⚙️' },
    { id: 'models', label: 'Models & Providers', icon: '🤖' },
    { id: 'theme', label: 'Appearance', icon: '🎨' },
    { id: 'tools', label: 'Tools', icon: '🔧' },
    { id: 'addons', label: 'Add-ons', icon: '📦' },
];

function GeneralSection() {
    const [assistantName, setAssistantName] = useState('');
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        fetch('/agent/branding').then(r => r.json()).then(data => {
            setAssistantName(data?.assistant_name || 'PiClaw');
            setLoaded(true);
        }).catch(() => setLoaded(true));
    }, []);

    const save = useCallback(async () => {
        await fetch('/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `/agent-name ${assistantName}` }),
        });
    }, [assistantName]);

    if (!loaded) return html`<div class="settings-loading">Loading…</div>`;

    return html`
        <div class="settings-section">
            <h3>General</h3>
            <div class="settings-row">
                <label>Assistant name</label>
                <input type="text" value=${assistantName} onInput=${e => setAssistantName(e.target.value)} />
                <button onClick=${save}>Save</button>
            </div>
        </div>
    `;
}

function ModelsSection() {
    const [models, setModels] = useState(null);

    useEffect(() => {
        getAgentModels().then(setModels).catch(() => setModels({ models: [], model_options: [] }));
    }, []);

    if (!models) return html`<div class="settings-loading">Loading models…</div>`;

    const options = models.model_options || [];
    const current = models.current;

    return html`
        <div class="settings-section">
            <h3>Models & Providers</h3>
            <p class="settings-hint">Current model: <strong>${current || 'none'}</strong></p>
            <table class="settings-table">
                <thead><tr><th>Model</th><th>Provider</th><th>Context</th><th>Reasoning</th></tr></thead>
                <tbody>
                    ${options.map(m => html`
                        <tr class=${m.label === current ? 'settings-row-active' : ''}>
                            <td>${m.label}</td>
                            <td>${m.provider}</td>
                            <td>${m.context_window ? (m.context_window / 1000).toFixed(0) + 'K' : '—'}</td>
                            <td>${m.reasoning ? '✓' : '—'}</td>
                        </tr>
                    `)}
                </tbody>
            </table>
            <p class="settings-hint">Use <code>/model provider/id</code> to switch or <code>/login</code> to add providers.</p>
        </div>
    `;
}

function ThemeSection() {
    const [currentTheme, setCurrentTheme] = useState('');

    useEffect(() => {
        setCurrentTheme(document.documentElement.dataset.colorTheme || 'default');
    }, []);

    const themes = [
        'default', 'solarized', 'github', 'dracula', 'catppuccin', 'nord',
        'gruvbox', 'tokyo', 'monokai', 'monokai-pro', 'ristretto', 'miasma',
        'gotham', 'xterm', 'tango',
    ];

    const apply = useCallback((name) => {
        fetch('/post', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: `/theme ${name}` }),
        });
        setCurrentTheme(name);
    }, []);

    return html`
        <div class="settings-section">
            <h3>Appearance</h3>
            <div class="settings-theme-grid">
                ${themes.map(t => html`
                    <button
                        class=${`settings-theme-btn ${t === currentTheme ? 'active' : ''}`}
                        onClick=${() => apply(t)}
                    >${t}</button>
                `)}
            </div>
        </div>
    `;
}

function ToolsSection() {
    return html`
        <div class="settings-section">
            <h3>Tools</h3>
            <p class="settings-hint">Tool activation is managed by the agent runtime. Use <code>list_tools</code> to discover available tools and <code>activate_tools</code> to enable them.</p>
            <p class="settings-hint">Default active tools can be configured in <code>.piclaw/config.json</code> under <code>tools.additionalDefaultTools</code>.</p>
        </div>
    `;
}

function AddonsSection() {
    const [catalog, setCatalog] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('https://raw.githubusercontent.com/rcarmo/piclaw-addons/main/catalog.json')
            .then(r => r.json())
            .then(data => { setCatalog(data); setLoading(false); })
            .catch(() => { setCatalog(null); setLoading(false); });
    }, []);

    if (loading) return html`<div class="settings-loading">Fetching add-on catalog…</div>`;
    if (!catalog) return html`
        <div class="settings-section">
            <h3>Add-ons</h3>
            <p>Could not load add-on catalog from <code>rcarmo/piclaw-addons</code>.</p>
        </div>
    `;

    return html`
        <div class="settings-section">
            <h3>Add-ons</h3>
            <p class="settings-hint">Available from <a href="https://github.com/rcarmo/piclaw-addons" target="_blank">rcarmo/piclaw-addons</a></p>
            <table class="settings-table">
                <thead><tr><th>Add-on</th><th>Description</th><th>Tags</th></tr></thead>
                <tbody>
                    ${(catalog.addons || []).map(a => html`
                        <tr>
                            <td><strong>${a.slug}</strong></td>
                            <td>${a.description}</td>
                            <td>${(a.tags || []).join(', ')}</td>
                        </tr>
                    `)}
                </tbody>
            </table>
        </div>
    `;
}

function SettingsApp() {
    const [activeSection, setActiveSection] = useState('general');

    const renderSection = () => {
        switch (activeSection) {
            case 'general': return html`<${GeneralSection} />`;
            case 'models': return html`<${ModelsSection} />`;
            case 'theme': return html`<${ThemeSection} />`;
            case 'tools': return html`<${ToolsSection} />`;
            case 'addons': return html`<${AddonsSection} />`;
            default: return html`<div>Select a section</div>`;
        }
    };

    return html`
        <div class="settings-pane">
            <nav class="settings-nav">
                <div class="settings-nav-title">Settings</div>
                ${SECTIONS.map(s => html`
                    <button
                        class=${`settings-nav-item ${s.id === activeSection ? 'active' : ''}`}
                        onClick=${() => setActiveSection(s.id)}
                    >
                        <span class="settings-nav-icon">${s.icon}</span>
                        <span class="settings-nav-label">${s.label}</span>
                    </button>
                `)}
            </nav>
            <main class="settings-content">
                ${renderSection()}
            </main>
        </div>
    `;
}

class SettingsPaneInstance implements PaneInstance {
    private container: HTMLElement;
    private disposed = false;

    constructor(container: HTMLElement) {
        this.container = container;
        this.container.classList.add('settings-pane-host');
        render(html`<${SettingsApp} />`, this.container);
    }

    getContent() { return undefined; }
    isDirty() { return false; }
    focus() { this.container?.focus?.(); }
    resize() {}
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        render(null, this.container);
    }
}

export const settingsPane: WebPaneExtension = {
    id: 'settings',
    label: 'Settings',
    icon: '⚙️',
    capabilities: ['readonly'],
    placement: 'tabs',
    canHandle(context: PaneContext) {
        return context.path === SETTINGS_TAB_PATH ? 100 : false;
    },
    mount(container: HTMLElement, _context: PaneContext) {
        return new SettingsPaneInstance(container);
    },
};
