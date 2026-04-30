export type GeneratedWidgetKind = "html" | "svg" | "session_tree";
export type GeneratedWidgetSource = "timeline" | "live";
export type GeneratedWidgetStatus = "loading" | "streaming" | "final" | "error";

export interface GeneratedWidgetArtifact {
  kind: GeneratedWidgetKind;
  html?: string;
  svg?: string;
  tree?: any;
}

export interface GeneratedWidgetPayload {
  title: string;
  subtitle: string;
  description: string;
  originPostId: number | null;
  originChatJid: string | null;
  widgetId: string | null;
  artifact: GeneratedWidgetArtifact;
  capabilities?: string[];
  source?: GeneratedWidgetSource;
  status?: GeneratedWidgetStatus;
  turnId?: string | null;
  toolCallId?: string | null;
  width?: number | null;
  height?: number | null;
  error?: string | null;
}

function getArtifact(block: any): GeneratedWidgetArtifact | null {
  const artifact = block?.artifact || {};
  const kind = artifact.kind || block?.kind || null;
  if (kind !== "html" && kind !== "svg" && kind !== "session_tree") return null;

  if (kind === "html") {
    const html = typeof artifact.html === "string" ? artifact.html : (typeof block?.html === "string" ? block.html : "");
    return html ? { kind, html } : null;
  }

  if (kind === "svg") {
    const svg = typeof artifact.svg === "string" ? artifact.svg : (typeof block?.svg === "string" ? block.svg : "");
    return svg ? { kind, svg } : null;
  }

  const tree = artifact.tree && typeof artifact.tree === 'object'
    ? artifact.tree
    : (block?.tree && typeof block.tree === 'object' ? block.tree : null);
  return { kind, tree };
}

