/** Render the admitted A2UI catalog in Classic's Preact timeline. */
import { html, useRef, useState } from '../vendor/preact-htm.js';
import { a2uiBindingPath, buildA2uiAction, readA2uiValue, type A2uiActionRequest } from '../../../src/channels/web/a2ui/action.js';
import type { A2uiSurfaceBlock } from '../../../src/channels/web/a2ui/surface.js';

type Submit = (request: A2uiActionRequest) => Promise<unknown>;

export function A2uiSurface({ block, source, onSubmit }: {
    block: A2uiSurfaceBlock;
    source: Pick<A2uiActionRequest, 'chat_jid' | 'post_id' | 'thread_id'>;
    onSubmit?: Submit;
}) {
    const snapshot = block.surface;
    const [edits, setEdits] = useState(new Map<string, unknown>());
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const lastAttempt = useRef<{ key: string; request: A2uiActionRequest } | null>(null);
    const inFlight = useRef(false);
    const disabled = block.state !== 'active' || !onSubmit;
    const components = new Map(snapshot.components.map(item => [item.id, item]));
    const read = (value: unknown) => readA2uiValue(snapshot, value, edits);
    const text = (value: unknown) => {
        const resolved = read(value);
        return typeof resolved === 'string' ? resolved : '';
    };
    function edit(path: string | undefined, value: unknown) {
        if (!path || disabled || inFlight.current) return;
        setEdits((previous: Map<string, unknown>) => new Map(previous).set(path, value));
        setError('');
    }
    async function submit(event: Event, componentId: string) {
        event.stopPropagation();
        if (disabled || !onSubmit || inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        setError('');
        try {
            const message = buildA2uiAction(snapshot, componentId, edits, new Date().toISOString());
            const key = JSON.stringify([componentId, message.action.context]);
            if (!lastAttempt.current || lastAttempt.current.key !== key) {
                lastAttempt.current = { key, request: { ...source, revision: block.revision, request_id: Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join(''), message } };
            }
            await onSubmit(lastAttempt.current.request);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to submit this form.');
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    }

    function renderComponent(id: unknown, depth: number): unknown {
        const item = typeof id === 'string' ? components.get(id) : undefined;
        if (!item || depth > 24) return null;
        const path = a2uiBindingPath(item.value);
        const locked = disabled || pending || !path;
        const child = (childId: unknown) => renderComponent(childId, depth + 1);
        const label = text(item.label);
        switch (item.component) {
            case 'Text': return html`<span key=${id} class=${item.variant === 'caption' ? 'a2ui-caption' : ''}>${text(item.text)}</span>`;
            case 'Card': return html`<div key=${id} class="a2ui-card">${child(item.child)}</div>`;
            case 'Row':
            case 'Column': {
                const direction = item.component === 'Row' ? 'row' : 'column';
                const align = typeof item.align === 'string' ? ({ center: 'center', start: 'start', end: 'end', stretch: 'stretch' })[item.align] : undefined;
                const justify = typeof item.justify === 'string' ? ({ center: 'center', start: 'start', end: 'end', stretch: 'stretch', spaceBetween: 'space-between', spaceAround: 'space-around', spaceEvenly: 'space-evenly' })[item.justify] : undefined;
                return html`<div key=${id} class=${`a2ui-${direction}`} style=${{ alignItems: align, justifyContent: justify }}>
                    ${Array.isArray(item.children) ? item.children.map(child) : null}</div>`;
            }
            case 'Divider': return html`<hr key=${id} class=${item.axis === 'vertical' ? 'a2ui-divider-vertical' : ''} />`;
            case 'Button': return html`<button key=${id} type="button" class=${`a2ui-button a2ui-button-${item.variant || 'default'}`}
                disabled=${disabled} aria-disabled=${pending || disabled} onClick=${(event: Event) => submit(event, item.id)}>${child(item.child)}</button>`;
            case 'TextField': {
                const value = text(item.value);
                const placeholder = text(item.placeholder);
                const onInput = (event: Event) => edit(path, (event.currentTarget as HTMLInputElement).value);
                return html`<label key=${id} class="a2ui-field">${label}${item.variant === 'longText'
                    ? html`<textarea disabled=${locked} value=${value} placeholder=${placeholder} maxLength="4096" onInput=${onInput}></textarea>`
                    : html`<input type=${item.variant === 'number' ? 'number' : 'text'} disabled=${locked} value=${value}
                        placeholder=${placeholder} maxLength="4096" onInput=${onInput} />`}</label>`;
            }
            case 'CheckBox': return html`<label key=${id} class="a2ui-checkbox"><input type="checkbox" disabled=${locked}
                checked=${read(item.value) === true} onChange=${(event: Event) => edit(path, (event.currentTarget as HTMLInputElement).checked)} />${label}</label>`;
            case 'ChoicePicker': {
                const selected = read(item.value);
                const choices = Array.isArray(selected) ? selected : [];
                const multiple = item.variant === 'multipleSelection';
                return html`<label key=${id} class="a2ui-field">${label}
                    <select multiple=${multiple} disabled=${locked} aria-label=${label || 'Choose an option'}
                        value=${multiple ? undefined : choices[0] ?? ''} onChange=${(event: Event) => edit(path,
                            Array.from((event.currentTarget as HTMLSelectElement).selectedOptions, option => option.value).filter(Boolean))}>
                        ${!multiple && html`<option value="">Select an option</option>`}
                        ${Array.isArray(item.options) && item.options.map(option => html`<option key=${option.value} value=${option.value}
                            selected=${multiple ? choices.includes(option.value) : undefined}>${text(option.label)}</option>`)}
                    </select></label>`;
            }
            default: return null;
        }
    }
    return html`<section class="a2ui-surface" aria-busy=${pending} onClick=${(event: Event) => event.stopPropagation()}>
        ${renderComponent('root', 0) || block.fallback_text}
        ${error && html`<p class="a2ui-error" role="alert">${error}</p>`}
    </section>`;
}
