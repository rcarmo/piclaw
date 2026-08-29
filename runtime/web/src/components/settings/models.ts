import { html, useState, useEffect, useCallback, useMemo, useRef } from '../../vendor/preact-htm.js';
import { getAgentModels, sendAgentMessage } from '../../api.js';
import {
    describeModelContextFit,
    formatModelCatalogueContextWindow,
    formatModelCataloguePricing,
    normaliseModelCatalogue,
} from '../../ui/model-catalogue.ts';
import {
    MODEL_CATALOGUE_PREFERENCES_EVENT,
    normalizeModelCataloguePreferenceKey,
    readModelCataloguePreferences,
    recordRecentModelKey,
    setModelCataloguePreferenceSort,
    toModelCatalogueNormalisePreferences,
    togglePinnedModelKey,
} from '../../ui/model-catalogue-preferences.ts';
import {
    buildModelSettingsProjection,
    collectModelSettingsFacets,
    formatModelCataloguePrice,
    formatModelLastUsed,
    moveModelSettingsActiveKey,
} from '../../ui/model-settings-catalogue.ts';
import { requestOpenSettingsDialog } from '../settings-dialog-events.js';

export function resolveModelsSettingsChatJid(runtimeWindow: ((Window & typeof globalThis) & { __piclawCurrentChatJid?: string }) | null = typeof window !== 'undefined' ? window : null) {
    const globalValue = typeof runtimeWindow?.__piclawCurrentChatJid === 'string'
        ? runtimeWindow.__piclawCurrentChatJid.trim()
        : '';
    if (globalValue) return globalValue;
    try {
        const raw = new URL(runtimeWindow?.location?.href || 'http://localhost/').searchParams.get('chat_jid');
        return raw && raw.trim() ? raw.trim() : 'web:default';
    } catch {
        return 'web:default';
    }
}

export async function sendModelsSettingsCommand(content, chatJid, sender = sendAgentMessage) {
    return sender('default', content, null, [], null, chatJid);
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { credentials: 'same-origin', ...options, signal: controller.signal });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || `Request failed (HTTP ${response.status})`);
        return payload;
    } finally {
        clearTimeout(timeout);
    }
}

function settingsOptionId(key) {
    return `settings-model-option-${encodeURIComponent(key)}`;
}

function formatContextFit(entry) {
    if (entry.contextFit.state === 'blocked') return describeModelContextFit(entry);
    if (entry.contextFit.state === 'unknown') {
        if (entry.contextFit.currentTokens == null) return 'Current chat context is unavailable, so compatibility is unknown.';
        return 'This model does not publish a usable context limit, so compatibility is unknown.';
    }
    const safe = entry.contextFit.effectiveContextWindow;
    const adjusted = entry.contextFit.safetyAdjustedTokens;
    return `Fits: about ${adjusted?.toLocaleString() ?? 'unknown'} safety-adjusted tokens in a ${safe?.toLocaleString() ?? 'unknown'}-token safe window.`;
}

function formatProviderUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    return [usage.plan, usage.availability, usage.hint_short].filter(Boolean).join(' · ') || null;
}

function defaultFilters(sort = 'recommended') {
    return { provider: '', publisher: '', family: '', contextFit: 'all', reasoning: 'all', variant: '', sort };
}

