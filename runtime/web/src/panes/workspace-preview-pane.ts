/**
 * workspace-preview-pane.ts — Extension-driven workspace file preview renderers.
 *
 * Provides a default preview extension plus a higher-priority markdown preview
 * override so the workspace explorer can resolve previews through the existing
 * pane registry instead of hard-coding all rendering branches inline.
 */

import { renderMarkdown } from '../markdown.js';
import { getWorkspaceRawUrl } from '../api.js';
import { formatFileSize, formatTimestamp } from '../utils/format.js';
import { rewriteWorkspaceMarkdownImageSrc } from '../ui/workspace-markdown-image.js';
import type { PaneCapability, PaneContext, PaneInstance, WebPaneExtension } from './pane-types.js';

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getPreview(context) {
    return context?.preview || null;
}

function fileExtensionFromPath(filePath) {
    const value = String(filePath || '');
    const lastSlash = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    const base = lastSlash >= 0 ? value.slice(lastSlash + 1) : value;
    const lastDot = base.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === base.length - 1) return 'none';
    return base.slice(lastDot + 1);
}

function previewKindLabel(preview) {
    if (!preview) return 'unknown';
    if (preview.kind === 'image') return 'image';
    if (preview.kind === 'text') return preview.content_type === 'text/markdown' ? 'markdown' : 'text';
    if (preview.kind === 'binary') return 'binary';
    return String(preview.kind || 'unknown');
}

function renderPreviewMetadata(context, preview) {
    const filePath = preview?.path || context?.path || '';
    const parts = [];

    if (preview?.content_type) {
        parts.push(`<span><strong>type:</strong> ${escapeHtml(preview.content_type)}</span>`);
    }
    if (typeof preview?.size === 'number') {
        parts.push(`<span><strong>size:</strong> ${escapeHtml(formatFileSize(preview.size))}</span>`);
    }
    if (preview?.mtime) {
        parts.push(`<span><strong>modified:</strong> ${escapeHtml(formatTimestamp(preview.mtime))}</span>`);
    }
    parts.push(`<span><strong>kind:</strong> ${escapeHtml(previewKindLabel(preview))}</span>`);
    parts.push(`<span><strong>extension:</strong> ${escapeHtml(fileExtensionFromPath(filePath))}</span>`);
    if (filePath) {
        parts.push(`<span><strong>path:</strong> ${escapeHtml(filePath)}</span>`);
    }
    if (preview?.truncated) {
        parts.push('<span><strong>content:</strong> truncated</span>');
    }

    return `<div class="workspace-preview-meta workspace-preview-meta-inline">${parts.join('')}</div>`;
}

/** Render workspace preview markup, including the inline metadata block. */
export function renderWorkspacePreviewMarkup(context) {
    const preview = getPreview(context);
    if (!preview) {
        return '<div class="workspace-preview-text">No preview available.</div>';
    }

    const metadata = renderPreviewMetadata(context, preview);

    if (preview.kind === 'image') {
        const src = preview.url || (preview.path ? getWorkspaceRawUrl(preview.path) : '');
        return `${metadata}
            <div class="workspace-preview-image">
                <img src="${escapeHtml(src)}" alt="preview" />
            </div>
        `;
    }

    if (preview.kind === 'text') {
        if (preview.content_type === 'text/markdown') {
            const rendered = renderMarkdown(preview.text || '', null, {
                rewriteImageSrc: (src) => rewriteWorkspaceMarkdownImageSrc(src, preview.path || context?.path),
            });
            return `${metadata}<div class="workspace-preview-text">${rendered}</div>`;
        }
        return `${metadata}<pre class="workspace-preview-text"><code>${escapeHtml(preview.text || '')}</code></pre>`;
    }

    if (preview.kind === 'binary') {
        return `${metadata}<div class="workspace-preview-text">Binary file — download to view.</div>`;
    }

    return `${metadata}<div class="workspace-preview-text">No preview available.</div>`;
}

class WorkspacePreviewInstance implements PaneInstance {
    private readonly container: HTMLElement;
    private readonly context: PaneContext;
    private disposed = false;
    private readonly host: HTMLElement;

    constructor(container: HTMLElement, context: PaneContext) {
        this.container = container;
        this.context = context;
        this.host = document.createElement('div');
        this.host.className = 'workspace-preview-render-host';
        this.host.tabIndex = 0;
        this.container.appendChild(this.host);
        this.render();
    }

    render() {
        if (this.disposed) return;
        this.host.innerHTML = renderWorkspacePreviewMarkup(this.context);
    }

    getContent() {
        const preview = getPreview(this.context);
        return typeof preview?.text === 'string' ? preview.text : undefined;
    }

    isDirty() {
        return false;
    }

    setContent(content, mtime) {
        const preview = getPreview(this.context);
        if (preview && preview.kind === 'text') {
            preview.text = content;
            if (mtime !== undefined) preview.mtime = mtime;
        }
        this.context.content = content;
        if (mtime !== undefined) this.context.mtime = mtime;
        this.render();
    }

    focus() {
        this.host?.focus?.();
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.host?.remove();
        this.container.innerHTML = '';
    }
}

export const workspaceMarkdownPreviewPaneExtension: WebPaneExtension = {
    id: 'workspace-markdown-preview',
    label: 'Workspace Markdown Preview',
    icon: 'preview',
    capabilities: ['preview', 'readonly'] as PaneCapability[],
    placement: 'tabs',

    canHandle(context: PaneContext) {
        const preview = getPreview(context);
        if (context?.mode !== 'view') return false;
        if (!preview || preview.kind !== 'text') return false;
        return preview.content_type === 'text/markdown' ? 20 : false;
    },

    mount(container: HTMLElement, context: PaneContext): PaneInstance {
        return new WorkspacePreviewInstance(container, context);
    },
};

export const workspacePreviewPaneExtension: WebPaneExtension = {
    id: 'workspace-preview-default',
    label: 'Workspace Preview',
    icon: 'preview',
    capabilities: ['preview', 'readonly'] as PaneCapability[],
    placement: 'tabs',

    canHandle(context: PaneContext) {
        if (context?.mode !== 'view') return false;
        return getPreview(context) || context?.path ? 1 : false;
    },

    mount(container: HTMLElement, context: PaneContext): PaneInstance {
        return new WorkspacePreviewInstance(container, context);
    },
};
