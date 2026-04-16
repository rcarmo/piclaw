import { expect, test } from 'bun:test';

import {
  cacheTimelineSnapshot,
  clearTimelineSnapshotCache,
  getCachedTimelineSnapshot,
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
