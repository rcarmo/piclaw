import {afterEach,beforeEach,expect,test} from 'bun:test';
import '../../helpers.js';
import {admitWebMessage} from '../../../src/channels/web/messaging/message-store.js';
import {handleAgentMessage} from '../../../src/channels/web/handlers/agent.js';
import {closeDatabase,getDb,initDatabase} from '../../../src/db.js';

beforeEach(()=>initDatabase());afterEach(()=>closeDatabase());
// HTTP/source-transaction port double only. SDK placement and immutable history
// are separately exercised by actual native-peer-input/native-web-queue-contract.
function fixture(){
  const calls:string[]=[],admitted:any[]=[],dispatches:any[][]=[];const fence={current:true};
  const unexpected=()=>{calls.push('legacy');throw Error('Legacy queue/streaming owner forbidden');};
  const accept=(stored:any)=>{expect(stored.database).toBe(getDb());expect(stored.database.inTransaction).toBe(true);admitted.push({rowId:stored.rowId,message:structuredClone(stored.message)});};
  const channel:any={
    authGateway:{isAuthEnabled:()=>false,getPrincipal:()=>({mode:'single-user'})},
    agentPool:{isDurableRuntime:()=>true,isStreaming:unexpected,isActive:unexpected,applyControlCommand:unexpected},
    queue:{isLaneBusy:unexpected,enqueue:unexpected},
    prepareInputText:(_chat:string,text:string)=>({text,assertCurrent(){if(!fence.current)throw Error('revoked');}}),
    getInputSourceAdmission:()=>accept,
    async dispatchAcceptedInput(...args:any[]){dispatches.push(args);return {submission_id:17,queued:true};},
    broadcastEvent:(event:string)=>calls.push(event),json:(body:unknown,status=200)=>Response.json(body,{status}),
  };
  for(const name of ['getQueuedInputSourceAdmission','getAcceptedQueuedSteering','admitQueuedFollowupItem','enqueueQueuedFollowupItem','getQueuedFollowupCount','resumeChat'])Object.defineProperty(channel,name,{get:unexpected});
  channel.admitMessage=(chat:string,content:string,isBot:boolean,media:number[],options:any,check:any,signal:AbortSignal)=>admitWebMessage(channel,{chatJid:chat,content,isBot,mediaIds:media,agentId:'default',agentName:'Fixture'},options,check,signal);
  const send=(payload:unknown,signal?:AbortSignal)=>handleAgentMessage(channel,new Request('https://fixture/agent/default/message',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal}),'/agent/default/message','web:queue-boundary','default');
  return {channel,calls,admitted,dispatches,fence,send};
}
const payloads=[{content:'queued input',mode:'queue'},{content:'steered input',mode:'steer',persist_steer:true},{content:'ordinary input',mode:'auto'},{content:'/queue explicit input'},{content:'/steer explicit input'}];
for(const missing of ['getInputSourceAdmission','admitMessage','dispatchAcceptedInput'])for(const payload of payloads)test(`native queue ingress rejects missing current ${missing} before source effects: ${payload.mode??payload.content}`,async()=>{
  const f=fixture();delete f.channel[missing];expect((await f.send(payload)).status).toBe(503);expect(f.calls).toEqual([]);expect(f.admitted).toEqual([]);expect(f.dispatches).toEqual([]);expect(getDb().query('SELECT * FROM messages').all()).toEqual([]);
});
for(const payload of payloads)test(`native input enters one source transaction and direct SDK admission without retired queue dependencies: ${payload.mode??payload.content}`,async()=>{
  const f=fixture(),response=await f.send(payload);expect(response.status).toBe(201);const receipt=await response.json() as any;
  const text=payload.content.replace(/^\/(?:queue|steer)\s+/,'');
  expect(f.admitted).toHaveLength(1);expect(f.admitted[0].message.content).toBe(text);
  expect(f.dispatches).toEqual([['web:queue-boundary',f.admitted[0].message.id,f.admitted[0].rowId,payload.mode==='steer'||payload.content.startsWith('/steer')?'steer':'followUp']]);
  expect(receipt).toMatchObject({created:true,row_id:f.admitted[0].rowId,submission_id:17,queued:payload.mode==='steer'||payload.content.startsWith('/steer')?'steer':'followup'});
  expect(receipt.user_message).toBeUndefined();expect(f.calls).toEqual(['agent_followup_queued']);
});
for(const failed of ['source-unavailable','source-selector-fenced','prepared-authority'])test(`native admission refuses current source/authority failure without effects: ${failed}`,async()=>{
  const f=fixture();if(failed==='prepared-authority')f.fence.current=false;else f.channel.getInputSourceAdmission=failed==='source-unavailable'?()=>undefined:()=>{throw Error('fenced private source');};
  expect((await f.send({content:'held input',mode:'steer'})).status).toBe(503);expect(f.calls).toEqual([]);expect(f.admitted).toEqual([]);expect(f.dispatches).toEqual([]);expect(getDb().query('SELECT * FROM messages').all()).toEqual([]);
});
for(const failure of ['revoke','abort'])test(`native source transaction rechecks ${failure} after asynchronous admission wait`,async()=>{
  const f=fixture(),controller=new AbortController();let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;}),admit=f.channel.admitMessage;
  f.channel.admitMessage=async(...args:any[])=>{entered();await gate;return admit(...args);};
  const pending=f.send({content:'held input',mode:'queue'},controller.signal);await ready;expect(f.admitted).toEqual([]);
  if(failure==='abort')controller.abort();else f.fence.current=false;release();expect((await pending).status).toBe(failure==='abort'?400:503);
  expect(f.admitted).toEqual([]);expect(f.dispatches).toEqual([]);expect(f.calls).toEqual([]);expect(getDb().query('SELECT * FROM messages').all()).toEqual([]);
});
test('raw native input requires source authority but no optional text transformation',async()=>{
  const f=fixture();delete f.channel.prepareInputText;const response=await f.send({content:'Raw accepted bytes',mode:'queue'});expect(response.status).toBe(201);expect(f.admitted[0].message.content).toBe('Raw accepted bytes');expect(f.dispatches).toHaveLength(1);expect(f.calls).toEqual(['agent_followup_queued']);
});
