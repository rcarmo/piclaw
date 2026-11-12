import { html, useState, useEffect, useCallback } from '../../vendor/preact-htm.js';
import { useTranslation } from '../../utils/i18n.js';

export function AddonsSection({ setStatus, filter = '' }) {
    const { t: tr } = useTranslation();
    const [addons, setAddons] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(null);
    const [restartRequired, setRestartRequired] = useState(false);
    const [platformInfo, setPlatformInfo] = useState({ runtime: '', windowsNative: false });
    const [catalogSources, setCatalogSources] = useState([]);
    const [failedSources, setFailedSources] = useState([]);

    // Read developer overrides from localStorage
    function devParams() {
        const params = new URLSearchParams();
        try {
            const primaryCatalogUrl = (localStorage.getItem('piclaw_addons_catalog_url') || '').trim();
            const additionalCatalogUrls = (localStorage.getItem('piclaw_addons_catalog_urls') || '')
                .split(/\r?\n/)
                .map(v => v.trim())
                .filter(Boolean);
            const ru = localStorage.getItem('piclaw_addons_repo_url');
            // All custom URLs are sent as catalog_url params; the server always
            // includes the default catalog and merges these on top.
            if (primaryCatalogUrl) params.append('catalog_url', primaryCatalogUrl);
            for (const extraUrl of additionalCatalogUrls) params.append('catalog_url', extraUrl);
            if (ru) params.set('repo_url', ru);
        } catch (e) { void e; }
        const qs = params.toString();
        return qs ? `?${qs}` : '';
    }

    const loadAddons = useCallback(async () => {
        try {
            const [addonsResp, settingsResp] = await Promise.all([
                fetch(`/agent/addons${devParams()}`),
                fetch('/agent/settings-data'),
            ]);
            const data = await addonsResp.json();
            if (data.error) throw new Error(data.error);
            setAddons(data.addons || []);
            setCatalogSources(data.sources || []);
            setFailedSources(data.failed_sources || []);

            const settingsData = await settingsResp.json().catch(() => ({}));
            const runtimePlatform = typeof settingsData?.runtimePlatform === 'string' ? settingsData.runtimePlatform : '';
            setPlatformInfo({
                runtime: runtimePlatform,
                windowsNative: runtimePlatform === 'win32',
            });
        } catch (e) { setAddons(null); setStatus?.(String(e.message || e), 'error'); }
        finally { setLoading(false); }
    }, [setStatus]);
    useEffect(() => { loadAddons(); }, []);

    const installAddon = useCallback(async (slug) => {
        if (busy) return;
        setBusy({ slug, action: 'install' });
        setStatus?.(tr('settings.addons.installing', { slug }), 'info');
        try {
            const resp = await fetch(`/agent/addons/install${devParams()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data || data.error) {
                setStatus?.(typeof data?.error === "string" && data.error.trim() ? data.error : "Couldn't install add-on (HTTP " + resp.status + "). Check its installed state before trying again.", 'error'); return;
            }
            setRestartRequired(true);
            const summary = [data.message, data.warning].filter(Boolean).join(' ');
            setStatus?.(summary || tr('settings.addons.installedToast'), 'success'); await loadAddons();
        } catch (e) { setStatus?.("Connection lost while installing the add-on. Check its installed state before trying again.", 'error'); }
        finally { setBusy(null); }
    }, [busy, loadAddons, setStatus]);

    const uninstallAddon = useCallback(async (slug) => {
        if (busy) return;
        setBusy({ slug, action: 'remove' });
        setStatus?.(tr('settings.addons.removing', { slug }), 'info');
        try {
            const resp = await fetch(`/agent/addons/uninstall${devParams()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) });
            const data = await resp.json().catch(() => null);
            if (!resp.ok || !data || data.error) {
                setStatus?.(typeof data?.error === "string" && data.error.trim() ? data.error : "Couldn't remove add-on (HTTP " + resp.status + "). Check its installed state before trying again.", 'error'); return;
            }
            setRestartRequired(true);
            const summary = [data.message, data.warning].filter(Boolean).join(' ');
            setStatus?.(summary || tr('settings.addons.removedToast'), 'success'); await loadAddons();
        } catch (e) { setStatus?.("Connection lost while removing the add-on. Check its installed state before trying again.", 'error'); }
        finally { setBusy(null); }
    }, [busy, loadAddons, setStatus]);

    const restartRuntime = useCallback(async () => {
        if (busy) return;
        setBusy({ slug: null, action: 'restart' });
        setStatus?.(tr('settings.addons.restarting'), 'info');
        try {
            const resp = await fetch('/agent/addons/restart', { method: 'POST' });
            const data = await resp.json();
            if (data.error) { setStatus?.(data.error, 'error'); setBusy(null); return; }
            setStatus?.(data.message || tr('settings.addons.restarting'), 'success');
            setRestartRequired(false);
            // Poll until backend is back, then refresh the addon list
            const pollUntilReady = async (maxAttempts = 30, intervalMs = 2000) => {
                for (let i = 0; i < maxAttempts; i++) {
                    await new Promise(r => setTimeout(r, intervalMs));
                    try {
                        const probe = await fetch('/agent/addons', { signal: AbortSignal.timeout(3000) });
                        if (probe.ok) {
                            await loadAddons();
                            setBusy(null);
                            setStatus?.(tr('settings.addons.restartComplete'), 'success');
                            return;
                        }
                    } catch (e) { void e; /* backend not ready yet */ }
                }
                setBusy(null);
                setStatus?.(tr('settings.addons.restartTimeout'), 'warning');
            };
            void pollUntilReady();
        } catch (e) {
            setStatus?.(String(e.message || e), 'error');
            setBusy(null);
        }
    }, [busy, setStatus, loadAddons]);

    if (loading) return html`<div class="settings-loading">${tr('settings.addons.fetching')}</div>`;
    if (!addons) return html`<div class="settings-section"><p class="settings-hint">${tr('settings.addons.loadFailed')}</p></div>`;

    const lf = filter.toLowerCase();
    const filtered = lf ? addons.filter(a => a.slug.toLowerCase().includes(lf) || (a.description || '').toLowerCase().includes(lf) || (a.tags || []).some(t => t.toLowerCase().includes(lf))) : addons;
    const busySlug = busy?.slug || null;
    const busyLabel = busy
        ? (busy.action === 'remove'
            ? tr('settings.addons.removing', { slug: busy.slug })
            : busy.action === 'restart'
                ? tr('settings.addons.restarting')
                : tr('settings.addons.installing', { slug: busy.slug }))
        : '';

    return html`
        <div class=${`settings-section settings-addon-panel${busy ? ' busy' : ''}`} aria-busy=${busy ? 'true' : 'false'}>
            <div class="settings-addon-toolbar">
                <div>
                    <p class="settings-hint">
                        ${catalogSources.length <= 1
                            ? html`${tr('settings.addons.catalogFromPre')} <a href="https://github.com/rcarmo/piclaw-addons" target="_blank">rcarmo/piclaw-addons</a>.`
                            : html`${tr('settings.addons.catalogMerged', { count: catalogSources.length })}`}
                        ${' '}${tr('settings.addons.installNote')}
                    </p>
                    ${failedSources.length > 0 && html`
                        <div class="settings-addon-error" role="alert">
                            ${failedSources.length > 1
                                ? tr('settings.addons.failedFetchPlural', { count: failedSources.length })
                                : tr('settings.addons.failedFetchSingular', { count: failedSources.length })}
                            ${failedSources.map(u => html` <code style="font-size:0.82em;word-break:break-all">${u}</code>`)}
                        </div>
                    `}
                    ${catalogSources.length > 1 && html`
                        <details class="settings-hint" style="margin-top:4px">
                            <summary style="cursor:pointer">${tr('settings.addons.activeSources', { count: catalogSources.length })}</summary>
                            <ul style="margin:4px 0 0 16px;font-size:0.82em">
                                ${catalogSources.map(u => html`<li style="word-break:break-all"><code>${u}</code></li>`)}
                            </ul>
                        </details>
                    `}
                    ${platformInfo.windowsNative && html`
                        <div class="settings-addon-error" role="alert">
                            ${tr('settings.addons.windowsWarning')}
                        </div>
                    `}
                </div>
            </div>
            <div class="settings-addon-list">
                ${busy && html`
                    <div class="settings-addon-panel-overlay" role="status" aria-live="polite" aria-label=${busyLabel}>
                        <div class="settings-addon-panel-overlay-card">
                            <div class="settings-spinner"></div>
                            <span>${busyLabel}</span>
                        </div>
                    </div>
                `}
                ${filtered.map(a => {
                    const hasSkills = (a.skills || []).length > 0;
                    const isExtension = a.type === 'extension';
                    const isCore = (a.tags || []).some(tag => String(tag).toLowerCase() === 'core');
                    const typeLabel = hasSkills && isExtension ? tr('settings.addons.typeExtSkill') : hasSkills ? tr('settings.addons.typeSkill') : tr('settings.addons.typeExt');
                    const typeCls = hasSkills && !isExtension ? 'settings-tag-skill' : '';
                    const homepage = typeof a.homepage === 'string' && a.homepage.trim() ? a.homepage.trim() : '';
                    return html`
                    <div class=${`settings-addon-card${a.installed ? ' installed' : ''}${isCore ? ' core' : ''}`}>
                        ${isCore && html`
                            <span class="settings-addon-core-bookmark" role="img" aria-label="Core add-on" title="Core add-on — recommended for most Piclaw installations">
                                <svg viewBox="0 0 28 38" width="28" height="38" aria-hidden="true" focusable="false">
                                    <path d="M0 0h28v38L14 29 0 38Z" fill="currentColor"></path>
                                    <path d="M0 0h28v3H0Z" class="settings-addon-core-bookmark-highlight"></path>
                                    <path d="m14 7 1.9 3.85 4.25.62-3.08 3 0.73 4.22L14 16.7l-3.8 1.99.73-4.22-3.08-3 4.25-.62Z" fill="#fff"></path>
                                </svg>
                            </span>
                        `}
                        <div class="settings-addon-card-header">
                            ${homepage
                                ? html`<a class="settings-addon-name-link" href=${homepage} target="_blank" rel="noopener noreferrer">${a.slug}</a>`
                                : html`<strong>${a.slug}</strong>`}
                            <span class=${`settings-tag settings-tag-type ${typeCls}`}>${typeLabel}</span>
                            <span class="settings-addon-version">${a.installed ? (a.installedVersion || '?') : (a.version || '')}</span>
                            ${a.installKind && html`<span class="settings-tag">${a.installKind}</span>`}
                            ${a.hasUpdate && html`<span class="settings-tag settings-tag-skill">\u2191 ${a.version}</span>`}
                            <div class="settings-addon-actions">
                                ${a.installed ? html`
                                    ${a.hasUpdate && html`<button class="settings-addon-btn settings-addon-btn-upgrade" disabled=${Boolean(busy)} onClick=${() => installAddon(a.slug)}>${busySlug === a.slug ? '\u2026' : tr('settings.addons.update')}</button>`}
                                    <button class="settings-addon-btn settings-addon-btn-remove" disabled=${Boolean(busy)} onClick=${() => uninstallAddon(a.slug)}>${busySlug === a.slug ? '\u2026' : tr('settings.addons.remove')}</button>
                                ` : html`
                                    <button class="settings-addon-btn settings-addon-btn-install" disabled=${Boolean(busy)} onClick=${() => installAddon(a.slug)}>${busySlug === a.slug ? '\u2026' : tr('settings.addons.install')}</button>
                                `}
                            </div>
                        </div>
                        <div class="settings-addon-card-body">${a.description}</div>
                        <div class="settings-addon-card-footer">
                            <div class="settings-addon-tags">${(a.tags || []).map(t => html`<span class="settings-tag">${t}</span>`)}${(a.skills || []).map(s => html`<span class="settings-tag settings-tag-skill">\ud83d\udcdd ${s}</span>`)}</div>
                        </div>
                    </div>
                `; })}
                ${filtered.length === 0 && html`<p class="settings-hint">${tr('settings.addons.noMatch', { filter })}</p>`}
            </div>
            ${restartRequired && html`
                <div class="settings-addon-restart-notice" role="status" aria-live="polite">
                    <span>${tr('settings.addons.restartNotice')}</span>
                    <button class="settings-addon-btn settings-addon-btn-restart-now" type="button" disabled=${Boolean(busy)} onClick=${restartRuntime}>${tr('settings.addons.restartNow')}</button>
                </div>
            `}
        </div>
    `;
}
