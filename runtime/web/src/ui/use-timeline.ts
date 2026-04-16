// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { getTimeline, getPostsByHashtag } from '../api.js';
import { cacheTimelineSnapshot, getCachedTimelineSnapshot } from './app-timeline-cache.js';
import { dedupePosts } from './timeline-utils.js';

export function mergeFreshTimelinePosts(currentPosts, freshPosts) {
  const normalizedFreshPosts = Array.isArray(freshPosts) ? freshPosts : [];
  if (!Array.isArray(currentPosts) || currentPosts.length === 0) {
    return normalizedFreshPosts;
  }
  return dedupePosts([...normalizedFreshPosts, ...currentPosts]);
}

export function useTimeline({ preserveTimelineScroll, preserveTimelineScrollTop, chatJid = null, currentHashtag = null, searchQuery = null }) {
  const [posts, setPostsState] = useState(null);
  const [hasMore, setHasMoreState] = useState(false);
  const hasMoreRef = useRef(false);
  const loadMoreRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const lastBeforeIdRef = useRef(null);
  const postsRef = useRef(null);
  const chatTokenRef = useRef(0);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  const shouldCacheCurrentView = !currentHashtag && !searchQuery;

  useEffect(() => {
    chatTokenRef.current += 1;
    // Preserve currently visible posts while the next chat loads so session
    // switching feels instant and the compose box stays visually anchored.
    // Stale fetches are ignored via chatTokenRef.
    lastBeforeIdRef.current = null;
    loadingMoreRef.current = false;
    const cached = shouldCacheCurrentView ? getCachedTimelineSnapshot(chatJid) : null;
    const cachedPosts = cached?.posts ?? null;
    const cachedHasMore = Boolean(cached?.has_more);
    hasMoreRef.current = cachedHasMore;
    setPostsState(cachedPosts);
    setHasMoreState(cachedHasMore);
  }, [chatJid, shouldCacheCurrentView]);

  const cacheCurrentSnapshot = useCallback((nextPosts, nextHasMore) => {
    if (!shouldCacheCurrentView) return;
    cacheTimelineSnapshot(chatJid, {
      posts: Array.isArray(nextPosts) ? nextPosts : [],
      has_more: Boolean(nextHasMore),
    });
  }, [chatJid, shouldCacheCurrentView]);

  const setPosts = useCallback((next) => {
    let resolvedPosts = null;
    setPostsState((prev) => {
      resolvedPosts = typeof next === 'function' ? next(prev) : next;
      return resolvedPosts;
    });
    if (Array.isArray(resolvedPosts)) {
      cacheCurrentSnapshot(resolvedPosts, hasMoreRef.current);
    }
  }, [cacheCurrentSnapshot]);

  const setHasMore = useCallback((next) => {
    let resolvedHasMore = false;
    setHasMoreState((prev) => {
      resolvedHasMore = typeof next === 'function' ? next(prev) : next;
      return resolvedHasMore;
    });
    hasMoreRef.current = Boolean(resolvedHasMore);
    if (Array.isArray(postsRef.current)) {
      cacheCurrentSnapshot(postsRef.current, resolvedHasMore);
    }
  }, [cacheCurrentSnapshot]);

  const loadPosts = useCallback(async (hashtag = null) => {
    const token = chatTokenRef.current;
    try {
      if (hashtag) {
        const result = await getPostsByHashtag(hashtag, 50, 0, chatJid);
        if (token !== chatTokenRef.current) return;
        setPosts(Array.isArray(result.posts) ? result.posts : []);
        setHasMore(false);
      } else {
        const result = await getTimeline(10, null, chatJid);
        if (token !== chatTokenRef.current) return;
        setPosts(Array.isArray(result.posts) ? result.posts : []);
        setHasMore(result.has_more);
      }
    } catch (error) {
      if (token !== chatTokenRef.current) return;
      console.error('Failed to load posts:', error);
    }
  }, [chatJid, setHasMore, setPosts]);

  const refreshTimeline = useCallback(async () => {
    const token = chatTokenRef.current;
    try {
      const result = await getTimeline(10, null, chatJid);
      if (token !== chatTokenRef.current) return;
      setPosts((prev) => mergeFreshTimelinePosts(prev, result.posts));
      setHasMore((prev) => prev || result.has_more);
    } catch (error) {
      if (token !== chatTokenRef.current) return;
      console.error('Failed to refresh timeline:', error);
    }
  }, [chatJid, setHasMore, setPosts]);

  // loadMore reads posts from ref to avoid re-creating on every posts change.
  const loadMore = useCallback(async (options = {}) => {
    const token = chatTokenRef.current;
    const currentPosts = postsRef.current;
    if (!currentPosts || currentPosts.length === 0) return;
    if (loadingMoreRef.current) return;
    const { preserveScroll = true, preserveMode = 'top', allowRepeat = false } = options;
    const applyUpdate = (fn) => {
      if (!preserveScroll) {
        fn();
        return;
      }
      if (preserveMode === 'top') preserveTimelineScrollTop(fn);
      else preserveTimelineScroll(fn);
    };
    const sortedPosts = currentPosts.slice().sort((a, b) => a.id - b.id);
    const oldestId = sortedPosts[0]?.id;
    if (!Number.isFinite(oldestId)) return;
    if (!allowRepeat && lastBeforeIdRef.current === oldestId) return;

    loadingMoreRef.current = true;
    lastBeforeIdRef.current = oldestId;
    try {
      const result = await getTimeline(10, oldestId, chatJid);
      if (token !== chatTokenRef.current) return;
      if (result.posts.length > 0) {
        applyUpdate(() => {
          setPosts(prev => dedupePosts([...result.posts, ...(prev || [])]));
          setHasMore(result.has_more);
        });
      } else {
        setHasMore(false);
      }
    } catch (error) {
      if (token !== chatTokenRef.current) return;
      console.error('Failed to load more posts:', error);
    } finally {
      if (token === chatTokenRef.current) {
        loadingMoreRef.current = false;
      }
    }
  }, [chatJid, preserveTimelineScroll, preserveTimelineScrollTop, setHasMore, setPosts]);

  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  return {
    posts,
    setPosts,
    hasMore,
    setHasMore,
    hasMoreRef,
    loadPosts,
    refreshTimeline,
    loadMore,
    loadMoreRef,
    loadingMoreRef,
    lastBeforeIdRef,
  };
}
