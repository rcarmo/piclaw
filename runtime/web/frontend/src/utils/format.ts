/** Shared formatting utilities (issue #419). */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
}

/** Compact: "512M", "1.2G" */
export function formatBytesCompact(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${Math.round(mb)}M`;
  return `${(mb / 1024).toFixed(1)}G`;
}

/** "45s", "1m 23s", "2h 5m" */
export function formatDuration(seconds: number): string {
  const secs = Math.floor(Math.max(0, seconds));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** Elapsed from ISO timestamp. */
export function formatElapsed(isoTimestamp: string, nowMs = Date.now()): string {
  const diff = nowMs - Date.parse(isoTimestamp);
  return diff > 0 && Number.isFinite(diff) ? formatDuration(diff / 1000) : "";
}

/** "just now", "5m ago", "3h ago", "2d ago" */
export function formatRelativeTime(timestamp: string | number): string {
  const sec = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** "128k", "1.0M" */
export function formatTokenWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  return `${(tokens / 1000).toFixed(0)}k`;
}
