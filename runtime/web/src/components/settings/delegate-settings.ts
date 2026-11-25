import type { SettingsPaneDefinition } from './pane-registry.js';
type DelegateUiRuntime = Pick<typeof import('../../vendor/preact-htm.js'), 'html' | 'useState' | 'useEffect' | 'useCallback'> & {
  registerSettingsPane(pane: SettingsPaneDefinition): void; notifySettingsPanesChanged(): void;
};

// A separate Core asset reuses the host's Preact/hooks and existing pane registry.
// The app's initial bundle retains its unchanged size bound.
export function registerDelegateSettings(runtime: DelegateUiRuntime) {
const { html, useState, useEffect, useCallback, registerSettingsPane, notifySettingsPanesChanged } = runtime;
const API = '/agent/addons/api/delegate';
const settingsStyles = "\n@layer delegate-settings-fallback {\n  .delegate-settings { padding: .5rem 0; min-width: 0; }\n  .delegate-settings .settings-addon-section { margin-bottom: 20px; min-width: 0; }\n  .delegate-settings h4 { margin: 1.2rem 0 .45rem; font-size: .9rem; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: .3rem; }\n  .delegate-settings .settings-addon-field { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; min-width: 0; margin-bottom: 12px; }\n  .delegate-settings .settings-addon-label { font-size: .84rem; font-weight: 500; color: var(--text-secondary); }\n  .delegate-settings .settings-addon-control { box-sizing: border-box; width: 280px; min-width: 0; max-width: 100%; padding: 6px 10px; background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; font-size: .84rem; }\n  .delegate-settings .settings-addon-help { font-size: .78rem; color: var(--text-secondary); line-height: 1.45; overflow-wrap: anywhere; }\n  .delegate-settings .settings-addon-control-group, .delegate-settings .settings-addon-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; max-width: 100%; }\n  .delegate-settings .settings-addon-control-group > .settings-addon-control { flex: 1 1 160px; }\n  .delegate-settings .settings-addon-error { color: var(--danger-color); overflow-wrap: anywhere; }\n  .delegate-settings .settings-addon-status { color: var(--text-secondary); overflow-wrap: anywhere; }\n  .delegate-settings button { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); cursor: pointer; font-size: .82rem; }\n  .delegate-settings :is(button, input, textarea):focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }\n  .delegate-settings :is(button, input, textarea):disabled { opacity: .5; }\n  @media (max-width: 640px) {\n    .delegate-settings .settings-addon-field { align-items: stretch; }\n    .delegate-settings .settings-addon-control { width: 100%; }\n  }\n}\n/* Pane-owned layout and list limits remain separate from host control styling. */\n.delegate-settings .delegate-scroll { overflow: auto; max-height: 18rem; border: 1px solid var(--border-color); border-radius: 6px; overflow-wrap: anywhere; }\n.delegate-settings .delegate-models { margin: 0; padding: 0; list-style: none; }\n.delegate-settings .delegate-model { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .5rem; padding: .4rem .5rem; border-bottom: 1px solid var(--border-color); }\n.delegate-settings .delegate-model button { min-height: 34px; min-width: 34px; }\n.delegate-settings .delegate-model button[aria-disabled=true] { opacity: .5; cursor: default; }\n";
type Models = {
  config: { approved_models: string[] };
  models: { id: string; name?: string; reason?: string }[];
  available: { id: string; tier: number }[];
  candidates: { id: string; tier: number }[];
};

function compareSlugs(a: string, b: string): number {
  return a < b ? -1 : a === b ? 0 : 1;
}

async function apiJson(path: string, options: RequestInit = {}): Promise<Models> {
  const response = await fetch(`${API}/${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) throw new Error(payload?.error || `HTTP ${response.status}`);
  return payload;
}

function DelegateSettings() {
  const [data, setData] = useState<Models | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'name' | 'rank'>('name');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (refresh = false, signal?: AbortSignal) => {
    setBusy(true); setMessage(''); setFailed(false);
    try {
      const payload = await apiJson('models', refresh ? {
        method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ refresh: true }), signal,
      } : { signal });
      if (signal?.aborted) return;
      setData(payload);
      if (refresh) setMessage('Model list refreshed.');
    } catch (error) {
      if (!signal?.aborted) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Could not load Delegate models.'); }
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const request = new AbortController();
    void load(false, request.signal);
    return () => request.abort();
  }, [load]);

  async function change(id: string, add: boolean, button: HTMLButtonElement) {
    if (busy) return;
    setBusy(true); setMessage(''); setFailed(false);
    try {
      setData(await apiJson('config', {
        method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ [add ? 'add_model' : 'remove_model']:id }),
      }));
      if (!add && button.ownerDocument.activeElement === button) {
        button.closest('.delegate-settings')?.querySelector<HTMLInputElement>('#delegate-model-search')?.focus({ preventScroll: true });
      }
      setMessage(`${add ? 'Added' : 'Removed'} ${id}.`);
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : 'Could not change the Delegate whitelist.');
    } finally { setBusy(false); }
  }

  if (!data) return html`<div class="delegate-settings"><style>${settingsStyles}</style>
    <p role=${failed ? 'alert' : 'status'}>${message || 'Loading Delegate models…'}</p>
    ${failed && html`<button type="button" disabled=${busy} onClick=${() => load()}>Retry</button>`}
  </div>`;

  const approved = new Set<string>(data.config.approved_models);
  const available = new Map<string, number>(data.available.map(model => [model.id, model.tier]));
  const candidates = new Map<string, number>(data.candidates.map(model => [model.id, model.tier]));
  const models = new Map<string, Models['models'][number]>(data.models.map(model => [model.id, model]));
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = [...models.values()].filter(model => {
    const text = `${model.id} ${model.name ?? ''}`.toLowerCase();
    return terms.every(term => text.includes(term));
  }).sort((a, b) => compareSlugs(a.id, b.id));
  const approvedIds = [...approved].sort((a, b) => {
    if (sort === 'rank') {
      const aRank = candidates.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bRank = candidates.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
    }
    return compareSlugs(a, b);
  });
  const rankLabel = (rank: number | undefined) => rank === undefined ? 'Not currently available' : `Rank ${rank}`;
  const row = (id: string, detail: string, remove = false) => {
    const added = approved.has(id), blocked = busy || (!remove && (added || !available.has(id)));
    return html`<li key=${id} class="delegate-model">
      <span><code>${id}</code>${detail && html`<br /><span class="settings-addon-help">${detail}</span>`}</span>
      ${(remove || available.has(id)) && html`<button type="button" aria-disabled=${blocked} onClick=${(event: Event) => { if (!blocked) void change(id, !remove, event.currentTarget as HTMLButtonElement); }}
        aria-label=${remove ? `Remove ${id} from whitelist` : added ? `${id} is on the whitelist` : `Add ${id} to whitelist`}
        title=${remove ? 'Remove from whitelist' : added ? 'Already on the whitelist' : 'Add to whitelist'}>${remove ? '−' : added ? '✓' : '+'}</button>`}
    </li>`;
  };

  return html`<div class="delegate-settings" aria-busy=${busy}><style>${settingsStyles}</style>
    <section class="settings-addon-section">
      <h4 id="delegate-available-label">Available models</h4>
      <p class="settings-addon-help" id="delegate-search-help">Search by provider, model ID or display name. Use + to approve an exact model. New models are never approved automatically.</p>
      <div class="settings-addon-field">
        <label class="settings-addon-label" for="delegate-model-search">Search models</label>
        <div class="settings-addon-control-group">
          <input id="delegate-model-search" class="settings-addon-control" type="search" aria-controls="delegate-available"
            aria-describedby="delegate-search-help" placeholder="Search models…" value=${query} onInput=${(event: Event) => setQuery((event.currentTarget as HTMLInputElement).value)} />
          <button type="button" disabled=${busy} onClick=${() => load(true)}>Refresh models</button>
        </div>
      </div>
      <p class="settings-addon-help" role="status">${matches.length} ${matches.length === 1 ? 'model' : 'models'}${terms.length ? ' found' : ' available'}.</p>
      <div class="delegate-scroll" id="delegate-available" role="region" aria-labelledby="delegate-available-label" tabIndex=${0}>
        ${matches.length ? html`<ul class="delegate-models">${matches.map(model => row(model.id, model.reason ?? rankLabel(available.get(model.id))))}</ul>` : html`<p class="settings-addon-help">${terms.length ? 'No models match your search.' : 'No models are currently available.'}</p>`}
      </div>
    </section>
    <section class="settings-addon-section">
      <h4 id="delegate-whitelist-label">Delegate whitelist</h4>
      <p class="settings-addon-help">${approved.size} approved · ${candidates.size} ready. Only available models can run.</p>
      ${approved.size ? html`
        <div class="settings-addon-field">
          <label class="settings-addon-label" for="delegate-whitelist-sort">Sort whitelist</label>
          <select id="delegate-whitelist-sort" class="settings-addon-control" value=${sort}
            onChange=${(event: Event) => setSort((event.currentTarget as HTMLSelectElement).value === 'rank' ? 'rank' : 'name')}>
            <option value="name">Model name (A–Z)</option>
            <option value="rank">Rank (low to high)</option>
          </select>
        </div>
        <div class="delegate-scroll" role="region" aria-labelledby="delegate-whitelist-label" tabIndex=${0}>
          <ul class="delegate-models">${approvedIds.map(id => row(id, rankLabel(candidates.get(id)), true))}</ul>
        </div>` : html`<p class="settings-addon-help">No models are approved.</p>`}
    </section>
    <div class=${failed ? 'settings-addon-error' : 'settings-addon-status'} role=${failed ? 'alert' : 'status'}>${message}</div>
  </div>`;
}

registerSettingsPane({ id: 'delegate', label: 'Delegate', icon: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h10v10H7z"/><path d="M4 4h4m8 0h4M4 20h4m8 0h4"/></svg>`, component: DelegateSettings, order: 30.25 });
notifySettingsPanesChanged();
}
