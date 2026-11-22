import { html, useEffect, useState } from '../vendor/preact-htm.js';
import type { A2uiSurface } from './a2ui-surface.js';

let loaded: typeof A2uiSurface | undefined;
let importing: Promise<typeof A2uiSurface> | undefined;

/** Do not load the catalogue on a timeline that has no surfaces. */
export function LazyA2uiSurface(props: Parameters<typeof A2uiSurface>[0]) {
    const [component,setComponent] = useState(() => loaded);
    useEffect(() => {
        if (component) return;
        let mounted=true;
        importing ??= import('./a2ui-surface.js').then(module=>loaded=module.A2uiSurface);
        void importing.then(surface=>{ if (mounted) setComponent(() => surface); },()=>{ importing=undefined; });
        return () => { mounted=false; };
    }, [component]);
    return component ? html`<${component} ...${props} />`
        : html`<section class="a2ui-surface">${props.block.fallback_text}</section>`;
}
