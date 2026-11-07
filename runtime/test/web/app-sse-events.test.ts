import { afterEach, expect, test } from 'bun:test';
import { getAgentUiSnapshot, invalidateAgentUiSnapshot } from '../../web/src/ui/agent-ui-snapshot.js';
import { applyChatPaneStateSnapshot, createEmptyChatPaneState } from '../../web/src/ui/app-chat-pane-state.js';

import { handleAppSseEvent, type HandleAppSseEventDependencies } from '../../web/src/ui/app-sse-events.js';
import {
  resetAppRefreshCoordination,
} from '../../web/src/ui/app-refresh-coordination.js';
import {
  reconcileContextUsageForChat,
  resetContextSessionGenerationsForTests,
  restoreContextUsage,
  refreshContextUsageForChat,
} from '../../web/src/ui/app-status-refresh-orchestration.js';

afterEach(() => {
  resetAppRefreshCoordination();
  resetContextSessionGenerationsForTests();
});

test('compaction intent invalidates a previously idle UI snapshot', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  try {
    invalidateAgentUiSnapshot('chat:alpha');
    globalThis.fetch = (async () => {
      requests++;
      return new Response(JSON.stringify({ status: { status: 'idle' }, errors: [] }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    await getAgentUiSnapshot('chat:alpha');
    const fixture = createDeps();
    handleAppSseEvent('agent_status', { chat_jid: 'chat:alpha', type: 'intent', intent_key: 'compaction', turn_id: 'compact' }, fixture.deps);
    await getAgentUiSnapshot('chat:alpha');
    expect(requests).toBe(2);
  } finally { globalThis.fetch = originalFetch; invalidateAgentUiSnapshot('chat:alpha'); }
});

function applyUpdate<T>(current: T, next: T | ((prev: T) => T)): T {
  return typeof next === 'function' ? (next as (prev: T) => T)(current) : next;
}

function createDeps() {
  let extensionPanels = new Map<string, any>();
  let pendingPanelActions = new Set<string>(['panel-a:run', 'autoresearch:stop']);
  let extensionWorkingState: any = { message: null, indicator: null };
  let followupQueueItems: Array<{ row_id: string; content?: string }> = [
    { row_id: 'row-1', content: 'first' },
    { row_id: 'row-2', content: 'second' },
  ];
  const toastCalls: Array<[string, string | null | undefined, string | undefined, number | undefined]> = [];
  const clearQueueCalls: number[] = [];
  let refreshQueueCalls = 0;
  let agentStatus: any = null;
  let agentDraft: any = { text: '', totalLines: 0 };
  let agentThought: any = { text: '', totalLines: 0 };
  let contextUsage: any = null;

  const deps: HandleAppSseEventDependencies = {
    currentChatJid: 'chat:alpha',
    updateAgentProfile: () => undefined,
    updateUserProfile: () => undefined,

    currentTurnIdRef: { current: null },
    agentStatusRef: { current: null },
    activeChatJidRef: { current: 'chat:alpha' },
    draftBufferRef: { current: '' },
    thoughtBufferRef: { current: '' },
    previewResyncGenerationRef: { current: 0 },
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
    setAgentDraft: (next) => {
      agentDraft = applyUpdate(agentDraft, next);
    },
    setAgentPlan: () => undefined,
    setAgentThought: (next) => {
      agentThought = applyUpdate(agentThought, next);
    },
    setPendingRequest: () => undefined,
    clearAgentRunState: () => undefined,
    noteAgentActivity: () => undefined,
    refreshTimeline: () => undefined,
    refreshModelAndQueueState: () => undefined,
    refreshActiveChatAgents: () => undefined,
    refreshCurrentChatBranches: () => undefined,
    notifyForFinalResponse: () => undefined,
    setContextUsage: (next) => {
      contextUsage = applyUpdate(contextUsage, next);
    },
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
    setExtensionWorkingState: (next) => {
      extensionWorkingState = applyUpdate(extensionWorkingState, next);
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
    getExtensionWorkingState: () => extensionWorkingState,
    getFollowupQueueItems: () => followupQueueItems,
    getToastCalls: () => toastCalls,
    getClearQueueCalls: () => clearQueueCalls,
    getRefreshQueueCalls: () => refreshQueueCalls,
    getAgentStatusState: () => agentStatus,
    getAgentDraftState: () => agentDraft,
    getAgentThoughtState: () => agentThought,
    getContextUsageState: () => contextUsage,
    setContextUsageState: (next: any) => { contextUsage = next; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

test('handleAppSseEvent preserves snapshot-only preview panes without treating bounded text as authoritative', () => {
  const state = createDeps();

  handleAppSseEvent('agent_thought', {
    chat_jid: 'chat:alpha',
    text: 'reasoning before the tool',
    total_lines: 1,
  }, state.deps);
  handleAppSseEvent('agent_draft', {
    chat_jid: 'chat:alpha',
    text: 'commentary before the tool',
    total_lines: 1,
    kind: 'draft',
    mode: 'replace',
  }, state.deps);

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'thinking',
    phase: 'post_tool_model',
    title: 'Continuing after tools...',
  }, state.deps);

  expect(state.getAgentThoughtState()).toMatchObject({ text: 'reasoning before the tool', totalLines: 1 });
  expect(state.getAgentDraftState()).toMatchObject({ text: 'commentary before the tool', totalLines: 1 });
  expect(state.deps.thoughtBufferRef.current).toBe('');
  expect(state.deps.draftBufferRef.current).toBe('');
  expect(state.getAgentStatusState()).toMatchObject({ phase: 'post_tool_model' });
});

test('handleAppSseEvent tracks extension working messages and indicators for the active chat', () => {
  const state = createDeps();

  handleAppSseEvent('extension_ui_working', {
    chat_jid: 'chat:alpha',
    message: 'Compacting context…',
  }, state.deps);

  expect(state.getExtensionWorkingState()).toEqual({
    message: 'Compacting context…',
    indicator: null,
  });

  handleAppSseEvent('extension_ui_working_indicator', {
    chat_jid: 'chat:alpha',
    frames: ['⠋', '⠙'],
    interval_ms: 90,
  }, state.deps);

  expect(state.getExtensionWorkingState()).toEqual({
    message: 'Compacting context…',
    indicator: {
      mode: 'custom',
      frames: ['⠋', '⠙'],
      intervalMs: 90,
    },
  });

  handleAppSseEvent('extension_ui_working', {
    chat_jid: 'chat:beta',
    message: 'Ignore other chats',
  }, state.deps);

  expect(state.getExtensionWorkingState()).toEqual({
    message: 'Compacting context…',
    indicator: {
      mode: 'custom',
      frames: ['⠋', '⠙'],
      intervalMs: 90,
    },
  });
});

test('handleAppSseEvent clears extension working state when the turn completes', () => {
  const state = createDeps();

  handleAppSseEvent('extension_ui_working', {
    chat_jid: 'chat:alpha',
    message: 'Compacting context…',
  }, state.deps);
  handleAppSseEvent('extension_ui_working_indicator', {
    chat_jid: 'chat:alpha',
    frames: ['⠋', '⠙'],
    interval_ms: 90,
  }, state.deps);

  handleAppSseEvent('agent_response', {
    chat_jid: 'chat:alpha',
    content: 'done',
  }, state.deps);

  expect(state.getExtensionWorkingState()).toEqual({ message: null, indicator: null, visible: true });
});

test('handleAppSseEvent consumes previews from a matching typed intermediate response', () => {
  const state = createDeps();
  state.deps.currentTurnIdRef.current = 'turn-current';
  state.deps.draftBufferRef.current = 'persisted draft';
  state.deps.thoughtBufferRef.current = 'persisted thought';
  state.deps.setAgentDraft({ text: 'persisted draft', totalLines: 1 });
  state.deps.setAgentThought({ text: 'persisted thought', totalLines: 1 });

  handleAppSseEvent('agent_response', {
    chat_jid: 'chat:alpha',
    data: {
      content: 'persisted draft',
      content_blocks: [{
        type: 'agent_turn_marker',
        kind: 'intermediate',
        cause: 'tool_use',
        followed_by_tool_use: true,
        turn_id: 'turn-current',
      }],
    },
  }, state.deps);

  expect(state.deps.draftBufferRef.current).toBe('');
  expect(state.deps.thoughtBufferRef.current).toBe('');
  expect(state.getAgentDraftState()).toEqual({ text: '', totalLines: 0 });
  expect(state.getAgentThoughtState()).toEqual({ text: '', totalLines: 0 });
});

test('handleAppSseEvent does not let an old typed response clear a newer turn', () => {
  const state = createDeps();
  state.deps.currentTurnIdRef.current = 'turn-new';
  state.deps.draftBufferRef.current = 'new draft';
  state.deps.setAgentDraft({ text: 'new draft', totalLines: 1 });

  handleAppSseEvent('agent_response', {
    chat_jid: 'chat:alpha',
    data: {
      content: 'old draft',
      content_blocks: [{
        type: 'agent_turn_marker',
        kind: 'intermediate',
        cause: 'tool_use',
        followed_by_tool_use: true,
        turn_id: 'turn-old',
      }],
    },
  }, state.deps);

  expect(state.deps.draftBufferRef.current).toBe('new draft');
  expect(state.getAgentDraftState()).toMatchObject({ text: 'new draft', totalLines: 1 });
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

test('handleAppSseEvent applies a chat-scoped provider usage refresh without resetting model state', () => {
  const state = createDeps();
  const modelPayloads: unknown[] = [];
  state.deps.applyModelState = (payload) => modelPayloads.push(payload);

  handleAppSseEvent('model_changed', {
    chat_jid: 'chat:alpha',
    current: 'zai/glm-4',
    provider_usage: { provider: 'zai', plan: 'pro' },
  }, state.deps);
  handleAppSseEvent('model_changed', {
    chat_jid: 'chat:beta',
    current: 'zai/glm-4',
    provider_usage: { provider: 'zai', plan: 'enterprise' },
  }, state.deps);

  expect(modelPayloads).toEqual([{
    chat_jid: 'chat:alpha',
    current: 'zai/glm-4',
    provider_usage: { provider: 'zai', plan: 'pro' },
  }]);
});

test('handleAppSseEvent preserves cached context usage when model context refresh fails', async () => {
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
  expect(updates).toEqual([]);
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

test('handleAppSseEvent resets context on a new session generation and rejects stale usage events', () => {
  const state = createDeps();
  const oldUsage = reconcileContextUsageForChat('chat:alpha', null, {
    tokens: 95000,
    contextWindow: 100000,
    percent: 95,
    sessionGeneration: 'session-old',
  }, { authoritative: true });
  state.setContextUsageState(oldUsage);

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'context_usage',
    context_reset: true,
    context_usage: {
      tokens: null,
      contextWindow: 100000,
      percent: null,
      sessionGeneration: 'session-new',
    },
  }, state.deps);
  expect(state.getContextUsageState()).toMatchObject({
    tokens: null,
    sessionGeneration: 'session-new',
  });

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'context_usage',
    context_usage: {
      tokens: 99000,
      contextWindow: 100000,
      percent: 99,
      sessionGeneration: 'session-old',
    },
  }, state.deps);
  expect(state.getContextUsageState()).toMatchObject({
    tokens: null,
    sessionGeneration: 'session-new',
  });
});

test('same-identity replacement clears active and inactive page-local meters without losing cache telemetry', () => {
  const previousWindow = (globalThis as any).window;
  const storage = new Map<string, string>();
  (globalThis as any).window = { localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } };
  try {
    const state = createDeps();
    for (const chat of ['chat:alpha', 'chat:beta']) {
      const previous = reconcileContextUsageForChat(chat, null, {
        tokens: 777, contextWindow: 10000, percent: 7.77, sessionGeneration: 'stable-session',
        cacheUsage: { latest: { cacheHitRate: 75 } },
      }, { authoritative: true });
      if (chat === 'chat:alpha') state.setContextUsageState(previous);
      handleAppSseEvent('agent_status', { chat_jid: chat, type: 'context_usage', context_usage: {
        tokens: null, contextWindow: null, percent: null, sessionGeneration: 'stable-session', contextUpdate: 'replace',
      } }, state.deps);
      expect(restoreContextUsage(chat)).toMatchObject({ tokens: null, percent: null, cacheUsage: { latest: { cacheHitRate: 75 } } });
    }
    expect(state.getContextUsageState()).toMatchObject({ tokens: null, percent: null });
    expect(state.getAgentStatusState()).toBeNull();
    expect(storage.size).toBe(0);
  } finally { (globalThis as any).window = previousWindow; }
});

test('switching back cannot restore stale pane meters after inactive replacement, unavailable storage and offline refresh', async () => {
  const previousWindow = (globalThis as any).window;
  const storage = new Map<string, string>();
  let failWrites = false, storageReads = 0, storageWrites = 0;
  (globalThis as any).window = { localStorage: {
    getItem: (key: string) => { storageReads++; return storage.get(key) ?? null; },
    setItem: (key: string, value: string) => { storageWrites++; if (failWrites) throw Error('storage unavailable'); storage.set(key, value); },
  } };
  try {
    const state = createDeps(); // alpha active; beta's saved pane is inactive
    const previous = reconcileContextUsageForChat('chat:beta', null, {
      tokens: 777, contextWindow: 10000, percent: 7.77, sessionGeneration: 'stable-session',
      cacheUsage: { latest: { cacheHitRate: 75 } },
    }, { authoritative: true });
    storage.set('piclaw:ctx:chat:beta', JSON.stringify(previous)); // Inert historical bytes from an older page.
    const pane = { ...createEmptyChatPaneState(), contextUsage: previous, agentPlan: 'keep plan',
      followupQueueItems: [{ row_id: 'keep', content: 'keep queue' }] };
    failWrites = true;
    handleAppSseEvent('agent_status', { chat_jid: 'chat:beta', type: 'context_usage', context_usage: {
      tokens: null, contextWindow: null, percent: null, sessionGeneration: 'stable-session', contextUpdate: 'replace',
    } }, state.deps);
    expect(JSON.parse(storage.get('piclaw:ctx:chat:beta')!).tokens).toBe(777); // disk is genuinely stale
    let plan = '';
    const refs = new Proxy({}, { get: (target: any, key) => target[key] ??= { current: null } });
    applyChatPaneStateSnapshot({ snapshot: pane, currentChatJid: 'chat:beta', refs: refs as any, setters: {
      ...state.deps, setIsAgentTurnActive() {}, setCurrentTurnId() {}, setActiveModel() {},
      setActiveThinkingLevel() {}, setSupportsThinking() {}, setActiveModelUsage() {},
      setAgentPlan: value => { plan = value; },
    } });
    expect(state.getContextUsageState()).toMatchObject({ tokens: null, percent: null, cacheUsage: { latest: { cacheHitRate: 75 } } });
    expect(plan).toBe('keep plan');
    expect(state.getFollowupQueueItems()).toEqual([{ row_id: 'keep', content: 'keep queue' }]);
    await refreshContextUsageForChat({ currentChatJid: 'chat:beta', activeChatJidRef: { current: 'chat:beta' },
      getAgentContext: async () => { throw Error('offline'); }, setContextUsage: state.deps.setContextUsage });
    expect(state.getContextUsageState()?.tokens).toBeNull();
    expect(restoreContextUsage('chat:beta')?.tokens).toBeNull();
    expect(storageReads).toBe(0); expect(storageWrites).toBe(0);
  } finally { (globalThis as any).window = previousWindow; }
});

test('handleAppSseEvent accepts current-generation compaction context updates', () => {
  const state = createDeps();
  state.setContextUsageState(reconcileContextUsageForChat('chat:alpha', null, {
    tokens: 80000,
    contextWindow: 100000,
    percent: 80,
    sessionGeneration: 'session-current',
  }, { authoritative: true }));

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha',
    type: 'context_usage',
    context_usage: {
      tokens: 25000,
      contextWindow: 100000,
      percent: 25,
      sessionGeneration: 'session-current',
      phase: 'after_manual_compaction',
    },
  }, state.deps);

  expect(state.getContextUsageState()).toMatchObject({
    tokens: 25000,
    percent: 25,
    sessionGeneration: 'session-current',
  });
});

test('reconnect cannot erase a newer held turn with a delayed older idle snapshot (#1519)', async () => {
  const state = createDeps();
  const snapshot = deferred<any>();
  Object.assign(state.deps, { getAgentStatus: () => snapshot.promise });
  state.deps.setActiveTurn = turn => { state.deps.currentTurnIdRef.current = turn || null; };
  state.deps.clearAgentRunState = () => { state.deps.currentTurnIdRef.current = null; };
  const event = (type: string, turn: string) => handleAppSseEvent('agent_status', {
    chat_jid: 'chat:alpha', turn_id: turn, type,
  }, state.deps);
  handleAppSseEvent('connected', {}, state.deps);
  event('thinking', 'aborted'); event('done', 'aborted');
  event('thinking', 'queued'); event('done', 'queued');
  event('thinking', 'held');
  handleAppSseEvent('agent_draft_delta', {chat_jid:'chat:alpha',turn_id:'held',reset:true,delta:'Current held draft'}, state.deps);
  snapshot.resolve({ status: 'idle', data: null });
  await snapshot.promise; await Promise.resolve();
  expect(state.deps.currentTurnIdRef.current).toBe('held');
  expect(state.getAgentStatusState()?.turn_id).toBe('held');
  expect(state.getAgentDraftState().fullText || state.getAgentDraftState().text).toBe('Current held draft');
});

test('an older error timeout cannot hide a newer status (#1519)', () => {
  const state = createDeps();
  const original = globalThis.setTimeout;
  let expire: () => void = () => { throw Error('Missing error timeout'); };
  globalThis.setTimeout = ((callback: () => void) => { expire = callback; return 0; }) as any;
  try {
    handleAppSseEvent('agent_status', {chat_jid:'chat:alpha',turn_id:'old',type:'error'}, state.deps);
    handleAppSseEvent('agent_status', {chat_jid:'chat:alpha',turn_id:'new',type:'thinking'}, state.deps);
    expire();
    expect(state.getAgentStatusState()?.turn_id).toBe('new');
  } finally { globalThis.setTimeout = original; }
});
