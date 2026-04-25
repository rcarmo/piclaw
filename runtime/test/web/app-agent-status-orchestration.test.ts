import { expect, test } from 'bun:test';

import {
  describeTimedOutToolAction,
  finalizeStalledResponse,
  reconcileSilentTurn,
  refreshAgentStatusForChat,
  runSilenceWatchdogTick,
} from '../../web/src/ui/app-agent-status-orchestration.js';

test('refreshAgentStatusForChat clears local state when server reports no active run', async () => {
  const events: string[] = [];

  const result = await refreshAgentStatusForChat({
    currentChatJid: 'web:chat',
    getAgentStatus: async () => ({ status: 'idle' }),
    activeChatJidRef: { current: 'web:chat' },
    wasAgentActiveRef: { current: true },
    viewStateRef: { current: { currentHashtag: null, searchQuery: null, searchOpen: false } },
    refreshTimeline: () => {
      events.push('refreshTimeline');
    },
    clearAgentRunState: () => events.push('clearAgentRunState'),
    agentStatusRef: { current: { type: 'thinking' } },
    pendingRequestRef: { current: 'pending' },
    thoughtBufferRef: { current: '' },
    draftBufferRef: { current: '' },
    setAgentStatus: (next) => events.push(`setAgentStatus:${String(next)}`),
    setAgentDraft: () => events.push('setAgentDraft'),
    setAgentPlan: () => events.push('setAgentPlan'),
    setAgentThought: () => events.push('setAgentThought'),
    setPendingRequest: () => events.push('setPendingRequest'),
    setActiveTurn: () => events.push('setActiveTurn'),
    noteAgentActivity: () => events.push('noteAgentActivity'),
    clearLastActivityFlag: () => events.push('clearLastActivityFlag'),
  });

  expect(result).toEqual({ status: 'idle' });
  expect(events).toContain('refreshTimeline');
  expect(events).toContain('clearAgentRunState');
  expect(events).toContain('setAgentDraft');
  expect(events).toContain('setAgentThought');
  expect(events).toContain('setPendingRequest');
});

test('refreshAgentStatusForChat restores draft/thought previews for active payloads', async () => {
  let thoughtState: any = { text: '', totalLines: 0 };
  let draftState: any = { text: '', totalLines: 0 };
  const thoughtBufferRef = { current: '' };
  const draftBufferRef = { current: '' };
  const activeTurns: Array<string | null | undefined> = [];

  const response = await refreshAgentStatusForChat({
    currentChatJid: 'web:chat',
    getAgentStatus: async () => ({
      status: 'active',
      data: { turn_id: 'turn-42', type: 'thinking' },
      thought: { text: 'thought text', total_lines: 1 },
      draft: { text: 'draft text', total_lines: 1 },
    }),
    activeChatJidRef: { current: 'web:chat' },
    wasAgentActiveRef: { current: false },
    viewStateRef: { current: null },
    refreshTimeline: async () => undefined,
    clearAgentRunState: () => undefined,
    agentStatusRef: { current: null },
    pendingRequestRef: { current: null },
    thoughtBufferRef,
    draftBufferRef,
    setAgentStatus: () => undefined,
    setAgentDraft: (next) => {
      draftState = typeof next === 'function' ? next(draftState) : next;
    },
    setAgentPlan: () => undefined,
    setAgentThought: (next) => {
      thoughtState = typeof next === 'function' ? next(thoughtState) : next;
    },
    setPendingRequest: () => undefined,
    setActiveTurn: (turnId) => activeTurns.push(turnId),
    noteAgentActivity: () => undefined,
    clearLastActivityFlag: () => undefined,
  });

  expect(response?.status).toBe('active');
  expect(activeTurns).toEqual(['turn-42']);
  expect(thoughtBufferRef.current).toBe('thought text');
  expect(draftBufferRef.current).toBe('draft text');
  expect(thoughtState.text).toBe('thought text');
  expect(draftState.text).toBe('draft text');
});

test('reconcileSilentTurn refreshes timeline and throttles duplicate probes', async () => {
  const calls: string[] = [];
  const silentRecoveryRef = { current: { inFlight: false, lastAttemptAt: 0, turnId: null as string | null } };

  const first = await reconcileSilentTurn({
    isAgentRunningRef: { current: true },
    pendingRequestRef: { current: null },
    currentTurnIdRef: { current: 'turn-a' },
    silentRecoveryRef,
    silenceRefreshMs: 500,
    viewStateRef: { current: { currentHashtag: null, searchQuery: null, searchOpen: false } },
    refreshTimeline: async () => {
      calls.push('refreshTimeline');
    },
    refreshQueueState: async () => {
      calls.push('refreshQueueState');
    },
    refreshAgentStatus: async () => {
      calls.push('refreshAgentStatus');
      return 'ok';
    },
    now: () => 1_000,
  });

  const second = await reconcileSilentTurn({
    isAgentRunningRef: { current: true },
    pendingRequestRef: { current: null },
    currentTurnIdRef: { current: 'turn-a' },
    silentRecoveryRef,
    silenceRefreshMs: 500,
    viewStateRef: { current: { currentHashtag: null, searchQuery: null, searchOpen: false } },
    refreshTimeline: async () => {
      calls.push('refreshTimeline:second');
    },
    refreshQueueState: async () => {
      calls.push('refreshQueueState:second');
    },
    refreshAgentStatus: async () => {
      calls.push('refreshAgentStatus:second');
      return 'second';
    },
    now: () => 1_200,
  });

  expect(first).toBe('ok');
  expect(second).toBeNull();
  expect(calls).toEqual(['refreshTimeline', 'refreshQueueState', 'refreshAgentStatus']);
});

