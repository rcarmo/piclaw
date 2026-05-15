import { html, useCallback, useEffect, useMemo, useState } from '../../vendor/preact-htm.js';
import {
    clearShellSurfaceGeometry,
    clearShellSurfaceVisible,
    listShellSurfaces,
    setShellSurfaceVisible,
    subscribeShellSurfacesChanged,
} from '../../ui/shell-surface-registry.js';

function readSurfaces() {
    return listShellSurfaces();
}

function sortSurfaces(a, b) {
    const slotDiff = String(a.slot).localeCompare(String(b.slot));
    if (slotDiff !== 0) return slotDiff;
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return String(a.id).localeCompare(String(b.id));
}

function matchesFilter(surface, filter) {
    const query = String(filter || '').trim().toLowerCase();
    if (!query) return true;
    return [surface.label, surface.id, surface.slot, surface.owner, surface.kind]
        .some((value) => String(value || '').toLowerCase().includes(query));
}

function groupBySlot(surfaces) {
    const groups = new Map();
    for (const surface of surfaces) {
        const existing = groups.get(surface.slot) || [];
        existing.push(surface);
        groups.set(surface.slot, existing);
    }
    return Array.from(groups.entries()).map(([slot, items]) => ({ slot, items }));
}

export function ShellSection({ filter = '', setStatus }) {
    const [surfaces, setSurfaces] = useState(readSurfaces);

    const refresh = useCallback(() => {
        setSurfaces(readSurfaces());
    }, []);

    useEffect(() => subscribeShellSurfacesChanged(refresh), [refresh]);

    const visibleSurfaces = useMemo(() => {
        return surfaces
            .filter((surface) => matchesFilter(surface, filter))
            .sort(sortSurfaces);
    }, [surfaces, filter]);

    const groups = useMemo(() => groupBySlot(visibleSurfaces), [visibleSurfaces]);

    const toggleSurface = useCallback((surface, checked) => {
        if (!surface.configurable) return;
        setShellSurfaceVisible(surface.id, checked);
        setStatus?.(`${surface.label || surface.id} ${checked ? 'shown' : 'hidden'}.`, 'success');
        refresh();
    }, [refresh, setStatus]);

    const resetVisibility = useCallback((surface) => {
        if (!surface.configurable) return;
        clearShellSurfaceVisible(surface.id);
        setStatus?.(`${surface.label || surface.id} visibility reset.`, 'success');
        refresh();
    }, [refresh, setStatus]);

    const resetGeometry = useCallback((surface) => {
        if (!surface.configurable) return;
        clearShellSurfaceGeometry(surface.id);
        setStatus?.(`${surface.label || surface.id} geometry reset.`, 'success');
        refresh();
    }, [refresh, setStatus]);

    return html`
        <div class="settings-section settings-shell-section">
            <h3>Shell surfaces</h3>
            <p class="settings-hint">
                Show or hide registered shell surfaces for this browser. Required surfaces are always visible.
            </p>
            ${groups.length === 0 && html`
                <p class="settings-hint">No shell surfaces match the current filter.</p>
            `}
            ${groups.map(({ slot, items }) => html`
                <section class="settings-shell-slot" key=${slot}>
                    <h4 style="margin:16px 0 8px">${slot}</h4>
                    ${items.map((surface) => {
                        const disabled = !surface.configurable;
                        const ownerKind = `${surface.owner || 'unknown'} / ${surface.kind || 'unknown'}`;
                        return html`
                            <div class="settings-row settings-shell-surface-row" key=${surface.id}>
                                <div style="min-width:0;flex:1">
                                    <label for=${`shell-surface-${surface.id}`} style="display:block">${surface.label || surface.id}</label>
                                    <div class="settings-hint" style="margin:2px 0 0">
                                        <code>${surface.id}</code> · ${ownerKind} · order ${surface.order}
                                    </div>
                                </div>
                                <input
                                    id=${`shell-surface-${surface.id}`}
                                    type="checkbox"
                                    checked=${surface.visible}
                                    disabled=${disabled}
                                    aria-label=${`Show ${surface.label || surface.id}`}
                                    title=${disabled ? 'Required shell surfaces cannot be hidden.' : 'Show shell surface'}
                                    onChange=${(event) => toggleSurface(surface, event.currentTarget.checked)}
                                />
                                <button
                                    type="button"
                                    class="settings-small-button"
                                    disabled=${disabled}
                                    title=${disabled ? 'Required shell surfaces cannot be reset.' : 'Reset visibility to default'}
                                    onClick=${() => resetVisibility(surface)}
                                >Reset visibility</button>
                                <button
                                    type="button"
                                    class="settings-small-button"
                                    disabled=${disabled}
                                    title=${disabled ? 'Required shell surfaces cannot be reset.' : 'Reset saved geometry'}
                                    onClick=${() => resetGeometry(surface)}
                                >Reset geometry</button>
                            </div>
                        `;
                    })}
                </section>
            `)}
        </div>
    `;
}
