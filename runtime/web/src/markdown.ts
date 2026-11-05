import { highlightCodeToHtml } from './utils/code-highlighting.js';
import { renderMermaidDiagrams as renderDiagrams } from './ui/mermaid-render.js';
export { isMermaidSourceAllowedForScopedRendering } from './ui/mermaid-render.js';
import { renderSvgFences, escapeSvgSource, encodeSvgSource } from './utils/svg-images.js';
import { linkifyChatReferences } from './ui/chat-reference-links.js';

declare const katex: { renderToString: (tex: string, options?: Record<string, unknown>) => string };
declare const marked: { parse: (text: string, options?: Record<string, unknown>) => string };

declare global {
    interface Window {
        __PICLAW_SANITIZE_SVG_FENCES__?: boolean;
        katex?: typeof katex;
        marked?: typeof marked;
        beautifulMermaid?: {
            renderMermaid: (code: string, options?: Record<string, unknown>) => Promise<string>;
            THEMES: Record<string, Record<string, unknown>>;
        };
    }
}

type MarkdownOptions = {
    allowDataImage?: boolean;
    sanitize?: boolean;
    rewriteImageSrc?: (src: string) => string;
    projectRepository?: string | null;
};

/** Regex matching HTTP/HTTPS URLs in message text. */
export const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
/** Regex matching #hashtag tokens in message text. */
export const HASHTAG_REGEX = /#(\w+)/g;

const ALLOWED_HTML_TAGS = new Set([
    'code',
    'pre',
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
    'del',
    'ins',
    'sub',
    'sup',
    'mark',
    'small',
    'br',
    'p',
    'ul',
    'ol',
    'li',
    'blockquote',
    'ruby',
    'rt',
    'rp',
    'span',
    'input',
]);

const SAFE_TAGS = new Set([
    'a',
    'abbr',
    'blockquote',
    'br',
    'code',
    'del',
    'div',
    'em',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'i',
    'img',
    'input',
    'ins',
    'kbd',
    'li',
    'mark',
    'ol',
    'p',
    'pre',
    'ruby',
    'rt',
    'rp',
    's',
    'small',
    'span',
    'strong',
    'sub',
    'sup',
    'table',
    'tbody',
    'td',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
    // KaTeX/MathML tags
    'math',
    'semantics',
    'mrow',
    'mi',
    'mn',
    'mo',
    'mtext',
    'mspace',
    'msup',
    'msub',
    'msubsup',
    'mfrac',
    'msqrt',
    'mroot',
    'mtable',
    'mtr',
    'mtd',
    'annotation',
    // SVG tags for inline diagrams/charts
    'svg',
    'g',
    'defs',
    'symbol',
    'use',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'text',
    'tspan',
    'image',
    'clippath',
    'mask',
    'pattern',
    'lineargradient',
    'radialgradient',
    'stop',
    'filter',
    'fegaussianblur',
    'feoffset',
    'feblend',
    'fecolormatrix',
    'fecomposite',
    'feflood',
    'fedropshadow',
    'title',
    'desc',
    'marker',
    'foreignobject',
]);

const GLOBAL_ALLOWED_ATTRS = new Set([
    'class',
    'title',
    'role',
    'aria-hidden',
    'aria-label',
    'aria-expanded',
    'aria-live',
    'data-mermaid',
    'data-hashtag',
]);

const TAG_ALLOWED_ATTRS = {
    a: new Set(['href', 'target', 'rel']),
    img: new Set(['src', 'alt', 'title']),
    input: new Set(['type', 'checked', 'disabled']),
};

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', '']);

const SVG_TAGS = new Set([
    'svg', 'g', 'defs', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse',
    'line', 'polyline', 'polygon', 'text', 'tspan', 'image', 'clippath', 'mask',
    'pattern', 'lineargradient', 'radialgradient', 'stop', 'filter',
    'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'fecomposite',
    'feflood', 'fedropshadow', 'title', 'desc', 'marker', 'foreignobject',
]);

