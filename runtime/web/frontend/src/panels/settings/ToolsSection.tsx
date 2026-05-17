import { useSignal, useComputed } from "@preact/signals";
import { type SettingsData, type Toolset, type Tool, type SettingsSectionProps } from "./types";
import { registerSettingsPane } from "./pane-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindIcon(kind?: string): string {
  if (kind === "read-only") return "🔍";
  if (kind === "mutating") return "✏️";
  if (kind === "mixed") return "🔄";
  return "🔵";
}

/** Derived from registerTool calls in the runtime — mirrors upstream tools.ts */
const TOOL_EXTENSION: Record<string, string> = {
  read: "pi-core", write: "pi-core", edit: "pi-core", bash: "pi-core", powershell: "pi-core",
  find: "pi-core", grep: "pi-core", ls: "pi-core",
  list_tools: "internal-tools", list_internal_tools: "internal-tools",
  activate_tools: "tool-activation", reset_active_tools: "tool-activation",
  list_scripts: "runtime-scripts",
  attach_file: "file-attachments", read_attachment: "file-attachments", export_attachment: "file-attachments",
  get_model_state: "model-control", list_models: "model-control", switch_model: "model-control", switch_thinking: "model-control",
  messages: "messages-crud", introspect_sql: "sql-introspect", keychain: "keychain-tools",
  search_workspace: "workspace-search", refresh_workspace_index: "workspace-search",
  open_office_viewer: "office-viewer", office_read: "office-viewer", office_write: "office-viewer",
  open_workspace_file: "open-workspace-file", image_process: "image-processing",
  schedule_task: "scheduled-tasks", scheduled_tasks: "scheduled-tasks",
  bun_run: "bun-runner", exec_batch: "exec-batch", search_tool_output: "search-tool-output",
  ssh: "ssh", proxmox: "proxmox", portainer: "portainer", mcp: "mcp",
  cdp_browser: "cdp-browser",
  send_adaptive_card: "send-adaptive-card", send_dashboard_widget: "send-dashboard-widget",
  start_autoresearch: "autoresearch", stop_autoresearch: "autoresearch", autoresearch_status: "autoresearch",
  exit_process: "exit-process", env: "env-tools",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ToolsSection({
  data,
  saveSetting,
}: {
  data: SettingsData;
  saveSetting: (endpoint: string, field: string, value: unknown) => Promise<void>;
}) {
  const toolsets = data.toolsets ?? [];

  // ── filter / search ──────────────────────────────────────────────────────
  const filter = useSignal("");
  const searchMatchMode = useSignal<"or" | "and">(data.searchMatchMode ?? "or");

  // ── collapse ─────────────────────────────────────────────────────────────
  const collapsed = useSignal<Record<string, boolean>>({});
  const toggleCollapse = (name: string) => {
    collapsed.value = { ...collapsed.value, [name]: !collapsed.value[name] };
  };

  // ── group enable (local UI state; persisted to API when backend supports it) ──
  const enabledGroups = useSignal<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {};
    for (const g of toolsets) m[g.name] = true;
    return m;
  });
  const toggleGroup = (name: string) => {
    enabledGroups.value = { ...enabledGroups.value, [name]: !enabledGroups.value[name] };
  };

  // ── compaction tools ─────────────────────────────────────────────────────
  const compactTools = useSignal<string[]>(
    Array.isArray(data.toolResultCompactionTools) ? data.toolResultCompactionTools : []
  );
  const compactSet = useComputed(() => new Set(compactTools.value.map(n => n.trim().toLowerCase())));

  const toggleCompact = async (toolName: string) => {
    const key = toolName.trim().toLowerCase();
    if (!key) return;
    const next = new Set(compactSet.value);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    const arr = Array.from(next).sort();
    compactTools.value = arr;
    try {
      await saveSetting("compaction", "toolResultCompactionTools", arr);
    } catch (e) {
      console.warn("[settings/tools] Failed to save compaction tools", e);
    }
  };

  // ── search match mode ─────────────────────────────────────────────────────
  const toggleMatchMode = async () => {
    const next = searchMatchMode.value === "or" ? "and" : "or";
    searchMatchMode.value = next;
    try {
      await saveSetting("general", "searchMatchMode", next);
    } catch (e) {
      console.warn("[settings/tools] Failed to save searchMatchMode", e);
    }
  };

  // ── filtered toolsets ─────────────────────────────────────────────────────
  const filteredToolsets = useComputed<Toolset[]>(() => {
    const raw = filter.value.trim().toLowerCase();
    if (!raw) return toolsets;
    const keywords = raw.split(/\s+/).filter(Boolean);
    return toolsets.map(ts => ({
      ...ts,
      tools: (ts.tools ?? []).filter((t: Tool) => {
        const haystack = `${t.name} ${t.description ?? ""} ${t.summary ?? ""}`.toLowerCase();
        return searchMatchMode.value === "and"
          ? keywords.every(k => haystack.includes(k))
          : keywords.some(k => haystack.includes(k));
      }),
    })).filter(ts => (ts.tools ?? []).length > 0);
  });

  return (
    <section className="settings-panel__section settings-panel__section--narrow">
      <h2 className="settings-panel__section-title">Tools</h2>

      {/* ── search bar + match-mode toggle ── */}
      <div className="settings-panel__tools-filter-row">
        <input
          className="settings-panel__input settings-panel__tools-filter"
          type="text"
          placeholder="Filter tools…"
          value={filter.value}
          onInput={(e) => (filter.value = (e.target as HTMLInputElement).value)}
        />
        <label className="settings-panel__tools-match-mode" title="Toggle AND / OR keyword matching">
          <input
            type="checkbox"
            checked={searchMatchMode.value === "and"}
            onChange={toggleMatchMode}
          />
          {searchMatchMode.value === "and" ? "All keywords (AND)" : "Any keyword (OR)"}
        </label>
      </div>

      {/* ── toolset groups ── */}
      {filteredToolsets.value.map((ts: Toolset) => {
        const isCollapsed = collapsed.value[ts.name] ?? false;
        const isEnabled = enabledGroups.value[ts.name] !== false;
        const tools = ts.tools ?? [];
        return (
          <div key={ts.name} className="settings-panel__toolset">
            {/* group header */}
            <div className="settings-panel__toolset-header">
              <span
                className="settings-panel__toolset-toggle"
                role="button"
                tabIndex={0}
                onClick={() => toggleCollapse(ts.name)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCollapse(ts.name); }
                }}
                aria-label={isCollapsed ? "Expand" : "Collapse"}
              >
                {isCollapsed ? "▶" : "▼"}
              </span>
              <input
                type="checkbox"
                checked={isEnabled}
                className="settings-panel__toolset-checkbox"
                title={isEnabled ? "Disable group" : "Enable group"}
                onChange={() => toggleGroup(ts.name)}
                style={{ display: 'none' }}
              />
              <strong className="settings-panel__toolset-name">{ts.name}</strong>
              <span className="settings-panel__toolset-count">({tools.length})</span>
              <span className="settings-panel__toolset-desc">{ts.description ?? ""}</span>
            </div>

            {/* tool rows */}
            {!isCollapsed && (
              <div className="settings-panel__toolset-tools">
                {/* column headers */}
                <div className="settings-panel__tool-row settings-panel__tool-row--header">
                  <span className="settings-panel__tool-col-enabled">ENABLED</span>
                  <span className="settings-panel__tool-name">TOOL</span>
                  <span className="settings-panel__tool-col-compact">COMPACT</span>
                  <span className="settings-panel__tool-kind">KIND</span>
                  <span className="settings-panel__tool-desc">SUMMARY</span>
                  <span className="settings-panel__tool-source">SOURCE</span>
                </div>

                {tools.map((t: Tool) => {
                  const key = t.name.trim().toLowerCase();
                  const compactChecked = compactSet.value.has(key);
                  const source = TOOL_EXTENSION[t.name] ?? ts.name;
                  return (
                    <div key={t.name} className="settings-panel__tool-row">
                      {/* enabled */}
                      <span className="settings-panel__tool-col-enabled">
                        <input
                          type="checkbox"
                          checked={true}
                          disabled
                          className="settings-panel__tool-checkbox"
                        />
                      </span>

                      {/* name */}
                      <span className="settings-panel__tool-name">{t.name}</span>

                      {/* compact */}
                      <span className="settings-panel__tool-col-compact">
                        <input
                          type="checkbox"
                          checked={compactChecked}
                          className="settings-panel__tool-checkbox"
                          title={compactChecked ? "Disable compaction for this tool" : "Enable compaction for this tool"}
                          onChange={() => toggleCompact(t.name)}
                        />
                      </span>

                      {/* kind */}
                      <span className="settings-panel__tool-kind" title={t.kind ?? "unknown"}>
                        {kindIcon(t.kind)}
                      </span>

                      {/* summary */}
                      <span className="settings-panel__tool-desc">
                        {(() => {
                          const s = t.description ?? t.summary ?? "";
                          return s.length > 70 ? s.slice(0, 70) + "…" : s;
                        })()}
                      </span>

                      {/* source */}
                      <span className="settings-panel__tool-source">{source}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {filteredToolsets.value.length === 0 && filter.value && (
        <p className="settings-panel__description settings-panel__description--spaced">
          No tools match "{filter.value}"
        </p>
      )}

      <p className="settings-panel__description settings-panel__description--spaced">
        Tool activation is managed by the agent runtime. The <strong>Compact</strong> column controls tool-result compaction eligibility.
      </p>
    </section>
  );
}

registerSettingsPane({
  id: "tools",
  label: "Tools",
  icon: <i className="codicon codicon-tools" />,
  order: 80,
  component: ({ data, saveSetting }: SettingsSectionProps) => (
    <ToolsSection data={data} saveSetting={saveSetting!} />
  ),
});
