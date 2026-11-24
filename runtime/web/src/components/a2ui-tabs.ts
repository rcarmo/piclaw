import { html, useState } from '../vendor/preact-htm.js';
import type { A2uiAria } from './a2ui-accessibility.js';

let nextTabsId = 0;

export function A2uiTabs({ tabs, aria, renderChild }: {
    aria: A2uiAria;
    tabs: { child: string; title: string }[];
    renderChild: (id: string) => unknown;
}) {
    const [prefix] = useState(() => `a2ui-tabs-${++nextTabsId}`);
    const [selected, select] = useState<string | undefined>(undefined);
    const active = tabs.some(tab => tab.child === selected) ? selected : tabs[0]?.child;
    const tabId = (index: number) => `${prefix}-tab-${index}`;
    const panelId = (index: number) => `${prefix}-panel-${index}`;
    function keydown(event: KeyboardEvent, index: number) {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % tabs.length
            : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : undefined;
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        select(tabs[next]!.child);
        (event.currentTarget as HTMLElement).ownerDocument.getElementById(tabId(next))?.focus();
    }
    return html`<div class="a2ui-tabs" inert=${aria.inert} aria-hidden=${aria['aria-hidden']}>
        <div role="tablist" ...${aria} class="a2ui-tab-list">
            ${tabs.map((tab, index) => html`<button type="button" role="tab" key=${tab.child} id=${tabId(index)}
                aria-controls=${panelId(index)} aria-selected=${tab.child === active} tabIndex=${tab.child === active ? 0 : -1}
                onClick=${() => select(tab.child)} onKeyDown=${(event: KeyboardEvent) => keydown(event, index)}>${tab.title}</button>`)}
        </div>
        ${tabs.map((tab, index) => html`<div role="tabpanel" key=${tab.child} id=${panelId(index)} aria-labelledby=${tabId(index)}
            hidden=${tab.child !== active} tabIndex=${0}>${tab.child === active ? renderChild(tab.child) : null}</div>`)}
    </div>`;
}
