import { useState, useEffect, useCallback } from "preact/hooks";
import { registerSettingsPane } from "./pane-registry";

interface EnvVariable {
  name: string;
  value: string;
  overridden: boolean;
  source: "override" | "process";
}

interface EnvironmentData {
  variables: EnvVariable[];
  overrides: Record<string, string>;
  keychainEnvNames: string[];
  count: number;
  overrideCount: number;
}

export function EnvironmentSection() {
  const [data, setData] = useState<EnvironmentData | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [filter, setFilter] = useState("");
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingVar, setEditingVar] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/agent/settings/environment", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.settings ?? json);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSaveOverride = async (name: string, value: string) => {
    setBusy(true);
    try {
      const res = await fetch("/agent/settings/environment", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, value, action: "set" }),
      });
      if (!res.ok) throw new Error("Save failed");
      const json = await res.json();
      setData(json.settings ?? json);
      setEditingVar(null);
      setNewName("");
      setNewValue("");
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async (name: string) => {
    setBusy(true);
    try {
      const res = await fetch("/agent/settings/environment", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, action: "clear" }),
      });
      if (!res.ok) throw new Error("Clear failed");
      const json = await res.json();
      setData(json.settings ?? json);
    } finally {
      setBusy(false);
    }
  };

  if (status === "loading") return <div className="env-section__empty">Loading environment…</div>;
  if (status === "error") return <div className="env-section__empty">Failed to load. <button onClick={fetchData}>Retry</button></div>;
  if (!data) return null;

  const filtered = data.variables.filter((v) =>
    !filter || v.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="env-section">
      <div className="env-section__header">
        <input
          type="text"
          className="env-section__filter"
          placeholder="Filter environment…"
          value={filter}
          onInput={(e) => setFilter((e.target as HTMLInputElement).value)}
        />
        <button className="env-section__refresh" onClick={fetchData} title="Refresh">↻</button>
      </div>

      <p className="env-section__desc">
        Non-keychain environment variables. Overrides are applied to <code>process.env</code> for tool calls.
      </p>

      {/* Add override form */}
      <div className="env-section__add-form">
        <input
          type="text"
          className="env-section__add-name"
          placeholder="VARIABLE_NAME"
          value={newName}
          onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
        />
        <input
          type="text"
          className="env-section__add-value"
          placeholder="value"
          value={newValue}
          onInput={(e) => setNewValue((e.target as HTMLInputElement).value)}
        />
        <button
          className="env-section__add-btn"
          disabled={busy || !newName.trim()}
          onClick={() => handleSaveOverride(newName.trim(), newValue)}
        >
          Save
        </button>
      </div>

      <div className="env-section__stats">
        {data.count} variables • {data.overrideCount} overrides • {data.keychainEnvNames.length} keychain-injected hidden
      </div>

      {/* Variable list */}
      <div className="env-section__list">
        {filtered.map((v) => (
          <div key={v.name} className={`env-section__row${v.overridden ? " env-section__row--overridden" : ""}`}>
            <span className="env-section__var-name">{v.name}</span>
            {editingVar === v.name ? (
              <input
                type="text"
                className="env-section__var-input"
                value={editValue}
                onInput={(e) => setEditValue((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveOverride(v.name, editValue); if (e.key === "Escape") setEditingVar(null); }}
                autoFocus
              />
            ) : (
              <span
                className="env-section__var-value"
                onClick={() => { setEditingVar(v.name); setEditValue(v.value); }}
                title="Click to edit"
              >
                {v.value || <em className="env-section__empty-val">(empty)</em>}
              </span>
            )}
            <span className={`env-section__source env-section__source--${v.source}`}>{v.source}</span>
            {editingVar === v.name && (
              <button className="env-section__save-btn" disabled={busy} onClick={() => handleSaveOverride(v.name, editValue)}>Save</button>
            )}
            {v.overridden && editingVar !== v.name && (
              <button className="env-section__clear-btn" disabled={busy} onClick={() => handleClear(v.name)}>Clear</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

registerSettingsPane({
  id: "environment",
  label: "Environment",
  icon: <i className="codicon codicon-symbol-variable" />,
  order: 30,
  component: () => <EnvironmentSection />,
});
