import { expect, test } from 'bun:test';

import { resolveBackstopIntervalMs, shouldInvalidateAgentStatusSnapshot, startConnectedBackstop } from '../../web/src/ui/app-realtime-lifecycle-orchestration.js';

test('resolveBackstopIntervalMs uses fast polling while agent is active', () => {
  expect(resolveBackstopIntervalMs(true)).toBe(15000);
});

test('resolveBackstopIntervalMs uses slower polling while agent is idle', () => {
  expect(resolveBackstopIntervalMs(false)).toBe(60000);
});

test('connected backstop pauses while hidden without reviving stale late context replies', async () => {
  let visibility: 'visible' | 'hidden' = 'visible';
  let nextTimer = 1;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const listeners = new Set<() => void>();
  const document = {
    get visibilityState() { return visibility; },
    addEventListener: (_name: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_name: string, listener: () => void) => listeners.delete(listener),
  };
  const window = {
    setInterval: (callback: () => void, delay: number) => {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearInterval: (id: number) => timers.delete(id),
  };
  const deferred = () => {
    let resolve!: (value: any) => void;
    const promise = new Promise<any>(next => { resolve = next; });
    return { promise, resolve };
  };
  const activeChatJidRef = { current: 'web:scoped-backstop' };
  const replies = [deferred(), deferred(), deferred()];
  let statusIndex = 0;
  const calls: string[] = [];
  const dispose = startConnectedBackstop({
    intervalMs: resolveBackstopIntervalMs(true),
    viewStateRef: { current: {} },
    isAgentActive: true,
    refreshTimeline: () => { calls.push('timeline'); },
    refreshQueueState: () => { calls.push('queue'); },
    refreshAgentStatus: () => {
      calls.push('status');
      return replies[statusIndex++].promise;
    },
    refreshContextUsage: () => { calls.push('context'); },
    refreshAutoresearchStatus: () => { calls.push('autoresearch'); },
    currentChatJid: 'web:scoped-backstop',
    activeChatJidRef,
  }, { document: document as any, window: window as any });
  const tick = () => Array.from(timers.values()).at(-1)!.callback();
  const visibilityChanged = () => { for (const listener of listeners) listener(); };
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

  expect(Array.from(timers.values()).map(timer => timer.delay)).toEqual([15000]);
  tick();
  expect(calls).toEqual(['timeline', 'queue', 'status', 'autoresearch']);
  visibility = 'hidden';
  visibilityChanged();
  expect(timers.size).toBe(0);
  visibility = 'visible';
  visibilityChanged();
  expect(timers.size).toBe(1);
  expect(calls).toEqual(['timeline', 'queue', 'status', 'autoresearch']);
  replies[0].resolve({ context_revision: 'after-hide' });
  await flush();
  expect(calls.filter(call => call === 'context')).toHaveLength(0);

  tick();
  activeChatJidRef.current = 'web:other';
  replies[1].resolve({ context_revision: 'after-chat-switch' });
  await flush();
  expect(calls.filter(call => call === 'context')).toHaveLength(0);

  activeChatJidRef.current = 'web:scoped-backstop';
  tick();
  dispose();
  expect(timers.size).toBe(0);
  replies[2].resolve({ context_revision: 'after-connection-switch-or-unmount' });
  await flush();
  expect(calls.filter(call => call === 'context')).toHaveLength(0);
});

 test("opening and terminal statuses both invalidate cached Idle snapshots", () => {
 for (const event of ["agent_status","connected","model_changed"]) expect(shouldInvalidateAgentStatusSnapshot(event)).toBe(true);
 for (const event of ["agent_thought_delta","agent_draft_delta","profile_update"]) expect(shouldInvalidateAgentStatusSnapshot(event)).toBe(false);
});

test('same-turn tool/thinking progress cannot starve snapshot recovery, while ownership barriers invalidate', () => {
  for(const type of ['tool_call','tool_status','thinking','context_usage']) {
    expect(shouldInvalidateAgentStatusSnapshot('agent_status',{type,turn_id:'live'},'live')).toBe(false);
  }
  for(const type of ['done','error','idle','intent']) {
    expect(shouldInvalidateAgentStatusSnapshot('agent_status',{type,turn_id:'live'},'live')).toBe(true);
  }
  expect(shouldInvalidateAgentStatusSnapshot('agent_status',{type:'thinking',turn_id:'new'},'old')).toBe(true);
  expect(shouldInvalidateAgentStatusSnapshot('agent_status',{type:'thinking',turn_id:'first'},null)).toBe(true);
});

test('a pending shared recovery snapshot completes despite repeated same-turn tool updates',async()=>{
 const {getAgentUiSnapshot,invalidateAgentUiSnapshot}=await import('../../web/src/ui/agent-ui-snapshot.js');
 const originalFetch=globalThis.fetch;let calls=0,release!:(value:any)=>void;
 const payload={status:{status:'active',data:{type:'tool_status',turn_id:'live'},thought:{text:'Recovered thought'}},errors:[],model:null,context:null,metrics:{},agent_name:'Fixture'};
 globalThis.fetch=(async()=>{calls++;return calls===1?{ok:true,json:()=>new Promise(resolve=>{release=resolve;})} as Response:Response.json(payload);}) as typeof fetch;
 try{
  const pending=getAgentUiSnapshot('web:return-busy-invalidation');await Promise.resolve();await Promise.resolve();
  for(let i=0;i<10;i++)if(shouldInvalidateAgentStatusSnapshot('agent_status',{type:'tool_status',turn_id:'live'},'live'))invalidateAgentUiSnapshot('web:return-busy-invalidation');
  release(payload);expect((await pending).status.thought.text).toBe('Recovered thought');expect(calls).toBe(1);
 }finally{globalThis.fetch=originalFetch;}
});
