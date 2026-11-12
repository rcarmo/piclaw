import { expect, test } from 'bun:test';

import {
  buildFloatingWidgetDashboardData,
  closeFloatingWidgetFromHost,
  handleFloatingWidgetEventFromHost,
  handleInjectQueuedFollowupAction,
  handleRemoveQueuedFollowupAction,
  openFloatingWidgetFromHost,
} from '../../web/src/ui/app-floating-widget-followup.js';

test('buildFloatingWidgetDashboardData composes settled payloads into dashboard snapshot', async () => {
  const dashboard = await buildFloatingWidgetDashboardData({
    requestPayload: { source: 'test' },
    currentChatJid: 'chat-a',
    currentRootChatJid: 'chat-root',
    getAgentStatus: async () => ({ status: 'active', data: { type: 'thinking' } }),
    getAgentContext: async () => ({ percent: 42, tokens: 420, contextWindow: 1000 }),
    getAgentQueueState: async () => ({ count: 2 }),
    getAgentModels: async () => ({ current: 'gpt-5' }),
    getActiveChatAgents: async () => ({ chats: [{ chat_jid: 'chat-a' }] }),
    getChatBranches: async () => ({ chats: [{ chat_jid: 'chat-b' }] }),
    getTimeline: async () => ({ posts: [{ id: 11, timestamp: '2026-01-01T00:00:00.000Z', data: { is_bot_message: true } }] }),
    rawPosts: [],
    activeChatAgents: [],
    currentChatBranches: [],
    contextUsage: null,
    followupQueueItems: [],
    activeModel: null,
    activeThinkingLevel: null,
    supportsThinking: true,
    isAgentTurnActive: true,
  }) as Record<string, any>;

  expect(dashboard.request).toEqual({ source: 'test' });
  expect(dashboard.chat.currentChatJid).toBe('chat-a');
  expect(dashboard.queue.count).toBe(2);
  expect(dashboard.model.current).toBe('gpt-5');
  expect(dashboard.timeline.latestPostId).toBe(11);
});

test('steering keeps its SDK item visible until actual placement and refreshes on acceptance', async () => {
  const followupQueueItemsRef = { current: [{ row_id: 'r1', content: 'Queued' }] };
  const dismissedQueueRowIdsRef = { current: new Set<string | number>() };
  let followupQueueItems = [...followupQueueItemsRef.current];
  let refreshCount = 0;
  const calls: Array<[string | number, string | null]> = [];

  handleInjectQueuedFollowupAction({
    queuedItem: { row_id: 'r1' },
    followupQueueItemsRef,
    dismissedQueueRowIdsRef,
    currentChatJid: 'chat-a',
    refreshQueueState: () => { refreshCount += 1; },
    setFollowupQueueItems: (next) => {
      followupQueueItems = typeof next === 'function' ? next(followupQueueItems) : next;
    },
    showIntentToast: () => {},
    steerAgentQueueItem: async (rowId, chatJid) => {
      calls.push([rowId, chatJid]);
      return { queued: 'steer', removed: false };
    },
    removeAgentQueueItem: async () => ({ ok: true }),
  });

  // Still visible, now shown as steering until the SDK places it.
  expect(followupQueueItems).toEqual([{ row_id: 'r1', content: 'Queued', mode: 'steer' }]);
  expect(dismissedQueueRowIdsRef.current.has('r1')).toBe(false);

  await Promise.resolve();
  await Promise.resolve();

  expect(calls).toEqual([['r1', 'chat-a']]);
  expect(refreshCount).toBe(1);
});

test('handleRemoveQueuedFollowupAction restores dismissed row marker on failure and toasts warning', async () => {
  const followupQueueItemsRef = { current: [{ row_id: 'r1', content: 'Queued' }] };
  const dismissedQueueRowIdsRef = { current: new Set<string | number>() };
  let followupQueueItems = [...followupQueueItemsRef.current];
  let refreshCount = 0;
  const toastMessages: string[] = [];
  const clearCounts: number[] = [];

  handleRemoveQueuedFollowupAction({
    queuedItem: { row_id: 'r1' },
    followupQueueItemsRef,
    dismissedQueueRowIdsRef,
    currentChatJid: 'chat-a',
    refreshQueueState: () => { refreshCount += 1; },
    setFollowupQueueItems: (next) => {
      followupQueueItems = typeof next === 'function' ? next(followupQueueItems) : next;
    },
    showIntentToast: (title) => {
      toastMessages.push(title || '');
    },
    clearQueuedSteerStateIfStale: (remainingCount) => {
      clearCounts.push(remainingCount);
    },
    steerAgentQueueItem: async () => ({ ok: true }),
    removeAgentQueueItem: async () => {
      throw new Error('nope');
    },
  });

  expect(followupQueueItems).toEqual(followupQueueItemsRef.current);
  expect(clearCounts).toEqual([]);

  await Promise.resolve();
  await Promise.resolve();

  expect(dismissedQueueRowIdsRef.current.has('r1')).toBe(false);
  expect(refreshCount).toBe(1);
  expect(toastMessages).toContain('Failed to remove message');
  expect(followupQueueItems).toEqual(followupQueueItemsRef.current);
});

