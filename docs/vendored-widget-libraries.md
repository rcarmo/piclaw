# Vendored widget libraries

Interactive HTML widgets in Classic allow inline and same-origin scripts, WASM compilation (`'wasm-unsafe-eval'`), same-origin fetches and same-origin child frames by default. JavaScript `eval` and cross-origin scripts, fetches and frames are blocked. Existing image, font and media source permissions are unchanged. Static HTML/SVG previews in the web UI keep scripts, connections and frames disabled. Same-origin stylesheets and inline styles remain available. Live HTML widgets are interactive; timeline HTML requires the `interactive` capability or the legacy `interactive: true` opt-in. Explicit capability arrays take precedence over that legacy flag.

These are trusted agent-authored widgets. The existing `allow-scripts allow-same-origin` sandbox permits authenticated same-origin access and parent DOM access; it is not a security boundary for untrusted HTML. Child frames inherit sandbox restrictions but have their own document CSP. The Visual wrapper now applies the shared CSP, so external script/connection/frame sources previously accepted there must be served from the PiClaw origin.

The following libraries are vendored as static assets. Dashboard widgets and generated HTML artifacts from the `visual-artifact-generator` skill can load them explicitly from the paths below; the iframe does not inherit scripts or styles from the host page.

## Babylon.js 9.16

**Size:** 7.8 MiB (UMD)
**Path:** `/static/common/js/vendor/babylon/babylon.js`
**Global:** `BABYLON`
**License:** Apache-2.0

3D engine with PBR materials, GlowLayer, MeshBuilder, ArcRotateCamera,
SceneLoader (STL, glTF), physics, particles, and post-processing.

```html
<canvas id="renderCanvas"></canvas>
<script src="/static/common/js/vendor/babylon/babylon.js"></script>
<script>
  var canvas = document.getElementById('renderCanvas');
  var engine = new BABYLON.Engine(canvas, true);
  var scene = new BABYLON.Scene(engine);
  var camera = new BABYLON.ArcRotateCamera('cam', -Math.PI/4, Math.PI/3, 10,
    BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), scene);
  engine.runRenderLoop(function () { scene.render(); });
  window.addEventListener('resize', function () { engine.resize(); });
</script>
```

## ECharts 6.1

**Size:** 1.1 MB (minified UMD)
**Path:** `/static/common/js/vendor/echarts/echarts.min.js`
**Global:** `echarts`
**License:** Apache-2.0

Charting library with bar, line, pie, scatter, radar, heatmap, treemap,
sunburst, sankey, graph, geographic maps, candlestick, boxplot, and more.
Includes a built-in dark theme.

![ECharts treemap widget — source code visualization](echarts-treemap-widget.png)

```html
<div id="chart" style="width:100%;height:400px"></div>
<script src="/static/common/js/vendor/echarts/echarts.min.js"></script>
<script>
  var chart = echarts.init(document.getElementById('chart'), 'dark');
  chart.setOption({
    xAxis: { data: ['A', 'B', 'C'] },
    yAxis: {},
    series: [{ type: 'bar', data: [10, 20, 30] }]
  });
  window.addEventListener('resize', function () { chart.resize(); });
</script>
```

## Three.js r185.1

**Size:** 357 KiB (ESM module) plus 376 KiB (core)
**Path:** `/static/common/js/vendor/three/three.module.min.js`
**Global:** none (ESM import)
**License:** MIT

3D rendering library for scenes, geometries, materials, loaders, and
post-processing. Import the module build directly:

```html
<script type="module">
  import * as THREE from '/static/common/js/vendor/three/three.module.min.js';
  const scene = new THREE.Scene();
</script>
```

## D3 7.9

**Size:** 274 KB (minified UMD)
**Path:** `/static/common/js/vendor/d3/d3.min.js`
**Global:** `d3`
**License:** ISC

Low-level data visualization toolkit: selections, scales, axes, shapes,
transitions, force-directed layouts, geographic projections, hierarchical
layouts (treemap, pack, partition, cluster), Voronoi, contours, and more.

```html
<svg id="viz" width="600" height="400"></svg>
<script src="/static/common/js/vendor/d3/d3.min.js"></script>
<script>
  var svg = d3.select('#viz');
  // Full D3 API available
</script>
```

## Preact 10.29.7 + HTM 3.1.1

