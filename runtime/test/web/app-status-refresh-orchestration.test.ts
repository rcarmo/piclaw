import { afterEach, expect, test } from 'bun:test';

import {
  hasRenderableContextUsage,
  haveSameContextUsage,
  normalizeContextUsage,
  refreshAutoresearchStatusForChat,
  refreshContextUsageForChat,
  refreshCurrentView,
  refreshModelAndQueueState,
  refreshQueueStateForChat,
  resetContextSessionGenerationsForTests,
  reconcileContextUsageForChat,
  restoreContextUsage,
} from '../../web/src/ui/app-status-refresh-orchestration.js';

afterEach(() => resetContextSessionGenerationsForTests());

type QueueRow = { row_id: string | number; content?: string };

test('normalizeContextUsage preserves prompt cache-hit telemetry', () => {
  expect(normalizeContextUsage({
    tokens: null,
    contextWindow: null,
    percent: null,
    cacheUsage: {
      latest: {
        inputTokens: '1000',
        outputTokens: 300,
        reasoningTokens: 40,
        cacheReadTokens: 3000,
        cacheWriteTokens: 1000,
        cacheReadReported: true,
        cacheWriteReported: false,
        totalTokens: 5300,
        costTotal: 0.012,
        providerCostTotal: 0.012,
        catalogueCostTotal: 0.02,
        costProvenance: 'provider_reported',
        runs: 1,
        cacheHitRate: 60,
        provider: 'anthropic',
        runAt: '2026-06-08T12:00:00.000Z',
      },
      totals: {
        totalTokens: 5300,
        costTotal: 0.012,
        runs: 1,
        costCoverage: {
          providerReportedRuns: 1,
          catalogueEstimateRuns: 0,
          unavailableRuns: 0,
          legacyRuns: 0,
        },
      },
    },
  })).toEqual({
    tokens: null,
    contextWindow: null,
    percent: null,
    cacheUsage: {
      latest: {
        inputTokens: 1000,
        outputTokens: 300,
        reasoningTokens: 40,
        cacheReadTokens: 3000,
        cacheWriteTokens: 1000,
        cacheReadReported: true,
        cacheWriteReported: false,
        totalTokens: 5300,
        costTotal: 0.012,
        providerCostTotal: 0.012,
        catalogueCostTotal: 0.02,
        costCurrency: null,
        providerCostCurrency: null,
        costProvenance: 'provider_reported',
        runs: 1,
        cacheHitRate: 60,
        model: null,
        responseModel: null,
        provider: 'anthropic',
        api: null,
        turns: null,
        runAt: '2026-06-08T12:00:00.000Z',
      },
      totals: {
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        cacheReadReported: null,
        cacheWriteReported: null,
        totalTokens: 5300,
        costTotal: 0.012,
        providerCostTotal: null,
        catalogueCostTotal: null,
        costCurrency: null,
        providerCostCurrency: null,
        costProvenance: null,
        runs: 1,
        cacheHitRate: null,
        model: null,
        responseModel: null,
        provider: null,
        api: null,
        turns: null,
        runAt: null,
        costCoverage: {
          providerReportedRuns: 1,
          catalogueEstimateRuns: 0,
          unavailableRuns: 0,
          legacyRuns: 0,
        },
      },
    },
  });
  const omitted = normalizeContextUsage({
    tokens: null,
    contextWindow: null,
    percent: null,
    cacheUsage: { latest: { inputTokens: 100, cacheReadTokens: 0, cacheReadReported: false } },
  });
  expect((omitted?.cacheUsage as any)?.latest?.cacheReadReported).toBe(false);
  expect((omitted?.cacheUsage as any)?.latest?.providerCostTotal).toBeNull();
  expect((omitted?.cacheUsage as any)?.latest?.costProvenance).toBeNull();

  expect(hasRenderableContextUsage({ tokens: null, contextWindow: null, percent: null })).toBe(false);
  expect(hasRenderableContextUsage({ tokens: null, contextWindow: null, percent: null, cacheUsage: { latest: { cacheHitRate: 50 } } })).toBe(true);
});

test('reconcileContextUsageForChat keeps generation-less compatibility only until a generation is known', () => {
  const legacy = reconcileContextUsageForChat('chat:legacy', null, {
    tokens: 1200,
    contextWindow: 10000,
    percent: 12,
  });
  expect(legacy).toMatchObject({ tokens: 1200, percent: 12 });

  const scoped = reconcileContextUsageForChat('chat:legacy', legacy, {
    tokens: 800,
    contextWindow: 10000,
    percent: 8,
    sessionGeneration: 'session-current',
  }, { authoritative: true });
  const staleLegacy = reconcileContextUsageForChat('chat:legacy', scoped, {
    tokens: 9900,
    contextWindow: 10000,
    percent: 99,
  });
  expect(staleLegacy).toMatchObject({ tokens: 800, sessionGeneration: 'session-current' });
});

