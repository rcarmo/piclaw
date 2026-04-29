// @ts-nocheck
/**
 * markdown-preview.ts — Live markdown preview panel for the editor.
 *
 * Renders below the CodeMirror editor when activated via tab context menu.
 * Uses the same renderMarkdown() pipeline as the timeline so output is
 * visually consistent. Updates on a debounced timer to avoid jank.
 *
 * Includes a draggable splitter at the top for resizing.
 */

import { html, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { renderMarkdown, renderMermaidDiagrams } from '../markdown.js';
import { readStoredPanelHeight, writeStoredPanelHeight } from './markdown-preview-storage.js';

const POLL_MS = 400;
const MIN_H = 60;
const DEFAULT_H = 220;
const LS_KEY = 'mdPreviewHeight';

function getStoredHeight() {
    return readStoredPanelHeight(localStorage, LS_KEY, MIN_H, DEFAULT_H);
}

/**
 * MarkdownPreview component.
 *
 * @param {Object} props
 * @param {() => string|undefined} props.getContent - Returns current editor content.
 * @param {string} props.path - File path (for display).
 * @param {() => void} props.onClose - Close the preview.
 */
export function MarkdownPreview({ getContent, path, onClose }) {
    const [renderedHtml, setRenderedHtml] = useState('');
    const [height, setHeight] = useState(getStoredHeight);
    const previewRef = useRef(null);
    const panelRef = useRef(null);
    const prevTextRef = useRef('');
    const getContentRef = useRef(getContent);

    // Keep ref in sync without restarting effects
    getContentRef.current = getContent;

    // Single stable interval — reads getContent via ref
    useEffect(() => {
        const tick = () => {
            const text = getContentRef.current?.() || '';
            if (text === prevTextRef.current) return;
            prevTextRef.current = text;
            try {
                const h = renderMarkdown(text, null);
                setRenderedHtml(h);
            } catch {
                setRenderedHtml('<p style="color:var(--text-secondary)">Preview unavailable</p>');
            }
        };
        tick();
        const id = setInterval(tick, POLL_MS);
        return () => clearInterval(id);
    }, []);

    // Render mermaid diagrams after HTML update
    useEffect(() => {
        if (previewRef.current && renderedHtml) {
            renderMermaidDiagrams(previewRef.current).catch((error) => {
                console.debug('[markdown-preview] Mermaid rendering failed for the live preview.', error, { path });
            });
        }
    }, [renderedHtml]);

    // ── Splitter drag (mouse) ──
    const handleMouseDown = (e) => {
        e.preventDefault();
        const startY = e.clientY;
        const startH = panelRef.current?.offsetHeight || height;
        const container = panelRef.current?.parentElement;
        const maxH = container ? container.offsetHeight * 0.7 : 500;
        const splitter = e.currentTarget;
        splitter.classList.add('dragging');
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';

        const onMove = (me) => {
            // Dragging up ⇒ larger preview
            const h = Math.min(Math.max(startH - (me.clientY - startY), MIN_H), maxH);
            setHeight(h);
        };
        const onUp = () => {
            splitter.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            writeStoredPanelHeight(localStorage, LS_KEY, panelRef.current?.offsetHeight || height);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    // ── Splitter drag (touch) ──
    const handleTouchStart = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        if (!touch) return;
        const startY = touch.clientY;
        const startH = panelRef.current?.offsetHeight || height;
        const container = panelRef.current?.parentElement;
        const maxH = container ? container.offsetHeight * 0.7 : 500;
        const splitter = e.currentTarget;
        splitter.classList.add('dragging');
        document.body.style.userSelect = 'none';

        const onMove = (te) => {
            const t = te.touches[0];
            if (!t) return;
            te.preventDefault();
            const h = Math.min(Math.max(startH - (t.clientY - startY), MIN_H), maxH);
            setHeight(h);
        };
        const onUp = () => {
            splitter.classList.remove('dragging');
            document.body.style.userSelect = '';
            writeStoredPanelHeight(localStorage, LS_KEY, panelRef.current?.offsetHeight || height);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);
            document.removeEventListener('touchcancel', onUp);
        };
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
        document.addEventListener('touchcancel', onUp);
    };

    return html`
        <div
            class="md-preview-splitter"
            onMouseDown=${handleMouseDown}
            onTouchStart=${handleTouchStart}
        ></div>
        <div class="md-preview-panel" ref=${panelRef} style=${{ height: height + 'px' }}>
            <div class="md-preview-header">
                <span class="md-preview-title">Preview</span>
                <button class="md-preview-close" onClick=${onClose} title="Close preview" aria-label="Close preview">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
                        <line x1="4" y1="4" x2="12" y2="12"/>
                        <line x1="12" y1="4" x2="4" y2="12"/>
                    </svg>
                </button>
            </div>
            <div
                class="md-preview-body post-content"
                ref=${previewRef}
                dangerouslySetInnerHTML=${{ __html: renderedHtml }}
            />
        </div>
    `;
}
