import { afterEach, expect, test } from 'bun:test';

import { handleAppSseEvent, type HandleAppSseEventDependencies } from '../../web/src/ui/app-sse-events.js';
import {
  noteAppChatActivation,
  resetAppRefreshCoordination,
} from '../../web/src/ui/app-refresh-coordination.js';

afterEach(() => {
  resetAppRefreshCoordination();
});

function applyUpdate<T>(current: T, next: T | ((prev: T) => T)): T {
  return typeof next === 'function' ? (next as (prev: T) => T)(current) : next;
}

function createDeps() {
  let extensionPanels = new Map<string, any>();
  let pendingPanelActions = new Set<string>(['panel-a:run', 'autoresearch:stop']);
  let followupQueueItems: Array<{ row_id: string; content?: string }> = [
    { row_id: 'row-1', content: 'first' },
    { row_id: 'row-2', content: 'second' },
  ];
  const toastCalls: Array<[string, string | null | undefined, string | undefined, number | undefined]> = [];
  const clearQueueCalls: number[] = [];
  let refreshQueueCalls = 0;
  let agentStatus: any = null;

  const deps: HandleAppSseEventDependencies = {
    currentChatJid: 'chat:alpha',
    updateAgentProfile: () => undefined,
    updateUserProfile: () => undefined,

    currentTurnIdRef: { current: null },
    activeChatJidRef: { current: 'chat:alpha' },
    pendingRequestRef: { current: null },
    draftBufferRef: { current: '' },
    thoughtBufferRef: { current: '' },
    steerQueuedTurnIdRef: { current: null },
    thoughtExpandedRef: { current: false },
    draftExpandedRef: { current: false },
    draftThrottleRef: { current: 0 },
    thoughtThrottleRef: { current: 0 },
    viewStateRef: { current: { currentHashtag: null, searchQuery: null, searchOpen: false } },
    followupQueueItemsRef: { current: followupQueueItems },
    dismissedQueueRowIdsRef: { current: new Set<string | number>() },
    scrollToBottomRef: { current: null },
    hasMoreRef: { current: false },
    loadMoreRef: { current: null },
    lastAgentResponseRef: { current: null },
    wasAgentActiveRef: { current: false },

    setActiveTurn: () => undefined,
    applyLiveGeneratedWidgetUpdate: () => undefined,
    setFloatingWidget: () => undefined,
    clearLastActivityFlag: () => undefined,
    handleUiVersionDrift: () => false,
    setAgentStatus: (next) => {
      agentStatus = applyUpdate(agentStatus, next);
    },
    setAgentDraft: () => undefined,
    setAgentPlan: () => undefined,
    setAgentThought: () => undefined,
    setPendingRequest: () => undefined,
    clearAgentRunState: () => undefined,
    getAgentStatus: async () => null,
    noteAgentActivity: () => undefined,
    showLastActivity: () => undefined,
    refreshTimeline: () => undefined,
    refreshModelAndQueueState: () => undefined,
    refreshActiveChatAgents: () => undefined,
    refreshCurrentChatBranches: () => undefined,
    notifyForFinalResponse: () => undefined,
    setContextUsage: () => undefined,
    refreshContextUsage: () => undefined,
    refreshQueueState: () => {
      refreshQueueCalls += 1;
    },
    setFollowupQueueItems: (next) => {
      followupQueueItems = applyUpdate(followupQueueItems, next);
      deps.followupQueueItemsRef.current = followupQueueItems;
    },
    clearQueuedSteerStateIfStale: (remainingQueueCount) => {
      clearQueueCalls.push(remainingQueueCount);
    },
    setSteerQueuedTurnId: () => undefined,
    applyModelState: () => undefined,
    getAgentContext: async () => null,
    setExtensionStatusPanels: (next) => {
      extensionPanels = applyUpdate(extensionPanels, next);
    },
    setPendingExtensionPanelActions: (next) => {
      pendingPanelActions = applyUpdate(pendingPanelActions, next);
    },
    refreshActiveEditorFromWorkspace: () => undefined,
    showIntentToast: (title, detail, kind, durationMs) => {
      toastCalls.push([title, detail, kind, durationMs]);
    },
    removeStalledPost: () => undefined,
    setPosts: () => undefined,
    preserveTimelineScrollTop: (mutate) => mutate(),
  };

  return {
    deps,
    getExtensionPanels: () => extensionPanels,
    getPendingPanelActions: () => pendingPanelActions,
    getFollowupQueueItems: () => followupQueueItems,
    getToastCalls: () => toastCalls,
    getClearQueueCalls: () => clearQueueCalls,
    getRefreshQueueCalls: () => refreshQueueCalls,
    getAgentStatusState: () => agentStatus,
  };
}

