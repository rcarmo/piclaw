import { html, render, useCallback, useMemo, useState } from '../vendor/preact-htm.js';
import { SettingsDialogContent } from '../components/settings-dialog.js';
import { registerSettingsPane } from '../components/settings/pane-registry.js';

const mockIcon = html`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>`;

function MockAddonPane({ label, body, filter = '' }) {
  return html`
    <div class="settings-section">
      <h3>${label}</h3>
      <p class="settings-hint">Mock add-on pane rendered by the settings widget fixture.</p>
      <div class="settings-addon-grid">
        ${['Credentials', 'Routes', 'Runtime options'].filter((item) => !filter || item.toLowerCase().includes(String(filter).toLowerCase())).map((item) => html`
          <div class="settings-addon-card">
            <div class="settings-addon-card-header">
              <div>
                <div class="settings-addon-name">${item}</div>
                <div class="settings-addon-subtitle">${body}</div>
              </div>
              <span class="settings-addon-enabled">fixture</span>
            </div>
            <div class="settings-row settings-row-vertical">
              <label>Mock field</label>
              <input type="text" value=${`${label.toLowerCase().replace(/\s+/g, '-')}:${item.toLowerCase().replace(/\s+/g, '-')}`} readonly />
            </div>
          </div>
        `)}
      </div>
    </div>
  `;
}

function registerFixturePanes() {
  const panes = [
    { id: 'fixture-z-observability', label: 'Observability', body: 'Latency, traces, and metrics.' },
    { id: 'fixture-a-portainer', label: 'Portainer', body: 'Container endpoint settings.' },
    { id: 'fixture-m-proxmox', label: 'Proxmox', body: 'Cluster profile and token settings.' },
    { id: 'fixture-b-cheapskate', label: 'Cheapskate', body: 'Model cost controls.' },
  ];
  for (const pane of panes) {
    registerSettingsPane({
      id: pane.id,
      label: pane.label,
      icon: mockIcon,
      searchable: true,
      searchPlaceholder: `Filter ${pane.label} settings…`,
      // Deliberately scrambled: the dialog should still list add-on panes alphabetically.
      order: pane.id === 'fixture-z-observability' ? 1 : 999,
      component: (props) => html`<${MockAddonPane} label=${pane.label} body=${pane.body} filter=${props?.filter || ''} />`,
    });
  }
}

const fixtureModelOptions = Array.from({ length: 160 }, (_, index) => {
  const provider = ['openai', 'anthropic', 'github-copilot', 'azure-openai', 'cerebras'][index % 5];
  const family = ['gpt', 'claude', 'sonnet', 'llama', 'qwen'][index % 5];
  const label = `${provider}/${family}-fixture-${String(index + 1).padStart(3, '0')}`;
  return {
    label,
    provider,
    id: label.slice(provider.length + 1),
    name: `${family.toUpperCase()} Fixture ${index + 1}`,
    context_window: [128000, 200000, 400000, 1000000][index % 4],
    reasoning: index % 3 !== 0,
    thinking_levels: index % 3 !== 0 ? ['off', 'minimal', 'low', 'medium', 'high'] : ['off'],
    pricing: { input_per_million: 0.25 + (index % 6), output_per_million: 1.25 + (index % 8) },
  };
});

const mockSettingsData = {
  userName: 'Rui Carmo',
  assistantName: 'Smith',
  userAvatar: '',
  assistantAvatar: '',
  composeUploadLimitMb: 32,
  workspaceUploadLimitMb: 256,
  widgetToken: 'piclaw_widget_fixture_token_0123456789abcdef',
  searchMatchMode: 'or',
  instanceTotp: {
    configured: true,
    issuer: 'Piclaw Fixture',
    label: 'Piclaw Fixture:Rui Carmo',
    secret: 'JBSWY3DPEHPK3PXP',
    otpauth: 'otpauth://totp/Piclaw%20Fixture:Rui%20Carmo?secret=JBSWY3DPEHPK3PXP&issuer=Piclaw%20Fixture',
    qrSvg: '<svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg"><rect width="96" height="96" rx="10" fill="#fff"/><g fill="#111"><rect x="10" y="10" width="22" height="22"/><rect x="64" y="10" width="22" height="22"/><rect x="10" y="64" width="22" height="22"/><rect x="40" y="14" width="8" height="8"/><rect x="52" y="26" width="8" height="8"/><rect x="42" y="42" width="10" height="10"/><rect x="62" y="46" width="8" height="8"/><rect x="76" y="60" width="8" height="8"/><rect x="48" y="72" width="8" height="8"/></g></svg>',
  },
  providers: [
    { id: 'openai', label: 'OpenAI', authType: 'api_key', configured: true },
    { id: 'anthropic', label: 'Anthropic', authType: 'api_key', configured: false },
    { id: 'github-copilot', label: 'GitHub Copilot', authType: 'oauth', configured: true },
  ],
  models: fixtureModelOptions.map((model) => model.label),
  model_options: fixtureModelOptions,
  current: fixtureModelOptions[0].label,
  thinking_level: 'medium',
  supports_thinking: true,
  available_thinking_levels: ['off', 'minimal', 'low', 'medium', 'high'],
  themes: [
    { id: 'system', label: 'System', dark: false },
    { id: 'ipad-pro', label: 'iPad Pro', dark: true },
    { id: 'terminal', label: 'Terminal', dark: true },
  ],
  colorKeys: ['accent', 'background', 'surface', 'text'],
  toolsets: [
    { name: 'core', description: 'Core shell and file tools', tools: [{ name: 'read', kind: 'read-only' }, { name: 'bash', kind: 'mutating' }] },
    { name: 'ui', description: 'Web UI posting tools', tools: [{ name: 'send_dashboard_widget', kind: 'mutating' }, { name: 'send_adaptive_card', kind: 'mutating' }] },
    { name: 'remote', description: 'Infrastructure tools', tools: [{ name: 'ssh', kind: 'mixed' }, { name: 'proxmox', kind: 'mixed' }, { name: 'portainer', kind: 'mixed' }] },
  ],
};

