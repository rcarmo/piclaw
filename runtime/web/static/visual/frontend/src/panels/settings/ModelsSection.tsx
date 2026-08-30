import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getChatJid } from "../../api/chat-jid";
import { type SettingsData, type SettingsSectionProps } from "./types";
import { registerSettingsPane } from "./pane-registry";
import {
  describeModelContextFit,
  formatModelCatalogueContextWindow,
  formatModelCataloguePricing,
  normaliseModelCatalogue,
  type ModelCatalogueEntry,
} from "../../../../../../src/ui/model-catalogue";
import {
  MODEL_CATALOGUE_PREFERENCES_EVENT,
  normalizeModelCataloguePreferenceKey,
  readModelCataloguePreferences,
  recordRecentModelKey,
  setModelCataloguePreferenceSort,
  toModelCatalogueNormalisePreferences,
  togglePinnedModelKey,
  type StoredModelCataloguePreferences,
} from "../../../../../../src/ui/model-catalogue-preferences";
import {
  buildModelSettingsProjection,
  collectModelSettingsFacets,
  formatModelCataloguePrice,
  formatModelLastUsed,
  moveModelSettingsActiveKey,
} from "../../../../../../src/ui/model-settings-catalogue";

interface ProviderDiagnostic {
  provider: string;
  model_count: number;
  available_model_count: number;
  auth_configured: boolean;
  auth_source?: string | null;
}

interface ModelsResponse {
  current?: string | null;
  model?: string | null;
  thinking_level?: string | null;
  model_options?: unknown[];
  models?: string[];
  provider_usage?: Record<string, unknown> | null;
  scoped_models_only?: boolean;
  scoped_model_filter_active?: boolean;
  enabled_model_patterns?: string[];
  provider_diagnostics?: {
    providers?: ProviderDiagnostic[];
    composition_error?: string | null;
  };
}

interface ContextResponse { tokens?: number | null }

type FilterState = {
  provider: string;
  publisher: string;
  family: string;
  contextFit: string;
  reasoning: string;
  variant: string;
  sort: "recommended" | "name" | "context" | "input-price" | "output-price";
};

const optionId = (key: string) => `visual-settings-model-option-${encodeURIComponent(key)}`;
const defaultFilters = (sort: FilterState["sort"]): FilterState => ({
  provider: "", publisher: "", family: "", contextFit: "all", reasoning: "all", variant: "", sort,
});

