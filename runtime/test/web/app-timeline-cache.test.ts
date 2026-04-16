import { expect, mock, test } from 'bun:test';

import {
  cacheTimelineSnapshot,
  clearTimelineSnapshotCache,
  getCachedTimelineSnapshot,
  prewarmTimelineSnapshots,
  resolveRecentTimelinePrewarmChatJids,
} from '../../web/src/ui/app-timeline-cache.js';

test('timeline cache stores and reloads fresh snapshots from memory', () => {
  clearTimelineSnapshotCache();

  cacheTimelineSnapshot('web:branch:a', {
    posts: [{ id: 1 }],
    has_more: true,
  });

  const snapshot = getCachedTimelineSnapshot('web:branch:a');
  expect(snapshot?.posts).toEqual([{ id: 1 }]);
  expect(snapshot?.has_more).toBe(true);

  clearTimelineSnapshotCache();
});

test('resolveRecentTimelinePrewarmChatJids excludes the active chat and dedupes rows', () => {
  const chatJids = resolveRecentTimelinePrewarmChatJids([
    { chat_jid: 'web:current' },
    { chat_jid: 'web:branch:1' },
    { chat_jid: 'web:branch:1' },
    { chat_jid: 'web:branch:2' },
    { chat_jid: '   ' },
  ], 'web:current', 2);

  expect(chatJids).toEqual(['web:branch:1', 'web:branch:2']);
});

test('prewarmTimelineSnapshots fills missing chats and skips already fresh entries', async () => {
  clearTimelineSnapshotCache();
  cacheTimelineSnapshot('web:cached', { posts: [{ id: 1 }], has_more: false });

  const fetchTimeline = mock(async (chatJid: string) => ({
    posts: [{ id: `${chatJid}-post` }],
    has_more: false,
  }));

  await prewarmTimelineSnapshots({
    chatJids: ['web:cached', 'web:warm', 'web:warm'],
    fetchTimeline,
  });

  expect(fetchTimeline).toHaveBeenCalledTimes(1);
  expect(fetchTimeline).toHaveBeenCalledWith('web:warm');
  expect(getCachedTimelineSnapshot('web:warm')?.posts).toEqual([{ id: 'web:warm-post' }]);

  clearTimelineSnapshotCache();
});
