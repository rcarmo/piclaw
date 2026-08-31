import { useEffect, useRef, useState } from "preact/hooks";
import { useSignal } from "@preact/signals";

import { type SettingsData } from "./settings/types";
import { safeGetItem, safeSetItem } from "../utils/storage";
import { getRegisteredPanes, type SettingsPaneDefinition } from "./settings/pane-registry";
import { mergeSavedSettings, SettingsSaveGeneration } from "./settings/save-state";

// Import all built-in sections so their registerSettingsPane() calls execute
import "./settings/GeneralSection";
import "./settings/SessionsSection";
import "./settings/RecordingsSection";
import "./settings/CompactionSection";
import "./settings/WorkspaceSection";
import "./settings/EnvironmentSection";
import "./settings/ProvidersSection";
import "./settings/ModelsSection";
import "./settings/AppearanceSection";
import "./settings/KeychainSection";
import "./settings/AuthenticationSection";
import "./settings/ToolsSection";

/** Safely render any pane component (built-in or addon); shows an error state if it throws. */
function PaneRenderer({
  pane,
  data,
  saveSetting,
}: {
  pane: SettingsPaneDefinition;
  data: SettingsData;
  saveSetting: (endpoint: string, field: string, value: unknown) => Promise<void>;
}) {
  const [renderError, setRenderError] = useState<string | null>(null);

  if (renderError) {
    return (
      <div className="settings-panel__addon-error">
        <p>Failed to render pane "{pane.label}": {renderError}</p>
      </div>
    );
  }

  if (typeof pane.component !== "function") {
    return (
      <div className="settings-panel__addon-error">
        <p>Pane "{pane.label}" did not provide a valid component.</p>
      </div>
    );
  }

  try {
    const Comp = pane.component as (props: {
      data: SettingsData;
      saveSetting: (endpoint: string, field: string, value: unknown) => Promise<void>;
      filter?: string;
    }) => unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return <>{Comp({ data, saveSetting }) as any}</>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    Promise.resolve().then(() => setRenderError(msg));
    return <div className="settings-panel__addon-loading">Loading…</div>;
  }
}

export function SettingsPanel() {
  const activeCategory = useSignal<string>(safeGetItem("piclaw-settings-category") || "general");
  const settings = useSignal<SettingsData>({});
  const loading = useSignal(true);
  const error = useSignal<string | null>(null);
  const saveStatus = useSignal<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveGeneration = useRef(new SettingsSaveGeneration());

  // Re-render when panes register/unregister
  const [allPanes, setAllPanes] = useState<SettingsPaneDefinition[]>(() => getRegisteredPanes());

  useEffect(() => {
    const handler = () => setAllPanes(getRegisteredPanes());
    window.addEventListener("piclaw:settings-panes-changed", handler);
    return () => window.removeEventListener("piclaw:settings-panes-changed", handler);
  }, []);

  useEffect(() => {
    const onOpenSettings = (event: Event) => {
      const section = (event as CustomEvent<{ section?: string }>).detail?.section;
      if (!section || !getRegisteredPanes().some((pane) => pane.id === section)) return;
      activeCategory.value = section;
      safeSetItem("piclaw-settings-category", section);
    };
    window.addEventListener("piclaw:open-settings", onOpenSettings);
    return () => window.removeEventListener("piclaw:open-settings", onOpenSettings);
  }, [activeCategory]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/agent/settings-data", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Load failed");
        const data: SettingsData = await res.json();
        settings.value = data;
      } catch (err: unknown) {
        error.value = `Failed to load settings: ${err instanceof Error ? err.message : String(err)}`;
        settings.value = {};
      } finally {
        loading.value = false;
      }
    })();
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function showSaved(msg = "Saved ✓") {
    saveStatus.value = msg;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => (saveStatus.value = null), 2000);
  }

  function showError(msg = "Save failed") {
    saveStatus.value = msg;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => (saveStatus.value = null), 3000);
  }

  async function saveSetting(endpoint: string, field: string, value: unknown) {
    const generation = saveGeneration.current.begin(endpoint, field);
    try {
      const res = await fetch(`/agent/settings/${endpoint}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error("Save failed");
      const body: { settings?: SettingsData } = await res.json();
      if (!saveGeneration.current.isCurrent(endpoint, field, generation)) return;
      if (body.settings) {
        settings.value = mergeSavedSettings(settings.value, endpoint, field, body.settings);
      }
      showSaved();
    } catch {
      if (saveGeneration.current.isCurrent(endpoint, field, generation)) showError();
    }
  }

  if (loading.value) {
    return (
      <div className="settings-panel">
        <div className="settings-panel__loading">Loading settings…</div>
      </div>
    );
  }

  // Split panes: built-in (order < 100) vs addon (order >= 100)
  const builtinPanes = allPanes.filter(p => (p.order ?? 500) < 100);
  const addonPanes = allPanes.filter(p => (p.order ?? 500) >= 100);

  const activePane = allPanes.find(p => p.id === activeCategory.value)
    ?? allPanes[0];

  const s = settings.value;

  return (
    <div className="settings-panel">
      {/* Left nav */}
      <nav className="settings-panel__nav">
        {builtinPanes.map((pane) => (
          <button
            key={pane.id}
            className={`settings-panel__nav-item${activeCategory.value === pane.id ? " settings-panel__nav-item--active" : ""}`}
            onClick={() => { activeCategory.value = pane.id; safeSetItem("piclaw-settings-category", pane.id); }}
          >
            <span className="settings-panel__nav-icon">{typeof pane.icon === "string" && pane.icon.trim().startsWith("<") ? <span dangerouslySetInnerHTML={{ __html: pane.icon }} /> : pane.icon as never}</span>
            <span>{pane.label}</span>
          </button>
        ))}
        {/* Separator between built-in and addon panes */}
        {addonPanes.length > 0 && <hr className="settings-panel__nav-separator" />}
        {addonPanes.map((pane) => (
          <button
            key={pane.id}
            className={`settings-panel__nav-item settings-panel__nav-item--addon${activeCategory.value === pane.id ? " settings-panel__nav-item--active" : ""}`}
            onClick={() => { activeCategory.value = pane.id; safeSetItem("piclaw-settings-category", pane.id); }}
          >
            <span className="settings-panel__nav-icon">{typeof pane.icon === "string" && pane.icon.trim().startsWith("<") ? <span dangerouslySetInnerHTML={{ __html: pane.icon }} /> : pane.icon as never}</span>
            <span>{pane.label}</span>
          </button>
        ))}
      </nav>

      {/* Right content */}
      <div className="settings-panel__content">
        {error.value && (
          <div className="settings-panel__error">{error.value}</div>
        )}
        {saveStatus.value && (
          <div className="settings-panel__save-status">{saveStatus.value}</div>
        )}

        {activePane && (
          <PaneRenderer pane={activePane} data={s} saveSetting={saveSetting} />
        )}
      </div>
    </div>
  );
}
