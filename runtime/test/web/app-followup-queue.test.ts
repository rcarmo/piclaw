import { expect, test } from 'bun:test';

import {
  appendFollowupQueueItem,
  filterQueuedTimelinePosts,
  haveSameFollowupQueueRows,
  LEGACY_QUEUE_STATUS,
  normalizeFollowupQueueItems,
  QUEUE_PLACEHOLDER_MARKER,
  removeFollowupQueueRow,
  shouldRefreshQueueStateFromResponse,
} from '../../web/src/ui/app-followup-queue.js';

test('filterQueuedTimelinePosts hides queued placeholder rows and marker bot posts', () => {
  const visible = { id: 'post:1', data: { is_bot_message: false, content: 'visible' } };
  const queuedRow = { id: 'queue:1', data: { is_bot_message: false, content: 'queued parent' } };
  const legacyPlaceholder = { id: 'bot:legacy', data: { is_bot_message: true, content: LEGACY_QUEUE_STATUS } };
  const invisibleMarker = { id: 'bot:marker', data: { is_bot_message: true, content: QUEUE_PLACEHOLDER_MARKER } };

  const filtered = filterQueuedTimelinePosts(
    [visible, queuedRow, legacyPlaceholder, invisibleMarker],
    new Set(['queue:1']),
  );

  expect(filtered).toEqual([visible]);
});

test('filterQueuedTimelinePosts preserves the original array reference when nothing is hidden', () => {
  const items = [{ id: 'post:1', data: { is_bot_message: false, content: 'visible' } }];
  expect(filterQueuedTimelinePosts(items, new Set())).toBe(items);
  expect(filterQueuedTimelinePosts(null, new Set())).toBeNull();
});

test('normalizeFollowupQueueItems clones payload rows and filters dismissed ids', () => {
  const source = [
    { row_id: 'queue:1', content: 'keep' },
    { row_id: 'queue:2', content: 'dismiss' },
  ];
  const normalized = normalizeFollowupQueueItems(source, new Set(['queue:2']));

  source[0].content = 'mutated';

  expect(normalized).toEqual([{ row_id: 'queue:1', content: 'keep' }]);
  expect(normalized[0]).not.toBe(source[0]);
});

test('haveSameFollowupQueueRows compares queue identity by ordered row ids', () => {
  expect(haveSameFollowupQueueRows([{ row_id: 'a' }, { row_id: 'b' }], [{ row_id: 'a' }, { row_id: 'b' }])).toBe(true);
  expect(haveSameFollowupQueueRows([{ row_id: 'a' }], [{ row_id: 'b' }])).toBe(false);
  expect(haveSameFollowupQueueRows(null, [{ row_id: 'a' }])).toBe(false);
});

test('removeFollowupQueueRow returns filtered rows and the remaining queue count', () => {
  expect(removeFollowupQueueRow([{ row_id: 'a' }, { row_id: 'b' }], 'a')).toEqual({
    items: [{ row_id: 'b' }],
    remainingQueueCount: 1,
  });
  expect(removeFollowupQueueRow([{ row_id: 'a' }], null)).toEqual({
    items: [{ row_id: 'a' }],
    remainingQueueCount: 1,
  });
});

test('appendFollowupQueueItem appends normalized rows for valid queue payloads', () => {
  const existing = [{ row_id: 'queue:1', content: 'first' }];
  const appended = appendFollowupQueueItem(existing, {
    row_id: 'queue:2',
    content: 'second',
    timestamp: '2026-03-29T12:00:00.000Z',
    thread_id: 9,
  });

  expect(appended).toEqual([
    { row_id: 'queue:1', content: 'first' },
    {
      row_id: 'queue:2',
      content: 'second',
      timestamp: '2026-03-29T12:00:00.000Z',
      thread_id: 9,
    },
  ]);
  expect(appended).not.toBe(existing);
});

test('appendFollowupQueueItem keeps array identity for duplicate or invalid payloads', () => {
  const existing = [{ row_id: 'queue:1', content: 'first' }];

  expect(appendFollowupQueueItem(existing, { row_id: 'queue:1', content: 'duplicate' })).toBe(existing);
  expect(appendFollowupQueueItem(existing, { row_id: null, content: 'missing row' })).toBe(existing);
  expect(appendFollowupQueueItem(existing, { row_id: 'queue:2', content: '   ' })).toBe(existing);
  expect(appendFollowupQueueItem(existing, null)).toBe(existing);
});

test('shouldRefreshQueueStateFromResponse detects queued responses and queued commands', () => {
  expect(shouldRefreshQueueStateFromResponse({ queued: 'followup' })).toBe(true);
  expect(shouldRefreshQueueStateFromResponse({ queued: 'steer' })).toBe(true);
  expect(shouldRefreshQueueStateFromResponse({ command: { queued_followup: true } })).toBe(true);
  expect(shouldRefreshQueueStateFromResponse({ command: { queued_steer: true } })).toBe(true);
  expect(shouldRefreshQueueStateFromResponse({ queued: 'sent', command: {} })).toBe(false);
  expect(shouldRefreshQueueStateFromResponse(null)).toBe(false);
});

test('steering rows sort first, keep their order and move only within their group', async () => {
  const { normalizeFollowupQueueItems, moveFollowupQueueItem, setFollowupQueueItemMode, haveSameFollowupQueueRows } = await import('../../web/src/ui/app-followup-queue.ts');
  const items = normalizeFollowupQueueItems([
    { row_id: 1, mode: 'followUp' }, { row_id: 2, mode: 'steer' }, { row_id: 3, mode: 'followUp' }, { row_id: 4, mode: 'steer' },
  ], new Set());
  expect(items.map((item) => item.row_id)).toEqual([2, 4, 1, 3]);
  expect(moveFollowupQueueItem(items, 3, 2)?.map((item) => item.row_id)).toEqual([2, 4, 3, 1]);
  expect(moveFollowupQueueItem(items, 2, 1)).toBeNull();
  expect(moveFollowupQueueItem(items, 0, 9)).toBeNull();
  const steered = setFollowupQueueItemMode(items, 3, 'steer');
  expect(steered.map((item) => [item.row_id, item.mode])).toEqual([[2, 'steer'], [4, 'steer'], [3, 'steer'], [1, 'followUp']]);
  expect(setFollowupQueueItemMode(steered, 3, 'followUp').map((item) => item.row_id)).toEqual([2, 4, 3, 1]);
  expect(setFollowupQueueItemMode([{ row_id: 5, mode: 'steer' }], 5, undefined)).toEqual([{ row_id: 5 }]);
  expect(haveSameFollowupQueueRows(items, items.map((item) => ({ ...item })))).toBe(true);
  expect(haveSameFollowupQueueRows([{ row_id: 1, mode: 'followUp' }], [{ row_id: 1, mode: 'steer' }])).toBe(false);
});
