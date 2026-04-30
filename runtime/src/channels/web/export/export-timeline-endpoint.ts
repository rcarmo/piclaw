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
  const agentAvatar = config?.assistant?.assistantAvatar ? "/avatar/agent" : null;
  const userAvatar = config?.user?.userAvatar ? "/avatar/user" : null;
  const userAvatarBg = String(config?.user?.userAvatarBackground || "").trim().toLowerCase();

  const html = buildExportHtml({
    theme,
    css,
    origin: url.origin,
    chatJid,
    messages,
    agentName,
    userName,
    agentAvatar,
    userAvatar,
    userAvatarBg,
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
  content_blocks: string | null;
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
  const { getDb } = require("../../../db.js");
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
    `SELECT rowid, sender, sender_name, content, timestamp, is_bot_message, content_blocks
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
  const bundlePath = join(runtimeDir, "web/static/dist/app.bundle.css");
  if (existsSync(bundlePath)) parts.push(readFileSync(bundlePath, "utf8"));
  const cssDir = join(runtimeDir, "web/static/css");
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

function isSafeExportUrl(raw: string): boolean {
  const value = decodeHtmlAttribute(raw || "").trim().replace(/[\u0000-\u001f\u007f\s]+/g, "");
  if (!value) return false;
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
  const safe = (content || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

function renderMedia(media: NonNullable<ExportMessage["media"]>, origin: string): string {
  if (!media.length) return "";
  return `<div class="post-attachments" style="margin-top:6px">${media.map((item) => {
    const isImage = (item.content_type || "").startsWith("image/");
    if (isImage) {
      return `<img src="${esc(`${origin}/media/${item.id}`)}" alt="${esc(item.filename || "")}" style="max-width:100%;border-radius:8px;margin:4px 0"/>`;
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
}): string {
  const isDark = opts.theme === "dark";
  const fg = isDark ? "#e7e9ea" : "#0f1419";
  const muted = isDark ? "#8b98a5" : "#536471";
  const border = isDark ? "#2f3336" : "#d7dce0";
  const card = isDark ? "#0f1113" : "#ffffff";
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
    .post-attachments { margin-top: 8px !important; }
    .post-attachments img {
      display: block !important;
      max-width: 100% !important;
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
        <div class="post-content">${renderMarkdown(msg.content || "")}</div>
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
