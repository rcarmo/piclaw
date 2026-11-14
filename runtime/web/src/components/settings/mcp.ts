import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { createMcpSettingsController, INITIAL_MCP_SETTINGS, type McpPolicy, type McpSettingsState } from '../../ui/mcp-settings-model.js';
import { McpServersSection } from './mcp-servers.js';

export function McpSection() {
    const [state, setState] = useState<McpSettingsState>(INITIAL_MCP_SETTINGS);
    const [acknowledged, setAcknowledged] = useState(false);
    const [serversApplying, setServersApplying] = useState(false);
    const controller = useRef<ReturnType<typeof createMcpSettingsController> | null>(null);
    useEffect(() => {
        const current = createMcpSettingsController(setState); controller.current = current;
        void current.refresh();
        return () => { current.dispose(); controller.current = null; };
    }, []);
    const select = (patch: Partial<McpPolicy>) => { setAcknowledged(false); controller.current?.select(patch); };
    return html`<section class="settings-section mcp-settings" aria-label="MCP settings">
        <header class="mcp-section-header"><div><h3>MCP</h3><p class="settings-hint">Connect external tools and resources. Changes are instance-wide and require Preview, then Apply.</p></div>
            <button class="settings-btn" type="button" disabled=${state.loading || serversApplying} onClick=${() => { setAcknowledged(false); void controller.current?.refresh(); }}>Refresh MCP status</button>
        </header>
        ${state.loading && html`<p class="mcp-notice" role="status" aria-live="polite">Loading MCP settings…</p>`}
        ${state.error && html`<p class="mcp-notice settings-error" role="alert">${state.error}</p>`}
        ${state.payload && html`
            <dl class="mcp-overview" aria-label="Current MCP configuration">
                <div><dt>Saved policy</dt><dd>${state.payload.persisted.policy.engine} / ${state.payload.persisted.policy.codemode}</dd></div>
                <div><dt>Observed policy</dt><dd>${state.payload.runtime.observedPolicy ? `${state.payload.runtime.observedPolicy.engine} · ${state.payload.runtime.observedPolicy.codemode}` : 'Unknown or blocked'}</dd></div>
                <div><dt>Connections</dt><dd>Not reported</dd></div>
            </dl>
            <p class="settings-hint">Live connection status is unknown.</p>
            <${McpServersSection} busy=${state.loading} onApplying=${setServersApplying} />
            <section class="mcp-panel mcp-policy" aria-labelledby="mcp-policy-heading">
                <header class="mcp-section-header"><div><h4 id="mcp-policy-heading">Runtime policy</h4><p class="settings-hint">Choose how this instance runs MCP. These controls do not change individual server definitions.</p></div></header>
                <div class="mcp-field-grid">
                    <div class="mcp-field"><label for="mcp-engine">Engine to preview</label>
                        <select id="mcp-engine" disabled=${state.applying || serversApplying} value=${state.draft.engine} aria-describedby="mcp-engine-help" onChange=${(event: Event) => select({ engine: (event.currentTarget as HTMLSelectElement).value as McpPolicy['engine'] })}>
                            <option value="adapter">Adapter (default)</option><option value="native">Native (experimental)</option>
                        </select><small id="mcp-engine-help" class="settings-hint">Configured factory: ${state.payload.runtime.configuredFactory}. Engine changes close the old owner before reloading extensions.</small>
                    </div>
                    <div class="mcp-field"><label for="mcp-codemode">Codemode to preview</label>
                        <select id="mcp-codemode" disabled=${state.applying || serversApplying} value=${state.draft.codemode} aria-describedby="mcp-codemode-help" onChange=${(event: Event) => select({ codemode: (event.currentTarget as HTMLSelectElement).value as McpPolicy['codemode'] })}>
                            <option value="auto">Auto (default)</option><option value="on">On</option><option value="off">Off</option>
                        </select><small id="mcp-codemode-help" class="settings-hint">Auto keeps scripting off with Adapter and enables it when Native needs it. On enables scripting; Off blocks it. Model execution inside scripts is disabled.</small>
                    </div>
                </div>
                <details class="mcp-advanced" open=${state.draft.engine === 'native'}><summary>Native compatibility details</summary>
                    <p class="settings-hint">These are configuration classifications, not live connection states. A native-blocked server may work through the adapter.</p>
                    ${state.payload.servers.length ? html`<ul class="mcp-compatibility-list">${state.payload.servers.map(server => html`<li key=${server.name}><strong>${server.name}</strong><span>${server.nativeProjectionStatus}</span></li>`)}</ul>` : html`<p class="settings-hint">No servers in the prepared configuration.</p>`}
                    ${state.draft.engine === 'native' && html`<ul>${state.payload.nativeBlockers.map(reason => html`<li>${reason}</li>`)}</ul>`}
                </details>
                <button class="settings-btn" type="button" disabled=${state.loading || serversApplying} onClick=${() => { setAcknowledged(false); void controller.current?.preview(); }}>Preview compatibility</button>
                ${state.draft.engine === 'native' && state.preview?.applicable === false && html`<p class="mcp-notice">${state.payload.nativeBlockReason}</p>`}
                ${state.previewed && state.preview && html`<div class="mcp-preview" role="status" aria-live="polite"><strong>${state.preview.applicable ? 'Preview compatible — not applied.' : 'Preview blocked — not applied.'}</strong>
                    ${state.preview.issues.length > 0 && html`<ul>${state.preview.issues.map(issue => html`<li>${issue.serverName ? `${issue.serverName}: ` : ''}${issue.field} — ${issue.message}</li>`)}</ul>`}
                </div>`}
                <div class="mcp-apply"><p class="settings-hint">Apply may interrupt active turns across all chats. Chat history is preserved.</p>
                    <label class="mcp-ack"><input type="checkbox" checked=${acknowledged} disabled=${state.loading || serversApplying} onChange=${(event: Event) => setAcknowledged((event.currentTarget as HTMLInputElement).checked)} /><span>I understand Apply may interrupt active turns across all chats.</span></label>
                    <button class="settings-btn primary" type="button" disabled=${serversApplying || state.loading || !acknowledged || !state.previewed || !state.payload.applyAvailable || !state.preview?.applicable} onClick=${() => void controller.current?.apply(acknowledged)}>${state.applying ? 'Applying…' : 'Apply MCP settings'}</button>
                </div>
                ${state.applied && html`<p class="mcp-notice" role="status">MCP settings saved and applied to current and new sessions.</p>`}
            </section>
        `}
    </section>`;
}
