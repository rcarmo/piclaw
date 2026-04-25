// @ts-nocheck
import { html, useState, useCallback, useMemo } from '../../vendor/preact-htm.js';

// Toolset icons derived from the tool-status-hints SVG vocabulary
const TOOLSET_ICONS = {
    core: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7.5 10l2.5 2-2.5 2"/><path d="M12.5 15H16"/></svg>`,
    discovery: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>`,
    attachments: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
    'model-control': html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><path d="M9 15c.83.67 2 1 3 1s2.17-.33 3-1"/></svg>`,
    data: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    workspace: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
    automation: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`,
    remote: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>`,
    browser: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    ui: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>`,
    experiments: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v7l4.6 7.7A1 1 0 0 1 18.7 19H5.3a1 1 0 0 1-.9-1.3L9 10z"/><line x1="9" y1="3" x2="15" y2="3"/></svg>`,
    lifecycle: html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`,
};
// Tool → extension source mapping (derived from registerTool calls)
const TOOL_EXTENSION = {
    read: 'pi-core', write: 'pi-core', edit: 'pi-core', bash: 'pi-core', powershell: 'pi-core',
    find: 'pi-core', grep: 'pi-core', ls: 'pi-core',
    list_tools: 'internal-tools', list_internal_tools: 'internal-tools',
    activate_tools: 'tool-activation', reset_active_tools: 'tool-activation',
    list_scripts: 'runtime-scripts',
    attach_file: 'file-attachments', read_attachment: 'file-attachments', export_attachment: 'file-attachments',
    get_model_state: 'model-control', list_models: 'model-control', switch_model: 'model-control', switch_thinking: 'model-control',
    messages: 'messages-crud', introspect_sql: 'sql-introspect', keychain: 'keychain-tools',
    search_workspace: 'workspace-search', refresh_workspace_index: 'workspace-search',
    open_office_viewer: 'office-viewer', office_read: 'office-viewer', office_write: 'office-viewer',
    open_workspace_file: 'open-workspace-file', image_process: 'image-processing',
    schedule_task: 'scheduled-tasks', scheduled_tasks: 'scheduled-tasks',
    bun_run: 'bun-runner', exec_batch: 'exec-batch', search_tool_output: 'search-tool-output',
    ssh: 'ssh', proxmox: 'proxmox', portainer: 'portainer', mcp: 'mcp',
    cdp_browser: 'cdp-browser',
    send_adaptive_card: 'send-adaptive-card', send_dashboard_widget: 'send-dashboard-widget',
    start_autoresearch: 'autoresearch', stop_autoresearch: 'autoresearch', autoresearch_status: 'autoresearch',
    exit_process: 'exit-process', env: 'env-tools',
};

const KIND_BADGE = { 'read-only': '\ud83d\udd0d', 'mutating': '\u270f\ufe0f', 'mixed': '\ud83d\udd04' };
const DEFAULT_ICON = html`<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`;

export function ToolsSection({ toolsets, filter = '' }) {
    const groups = toolsets || [];
    const [enabledGroups, setEnabledGroups] = useState(() => { const m = {}; for (const g of groups) m[g.name] = true; return m; });
    const toggleGroup = useCallback((name) => { setEnabledGroups(prev => ({ ...prev, [name]: !prev[name] })); }, []);

    const lf = filter.toLowerCase();
    const filteredGroups = useMemo(() => {
        if (!lf) return groups;
        return groups.map(g => {
            const tools = g.tools.filter(t =>
                t.name.toLowerCase().includes(lf) ||
                g.name.toLowerCase().includes(lf) ||
                (t.summary || '').toLowerCase().includes(lf)
            );
            return tools.length > 0 ? { ...g, tools } : null;
        }).filter(Boolean);
    }, [groups, lf]);

    if (groups.length === 0) return html`<div class="settings-section"><p class="settings-hint">Tool data not available.</p></div>`;

    return html`
        <div class="settings-section">
            ${filteredGroups.map(g => { const enabled = enabledGroups[g.name] !== false; return html`
                <div class="settings-toolset">
                    <div class="settings-toolset-header">
                        <label class="settings-toolset-toggle">
                            <input type="checkbox" checked=${enabled} onChange=${() => toggleGroup(g.name)} />
                            <span class="settings-toolset-icon">${TOOLSET_ICONS[g.name] || DEFAULT_ICON}</span>
                            <strong>${g.name}</strong>
                        </label>
                        <span class="settings-hint" style="margin:0">${g.description}</span>
                    </div>
                    ${enabled && html`<div class="settings-tool-list">${g.tools.map(t => html`
                        <div class="settings-tool-row">
                            <input type="checkbox" checked disabled />
                            <span class="settings-tool-name">${t.name}</span>
                            <span class="settings-tool-kind" title=${t.kind}>${KIND_BADGE[t.kind] || '?'}</span>
                            ${t.summary && html`<span class="settings-tool-summary">${t.summary}</span>`}
                            <span class="settings-tool-source">${TOOL_EXTENSION[t.name] || g.name}</span>
                        </div>
                    `)}</div>`}
                </div>
            `; })}
            ${filteredGroups.length === 0 && html`<p class="settings-hint">No tools match "${filter}"</p>`}
            <p class="settings-hint">Tool activation is managed by the agent runtime. Group checkboxes collapse/expand; individual tools use <code>activate_tools</code>.</p>
        </div>
    `;
}
