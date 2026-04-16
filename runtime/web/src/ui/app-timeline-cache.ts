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
const prewarmInFlight = new Map<string, Promise<void>>();

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

export function cacheTimelineSnapshot(
  chatJid: string | null | undefined,
  payload: TimelinePayload,
): TimelineSnapshot | null {
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

export function resolveRecentTimelinePrewarmChatJids(chats: unknown, currentChatJid: string | null | undefined, limit = 5): string[] {
  if (!Array.isArray(chats)) return [];
  const normalizedCurrentChatJid = normalizeChatJid(currentChatJid);
  const maxRows = Number.isFinite(limit) ? Math.max(1, Math.min(8, Number(limit))) : 5;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const chat of chats) {
    const chatJid = normalizeChatJid(chat?.chat_jid);
    if (!chatJid || chatJid === normalizedCurrentChatJid || seen.has(chatJid)) continue;
    seen.add(chatJid);
    result.push(chatJid);
    if (result.length >= maxRows) break;
  }
  return result;
}

export async function prewarmTimelineSnapshots(options: {
  chatJids: string[];
  fetchTimeline: (chatJid: string) => Promise<TimelinePayload>;
  maxAgeMs?: number;
  maxConcurrent?: number;
}): Promise<void> {
  const uniqueChatJids = Array.from(new Set((options.chatJids || []).map((chatJid) => normalizeChatJid(chatJid)).filter(Boolean)));
  if (uniqueChatJids.length === 0) return;
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? Number(options.maxAgeMs) : TIMELINE_CACHE_TTL_MS;
  const maxConcurrent = Number.isFinite(options.maxConcurrent) ? Math.max(1, Math.min(4, Number(options.maxConcurrent))) : 2;
  const pending = uniqueChatJids.filter((chatJid) => !isFresh(getCachedTimelineSnapshot(chatJid, { maxAgeMs }), maxAgeMs));
  let cursor = 0;
  const workers = Array.from({ length: Math.min(maxConcurrent, pending.length) }, async () => {
    while (cursor < pending.length) {
      const chatJid = pending[cursor++];
      const existing = prewarmInFlight.get(chatJid);
      if (existing) {
        await existing;
        continue;
      }
      const task = (async () => {
        try {
          const payload = await options.fetchTimeline(chatJid);
          cacheTimelineSnapshot(chatJid, payload);
        } catch (error) {
          console.debug('[app-timeline-cache] Ignoring timeline prewarm failure for a best-effort background fetch.', error, {
            chatJid,
          });
        } finally {
          prewarmInFlight.delete(chatJid);
        }
      })();
      prewarmInFlight.set(chatJid, task);
      await task;
    }
  });
  await Promise.all(workers);
}

export function clearTimelineSnapshotCache(): void {
  timelineCache.clear();
  prewarmInFlight.clear();
}
