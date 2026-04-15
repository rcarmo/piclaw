// @ts-nocheck
import { highlightCodeToHtml } from './utils/code-highlighting.js';
import { getThemeMode } from './ui/theme.js';

/** Regex matching HTTP/HTTPS URLs in message text. */
export const URL_REGEX = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
/** Regex matching #hashtag tokens in message text. */
export const HASHTAG_REGEX = /#(\w+)/g;

const ALLOWED_HTML_TAGS = new Set([
    'strong',
    'em',
    'b',
    'i',
    'u',
    's',
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
]);

const SAFE_TAGS = new Set([
    'a',
    'abbr',
    'blockquote',
    'br',
    'code',
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
]);

const GLOBAL_ALLOWED_ATTRS = new Set([
    'class',
    'style',
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
};

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', '']);

function escapeHtmlAttr(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/'/g, '&#39;');
}

export function sanitizeUrl(url, options = {}) {
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

function sanitizeHtml(html, options = {}) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nodes = [];
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

        const allowedAttrs = TAG_ALLOWED_ATTRS[tag] || new Set();
        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = attr.value;
            if (name.startsWith('on')) {
                el.removeAttribute(attr.name);
                continue;
            }
            if (name.startsWith('data-') || name.startsWith('aria-')) {
                continue;
            }
            if (allowedAttrs.has(name) || GLOBAL_ALLOWED_ATTRS.has(name)) {
                if (name === 'href') {
                    const safe = sanitizeUrl(value);
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
                    const rewritten = tag === 'img' && typeof options.rewriteImageSrc === 'function'
                        ? options.rewriteImageSrc(value)
                        : value;
                    const safe = sanitizeUrl(rewritten, { allowDataImage: tag === 'img' });
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

function extractMermaidBlocks(text) {
    if (!text) return { text: '', blocks: [] };
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const blocks = [];
    const output = [];
    let inMermaid = false;
    let current = [];

    for (const line of lines) {
        if (!inMermaid && line.trim().match(/^```mermaid\s*$/i)) {
            inMermaid = true;
            current = [];
            continue;
        }
        if (inMermaid && line.trim().match(/^```\s*$/)) {
            const idx = blocks.length;
            blocks.push(current.join('\n'));
            output.push(`@@MERMAID_BLOCK_${idx}@@`);
            inMermaid = false;
            current = [];
            continue;
        }
        if (inMermaid) {
            current.push(line);
        } else {
            output.push(line);
        }
    }

    if (inMermaid) {
        output.push('```mermaid');
        output.push(...current);
    }

    return { text: output.join('\n'), blocks };
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

function fromBase64(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

function injectMermaidBlocks(html, blocks) {
    if (!html || !blocks || blocks.length === 0) return html;
    return html.replace(/@@MERMAID_BLOCK_(\d+)@@/g, (match, idxStr) => {
        const idx = Number(idxStr);
        const raw = blocks[idx] ?? '';
        const decoded = decodeMermaidBlock(raw);
        const encoded = toBase64(decoded);
        return `<div class="mermaid-container" data-mermaid="${encoded}"><div class="mermaid-loading">Loading diagram...</div></div>`;
    });
}

function normalizeHtmlCodeTags(text) {
    if (!text) return text;
    return text.replace(/<code>([\s\S]*?)<\/code>/gi, (match, code) => {
        if (code.includes('\n')) {
            return `\n\`\`\`\n${code}\n\`\`\`\n`;
        }
        return `\`${code}\``;
    });
}

export function applySyntaxHighlighting(html) {
    if (!html) return html;
    const highlighted = html.replace(/<pre><code(?:\s+class="language-([A-Za-z0-9_+-]+)")?>([\s\S]*?)<\/code><\/pre>/g, (match, lang, code) => {
        const normalizedLanguage = String(lang || '').trim().toLowerCase();
        const decodedCode = decodeEntitiesDeep(code, 2);
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

function decodeCodeEntities(html) {
    if (!html) return html;
    const normalize = (value) => value
        .replace(/&amp;lt;/g, '&lt;')
        .replace(/&amp;gt;/g, '&gt;')
        .replace(/&amp;quot;/g, '&quot;')
        .replace(/&amp;#39;/g, '&#39;')
        .replace(/&amp;amp;/g, '&amp;');
    return html
        .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (match, code) => `<pre><code>${normalize(code)}</code></pre>`)
        .replace(/<code>([\s\S]*?)<\/code>/g, (match, code) => `<code>${normalize(code)}</code>`);
}

function decodeTextEntities(html) {
    if (!html) return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const decode = (value) => value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
    let node;
    while ((node = walker.nextNode())) {
        if (!node.nodeValue) continue;
        const next = decode(node.nodeValue);
        if (next !== node.nodeValue) {
            node.nodeValue = next;
        }
    }
    return doc.body.innerHTML;
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
            return `<span class="math-error" title="${escapeHtmlAttr(e.message)}">${match}</span>`;
        }
    });

    return restoreCodeBlocks(processed, stripped.blocks);
}

/**
 * Linkify hashtags in rendered HTML, avoiding links/code blocks.
 */
function linkifyHashtagsInHtml(html_content) {
    if (!html_content) return html_content;
    const doc = new DOMParser().parseFromString(html_content, 'text/html');
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
        nodes.push(node);
    }
    for (const textNode of nodes) {
        const value = textNode.nodeValue;
        if (!value) continue;
        HASHTAG_REGEX.lastIndex = 0;
        if (!HASHTAG_REGEX.test(value)) continue;
        HASHTAG_REGEX.lastIndex = 0;
        const parent = textNode.parentElement;
        if (parent && (parent.closest('a') || parent.closest('code') || parent.closest('pre'))) continue;
        const parts = value.split(HASHTAG_REGEX);
        if (parts.length <= 1) continue;
        const fragment = doc.createDocumentFragment();
        parts.forEach((part, idx) => {
            if (idx % 2 === 1) {
                const link = doc.createElement('a');
                link.setAttribute('href', '#');
                link.className = 'hashtag';
                link.setAttribute('data-hashtag', part);
                link.textContent = `#${part}`;
                fragment.appendChild(link);
            } else {
                fragment.appendChild(doc.createTextNode(part));
            }
        });
        textNode.parentNode?.replaceChild(fragment, textNode);
    }
    return doc.body.innerHTML;
}

/**
 * Render markdown and then linkify hashtags
 */
function normalizeMathFences(text) {
    if (!text) return text;
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const output = [];
    let inMath = false;

    for (const line of lines) {
        if (!inMath && line.trim().match(/^```(?:math|katex|latex)\s*$/i)) {
            inMath = true;
            output.push('$$');
            continue;
        }
        if (inMath && line.trim().match(/^```\s*$/)) {
            inMath = false;
            output.push('$$');
            continue;
        }
        output.push(line);
    }

    return output.join('\n');
}

export function prepareMarkdownSource(text) {
    const normalizedFrontmatter = normalizeLeadingFrontmatter(text || '');
    const normalizedMath = normalizeMathFences(normalizedFrontmatter);
    const { text: stripped, blocks: mermaidBlocks } = extractMermaidBlocks(normalizedMath);

    // Decode HTML entities first (in case content has encoded entities)
    const decoded = decodeEntitiesDeep(stripped, 2);
    const normalized = normalizeHtmlCodeTags(decoded);
    const escaped = normalized
        .replace(/</g, '&lt;');
    const safeHtml = restoreAllowedHtmlTags(escaped);

    return { safeHtml, mermaidBlocks };
}

/** Render markdown text to sanitised HTML with syntax highlighting. */
export function renderMarkdown(text, onHashtagClick, options = {}) {
    if (!text) return '';

    const { safeHtml, mermaidBlocks } = prepareMarkdownSource(text);

    // Render markdown to HTML (preserve escaped HTML)
    let html_content = window.marked
        ? marked.parse(safeHtml, { headerIds: false, mangle: false })
        : safeHtml.replace(/\n/g, '<br>');

    html_content = decodeCodeEntities(html_content);
    html_content = decodeTextEntities(html_content);
    html_content = applySyntaxHighlighting(html_content);

    // Render math expressions
    html_content = renderMath(html_content);

    // Process hashtags without breaking links
    html_content = linkifyHashtagsInHtml(html_content);

    // Inject Mermaid blocks after markdown processing to avoid double-encoding
    html_content = injectMermaidBlocks(html_content, mermaidBlocks);

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
    const decoded = decodeEntitiesDeep(normalized, 2);
    const normalizedHtml = normalizeHtmlCodeTags(decoded);
    const escaped = normalizedHtml
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const safeHtml = restoreAllowedHtmlTags(escaped);
    let html_content = window.marked ? marked.parse(safeHtml) : safeHtml.replace(/\n/g, '<br>');
    html_content = decodeCodeEntities(html_content);
    html_content = decodeTextEntities(html_content);
    // Avoid math rendering in thought/draft panels to prevent shell $ variables
    // from being misinterpreted as inline LaTeX.
    html_content = sanitizeHtml(html_content);
    return html_content;
}

// Render pending mermaid diagrams in the DOM
/**
 * Post-process Mermaid SVG: replace sharp orthogonal polyline corners with
 * smooth arc-cornered paths.  Radius is clamped so short segments stay valid.
 */
function roundPolylineCorners(svgString, radius = 6) {
    return svgString.replace(
        /<polyline\b([^>]*)\bpoints="([^"]+)"([^>]*)\/?\s*>/g,
        (_match, before, pointsStr, after) => {
            const pts = pointsStr.trim().split(/\s+/).map(p => {
                const [x, y] = p.split(',').map(Number);
                return { x, y };
            });
            if (pts.length < 3) {
                return `<polyline${before}points="${pointsStr}"${after}/>`;
            }

            const parts = [`M ${pts[0].x},${pts[0].y}`];
            for (let i = 1; i < pts.length - 1; i++) {
                const prev = pts[i - 1];
                const curr = pts[i];
                const next = pts[i + 1];

                const dxIn  = curr.x - prev.x;
                const dyIn  = curr.y - prev.y;
                const dxOut = next.x - curr.x;
                const dyOut = next.y - curr.y;

                const lenIn  = Math.sqrt(dxIn * dxIn + dyIn * dyIn);
                const lenOut = Math.sqrt(dxOut * dxOut + dyOut * dyOut);

                // Clamp radius to half the shortest adjacent segment
                const r = Math.min(radius, lenIn / 2, lenOut / 2);
                if (r < 0.5) {
                    parts.push(`L ${curr.x},${curr.y}`);
                    continue;
                }

                // Points where the arc begins and ends
                const ax = curr.x - (dxIn / lenIn) * r;
                const ay = curr.y - (dyIn / lenIn) * r;
                const bx = curr.x + (dxOut / lenOut) * r;
                const by = curr.y + (dyOut / lenOut) * r;

                // Determine sweep direction via cross product
                const cross = dxIn * dyOut - dyIn * dxOut;
                const sweep = cross > 0 ? 1 : 0;

                parts.push(`L ${ax},${ay}`);
                parts.push(`A ${r},${r} 0 0 ${sweep} ${bx},${by}`);
            }
            parts.push(`L ${pts[pts.length - 1].x},${pts[pts.length - 1].y}`);

            return `<path${before}d="${parts.join(' ')}"${after}/>`;
        },
    );
}

/** Find mermaid code blocks in a container and render them as SVG diagrams. */
export async function renderMermaidDiagrams(container) {
    if (!window.beautifulMermaid) return;

    const { renderMermaid, THEMES } = window.beautifulMermaid;
    const isDark = getThemeMode() === 'dark';
    const theme = isDark ? THEMES['tokyo-night'] : THEMES['github-light'];

    const pending = container.querySelectorAll('.mermaid-container[data-mermaid]');
    for (const el of pending) {
        try {
            const encoded = el.dataset.mermaid;
            const raw = fromBase64(encoded || '');
            const code = decodeEntitiesDeep(raw, 2);
            let svg = await renderMermaid(code, { ...theme, transparent: true });
            svg = roundPolylineCorners(svg);
            el.innerHTML = svg;
            el.removeAttribute('data-mermaid');
        } catch (e) {
            console.error('Mermaid render error:', e);
            const pre = document.createElement('pre');
            pre.className = 'mermaid-error';
            pre.textContent = `Diagram error: ${e.message}`;
            el.innerHTML = '';
            el.appendChild(pre);
            el.removeAttribute('data-mermaid');
        }
    }
}
