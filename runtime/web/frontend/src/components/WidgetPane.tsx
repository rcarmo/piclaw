import { useEffect, useRef, useState, useCallback } from "preact/hooks";
import { OverlayShell } from "./OverlayShell";

interface WidgetState {
  html: string;
  title: string;
  subtitle: string;
  status: "loading" | "streaming" | "final" | "error";
  error?: string;
}

// Bridge script injected into the widget iframe
const BRIDGE_SCRIPT = `
<script>
(function() {
  var piclawWidget = {
    submit: function(payload) {
      window.parent.postMessage({ type: 'piclaw:widget-submit', payload: payload }, '*');
    },
    close: function(payload) {
      window.parent.postMessage({ type: 'piclaw:widget-close', payload: payload }, '*');
    },
    requestRefresh: function(payload) {
      window.parent.postMessage({ type: 'piclaw:widget-refresh', payload: payload }, '*');
    }
  };
  window.piclawWidget = piclawWidget;

  // Forward host messages to widget
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'piclaw:host-message') {
      window.dispatchEvent(new CustomEvent('piclaw:widget-message', { detail: e.data }));
    }
  });
})();
<\/script>
`;

function buildSrcDoc(html: string, title: string): string {
  if (!html) return "";
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${title || "Widget"}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; padding: 8px; background: #1e1e2e; color: #cdd6f4; font-family: system-ui, sans-serif; font-size: 14px; }
  </style>
  ${BRIDGE_SCRIPT}
</head>
<body>
  ${html}
</body>
</html>`;
}

export function WidgetPane({ tabMode = false, widgetHtml, widgetSrc, widgetTitle }: { tabMode?: boolean; widgetHtml?: string; widgetSrc?: string; widgetTitle?: string }) {
  const [widget, setWidget] = useState<WidgetState | null>(
    widgetHtml ? { html: widgetHtml, title: widgetTitle || "Widget", subtitle: "", status: "final" } : null
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const htmlBufferRef = useRef(widgetHtml || "");

  // Update if props change
  useEffect(() => {
    if (widgetHtml) {
      htmlBufferRef.current = widgetHtml;
      setWidget({ html: widgetHtml, title: widgetTitle || "Widget", subtitle: "", status: "final" });
    }
  }, [widgetHtml, widgetTitle]);

  useEffect(() => {
    if (tabMode) return; // In tab mode, content comes from props
    const handleOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const html = detail?.artifact?.html || detail?.html || "";
      const title = detail?.title || "Widget";
      const subtitle = detail?.subtitle || detail?.description || "";
      htmlBufferRef.current = html;
      setWidget({ html, title, subtitle, status: html ? "final" : "loading" });
    };

    const handleDelta = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const delta = detail?.artifact?.html || detail?.html || detail?.delta || "";
      if (delta) {
        htmlBufferRef.current += delta;
        setWidget((prev) => prev ? { ...prev, html: htmlBufferRef.current, status: "streaming" } : prev);
      }
    };

    const handleFinal = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const html = detail?.artifact?.html || detail?.html || htmlBufferRef.current;
      htmlBufferRef.current = html;
      setWidget((prev) => prev ? { ...prev, html, status: "final" } : prev);
    };

    const handleClose = () => {
      htmlBufferRef.current = "";
      setWidget(null);
    };

    const handleError = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setWidget((prev) => prev ? { ...prev, status: "error", error: detail?.error || "Widget failed" } : prev);
    };

    // Handle messages from widget iframe
    const handleMessage = (e: MessageEvent) => {
      if (!e.data?.type) return;
      if (e.data.type === "piclaw:widget-submit") {
        const text = e.data.payload?.text;
        if (text) {
          // Post as user message
          window.dispatchEvent(new CustomEvent("piclaw:widget-submission", { detail: { text } }));
        }
      } else if (e.data.type === "piclaw:widget-close") {
        setWidget(null);
      }
    };

    window.addEventListener("piclaw:widget-open", handleOpen);
    window.addEventListener("piclaw:widget-delta", handleDelta);
    window.addEventListener("piclaw:widget-final", handleFinal);
    window.addEventListener("piclaw:widget-close", handleClose);
    window.addEventListener("piclaw:widget-error", handleError);
    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("piclaw:widget-open", handleOpen);
      window.removeEventListener("piclaw:widget-delta", handleDelta);
      window.removeEventListener("piclaw:widget-final", handleFinal);
      window.removeEventListener("piclaw:widget-close", handleClose);
      window.removeEventListener("piclaw:widget-error", handleError);
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  const handleClose = useCallback(() => {
    htmlBufferRef.current = "";
    setWidget(null);
  }, []);

  if (tabMode && widgetSrc) {
    return (
      <div className="widget-pane widget-pane--tab">
        <div className="widget-pane__body widget-pane__body--full">
          <iframe
            className="widget-pane__frame"
            src={widgetSrc}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            title={widgetTitle || "Widget"}
          />
        </div>
      </div>
    );
  }

  if (!widget && !tabMode) return null;
  if (!widget) {
    return <div className="widget-pane__empty">Waiting for widget content...</div>;
  }

  const srcDoc = buildSrcDoc(widget.html, widget.title);

  if (tabMode) {
    return (
      <div className="widget-pane widget-pane--tab">
        <div className="widget-pane__body widget-pane__body--full">
          {widget.status === "error" ? (
            <div className="widget-pane__error">{widget.error}</div>
          ) : srcDoc ? (
            <iframe
              ref={iframeRef}
              className="widget-pane__frame"
              sandbox="allow-scripts allow-same-origin"
              srcDoc={srcDoc}
              title={widget.title}
            />
          ) : (
            <div className="widget-pane__empty">Waiting for widget content...</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <OverlayShell open onClose={handleClose} escape="close" backdrop="close" tier="overlay" className="widget-pane__backdrop" ariaLabel={widget.title}>
      <div className="widget-pane" onMouseDown={e => e.stopPropagation()}>
        <div className="widget-pane__header">
          <div className="widget-pane__heading">
            <div className="widget-pane__eyebrow">
              Widget • {widget.status.toUpperCase()}
            </div>
            <div className="widget-pane__title">{widget.title}</div>
            {widget.subtitle && (
              <div className="widget-pane__subtitle">{widget.subtitle}</div>
            )}
          </div>
          <button
            type="button"
            className="widget-pane__close"
            onClick={handleClose}
            aria-label="Close widget"
          >
            ✕
          </button>
        </div>
        <div className="widget-pane__body">
          {widget.status === "error" ? (
            <div className="widget-pane__error">{widget.error}</div>
          ) : srcDoc ? (
            <iframe
              ref={iframeRef}
              className="widget-pane__frame"
              sandbox="allow-scripts allow-same-origin"
              srcDoc={srcDoc}
              title={widget.title}
            />
          ) : (
            <div className="widget-pane__empty">Waiting for widget content...</div>
          )}
        </div>
      </div>
    </OverlayShell>
  );
}
