import { afterEach, expect, test } from 'bun:test';
import { refreshAgentStatusForChat } from '../../web/src/ui/app-agent-status-orchestration.js';
import { handleConnectionStatusChangeEvent } from '../../web/src/ui/app-connection-lifecycle.js';
import { getAgentUiSnapshot } from '../../web/src/ui/agent-ui-snapshot.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function harness(chatJid: string) {
  const connectionStateRef = { current: { status: 'connected' as string | undefined, generation: 0 } };
  const agentStatusRef = { current: null as any };
  const draftBufferRef = { current: '' };
  const thoughtBufferRef = { current: '' };
  let draft = { text: '', totalLines: 0 };
  let thought = { text: '', totalLines: 0 };
  let applies = 0;
  const options = {
    currentChatJid: chatJid, connectionStateRef,
    activeChatJidRef: { current: chatJid }, currentTurnIdRef: { current: null as string | null },
    wasAgentActiveRef: { current: false }, viewStateRef: { current: null },
    refreshTimeline: () => {}, clearAgentRunState: () => {},
    agentStatusRef, pendingRequestRef: { current: null }, draftBufferRef, thoughtBufferRef,
    setAgentStatus: (next: any) => { agentStatusRef.current = next; applies++; },
    setAgentDraft: (next: any) => { draft = typeof next === 'function' ? next(draft) : next; },
    setAgentThought: (next: any) => { thought = typeof next === 'function' ? next(thought) : next; },
    setAgentPlan: () => {}, setPendingRequest: () => {}, setExtensionWorkingState: () => {},
    setActiveTurn: () => {}, noteAgentActivity: () => {}, clearLastActivityFlag: () => {},
  };
  return {
    options, connectionStateRef, agentStatusRef,
    state: () => ({ draft, thought, applies }),
    connection(status: string) {
      handleConnectionStatusChangeEvent({
        ...options, status, setConnectionStatus: () => {}, hasConnectedOnceRef: { current: true },
        refreshAgentStatus: () => {}, refreshQueueState: () => {}, refreshContextUsage: () => {},
      });
    },
  };
}
const active = {
  status: 'active', data: { type: 'thinking', turn_id: 'old-turn' },
  draft: { text: 'Old draft', totalLines: 1 }, thought: { text: 'Old thought', totalLines: 1 },
};

for (const reconnect of [false, true]) {
  test(`late active reply cannot restore cleared null/empty refs after disconnect${reconnect ? '/reconnect ABA' : ''}`, async () => {
    const h = harness(`web:disconnect-${reconnect}`);
    let release!: (value: any) => void;
    const pending = refreshAgentStatusForChat({ ...h.options, getAgentStatus: () => new Promise(resolve => { release = resolve; }) });
    h.connection('disconnected');
    if (reconnect) h.connection('connected');
    const before = h.state();
    release(active);
    expect(await pending).toBeNull();
    expect(h.agentStatusRef.current).toBeNull();
    expect(h.state()).toEqual(before);
    if (reconnect) {
      expect(await refreshAgentStatusForChat({ ...h.options, getAgentStatus: async () => active })).toBe(active);
      expect(h.state().draft.text).toBe('Old draft');
      expect(h.state().thought.text).toBe('Old thought');
    }
  });
}

test('refresh started while disconnected does not fetch or apply active previews', async () => {
  const h = harness('web:already-disconnected');
  h.connection('reconnecting');
  let fetched = false;
  expect(await refreshAgentStatusForChat({ ...h.options, getAgentStatus: async () => { fetched = true; return active; } })).toBeNull();
  expect(fetched).toBe(false);
  expect(h.agentStatusRef.current).toBeNull();
});

test('connection transitions invalidate cached shared UI snapshots before reconnect refresh', async () => {
  const h = harness('web:connection-cache');
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ status: { status: 'idle' }, model: { current: calls }, context: {}, metrics: {}, agent_name: 'Fixture', errors: [] });
  }) as typeof fetch;
  expect((await getAgentUiSnapshot(h.options.currentChatJid)).model.current).toBe(1);
  h.connection('disconnected');
  h.connection('connected');
  expect((await getAgentUiSnapshot(h.options.currentChatJid)).model.current).toBe(2);
});

