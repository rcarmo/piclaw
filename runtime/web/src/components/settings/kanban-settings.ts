// @ts-nocheck
/**
 * kanban-settings.ts — Kanban board settings pane (extension-contributed).
 */
import { html, useState, useCallback } from '../../vendor/preact-htm.js';
import { registerSettingsPane } from './pane-registry.js';

function getBool(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v === 'true'; } catch { return fallback; }
}
function setBool(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) { void e; } }
function getString(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
function setString(key, value) { try { localStorage.setItem(key, value); } catch (e) { void e; } }

function KanbanSettingsSection() {
    const [defaultColumns, setDefaultColumns] = useState(() => getString('piclaw_kanban_default_columns', 'To Do, In Progress, Done'));
    const [autoSave, setAutoSave] = useState(() => getBool('piclaw_kanban_auto_save', true));
    const [compactMode, setCompactMode] = useState(() => getBool('piclaw_kanban_compact', false));
    const [showArchived, setShowArchived] = useState(() => getBool('piclaw_kanban_show_archived', false));

    return html`
        <div class="settings-section">
            <h3>Kanban Board</h3>
            <div class="settings-row">
                <label>Default columns</label>
                <input type="text" value=${defaultColumns}
                    onInput=${e => { const v = e.target.value; setDefaultColumns(v); setString('piclaw_kanban_default_columns', v); }}
                    placeholder="To Do, In Progress, Done" />
            </div>
            <div class="settings-row">
                <label>Auto-save</label>
                <input type="checkbox" checked=${autoSave}
                    onChange=${() => { const v = !autoSave; setAutoSave(v); setBool('piclaw_kanban_auto_save', v); }} />
            </div>
            <div class="settings-row">
                <label>Compact card mode</label>
                <input type="checkbox" checked=${compactMode}
                    onChange=${() => { const v = !compactMode; setCompactMode(v); setBool('piclaw_kanban_compact', v); }} />
            </div>
            <div class="settings-row">
                <label>Show archived items</label>
                <input type="checkbox" checked=${showArchived}
                    onChange=${() => { const v = !showArchived; setShowArchived(v); setBool('piclaw_kanban_show_archived', v); }} />
            </div>
            <p class="settings-hint">Opens <code>.kanban.md</code> files. Changes take effect on the next board open.</p>
        </div>
    `;
}

const iconKanban = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="12" rx="1"/></svg>`;

registerSettingsPane({
    id: 'kanban',
    label: 'Kanban',
    icon: iconKanban,
    component: KanbanSettingsSection,
    order: 160,
});
