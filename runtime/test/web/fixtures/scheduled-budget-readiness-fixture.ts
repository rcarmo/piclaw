// Mount the real Settings hosts/sections; the test supplies every API response.

const root = document.getElementById("app")!;

{
  const { html, render } =
    await import("../../../web/src/vendor/preact-htm.js");
  const { requestOpenSettingsDialog } =
    await import("../../../web/src/components/settings-dialog-events.js");
  const { SettingsDialogContent } =
    await import("../../../web/src/components/settings-dialog.js");
  requestOpenSettingsDialog({ section: "scheduled-tasks" });
  render(html`<${SettingsDialogContent} onClose=${() => {}} />`, root);
}
