import { expect, test } from 'bun:test';

import { handleAppSseEvent, type HandleAppSseEventDependencies } from '../../web/src/ui/app-sse-events.js';

function applyUpdate<T>(current: T, next: T | ((prev: T) => T)): T {
  return typeof next === 'function' ? (next as (prev: T) => T)(current) : next;
}

function createPreviewHarness() {
  let draft: any = { text: '', totalLines: 0 };
  let thought: any = { text: '', totalLines: 0 };
  let plan = '';
  const writes: Array<{ panel: 'draft' | 'thought'; value: any }> = [];
  const lifecycle: string[] = [];

  const deps: HandleAppSseEventDependencies = {
    currentChatJid: 'chat:preview',
    updateAgentProfile: () => undefined,
    updateUserProfile: () => undefined,
    currentTurnIdRef: { current: 'turn-preview' },
    agentStatusRef: { current: null },
    activeChatJidRef: { current: 'chat:preview' },
    draftBufferRef: { current: '' },
    thoughtBufferRef: { current: '' },
    previewResyncGenerationRef: { current: 0 },
    steerQueuedTurnIdRef: { current: null },
    thoughtExpandedRef: { current: false },
    draftExpandedRef: { current: false },
    draftThrottleRef: { current: 0 },
    thoughtThrottleRef: { current: 0 },
    viewStateRef: { current: { currentHashtag: null, searchQuery: null, searchOpen: false } },
    followupQueueItemsRef: { current: [] },
    dismissedQueueRowIdsRef: { current: new Set() },
    scrollToBottomRef: { current: null },
    hasMoreRef: { current: false },
    loadMoreRef: { current: null },
    lastAgentResponseRef: { current: null },
    wasAgentActiveRef: { current: true },
    setActiveTurn: () => undefined,
    applyLiveGeneratedWidgetUpdate: () => undefined,
    setFloatingWidget: () => undefined,
    clearLastActivityFlag: () => undefined,
    handleUiVersionDrift: () => false,
    setAgentStatus: () => undefined,
    setAgentDraft: (next) => {
      draft = applyUpdate(draft, next);
      writes.push({ panel: 'draft', value: structuredClone(draft) });
    },
    setAgentPlan: (next) => { plan = applyUpdate(plan, next); },
    setAgentThought: (next) => {
      thought = applyUpdate(thought, next);
      writes.push({ panel: 'thought', value: structuredClone(thought) });
    },
    setPendingRequest: () => undefined,
    clearAgentRunState: () => {
      lifecycle.push('clear');
      deps.draftBufferRef.current = '';
      deps.thoughtBufferRef.current = '';
    },
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
    refreshQueueState: () => undefined,
    setFollowupQueueItems: () => undefined,
    clearQueuedSteerStateIfStale: () => undefined,
    setSteerQueuedTurnId: () => undefined,
    applyModelState: () => undefined,
    getAgentContext: async () => null,
    setExtensionStatusPanels: () => undefined,
    setPendingExtensionPanelActions: () => undefined,
    setExtensionWorkingState: () => undefined,
    refreshActiveEditorFromWorkspace: () => undefined,
    showIntentToast: () => undefined,
    removeStalledPost: () => undefined,
    setPosts: () => undefined,
    preserveTimelineScrollTop: (mutate) => mutate(),
  };

  return {
    deps,
    getDraft: () => draft,
    getThought: () => thought,
    getPlan: () => plan,
    getWrites: () => writes,
    getLifecycle: () => lifecycle,
  };
}

function streamCollapsedPanel(
  eventBase: 'agent_draft' | 'agent_thought',
  lines: string[],
  harness: ReturnType<typeof createPreviewHarness>,
) {
  const deltaEvent = `${eventBase}_delta`;

  // Match production ordering exactly: content start first emits an empty
  // bounded snapshot and a separate empty reset delta. Each non-empty update
  // then emits its bounded snapshot before a non-reset full delta.
  handleAppSseEvent(eventBase, {
    chat_jid: 'chat:preview',
    turn_id: 'turn-preview',
    text: '',
    total_lines: 0,
    kind: eventBase === 'agent_draft' ? 'draft' : undefined,
    mode: eventBase === 'agent_draft' ? 'replace' : undefined,
  }, harness.deps);
  handleAppSseEvent(deltaEvent, {
    chat_jid: 'chat:preview',
    turn_id: 'turn-preview',
    reset: true,
    delta: '',
  }, harness.deps);

  for (let index = 0; index < lines.length; index += 1) {
    const accumulated = lines.slice(0, index + 1).join('\n');
    const preview = lines.slice(0, Math.min(index + 1, 8)).join('\n');
    handleAppSseEvent(eventBase, {
      chat_jid: 'chat:preview',
      turn_id: 'turn-preview',
      text: preview,
      total_lines: index + 1,
      kind: eventBase === 'agent_draft' ? 'draft' : undefined,
      mode: eventBase === 'agent_draft' ? 'replace' : undefined,
    }, harness.deps);
    handleAppSseEvent(deltaEvent, {
      chat_jid: 'chat:preview',
      turn_id: 'turn-preview',
      delta: index === 0 ? accumulated : `\n${lines[index]}`,
    }, harness.deps);
  }
}

