/**
 * developer-settings.ts — Developer mode settings pane.
 */
import { html, useState, useCallback } from '../../vendor/preact-htm.js';
import { registerSettingsPane } from './pane-registry.js';
import { useTranslation } from '../../utils/i18n.js';
import { useSettingsFieldIds } from './field-ids.js';
import { iconDeveloperPane } from './core-pane-icons.js';

function getBool(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v === 'true'; } catch { return fallback; }
}
function setBool(key, value) { try { localStorage.setItem(key, String(value)); } catch (e) { void e; } }
function getString(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } }
function setString(key, value) { try { localStorage.setItem(key, value); } catch (e) { void e; } }

function DeveloperSettingsSection() {
    const fieldId = useSettingsFieldIds('developer');
    const { t } = useTranslation();
    const [devMode, setDevMode] = useState(() => getBool('piclaw_dev_mode', false));
    const [addonsCatalogUrl, setAddonsCatalogUrl] = useState(() => getString('piclaw_addons_catalog_url', ''));
    const [additionalCatalogUrls, setAdditionalCatalogUrls] = useState(() => getString('piclaw_addons_catalog_urls', ''));
    const [addonsRepoUrl, setAddonsRepoUrl] = useState(() => getString('piclaw_addons_repo_url', ''));
    const [debugSse, setDebugSse] = useState(() => getBool('piclaw_debug_sse', false));
    const [debugToolCalls, setDebugToolCalls] = useState(() => getBool('piclaw_debug_tool_calls', false));

    const toggleDev = useCallback(() => {
        const v = !devMode;
        setDevMode(v);
        setBool('piclaw_dev_mode', v);
    }, [devMode]);

    return html`
        <div class="settings-section">
            <h3>${t('settings.developer.heading')}</h3>
            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label for=${fieldId('dev-mode')}>${t('settings.developer.devMode')}</label>
                <input id=${fieldId('dev-mode')} type="checkbox" checked=${devMode} onChange=${toggleDev} />
            </div>

            <p class="settings-hint settings-local-only-hint">${t('settings.developer.localHint')}</p>

            ${devMode && html`
                <h3 style="margin-top:16px">${t('settings.developer.addonSources')}</h3>
                <div class="settings-row settings-dense-row settings-dense-row-wide">
                    <label for=${fieldId('catalog')}>${t('settings.developer.catalogUrl')}</label>
                    <input id=${fieldId('catalog')} type="text" value=${addonsCatalogUrl}
                        onInput=${e => { const v = e.target.value; setAddonsCatalogUrl(v); setString('piclaw_addons_catalog_url', v); }}
                        placeholder="https://raw.githubusercontent.com/.../catalog.json" />
                </div>
                <p class="settings-hint" style="margin-top:0">${t('settings.developer.catalogHint')} (<code>rcarmo/piclaw-addons</code>).</p>
                <div class="settings-row settings-dense-row settings-dense-row-wide settings-dense-row-compound">
                    <label for=${fieldId('catalogs')}>${t('settings.developer.additionalCatalogs')}</label>
                    <textarea id=${fieldId('catalogs')}
                        value=${additionalCatalogUrls}
                        onInput=${e => { const v = e.target.value; setAdditionalCatalogUrls(v); setString('piclaw_addons_catalog_urls', v); }}
                        placeholder="One URL per line\nhttps://example.com/catalog.json"
                        style="min-height:86px; resize:vertical;"
                    ></textarea>
                </div>
                <p class="settings-hint" style="margin-top:0">${t('settings.developer.additionalHint')}</p>
                <div class="settings-row settings-dense-row settings-dense-row-wide">
                    <label for=${fieldId('repo')}>${t('settings.developer.repoUrl')}</label>
                    <input id=${fieldId('repo')} type="text" value=${addonsRepoUrl}
                        onInput=${e => { const v = e.target.value; setAddonsRepoUrl(v); setString('piclaw_addons_repo_url', v); }}
                        placeholder="https://github.com/.../piclaw-addons.git" />
                </div>
                <p class="settings-hint" style="margin-top:0">${t('settings.developer.repoHintPre')} <code>bun add</code> ${t('settings.developer.repoHintPost')}</p>

                <h3 style="margin-top:16px">${t('settings.developer.debug')}</h3>
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label for=${fieldId('log-sse')}>${t('settings.developer.logSse')}</label>
                    <input id=${fieldId('log-sse')} type="checkbox" checked=${debugSse}
                        onChange=${() => { const v = !debugSse; setDebugSse(v); setBool('piclaw_debug_sse', v); }} />
                </div>
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label for=${fieldId('log-tools')}>${t('settings.developer.logToolCalls')}</label>
                    <input id=${fieldId('log-tools')} type="checkbox" checked=${debugToolCalls}
                        onChange=${() => { const v = !debugToolCalls; setDebugToolCalls(v); setBool('piclaw_debug_tool_calls', v); }} />
                </div>
                <p class="settings-hint">${t('settings.developer.debugHint')}</p>
            `}
        </div>
    `;
}


registerSettingsPane({
    id: 'developer',
    label: 'Developer',
    icon: iconDeveloperPane,
    component: DeveloperSettingsSection,
    order: 900,
});
