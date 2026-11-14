import { html, useCallback, useEffect, useMemo, useState } from '../../vendor/preact-htm.js';
import { getEnvironmentSettings, saveEnvironmentOverride } from '../../api.js';
import { useTranslation } from '../../utils/i18n.js';

function normalizeEnvironmentSettings(data: Record<string, any> = {}) {
    const environment = data.environmentSettings || data.settings || data.environment || {};
    return {
        variables: Array.isArray(environment.variables) ? environment.variables : [],
        overrides: environment.overrides && typeof environment.overrides === 'object' ? environment.overrides : {},
        count: Number(environment.count || 0),
        overrideCount: Number(environment.overrideCount || 0),
        keychainEnvNames: Array.isArray(environment.keychainEnvNames) ? environment.keychainEnvNames : [],
    };
}

export function EnvironmentSection({ settingsData, filter = '', setStatus, mergeSettingsData }) {
    const { t } = useTranslation();
    const [environment, setEnvironment] = useState(() => normalizeEnvironmentSettings(settingsData || {}));
    const [drafts, setDrafts] = useState({});
    const [newName, setNewName] = useState('');
    const [newValue, setNewValue] = useState('');
    const [savingName, setSavingName] = useState(null);

    useEffect(() => {
        setEnvironment(normalizeEnvironmentSettings(settingsData || {}));
        setDrafts({});
    }, [settingsData]);

    const applyPayload = useCallback((payload) => {
        const next = normalizeEnvironmentSettings({ environmentSettings: payload?.settings || payload });
        setEnvironment(next);
        mergeSettingsData?.({ environmentSettings: next });
        setDrafts({});
        return next;
    }, [mergeSettingsData]);

    const refresh = useCallback(async () => {
        try {
            const payload = await getEnvironmentSettings();
            if (payload?.ok) applyPayload(payload.settings);
            setStatus?.(t('settings.environment.refreshedToast'), 'info');
        } catch (error) {
            setStatus?.(String(error?.message || error), 'error');
        }
    }, [applyPayload, setStatus]);

    const saveOverride = useCallback(async (name, value) => {
        const normalizedName = String(name || '').trim();
        if (!normalizedName) return;
        setSavingName(normalizedName);
        try {
            const payload = await saveEnvironmentOverride({ action: 'set', name: normalizedName, value: String(value ?? '') });
            if (payload?.ok) applyPayload(payload.settings);
            setStatus?.(t('settings.environment.savedToast', { name: normalizedName }), 'info');
            if (normalizedName === newName.trim()) {
                setNewName('');
                setNewValue('');
            }
        } catch (error) {
            setStatus?.(String(error?.message || error), 'error');
        } finally {
            setSavingName(null);
        }
    }, [applyPayload, newName, setStatus]);

    const clearOverride = useCallback(async (name) => {
        const normalizedName = String(name || '').trim();
        if (!normalizedName) return;
        setSavingName(normalizedName);
        try {
            const payload = await saveEnvironmentOverride({ action: 'clear', name: normalizedName });
            if (payload?.ok) applyPayload(payload.settings);
            setStatus?.(t('settings.environment.clearedToast', { name: normalizedName }), 'info');
        } catch (error) {
            setStatus?.(String(error?.message || error), 'error');
        } finally {
            setSavingName(null);
        }
    }, [applyPayload, setStatus]);

    const filteredVariables = useMemo(() => {
        const q = String(filter || '').trim().toLowerCase();
        const rows = Array.isArray(environment.variables) ? environment.variables : [];
        if (!q) return rows;
        return rows.filter((row) => {
            const haystack = `${row?.name || ''} ${row?.value || ''} ${row?.source || ''}`.toLowerCase();
            return haystack.includes(q);
        });
    }, [environment.variables, filter]);

    const setDraft = useCallback((name, value) => {
        setDrafts(prev => ({ ...(prev || {}), [name]: value }));
    }, []);

    return html`
        <div class="settings-section">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:12px;">
                <div>
                    <h3 style="margin-top:0">${t('settings.environment.heading')}</h3>
                    <p class="settings-hint" style="margin-top:4px">
                        ${t('settings.environment.introPre')} <code>process.env</code>${t('settings.environment.introPost')}
                    </p>
                </div>
                <button type="button" class="settings-secondary-btn" onClick=${refresh}>${t('settings.environment.refresh')}</button>
            </div>

            <div class="settings-row" style="align-items:flex-start; gap:10px;">
                <label>${t('settings.environment.addOverride')}</label>
                <div class="settings-env-add">
                    <input
                        type="text"
                        value=${newName}
                        placeholder="VARIABLE_NAME"
                        spellcheck="false"
                        onInput=${e => setNewName(e.target.value)}
                    />
                    <input
                        type="text"
                        value=${newValue}
                        placeholder=${t('settings.environment.valuePlaceholder')}
                        spellcheck="false"
                        onInput=${e => setNewValue(e.target.value)}
                    />
                    <button
                        type="button"
                        disabled=${!newName.trim() || savingName === newName.trim()}
                        onClick=${() => saveOverride(newName, newValue)}
                    >${t('settings.environment.save')}</button>
                </div>
            </div>

            <p class="settings-hint">
                ${t('settings.environment.countLine', { count: environment.count, overrides: environment.overrideCount, keychain: environment.keychainEnvNames.length })}
            </p>

            <div class="settings-tool-list" style="max-height:58vh; overflow:auto;">
                ${filteredVariables.map(row => {
                    const name = String(row?.name || '');
                    const draft = Object.prototype.hasOwnProperty.call(drafts, name) ? drafts[name] : row.value;
                    const dirty = draft !== row.value;
                    const saving = savingName === name;
                    return html`
                        <div class="settings-tool-row settings-env-row" key=${name}>
                            <span class="settings-tool-name" title=${name}>${name}</span>
                            <input
                                type="text"
                                value=${draft}
                                spellcheck="false"
                                onInput=${e => setDraft(name, e.target.value)}
                                style="min-width:0; width:100%; font-family:var(--font-mono, monospace);"
                            />
                            <span class="settings-tool-kind" title=${row.overridden ? t('settings.environment.overridden') : t('settings.environment.inherited')}>
                                ${row.overridden ? t('settings.environment.kindOverride') : t('settings.environment.kindProcess')}
                            </span>
                            <span style="display:flex; gap:6px; justify-content:flex-end;">
                                <button type="button" disabled=${saving || !dirty} onClick=${() => saveOverride(name, draft)}>${t('settings.environment.save')}</button>
                                <button type="button" disabled=${saving || !row.overridden} onClick=${() => clearOverride(name)}>${t('settings.environment.clear')}</button>
                            </span>
                        </div>
                    `;
                })}
                ${filteredVariables.length === 0 && html`<p class="settings-hint">${String(filter || '').trim() ? t('settings.environment.noMatch', { filter }) : t('settings.environment.empty')}</p>`}
            </div>
        </div>
    `;
}
