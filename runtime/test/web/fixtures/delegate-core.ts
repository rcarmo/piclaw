import { html, render } from '../../../web/src/vendor/preact-htm.js';
import { SettingsDialogContent } from '../../../web/src/components/settings-dialog.js';
import { requestOpenSettingsDialog } from '../../../web/src/components/settings-dialog-events.js';
requestOpenSettingsDialog({ section: 'delegate' });
render(html`<${SettingsDialogContent} variant="tab" />`, document.getElementById('root'));
