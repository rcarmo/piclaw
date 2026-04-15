/**
 * web/http/server-timing.ts – minimal helpers for correlated backend timing.
 */

export interface ServerTimingMetric {
  name: string;
  durationMs: number;
  description?: string | null;
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function sanitizeToken(value: string): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_\-.]/g, "_")
    .slice(0, 64);
}

function sanitizeDescription(value: string): string {
  return String(value || "")
    .replace(/["\\]/g, "")
    .trim()
    .slice(0, 120);
}

function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs)) return "0";
  return (Math.max(0, durationMs) + Number.EPSILON).toFixed(1);
}

function formatMetric(metric: ServerTimingMetric): string | null {
  const name = sanitizeToken(metric.name);
  if (!name) return null;
  const parts = [`${name};dur=${formatDuration(metric.durationMs)}`];
  const description = metric.description ? sanitizeDescription(metric.description) : "";
  if (description) {
    parts.push(`desc="${description}"`);
  }
  return parts.join(";");
}

export function appendServerTiming(response: Response, ...metrics: ServerTimingMetric[]): Response {
  for (const metric of metrics) {
    const formatted = formatMetric(metric);
    if (!formatted) continue;
    response.headers.append("Server-Timing", formatted);
  }
  return response;
}

export function measureSync<T>(run: () => T): { result: T; durationMs: number } {
  const startedAt = nowMs();
  const result = run();
  return {
    result,
    durationMs: nowMs() - startedAt,
  };
}

export async function measureAsync<T>(run: () => Promise<T> | T): Promise<{ result: T; durationMs: number }> {
  const startedAt = nowMs();
  const result = await run();
  return {
    result,
    durationMs: nowMs() - startedAt,
  };
}
