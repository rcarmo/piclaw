type TimelinePayload = {
  posts?: any[];
  has_more?: boolean;
};

type TimelineSnapshot = {
  posts: any[];
  has_more: boolean;
  cachedAt: number;
};

const TIMELINE_CACHE_LIMIT = 24;
const TIMELINE_CACHE_TTL_MS = 10 * 60 * 1000;
const timelineCache = new Map<string, TimelineSnapshot>();

function nowMs(): number {
  return Date.now();
}

function normalizeChatJid(chatJid: string | null | undefined): string {
  return String(chatJid || '').trim();
}

function isFresh(snapshot: TimelineSnapshot | null | undefined, maxAgeMs = TIMELINE_CACHE_TTL_MS): snapshot is TimelineSnapshot {
  return Boolean(snapshot && (nowMs() - snapshot.cachedAt) <= maxAgeMs);
}

function pruneCacheMap(cache: Map<string, TimelineSnapshot>): void {
  while (cache.size > TIMELINE_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function touchCacheEntry(chatJid: string, snapshot: TimelineSnapshot): TimelineSnapshot {
  timelineCache.delete(chatJid);
  timelineCache.set(chatJid, snapshot);
  pruneCacheMap(timelineCache);
  return snapshot;
}

export function cacheTimelineSnapshot(chatJid: string | null | undefined, payload: TimelinePayload): TimelineSnapshot | null {
  const normalizedChatJid = normalizeChatJid(chatJid);
  if (!normalizedChatJid) return null;
  const snapshot: TimelineSnapshot = {
    posts: Array.isArray(payload?.posts) ? payload.posts : [],
    has_more: Boolean(payload?.has_more),
    cachedAt: nowMs(),
  };
  return touchCacheEntry(normalizedChatJid, snapshot);
}

export function getCachedTimelineSnapshot(
  chatJid: string | null | undefined,
  options: { maxAgeMs?: number } = {},
): TimelineSnapshot | null {
  const normalizedChatJid = normalizeChatJid(chatJid);
  if (!normalizedChatJid) return null;
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? Number(options.maxAgeMs) : TIMELINE_CACHE_TTL_MS;
  const snapshot = timelineCache.get(normalizedChatJid) || null;
  if (!isFresh(snapshot, maxAgeMs)) {
    return null;
  }
  return touchCacheEntry(normalizedChatJid, snapshot);
}

export function clearTimelineSnapshotCache(): void {
  timelineCache.clear();
}
