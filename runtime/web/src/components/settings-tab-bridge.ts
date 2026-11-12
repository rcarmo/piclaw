/**
 * settings-tab-bridge.ts — routes Settings requests to a work-area tab.
 *
 * In the Classic workbench, every request to open Settings (activity bar,
 * menu, keyboard shortcut, compose commands, server events) opens or focuses
 * the Settings tab. A requested section is left for the tab's content to
 * pick up, and an already-open tab switches section from the same event.
 */
import { useEffect } from '../vendor/preact-htm.js';
import { consumeRequestedSettingsOpenState, normalizeSettingsSectionId } from './settings-dialog-events.js';
import { SETTINGS_TAB_PATH } from '../panes/settings-pane.js';
import { EDITOR_MIN_WIDTH_EVENT } from '../ui/use-splitters.js';

/** Settings sections need roughly this much room before their two-column layout. */
const SETTINGS_TAB_MIN_WIDTH = 720;

export function SettingsTabBridge({ openEditor }: { openEditor: (path: string, options?: Record<string, unknown>) => void }) {
  useEffect(() => {
    const open = (section: string | null) => {
      if (section) (window as any).__piclawSettingsRequestedSection = section;
      openEditor(SETTINGS_TAB_PATH, { label: 'Settings' });
      // After the editor area has rendered, widen it if there is room.
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(EDITOR_MIN_WIDTH_EVENT, { detail: { width: SETTINGS_TAB_MIN_WIDTH } })));
    };
    const onOpenSettings = (event: Event) => open(normalizeSettingsSectionId((event as CustomEvent)?.detail?.section));
    window.addEventListener('piclaw:open-settings', onOpenSettings);
    const pending = consumeRequestedSettingsOpenState();
    if (pending.open) open(pending.section);
    return () => window.removeEventListener('piclaw:open-settings', onOpenSettings);
  }, [openEditor]);
  return null;
}
