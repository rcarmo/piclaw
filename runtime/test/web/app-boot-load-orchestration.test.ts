import { expect, test } from 'bun:test';

import {
  applyStoredSidebarWidth,
  runTimelineLoadFlow,
} from '../../web/src/ui/app-boot-load-orchestration.js';

test('applyStoredSidebarWidth clamps storage values and updates css var', () => {
  const styleCalls: Array<[string, string]> = [];
  const shell = {
    style: {
      setProperty: (key: string, value: string) => styleCalls.push([key, value]),
    },
  } as unknown as HTMLElement;

  const sidebarWidthRef = { current: 0 };
  const width = applyStoredSidebarWidth({
    readStoredNumber: () => 999,
    sidebarWidthRef,
    shellElement: shell,
  });

  expect(width).toBe(600);
  expect(sidebarWidthRef.current).toBe(600);
  expect(styleCalls).toEqual([['--sidebar-width', '600px']]);
});

test('runTimelineLoadFlow loads hashtag timeline branch', async () => {
  const calls: string[] = [];

  await runTimelineLoadFlow({
    currentHashtag: '#release',
    searchQuery: null,
    searchScope: 'current',
    currentChatJid: 'web:a',
    currentRootChatJid: 'web:a',
    loadPosts: async (hashtag) => {
      calls.push(`load:${hashtag}`);
    },
    searchPosts: async () => ({ results: [] }),
    setPosts: () => undefined,
    setHasMore: () => undefined,
    scrollToBottom: () => calls.push('scroll'),
    isCancelled: () => false,
  });

  expect(calls).toEqual(['load:#release']);
});

test('runTimelineLoadFlow loads search results and disables hasMore', async () => {
  const postsCalls: any[] = [];
  const hasMoreCalls: boolean[] = [];

  await runTimelineLoadFlow({
    currentHashtag: null,
    searchQuery: 'error',
    searchScope: 'root',
    currentChatJid: 'web:feature',
    currentRootChatJid: 'web:root',
    loadPosts: async () => undefined,
    searchPosts: async (_query, _limit, _offset, chatJid, scope, rootChatJid) => {
      expect(chatJid).toBe('web:feature');
      expect(scope).toBe('root');
      expect(rootChatJid).toBe('web:root');
      return { results: [{ id: 1 }] };
    },
    setPosts: (next) => postsCalls.push(next),
    setHasMore: (next) => hasMoreCalls.push(next),
    scrollToBottom: () => undefined,
    isCancelled: () => false,
  });

  expect(postsCalls).toEqual([[{ id: 1 }]]);
  expect(hasMoreCalls).toEqual([false]);
});

test('runTimelineLoadFlow loads main timeline and triggers deferred scroll', async () => {
  const calls: string[] = [];

  await runTimelineLoadFlow({
    currentHashtag: null,
    searchQuery: null,
    searchScope: 'current',
    currentChatJid: 'web:default',
    currentRootChatJid: 'web:default',
    loadPosts: async () => {
      calls.push('load');
    },
    searchPosts: async () => ({ results: [] }),
    setPosts: () => undefined,
    setHasMore: () => undefined,
    scrollToBottom: () => {
      calls.push('scroll');
    },
    isCancelled: () => false,
    scheduleRaf: (callback) => callback(),
    scheduleTimeout: (callback) => callback(),
    onTimelineLoadStart: () => calls.push('load-start'),
    onTimelineDataReady: () => calls.push('data-ready'),
    onTimelineFirstPaint: () => calls.push('first-paint'),
  });

  expect(calls).toEqual(['load-start', 'load', 'data-ready', 'first-paint', 'scroll']);
});
