import { afterEach, expect, test } from 'bun:test';

import {
  handleConnectionStatusChangeEvent,
  handleUiVersionDriftEvent,
  runBackstopRefreshTick,
} from '../../web/src/ui/app-connection-lifecycle.js';
import {
  noteAppChatActivation,
  resetAppRefreshCoordination,
} from '../../web/src/ui/app-refresh-coordination.js';

afterEach(() => {
  resetAppRefreshCoordination();
});

test('handleUiVersionDriftEvent ignores missing/unchanged versions', () => {
  const staleUiVersionRef = { current: null as string | null };
  const staleUiReloadScheduledRef = { current: false };
  const toasts: string[] = [];

  const unchanged = handleUiVersionDriftEvent({
    serverVersion: 'v1',
    currentAppAssetVersion: 'v1',
    staleUiVersionRef,
    staleUiReloadScheduledRef,
    tabStoreHasUnsaved: () => false,
    isAgentRunningRef: { current: false },
    pendingRequestRef: { current: null },
    showIntentToast: (title) => { toasts.push(title); },
  });

  expect(unchanged).toBe(false);
  expect(toasts).toEqual([]);
});

test('handleUiVersionDriftEvent warns when auto-reload is not possible', () => {
  const staleUiVersionRef = { current: null as string | null };
  const staleUiReloadScheduledRef = { current: false };
  const toasts: string[] = [];

  const handled = handleUiVersionDriftEvent({
    serverVersion: 'v2',
    currentAppAssetVersion: 'v1',
    staleUiVersionRef,
    staleUiReloadScheduledRef,
    tabStoreHasUnsaved: () => true,
    isAgentRunningRef: { current: false },
    pendingRequestRef: { current: null },
    showIntentToast: (title) => { toasts.push(title); },
  });

  expect(handled).toBe(true);
  expect(staleUiVersionRef.current).toBe('v2');
  expect(toasts).toEqual(['New UI available']);
});

test('handleConnectionStatusChangeEvent clears active agent state on disconnect', () => {
  const calls: string[] = [];
  const pendingRequestRef = { current: { id: 1 } as unknown };

  handleConnectionStatusChangeEvent({
    currentChatJid: 'chat:alpha',
    status: 'disconnected',
    setConnectionStatus: (status) => { calls.push(`conn:${status}`); },
    setAgentStatus: (status) => { calls.push(`status:${status === null ? 'null' : 'set'}`); },
    setAgentDraft: () => { calls.push('draft'); },
    setAgentPlan: () => { calls.push('plan'); },
    setAgentThought: () => { calls.push('thought'); },
    setPendingRequest: (request) => { calls.push(`pending:${request === null ? 'null' : 'set'}`); },
    pendingRequestRef,
    clearAgentRunState: () => { calls.push('clear'); },
    hasConnectedOnceRef: { current: false },
    viewStateRef: { current: null },
    refreshTimeline: () => { calls.push('timeline'); },
    refreshAgentStatus: () => { calls.push('refresh-status'); },
    refreshQueueState: () => { calls.push('refresh-queue'); },
    refreshContextUsage: () => { calls.push('refresh-context'); },
  });

  expect(calls).toEqual([
    'conn:disconnected',
    'status:null',
    'draft',
    'plan',
    'thought',
    'pending:null',
    'clear',
  ]);
  expect(pendingRequestRef.current).toBeNull();
});

test('handleConnectionStatusChangeEvent skips the initial reconnect bundle during a fresh cold-open activation', () => {
  noteAppChatActivation({ chatJid: 'chat:alpha' });
  const calls: string[] = [];

  handleConnectionStatusChangeEvent({
    currentChatJid: 'chat:alpha',
    status: 'connected',
    setConnectionStatus: (status) => { calls.push(`conn:${status}`); },
    setAgentStatus: () => { calls.push('status'); },
    setAgentDraft: () => { calls.push('draft'); },
    setAgentPlan: () => { calls.push('plan'); },
    setAgentThought: () => { calls.push('thought'); },
    setPendingRequest: () => { calls.push('pending'); },
    pendingRequestRef: { current: null },
    clearAgentRunState: () => { calls.push('clear'); },
    hasConnectedOnceRef: { current: false },
    viewStateRef: { current: { currentHashtag: null, searchQuery: null, searchOpen: false } },
    refreshTimeline: () => { calls.push('timeline'); },
    refreshAgentStatus: () => { calls.push('refresh-status'); },
    refreshQueueState: () => { calls.push('refresh-queue'); },
    refreshContextUsage: () => { calls.push('refresh-context'); },
  });

  expect(calls).toEqual([
    'conn:connected',
    'status',
    'draft',
    'plan',
    'thought',
    'pending',
    'clear',
  ]);
});

test('runBackstopRefreshTick refreshes queue only when agent is active', () => {
  const calls: string[] = [];
  const run = (isAgentActive: boolean) => {
    runBackstopRefreshTick({
      viewStateRef: { current: { currentHashtag: null, searchQuery: null, searchOpen: false } },
      isAgentActive,
      refreshTimeline: () => { calls.push(`timeline:${isAgentActive}`); },
      refreshQueueState: () => { calls.push(`queue:${isAgentActive}`); },
      refreshAgentStatus: () => { calls.push(`status:${isAgentActive}`); },
      refreshContextUsage: () => { calls.push(`context:${isAgentActive}`); },
      refreshAutoresearchStatus: () => { calls.push(`autoresearch:${isAgentActive}`); },
    });
  };

  run(true);
  run(false);

  expect(calls).toEqual([
    'timeline:true',
    'queue:true',
    'status:true',
    'context:true',
    'autoresearch:true',
    'timeline:false',
    'status:false',
    'context:false',
    'autoresearch:false',
  ]);
});
