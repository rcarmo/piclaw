import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { getMessageUrl } from "../../api/chat-jid";
import { type SettingsData, type SettingsSectionProps } from "./types";
import { registerSettingsPane } from "./pane-registry";

interface ModelOption {
  label: string;
  name: string;
  provider: string;
  context_window?: number;
  reasoning?: boolean;
}

interface ModelsResponse {
  current?: string;
  thinking_level?: string;
  model_options?: ModelOption[];
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"];

export function ModelsSection({ data: _data }: { data: SettingsData }) {
  const models = useSignal<ModelOption[]>([]);
  const current = useSignal("");
  const thinkingLevel = useSignal("medium");
  const filter = useSignal("");
  const loading = useSignal(true);
  const loadError = useSignal<string | null>(null);
  const switching = useSignal(false);

  const fetchModels = async () => {
    loading.value = true;
    loadError.value = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch("/agent/models", { credentials: "same-origin", signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) {
        loadError.value = `Failed to load models (HTTP ${res.status})`;
        loading.value = false;
        return;
      }
      const d = await res.json() as ModelsResponse;
      current.value = d.current ?? "";
      thinkingLevel.value = d.thinking_level ?? "medium";
      models.value = d.model_options ?? [];
      loadError.value = null;
    } catch (err: any) {
      loadError.value = err?.name === "AbortError" ? "Models request timed out" : "Failed to load models";
    } finally {
      loading.value = false;
    }
  };

  useEffect(() => { fetchModels(); }, []);

  const sendCommand = async (cmd: string): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(getMessageUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ content: cmd }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  };

  const switchModel = async (label: string) => {
    const prev = current.value;
    current.value = label;
    switching.value = true;
    const ok = await sendCommand(`/model ${label}`);
    switching.value = false;
    if (!ok) {
      current.value = prev;
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Model switch failed", type: "error" } }));
    }
  };

  const switchThinking = async (level: string) => {
    const prev = thinkingLevel.value;
    thinkingLevel.value = level;
    switching.value = true;
    const ok = await sendCommand(`/thinking ${level}`);
    switching.value = false;
    if (!ok) {
      thinkingLevel.value = prev;
      window.dispatchEvent(new CustomEvent("piclaw:status-flash", { detail: { message: "Thinking level change failed", type: "error" } }));
    }
  };

  const filtered = filter.value
    ? models.value.filter(m => m.name.toLowerCase().includes(filter.value.toLowerCase()) || m.provider.toLowerCase().includes(filter.value.toLowerCase()))
    : models.value;

  return (
    <section className="settings-panel__section settings-panel__section--models">
      <h2 className="settings-panel__section-title">Models</h2>

      {loading.value && !models.value.length && (
        <p className="settings-panel__description">Loading models...</p>
      )}
      {loadError.value && (
        <div className="settings-panel__save-status settings-panel__save-status--error">
          {loadError.value}
          <button type="button" className="settings-panel__provider-btn" onClick={fetchModels} style="margin-left:8px">Retry</button>
        </div>
      )}

      <input
        className="settings-panel__input settings-panel__model-filter"
        type="text"
        placeholder="Filter models..."
        value={filter.value}
        onInput={(e) => (filter.value = (e.target as HTMLInputElement).value)}
      />

      <p className="settings-panel__description">Model and provider names may wrap in narrow panes to avoid clipping.</p>

      <div className="settings-panel__model-table-wrapper">
        <table className="settings-panel__table settings-panel__model-table">
          <thead>
            <tr>
              <th></th>
              <th>Model</th>
              <th>Provider</th>
              <th>Context</th>
              <th>Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(m => (
              <tr
                key={m.label}
                tabIndex={0}
                onClick={() => switchModel(m.label)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchModel(m.label); } }}
                className={`${m.label === current.value ? "settings-panel__model-table-row--active" : ""} settings-panel__model-table-row`}
              >
                <td>
                  <input type="radio" name="model" checked={m.label === current.value} readOnly />
                </td>
                <td>{m.name}</td>
                <td>{m.provider}</td>
                <td>{m.context_window ? `${Math.round(m.context_window / 1000)}K` : "—"}</td>
                <td>{m.reasoning ? "🧠" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="settings-panel__subsection-title settings-panel__subsection-title--spaced">Thinking level: <strong>{thinkingLevel.value}</strong></h3>

      <div className="settings-panel__thinking-slider">
        <input
          type="range"
          min={0}
          max={4}
          value={THINKING_LEVELS.indexOf(thinkingLevel.value)}
          onInput={(e) => switchThinking(THINKING_LEVELS[Number((e.target as HTMLInputElement).value)])}
          className="settings-panel__thinking-range"
        />
        <div className="settings-panel__thinking-labels">
          {THINKING_LEVELS.map((l) => (
            <span
              key={l}
              className={`settings-panel__thinking-label${l === thinkingLevel.value ? " settings-panel__thinking-label--active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => switchThinking(l)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchThinking(l); } }}
            >
              {l.charAt(0).toUpperCase() + l.slice(1)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

registerSettingsPane({
  id: "models",
  label: "Models",
  icon: <i className="codicon codicon-hubot" />,
  order: 40,
  component: ({ data }: SettingsSectionProps) => <ModelsSection data={data} />,
});