test('runSilenceWatchdogTick emits waiting status and triggers re-sync after finalize threshold', () => {
  const statuses: any[] = [];
  let reconciles = 0;

  runSilenceWatchdogTick({
    isAgentRunningRef: { current: true },
    pendingRequestRef: { current: null },
    lastAgentEventRef: { current: 1_000 },
    lastSilenceNoticeRef: { current: 0 },
    agentStatusRef: { current: { type: 'thinking' } },
    silenceWarningMs: 4_000,
    silenceFinalizeMs: 8_000,
    silenceRefreshMs: 2_000,
    isCompactionStatus: () => false,
    setAgentStatus: (next) => statuses.push(next),
    reconcileSilentTurn: () => {
      reconciles += 1;
    },
    now: () => 10_000,
  });

  expect(statuses).toEqual([{ type: 'waiting', title: 'Re-syncing after a quiet period…' }]);
  expect(reconciles).toBe(1);
});

test('runSilenceWatchdogTick keeps the last tool status visible while re-syncing', () => {
  const statuses: any[] = [];
  let reconciles = 0;

  runSilenceWatchdogTick({
    isAgentRunningRef: { current: true },
    pendingRequestRef: { current: null },
    lastAgentEventRef: { current: 1_000 },
    lastSilenceNoticeRef: { current: 0 },
    agentStatusRef: { current: { type: 'tool_status', title: 'bash', status: 'Working...', tool_name: 'bash' } },
    silenceWarningMs: 4_000,
    silenceFinalizeMs: 8_000,
    silenceRefreshMs: 2_000,
    isCompactionStatus: () => false,
    setAgentStatus: (next) => statuses.push(next),
    reconcileSilentTurn: () => {
      reconciles += 1;
    },
    now: () => 10_000,
  });

  expect(statuses).toEqual([]);
  expect(reconciles).toBe(1);
});

test('describeTimedOutToolAction summarizes the last visible tool status', () => {
  expect(describeTimedOutToolAction({ type: 'tool_call', title: 'bash', tool_name: 'bash' })).toEqual({
    summary: 'Timed out while running bash',
    title: 'bash',
    toolName: 'bash',
    statusText: null,
  });
  expect(describeTimedOutToolAction({ type: 'tool_status', title: 'bash', status: 'Working...', tool_name: 'bash' })).toEqual({
    summary: 'Timed out after bash: Working...',
    title: 'bash',
    toolName: 'bash',
    statusText: 'Working...',
  });
});

test('finalizeStalledResponse appends local warning post, includes the last tool action, and preserves the last draft when partial draft exists', () => {
  const setAgentStatusCalls: any[] = [];
  const setAgentDraftCalls: any[] = [];
  const setPostsCalls: any[] = [];

  finalizeStalledResponse({
    isAgentRunningRef: { current: true },
    lastSilenceNoticeRef: { current: 5 },
    lastAgentEventRef: { current: 1000 },
    currentTurnIdRef: { current: 'turn-1' },
    thoughtExpandedRef: { current: true },
    draftExpandedRef: { current: true },
    draftBufferRef: { current: 'partial output' },
    thoughtBufferRef: { current: 'thinking' },
    pendingRequestRef: { current: { id: 1 } },
    lastAgentResponseRef: { current: { post: { id: 1 } } },
    agentStatusRef: { current: { type: 'tool_status', title: 'bash', status: 'Working...', tool_name: 'bash' } },
    stalledPostIdRef: { current: null },
    scrollToBottomRef: { current: () => undefined },
    setCurrentTurnId: () => undefined,
    setAgentDraft: (next) => setAgentDraftCalls.push(next),
    setAgentPlan: () => undefined,
    setAgentThought: () => undefined,
    setPendingRequest: () => undefined,
    setAgentStatus: (next) => setAgentStatusCalls.push(next),
    setPosts: (next) => setPostsCalls.push(next),
    dedupePosts: (posts) => posts,
    now: () => 42,
    nowIso: () => '2026-01-01T00:00:00.000Z',
  });

  expect(setAgentDraftCalls.at(-1)).toEqual({
    text: 'partial output',
    totalLines: 1,
    fullText: 'partial output',
  });
  expect(typeof setPostsCalls[0]).toBe('function');
  const appended = setPostsCalls[0]([{ id: 1, data: { content: 'a' } }]);
  expect(appended.at(-1)).toMatchObject({
    id: 42,
    data: {
      type: 'agent_response',
      content: 'partial output',
      is_local_stall: true,
      content_blocks: [
        expect.objectContaining({
          type: 'timeout_marker',
          timed_out: true,
          tool_action_summary: 'Timed out after bash: Working...',
          draft_recovered: true,
        }),
      ],
    },
  });
  expect(setAgentStatusCalls.at(-1)).toBeNull();
});