function expectAuthoritativePreview(state: any, lines: string[]) {
  const expected = lines.join('\n');
  expect(state.fullText).toBe(expected);
  expect(state.fullText.split('\n')).toEqual(lines);
  expect(state.totalLines).toBe(lines.length);
  expect((state.fullText.match(new RegExp(lines[0], 'g')) || []).length).toBe(1);
  expect((state.fullText.match(new RegExp(lines.at(-1)!, 'g')) || []).length).toBe(1);
}

test('persisted response consumes the authoritative Draft preview', () => {
  const harness = createPreviewHarness();
  const lines = Array.from({ length: 24 }, (_, index) => `draft-line-${String(index + 1).padStart(2, '0')}`);

  streamCollapsedPanel('agent_draft', lines.slice(0, 12), harness);
  expect(harness.deps.draftBufferRef.current).toBe(lines.slice(0, 12).join('\n'));
  harness.deps.draftThrottleRef.current = Date.now();

  for (let index = 12; index < lines.length; index += 1) {
    const preview = lines.slice(0, 8).join('\n');
    handleAppSseEvent('agent_draft', {
      chat_jid: 'chat:preview', turn_id: 'turn-preview', text: preview,
      total_lines: index + 1, kind: 'draft', mode: 'replace',
    }, harness.deps);
    handleAppSseEvent('agent_draft_delta', {
      chat_jid: 'chat:preview', turn_id: 'turn-preview', delta: `\n${lines[index]}`,
    }, harness.deps);
  }

  handleAppSseEvent('agent_preview_consumed', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', content: 'done',
  }, harness.deps);

  expect(harness.deps.draftBufferRef.current).toBe('');
  expect(harness.getDraft()).toEqual({ text: '', totalLines: 0 });
});

test('persisted response consumes Draft and Thought without clearing Plan', () => {
  const harness = createPreviewHarness();
  handleAppSseEvent('agent_draft', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', kind: 'plan', mode: 'replace', text: 'keep plan',
  }, harness.deps);
  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'draft',
  }, harness.deps);
  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'thought',
  }, harness.deps);

  handleAppSseEvent('agent_preview_consumed', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', row_id: 42,
  }, harness.deps);

  expect(harness.getDraft()).toEqual({ text: '', totalLines: 0 });
  expect(harness.getThought()).toEqual({ text: '', totalLines: 0 });
  expect(harness.getPlan()).toBe('keep plan');
});

test('persisted response consumes the authoritative Thought preview', () => {
  const harness = createPreviewHarness();
  const lines = Array.from({ length: 24 }, (_, index) => `thought-line-${String(index + 1).padStart(2, '0')}`);

  streamCollapsedPanel('agent_thought', lines.slice(0, 12), harness);
  expect(harness.deps.thoughtBufferRef.current).toBe(lines.slice(0, 12).join('\n'));
  harness.deps.thoughtThrottleRef.current = Date.now();

  for (let index = 12; index < lines.length; index += 1) {
    handleAppSseEvent('agent_thought', {
      chat_jid: 'chat:preview', turn_id: 'turn-preview',
      text: lines.slice(0, 8).join('\n'), total_lines: index + 1,
    }, harness.deps);
    handleAppSseEvent('agent_thought_delta', {
      chat_jid: 'chat:preview', turn_id: 'turn-preview', delta: `\n${lines[index]}`,
    }, harness.deps);
  }

  handleAppSseEvent('agent_preview_consumed', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', content: 'done',
  }, harness.deps);

  expect(harness.deps.thoughtBufferRef.current).toBe('');
  expect(harness.getThought()).toEqual({ text: '', totalLines: 0 });
});

test('stale preview consumption cannot clear a newer turn', () => {
  const harness = createPreviewHarness();
  harness.deps.currentTurnIdRef.current = 'turn-new';
  harness.deps.draftBufferRef.current = 'new draft';
  harness.deps.thoughtBufferRef.current = 'new thought';

  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-new', reset: true, delta: 'new draft',
  }, harness.deps);
  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-new', reset: true, delta: 'new thought',
  }, harness.deps);
  handleAppSseEvent('agent_preview_consumed', {
    chat_jid: 'chat:preview', turn_id: 'turn-old', row_id: 42,
  }, harness.deps);

  expect(harness.getDraft().fullText).toBe('new draft');
  expect(harness.getThought().fullText).toBe('new thought');
});

