/**
 * html-viewer-route.ts — Authenticated HTML preview route.
 *
 * Serves an iframe-based HTML file viewer at /html-viewer/?path=...
 * Renders workspace HTML files in a sandboxed iframe without same-origin
 * privileges. Workspace HTML is treated as untrusted preview content.
 */

import { registerExtensionRoute } from "./extension-routes.js";

const ROUTE_PREFIX = "/html-viewer";

const VIEWER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http:",
  "connect-src 'self'",
  "frame-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function generateHtmlViewerPage(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>HTML Preview</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { background: #0f1117; font-family: Inter, system-ui, sans-serif; height: 100vh; display: flex; flex-direction: column; }
  #toolbar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #1a1d28; border-bottom: 1px solid rgba(148,163,184,.15); flex-shrink: 0; }
  #toolbar .filename { color: #e2e8f0; font-size: 13px; font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #toolbar button { appearance: none; border: 0; cursor: pointer; font: 12px/1 Inter, system-ui, sans-serif; border-radius: 6px; padding: 6px 12px; color: #cbd5e1; background: rgba(148,163,184,.12); }
  #toolbar button:hover { background: rgba(148,163,184,.2); }
  #toolbar .sep { width: 1px; height: 20px; background: rgba(148,163,184,.15); }
  #frame { flex: 1; border: 0; width: 100%; background: white; }
  .empty { color: #94a3b8; font-size: 14px; padding: 24px; text-align: center; }
</style>
</head>
<body>
  <div id="toolbar">
    <span class="filename" id="filename">HTML Preview</span>
    <button id="btnSource" title="View source in editor">View Source</button>
    <div class="sep"></div>
    <button id="btnRefresh" title="Reload">↻ Refresh</button>
    <button id="btnNewTab" title="Open in new tab">↗ New Tab</button>
  </div>
  <iframe id="frame" sandbox="allow-scripts allow-forms allow-popups"></iframe>
  <script>
  (function() {
    var params = new URLSearchParams(location.search);
    var filePath = params.get('path') || '';
    if (!filePath) {
      document.getElementById('frame').style.display = 'none';
      document.body.innerHTML += '<div class="empty">Missing <code>?path=...</code> query parameter.</div>';
      return;
    }
    var fileName = filePath.split('/').pop() || 'index.html';
    document.getElementById('filename').textContent = fileName;
    document.title = fileName + ' — HTML Preview';

    var rawUrl = '/workspace/raw?path=' + encodeURIComponent(filePath);
    var frame = document.getElementById('frame');
    frame.src = rawUrl;

    document.getElementById('btnRefresh').addEventListener('click', function() {
      frame.src = rawUrl + '&_t=' + Date.now();
    });

    document.getElementById('btnNewTab').addEventListener('click', function() {
      window.open(rawUrl, '_blank');
    });

    document.getElementById('btnSource').addEventListener('click', function() {
      // Navigate the parent to the editor view for this file
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'piclaw:open-file', path: filePath, mode: 'edit' }, '*');
      } else {
        window.location.href = '/workspace/edit?path=' + encodeURIComponent(filePath);
      }
    });
  })();
  </script>
</body>
</html>`;
}

export function handleRoute(req: Request, pathname: string): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const relative = pathname.replace(/^\/html-viewer\/?/, "");
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

  return new Response(generateHtmlViewerPage(), { status: 200, headers });
}

registerExtensionRoute(ROUTE_PREFIX, handleRoute, import.meta.dir);
