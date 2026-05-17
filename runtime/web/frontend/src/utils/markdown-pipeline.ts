/**
 * Full markdown rendering pipeline — ported from upstream piclaw.
 *
 * Pipeline stages:
 *   1. Pre-processing  (frontmatter, math fences, mermaid extraction)
 *   2. Entity handling (decode, normalize code tags, escape + restore)
 *   3. Markdown render (marked.parse)
 *   4. Post-processing (decode entities, syntax highlighting, KaTeX math,
 *                        hashtag links, mermaid injection)
 *   5. Sanitization    (DOMParser-based, allows KaTeX/MathML tags)
 */

import { applySyntaxHighlighting } from "./code-highlighting";
import _DOMPurifyModule from "dompurify";

// ── DOMPurify lazy init (browser + Bun/Node safe) ─────────────────────────

let _purifyInstance: typeof _DOMPurifyModule | null = null;

function getDOMPurifyInstance(): typeof _DOMPurifyModule | null {
  if (_purifyInstance !== null) return _purifyInstance;
  try {
    if (typeof _DOMPurifyModule.sanitize === "function") {
      _purifyInstance = _DOMPurifyModule;
    } else if (typeof (_DOMPurifyModule as unknown as (win: unknown) => typeof _DOMPurifyModule) === "function") {
      // Factory form returned by dompurify in non-browser environments (Bun/Node)
      _purifyInstance = (_DOMPurifyModule as unknown as (win: unknown) => typeof _DOMPurifyModule)(globalThis);
    }
  } catch {
    // DOMPurify not usable in this environment
  }
  return _purifyInstance;
}

/** Get the marked library from the deferred vendor global. */
function getMarked(): PiclawMarked | null {
  return window.marked ?? null;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** Regex matching #hashtag tokens in message text. */
export const HASHTAG_REGEX = /#(\w+)/g;

const ALLOWED_HTML_TAGS = new Set([
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "del",
  "ins",
  "sub",
  "sup",
  "mark",
  "small",
  "br",
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "ruby",
  "rt",
  "rp",
  "span",
  "input",
]);

// KaTeX/MathML tags to allow through DOMPurify
const KATEX_TAGS = [
  "math", "semantics", "mrow", "mi", "mn", "mo", "mtext", "mspace",
  "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot",
  "mtable", "mtr", "mtd", "annotation",
];

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", ""]);

const RESTORABLE_HTML_ATTRS: Record<string, Set<string>> = {
  span: new Set(["title", "class", "lang", "dir"]),
  input: new Set(["type", "checked", "disabled"]),
};

// ── Utility ────────────────────────────────────────────────────────────────

function escapeHtmlAttr(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/'/g, "&#39;");
}

// ── Stage 5: Sanitization (DOMPurify — battle-tested) ──────────────────────

/** Get DOMPurify (bundled ESM, with Bun/Node guard). */
function getDOMPurify(): typeof _DOMPurifyModule | null {
  return getDOMPurifyInstance();
}

/** DOMPurify configuration: allow KaTeX/MathML, data attributes, classes. */
const DOMPURIFY_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_TAGS: KATEX_TAGS,
  ADD_ATTR: ["class", "data-mermaid", "data-hashtag", "target", "rel"],
  ALLOW_DATA_ATTR: true,
  ADD_URI_SAFE_ATTR: ["data-mermaid"],
};

