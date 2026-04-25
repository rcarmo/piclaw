// @ts-nocheck
import { html, useState, useEffect, useCallback } from '../../vendor/preact-htm.js';

export function AddonsSection({ setStatus, filter = '' }) {
    const [addons, setAddons] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(null);
    const [restartRequired, setRestartRequired] = useState(false);

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
            if (primaryCatalogUrl) params.append('catalog_url', primaryCatalogUrl);
            for (const extraUrl of additionalCatalogUrls) params.append('catalog_url', extraUrl);
            if (ru) params.set('repo_url', ru);
        } catch (e) { void e; }
        const qs = params.toString();
        return qs ? `?${qs}` : '';
    }

    const loadAddons = useCallback(async () => {
        try {
            const resp = await fetch(`/agent/addons${devParams()}`);
            const data = await resp.json();
            if (data.error) throw new Error(data.error);
            setAddons(data.addons || []);
        } catch (e) { setAddons(null); setStatus?.(String(e.message || e), 'error'); }
        finally { setLoading(false); }
    }, [setStatus]);
    useEffect(() => { loadAddons(); }, []);

    const installAddon = useCallback(async (slug) => {
        if (busy) return;
        setBusy({ slug, action: 'install' });
        setStatus?.(`Installing ${slug}\u2026`, 'info');
        try {
            const resp = await fetch(`/agent/addons/install${devParams()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) });
            const data = await resp.json();
            if (data.error) { setStatus?.(data.error, 'error'); return; }
            setRestartRequired(true);
            setStatus?.(data.message, 'success'); await loadAddons();
        } catch (e) { setStatus?.(String(e.message || e), 'error'); }
        finally { setBusy(null); }
    }, [busy, loadAddons, setStatus]);

    const uninstallAddon = useCallback(async (slug) => {
        if (busy) return;
        setBusy({ slug, action: 'remove' });
        setStatus?.(`Removing ${slug}\u2026`, 'info');
        try {
            const resp = await fetch(`/agent/addons/uninstall${devParams()}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) });
            const data = await resp.json();
            if (data.error) { setStatus?.(data.error, 'error'); return; }
            setRestartRequired(true);
            setStatus?.(data.message, 'success'); await loadAddons();
        } catch (e) { setStatus?.(String(e.message || e), 'error'); }
        finally { setBusy(null); }
    }, [busy, loadAddons, setStatus]);

    const restartRuntime = useCallback(async () => {
        if (busy) return;
        setBusy({ slug: null, action: 'restart' });
        setStatus?.('Restarting piclaw\u2026', 'info');
        try {
            const resp = await fetch('/agent/addons/restart', { method: 'POST' });
            const data = await resp.json();
            if (data.error) { setStatus?.(data.error, 'error'); setBusy(null); return; }
            setStatus?.(data.message || 'Restarting piclaw\u2026', 'success');
        } catch (e) {
            setStatus?.(String(e.message || e), 'error');
            setBusy(null);
        }
    }, [busy, setStatus]);

    if (loading) return html`<div class="settings-loading">Fetching add-ons\u2026</div>`;
    if (!addons) return html`<div class="settings-section"><p class="settings-hint">Could not load add-ons.</p></div>`;

    const lf = filter.toLowerCase();
    const filtered = lf ? addons.filter(a => a.slug.toLowerCase().includes(lf) || (a.description || '').toLowerCase().includes(lf) || (a.tags || []).some(t => t.toLowerCase().includes(lf))) : addons;
    const busySlug = busy?.slug || null;
    const busyLabel = busy
        ? (busy.action === 'remove'
            ? `Removing ${busy.slug}\u2026`
            : busy.action === 'restart'
                ? 'Restarting piclaw\u2026'
                : `Installing ${busy.slug}\u2026`)
        : '';

    return html`
        <div class=${`settings-section settings-addon-panel${busy ? ' busy' : ''}`} aria-busy=${busy ? 'true' : 'false'}>
            <div class="settings-addon-toolbar">
                <p class="settings-hint">Catalog from <a href="https://github.com/rcarmo/piclaw-addons" target="_blank">rcarmo/piclaw-addons</a>. Package-first install via Bun; restart required after install/uninstall.</p>
            </div>
            ${restartRequired && html`
                <div class="settings-addon-restart-notice" role="status" aria-live="polite">
                    <span>Extension changes are installed but inactive until piclaw restarts.</span>
                    <button class="settings-addon-btn settings-addon-btn-restart-now" type="button" disabled=${Boolean(busy)} onClick=${restartRuntime}>Restart Now</button>
                </div>
            `}
            ${busy && html`
                <div class="settings-addon-panel-overlay" role="status" aria-live="polite" aria-label=${busyLabel}>
                    <div class="settings-addon-panel-overlay-card">
                        <div class="settings-spinner"></div>
                        <span>${busyLabel}</span>
                    </div>
                </div>
            `}
            <div class="settings-addon-list">
                ${filtered.map(a => {
                    const hasSkills = (a.skills || []).length > 0;
                    const isExtension = a.type === 'extension';
                    const typeLabel = hasSkills && isExtension ? 'extension + skill' : hasSkills ? 'skill' : 'extension';
                    const typeCls = hasSkills && !isExtension ? 'settings-tag-skill' : '';
                    return html`
                    <div class=${`settings-addon-card${a.installed ? ' installed' : ''}`}>
                        <div class="settings-addon-card-header">
                            <strong>${a.slug}</strong>
                            <span class=${`settings-tag settings-tag-type ${typeCls}`}>${typeLabel}</span>
                            <span class="settings-addon-version">${a.installed ? (a.installedVersion || '?') : (a.version || '')}</span>
                            ${a.installKind && html`<span class="settings-tag">${a.installKind}</span>`}
                            ${a.hasUpdate && html`<span class="settings-tag settings-tag-skill">\u2191 ${a.version}</span>`}
                        </div>
                        <div class="settings-addon-card-body">${a.description}</div>
                        <div class="settings-addon-card-footer">
                            <div class="settings-addon-tags">${(a.tags || []).map(t => html`<span class="settings-tag">${t}</span>`)}${(a.skills || []).map(s => html`<span class="settings-tag settings-tag-skill">\ud83d\udcdd ${s}</span>`)}</div>
                            <div class="settings-addon-actions">
                                ${a.installed ? html`
                                    ${a.hasUpdate && html`<button class="settings-addon-btn settings-addon-btn-upgrade" disabled=${Boolean(busy)} onClick=${() => installAddon(a.slug)}>${busySlug === a.slug ? '\u2026' : '\u2b06 Upgrade'}</button>`}
                                    <button class="settings-addon-btn settings-addon-btn-remove" disabled=${Boolean(busy)} onClick=${() => uninstallAddon(a.slug)}>${busySlug === a.slug ? '\u2026' : 'Remove'}</button>
                                ` : html`
                                    <button class="settings-addon-btn settings-addon-btn-install" disabled=${Boolean(busy)} onClick=${() => installAddon(a.slug)}>${busySlug === a.slug ? '\u2026' : 'Install'}</button>
                                `}
                            </div>
                        </div>
                    </div>
                `; })}
                ${filtered.length === 0 && html`<p class="settings-hint">No add-ons match "${filter}"</p>`}
            </div>
        </div>
    `;
}