function getLiveArtifact(block: any): GeneratedWidgetArtifact {
  const artifact = block?.artifact && typeof block.artifact === 'object' ? block.artifact : {};
  const rawSvg = typeof artifact.svg === 'string' ? artifact.svg : (typeof block?.svg === 'string' ? block.svg : '');
  const rawHtml = typeof artifact.html === 'string'
    ? artifact.html
    : (typeof block?.html === 'string'
      ? block.html
      : (typeof block?.w === 'string'
        ? block.w
        : (typeof block?.content === 'string' ? block.content : '')));
  const rawTree = artifact.tree && typeof artifact.tree === 'object'
    ? artifact.tree
    : (block?.tree && typeof block.tree === 'object' ? block.tree : null);

  const requestedKind = artifact.kind || block?.kind || null;
  const kind = requestedKind === 'session_tree'
    ? 'session_tree'
    : (requestedKind === 'svg' || rawSvg ? 'svg' : 'html');
  if (kind === 'session_tree') {
    return { kind, tree: rawTree };
  }
  if (kind === 'svg') {
    return rawSvg ? { kind, svg: rawSvg } : { kind };
  }
  return rawHtml ? { kind, html: rawHtml } : { kind };
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeCapabilities(input: unknown, interactiveFallback = false): string[] {
  const values = Array.isArray(input)
    ? input
    : (interactiveFallback ? ['interactive'] : []);
  const normalized = values
    .filter((value) => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

const GENERATED_WIDGET_WINDOW_NAME_PREFIX = '__PICLAW_WIDGET_HOST__:';

function escapeJsonForInlineScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildGeneratedWidgetPayload(block: any, post?: any): GeneratedWidgetPayload | null {
  if (!block || block.type !== "generated_widget") return null;
  const artifact = getArtifact(block);
  if (!artifact) return null;

  return {
    title: block.title || block.name || "Generated widget",
    subtitle: typeof block.subtitle === "string" ? block.subtitle : "",
    description: block.description || block.subtitle || "",
    originPostId: Number.isFinite(post?.id) ? post.id : null,
    originChatJid: typeof post?.chat_jid === "string" ? post.chat_jid : null,
    widgetId: block.widget_id || block.id || null,
    artifact,
    capabilities: normalizeCapabilities(block.capabilities, block.interactive === true),
    source: 'timeline',
    status: 'final',
  };
}

export function normalizeLiveGeneratedWidgetPayload(block: any): GeneratedWidgetPayload | null {
  if (!block || typeof block !== 'object') return null;

  const artifact = getLiveArtifact(block);
  const widgetId = readOptionalString(block?.widget_id) || readOptionalString(block?.widgetId) || readOptionalString(block?.tool_call_id) || readOptionalString(block?.toolCallId);
  const toolCallId = readOptionalString(block?.tool_call_id) || readOptionalString(block?.toolCallId);
  const turnId = readOptionalString(block?.turn_id) || readOptionalString(block?.turnId);
  const title = readOptionalString(block?.title) || readOptionalString(block?.name) || 'Generated widget';
  const subtitle = readOptionalString(block?.subtitle) || '';
  const description = readOptionalString(block?.description) || subtitle;
  const status = readOptionalString(block?.status);
  const normalizedStatus = status === 'loading' || status === 'streaming' || status === 'final' || status === 'error'
    ? status
    : 'streaming';

  return {
    title,
    subtitle,
    description,
    originPostId: readFiniteNumber(block?.origin_post_id) ?? readFiniteNumber(block?.originPostId),
    originChatJid: readOptionalString(block?.origin_chat_jid) || readOptionalString(block?.originChatJid) || readOptionalString(block?.chat_jid) || null,
    widgetId,
    artifact,
    capabilities: normalizeCapabilities(block?.capabilities, true),
    source: 'live',
    status: normalizedStatus,
    turnId,
    toolCallId,
    width: readFiniteNumber(block?.width),
    height: readFiniteNumber(block?.height),
    error: readOptionalString(block?.error),
  };
}

export function canRenderGeneratedWidget(block: any): boolean {
  return buildGeneratedWidgetPayload(block, null) !== null;
}

export function getGeneratedWidgetSessionKey(widget: any): string | null {
  const toolCallId = readOptionalString(widget?.toolCallId) || readOptionalString(widget?.tool_call_id);
  if (toolCallId) return toolCallId;

  const widgetId = readOptionalString(widget?.widgetId) || readOptionalString(widget?.widget_id);
  if (widgetId) return widgetId;

  const originPostId = readFiniteNumber(widget?.originPostId) ?? readFiniteNumber(widget?.origin_post_id);
  if (originPostId !== null) return `post:${originPostId}`;
  return null;
}

export function isInteractiveGeneratedWidget(widget: any): boolean {
  const artifact = widget?.artifact || {};
  const kind = artifact.kind || widget?.kind || null;
  const capabilities = Array.isArray(widget?.capabilities) ? widget.capabilities : [];
  const interactiveCapability = capabilities.some((value) => typeof value === 'string' && value.trim().toLowerCase() === 'interactive');
  return kind === 'html' && (widget?.source === 'live' || interactiveCapability);
}

export function getGeneratedWidgetIframeSandbox(widget: any): string {
  return isInteractiveGeneratedWidget(widget)
    ? 'allow-downloads allow-scripts'
    : 'allow-downloads';
}

export function getGeneratedWidgetInitPayload(widget: any): Record<string, unknown> {
  return {
    title: readOptionalString(widget?.title) || 'Generated widget',
    widgetId: readOptionalString(widget?.widgetId) || readOptionalString(widget?.widget_id),
    toolCallId: readOptionalString(widget?.toolCallId) || readOptionalString(widget?.tool_call_id),
    turnId: readOptionalString(widget?.turnId) || readOptionalString(widget?.turn_id),
    capabilities: Array.isArray(widget?.capabilities) ? widget.capabilities : [],
    source: widget?.source === 'live' ? 'live' : 'timeline',
    status: readOptionalString(widget?.status) || 'final',
  };
}

export function getGeneratedWidgetHostPayload(widget: any): Record<string, unknown> {
  return {
    ...getGeneratedWidgetInitPayload(widget),
    subtitle: readOptionalString(widget?.subtitle) || '',
    description: readOptionalString(widget?.description) || '',
    error: readOptionalString(widget?.error) || null,
    width: readFiniteNumber(widget?.width),
    height: readFiniteNumber(widget?.height),
    runtimeState: widget?.runtimeState && typeof widget.runtimeState === 'object' ? widget.runtimeState : null,
  };
}

export function getGeneratedWidgetHostWindowName(widget: any): string {
  return `${GENERATED_WIDGET_WINDOW_NAME_PREFIX}${JSON.stringify(getGeneratedWidgetHostPayload(widget))}`;
}

export function getGeneratedWidgetSubmissionText(payload: any): string | null {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (!payload || typeof payload !== 'object') return null;

  const direct = readOptionalString(payload.text)
    || readOptionalString(payload.content)
    || readOptionalString(payload.message)
    || readOptionalString(payload.prompt)
    || readOptionalString(payload.value);
  if (direct) return direct;

  const data = payload.data;
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (data && typeof data === 'object') {
    const nested = readOptionalString(data.text)
      || readOptionalString(data.content)
      || readOptionalString(data.message)
      || readOptionalString(data.prompt)
      || readOptionalString(data.value);
    if (nested) return nested;
  }

  return null;
}

export function getGeneratedWidgetShouldCloseOnSubmit(payload: any): boolean {
  if (!payload || typeof payload !== 'object') return false;
  return payload.close === true || payload.dismiss === true || payload.closeAfterSubmit === true;
}

export function getGeneratedWidgetEmptyStateMessage(widget: any): string {
  const status = readOptionalString(widget?.status);
  if (status === 'loading' || status === 'streaming') {
    return 'Widget is loading…';
  }
  if (status === 'error') {
    return readOptionalString(widget?.error) || 'Widget failed to load.';
  }
  if ((widget?.artifact?.kind || widget?.kind) === 'session_tree') {
    return 'Session tree widget is unavailable.';
  }
  return 'Widget artifact is missing or unsupported.';
}

function buildWidgetBootstrapScript(widget: any): string {
  const meta = getGeneratedWidgetInitPayload(widget);
  const safeMeta = escapeJsonForInlineScript(meta);
  return `<script>
(function () {
  const meta = ${safeMeta};
  function post(kind, payload) {
    try {
      window.parent.postMessage({
        __piclawGeneratedWidget: true,
        kind,
        widgetId: meta.widgetId || null,
        toolCallId: meta.toolCallId || null,
        turnId: meta.turnId || null,
        payload: payload || {}
      }, '*');
    } catch {
      /* expected: parent bridge may be unavailable while the iframe is unloading. */
    }
  }

  const windowNamePrefix = ${escapeJsonForInlineScript(GENERATED_WIDGET_WINDOW_NAME_PREFIX)};
  let lastWindowName = null;
  let pendingHostEnvelope = null;
  let pendingHostEnvelopeFrame = 0;
  let lastDispatchedEnvelopeKey = null;

  function getEnvelopeKey(data) {
    try {
      return JSON.stringify([
        data?.type || null,
        data?.widgetId || null,
        data?.toolCallId || null,
        data?.turnId || null,
        data?.payload || null,
      ]);
    } catch {
      return null;
    }
  }

  function flushHostEnvelope() {
    pendingHostEnvelopeFrame = 0;
    const data = pendingHostEnvelope;
    pendingHostEnvelope = null;
    if (!data) return;

    window.piclawWidget.lastHostMessage = data;
    const nextPayload = data.payload || null;
    if (data.type === 'widget.init') {
      const previous = window.piclawWidget.hostState && typeof window.piclawWidget.hostState === 'object'
        ? window.piclawWidget.hostState
        : null;
      if (nextPayload && typeof nextPayload === 'object') {
        window.piclawWidget.hostState = {
          ...(previous || {}),
          ...nextPayload,
          ...(Object.prototype.hasOwnProperty.call(nextPayload, 'runtimeState')
            ? {}
            : { runtimeState: previous?.runtimeState ?? null }),
        };
      } else {
        window.piclawWidget.hostState = previous || null;
      }
    } else if (data.type === 'widget.update' || data.type === 'widget.complete' || data.type === 'widget.error') {
      window.piclawWidget.hostState = nextPayload;
    }

    const effectivePayload = window.piclawWidget.hostState ?? nextPayload ?? null;
    const detail = (effectivePayload === data.payload)
      ? data
      : { ...data, payload: effectivePayload };
    const envelopeKey = getEnvelopeKey(detail);
    if (envelopeKey && envelopeKey === lastDispatchedEnvelopeKey) return;
    lastDispatchedEnvelopeKey = envelopeKey;
    window.dispatchEvent(new CustomEvent('piclaw:widget-message', { detail }));
  }

  function scheduleHostEnvelope(data) {
    if (!data) return;
    pendingHostEnvelope = data;
    if (pendingHostEnvelopeFrame) return;
    const schedule = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 0);
    pendingHostEnvelopeFrame = schedule(flushHostEnvelope);
  }

  function readWindowNameState() {
    try {
      const raw = window.name || '';
      if (!raw || raw === lastWindowName || !raw.startsWith(windowNamePrefix)) return;
      lastWindowName = raw;
      const payload = JSON.parse(raw.slice(windowNamePrefix.length));
      scheduleHostEnvelope({
        __piclawGeneratedWidgetHost: true,
        type: 'widget.update',
        widgetId: meta.widgetId || null,
        toolCallId: meta.toolCallId || null,
        turnId: meta.turnId || null,
        payload,
      });
    } catch {
      /* expected: host window.name payload can be absent or mid-update while polling. */
    }
  }

  window.piclawWidget = {
    meta,
    lastHostMessage: null,
    hostState: null,
    ready(payload) { post('widget.ready', payload); },
    close(payload) { post('widget.close', payload); },
    requestRefresh(payload) { post('widget.request_refresh', payload); },
    submit(payload) { post('widget.submit', payload); },
  };

  window.addEventListener('message', function (event) {
    const data = event && event.data;
    if (!data || data.__piclawGeneratedWidgetHost !== true) return;
    if ((data.widgetId || null) !== (meta.widgetId || null)) return;
    scheduleHostEnvelope(data);
  });

  function announceReady() {
    readWindowNameState();
    post('widget.ready', { title: document.title || meta.title || 'Generated widget' });
  }

  setInterval(readWindowNameState, 250);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announceReady, { once: true });
  } else {
    announceReady();
  }
})();
</script>`;
}

export function buildWidgetSrcDoc(widget: any): string {
  const artifact = widget?.artifact || {};
  const kind = artifact.kind || widget?.kind || null;
  const rawHtml = typeof artifact.html === 'string' ? artifact.html : (typeof widget?.html === 'string' ? widget.html : '');
  const rawSvg = typeof artifact.svg === 'string' ? artifact.svg : (typeof widget?.svg === 'string' ? widget.svg : '');
  const title = typeof widget?.title === 'string' && widget.title.trim() ? widget.title.trim() : 'Generated widget';
  const content = kind === 'svg' ? rawSvg : rawHtml;
  if (!content) return '';

  const interactive = isInteractiveGeneratedWidget(widget);
  const csp = [
    "default-src 'none'",
    "img-src data: blob: https: http:",
    "style-src 'unsafe-inline'",
    "font-src 'self' data: https: http:",
    "media-src data: blob: https: http:",
    "connect-src 'none'",
    "frame-src 'none'",
    interactive ? "script-src 'unsafe-inline' 'self'" : "script-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  const body = kind === 'svg'
    ? `<div class="widget-svg-shell">${content}</div>`
    : content;
  const bootstrap = interactive ? buildWidgetBootstrapScript(widget) : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title.replace(/[<&>]/g, '')}</title>
<style>
:root { color-scheme: dark light; }
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background: #0f1117;
  color: #f5f7fb;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
body {
  box-sizing: border-box;
}
.widget-svg-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}
.widget-svg-shell svg {
  max-width: 100%;
  height: auto;
}
</style>
${bootstrap}
</head>
<body>${body}</body>
</html>`;
}
