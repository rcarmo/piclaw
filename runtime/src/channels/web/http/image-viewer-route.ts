/**
 * image-viewer-route.ts — Lightweight authenticated image viewer route.
 *
 * Serves a same-origin zoomable image viewer that loads workspace images via
 * /workspace/raw.
 */

import { registerExtensionRoute } from "./extension-routes.js";

const ROUTE_PREFIX = "/image-viewer";
const VIEWER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function generateImageViewerPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Image Viewer</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme:light; --viewer-bg:#ffffff; --viewer-fg:#18212b; --viewer-muted:#536171; --viewer-panel:#f3f5f7; --viewer-border:#b6bec8; --viewer-accent:#0969da; }
  @media (prefers-color-scheme:dark) { :root { color-scheme:dark; --viewer-bg:#171b22; --viewer-fg:#e6edf3; --viewer-muted:#a2afbf; --viewer-panel:#242b36; --viewer-border:#586577; --viewer-accent:#79c0ff; } }
  :root[data-image-surface="light"] img { background:#ffffff; color-scheme:light; }
  :root[data-image-surface="dark"] img { background:#171b22; color-scheme:dark; }
  :root[data-image-surface="transparent"] img { background:transparent; }

  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: var(--viewer-bg);
    color: var(--viewer-fg);
    font-family: system-ui, -apple-system, sans-serif;
  }
  .stage {
    width: 100%;
    height: 100%;
    overflow: auto;
    background-image:
      linear-gradient(45deg, rgba(128,128,128,0.08) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(128,128,128,0.08) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(128,128,128,0.08) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(128,128,128,0.08) 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0;
  }
  .inner {
    min-width: 100%; min-height: 100%;
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
  }
  img {
    max-width: none; max-height: none;
    flex: 0 0 auto;
    border-radius: 2px;
    background: var(--viewer-bg);
  }
  /* Hover toolbar — top-right */
  #toolbar-trigger { position: fixed; top: 0; right: 0; width: 140px; height: 24px; z-index: 99; }
  #toolbar {
    position: fixed; top: 0; right: 0; z-index: 100;
    display: flex; gap: 4px; padding: 6px 8px;
    background: var(--viewer-panel); border-bottom-left-radius: 6px;
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    opacity: 0; transition: opacity 0.2s;
  }
  #toolbar-trigger:hover + #toolbar, #toolbar:hover, #toolbar:focus-within { opacity: 1; }
  @media (hover:none) { #toolbar { opacity:1; } }
  #toolbar button, #toolbar select {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 28px; height: 24px; padding: 0 6px;
    border: none; border-radius: 3px; background: var(--viewer-bg);
    color: var(--viewer-fg); font: 12px system-ui, sans-serif; cursor: pointer;
  }
  #toolbar button:hover { background:var(--viewer-border); }
  #toolbar :is(button,select):focus-visible { outline:2px solid var(--viewer-accent); outline-offset:2px; }
  #toolbar .zoom-label { font-size: 11px; color: var(--viewer-muted); min-width: 36px; text-align: center; line-height: 24px; }
  .empty {
    display: flex; width: 100%; height: 100%;
    align-items: center; justify-content: center;
    color: var(--viewer-muted); font-size: 14px; padding: 24px; text-align: center;
  }
</style>
</head>
<body>
<div id="toolbar-trigger"></div>
<div id="toolbar">
  <select id="imageSurface" aria-label="Image background"><option value="theme">Theme</option><option value="light">Light</option><option value="dark">Dark</option><option value="transparent">Transparent</option></select>
  <button aria-label="Zoom out" id="zoomOut">−</button>
  <span class="zoom-label" id="zoomLabel">100%</span>
  <button aria-label="Zoom in" id="zoomIn">+</button>
  <button aria-label="Fit to viewer" aria-pressed="true" id="zoomFit">Fit</button>
  <button aria-label="Reset zoom to actual size" id="zoomReset">1:1</button>
</div>
<div id="stage" class="stage"><div class="inner"></div></div>
<script>
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var path = params.get('path') || '';
  document.getElementById('imageSurface').addEventListener('change', function (event) {
    document.documentElement.dataset.imageSurface = event.target.value;
  });
  function syncParentTheme() {
    if (parent === window) return;
    try {
      var root = parent.document.documentElement;
      var style = parent.getComputedStyle(root);
      var names = {'--viewer-bg':'--bg-primary','--viewer-fg':'--text-primary','--viewer-muted':'--text-secondary','--viewer-panel':'--bg-secondary','--viewer-border':'--border-color','--viewer-accent':'--accent-color'};
      Object.keys(names).forEach(function (key) { var value = style.getPropertyValue(names[key]).trim(); if (value && CSS.supports('color', value)) document.documentElement.style.setProperty(key, value); });
      var scheme = root.style.colorScheme || root.dataset.theme;
      if (scheme === 'light' || scheme === 'dark') document.documentElement.style.colorScheme = scheme;
    } catch (error) { console.debug('Image viewer parent theme unavailable.', error); }
  }
  syncParentTheme();
  try {
    if (parent !== window) {
      parent.addEventListener('piclaw-theme-change', syncParentTheme);
      window.addEventListener('pagehide', function () { parent.removeEventListener('piclaw-theme-change', syncParentTheme); }, {once:true});
    }
  } catch (error) { console.debug('Image viewer parent listener unavailable.', error); }

  var stageEl = document.getElementById('stage');

  if (!path) {
    document.body.innerHTML = '<div class="empty">Missing <code>?path=...</code> query parameter.</div>';
    return;
  }

  var fileName = path.split('/').pop() || 'image';
  document.title = fileName + ' · Image Viewer';

  var rawUrl = '/workspace/raw?path=' + encodeURIComponent(path);
  // Images open fitted to the viewer (never enlarged past 100%) and refit as it
  // resizes. Zooming switches to a fixed scale; Fit returns to fitting.
  var scale = 1;
  var fit = true;
  var PADDING = 24;
  var img = document.createElement('img');
  img.alt = fileName;
  img.src = rawUrl;

  var zoomLabel = document.getElementById('zoomLabel');
  var fitButton = document.getElementById('zoomFit');
  function naturalSize() {
    var width = img.naturalWidth, height = img.naturalHeight;
    // An SVG without intrinsic dimensions reports 0: treat the viewer as its size.
    if (!width || !height) return { width: Math.max(1, stageEl.clientWidth - PADDING * 2), height: Math.max(1, stageEl.clientHeight - PADDING * 2) };
    return { width: width, height: height };
  }
  function fitScale() {
    var size = naturalSize();
    var availableWidth = Math.max(1, stageEl.clientWidth - PADDING * 2);
    var availableHeight = Math.max(1, stageEl.clientHeight - PADDING * 2);
    return Math.min(1, availableWidth / size.width, availableHeight / size.height);
  }
  function applyScale() {
    if (fit) scale = fitScale();
    // Size the element, not a transform, so scrolling matches the zoom.
    var size = naturalSize();
    img.style.width = Math.max(1, Math.round(size.width * scale)) + 'px';
    img.style.height = Math.max(1, Math.round(size.height * scale)) + 'px';
    zoomLabel.textContent = Math.round(scale * 100) + '%';
    fitButton.setAttribute('aria-pressed', fit ? 'true' : 'false');
  }
  function clamp(v) { return Math.max(0.1, Math.min(8, v)); }
  function zoomTo(next) { fit = false; scale = clamp(next); applyScale(); }

  document.getElementById('zoomOut').addEventListener('click', function () { zoomTo(scale / 1.25); });
  document.getElementById('zoomIn').addEventListener('click', function () { zoomTo(scale * 1.25); });
  document.getElementById('zoomReset').addEventListener('click', function () { zoomTo(1); });
  fitButton.addEventListener('click', function () { fit = true; applyScale(); });
  stageEl.addEventListener('wheel', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomTo(scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
  }, { passive: false });
  img.addEventListener('load', applyScale);
  if (typeof ResizeObserver === 'function') new ResizeObserver(function () { if (fit) applyScale(); }).observe(stageEl);
  else window.addEventListener('resize', function () { if (fit) applyScale(); });

  img.addEventListener('error', function () {
    stageEl.innerHTML = '<div class="inner"><div class="empty">Failed to load image.</div></div>';
  });

  var inner = stageEl.querySelector('.inner');
  inner.appendChild(img);
  applyScale();
})();
</script>
</body>
</html>`;
}

function handleImageViewerRoute(req: Request, pathname: string): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const relative = pathname.replace(/^\/image-viewer\/?/, "");
  if (relative && !relative.startsWith("?")) {
    return new Response("Not Found", { status: 404 });
  }

  const headers = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": VIEWER_CSP,
  };

  if (req.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(generateImageViewerPage(), { status: 200, headers });
}

registerExtensionRoute(ROUTE_PREFIX, handleImageViewerRoute, import.meta.dir);
