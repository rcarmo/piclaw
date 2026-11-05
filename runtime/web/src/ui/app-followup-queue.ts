export interface FollowupQueueItemLike {
  row_id?: string | number | null;
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

export function normalizeFollowupQueueItems<T extends FollowupQueueItemLike>(
  items: T[] | null | undefined,
  dismissedRowIds: Set<string | number> | null | undefined,
): T[] {
  const dismissed = dismissedRowIds || new Set<string | number>();
  return Array.isArray(items)
    ? items
        .map((item) => ({ ...item }))
        .filter((item) => !dismissed.has(item.row_id as string | number))
    : [];
}

export function haveSameFollowupQueueRows(
  previous: Array<FollowupQueueItemLike> | null | undefined,
  next: Array<FollowupQueueItemLike> | null | undefined,
): boolean {
  if (!Array.isArray(previous) || !Array.isArray(next)) return false;
  return previous.length === next.length && previous.every((item, index) => item?.row_id === next[index]?.row_id);
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

  return [
    ...currentItems,
    {
      row_id: rowId,
      ...(typeof payload?.source === 'string' ? {source:payload.source}: {}),
      content,
      timestamp: payload?.timestamp || null,
      thread_id: payload?.thread_id ?? null,
    },
  ];
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
