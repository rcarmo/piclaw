/**
 * editor-settings.ts — Editor settings pane (extension-contributed).
 *
 * Reads/writes editor preferences from localStorage, matching the keys
 * used by the CodeMirror editor extension.
 */
import { html, useState, useCallback } from '../../vendor/preact-htm.js';
import { registerSettingsPane, notifySettingsPanesChanged } from './pane-registry.js';
import { NumberStepper, normalizeNumberValue } from './number-stepper.js';
import { useTranslation } from '../../utils/i18n.js';
import { useSettingsFieldIds } from './field-ids.js';
import { iconEditorPane } from './core-pane-icons.js';

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
    const fieldId = useSettingsFieldIds('editor');
    const { t } = useTranslation();
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
            <h3>${t('settings.editor.heading')}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('vim')}>${t('settings.editor.vimMode')}</label>
                <input id=${fieldId('vim')} type="checkbox" checked=${vimMode}
                    onChange=${() => { const v = !vimMode; setVimMode(v); setBool('piclaw_vim_mode', v); }} />
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('whitespace')}>${t('settings.editor.showWhitespace')}</label>
                <input id=${fieldId('whitespace')} type="checkbox" checked=${showWhitespace}
                    onChange=${() => { const v = !showWhitespace; setShowWhitespace(v); setBool('piclaw_show_whitespace', v); }} />
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('preview')}>${t('settings.editor.livePreview')}</label>
                <input id=${fieldId('preview')} type="checkbox" checked=${livePreview}
                    onChange=${() => { const v = !livePreview; setLivePreview(v); setBool('piclaw_md_live_preview', v); }} />
            </div>
            <div class="settings-row settings-dense-row">
                <label>${t('settings.editor.fontSize')}</label>
                <${NumberStepper}
                    label=${t('settings.editor.fontSizeAria')}
                    value=${editorFontSize}
                    min=${10}
                    max=${24}
                    fallback=${13}
                    width="70px"
                    onChange=${(value) => { setEditorFontSize(value); setInt('piclaw_editor_font_size', value); }}
                />
            </div>
            <div class="settings-row settings-dense-row settings-dense-row-wide">
                <label for=${fieldId('font-family')}>${t('settings.editor.fontFamily')}</label>
                <input id=${fieldId('font-family')} type="text" value=${editorFontFamily}
                    onInput=${e => { const v = e.target.value; setEditorFontFamily(v); setString('piclaw_editor_font_family', v); }}
                    placeholder=${t('settings.editor.fontFamilyPlaceholder')} />
            </div>
            <p class="settings-hint settings-local-only-hint">${t('settings.editor.localOnlyHint')}</p>
        </div>
    `;
}


// Self-register on import
registerSettingsPane({
    id: 'editor',
    label: 'Editor',
    icon: iconEditorPane,
    component: EditorSettingsSection,
    order: 150,
});
