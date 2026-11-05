import {expect,test} from 'bun:test';
import '../../helpers.js';
import {initDatabase,getDb,setRouterState,getRouterState} from '../../../src/db.js';
import {AgentStatusStore} from '../../../src/channels/web/agent/agent-status-store.js';
import {WebChannelRuntimeStateService} from '../../../src/channels/web/runtime/runtime-state-service.js';
import {createWebChannelEndpointContexts} from '../../../src/channels/web/endpoints/channel-endpoint-context-factory.js';

test('native projection exposes no persistence/restore/context-copy entrypoint and leaves opaque history intact',()=>{
  initDatabase();
  const key='last_agent_timestamp_web',historical=JSON.stringify({agentStatuses:{'web:test':{type:'thinking'}},contextUsages:{'web:test':{tokens:777,sessionGeneration:'same'}},draftRecoveries:{'web:test':{text:'historical uncommitted draft',totalLines:1,updatedAt:1}},unrelated:{keep:true}});
  setRouterState(key,historical);const before=getDb().serialize();
  const service=new WebChannelRuntimeStateService();
  for(const name of ['loadState','saveState','setContextUsage','getContextUsage'])expect(service).not.toHaveProperty(name);
  service.updateAgentStatus('web:test',{sdk_observation:true,type:'thinking',turn_id:'native:1'});
  expect(service.getAgentStatus('web:test')).toMatchObject({type:'thinking',turn_id:'native:1'});
  expect(getRouterState(key)).toBe(historical);expect(getDb().serialize()).toEqual(before);
});

test('status observations are bounded process-local hints with no persistent-store dependency',()=>{
  const store=new AgentStatusStore(15000,2);
  store.update('old',{type:'thinking'});store.update('middle',{type:'tool_call'});store.update('new',{type:'thinking'});
  expect(store.get('old')).toBeNull();expect(store.get('middle')).toMatchObject({type:'tool_call'});expect(store.get('new')).toMatchObject({type:'thinking'});
  for(const name of ['load','clearPersistedStatuses'])expect(store).not.toHaveProperty(name);
});

for(const tokens of [null,0,42])test(`current SDK context ${tokens} never reads a persisted or host-copied estimate`,async()=>{
  let staleReads=0;
  const expected={tokens,contextWindow:1000,percent:tokens===null?null:tokens/10,sessionGeneration:'same',tokensAreAuthoritative:true as const};
  const channel:any={getContextUsage(){staleReads++;return{tokens:999,contextWindow:1000,percent:99.9,sessionGeneration:'same'};},agentPool:{getSessionGenerationForChat:()=> 'same',getContextUsageForChat:async()=>expected}};
  const contexts=createWebChannelEndpointContexts(channel,{defaultChatJid:'web:test',defaultAgentId:'default',getIdentitySnapshot:()=>({}as any)});
  expect(await contexts.agentStatus().getContextUsageForChat('web:test')).toEqual(expected);
  expect(staleReads).toBe(0);
});

test('SDK observations cannot be overwritten by host work or relabelled as a successor',()=>{
 const store=new AgentStatusStore();
 const service=new WebChannelRuntimeStateService({agentStatusStore:store});
 service.updateAgentStatus('chat',{sdk_observation:true,type:'tool_call',tool_name:'sdk-tool',operation_id:'sdk-run'});
 service.updateAgentStatus('chat',{type:'thinking',operation_id:'host-successor',title:'Working'});
 expect(service.getAgentStatus('chat')).toMatchObject({type:'tool_call',tool_name:'sdk-tool',operation_id:'sdk-run'});
 service.updateAgentStatus('chat',{sdk_observation:true,type:'done',state:'idle'});
 expect(service.getAgentStatus('chat')).toMatchObject({type:'done',state:'idle'});
 store.dispose();
});

test('malformed historical router bytes remain inert and unchanged by local status updates',()=>{
 initDatabase();const historical='{malformed\u0000old model draft';setRouterState('last_agent_timestamp_web',historical);
 const before=getDb().serialize();
 const service=new WebChannelRuntimeStateService();
 expect(service.getAgentStatus('web:malformed')).toBeNull();
 service.updateAgentStatus('web:malformed',{type:'thinking'});
 expect(getRouterState('last_agent_timestamp_web')).toBe(historical);expect(getDb().serialize()).toEqual(before);
});
