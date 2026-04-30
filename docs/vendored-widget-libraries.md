# Vendored widget libraries

Interactive widgets posted via `send_dashboard_widget` run in a sandboxed iframe
with `allow-scripts` but without `allow-same-origin`, so widget documents run in
an opaque origin and communicate with the host through the `piclawWidget`
postMessage bridge. The CSP allows inline scripts for the bridge/runtime.

The following libraries are vendored as static assets and available to any widget
and to generated HTML artifacts from the `visual-artifact-generator` skill:

## Babylon.js 7.x

**Size:** 7.7 MB (minified UMD)  
**Path:** `/static/js/vendor/babylon/babylon.js`  
**Global:** `BABYLON`  
**License:** Apache-2.0

3D engine with PBR materials, GlowLayer, MeshBuilder, ArcRotateCamera,
SceneLoader (STL, glTF), physics, particles, and post-processing.

```html
<canvas id="renderCanvas"></canvas>
<script src="/static/js/vendor/babylon/babylon.js"></script>
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

## ECharts 5.6

**Size:** 1010 KB (minified UMD)  
**Path:** `/static/js/vendor/echarts/echarts.min.js`  
**Global:** `echarts`  
**License:** Apache-2.0

Rich charting library: bar, line, pie, scatter, radar, heatmap, treemap,
sunburst, sankey, graph, geographic maps, candlestick, boxplot, and more.
Dark theme built in.

![ECharts treemap widget — source code visualization](echarts-treemap-widget.png)

```html
<div id="chart" style="width:100%;height:400px"></div>
<script src="/static/js/vendor/echarts/echarts.min.js"></script>
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

## D3 7.9

**Size:** 274 KB (minified UMD)  
**Path:** `/static/js/vendor/d3/d3.min.js`  
**Global:** `d3`  
**License:** ISC

Low-level data visualization toolkit: selections, scales, axes, shapes,
transitions, force-directed layouts, geographic projections, hierarchical
layouts (treemap, pack, partition, cluster), Voronoi, contours, and more.

```html
<svg id="viz" width="600" height="400"></svg>
<script src="/static/js/vendor/d3/d3.min.js"></script>
<script>
  var svg = d3.select('#viz');
  // Full D3 API available
</script>
```

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

## Mermaid (beautiful-mermaid)

**Size:** ~1.5 MB (bundled)
**Path:** `/static/js/vendor/beautiful-mermaid.js`
**Global:** `window.beautifulMermaid`
**License:** MIT

Mermaid diagram renderer with enhanced theming. Exposes
`window.beautifulMermaid` — **not** `window.mermaid`. Do not use
`mermaid.initialize()` patterns here.

```html
<script src="/static/js/vendor/beautiful-mermaid.js"></script>
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

## Vendored fonts

Two font families are vendored as WOFF2 assets for use in generated HTML
artifacts and widgets:

### IBM Plex Sans

**Path:** `/static/fonts/ibm-plex-sans/`
**Weights:** Regular (400), Medium (500), SemiBold (600), Bold (700)
**License:** OFL 1.1

```css
@font-face {
  font-family: 'IBM Plex Sans';
  font-weight: 400;
  src: url(/static/fonts/ibm-plex-sans/IBMPlexSans-Regular.woff2) format('woff2');
}
```

### JetBrains Mono Nerd Font Mono

**Path:** `/static/fonts/jetbrains-mono-nf/`
**Weights:** Regular (400), Medium (500)
**License:** OFL 1.1

Nerd Font patched variant — includes ~9,000 Powerline, Devicons, and
file-type glyphs. Also serves as the terminal font.

```css
@font-face {
  font-family: 'JetBrains Mono NF';
  font-weight: 400;
  src: url(/static/fonts/jetbrains-mono-nf/JetBrainsMonoNFM-Regular.woff2) format('woff2');
}
```

> **Widget sandbox note:** Interactive widgets do not receive
> `allow-same-origin`. Treat the iframe as an opaque-origin execution context
> and use the `piclawWidget` bridge for host communication.

## Mermaid post-processing helper

The `beautiful-mermaid` renderer outputs polylines with sharp 90° corners and
uses CSS variables for colors that need explicit initialization. A helper script
handles all required fixups:

**Path:** `.pi/skills/visual-artifact-generator/scripts/mermaid-fixup.js`
**Exposes:** `window.fixupMermaidSVG(container, options)`

```html
<script src="/static/js/vendor/beautiful-mermaid.js"></script>
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
