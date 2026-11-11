/**
 * session-activity.ts — per-session activity summaries for the Classic
 * sessions pane (#1987). Ported from the session-dashboard add-on: activity
 * state, live draft/thinking/tool preview, latest reply and context use.
 */

const PREVIEW_MAX_LENGTH = 220;
const TOOL_DETAIL_MAX_LENGTH = 120;

export interface SessionLivePreview {
  kind: 'draft' | 'thinking' | 'tool';
  label: string;
  text: string;
  turnId?: string;
}

const ACTIVITY_LABELS: Record<string, string> = {
  streaming: 'Streaming',
  working: 'Working',
  compacting: 'Compacting',
  retrying: 'Retrying',
  bash_running: 'Running shell',
};

/** Short activity label for an active session row, or an empty string when idle. */
export function formatSessionActivityStatus(chat: any): string {
  if (!chat?.is_active) return '';
  const status = String(chat.activity_status || '').trim();
  return ACTIVITY_LABELS[status] || 'Working';
}

/** Collapse Markdown and whitespace into one readable line. */
export function cleanSessionPreviewText(value: unknown, maxLength = PREVIEW_MAX_LENGTH): string {
  const text = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```+/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function extractToolArgs(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return extractToolArgs(JSON.parse(value)); } catch { return null; /* expected: tool args are often plain text. */ }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const object = value as Record<string, any>;
  const nested = object.arguments ?? object.input ?? object.params ?? object.parameters ?? object.args ?? object.payload;
  return nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : object;
}

function resolveToolTitle(data: any): string {
  const title = cleanSessionPreviewText(data?.title, PREVIEW_MAX_LENGTH);
  if (title) return title;
  const toolName = cleanSessionPreviewText(data?.tool_name ?? data?.toolName, PREVIEW_MAX_LENGTH);
  if (!toolName) return '';
  const args: any = extractToolArgs(data?.tool_args ?? data?.toolArgs);
  if (!args) return toolName;
  const candidates = [
    args.command,
    Array.isArray(args.commands) ? args.commands.filter((item) => typeof item === 'string').join(' && ') : '',
    args.path ?? args.filePath ?? args.target,
    Array.isArray(args.paths) ? args.paths.filter((item) => typeof item === 'string').join(', ') : '',
    args.fileName ?? args.filename ?? args.file,
    args.url,
    args.query,
  ];
  const detail = candidates
    .map((candidate) => (typeof candidate === 'string' ? cleanSessionPreviewText(candidate, TOOL_DETAIL_MAX_LENGTH) : ''))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0];
  return detail ? `${toolName}: ${detail}` : toolName;
}

function resolveToolPreview(data: any): SessionLivePreview | null {
  const type = typeof data?.type === 'string' ? data.type.trim() : '';
  if (type !== 'tool_call' && type !== 'tool_status') return null;
  const status = cleanSessionPreviewText(data.status ?? data.tool_status ?? data.toolStatus, PREVIEW_MAX_LENGTH);
  if (type === 'tool_status' && /^(done|failed|cancelled|canceled|aborted)$/i.test(status)) return null;
  const suffix = status && !/^working(?:\.{3}|…)?$/i.test(status) ? status : '';
  const text = [resolveToolTitle(data), suffix].filter(Boolean).join(' — ');
  return text ? { kind: 'tool', label: 'Tool', text: cleanSessionPreviewText(text) } : null;
}

function resolveTextPreview(kind: 'draft' | 'thinking', value: any): SessionLivePreview | null {
  const text = cleanSessionPreviewText(typeof value === 'string' ? value : value?.text);
  return text ? { kind, label: kind === 'thinking' ? 'Thinking' : 'Draft', text } : null;
}

/**
 * Live preview for an active session from its /agent/status payload: draft,
 * then thinking, then the running tool. When a tool finishes, the last draft
 * or thought from the same turn is kept instead of dropping to nothing.
 */
export function resolveSessionLivePreview(status: any, retained: SessionLivePreview | null = null): {
  preview: SessionLivePreview | null;
  retained: SessionLivePreview | null;
} {
  if (!status || status.status !== 'active') return { preview: null, retained: null };
  const turnValue = status.data?.turn_id ?? status.data?.turnId;
  const turnId = typeof turnValue === 'string' ? turnValue.trim() : '';
  const sameTurn = turnId && retained?.turnId === turnId ? retained : null;
  const live = resolveTextPreview('draft', status.draft) || resolveTextPreview('thinking', status.thought);
  const nextRetained = live && turnId ? { ...live, turnId } : sameTurn;
  return { preview: live || resolveToolPreview(status.data) || nextRetained, retained: nextRetained };
}

/** Compact age such as "now", "5m", "3h", "2d" or a short date. */
export function formatSessionActivityAge(value: unknown, now = Date.now()): string {
  const time = Date.parse(String(value ?? ''));
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Context use in percent (0–100), or null when unknown. */
export function resolveSessionContextPercent(chat: any): number | null {
  const raw = Number(chat?.context_percent ?? chat?.contextPercent ?? chat?.context_usage?.percent);
  if (Number.isFinite(raw) && raw >= 0) return Math.min(100, raw);
  const tokens = Number(chat?.context_tokens);
  const contextWindow = Number(chat?.context_window);
  if (Number.isFinite(tokens) && Number.isFinite(contextWindow) && contextWindow > 0 && tokens >= 0) {
    return Math.min(100, (tokens / contextWindow) * 100);
  }
  return null;
}

/** Ctrl/Cmd-click and middle-click open a session in a new tab. */
export function isNewTabSessionClick(event: { ctrlKey?: boolean; metaKey?: boolean; button?: number } | null | undefined): boolean {
  return Boolean(event?.ctrlKey || event?.metaKey || event?.button === 1);
}
