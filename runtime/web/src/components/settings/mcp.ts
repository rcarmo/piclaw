import { html, useCallback, useEffect, useMemo, useState } from '../../vendor/preact-htm.js';
import { useSettingsFieldIds } from './field-ids.js';
import { NumberStepper } from './number-stepper.js';

const DEFAULT_RECALL = () => ({
    mode: 'off',
    maxAgeDays: 7,
    maxItems: 128,
    maxBytes: 8 * 1024 * 1024,
    profiles: [],
});

function parseJsonArray(raw: string, fallback: string[] = []): string[] {
    const value = raw.trim();
    if (!value) return fallback;
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed) || parsed.some(item=>typeof item!=='string')) throw Error('Command must be a JSON string array.');
        return parsed;
    } catch {
        throw Error('Command must be a valid JSON string array.');
    }
}

function parseJsonObject(raw: string, fallback: Record<string, string> = {}): Record<string, string> {
    const value = raw.trim();
    if (!value) return fallback;
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('Environment must be a JSON object.');
        const next: Record<string, string> = {};
        for (const [key, entry] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof entry !== 'string') throw Error('Environment values must be strings.');
            next[key] = entry;
        }
        return next;
    } catch {
        throw Error('Environment must be a valid JSON object with string values.');
    }
}

function createConnectionDraft(workspaceId: string, source: any = null, recallDefaults = DEFAULT_RECALL()) {
    const data = source || {};
    const recall = { ...DEFAULT_RECALL(), ...(recallDefaults || {}), ...(data.recall || {}) };
    return {
        id: data.id || crypto.randomUUID(),
        name: data.name || '',
        workspaceId: data.workspaceId || workspaceId || 'workspace',
        access: data.access || null,
        grantMode: data.access?.kind === 'all' ? 'all' : (data.access?.grants?.find(grant => grant.workspaceId === (data.workspaceId || workspaceId))?.agentIds ?? (data.agentIds?.length ? data.agentIds : 'all')) === 'all' ? 'workspace' : 'agents',
        agentIds: Array.isArray(data.access?.grants?.find(grant => grant.workspaceId === (data.workspaceId || workspaceId))?.agentIds) ? [...data.access.grants.find(grant => grant.workspaceId === (data.workspaceId || workspaceId)).agentIds] : Array.isArray(data.agentIds) ? [...data.agentIds] : [],
        enabled: data.enabled !== false,
        transport: data.transport || 'http',
        url: data.url || '',
        auth: data.auth || 'bearer',
        allowHttp: Boolean(data.allowHttp),
        timeoutSeconds: Number(data.timeoutSeconds || 30),
        revision: Number(data.revision || 0),
        accessEpoch: data.accessEpoch || crypto.randomUUID(),
        hasSavedCredentials: Boolean(data.hasSavedCredentials),
        needsCredentialApproval: Boolean(data.needsCredentialApproval),
        approveCredentialReuse: false,
        status: data.status || null,
        oauth: {
            clientId: data.oauth?.clientId || '',
            scope: data.oauth?.scope || '',
            clientSecretKeychain: '',
        },
        bearerTokenKeychain: '',
        command: Array.isArray(data.command) ? [...data.command] : [],
        commandText: Array.isArray(data.command) ? JSON.stringify(data.command) : '',
        workdir: data.workdir || '',
        env: data.env && typeof data.env === 'object' ? { ...data.env } : {},
        envText: data.env && typeof data.env === 'object' ? JSON.stringify(data.env) : '',
        recall,
    };
}

function normalizeRecallInput(value: any) {
    const input = value && typeof value === 'object' ? value : {};
    const recall = { ...DEFAULT_RECALL(), ...input };
    return {
        mode: recall.mode === 'observe' || recall.mode === 'active' ? recall.mode : 'off',
        maxAgeDays: Number(recall.maxAgeDays || 7),
        maxItems: Number(recall.maxItems || 128),
        maxBytes: Number(recall.maxBytes || 8 * 1024 * 1024),
        profiles: Array.isArray(recall.profiles) ? recall.profiles : [],
    };
}