test('handleAppSseEvent routes status-panel widget events and clears finished pending actions', () => {
  const state = createDeps();

  handleAppSseEvent('extension_ui_widget', {
    key: 'panel-a',
    chat_jid: 'chat:alpha',
    options: { surface: 'status-panel' },
    content: [{ type: 'status_panel', panel: { state: 'done', title: 'Complete' } }],
  }, state.deps);

  expect(state.getExtensionPanels().get('panel-a')).toEqual({ state: 'done', title: 'Complete' });
  expect(Array.from(state.getPendingPanelActions())).toEqual(['autoresearch:stop']);
});

test('handleAppSseEvent removes followup rows on removal events and schedules queue refresh', () => {
  const state = createDeps();

  handleAppSseEvent('agent_followup_removed', {
    chat_jid: 'chat:alpha',
    row_id: 'row-1',
  }, state.deps);

  expect(state.deps.dismissedQueueRowIdsRef.current.has('row-1')).toBe(true);
  expect(state.getFollowupQueueItems().map((item) => item.row_id)).toEqual(['row-2']);
  expect(state.getClearQueueCalls()).toEqual([1]);
  expect(state.getRefreshQueueCalls()).toBe(1);
});

test('handleAppSseEvent restores active agent status on reconnect', async () => {
  const state = createDeps();
  state.deps.getAgentStatus = async () => ({
    status: 'active',
    data: {
      chat_jid: 'chat:alpha',
      type: 'intent',
      title: 'Compacting context',
      intent_key: 'compaction',
      turn_id: 'turn-42',
      started_at: '2026-03-30T21:00:00.000Z',
    },
    thought: { text: 'thought preview', totalLines: 2 },
    draft: { text: 'draft preview', totalLines: 3 },
  });

  handleAppSseEvent('connected', { app_asset_version: 'test' }, state.deps);
  await Promise.resolve();

  expect(state.getAgentStatusState()).toEqual({
    chat_jid: 'chat:alpha',
    type: 'intent',
    title: 'Compacting context',
    intent_key: 'compaction',
    turn_id: 'turn-42',
    started_at: '2026-03-30T21:00:00.000Z',
  });
});

test('handleAppSseEvent skips duplicate reconnect recovery during a fresh cold-open activation', async () => {
  noteAppChatActivation({ chatJid: 'chat:alpha' });
  const state = createDeps();
  let agentStatusCalls = 0;
  let timelineCalls = 0;
  let bundleCalls = 0;
  state.deps.getAgentStatus = async () => {
    agentStatusCalls += 1;
    return null;
  };
  state.deps.refreshTimeline = () => {
    timelineCalls += 1;
  };
  state.deps.refreshModelAndQueueState = () => {
    bundleCalls += 1;
  };

  handleAppSseEvent('connected', { app_asset_version: 'test' }, state.deps);
  await Promise.resolve();

  expect(agentStatusCalls).toBe(0);
  expect(timelineCalls).toBe(0);
  expect(bundleCalls).toBe(0);
});

test('handleAppSseEvent refreshes compaction status metadata even when title stays the same', () => {
  const state = createDeps();

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'intent',
    title: 'Compacting context',
    intent_key: 'compaction',
    turn_id: 'turn-1',
    started_at: '2026-04-02T13:00:00.000Z',
  }, state.deps);

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'intent',
    title: 'Compacting context',
    intent_key: 'compaction',
    turn_id: 'turn-2',
    started_at: '2026-04-02T13:05:00.000Z',
    detail: 'Shrinking recent context before continuing the turn.',
  }, state.deps);

  expect(state.getAgentStatusState()).toEqual({
    chat_jid: 'chat:alpha',
    type: 'intent',
    title: 'Compacting context',
    intent_key: 'compaction',
    turn_id: 'turn-2',
    started_at: '2026-04-02T13:05:00.000Z',
    detail: 'Shrinking recent context before continuing the turn.',
  });
});

test('handleAppSseEvent clears stale context usage when model context refresh fails', async () => {
  const state = createDeps();
  const updates: any[] = [];
  state.deps.setContextUsage = (next) => {
    updates.push(typeof next === 'function' ? next(updates.at(-1)) : next);
  };
  state.deps.getAgentContext = async () => {
    throw new Error('network');
  };

  handleAppSseEvent('model_changed', {
    chat_jid: 'chat:alpha',
    current: 'gpt-5.4',
  }, state.deps);

  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(updates).toEqual([null]);
});

test('handleAppSseEvent maps extension notify events into intent toasts', () => {
  const state = createDeps();

  handleAppSseEvent('extension_ui_notify', {
    chat_jid: 'chat:alpha',
    message: 'Widget synced',
    type: 'success',
  }, state.deps);

  expect(state.getToastCalls()).toEqual([
    ['Widget synced', null, 'success', undefined],
  ]);
});
