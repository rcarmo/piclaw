/**
 * export-timeline-endpoint.ts — Serves a self-contained printable HTML page
 * for a chunk of messages.
 *
 * Access: localhost only + valid internal secret header/bearer token.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { marked } from "marked";
import { getWebRuntimeConfig } from "../../../core/config.js";
import { getDb } from "../../../db.js";
import { getMediaById } from "../../../db/media.js";
import { isInternalSecretRequestAuthorized } from "../auth/internal-secret.js";
import { jsonResponse } from "../http/http-utils.js";

export interface ExportTimelineContext {
  runtimeDir: string;
  internalSecret?: string;
}

export function handleExportTimeline(req: Request, ctx: ExportTimelineContext): Response {
  const url = new URL(req.url);
  if (!isLoopbackHostname(url.hostname)) {
    return jsonResponse({ error: "Export endpoint is localhost-only" }, 403);
  }

  const internalSecret = (ctx.internalSecret || getWebRuntimeConfig().internalSecret || "").trim();
  if (!internalSecret) {
    return jsonResponse({ error: "Internal export auth is not configured" }, 503);
  }
  if (!isInternalSecretRequestAuthorized(req, internalSecret)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const chatJid = url.searchParams.get("chat_jid") || "web:default";
  const theme = url.searchParams.get("theme") || "light";
  const fromTs = url.searchParams.get("from") || null;
  const toTs = url.searchParams.get("to") || null;
  const fromRow = url.searchParams.get("from_row") || null;
  const toRow = url.searchParams.get("to_row") || null;
  const lastN = url.searchParams.get("last") || null;

  let messages: ExportMessage[];
  try {
    messages = queryExportMessages(chatJid, { fromTs, toTs, fromRow, toRow, lastN });
  } catch (err: any) {
    return jsonResponse({ error: err.message || String(err) }, 500);
  }

  const css = loadAllCss(ctx.runtimeDir);
  const config = loadConfig();
  const agentName = config?.assistant?.assistantName || "Assistant";
  const userName = config?.user?.userName || "You";
  const agentAvatarSource = String(config?.assistant?.assistantAvatar || "").trim() || null;
  const userAvatarSource = String(config?.user?.userAvatar || "").trim() || null;
  const userAvatarBg = String(config?.user?.userAvatarBackground || "").trim().toLowerCase();

  // Inline avatars as base64 data URIs so wkhtmltopdf renders them
  // without needing to call back into the same server (deadlock).
  const agentAvatar = agentAvatarSource ? resolveAvatarDataUri(agentAvatarSource) : null;
  const userAvatar = userAvatarSource ? resolveAvatarDataUri(userAvatarSource) : null;

  // Build a lookup of referenced message previews for pill rendering.
  const referencedRowIds = extractReferencedRowIds(messages);
  const referencedPreviews = referencedRowIds.size > 0 ? loadReferencedPreviews(chatJid, referencedRowIds) : new Map();

  const html = buildExportHtml({
    theme,
    css,
    origin: url.origin,
    chatJid,
    messages,
    agentName,
    userName,
    agentAvatar: agentAvatar,
    userAvatar: userAvatar,
    userAvatarBg,
    referencedPreviews,
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

type ExportMessage = {
  rowid: number;
  sender: string | null;
  sender_name: string | null;
  content: string | null;
  timestamp: string;
  is_bot_message: number;
  media?: Array<{
    id: number;
    filename: string | null;
    content_type: string | null;
    size: number | null;
  }>;
};

function isLoopbackHostname(hostname: string): boolean {
  const normalized = (hostname || "").trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

function queryExportMessages(
  chatJid: string,
  opts: { fromTs?: string | null; toTs?: string | null; fromRow?: string | null; toRow?: string | null; lastN?: string | null },
): ExportMessage[] {
  const db = getDb();

  const where: string[] = ["chat_jid = ?"];
  const params: (string | number)[] = [chatJid];
  if (opts.fromTs) {
    where.push("timestamp >= ?");
    params.push(opts.fromTs);
  }
  if (opts.toTs) {
    where.push("timestamp <= ?");
    params.push(opts.toTs);
  }
  if (opts.fromRow) {
    where.push("rowid >= ?");
    params.push(Number(opts.fromRow));
  }
  if (opts.toRow) {
    where.push("rowid <= ?");
    params.push(Number(opts.toRow));
  }

  const order = opts.lastN
    ? `ORDER BY rowid DESC LIMIT ${Math.max(1, Number(opts.lastN))}`
    : "ORDER BY rowid ASC";

  const rows = db.prepare(
    `SELECT rowid, sender, sender_name, content, timestamp, is_bot_message
     FROM messages
     WHERE ${where.join(" AND ")}
     ${order}`,
  ).all(...params) as ExportMessage[];

  const messages = opts.lastN ? rows.reverse() : rows;
  if (messages.length === 0) return messages;

  const rowids = messages.map((m) => m.rowid);
  const mediaRows = db.prepare(
    `SELECT mm.message_rowid, m.id, m.filename, m.content_type, length(m.data) as size
     FROM message_media mm
     JOIN media m ON m.id = mm.media_id
     WHERE mm.message_rowid IN (${rowids.map(() => "?").join(",")})
     ORDER BY mm.message_rowid ASC, mm.media_id ASC`,
  ).all(...rowids) as Array<{
    message_rowid: number;
    id: number;
    filename: string | null;
    content_type: string | null;
    size: number | null;
  }>;

  const mediaByMsg = new Map<number, ExportMessage["media"]>();
  for (const row of mediaRows) {
    const list = mediaByMsg.get(row.message_rowid) || [];
    list.push({ id: row.id, filename: row.filename, content_type: row.content_type, size: row.size });
    mediaByMsg.set(row.message_rowid, list);
  }
  for (const msg of messages) msg.media = mediaByMsg.get(msg.rowid) || [];
  return messages;
}

function loadAllCss(runtimeDir: string): string {
  const parts: string[] = [];
  const bundlePath = join(runtimeDir, "web/static/classic/dist/app.bundle.css");
  if (existsSync(bundlePath)) parts.push(readFileSync(bundlePath, "utf8"));
  const cssDir = join(runtimeDir, "web/static/classic/css");
  if (existsSync(cssDir)) {
    for (const entry of readdirSync(cssDir).sort()) {
      if (entry.endsWith(".css")) parts.push(readFileSync(join(cssDir, entry), "utf8"));
    }
  }
  return parts.join("\n");
}

function loadConfig(): any {
  try {
    return JSON.parse(readFileSync("/workspace/.piclaw/config.json", "utf8"));
  } catch {
    return {};
  }
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(parseInt(dec, 10)));
}

function normalizeExportUrlAttribute(raw: string): string {
  return Array.from(decodeHtmlAttribute(raw || "").trim())
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code > 0x1f && code !== 0x7f && !/\s/u.test(ch);
    })
    .join("");
}

function isSafeExportDataImageUrl(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp|bmp|x-icon|svg\+xml);base64,[a-z0-9+/]+=*$/i.test(value);
}

function isSafeExportUrl(raw: string): boolean {
  const value = normalizeExportUrlAttribute(raw);
  if (!value) return false;
  if (isSafeExportDataImageUrl(value)) return true;
  try {
    const url = new URL(value, "https://export.local/");
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function sanitizeMarkdownHtml(html: string): string {
  return html.replace(/\s(href|src)=("([^"]*)"|'([^']*)')/gi, (match, attr, _quoted, doubleValue, singleValue) => {
    const value = doubleValue ?? singleValue ?? "";
    return isSafeExportUrl(value) ? match : ` data-removed-${String(attr).toLowerCase()}="unsafe-url"`;
  });
}

function renderMarkdown(content: string): string {
  // Escape < and & to prevent raw HTML injection, but preserve >
  // so markdown blockquote syntax (> text) works correctly.
  const safe = (content || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
  return sanitizeMarkdownHtml(String(marked.parse(safe, { async: false, gfm: true, breaks: true })));
}

function formatTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return esc(ts);
  return esc(date.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }));
}

function formatSize(bytes: number | null | undefined): string {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read an avatar from a local file path or remote URL and return a data URI. */
function resolveAvatarDataUri(source: string): string | null {
  try {
    let buf: Buffer;
    if (source.startsWith("http://") || source.startsWith("https://")) {
      // Remote URL — fetch with curl (sync, short timeout)
      const res = Bun.spawnSync(
        ["curl", "-sfL", "--max-time", "5", source],
        { stdout: "pipe" },
      );
      if (!res.stdout || res.stdout.length === 0) return null;
      buf = Buffer.from(res.stdout);
    } else {
      // Local file path
      if (!existsSync(source)) return null;
      buf = Buffer.from(readFileSync(source));
    }
    if (buf.length < 8) return null;
    let mime = "image/png";
    if (buf[0] === 0x52 && buf[1] === 0x49) mime = "image/webp";
    else if (buf[0] === 0xff && buf[1] === 0xd8) mime = "image/jpeg";
    else if (buf[0] === 0x89 && buf[1] === 0x50) mime = "image/png";
    else if (buf[0] === 0x47 && buf[1] === 0x49) mime = "image/gif";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Extract all `message:<rowid>` references from message content. */
function extractReferencedRowIds(messages: ExportMessage[]): Set<number> {
  const ids = new Set<number>();
  const pattern = /message:(\d+)/g;
  for (const msg of messages) {
    const text = msg.content || "";
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      ids.add(Number(match[1]));
    }
  }
  return ids;
}

/** Load short previews of referenced messages for pill rendering. */
function loadReferencedPreviews(chatJid: string, rowIds: Set<number>): Map<number, { sender_name: string; preview: string; is_bot: boolean }> {
  const db = getDb();
  const ids = Array.from(rowIds);
  const rows = db.prepare(
    `SELECT rowid, sender_name, content, is_bot_message
     FROM messages
     WHERE rowid IN (${ids.map(() => "?").join(",")})`
  ).all(...ids) as Array<{ rowid: number; sender_name: string | null; content: string | null; is_bot_message: number }>;
  const map = new Map<number, { sender_name: string; preview: string; is_bot: boolean }>();
  for (const row of rows) {
    const text = (row.content || "").replace(/\n/g, " ").trim();
    const preview = text.length > 80 ? text.slice(0, 77) + "…" : text;
    map.set(row.rowid, {
      sender_name: row.sender_name || "Unknown",
      preview,
      is_bot: row.is_bot_message === 1,
    });
  }
  return map;
}

/** Replace `Referenced messages:\n- message:<id>` blocks with styled pills. */
function renderReferencedPills(
  html: string,
  previews: Map<number, { sender_name: string; preview: string; is_bot: boolean }>,
): string {
  // The markdown renderer turns the content into:
  //   <p>Referenced messages:</p>\n<ul>\n<li>message:12345</li>\n</ul>
  // or sometimes just: ...message:12345...
  // Replace the full block first, then any inline remnants.
  html = html.replace(
    /<p>Referenced messages:<\/p>\s*<ul>([\s\S]*?)<\/ul>/gi,
    (_match, listContent: string) => {
      const pills = listContent.replace(/message:(\d+)/g, (_m: string, id: string) => {
        const rowId = Number(id);
        const ref = previews.get(rowId);
        if (!ref) return `<span class="ref-pill ref-missing">message:${esc(id)}</span>`;
        return `<span class="ref-pill${ref.is_bot ? " ref-agent" : ""}"><span class="ref-pill-author">${esc(ref.sender_name)}</span> <span class="ref-pill-preview">${esc(ref.preview)}</span></span>`;
      });
      return `<div class="ref-pills">${pills.replace(/<\/?li>/g, "").trim()}</div>`;
    },
  );
  // Catch any remaining inline message:NNN references
  html = html.replace(/message:(\d+)/g, (_m, id) => {
    const rowId = Number(id);
    const ref = previews.get(rowId);
    if (!ref) return `<span class="ref-pill ref-missing">message:${id}</span>`;
    return `<span class="ref-pill${ref.is_bot ? " ref-agent" : ""}"><span class="ref-pill-author">${esc(ref.sender_name)}</span> <span class="ref-pill-preview">${esc(ref.preview)}</span></span>`;
  });
  return html;
}

function renderAvatar(params: {
  name: string;
  url: string | null;
  isAgent: boolean;
  userAvatarBg: string;
}): string {
  const cls = `post-avatar${params.isAgent ? " agent-avatar" : ""}${params.url ? " has-image" : ""}`;
  const clearBg = !params.isAgent && params.url && (params.userAvatarBg === "clear" || params.userAvatarBg === "transparent");
  const style = clearBg ? ' style="background-color:transparent"' : "";
  if (params.url) {
    return `<div class="${cls}"${style}><img src="${esc(params.url)}" alt="${esc(params.name)}"/></div>`;
  }
  const initial = esc((params.name.trim()[0] || "?").toUpperCase());
  return `<div class="${cls}"${style}>${initial}</div>`;
}

function mediaImageDataUri(id: number, contentType: string | null): string | null {
  const type = String(contentType || "").trim().toLowerCase();
  if (!type.startsWith("image/")) return null;
  const media = getMediaById(id);
  if (!media?.data?.length) return null;
  const mime = String(media.content_type || type || "image/png").trim().toLowerCase();
  if (!mime.startsWith("image/")) return null;
  return `data:${mime};base64,${Buffer.from(media.data).toString("base64")}`;
}

function renderMedia(media: NonNullable<ExportMessage["media"]>, _origin: string): string {
  if (!media.length) return "";
  return `<div class="post-attachments" style="margin-top:6px">${media.map((item) => {
    const isImage = (item.content_type || "").startsWith("image/");
    if (isImage) {
      const src = mediaImageDataUri(item.id, item.content_type);
      if (src) {
        return `<img src="${esc(src)}" alt="${esc(item.filename || "")}" style="max-width:100%;border-radius:8px;margin:4px 0"/>`;
      }
    }
    return `<div class="attachment-pill" style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border:1px solid var(--border-color);border-radius:8px;font-size:12px;margin:2px 4px 2px 0"><span>${esc(item.filename || `file-${item.id}`)}</span><span style="color:var(--text-secondary)">${esc(formatSize(item.size))}</span></div>`;
  }).join("")}</div>`;
}

function buildExportHtml(opts: {
  theme: string;
  css: string;
  origin: string;
  chatJid: string;
  messages: ExportMessage[];
  agentName: string;
  userName: string;
  agentAvatar: string | null;
  userAvatar: string | null;
  userAvatarBg: string;
  referencedPreviews: Map<number, { sender_name: string; preview: string; is_bot: boolean }>;
}): string {
  const isDark = opts.theme === "dark";
  const fg = isDark ? "#e7e9ea" : "#0f1419";
  const muted = isDark ? "#8b98a5" : "#536471";
  const border = isDark ? "#2f3336" : "#d7dce0";
  const subtle = isDark ? "#16181c" : "#f7f9fa";
  const accent = "#1d9bf0";

  const printCss = `
    @page { margin: 16mm 14mm; size: A4; }
    html, body {
      height: auto !important; min-height: 0 !important; max-height: none !important;
      overflow: visible !important; position: static !important;
      background: ${isDark ? "#000" : "#fff"} !important;
      color: ${fg} !important;
      -webkit-print-color-adjust: exact; print-color-adjust: exact; color-adjust: exact;
    }
    body {
      margin: 0 !important;
      position: static !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
      font-size: 15px !important;
      line-height: 1.5 !important;
      background: ${isDark ? "#000" : "#fff"} !important;
      color: ${fg} !important;
    }
    #app, #app > *, .timeline, .timeline-content, .export-root {
      height: auto !important; max-height: none !important; overflow: visible !important;
      display: block !important; position: static !important; flex: initial !important;
    }
    .timeline-content.export-shell {
      padding: 16px 24px !important;
      max-width: 920px;
      margin: 0 auto;
    }
    .export-meta {
      margin: 0 0 16px !important;
      color: ${muted} !important;
      font-size: 12px !important;
    }
    .post {
      display: table !important;
      width: 100% !important;
      table-layout: fixed;
      margin: 0 !important;
      padding: 14px 0 !important;
      background: transparent !important;
      color: ${fg} !important;
      border: 0 !important;
      border-bottom: 1px solid ${border} !important;
      border-radius: 0 !important;
      break-inside: avoid;
      page-break-inside: avoid;
      animation: none !important;
      box-shadow: none !important;
    }
    .post:first-of-type {
      border-top: 1px solid ${border} !important;
    }
    .post-avatar,
    .post-body {
      display: table-cell !important;
      vertical-align: top;
    }
    .post-avatar {
      width: 42px !important;
      min-width: 42px !important;
      height: 42px !important;
      border-radius: 9999px !important;
      background: ${subtle} !important;
      border: 0 !important;
      color: ${fg} !important;
      text-align: center !important;
      font-weight: 700 !important;
      font-size: 17px !important;
      line-height: 42px !important;
      overflow: hidden !important;
    }
    .post-avatar img {
      display: block !important;
      width: 42px !important;
      height: 42px !important;
      object-fit: cover !important;
      border-radius: 9999px !important;
    }
    .post-avatar.agent-avatar.has-image { background: transparent !important; }
    .post-body {
      padding-left: 12px !important;
      width: auto !important;
    }
    .post-meta {
      margin: 0 0 4px !important;
      font-size: 12px !important;
      color: ${muted} !important;
    }
    .post-author {
      font-weight: 700 !important;
      color: ${fg} !important;
      margin-right: 8px !important;
    }
    .post-time {
      color: ${muted} !important;
    }
    .post-content,
    .post-content p,
    .post-content li,
    .post-content blockquote {
      color: ${fg} !important;
    }
    .post-content p { margin: 0 0 8px !important; }
    .post-content p:last-child { margin-bottom: 0 !important; }
    .post-content a {
      color: ${accent} !important;
      text-decoration: underline !important;
    }
    .post-content pre {
      white-space: pre-wrap !important;
      word-break: break-word !important;
      margin: 10px 0 !important;
      padding: 10px 12px !important;
      border: 1px solid ${border} !important;
      border-radius: 10px !important;
      background: ${subtle} !important;
      color: ${fg} !important;
      font-size: 12px !important;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
    }
    .post-content code {
      font-size: 12px !important;
      background: ${subtle} !important;
      padding: 1px 4px !important;
      border-radius: 4px !important;
    }
    .post-content ul,
    .post-content ol {
      margin: 8px 0 10px 22px !important;
    }
    .post-content blockquote {
      margin: 10px 0 !important;
      padding: 0 0 0 12px !important;
      border-left: 3px solid ${border} !important;
    }
    .post-content img {
      display: block !important;
      max-width: 100% !important;
      height: auto !important;
      border-radius: 10px !important;
      margin: 8px 0 !important;
      border: 1px solid ${border} !important;
    }
    .post-attachments { margin-top: 8px !important; }
    .post-attachments img {
      display: block !important;
      max-width: 100% !important;
      height: auto !important;
      border-radius: 10px !important;
      margin: 6px 0 !important;
      border: 1px solid ${border} !important;
    }
    .attachment-pill {
      display: inline-block !important;
      padding: 6px 10px !important;
      border: 1px solid ${border} !important;
      border-radius: 9999px !important;
      font-size: 12px !important;
      margin: 2px 6px 2px 0 !important;
      color: ${fg} !important;
      background: ${subtle} !important;
    }
    .post:hover { background: transparent !important; }
    .post-actions, .post-delete-btn, .compose-box, .sidebar, .header-bar, .dock-panel { display: none !important; }
    .ref-pills { margin: 6px 0 8px !important; }
    .ref-pill {
      display: inline-flex !important;
      align-items: baseline !important;
      gap: 6px !important;
      padding: 4px 10px !important;
      border: 1px solid ${border} !important;
      border-radius: 9999px !important;
      font-size: 12px !important;
      margin: 2px 4px 2px 0 !important;
      color: ${muted} !important;
      background: ${subtle} !important;
      max-width: 100% !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    .ref-pill-author {
      font-weight: 600 !important;
      color: ${fg} !important;
      flex-shrink: 0 !important;
    }
    .ref-pill-preview {
      color: ${muted} !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }
    .ref-pill.ref-agent { border-left: 3px solid ${accent} !important; }
    .ref-pill.ref-missing { opacity: 0.5 !important; font-style: italic !important; }
  `;

  const posts = opts.messages.map((msg) => {
    const isAgent = msg.is_bot_message === 1;
    const name = isAgent ? opts.agentName : opts.userName;
    const avatarUrl = isAgent ? opts.agentAvatar : opts.userAvatar;
    return `<div class="post${isAgent ? " agent-post" : ""}">
      ${renderAvatar({ name, url: avatarUrl, isAgent, userAvatarBg: opts.userAvatarBg })}
      <div class="post-body">
        <div class="post-meta">
          <span class="post-author">${esc(name)}</span>
          <span class="post-time">${formatTime(msg.timestamp)}</span>
        </div>
        <div class="post-content">${renderReferencedPills(renderMarkdown(msg.content || ""), opts.referencedPreviews)}</div>
        ${renderMedia(msg.media || [], opts.origin)}
      </div>
    </div>`;
  }).join("\n");

  return `<!doctype html>
<html lang="en" data-theme="${esc(opts.theme)}" data-render-done="true">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<base href="${esc(`${opts.origin}/`)}"/>
<title>Timeline export — ${esc(opts.chatJid)}</title>
<style>${opts.css}\n${printCss}</style>
</head>
<body class="timeline-export-document ${isDark ? "dark" : "light"}" style="background:${isDark ? "#000" : "#fff"}">
  <div id="export-root" class="export-root">
    <div class="timeline normal" style="height:auto;overflow:visible">
      <div class="timeline-content export-shell" style="padding:16px 24px">
        <p class="export-meta">Chat: ${esc(opts.chatJid)} · Messages: ${opts.messages.length}</p>
        ${posts || '<div class="post"><div class="post-body"><div class="post-content"><p>No messages matched the requested range.</p></div></div></div>'}
      </div>
    </div>
  </div>
</body>
</html>`;
}