const mockModelsPayload = {
  current: mockSettingsData.current,
  models: mockSettingsData.models,
  model_options: mockSettingsData.model_options,
  thinking_level: mockSettingsData.thinking_level,
  supports_thinking: mockSettingsData.supports_thinking,
  available_thinking_levels: mockSettingsData.available_thinking_levels,
  scoped_models_only: true,
  scoped_model_filter_active: true,
  enabled_model_patterns: ['openai/*', 'anthropic/claude*', 'github-copilot/gpt*'],
};

const mockAddonsPayload = {
  sources: ['fixture-catalog'],
  failed_sources: [],
  addons: [
    { slug: 'goal', name: 'Goal', description: 'Persisted thread goals and bounded autonomous continuation.', tags: ['automation', 'core'], installed: true, enabled: true, version: '0.1.46', bundled: false },
    { slug: 'observability', name: 'Observability', description: 'Local metrics and tracing panels.', tags: ['metrics'], installed: true, enabled: true, version: '0.2.0', bundled: false },
    { slug: 'portainer', name: 'Portainer', description: 'Container management add-on.', installed: false, enabled: false, version: '0.3.0', bundled: false },
    { slug: 'proxmox', name: 'Proxmox', description: 'Proxmox inventory and workflow add-on.', installed: true, enabled: false, version: '0.4.0', bundled: false },
  ],
};

const mockKeychainPayload = {
  entries: [
    { name: 'github/piclaw-bot-pat', type: 'token', envVar: 'GITHUB_PICLAW_BOT_PAT', updatedAt: new Date().toISOString(), userNote: 'Fixture note', agentNote: 'Use only through env injection.' },
    { name: 'ssh/relay.local', type: 'secret', envVar: 'SSH_RELAY_LOCAL', updatedAt: new Date().toISOString(), userNote: '', agentNote: '' },
  ],
};

let mockMode = new URLSearchParams(window.location.search).get('real') !== '1';
const originalFetch = window.fetch.bind(window);

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installMockFetch() {
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    const method = String(init?.method || 'GET').toUpperCase();
    if (!mockMode) return originalFetch(input, init);

    if (url.pathname === '/agent/settings-data') return json(mockSettingsData);
    if (url.pathname === '/agent/models') return json(mockModelsPayload);
    if (url.pathname === '/agent/addons') return json(mockAddonsPayload);
    if (url.pathname.startsWith('/agent/addons/')) return json({ ok: true, message: 'Fixture add-on action accepted.', ...mockAddonsPayload });
    if (url.pathname === '/agent/keychain') {
      if (method === 'GET') return json(mockKeychainPayload);
      if (method === 'POST') return json({ ok: true, ...mockKeychainPayload });
    }
    if (url.pathname === '/agent/settings/general') return json({ ok: true, settings: mockSettingsData });
    if (url.pathname === '/agent/settings/widget-token/regenerate') return json({ ok: true, settings: { ...mockSettingsData, widgetToken: `piclaw_widget_fixture_regenerated_${Date.now()}` } });
    if (url.pathname.startsWith('/agent/default/message')) return json({ command: { status: 'success', message: 'Fixture command accepted.' } });
    if (url.pathname.startsWith('/agent/settings/')) return json({ ok: true, settings: mockSettingsData, items: [], entries: [] });
    if (url.pathname === '/agent/client-perf') return json({ ok: true });

    return originalFetch(input, init);
  };
}

