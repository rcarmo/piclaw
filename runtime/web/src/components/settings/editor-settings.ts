// @ts-nocheck
/**
 * editor-settings.ts — Editor settings pane (extension-contributed).
 *
 * Reads/writes editor preferences from localStorage, matching the keys
 * used by the CodeMirror editor extension.
 */
import { html, useState, useCallback } from '../../vendor/preact-htm.js';
import { registerSettingsPane, notifySettingsPanesChanged } from './pane-registry.js';
import { NumberStepper, normalizeNumberValue } from './number-stepper.js';

function getBool(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v === 'true'; }
    catch { return fallback; }
}
function setBool(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { void e; }
}
function getString(key, fallback) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function setString(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { void e; }
}
function getInt(key, fallback, min, max) {
    try {
        return normalizeNumberValue(localStorage.getItem(key), { fallback, min, max });
    } catch {
        return normalizeNumberValue(fallback, { fallback, min, max });
    }
}
function setInt(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { void e; }
}

function EditorSettingsSection() {
    const [vimMode, setVimMode] = useState(() => getBool('piclaw_vim_mode', false));
    const [showWhitespace, setShowWhitespace] = useState(() => getBool('piclaw_show_whitespace', true));
    const [livePreview, setLivePreview] = useState(() => getBool('piclaw_md_live_preview', true));
    const [editorFontSize, setEditorFontSize] = useState(() => getInt('piclaw_editor_font_size', 13, 10, 24));
    const [editorFontFamily, setEditorFontFamily] = useState(() => getString('piclaw_editor_font_family', ''));

    const toggle = useCallback((key, getter, setter) => {
        const next = !getter;
        setter(next);
        setBool(key, next);
    }, []);

    return html`
        <div class="settings-section">
            <h3>Editor</h3>
            <div class="settings-row">
                <label>Vim mode</label>
                <input type="checkbox" checked=${vimMode}
                    onChange=${() => { const v = !vimMode; setVimMode(v); setBool('piclaw_vim_mode', v); }} />
            </div>
            <div class="settings-row">
                <label>Show whitespace</label>
                <input type="checkbox" checked=${showWhitespace}
                    onChange=${() => { const v = !showWhitespace; setShowWhitespace(v); setBool('piclaw_show_whitespace', v); }} />
            </div>
            <div class="settings-row">
                <label>Markdown live preview</label>
                <input type="checkbox" checked=${livePreview}
                    onChange=${() => { const v = !livePreview; setLivePreview(v); setBool('piclaw_md_live_preview', v); }} />
            </div>
            <div class="settings-row">
                <label>Font size (px)</label>
                <${NumberStepper}
                    label="editor font size"
                    value=${editorFontSize}
                    min=${10}
                    max=${24}
                    fallback=${13}
                    width="70px"
                    onChange=${(value) => { setEditorFontSize(value); setInt('piclaw_editor_font_size', value); }}
                />
            </div>
            <div class="settings-row">
                <label>Font family</label>
                <input type="text" value=${editorFontFamily}
                    onInput=${e => { const v = e.target.value; setEditorFontFamily(v); setString('piclaw_editor_font_family', v); }}
                    placeholder="monospace (default)" />
            </div>
            <p class="settings-hint">Editor changes take effect when you next open or reload a file tab.</p>
        </div>
    `;
}

// SVG icon: code brackets
const iconEditor = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`;

// Self-register on import
registerSettingsPane({
    id: 'editor',
    label: 'Editor',
    icon: iconEditor,
    component: EditorSettingsSection,
    order: 150,
});
