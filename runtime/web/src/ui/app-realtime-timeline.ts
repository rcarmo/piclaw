export interface TimelineViewStateLike {
  currentHashtag?: unknown;
  searchQuery?: unknown;
  searchOpen?: unknown;
}

export interface TimelinePostLike {
  id?: unknown;
  [key: string]: unknown;
}

export function isMainTimelineView(viewState: TimelineViewStateLike | null | undefined): boolean {
  return !viewState?.currentHashtag && !viewState?.searchQuery && !viewState?.searchOpen;
}

export function shouldAppendRealtimeTimelinePost(
  eventType: unknown,
  isCurrentChatEvent: boolean,
  isMainTimeline: boolean,
): boolean {
  return Boolean(
    isCurrentChatEvent
      && isMainTimeline
      && (eventType === 'new_post' || eventType === 'new_reply' || eventType === 'agent_response'),
  );
}

export function shouldMutateInteractionTimeline(
  isCurrentChatEvent: boolean,
  isMainTimeline: boolean,
): boolean {
  return isCurrentChatEvent && isMainTimeline;
}

export function appendUniqueTimelinePost<T extends TimelinePostLike>(
  posts: T[] | null | undefined,
  nextPost: T,
): T[] {
  if (!Array.isArray(posts) || posts.length === 0) {
    return [nextPost];
  }
  if (posts.some((post) => post?.id === nextPost?.id)) {
    return posts;
  }
  return [...posts, nextPost];
}

function surfaceRevision(post: TimelinePostLike): number {
  const blocks = (post.data as { content_blocks?: unknown } | undefined)?.content_blocks;
  if (!Array.isArray(blocks)) return 0;
  return blocks.reduce((latest, block) => (
    (block?.type === 'a2ui_surface' || block?.type === 'a2ui_surface_removed') && Number.isSafeInteger(block.revision)
      ? Math.max(latest, block.revision) : latest
  ), 0);
}

export function replaceTimelinePostById<T extends TimelinePostLike>(
  posts: T[] | null | undefined,
  nextPost: T,
): T[] | null | undefined {
  if (!Array.isArray(posts)) return posts;
  const index = posts.findIndex((post) => post?.id === nextPost?.id);
  if (index < 0 || surfaceRevision(posts[index]) > surfaceRevision(nextPost)) return posts;
  return posts.map((post, i) => i === index ? nextPost : post);
}

export function removeTimelinePostsByIds<T extends TimelinePostLike>(
  posts: T[] | null | undefined,
  ids: unknown,
): T[] | null | undefined {
  if (!Array.isArray(posts)) return posts;
  const idList = Array.isArray(ids) ? ids : [];
  if (idList.length === 0) return posts;

  const idSet = new Set(idList);
  const filtered = posts.filter((post) => !idSet.has(post?.id));
  return filtered.length === posts.length ? posts : filtered;
}

/** HTTP acknowledgement and SSE may arrive in either order. Use the durable
 * returned row immediately; appendUniqueTimelinePost keeps both paths idempotent. */
export function appendAcknowledgedTimelinePost<T extends TimelinePostLike>(
  posts: T[] | null | undefined,
  response: any,
  activeChatJid: string,
  viewState: TimelineViewStateLike | null | undefined,
): T[] | null | undefined {
  const post = response?.user_message;
  if (!isMainTimelineView(viewState) || response?.queued || response?.ui_only
    || !post || post.chat_jid !== activeChatJid
    || typeof post.id !== 'number' || !Number.isSafeInteger(post.id) || post.id <= 0) return posts;
  return appendUniqueTimelinePost(posts, post);
}
