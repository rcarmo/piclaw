import {afterEach,expect,test} from 'bun:test';
import {createTempWorkspace,setEnv} from '../../../helpers.js';
import {initDatabase,getDb,closeDatabase} from '../../../../src/db/connection.js';
import {getMessagesSince} from '../../../../src/db/messages.js';
import {admitWebMessage} from '../../../../src/channels/web/messaging/message-store.js';
import {QueuedFollowupLifecycleService} from '../../../../src/channels/web/runtime/queued-followup-lifecycle-service.js';
import {materializeDeferredFollowups,selectProcessChatMessage} from '../../../../src/channels/web/runtime/process-chat-control-runtime.js';
import {handleAgentMessage} from '../../../../src/channels/web/handlers/agent.js';
let cleanup:()=>void=()=>{};afterEach(()=>{closeDatabase();cleanup();});
function fixture(){const ws=createTempWorkspace('idle-routing-');const restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});cleanup=()=>{restore();ws.cleanup();};initDatabase();const queue=new QueuedFollowupLifecycleService();let busy=false,gates:Promise<void>[]=[],afterCommit:(()=>void)|undefined;const events:string[]=[];let wakes=0;
const channel={agentPool:{isStreaming:()=>busy,isActive:()=>busy},getQueuedFollowupCount:queue.getQueuedFollowupCount.bind(queue),enqueueQueuedFollowupItem:queue.enqueueQueuedFollowupItem.bind(queue),peekQueuedFollowupItem:queue.peekQueuedFollowupItem.bind(queue),consumeQueuedFollowupItem:queue.consumeQueuedFollowupItem.bind(queue),prependQueuedFollowupItem:queue.prependQueuedFollowupItem.bind(queue),
async admitMessage(jid:string,text:string, _isBot: boolean,media:number[],options:unknown,check:()=>void,signal:AbortSignal,defer:()=>boolean){const gate=gates.shift();if(gate)await gate;const result=await admitWebMessage(channel as any,{chatJid:jid,content:text,isBot:false,mediaIds:media,agentId:'default',agentName:'Fixture'},options as any,check,signal,defer);afterCommit?.();return result;},
broadcastEvent:(type:string)=>events.push(type),resumeChat:()=>{wakes++;},queue:{enqueue:()=>{wakes++;}},json:(value:unknown,status=200)=>Response.json(value,{status})} as any;
return{channel,queue,events,get wakes(){return wakes;},busy(value:boolean){busy=value;},gate(promise:Promise<void>){gates.push(promise);},afterCommit(fn:()=>void){afterCommit=fn;}};}
const request=(content:string)=>new Request('https://fixture/agent/default/message',{method:'POST',body:JSON.stringify({content})});
const messages=()=>(getDb().query('SELECT count(*) AS n FROM messages').get() as {n:number}).n;
for(const idleAfterCommit of [false,true])test(`idle-to-busy intent materializes once; idle after commit ${idleAfterCommit}`,async()=>{
const f=fixture();let release!:()=>void;f.gate(new Promise(resolve=>{release=resolve;}));
const pending=handleAgentMessage(f.channel,request('execute exactly once'),'/agent/default/message','web:route','default');await Bun.sleep(0);f.busy(true);
if(idleAfterCommit)f.afterCommit(()=>f.busy(false));
release();const response=await pending;expect(response.status).toBe(201);expect((await response.json()).queued).toBe('followup');expect(messages()).toBe(0);expect(f.queue.getQueuedFollowupCount('web:route')).toBe(1);expect(f.queue.peekQueuedFollowupItem('web:route')!.rowId).toBeLessThan(0);expect(f.wakes).toBe(idleAfterCommit?1:0);
f.busy(false);const result=await materializeDeferredFollowups({channel:f.channel,chatJid:'web:route',agentId:'default',assistantName:'Fixture'});expect(result.status).toBe('resumed');expect(messages()).toBe(1);expect(f.queue.getQueuedFollowupCount('web:route')).toBe(0);expect(f.events.filter(type=>type==='agent_followup_consumed')).toHaveLength(1);
const selected=selectProcessChatMessage({chatJid:'web:route',prevCursor:'',assistantName:'Fixture'});expect(selected.kind).toBe('message');expect(selected.pendingMessages).toHaveLength(1);const timestamp=selected.pendingMessages[0]!.timestamp;expect(getMessagesSince('web:route',timestamp,'Fixture')).toHaveLength(0);expect((await materializeDeferredFollowups({channel:f.channel,chatJid:'web:route',agentId:'default'})).status).toBe('none');expect(messages()).toBe(1);
});
test('two held ordinary admissions retain one row per input and monotonic commit order',async()=>{
const f=fixture();let releaseA!:()=>void,releaseB!:()=>void;f.gate(new Promise(resolve=>{releaseA=resolve;}));f.gate(new Promise(resolve=>{releaseB=resolve;}));
const first=handleAgentMessage(f.channel,request('A'),'/agent/default/message','web:concurrent','default');await Bun.sleep(0);const second=handleAgentMessage(f.channel,request('B'),'/agent/default/message','web:concurrent','default');await Bun.sleep(0);releaseB();expect((await second).status).toBe(201);releaseA();expect((await first).status).toBe(201);
const pending=getMessagesSince('web:concurrent','','Fixture');expect(pending.map(item=>item.content)).toEqual(['B','A']);expect(pending[1]!.timestamp>pending[0]!.timestamp).toBe(true);expect(getMessagesSince('web:concurrent',pending[0]!.timestamp,'Fixture').map(item=>item.content)).toEqual(['A']);expect(messages()).toBe(2);
});