test('haveSameContextUsage includes cache telemetry in equality checks', () => {
  expect(haveSameContextUsage(
    { tokens: 100, contextWindow: 1000, percent: 10, cacheUsage: { latest: { cacheHitRate: 50 } } },
    { tokens: 100, contextWindow: 1000, percent: 10, cacheUsage: { latest: { cacheHitRate: 50 } } },
  )).toBe(true);
  expect(haveSameContextUsage(
    { tokens: 100, contextWindow: 1000, percent: 10, cacheUsage: { latest: { cacheHitRate: 50 } } },
    { tokens: 100, contextWindow: 1000, percent: 10, cacheUsage: { latest: { cacheHitRate: 60 } } },
  )).toBe(false);
});

test('refreshQueueStateForChat keeps only newest non-dismissed queue rows', async () => {
  const queueRefreshGenRef = { current: 0 };
  const activeChatJidRef = { current: 'chat:alpha' };
  const dismissedQueueRowIdsRef = { current: new Set<string | number>(['row-dismissed']) };
  const clearCounts: number[] = [];

  let queueRows: QueueRow[] = [{ row_id: 'row-old' }];
  refreshQueueStateForChat<QueueRow>({
    currentChatJid: 'chat:alpha',
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState: async () => ({
      items: [
        { row_id: 'row-dismissed', content: 'hidden' },
        { row_id: 'row-visible', content: 'keep' },
      ],
    }),
    setFollowupQueueItems: (next) => {
      queueRows = typeof next === 'function' ? next(queueRows) : next;
    },
    clearQueuedSteerStateIfStale: (remainingQueueCount) => {
      clearCounts.push(remainingQueueCount);
    },
  });

  await Promise.resolve();

  expect(queueRows).toEqual([{ row_id: 'row-visible', content: 'keep' }]);
  expect(clearCounts).toEqual([]);
});

test('refreshQueueStateForChat drops stale refresh generations and clears queue on empty payload', async () => {
  const queueRefreshGenRef = { current: 0 };
  const activeChatJidRef = { current: 'chat:alpha' };
  const dismissedQueueRowIdsRef = { current: new Set<string | number>(['row-dismissed']) };
  const clearCounts: number[] = [];

  let resolvePayload: ((value: { items: QueueRow[] }) => void) | null = null;
  let queueRows: QueueRow[] = [{ row_id: 'row-old' }];

  refreshQueueStateForChat<QueueRow>({
    currentChatJid: 'chat:alpha',
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState: () => new Promise((resolve) => {
      resolvePayload = resolve;
    }),
    setFollowupQueueItems: (next) => {
      queueRows = typeof next === 'function' ? next(queueRows) : next;
    },
    clearQueuedSteerStateIfStale: (remainingQueueCount) => {
      clearCounts.push(remainingQueueCount);
    },
  });

  // Simulate a newer refresh issued before this request resolves.
  queueRefreshGenRef.current += 1;
  resolvePayload?.({ items: [{ row_id: 'row-new' }] });
  await Promise.resolve();
  expect(queueRows).toEqual([{ row_id: 'row-old' }]);

  // Now run a non-stale refresh with no rows.
  refreshQueueStateForChat<QueueRow>({
    currentChatJid: 'chat:alpha',
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState: async () => ({ items: [] }),
    setFollowupQueueItems: (next) => {
      queueRows = typeof next === 'function' ? next(queueRows) : next;
    },
    clearQueuedSteerStateIfStale: (remainingQueueCount) => {
      clearCounts.push(remainingQueueCount);
    },
  });

  await Promise.resolve();

  expect(queueRows).toEqual([]);
  expect(dismissedQueueRowIdsRef.current.size).toBe(0);
  expect(clearCounts[clearCounts.length - 1]).toBe(0);
});

test('refreshQueueStateForChat preserves optimistic rows when the backend only returns dismissed ids', async () => {
  const queueRefreshGenRef = { current: 0 };
  const activeChatJidRef = { current: 'chat:alpha' };
  const dismissedQueueRowIdsRef = { current: new Set<string | number>([-1]) };
  const clearCounts: number[] = [];
  let queueRows: QueueRow[] = [{ row_id: -1, content: 'queued now' }];

  refreshQueueStateForChat<any>({
    currentChatJid: 'chat:alpha',
    queueRefreshGenRef,
    activeChatJidRef,
    dismissedQueueRowIdsRef,
    getAgentQueueState: async () => ({ items: [{ row_id: -1, content: 'queued now' }] }),
    setFollowupQueueItems: (next) => {
      queueRows = typeof next === 'function' ? next(queueRows) : next;
    },
    clearQueuedSteerStateIfStale: (remainingQueueCount) => {
      clearCounts.push(remainingQueueCount);
    },
  });

  await Promise.resolve();

  expect(queueRows).toEqual([{ row_id: -1, content: 'queued now' }]);
  expect(Array.from(dismissedQueueRowIdsRef.current)).toEqual([-1]);
  expect(clearCounts).toEqual([]);
});

