import { html, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { useTranslation } from '../utils/i18n.js';
import { postIframeMessageBestEffort, setIframeNameBestEffort } from './generated-widget-host-bridge.js';
import {
    buildWidgetSrcDoc,
    getGeneratedWidgetEmptyStateMessage,
    getGeneratedWidgetHostPayload,
    getGeneratedWidgetHostWindowName,
    getGeneratedWidgetIframeSandbox,
    getGeneratedWidgetInitPayload,
    getGeneratedWidgetSessionKey,
} from '../ui/generated-widget.js';

export function buildFloatingWidgetBackdropClassName(maximized = false) {
    return `floating-widget-backdrop${maximized ? ' maximized' : ''}`;
}

export function buildFloatingWidgetPaneClassName(maximized = false) {
    return `floating-widget-pane${maximized ? ' maximized' : ''}`;
}

export function FloatingWidgetPane({ widget, onClose, onWidgetEvent }) {
    const { t } = useTranslation();
    const frameRef = useRef(null);
    const frameLoadedRef = useRef(false);
    const [maximized, setMaximized] = useState(false);
    const widgetSessionKey = getGeneratedWidgetSessionKey(widget);
    const srcDoc = useMemo(() => buildWidgetSrcDoc(widget), [
        widget?.artifact?.kind,
        widget?.artifact?.html,
        widget?.artifact?.svg,
        widget?.widgetId,
        widget?.toolCallId,
        widget?.turnId,
        widget?.title,
    ]);

    useEffect(() => {
        setMaximized(false);
    }, [widgetSessionKey]);

    useEffect(() => {
        if (!widget) return undefined;
        const handleEsc = (e) => {
            if (e.key !== 'Escape') return;
            if (maximized) {
                setMaximized(false);
                return;
            }
            onClose?.();
        };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [maximized, widget, onClose]);

    useEffect(() => {
        frameLoadedRef.current = false;
    }, [srcDoc]);

    useEffect(() => {
        if (!widget) return undefined;
        const iframe = frameRef.current;
        if (!iframe) return undefined;

        const postToFrame = (type) => {
            const hostName = getGeneratedWidgetHostWindowName(widget);
            const payload = type === 'widget.init'
                ? getGeneratedWidgetInitPayload(widget)
                : getGeneratedWidgetHostPayload(widget);

            setIframeNameBestEffort(iframe, hostName);
            postIframeMessageBestEffort(iframe, {
                __piclawGeneratedWidgetHost: true,
                type,
                widgetId: widget?.widgetId || null,
                toolCallId: widget?.toolCallId || null,
                turnId: widget?.turnId || null,
                payload,
            });
        };

        const syncHostState = () => {
            postToFrame('widget.init');
            postToFrame('widget.update');
        };

        const handleLoad = () => {
            frameLoadedRef.current = true;
            syncHostState();
        };

        iframe.addEventListener('load', handleLoad);

        // srcdoc iframes can finish loading before this effect attaches the
        // listener, especially on fast local rebuilds. Retry a few times so the
        // widget always receives init/update once its bridge is ready.
        const retryDelays = [0, 40, 120, 300, 800];
        const retryTimers = retryDelays.map((delay) => setTimeout(syncHostState, delay));

        return () => {
            iframe.removeEventListener('load', handleLoad);
            retryTimers.forEach((timer) => clearTimeout(timer));
        };
    }, [srcDoc, widget?.widgetId, widget?.toolCallId, widget?.turnId]);

    useEffect(() => {
        if (!widget) return undefined;
        const iframe = frameRef.current;
        if (!iframe?.contentWindow) return undefined;
        const hostName = getGeneratedWidgetHostWindowName(widget);
        const payload = getGeneratedWidgetHostPayload(widget);

        setIframeNameBestEffort(iframe, hostName);
        postIframeMessageBestEffort(iframe, {
            __piclawGeneratedWidgetHost: true,
            type: 'widget.update',
            widgetId: widget?.widgetId || null,
            toolCallId: widget?.toolCallId || null,
            turnId: widget?.turnId || null,
            payload,
        });
        return undefined;
    }, [
        widget?.widgetId,
        widget?.toolCallId,
        widget?.turnId,
        widget?.status,
        widget?.subtitle,
        widget?.description,
        widget?.error,
        widget?.width,
        widget?.height,
        widget?.runtimeState,
    ]);

    useEffect(() => {
        if (!widget) return undefined;
        const handleMessage = (event) => {
            const data = event?.data;
            if (!data || data.__piclawGeneratedWidget !== true) return;

            const iframe = frameRef.current;
            const currentKey = getGeneratedWidgetSessionKey(widget);
            const incomingKey = getGeneratedWidgetSessionKey({
                widgetId: data.widgetId,
                toolCallId: data.toolCallId,
            });

            if (incomingKey && currentKey && incomingKey !== currentKey) return;

            if (!incomingKey && iframe?.contentWindow && event.source !== iframe.contentWindow) return;

            onWidgetEvent?.(data, widget);
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [widget, onWidgetEvent]);

    if (!widget) return null;

    const artifact = widget?.artifact || {};
    const kind = artifact.kind || widget?.kind || 'html';
    const title = typeof widget?.title === 'string' && widget.title.trim() ? widget.title.trim() : 'Generated widget';
    const subtitle = typeof widget?.subtitle === 'string' && widget.subtitle.trim() ? widget.subtitle.trim() : '';
    const source = widget?.source === 'live' ? 'live' : 'timeline';
    const status = typeof widget?.status === 'string' && widget.status.trim() ? widget.status.trim() : 'final';
    const originLabel = source === 'live'
        ? `Live widget • ${status.toUpperCase()}`
        : (widget?.originPostId ? `Message #${widget.originPostId}` : 'Timeline launch');
    const description = typeof widget?.description === 'string' && widget.description.trim() ? widget.description.trim() : '';
    const emptyState = !srcDoc;
    const emptyMessage = getGeneratedWidgetEmptyStateMessage(widget);
    const sandbox = getGeneratedWidgetIframeSandbox(widget);

    return html`
        <div class=${buildFloatingWidgetBackdropClassName(maximized)} onClick=${() => onClose?.()}>
            <section
                class=${buildFloatingWidgetPaneClassName(maximized)}
                aria-label=${title}
                onClick=${(e) => e.stopPropagation()}
            >
                <div class="floating-widget-header">
                    <div class="floating-widget-heading">
                        <div class="floating-widget-eyebrow">${originLabel} • ${kind.toUpperCase()}</div>
                        <div class="floating-widget-title">${title}</div>
                        ${(subtitle || description) && html`
                            <div class="floating-widget-subtitle">${subtitle || description}</div>
                        `}
                    </div>
                    <div class="floating-widget-header-actions">
                        <button
                            class="floating-widget-action floating-widget-maximize"
                            type="button"
                            onClick=${() => setMaximized((value) => !value)}
                            title=${maximized ? 'Exit zen mode' : 'Enter zen mode'}
                            aria-label=${maximized ? 'Exit zen mode' : 'Enter zen mode'}
                            aria-pressed=${maximized ? 'true' : 'false'}
                        >
                            ${maximized ? 'Restore' : 'Maximize'}
                        </button>
                        <button
                            class="floating-widget-close"
                            type="button"
                            onClick=${() => onClose?.()}
                            title=${t('widget.close')}
                            aria-label=${t('widget.close')}
                        >
                            Close
                        </button>
                    </div>
                </div>
                <div class="floating-widget-body">
                    ${emptyState
                        ? html`<div class="floating-widget-empty">${emptyMessage}</div>`
                        : html`
                            <iframe
                                ref=${frameRef}
                                class="floating-widget-frame"
                                title=${title}
                                name=${getGeneratedWidgetHostWindowName(widget)}
                                sandbox=${sandbox}
                                allow="microphone; clipboard-read; clipboard-write"
                                referrerpolicy="no-referrer"
                                srcdoc=${srcDoc}
                            ></iframe>
                        `}
                </div>
            </section>
        </div>
    `;
}