for (const progressed of ['draft', 'status'] as const) test(`same-turn ${progressed} progress cannot prevent restoring a missing thought pane`, async () => {
  const h = harness(`web:return-${progressed}`);
  h.options.currentTurnIdRef.current = 'live-turn';
  h.agentStatusRef.current = { type: 'thinking', turn_id: 'live-turn' };
  let release!: (value: any) => void;
  const pending = refreshAgentStatusForChat({ ...h.options, getAgentStatus: () => new Promise(resolve => { release = resolve; }) });
  if (progressed === 'draft') h.options.draftBufferRef.current = 'Newer live draft';
  else h.agentStatusRef.current = { type: 'tool_call', turn_id: 'live-turn', title: 'Current tool' };
  const liveStatus = h.agentStatusRef.current;
  release({status:'active',data:{type:'thinking',turn_id:'live-turn'},thought:{text:'Background thought restored',totalLines:1},draft:{text:'Snapshot draft',totalLines:1}});
  expect(await pending).toBeNull();
  expect(h.state().thought.text).toBe('Background thought restored');
  if (progressed === 'draft') expect(h.options.draftBufferRef.current).toBe('Newer live draft');
  else expect(h.agentStatusRef.current).toBe(liveStatus);
});

for(const newer of ['completed','different-turn','idle-reply'] as const) test(`preview recovery still fences ${newer}`,async()=>{
 const h=harness(`web:return-fence-${newer}`);
 h.options.currentTurnIdRef.current='live-turn';
 h.agentStatusRef.current={type:'thinking',turn_id:'live-turn'};
 let release!:(value:any)=>void;
 const pending=refreshAgentStatusForChat({...h.options,getAgentStatus:()=>new Promise(resolve=>{release=resolve;})});
 if(newer==='completed')h.agentStatusRef.current={type:'done',turn_id:'live-turn'};
 if(newer==='different-turn'){h.options.currentTurnIdRef.current='next-turn';h.agentStatusRef.current={type:'thinking',turn_id:'next-turn'};}
 if(newer==='idle-reply')h.options.draftBufferRef.current='Current live draft';
 release(newer==='idle-reply'?{status:'idle',data:null}:active);
 expect(await pending).toBeNull();
 expect(h.state().thought.text).toBe('');
 if(newer==='idle-reply')expect(h.options.draftBufferRef.current).toBe('Current live draft');
});

test('thought progress preserves the newer thought while recovering a missing draft',async()=>{
 const h=harness('web:return-thought-progress');
 h.options.currentTurnIdRef.current='live-turn';h.agentStatusRef.current={type:'thinking',turn_id:'live-turn'};
 let release!:(value:any)=>void;
 const pending=refreshAgentStatusForChat({...h.options,getAgentStatus:()=>new Promise(resolve=>{release=resolve;})});
 h.options.thoughtBufferRef.current='Newer live thought';h.options.setAgentThought({text:'Newer live thought',totalLines:1});
 release({status:'active',data:{type:'thinking',turn_id:'live-turn'},thought:{text:'Older thought',totalLines:1},draft:{text:'Recovered draft',totalLines:1}});
 expect(await pending).toBeNull();expect(h.state().thought.text).toBe('Newer live thought');expect(h.state().draft.text).toBe('Recovered draft');
});

test('partial recovery also leaves an existing collapsed preview untouched when its full buffer is absent',async()=>{
 const h=harness('web:return-existing-collapsed');h.options.currentTurnIdRef.current='live-turn';h.agentStatusRef.current={type:'thinking',turn_id:'live-turn'};
 h.options.setAgentThought({text:'Existing collapsed preview',totalLines:1});
 let release!:(value:any)=>void;const pending=refreshAgentStatusForChat({...h.options,getAgentStatus:()=>new Promise(resolve=>{release=resolve;})});
 h.options.draftBufferRef.current='Live draft';
 release({status:'active',data:{type:'thinking',turn_id:'live-turn'},thought:{text:'Longer snapshot should not replace the existing pane',totalLines:2}});
 expect(await pending).toBeNull();expect(h.state().thought.text).toBe('Existing collapsed preview');
});
