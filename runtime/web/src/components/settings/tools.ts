import { html, useCallback, useMemo } from '../../vendor/preact-htm.js';
import { renderToolIcon } from '../../ui/tool-icon.js';
import { useTranslation } from '../../utils/i18n.js';
import { useSettingsFieldIds } from './field-ids.js';

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
    list_tools: 'internal-tools',
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
    send_dashboard_widget: 'send-dashboard-widget',
    start_autoresearch: 'autoresearch', stop_autoresearch: 'autoresearch', autoresearch_status: 'autoresearch',
    exit_process: 'exit-process', env: 'env-tools',
};

const KIND_BADGE = { 'read-only': '\ud83d\udd0d', 'mutating': '\u270f\ufe0f', 'mixed': '\ud83d\udd04' };
const DEFAULT_ICON = renderToolIcon(12);

/** Read-only catalogue. SDK access restrictions govern availability. */
export function ToolsSection({ toolsets, filter = '', settingsData, mergeSettingsData }) {
    const { t: tr } = useTranslation();
    const groups = toolsets || [];
    const fieldId = useSettingsFieldIds('tools');
    const searchModeId = fieldId('search-match-mode');
    const searchMatchMode = settingsData?.searchMatchMode || 'or';
    const toggleSearchMode = useCallback(async () => {
        const next = searchMatchMode === 'or' ? 'and' : 'or';
        try {
            const response = await fetch('/agent/settings/general', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ searchMatchMode: next }),
            });
            const payload = await response.json().catch(() => ({}));
            if (payload?.ok && payload?.settings) mergeSettingsData?.(payload.settings);
        } catch (e) { console.warn('[settings/tools] Failed to save search match mode.', e); }
    }, [searchMatchMode, mergeSettingsData]);
    const lf = filter.toLowerCase();
    const filteredGroups = useMemo(() => {
        if (!lf) return groups;
        return groups.map(g => {
            const tools = g.tools.filter(t => t.name.toLowerCase().includes(lf) || g.name.toLowerCase().includes(lf) || (t.summary || '').toLowerCase().includes(lf));
            return tools.length > 0 ? { ...g, tools } : null;
        }).filter(Boolean);
    }, [groups, lf]);
    if (groups.length === 0) return html`<div class="settings-section"><p class="settings-hint">${tr('settings.tools.unavailable')}</p></div>`;
    return html`
        <div class="settings-section">
            <div class="settings-search-options">
                <h4 style="margin:0 0 8px 0">${tr('settings.tools.search')}</h4>
                <div class="settings-row">
                    <label for=${searchModeId}>${tr('settings.tools.matchMode')}</label>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input id=${searchModeId} type="checkbox" checked=${searchMatchMode === 'and'} onChange=${toggleSearchMode} />
                        <span class="settings-hint" style="margin:0">${tr(searchMatchMode === 'or' ? 'settings.tools.orMode' : 'settings.tools.andMode')}</span>
                    </div>
                </div>
            </div>
            ${filteredGroups.map(g => html`
                <div class="settings-toolset">
                    <div class="settings-toolset-header">
                        <span class="settings-toolset-icon">${TOOLSET_ICONS[g.name] || DEFAULT_ICON}</span><strong>${g.name}</strong>
                        <span class="settings-hint" style="margin:0">${g.description}</span>
                    </div>
                    <div class="settings-tool-list">
                        <div class="settings-tool-row settings-tool-row-header" aria-hidden="true">
                            <span class="settings-tool-name">${tr('settings.tools.colTool')}</span>
                            <span class="settings-tool-kind">${tr('settings.tools.colKind')}</span>
                            <span class="settings-tool-summary">${tr('settings.tools.colSummary')}</span>
                            <span class="settings-tool-source">${tr('settings.tools.colSource')}</span>
                        </div>
                        ${g.tools.map(t => html`
                            <div class="settings-tool-row">
                                <span class="settings-tool-name">${t.name}</span>
                                <span class="settings-tool-kind" title=${t.kind}>${KIND_BADGE[t.kind] || '?'}</span>
                                <span class="settings-tool-summary">${t.summary || ''}</span>
                                <span class="settings-tool-source">${TOOL_EXTENSION[t.name] || g.name}</span>
                            </div>
                        `)}
                    </div>
                </div>
            `)}
            ${filteredGroups.length === 0 && html`<p class="settings-hint">${tr('settings.tools.noMatch', { filter })}</p>`}
            <p class="settings-hint">${tr('settings.tools.footer')}</p>
        </div>
    `;
}