async function fetchJson<T>(url: string, options: RequestInit = {}, timeoutMs = 10_000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: "same-origin", ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) throw new Error(payload?.error || `Request failed (HTTP ${response.status})`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function contextFitText(entry: ModelCatalogueEntry): string {
  if (entry.contextFit.state === "blocked") return describeModelContextFit(entry);
  if (entry.contextFit.state === "unknown") {
    return entry.contextFit.currentTokens == null
      ? "Current chat context is unavailable, so compatibility is unknown."
      : "This model does not publish a usable context limit, so compatibility is unknown.";
  }
  return `Fits: about ${entry.contextFit.safetyAdjustedTokens?.toLocaleString() ?? "unknown"} safety-adjusted tokens in a ${entry.contextFit.effectiveContextWindow?.toLocaleString() ?? "unknown"}-token safe window.`;
}

function providerUsageText(usage: Record<string, unknown> | null | undefined): string | null {
  if (!usage) return null;
  return [usage.plan, usage.availability, usage.hint_short].filter((value) => typeof value === "string" && value).join(" · ") || null;
}

export function ModelsSection({ data: _data }: { data: SettingsData }) {
  const [chatJid, setChatJid] = useState(() => getChatJid());
  const [payload, setPayload] = useState<ModelsResponse | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextResponse | null>(null);
  const [preferences, setPreferences] = useState<StoredModelCataloguePreferences>(() => readModelCataloguePreferences());
  const [filters, setFilters] = useState<FilterState>(() => defaultFilters(readModelCataloguePreferences().sort));
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [staleMessage, setStaleMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState("");
  const [actionStatus, setActionStatus] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [scopedBusy, setScopedBusy] = useState(false);
  const requestGeneration = useRef(0);
  const actionGeneration = useRef(0);
  const chatJidRef = useRef(chatJid);
  chatJidRef.current = chatJid;

  const loadModels = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
    const targetChatJid = chatJid;
    const generation = ++requestGeneration.current;
    if (!quiet || !payload) setLoading(true);
    if (!quiet) setLoadError(null);
    try {
      const [nextPayload, nextContext] = await Promise.all([
        fetchJson<ModelsResponse>(`/agent/models?chat_jid=${encodeURIComponent(targetChatJid)}`),
        fetchJson<ContextResponse>(`/agent/context?chat_jid=${encodeURIComponent(targetChatJid)}`).catch(() => null),
      ]);
      if (generation !== requestGeneration.current || targetChatJid !== chatJidRef.current) return null;
      const nextPreferences = readModelCataloguePreferences();
      const catalogue = normaliseModelCatalogue(nextPayload, {
        contextUsage: nextContext,
        ...toModelCatalogueNormalisePreferences(nextPreferences),
      });
      setPayload(nextPayload);
      setContextUsage(nextContext);
      setPreferences(nextPreferences);
      setSelectedKey((current) => catalogue.some((entry) => entry.key === current)
        ? current
        : (catalogue.find((entry) => entry.current)?.key ?? catalogue[0]?.key ?? ""));
      setLoadError(null);
      setStaleMessage(null);
      return { payload: nextPayload, catalogue };
    } catch (error: unknown) {
      if (generation !== requestGeneration.current || targetChatJid !== chatJidRef.current) return null;
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "Models request timed out."
        : error instanceof Error ? error.message : "Failed to load models.";
      if (payload) setStaleMessage(`${message} Showing the last loaded catalogue.`);
      else setLoadError(message);
      return null;
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [chatJid, payload]);

  useEffect(() => {
    const syncChatJid = () => setChatJid(getChatJid());
    window.addEventListener("popstate", syncChatJid);
    window.addEventListener("piclaw:current-chat-changed", syncChatJid);
    return () => {
      window.removeEventListener("popstate", syncChatJid);
      window.removeEventListener("piclaw:current-chat-changed", syncChatJid);
    };
  }, []);

  useEffect(() => {
    actionGeneration.current += 1;
    requestGeneration.current += 1;
    setBusyAction("");
    setActionStatus(null);
    void loadModels();
  }, [chatJid]);

  useEffect(() => {
    const onPreferences = (event: Event) => {
      const detail = (event as CustomEvent<StoredModelCataloguePreferences>).detail;
      setPreferences(detail || readModelCataloguePreferences());
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === "piclaw:model-catalogue-preferences:v1") setPreferences(readModelCataloguePreferences());
    };
    window.addEventListener(MODEL_CATALOGUE_PREFERENCES_EVENT, onPreferences);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(MODEL_CATALOGUE_PREFERENCES_EVENT, onPreferences);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const refresh = (event: Event) => {
      const eventChatJid = (event as CustomEvent<{ chatJid?: string }>).detail?.chatJid;
      if (!eventChatJid || eventChatJid === chatJid) void loadModels({ quiet: true });
    };
    const refreshOnFocus = () => void loadModels({ quiet: true });
    const interval = setInterval(refreshOnFocus, 15_000);
    window.addEventListener("piclaw:model-state-changed", refresh);
    window.addEventListener("piclaw:sse-connected", refresh);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("piclaw:model-state-changed", refresh);
      window.removeEventListener("piclaw:sse-connected", refresh);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [chatJid, loadModels]);

  const entries = useMemo(() => normaliseModelCatalogue(payload, {
    contextUsage,
    ...toModelCatalogueNormalisePreferences(preferences),
  }), [payload, contextUsage, preferences]);
  const facets = useMemo(() => collectModelSettingsFacets(entries), [entries]);
  const projection = useMemo(() => buildModelSettingsProjection(entries, {
    query,
    providers: filters.provider || null,
    publishers: filters.publisher || null,
    families: filters.family || null,
    contextFit: filters.contextFit as "all" | "compatible" | "fits" | "unknown" | "blocked",
    reasoning: filters.reasoning === "all" ? null : filters.reasoning === "yes",
    variants: filters.variant || null,
    sort: filters.sort,
  }, selectedKey), [entries, filters, query, selectedKey]);
  const selected = projection.selectedEntry;

  useEffect(() => {
    if (!projection.renderedEntries.some((entry) => entry.key === selectedKey)) {
      setSelectedKey(projection.renderedEntries[0]?.key ?? "");
    }
  }, [projection.renderedEntries, selectedKey]);

  const updateFilter = <K extends keyof FilterState>(name: K, value: FilterState[K]) => {
    setFilters((current) => ({ ...current, [name]: value }));
    if (name === "sort") setPreferences(setModelCataloguePreferenceSort(value as FilterState["sort"]));
  };

  const sendCommand = async (command: string, targetChatJid = chatJid) => {
    return fetchJson<Record<string, unknown>>(`/agent/${encodeURIComponent(targetChatJid)}/message?chat_jid=${encodeURIComponent(targetChatJid)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: command }),
    });
  };

  const switchModel = async () => {
    if (!selected || busyAction) return;
    if (selected.contextFit.state === "blocked") {
      setActionStatus({ type: "error", text: describeModelContextFit(selected) });
      return;
    }
    const targetChatJid = chatJid;
    const generation = ++actionGeneration.current;
    setBusyAction("switch");
    setActionStatus(null);
    try {
      const response = await sendCommand(`/model ${selected.key}`, targetChatJid);
      if (generation !== actionGeneration.current || targetChatJid !== chatJidRef.current) return;
      if (response.command === false || response.error || (response.command as { status?: string } | undefined)?.status === "error") throw new Error(String(response.error || (response.command as { message?: string } | undefined)?.message || "Model switch failed."));
      const confirmedPayload = await fetchJson<ModelsResponse>(`/agent/models?chat_jid=${encodeURIComponent(targetChatJid)}`);
      if (generation !== actionGeneration.current || targetChatJid !== chatJidRef.current) return;
      const confirmedCatalogue = normaliseModelCatalogue(confirmedPayload, {
        contextUsage,
        ...toModelCatalogueNormalisePreferences(preferences),
      });
      const confirmed = confirmedCatalogue.find((entry) => entry.current)?.key
        ?? normalizeModelCataloguePreferenceKey(confirmedPayload.current ?? confirmedPayload.model);
      if (confirmed !== selected.key) throw new Error("The server did not confirm the model switch.");
      requestGeneration.current += 1;
      setPayload(confirmedPayload);
      setPreferences(recordRecentModelKey(selected.key));
      setActionStatus({ type: "success", text: `Using ${selected.key} for ${targetChatJid}.` });
      window.dispatchEvent(new CustomEvent("piclaw:model-state-changed", { detail: { chatJid: targetChatJid, payload: confirmedPayload, source: "settings" } }));
      void loadModels({ quiet: true });
    } catch (error: unknown) {
      if (generation === actionGeneration.current && targetChatJid === chatJidRef.current) {
        setActionStatus({ type: "error", text: error instanceof Error ? error.message : "Model switch failed." });
        await loadModels({ quiet: true });
      }
    } finally {
      if (generation === actionGeneration.current) setBusyAction("");
    }
  };

  const setThinkingLevel = async (level: string) => {
    if (!selected?.current || busyAction) return;
    setBusyAction("thinking");
    setActionStatus(null);
    try {
      const response = await sendCommand(`/thinking ${level}`);
      if (response.command === false || response.error || (response.command as { status?: string } | undefined)?.status === "error") throw new Error(String(response.error || (response.command as { message?: string } | undefined)?.message || "Thinking level change failed."));
      await loadModels({ quiet: true });
      setActionStatus({ type: "success", text: "Thinking level updated." });
    } catch (error: unknown) {
      setActionStatus({ type: "error", text: error instanceof Error ? error.message : "Thinking level change failed." });
      await loadModels({ quiet: true });
    } finally {
      setBusyAction("");
    }
  };

  const compactContext = async () => {
    if (busyAction) return;
    setBusyAction("compact");
    try {
      const response = await sendCommand("/compact");
      if (response.command === false || response.error || (response.command as { status?: string } | undefined)?.status === "error") throw new Error(String(response.error || (response.command as { message?: string } | undefined)?.message || "Compaction request failed."));
      setActionStatus({ type: "success", text: "Context compaction requested. Switch after compaction completes." });
    } catch (error: unknown) {
      setActionStatus({ type: "error", text: error instanceof Error ? error.message : "Compaction request failed." });
    } finally {
      setBusyAction("");
    }
  };

  const setScopedModels = async (enabled: boolean) => {
    if (scopedBusy) return;
    setScopedBusy(true);
    try {
      const result = await fetchJson<{ ok?: boolean; error?: string }>("/agent/settings/general", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopedModelsOnly: enabled }),
      });
      if (!result.ok) throw new Error(result.error || "Failed to save scoped model setting.");
      await loadModels({ quiet: true });
    } catch (error: unknown) {
      setActionStatus({ type: "error", text: error instanceof Error ? error.message : "Failed to save scoped model setting." });
    } finally {
      setScopedBusy(false);
    }
  };

  const handleListKeyDown = (event: KeyboardEvent) => {
    const actions = {
      ArrowDown: "next", ArrowUp: "previous", Home: "first", End: "last",
      PageDown: "page-next", PageUp: "page-previous",
    } as const;
    const action = actions[event.key as keyof typeof actions];
    if (!action) return;
    event.preventDefault();
    const nextKey = moveModelSettingsActiveKey(projection.renderedEntries, selectedKey, action);
    setSelectedKey(nextKey ?? "");
    requestAnimationFrame(() => {
      if (nextKey) document.getElementById(optionId(nextKey))?.scrollIntoView({ block: "nearest" });
    });
  };

  const togglePin = (key = selected?.key) => {
    if (!key) return;
    setPreferences(togglePinnedModelKey(key));
  };

  const renderEntry = (entry: ModelCatalogueEntry) => (
    <div
      id={optionId(entry.key)}
      key={entry.key}
      role="option"
      aria-selected={entry.key === selectedKey}
      aria-current={entry.current || undefined}
      class={`model-catalogue-settings__row${entry.key === selectedKey ? " selected" : ""}${entry.current ? " current" : ""}`}
      onClick={() => setSelectedKey(entry.key)}
    >
      <button
        type="button"
        className="model-catalogue-settings__pin"
        aria-label={entry.pinned ? `Unpin ${entry.displayName}` : `Pin ${entry.displayName}`}
        aria-pressed={entry.pinned ? "true" : "false"}
        title={entry.pinned ? "Unpin model" : "Pin model"}
        onClick={(event) => { event.stopPropagation(); togglePin(entry.key); }}
      >{entry.pinned ? "★" : "☆"}</button>
      <span className="model-catalogue-settings__row-main">
        <strong>{entry.displayName}</strong><code>{entry.key}</code>
        <span className="model-catalogue-settings__row-mobile-meta">
          <span>{formatModelCatalogueContextWindow(entry.contextWindow) || "Unknown context"}</span>
          <span>{entry.reasoning ? "Reasoning" : "Standard"}</span>
          {formatModelCataloguePricing(entry.pricing) && <span>{formatModelCataloguePricing(entry.pricing)}</span>}
        </span>
      </span>
      <span className="model-catalogue-settings__row-family">{entry.family || entry.publisher || "—"}</span>
      <span className="model-catalogue-settings__row-context">{formatModelCatalogueContextWindow(entry.contextWindow) || "Unknown"}</span>
      <span className="model-catalogue-settings__row-mode">{entry.reasoning ? "Reasoning" : "Standard"}</span>
      <span className="model-catalogue-settings__row-input-price">{formatModelCataloguePrice(entry.pricing?.inputPerMillion ?? null)}</span>
      <span className="model-catalogue-settings__row-output-price">{formatModelCataloguePrice(entry.pricing?.outputPerMillion ?? null)}</span>
    </div>
  );

  const selectedDiagnostic = payload?.provider_diagnostics?.providers?.find((row) => row.provider === selected?.provider);
  const usageText = selected?.current ? providerUsageText(payload?.provider_usage) : null;
  const thinkingLevels = selected?.thinkingLevels ?? [];
  const enabledPatterns = Array.isArray(payload?.enabled_model_patterns) ? payload.enabled_model_patterns : [];

  if (loading && !payload) {
    return <section className="settings-panel__section settings-panel__section--models"><p role="status">Loading model catalogue…</p></section>;
  }

  return (
    <section className="settings-panel__section settings-panel__section--models model-catalogue-settings">
      <div className="model-catalogue-settings__header">
        <div><h2 className="settings-panel__section-title">Models</h2><span>{chatJid} · {entries.length} available · {projection.totalMatches} matched{projection.hiddenCount ? ` · ${projection.renderedEntries.length} shown` : ""}</span></div>
        <button type="button" className="settings-panel__provider-btn" onClick={() => void loadModels()} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
      </div>
      {loadError && <div className="model-catalogue-settings__notice error" role="alert">{loadError} <button type="button" onClick={() => void loadModels()}>Retry</button></div>}
      {staleMessage && <div className="model-catalogue-settings__notice warning" role="status">{staleMessage}</div>}
      {actionStatus && <div className={`model-catalogue-settings__notice ${actionStatus.type}`} role={actionStatus.type === "error" ? "alert" : "status"}>{actionStatus.text}</div>}

      <div className="model-catalogue-settings__scope">
        <label><input type="checkbox" checked={Boolean(payload?.scoped_models_only)} disabled={scopedBusy} onChange={(event) => void setScopedModels(event.currentTarget.checked)} /> Use <code>enabledModels</code> to scope the catalogue and picker</label>
        <span>{payload?.scoped_models_only ? (payload?.scoped_model_filter_active ? "enabledModels filter active" : "Scope enabled, but no enabledModels patterns are available") : "Showing the full provider catalogue"}</span>
      </div>
      <div className={`model-catalogue-settings__enabled-models${payload?.scoped_model_filter_active ? " active" : ""}`}>
        <strong>enabledModels</strong>
        <span>{enabledPatterns.length ? enabledPatterns.join(", ") : "No patterns reported by the active Pi settings manager."}</span>
        <small>{enabledPatterns.length ? `${entries.length} catalogue entries after applying the configured patterns.` : "Configure enabledModels in Pi settings; this toggle only chooses whether Piclaw applies those patterns outside the TUI."}</small>
      </div>

      <input className="settings-panel__input settings-panel__model-filter" type="search" aria-label="Search model catalogue" placeholder="Search model, provider, publisher, family…" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
      <div className="model-catalogue-settings__filter-disclosure">
        <button
          type="button"
          className="model-catalogue-settings__filter-toggle settings-panel__provider-btn"
          aria-expanded={filtersExpanded}
          aria-controls="visual-model-catalogue-filters"
          onClick={() => setFiltersExpanded((value) => !value)}
        >Filters and sorting</button>
        <div id="visual-model-catalogue-filters" className={`model-catalogue-settings__filters${filtersExpanded ? " expanded" : ""}`} aria-label="Model catalogue filters">
          <select aria-label="Provider" value={filters.provider} onChange={(event) => updateFilter("provider", event.currentTarget.value)}><option value="">All providers</option>{facets.providers.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select aria-label="Publisher" value={filters.publisher} onChange={(event) => updateFilter("publisher", event.currentTarget.value)}><option value="">All publishers</option>{facets.publishers.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select aria-label="Family" value={filters.family} onChange={(event) => updateFilter("family", event.currentTarget.value)}><option value="">All families</option>{facets.families.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select aria-label="Context fit" value={filters.contextFit} onChange={(event) => updateFilter("contextFit", event.currentTarget.value)}><option value="all">Any context fit</option><option value="compatible">Compatible or unknown</option><option value="fits">Fits current context</option><option value="unknown">Unknown fit</option><option value="blocked">Blocked</option></select>
          <select aria-label="Reasoning" value={filters.reasoning} onChange={(event) => updateFilter("reasoning", event.currentTarget.value)}><option value="all">Any reasoning</option><option value="yes">Reasoning</option><option value="no">Non-reasoning</option></select>
          <select aria-label="Variant" value={filters.variant} onChange={(event) => updateFilter("variant", event.currentTarget.value)}><option value="">All variants</option>{facets.variants.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <select aria-label="Sort models" value={filters.sort} onChange={(event) => updateFilter("sort", event.currentTarget.value as FilterState["sort"])}><option value="recommended">Recommended</option><option value="name">Name</option><option value="context">Context window</option><option value="input-price">Input price</option><option value="output-price">Output price</option></select>
          <button type="button" className="settings-panel__provider-btn" onClick={() => { setQuery(""); setFilters(defaultFilters(preferences.sort)); }}>Reset filters</button>
        </div>
      </div>

      <div className="model-catalogue-settings__workspace">
        <div
          className="model-catalogue-settings__list"
          role="listbox"
          tabIndex={0}
          aria-label="Model catalogue"
          aria-activedescendant={projection.renderedEntries.some((entry) => entry.key === selectedKey) ? optionId(selectedKey) : undefined}
          onKeyDown={handleListKeyDown}
        >
          <div className="model-catalogue-settings__columns" aria-hidden="true"><span>Pin</span><span>Model</span><span>Family</span><span>Context</span><span>Mode</span><span>Input / 1M</span><span>Output / 1M</span></div>
          {projection.groups.map((provider) => (
            <div className="model-catalogue-settings__provider" key={provider.key} role="group" aria-label={provider.label}>
              <div className="model-catalogue-settings__provider-heading"><span>{provider.label}</span><span>{provider.totalCount}</span></div>
              {provider.entries.map(renderEntry)}
              {provider.publisherGroups.map((group) => (
                <div className="model-catalogue-settings__group" key={group.key} role="group" aria-label={group.label}>
                  <div className="model-catalogue-settings__group-heading"><span>{group.label}</span><span>{group.totalCount}</span></div>
                  {group.entries.map(renderEntry)}
                </div>
              ))}
            </div>
          ))}
          {projection.totalMatches === 0 && <div className="settings-panel__table-empty">No models match the current search and filters.</div>}
          {projection.hiddenCount > 0 && <div className="model-catalogue-settings__limit">Showing {projection.renderedEntries.length} of {projection.totalMatches}. Refine the search or filters to see the rest.</div>}
        </div>

        <aside className="model-catalogue-settings__detail" aria-live="polite">
          {selected ? (
            <>
              <div className="model-catalogue-settings__detail-title"><div><h3>{selected.displayName}</h3><code>{selected.key}</code></div><button type="button" className="settings-panel__provider-btn" onClick={() => togglePin()}>{selected.pinned ? "Unpin" : "Pin"}</button></div>
              <dl className="model-catalogue-settings__facts">
                <div><dt>Access provider</dt><dd>{selected.provider || "Unknown"}</dd></div>
                <div><dt>Publisher</dt><dd>{selected.publisher || "Unknown"}</dd></div>
                <div><dt>Family</dt><dd>{selected.family || "Unknown"}</dd></div>
                <div><dt>Context window</dt><dd>{formatModelCatalogueContextWindow(selected.contextWindow) || "Unknown"}</dd></div>
                <div><dt>Context fit</dt><dd>{contextFitText(selected)}</dd></div>
                <div><dt>Reasoning</dt><dd>{selected.reasoning ? "Supported" : "Not advertised"}</dd></div>
                <div><dt>Variants</dt><dd>{selected.variants.length ? selected.variants.join(", ") : "Stable"}</dd></div>
                <div><dt>Input / 1M</dt><dd>{formatModelCataloguePrice(selected.pricing?.inputPerMillion ?? null)}</dd></div>
                <div><dt>Output / 1M</dt><dd>{formatModelCataloguePrice(selected.pricing?.outputPerMillion ?? null)}</dd></div>
                <div><dt>Cache read / 1M</dt><dd>{formatModelCataloguePrice(selected.pricing?.cacheReadPerMillion ?? null)}</dd></div>
                <div><dt>Cache write / 1M</dt><dd>{formatModelCataloguePrice(selected.pricing?.cacheWritePerMillion ?? null)}</dd></div>
                <div><dt>Last used</dt><dd>{formatModelLastUsed(selected.lastUsedAt)}</dd></div>
                <div><dt>Status</dt><dd>{selected.current ? "Current model" : selected.pinned ? "Pinned" : "Available"}</dd></div>
              </dl>
              <div className="model-catalogue-settings__thinking"><strong>Thinking levels</strong>{thinkingLevels.length ? <><select aria-label="Thinking level" disabled={!selected.current || Boolean(busyAction)} value={selected.current ? payload?.thinking_level ?? "" : ""} onChange={(event) => void setThinkingLevel(event.currentTarget.value)}>{!selected.current && <option value="">Switch to this model to change thinking</option>}{thinkingLevels.map((level) => <option key={level.id} value={level.id}>{level.label}</option>)}</select><span>{thinkingLevels.map((level) => level.label).join(", ")}</span></> : <span>No server-provided thinking levels.</span>}</div>
              <div className="model-catalogue-settings__diagnostics"><strong>Provider diagnostics</strong>{selectedDiagnostic ? <span>{selectedDiagnostic.auth_configured ? "Authenticated" : "Credentials not configured"} · {selectedDiagnostic.available_model_count} available of {selectedDiagnostic.model_count} advertised{selectedDiagnostic.auth_source ? ` · ${selectedDiagnostic.auth_source}` : ""}</span> : <span>No provider diagnostics available.</span>}{payload?.provider_diagnostics?.composition_error && <span className="error">{payload.provider_diagnostics.composition_error}</span>}{usageText && <span>{usageText}</span>}</div>
              <div className="model-catalogue-settings__actions">
                <button type="button" className="settings-panel__provider-btn settings-panel__provider-btn--primary" disabled={selected.current || Boolean(busyAction) || selected.contextFit.state === "blocked"} onClick={() => void switchModel()}>{selected.current ? "Current model" : busyAction === "switch" ? "Switching…" : "Use for current chat"}</button>
                {selected.contextFit.state === "blocked" && <button type="button" className="settings-panel__provider-btn" disabled={Boolean(busyAction)} onClick={() => void compactContext()}>Compact context</button>}
                <button type="button" className="settings-panel__provider-btn" onClick={() => void navigator.clipboard?.writeText?.(selected.key)}>Copy model key</button>
                <button type="button" className="settings-panel__provider-btn" onClick={() => window.dispatchEvent(new CustomEvent("piclaw:open-settings", { detail: { section: "providers" } }))}>Provider settings</button>
              </div>
            </>
          ) : <div className="settings-panel__table-empty">Select a model to inspect it.</div>}
        </aside>
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
