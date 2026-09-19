import { html, useEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { useTranslation } from '../utils/i18n.js';
import { BodyPortal } from './body-portal.js';
import { getMediaBlob, getMediaUrl } from '../api.js';
import { renderMarkdown, renderMermaidDiagrams } from '../markdown.js';
import { formatFileSize, formatTimestamp } from '../utils/format.js';
import { highlightCodeToHtml, normalizeCodeLanguageLabel, extensionToLanguage } from '../utils/code-highlighting.js';
import {
    buildAddonAttachmentPreviewFrameUrl,
    getAddonAttachmentPreviewNote,
    resolveAddonAttachmentPreview,
} from '../ui/addon-web-extensions.js';
import { getAttachmentPreviewKind, getAttachmentPreviewLabel, isMarkdownAttachmentPreview } from '../ui/attachment-preview.js';
import { inferDelimitedPreviewDelimiter, parseDelimitedPreview } from '../ui/delimited-preview.js';
import { formatCompressionRatio, getCompressionMethodLabel, parseZipPreview } from '../ui/zip-preview.js';

export const HTML_ATTACHMENT_PREVIEW_SANDBOX = 'allow-scripts';

export function buildAttachmentPreviewModalClassName(maximized = false) {
    return `image-modal attachment-preview-modal${maximized ? ' maximized' : ''}`;
}

function isProbablyTextBytes(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return true;
    let suspicious = 0;
    const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
    for (const byte of sample) {
        if (byte === 0) return false;
        const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 12;
        if (isControl) suspicious += 1;
    }
    return suspicious / sample.length < 0.02;
}

function shouldSniffTextAttachment(info, filename) {
    const normalizedType = String(info?.content_type || '').trim().toLowerCase();
    const normalizedName = String(filename || '').trim().toLowerCase();
    if (normalizedType.startsWith('text/') || normalizedType === 'application/json' || normalizedType === 'application/xml') {
        return false;
    }
    return normalizedType === 'application/octet-stream' || normalizedName.endsWith('.sb') || normalizedName.endsWith('.sh');
}

function decodeTextBytes(bytes) {
    try {
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
        return new TextDecoder().decode(bytes);
    }
}

function formatDelimitedDelimiter(delimiter) {
    if (delimiter === '\t') return 'Tab';
    if (delimiter === ',') return 'Comma';
    if (delimiter === ';') return 'Semicolon';
    if (delimiter === '|') return 'Pipe';
    return null;
}

function buildMetadata(info, languageLabel = null, archivePreview = null, delimitedPreview = null) {
    const size = info?.metadata?.size;
    const contentType = info?.content_type || 'application/octet-stream';
    const archiveSummary = archivePreview?.summary || null;
    return [
        { label: 'Type', value: contentType },
        { label: 'Syntax', value: languageLabel },
        { label: 'Delimiter', value: delimitedPreview ? formatDelimitedDelimiter(delimitedPreview.delimiter) : null },
        { label: 'Rows', value: delimitedPreview ? `${delimitedPreview.rowCount}${delimitedPreview.truncatedRows ? '+' : ''}` : null },
        { label: 'Columns', value: delimitedPreview ? `${delimitedPreview.columnCount}${delimitedPreview.truncatedColumns ? '+' : ''}` : null },
        { label: 'Entries', value: archiveSummary ? String(archiveSummary.totalEntries) : null },
        { label: 'Files', value: archiveSummary ? String(archiveSummary.fileCount) : null },
        { label: 'Folders', value: archiveSummary ? String(archiveSummary.directoryCount) : null },
        { label: 'Compressed', value: archiveSummary ? formatFileSize(archiveSummary.compressedBytes) : null },
        { label: 'Uncompressed', value: archiveSummary ? formatFileSize(archiveSummary.uncompressedBytes) : null },
        { label: 'Savings', value: formatCompressionRatio(archiveSummary) },
        { label: 'Size', value: typeof size === 'number' ? formatFileSize(size) : null },
        { label: 'Added', value: info?.created_at ? formatTimestamp(info.created_at) : null },
    ].filter((entry) => entry.value);
}

function previewLanguageFromAttachment(info, filename) {
    // Delegate to the shared extensionToLanguage utility from code-highlighting.ts
    // which covers ~90 file extensions.
    const name = String(filename || '').trim();
    if (name) {
        const lang = extensionToLanguage(name);
        if (lang) return lang;
    }
    // Fallback: check content_type for text types we know
    const ct = String(info?.content_type || '').trim().toLowerCase();
    if (ct === 'application/json') return 'json';
    if (ct === 'text/yaml' || ct === 'application/yaml' || ct === 'text/x-yaml') return 'yaml';
    if (ct === 'application/xml' || ct === 'text/xml') return 'xml';
    if (ct === 'text/html') return 'html';
    if (ct === 'text/css') return 'css';
    if (ct === 'text/javascript' || ct === 'application/javascript') return 'javascript';
    if (ct === 'text/x-python' || ct === 'application/x-python-code') return 'python';
    return null;
}

function buildFrameUrl(mediaId, filename, previewKind) {
    const safeName = encodeURIComponent(filename || `attachment-${mediaId}`);
    const safeMediaId = encodeURIComponent(String(mediaId));

    if (previewKind === 'pdf') {
        return `/pdf-viewer/?media=${safeMediaId}&name=${safeName}#media=${safeMediaId}&name=${safeName}`;
    }

    if (previewKind === 'office') {
        const mediaUrl = getMediaUrl(mediaId);
        return `/office-viewer/?url=${encodeURIComponent(mediaUrl)}&name=${safeName}`;
    }

    if (previewKind === 'eml') {
        return `/eml-viewer/?media=${safeMediaId}&name=${safeName}`;
    }

    return null;
}

export function AttachmentPreviewModal({ mediaId, info, onClose }) {
    const { t } = useTranslation();
    const filename = info?.filename || `attachment-${mediaId}`;
    const addonPreview = useMemo(() => resolveAddonAttachmentPreview(info?.content_type, filename), [info?.content_type, filename]);
    const previewKind = useMemo(() => getAttachmentPreviewKind(info?.content_type, filename), [info?.content_type, filename]);
    const previewLabel = addonPreview?.label || getAttachmentPreviewLabel(previewKind);
    const isMarkdown = useMemo(() => isMarkdownAttachmentPreview(info?.content_type), [info?.content_type]);
    const [loading, setLoading] = useState(previewKind === 'text' || previewKind === 'html' || previewKind === 'archive' || previewKind === 'delimited');
    const [textContent, setTextContent] = useState('');
    const [archivePreview, setArchivePreview] = useState(null);
    const [delimitedPreview, setDelimitedPreview] = useState(null);
    const [error, setError] = useState(null);
    const [maximized, setMaximized] = useState(false);
    const markdownContainerRef = useRef(null);
    const previewLanguage = useMemo(() => previewLanguageFromAttachment(info, filename), [info, filename]);
    const previewLanguageLabel = useMemo(() => previewLanguage ? normalizeCodeLanguageLabel(previewLanguage) : null, [previewLanguage]);
    const metadata = useMemo(() => buildMetadata(info, !isMarkdown ? previewLanguageLabel : null, archivePreview, delimitedPreview), [info, isMarkdown, previewLanguageLabel, archivePreview, delimitedPreview]);
    const frameUrl = useMemo(() => addonPreview
        ? buildAddonAttachmentPreviewFrameUrl(addonPreview.id, mediaId, filename)
        : buildFrameUrl(mediaId, filename, previewKind), [addonPreview, mediaId, filename, previewKind]);
    const addonPreviewNote = useMemo(() => getAddonAttachmentPreviewNote(addonPreview?.id || previewKind), [addonPreview?.id, previewKind]);
    const renderedMarkdown = useMemo(() => {
        if (!isMarkdown || !textContent) return '';
        return renderMarkdown(textContent);
    }, [isMarkdown, textContent]);
    const highlightedText = useMemo(() => {
        if (isMarkdown || !textContent || !previewLanguage) return '';
        return highlightCodeToHtml(textContent, previewLanguage);
    }, [isMarkdown, textContent, previewLanguage]);

    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key !== 'Escape') return;
            if (maximized) {
                setMaximized(false);
                return;
            }
            onClose();
        };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [maximized, onClose]);

    useEffect(() => {
        if (!markdownContainerRef.current || !renderedMarkdown) return undefined;
        renderMermaidDiagrams(markdownContainerRef.current);
        return undefined;
    }, [renderedMarkdown]);

    useEffect(() => {
        let cancelled = false;

        async function loadPreview() {
            if (previewKind !== 'text' && previewKind !== 'html' && previewKind !== 'archive' && previewKind !== 'delimited') {
                setLoading(false);
                setError(null);
                setTextContent('');
                setArchivePreview(null);
                setDelimitedPreview(null);
                return;
            }

            setLoading(true);
            setError(null);
            setTextContent('');
            setArchivePreview(null);
            setDelimitedPreview(null);
            try {
                const blob = await getMediaBlob(mediaId);
                const bytes = new Uint8Array(await blob.arrayBuffer());

                if (previewKind === 'text' || previewKind === 'html' || previewKind === 'delimited') {
                    if (previewKind === 'text' && shouldSniffTextAttachment(info, filename) && !isProbablyTextBytes(bytes)) {
                        throw new Error('Attachment does not appear to contain text content.');
                    }
                    const text = decodeTextBytes(bytes);
                    if (!cancelled) {
                        setTextContent(text);
                        if (previewKind === 'delimited') {
                            setDelimitedPreview(parseDelimitedPreview(text, {
                                delimiter: inferDelimitedPreviewDelimiter(info?.content_type, filename),
                            }));
                        }
                    }
                    return;
                }

                const parsed = parseZipPreview(bytes);
                if (!cancelled) setArchivePreview(parsed);
            } catch (loadError) {
                if (!cancelled) {
                    const detail = loadError instanceof Error ? loadError.message : String(loadError || 'Unknown error');
                    setError(previewKind === 'archive'
                        ? `Failed to load ZIP preview. ${detail}`
                        : previewKind === 'delimited'
                            ? `Failed to load table preview. ${detail}`
                            : `Failed to load text preview. ${detail}`);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void loadPreview();

        return () => {
            cancelled = true;
        };
    }, [mediaId, previewKind, info?.content_type, filename]);

    return html`
        <${BodyPortal} className="attachment-preview-portal-root">
            <div class=${buildAttachmentPreviewModalClassName(maximized)} onClick=${onClose}>
                <div class="attachment-preview-shell" onClick=${(e) => { e.stopPropagation(); }}>
                    <div class="attachment-preview-header">
                        <div class="attachment-preview-heading">
                            <div class="attachment-preview-title">${filename}</div>
                            <div class="attachment-preview-subtitle">${previewLabel}</div>
                        </div>
                        <div class="attachment-preview-header-actions">
                            <button
                                class="attachment-preview-zen"
                                type="button"
                                onClick=${() => setMaximized((value) => !value)}
                                title=${maximized ? 'Exit zen mode' : 'Enter zen mode'}
                                aria-label=${maximized ? 'Exit zen mode' : 'Enter zen mode'}
                                aria-pressed=${maximized ? 'true' : 'false'}
                            >
                                ${maximized ? 'Restore' : 'Maximize'}
                            </button>
                            ${frameUrl && html`
                                <a
                                    href=${frameUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="attachment-preview-download"
                                    onClick=${(e) => e.stopPropagation()}
                                >
                                    Open in Tab
                                </a>
                            `}
                            <a
                                href=${getMediaUrl(mediaId)}
                                download=${filename}
                                class="attachment-preview-download"
                                onClick=${(e) => e.stopPropagation()}
                            >
                                Download
                            </a>
                            <button class="attachment-preview-close" type="button" onClick=${onClose}>${t('preview.close')}</button>
                        </div>
                    </div>
                    <div class="attachment-preview-body">
                        ${loading && html`<div class="attachment-preview-state">${t('preview.loading')}</div>`}
                        ${!loading && error && html`<div class="attachment-preview-state">${error}</div>`}
                        ${!loading && !error && previewKind === 'image' && html`
                            <img class="attachment-preview-image" src=${getMediaUrl(mediaId)} alt=${filename} />
                        `}
                        ${!loading && !error && previewKind === 'audio' && html`
                            <div class="attachment-preview-audio-shell">
                                <audio class="attachment-preview-audio" src=${getMediaUrl(mediaId)} controls preload="metadata">
                                    Your browser does not support audio playback. Download the file to listen to it.
                                </audio>
                            </div>
                        `}
                        ${!loading && !error && previewKind === 'video' && html`
                            <video class="attachment-preview-video" src=${getMediaUrl(mediaId)} controls autoplay style="max-width:100%;max-height:100%;" />
                        `}
                        ${!loading && !error && previewKind === 'html' && html`
                            <iframe class="attachment-preview-frame" srcdoc=${textContent || ''} sandbox=${HTML_ATTACHMENT_PREVIEW_SANDBOX} title=${filename}></iframe>
                        `}
                        ${!loading && !error && (previewKind === 'pdf' || previewKind === 'office' || previewKind === 'eml' || Boolean(addonPreview)) && frameUrl && html`
                            <iframe class="attachment-preview-frame" src=${frameUrl} title=${filename}></iframe>
                        `}
                        ${!loading && !error && addonPreviewNote && html`
                            <div class="attachment-preview-readonly-note">${addonPreviewNote}</div>
                        `}
                        ${!loading && !error && previewKind === 'delimited' && delimitedPreview && html`
                            <div class="attachment-preview-delimited">
                                ${(delimitedPreview.truncatedRows || delimitedPreview.truncatedColumns) && html`
                                    <div class="attachment-preview-delimited-note">
                                        Showing first ${delimitedPreview.rowCount} rows and ${delimitedPreview.columnCount} columns.
                                        Download the file for the complete dataset.
                                    </div>
                                `}
                                <div class="attachment-preview-delimited-table-wrap">
                                    <table class="attachment-preview-delimited-table">
                                        <thead>
                                            <tr>
                                                ${delimitedPreview.headers.map((header, index) => html`
                                                    <th key=${`h-${index}`}>${header}</th>
                                                `)}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${delimitedPreview.rows.map((row, rowIndex) => html`
                                                <tr key=${`r-${rowIndex}`}>
                                                    ${row.map((cell, cellIndex) => html`
                                                        <td key=${`c-${rowIndex}-${cellIndex}`}>${cell}</td>
                                                    `)}
                                                </tr>
                                            `)}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        `}
                        ${!loading && !error && previewKind === 'archive' && archivePreview && html`
                            <div class="attachment-preview-archive">
                                <div class="attachment-preview-archive-summary">
                                    <div class="attachment-preview-archive-card">
                                        <span class="attachment-preview-archive-card-label">${t('preview.files')}</span>
                                        <strong class="attachment-preview-archive-card-value">${archivePreview.summary.fileCount}</strong>
                                    </div>
                                    <div class="attachment-preview-archive-card">
                                        <span class="attachment-preview-archive-card-label">${t('preview.folders')}</span>
                                        <strong class="attachment-preview-archive-card-value">${archivePreview.summary.directoryCount}</strong>
                                    </div>
                                    <div class="attachment-preview-archive-card">
                                        <span class="attachment-preview-archive-card-label">${t('preview.compressed')}</span>
                                        <strong class="attachment-preview-archive-card-value">${formatFileSize(archivePreview.summary.compressedBytes)}</strong>
                                    </div>
                                    <div class="attachment-preview-archive-card">
                                        <span class="attachment-preview-archive-card-label">${t('preview.uncompressed')}</span>
                                        <strong class="attachment-preview-archive-card-value">${formatFileSize(archivePreview.summary.uncompressedBytes)}</strong>
                                    </div>
                                </div>
                                <div class="attachment-preview-archive-table-wrap">
                                    <table class="attachment-preview-archive-table">
                                        <thead>
                                            <tr>
                                                <th>${t('preview.name')}</th>
                                                <th>${t('preview.type')}</th>
                                                <th>${t('preview.method')}</th>
                                                <th>${t('preview.compressed')}</th>
                                                <th>${t('preview.size')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${archivePreview.entries.map((entry) => html`
                                                <tr key=${entry.path}>
                                                    <td class="attachment-preview-archive-name">${entry.path}</td>
                                                    <td>${entry.isDirectory ? 'Folder' : 'File'}</td>
                                                    <td>${entry.isDirectory ? '—' : getCompressionMethodLabel(entry.compressionMethod)}</td>
                                                    <td>${entry.isDirectory ? '—' : formatFileSize(entry.compressedSize)}</td>
                                                    <td>${entry.isDirectory ? '—' : formatFileSize(entry.uncompressedSize)}</td>
                                                </tr>
                                            `)}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        `}
                        ${!loading && !error && previewKind === 'text' && isMarkdown && html`
                            <div
                                ref=${markdownContainerRef}
                                class="attachment-preview-markdown post-content"
                                dangerouslySetInnerHTML=${{ __html: renderedMarkdown }}
                            />
                        `}
                        ${!loading && !error && previewKind === 'text' && !isMarkdown && highlightedText && html`
                            <pre class="attachment-preview-text attachment-preview-code"><code dangerouslySetInnerHTML=${{ __html: highlightedText }} /></pre>
                        `}
                        ${!loading && !error && previewKind === 'text' && !isMarkdown && !highlightedText && html`
                            <pre class="attachment-preview-text">${textContent}</pre>
                        `}
                        ${!loading && !error && previewKind === 'unsupported' && html`
                            <div class="attachment-preview-state">
                                Preview is not available for this file type yet. You can still download it directly.
                            </div>
                        `}
                    </div>
                    <div class="attachment-preview-meta">
                        ${metadata.map((entry) => html`
                            <div class="attachment-preview-meta-item" key=${entry.label}>
                                <span class="attachment-preview-meta-label">${entry.label}</span>
                                <span class="attachment-preview-meta-value">${entry.value}</span>
                            </div>
                        `)}
                    </div>
                </div>
            </div>
        </${BodyPortal}>
    `;
}