test('openFloatingWidgetFromHost and closeFloatingWidgetFromHost update dismissed session tracking', () => {
  const dismissedLiveWidgetKeysRef = { current: new Set<string>(['tool-1']) };
  let widgetState: Record<string, unknown> | null = {
    widgetId: 'tool-1',
    source: 'live',
    runtimeState: {},
  };

  openFloatingWidgetFromHost({
    widget: widgetState,
    dismissedLiveWidgetKeysRef,
    setFloatingWidget: (next) => {
      widgetState = typeof next === 'function' ? next(widgetState) : next;
    },
  });

  expect(dismissedLiveWidgetKeysRef.current.has('tool-1')).toBe(false);
  expect(widgetState?.openedAt).toBeDefined();

  closeFloatingWidgetFromHost({
    dismissedLiveWidgetKeysRef,
    setFloatingWidget: (next) => {
      widgetState = typeof next === 'function' ? next(widgetState) : next;
    },
  });

  expect(widgetState).toBeNull();
  expect(dismissedLiveWidgetKeysRef.current.has('tool-1')).toBe(true);
});

test('handleFloatingWidgetEventFromHost acknowledges refresh-only requests without dashboard rebuild', () => {
  const toasts: string[] = [];
  let closeCount = 0;
  let sendCalls = 0;
  let dashboardBuildCalls = 0;
  let widgetState: any = {
    widgetId: 'widget-1',
    source: 'live',
    runtimeState: { refreshCount: 2 },
  };

  handleFloatingWidgetEventFromHost({
    event: {
      kind: 'widget.request_refresh',
      payload: { buildDashboard: false },
    },
    widget: widgetState,
    currentChatJid: 'chat-a',
    isComposeBoxAgentActive: false,
    setFloatingWidget: (next) => {
      widgetState = typeof next === 'function' ? next(widgetState) : next;
    },
    handleCloseFloatingWidget: () => {
      closeCount += 1;
    },
    handleMessageResponse: () => {},
    showIntentToast: (title) => {
      toasts.push(title || '');
    },
    sendAgentMessage: async () => {
      sendCalls += 1;
      return { ok: true };
    },
    buildFloatingWidgetDashboardSnapshot: async () => {
      dashboardBuildCalls += 1;
      return {};
    },
  });

  expect(closeCount).toBe(0);
  expect(sendCalls).toBe(0);
  expect(dashboardBuildCalls).toBe(0);
  expect(toasts).toContain('Widget refresh requested');
  expect(widgetState.runtimeState.lastHostUpdate.type).toBe('refresh_ack');
  expect(widgetState.runtimeState.refreshCount).toBe(3);
});

for(const changed of [false,true])test(`removal returns its real server acknowledgement without publishing into a changed chat: changed=${changed}`,async()=>{
  const ack=Promise.withResolvers<{removed:boolean}>(),items=[{row_id:17,content:'Queued'}],dismissed={current:new Set<string|number>()};let current=true,writes=0,refreshes=0;
  const pending=handleRemoveQueuedFollowupAction({queuedItem:items[0],followupQueueItemsRef:{current:items},dismissedQueueRowIdsRef:dismissed,currentChatJid:'chat-a',
    isCurrent:()=>current,setFollowupQueueItems:()=>{writes++;},refreshQueueState:()=>{refreshes++;},showIntentToast:()=>{throw Error('Confirmed removal must not warn');},
    removeAgentQueueItem:()=>ack.promise,steerAgentQueueItem:async()=>({queued:'steer'})});
  expect(writes).toBe(0);if(changed)current=false;ack.resolve({removed:true});expect(await pending).toBe(true);
  expect(writes).toBe(changed?0:1);expect(refreshes).toBe(changed?0:1);expect(dismissed.current.has(17)).toBe(!changed);
});

for (const rejected of [false,true]) test(`steer completion cannot update a different session; rejected=${rejected}`,async()=>{
 let current=true,resolve!:(value:unknown)=>void,reject!:(error:Error)=>void;
 const pending=new Promise((a,b)=>{resolve=a;reject=b;});let updates=0,refreshes=0,toasts=0;
 handleInjectQueuedFollowupAction({queuedItem:{row_id:1},followupQueueItemsRef:{current:[{row_id:1,content:'A'}]},dismissedQueueRowIdsRef:{current:new Set()},currentChatJid:'chat-a',isCurrent:()=>current,refreshQueueState(){refreshes++;},setFollowupQueueItems(){updates++;},showIntentToast(){toasts++;},steerAgentQueueItem:()=>pending,removeAgentQueueItem:async()=>({})});
 expect(updates).toBe(1);current=false;
 if(rejected)reject(Error('Late rejection'));else resolve({queued:'steer'});
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 expect(updates).toBe(1);expect(refreshes).toBe(0);expect(toasts).toBe(0);
});
