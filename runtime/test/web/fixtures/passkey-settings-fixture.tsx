/** @jsx h */
import { h, render } from 'preact';
import { html, render as renderClassic } from '../../../web/src/vendor/preact-htm.js';
import { AuthenticationSection as ClassicSection } from '../../../web/src/components/settings/authentication';
import { PasskeySettings } from '../../../web/shared/passkey-settings';

const root = document.getElementById('app')!;
if (new URL(location.href).searchParams.get('skin') === 'classic') {
  renderClassic(html`<${ClassicSection} />`, root);
} else {
  const pane = getRegisteredPanes().find(p => p.id === 'authentication')!;
  render(h(pane.component as any, { data: { instanceTotp: { configured: true } }, saveSetting: async () => {} }), root);
}
Object.assign(window, { passkeyFixture: { unmount: () => { renderClassic(null, root); render(null, root); }, component: PasskeySettings } });
