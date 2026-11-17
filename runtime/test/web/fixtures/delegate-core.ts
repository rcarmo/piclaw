import { html, render } from '../../../web/src/vendor/preact-htm.js';
import { SettingsDialogContent } from '../../../web/src/components/settings-dialog.js';
import { requestOpenSettingsDialog } from '../../../web/src/components/settings-dialog-events.js';
import { registerSettingsPane } from '../../../web/src/components/settings/pane-registry.js';
registerSettingsPane({ id: 'fixture-addon', label: 'Fixture add-on', icon: '', component: () => html`<p>Fixture add-on pane</p>` });
requestOpenSettingsDialog({ section: new URL(window.location.href).searchParams.get('section') || 'delegate' });
render(html`<${SettingsDialogContent} variant="tab" />`, document.getElementById('root'));
