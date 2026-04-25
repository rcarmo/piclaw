// @ts-nocheck
/**
 * settings-pane-registry.ts — Registry for extension-contributed settings panes.
 *
 * Extensions (client-side) can register custom panes that appear in the
 * settings dialog's nav. Each pane provides a Preact render function.
 */

export interface SettingsPaneDefinition {
    /** Unique id (used as nav key). */
    id: string;
    /** Display label in nav. */
    label: string;
    /** SVG icon (preact html template). */
    icon: unknown;
    /** Preact component: (props: { filter?: string }) => VNode */
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
    // Replace if same id exists
    const idx = registry.findIndex(p => p.id === def.id);
    if (idx >= 0) registry[idx] = def;
    else registry.push(def);
    registry.sort((a, b) => (a.order ?? 500) - (b.order ?? 500));
}

export function getRegisteredSettingsPanes(): SettingsPaneDefinition[] {
    return [...registry];
}

/** Dispatch a custom event so the settings dialog knows to re-render. */
export function notifySettingsPanesChanged(): void {
    window.dispatchEvent(new CustomEvent('piclaw:settings-panes-changed'));
}
