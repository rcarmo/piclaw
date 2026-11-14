import { useRef } from '../../vendor/preact-htm.js';

let settingsFieldInstance = 0;

/** Stable per-instance ids so visible labels can name their controls. */
export function useSettingsFieldIds(prefix: string): (name: string) => string {
    const ref = useRef(null);
    if (!ref.current) ref.current = `settings-${prefix}-${++settingsFieldInstance}`;
    return (name: string) => `${ref.current}-${name}`;
}
