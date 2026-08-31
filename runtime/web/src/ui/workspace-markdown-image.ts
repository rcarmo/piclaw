import { getWorkspaceRawUrl } from '../api.js';

/**
 * Rewrite a Markdown image source relative to its workspace Markdown file.
 * External, fragment, data, and blob URLs are left for the caller's URL
 * safety policy; local paths are served through the authenticated raw route.
 */
export function rewriteWorkspaceMarkdownImageSrc(src: string, markdownPath: string): string {
    const raw = String(src || '').trim();
    if (!raw) return raw;

    if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(raw) || raw.startsWith('#') || raw.startsWith('data:') || raw.startsWith('blob:')) {
        return raw;
    }

    const match = raw.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
    const relPath = match?.[1] || raw;
    const query = match?.[2] || '';
    const hash = match?.[3] || '';
    const baseDir = String(markdownPath || '')
        .replace(/\\/g, '/')
        .split('/')
        .slice(0, -1)
        .join('/');
    const combined = relPath.startsWith('/')
        ? relPath
        : `${baseDir ? `${baseDir}/` : ''}${relPath}`;
    const normalized: string[] = [];

    for (const segment of combined.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            if (normalized.length > 0) normalized.pop();
            continue;
        }
        normalized.push(segment);
    }

    const querySuffix = query ? `&${query.slice(1)}` : '';
    return `${getWorkspaceRawUrl(normalized.join('/'))}${querySuffix}${hash}`;
}
