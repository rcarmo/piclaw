import { requestOpenSettingsDialog } from './settings-dialog-events.js';

/**
 * Open Settings. In the Classic workbench the request opens the Settings tab
 * (see settings-tab-bridge.ts).
 */
export function openSettingsDialog(options = {}) {
    requestOpenSettingsDialog(options);
}
