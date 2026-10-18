export interface McpServerDraft { name: string; action: 'update' | 'create' | 'remove_override'; patch: Record<string, unknown> }
export interface McpServerRow { name: string; patch: Record<string, unknown>; withheldFields: string[]; enabled: boolean; localOverride: boolean; source: string }
export interface McpServerPayload { ok: true; servers: McpServerRow[]; revision: string; preview: { name: string; action: string; present: boolean; enabled: boolean; applicable: boolean; patch: Record<string, unknown>; withheldFields: string[] } | null; applyAvailable: boolean; phase: string }
export interface McpServerSettingsState { payload: McpServerPayload | null; draft: McpServerDraft; loading: boolean; applying: boolean; previewed: boolean; applied: boolean; error: string | null }
export const INITIAL_MCP_SERVERS: McpServerSettingsState = { payload: null, draft: { name: '', action: 'update', patch: {} }, loading: false, applying: false, previewed: false, applied: false, error: null };
function payload(value: any): McpServerPayload {
  if (value?.ok !== true || !Array.isArray(value.servers) || typeof value.revision !== 'string' || typeof value.applyAvailable !== 'boolean' || typeof value.phase !== 'string'
    || value.servers.some((row: any) => typeof row?.name !== 'string' || !row.patch || typeof row.patch !== 'object' || Array.isArray(row.patch) || !Array.isArray(row.withheldFields) || row.withheldFields.some((field: unknown) => typeof field !== 'string') || typeof row.enabled !== 'boolean' || typeof row.localOverride !== 'boolean')
    || (value.preview !== null && (!value.preview || typeof value.preview.name !== 'string' || typeof value.preview.action !== 'string' || typeof value.preview.applicable !== 'boolean'))) throw Error('Invalid response');
  return value;
}
export function createMcpServerSettingsController(publish: (value: McpServerSettingsState) => void, request: typeof fetch = fetch) {
  let state = { ...INITIAL_MCP_SERVERS, draft: { ...INITIAL_MCP_SERVERS.draft, patch: {} } }, generation = 0, disposed = false;
  let abort: AbortController | null = null;
  const emit = (patch: Partial<McpServerSettingsState>) => { state = { ...state, ...patch }; if (!disposed) publish(state); };
  async function run(mode: 'refresh' | 'preview' | 'apply') {
    if (disposed || state.applying) return;
    if (mode === 'apply' && (!state.previewed || !state.payload?.applyAvailable || !state.payload.preview?.applicable)) return;
    abort?.abort(); abort = new AbortController(); const current = ++generation, signal = abort.signal, draft = structuredClone(state.draft), revision = state.payload?.revision;
    emit({ loading: true, applying: mode === 'apply', error: null, applied: false, previewed: false, ...(mode === 'refresh' ? { payload: null } : {}) });
    try {
      const response = await request(`/agent/settings/mcp/servers${mode === 'refresh' ? '' : `/${mode}`}`, { credentials: 'same-origin', cache: 'no-store', signal,
        ...(mode === 'refresh' ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mode === 'apply' ? { revision, acknowledgeInterruptions: true } : { name: draft.name, action: draft.action, ...(draft.action !== 'remove_override' ? { patch: draft.patch } : {}) }) }) });
      if (!response.ok) throw Error(response.status === 401 || response.status === 403 ? 'owner' : mode === 'apply' ? 'apply' : 'preview');
      const result = payload(await response.json()); if (disposed || current !== generation || signal.aborted) return;
      if (mode === 'preview' && (result.preview?.name !== draft.name || result.preview.action !== draft.action)) throw Error('preview');
      if (mode === 'apply' && (result.phase !== 'ready' || !result.applyAvailable)) throw Error('apply');
      emit({ payload: result, loading: false, applying: false, previewed: mode === 'preview', applied: mode === 'apply', ...(mode === 'apply' ? { draft: { name: '', action: 'update', patch: {} } } : {}) });
    } catch (error) {
      if (disposed || current !== generation || signal.aborted) return;
      emit({ payload: null, loading: false, applying: false, previewed: false, applied: false, error: error instanceof Error && error.message === 'owner'
        ? 'MCP server Settings are owner-only.' : mode === 'apply' ? 'Server application was not confirmed. Refresh before retrying; configuration may have been saved and operations may be blocked.' : 'Could not preview or load server settings. Check fields and refresh.' });
    }
  }
  return { refresh: () => run('refresh'), preview: () => run('preview'), apply: (ack: boolean) => ack ? run('apply') : Promise.resolve(),
    edit(draft: McpServerDraft, { selectExisting = false } = {}) { if (disposed || state.applying) return; abort?.abort(); generation++; emit({ draft: structuredClone({ ...draft, action: !selectExisting && state.draft.action === 'create' && draft.action === 'update' ? 'create' : draft.action }), previewed: false, applied: false, loading: false, error: null }); },
    dispose() { disposed = true; generation++; abort?.abort(); } };
}
/** Form values are explicit local patches, not whole effective configs. */
export const MCP_SERVER_FIELDS = [
  ['command','Executable','text'],['args','Arguments (JSON string array)','json'],['cwd','Working directory','text'],['url','HTTP URL','text'],['socket','Unix socket path','text'],
  ['env','Environment references (JSON object)','json'],['headers','Header references (JSON object)','json'],['auth','Auth: oauth, bearer or false','json'],['bearerTokenKeychain','Bearer keychain entry name','text'],['bearerTokenEnv','Bearer environment name','text'],
  ['disabled','Disabled (true/false)','json'],['lifecycle','Lifecycle: lazy, eager, keep-alive, lazy-keep-alive','text'],['requestTimeoutMs','Request timeout (milliseconds)','json'],['idleTimeout','Idle timeout (minutes)','json'],
  ['directTools','Direct tools (boolean or JSON names)','json'],['includeTools','Included tools (JSON names)','json'],['excludeTools','Excluded tools (JSON names)','json'],['approveTools','Approval rules (boolean or JSON names)','json'],['exposeResources','Expose resources (true/false)','json'],['toolPrefix','Tool prefix: server, none, short, mcp','text'],['httpTransport','HTTP transport: streamable-http or sse','text'],
] as const;
export function patchFromForm(values: Record<string, string>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [field,, kind] of MCP_SERVER_FIELDS) { const text = values[field]?.trim(); if (!text) continue; patch[field] = text === 'null' ? null : kind === 'json' ? JSON.parse(text) : text; }
  return patch;
}

/** An explicit new-server draft. Never repoint an existing or disabled server. */
export function createParallelSearchDraft(servers: readonly Pick<McpServerRow, 'name'>[]): McpServerDraft | null {
  if (servers.some(server => server.name === 'parallel-search')) return null;
  return {
    name: 'parallel-search', action: 'create', patch: {
      url: 'https://search.parallel.ai/mcp',
      httpTransport: 'streamable-http',
      auth: false,
      headers: { 'User-Agent': 'PiClaw (+https://github.com/rcarmo/piclaw)' },
      lifecycle: 'lazy',
      directTools: false,
      includeTools: ['web_search', 'web_fetch'],
      requestTimeoutMs: 60000,
    },
  };
}