**Size:** 16 KiB (minified ESM)
**Path:** `/static/common/js/vendor/preact-htm.js`
**Exports:** `h`, `html`, `render`, `Component`, contexts, and Preact hooks
**Licenses:** MIT (Preact), Apache-2.0 (HTM)

This is the preferred small component runtime for Piclaw web panes and lightweight widgets that need component state without a compile step.

```html
<div id="app"></div>
<script type="module">
  import { html, render, useState } from '/static/common/js/vendor/preact-htm.js';

  function Counter() {
    const [count, setCount] = useState(0);
    return html`<button onClick=${() => setCount(count + 1)}>Count: ${count}</button>`;
  }

  render(html`<${Counter} />`, document.getElementById('app'));
</script>
```

## Marked 18.0.6

**Size:** 41 KiB (minified IIFE)
**Path:** `/static/common/js/marked.min.js`
**Global:** `marked`
**License:** MIT

Markdown parser used by the host web UI and available to widgets that need client-side Markdown rendering. Sanitize untrusted HTML separately; Marked parses Markdown but is not an HTML sanitizer.

```html
<div id="output"></div>
<script src="/static/common/js/marked.min.js"></script>
<script>
  document.getElementById('output').innerHTML = marked.parse('# Widget output');
</script>
```

## KaTeX 0.17.0

**Size:** 267 KiB (minified IIFE), plus fonts
**Path:** `/static/common/js/vendor/katex.min.js`
**Global:** `katex`
**License:** MIT

KaTeX powers host-side math rendering. Its WOFF2 fonts are vendored under `/static/common/fonts/`. The host app bundles the matching KaTeX CSS; sandboxed widgets do not inherit that CSS and must provide compatible styles if they render formulas themselves.

```html
<div id="output"></div>
<script src="/static/common/js/vendor/katex.min.js"></script>
<script>
  katex.render('c = \\pm\\sqrt{a^2 + b^2}', document.getElementById('output'), {
    throwOnError: false
  });
</script>
```

## Adaptive Cards 3.0.6

**Size:** 331 KiB (minified IIFE)
**Path:** `/static/common/js/vendor/adaptivecards.min.js`
**Global:** `AdaptiveCards`
**License:** MIT

This is the browser renderer used by Piclaw's structured timeline cards. Extension authors should normally post cards through `send_adaptive_card` rather than rendering the SDK in a dashboard widget; the static bundle is documented here for host UI maintenance and specialized pane use.

## Widget bridge

All interactive widgets get `window.piclawWidget` automatically:

```js
piclawWidget.submit({ text: "message" })   // Send text back into the chat
piclawWidget.close({ reason: "done" })      // Programmatic dismiss (pane already has its own close button)
piclawWidget.requestRefresh({ key: "val" }) // Ask host for data

// Listen for host responses:
window.addEventListener('piclaw:widget-message', function (e) {
  var payload = e.detail && e.detail.payload;
});
```

## Timeline diagrams (Pele)

Classic and Family render Mermaid fences with `pele@1.6.0`. The local
asset `/static/common/js/vendor/pele.js` exposes `window.piclawDiagrams.render(source)`,
which returns an SVG string synchronously. The application passes it through
the shared fail-closed SVG sanitizer before insertion.

The host owns rendering options: links and images are disabled, authored
direction is preserved, and source/output/edge limits apply. Live Piclaw CSS
tokens colour text, surfaces, connectors and chart series in light and dark
themes without regenerating the SVG. Fixed colours authored in a diagram stay
fixed. Pele zoom controls, resize-driven relayout and error overlays are not
used; the existing inline loading and error surfaces remain.

`bun run build:vendor:pele` regenerates the bundle, metadata and complete
MIT/embedded ISC notice at `/static/common/js/vendor/pele.LICENSE.txt`, plus
the bundled DOMPurify Apache-2.0 notice at
`/static/common/js/vendor/diagram-sanitizer.LICENSE.txt`.
`bun run update:vendor:pele -- --version <exact-version>` updates the pinned
package through the existing manifest workflow.

## Legacy widget diagrams (beautiful-mermaid)

The existing asset and all eight `beautifulMermaid` exports remain available
for generated widgets and older artifacts, including the original parser
model and theme helpers. It is not loaded by the timeline and is never an
automatic fallback for a Pele error. Remove it only after those callers have
an explicit, tested migration path. The post-processing helper below applies
only to this legacy renderer, not to Pele output.

