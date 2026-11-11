/** System meters are always shown; only their collapsed state is a preference. */
import { saveUiState } from '../api.js';
import { getLocalStorageBoolean, setLocalStorageItem } from '../utils/storage.js';

export const METERS_COLLAPSED_STORAGE_KEY = 'piclaw_system_meters_collapsed';
export const METERS_COLLAPSED_EVENT_NAME = 'piclaw-meters-collapsed-change';

function persistMetersState(patch) {
    if (typeof fetch !== 'function') return;
    void saveUiState({ ui_meters: patch }).catch((error) => {
        console.debug('[meters] Failed to persist meters UI state.', error);
    });
}

function dispatchMetersCollapsedChange(collapsed) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(METERS_COLLAPSED_EVENT_NAME, {
        detail: { collapsed: Boolean(collapsed) },
    }));
}

export function readStoredMetersCollapsed(defaultValue = false) {
    return getLocalStorageBoolean(METERS_COLLAPSED_STORAGE_KEY, defaultValue);
}

export function applyMetersCollapsed(collapsed, options: { persist?: boolean; persistServer?: boolean } = {}) {
    const persist = options.persist !== false;
    const persistServer = options.persistServer !== false;
    const next = Boolean(collapsed);
    if (persist) {
        setLocalStorageItem(METERS_COLLAPSED_STORAGE_KEY, next ? 'true' : 'false');
    }
    if (persistServer) persistMetersState({ collapsed: next });
    dispatchMetersCollapsedChange(next);
    return next;
}

export function toggleMetersCollapsed() {
    const next = !readStoredMetersCollapsed(false);
    return applyMetersCollapsed(next);
}

export function applyMetersFromEvent(payload) {
    if (typeof payload?.collapsed === 'boolean') {
        applyMetersCollapsed(Boolean(payload.collapsed), { persistServer: false });
    }
}
