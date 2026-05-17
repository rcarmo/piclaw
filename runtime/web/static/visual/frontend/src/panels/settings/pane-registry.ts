/**
 * pane-registry.ts — Registry for addon-contributed settings panes.
 *
 * Addons (client-side) can register custom panes that appear in the
 * Settings panel's nav. Each pane provides a render function.
 *
 * Ported from runtime/web/src/components/settings/pane-registry.ts.
 */

export interface SettingsPaneDefinition {
    /** Unique id (used as nav key). */
    id: string;
    /** Display label in nav. */
    label: string;
    /** SVG icon (optional). */
    icon?: unknown;
    /** Component function: (props: { filter?: string }) => VNode */
    component: unknown;
    /** Whether this pane supports the header search filter. */
    searchable?: boolean;
    /** Placeholder text for the header search. */
    searchPlaceholder?: string;
    /** Sort order (lower = higher in nav). Built-in panes use 0-100. */
    order?: number;
}

const registry: SettingsPaneDefinition[] = [];

export function registerSettingsPane(def: SettingsPaneDefinition): void {
    const idx = registry.findIndex(p => p.id === def.id);
    if (idx >= 0) registry[idx] = def;
    else registry.push(def);
    registry.sort((a, b) => (a.order ?? 500) - (b.order ?? 500));
}

export function unregisterSettingsPane(id: string): void {
    const idx = registry.findIndex(p => p.id === id);
    if (idx >= 0) registry.splice(idx, 1);
}

export function getRegisteredPanes(): SettingsPaneDefinition[] {
    return [...registry];
}

/** Dispatch a custom event so the settings panel knows to re-render. */
export function notifySettingsPanesChanged(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('piclaw:settings-panes-changed'));
}
