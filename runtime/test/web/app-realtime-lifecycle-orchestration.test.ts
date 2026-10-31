import { expect, test } from 'bun:test';

import { resolveBackstopIntervalMs, shouldInvalidateAgentStatusSnapshot } from '../../web/src/ui/app-realtime-lifecycle-orchestration.js';

test('resolveBackstopIntervalMs uses fast polling while agent is active', () => {
  expect(resolveBackstopIntervalMs(true)).toBe(15000);
});

test('resolveBackstopIntervalMs uses slower polling while agent is idle', () => {
  expect(resolveBackstopIntervalMs(false)).toBe(60000);
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
