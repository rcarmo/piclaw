// @ts-nocheck
import { useCallback, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { getTimeline, getPostsByHashtag } from '../api.js';
import { cacheTimelineSnapshot, getCachedTimelineSnapshot } from './app-timeline-cache.js';
import { dedupePosts } from './timeline-utils.js';

export function mergeFreshTimelinePosts(currentPosts, freshPosts) {
  const currentArray = Array.isArray(currentPosts) ? currentPosts : [];
  const freshArray = Array.isArray(freshPosts) ? freshPosts : null;
  if (!freshArray) return currentArray;
  if (freshArray.length === 0) return freshArray;
  if (currentArray.length === 0) return freshArray;
  // Window-replace merge: fresh is authoritative for its own id range.
  // Drop cached rows whose id falls within the fresh window (>= minFreshId)
  // so a row that disappeared server-side (deleted elsewhere, branch reset)
  // does not survive as a phantom; keep older cached rows (id < minFreshId)
  // that were loaded via loadMore.
  let minFreshId = Infinity;
  for (const post of freshArray) {
    const id = post?.id;
    if (typeof id === 'number' && Number.isFinite(id) && id < minFreshId) {
      minFreshId = id;
    }
  }
  if (!Number.isFinite(minFreshId)) {
    return dedupePosts([...freshArray, ...currentArray]);
  }
  const olderCached = currentArray.filter((post) => {
    const id = post?.id;
    return typeof id === 'number' && Number.isFinite(id) && id < minFreshId;
  });
  return dedupePosts([...freshArray, ...olderCached]);
}

export function useTimeline({ preserveTimelineScroll, preserveTimelineScrollTop, chatJid = null, currentHashtag = null, searchQuery = null, onIdentity = null }) {
  const [posts, setPostsState] = useState(null);
  const [hasMore, setHasMoreState] = useState(false);
  const hasMoreRef = useRef(false);
  const loadMoreRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const lastBeforeIdRef = useRef(null);
  const postsRef = useRef(null);
  const chatTokenRef = useRef(0);
  const mutationVersionRef = useRef(0);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  const shouldCacheCurrentView = !currentHashtag && !searchQuery;
  // Mirror the current view-mode in a ref so async callbacks (cache-hit
  // background refresh) can bail out if the user has switched into hashtag
  // or search mode, which does not bump chatTokenRef.
  const viewModeCacheableRef = useRef(shouldCacheCurrentView);
  useEffect(() => {
    viewModeCacheableRef.current = shouldCacheCurrentView;
  }, [shouldCacheCurrentView]);

  useEffect(() => {
    chatTokenRef.current += 1;
    // Preserve currently visible posts while the next chat loads so session
    // switching feels instant and the compose box stays visually anchored.
    // Stale fetches are ignored via chatTokenRef.
    lastBeforeIdRef.current = null;
    loadingMoreRef.current = false;
    hasMoreRef.current = false;
    setHasMoreState(false);
    mutationVersionRef.current = 0;
  }, [chatJid]);

  const cacheCurrentSnapshot = useCallback((nextPosts, nextHasMore) => {
    if (!shouldCacheCurrentView) return;
    cacheTimelineSnapshot(chatJid, {
      posts: Array.isArray(nextPosts) ? nextPosts : [],
      has_more: Boolean(nextHasMore),
    });
  }, [chatJid, shouldCacheCurrentView]);

  const setTimelineState = useCallback((nextPosts, nextHasMore) => {
    postsRef.current = Array.isArray(nextPosts) ? nextPosts : [];
    hasMoreRef.current = Boolean(nextHasMore);
    setPostsState(postsRef.current);
    setHasMoreState(hasMoreRef.current);
    cacheCurrentSnapshot(postsRef.current, hasMoreRef.current);
  }, [cacheCurrentSnapshot]);

  const loadPosts = useCallback(async (hashtag = null) => {
    const token = chatTokenRef.current;
    try {
      if (hashtag) {
        const result = await getPostsByHashtag(hashtag, 50, 0, chatJid);
        if (token !== chatTokenRef.current) return;
        setPostsState(result.posts);
        setHasMoreState(false);
        return;
      }

      const applyFreshPayload = (result) => {
        if (token !== chatTokenRef.current) return;
        const nextPosts = Array.isArray(result?.posts) ? result.posts : [];
        const nextHasMore = Boolean(result?.has_more);
        setTimelineState(nextPosts, nextHasMore);
        if (result?.identity && typeof onIdentity === 'function') onIdentity(result.identity);
      };

      const cached = getCachedTimelineSnapshot(chatJid);
      if (cached) {
        setTimelineState(cached.posts, cached.has_more);
        const backgroundMutationVersion = mutationVersionRef.current;
        void getTimeline(10, null, chatJid)
          .then((result) => {
            if (token !== chatTokenRef.current || mutationVersionRef.current !== backgroundMutationVersion) return;
            // Drop the refresh if the user has switched into hashtag/search
            // mode since the request was kicked off — chatTokenRef does not
            // change across in-chat view-mode transitions, so it would not
            // otherwise invalidate this callback.
            if (!viewModeCacheableRef.current) return;
            const freshPosts = Array.isArray(result?.posts) ? result.posts : [];
            const freshHasMore = Boolean(result?.has_more);
            setTimelineState(mergeFreshTimelinePosts(postsRef.current, freshPosts), freshHasMore);
          })
          .catch((error) => {
            if (token !== chatTokenRef.current) return;
            console.error('Failed to refresh cached timeline:', error);
          });
        return;
      }

      const result = await getTimeline(10, null, chatJid);
      applyFreshPayload(result);
    } catch (error) {
      if (token !== chatTokenRef.current) return;
      console.error('Failed to load posts:', error);
      throw error;
    }
  }, [chatJid, setTimelineState]);

  const refreshTimeline = useCallback(async () => {
    const token = chatTokenRef.current;
    try {
      const result = await getTimeline(10, null, chatJid);
      if (token !== chatTokenRef.current) return;
      setTimelineState(mergeFreshTimelinePosts(postsRef.current, result?.posts), Boolean(result?.has_more));
    } catch (error) {
      if (token !== chatTokenRef.current) return;
      console.error('Failed to refresh timeline:', error);
    }
  }, [chatJid, setTimelineState]);

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
      mutationVersionRef.current += 1;
      if (result.posts.length > 0) {
        applyUpdate(() => {
          const nextPosts = dedupePosts([...result.posts, ...(postsRef.current || [])]);
          setTimelineState(nextPosts, result.has_more);
        });
      } else {
        setTimelineState(postsRef.current || [], false);
      }
    } catch (error) {
      if (token !== chatTokenRef.current) return;
      console.error('Failed to load more posts:', error);
    } finally {
      if (token === chatTokenRef.current) {
        loadingMoreRef.current = false;
      }
    }
  }, [chatJid, preserveTimelineScroll, preserveTimelineScrollTop, setTimelineState]);

  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);

  const setPosts = useCallback((updater) => {
    setPostsState((prev) => {
      const nextPosts = typeof updater === 'function' ? updater(prev) : updater;
      postsRef.current = nextPosts;
      if (Array.isArray(nextPosts)) {
        mutationVersionRef.current += 1;
        // Persist even the empty snapshot: deleting the last visible row must
        // invalidate the prior cached state, otherwise a quick switch-away
        // and back within the TTL would resurrect rows we just removed.
        if (shouldCacheCurrentView) {
          cacheTimelineSnapshot(chatJid, {
            posts: nextPosts,
            has_more: hasMoreRef.current,
          });
        }
      }
      return nextPosts;
    });
  }, [chatJid, shouldCacheCurrentView]);

  return {
    posts,
    setPosts,
    hasMore,
    setHasMore: setHasMoreState,
    hasMoreRef,
    loadPosts,
    refreshTimeline,
    loadMore,
    loadMoreRef,
    loadingMoreRef,
    lastBeforeIdRef,
  };
}
