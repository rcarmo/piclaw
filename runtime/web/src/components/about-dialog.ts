import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { BodyPortal } from './body-portal.js';

export interface RuntimeVersions {
    piclaw: string;
    piAi: string;
    bun: string;
}

/** Pure view shared by About and both General settings panes. */
export function AboutVersions({ versions }: { versions?: RuntimeVersions | null }) {
    return html`
        <dl class="about-versions">
            ${[
                ['PiClaw', versions?.piclaw, 'https://github.com/rcarmo/piclaw'],
                ['pi-ai', versions?.piAi, 'https://github.com/earendil-works/pi/tree/main/packages/ai'],
                ['Bun', versions?.bun, 'https://github.com/oven-sh/bun'],
            ].map(([label, value, url]) => html`
                <div class="about-version"><dt>${label}</dt><dd><a href=${url} target="_blank" rel="noopener noreferrer" aria-label=${`${label} ${value || 'Unknown'} on GitHub`}>${value || 'Unknown'}</a></dd></div>
            `)}
        </dl>
    `;
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
    const [versions, setVersions] = useState<RuntimeVersions | null>(null);
    const [error, setError] = useState(false);
    const closeRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null;
        const frame = requestAnimationFrame(() => closeRef.current?.focus());
        const controller = new AbortController();
        fetch('/agent/about', { credentials: 'same-origin', signal: controller.signal })
            .then(response => {
                if (!response.ok) throw new Error('Unable to load versions');
                return response.json();
            })
            .then(data => { if (!controller.signal.aborted) setVersions(data); })
            .catch(() => { if (!controller.signal.aborted) setError(true); });
        return () => {
            cancelAnimationFrame(frame);
            controller.abort();
            if (previous?.isConnected) previous.focus();
        };
    }, []);

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
        } else if (event.key === 'Tab') {
            const items = Array.from((dialogRef.current as HTMLDivElement | null)?.querySelectorAll<HTMLElement>('button, a[href]') || []);
            const first = items[0], last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault(); first?.focus();
            }
        }
    };

    return html`
        <${BodyPortal} className="settings-dialog-portal">
            <div class="settings-dialog-backdrop" onClick=${onClose}>
                <div class="settings-dialog about-dialog" ref=${dialogRef} role="dialog" aria-modal="true" aria-label="About" onClick=${(event: MouseEvent) => event.stopPropagation()} onKeyDown=${onKeyDown}>
                    <div class="settings-dialog-header">
                        <span class="settings-dialog-title">About</span>
                        <button class="settings-dialog-close" type="button" aria-label="Close About" ref=${closeRef} onClick=${onClose}>×</button>
                    </div>
                    <div class="settings-content about-dialog-content">
                        ${versions ? html`<${AboutVersions} versions=${versions} />` : html`<div role="status">${error ? 'Unable to load versions.' : 'Loading…'}</div>`}
                    </div>
                </div>
            </div>
        <//>
    `;
}