function toConnectionSavePayload(draft: any, fallbackWorkspace: string): Record<string, any> {
    const payload: Record<string, any> = {
        id: draft.id,
        name: String(draft.name || '').trim(),
        workspaceId: String(draft.workspaceId || fallbackWorkspace || 'workspace'),
        agentIds: Array.from(new Set((draft.agentIds || []).filter(Boolean))),
        enabled: Boolean(draft.enabled),
        transport: draft.transport || 'http',
        url: String(draft.url || '').trim(),
        auth: draft.auth || 'bearer',
        allowHttp: Boolean(draft.allowHttp),
        timeoutSeconds: Number(draft.timeoutSeconds || 30),
        recall: normalizeRecallInput(draft.recall),
    };

    if (draft.grantMode === 'agents' && !payload.agentIds.length) throw Error('Select at least one Agent, or explicitly choose all Agents in this workspace.');
    const otherGrants = draft.access?.kind === 'workspaces' ? draft.access.grants.filter(grant => grant.workspaceId !== payload.workspaceId) : [];
    payload.access = draft.grantMode === 'all' ? {kind:'all'} : {kind:'workspaces',grants:[...otherGrants,{workspaceId:payload.workspaceId,agentIds:draft.grantMode === 'agents' ? payload.agentIds : 'all'}]};
    if (payload.transport === 'stdio') {
        const command = parseJsonArray(String(draft.commandText || ''), Array.isArray(draft.command) ? draft.command : []);
        if (command.length) payload.command = command;
        if (String(draft.workdir || '').trim()) payload.workdir = String(draft.workdir || '').trim();
        const env = parseJsonObject(String(draft.envText || ''), draft.env || {});
        const envFiltered: Record<string, string> = {};
        for (const [key, value] of Object.entries(env)) {
            if (typeof value === 'string') envFiltered[key] = value;
            else if (value !== undefined && value !== null) envFiltered[key] = String(value);
        }
        if (String(draft.envText || '').trim() || Object.keys(envFiltered).length) payload.env = envFiltered;
    } else {
        payload.url = String(draft.url || '').trim();
        if (draft.auth === 'bearer' && String(draft.bearerTokenKeychain || '').trim()) {
            payload.bearerTokenKeychain = String(draft.bearerTokenKeychain || '').trim();
        }
        if (draft.auth === 'oauth') {
            const oauth: Record<string, string> = {};
            const clientId = String(draft.oauth?.clientId || '').trim();
            const scope = String(draft.oauth?.scope || '').trim();
            const secret = String(draft.oauth?.clientSecretKeychain || '').trim();
            if (clientId) oauth.clientId = clientId;
            if (scope) oauth.scope = scope;
            if (secret) oauth.clientSecretKeychain = secret;
            if (Object.keys(oauth).length) payload.oauth = oauth;
        }
    }

    return payload;
}

function renderConnectionStateLabel(status: any) {
    if (!status || typeof status !== 'object') return 'Unknown status';
    const state = typeof status.state === 'string' ? status.state : 'unknown';
    const message = typeof status.message === 'string' && status.message.trim() ? ` · ${status.message}` : '';
    const tools = Array.isArray(status.tools) && status.tools.length ? ` · ${status.tools.length} tools` : '';
    return `${state}${message}${tools}`;
}

