import { dedupePosts } from './timeline-utils.js';
/** Load contiguous newest-first pages before retaining an older cached suffix.
 * A bounded catch-up that cannot join it drops disconnected cached rows. */
export async function fetchContiguousTimeline(currentPosts, fetchPage, isCurrent = () => true, contiguousThroughId?: number) {
    // Without a verified page boundary, isolated SSE IDs cannot prove a join.
    // Conservatively page through the oldest retained row instead.
    const cached = Array.isArray(currentPosts) ? currentPosts : [];
    const cachedIds = cached.map(post => Number(post.id)).filter(id => Number.isFinite(id) && id > 0);
    const verifiedBoundary = contiguousThroughId && contiguousThroughId > 0 ? contiguousThroughId : (cachedIds.length ? Math.min(...cachedIds) : 0);
    // Missed SSE updates can change a form's revision without creating a new post.
    // Re-read cached active forms before retaining them after a reconnect.
    const latestCached = cached.reduce((boundary, post) => {
        const id = Number(post.id);
        const blocks = post.data?.content_blocks;
        return id > 0 && id < boundary && Array.isArray(blocks)
            && blocks.some(block => block?.type === 'a2ui_surface' && block.state === 'active') ? id : boundary;
    }, verifiedBoundary);
    let fresh = [], before = null, hasMore = false, joined = !latestCached;
    for (let page = 0; page < 10; page++) {
        const result = await fetchPage(50, before);
        if (!isCurrent()) return null;
        if (!Array.isArray(result?.posts)) throw Error('Invalid timeline page.');
        const rows = result.posts;
        fresh = dedupePosts([...fresh, ...rows]); hasMore = Boolean(result?.has_more);
        const oldest = Math.min(...rows.map(row => Number(row.id)).filter(Number.isFinite));
        joined = !latestCached || oldest <= latestCached;
        if (joined || !hasMore || !rows.length || !Number.isFinite(oldest) || before === oldest) break;
        before = oldest;
    }
    if (joined && fresh.length) {
        const minFresh = Math.min(...fresh.map(post => Number(post.id)).filter(Number.isFinite));
        fresh = dedupePosts([...fresh, ...(currentPosts || []).filter(post => Number(post.id) < minFresh)]);
    }
    return { posts: fresh, has_more: hasMore };
}
