import { useSignal } from "@preact/signals";
import { type SettingsData, type SettingsSectionProps } from "./types";
import { NumberStepper } from "./NumberStepper";
import { registerSettingsPane } from "./pane-registry";
import { CustomSelect } from "../../components/CustomSelect";

export function SessionsSection({
  data,
  onSaveGeneral,
}: {
  data: SettingsData;
  onSaveGeneral: (field: string, value: unknown) => void;
}) {
  const sessionMaxSizeMb = useSignal(data.sessionMaxSizeMb ?? 0);
  const toolUseBudget = useSignal(data.toolUseBudget ?? 0);

  return (
    <section className="settings-panel__section">
      <h2 className="settings-panel__section-title">Sessions</h2>

      <h3 className="settings-panel__subsection-title">Session Lifecycle</h3>

      <div className="settings-panel__field settings-panel__checkbox-row">
        <input
          id="sessionAutoRotate"
          type="checkbox"
          checked={data.sessionAutoRotate ?? false}
          onChange={(e) =>
            onSaveGeneral("sessionAutoRotate", (e.target as HTMLInputElement).checked)
          }
        />
        <label htmlFor="sessionAutoRotate" className="settings-panel__label">
          Auto-rotate sessions
        </label>
        <span className="settings-panel__description">Automatically start new session when context is full</span>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Max session size (MB)</label>
        <div className="settings-panel__field-content">
          <NumberStepper value={sessionMaxSizeMb} min={1} max={500} onSave={(v) => onSaveGeneral("sessionMaxSizeMb", v)} />
          <span className="settings-panel__description">Maximum session context size before auto-compaction</span>
        </div>
      </div>

      <h3 className="settings-panel__subsection-title">Agent Behaviour</h3>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Tool use budget</label>
        <div className="settings-panel__field-content">
          <NumberStepper value={toolUseBudget} min={0} max={200} onSave={(v) => onSaveGeneral("toolUseBudget", v)} />
          <span className="settings-panel__description">Max tool-call messages per turn</span>
        </div>
      </div>

      <div className="settings-panel__field">
        <label className="settings-panel__label">Session isolation</label>
        <div className="settings-panel__field-content">
          <CustomSelect
            value={data.sessionIsolation ?? "none"}
            options={[
              { value: "none", label: "None — full cross-session visibility" },
              { value: "summary", label: "Summary" },
              { value: "full", label: "Full" },
            ]}
            onChange={(val) => onSaveGeneral("sessionIsolation", val)}
          />
          <span className="settings-panel__description">Controls visibility between sessions</span>
        </div>
      </div>
    </section>
  );
}

registerSettingsPane({
  id: "sessions",
  label: "Sessions",
  icon: <i className="codicon codicon-terminal-bash" />,
  order: 12,
  component: ({ data, saveSetting }: SettingsSectionProps) => (
    <SessionsSection data={data} onSaveGeneral={(field, value) => saveSetting("general", field, value)} />
  ),
});