export function isSanitizedHtmlAttributeAllowed(tagName, attrName) {
    const normalizedTag = String(tagName || '').toLowerCase();
    const normalizedAttr = String(attrName || '').toLowerCase();
    if (!normalizedAttr || normalizedAttr.startsWith('on')) return false;
    if (normalizedAttr.startsWith('data-') || normalizedAttr.startsWith('aria-')) {
        return true;
    }
    // SVG elements use many presentation attributes (viewBox, fill, stroke, d, cx, etc.)
    // Allow all non-event attributes here; scoped indirect-reference filtering
    // is applied by sanitizeHtml when an image rewrite policy is supplied.
    if (SVG_TAGS.has(normalizedTag)) return true;
    const allowedAttrs = TAG_ALLOWED_ATTRS[normalizedTag] || new Set();
    return allowedAttrs.has(normalizedAttr) || GLOBAL_ALLOWED_ATTRS.has(normalizedAttr);
}

function escapeHtmlAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&#39;');
}

export function sanitizeUrl(url, options: MarkdownOptions = {}) {
    if (!url) return null;
    const raw = String(url).trim();
    if (!raw) return null;

    if (raw.startsWith('#') || raw.startsWith('/')) return raw;

    if (raw.startsWith('data:')) {
        if (options.allowDataImage && /^data:image\//i.test(raw)) {
            return raw;
        }
        return null;
    }

    if (raw.startsWith('blob:')) return raw;

    try {
        const parsed = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
        if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
        return parsed.href;
    } catch {
        return null;
    }
}

function sanitizeHtml(html, options: MarkdownOptions = {}) {
    if (!html) return '';
    if (options?.sanitize === false) return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nodes: Element[] = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
        nodes.push(node);
    }

    for (const el of nodes) {
        const tag = el.tagName.toLowerCase();
        if (!SAFE_TAGS.has(tag)) {
            const parent = el.parentNode;
            if (!parent) continue;
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            continue;
        }

        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value;
            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
                continue;
            }
            if (isSanitizedHtmlAttributeAllowed(tag, name)) {
                if (SVG_TAGS.has(tag) && typeof options.rewriteImageSrc === 'function') {
                    const references = Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi), (match) => match[2]?.trim() || '');
                    const hasExternalReference = /(?:https?:|data:|blob:|\/\/)/i.test(value);
                    if (hasExternalReference || references.some((reference) => !/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(reference))) {
                        el.removeAttribute(attr.name);
                        continue;
                    }
                }
                if (name === 'href' || name === 'xlink:href') {
                    const rewritten = typeof options.rewriteImageSrc === 'function' && SVG_TAGS.has(tag)
                        ? (/^#[A-Za-z_][A-Za-z0-9_.:-]*$/.test(value.trim()) ? value.trim() : options.rewriteImageSrc(value))
                        : value;
                    const safe = sanitizeUrl(rewritten);
                    if (!safe) {
                        el.removeAttribute(attr.name);
                    } else {
                        el.setAttribute(attr.name, safe);
                        if (tag === 'a') {
                            if (!el.getAttribute('rel')) {
                                el.setAttribute('rel', 'noopener noreferrer');
                            }
                            // Open external links in a new tab
                            if (/^https?:\/\//i.test(safe)) {
                                el.setAttribute('target', '_blank');
                            }
                        }
                    }
                } else if (name === 'src') {
                    const rewritten = typeof options.rewriteImageSrc === 'function' && (tag === 'img' || tag === 'image')
                        ? options.rewriteImageSrc(value)
                        : value;
                    const safe = sanitizeUrl(rewritten, { allowDataImage: tag === 'img' && typeof options.rewriteImageSrc !== 'function' });
                    if (!safe) {
                        el.removeAttribute(attr.name);
                    } else {
                        el.setAttribute(attr.name, safe);
                    }
                }
                continue;
            }
            el.removeAttribute(attr.name);
        }
    }

    return doc.body.innerHTML;
}

/**
 * Decode HTML entities
 */