test('bounded snapshots do not duplicate state writes once full Draft and Thought deltas are authoritative', () => {
  const harness = createPreviewHarness();

  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'draft-full',
  }, harness.deps);
  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'thought-full',
  }, harness.deps);
  const writesBeforeSnapshots = harness.getWrites().length;

  for (let index = 0; index < 50; index += 1) {
    handleAppSseEvent('agent_draft', {
      chat_jid: 'chat:preview', turn_id: 'turn-preview', text: `draft-preview-${index}`,
      total_lines: index + 1, kind: 'draft', mode: 'replace',
    }, harness.deps);
    handleAppSseEvent('agent_thought', {
      chat_jid: 'chat:preview', turn_id: 'turn-preview', text: `thought-preview-${index}`,
      total_lines: index + 1,
    }, harness.deps);
  }

  expect(harness.getWrites()).toHaveLength(writesBeforeSnapshots);
  expect(harness.getDraft().fullText).toBe('draft-full');
  expect(harness.getThought().fullText).toBe('thought-full');

  const snapshotOnly = createPreviewHarness();
  handleAppSseEvent('agent_draft', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', text: 'legacy draft', total_lines: 1,
    kind: 'draft', mode: 'replace',
  }, snapshotOnly.deps);
  handleAppSseEvent('agent_thought', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', text: 'legacy thought', total_lines: 1,
  }, snapshotOnly.deps);
  expect(snapshotOnly.getDraft()).toMatchObject({ text: 'legacy draft', totalLines: 1 });
  expect(snapshotOnly.getThought()).toMatchObject({ text: 'legacy thought', totalLines: 1 });
});

test('authoritative Thought text repairs a duplicated local buffer', () => {
  const harness = createPreviewHarness();
  const prefix = "Deciding on a commit\n\nI need to decide. First, I’ll";
  const complete = `${prefix} test the document differences.`;

  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: prefix, text: prefix,
  }, harness.deps);
  harness.deps.thoughtBufferRef.current = `${prefix}${complete}`;
  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', delta: '', text: complete,
  }, harness.deps);

  expectAuthoritativePreview(harness.getThought(), complete.split('\n'));
  expect(harness.deps.thoughtBufferRef.current).toBe(complete);
});

test('sub-throttle Draft and Thought suffixes render after a bounded live pause', async () => {
  const harness = createPreviewHarness();

  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'draft-a',
  }, harness.deps);
  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'thought-a',
  }, harness.deps);
  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', delta: '-draft-b',
  }, harness.deps);
  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', delta: '-thought-b',
  }, harness.deps);

  expect(harness.getDraft().fullText).toBe('draft-a');
  expect(harness.getThought().fullText).toBe('thought-a');
  await new Promise((resolve) => setTimeout(resolve, 125));
  expect(harness.getDraft().fullText).toBe('draft-a-draft-b');
  expect(harness.getThought().fullText).toBe('thought-a-thought-b');
});

test('new-turn and chat lifecycle changes invalidate stale trailing preview callbacks', async () => {
  const turnHarness = createPreviewHarness();
  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'old-a',
  }, turnHarness.deps);
  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', delta: '-old-b',
  }, turnHarness.deps);
  turnHarness.deps.currentTurnIdRef.current = 'turn-next';
  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:preview', turn_id: 'turn-next', type: 'thinking',
  }, turnHarness.deps);

  const chatHarness = createPreviewHarness();
  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'chat-a',
  }, chatHarness.deps);
  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', delta: '-chat-b',
  }, chatHarness.deps);
  chatHarness.deps.activeChatJidRef.current = 'chat:other';

  const resetHarness = createPreviewHarness();
  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'reset-old-a',
  }, resetHarness.deps);
  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', delta: '-reset-old-b',
  }, resetHarness.deps);
  handleAppSseEvent('agent_draft_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'reset-new',
  }, resetHarness.deps);

  const reconnectHarness = createPreviewHarness();
  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', reset: true, delta: 'reconnect-a',
  }, reconnectHarness.deps);
  handleAppSseEvent('agent_thought_delta', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', delta: '-reconnect-b',
  }, reconnectHarness.deps);
  handleAppSseEvent('connected', {}, reconnectHarness.deps);

  await new Promise((resolve) => setTimeout(resolve, 125));
  expect(turnHarness.getDraft().fullText || '').not.toContain('old-b');
  expect(chatHarness.getThought().fullText).toBe('chat-a');
  expect(resetHarness.getDraft().fullText).toBe('reset-new');
  expect(reconnectHarness.getThought().fullText || '').not.toContain('reconnect-b');
});

test('terminal status flushes authoritative preview state before clearing run refs', () => {
  const harness = createPreviewHarness();
  const lines = Array.from({ length: 24 }, (_, index) => `draft-line-${String(index + 1).padStart(2, '0')}`);
  harness.deps.draftBufferRef.current = lines.join('\n');
  harness.deps.draftThrottleRef.current = Date.now();

  handleAppSseEvent('agent_status', {
    chat_jid: 'chat:preview', turn_id: 'turn-preview', type: 'done',
  }, harness.deps);

  const fullWriteIndex = harness.getWrites().findIndex(({ panel, value }) => panel === 'draft' && value.fullText === lines.join('\n'));
  expect(fullWriteIndex).toBeGreaterThanOrEqual(0);
  expect(harness.getLifecycle()).toEqual(['clear']);
  expect(harness.deps.draftBufferRef.current).toBe('');
});
