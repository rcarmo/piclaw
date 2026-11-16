import type { SettingsPaneDefinition } from './pane-registry.js';
type DelegateUiRuntime = Pick<typeof import('../../vendor/preact-htm.js'), 'html' | 'useState' | 'useEffect' | 'useCallback'> & {
  registerSettingsPane(pane: SettingsPaneDefinition): void; notifySettingsPanesChanged(): void;
};

// A separate Core asset reuses the host's Preact/hooks and existing pane registry.
// The app's initial bundle retains its unchanged size bound.
export function registerDelegateSettings(runtime: DelegateUiRuntime) {
const { html, useState, useEffect, useCallback, registerSettingsPane, notifySettingsPanesChanged } = runtime;
const API = '/agent/addons/api/delegate';
const settingsStyles = "\n@layer delegate-settings-fallback {\n  .delegate-settings { padding: .5rem 0; min-width: 0; }\n  .delegate-settings .settings-addon-section { margin-bottom: 20px; min-width: 0; }\n  .delegate-settings h4 { margin: 1.2rem 0 .45rem; font-size: .9rem; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: .3rem; }\n  .delegate-settings .settings-addon-field { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; margin-bottom: 12px; }\n  .delegate-settings .settings-addon-label { font-size: .84rem; font-weight: 500; color: var(--text-secondary); }\n  .delegate-settings .settings-addon-control { box-sizing: border-box; width: 280px; min-width: 0; max-width: 100%; padding: 6px 10px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; font-size: .84rem; }\n  .delegate-settings .settings-addon-help { font-size: .78rem; color: var(--text-secondary); line-height: 1.45; overflow-wrap: anywhere; }\n  .delegate-settings .settings-addon-control-group, .delegate-settings .settings-addon-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }\n  .delegate-settings .settings-addon-control-group > .settings-addon-control { flex: 1 1 160px; }\n  .delegate-settings .settings-addon-error { color: var(--danger-color); overflow-wrap: anywhere; }\n  .delegate-settings .settings-addon-status { color: var(--text-secondary); overflow-wrap: anywhere; }\n  .delegate-settings button { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font-size: .82rem; }\n  .delegate-settings :is(button, input, textarea):focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }\n  .delegate-settings :is(button, input, textarea):disabled { opacity: .5; }\n  @media (max-width: 640px) {\n    .delegate-settings .settings-addon-field { align-items: stretch; }\n    .delegate-settings .settings-addon-control { width: 100%; }\n  }\n}\n/* Pane-owned layout and list limits remain separate from host control styling. */\n.delegate-settings .delegate-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: .45rem; margin-bottom: .6rem; }\n.delegate-settings .delegate-metric { padding: .55rem .65rem; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-secondary); }\n.delegate-settings .delegate-metric-count { font-size: 1.05rem; font-weight: 600; }\n.delegate-settings .delegate-provider-row { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; margin: .45rem 0; min-width: 0; }\n.delegate-settings .delegate-radio { display: inline-flex; align-items: center; gap: .25rem; }\n.delegate-settings .delegate-provider-name { font-family: var(--font-mono, monospace); overflow-wrap: anywhere; }\n.delegate-settings .delegate-scroll { overflow: auto; border: 1px solid var(--border-color); border-radius: 6px; overflow-wrap: anywhere; }\n.delegate-settings .delegate-scroll-candidates { max-height: 180px; }\n.delegate-settings .delegate-scroll-rejections { max-height: 190px; }\n.delegate-settings .delegate-exclusions { min-height: 74px; font-family: var(--font-mono, monospace); }\n.delegate-settings .delegate-candidate { display: grid; grid-template-columns: 3rem minmax(0, 1fr); gap: .5rem; padding: .4rem .5rem; border-bottom: 1px solid var(--border-color); }\n.delegate-settings .delegate-rejection { padding: .35rem .5rem; border-bottom: 1px solid var(--border-color); }\n";
async function apiJson(path, options: RequestInit = {}) {
  const response = await fetch(`${API}/${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload;
}

function formatTimestamp(value) {
  if (!value) return "never";
  try { return new Date(value).toLocaleString(); } catch { return "unknown"; }
}

function compactTokens(value) {
  if (!Number.isFinite(value) || value <= 0) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function resolveProviderMode(provider, searchableProviders) {
  return searchableProviders.has(provider) ? "search" : "exclude";
}

function buildProviderModePatch(provider, mode, discoveredProviders, searchableProviders) {
  const searchableSource = [...searchableProviders];
  const searchable = searchableSource.filter((item) => item !== provider);
  if (mode === "search") {
    const originalIndex = searchableSource.indexOf(provider);
    if (originalIndex >= 0) searchable.splice(Math.min(originalIndex, searchable.length), 0, provider);
    else searchable.push(provider);
  }
  const searchableSet = new Set(searchable);
  return {
    searchable_providers: searchable,
    excluded_providers: [...discoveredProviders].filter((item) => !searchableSet.has(item)),
  };
}

function DelegateSettings() {
  const [config, setConfig] = useState(null);
  const [providers, setProviders] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [filter, setFilter] = useState("");
  const [excludedModelsText, setExcludedModelsText] = useState("");
  const [runtimeCatalog, setRuntimeCatalog] = useState({});
  const [executableCatalog, setExecutableCatalog] = useState({});
  const [runtimeOnlyModels, setRuntimeOnlyModels] = useState([]);
  const [unclassifiedModels, setUnclassifiedModels] = useState([]);
  const [rejectedModels, setRejectedModels] = useState([]);
  const [effectiveExclusions, setEffectiveExclusions] = useState({ providers: [], models: [] });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!message || failed) return;
    const timer = setTimeout(() => setMessage(''), 2500);
    return () => clearTimeout(timer);
  }, [message, failed]);

  const load = useCallback(async (refresh = false, throwOnError = false) => {
    setSaving(true);
    setFailed(false); setMessage(refresh ? "Refreshing models…" : "");
    try {
      const payload = refresh
        ? await apiJson("models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh: true }) })
        : await apiJson("models");
      const nextConfig = payload.config || { searchable_providers: null, excluded_providers: null, excluded_models: [] };
      setConfig(nextConfig);
      setExcludedModelsText(Array.isArray(nextConfig.excluded_models) ? nextConfig.excluded_models.join("\n") : "");
      setProviders(payload.providers || []);
      setCandidates(payload.candidates || []);
      setRuntimeCatalog(payload.runtime_catalog || {});
      setExecutableCatalog(payload.executable_catalog || {});
      setRuntimeOnlyModels(payload.runtime_only_models || []);
      setUnclassifiedModels(payload.unclassified_models || []);
      setRejectedModels(payload.rejected_models || []);
      setEffectiveExclusions(payload.effective_exclusions || { providers: [], models: [] });
      setMessage(refresh ? "Model list refreshed." : "");
    } catch (error) {
      setFailed(true); setMessage(error?.message || "Failed to load delegate settings.");
      if (throwOnError) throw error;
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const saveConfigPatch = useCallback(async (patch, successMessage = "Saved delegate settings.") => {
    const previousConfig = config;
    const optimisticConfig = { ...config, ...patch };
    setConfig(optimisticConfig);
    setSaving(true);
    setFailed(false); setMessage("");
    let nextConfig;
    try {
      const payload = await apiJson("config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      nextConfig = payload.config || optimisticConfig;
      setConfig(nextConfig);
      setExcludedModelsText(Array.isArray(nextConfig.excluded_models) ? nextConfig.excluded_models.join("\n") : "");
    } catch (error) {
      setConfig(previousConfig);
      setExcludedModelsText(Array.isArray(previousConfig?.excluded_models) ? previousConfig.excluded_models.join("\n") : "");
      setFailed(true); setMessage(error?.message || "Failed to save delegate settings.");
      setSaving(false);
      return;
    }
    try {
      await load(false, true);
      setFailed(false); setMessage(successMessage);
    } catch (error) {
      setConfig(nextConfig);
      setFailed(true); setMessage(`${successMessage} Refresh failed: ${error?.message || "unknown error"}`);
    } finally {
      setSaving(false);
    }
  }, [config, load]);

  const saveProviderMode = useCallback((provider, mode, discoveredProviders, searchableProviders) => {
    const patch = buildProviderModePatch(provider, mode, discoveredProviders, searchableProviders);
    saveConfigPatch(patch, `Set ${provider} to ${mode}.`);
  }, [saveConfigPatch]);
  const saveExcludedModels = useCallback(() => {
    const patterns = excludedModelsText.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).sort();
    saveConfigPatch({ excluded_models: patterns }, "Saved model exclusions.");
  }, [excludedModelsText, saveConfigPatch]);

  if (!config) return html`<div class="delegate-settings"><style>${settingsStyles}</style>
    <p class=${failed ? 'settings-addon-error' : 'settings-addon-status'} role=${failed ? 'alert' : 'status'}>${message || 'Loading delegate settings…'}</p>
    ${message && html`<button type="button" disabled=${saving} onClick=${() => load(false)}>Retry</button>`}
  </div>`;

  const enabledSet = new Set(Array.isArray(config.searchable_providers)
    ? config.searchable_providers
    : providers.filter((provider) => provider.enabled).map((provider) => provider.provider));
  const excludedSet = new Set(Array.isArray(config.excluded_providers)
    ? config.excluded_providers
    : providers.filter((provider) => provider.excluded).map((provider) => provider.provider));
  const q = filter.trim().toLowerCase();
  const visibleProviders = providers.filter((provider) => !q || provider.provider.toLowerCase().includes(q));

  return html`
    <div class="delegate-settings">
      <style>${settingsStyles}</style>
      <section class="settings-addon-section">
      <h4>Catalog status</h4>
      <div class="delegate-metrics">
        <div class="delegate-metric"><div class="delegate-metric-count">${runtimeCatalog.model_count || 0}</div><div class="settings-addon-help">Registered models</div></div>
        <div class="delegate-metric"><div class="delegate-metric-count">${executableCatalog.model_count || 0}</div><div class="settings-addon-help">Native models</div></div>
        <div class="delegate-metric"><div class="delegate-metric-count">${executableCatalog.candidate_count || 0}</div><div class="settings-addon-help">Approved models</div></div>
        <div class="delegate-metric"><div class="delegate-metric-count">${rejectedModels.length}</div><div class="settings-addon-help">Rejected</div></div>
        <div class="delegate-metric"><div class="delegate-metric-count">${unclassifiedModels.length}</div><div class="settings-addon-help">Unclassified</div></div>
      </div>
      <div class="settings-addon-help">
        <div>Default: <code>${runtimeCatalog.current_model || "unavailable"}</code>${runtimeCatalog.current_classification?.tier ? ` · T${runtimeCatalog.current_classification.tier} · ${runtimeCatalog.current_classification.rule}` : " · unclassified"}</div>
        <div>Native catalogue captured ${formatTimestamp(runtimeCatalog.captured_at)}. Model availability is read from the current registered runtime; no child CLI is launched.</div>
      </div>
      </section>

      <section class="settings-addon-section">
      <h4>Approved providers</h4>
      <p class="settings-addon-help" id="delegate-provider-help">
        No provider is approved by default. Delegate can launch models only from providers marked <strong>Approved</strong>. Only currently available, registered native models can be selected.
      </p>
      <div class="settings-addon-field">
        <label class="settings-addon-label" for="delegate-provider-filter">Filter providers</label>
        <div class="settings-addon-control-group">
        <input id="delegate-provider-filter" class="settings-addon-control" aria-describedby="delegate-provider-help" type="search" value=${filter} placeholder="Filter providers…" onInput=${(e) => setFilter(e.target.value)} />
        <button type="button" disabled=${saving} onClick=${() => load(true)}>Refresh</button>
        </div>
      </div>
      <div>
        ${visibleProviders.map((provider) => {
          const mode = resolveProviderMode(provider.provider, enabledSet);
          const radioName = `delegate-provider-mode-${provider.provider}`;
          return html`
            <div key=${provider.provider} class="delegate-provider-row">
              <div role="radiogroup" aria-label=${`${provider.provider} mode`} class="settings-addon-control-group">
                ${["approved", "exclude"].map((option) => html`
                  <label key=${option} class="delegate-radio settings-addon-label">
                    <input type="radio" name=${radioName} value=${option} checked=${mode === (option === "approved" ? "search" : option)} disabled=${saving}
                      onChange=${() => saveProviderMode(provider.provider, option === "approved" ? "search" : option, providers.map((item) => item.provider), enabledSet)} />
                    <span>${option[0].toUpperCase()}${option.slice(1)}</span>
                  </label>`)}
              </div>
              <span class="delegate-provider-name">${provider.provider}</span>
              <span class="settings-addon-help">${provider.modelCount} models${mode === "exclude" ? (provider.defaultExcluded ? " · default excluded" : " · excluded") : ""}</span>
            </div>`;
        })}
      </div>
      </section>

      <section class="settings-addon-section">
      <h4>Excluded model patterns</h4>
      <div class="settings-addon-field">
      <label class="settings-addon-label" for="delegate-exclusions">Excluded model patterns</label>
      <p class="settings-addon-help" id="delegate-exclusions-help">
        Hard model exclusions, one per line or comma-separated. Supports exact ids, substrings, or <code>*</code> wildcards. Matching models are blocked from automatic selection, fallback, and explicit model selection. Effective provider exclusions: ${effectiveExclusions.providers?.join(", ") || "none"}.
      </p>
      <textarea id="delegate-exclusions" class="settings-addon-control delegate-exclusions" aria-describedby="delegate-exclusions-help" value=${excludedModelsText} disabled=${saving} placeholder="gpt-4o\n*/experimental-*" onInput=${(e) => setExcludedModelsText(e.target.value)} />
      </div>
      <div class="settings-addon-actions">
        <button type="button" disabled=${saving} onClick=${saveExcludedModels}>Save exclusions</button>
      </div>
      </section>

      <section class="settings-addon-section">
      <h4>Approved delegate models</h4>
      <p class="settings-addon-help">
        Delegate can launch only these ${candidates.length} models, whether selected automatically, requested explicitly by an agent, or used as a fallback. Each model is from an approved provider, matches the ordered model policy, is available in the native runtime, and does not match an exclusion.
      </p>
      <div class="delegate-scroll delegate-scroll-candidates">
        ${candidates.slice(0, 80).map((candidate) => html`
          <div key=${candidate.id} title=${candidate.classificationReason} class="delegate-candidate">
            <span class="settings-addon-help">T${candidate.tier}</span>
            <span>
              <code>${candidate.id}</code>
              <span class="settings-addon-help"> · ${candidate.family} · ${candidate.classificationRule}</span>
              <div class="settings-addon-help">images=${candidate.supportsImages === true ? "yes" : candidate.supportsImages === false ? "no" : "?"} · reasoning=${candidate.reasoning === true ? "yes" : candidate.reasoning === false ? "no" : "?"} · context=${compactTokens(candidate.contextWindow)} · output=${compactTokens(candidate.maxOutputTokens)}</div>
            </span>
          </div>`)}
      </div>
      </section>

      <section class="settings-addon-section">
      <h4>Catalog differences and rejections</h4>
      <p class="settings-addon-help">
        Rejected models cannot be used by Delegate because their provider is unapproved, the model is excluded, or the model is unclassified. Native execution never falls back to a child CLI.
      </p>
      <div class="delegate-scroll delegate-scroll-rejections">
        ${runtimeOnlyModels.length === 0 && rejectedModels.length === 0 && html`<p class="settings-addon-help">No catalog differences or rejected models.</p>`}
        ${runtimeOnlyModels.slice(0, 50).map((model) => html`
          <div key=${`runtime:${model.fullId}`} class="delegate-rejection settings-addon-help">
            <code>${model.fullId}</code> <span>runtime-only · ${model.classification?.status === "classified" ? `T${model.classification.tier} ${model.classification.rule}` : model.classification?.reason}</span>
          </div>`)}
        ${rejectedModels.slice(0, 80).map((model) => html`
          <div key=${`rejected:${model.fullId}`} class="delegate-rejection settings-addon-help">
            <code>${model.fullId}</code> <span>rejected · ${model.rejection_reason}</span>
          </div>`)}
      </div>
      </section>
      ${message && html`<div class=${failed ? "settings-addon-error" : "settings-addon-status"} role=${failed ? "alert" : "status"}>${message}</div>`}
    </div>`;
}

registerSettingsPane({ id: 'delegate', label: 'Delegate', icon: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h10v10H7z"/><path d="M4 4h4m8 0h4M4 20h4m8 0h4"/></svg>`, component: DelegateSettings, order: 169 });
notifySettingsPanesChanged();
}