export function decodeEntities(text) {
    if (!text) return text;
    // Escape literal angle brackets so DOMParser doesn't treat them as tags
    const safe = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const doc = new DOMParser().parseFromString(safe, 'text/html');
    return doc.documentElement.textContent;
}

/** Recursively decode HTML entities up to maxDepth iterations. */
export function decodeEntitiesDeep(text, maxDepth = 2) {
    if (!text) return text;
    let current = text;
    for (let i = 0; i < maxDepth; i += 1) {
        const next = decodeEntities(current);
        if (next === current) break;
        current = next;
    }
    return current;
}

function extractLeadingYamlFrontmatter(text) {
    if (!text) return { text: '', frontmatter: null };
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.startsWith('---\n')) {
        return { text: normalized, frontmatter: null };
    }

    const lines = normalized.split('\n');
    let closingIndex = -1;
    for (let i = 1; i < lines.length; i += 1) {
        if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
            closingIndex = i;
            break;
        }
    }

    if (closingIndex <= 0) {
        return { text: normalized, frontmatter: null };
    }

    const frontmatter = lines.slice(1, closingIndex).join('\n');
    const body = lines.slice(closingIndex + 1).join('\n').replace(/^\n+/, '');
    return { text: body, frontmatter };
}

function normalizeLeadingFrontmatter(text) {
    const { text: body, frontmatter } = extractLeadingYamlFrontmatter(text);
    if (frontmatter === null) return body;
    return [
        '<!--frontmatter-block-start-->',
        '```yaml',
        frontmatter,
        '```',
        '<!--frontmatter-block-end-->',
        body,
    ].filter(Boolean).join('\n\n');
}

function decodeMermaidBlock(text) {
    if (!text) return text;
    return decodeEntitiesDeep(text, 5);
}

