import { html, useState, useCallback } from '../../vendor/preact-htm.js';
import { sendAgentMessage } from '../../api.js';
import { t, useTranslation } from '../../utils/i18n.js';

function formatAuthTypeLabel(authType) {
    switch (authType) {
        case 'oauth': return 'OAuth';
        case 'api_key': return t('settings.providers.authApiKey');
        case 'custom': return t('settings.providers.authConfigured');
        default: return t('settings.providers.authConfigured');
    }
}

export function ProvidersSection({ providers, setStatus }) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(null);
    const [expandedProvider, setExpandedProvider] = useState(null);
    const [formData, setFormData] = useState({});

    const updateForm = useCallback((key, value) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    }, []);

    const setupApiKey = useCallback(async (providerId) => {
        const apiKey = (formData.apiKey || '').trim();
        if (!apiKey) { setStatus?.(t('settings.providers.apiKeyEmpty'), 'error'); return; }
        setBusy(providerId);
        setStatus?.(t('settings.providers.configuringToast', { provider: providerId }), 'info');
        try {
            // Use the login step2 protocol: /login __step2 {"provider":"...","method":"api_key","api_key":"..."}
            const payload = JSON.stringify({ provider: providerId, method: 'api_key', api_key: apiKey });
            const resp = await sendAgentMessage('default', `/login __step2 ${payload}`, null, []);
            if (resp?.command?.status === 'error') { setStatus?.(resp.command.message, 'error'); return; }
            setStatus?.(resp?.command?.message || t('settings.providers.configured', { provider: providerId }), 'success');
            setExpandedProvider(null);
            setFormData({});
        } catch (e) { setStatus?.(String(e.message || e), 'error'); }
        finally { setBusy(null); }
    }, [formData, setStatus]);

    const setupCustom = useCallback(async (providerId, def) => {
        setBusy(providerId);
        setStatus?.(t('settings.providers.configuringToast', { provider: providerId }), 'info');
        try {
            const data = { provider: providerId, method: 'custom' };
            for (const f of (def.customFields || [])) {
                data[f.key] = (formData[f.key] || '').trim();
            }
            const payload = JSON.stringify(data);
            const resp = await sendAgentMessage('default', `/login __step2 ${payload}`, null, []);
            if (resp?.command?.status === 'error') { setStatus?.(resp.command.message, 'error'); return; }
            setStatus?.(resp?.command?.message || t('settings.providers.configured', { provider: providerId }), 'success');
            setExpandedProvider(null);
            setFormData({});
        } catch (e) { setStatus?.(String(e.message || e), 'error'); }
        finally { setBusy(null); }
    }, [formData, setStatus]);

    const startOAuth = useCallback(async (providerId) => {
        setBusy(providerId);
        setStatus?.(t('settings.providers.startingOAuth', { provider: providerId }), 'info');
        try {
            const payload = JSON.stringify({ provider: providerId });
            const resp = await sendAgentMessage('default', `/login __step1 ${payload}`, null, []);
            const msg = resp?.command?.message || '';
            if (msg.includes('http')) {
                // Extract URL from message
                const urlMatch = msg.match(/(https?:\/\/[^\s)]+)/);
                if (urlMatch) {
                    window.open(urlMatch[1], '_blank', 'noopener');
                    setStatus?.(t('settings.providers.oauthOpened'), 'success');
                } else {
                    setStatus?.(msg, 'success');
                }
            } else {
                setStatus?.(msg || t('settings.providers.oauthStarted', { provider: providerId }), 'success');
            }
        } catch (e) { setStatus?.(String(e.message || e), 'error'); }
        finally { setBusy(null); }
    }, [setStatus]);

    const logout = useCallback(async (providerId) => {
        if (busy) return;
        setBusy(providerId);
        setStatus?.(t('settings.providers.loggingOut', { provider: providerId }), 'info');
        try {
            await sendAgentMessage('default', `/logout ${providerId}`, null, []);
            setStatus?.(t('settings.providers.loggedOut', { provider: providerId }), 'success');
        } catch (e) { setStatus?.(String(e.message || e), 'error'); }
        finally { setBusy(null); }
    }, [busy, setStatus]);

    const list = providers || [];
    const isExpanded = (id) => expandedProvider === id;
    const toggle = (id) => { setExpandedProvider(prev => prev === id ? null : id); setFormData({}); };

    return html`
        <div class="settings-section">
            <h3>${t('settings.providers.heading')}</h3>
            <div class="settings-provider-list">
                ${list.map(p => html`
                    <div class=${`settings-provider-card${p.configured ? ' configured' : ''}`}>
                        <div class="settings-provider-card-header" onClick=${() => !p.configured && toggle(p.id)}>
                            <div class="settings-provider-card-title">
                                <strong>${p.name}</strong>
                                <span class="settings-provider-id">${p.id}</span>
                                ${p.configured && html`<span class="settings-tag settings-tag-skill">${formatAuthTypeLabel(p.authType)}</span>`}
                            </div>
                            <div class="settings-provider-card-meta">
                                ${!p.configured && p.hasOAuth && html`<span class="settings-tag">OAuth</span>`}
                                ${!p.configured && p.hasApiKey && html`<span class="settings-tag">API Key</span>`}
                                ${p.isCustom && html`<span class="settings-tag">${t('settings.providers.tagCustom')}</span>`}
                            </div>
                            <div class="settings-provider-card-actions">
                                ${p.configured ? html`
                                    <button class="settings-addon-btn settings-addon-btn-remove"
                                        disabled=${busy === p.id} onClick=${(e) => { e.stopPropagation(); logout(p.id); }}
                                    >${busy === p.id ? '…' : t('settings.providers.logout')}</button>
                                    <button class="settings-addon-btn"
                                        disabled=${busy === p.id} onClick=${(e) => { e.stopPropagation(); toggle(p.id); }}
                                    >${t('settings.providers.reconfigure')}</button>
                                ` : html`
                                    <button class="settings-addon-btn settings-addon-btn-install"
                                        disabled=${busy === p.id} onClick=${(e) => { e.stopPropagation(); toggle(p.id); }}
                                    >${t('settings.providers.setUp')}</button>
                                `}
                            </div>
                        </div>

                        ${isExpanded(p.id) && html`
                            <div class="settings-provider-setup">
                                <p class="settings-hint settings-provider-setup-hint">${t('settings.providers.setupHint')}</p>
                                ${p.hasOAuth && html`
                                    <div class="settings-provider-method">
                                        <button class="settings-addon-btn settings-addon-btn-install"
                                            disabled=${busy === p.id}
                                            onClick=${() => startOAuth(p.id)}>
                                            ${busy === p.id ? t('settings.providers.starting') : t('settings.providers.signInOAuth')}
                                        </button>
                                    </div>
                                `}
                                ${p.hasApiKey && html`
                                    <div class="settings-provider-method">
                                        <div class="settings-provider-field-row">
                                            <label>${t('settings.providers.apiKeyLabel')}</label>
                                            <input type="password" value=${formData.apiKey || ''}
                                                onInput=${e => updateForm('apiKey', e.target.value)}
                                                placeholder=${p.apiKeyHint || t('settings.providers.apiKeyPlaceholder')} />
                                            <button class="settings-addon-btn settings-addon-btn-install"
                                                disabled=${busy === p.id || !(formData.apiKey || '').trim()}
                                                onClick=${() => setupApiKey(p.id)}>
                                                ${busy === p.id ? '…' : t('settings.providers.save')}
                                            </button>
                                        </div>
                                    </div>
                                `}
                                ${p.isCustom && html`
                                    <div class="settings-provider-method">
                                        ${(p.customFields || []).map(f => html`
                                            <div class="settings-provider-field-row">
                                                <label>${f.label}${f.required ? ' *' : ''}</label>
                                                <input type="text" value=${formData[f.key] || ''}
                                                    onInput=${e => updateForm(f.key, e.target.value)}
                                                    placeholder=${f.placeholder || ''} />
                                            </div>
                                        `)}
                                        <div class="settings-provider-form-actions">
                                            <button class="settings-addon-btn settings-addon-btn-install"
                                                disabled=${busy === p.id}
                                                onClick=${() => setupCustom(p.id, p)}>
                                                ${busy === p.id ? t('settings.providers.configuring') : t('settings.providers.saveConfig')}
                                            </button>
                                        </div>
                                    </div>
                                `}
                            </div>
                        `}
                    </div>
                `)}
            </div>
        </div>
    `;
}
