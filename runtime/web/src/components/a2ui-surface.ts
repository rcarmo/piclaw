/** Render the admitted A2UI catalog in Classic's Preact timeline. */
import { html, useCallback, useRef, useState } from '../vendor/preact-htm.js';
import { a2uiBindingPath, buildA2uiAction, readA2uiValue, type A2uiActionRequest } from '../../../src/channels/web/a2ui/action.js';
import { a2uiDateTimeDisplay, a2uiDateTimeType } from '../../../src/channels/web/a2ui/date-time.js';
import { presentProviderAuth } from '../ui/provider-auth-presentation.js';
import { A2uiModal } from './a2ui-modal.js';
import { A2uiTabs } from './a2ui-tabs.js';
import { A2uiTotpDialog, readTotpPresentation, type TotpPresentation } from './a2ui-totp-dialog.js';
import { a2uiSliderRange, readA2uiImageUrl, readA2uiLink, type A2uiSurfaceBlock } from '../../../src/channels/web/a2ui/surface.js';

type Submit = (request: A2uiActionRequest, options?: { signal?: AbortSignal }) => Promise<unknown>;

export function A2uiSurface({ block, source, onSubmit }: {
    block: A2uiSurfaceBlock;
    source: Pick<A2uiActionRequest, 'chat_jid' | 'post_id' | 'thread_id'>;
    onSubmit?: Submit;
}) {
    const snapshot = block.surface;
    const [edits, setEdits] = useState(new Map<string, unknown>());
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [totp, setTotp] = useState<{ presentation: TotpPresentation; request: A2uiActionRequest } | null>(null);
    const dismissTotp = useCallback(() => setTotp(null), []);
    const lastAttempt = useRef<{ key: string; request: A2uiActionRequest } | null>(null);
    const inFlight = useRef(false);
    const privateInput = useRef<HTMLInputElement | null>(null);
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
            const request = lastAttempt.current.request;
            const value = block.owner === 'login' && componentId === 'save' ? privateInput.current?.value : undefined;
            if (privateInput.current) privateInput.current.value = '';
            const response = await onSubmit(value !== undefined ? { ...request, private_value: value } : request);
            if (block.owner === 'login') presentProviderAuth(response, onSubmit);
            if (block.owner === 'totp') {
                const presentation = readTotpPresentation(response);
                if (!presentation) throw new Error('TOTP setup is unavailable. Run /totp again.');
                setTotp({ presentation, request });
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to submit this form.');
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    }

    function renderComponent(id: unknown, depth: number, openModal?: (event: Event) => void): unknown {
        const item = typeof id === 'string' ? components.get(id) : undefined;
        if (!item || depth > 24) return null;
        const path = a2uiBindingPath(item.value);
        const locked = disabled || pending || !path;
        const child = (childId: unknown) => renderComponent(childId, depth + 1);
        const label = text(item.label);
        switch (item.component) {
            case 'Text': return html`<span key=${id} class=${item.variant === 'caption' ? 'a2ui-caption' : ''}>${text(item.text)}</span>`;
            case 'Image': {
                const src = readA2uiImageUrl(read(item.url), window.location.origin);
                const alt = text(item.description);
                if (!src) return alt || null;
                const size = typeof item.variant === 'string' && ['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'].includes(item.variant)
                    ? item.variant : 'mediumFeature';
                const fit = item.fit === 'scaleDown' ? 'scale-down' : item.fit === 'cover' || item.fit === 'contain' || item.fit === 'none' ? item.fit : 'fill';
                return html`<img key=${id} class=${`a2ui-image a2ui-image-${size}`} src=${src} alt=${alt}
                    loading="lazy" decoding="async" referrerpolicy="no-referrer" style=${{ objectFit: fit }} />`;
            }
            case 'Card': return html`<div key=${id} class="a2ui-card">${child(item.child)}</div>`;
            case 'Row':
            case 'Column': {
                const direction = item.component === 'Row' ? 'row' : 'column';
                const align = typeof item.align === 'string' ? ({ center: 'center', start: 'start', end: 'end', stretch: 'stretch' })[item.align] : undefined;
                const justify = typeof item.justify === 'string' ? ({ center: 'center', start: 'start', end: 'end', stretch: 'stretch', spaceBetween: 'space-between', spaceAround: 'space-around', spaceEvenly: 'space-evenly' })[item.justify] : undefined;
                return html`<div key=${id} class=${`a2ui-${direction}`} style=${{ alignItems: align, justifyContent: justify }}>
                    ${Array.isArray(item.children) ? item.children.map(child) : null}</div>`;
            }
            case 'Modal': {
                const trigger = typeof item.trigger === 'string' ? components.get(item.trigger) : undefined;
                if (!trigger) return null;
                const title = trigger.component === 'Button' && typeof trigger.child === 'string' ? components.get(trigger.child) : trigger;
                const dialogLabel = text(title?.text) || 'Details';
                return html`<${A2uiModal} key=${id} label=${dialogLabel} buttonTrigger=${trigger.component === 'Button'}
                    renderTrigger=${(open: (event: Event) => void) => renderComponent(trigger.id, depth + 1, open)}
                    renderContent=${() => child(item.content)} />`;
            }
            case 'Tabs': {
                if (!Array.isArray(item.tabs)) return null;
                const tabs = item.tabs.map(tab => ({ child: tab.child, title: text(tab.title) }));
                return html`<${A2uiTabs} key=${id} tabs=${tabs} renderChild=${child} />`;
            }
            case 'List': {
                const direction = item.direction === 'horizontal' ? 'a2ui-list-horizontal' : '';
                const align = item.align === 'start' || item.align === 'center' || item.align === 'end' ? item.align : 'stretch';
                return html`<div key=${id} role="list" class=${`a2ui-list ${direction}`} style=${{ alignItems: align }}>
                    ${Array.isArray(item.children) && item.children.map(childId => html`<div key=${childId} role="listitem">${child(childId)}</div>`)}</div>`;
            }
            case 'Divider': return html`<hr key=${id} class=${item.axis === 'vertical' ? 'a2ui-divider-vertical' : ''} />`;
            case 'Button': {
                const link = readA2uiLink(item.action);
                if (link && !disabled) return html`<a key=${id} class="a2ui-button a2ui-button-borderless" href=${link}
                    aria-haspopup=${openModal ? 'dialog' : undefined} onClick=${openModal}
                    target="_blank" rel="noopener noreferrer">${child(item.child)}</a>`;
                if (block.owner === 'login' && (id === 'continue' || id === 'check')) return null;
                return html`<button key=${id} type="button" class=${`a2ui-button a2ui-button-${item.variant || 'default'}`}
                disabled=${disabled} aria-disabled=${pending || disabled} aria-haspopup=${openModal ? 'dialog' : undefined}
                onClick=${(event: Event) => {
                    if (pending || disabled) return;
                    openModal?.(event);
                    void submit(event, item.id);
                }}>${child(item.child)}</button>`;
            }
            case 'TextField': {
                if (block.owner === 'login' && item.variant === 'obscured') return html`<label key=${id} class="a2ui-field">${label}
                    <input ref=${privateInput} disabled=${disabled || pending} type="password" autocomplete="off" maxlength="4096" placeholder=${text(item.placeholder)} />
                </label>`;
                const value = text(item.value);
                const placeholder = text(item.placeholder);
                const onInput = (event: Event) => edit(path, (event.currentTarget as HTMLInputElement).value);
                return html`<label key=${id} class="a2ui-field">${label}${item.variant === 'longText'
                    ? html`<textarea disabled=${locked} value=${value} placeholder=${placeholder} maxLength="4096" onInput=${onInput}></textarea>`
                    : html`<input type=${item.variant === 'number' ? 'number' : 'text'} disabled=${locked} value=${value}
                        placeholder=${placeholder} maxLength="4096" onInput=${onInput} />`}</label>`;
            }
            case 'DateTimeInput': {
                const type = a2uiDateTimeType(item);
                if (!type) return null;
                const value = a2uiDateTimeDisplay(read(item.value), type) ?? '';
                const min = a2uiDateTimeDisplay(readA2uiValue(snapshot, item.min), type);
                const max = a2uiDateTimeDisplay(readA2uiValue(snapshot, item.max), type);
                return html`<label key=${id} class="a2ui-field">${label}
                    <input type=${type} aria-label=${label || (type === 'datetime-local' ? 'Date and time' : type === 'date' ? 'Date' : 'Time')}
                        disabled=${locked} min=${min} max=${max} step=${type === 'date' ? undefined : 'any'} value=${value}
                        onChange=${(event: Event) => edit(path, (event.currentTarget as HTMLInputElement).value)} />
                </label>`;
            }
            case 'Slider': {
                const range = a2uiSliderRange(item);
                if (!range) return null;
                const value = read(item.value);
                return html`<label key=${id} class="a2ui-field">${label}
                    <input type="range" aria-label=${label || 'Value'} disabled=${locked} min=${range.min} max=${range.max}
                        step=${range.step ?? 'any'} value=${typeof value === 'number' ? value : range.min}
                        onInput=${(event: Event) => edit(path, (event.currentTarget as HTMLInputElement).valueAsNumber)} />
                </label>`;
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
    return html`<section class="a2ui-surface" data-no-session-dashboard-shortcut="" aria-busy=${pending} onClick=${(event: Event) => event.stopPropagation()}>
        ${renderComponent('root', 0) || block.fallback_text}
        ${totp && !disabled && html`<${A2uiTotpDialog} presentation=${totp.presentation} dismiss=${dismissTotp}
            confirm=${async (code: string) => {
                const reply = await onSubmit!({ ...totp.request, private_code: code });
                if ((reply as { totp_result?: string } | undefined)?.totp_result !== 'success') throw new Error('TOTP was not confirmed.');
            }} />`}
        ${error && html`<p class="a2ui-error" role="alert">${error}</p>`}
    </section>`;
}
