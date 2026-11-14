// Real Settings hosts; all requests are fixture-local and never reach a live instance.
const params = new URLSearchParams(location.search);

const section = params.get("section") || "general";
const vendor = await import("../../../web/src/vendor/preact-htm.js");
let html = vendor.html;

const data = {
  version: "fixture", userName: "Fixture User", assistantName: "Fixture Agent",
  composeUploadLimitMb: 32, workspaceUploadLimitMb: 256, scopedModelsOnly: false,
  widgetToken: "fixture-token-not-a-credential", instanceTotp: { configured: false },
  models: [], model_options: [], providers: [], toolsets: [],
};
let entries = [{ name: "fixture/entry", type: "token", envVar: "FIXTURE_ENTRY", updatedAt: "2026-01-01T12:00:00Z", userNote: "", agentNote: "" }];
window.fetch = async (input, init) => {
  const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (path === "/agent/settings-data") return Response.json(data);
  if (path === "/agent/keychain") {
    if (init?.method === "POST") {
      if (body.name === "fail") return Response.json({ ok: false, error: "Fixture save failed" }, { status: 400 });
      entries = [...entries, { name: body.name, type: body.type, envVar: "FIXTURE_SAVED", updatedAt: "2026-01-01T12:00:00Z", userNote: "", agentNote: "" }];
    }
    return Response.json({ ok: true, entries });
  }
  if (path === "/agent/keychain/reveal") return Response.json({ ok: false, needs_master_password: true });
  if (path.startsWith("/agent/settings/")) return Response.json({ ok: true, settings: { ...data, ...body } });
  if (path === "/agent/addons/api/sample-addon/config") return Response.json({ ok: true, config: { enabled: true, greeting: "Fixture greeting", secret_keychain: "sample-addon/api-key" } });
  if (path === "/agent/addons/api/delegate/models" || path === "/agent/addons/api/delegate/config") {
    return Response.json({ ok: true, config: { searchable_providers: [], excluded_providers: ["fixture"], excluded_models: [] }, providers: [{ provider: "fixture", modelCount: 20, defaultExcluded: false }, { provider: "fixture-other", modelCount: 2, defaultExcluded: false }],
      candidates: Array.from({ length: 20 }, (_, i) => ({ provider: "fixture", id: `fixture-model-${i}`, model: `fixture-model-${i}`, name: `Fixture ${i}`, tier: "standard", contextWindow: 32000 })),
      rejected_models: Array.from({ length: 10 }, (_, i) => ({ provider: "fixture", fullId: `fixture/rejected-${i}`, rejection_reason: "not_approved" })),
      effective_exclusions: { providers: [], models: [] }, cache: {}, runtime_catalog: {}, executable_catalog: {},
    });
  }
  if (path.includes("/message")) return Response.json({ command: { status: "success", message: "Saved" } });
  return Response.json({ ok: true, entries: [], items: [] });
};

function Controls({ addon = false }) {
  const row = addon ? "settings-addon-field" : "settings-row settings-row-vertical";
  const control = addon ? "settings-addon-control" : "";
  const label = addon ? "settings-addon-label" : "";
  return html`<section class=${addon ? "settings-addon-section" : "settings-section settings-panel__section"}>
    <h3>Control contract</h3>
    ${["text", "search", "password", "number", "url"].map(type => html`<div class=${row}>
      <label class=${label} for=${`contract-${type}`}>${type}</label>
      <input id=${`contract-${type}`} class=${control} type=${type} placeholder=${`${type} value`} value=${type === "number" ? "12" : ""} />
    </div>`)}
    <div class=${row}><label class=${label} for="contract-select">Select</label><select id="contract-select" class=${addon ? control : "settings-keychain-select"}><option>First</option><option>Second</option></select></div>
    <div class=${row}><label class=${label} for="contract-textarea">Notes</label><textarea id="contract-textarea" class=${control} rows="2" placeholder="Notes"></textarea></div>
    <div class=${row}><label class=${label} for="contract-disabled">Disabled</label><input id="contract-disabled" class=${control} type="text" value="Disabled value" disabled /></div>
    <div class=${row}><label class=${label} for="contract-readonly">Read only</label><input id="contract-readonly" class=${control} type="text" value="Read only value" readonly /></div>
    <div class=${row}><label class=${label} for="contract-invalid">Invalid</label><input id="contract-invalid" class=${control} type="text" aria-invalid="true" aria-describedby="contract-error" value="Bad value" /><span id="contract-error" class="settings-addon-error" role="alert">Invalid fixture value</span></div>
    <label><input id="contract-checkbox" type="checkbox" /> Enable fixture</label>
    <div class=${addon ? "settings-addon-actions" : "settings-row"}><button type="button" class=${""}>Save fixture</button><button type="button" disabled>Disabled action</button></div>
  </section>`;
}

const root = document.getElementById("app")!;
{
  const { registerSettingsPane } = await import("../../../web/src/components/settings/pane-registry.js");
  const { requestOpenSettingsDialog } = await import("../../../web/src/components/settings-dialog-events.js");
  const { SettingsDialogContent } = await import("../../../web/src/components/settings-dialog.js");
  registerSettingsPane({ id: "contract", label: "Contract", component: () => html`<${Controls} addon />`, icon: null });
  if (["sample-addon", "delegate"].includes(section)) {
    Object.assign(globalThis, { __piclawPreactHtm: vendor, __piclawSettingsPaneRegistry: { registerSettingsPane, notifySettingsPanesChanged() {} } });
    const entry = `/addon/${section}/index.ts`;
    await import(entry);
  }
  requestOpenSettingsDialog({ section });
  vendor.render(html`<${SettingsDialogContent} onClose=${() => {}} />`, root);
}