**Size:** ~1.5 MB (bundled)
**Path:** `/static/common/js/vendor/beautiful-mermaid.js`
**Global:** `window.beautifulMermaid`
**License:** MIT

Mermaid renderer with Piclaw theming. Exposes `window.beautifulMermaid`,
not `window.mermaid`. Do not use `mermaid.initialize()` patterns here.

```html
<script src="/static/common/js/vendor/beautiful-mermaid.js"></script>
<script>
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  beautifulMermaid.renderMermaidSVGAsync(source, {
    bg: isDark ? '#1e293b' : '#ffffff',
    fg: isDark ? '#e2e8f0' : '#1f2937',
    // ... other color options
  }).then(svg => {
    container.innerHTML = svg;
    // Always post-process with fixupMermaidSVG() — see below
  });
</script>
```

## Dependency provenance and rebuilding

Each generated bundle has a nearby `*.meta.json` file recording its package version, license, repository, SHA-256 digest, size, source entry point, and exact build command. Manifests for build-script-managed bundles live in `runtime/vendor-manifests/`.

Do not hand-edit generated bundles. To rebuild the standard runtime vendor set from the repository root:

```bash
bun run build:vendor
```

For one manifest, use the build command captured in that bundle's metadata, for example:

```bash
cd runtime
bun run scripts/build-vendored-dependency.ts --manifest vendor-manifests/preact-htm.json
```

Bundles not included in `build:vendor`, such as Adaptive Cards, can use the same command with their own manifest. Commit the source/manifest change, generated asset, and regenerated metadata together. `runtime/test/scripts/runtime-vendors.test.ts` covers reproducible builds and browser globals for the Preact/HTM, Marked, and KaTeX bundles.

## Vendored fonts

Two font families are vendored as WOFF2 assets for use in generated HTML
artifacts and widgets:

### IBM Plex Sans

**Path:** `/static/common/fonts/ibm-plex-sans/`
**Weights:** Regular (400), Medium (500), SemiBold (600), Bold (700)
**License:** OFL 1.1

```css
@font-face {
  font-family: 'IBM Plex Sans';
  font-weight: 400;
  src: url(/static/common/fonts/ibm-plex-sans/IBMPlexSans-Regular.woff2) format('woff2');
}
```

### JetBrains Mono Nerd Font Mono

**Path:** `/static/common/fonts/jetbrains-mono-nf/`
**Weights:** Regular (400), Medium (500)
**License:** OFL 1.1

This Nerd Font variant includes about 9,000 Powerline, Devicons, and
file-type glyphs. Piclaw also uses it as the terminal font.

```css
@font-face {
  font-family: 'JetBrains Mono NF';
  font-weight: 400;
  src: url(/static/common/fonts/jetbrains-mono-nf/JetBrainsMonoNFM-Regular.woff2) format('woff2');
}
```

> **Widget sandbox note:** Interactive widgets receive `allow-scripts`,
> `allow-same-origin`, and `allow-forms` so they can load vendored/workspace
> assets and use authenticated local endpoints. Treat widget HTML as trusted
> code, keep host interaction explicit, and prefer the `piclawWidget` bridge
> for returning user decisions to the chat.

## Mermaid post-processing helper

The `beautiful-mermaid` renderer outputs polylines with sharp 90° corners and
uses CSS variables for colors that need explicit initialization. A helper script
handles all required fixups:

**Path:** `.pi/skills/visual-artifact-generator/scripts/mermaid-fixup.js`
**Exposes:** `window.fixupMermaidSVG(container, options)`

```html
<script src="/static/common/js/vendor/beautiful-mermaid.js"></script>
<script src="/workspace/.pi/skills/visual-artifact-generator/scripts/mermaid-fixup.js"></script>
<script>
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  beautifulMermaid.renderMermaidSVGAsync(source, { /* colors */ }).then(svg => {
    container.innerHTML = svg;
    fixupMermaidSVG(container, { isDark });  // fixes colors, arrows, rounded corners
  });
</script>
```

`fixupMermaidSVG` handles:
1. CSS variable initialization (`--_line`, `--_arrow`, `--_accent`)
2. Direct arrowhead marker color fixes
3. Google Fonts `@import` removal
4. Polyline → Q-curve path conversion (rounded edge corners)
5. Rect corner rounding (`rx=8`)
