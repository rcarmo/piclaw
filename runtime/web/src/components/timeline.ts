import { Component, h, html, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from '../vendor/preact-htm.js';
import { Post } from './post.js';
import { isAnchorScrolling } from '../ui/scroll-anchor.js';
import { getAgentAvatarUrl, getAgentName } from '../ui/agent-utils.js';

export const TIMELINE_WINDOW_SIZE = 16;
export const TIMELINE_WINDOW_THRESHOLD = 100;
export const TIMELINE_REVEAL_EVENT = 'piclaw:reveal-timeline-post';
export const TIMELINE_JUMP_LATEST_EVENT = 'piclaw:jump-timeline-latest';

export function haveSameTimelineProps(currentProps, nextProps) {
    if (currentProps === nextProps) return true;
    const currentKeys = Object.keys(currentProps || {});
    const nextKeys = Object.keys(nextProps || {});
    if (currentKeys.length !== nextKeys.length) return false;
    return currentKeys.every((key) => Object.is(currentProps[key], nextProps[key]));
}

export function getLatestTimelineWindow(postCount, windowSize = TIMELINE_WINDOW_SIZE) {
    const end = Math.max(0, postCount);
    return { start: Math.max(0, end - windowSize), end };
}

export function getTimelineWindowAroundIndex(index, postCount, windowSize = TIMELINE_WINDOW_SIZE) {
    const boundedIndex = Math.max(0, Math.min(index, Math.max(0, postCount - 1)));
    const start = Math.max(0, Math.min(boundedIndex - Math.floor(windowSize / 2), postCount - windowSize));
    return { start, end: Math.min(postCount, start + windowSize) };
}

export function estimateTimelinePostHeight(post) {
    const content = typeof post?.data?.content === 'string' ? post.data.content.length : 0;
    const mediaCount = Array.isArray(post?.data?.media_ids) ? post.data.media_ids.length : 0;
    const blockCount = Array.isArray(post?.data?.content_blocks) ? post.data.content_blocks.length : 0;
    return Math.max(72, Math.min(1200, 76 + content * 0.22 + mediaCount * 220 + blockCount * 120));
}

export function findTimelineIndexAtOffset(prefixHeights, offset) {
    if (prefixHeights.length <= 1) return 0;
    let low = 0;
    let high = prefixHeights.length - 1;
    const target = Math.max(0, offset);
    while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (prefixHeights[middle] <= target) low = middle;
        else high = middle - 1;
    }
    return Math.min(prefixHeights.length - 2, low);
}

/** Render the actual viewport plus a small row buffer, never a fixed number
 * that can leave visible spacer when short rows or the viewport change. */
export function getTimelineViewportWindow(prefixHeights, offset, viewportHeight, atLatest = false) {
    const count = Math.max(0, prefixHeights.length - 1);
    const total = prefixHeights[count] || 0;
    const top = atLatest ? Math.max(0, total - viewportHeight) : Math.max(0, offset);
    const first = findTimelineIndexAtOffset(prefixHeights, top);
    const last = atLatest ? count : Math.min(count, findTimelineIndexAtOffset(prefixHeights, top + viewportHeight) + 1);
    const end = Math.min(count, Math.max(last + 4, first + TIMELINE_WINDOW_SIZE));
    return { start: Math.max(0, Math.min(first - 4, end - TIMELINE_WINDOW_SIZE)), end };
}

/**
 * Keep high-frequency agent-status/draft updates from walking every rendered post.
 * TimelineView still updates normally when timeline data or one of its callbacks changes.
 */
export class Timeline extends Component {
    shouldComponentUpdate(nextProps) {
        return !haveSameTimelineProps(this.props, nextProps);
    }

    render(props) {
        return h(TimelineView, props);
    }
}

/** Keep timeline updates from re-running unchanged mounted post component trees. */
class TimelinePost extends Component {
    shouldComponentUpdate(nextProps) {
        return !haveSameTimelineProps(this.props, nextProps);
    }