test('restoreContextUsage rejects local storage from a replaced session generation', () => {
  const previousWindow = (globalThis as any).window;
  const storage = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  };
  try {
    reconcileContextUsageForChat('chat:alpha', null, {
      tokens: 95000,
      contextWindow: 100000,
      percent: 95,
      sessionGeneration: 'session-old',
    }, { authoritative: true });
    storage.set('piclaw:ctx:chat:alpha',JSON.stringify({tokens:95000,sessionGeneration:'session-old'}));
    reconcileContextUsageForChat('chat:alpha', null, {
      tokens: null,
      contextWindow: 100000,
      percent: null,
      sessionGeneration: 'session-new',
    }, { authoritative: true });

    expect(restoreContextUsage('chat:alpha')).toMatchObject({
      tokens: null, percent: null, sessionGeneration: 'session-new',
    });
  } finally {
    (globalThis as any).window = previousWindow;
  }
});

test('refreshContextUsageForChat ignores stale chat responses', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let contextState: any = null;

  const pending = refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({ tokens: 4200, contextWindow: 100000, percent: 4.2, sessionGeneration: 'session-alpha' }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  activeChatJidRef.current = 'chat:beta';
  await pending;

  expect(contextState).toBeNull();
});

test('refreshContextUsageForChat preserves cached metrics for an empty response from the same generation', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let contextState: any = reconcileContextUsageForChat('chat:alpha', null, {
    tokens: 5000,
    contextWindow: 128000,
    percent: 3.9,
    sessionGeneration: 'session-alpha',
  }, { authoritative: true });

  await refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({ tokens: null, contextWindow: null, percent: null, sessionGeneration: 'session-alpha' }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  expect(contextState).toEqual({
    tokens: 5000,
    contextWindow: 128000,
    percent: 3.9,
    cacheUsage: null,
    sessionGeneration: 'session-alpha',
  });
});

test('refreshContextUsageForChat updates state when API returns real data', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let contextState: any = null;

  await refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({ tokens: 8000, contextWindow: 128000, percent: 6.25, sessionGeneration: 'session-alpha' }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  expect(contextState).toEqual({ tokens: 8000, contextWindow: 128000, percent: 6.25, cacheUsage: null, sessionGeneration: 'session-alpha' });
});

test('refreshContextUsageForChat merges cache-only telemetry into existing context metrics', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let contextState: any = reconcileContextUsageForChat('chat:alpha', null, {
    tokens: 5000,
    contextWindow: 128000,
    percent: 3.9,
    sessionGeneration: 'session-alpha',
  }, { authoritative: true });

  await refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({
      tokens: null,
      contextWindow: null,
      percent: null,
      cacheUsage: { latest: { cacheHitRate: 87.3, cacheReadTokens: 873, inputTokens: 100, cacheWriteTokens: 27 } },
      sessionGeneration: 'session-alpha',
    }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  expect(contextState).toMatchObject({
    tokens: 5000,
    contextWindow: 128000,
    percent: 3.9,
    sessionGeneration: 'session-alpha',
    cacheUsage: { latest: { cacheHitRate: 87.3 } },
  });
});

test('refreshContextUsageForChat preserves cache telemetry when context metrics update', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  const cacheUsage = { latest: { cacheHitRate: 87.3 }, totals: null };
  let contextState: any = reconcileContextUsageForChat('chat:alpha', null, {
    tokens: 5000,
    contextWindow: 128000,
    percent: 3.9,
    cacheUsage,
    sessionGeneration: 'session-alpha',
  }, { authoritative: true });

  await refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({ tokens: 8000, contextWindow: 128000, percent: 6.25, sessionGeneration: 'session-alpha' }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  expect(contextState).toMatchObject({
    tokens: 8000,
    contextWindow: 128000,
    percent: 6.25,
    sessionGeneration: 'session-alpha',
    cacheUsage: { latest: { cacheHitRate: 87.3 } },
  });
});

