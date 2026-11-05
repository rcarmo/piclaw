import { prepareMarkdownToken } from '../../../../../src/markdown';
import { linkifyChatReferences } from "../../../../../src/ui/chat-reference-links";
/**
 * Full markdown rendering pipeline — ported from upstream piclaw.
 *
 * Pipeline stages:
 *   1. Pre-processing  (frontmatter, math fences, mermaid extraction)
 *   2. Literal Markdown source; parser-scoped HTML policy
 *   3. Markdown render (marked.parse)
 *   4. Post-processing (syntax highlighting, KaTeX math,
 *                        hashtag links, mermaid injection)
 *   5. Sanitization    (DOMParser-based, allows KaTeX/MathML tags)
 */

import { applySyntaxHighlighting } from "./code-highlighting";
import _DOMPurifyModule from "dompurify";
import { renderSvgFences, escapeSvgSource, encodeSvgSource } from "../../../../../src/utils/svg-images";

declare global {
  interface Window {
    __PICLAW_SANITIZE_SVG_FENCES__?: boolean;
  }
}

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

// KaTeX/MathML tags to allow through DOMPurify
const KATEX_TAGS = [
  "math", "semantics", "mrow", "mi", "mn", "mo", "mtext", "mspace",
  "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot",
  "mtable", "mtr", "mtd", "annotation",
];

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:", ""]);

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

export function linkifyHashtagsInHtml(html: string, repositoryUrl: string | null = null): string {
  return linkifyChatReferences(html, repositoryUrl);
}

// ── Pre-processing pipeline ────────────────────────────────────────────────

export function prepareMarkdownSource(text: string): {safeHtml:string} {
  return {safeHtml:normalizeLeadingFrontmatter(text || '')};
}

// ── Main exports ───────────────────────────────────────────────────────────

export function renderMarkdown(text: string, options: { sanitize?: boolean; projectRepository?: string | null } | null = {}): string {
  if (!text) return "";
  const renderOptions = options ?? {};
  return renderSvgFences(text, (part) => renderMarkdownBody(part, renderOptions), (source) => {
    const encoded = encodeSvgSource(source);
    return `<div class="code-block"><div class="code-block__header"><span class="code-block__lang">SVG</span><button type="button" class="code-block__copy" aria-label="Copy code" data-code="${encoded}"><i class="codicon codicon-copy"></i></button></div><pre><code class="language-svg">${escapeSvgSource(source)}</code></pre></div>`;
  }, { sanitize: typeof window === "undefined" || window.__PICLAW_SANITIZE_SVG_FENCES__ !== false });
}

function renderMarkdownBody(text: string, options: { sanitize?: boolean; projectRepository?: string | null }): string {

  const { safeHtml } = prepareMarkdownSource(text);

  const m = getMarked();
  let html = m
    ? m.parse(safeHtml, { headerIds: false, mangle: false, walkTokens: prepareMarkdownToken })
    : escapeHtmlAttr(safeHtml).replace(/\n/g, "<br>");

  html = applySyntaxHighlighting(html);
  html = renderMath(html);
  html = linkifyHashtagsInHtml(html, options.projectRepository);
  html = sanitizeHtml(html, options);

  return html;
}

export function renderThinkingMarkdown(text: string): string {
  if (!text) return "";
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const m = getMarked();
  let html = m ? m.parse(normalized, { walkTokens: (token: Parameters<typeof prepareMarkdownToken>[0]) => prepareMarkdownToken(token, false) }) : escapeHtmlAttr(normalized).replace(/\n/g, '<br>');
  // Skip math rendering to avoid $ false positives in shell output
  html = sanitizeHtml(html);
  return html;
}

// renderMermaidDiagrams stub removed — full implementation in utils/mermaid-render.ts (#157)
