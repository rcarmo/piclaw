import {expect,test} from 'bun:test';
import {AgentQueue} from '../../../../src/queue.js';
import {handleAgentMessage} from '../../../../src/channels/web/handlers/agent.js';
import {waitFor} from '../../../helpers.js';

test('concurrent idle acknowledgements use one execution lane for the same chat',async()=>{
const queue=new AgentQueue();let scheduled=0,inFlight=0,peak=0,processed=0;
const events:string[]=[];let releaseFirst!:()=>void;const gate=new Promise<void>(resolve=>{releaseFirst=resolve;});
const taskQueue={enqueue(_fn:()=>Promise<void>,key:string,lane:string){scheduled++;queue.enqueue(async()=>{inFlight++;peak=Math.max(peak,inFlight);processed++;if(processed===1)await gate;inFlight--;},key,lane);}};
let row=0;
const channel={queue:taskQueue,agentPool:{isStreaming:()=>false,isActive:()=>false},getQueuedFollowupCount:()=>0,json:(value:unknown,status=200)=>Response.json(value,{status}),broadcastEvent:(type:string)=>events.push(type),
async admitMessage(jid:string,text:string, _isBot: boolean,_media:unknown,_options:unknown,check:()=>void,_signal:unknown,defer:()=>boolean){check();expect(defer()).toBe(false);return{id:++row,chat_jid:jid,timestamp:new Date().toISOString(),data:{content:text,thread_id:row}};}} as any;
const request=(content:string)=>new Request('https://fixture/agent/default/message',{method:'POST',body:JSON.stringify({content})});
try{const responses=await Promise.all([handleAgentMessage(channel,request('first'),'/agent/default/message','web:same','default'),handleAgentMessage(channel,request('second'),'/agent/default/message','web:same','default')]);expect(responses.map(res=>res.status)).toEqual([201,201]);expect(scheduled).toBe(2);await waitFor(()=>processed===1);expect(peak).toBe(1);releaseFirst();await waitFor(()=>processed===2&&inFlight===0);expect(peak).toBe(1);expect(events).toEqual(['new_post','new_post']);}
finally{releaseFirst();await queue.shutdown();}
});