test('refreshContextUsageForChat clears stale metrics when the authoritative generation changes', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let contextState: any = reconcileContextUsageForChat('chat:alpha', null, {
    tokens: 95000,
    contextWindow: 100000,
    percent: 95,
    sessionGeneration: 'session-old',
  }, { authoritative: true });

  await refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({ tokens: null, contextWindow: 100000, percent: null, sessionGeneration: 'session-new' }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });

  expect(contextState).toEqual({
    tokens: null,
    contextWindow: 100000,
    percent: null,
    cacheUsage: null,
    sessionGeneration: 'session-new',
  });
});

test('refreshContextUsageForChat drops an old API response after a newer generation is adopted', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let contextState: any = null;
  let resolveOld!: (value: any) => void;
  const oldResponse = new Promise((resolve) => { resolveOld = resolve; });

  const stale = refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: () => oldResponse,
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });
  await refreshContextUsageForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAgentContext: async () => ({ tokens: null, contextWindow: 100000, percent: null, sessionGeneration: 'session-new' }),
    setContextUsage: (next) => {
      contextState = typeof next === 'function' ? next(contextState) : next;
    },
  });
  resolveOld({ tokens: 95000, contextWindow: 100000, percent: 95, sessionGeneration: 'session-old' });
  await stale;

  expect(contextState?.sessionGeneration).toBe('session-new');
  expect(contextState?.tokens).toBeNull();
});

test('refreshAutoresearchStatusForChat updates panels and clears autoresearch pending actions', async () => {
  const activeChatJidRef = { current: 'chat:alpha' };
  let panelState = new Map<string, any>();
  let pendingActions = new Set<string>(['autoresearch:stop', 'custom:keep']);

  await refreshAutoresearchStatusForChat({
    currentChatJid: 'chat:alpha',
    activeChatJidRef,
    getAutoresearchStatus: async () => ({
      key: 'autoresearch',
      content: [{ type: 'status_panel', panel: { state: 'running', title: 'Auto' } }],
    }),
    setExtensionStatusPanels: (next) => {
      panelState = typeof next === 'function' ? next(panelState) : next;
    },
    setPendingExtensionPanelActions: (next) => {
      pendingActions = typeof next === 'function' ? next(pendingActions) : next;
    },
  });

  expect(panelState.get('autoresearch')).toEqual({ state: 'running', title: 'Auto' });
  expect(Array.from(pendingActions)).toEqual(['custom:keep']);
});

test('refreshCurrentView refreshes timeline only on main view and always refreshes model/queue bundle', () => {
  let timelineCalls = 0;
  let bundleCalls = 0;

  refreshCurrentView({
    viewStateRef: { current: { currentHashtag: null, searchQuery: null, searchOpen: false } },
    refreshTimeline: () => { timelineCalls += 1; },
    refreshModelAndQueueState: () => { bundleCalls += 1; },
  });

  refreshCurrentView({
    viewStateRef: { current: { currentHashtag: 'tag', searchQuery: null, searchOpen: false } },
    refreshTimeline: () => { timelineCalls += 1; },
    refreshModelAndQueueState: () => { bundleCalls += 1; },
  });

  expect(timelineCalls).toBe(1);
  expect(bundleCalls).toBe(2);

  const calls: string[] = [];
  refreshModelAndQueueState({
    refreshModelState: () => calls.push('model'),
    refreshActiveChatAgents: () => calls.push('active'),
    refreshCurrentChatBranches: () => calls.push('branches'),
    refreshQueueState: () => calls.push('queue'),
    refreshContextUsage: () => calls.push('context'),
    refreshAutoresearchStatus: () => calls.push('autoresearch'),
  });
  expect(calls).toEqual(['model', 'active', 'branches', 'queue', 'context', 'autoresearch']);
});

test('a slow context fetch cannot overwrite newer same-generation streamed usage',async()=>{
 const {getContextUsageRevision}=await import('../../web/src/ui/app-status-refresh-orchestration');
 let usage:any=reconcileContextUsageForChat('chat-race',null,{tokens:100,percent:1,contextWindow:10000,sessionGeneration:'same'},{authoritative:true});
 let release!:(value:any)=>void;
 const pending=refreshContextUsageForChat({currentChatJid:'chat-race',activeChatJidRef:{current:'chat-race'},getAgentContext:()=>new Promise(r=>{release=r;}),setContextUsage:next=>{usage=typeof next==='function'?next(usage):next;}});
 const before=getContextUsageRevision('chat-race');
 usage=reconcileContextUsageForChat('chat-race',usage,{tokens:900,percent:9,contextWindow:10000,sessionGeneration:'same'});
 expect(getContextUsageRevision('chat-race')).toBeGreaterThan(before);
 release({tokens:200,percent:2,contextWindow:10000,sessionGeneration:'same'});await pending;
 expect(usage.tokens).toBe(900);
});