    render({ onPostClick, post, ...postProps }) {
        const onClick = onPostClick ? () => onPostClick(post) : undefined;
        return h(Post, { ...postProps, post, onClick });
    }
}

function resolveThreadInfo(displayPosts) {
    const resolveThreadRootId = (post) => {
        const raw = post?.data?.thread_id;
        if (raw === null || raw === undefined || raw === '') return null;
        const threadId = Number(raw);
        return Number.isFinite(threadId) ? threadId : null;
    };

    const threadGroups = new Map();
    for (let index = 0; index < displayPosts.length; index += 1) {
        const post = displayPosts[index];
        const postId = Number(post?.id);
        const threadRootId = resolveThreadRootId(post);
        if (threadRootId !== null) {
            const group = threadGroups.get(threadRootId) || { anchorIndex: -1, replyIndexes: [] };
            group.replyIndexes.push(index);
            threadGroups.set(threadRootId, group);
        } else if (Number.isFinite(postId)) {
            const group = threadGroups.get(postId) || { anchorIndex: -1, replyIndexes: [] };
            group.anchorIndex = index;
            threadGroups.set(postId, group);
        }
    }

    const threadSequences = new Map();
    for (const [threadId, group] of threadGroups.entries()) {
        const ordered = new Set();
        if (group.anchorIndex >= 0) ordered.add(group.anchorIndex);
        for (const index of group.replyIndexes) ordered.add(index);
        threadSequences.set(threadId, Array.from(ordered).sort((a, b) => a - b));
    }

    return displayPosts.map((post, index) => {
        const threadRootId = resolveThreadRootId(post);
        if (threadRootId === null) return { hasThreadPrev: false, hasThreadNext: false };
        const sequence = threadSequences.get(threadRootId);
        const position = sequence?.indexOf(index) ?? -1;
        return {
            hasThreadPrev: position > 0,
            hasThreadNext: position >= 0 && position < sequence.length - 1,
        };
    });
}

