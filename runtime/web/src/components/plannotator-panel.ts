// @ts-nocheck
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { renderMarkdown, renderMermaidDiagrams } from '../markdown.js';

/**
 * PlannotatorPanel — side panel for quick plan review (Approve / Reject).
 *
 * Props:
 *   session      – PlannotatorSession | null
 *   onClose      – () => void
 *   onApprove    – (comment: string) => void
 *   onReject     – (comment: string) => void
 *   onOpenTab    – () => void  (expands to full pane)
 */
export function PlannotatorPanel({ session, onClose, onApprove, onReject, onOpenTab }) {
    const [rejectOpen, setRejectOpen] = useState(false);
    const [rejectComment, setRejectComment] = useState('');
    const contentRef = useRef(null);

    const renderedContent = session?.content
        ? renderMarkdown(session.content, null)
        : '';

    useEffect(() => {
        setRejectOpen(false);
        setRejectComment('');
    }, [session?.id]);

    useEffect(() => {
        if (contentRef.current && renderedContent) {
            renderMermaidDiagrams(contentRef.current).catch((err) => {
                console.debug('[plannotator-panel] Mermaid render failed', err);
            });
        }
    }, [renderedContent]);

    if (!session) return null;

    const title = session.title || 'Plan Review';
    const isStreaming = session.status === 'streaming';

    function handleApprove() {
        onApprove?.('');
    }

    function handleRejectToggle() {
        setRejectOpen((v) => !v);
    }

    function handleRejectSubmit() {
        onReject?.(rejectComment.trim());
        setRejectComment('');
        setRejectOpen(false);
    }

    return html`
        <section class="plannotator-panel" aria-label="Plan review">
            <div class="plannotator-panel-header">
                <div class="plannotator-panel-title-wrap">
                    <span class="plannotator-panel-title">${title}</span>
                    ${isStreaming && html`<span class="plannotator-panel-status plannotator-status-streaming">Streaming…</span>`}
                </div>
                <div class="plannotator-panel-header-actions">
                    <button
                        class="plannotator-expand-btn"
                        onClick=${() => onOpenTab?.()}
                        title="Open in full tab"
                        aria-label="Open in full tab"
                    >
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="10 2 14 2 14 6"/>
                            <polyline points="6 14 2 14 2 10"/>
                            <line x1="14" y1="2" x2="9" y2="7"/>
                            <line x1="2" y1="14" x2="7" y2="9"/>
                        </svg>
                    </button>
                    <button
                        class="plannotator-close-btn"
                        onClick=${() => onClose?.()}
                        title="Close"
                        aria-label="Close plan review"
                    >
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                            <line x1="4" y1="4" x2="12" y2="12"/>
                            <line x1="12" y1="4" x2="4" y2="12"/>
                        </svg>
                    </button>
                </div>
            </div>

            <div
                class="plannotator-panel-content post-content"
                ref=${contentRef}
                dangerouslySetInnerHTML=${{ __html: renderedContent }}
            ></div>

            <div class="plannotator-panel-footer">
                ${rejectOpen
                    ? html`
                        <div class="plannotator-reject-form">
                            <textarea
                                class="plannotator-reject-textarea"
                                placeholder="Optional: reason for rejection…"
                                rows="3"
                                value=${rejectComment}
                                onInput=${(e) => setRejectComment(e.target.value)}
                                onKeyDown=${(e) => {
                                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRejectSubmit();
                                    if (e.key === 'Escape') setRejectOpen(false);
                                }}
                            ></textarea>
                            <div class="plannotator-reject-actions">
                                <button class="plannotator-btn plannotator-btn-ghost" onClick=${() => setRejectOpen(false)}>
                                    Cancel
                                </button>
                                <button class="plannotator-btn plannotator-btn-danger" onClick=${handleRejectSubmit}>
                                    Send rejection
                                </button>
                            </div>
                        </div>
                    `
                    : html`
                        <div class="plannotator-panel-actions">
                            <button
                                class="plannotator-btn plannotator-btn-danger-ghost"
                                onClick=${handleRejectToggle}
                                disabled=${isStreaming}
                            >
                                Reject
                            </button>
                            <button
                                class="plannotator-btn plannotator-btn-primary"
                                onClick=${handleApprove}
                                disabled=${isStreaming}
                            >
                                Approve
                            </button>
                        </div>
                    `
                }
            </div>
        </section>
    `;
}
