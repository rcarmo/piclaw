// @ts-nocheck
import { html, useState, useCallback } from '../../vendor/preact-htm.js';
import { sendAgentMessage } from '../../api.js';

export function ProvidersSection({ providers, setStatus }) {
    const [busy, setBusy] = useState(null);
    const [expandedProvider, setExpandedProvider] = useState(null);
    const [formData, setFormData] = useState({});

    const updateForm = useCallback((key, value) => {
        setFormData(prev => ({ ...prev, [key]: value }));
    }, []);

    const setupApiKey = useCallback(async (providerId) => {
        const apiKey = (formData.apiKey || '').trim();
        if (!apiKey) { setStatus?.('API key cannot be empty.', 'error'); return; }
        setBusy(providerId);
        setStatus?.(`Configuring ${providerId}…`, 'info');
        try {
            // Use the login step2 protocol: /login __step2 {"provider":"...","method":"api_key","api_key":"..."}
            const payload = JSON.stringify({ provider: providerId, method: 'api_key', api_key: apiKey });
            const resp = await sendAgentMessage('default', `/login __step2 ${payload}`, null, []);
            if (resp?.command?.status === 'error') { setStatus?.(resp.command.message, 'error'); return; }
            setStatus?.(resp?.command?.message || `${providerId} configured.`, 'success');
            setExpandedProvider(null);
            setFormData({});
        } catch (e) { setStatus?.(String(e.message || e), 'error'); }
        finally { setBusy(null); }
    }, [formData, setStatus]);

    const setupCustom = useCallback(async (providerId, def) => {
        setBusy(providerId);
        setStatus?.(`Configuring ${providerId}…`, 'info');
        try {
            const data = { provider: providerId, method: 'custom' };
            for (const f of (def.customFields || [])) {
                data[f.key] = (formData[f.key] || '').trim();
            }
            const payload = JSON.stringify(data);
            const resp = await sendAgentMessage('default', `/login __step2 ${payload}`, null, []);
            if (resp?.command?.status === 'error') { setStatus?.(resp.command.message, 'error'); return; }
            setStatus?.(resp?.command?.message || `${providerId} configured.`, 'success');
            setExpandedProvider(null);
            setFormData({});
        } catch (e) { setStatus?.(String(e.message || e), 'error'); }
        finally { setBusy(null); }
    }, [formData, setStatus]);

    const startOAuth = useCallback(async (providerId) => {
        setBusy(providerId);
        setStatus?.(`Starting OAuth for ${providerId}…`, 'info');
        try {
            const payload = JSON.stringify({ provider: providerId });
            const resp = await sendAgentMessage('default', `/login __step1 ${payload}`, null, []);
            const msg = resp?.command?.message || '';
            if (msg.includes('http')) {
                // Extract URL from message
                const urlMatch = msg.match(/(https?:\/\/[^\s)]+)/);
                if (urlMatch) {
                    window.open(urlMatch[1], '_blank', 'noopener');
                    setStatus?.('OAuth window opened. Complete the sign-in flow, then close this message.', 'success');
                } else {
                    setStatus?.(msg, 'success');
                }
            } else {
                setStatus?.(msg || `OAuth flow started for ${providerId}. Check the chat.`, 'success');
            }
        } catch (e) { setStatus?.(String(e.message || e), 'error'); }
        finally { setBusy(null); }
    }, [setStatus]);

    const logout = useCallback(async (providerId) => {
        if (busy) return;
        setBusy(providerId);
        setStatus?.(`Logging out ${providerId}…`, 'info');
        try {
            await sendAgentMessage('default', `/logout ${providerId}`, null, []);
            setStatus?.(`Logged out ${providerId}. Restart may be needed.`, 'success');
        } catch (e) { setStatus?.(String(e.message || e), 'error'); }
        finally { setBusy(null); }
    }, [busy, setStatus]);

    const list = providers || [];
    const isExpanded = (id) => expandedProvider === id;
    const toggle = (id) => { setExpandedProvider(prev => prev === id ? null : id); setFormData({}); };

    return html`
        <div class="settings-section">
            <h3>Providers</h3>
            <div class="settings-provider-list">
                ${list.map(p => html`
                    <div class=${`settings-provider-card${p.configured ? ' configured' : ''}`}>
                        <div class="settings-provider-card-header" onClick=${() => !p.configured && toggle(p.id)}>
                            <strong>${p.name}</strong>
                            <span class="settings-provider-id">${p.id}</span>
                            ${p.configured && html`<span class="settings-tag settings-tag-skill">${p.authType || 'configured'}</span>`}
                            <div class="settings-provider-card-meta">
                                ${p.hasOAuth && html`<span class="settings-tag">OAuth</span>`}
                                ${p.hasApiKey && html`<span class="settings-tag">API Key</span>`}
                                ${p.isCustom && html`<span class="settings-tag">Custom</span>`}
                            </div>
                            <div class="settings-provider-card-actions">
                                ${p.configured ? html`
                                    <button class="settings-addon-btn settings-addon-btn-remove"
                                        disabled=${busy === p.id} onClick=${(e) => { e.stopPropagation(); logout(p.id); }}
                                    >${busy === p.id ? '…' : 'Logout'}</button>
                                    <button class="settings-addon-btn"
                                        disabled=${busy === p.id} onClick=${(e) => { e.stopPropagation(); toggle(p.id); }}
                                    >Reconfigure</button>
                                ` : html`
                                    <button class="settings-addon-btn settings-addon-btn-install"
                                        disabled=${busy === p.id} onClick=${(e) => { e.stopPropagation(); toggle(p.id); }}
                                    >Set up</button>
                                `}
                            </div>
                        </div>

                        ${isExpanded(p.id) && html`
                            <div class="settings-provider-setup">
                                ${p.hasOAuth && html`
                                    <div class="settings-provider-method">
                                        <button class="settings-addon-btn settings-addon-btn-install"
                                            disabled=${busy === p.id}
                                            onClick=${() => startOAuth(p.id)}>
                                            ${busy === p.id ? 'Starting…' : 'Sign in with OAuth'}
                                        </button>
                                    </div>
                                `}
                                ${p.hasApiKey && html`
                                    <div class="settings-provider-method">
                                        <div class="settings-row" style="margin-bottom:6px">
                                            <label>API Key</label>
                                            <input type="password" value=${formData.apiKey || ''}
                                                onInput=${e => updateForm('apiKey', e.target.value)}
                                                placeholder=${p.apiKeyHint || 'Enter API key'} />
                                            <button class="settings-addon-btn settings-addon-btn-install"
                                                disabled=${busy === p.id || !(formData.apiKey || '').trim()}
                                                onClick=${() => setupApiKey(p.id)}>
                                                ${busy === p.id ? '…' : 'Save'}
                                            </button>
                                        </div>
                                    </div>
                                `}
                                ${p.isCustom && html`
                                    <div class="settings-provider-method">
                                        ${(p.customFields || []).map(f => html`
                                            <div class="settings-row" style="margin-bottom:6px">
                                                <label>${f.label}${f.required ? ' *' : ''}</label>
                                                <input type="text" value=${formData[f.key] || ''}
                                                    onInput=${e => updateForm(f.key, e.target.value)}
                                                    placeholder=${f.placeholder || ''} />
                                            </div>
                                        `)}
                                        <button class="settings-addon-btn settings-addon-btn-install"
                                            disabled=${busy === p.id}
                                            onClick=${() => setupCustom(p.id, p)}>
                                            ${busy === p.id ? 'Configuring…' : 'Save configuration'}
                                        </button>
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
