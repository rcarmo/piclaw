import { html, useCallback, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import {
    buildModelPickerProjection,
    describeModelContextFit,
    formatModelCatalogueContextWindow,
    formatModelCataloguePricing,
    moveModelPickerActiveKey,
} from '../ui/model-catalogue.ts';

let modelPickerInstanceCounter = 0;

function optionId(instanceId, key) {
    return `compose-model-option-${instanceId}-${encodeURIComponent(key)}`;
}

function formatModelBadges(entry) {
    const badges = [];
    const context = formatModelCatalogueContextWindow(entry.contextWindow);
    if (context) badges.push(context);
    if (entry.reasoning) badges.push('reasoning');
    badges.push(...entry.variants.filter((variant) => variant !== 'stable').slice(0, 2));
    return badges;
}

export function ClassicModelPicker({
    entries,
    loading = false,
    switching = false,
    onSelect,
    onTogglePin,
    onClose,
    onCompact,
    onOpenSettings,
    rootRef,
}) {
    const [query, setQuery] = useState('');
    const [showBlocked, setShowBlocked] = useState(false);
    const [activeKey, setActiveKey] = useState(null);
    const searchRef = useRef(null);
    const optionRefs = useRef(new Map());
    const instanceIdRef = useRef(null);
    if (instanceIdRef.current == null) instanceIdRef.current = ++modelPickerInstanceCounter;
    const searchId = `compose-model-search-${instanceIdRef.current}`;
    const resultsId = `compose-model-results-${instanceIdRef.current}`;
    const projection = useMemo(
        () => buildModelPickerProjection(entries, { query, showBlocked }),
        [entries, query, showBlocked],
    );
    const selectableEntries = useMemo(
        () => projection.renderedEntries.filter((entry) => entry.contextFit.state !== 'blocked'),
        [projection],
    );

    useEffect(() => {
        searchRef.current?.focus();
    }, []);

    useEffect(() => {
        if (selectableEntries.some((entry) => entry.key === activeKey)) return;
        const current = selectableEntries.find((entry) => entry.current);
        setActiveKey(current?.key ?? selectableEntries[0]?.key ?? null);
    }, [activeKey, selectableEntries]);

    useEffect(() => {
        optionRefs.current.get(activeKey)?.scrollIntoView?.({ block: 'nearest' });
    }, [activeKey]);

    const choose = useCallback((entry) => {
        if (!entry || switching || entry.contextFit.state === 'blocked') return;
        onSelect(entry);
    }, [onSelect, switching]);

    const handleKeyboard = useCallback((event) => {
        if (event.isComposing) return;
        const actions = {
            ArrowDown: 'next',
            ArrowUp: 'previous',
            Home: 'first',
            End: 'last',
            PageDown: 'page-next',
            PageUp: 'page-previous',
        };
        if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
        }
        if (event.target !== searchRef.current) return;
        if (event.key === 'Enter') {
            const entry = projection.renderedEntries.find((candidate) => candidate.key === activeKey);
            if (entry) {
                event.preventDefault();
                if (event.altKey) onTogglePin?.(entry);
                else choose(entry);
            }
            return;
        }
        const action = actions[event.key];
        if (!action || ((event.key === 'Home' || event.key === 'End') && !event.ctrlKey && !event.metaKey)) return;
        event.preventDefault();
        setActiveKey(moveModelPickerActiveKey(projection.renderedEntries, activeKey, action));
    }, [activeKey, choose, onClose, onTogglePin, projection.renderedEntries]);

    const renderEntry = (entry) => {
        const blocked = entry.contextFit.state === 'blocked';
        const selected = entry.current;
        const active = entry.key === activeKey;
        const badges = formatModelBadges(entry);
        return html`
            <button
                id=${optionId(instanceIdRef.current, entry.key)}
                key=${entry.key}
                type="button"
                role="option"
                aria-label=${`${entry.displayName}, ${entry.pinned ? 'pinned' : 'not pinned'}. Alt+Enter to ${entry.pinned ? 'unpin' : 'pin'}.`}
                aria-keyshortcuts="Alt+Enter"
                aria-selected=${selected ? 'true' : 'false'}
                aria-disabled=${blocked ? 'true' : 'false'}
                tabIndex=${-1}
                class=${`compose-model-catalogue-option${selected ? ' selected' : ''}${active ? ' focused' : ''}${blocked ? ' blocked' : ''}`}
                ref=${(node) => node ? optionRefs.current.set(entry.key, node) : optionRefs.current.delete(entry.key)}
                onMouseDown=${(event) => event.preventDefault()}
                onMouseEnter=${() => !blocked && setActiveKey(entry.key)}
                onClick=${() => choose(entry)}
            >
                <span
                    class=${`compose-model-catalogue-pin${entry.pinned ? ' pinned' : ''}`}
                    aria-hidden="true"
                    title=${entry.pinned ? 'Unpin model' : 'Pin model'}
                    onClick=${(event) => { event.preventDefault(); event.stopPropagation(); setActiveKey(entry.key); onTogglePin?.(entry); }}
                >${entry.pinned ? '★' : '☆'}</span>
                <span class="compose-model-catalogue-option-content">
                    <span class="compose-model-catalogue-option-primary">
                        <span class="compose-model-catalogue-option-name">${entry.displayName}</span>
                        ${formatModelCataloguePricing(entry.pricing) && html`<span class="compose-model-catalogue-option-price">${formatModelCataloguePricing(entry.pricing)}</span>`}
                    </span>
                    ${entry.displayName !== entry.key && html`<span class="compose-model-catalogue-option-key">${entry.key}</span>`}
                    ${badges.length > 0 && html`
                        <span class="compose-model-catalogue-option-badges">
                            ${badges.map((badge) => html`<span class="compose-model-catalogue-badge" key=${badge}>${badge}</span>`)}
                        </span>
                    `}
                    ${blocked && html`<span class="compose-model-catalogue-option-note">${describeModelContextFit(entry)}</span>`}
                </span>
            </button>
        `;
    };

    return html`
        <div
            class="compose-model-popup compose-model-catalogue"
            data-compose-model-catalogue="true"
            ref=${rootRef}
            onKeyDown=${handleKeyboard}
        >
            <div class="compose-model-catalogue-header">
                <label class="compose-model-catalogue-search-label" for=${searchId}>Search models</label>
                <div class="compose-model-catalogue-search-row">
                    <input
                        id=${searchId}
                        ref=${searchRef}
                        class="compose-model-catalogue-search"
                        type="search"
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded="true"
                        aria-controls=${resultsId}
                        aria-activedescendant=${activeKey ? optionId(instanceIdRef.current, activeKey) : undefined}
                        placeholder="Search models…"
                        value=${query}
                        onInput=${(event) => setQuery(event.currentTarget.value)}
                    />
                    ${query && html`<button type="button" class="compose-model-catalogue-clear" onClick=${() => setQuery('')} aria-label="Clear model search">×</button>`}
                </div>
                <div class="compose-model-catalogue-summary" aria-live="polite">
                    <span>${projection.totalMatches} ${projection.totalMatches === 1 ? 'model' : 'models'}</span>
                    ${loading && html`<span>Refreshing…</span>`}
                </div>
            </div>
            <div id=${resultsId} class="compose-model-popup-menu compose-model-catalogue-results" role="listbox" aria-label="Models">
                ${projection.sections.map((section) => !section.collapsed && html`
                    <section class=${`compose-model-catalogue-section ${`compose-model-catalogue-section--${section.key}`}`} key=${section.key} role="presentation">
                        <div class="compose-model-catalogue-section-heading" role="presentation">
                            <span>${section.label}</span><span>${section.totalCount}</span>
                        </div>
                        ${section.entries.map(renderEntry)}
                        ${section.groups.map((group) => html`
                            <div class="compose-model-catalogue-group" key=${group.key} role="group" aria-label=${group.label}>
                                <div class="compose-model-catalogue-group-heading" role="presentation">
                                    <span>${group.label}</span><span>${group.totalCount}</span>
                                </div>
                                ${group.entries.map(renderEntry)}
                            </div>
                        `)}
                    </section>
                `)}
                ${projection.totalMatches === 0 && html`
                    <div class="compose-model-popup-empty">
                        ${loading ? 'Loading models…' : (query ? `No models match “${query}”.` : 'No models available.')}
                    </div>
                `}
                ${projection.hiddenCount > 0 && html`<div class="compose-model-catalogue-limit-note">Showing ${projection.renderedEntries.length} of ${projection.totalMatches}; refine your search to see more.</div>`}
            </div>
            <div class="compose-model-catalogue-footer">
                <div class="compose-model-catalogue-footer-start">
                    ${projection.blockedCount > 0 && html`
                        <button type="button" class="compose-model-popup-btn" onClick=${() => setShowBlocked((value) => !value)}>
                            ${showBlocked ? 'Hide' : 'Show'} incompatible (${projection.blockedCount})
                        </button>
                    `}
                    ${onCompact && projection.blockedCount > 0 && html`<button type="button" class="compose-model-popup-btn" onClick=${onCompact}>Compact context</button>`}
                </div>
                <button type="button" class="compose-model-popup-btn primary" onClick=${onOpenSettings}>Open Models settings</button>
            </div>
        </div>
    `;
}
