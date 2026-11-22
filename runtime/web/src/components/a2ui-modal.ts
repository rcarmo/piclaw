import { html, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';

export function A2uiModal({ label, buttonTrigger, renderTrigger, renderContent }: {
    label: string;
    buttonTrigger: boolean;
    renderTrigger: (open: (event: Event) => void) => unknown;
    renderContent: () => unknown;
}) {
    const [open, setOpen] = useState(false);
    const dialog = useRef<HTMLDialogElement | null>(null);
    const trigger = useRef<HTMLElement | null>(null);
    function show(event: Event) {
        event.stopPropagation();
        trigger.current = event.currentTarget as HTMLElement;
        setOpen(true);
    }
    function dismiss() { setOpen(false); }
    useLayoutEffect(() => {
        if (!open) return;
        const element = dialog.current!;
        element.showModal();
        return () => {
            if (element.open) element.close();
            if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
        };
    }, [open]);
    return html`<div class="a2ui-modal">
        ${buttonTrigger ? renderTrigger(show) : html`<div role="button" tabIndex=${0} aria-haspopup="dialog" class="a2ui-modal-trigger"
            onClick=${show} onKeyDown=${(event: KeyboardEvent) => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                show(event);
            }}>${renderTrigger(show)}</div>`}
        ${open && html`<dialog ref=${dialog} class="a2ui-surface a2ui-modal-dialog" data-no-session-dashboard-shortcut=""
            aria-label=${label} onCancel=${(event: Event) => { event.preventDefault(); dismiss(); }}
            onClick=${(event: MouseEvent) => {
                if (event.target !== dialog.current) return;
                const bounds = dialog.current.getBoundingClientRect();
                if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dismiss();
            }}>
            <div class="a2ui-column">${renderContent()}
                <button type="button" class="a2ui-button" onClick=${dismiss} autofocus>Close</button>
            </div>
        </dialog>`}
    </div>`;
}