export function McpSection({ setStatus }: {setStatus?:(message:string|null,kind?:string)=>void} = {}) {
    const fieldId = useSettingsFieldIds('mcp');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [workspaceId, setWorkspaceId] = useState('');
    const [agents, setAgents] = useState<any[]>([]);
    const [connections, setConnections] = useState<any[]>([]);
    const [migration, setMigration] = useState<any>(null);
    const [defaults, setDefaults] = useState({ recall: DEFAULT_RECALL() });
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<any>(() => createConnectionDraft('workspace'));

    const selectedConnection = useMemo(() => connections.find((connection) => connection.id === selectedId) || null, [connections, selectedId]);

    const loadSettings = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const response = await fetch('/agent/settings/mcp', { credentials: 'same-origin', cache: 'no-store' });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || `MCP settings failed (${response.status})`);
            }
            const nextConnections = Array.isArray(payload.connections) ? payload.connections : [];
            setWorkspaceId(payload.workspaceId || 'workspace');
            setAgents(Array.isArray(payload.agents) ? payload.agents : []);
            setConnections(nextConnections);
            setMigration(payload.migration || null);
            setDefaults({ recall: normalizeRecallInput(payload.defaults?.recall || DEFAULT_RECALL()) });
            setSelectedId((current) => {
                if (current && nextConnections.some((connection) => connection.id === current)) return current;
                return nextConnections[0]?.id || null;
            });
            setStatus?.(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            setStatus?.(message, 'error');
        } finally {
            setLoading(false);
        }
    }, [setStatus]);

    useEffect(() => { void loadSettings(); }, [loadSettings]);

    useEffect(() => {
        if (!selectedConnection) {
            setDraft(createConnectionDraft(workspaceId, null, defaults.recall));
            return;
        }
        setDraft(createConnectionDraft(workspaceId, selectedConnection, defaults.recall));
    }, [defaults.recall, selectedConnection, workspaceId]);

    const noConnectionOpen = !selectedConnection && !selectedId;

    const saveDraft = useCallback(async () => {
        const name = String(draft.name || '').trim();
        if (!name) {
            setError('Connection name is required.');
            setStatus?.('Connection name is required.', 'error');
            return;
        }
        if (draft.transport === 'http' && !String(draft.url || '').trim()) {
            setError('HTTP MCP connections need an endpoint URL.');
            setStatus?.('HTTP MCP connections need an endpoint URL.', 'error');
            return;
        }
        setSaving(true);
        setError('');
        setStatus?.('Saving MCP connection…', 'info');
        try {
            const connection = toConnectionSavePayload(draft, workspaceId);
            const response = await fetch('/agent/settings/mcp', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'save',
                    connection,
                    expectedRevision: Number((selectedConnection?.revision ?? draft.revision ?? 0) || 0),
                    approveCredentialReuse: Boolean(draft.approveCredentialReuse),
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
                const detail = payload?.error || 'MCP connection could not be saved.';
                throw new Error(detail);
            }
            setStatus?.('MCP connection saved.', 'success');
            setSelectedId(payload?.connection?.id || connection.id || selectedId || null);
            await loadSettings();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            setStatus?.(message, 'error');
        } finally {
            setSaving(false);
        }
    }, [draft, loadSettings, selectedConnection, selectedId, setStatus, workspaceId]);

    const removeSelected = useCallback(async () => {
        if (!selectedConnection) return;
        setSaving(true);
        try {
            const response = await fetch('/agent/settings/mcp', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove', id: selectedConnection.id, expectedRevision: Number(selectedConnection.revision || 0) }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || 'Could not remove the MCP connection.');
            }
            setSelectedId(null);
            setStatus?.('MCP connection removed.', 'success');
            await loadSettings();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            setStatus?.(message, 'error');
        } finally {
            setSaving(false);
        }
    }, [loadSettings, selectedConnection, setStatus]);

    const reconnectSelected = useCallback(async () => {
        if (!selectedConnection) return;
        setSaving(true);
        try {
            const response = await fetch('/agent/settings/mcp', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reconnect', id: selectedConnection.id }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || 'Could not reconnect the MCP connection.');
            }
            setStatus?.('Reconnect requested.', 'success');
            await loadSettings();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            setStatus?.(message, 'error');
        } finally {
            setSaving(false);
        }
    }, [loadSettings, selectedConnection, setStatus]);

    const signIn = useCallback(async () => {
        if (!selectedConnection || saving) return;
        setSaving(true);
        try {
            const response = await fetch('/agent/settings/mcp', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'sign_in', id: selectedConnection.id }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) throw new Error(payload?.error || 'OAuth sign-in was not available.');
            if (payload.authorizationUrl) window.location.assign(payload.authorizationUrl);
            else { setStatus?.(payload.message || 'Already signed in.', 'success'); await loadSettings(); }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            setStatus?.(message, 'error');
        } finally { setSaving(false); }
    }, [selectedConnection, setStatus, saving, loadSettings]);

    const signOut = useCallback(async () => {
        if (!selectedConnection || saving) return;
        setSaving(true);
        try {
            const response = await fetch('/agent/settings/mcp', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'sign_out', id: selectedConnection.id }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || 'OAuth sign-out failed.');
            }
            setStatus?.('OAuth sign-out completed.', 'success');
            await loadSettings();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            setStatus?.(message, 'error');
        } finally { setSaving(false); }
    }, [loadSettings, selectedConnection, setStatus, saving]);

    const forgetRecall = useCallback(async () => {
        if (!selectedConnection || saving || !confirm('Forget retained MCP recall copies for this connection? Original SDK history is unchanged.')) return;
        setSaving(true);
        try {
            const response = await fetch('/agent/settings/mcp', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'forget_recall', id: selectedConnection.id }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.ok) {
                throw new Error(payload?.error || 'Could not clear MCP recall history.');
            }
            setStatus?.('MCP recall history was cleared.', 'success');
            await loadSettings();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
            setStatus?.(message, 'error');
        } finally { setSaving(false); }
    }, [loadSettings, selectedConnection, setStatus, saving]);

    const canEdit = !loading && !saving;

    return html`
        <div class="settings-section">
            <h3>MCP</h3>
            ${loading && html`<p class="settings-hint" role="status">Loading MCP connections…</p>`}
            ${error && html`<p class="mcp-notice settings-error" role="alert">${error}</p>`}
            ${migration?.diagnostics?.length > 0 && html`
                <div class="settings-row settings-dense-row" style="display:block">
                    <strong>Imported disabled entries</strong>
                    <ul style="margin:8px 0 0 1.2rem; padding:0;">
                        ${migration.diagnostics.map((entry) => html`<li key=${entry.name}>
                            <strong>${entry.name}</strong>: ${entry.fields?.join(', ') || 'fields'} — ${entry.reason}
                        </li>`)}
                    </ul>
                </div>
            `}

            <div class="settings-row settings-dense-row">
                <label>Workspace</label>
                <span class="settings-hint" style="margin:0">${workspaceId || 'current workspace'}</span>
            </div>

            <div class="settings-row" style="display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
                <label style="min-width:140px">Connections</label>
                <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    ${connections.map((connection) => html`
                        <button
                            type="button"
                            key=${connection.id}
                            class=${`settings-btn ${selectedId === connection.id ? 'primary' : ''}`}
                            onClick=${() => setSelectedId(connection.id)}
                            disabled=${saving}
                        >
                            ${connection.name || 'Unnamed'}
                        </button>
                    `)}
                    <button type="button" class="settings-btn" onClick=${() => setSelectedId(null)} disabled=${saving}>New connection</button>
                </div>
            </div>

            <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                <label class="settings-dense-check" for=${fieldId('new-connection-toggle')}>
                    <input id=${fieldId('new-connection-toggle')} type="checkbox" checked=${Boolean(draft.enabled)} disabled=${!canEdit} onChange=${(event) => setDraft((prev) => ({ ...prev, enabled: (event.currentTarget as HTMLInputElement).checked }))} />
                    <span>Enabled</span>
                </label>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${fieldId('name')}>Name</label>
                <input id=${fieldId('name')} type="text" value=${draft.name || ''} disabled=${!canEdit} onInput=${(event) => setDraft((prev) => ({ ...prev, name: (event.currentTarget as HTMLInputElement).value }))} placeholder="my-mcp-server" />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${fieldId('workspace')}>Workspace</label>
                <input id=${fieldId('workspace')} type="text" value=${draft.workspaceId || workspaceId || 'workspace'} disabled=${true} />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${fieldId('grant-mode')}>Access</label>
                <select id=${fieldId('grant-mode')} value=${draft.grantMode} disabled=${!canEdit} onChange=${event=>setDraft(previous=>({...previous,grantMode:event.currentTarget.value}))}>
                    <option value="workspace">This workspace, all Agents</option><option value="agents">Selected Agents in this workspace</option><option value="all">All workspaces and Agents</option>
                </select>
            </div>
            <div class="settings-row settings-dense-row">
                <label for=${fieldId('agentIds')}>Selected Agents</label>
                <div id=${fieldId('agentIds')} style="display:flex; flex-wrap:wrap; gap:8px; min-height:32px;">
                    ${agents.length === 0 ? html`<span class="settings-hint" style="margin:0">No agents reported.</span>` : agents.map((agent) => { const checked = draft.agentIds.includes(agent.id); return html`
                        <label key=${agent.id} class="settings-dense-check" style="padding:4px 8px; border:1px solid var(--border-color, rgba(255,255,255,0.12)); border-radius:999px;">
                            <input type="checkbox" checked=${checked} disabled=${!canEdit || draft.grantMode !== 'agents'} onChange=${(event) => {
                                const isChecked = (event.currentTarget as HTMLInputElement).checked;
                                setDraft((prev) => ({
                                    ...prev,
                                    agentIds: isChecked ? Array.from(new Set([...prev.agentIds, agent.id])) : prev.agentIds.filter((id) => id !== agent.id),
                                }));
                            }} />
                            <span>${agent.label || agent.id}</span>
                        </label>
                    `; })}
                </div>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${fieldId('transport')}>Transport</label>
                <select id=${fieldId('transport')} value=${draft.transport || 'http'} disabled=${!canEdit} onChange=${(event) => setDraft((prev) => ({ ...prev, transport: (event.currentTarget as HTMLSelectElement).value as 'http' | 'stdio' }))}>
                    <option value="http">HTTP</option>
                    <option value="stdio">stdio</option>
                </select>
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${fieldId('url')}>URL</label>
                <input id=${fieldId('url')} type="text" value=${draft.url || ''} disabled=${!canEdit || draft.transport !== 'http'} onInput=${(event) => setDraft((prev) => ({ ...prev, url: (event.currentTarget as HTMLInputElement).value }))} placeholder="https://example.test/mcp" />
            </div>

            <div class="settings-row settings-dense-row">
                <label for=${fieldId('auth')}>Authentication</label>
                <select id=${fieldId('auth')} value=${draft.auth || 'bearer'} disabled=${!canEdit || draft.transport !== 'http'} onChange=${(event) => setDraft((prev) => ({ ...prev, auth: (event.currentTarget as HTMLSelectElement).value as 'none' | 'bearer' | 'oauth' }))}>
                    <option value="none">No authentication</option>
                    <option value="bearer">Bearer token</option>
                    <option value="oauth">OAuth</option>
                </select>
            </div>

            ${draft.transport === 'http' && html`
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${fieldId('allow-http')}>
                        <input id=${fieldId('allow-http')} type="checkbox" checked=${Boolean(draft.allowHttp)} disabled=${!canEdit} onChange=${(event) => setDraft((prev) => ({ ...prev, allowHttp: (event.currentTarget as HTMLInputElement).checked }))} />
                        <span>Allow insecure HTTP</span>
                    </label>
                </div>
            `}

            ${draft.transport === 'http' && draft.auth === 'bearer' && html`
                <div class="settings-row settings-dense-row">
                    <label for=${fieldId('bearer-keychain')}>Bearer token keychain reference</label>
                    <input id=${fieldId('bearer-keychain')} type="text" value=${draft.bearerTokenKeychain || ''} disabled=${!canEdit} onInput=${(event) => setDraft((prev) => ({ ...prev, bearerTokenKeychain: (event.currentTarget as HTMLInputElement).value }))} placeholder="my-server/token" />
                </div>
            `}

            ${draft.transport === 'http' && draft.auth === 'oauth' && html`
                <div class="settings-row settings-dense-row">
                    <label for=${fieldId('oauth-client-id')}>OAuth client ID</label>
                    <input id=${fieldId('oauth-client-id')} type="text" value=${draft.oauth?.clientId || ''} disabled=${!canEdit} onInput=${(event) => setDraft((prev) => ({ ...prev, oauth: { ...prev.oauth, clientId: (event.currentTarget as HTMLInputElement).value } }))} placeholder="client-id" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${fieldId('oauth-scope')}>OAuth scope</label>
                    <input id=${fieldId('oauth-scope')} type="text" value=${draft.oauth?.scope || ''} disabled=${!canEdit} onInput=${(event) => setDraft((prev) => ({ ...prev, oauth: { ...prev.oauth, scope: (event.currentTarget as HTMLInputElement).value } }))} placeholder="mcp.read mcp.write" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${fieldId('oauth-secret-keychain')}>OAuth client secret keychain</label>
                    <input id=${fieldId('oauth-secret-keychain')} type="text" value=${draft.oauth?.clientSecretKeychain || ''} disabled=${!canEdit} onInput=${(event) => setDraft((prev) => ({ ...prev, oauth: { ...prev.oauth, clientSecretKeychain: (event.currentTarget as HTMLInputElement).value } }))} placeholder="my-server/oauth-secret" />
                </div>
                <div class="settings-row settings-dense-row" style="gap:8px; flex-wrap:wrap;">
                    <button type="button" class="settings-btn" disabled=${!selectedConnection || saving} onClick=${signIn}>Sign in</button>
                    <button type="button" class="settings-btn" disabled=${!selectedConnection || saving} onClick=${signOut}>Sign out</button>
                </div>
            `}

            ${draft.transport === 'stdio' && html`
                <div class="settings-row settings-dense-row">
                    <label for=${fieldId('stdio-command')}>Command</label>
                    <input id=${fieldId('stdio-command')} type="text" value=${draft.commandText || ''} disabled=${!canEdit} onInput=${(event) => setDraft((prev) => ({ ...prev, commandText: (event.currentTarget as HTMLInputElement).value }))} placeholder='["bun","run","server.ts"]' />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${fieldId('workdir')}>Work directory</label>
                    <input id=${fieldId('workdir')} type="text" value=${draft.workdir || ''} disabled=${!canEdit} onInput=${(event) => setDraft((prev) => ({ ...prev, workdir: (event.currentTarget as HTMLInputElement).value }))} placeholder="/workspace/project" />
                </div>
                <div class="settings-row settings-dense-row">
                    <label for=${fieldId('stdio-env')}>Environment JSON</label>
                    <textarea id=${fieldId('stdio-env')} rows="3" value=${draft.envText || ''} disabled=${!canEdit} onInput=${(event) => setDraft((prev) => ({ ...prev, envText: (event.currentTarget as HTMLTextAreaElement).value }))} placeholder='{"KEY":"keychain:server/token"}'></textarea>
                </div>
            `}

            <div class="settings-row settings-dense-row">
                <label>Timeout</label>
                <${NumberStepper}
                    id=${fieldId('timeout')}
                    label="MCP timeout seconds"
                    value=${Number(draft.timeoutSeconds || 30)}
                    min=${1}
                    max=${300}
                    step=${5}
                    fallback=${30}
                    width="88px"
                    disabled=${!canEdit}
                    onChange=${(value) => setDraft((prev) => ({ ...prev, timeoutSeconds: Number(value || 30) }))}
                />
                <span class="settings-hint" style="margin:0">Seconds</span>
            </div>

            <div class="settings-row settings-dense-row">
                <label>Recall</label>
                <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    <select value=${String(draft.recall?.mode || 'off')} disabled=${!canEdit} onChange=${(event) => setDraft((prev) => ({ ...prev, recall: { ...normalizeRecallInput(prev.recall), mode: (event.currentTarget as HTMLSelectElement).value as 'off' | 'observe' | 'active' } }))}>
                        <option value="off">Off</option>
                        <option value="observe">Observe</option>
                        <option value="active">Active</option>
                    </select>

                </div>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Retention</label>
                <${NumberStepper}
                    id=${fieldId('recall-retention')}
                    label="Recall retention days"
                    value=${Number(draft.recall?.maxAgeDays || 7)}
                    min=${1}
                    max=${90}
                    fallback=${7}
                    width="88px"
                    disabled=${!canEdit}
                    onChange=${(value) => setDraft((prev) => ({ ...prev, recall: { ...normalizeRecallInput(prev.recall), maxAgeDays: Number(value || 7) } }))}
                />
                <span class="settings-hint" style="margin:0">days</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Recall size</label>
                <${NumberStepper}
                    id=${fieldId('recall-max-items')}
                    label="Recall max items"
                    value=${Number(draft.recall?.maxItems || 128)}
                    min=${1}
                    max=${256}
                    fallback=${128}
                    width="90px"
                    disabled=${!canEdit}
                    onChange=${(value) => setDraft((prev) => ({ ...prev, recall: { ...normalizeRecallInput(prev.recall), maxItems: Number(value || 128) } }))}
                />
                <span class="settings-hint" style="margin:0">items</span>
            </div>
            <div class="settings-row settings-dense-row">
                <label>Recall max bytes</label>
                <${NumberStepper}
                    id=${fieldId('recall-max-bytes')}
                    label="Recall max bytes"
                    value=${Number(draft.recall?.maxBytes || 8 * 1024 * 1024)}
                    min=${4096}
                    max=${16 * 1024 * 1024}
                    step=${1024}
                    fallback=${8 * 1024 * 1024}
                    width="115px"
                    disabled=${!canEdit}
                    onChange=${(value) => setDraft((prev) => ({ ...prev, recall: { ...normalizeRecallInput(prev.recall), maxBytes: Number(value || 8 * 1024 * 1024) } }))}
                />
                <span class="settings-hint" style="margin:0">bytes</span>
            </div>

            <div class="settings-row settings-dense-row" style="gap:8px; flex-wrap:wrap;">
                <button type="button" class="settings-btn" disabled=${!canEdit || !draft.name} onClick=${saveDraft}>${saving ? 'Saving…' : 'Save connection'}</button>
                <button type="button" class="settings-btn" disabled=${!selectedConnection || saving} onClick=${reconnectSelected}>Reconnect</button>
                <button type="button" class="settings-btn danger" disabled=${!selectedConnection || saving} onClick=${removeSelected}>Remove</button>
                <button type="button" class="settings-btn" disabled=${!selectedConnection || saving} onClick=${forgetRecall}>Forget recall</button>
            </div>

            ${selectedConnection?.status && html`
                <div class="settings-row" style="display:block;">
                    <strong>Status</strong>
                    <p class="settings-hint" style="margin:8px 0 0 0">${renderConnectionStateLabel(selectedConnection.status)}</p>
                </div>
            `}
            ${selectedConnection?.needsCredentialApproval && html`
                <div class="settings-row settings-dense-row settings-dense-row-checkbox">
                    <label class="settings-dense-check" for=${fieldId('approve-reuse')}>
                        <input id=${fieldId('approve-reuse')} type="checkbox" checked=${Boolean(draft.approveCredentialReuse)} disabled=${!canEdit} onChange=${(event) => setDraft((prev) => ({ ...prev, approveCredentialReuse: (event.currentTarget as HTMLInputElement).checked }))} />
                        <span>Approve credential reuse for this endpoint or command</span>
                    </label>
                </div>
            `}
            ${noConnectionOpen && html`<p class="settings-hint">Choose an MCP connection or create a new one.</p>`}
        </div>
    `;
}
