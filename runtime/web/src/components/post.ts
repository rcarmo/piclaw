// @ts-nocheck
import { html, useCallback, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { getMediaInfo, getMediaUrl, getThumbnailUrl, submitAdaptiveCardAction } from '../api.js';
import { renderMarkdown, renderMermaidDiagrams, sanitizeUrl } from '../markdown.js';
import { formatCount, formatFileSize, formatTime, formatTimestamp } from '../utils/format.js';
import { buildPostMarkdownCopyPayload } from '../utils/post-copy-markdown.js';
import { DEFAULT_AGENT_NAME, getAvatarInfo } from '../ui/agent-utils.js';
import { getAttachmentPreviewKind } from '../ui/attachment-preview.js';
import { extractCardBlocks, renderAdaptiveCard } from '../ui/adaptive-card-renderer.js';
import { buildAdaptiveCardSubmissionFallbackText, describeAdaptiveCardSubmission, extractAdaptiveCardSubmissionBlocks } from '../ui/adaptive-card-submission.js';
import { buildGeneratedWidgetPayload, canRenderGeneratedWidget } from '../ui/generated-widget.js';
import { ImageModal } from './image-modal.js';
import { FilePill } from './file-pill.js';
import { copyPlainTextSelectionFromElement, readSessionStorageFlagBestEffort, resolveLinkPreviewSiteName, writeClipboardDataViaExecCommand, writeClipboardTextBestEffort, writeSessionStorageFlagBestEffort } from './post-runtime-safety.js';

/**
 * File attachment component - keeps single-click download on the main card while
 * exposing an explicit preview affordance for the v1 preview flow.
 */
function FileAttachment({ mediaId, onPreview }) {
    const [info, setInfo] = useState(null);

    useEffect(() => {
        getMediaInfo(mediaId).then(setInfo).catch((error) => {
            console.warn('[post] Failed to load attachment metadata for file card:', mediaId, error);
        });
    }, [mediaId]);

    if (!info) return null;

    const filename = info.filename || 'file';
    const size = info.metadata?.size;
    const sizeStr = size ? formatFileSize(size) : '';
    const previewKind = getAttachmentPreviewKind(info.content_type, info.filename);
    const previewLabel = previewKind === 'unsupported' ? 'Details' : 'Preview';

    return html`
        <div class="file-attachment" onClick=${(e) => e.stopPropagation()}>
            <a href=${getMediaUrl(mediaId)} download=${filename} class="file-attachment-main">
                <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                </svg>
                <div class="file-info">
                    <span class="file-name">${filename}</span>
                    <span class="file-meta-row">
                        ${sizeStr && html`<span class="file-size">${sizeStr}</span>`}
                        ${info.content_type && html`<span class="file-size">${info.content_type}</span>`}
                    </span>
                </div>
                <svg class="download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </a>
            <button
                class="file-attachment-preview"
                type="button"
                onClick=${(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPreview?.({ mediaId, info });
                }}
            >
                ${previewLabel}
            </button>
        </div>
    `;
}

export function extractRecoveryMarkerBlocks(contentBlocks) {
    if (!Array.isArray(contentBlocks)) return [];
    return contentBlocks.filter((block) => block && typeof block === 'object' && block.type === 'recovery_marker' && block.recovered);
}

export function extractTimeoutMarkerBlocks(contentBlocks) {
    if (!Array.isArray(contentBlocks)) return [];
    return contentBlocks.filter((block) => block && typeof block === 'object' && block.type === 'timeout_marker' && (block.timed_out ?? true));
}

export function extractOutcomeMarkerBlocks(contentBlocks) {
    if (!Array.isArray(contentBlocks)) return [];
    return contentBlocks.filter((block) => block && typeof block === 'object' && block.type === 'turn_outcome_marker');
}

const RECOVERY_CLASSIFIER_LABELS = {
    context_recover: 'context limit exceeded',
    rate_limit: 'rate limit hit',
    api_error: 'API error',
    timeout: 'request timeout',
    overloaded: 'service overloaded',
    connection: 'connection error',
};

export function formatRecoveryChipTooltip(marker) {
    const attempts = Number(marker?.attempts_used || 0);
    const classifier = String(marker?.classifier || '').trim();
    const reason = RECOVERY_CLASSIFIER_LABELS[classifier] || (classifier ? classifier.replace(/_/g, ' ') : '');
    const parts = ['Recovered automatically'];
    if (attempts > 1) parts[0] = `Recovered after ${attempts} attempts`;
    if (reason) parts.push(reason);
    return parts.join(' — ');
}

export function formatTimeoutChipTooltip(marker) {
    const action = typeof marker?.tool_action_summary === 'string' ? marker.tool_action_summary.trim() : '';
    const recoveredDraft = marker?.draft_recovered ? ' Showing recovered draft.' : '';
    return action
        ? `Turn timed out — ${action}${recoveredDraft}`
        : `Turn timed out before the model finished responding${recoveredDraft}`;
}

export function formatOutcomeChipTooltip(marker) {
    const title = typeof marker?.title === 'string' ? marker.title.trim() : '';
    const detail = typeof marker?.detail === 'string' ? marker.detail.trim() : '';
    const action = typeof marker?.tool_action_summary === 'string' ? marker.tool_action_summary.trim() : '';
    const recoveredDraft = marker?.draft_recovered ? ' Showing recovered draft.' : '';
    const parts = [title, detail];
    if (action) parts.push(`Last action: ${action}`);
    return parts.filter(Boolean).join(' — ') + recoveredDraft;
}

function OutcomePill({ marker }) {
    const [expanded, setExpanded] = useState(false);
    const toggle = useCallback((e) => { e.stopPropagation(); setExpanded(v => !v); }, []);

    const title = typeof marker?.title === 'string' ? marker.title.trim() : '';
    const detail = typeof marker?.detail === 'string' ? marker.detail.trim() : '';
    const action = typeof marker?.tool_action_summary === 'string' ? marker.tool_action_summary.trim() : '';
    const draftRecovered = marker?.draft_recovered;
    const severity = String(marker?.severity || 'warning');
    const label = action || title || String(marker?.label || marker?.kind || 'issue');

    const hasDetail = Boolean(detail || (title && action));

    return html`
        <div class=${`post-outcome-pill post-outcome-pill-${severity}`}>
            <div class="post-outcome-pill-header" onClick=${hasDetail ? toggle : undefined}>
                ${hasDetail && html`
                    <span class=${`post-outcome-pill-toggle${expanded ? ' expanded' : ''}`} aria-hidden="true">▶</span>
                `}
                <span class="post-outcome-pill-label">${label}</span>
                ${draftRecovered && html`<span class="post-outcome-pill-badge">draft recovered</span>`}
            </div>
            ${expanded && hasDetail && html`
                <div class="post-outcome-pill-detail">
                    ${title && html`<div><strong>${title}</strong></div>`}
                    ${detail && detail !== title && html`<div>${detail}</div>`}
                </div>
            `}
        </div>
    `;
}

function AttachmentPill({ attachment, onPreview }) {
    const mediaId = Number(attachment?.id);
    const [info, setInfo] = useState(null);

    useEffect(() => {
        if (!Number.isFinite(mediaId)) return undefined;
        getMediaInfo(mediaId).then(setInfo).catch((error) => {
            console.warn('[post] Failed to load attachment metadata for attachment pill:', mediaId, error);
        });
        return undefined;
    }, [mediaId]);

    const filename = info?.filename || attachment.label || `attachment-${attachment.id}`;
    const downloadHref = Number.isFinite(mediaId) ? getMediaUrl(mediaId) : null;
    const previewKind = getAttachmentPreviewKind(info?.content_type, info?.filename || attachment?.label);
    const previewLabel = previewKind === 'unsupported' ? 'Details' : 'Preview';

    return html`
        <span class="attachment-pill" title=${filename}>
            ${downloadHref
                ? html`
                    <a href=${downloadHref} download=${filename} class="attachment-pill-main" onClick=${(e) => e.stopPropagation()}>
                        <${FilePill}
                            prefix="post"
                            label=${attachment.label}
                            title=${filename}
                        />
                    </a>
                `
                : html`
                    <${FilePill}
                        prefix="post"
                        label=${attachment.label}
                        title=${filename}
                    />
                `}
            ${Number.isFinite(mediaId) && info && html`
                <button
                    class="attachment-pill-preview"
                    type="button"
                    title=${previewLabel}
                    onClick=${(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onPreview?.({ mediaId, info });
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>
            `}
        </span>
    `;
}

/**
 * Render annotations (audience/priority/lastModified)
 */
function AnnotationsBadge({ annotations }) {
    if (!annotations) return null;
    const { audience, priority, lastModified } = annotations;
    const formattedLastModified = lastModified ? formatTimestamp(lastModified) : null;
    return html`
        <div class="content-annotations">
            ${audience && audience.length > 0 && html`
                <span class="content-annotation">Audience: ${audience.join(', ')}</span>
            `}
            ${typeof priority === 'number' && html`
                <span class="content-annotation">Priority: ${priority}</span>
            `}
            ${formattedLastModified && html`
                <span class="content-annotation">Updated: ${formattedLastModified}</span>
            `}
        </div>
    `;
}

/**
 * Resource link block (MCP/ACP)
 */
function ResourceLinkBlock({ block }) {
    const name = block.title || block.name || block.uri;
    const description = block.description;
    const sizeStr = block.size ? formatFileSize(block.size) : '';
    const mimeType = block.mime_type || '';
    const icon = getMimeIcon(mimeType);
    const safeUrl = sanitizeUrl(block.uri);
    return html`
        <a
            href=${safeUrl || '#'}
            class="resource-link"
            target=${safeUrl ? "_blank" : undefined}
            rel=${safeUrl ? "noopener noreferrer" : undefined}
            onClick=${(e) => e.stopPropagation()}>
            <div class="resource-link-main">
                <div class="resource-link-header">
                    <span class="resource-link-icon-inline">${icon}</span>
                    <div class="resource-link-title">${name}</div>
                </div>
                ${description && html`<div class="resource-link-description">${description}</div>`}
                <div class="resource-link-meta">
                    ${mimeType && html`<span>${mimeType}</span>`}
                    ${sizeStr && html`<span>${sizeStr}</span>`}
                </div>
            </div>
            <div class="resource-link-icon">↗</div>
        </a>
    `;
}

/**
 * Embedded resource block (MCP/ACP)
 */
function ResourceBlock({ block }) {
    const [open, setOpen] = useState(false);
    const title = block.uri || 'Embedded resource';
    const contentText = block.text || '';
    const hasBlob = Boolean(block.data);
    const mimeType = block.mime_type || '';
    return html`
        <div class="resource-embed">
            <button class="resource-embed-toggle" onClick=${(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}>
                ${open ? '▼' : '▶'} ${title}
            </button>
            ${open && html`
                ${contentText && html`<pre class="resource-embed-content">${contentText}</pre>`}
                ${hasBlob && html`
                    <div class="resource-embed-blob">
                        <span class="resource-embed-blob-label">Embedded blob</span>
                        ${mimeType && html`<span class="resource-embed-blob-meta">${mimeType}</span>`}
                        <button class="resource-embed-blob-btn" onClick=${(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const blob = new Blob([Uint8Array.from(atob(block.data), c => c.charCodeAt(0))], { type: mimeType || 'application/octet-stream' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = title.split('/').pop() || 'resource';
                            a.click();
                            URL.revokeObjectURL(url);
                        }}>Download</button>
                    </div>
                `}
            `}
        </div>
    `;
}

function GeneratedWidgetLaunch({ block, post, onOpenWidget }) {
    if (!block) return null;

    const payload = buildGeneratedWidgetPayload(block, post);
    const supportsRender = canRenderGeneratedWidget(block);
    const kind = payload?.artifact?.kind || block?.artifact?.kind || block?.kind || null;
    const title = payload?.title || block.title || block.name || 'Generated widget';
    const description = payload?.description || block.description || block.subtitle || '';
    const openLabel = block.open_label || 'Open widget';
    const autoOpened = useRef(false);
    const launchWidget = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (!payload) return;
        onOpenWidget?.(payload);
    };

    useEffect(() => {
        if (!block?.auto_open || !payload || !supportsRender || autoOpened.current) return;
        // Only auto-open for messages posted in the last 10 seconds to avoid
        // re-opening stale widgets on page refresh or timeline scroll.
        const postTime = post?.timestamp ? new Date(post.timestamp).getTime() : 0;
        if (postTime && (Date.now() - postTime) > 10_000) return;
        // Prevent re-open across page refreshes using sessionStorage
        const key = `widget_opened_${block.widget_id || post?.id || ''}`;
        if (readSessionStorageFlagBestEffort(sessionStorage, key)) return;
        autoOpened.current = true;
        writeSessionStorageFlagBestEffort(sessionStorage, key, '1');
        onOpenWidget?.(payload);
    }, [block?.auto_open, payload, supportsRender]);

    return html`
        <div class="generated-widget-launch" onClick=${(e) => e.stopPropagation()}>
            <div class="generated-widget-launch-header">
                <div class="generated-widget-launch-eyebrow">Generated widget${kind ? ` • ${String(kind).toUpperCase()}` : ''}</div>
                <div class="generated-widget-launch-title">${title}</div>
            </div>
            ${description && html`<div class="generated-widget-launch-description">${description}</div>`}
            <div class="generated-widget-launch-actions">
                <button
                    class="generated-widget-launch-btn"
                    type="button"
                    disabled=${!supportsRender}
                    onClick=${launchWidget}
                    title=${supportsRender ? 'Open widget in a floating pane' : 'Unsupported widget artifact'}
                >
                    ${openLabel}
                </button>
                <span class="generated-widget-launch-note">
                    ${supportsRender
                        ? 'Opens in a dismissible floating pane.'
                        : 'This widget artifact is missing or unsupported.'}
                </span>
            </div>
        </div>
    `;
}

function getMimeIcon(mimeType) {
    if (!mimeType) return '📎';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('zip') || mimeType.includes('gzip')) return '🗜️';
    if (mimeType.startsWith('text/')) return '📄';
    return '📎';
}

/**
 * Link preview component - card with image background
 */
export function buildLinkPreviewBackgroundStyle(imageUrl) {
    const safeImage = sanitizeUrl(imageUrl, { allowDataImage: true });
    return safeImage
        ? { backgroundImage: `url("${safeImage}")` }
        : undefined;
}

function LinkPreview({ preview }) {
    const safeUrl = sanitizeUrl(preview.url);
    const bgStyle = buildLinkPreviewBackgroundStyle(preview.image);
    const siteName = resolveLinkPreviewSiteName(preview.site_name, safeUrl);

    return html`
        <a
            href=${safeUrl || '#'}
            class="link-preview ${bgStyle ? 'has-image' : ''}"
            target=${safeUrl ? "_blank" : undefined}
            rel=${safeUrl ? "noopener noreferrer" : undefined}
            onClick=${(e) => e.stopPropagation()}
            style=${bgStyle}>
            <div class="link-preview-overlay">
                <div class="link-preview-site">${siteName || ''}</div>
                <div class="link-preview-title">${preview.title}</div>
                ${preview.description && html`
                    <div class="link-preview-description">${preview.description}</div>
                `}
            </div>
        </a>
    `;
}

/**
 * Preserve message text exactly as-authored, even when link previews exist.
 *
 * Regression note: we intentionally do not strip URLs from content when a
 * preview card is shown. Users expect their original text to remain visible.
 */
export function getDisplayContent(content, _linkPreviews) {
    return typeof content === 'string' ? content : '';
}

const CODE_COPY_RESET_MS = 1800;
const COPY_ICON_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="9" y="9" width="10" height="10" rx="2"></rect>
        <path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path>
    </svg>`;
const COPY_SUCCESS_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 6L9 17l-5-5"></path>
    </svg>`;
const COPY_ERROR_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9"></circle>
        <path d="M9 9l6 6M15 9l-6 6"></path>
    </svg>`;
const CLIPBOARD_STYLE = `
<style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #1a1a1a;
  }
  h1 { font-size: 1.6em; font-weight: 700; margin: 0.6em 0 0.4em; }
  h2 { font-size: 1.35em; font-weight: 700; margin: 0.6em 0 0.4em; }
  h3 { font-size: 1.15em; font-weight: 700; margin: 0.5em 0 0.3em; }
  h4, h5, h6 { font-size: 1em; font-weight: 700; margin: 0.5em 0 0.3em; }
  p { margin: 0.5em 0; }
  pre {
    background: #f6f8fa;
    border: 1px solid #d0d7de;
    border-radius: 6px;
    padding: 12px 16px;
    overflow-x: auto;
    margin: 0.5em 0;
  }
  code {
    font-family: "Fira Code", "Cascadia Code", Consolas, "Courier New", monospace;
    font-size: 0.9em;
  }
  pre code { background: none; padding: 0; border: none; }
  :not(pre) > code { background: #f0f2f5; padding: 2px 5px; border-radius: 3px; }
  blockquote { border-left: 3px solid #d0d7de; margin: 0.5em 0; padding-left: 12px; color: #57606a; }
  table { border-collapse: collapse; margin: 0.5em 0; }
  th, td { border: 1px solid #d0d7de; padding: 6px 12px; text-align: left; }
  th { background: #f6f8fa; font-weight: 600; }
  ul, ol { margin: 0.4em 0; padding-left: 1.8em; }
  li { margin: 0.15em 0; }
  a { color: #0969da; text-decoration: none; }
  hr { border: none; border-top: 1px solid #d0d7de; margin: 1em 0; }
  img { max-width: 100%; }
</style>`;

async function copyTextToClipboard(text) {
    const value = typeof text === 'string' ? text : '';
    if (!value) return false;

    if (writeClipboardDataViaExecCommand(document, { text: value })) {
        return true;
    }

    if (await writeClipboardTextBestEffort(navigator.clipboard, value)) {
        return true;
    }

    try {
        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copied = document.execCommand('copy');
        document.body.removeChild(textarea);
        return copied;
    } catch {
        return false;
    }
}

async function copyMessageToClipboard(markdown) {
    const value = typeof markdown === 'string' ? markdown : '';
    if (!value) return false;

    const bodyHtml = renderMarkdown(value, null);
    const htmlDoc = `<html><head>${CLIPBOARD_STYLE}</head><body>${bodyHtml}</body></html>`;

    if (writeClipboardDataViaExecCommand(document, { text: value, html: htmlDoc })) {
        return true;
    }

    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        try {
            const item = new ClipboardItem({
                'text/plain': new Blob([value], { type: 'text/plain' }),
                'text/html': new Blob([htmlDoc], { type: 'text/html' }),
            });
            await navigator.clipboard.write([item]);
            return true;
        } catch (error) {
            console.warn('[post] Rich clipboard write failed, falling back to plain text copy.', error);
        }
    }

    return copyTextToClipboard(value);
}

function enhanceCodeBlocks(container) {
    if (!container) return () => {};

    const blocks = Array.from(container.querySelectorAll('pre')).filter((pre) => pre.querySelector('code'));
    if (blocks.length === 0) return () => {};

    const resetTimers = new Map();
    const cleanups = [];

    const handleDocumentCopy = (event) => {
        const selection = window.getSelection?.();
        if (!selection || selection.isCollapsed) return;
        for (const pre of blocks) {
            if (copyPlainTextSelectionFromElement(event, { root: pre, selection })) {
                return;
            }
        }
    };

    document.addEventListener('copy', handleDocumentCopy, true);
    cleanups.push(() => document.removeEventListener('copy', handleDocumentCopy, true));

    const setButtonState = (button, state) => {
        const nextState = state || 'idle';
        button.dataset.copyState = nextState;
        if (nextState === 'success') {
            button.innerHTML = COPY_SUCCESS_SVG;
            button.setAttribute('aria-label', 'Copied');
            button.setAttribute('title', 'Copied');
            button.classList.add('is-success');
            button.classList.remove('is-error');
        } else if (nextState === 'error') {
            button.innerHTML = COPY_ERROR_SVG;
            button.setAttribute('aria-label', 'Copy failed');
            button.setAttribute('title', 'Copy failed');
            button.classList.add('is-error');
            button.classList.remove('is-success');
        } else {
            button.innerHTML = COPY_ICON_SVG;
            button.setAttribute('aria-label', 'Copy code');
            button.setAttribute('title', 'Copy code');
            button.classList.remove('is-success', 'is-error');
        }
    };

    blocks.forEach((pre) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'post-code-block';
        pre.parentNode?.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'post-code-copy-btn';
        setButtonState(button, 'idle');
        wrapper.appendChild(button);

        const handleCopyClick = async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const code = pre.querySelector('code');
            const text = code?.textContent || '';
            const ok = await copyTextToClipboard(text);
            setButtonState(button, ok ? 'success' : 'error');
            const existingTimer = resetTimers.get(button);
            if (existingTimer) clearTimeout(existingTimer);
            const timer = setTimeout(() => {
                setButtonState(button, 'idle');
                resetTimers.delete(button);
            }, CODE_COPY_RESET_MS);
            resetTimers.set(button, timer);
        };

        button.addEventListener('click', handleCopyClick);
        cleanups.push(() => {
            button.removeEventListener('click', handleCopyClick);
            const timer = resetTimers.get(button);
            if (timer) clearTimeout(timer);
            if (wrapper.parentNode) {
                wrapper.parentNode.insertBefore(pre, wrapper);
                wrapper.remove();
            }
        });
    });

    return () => {
        cleanups.forEach((cleanup) => cleanup());
    };
}

function extractFileRefs(content) {
    if (!content) return { content, fileRefs: [] };
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].trim() === 'Files:' && lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
            start = i;
            break;
        }
    }
    if (start === -1) return { content, fileRefs: [] };
    const refs = [];
    let end = start + 1;
    for (; end < lines.length; end += 1) {
        const line = lines[end];
        if (/^\s*-\s+/.test(line)) {
            refs.push(line.replace(/^\s*-\s+/, '').trim());
        } else if (!line.trim()) {
            break;
        } else {
            break;
        }
    }
    if (refs.length === 0) return { content, fileRefs: [] };
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    let cleaned = [...before, ...after].join('\n');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return { content: cleaned, fileRefs: refs };
}

function extractMessageRefs(content) {
    if (!content) return { content, messageRefs: [] };
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].trim() === 'Referenced messages:' && lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
            start = i;
            break;
        }
    }
    if (start === -1) return { content, messageRefs: [] };
    const refs = [];
    let end = start + 1;
    for (; end < lines.length; end += 1) {
        const line = lines[end];
        if (/^\s*-\s+/.test(line)) {
            const val = line.replace(/^\s*-\s+/, '').trim();
            const match = val.match(/^message:(\S+)$/i);
            if (match) refs.push(match[1]);
        } else if (!line.trim()) {
            break;
        } else {
            break;
        }
    }
    if (refs.length === 0) return { content, messageRefs: [] };
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    let cleaned = [...before, ...after].join('\n');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return { content: cleaned, messageRefs: refs };
}

function extractAttachmentRefs(content) {
    if (!content) return { content, attachments: [] };
    const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i += 1) {
        const header = lines[i].trim();
        if ((header === 'Images:' || header === 'Attachments:') && lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
            start = i;
            break;
        }
    }
    if (start === -1) return { content, attachments: [] };
    const refs = [];
    let end = start + 1;
    for (; end < lines.length; end += 1) {
        const line = lines[end];
        if (/^\s*-\s+/.test(line)) {
            const raw = line.replace(/^\s*-\s+/, '').trim();
            const match = raw.match(/^attachment:([^\s)]+)\s*(?:\((.+)\))?$/i) ||
                raw.match(/^attachment:([^\s]+)\s+(.+)$/i);
            if (match) {
                const id = match[1];
                const label = (match[2] || '').trim() || id;
                refs.push({ id, label, raw });
            } else {
                refs.push({ id: null, label: raw, raw });
            }
        } else if (!line.trim()) {
            break;
        } else {
            break;
        }
    }
    if (refs.length === 0) return { content, attachments: [] };
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    let cleaned = [...before, ...after].join('\n');
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return { content: cleaned, attachments: refs };
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightHtml(html, query) {
    if (!html || !query) return html;
    const terms = String(query)
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (terms.length === 0) return html;

    const escapedTerms = terms
        .map(escapeRegex)
        .sort((a, b) => b.length - a.length);
    const pattern = new RegExp(`(${escapedTerms.join('|')})`, 'gi');
    const matcher = new RegExp(`^(${escapedTerms.join('|')})$`, 'i');

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) nodes.push(node);

    for (const textNode of nodes) {
        const value = textNode.nodeValue;
        if (!value || !pattern.test(value)) {
            pattern.lastIndex = 0;
            continue;
        }
        pattern.lastIndex = 0;
        const parent = textNode.parentElement;
        if (parent && parent.closest('code, pre, script, style')) continue;

        const parts = value.split(pattern).filter((part) => part !== '');
        if (parts.length === 0) continue;
        const frag = doc.createDocumentFragment();
        for (const part of parts) {
            if (matcher.test(part)) {
                const mark = doc.createElement('mark');
                mark.className = 'search-highlight-term';
                mark.textContent = part;
                frag.appendChild(mark);
            } else {
                frag.appendChild(doc.createTextNode(part));
            }
        }
        textNode.parentNode.replaceChild(frag, textNode);
    }

    return doc.body.innerHTML;
}

/**
 * Single post component
 */
export function Post({ post, onClick, onHashtagClick, onMessageRef, onScrollToMessage, agentName, agentAvatarUrl, userName, userAvatarUrl, userAvatarBackground, onDelete, isThreadReply, isThreadPrev, isThreadNext, isRemoving, highlightQuery, onFileRef, onOpenWidget, onOpenAttachmentPreview }) {
    const [zoomedImage, setZoomedImage] = useState(null);
    const [copyState, setCopyState] = useState('idle');
    const contentRef = useRef(null);
    const copyResetTimerRef = useRef(null);

    const data = post.data;
    const isAgent = data.type === 'agent_response';
    const resolvedUserName = userName || 'You';
    const displayName = isAgent ? (agentName || DEFAULT_AGENT_NAME) : resolvedUserName;
    const searchChatAgentName = typeof post.chat_agent_name === 'string' ? post.chat_agent_name.trim() : '';
    const showSearchChatAgentTag = Boolean(isAgent && highlightQuery && searchChatAgentName && searchChatAgentName !== displayName);

    // Get avatar info based on the name
    const avatarInfo = isAgent
        ? getAvatarInfo(agentName, agentAvatarUrl, true)
        : getAvatarInfo(resolvedUserName, userAvatarUrl);
    const normalizedUserBackground = typeof userAvatarBackground === 'string'
        ? userAvatarBackground.trim().toLowerCase()
        : '';
    const clearUserBackground = !isAgent && avatarInfo.image
        && (normalizedUserBackground === 'clear' || normalizedUserBackground === 'transparent');
    // Keep agent avatars with transparent background when an image is set,
    // matching user avatar behavior when background is cleared.
    const clearAgentBackground = isAgent && Boolean(avatarInfo.image);
    const avatarStyle = `background-color: ${(clearUserBackground || clearAgentBackground) ? 'transparent' : avatarInfo.color}`;

    const contentMeta = data.content_meta;
    const isTruncated = Boolean(contentMeta?.truncated);
    const isPreview = Boolean(contentMeta?.preview);
    const isHardTruncated = isTruncated && !isPreview;
    const truncatedInfo = isTruncated
        ? {
            originalLength: Number.isFinite(contentMeta?.original_length)
                ? contentMeta.original_length
                : (data.content ? data.content.length : 0),
            maxLength: Number.isFinite(contentMeta?.max_length) ? contentMeta.max_length : 0,
        }
        : null;

    const blocks = data.content_blocks || [];
    const mediaIds = data.media_ids || [];

    // Keep original message text even when link previews are available.
    let displayContent = getDisplayContent(data.content, data.link_previews);
    const { content: cleanedContent, fileRefs } = extractFileRefs(displayContent);
    const { content: cleanedWithMsgRefs, messageRefs } = extractMessageRefs(cleanedContent);
    const { content: cleanedWithAttachments, attachments } = extractAttachmentRefs(cleanedWithMsgRefs);
    displayContent = cleanedWithAttachments;
    const directCardBlocks = extractCardBlocks(blocks);
    const submissionBlocks = extractAdaptiveCardSubmissionBlocks(blocks);
    const recoveryMarkerBlocks = extractRecoveryMarkerBlocks(blocks);
    const recoveryMarker = recoveryMarkerBlocks[0] || null;
    const timeoutMarkerBlocks = extractTimeoutMarkerBlocks(blocks);
    const timeoutMarker = timeoutMarkerBlocks[0] || null;
    const outcomeMarkerBlocks = extractOutcomeMarkerBlocks(blocks);
    const outcomeMarker = outcomeMarkerBlocks[0] || null;
    const singleCardFallback = directCardBlocks.length === 1 && typeof directCardBlocks[0]?.fallback_text === 'string'
        ? directCardBlocks[0].fallback_text.trim()
        : '';
    const singleSubmissionFallback = submissionBlocks.length === 1
        ? buildAdaptiveCardSubmissionFallbackText(submissionBlocks[0]).trim()
        : '';
    const hideRenderedFallback = (
        Boolean(singleCardFallback) && displayContent?.trim() === singleCardFallback
    ) || (
        Boolean(singleSubmissionFallback) && displayContent?.trim() === singleSubmissionFallback
    );
    const shouldRenderContent = Boolean(displayContent) && !isHardTruncated && !hideRenderedFallback;
    const highlightQueryText = typeof highlightQuery === 'string' ? highlightQuery.trim() : '';
    const renderedHtml = useMemo(() => {
        if (!displayContent || hideRenderedFallback) return '';
        const baseHtml = renderMarkdown(displayContent, onHashtagClick);
        return highlightQueryText ? highlightHtml(baseHtml, highlightQueryText) : baseHtml;
    }, [displayContent, hideRenderedFallback, highlightQueryText]);

    const markdownCopyPayload = useMemo(() => buildPostMarkdownCopyPayload(post), [post]);

    const handleImageClick = (e, mediaId) => {
        e.stopPropagation();
        setZoomedImage(getMediaUrl(mediaId));
    };

    const handleAttachmentPreview = (attachment) => {
        onOpenAttachmentPreview?.(attachment);
    };

    const handleDeleteClick = (e) => {
        e.stopPropagation();
        onDelete?.(post);
    };

    const handleCopyMarkdownClick = async (e) => {
        e.stopPropagation();
        const ok = await copyMessageToClipboard(markdownCopyPayload);
        setCopyState(ok ? 'success' : 'error');
        if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
        copyResetTimerRef.current = setTimeout(() => {
            copyResetTimerRef.current = null;
            setCopyState('idle');
        }, CODE_COPY_RESET_MS);
    };

    const resolveInlineAttachments = (content, attachments) => {
        const usedIds = new Set();
        if (!content || attachments.length === 0) {
            return { content, usedIds };
        }

        const replaced = content.replace(/attachment:([^\s)"']+)/g, (match, rawRef, offset, source) => {
            const ref = rawRef.replace(/^\/+/, '');
            const byName = attachments.find(
                (entry) => entry.name && entry.name.toLowerCase() === ref.toLowerCase() && !usedIds.has(entry.id)
            );
            const entry = byName || attachments.find((item) => !usedIds.has(item.id));
            if (!entry) return match;
            usedIds.add(entry.id);
            const prefix = source.slice(Math.max(0, offset - 2), offset);
            if (prefix === '](') {
                return `/media/${entry.id}`;
            }
            return entry.name || 'attachment';
        });

        return { content: replaced, usedIds };
    };

    // Separate images from files using content_blocks info
    const imageItems: Array<{ id: number; annotations?: unknown; mimeType?: string }> = [];
    const fileIds = [];
    const attachmentEntries = [];
    const resourceLinks = [];
    const resources = [];
    const generatedWidgets = [];
    const textAnnotations = [];
    let mediaIndex = 0;

    if (blocks.length > 0) {
        blocks.forEach((block) => {
            if (block?.type === 'text' && block.annotations) {
                textAnnotations.push(block.annotations);
            }
            if (block?.type === 'generated_widget') {
                generatedWidgets.push(block);
            } else if (block?.type === 'resource_link') {
                resourceLinks.push(block);
            } else if (block?.type === 'resource') {
                resources.push(block);
            } else if (block?.type === 'file') {
                const id = mediaIds[mediaIndex++];
                if (id) {
                    fileIds.push(id);
                    attachmentEntries.push({ id, name: block?.name || block?.filename || block?.title });
                }
            } else if (block?.type === 'image' || !block?.type) {
                const id = mediaIds[mediaIndex++];
                if (id) {
                    const mimeType =
                        typeof block?.mime_type === 'string' ? block.mime_type : undefined;
                    imageItems.push({ id, annotations: block?.annotations, mimeType });
                    attachmentEntries.push({ id, name: block?.name || block?.filename || block?.title });
                }
            }
        });
    } else if (mediaIds.length > 0) {
        const treatAsFiles = attachments.length > 0;
        mediaIds.forEach((id, index) => {
            const ref = attachments[index] || null;
            attachmentEntries.push({ id, name: ref?.label || null });
            if (treatAsFiles) {
                fileIds.push(id);
            } else {
                imageItems.push({ id, annotations: null });
            }
        });
    }

    if (attachments.length > 0) {
        attachments.forEach((ref) => {
            if (!ref?.id) return;
            const match = attachmentEntries.find((entry) => String(entry.id) === String(ref.id));
            if (match && !match.name) {
                match.name = ref.label;
            }
        });
    }

    const { content: resolvedContent, usedIds } = resolveInlineAttachments(displayContent, attachmentEntries);
    displayContent = resolvedContent;
    const filteredImageItems = imageItems.filter(({ id }) => !usedIds.has(id));
    const filteredFileIds = fileIds.filter((id) => !usedIds.has(id));

    const attachmentPills = attachments.length > 0
        ? attachments.map((ref, idx) => ({
            id: ref.id || `attachment-${idx + 1}`,
            label: ref.label || `attachment-${idx + 1}`,
        }))
        : attachmentEntries.map((entry, idx) => ({
            id: entry.id,
            label: entry.name || `attachment-${idx + 1}`,
        }));

    // Extract adaptive card blocks from content_blocks
    const cardBlocks = useMemo(() => extractCardBlocks(blocks), [blocks]);
    const cardSubmissionBlocks = useMemo(() => extractAdaptiveCardSubmissionBlocks(blocks), [blocks]);

    // Stable identity key for card blocks so the render effect only fires when
    // a card's identity or lifecycle state actually changes — not on every
    // parent re-render caused by unrelated SSE events.  This prevents the
    // card DOM (and all user input state) from being torn down and rebuilt
    // while the user is filling in a form.
    const cardBlocksKey = useMemo(() => {
        return cardBlocks.map((b) => `${b.card_id}:${b.state}`).join('|');
    }, [cardBlocks]);

    // Render mermaid diagrams and enhance code blocks after content is mounted
    useEffect(() => {
        if (!contentRef.current) return undefined;
        renderMermaidDiagrams(contentRef.current);
        return enhanceCodeBlocks(contentRef.current);
    }, [renderedHtml]);

    useEffect(() => () => {
        if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
    }, []);

    // Render adaptive cards into their containers.
    // The effect depends on cardBlocksKey (card_id + state) rather than the
    // full cardBlocks array, so unrelated parent re-renders won't destroy
    // the card DOM and reset user inputs.
    const cardContainerRef = useRef(null);
    useEffect(() => {
        if (!cardContainerRef.current || cardBlocks.length === 0) return;
        const container = cardContainerRef.current;
        container.innerHTML = '';
        for (const block of cardBlocks) {
            const cardEl = document.createElement('div');
            container.appendChild(cardEl);
            renderAdaptiveCard(cardEl, block, {
                onAction: async (action) => {
                    if (action.type === 'Action.OpenUrl') {
                        const safeUrl = sanitizeUrl(action.url || '');
                        if (!safeUrl) throw new Error('Invalid URL');
                        window.open(safeUrl, '_blank', 'noopener,noreferrer');
                        return;
                    }

                    if (action.type === 'Action.Submit') {
                        await submitAdaptiveCardAction({
                            post_id: post.id,
                            thread_id: data.thread_id || post.id,
                            chat_jid: post.chat_jid || null,
                            card_id: block.card_id,
                            action: {
                                type: action.type,
                                title: action.title || '',
                                data: action.data,
                            },
                        });
                        return;
                    }

                    console.warn('[post] unsupported adaptive card action:', action.type, action);
                },
            }).catch((err) => {
                console.error('[post] adaptive card render error:', err);
                cardEl.textContent = block.fallback_text || 'Card failed to render.';
            });
        }
    }, [cardBlocksKey, post.id]);

    return html`
        <div id=${`post-${post.id}`} class="post ${isAgent ? 'agent-post' : ''} ${isThreadReply ? 'thread-reply' : ''} ${isThreadPrev ? 'thread-prev' : ''} ${isThreadNext ? 'thread-next' : ''} ${isRemoving ? 'removing' : ''}" onClick=${onClick}>
            <div class="post-avatar ${isAgent ? 'agent-avatar' : ''} ${avatarInfo.image ? 'has-image' : ''}" style=${avatarStyle}>
                ${avatarInfo.image ? html`<img src=${avatarInfo.image} alt=${displayName} />` : avatarInfo.letter}
            </div>
            <div class="post-body">
                <div class="post-actions">
                    <button
                        class=${`post-action-btn post-copy-btn${copyState === 'success' ? ' is-success' : copyState === 'error' ? ' is-error' : ''}`}
                        type="button"
                        title=${copyState === 'success' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy message'}
                        aria-label=${copyState === 'success' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy message'}
                        onClick=${handleCopyMarkdownClick}
                        disabled=${!markdownCopyPayload}
                    >
                        ${copyState === 'success'
                            ? html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 6L9 17l-5-5"></path></svg>`
                            : copyState === 'error'
                                ? html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M9 9l6 6M15 9l-6 6"></path></svg>`
                                : html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1"></path></svg>`}
                    </button>
                    <button
                        class="post-action-btn post-delete-btn"
                        type="button"
                        title="Delete message"
                        aria-label="Delete message"
                        onClick=${handleDeleteClick}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div class="post-meta">
                    <span class="post-author">${displayName}</span>
                    ${showSearchChatAgentTag && html`<span class="post-chat-agent-tag" title=${`Chat: ${searchChatAgentName}`}>@${searchChatAgentName}</span>`}
                    <a class="post-time" href=${`#msg-${post.id}`} onClick=${(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (onMessageRef) onMessageRef(post.id);
                    }}>${formatTime(post.timestamp)}</a>
                    ${recoveryMarker && html`
                        <span
                            class="post-recovery-chip"
                            title=${formatRecoveryChipTooltip(recoveryMarker)}
                        >
                            recovered
                        </span>
                    `}
                    ${timeoutMarker && html`
                        <span
                            class="post-recovery-chip post-timeout-chip"
                            title=${formatTimeoutChipTooltip(timeoutMarker)}
                        >
                            timeout
                        </span>
                    `}
                    ${outcomeMarker && html`
                        <span
                            class=${`post-recovery-chip post-outcome-chip post-outcome-chip-${String(outcomeMarker.severity || 'warning')}${outcomeMarker.kind === 'tool_budget' ? ' post-outcome-chip-tool-budget' : ''}`}
                            title=${String(outcomeMarker.label || outcomeMarker.kind || 'issue')}
                        >
                            ${String(outcomeMarker.label || outcomeMarker.kind || 'issue')}
                        </span>
                    `}
                </div>
                ${outcomeMarker && html`
                    <${OutcomePill} marker=${outcomeMarker} />
                `}
                ${isHardTruncated && truncatedInfo && html`
                    <div class="post-content truncated">
                        <div class="truncated-title">Message too large to display.</div>
                        <div class="truncated-meta">
                            Original length: ${formatCount(truncatedInfo.originalLength)} chars
                            ${truncatedInfo.maxLength ? html` • Display limit: ${formatCount(truncatedInfo.maxLength)} chars` : ''}
                        </div>
                    </div>
                `}
                ${isPreview && truncatedInfo && html`
                    <div class="post-content preview">
                        <div class="truncated-title">Preview truncated.</div>
                        <div class="truncated-meta">
                            Showing first ${formatCount(truncatedInfo.maxLength)} of ${formatCount(truncatedInfo.originalLength)} chars. Download full text below.
                        </div>
                    </div>
                `}
                ${(fileRefs.length > 0 || messageRefs.length > 0 || attachmentPills.length > 0) && html`
                    <div class="post-file-refs">
                        ${messageRefs.map((id) => {
                            const scrollToRef = (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (onScrollToMessage) {
                                    onScrollToMessage(id, post.chat_jid || null);
                                } else {
                                    const el = document.getElementById('post-' + id);
                                    if (el) {
                                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                        el.classList.add('post-highlight');
                                        setTimeout(() => el.classList.remove('post-highlight'), 2000);
                                    }
                                }
                            };
                            return html`
                                <a href=${`#msg-${id}`} class="post-msg-pill-link" onClick=${scrollToRef}>
                                    <${FilePill}
                                        prefix="post"
                                        label=${'msg:' + id}
                                        title=${'Message ' + id}
                                        icon="message"
                                        onClick=${scrollToRef}
                                    />
                                </a>
                            `;
                        })}
                        ${fileRefs.map((ref) => {
                            const label = ref.split('/').pop() || ref;
                            return html`
                                <${FilePill}
                                    prefix="post"
                                    label=${label}
                                    title=${ref}
                                    onClick=${() => onFileRef?.(ref)}
                                />
                            `;
                        })}
                        ${attachmentPills.map((attachment) => html`
                            <${AttachmentPill}
                                key=${attachment.id}
                                attachment=${attachment}
                                onPreview=${handleAttachmentPreview}
                            />
                        `)}
                    </div>
                `}
                ${shouldRenderContent && html`
                    <div 
                        ref=${contentRef}
                        class="post-content"
                        dangerouslySetInnerHTML=${{ __html: renderedHtml }}
                        onClick=${(e) => {
                            if (e.target.classList.contains('hashtag')) {
                                e.preventDefault();
                                e.stopPropagation();
                                const tag = e.target.dataset.hashtag;
                                if (tag) onHashtagClick?.(tag);
                            } else if (e.target.tagName === 'IMG') {
                                e.preventDefault();
                                e.stopPropagation();
                                setZoomedImage(e.target.src);
                            }
                        }}
                    />
                `}
                ${cardBlocks.length > 0 && html`
                    <div ref=${cardContainerRef} class="post-adaptive-cards" />
                `}
                ${cardSubmissionBlocks.length > 0 && html`
                    <div class="post-adaptive-card-submissions">
                        ${cardSubmissionBlocks.map((block, idx) => {
                            const meta = describeAdaptiveCardSubmission(block);
                            const submissionKey = `${block.card_id}-${idx}`;
                            return html`
                                <div key=${submissionKey} class="adaptive-card-submission-receipt">
                                    <div class="adaptive-card-submission-header">
                                        <span class="adaptive-card-submission-icon" aria-hidden="true">✓</span>
                                        <div class="adaptive-card-submission-title-wrap">
                                            <span class="adaptive-card-submission-title">Submitted</span>
                                            <span class="adaptive-card-submission-title-action">${meta.title}</span>
                                        </div>
                                    </div>
                                    ${meta.fields.length > 0 && html`
                                        <div class="adaptive-card-submission-fields">
                                            ${meta.fields.map((field) => html`
                                                <span class="adaptive-card-submission-field" title=${`${field.key}: ${field.value}`}>
                                                    <span class="adaptive-card-submission-field-key">${field.key}</span>
                                                    <span class="adaptive-card-submission-field-sep">:</span>
                                                    <span class="adaptive-card-submission-field-value">${field.value}</span>
                                                </span>
                                            `)}
                                        </div>
                                    `}
                                    <div class="adaptive-card-submission-meta">
                                        Submitted ${formatTimestamp(meta.submittedAt)}
                                    </div>
                                </div>
                            `;
                        })}
                    </div>
                `}
                ${generatedWidgets.length > 0 && html`
                    <div class="generated-widget-launches">
                        ${generatedWidgets.map((block, idx) => html`
                            <${GeneratedWidgetLaunch}
                                key=${block.widget_id || block.id || `${post.id}-widget-${idx}`}
                                block=${block}
                                post=${post}
                                onOpenWidget=${onOpenWidget}
                            />
                        `)}
                    </div>
                `}
                ${textAnnotations.length > 0 && html`
                    ${textAnnotations.map((annotations, idx) => html`
                        <${AnnotationsBadge} key=${idx} annotations=${annotations} />
                    `)}
                `}
                ${filteredImageItems.length > 0 && html`
                    <div class="media-preview">
                        ${filteredImageItems.map(({ id, mimeType }) => {
                            const isSvg = typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/svg');
                            const imageSrc = isSvg ? getMediaUrl(id) : getThumbnailUrl(id);
                            return html`
                                <img 
                                    key=${id} 
                                    src=${imageSrc} 
                                    alt="Media" 
                                    loading="lazy"
                                    decoding="async"
                                    onClick=${(e) => handleImageClick(e, id)}
                                />
                            `;
                        })}
                    </div>
                `}
                ${filteredImageItems.length > 0 && html`
                    ${filteredImageItems.map(({ annotations }, idx) => html`
                        ${annotations && html`<${AnnotationsBadge} key=${idx} annotations=${annotations} />`}
                    `)}
                `}
                ${filteredFileIds.length > 0 && html`
                    <div class="file-attachments">
                        ${filteredFileIds.map(id => html`
                            <${FileAttachment} key=${id} mediaId=${id} onPreview=${handleAttachmentPreview} />
                        `)}
                    </div>
                `}
                ${resourceLinks.length > 0 && html`
                    <div class="resource-links">
                        ${resourceLinks.map((block, idx) => html`
                            <div key=${idx}>
                                <${ResourceLinkBlock} block=${block} />
                                <${AnnotationsBadge} annotations=${block.annotations} />
                            </div>
                        `)}
                    </div>
                `}
                ${resources.length > 0 && html`
                    <div class="resource-embeds">
                        ${resources.map((block, idx) => html`
                            <div key=${idx}>
                                <${ResourceBlock} block=${block} />
                                <${AnnotationsBadge} annotations=${block.annotations} />
                            </div>
                        `)}
                    </div>
                `}
                ${data.link_previews?.length > 0 && html`
                    <div class="link-previews">
                        ${data.link_previews.map((preview, i) => html`
                            <${LinkPreview} key=${i} preview=${preview} />
                        `)}
                    </div>
                `}
            </div>
        </div>
        ${zoomedImage && html`<${ImageModal} src=${zoomedImage} onClose=${() => setZoomedImage(null)} />`}

    `;
}
