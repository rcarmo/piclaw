
const root = document.getElementById('app')!;
{
  const { html, render, useState } = await import('../../../web/src/vendor/preact-htm.js');
  const { AddonsSection } = await import('../../../web/src/components/settings/addons.js');
  function Fixture() {
    const [status, setStatus] = useState('');
    return html`<div id="status" role="alert">${status}</div><${AddonsSection} setStatus=${setStatus} />`;
  }
  render(html`<${Fixture} />`, root);
}
