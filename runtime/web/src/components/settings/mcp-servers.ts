import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { createMcpServerSettingsController, createParallelSearchDraft, INITIAL_MCP_SERVERS, MCP_SERVER_FIELDS, patchFromForm, type McpServerSettingsState } from '../../ui/mcp-server-settings-model.js';
import { MCP_FIELD_CHOICES, MCP_FIELD_HELP, MCP_FIELD_LABELS, MCP_FORM_FIELDS, MCP_STRUCTURED_FIELDS, type McpServerField } from '../../ui/mcp-server-form.js';

export function McpServersSection({ busy = false, onApplying = (_applying: boolean) => {} }: { busy?: boolean; onApplying?: (applying: boolean) => void } = {}) {
    const [state, setState] = useState<McpServerSettingsState>(INITIAL_MCP_SERVERS);
    const [name, setName] = useState('');
    const [values, setValues] = useState<Record<string, string>>({});
    const [ack, setAck] = useState(false);
    const [error, setError] = useState('');
    const [invalidField, setInvalidField] = useState('');
    const nameRef = useRef<HTMLInputElement | null>(null);
    const controller = useRef<ReturnType<typeof createMcpServerSettingsController> | null>(null);
    useEffect(() => {
        const current = createMcpServerSettingsController(setState); controller.current = current;
        void current.refresh();
        return () => { current.dispose(); controller.current = null; };
    }, []);
    useEffect(() => { onApplying(state.applying); }, [state.applying]);
    useEffect(() => { if (state.applied) { setName(''); setValues({}); setAck(false); } }, [state.applied]);
    const locked = busy || state.applying;
    const creating = state.draft.action === 'create';
    const selected = creating ? null : state.payload?.servers.find(row => row.name === name);
    const editing = creating || Boolean(selected);
    const edit = (nextName: string, nextValues: Record<string, string>, selectExisting = false) => {
        setAck(false); setError(''); setInvalidField('');
        try {
            controller.current?.edit({ name: nextName, action: 'update', patch: patchFromForm(nextValues) }, { selectExisting });
        } catch {
            setError('Use valid JSON for array, object, boolean and numeric fields.');
            for (const [field] of MCP_SERVER_FIELDS) {
                try { patchFromForm({ [field]: nextValues[field] }); }
                catch { setInvalidField(field); break; }
            }
            controller.current?.edit({ name: nextName, action: 'update', patch: {} }, { selectExisting });
        }
    };
    const refresh = () => {
        setName(''); setValues({}); setAck(false); setError(''); setInvalidField('');
        controller.current?.edit({ name: '', action: 'update', patch: {} }, { selectExisting: true });
        void controller.current?.refresh();
    };
    const newServer = () => {
        setName(''); setValues({}); setAck(false); setError(''); setInvalidField('');
        controller.current?.edit({ name: '', action: 'create', patch: {} });
        requestAnimationFrame(() => nameRef.current?.focus());
    };
    const useParallel = () => {
        if (!state.payload) return;
        const draft = createParallelSearchDraft(state.payload.servers);
        if (!draft) return;
        setName(draft.name);
        setValues(Object.fromEntries(Object.entries(draft.patch).map(([field, value]) => [field, typeof value === 'string' ? value : JSON.stringify(value)])));
        setAck(false); setError(''); setInvalidField(''); controller.current?.edit(draft);
    };
    const previewAction = (action: 'disable' | 'remove') => {
        setAck(false); setValues({}); setError(''); setInvalidField('');
        controller.current?.edit(action === 'disable' ? { name, action: 'update', patch: { disabled: true } } : { name, action: 'remove_override', patch: {} });
        void controller.current?.preview();
    };
    const field = (key: McpServerField) => {
        const [, originalLabel] = MCP_FORM_FIELDS.get(key)!;
        const label = MCP_FIELD_LABELS[key] || originalLabel;
        const id = `mcp-server-${key}`, invalid = invalidField === key;
        const current = selected?.patch[key];
        const describedBy = `${id}-help${current !== undefined ? ` ${id}-current` : ''}${invalid ? ' mcp-server-form-error' : ''}`;
        const update = (event: Event) => {
            const next = { ...values, [key]: (event.currentTarget as HTMLInputElement).value };
            setValues(next); edit(name, next);
        };
        return html`<div class="mcp-field" data-mcp-field=${key}>
            <label for=${id}>${label}</label>
            ${MCP_FIELD_CHOICES[key] ? html`<select id=${id} value=${values[key] ?? ''} disabled=${locked} aria-describedby=${describedBy} onChange=${update}>
                <option value="">${creating ? 'Use default' : 'Keep current'}</option>
                ${MCP_FIELD_CHOICES[key]!.map(([value, text]) => html`<option value=${value}>${text}</option>`)}
                <option value="null">Remove local value</option>
            </select>` : MCP_STRUCTURED_FIELDS.has(key) ? html`<textarea id=${id} rows="3" value=${values[key] ?? ''} disabled=${locked} placeholder="Unchanged" spellcheck="false" aria-invalid=${invalid ? 'true' : undefined} aria-describedby=${describedBy} onInput=${update}></textarea>` : html`<input id=${id} type="text" inputmode=${key === 'requestTimeoutMs' || key === 'idleTimeout' ? 'decimal' : undefined} value=${values[key] ?? ''} disabled=${locked} placeholder=${key === 'url' && creating ? 'https://tools.example.test/mcp' : 'Unchanged'} autocomplete="off" spellcheck="false" aria-invalid=${invalid ? 'true' : undefined} aria-describedby=${describedBy} onInput=${update} />`}
            <small id=${`${id}-help`} class="settings-hint">${MCP_FIELD_HELP[key]}</small>
            ${current !== undefined && html`<small id=${`${id}-current`} class="mcp-current">Current: ${typeof current === 'string' ? current : JSON.stringify(current)}</small>`}
        </div>`;
    };
    return html`<section class="mcp-server-editor" aria-label="MCP server editor">
        <header class="mcp-section-header">
            <div><h4>MCP servers</h4><p class="settings-hint">Manage local overrides without changing inherited or private settings.</p></div>
            <div class="mcp-actions">
                <button class="settings-btn" type="button" disabled=${locked || state.loading} onClick=${refresh}>Refresh servers</button>
                <button class="settings-btn primary" type="button" disabled=${locked || state.loading || !state.payload} onClick=${newServer}>New server</button>
            </div>
        </header>
        ${state.loading && html`<p class="mcp-notice" role="status">${state.applying ? 'Applying server configuration…' : 'Loading server configuration…'}</p>`}
        ${state.error && html`<p role="alert" class="mcp-notice settings-error">${state.error}</p>`}
        ${state.payload && html`
            <div class="mcp-server-meta"><span>${state.payload.servers.length} ${state.payload.servers.length === 1 ? 'server' : 'servers'}</span><span>Configuration: ${state.payload.phase}</span></div>
            <div class="mcp-server-workspace">
                <div class="mcp-server-list">
                    ${!state.payload.servers.length && html`<p class="mcp-empty">No MCP servers configured.</p>`}
                    <ul aria-label="MCP servers">${state.payload.servers.map(row => html`<li key=${row.name}>
                        <button type="button" class=${`mcp-server-card${selected?.name === row.name ? ' selected' : ''}`} aria-label=${row.name} aria-pressed=${selected?.name === row.name ? 'true' : 'false'} disabled=${locked} onClick=${() => { setName(row.name); setValues({}); edit(row.name, {}, true); }}>
                            <strong>${row.name}</strong><span class="mcp-server-card-meta"><span>${row.enabled ? 'Enabled' : 'Disabled'}</span><span>${row.localOverride ? 'Local override' : 'Inherited'}</span></span>
                            <small>${typeof row.patch.url === 'string' ? 'HTTP' : typeof row.patch.command === 'string' ? 'Local process' : typeof row.patch.socket === 'string' ? 'Unix socket' : 'Configured transport'}</small>
                        </button>
                    </li>`)}</ul>
                    <div class="mcp-preset"><p class="settings-hint">Quick setup</p><button class="settings-btn" type="button" disabled=${locked || state.loading || !createParallelSearchDraft(state.payload.servers)} onClick=${useParallel}>Use Parallel Search preset</button></div>
                </div>
                <div class="mcp-editor mcp-panel">
                    ${!editing ? html`<div class="mcp-empty"><h5>Choose a server</h5><p>Select a server to edit its local overrides, or add a new connection.</p><p class="settings-hint">Enabled describes configuration, not a live connection.</p></div>` : html`
                        <header class="mcp-editor-header"><h5>${creating ? 'New server' : name}</h5><span class="mcp-badge">${creating ? 'Not saved' : selected?.localOverride ? 'Local override' : 'Inherited configuration'}</span></header>
                        <div class="mcp-field"><label for="mcp-server-name">Server name</label><input ref=${nameRef} id="mcp-server-name" type="text" value=${name} readonly=${!creating} disabled=${locked} autocomplete="off" onInput=${(event: Event) => { const next = (event.currentTarget as HTMLInputElement).value; setName(next); edit(next, values); }} /></div>
                        <p class="settings-hint">Only entered fields change. Blank keeps the current value; <code>null</code> removes a local value and may reveal an inherited one.</p>
                        ${selected && html`<p class="mcp-provenance">Source: ${typeof selected.source === 'string' ? selected.source : 'configuration'}. ${selected.withheldFields.length ? `Private/advanced fields preserved: ${selected.withheldFields.join(', ')}.` : 'Existing fields remain unchanged unless you edit them.'}</p>`}
                        ${error && html`<p id="mcp-server-form-error" role="alert" class="mcp-notice settings-error">${error}</p>`}
                        <fieldset class="mcp-fieldset"><legend>Connection</legend><div class="mcp-field-grid">${field('url')}${field('httpTransport')}</div>
                            <details open=${Boolean(selected?.patch.command || selected?.patch.socket)}><summary>Local process or socket</summary><div class="mcp-field-grid">${field('command')}${field('args')}${field('cwd')}${field('socket')}</div></details>
                        </fieldset>
                        <fieldset class="mcp-fieldset"><legend>Authentication</legend><div class="mcp-field-grid">${field('auth')}${field('bearerTokenKeychain')}${field('bearerTokenEnv')}</div>
                            <details><summary>Additional headers and environment</summary><div class="mcp-field-grid">${field('headers')}${field('env')}</div></details>
                        </fieldset>
                        <details class="mcp-advanced"><summary>Tools and resources</summary><div class="mcp-field-grid">${field('directTools')}${field('includeTools')}${field('excludeTools')}${field('approveTools')}${field('exposeResources')}${field('toolPrefix')}</div></details>
                        <details class="mcp-advanced"><summary>Advanced options</summary><div class="mcp-field-grid">${field('disabled')}${field('lifecycle')}${field('requestTimeoutMs')}${field('idleTimeout')}</div></details>
                        <div class="mcp-actions mcp-preview-actions">
                            <button class="settings-btn" type="button" disabled=${locked || state.loading || !name || !!error} onClick=${() => { setAck(false); void controller.current?.preview(); }}>Preview server change</button>
                            ${selected && html`<button class="settings-btn" type="button" disabled=${locked || state.loading} onClick=${() => previewAction('disable')}>Preview disable</button>
                            <button class="settings-btn danger" type="button" disabled=${locked || state.loading || !selected.localOverride} onClick=${() => previewAction('remove')}>Preview remove local override</button>`}
                        </div>
                        ${state.previewed && state.payload.preview && html`<div class="mcp-preview"><p role="status">Preview only: ${state.payload.preview.name} — ${state.payload.preview.present ? (state.payload.preview.enabled ? 'enabled' : 'disabled') : 'removed'}.</p>
                            ${state.payload.preview.action === 'remove_override' && html`<p class="settings-hint">Removing the override may reveal an inherited server.</p>`}
                            <details><summary>Effective server preview</summary><pre aria-label="Effective server preview">${JSON.stringify(state.payload.preview.patch, null, 2)}</pre></details>
                        </div>`}
                        <div class="mcp-apply"><p class="settings-hint">Apply interrupts active turns and reloads extensions across all chats. Chat history is retained.</p>
                            <label class="mcp-ack"><input type="checkbox" checked=${ack} disabled=${locked || state.loading} onChange=${(event: Event) => setAck((event.currentTarget as HTMLInputElement).checked)} /><span>I understand server Apply interrupts turns and reloads extensions.</span></label>
                            <button class="settings-btn primary" type="button" disabled=${locked || state.loading || !ack || !state.previewed || !state.payload.applyAvailable || !state.payload.preview?.applicable} onClick=${() => void controller.current?.apply(ack)}>${state.applying ? 'Applying servers…' : 'Apply server change'}</button>
                        </div>
                    `}
                </div>
            </div>
        `}
        ${state.applied && html`<p class="mcp-notice" role="status">Server configuration saved and applied to current and new sessions.</p>`}
    </section>`;
}