function injectFixtureStyle() {
  const style = document.createElement('style');
  style.textContent = `
    html, body, #settings-widget-fixture-root { margin: 0; width: 100%; height: 100%; overflow: hidden; background: var(--bg-primary, #111827); color: var(--text-primary, #e5e7eb); }
    .settings-fixture-shell { height: 100vh; display: grid; grid-template-rows: auto minmax(0, 1fr); background: var(--bg-primary, #111827); }
    .settings-fixture-toolbar { position: relative; z-index: 2600; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border-bottom: 1px solid var(--border-color, rgba(148,163,184,.22)); background: var(--bg-secondary, #0f172a); font: 12px var(--font-sans, system-ui, sans-serif); }
    .settings-fixture-toolbar strong { margin-right: 4px; }
    .settings-fixture-toolbar button, .settings-fixture-toolbar select, .settings-fixture-toolbar input { border: 1px solid var(--border-color, rgba(148,163,184,.28)); border-radius: 7px; background: var(--bg-primary, #111827); color: inherit; padding: 5px 8px; font: inherit; }
    .settings-fixture-toolbar input[type="range"] { padding: 0; width: 120px; }
    .settings-fixture-canvas { position: relative; min-height: 0; overflow: hidden; }
    .settings-fixture-canvas .settings-dialog-backdrop { position: absolute; inset: 0; background: color-mix(in srgb, var(--bg-primary, #111827) 82%, transparent); }
    .settings-fixture-canvas .settings-dialog { width: min(var(--fixture-width, 900px), 96vw); height: min(var(--fixture-height, 640px), 94%); max-width: none; max-height: none; }
    .settings-fixture-note { opacity: .72; }
  `;
  document.head.appendChild(style);
}

function setRequestedSection(section) {
  try { window.__piclawSettingsRequestedSection = section; } catch (e) { void e; }
  window.dispatchEvent(new CustomEvent('piclaw:open-settings', { detail: { section } }));
}

function FixtureApp() {
  const params = new URLSearchParams(window.location.search);
  const [section, setSection] = useState(params.get('section') || 'general');
  const [width, setWidth] = useState(Number(params.get('width') || 900));
  const [height, setHeight] = useState(Number(params.get('height') || 640));
  const [usingMock, setUsingMock] = useState(mockMode);
  const [renderKey, setRenderKey] = useState(0);

  const sections = useMemo(() => [
    'general', 'sessions', 'compaction', 'keyboard', 'workspace', 'environment', 'providers', 'models', 'theme', 'scheduled-tasks', 'quick-actions', 'keychain', 'tools', 'addons',
    'fixture-b-cheapskate', 'fixture-z-observability', 'fixture-a-portainer', 'fixture-m-proxmox',
  ], []);

  const switchSection = useCallback((next) => {
    setSection(next);
    setRequestedSection(next);
  }, []);

  const toggleMock = useCallback(() => {
    mockMode = !mockMode;
    setUsingMock(mockMode);
    setRenderKey((value) => value + 1);
  }, []);

  return html`
    <div class="settings-fixture-shell">
      <div class="settings-fixture-toolbar">
        <strong>Settings fixture</strong>
        <label>Section <select value=${section} onChange=${(e) => switchSection(e.target.value)}>${sections.map((item) => html`<option value=${item}>${item}</option>`)}</select></label>
        <label>Width <input type="range" min="480" max="1200" value=${width} onInput=${(e) => setWidth(Number(e.target.value))} /> ${width}px</label>
        <label>Height <input type="range" min="420" max="900" value=${height} onInput=${(e) => setHeight(Number(e.target.value))} /> ${height}px</label>
        <button type="button" onClick=${toggleMock}>${usingMock ? 'Mock data' : 'Real endpoints'}</button>
        <button type="button" onClick=${() => setRenderKey((value) => value + 1)}>Remount</button>
        <span class="settings-fixture-note">Add-on panes are registered in scrambled order for nav ordering tests.</span>
      </div>
      <div class="settings-fixture-canvas" style=${`--fixture-width:${width}px;--fixture-height:${height}px;`}>
        <${SettingsDialogContent} key=${renderKey} onClose=${() => {}} />
      </div>
    </div>
  `;
}

function main() {
  registerFixturePanes();
  installMockFetch();
  injectFixtureStyle();
  const params = new URLSearchParams(window.location.search);
  setRequestedSection(params.get('section') || 'general');
  const root = document.getElementById('settings-widget-fixture-root') || document.body.appendChild(document.createElement('div'));
  root.id = 'settings-widget-fixture-root';
  render(html`<${FixtureApp} />`, root);
  window.piclawWidget?.ready?.({ title: 'Settings fixture', mockMode });
}

main();