export function sanitizeUrl(url: string, options: { allowDataImage?: boolean } = {}): string | null {
  if (!url) return null;
  const raw = String(url).trim();
  if (!raw) return null;

  if (raw.startsWith("#") || raw.startsWith("/")) return raw;

  if (raw.startsWith("data:")) {
    if (options.allowDataImage && /^data:image\//i.test(raw)) {
      return raw;
    }
    return null;
  }

  if (raw.startsWith("blob:")) return raw;

  try {
    const parsed = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function sanitizeHtml(html: string, options: { sanitize?: boolean } = {}): string {
  if (!html) return "";
  if (options?.sanitize === false) return html;

  const purify = getDOMPurify();
  if (purify) {
    return purify.sanitize(html, DOMPURIFY_CONFIG);
  }

  // Fallback: strip all tags if DOMPurify not loaded yet
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

// ── Stage 2: Entity handling ───────────────────────────────────────────────

export function decodeEntities(text: string): string {
  if (!text) return text;
  const safe = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const doc = new DOMParser().parseFromString(safe, "text/html");
  return doc.documentElement.textContent ?? text;
}

export function decodeEntitiesDeep(text: string, maxDepth = 2): string {
  if (!text) return text;
  let current = text;
  for (let i = 0; i < maxDepth; i += 1) {
    const next = decodeEntities(current);
    if (next === current) break;
    current = next;
  }
  return current;
}

function normalizeHtmlCodeTags(text: string): string {
  if (!text) return text;
  return text.replace(/<code>([\s\S]*?)<\/code>/gi, (_match, code) => {
    if (code.includes("\n")) {
      return `\n\`\`\`\n${code}\n\`\`\`\n`;
    }
    return `\`${code}\``;
  });
}

function extractRestorableAttributes(tagName: string, rawAttrs: string): string {
  const allowed = RESTORABLE_HTML_ATTRS[tagName];
  if (!allowed || !rawAttrs) return "";

  const attrs: string[] = [];
  const regex = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let match;
  while ((match = regex.exec(rawAttrs))) {
    const name = (match[1] || "").toLowerCase();
    if (!name || name.startsWith("on") || !allowed.has(name)) continue;
    const rawValue = match[2] ?? match[3] ?? match[4] ?? "";
    attrs.push(` ${name}="${escapeHtmlAttr(rawValue)}"`);
  }

  return attrs.join("");
}

function restoreAllowedHtmlTags(text: string): string {
  if (!text) return text;
  return text.replace(/&lt;((?:[^"'<>]|"[^"]*"|'[^']*')*?)(?:&gt;|>)/g, (match, content) => {
    const trimmed = content.trim();
    const isClosing = trimmed.startsWith("/");
    const rawTag = isClosing ? trimmed.slice(1).trim() : trimmed;
    const isSelfClosing = rawTag.endsWith("/");
    const tagContent = isSelfClosing ? rawTag.slice(0, -1).trim() : rawTag;
    const [tagToken = ""] = tagContent.split(/\s+/, 1);
    const tagName = tagToken.toLowerCase();
    if (!tagName || !ALLOWED_HTML_TAGS.has(tagName)) return match;
    if (tagName === "br") {
      return isClosing ? "" : "<br>";
    }
    if (isClosing) return `</${tagName}>`;

    const attrSource = tagContent.slice(tagToken.length).trim();
    const attrs = extractRestorableAttributes(tagName, attrSource);
    return `<${tagName}${attrs}>`;
  });
}

// ── Stage 1: Pre-processing ────────────────────────────────────────────────

function extractLeadingYamlFrontmatter(text: string): { text: string; frontmatter: string | null } {
  if (!text) return { text: "", frontmatter: null };
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { text: normalized, frontmatter: null };
  }

  const lines = normalized.split("\n");
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

  const frontmatter = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n").replace(/^\n+/, "");
  return { text: body, frontmatter };
}

function normalizeLeadingFrontmatter(text: string): string {
  const { text: body, frontmatter } = extractLeadingYamlFrontmatter(text);
  if (frontmatter === null) return body;
  return [
    "<!--frontmatter-block-start-->",
    "```yaml",
    frontmatter,
    "```",
    "<!--frontmatter-block-end-->",
    body,
  ].filter(Boolean).join("\n\n");
}

function normalizeMathFences(text: string): string {
  if (!text) return text;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const output: string[] = [];
  let inMath = false;

  for (const line of lines) {
    if (!inMath && line.trim().match(/^```(?:math|katex|latex)\s*$/i)) {
      inMath = true;
      output.push("$$");
      continue;
    }
    if (inMath && line.trim().match(/^```\s*$/)) {
      inMath = false;
      output.push("$$");
      continue;
    }
    output.push(line);
  }

  return output.join("\n");
}

function extractMermaidBlocks(text: string): { text: string; blocks: string[] } {
  if (!text) return { text: "", blocks: [] };
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const blocks: string[] = [];
  const output: string[] = [];
  let inMermaid = false;
  let current: string[] = [];

  for (const line of lines) {
    if (!inMermaid && line.trim().match(/^```mermaid\s*$/i)) {
      inMermaid = true;
      current = [];
      continue;
    }
    if (inMermaid && line.trim().match(/^```\s*$/)) {
      const idx = blocks.length;
      blocks.push(current.join("\n"));
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
    output.push("```mermaid");
    output.push(...current);
  }

  return { text: output.join("\n"), blocks };
}

// ── Stage 4 helpers ────────────────────────────────────────────────────────

function decodeCodeEntities(html: string): string {
  if (!html) return html;
  const normalize = (value: string) =>
    value
      .replace(/&amp;lt;/g, "&lt;")
      .replace(/&amp;gt;/g, "&gt;")
      .replace(/&amp;quot;/g, "&quot;")
      .replace(/&amp;#39;/g, "&#39;")
      .replace(/&amp;amp;/g, "&amp;");
  return html
    .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_match, code) => `<pre><code>${normalize(code)}</code></pre>`)
    .replace(/<code>([\s\S]*?)<\/code>/g, (_match, code) => `<code>${normalize(code)}</code>`);
}

function decodeTextEntities(html: string): string {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const decode = (value: string) =>
    value
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.nodeValue) continue;
    const next = decode(node.nodeValue);
    if (next !== node.nodeValue) {
      node.nodeValue = next;
    }
  }
  return doc.body.innerHTML;
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(String(value || ""));
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}


function injectMermaidBlocks(html: string, blocks: string[]): string {
  if (!html || !blocks || blocks.length === 0) return html;
  return html.replace(/@@MERMAID_BLOCK_(\d+)@@/g, (_match, idxStr) => {
    const idx = Number(idxStr);
    const raw = blocks[idx] ?? "";
    const decoded = decodeEntitiesDeep(raw, 5);
    const encoded = toBase64(decoded);
    return `<div class="mermaid-container" data-mermaid="${encoded}"><div class="mermaid-loading">Loading diagram...</div></div>`;
  });
}

export function renderMath(html_content: string): string {
  const katex = window.katex;
  if (!katex) return html_content;

  const decodeMath = (value: string) =>
    decodeEntities(value)
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
      .replace(/<br\s*\/?\s*>/gi, "\n");

  const stripCodeBlocks = (html: string) => {
    const blocks: string[] = [];
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

  const restoreCodeBlocks = (html: string, blocks: string[]) => {
    if (!blocks.length) return html;
    return html.replace(/@@CODE_(?:BLOCK|INLINE)_(\d+)@@/g, (_match, idxStr) => {
      const idx = Number(idxStr);
      return blocks[idx] ?? "";
    });
  };

  const stripped = stripCodeBlocks(html_content);
  let processed = stripped.html;

  processed = processed.replace(
    /(^|\n|<br\s*\/?\s*>|<p>|<\/p>)\s*\$\$([\s\S]+?)\$\$\s*(?=\n|<br\s*\/?\s*>|<\/p>|$)/gi,
    (match, leading, tex) => {
      try {
        const rendered = katex.renderToString(decodeMath(tex.trim()), {
          displayMode: true,
          throwOnError: false,
        });
        return `${leading}${rendered}`;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return `<span class="math-error" title="${escapeHtmlAttr(msg)}">${match}</span>`;
      }
    }
  );

  return restoreCodeBlocks(processed, stripped.blocks);
}

function linkifyHashtagsInHtml(html_content: string): string {
  if (!html_content) return html_content;
  const doc = new DOMParser().parseFromString(html_content, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    nodes.push(node as Text);
  }
  for (const textNode of nodes) {
    const value = textNode.nodeValue;
    if (!value) continue;
    HASHTAG_REGEX.lastIndex = 0;
    if (!HASHTAG_REGEX.test(value)) continue;
    HASHTAG_REGEX.lastIndex = 0;
    const parent = textNode.parentElement;
    if (parent && (parent.closest("a") || parent.closest("code") || parent.closest("pre"))) continue;
    const parts = value.split(HASHTAG_REGEX);
    if (parts.length <= 1) continue;
    const fragment = doc.createDocumentFragment();
    parts.forEach((part, idx) => {
      if (idx % 2 === 1) {
        const link = doc.createElement("a");
        link.setAttribute("href", "#");
        link.className = "hashtag";
        link.setAttribute("data-hashtag", part);
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

// ── Pre-processing pipeline ────────────────────────────────────────────────

export function prepareMarkdownSource(text: string): { safeHtml: string; mermaidBlocks: string[] } {
  const normalizedFrontmatter = normalizeLeadingFrontmatter(text || "");
  const normalizedMath = normalizeMathFences(normalizedFrontmatter);
  const { text: stripped, blocks: mermaidBlocks } = extractMermaidBlocks(normalizedMath);

  const decoded = decodeEntitiesDeep(stripped, 2);
  const normalized = normalizeHtmlCodeTags(decoded);
  const escaped = normalized.replace(/</g, "&lt;");
  const safeHtml = restoreAllowedHtmlTags(escaped);

  return { safeHtml, mermaidBlocks };
}

// ── Main exports ───────────────────────────────────────────────────────────

export function renderMarkdown(text: string, options: { sanitize?: boolean } = {}): string {
  if (!text) return "";

  const { safeHtml, mermaidBlocks } = prepareMarkdownSource(text);

  const m = getMarked();
  let html = m
    ? m.parse(safeHtml, { headerIds: false, mangle: false })
    : safeHtml.replace(/\n/g, "<br>");

  html = decodeCodeEntities(html);
  html = decodeTextEntities(html);
  html = applySyntaxHighlighting(html);
  html = renderMath(html);
  html = linkifyHashtagsInHtml(html);
  html = injectMermaidBlocks(html, mermaidBlocks);
  html = sanitizeHtml(html, options);

  return html;
}

export function renderThinkingMarkdown(text: string): string {
  if (!text) return "";
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const decoded = decodeEntitiesDeep(normalized, 2);
  const normalizedHtml = normalizeHtmlCodeTags(decoded);
  const escaped = normalizedHtml
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const safeHtml = restoreAllowedHtmlTags(escaped);
  const m = getMarked();
  let html = m
    ? m.parse(safeHtml, { headerIds: false, mangle: false })
    : safeHtml.replace(/\n/g, "<br>");
  html = decodeCodeEntities(html);
  html = decodeTextEntities(html);
  // Skip math rendering to avoid $ false positives in shell output
  html = sanitizeHtml(html);
  return html;
}

// renderMermaidDiagrams stub removed — full implementation in utils/mermaid-render.ts (#157)