function toBase64(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

export function applySyntaxHighlighting(html) {
    if (!html) return html;
    const highlighted = html.replace(/<pre><code(?:\s+class="language-([A-Za-z0-9_+-]+)")?>([\s\S]*?)<\/code><\/pre>/g, (match, lang, code) => {
        const normalizedLanguage = String(lang || '').trim().toLowerCase();
        const decodedCode = decodeEntities(code);
        const languageClass = normalizedLanguage || 'plaintext';
        const highlightedCode = highlightCodeToHtml(decodedCode, normalizedLanguage);
        return `<pre><code class="hljs language-${escapeHtmlAttr(languageClass)}">${highlightedCode}</code></pre>`;
    });
    return highlighted
        .replace(/<!--frontmatter-block-start-->\s*<pre>/g, '<pre class="frontmatter-block">')
        .replace(/<\/pre>\s*<!--frontmatter-block-end-->/g, '</pre>');
}

const RESTORABLE_HTML_ATTRS = {
    span: new Set(['title', 'class', 'lang', 'dir']),
    input: new Set(['type', 'checked', 'disabled']),
};

function extractRestorableAttributes(tagName, rawAttrs) {
    const allowed = RESTORABLE_HTML_ATTRS[tagName];
    if (!allowed || !rawAttrs) return '';

    const attrs = [];
    const regex = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
    let match;
    while ((match = regex.exec(rawAttrs))) {
        const name = (match[1] || '').toLowerCase();
        if (!name || name.startsWith('on') || !allowed.has(name)) continue;
        const rawValue = match[2] ?? match[3] ?? match[4] ?? '';
        attrs.push(` ${name}="${escapeHtmlAttr(rawValue)}"`);
    }

    return attrs.join('');
}

function restoreAllowedHtmlTags(text) {
    if (!text) return text;
    return text.replace(/&lt;((?:[^"'<>]|"[^"]*"|'[^']*')*?)(?:&gt;|>)/g, (match, content) => {
        const trimmed = content.trim();
        const isClosing = trimmed.startsWith('/');
        const rawTag = isClosing ? trimmed.slice(1).trim() : trimmed;
        const isSelfClosing = rawTag.endsWith('/');
        const tagContent = isSelfClosing ? rawTag.slice(0, -1).trim() : rawTag;
        const [tagToken = ''] = tagContent.split(/\s+/, 1);
        const tagName = tagToken.toLowerCase();
        if (!tagName || !ALLOWED_HTML_TAGS.has(tagName)) return match;
        // Void tag: never emit a closing </br>
        if (tagName === 'br') {
            return isClosing ? '' : '<br>';
        }
        if (isClosing) return `</${tagName}>`;

        const attrSource = tagContent.slice(tagToken.length).trim();
        const attrs = extractRestorableAttributes(tagName, attrSource);
        return `<${tagName}${attrs}>`;
    });
}

/** Apply the existing raw-HTML policy only to parser HTML tokens. Code
 * tokens never enter entity/tag restoration, including nested fences/spans. */
export function prepareMarkdownToken(token: {type?:string;text?:string;lang?:string}, renderLanguageFences = true): void {
    if (typeof token.text !== 'string') return;
    if (token.type === 'code' && renderLanguageFences) {
        const language = token.lang?.trim().toLowerCase();
        if (language === 'mermaid') {
            token.type = 'html';
            token.text = `<div class="mermaid-container" data-mermaid="${toBase64(decodeMermaidBlock(token.text))}"><div class="mermaid-loading">Loading diagram...</div></div>`;
            return;
        }
        if (language && ['math','katex','latex'].includes(language)) {
            token.type = 'html';
            token.text = `<p>$$\n${escapeHtmlAttr(token.text)}\n$$</p>\n`;
            return;
        }
    }
    if (token.type !== 'html') return;
    if (/^<!--frontmatter-block-(?:start|end)-->\s*$/.test(token.text)) return;
    token.text = restoreAllowedHtmlTags(token.text.replace(/</g, '&lt;'));
}

/**
 * Render LaTeX math expressions using KaTeX.
 * Web only supports block math ($$...$$ or fenced math blocks); inline $...$ is disabled.
 */
export function renderMath(html_content) {
    if (!window.katex) return html_content;

    const decodeMath = (value) => decodeEntities(value)
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&amp;/g, '&')
        .replace(/<br\s*\/?\s*>/gi, '\n');

    const stripCodeBlocks = (html) => {
        const blocks = [];
        let output = html.replace(/<pre\b[^>]*>\s*<code\b[^>]*>[\s\S]*?<\/code>\s*<\/pre>/gi, (match) => {
            const idx = blocks.length;
            blocks.push(match);
            return `@@CODE_BLOCK_${idx}@@`;
        });
        output = output.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, (match) => {
            const idx = blocks.length;
            blocks.push(match);
            return `@@CODE_INLINE_${idx}@@`;
        });
        return { html: output, blocks };
    };

    const restoreCodeBlocks = (html, blocks) => {
        if (!blocks.length) return html;
        return html.replace(/@@CODE_(?:BLOCK|INLINE)_(\d+)@@/g, (_match, idxStr) => {
            const idx = Number(idxStr);
            return blocks[idx] ?? '';
        });
    };

    const stripped = stripCodeBlocks(html_content);
    let processed = stripped.html;

    // Process display math first ($$...$$) - require block delimiters on their own line
    processed = processed.replace(/(^|\n|<br\s*\/?\s*>|<p>|<\/p>)\s*\$\$([\s\S]+?)\$\$\s*(?=\n|<br\s*\/?\s*>|<\/p>|$)/gi, (match, leading, tex) => {
        try {
            const rendered = katex.renderToString(decodeMath(tex.trim()), { displayMode: true, throwOnError: false });
            return `${leading}${rendered}`;
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return `<span class="math-error" title="${escapeHtmlAttr(message)}">${match}</span>`;
        }
    });

    return restoreCodeBlocks(processed, stripped.blocks);
}

/**
 * Linkify hashtags in rendered HTML, avoiding links/code blocks.
 */
export function linkifyHashtagsInHtml(html: string, repositoryUrl: string | null = null): string {
    return linkifyChatReferences(html, repositoryUrl);
}

/**
 * Render markdown and then linkify hashtags
 */
export function prepareMarkdownSource(text) {
    // Leave literal ranges and language fences to the existing Markdown parser.
    return { safeHtml: normalizeLeadingFrontmatter(text || '') };
}

/**
 * Transform GitHub-style admonition blockquotes into styled admonition blocks.
 * Matches: <blockquote><p>[!NOTE]\n...   or   <blockquote>\n<p>[!NOTE]\n...
 * Types: NOTE, TIP, IMPORTANT, WARNING, CAUTION
 */
const ADMONITION_TYPES = new Set(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']);
const ADMONITION_LABELS: Record<string, string> = {
    NOTE: 'Note',
    TIP: 'Tip',
    IMPORTANT: 'Important',
    WARNING: 'Warning',
    CAUTION: 'Caution',
};

function transformAdmonitions(html: string): string {
    // Match blockquotes whose first <p> starts with [!TYPE]
    return html.replace(
        /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>\s*)?(\n)?/gi,
        (_match, type: string, _nl) => {
            const normalized = type.toUpperCase();
            if (!ADMONITION_TYPES.has(normalized)) return _match;
            const label = ADMONITION_LABELS[normalized] || normalized;
            return `<div class="admonition admonition-${normalized.toLowerCase()}"><p class="admonition-title">${label}</p><p>`;
        }
    ).replace(
        // Close the div instead of blockquote for transformed admonitions
        /(<div class="admonition admonition-[a-z]+">(?:(?!<\/div>)[\s\S])*?)<\/blockquote>/g,
        (_match, inner) => `${inner}</div>`
    );
}

/** Render markdown text to sanitised HTML with syntax highlighting. */
export function renderMarkdown(text, onHashtagClick, options: MarkdownOptions = {}) {
    if (!text) return '';
    return renderSvgFences(text, (part) => renderMarkdownBody(part, options),
        (source) => `<pre><code class="language-svg" data-svg-source="${encodeSvgSource(source)}">${escapeSvgSource(source)}</code></pre>`,
        { sanitize: typeof window === 'undefined' || window.__PICLAW_SANITIZE_SVG_FENCES__ !== false });
}

function renderMarkdownBody(text: string, options: MarkdownOptions): string {

    const { safeHtml } = prepareMarkdownSource(text);

    // Render markdown to HTML (preserve escaped HTML)
    let html_content = window.marked
        ? marked.parse(safeHtml, { headerIds: false, mangle: false, walkTokens: prepareMarkdownToken })
        : escapeHtmlAttr(safeHtml).replace(/\n/g, '<br>');

    html_content = applySyntaxHighlighting(html_content);

    // Render math expressions
    html_content = renderMath(html_content);

    // Process hashtags without breaking links
    html_content = linkifyHashtagsInHtml(html_content, options.projectRepository);

    // Transform GitHub-style admonitions (> [!NOTE], > [!TIP], etc.)
    html_content = transformAdmonitions(html_content);

    // Sanitize HTML output (links/attributes/tags)
    html_content = sanitizeHtml(html_content, options);

    return html_content;
}

/**
 * Render thinking panels with markdown while keeping tags/quotes intact.
 */
export function renderThinkingMarkdown(text) {
    if (!text) return '';
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let html_content = window.marked ? marked.parse(normalized, { walkTokens: (token: Parameters<typeof prepareMarkdownToken>[0]) => prepareMarkdownToken(token, false) }) : escapeHtmlAttr(normalized).replace(/\n/g, '<br>');
    // Avoid math rendering in thought/draft panels to prevent shell $ variables
    // from being misinterpreted as inline LaTeX.
    html_content = sanitizeHtml(html_content);
    return html_content;
}

/** Render through the shared, sanitized timeline renderer. */
export async function renderMermaidDiagrams(container: HTMLElement, options: MarkdownOptions = {}) {
    await renderDiagrams(container, {
        scoped: typeof options.rewriteImageSrc === 'function',
        reportError: (error) => console.error('Mermaid render error:', error),
    });
}
