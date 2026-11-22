import { html, useState } from '../vendor/preact-htm.js';

let nextGroup = 0;

export function A2uiChoicePicker({ label, options, selected, multiple, chips, filterable, disabled, onChange }: {
    label: string;
    options: { label: string; value: string }[];
    selected: readonly string[];
    multiple: boolean;
    chips: boolean;
    filterable: boolean;
    disabled: boolean;
    onChange: (value: string[]) => void;
}) {
    const [group] = useState(() => `a2ui-choice-${++nextGroup}`);
    const [filter, setFilter] = useState('');
    const terms = filterable ? filter.trim().toLocaleLowerCase() : '';
    const visible = terms ? options.filter(option => option.label.toLocaleLowerCase().includes(terms)) : options;
    function choose(value: string) {
        if (disabled) return;
        onChange(!multiple ? [value] : selected.includes(value) ? selected.filter(choice => choice !== value) : [...selected, value]);
    }
    return html`<div role="group" aria-label=${label || 'Choose an option'} class="a2ui-field">
        ${label && html`<span>${label}</span>`}
        ${filterable && html`<input type="search" aria-label="Filter options" placeholder="Filter options" maxLength="256"
            value=${filter} onInput=${(event: Event) => setFilter((event.currentTarget as HTMLInputElement).value)} />`}
        ${visible.length === 0 ? html`<span class="a2ui-caption" role="status">No matching options</span>`
            : html`<div class=${chips ? 'a2ui-chips' : 'a2ui-column'}>
                ${visible.map(option => chips
                    ? html`<button key=${option.value} type="button" class="a2ui-button a2ui-chip" disabled=${disabled}
                        aria-pressed=${selected.includes(option.value)} onClick=${() => choose(option.value)}>${option.label}</button>`
                    : html`<label key=${option.value} class="a2ui-option"><input type=${multiple ? 'checkbox' : 'radio'}
                        name=${multiple ? undefined : group} value=${option.value} checked=${selected.includes(option.value)}
                        disabled=${disabled} onChange=${() => choose(option.value)} />${option.label}</label>`)}
            </div>`}
    </div>`;
}
