import { html, render, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import type { A2uiActionRequest } from '../../../src/channels/web/a2ui/action.js';

type SubmitAction = (payload: A2uiActionRequest, options?: { signal?: AbortSignal }) => Promise<unknown>;
type RecordValue = Record<string, unknown>;
type Method = 'continue' | 'check' | 'cancel';
type Presentation = { expires_at: number; events: unknown[]; prompt: RecordValue | null; actions: Partial<Record<Method, A2uiActionRequest>> };
const isRecord = (value: unknown): value is RecordValue => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const bounded = (value: unknown, limit = 2000): string => typeof value === 'string' ? value.slice(0, limit) : '';
let dismissActive: (() => void) | null = null;

function safeUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value || value.length > 4096) return null;
    try {
        const url = new URL(value);
        return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}
function link(target: unknown, label: unknown) {
    const url = safeUrl(target);
    return url && html`<a href=${url} target="_blank" rel="noopener noreferrer">${bounded(label, 300) || 'Open authentication page'}</a>`;
}
function renderEvent(value: unknown, index: number) {
    if (!isRecord(value)) return null;
    let contents;
    if (value.type === 'auth_url') contents = [bounded(value.instructions) || 'Open the login page and complete authentication.', link(value.url, 'Open login page ↗')];
    else if (value.type === 'device_code') {
        const interval = Number(value.intervalSeconds), expires = Number(value.expiresInSeconds);
        contents = ['Open the verification page and enter this code:', html`<strong>${bounded(value.userCode, 256)}</strong>`, link(value.verificationUri, 'Open verification page ↗'),
            Number.isFinite(interval) && interval > 0 ? `Check interval: ${Math.min(interval, 86400)} seconds` : null,
            Number.isFinite(expires) && expires > 0 ? `Code expires in ${Math.min(expires, 86400)} seconds` : null];
    } else if (value.type === 'info' || value.type === 'progress') {
        contents = [bounded(value.message), ...(Array.isArray(value.links) ? value.links.slice(0, 12).flatMap(item => isRecord(item) ? [link(item.url, item.label || 'Open link ↗')] : []) : [])];
    } else return null;
    return html`<section key=${index} class="a2ui-column a2ui-card">${contents.map(item => item && html`<span>${item}</span>`)}</section>`;
}

function ProviderAuthDialog({ presentation, submit, dismiss }: { presentation: Presentation; submit: SubmitAction; dismiss(): void }) {
    const dialog = useRef<HTMLDialogElement | null>(null);
    const input = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
    const controller = useRef<AbortController | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const prompt = presentation.prompt;
    const confirmMethod = prompt ? 'continue' : 'check';
    useLayoutEffect(() => {
        const element = dialog.current!;
        const field = input.current;
        element.showModal(); field?.focus();
        const timer = setTimeout(dismiss, Math.min(presentation.expires_at - Date.now(), 2_147_483_647));
        window.addEventListener('pagehide', dismiss, { once: true });
        return () => {
            clearTimeout(timer); window.removeEventListener('pagehide', dismiss);
            controller.current?.abort();
            if (field) field.value = '';
            if (element.open) element.close();
        };
    }, [dismiss, presentation.expires_at]);
    async function run(method: Method) {
        if (controller.current) return;
        if (Date.now() >= presentation.expires_at) { dismiss(); return; }
        const request = presentation.actions[method];
        if (!request) return;
        const signal = new AbortController(); controller.current = signal;
        const value = input.current?.value ?? '';
        if (input.current instanceof HTMLInputElement) input.current.value = '';
        setBusy(true); setError('');
        try {
            const next = await submit(method === 'continue' ? { ...request, private_value: value } : request, { signal: signal.signal });
            if (!signal.signal.aborted) { dismiss(); presentProviderAuth(next, submit); }
        } catch {
            if (!signal.signal.aborted) { setBusy(false); setError('Authentication action failed. Please try again or restart /login.'); }
        } finally { if (controller.current === signal) controller.current = null; }
    }
    return html`<dialog ref=${dialog} class="a2ui-surface a2ui-private-dialog" data-no-session-dashboard-shortcut="" aria-label="Provider authentication"
        onCancel=${(event: Event) => { event.preventDefault(); dismiss(); }}>
        <form class="a2ui-column" onSubmit=${(event: SubmitEvent) => { event.preventDefault(); void run(confirmMethod); }} aria-busy=${busy}>
            <strong>Provider authentication</strong>
            ${presentation.events.slice(0, 16).map(renderEvent)}
            ${prompt && html`<label class="a2ui-field">${bounded(prompt.message, 1000) || 'Authentication value'}
                ${prompt.type === 'select' ? html`<select ref=${input} disabled=${busy}>
                    ${(Array.isArray(prompt.options) ? prompt.options.slice(0, 64) : []).map(option =>
                        isRecord(option) && typeof option.id === 'string' && option.id.length <= 4096 && html`<option key=${option.id} value=${option.id}>
                            ${[bounded(option.label, 500), bounded(option.description, 1000)].filter(Boolean).join(' — ')}</option>`)}</select>`
                    : html`<input ref=${input} type=${prompt.type === 'secret' ? 'password' : 'text'} maxlength="4096" disabled=${busy}
                        placeholder=${bounded(prompt.placeholder, 500)} autocomplete=${prompt.type === 'manual_code' ? 'one-time-code' : 'off'} />`}</label>`}
            ${error && html`<p class="a2ui-error" role="alert">${error}</p>`}
            <div class="a2ui-row">
                ${presentation.actions[confirmMethod] && html`<button type="submit" class="a2ui-button a2ui-button-primary" disabled=${busy}>${prompt ? 'Continue' : 'Check & Continue'}</button>`}
                ${presentation.actions.cancel && html`<button type="button" class="a2ui-button" disabled=${busy} onClick=${() => run('cancel')}>Cancel authentication</button>`}
                <button type="button" class="a2ui-button" onClick=${dismiss}>Close</button>
            </div>
        </form>
    </dialog>`;
}

/** The independent Preact root keeps transient provider state out of timeline hydration. */
export function presentProviderAuth(response: unknown, submit: SubmitAction): boolean {
    if (!isRecord(response) || response.status !== 'ok' || !isRecord(response.auth_presentation)) return false;
    const { expires_at, events, prompt, actions } = response.auth_presentation;
    if (typeof expires_at !== 'number' || !Number.isFinite(expires_at) || !Array.isArray(events) || !isRecord(actions)
        || (prompt !== null && (!isRecord(prompt) || !['secret', 'text', 'manual_code', 'select'].includes(String(prompt.type))))) return false;
    dismissActive?.();
    if (Date.now() >= expires_at) return true;
    const host = document.createElement('div');
    document.body.append(host);
    const dismiss = () => {
        if (dismissActive !== dismiss) return;
        dismissActive = null;
        render(null, host); host.remove();
    };
    dismissActive = dismiss;
    render(html`<${ProviderAuthDialog} presentation=${{ expires_at, events, prompt, actions }} submit=${submit} dismiss=${dismiss} />`, host);
    return true;
}
