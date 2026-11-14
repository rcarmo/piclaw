// Real Settings hosts with registered panes reproducing shipped add-on markup.

window.fetch = async () => Response.json({});
const vendor = await import("../../../web/src/vendor/preact-htm.js");
let html = vendor.html;

function ButtonsPane() {
  return html`<section>
    <h3>Button fixtures</h3>
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
      <button id="plain">Copy ID</button>
      <div class="settings-row"><button id="row">Save</button></div>
      <button id="inline" style="padding:4px 10px;border:1px solid var(--border-color);border-radius:4px;background:var(--bg-secondary);color:var(--text-primary);cursor:pointer;font-size:0.82rem">Save token</button>
      <button id="telegram" style="padding:6px 16px;border-radius:4px;border:1px solid var(--border);background:var(--bg-elevated);color:var(--text-primary);cursor:pointer;font-size:13px"><span>Save config</span></button>
      <button id="disabled" disabled style="cursor:pointer;opacity:1">Working</button>
      <button id="aria-disabled" aria-disabled="true">Unavailable</button>
      <button id="primary" data-settings-button="primary">Accept</button>
      <button id="danger" data-settings-button="danger">Revoke</button>
      <button id="icon" data-settings-button="icon" aria-label="Raise priority">↑</button>
      <button id="custom" data-settings-button="unstyled" style="padding:1px;border-radius:2px">Custom</button>
      <button id="stepper" class="settings-number-step-btn">+</button>
      <button id="tab" role="tab" style="padding:2px">Tab</button>
      <button id="switch" role="switch" style="padding:3px" aria-checked="false">Toggle</button>
      <button id="hidden" style="display:none">Hidden</button>
    </div>
  </section>`;
}

const root = document.getElementById("app")!;
{
  const { registerSettingsPane } = await import("../../../web/src/components/settings/pane-registry.js");
  const { requestOpenSettingsDialog } = await import("../../../web/src/components/settings-dialog-events.js");
  const { SettingsDialogContent } = await import("../../../web/src/components/settings-dialog.js");
  registerSettingsPane({ id: "buttons", label: "Buttons", component: ButtonsPane, icon: null });
  requestOpenSettingsDialog({ section: "buttons" });
  vendor.render(html`<${SettingsDialogContent} onClose=${() => {}} />`, root);
}
