import { html, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import type { A2uiAria } from './a2ui-accessibility.js';

function Unavailable({ kind, label, retry }: {kind:string;label:string;retry:()=>void}) {
    return html`<span><span role="status">${kind} unavailable${label ? `: ${label}` : ''}</span>
        <button type="button" class="a2ui-button" onClick=${retry}>Retry ${kind.toLowerCase()}</button></span>`;
}

export function A2uiImage({ src, alt, aria, size, fit }: {src:string;alt:string;aria:A2uiAria;size:string;fit:string}) {
    const [failed, setFailed]=useState(false);
    if (failed) return html`<span ...${aria}><${Unavailable} kind="Image" label=${alt || aria['aria-label'] || ''} retry=${()=>setFailed(false)} /></span>`;
    return html`<img class=${`a2ui-image a2ui-image-${size}`} src=${src} alt=${alt} ...${aria}
        onError=${()=>setFailed(true)} loading="lazy" decoding="async" referrerpolicy="no-referrer" style=${{objectFit:fit}} />`;
}

export function A2uiPlayback({ kind, source, external, label, poster, aria }: {
    aria: A2uiAria;
    kind: 'audio' | 'video';
    source: string;
    external: boolean;
    label: string;
    poster?: string;
}) {
    const [allowed, allow] = useState(false);
    const [failed, setFailed] = useState(false);
    const player = useRef<HTMLMediaElement | null>(null);
    useLayoutEffect(() => { if (allowed && !failed) player.current?.focus({ preventScroll: true }); }, [allowed,failed]);
    const unavailable=()=>setFailed(true);
    if (failed) return html`<div ...${aria}><${Unavailable} kind=${kind==='audio' ? 'Audio' : 'Video'} label=${label || aria['aria-label'] || ''}
        retry=${()=>setFailed(false)} /></div>`;
    const crossOrigin = external ? 'anonymous' : undefined;
    const caption = label && html`<span class="a2ui-caption">${label}</span>`;
    if (external && !allowed) return html`<div class="a2ui-column" role=${aria['aria-label'] ? 'group' : undefined} ...${aria}>${caption}
        <button type="button" class="a2ui-button" onClick=${() => allow(true)}>Load external ${kind}</button>
    </div>`;
    return html`<div class="a2ui-column" inert=${aria.inert} aria-hidden=${aria['aria-hidden']}>${caption}
        ${kind === 'audio' ? html`<audio class="a2ui-playback" ref=${player} tabIndex=${0} controls preload="metadata" aria-label=${label || 'Audio'} ...${aria}
            crossOrigin=${crossOrigin} src=${source} onError=${unavailable}></audio>`
        : html`<video class="a2ui-playback" ref=${player} tabIndex=${0} controls preload="metadata" playsinline aria-label=${label || 'Video'} ...${aria}
            crossOrigin=${crossOrigin} src=${source} poster=${poster} onError=${unavailable}></video>`}
    </div>`;
}