export function ModelsSection({ filter = '', onFilterChange = null }) {
    const [chatJid, setChatJid] = useState(() => resolveModelsSettingsChatJid());
    const [payload, setPayload] = useState(null);
    const [contextUsage, setContextUsage] = useState(null);
    const [preferences, setPreferences] = useState(() => readModelCataloguePreferences());
    const [filters, setFilters] = useState(() => defaultFilters(readModelCataloguePreferences().sort));
    const [filtersExpanded, setFiltersExpanded] = useState(false);
    const [selectedKey, setSelectedKey] = useState('');
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [staleMessage, setStaleMessage] = useState(null);
    const [busyAction, setBusyAction] = useState('');
    const [actionStatus, setActionStatus] = useState(null);
    const [scopedBusy, setScopedBusy] = useState(false);
    const listRef = useRef(null);
    const requestGeneration = useRef(0);
    const actionGeneration = useRef(0);
    const chatJidRef = useRef(chatJid);
    chatJidRef.current = chatJid;

    const loadModels = useCallback(async ({ quiet = false } = {}) => {
        const targetChatJid = chatJid;
        const generation = ++requestGeneration.current;
        if (!quiet || !payload) setLoading(true);
        if (!quiet) setLoadError(null);
        try {
            const [nextPayload, nextContext] = await Promise.all([
                getAgentModels(targetChatJid),
                fetchJsonWithTimeout(`/agent/context?chat_jid=${encodeURIComponent(targetChatJid)}`).catch(() => null),
            ]);
            if (generation !== requestGeneration.current || targetChatJid !== chatJidRef.current) return null;
            const nextPreferences = readModelCataloguePreferences();
            const catalogue = normaliseModelCatalogue(nextPayload, {
                contextUsage: nextContext,
                ...toModelCatalogueNormalisePreferences(nextPreferences),
            });
            setPayload(nextPayload);
            setContextUsage(nextContext);
            setPreferences(nextPreferences);
            setSelectedKey((current) => catalogue.some((entry) => entry.key === current)
                ? current
                : (catalogue.find((entry) => entry.current)?.key ?? catalogue[0]?.key ?? ''));
            setLoadError(null);
            setStaleMessage(null);
            return { payload: nextPayload, catalogue };
        } catch (error) {
            if (generation !== requestGeneration.current || targetChatJid !== chatJidRef.current) return null;
            const message = error?.name === 'AbortError' ? 'Models request timed out.' : (error?.message || 'Failed to load models.');
            if (payload) setStaleMessage(`${message} Showing the last loaded catalogue.`);
            else setLoadError(message);
            return null;
        } finally {
            if (generation === requestGeneration.current) setLoading(false);
        }
    }, [chatJid, payload]);

    useEffect(() => {
        actionGeneration.current += 1;
        setBusyAction('');
        setActionStatus(null);
        void loadModels();
    }, [chatJid]);

    useEffect(() => {
        const onChatChanged = (event) => {
            const next = typeof event?.detail?.chatJid === 'string' ? event.detail.chatJid.trim() : resolveModelsSettingsChatJid();
            if (next) setChatJid(next);
        };
        window.addEventListener('piclaw:current-chat-changed', onChatChanged);
        return () => window.removeEventListener('piclaw:current-chat-changed', onChatChanged);
    }, []);

    useEffect(() => {
        const onPreferences = (event) => setPreferences(event?.detail || readModelCataloguePreferences());
        const onStorage = (event) => {
            if (!event?.key || event.key === 'piclaw:model-catalogue-preferences:v1') setPreferences(readModelCataloguePreferences());
        };
        window.addEventListener(MODEL_CATALOGUE_PREFERENCES_EVENT, onPreferences);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener(MODEL_CATALOGUE_PREFERENCES_EVENT, onPreferences);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    useEffect(() => {
        const refresh = (event) => {
            const eventChatJid = event?.detail?.chatJid;
            if (!eventChatJid || eventChatJid === chatJid) void loadModels({ quiet: true });
        };
        const refreshOnFocus = () => void loadModels({ quiet: true });
        const interval = setInterval(refreshOnFocus, 15_000);
        window.addEventListener('piclaw:model-state-changed', refresh);
        window.addEventListener('piclaw:sse-connected', refresh);
        window.addEventListener('focus', refreshOnFocus);
        return () => {
            clearInterval(interval);
            window.removeEventListener('piclaw:model-state-changed', refresh);
            window.removeEventListener('piclaw:sse-connected', refresh);
            window.removeEventListener('focus', refreshOnFocus);
        };
    }, [chatJid, loadModels]);

    const entries = useMemo(() => normaliseModelCatalogue(payload, {
        contextUsage,
        ...toModelCatalogueNormalisePreferences(preferences),
    }), [payload, contextUsage, preferences]);
    const facets = useMemo(() => collectModelSettingsFacets(entries), [entries]);
    const projection = useMemo(() => buildModelSettingsProjection(entries, {
        query: filter,
        providers: filters.provider || null,
        publishers: filters.publisher || null,
        families: filters.family || null,
        contextFit: filters.contextFit,
        reasoning: filters.reasoning === 'all' ? null : filters.reasoning === 'yes',
        variants: filters.variant || null,
        sort: filters.sort,
    }, selectedKey), [entries, filter, filters, selectedKey]);
    const selected = projection.selectedEntry;

    useEffect(() => {
        if (!projection.renderedEntries.some((entry) => entry.key === selectedKey)) {
            setSelectedKey(projection.renderedEntries[0]?.key ?? '');
        }
    }, [projection.renderedEntries, selectedKey]);

    const updateFilter = (name, value) => {
        setFilters((current) => ({ ...current, [name]: value }));
        if (name === 'sort') setPreferences(setModelCataloguePreferenceSort(value));
    };

    const resetFilters = () => {
        setFilters(defaultFilters(preferences.sort));
        onFilterChange?.('');
    };

    const handleListKeyDown = (event) => {
        const actions = {
            ArrowDown: 'next', ArrowUp: 'previous', Home: 'first', End: 'last',
            PageDown: 'page-next', PageUp: 'page-previous',
        };
        const action = actions[event.key];
        if (!action) return;
        event.preventDefault();
        const nextKey = moveModelSettingsActiveKey(projection.renderedEntries, selectedKey, action);
        setSelectedKey(nextKey);
        requestAnimationFrame(() => {
            const node = nextKey ? document.getElementById(settingsOptionId(nextKey)) : null;
            node?.scrollIntoView?.({ block: 'nearest' });
        });
    };

    const switchModel = async () => {
        if (!selected || busyAction) return;
        if (selected.contextFit.state === 'blocked') {
            setActionStatus({ type: 'error', text: describeModelContextFit(selected) });
            return;
        }
        const targetChatJid = chatJid;
        const generation = ++actionGeneration.current;
        setBusyAction('switch');
        setActionStatus(null);
        try {
            const response = await sendModelsSettingsCommand(`/model ${selected.key}`, targetChatJid);
            if (generation !== actionGeneration.current || targetChatJid !== chatJidRef.current) return;
            if (response?.command === false || response?.error || response?.command?.status === 'error') throw new Error(response?.error || response?.command?.message || 'Model switch failed.');
            const confirmedPayload = await getAgentModels(targetChatJid);
            if (generation !== actionGeneration.current || targetChatJid !== chatJidRef.current) return;
            const confirmedCatalogue = normaliseModelCatalogue(confirmedPayload, {
                contextUsage,
                ...toModelCatalogueNormalisePreferences(preferences),
            });
            const confirmed = confirmedCatalogue.find((entry) => entry.current)?.key
                ?? normalizeModelCataloguePreferenceKey(confirmedPayload?.current ?? confirmedPayload?.model);
            if (confirmed !== selected.key) throw new Error('The server did not confirm the model switch.');
            requestGeneration.current += 1;
            setPayload(confirmedPayload);
            setPreferences(recordRecentModelKey(selected.key));
            setActionStatus({ type: 'success', text: `Using ${selected.key} for ${targetChatJid}.` });
            window.dispatchEvent(new CustomEvent('piclaw:model-state-changed', { detail: { chatJid: targetChatJid, payload: confirmedPayload, source: 'settings' } }));
            void loadModels({ quiet: true });
        } catch (error) {
            if (generation === actionGeneration.current && targetChatJid === chatJidRef.current) {
                setActionStatus({ type: 'error', text: error?.message || 'Model switch failed.' });
                await loadModels({ quiet: true });
            }
        } finally {
            if (generation === actionGeneration.current) setBusyAction('');
        }
    };

    const setThinkingLevel = async (level) => {
        if (!selected?.current || busyAction) return;
        setBusyAction('thinking');
        setActionStatus(null);
        try {
            const response = await sendModelsSettingsCommand(`/thinking ${level}`, chatJid);
            if (response?.command === false || response?.error || response?.command?.status === 'error') throw new Error(response?.error || response?.command?.message || 'Thinking level change failed.');
            await loadModels({ quiet: true });
            setActionStatus({ type: 'success', text: 'Thinking level updated.' });
        } catch (error) {
            setActionStatus({ type: 'error', text: error?.message || 'Thinking level change failed.' });
            await loadModels({ quiet: true });
        } finally {
            setBusyAction('');
        }
    };

    const compactContext = async () => {
        if (busyAction) return;
        setBusyAction('compact');
        try {
            const response = await sendModelsSettingsCommand('/compact', chatJid);
            if (response?.command === false || response?.error || response?.command?.status === 'error') throw new Error(response?.error || response?.command?.message || 'Compaction request failed.');
            setActionStatus({ type: 'success', text: 'Context compaction requested. Switch after compaction completes.' });
        } catch (error) {
            setActionStatus({ type: 'error', text: error?.message || 'Compaction request failed.' });
        } finally {
            setBusyAction('');
        }
    };

    const setScopedModels = async (enabled) => {
        if (scopedBusy) return;
        setScopedBusy(true);
        try {
            const result = await fetchJsonWithTimeout('/agent/settings/general', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scopedModelsOnly: Boolean(enabled) }),
            });
            if (!result?.ok) throw new Error(result?.error || 'Failed to save scoped model setting.');
            await loadModels({ quiet: true });
        } catch (error) {
            setActionStatus({ type: 'error', text: error?.message || 'Failed to save scoped model setting.' });
        } finally {
            setScopedBusy(false);
        }
    };

    const togglePin = (key = selected?.key) => {
        if (!key) return;
        setPreferences(togglePinnedModelKey(key));
    };

    const renderEntry = (entry) => html`
        <div
            id=${settingsOptionId(entry.key)}
            key=${entry.key}
            role="option"
            aria-selected=${entry.key === selectedKey ? 'true' : 'false'}
            aria-current=${entry.current ? 'true' : undefined}
            class=${`model-catalogue-settings__row${entry.key === selectedKey ? ' selected' : ''}${entry.current ? ' current' : ''}`}
            onClick=${() => setSelectedKey(entry.key)}
        >
            <button
                type="button"
                class="model-catalogue-settings__pin"
                aria-label=${entry.pinned ? `Unpin ${entry.displayName}` : `Pin ${entry.displayName}`}
                aria-pressed=${entry.pinned ? 'true' : 'false'}
                title=${entry.pinned ? 'Unpin model' : 'Pin model'}
                onClick=${(event) => { event.stopPropagation(); togglePin(entry.key); }}
            >${entry.pinned ? '★' : '☆'}</button>
            <span class="model-catalogue-settings__row-main">
                <strong>${entry.displayName}</strong>
                <code>${entry.key}</code>
                <span class="model-catalogue-settings__row-mobile-meta">
                    <span>${formatModelCatalogueContextWindow(entry.contextWindow) || 'Unknown context'}</span>
                    <span>${entry.reasoning ? 'Reasoning' : 'Standard'}</span>
                    ${formatModelCataloguePricing(entry.pricing) && html`<span>${formatModelCataloguePricing(entry.pricing)}</span>`}
                </span>
            </span>
            <span class="model-catalogue-settings__row-family">${entry.family || entry.publisher || '—'}</span>
            <span class="model-catalogue-settings__row-context">${formatModelCatalogueContextWindow(entry.contextWindow) || 'Unknown'}</span>
            <span class="model-catalogue-settings__row-mode">${entry.reasoning ? 'Reasoning' : 'Standard'}</span>
            <span class="model-catalogue-settings__row-input-price">${formatModelCataloguePrice(entry.pricing?.inputPerMillion ?? null)}</span>
            <span class="model-catalogue-settings__row-output-price">${formatModelCataloguePrice(entry.pricing?.outputPerMillion ?? null)}</span>
        </div>
    `;

    const renderGroup = (group) => html`
        <div class="model-catalogue-settings__group" key=${group.key} role="group" aria-label=${group.label}>
            <div class="model-catalogue-settings__group-heading"><span>${group.label}</span><span>${group.totalCount}</span></div>
            ${group.entries.map(renderEntry)}
        </div>
    `;

    const selectedDiagnostic = payload?.provider_diagnostics?.providers?.find((row) => row.provider === selected?.provider);
    const usageText = selected?.current ? formatProviderUsage(payload?.provider_usage) : null;
    const thinkingLevels = selected?.thinkingLevels ?? [];
    const currentThinkingLevel = payload?.thinking_level ?? '';
    const enabledPatterns = Array.isArray(payload?.enabled_model_patterns) ? payload.enabled_model_patterns : [];

    if (loading && !payload) return html`<div class="settings-loading" role="status">Loading model catalogue…</div>`;

    return html`
        <div class="model-catalogue-settings">
            <div class="model-catalogue-settings__header">
                <div>
                    <strong>Models for ${chatJid}</strong>
                    <span>${entries.length} available · ${projection.totalMatches} matched${projection.hiddenCount ? ` · ${projection.renderedEntries.length} shown` : ''}</span>
                </div>
                <button type="button" class="settings-btn" onClick=${() => loadModels()} disabled=${loading}>${loading ? 'Refreshing…' : 'Refresh'}</button>
            </div>
            ${loadError && html`<div class="model-catalogue-settings__notice error" role="alert">${loadError} <button type="button" onClick=${() => loadModels()}>Retry</button></div>`}
            ${staleMessage && html`<div class="model-catalogue-settings__notice warning" role="status">${staleMessage}</div>`}
            ${actionStatus && html`<div class=${`model-catalogue-settings__notice ${actionStatus.type}`} role=${actionStatus.type === 'error' ? 'alert' : 'status'}>${actionStatus.text}</div>`}

            <div class="model-catalogue-settings__scope">
                <label><input type="checkbox" checked=${Boolean(payload?.scoped_models_only)} disabled=${scopedBusy} onChange=${(event) => setScopedModels(event.currentTarget.checked)} /> Use <code>enabledModels</code> to scope the catalogue and picker</label>
                <span>${payload?.scoped_models_only ? (payload?.scoped_model_filter_active ? 'enabledModels filter active' : 'Scope enabled, but no enabledModels patterns are available') : 'Showing the full provider catalogue'}</span>
            </div>
            <div class=${`model-catalogue-settings__enabled-models${payload?.scoped_model_filter_active ? ' active' : ''}`}>
                <strong>enabledModels</strong>
                <span>${enabledPatterns.length ? enabledPatterns.join(', ') : 'No patterns reported by the active Pi settings manager.'}</span>
                <small>${enabledPatterns.length ? `${entries.length} catalogue entries after applying the configured patterns.` : 'Configure enabledModels in Pi settings; this toggle only chooses whether Piclaw applies those patterns outside the TUI.'}</small>
            </div>

            <div class="model-catalogue-settings__filter-disclosure">
                <button
                    type="button"
                    class="model-catalogue-settings__filter-toggle settings-btn"
                    aria-expanded=${filtersExpanded ? 'true' : 'false'}
                    aria-controls="classic-model-catalogue-filters"
                    onClick=${() => setFiltersExpanded((value) => !value)}
                >Filters and sorting</button>
                <div id="classic-model-catalogue-filters" class=${`model-catalogue-settings__filters${filtersExpanded ? ' expanded' : ''}`} aria-label="Model catalogue filters">
                    <select aria-label="Provider" value=${filters.provider} onChange=${(event) => updateFilter('provider', event.currentTarget.value)}><option value="">All providers</option>${facets.providers.map((value) => html`<option value=${value}>${value}</option>`)}</select>
                    <select aria-label="Publisher" value=${filters.publisher} onChange=${(event) => updateFilter('publisher', event.currentTarget.value)}><option value="">All publishers</option>${facets.publishers.map((value) => html`<option value=${value}>${value}</option>`)}</select>
                    <select aria-label="Family" value=${filters.family} onChange=${(event) => updateFilter('family', event.currentTarget.value)}><option value="">All families</option>${facets.families.map((value) => html`<option value=${value}>${value}</option>`)}</select>
                    <select aria-label="Context fit" value=${filters.contextFit} onChange=${(event) => updateFilter('contextFit', event.currentTarget.value)}><option value="all">Any context fit</option><option value="compatible">Compatible or unknown</option><option value="fits">Fits current context</option><option value="unknown">Unknown fit</option><option value="blocked">Blocked</option></select>
                    <select aria-label="Reasoning" value=${filters.reasoning} onChange=${(event) => updateFilter('reasoning', event.currentTarget.value)}><option value="all">Any reasoning</option><option value="yes">Reasoning</option><option value="no">Non-reasoning</option></select>
                    <select aria-label="Variant" value=${filters.variant} onChange=${(event) => updateFilter('variant', event.currentTarget.value)}><option value="">All variants</option>${facets.variants.map((value) => html`<option value=${value}>${value}</option>`)}</select>
                    <select aria-label="Sort models" value=${filters.sort} onChange=${(event) => updateFilter('sort', event.currentTarget.value)}><option value="recommended">Recommended</option><option value="name">Name</option><option value="context">Context window</option><option value="input-price">Input price</option><option value="output-price">Output price</option></select>
                    <button type="button" class="settings-btn" onClick=${resetFilters}>Reset filters</button>
                </div>
            </div>

            <div class="model-catalogue-settings__workspace">
                <div
                    ref=${listRef}
                    class="model-catalogue-settings__list"
                    role="listbox"
                    tabIndex="0"
                    aria-label="Model catalogue"
                    aria-activedescendant=${projection.renderedEntries.some((entry) => entry.key === selectedKey) ? settingsOptionId(selectedKey) : undefined}
                    onKeyDown=${handleListKeyDown}
                >
                    <div class="model-catalogue-settings__columns" aria-hidden="true"><span>Pin</span><span>Model</span><span>Family</span><span>Context</span><span>Mode</span><span>Input / 1M</span><span>Output / 1M</span></div>
                    ${projection.groups.map((provider) => html`
                        <div class="model-catalogue-settings__provider" key=${provider.key} role="group" aria-label=${provider.label}>
                            <div class="model-catalogue-settings__provider-heading"><span>${provider.label}</span><span>${provider.totalCount}</span></div>
                            ${provider.entries.map(renderEntry)}
                            ${provider.publisherGroups.map(renderGroup)}
                        </div>
                    `)}
                    ${projection.totalMatches === 0 && html`<div class="settings-empty">No models match the current search and filters.</div>`}
                    ${projection.hiddenCount > 0 && html`<div class="model-catalogue-settings__limit">Showing ${projection.renderedEntries.length} of ${projection.totalMatches}. Refine the search or filters to see the rest.</div>`}
                </div>

                <aside class="model-catalogue-settings__detail" aria-live="polite">
                    ${selected ? html`
                        <div class="model-catalogue-settings__detail-title">
                            <div><h3>${selected.displayName}</h3><code>${selected.key}</code></div>
                            <button type="button" class="settings-btn" onClick=${() => togglePin()}>${selected.pinned ? 'Unpin' : 'Pin'}</button>
                        </div>
                        <dl class="model-catalogue-settings__facts">
                            <div><dt>Access provider</dt><dd>${selected.provider || 'Unknown'}</dd></div>
                            <div><dt>Publisher</dt><dd>${selected.publisher || 'Unknown'}</dd></div>
                            <div><dt>Family</dt><dd>${selected.family || 'Unknown'}</dd></div>
                            <div><dt>Context window</dt><dd>${formatModelCatalogueContextWindow(selected.contextWindow) || 'Unknown'}</dd></div>
                            <div><dt>Context fit</dt><dd>${formatContextFit(selected)}</dd></div>
                            <div><dt>Reasoning</dt><dd>${selected.reasoning ? 'Supported' : 'Not advertised'}</dd></div>
                            <div><dt>Variants</dt><dd>${selected.variants.length ? selected.variants.join(', ') : 'Stable'}</dd></div>
                            <div><dt>Input / 1M</dt><dd>${formatModelCataloguePrice(selected.pricing?.inputPerMillion ?? null)}</dd></div>
                            <div><dt>Output / 1M</dt><dd>${formatModelCataloguePrice(selected.pricing?.outputPerMillion ?? null)}</dd></div>
                            <div><dt>Cache read / 1M</dt><dd>${formatModelCataloguePrice(selected.pricing?.cacheReadPerMillion ?? null)}</dd></div>
                            <div><dt>Cache write / 1M</dt><dd>${formatModelCataloguePrice(selected.pricing?.cacheWritePerMillion ?? null)}</dd></div>
                            <div><dt>Last used</dt><dd>${formatModelLastUsed(selected.lastUsedAt)}</dd></div>
                            <div><dt>Status</dt><dd>${selected.current ? 'Current model' : selected.pinned ? 'Pinned' : 'Available'}</dd></div>
                        </dl>
                        <div class="model-catalogue-settings__thinking">
                            <strong>Thinking levels</strong>
                            ${thinkingLevels.length ? html`
                                <select aria-label="Thinking level" disabled=${!selected.current || busyAction} value=${selected.current ? currentThinkingLevel : ''} onChange=${(event) => setThinkingLevel(event.currentTarget.value)}>
                                    ${!selected.current && html`<option value="">Switch to this model to change thinking</option>`}
                                    ${thinkingLevels.map((level) => html`<option value=${level.id}>${level.label}</option>`)}
                                </select>
                                <span>${thinkingLevels.map((level) => level.label).join(', ')}</span>
                            ` : html`<span>No server-provided thinking levels.</span>`}
                        </div>
                        <div class="model-catalogue-settings__diagnostics">
                            <strong>Provider diagnostics</strong>
                            ${selectedDiagnostic ? html`<span>${selectedDiagnostic.auth_configured ? 'Authenticated' : 'Credentials not configured'} · ${selectedDiagnostic.available_model_count} available of ${selectedDiagnostic.model_count} advertised${selectedDiagnostic.auth_source ? ` · ${selectedDiagnostic.auth_source}` : ''}</span>` : html`<span>No provider diagnostics available.</span>`}
                            ${payload?.provider_diagnostics?.composition_error && html`<span class="error">${payload.provider_diagnostics.composition_error}</span>`}
                            ${usageText && html`<span>${usageText}</span>`}
                        </div>
                        <div class="model-catalogue-settings__actions">
                            <button type="button" class="settings-btn primary" disabled=${selected.current || Boolean(busyAction) || selected.contextFit.state === 'blocked'} onClick=${switchModel}>${selected.current ? 'Current model' : busyAction === 'switch' ? 'Switching…' : 'Use for current chat'}</button>
                            ${selected.contextFit.state === 'blocked' && html`<button type="button" class="settings-btn" disabled=${Boolean(busyAction)} onClick=${compactContext}>Compact context</button>`}
                            <button type="button" class="settings-btn" onClick=${() => navigator.clipboard?.writeText?.(selected.key)}>Copy model key</button>
                            <button type="button" class="settings-btn" onClick=${() => requestOpenSettingsDialog({ section: 'providers' })}>Provider settings</button>
                        </div>
                    ` : html`<div class="settings-empty">Select a model to inspect it.</div>`}
                </aside>
            </div>
        </div>
    `;
}
