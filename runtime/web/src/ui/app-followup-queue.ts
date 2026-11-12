export interface FollowupQueueItemLike {
  row_id?: string | number | null;
  mode?: unknown;
  [key: string]: unknown;
}

export interface TimelinePostLike {
  id?: string | number | null;
  data?: {
    is_bot_message?: boolean;
    content?: unknown;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export const LEGACY_QUEUE_STATUS = 'Queued as a follow-up (one-at-a-time).';
export const QUEUE_PLACEHOLDER_MARKER = '\u2063';

function isPlaceholderBotPost(post: TimelinePostLike | null | undefined): boolean {
  if (!post?.data?.is_bot_message) return false;
  const content = post.data.content;
  return content === LEGACY_QUEUE_STATUS || content === QUEUE_PLACEHOLDER_MARKER;
}

export function filterQueuedTimelinePosts<T extends TimelinePostLike>(
  items: T[] | null | undefined,
  queueRowIds: Set<string | number> | null | undefined,
): T[] | null | undefined {
  if (!items || !Array.isArray(items)) return items;
  const hiddenIds = new Set(queueRowIds || []);
  const filtered = items.filter((post) => !hiddenIds.has(post?.id as string | number) && !isPlaceholderBotPost(post));
  return filtered.length === items.length ? items : filtered;
}

/** Steering is placed after the current tool round, before any follow-up, so it is listed first. */
export function orderFollowupQueueItems<T extends FollowupQueueItemLike>(items: T[]): T[] {
  return [...items.filter((item) => item?.mode === 'steer'), ...items.filter((item) => item?.mode !== 'steer')];
}

export function normalizeFollowupQueueItems<T extends FollowupQueueItemLike>(
  items: T[] | null | undefined,
  dismissedRowIds: Set<string | number> | null | undefined,
): T[] {
  const dismissed = dismissedRowIds || new Set<string | number>();
  return Array.isArray(items)
    ? orderFollowupQueueItems(items
        .map((item) => ({ ...item }))
        .filter((item) => !dismissed.has(item.row_id as string | number)))
    : [];
}

/** Move one row within its mode group; null when the move crosses groups or is out of range. */
export function moveFollowupQueueItem<T extends FollowupQueueItemLike>(items: T[], fromIndex: number, toIndex: number): T[] | null {
  if (!Array.isArray(items) || fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return null;
  if ((items[fromIndex]?.mode === 'steer') !== (items[toIndex]?.mode === 'steer')) return null;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return next;
}

/** Show a row in a delivery mode at once (steering on click, the previous mode on failure). */
export function setFollowupQueueItemMode<T extends FollowupQueueItemLike>(items: T[], rowId: string | number, mode: unknown): T[] {
  return orderFollowupQueueItems(items.map((item) => {
    if (item?.row_id !== rowId) return item;
    const next = { ...item };
    if (mode === undefined) delete next.mode; else next.mode = mode;
    return next;
  }));
}

export function haveSameFollowupQueueRows(
  previous: Array<FollowupQueueItemLike> | null | undefined,
  next: Array<FollowupQueueItemLike> | null | undefined,
): boolean {
  if (!Array.isArray(previous) || !Array.isArray(next)) return false;
  return previous.length === next.length && previous.every((item, index) => item?.row_id === next[index]?.row_id && item?.mode === next[index]?.mode);
}

export function removeFollowupQueueRow<T extends FollowupQueueItemLike>(
  items: T[] | null | undefined,
  rowId: string | number | null | undefined,
): { items: T[]; remainingQueueCount: number } {
  const nextItems = Array.isArray(items) && rowId != null
    ? items.filter((item) => item?.row_id !== rowId)
    : (Array.isArray(items) ? [...items] : []);
  return {
    items: nextItems,
    remainingQueueCount: nextItems.length,
  };
}

export function appendFollowupQueueItem(
  items: FollowupQueueItemLike[] | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): FollowupQueueItemLike[] {
  const currentItems = Array.isArray(items) ? items : [];
  const rowId = payload?.row_id as string | number | null | undefined;
  const content = payload?.content;

  if (rowId == null || typeof content !== 'string' || !content.trim()) {
    return currentItems;
  }

  if (currentItems.some((item) => item?.row_id === rowId)) {
    return currentItems;
  }

  return orderFollowupQueueItems([
    ...currentItems,
    {
      row_id: rowId,
      ...(payload?.mode === 'steer' || payload?.mode === 'followUp' ? { mode: payload.mode } : {}),
      ...(typeof payload?.source === 'string' ? {source:payload.source}: {}),
      content,
      timestamp: payload?.timestamp || null,
      thread_id: payload?.thread_id ?? null,
    },
  ]);
}

export function shouldRefreshQueueStateFromResponse(response: Record<string, any> | null | undefined): boolean {
  if (!response || typeof response !== 'object') return false;
  if (response.queued === 'followup' || response.queued === 'steer') return true;
  const commandResult = response.command;
  return Boolean(
    commandResult
      && typeof commandResult === 'object'
      && (commandResult.queued_followup || commandResult.queued_steer),
  );
}
