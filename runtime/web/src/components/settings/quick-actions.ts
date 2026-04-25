// @ts-nocheck
import { html, useCallback, useEffect, useMemo, useState } from '../../vendor/preact-htm.js';
import { getAgentCommands, getQuickActionsSettings, saveQuickActionsSettings } from '../../api.js';
import {
    WORKSPACE_QUICK_ACTIONS_CATALOG,
    normalizeTimelineQuickActionsSettingsData,
} from '../../ui/timeline-quick-actions.js';

function hasFilterMatch(filter, ...parts) {
    const query = String(filter || '').trim().toLowerCase();
    if (!query) return true;
    return parts.some((part) => String(part || '').toLowerCase().includes(query));
}

function buildSelectionSet(values) {
    if (!Array.isArray(values)) return null;
    return new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
}

export function QuickActionsSection({ filter = '', setStatus, mergeSettingsData }) {
    const [workspaceCommands, setWorkspaceCommands] = useState(() => WORKSPACE_QUICK_ACTIONS_CATALOG.map((command) => command.id));
    const [slashCommands, setSlashCommands] = useState([]);
    const [availableSlashCommands, setAvailableSlashCommands] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [settingsPayload, commandsPayload] = await Promise.all([
                getQuickActionsSettings(),
                getAgentCommands('web:default').catch(() => ({ commands: [] })),
            ]);
            const settings = normalizeTimelineQuickActionsSettingsData(settingsPayload?.settings);
            const commands = Array.isArray(commandsPayload?.commands) ? commandsPayload.commands : [];
            setAvailableSlashCommands(commands);
            setWorkspaceCommands(Array.isArray(settings.workspaceCommands)
                ? settings.workspaceCommands
                : WORKSPACE_QUICK_ACTIONS_CATALOG.map((command) => command.id));
            setSlashCommands(Array.isArray(settings.slashCommands)
                ? settings.slashCommands
                : commands.map((command) => String(command?.name || '').trim()).filter(Boolean));
        } catch (error) {
            setStatus?.(String(error?.message || error), 'error');
        } finally {
            setLoading(false);
        }
    }, [setStatus]);

    useEffect(() => {
        void load();
    }, [load]);

    const workspaceSelection = useMemo(() => buildSelectionSet(workspaceCommands), [workspaceCommands]);
    const slashSelection = useMemo(() => buildSelectionSet(slashCommands), [slashCommands]);

    const visibleWorkspaceCommands = useMemo(() => WORKSPACE_QUICK_ACTIONS_CATALOG.filter((command) => (
        hasFilterMatch(filter, command.label, command.description, ...(command.keywords || []))
    )), [filter]);

    const visibleSlashCommands = useMemo(() => availableSlashCommands.filter((command) => (
        hasFilterMatch(filter, command?.name, command?.description, command?.source)
    )), [availableSlashCommands, filter]);

    const toggleWorkspaceCommand = useCallback((commandId) => {
        setWorkspaceCommands((prev) => {
            const current = new Set((Array.isArray(prev) ? prev : []).map((value) => String(value || '').trim()).filter(Boolean));
            if (current.has(commandId)) current.delete(commandId);
            else current.add(commandId);
            return WORKSPACE_QUICK_ACTIONS_CATALOG.map((command) => command.id).filter((id) => current.has(id));
        });
    }, []);

    const toggleSlashCommand = useCallback((commandName) => {
        setSlashCommands((prev) => {
            const current = new Set((Array.isArray(prev) ? prev : []).map((value) => String(value || '').trim()).filter(Boolean));
            if (current.has(commandName)) current.delete(commandName);
            else current.add(commandName);
            return availableSlashCommands
                .map((command) => String(command?.name || '').trim())
                .filter((name) => name && current.has(name));
        });
    }, [availableSlashCommands]);

    const resetDefaults = useCallback(() => {
        setWorkspaceCommands(WORKSPACE_QUICK_ACTIONS_CATALOG.map((command) => command.id));
        setSlashCommands(availableSlashCommands.map((command) => String(command?.name || '').trim()).filter(Boolean));
    }, [availableSlashCommands]);

    const save = useCallback(async () => {
        if (saving) return;
        setSaving(true);
        setStatus?.('Saving quick actions…', 'info');
        try {
            const payload = await saveQuickActionsSettings({
                workspaceCommands,
                slashCommands,
            });
            const settings = normalizeTimelineQuickActionsSettingsData(payload?.settings);
            mergeSettingsData?.({ quickActions: settings });
            window.dispatchEvent(new CustomEvent('piclaw:quick-actions-settings-updated', { detail: { settings } }));
            setStatus?.('Quick Actions saved.', 'success');
        } catch (error) {
            setStatus?.(String(error?.message || error), 'error');
        } finally {
            setSaving(false);
        }
    }, [mergeSettingsData, saving, setStatus, slashCommands, workspaceCommands]);

    if (loading) {
        return html`<div class="settings-loading">Loading…</div>`;
    }

    return html`
        <div class="settings-section">
            <h3>Timeline Quick Actions</h3>
            <p class="settings-hint">
                Choose which actions appear in the timeline typeahead. Agents are always pinned first, then workspace commands, then slash commands.
            </p>

            <div class="settings-row" style="align-items:center; gap:10px; margin-bottom:12px;">
                <button class="settings-addon-btn" onClick=${resetDefaults} disabled=${saving}>Enable all</button>
                <button class="settings-addon-btn settings-addon-btn-install" onClick=${save} disabled=${saving}>
                    ${saving ? 'Saving…' : 'Save & apply'}
                </button>
            </div>

            <h3 style="margin-top:8px;">Workspace commands</h3>
            <div class="settings-subsection-list">
                ${visibleWorkspaceCommands.map((command) => {
                    const checked = workspaceSelection ? workspaceSelection.has(command.id.toLowerCase()) : true;
                    return html`
                        <label class="settings-checkbox-row" key=${command.id}>
                            <input type="checkbox" checked=${checked} onChange=${() => toggleWorkspaceCommand(command.id)} />
                            <div>
                                <div>${command.label}</div>
                                <div class="settings-hint" style="margin:2px 0 0 0;">${command.description}</div>
                            </div>
                        </label>
                    `;
                })}
                ${visibleWorkspaceCommands.length === 0 && html`<div class="settings-hint">No workspace commands match this filter.</div>`}
            </div>

            <h3 style="margin-top:20px;">Slash commands</h3>
            <div class="settings-subsection-list">
                ${visibleSlashCommands.map((command) => {
                    const name = String(command?.name || '').trim();
                    const checked = slashSelection ? slashSelection.has(name.toLowerCase()) : true;
                    return html`
                        <label class="settings-checkbox-row" key=${name}>
                            <input type="checkbox" checked=${checked} onChange=${() => toggleSlashCommand(name)} />
                            <div>
                                <div><code>${name}</code></div>
                                <div class="settings-hint" style="margin:2px 0 0 0;">${command?.description || 'slash command'}</div>
                            </div>
                        </label>
                    `;
                })}
                ${visibleSlashCommands.length === 0 && html`<div class="settings-hint">No slash commands match this filter.</div>`}
            </div>
        </div>
    `;
}