/** Timeline component. */
function TimelineView({ posts, hasMore, onLoadMore, onPostClick, onHashtagClick, onMessageRef, onScrollToMessage, onFileRef, onOpenWidget, onOpenAttachmentPreview, onSaveAnnotations, onSubmitCardAction, renderPostAccessory, postCapabilities, emptyMessage, timelineRef, timelineId, agents, user, onDeletePost, reverse = true, removingPostIds, searchQuery, footer = null }) {
    const [loadingMore, setLoadingMore] = useState(false);
    const [loadMoreFailed, setLoadMoreFailed] = useState(false);
    const [windowRange, setWindowRange] = useState({ start: 0, end: 0 });
    const [heightRevision, setHeightRevision] = useState(0);
    const sentinelRef = useRef(null);
    const timelineContentRef = useRef(null);
    const previousPostsRef = useRef([]);
    const measuredHeightsRef = useRef(new Map());
    const hasIntersectionObserver = typeof IntersectionObserver !== 'undefined';
    const displayPosts = useMemo(
        () => Array.isArray(posts) ? posts.slice().sort((a, b) => a.id - b.id) : [],
        [posts],
    );
    const shouldWindow = reverse && hasIntersectionObserver && displayPosts.length > TIMELINE_WINDOW_THRESHOLD;
    const threadInfoByIndex = useMemo(() => resolveThreadInfo(displayPosts), [displayPosts]);
    const virtualHeights = useMemo(() => {
        const prefix = [0];
        for (const post of displayPosts) {
            const measured = measuredHeightsRef.current.get(String(post.id));
            prefix.push(prefix[prefix.length - 1] + (measured ?? estimateTimelinePostHeight(post)));
        }
        return prefix;
    }, [displayPosts, heightRevision]);

    const triggerLoadMore = useCallback(async (retry = false) => {
        if (!onLoadMore || !hasMore || loadingMore || (loadMoreFailed && !retry)) return;
        setLoadingMore(true);
        setLoadMoreFailed(false);
        try {
            await onLoadMore({ preserveScroll: true, preserveMode: 'top' });
        } catch {
            setLoadMoreFailed(true);
        } finally {
            setLoadingMore(false);
        }
    }, [hasMore, loadingMore, loadMoreFailed, onLoadMore]);

    const handleScroll = useCallback((event) => {
        if (isAnchorScrolling(event.target)) return;
        const { scrollTop, scrollHeight, clientHeight } = event.target;
        const distanceFromTop = reverse ? (scrollHeight - clientHeight + scrollTop) : scrollTop;
        if (distanceFromTop < Math.max(300, clientHeight)) triggerLoadMore();

        if (shouldWindow) {
            const contentOffset = reverse
                ? Math.max(0, scrollHeight - clientHeight + scrollTop)
                : Math.max(0, scrollTop);
            const next = getTimelineViewportWindow(virtualHeights, contentOffset, clientHeight, reverse && scrollTop >= -2);
            setWindowRange(current => current.start === next.start && current.end === next.end ? current : next);
        }
    }, [displayPosts.length, reverse, shouldWindow, triggerLoadMore, virtualHeights]);

    useLayoutEffect(() => {
        const root = timelineRef?.current;
        if (!root || !shouldWindow) return;
        let frame = 0;
        const reconcile = () => {
            if (!root.clientHeight || !root.isConnected) return;
            const offset = Math.max(0, virtualHeights[displayPosts.length] - root.clientHeight + root.scrollTop);
            const next = getTimelineViewportWindow(virtualHeights, offset, root.clientHeight, root.scrollTop >= -2);
            setWindowRange(current => current.start === next.start && current.end === next.end ? current : next);
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; reconcile(); }); };
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        observer?.observe(root);
        const visible = () => { if (document.visibilityState !== 'hidden') schedule(); };
        root.addEventListener(TIMELINE_JUMP_LATEST_EVENT, schedule);
        window.addEventListener('pageshow', schedule);
        window.addEventListener('focus', visible);
        document.addEventListener('visibilitychange', visible);
        reconcile();
        return () => { observer?.disconnect(); if (frame) cancelAnimationFrame(frame); root.removeEventListener(TIMELINE_JUMP_LATEST_EVENT, schedule); window.removeEventListener('pageshow', schedule); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
    }, [displayPosts.length, shouldWindow, timelineRef, virtualHeights]);

    useLayoutEffect(() => {
        const previousPosts = previousPostsRef.current;
        previousPostsRef.current = displayPosts;
        if (!shouldWindow) {
            setWindowRange({ start: 0, end: displayPosts.length });
            return;
        }

        setWindowRange((current) => {
            if (previousPosts.length === 0 || current.end === 0) {
                return getTimelineViewportWindow(virtualHeights, 0, timelineRef?.current?.clientHeight || 0, true);
            }
            const wasAtNewest = (timelineRef?.current?.scrollTop ?? 0) >= -2;
            if (wasAtNewest) return getTimelineViewportWindow(virtualHeights, 0, timelineRef?.current?.clientHeight || 0, true);

            const firstVisibleId = previousPosts[current.start]?.id;
            const preservedStart = displayPosts.findIndex((post) => post.id === firstVisibleId);
            return preservedStart >= 0
                ? { start: preservedStart, end: Math.min(displayPosts.length, preservedStart + Math.max(TIMELINE_WINDOW_SIZE, current.end - current.start)) }
                : getLatestTimelineWindow(displayPosts.length);
        });
    }, [displayPosts, shouldWindow]);

    useLayoutEffect(() => {
        if (!shouldWindow || windowRange.end < displayPosts.length || (timelineRef?.current?.scrollTop ?? 0) < -2) return;
        const root = timelineRef?.current;
        if (!root) return;
        const frame = requestAnimationFrame(() => {
            if (root.isConnected && root.scrollTop >= -2 && root.scrollTop !== 0) root.scrollTop = 0;
        });
        return () => cancelAnimationFrame(frame);
    }, [displayPosts.length, shouldWindow, timelineRef, windowRange.end]);

    useEffect(() => {
        if (!shouldWindow || typeof ResizeObserver === 'undefined') return;
        const content = timelineContentRef.current;
        if (!content) return;
        let updateFrame = 0;
        const observer = new ResizeObserver((entries) => {
            let changed = false;
            for (const entry of entries) {
                const id = entry.target.id?.startsWith('post-') ? entry.target.id.slice(5) : '';
                if (!id) continue;
                const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
                const previous = measuredHeightsRef.current.get(id);
                if (Number.isFinite(height) && height > 0 && Math.abs((previous ?? 0) - height) > 1) {
                    measuredHeightsRef.current.set(id, height);
                    changed = true;
                }
            }
            if (changed && !updateFrame) {
                updateFrame = requestAnimationFrame(() => {
                    updateFrame = 0;
                    setHeightRevision((value) => value + 1);
                });
            }
        });
        for (const post of content.querySelectorAll(':scope > .post')) observer.observe(post);
        return () => {
            observer.disconnect();
            if (updateFrame) cancelAnimationFrame(updateFrame);
        };
    }, [shouldWindow, windowRange.start, windowRange.end, displayPosts]);

    useEffect(() => {
        const reveal = (event) => {
            const targetId = String(event?.detail?.id ?? '');
            if (!targetId || !shouldWindow) return;
            const index = displayPosts.findIndex((post) => String(post.id) === targetId);
            if (index >= 0) {
                const root = timelineRef?.current;
                if (root) root.scrollTop = Math.min(0, virtualHeights[index] - (virtualHeights[displayPosts.length] - root.clientHeight));
                setWindowRange(getTimelineWindowAroundIndex(index, displayPosts.length));
            }
        };
        window.addEventListener(TIMELINE_REVEAL_EVENT, reveal);
        return () => window.removeEventListener(TIMELINE_REVEAL_EVENT, reveal);
    }, [displayPosts, shouldWindow, virtualHeights, timelineRef]);

    useEffect(() => {
        if (!hasIntersectionObserver) return;
        const sentinel = sentinelRef.current;
        const root = timelineRef?.current;
        if (!sentinel || !root) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) triggerLoadMore();
        }, {
            root,
            rootMargin: '300px 0px 300px 0px',
            threshold: 0,
        });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasIntersectionObserver, hasMore, onLoadMore, timelineRef, triggerLoadMore]);

    const triggerLoadMoreRef = useRef(triggerLoadMore);
    triggerLoadMoreRef.current = triggerLoadMore;

    useEffect(() => {
        if (hasIntersectionObserver || !timelineRef?.current) return;
        const { scrollTop, scrollHeight, clientHeight } = timelineRef.current;
        const distanceFromTop = reverse ? (scrollHeight - clientHeight + scrollTop) : scrollTop;
        if (distanceFromTop < Math.max(300, clientHeight)) triggerLoadMoreRef.current?.();
    }, [hasIntersectionObserver, posts, hasMore, reverse, timelineRef]);

    useEffect(() => {
        if (!timelineRef?.current || !hasMore || loadingMore) return;
        const { scrollTop, scrollHeight, clientHeight } = timelineRef.current;
        const distanceFromTop = reverse ? (scrollHeight - clientHeight + scrollTop) : scrollTop;
        if (scrollHeight <= clientHeight + 1 || distanceFromTop < Math.max(300, clientHeight)) {
            triggerLoadMoreRef.current?.();
        }
    }, [posts, hasMore, loadingMore, reverse, timelineRef]);

    if (!posts) {
        return html`<div class="loading"><div class="spinner"></div></div>`;
    }

    if (displayPosts.length === 0) {
        return html`
            <div id=${timelineId} class="timeline" ref=${timelineRef}>
                <div class="timeline-content">
                    <div style="padding: var(--spacing-xl); text-align: center; color: var(--text-secondary)">
                        ${emptyMessage || 'No messages yet. Start a conversation!'}
                    </div>
                </div>
            </div>
        `;
    }

    const effectiveRange = shouldWindow
        ? {
            start: Math.max(0, Math.min(windowRange.start, displayPosts.length)),
            end: Math.max(windowRange.start, Math.min(windowRange.end, displayPosts.length)),
        }
        : { start: 0, end: displayPosts.length };
    const visiblePosts = displayPosts.slice(effectiveRange.start, effectiveRange.end);
    const topSpacerHeight = shouldWindow ? virtualHeights[effectiveRange.start] : 0;
    const bottomSpacerHeight = shouldWindow
        ? virtualHeights[displayPosts.length] - virtualHeights[effectiveRange.end]
        : 0;
    const loadMoreSentinel = html`<div class="timeline-sentinel" ref=${sentinelRef}></div>`;

    return html`
        <div id=${timelineId} class="timeline ${reverse ? 'reverse' : 'normal'}" ref=${timelineRef} onScroll=${handleScroll}>
            <div class="timeline-content" ref=${timelineContentRef}>
                ${reverse ? loadMoreSentinel : null}
                ${loadMoreFailed ? html`<button type="button" class="load-more-btn" onClick=${() => triggerLoadMore(true)}>Could not load older messages — retry</button>` : null}
                ${shouldWindow && topSpacerHeight > 0 ? html`<div class="timeline-virtual-spacer" style=${{ height: `${topSpacerHeight}px` }}></div>` : null}
                ${visiblePosts.map((post, visibleIndex) => {
                    const index = effectiveRange.start + visibleIndex;
                    const isThreadReply = Boolean(post.data?.thread_id && post.data.thread_id !== post.id);
                    const isRemoving = removingPostIds?.has?.(post.id);
                    const threadInfo = threadInfoByIndex[index] || {};
                    return html`
                    <${TimelinePost}
                        key=${post.id}
                        post=${post}
                        isThreadReply=${isThreadReply}
                        isThreadPrev=${threadInfo.hasThreadPrev}
                        isThreadNext=${threadInfo.hasThreadNext}
                        isRemoving=${isRemoving}
                        highlightQuery=${searchQuery}
                        agentName=${getAgentName(post.data?.agent_id, agents || {})}
                        agentAvatarUrl=${getAgentAvatarUrl(post.data?.agent_id, agents || {})}
                        userName=${user?.name || user?.user_name}
                        userAvatarUrl=${user?.avatar_url || user?.avatarUrl || user?.avatar}
                        userAvatarBackground=${user?.avatar_background || user?.avatarBackground}
                        onPostClick=${onPostClick}
                        onHashtagClick=${onHashtagClick}
                        onMessageRef=${onMessageRef}
                        onScrollToMessage=${onScrollToMessage}
                        onFileRef=${onFileRef}
                        onOpenWidget=${onOpenWidget}
                        onDelete=${onDeletePost}
                        onOpenAttachmentPreview=${onOpenAttachmentPreview}
                        onSaveAnnotations=${onSaveAnnotations}
                        onSubmitCardAction=${onSubmitCardAction}
                        accessory=${renderPostAccessory?.(post)}
                        capabilities=${postCapabilities}
                    />
                `})}
                ${shouldWindow && bottomSpacerHeight > 0 ? html`<div class="timeline-virtual-spacer" style=${{ height: `${bottomSpacerHeight}px` }}></div>` : null}
                ${footer}
                ${reverse ? null : loadMoreSentinel}
            </div>
        </div>
    `;
}
