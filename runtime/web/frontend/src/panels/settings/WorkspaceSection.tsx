import { useSignal } from "@preact/signals";
import { type SettingsData, type SettingsSectionProps } from "./types";
import { NumberStepper } from "./NumberStepper";
import { registerSettingsPane } from "./pane-registry";

export function WorkspaceSection({
  data,
  onSaveWorkspace,
}: {
  data: SettingsData;
  onSaveWorkspace: (field: string, value: unknown) => void;
}) {
  const ws = data.workspaceSettings ?? {};
  const treeMaxDepth = useSignal(ws.treeMaxDepth ?? 4);
  const treeMaxEntries = useSignal(ws.treeMaxEntries ?? 5000);

  return (
    <section className="settings-panel__section">
      <h2 className="settings-panel__section-title">Workspace</h2>

      <h3 className="settings-panel__subsection-title">Access</h3>

      <div className="settings-panel__field settings-panel__checkbox-row">
        <input
          id="ws-webTerminalEnabled"
          type="checkbox"
          checked={ws.webTerminalEnabled ?? false}
          onChange={(e) =>
            onSaveWorkspace("webTerminalEnabled", (e.target as HTMLInputElement).checked)
          }
        />
        <label htmlFor="ws-webTerminalEnabled" className="settings-panel__label">
          Enable web terminal
        </label>
      </div>

      <div className="settings-panel__field settings-panel__checkbox-row">
        <input
          id="ws-vncAllowDirect"
          type="checkbox"
          checked={ws.vncAllowDirect ?? false}
          onChange={(e) =>
            onSaveWorkspace("vncAllowDirect", (e.target as HTMLInputElement).checked)
          }
        />
        <label htmlFor="ws-vncAllowDirect" className="settings-panel__label">
          Allow direct VNC targets
        </label>
      </div>

      <p className="settings-panel__description">Terminal access updates immediately. Direct VNC target policy applies to new VNC requests.</p>

      <h3 className="settings-panel__subsection-title">Server scan guardrails</h3>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Max tree depth</label>
        <NumberStepper value={treeMaxDepth} min={1} max={50} onSave={(v) => onSaveWorkspace("treeMaxDepth", v)} />
        <span className="settings-panel__description">caps all <code>/workspace/tree</code> requests</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Max entries per scan</label>
        <NumberStepper value={treeMaxEntries} min={50} max={10000} step={50} onSave={(v) => onSaveWorkspace("treeMaxEntries", v)} />
        <span className="settings-panel__description">truncate oversized tree walks earlier</span>
      </div>


    </section>
  );
}

registerSettingsPane({
  id: "workspace",
  label: "Workspace",
  icon: <i className="codicon codicon-folder" />,
  order: 25,
  component: ({ data, saveSetting }: SettingsSectionProps) => (
    <WorkspaceSection data={data} onSaveWorkspace={(field, value) => saveSetting("workspace", field, value)} />
  ),
});
