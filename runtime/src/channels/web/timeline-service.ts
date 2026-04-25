/**
 * web/timeline-service.ts – Timeline data access for the web UI.
 *
 * Provides paginated timeline queries, hashtag/search filtering, and
 * post deletion with cascade handling for threaded replies.
 *
 * Consumers: web/handlers/posts.ts delegates timeline operations here.
 */

import {
  deleteMessageByRowId,
  deleteThreadByRowId,
  getChatBranchByChatJid,
  getMessageByRowId,
  getMessagesByHashtag,
  getTimeline,
  hasOlderMessages,
  listChatBranches,
  searchMessages,
  searchMessagesAcrossChats,
} from "../../db.js";

import type { InteractionRow } from "../../db/types.js";

const QUEUE_PLACEHOLDER_MARKER = "\u2063";
const LEGACY_QUEUE_STATUS = "Queued as a follow-up (one-at-a-time).";

type QueueFilterablePost = {
  data?: {
    content?: string;
    is_bot_message?: boolean;
  };
};

function isHiddenQueuePlaceholder(post: QueueFilterablePost): boolean {
  const content = post?.data?.content;
  const isBot = Boolean(post?.data?.is_bot_message);
  if (!isBot || typeof content !== "string") return false;
  return content === QUEUE_PLACEHOLDER_MARKER || content === LEGACY_QUEUE_STATUS;
}

function filterHiddenQueuePlaceholders<T extends QueueFilterablePost>(items: T[]): T[] {
  return items.filter((post) => !isHiddenQueuePlaceholder(post));
}

export interface TimelineIdentity {
  assistant_name?: string | null;
  assistant_avatar_url?: string | null;
  user_name?: string | null;
  user_avatar_url?: string | null;
  user_avatar_background?: string | null;
}

/** Build paginated timeline data for GET /timeline. */
export function getTimelineResponse(
  chatJid: string,
  limit: number,
  before?: number,
  identity?: TimelineIdentity | null,
): { status: number; body: unknown } {
  const rawPosts = getTimeline(chatJid, limit, before ?? undefined);
  const posts = filterHiddenQueuePlaceholders(rawPosts);
  const oldestId = rawPosts.length > 0 ? rawPosts[0].id : null;
  const hasMore = oldestId !== null && rawPosts.length === limit && hasOlderMessages(chatJid, oldestId);
  const body: Record<string, unknown> = { posts, limit, has_more: hasMore };
  if (identity) {
    body.identity = identity;
  }
  return { status: 200, body };
}

/** Build timeline data filtered by hashtag. */
export function getHashtagResponse(
  chatJid: string,
  tag: string,
  limit: number,
  offset: number
): { status: number; body: unknown } {
  const posts = getMessagesByHashtag(chatJid, tag, limit, offset);
  return { status: 200, body: { hashtag: tag, posts, limit, offset } };
}

export type SearchScope = "current" | "root" | "all";

function annotateSearchResultsWithAgentNames(results: InteractionRow[]): InteractionRow[] {
  const chatAgentNameCache = new Map<string, string | null>();
  return results.map((row) => {
    if (row?.data?.type !== "agent_response") return row;
    const chatJid = typeof row.chat_jid === "string" ? row.chat_jid.trim() : "";
    if (!chatJid) return row;
    let agentName = chatAgentNameCache.get(chatJid);
    if (agentName === undefined) {
      const branch = getChatBranchByChatJid(chatJid);
      agentName = typeof branch?.agent_name === "string" && branch.agent_name.trim()
        ? branch.agent_name.trim()
        : null;
      chatAgentNameCache.set(chatJid, agentName);
    }
    return agentName ? { ...row, chat_agent_name: agentName } : row;
  });
}

function resolveSearchRootChatJid(chatJid: string, requestedRootChatJid?: string | null): string {
  const branch = getChatBranchByChatJid(chatJid);
  const registryRoot = typeof branch?.root_chat_jid === "string" && branch.root_chat_jid.trim()
    ? branch.root_chat_jid.trim()
    : null;
  const requestedRoot = typeof requestedRootChatJid === "string" && requestedRootChatJid.trim()
    ? requestedRootChatJid.trim()
    : null;
  return registryRoot || requestedRoot || chatJid;
}

/** Build timeline data filtered by search query. */
export function getSearchResponse(
  chatJid: string,
  query: string,
  limit: number,
  offset: number,
  scope: SearchScope = "current",
  rootChatJid?: string | null,
): { status: number; body: unknown } {
  if (!query) return { status: 400, body: { error: "Missing 'q' parameter" } };

  const effectiveRootChatJid = scope === "root" ? resolveSearchRootChatJid(chatJid, rootChatJid) : null;

  let results;
  if (scope === "all") {
    results = searchMessagesAcrossChats(null, query, limit, offset);
  } else if (scope === "root") {
    const branchChatJids = Array.from(new Set(listChatBranches(effectiveRootChatJid).map((branch) => branch.chat_jid)));
    const scopedChatJids = branchChatJids.length > 0
      ? branchChatJids
      : Array.from(new Set([effectiveRootChatJid, chatJid].filter((value): value is string => Boolean(value))));
    results = searchMessagesAcrossChats(scopedChatJids, query, limit, offset);
  } else {
    results = searchMessages(chatJid, query, limit, offset);
  }

  return {
    status: 200,
    body: {
      query,
      results: annotateSearchResultsWithAgentNames(results),
      limit,
      offset,
      scope,
      root_chat_jid: effectiveRootChatJid,
    },
  };
}

/** Build a single thread's messages for GET /thread/:id. */
export function getThreadResponse(chatJid: string, id: number | null): { status: number; body: unknown } {
  if (!id) return { status: 404, body: { error: "Thread not found" } };
  const thread = getMessageByRowId(chatJid, id);
  if (!thread) return { status: 404, body: { error: "Thread not found" } };
  return { status: 200, body: { thread: [thread] } };
}

/** Delete a post and its thread, returning success/error. */
export function deletePostResponse(
  chatJid: string,
  id: number | null,
  cascade = false
): {
  status: number;
  body: unknown;
  deletedIds: number[];
} {
  if (!id) return { status: 404, body: { error: "Post not found" }, deletedIds: [] };
  const deletedIds = cascade
    ? deleteThreadByRowId(chatJid, id)
    : deleteMessageByRowId(chatJid, id)
      ? [id]
      : [];
  return {
    status: 200,
    body: { deleted: deletedIds.length, ids: deletedIds },
    deletedIds,
  };
}
