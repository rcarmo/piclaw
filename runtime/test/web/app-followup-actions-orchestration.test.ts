import { expect, test } from 'bun:test';

import {
  runInjectQueuedFollowup,
  runRemoveQueuedFollowup,
  runMessageResponseRefresh,
} from '../../web/src/ui/app-followup-actions-orchestration.js';

const noopAsync = async () => {};

test('runInjectQueuedFollowup forwards queue context to injected action', () => {
  let captured: any = null;
  runInjectQueuedFollowup({
    queuedItem: { row_id: 'q1' },
    followupQueueItemsRef: { current: [] },
    dismissedQueueRowIdsRef: { current: new Set() },
    currentChatJid: 'web:default',
    refreshQueueState: noopAsync,
    setFollowupQueueItems: () => {},
    showIntentToast: () => {},
    steerAgentQueueItem: noopAsync,
    removeAgentQueueItem: noopAsync,
  }, (options) => {
    captured = options;
  });

  expect(captured?.queuedItem?.row_id).toBe('q1');
  expect(captured?.currentChatJid).toBe('web:default');
});

test('runRemoveQueuedFollowup forwards the confirmed removal acknowledgement', async () => {
  let called = false;
  const result = runRemoveQueuedFollowup({
    queuedItem: { row_id: 'q2' },
    followupQueueItemsRef: { current: [] },
    dismissedQueueRowIdsRef: { current: new Set() },
    currentChatJid: 'web:default',
    refreshQueueState: noopAsync,
    setFollowupQueueItems: () => {},
    showIntentToast: () => {},
    clearQueuedSteerStateIfStale: () => {
      called = true;
    },
    steerAgentQueueItem: noopAsync,
    removeAgentQueueItem: noopAsync,
  }, async (options) => {
    options.clearQueuedSteerStateIfStale?.();
    return true;
  });

  expect(called).toBe(true); expect(await result).toBe(true);
});

test('runMessageResponseRefresh forwards refresh callbacks and response payload', () => {
  const calls: string[] = [];
  runMessageResponseRefresh({ id: 'resp' }, {
    refreshActiveChatAgents: async () => calls.push('agents'),
    refreshCurrentChatBranches: async () => calls.push('branches'),
    refreshContextUsage: async () => calls.push('context'),
    refreshAutoresearchStatus: async () => calls.push('autoresearch'),
    refreshQueueState: async () => calls.push('queue'),
  }, (options) => {
    expect(options.response).toEqual({ id: 'resp' });
    expect(typeof options.refreshQueueState).toBe('function');
  });

  expect(calls).toEqual([]);
});
