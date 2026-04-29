// @ts-nocheck
import { html, useEffect, useRef } from '../vendor/preact-htm.js';
import { renderMarkdown, renderMermaidDiagrams, renderThinkingMarkdown } from '../markdown.js';
import { shouldShowBtwAnswer, shouldShowBtwControls } from '../ui/btw.js';

export function BtwPanel({ session, onClose, onInject, onRetry }) {
    const thinkingRef = useRef(null);
    const answerRef = useRef(null);
    const renderedThinking = session?.thinking ? renderThinkingMarkdown(session.thinking) : '';
    const renderedAnswer = session?.answer ? renderMarkdown(session.answer, null) : '';

    useEffect(() => {
        if (thinkingRef.current && renderedThinking) {
            renderMermaidDiagrams(thinkingRef.current).catch((error) => {
                console.debug('[btw-panel] Mermaid rendering failed for BTW thinking content.', error);
            });
        }
    }, [renderedThinking]);

    useEffect(() => {
        if (answerRef.current && renderedAnswer) {
            renderMermaidDiagrams(answerRef.current).catch((error) => {
                console.debug('[btw-panel] Mermaid rendering failed for BTW answer content.', error);
            });
        }
    }, [renderedAnswer]);

    if (!session) return null;

    const running = session.status === 'running';
    const hasAnswer = Boolean(String(session.answer || '').trim());
    const hasThinking = Boolean(String(session.thinking || '').trim());
    const showAnswer = shouldShowBtwAnswer(session);
    const showControls = shouldShowBtwControls(session);
    const canInject = !running && hasAnswer;

    const statusLabel = running
        ? 'Thinking…'
        : session.status === 'error'
            ? 'Error'
            : 'Done';

    return html`
        <section class="btw-panel" aria-label="BTW side conversation">
            <div class="btw-panel-header">
                <div class="btw-panel-title-wrap">
                    <span class="btw-panel-title">Question</span>
                    <span class=${`btw-panel-status btw-panel-status-${session.status || 'idle'}`}>${statusLabel}</span>
                </div>
                <button class="btw-panel-close" onClick=${() => onClose?.()} title="Close BTW" aria-label="Close BTW">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                        <line x1="4" y1="4" x2="12" y2="12"/>
                        <line x1="12" y1="4" x2="4" y2="12"/>
                    </svg>
                </button>
            </div>

            ${session.question && html`<div class="btw-block btw-question">${session.question}</div>`}
            ${session.error && html`<div class="btw-block btw-error">${session.error}</div>`}
            ${hasThinking && html`
                <details class="btw-block btw-thinking" open=${running ? true : undefined}>
                    <summary>Thinking</summary>
                    <div
                        class="btw-thinking-body post-content"
                        ref=${thinkingRef}
                        dangerouslySetInnerHTML=${{ __html: renderedThinking }}
                    ></div>
                </details>
            `}
            ${showAnswer && html`
                <div class="btw-block btw-answer">
                    <div class="btw-answer-label">Answer</div>
                    <div
                        class="btw-answer-body post-content"
                        ref=${answerRef}
                        dangerouslySetInnerHTML=${{ __html: renderedAnswer }}
                    ></div>
                </div>
            `}

            ${showControls && html`
                <div class="btw-panel-footer">
                    <div class="btw-panel-footer-left">
                        ${session.question && html`
                            <button class="btw-btn btw-btn-secondary" onClick=${() => onRetry?.()}>
                                Retry
                            </button>
                        `}
                    </div>
                    <div class="btw-panel-footer-right">
                        <button class="btw-btn btw-btn-primary" onClick=${() => onInject?.()} disabled=${!canInject}>
                            Inject into chat
                        </button>
                    </div>
                </div>
            `}
        </section>
    `;
}
