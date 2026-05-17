import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import type { Signal } from "@preact/signals";
import { buildChatUrl } from "../../api/chat-jid";
import { normalizePost, mergeInteractions } from "./helpers";
import type { Interaction, TimelineResponse } from "./types";

interface UseTimelineFetchParams {
  setConnected: (v: boolean) => void;
  scrollToBottom: (force?: boolean) => void;
  timelineError: Signal<string | null>;
  listRef: { current: HTMLDivElement | null };
}

/**
 * Manages timeline data: initial fetch, pagination (loadMore),
 * and reconnect refresh. Exposes message state and fetch utilities.
 */
export function useTimelineFetch({
  setConnected,
  scrollToBottom,
  timelineError,
  listRef,
}: UseTimelineFetchParams) {
  const [messages, setMessages] = useState<Interaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const initialTimelineFetchedRef = useRef(false);

  const fetchTimeline = useCallback(async () => {
    const res = await fetch(buildChatUrl("/timeline", { limit: "50" }), {
      credentials: "include",
    });
    if (res.status === 401) {
      setConnected(false);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      posts?: Array<Record<string, unknown>>;
      has_more?: boolean;
      identity?: { user_avatar_url?: string; assistant_avatar_url?: string };
    };
    // Populate global identity signals from timeline response
    if (data.identity) {
      const { userAvatarUrl: uav, assistantAvatarUrl: aav } = await import("../../api/identity");
      if (data.identity.user_avatar_url) uav.value = data.identity.user_avatar_url;
      if (data.identity.assistant_avatar_url) aav.value = data.identity.assistant_avatar_url;
    }
    const posts = (data.posts ?? []).map(normalizePost);
    return { posts, hasMore: data.has_more ?? false };
  }, [setConnected]);

  const refetchTimelineOnReconnect = useCallback(async () => {
    const timeline = await fetchTimeline();
    if (!timeline) return;
    setMessages((prev) => mergeInteractions(prev, timeline.posts));
    setHasMore(timeline.hasMore);
    timelineError.value = null;
    scrollToBottom(true);
    // Ensure scroll after DOM paint
    requestAnimationFrame(() => scrollToBottom(true));
  }, [fetchTimeline, scrollToBottom, timelineError]);

  // Initial fetch
  useEffect(() => {
    async function fetchInitialTimeline() {
      try {
        const timeline = await fetchTimeline();
        if (!timeline) return;
        setMessages((prev) => mergeInteractions(prev, timeline.posts));
        setHasMore(timeline.hasMore);
        timelineError.value = null;
        setConnected(true);
        initialTimelineFetchedRef.current = true;
        // Scroll to bottom after first load — wait for DOM
        setTimeout(() => {
          scrollToBottom(true);
          requestAnimationFrame(() => scrollToBottom(true));
        }, 100);
      } catch {
        setConnected(false);
      }
    }
    fetchInitialTimeline();
  }, [fetchTimeline, scrollToBottom, setConnected, timelineError]);

  const loadMore = async () => {
    if (!messages.length || loadingMore) return;
    const oldestId = messages[0].id;
    setLoadingMore(true);
    try {
      const res = await fetch(
        buildChatUrl("/timeline", { limit: "50", before: String(oldestId) }),
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TimelineResponse = await res.json();
      const olderPosts = (data.posts ?? []).map(normalizePost);
      setHasMore(data.has_more ?? false);
      timelineError.value = null;
      if (olderPosts.length) {
        const el = listRef.current;
        const prevScrollHeight = el?.scrollHeight ?? 0;
        setMessages((prev) => mergeInteractions(olderPosts, prev));
        // Restore scroll position
        requestAnimationFrame(() => {
          if (el) {
            el.scrollTop = el.scrollHeight - prevScrollHeight;
          }
        });
      }
    } catch (err) {
      console.warn("[MessageList] loadMore failed:", err);
      timelineError.value = "Failed to load older messages. Try again.";
    } finally {
      setLoadingMore(false);
    }
  };

  return {
    messages,
    setMessages,
    hasMore,
    loadingMore,
    fetchTimeline,
    loadMore,
    refetchTimelineOnReconnect,
  };
}
