import { html, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import type { A2uiAria } from './a2ui-accessibility.js';

export function A2uiPlayback({ kind, source, external, label, poster, aria }: {
    aria: A2uiAria;
    kind: 'audio' | 'video';
    source: string;
    external: boolean;
    label: string;
    poster?: string;
}) {
    const [allowed, allow] = useState(false);
    const player = useRef<HTMLMediaElement | null>(null);
    useLayoutEffect(() => { if (allowed) player.current?.focus({ preventScroll: true }); }, [allowed]);
    const crossOrigin = external ? 'anonymous' : undefined;
    const caption = label && html`<span class="a2ui-caption">${label}</span>`;
    if (external && !allowed) return html`<div class="a2ui-column" role=${aria['aria-label'] ? 'group' : undefined} ...${aria}>${caption}
        <button type="button" class="a2ui-button" onClick=${() => allow(true)}>Load external ${kind}</button>
    </div>`;
    return html`<div class="a2ui-column" aria-hidden=${aria['aria-hidden']}>${caption}
        ${kind === 'audio' ? html`<audio class="a2ui-playback" ref=${player} tabIndex=${0} controls preload="metadata" aria-label=${label || 'Audio'} ...${aria}
            crossOrigin=${crossOrigin} src=${source}></audio>`
        : html`<video class="a2ui-playback" ref=${player} tabIndex=${0} controls preload="metadata" playsinline aria-label=${label || 'Video'} ...${aria}
            crossOrigin=${crossOrigin} src=${source} poster=${poster}></video>`}
    </div>`;
}
