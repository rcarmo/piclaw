import { expect, test } from 'bun:test';

import {
  refreshPostPaintThreadHydration,
  startModelAndQueueRefreshEffect,
} from '../../web/src/ui/app-chat-refresh-lifecycle.js';

test('startModelAndQueueRefreshEffect runs hydrate immediately and schedules periodic refresh bundle', () => {
  const calls: string[] = [];
  let intervalHandler: (() => void) | null = null;
  let clearedHandle: unknown = null;

  const cleanup = startModelAndQueueRefreshEffect({
    refreshModelAndQueueState: () => calls.push('initial'),
    refreshModelState: () => calls.push('model'),
    refreshActiveChatAgents: () => calls.push('agents'),
    refreshCurrentChatBranches: () => calls.push('branches'),
    refreshQueueState: () => calls.push('queue'),
    intervalMs: 60_000,
    scheduleInterval: (handler) => {
      intervalHandler = handler;
      return { token: 'poll' };
    },
    clearScheduledInterval: (handle) => {
      clearedHandle = handle;
    },
  });

  expect(calls).toEqual(['initial']);
  intervalHandler?.();
  expect(calls).toEqual(['initial', 'model', 'agents', 'branches', 'queue']);

  cleanup();
  expect(clearedHandle).toEqual({ token: 'poll' });
});

test('startModelAndQueueRefreshEffect can skip the immediate hydrate pass', () => {
  const calls: string[] = [];
  let intervalHandler: (() => void) | null = null;

  const cleanup = startModelAndQueueRefreshEffect({
    refreshModelAndQueueState: () => calls.push('initial'),
    refreshModelState: () => calls.push('model'),
    refreshActiveChatAgents: () => calls.push('agents'),
    refreshCurrentChatBranches: () => calls.push('branches'),
    refreshQueueState: () => calls.push('queue'),
    runImmediately: false,
    scheduleInterval: (handler) => {
      intervalHandler = handler;
      return { token: 'poll' };
    },
  });

  expect(calls).toEqual([]);
  intervalHandler?.();
  expect(calls).toEqual(['model', 'agents', 'branches', 'queue']);

  cleanup();
});

test('refreshPostPaintThreadHydration refreshes the current chat after timeline load settles', async () => {
  const calls: string[] = [];

  refreshPostPaintThreadHydration({
    refreshModelState: () => calls.push('model'),
    refreshActiveChatAgents: () => calls.push('agents'),
    refreshCurrentChatBranches: () => calls.push('branches'),
    refreshQueueState: () => calls.push('queue'),
    refreshContextUsage: async () => { calls.push('context'); },
    refreshAutoresearchStatus: async () => { calls.push('autoresearch'); },
  });

  await Promise.resolve();
  expect(calls).toEqual([
    'model',
    'agents',
    'branches',
    'queue',
    'context',
    'autoresearch',
  ]);
});
