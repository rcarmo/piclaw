import {afterEach,beforeEach,expect,test} from 'bun:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createTempWorkspace,setEnv} from '../../helpers.js';
import {initDatabase,getDb,closeDatabase} from '../../../src/db/connection.js';
import {createWebSession,revokeUserWebSessions} from '../../../src/db/web-sessions.js';
import {WebAuthGateway} from '../../../src/channels/web/auth/auth-gateway.js';
import {WebauthnChallengeTracker} from '../../../src/channels/web/auth/webauthn-challenges.js';
import {TotpFailureTracker} from '../../../src/channels/web/auth/totp-failure-tracker.js';
import {enforceRequestGuards} from '../../../src/channels/web/http/request-guards.js';
import {getRouteFlags} from '../../../src/channels/web/http/route-flags.js';
import {resetRateLimiterStateForTests} from '../../../src/channels/web/http/rate-limit.js';
import {handleAgentMessage} from '../../../src/channels/web/handlers/agent.js';
import {storeWebMessage,admitWebUserMessage} from '../../../src/channels/web/messaging/message-store.js';
import {QueuedFollowupLifecycleService} from '../../../src/channels/web/runtime/queued-followup-lifecycle-service.js';
import {WebChannelRuntimePublicSurfaceService} from '../../../src/channels/web/core/web-channel-runtime-public-surface-service.js';
import {createDirectChatToolRelayHandler} from '../../../src/extensions/chat-tool-runtime.js';
import {bindInputRequestAuthority,releaseInputRequestAuthority} from '../../../src/channels/web/messaging/input-request-authority.js';
import {ensureChatBranch,getChatBranchByChatJid} from '../../../src/db/chat-branches.js';
import {admitAddonLocalRequest,setAddonLocalContextHost,withAddonLocalRequest,addonLocalContextApi} from '../../../src/addons/local-context.js';
import {materializeDeferredFollowups} from '../../../src/channels/web/runtime/process-chat-control-runtime.js';
import {withExecutionIdentity} from '../../../src/core/execution-context.js';

let ws:ReturnType<typeof createTempWorkspace>,restore:()=>void;
beforeEach(()=>{ws=createTempWorkspace('idle-authority-');restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});mkdirSync(join(ws.workspace,'.piclaw'),{recursive:true});writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'single-user'}}}),{mode:0o600});closeDatabase();initDatabase();resetRateLimiterStateForTests();createWebSession('synthetic-cookie','default',3600,'totp');});
afterEach(()=>{setAddonLocalContextHost(null);closeDatabase();restore();ws.cleanup();resetRateLimiterStateForTests();});
function fixture(){
 const config={accessMode:'single-user' as const,passkeyMode:'',totpSecret:'synthetic-totp',internalSecret:'synthetic-internal',hasTls:true,sessionTtlSeconds:3600};
 const json=(body:unknown,status=200)=>Response.json(body,{status});
 const auth=new WebAuthGateway(config,{json,challenges:new WebauthnChallengeTracker(),failureTracker:new TotpFailureTracker()});
 const queue=new QueuedFollowupLifecycleService();const events:Array<{type:string,payload:any}>=[];let busy=false,hold:Promise<void>|undefined,heldJid:string|undefined,scheduled=0;
 const branches=[{chat_jid:'web:source',agent_name:'source',branch_id:'source-incarnation'},{chat_jid:'web:target',agent_name:'target',branch_id:'target-incarnation'}];
 const channel={authGateway:auth,json,endpointContexts:{auth:()=>({})},agentPool:{isStreaming:(jid:string)=>jid==='web:target'&&busy,isActive:(jid:string)=>jid==='web:target'&&busy,findChatByAgentName:(name:string)=>branches.find(b=>b.agent_name===name)??null,getAgentHandleForChat:(jid:string)=>branches.find(b=>b.chat_jid===jid)?.agent_name??'fixture',listActiveChats:()=>branches,listKnownChats:()=>branches},
 getQueuedFollowupCount:queue.getQueuedFollowupCount.bind(queue),enqueueQueuedFollowupItem:queue.enqueueQueuedFollowupItem.bind(queue),
 async admitQueuedFollowupItem(args:any,check:()=>void,signal:AbortSignal){if(hold&&(!heldJid||args[0]===heldJid))await hold;return queue.admitQueuedFollowupItem(args,check,signal);},
 async admitUserMessage(jid:string,text:string,media:number[],options:any,check:()=>void,signal:AbortSignal,defer?:()=>boolean){if(hold&&(!heldJid||jid===heldJid))await hold;return admitWebUserMessage(channel as any,{chatJid:jid,content:text,isBot:false,mediaIds:media,agentId:'default',agentName:'Fixture'},options,check,signal,defer);},
 storeMessage(jid:string,text:string,isBot:boolean,media:number[],options:any){return storeWebMessage(channel as any,{chatJid:jid,content:text,isBot,mediaIds:media,agentId:'default',agentName:'Fixture'},options);},broadcastEvent:(type:string,payload:any)=>events.push({type,payload}),queue:{enqueue:()=>{scheduled++;}},resumeChat:()=>{scheduled++;}} as any;
 const route=async(req:Request)=>{const url=new URL(req.url);return await enforceRequestGuards(channel,req,url.pathname,getRouteFlags(req,url.pathname))??await handleAgentMessage(channel,req,url.pathname,url.searchParams.get('chat_jid')||'web:source','default');};
 return{channel,auth,config,queue,events,branches,route,get scheduled(){return scheduled;},busy(value:boolean){busy=value;},hold(value:Promise<void>,jid?:string){hold=value;heldJid=jid;}};
}
function request(content='ordinary',options:{cookie?:boolean;secret?:string;signal?:AbortSignal;target?:string;headers?:Record<string,string>}={}){return new Request(`https://fixture/agent/default/message?chat_jid=${options.target??'web:source'}`,{method:'POST',headers:{Origin:'https://fixture','Content-Type':'application/json',...(options.cookie===false?{}:{Cookie:'piclaw_session=synthetic-cookie'}),...(options.secret?{'x-piclaw-internal-secret':options.secret}:{}),...options.headers},body:JSON.stringify({content}),signal:options.signal});}
const rows=(jid:string)=>(getDb().query('SELECT count(*) AS n FROM messages WHERE chat_jid=?').get(jid) as {n:number}).n;
for(const busy of [false,true])test(`verified cookie mention preserves original authority for ${busy?'busy':'idle'} target`,async()=>{
 const f=fixture();f.busy(busy);const response=await f.route(request('@target deliver authenticated input'));expect(response.status).toBe(201);expect(rows('web:source')).toBe(1);expect(rows('web:target')).toBe(busy?0:1);expect(f.queue.getQueuedFollowupCount('web:target')).toBe(busy?1:0);expect(f.scheduled).toBe(busy?0:1);
});
for(const mutation of ['revoke','expire','abort','target'] as const)test(`mention target waiting rechecks original ${mutation}; source persistence remains explicit`,async()=>{
 const f=fixture();let release!:()=>void;f.hold(new Promise(resolve=>{release=resolve;}),'web:target');const abort=new AbortController();const pending=f.route(request('@target delayed input',{signal:abort.signal}));for(let n=0;n<20&&rows('web:source')===0;n++)await Bun.sleep(0);expect(rows('web:source')).toBe(1);
 if(mutation==='revoke')revokeUserWebSessions('default');else if(mutation==='expire')getDb().query('UPDATE web_sessions SET expires_at=?').run('2000-01-01T00:00:00Z');else if(mutation==='abort')abort.abort(Error('cancelled'));else f.branches[1].chat_jid='web:replacement';release();const response=await pending;expect(response.status).toBeGreaterThanOrEqual(400);expect(rows('web:target')).toBe(0);expect(f.queue.getQueuedFollowupCount('web:target')).toBe(0);expect(f.scheduled).toBe(0);expect(f.events.filter(e=>e.payload?.chat_jid==='web:target')).toEqual([]);
});
test('real guards admit only freshly verified internal secret, not absent/wrong/rotated authority',async()=>{
 const f=fixture();expect((await f.route(request('internal input',{cookie:false,secret:'synthetic-internal'}))).status).toBe(201);expect(rows('web:source')).toBe(1);
 for(const secret of [undefined,'wrong'])expect((await f.route(request('denied',{cookie:false,secret}))).status).toBe(401);
 let release!:()=>void;f.hold(new Promise(resolve=>{release=resolve;}));const pending=f.route(request('rotation',{cookie:false,secret:'synthetic-internal'}));await Bun.sleep(0);f.config.internalSecret='rotated';release();expect((await pending).status).toBeGreaterThanOrEqual(400);expect(rows('web:source')).toBe(1);expect(f.scheduled).toBe(1);
});
test('verified internal admission still obeys family-mode deny and original cancellation',async()=>{
 const f=fixture();let release!:()=>void;f.hold(new Promise(resolve=>{release=resolve;}));const abort=new AbortController();const pending=f.route(request('cancel',{cookie:false,secret:'synthetic-internal',signal:abort.signal}));await Bun.sleep(0);abort.abort(Error('stopped'));release();expect((await pending).status).toBeGreaterThanOrEqual(400);expect(rows('web:source')).toBe(0);
 writeFileSync(join(ws.workspace,'.piclaw/config.json'),JSON.stringify({domains:{access:{mode:'family-shared'}}}));expect((await f.route(request('wrong mode',{cookie:false,secret:'synthetic-internal'}))).status).toBe(403);
});
test('verified internal secret busy target creates one negative intent and materializes once',async()=>{
 const f=fixture();f.busy(true);const response=await f.route(request('busy internal',{cookie:false,secret:'synthetic-internal',target:'web:target'}));expect(response.status).toBe(201);expect(rows('web:target')).toBe(0);expect(f.queue.peekQueuedFollowupItem('web:target')!.rowId).toBeLessThan(0);f.busy(false);
 Object.assign(f.channel,{peekQueuedFollowupItem:f.queue.peekQueuedFollowupItem.bind(f.queue),consumeQueuedFollowupItem:f.queue.consumeQueuedFollowupItem.bind(f.queue),prependQueuedFollowupItem:f.queue.prependQueuedFollowupItem.bind(f.queue),replaceQueuedFollowupItem:f.queue.replaceQueuedFollowupItem.bind(f.queue)});
 expect((await materializeDeferredFollowups({channel:f.channel,chatJid:'web:target',agentId:'default'})).status).toBe('resumed');expect(rows('web:target')).toBe(1);expect(f.queue.getQueuedFollowupCount('web:target')).toBe(0);expect(f.scheduled).toBe(1);
});
for(const revoke of [false,true])test(`actual operator localContext queue validates its active scope during held delivery: revoked ${revoke}`,async()=>{
 const f=fixture();const target=ensureChatBranch({chat_jid:'web:local-target',agent_name:'local-target'});
 const service=new WebChannelRuntimePublicSurfaceService({handleAgentMessage:(req:Request,path:string)=>handleAgentMessage(f.channel,req,path,new URL(req.url).searchParams.get('chat_jid')!,'default'),messageWriteService:{} as any,queuedFollowupLifecycle:{} as any,runtimeState:{} as any,messageProcessingStorageService:{} as any,sessionBroadcast:{} as any});
 setAddonLocalContextHost({enqueue:request=>service.enqueueAgentMessage(request)});
 const origin=new Request('https://fixture/agent/addons/api/test/send',{method:'POST',headers:{Cookie:'piclaw_session=synthetic-cookie',Origin:'https://fixture'}});
 let valid=true;const principal=f.auth.getPrincipal(origin,true)!;admitAddonLocalRequest(origin,principal,()=>valid&&!!f.auth.getPrincipal(origin,true));
 let release!:()=>void;f.hold(new Promise(resolve=>{release=resolve;}));
 const pending=withAddonLocalRequest(origin,async context=>{expect(context).not.toBeNull();return context!.enqueue({target:{chatJid:target.chat_jid,incarnation:target.branch_id},content:'local operator input',mode:'queue'});});
 const observed=pending.then(value=>({value,error:null}),error=>({value:null,error}));await Bun.sleep(0);valid=!revoke;release();const outcome=await observed;
 if(revoke){expect(outcome.error).toBeTruthy();expect(rows(target.chat_jid)).toBe(0);expect(f.scheduled).toBe(0);}else{expect(outcome.value?.status).toBe('accepted');expect(rows(target.chat_jid)).toBe(1);expect(f.scheduled).toBe(1);}
 expect(addonLocalContextApi.getToolContext()).toBeNull();
});
test('authenticated mention cannot rebind a same-name same-chat replacement incarnation',async()=>{
 const f=fixture();ensureChatBranch({chat_jid:'web:target',agent_name:'target'});let release!:()=>void;f.hold(new Promise(resolve=>{release=resolve;}),'web:target');
 const pending=f.route(request('@target incarnation-bound input'));for(let n=0;n<20&&rows('web:source')===0;n++)await Bun.sleep(0);expect(rows('web:source')).toBe(1);
 getDb().query('UPDATE chat_branches SET branch_id=? WHERE chat_jid=?').run('recreated-incarnation','web:target');release();expect((await pending).status).toBeGreaterThanOrEqual(400);expect(rows('web:target')).toBe(0);expect(f.queue.getQueuedFollowupCount('web:target')).toBe(0);expect(f.scheduled).toBe(0);
});
for(const change of ['abort','source','target'] as const)test(`direct trusted relay revalidates ${change} while admission is held`,async()=>{
 const f=fixture();let release!:()=>void;f.hold(new Promise(resolve=>{release=resolve;}));const abort=new AbortController();
 const relay=createDirectChatToolRelayHandler(f.channel.agentPool,{handleAgentMessage:(req,path)=>handleAgentMessage(f.channel,req,path,new URL(req.url).searchParams.get('chat_jid')!,'default')},{getChatBranchByChatJid:jid=>f.branches.find(b=>b.chat_jid===jid)??null});
 const pending=relay({source_chat_jid:'web:source',target_chat_jid:'web:target',content:'relay held',mode:'queue',signal:abort.signal});const observed=pending.then(()=>false,()=>true);await Bun.sleep(0);
 if(change==='abort')abort.abort(Error('cancelled tool'));else f.branches[change==='source'?0:1].branch_id='replacement';release();expect(await observed).toBe(true);expect(rows('web:target')).toBe(0);expect(f.scheduled).toBe(0);
});
test('trusted public host enqueue and direct relay retain scoped in-process admission with auth enabled',async()=>{
 const f=fixture();const service=new WebChannelRuntimePublicSurfaceService({handleAgentMessage:(req:Request,path:string)=>handleAgentMessage(f.channel,req,path,new URL(req.url).searchParams.get('chat_jid')!,'default'),messageWriteService:{} as any,queuedFollowupLifecycle:{} as any,runtimeState:{} as any,messageProcessingStorageService:{} as any,sessionBroadcast:{} as any});
 expect((await service.enqueueAgentMessage({chatJid:'web:target',content:'host delivery',mode:'queue'})).status).toBe('ok');expect(rows('web:target')).toBe(1);
 const relay=createDirectChatToolRelayHandler(f.channel.agentPool,{handleAgentMessage:(req,path)=>handleAgentMessage(f.channel,req,path,new URL(req.url).searchParams.get('chat_jid')!,'default')},{getChatBranchByChatJid:jid=>f.branches.find(b=>b.chat_jid===jid)??null});
 expect((await relay({source_chat_jid:'web:source',target_chat_jid:'web:target',content:'trusted relay',mode:'auto'})).status).toBe('ok');expect(rows('web:target')).toBe(2);
});
for(const busy of [false,true])test(`generic host mention from a new source admits its own lifetime before forwarding: busy ${busy}`,async()=>{
 const f=fixture();f.busy(busy);expect(getChatBranchByChatJid('web:source')).toBeNull();
 const service=new WebChannelRuntimePublicSurfaceService({handleAgentMessage:(req:Request,path:string)=>handleAgentMessage(f.channel,req,path,new URL(req.url).searchParams.get('chat_jid')!,'default'),messageWriteService:{} as any,queuedFollowupLifecycle:{} as any,runtimeState:{} as any,messageProcessingStorageService:{} as any,sessionBroadcast:{} as any});
 const result=await service.enqueueAgentMessage({chatJid:'web:source',content:'@target composed host input',mode:'queue'});
 expect(result.status).toBe('ok');expect(rows('web:source')).toBe(1);expect(getChatBranchByChatJid('web:source')?.branch_id).toBeTruthy();expect(rows('web:target')).toBe(busy?0:1);expect(f.queue.getQueuedFollowupCount('web:target')).toBe(busy?1:0);expect(f.scheduled).toBe(busy?0:1);
});
test('host mention cancelled after source commit reports that receipt without accepting the target',async()=>{
 const f=fixture(),admit=f.channel.admitUserMessage.bind(f.channel);let release!:()=>void,entered!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;}),waiting=new Promise<void>(resolve=>{entered=resolve;});
 f.channel.admitUserMessage=async(...args:any[])=>{if(args[0]==='web:target'){entered();await held;}return admit(...args);};
 let response!:Response;const service=new WebChannelRuntimePublicSurfaceService({handleAgentMessage:async(req:Request,path:string)=>response=await handleAgentMessage(f.channel,req,path,new URL(req.url).searchParams.get('chat_jid')!,'default'),messageWriteService:{} as any,queuedFollowupLifecycle:{} as any,runtimeState:{} as any,messageProcessingStorageService:{} as any,sessionBroadcast:{} as any});
 const abort=new AbortController();const observed=service.enqueueAgentMessage({chatJid:'web:source',content:'@target cancelled host input',signal:abort.signal}).then(()=>null,error=>error);
 await waiting;expect(rows('web:source')).toBe(1);abort.abort(Error('host cancelled'));release();expect(await observed).toBeTruthy();expect(response.status).toBe(400);const payload=await response.json();expect(payload.source_committed).toBe(true);expect(payload.relayed).toBe(false);expect(payload.user_message.id).toBeGreaterThan(0);expect(rows('web:target')).toBe(0);expect(f.scheduled).toBe(0);expect(getChatBranchByChatJid('web:target')).toBeNull();
});
for(const archived of ['source','target'] as const)test(`direct relay rejects a real ${archived} branch archived during held admission without pool fallback`,async()=>{
 const f=fixture();ensureChatBranch({chat_jid:'web:source',agent_name:'source'});ensureChatBranch({chat_jid:'web:target',agent_name:'target'});let release!:()=>void;f.hold(new Promise(resolve=>{release=resolve;}));
 const relay=createDirectChatToolRelayHandler(f.channel.agentPool,{handleAgentMessage:(req,path)=>handleAgentMessage(f.channel,req,path,new URL(req.url).searchParams.get('chat_jid')!,'default')});
 const observed=relay({source_chat_jid:'web:source',target_agent_name:'target',content:'archived authority',mode:'queue'}).then(()=>null,error=>error);await Bun.sleep(0);const branch=getChatBranchByChatJid(`web:${archived}`)!;
 getDb().query('UPDATE chat_branches SET archived_at=? WHERE chat_jid=?').run('2026-10-04T00:00:00Z',branch.chat_jid);release();expect(await observed).toBeTruthy();expect(rows('web:target')).toBe(0);expect(f.scheduled).toBe(0);expect(f.events).toEqual([]);expect(getChatBranchByChatJid(branch.chat_jid)?.branch_id).toBe(branch.branch_id);expect(getChatBranchByChatJid(branch.chat_jid)?.archived_at).toBe('2026-10-04T00:00:00Z');
});
for(const change of ['abort','revoke','target'] as const)test(`mention source publication ${change} before forwarding bind still returns its committed receipt`,async()=>{
 const f=fixture(),abort=new AbortController(),broadcast=f.channel.broadcastEvent;
 f.channel.broadcastEvent=(type:string,payload:any)=>{broadcast(type,payload);if(type==='new_post'&&payload.chat_jid==='web:source'){
 if(change==='abort')abort.abort(Error('cancel before bind'));else if(change==='revoke')revokeUserWebSessions('default');else f.branches[1].chat_jid='web:replaced-target';
 }};
 const response=await f.route(request('@target cancelled before bind',{signal:abort.signal}));expect(response.status).toBe(change==='abort'?400:403);const payload=await response.json();expect(payload.source_committed).toBe(true);expect(payload.relayed).toBe(false);expect(payload.user_message.id).toBeGreaterThan(0);expect(rows('web:source')).toBe(1);expect(rows('web:target')).toBe(0);expect(f.scheduled).toBe(0);expect(f.events.filter(e=>e.payload?.chat_jid==='web:target')).toEqual([]);
});
test('arbitrary internal Requests, identity headers or markers cannot mint host authority; target/payload bindings are exact',async()=>{
 const f=fixture();for(const headers of [{},{'x-piclaw-source-chat-jid':'web:source','x-piclaw-account-id':'default'}]){
 const req=request('forged',{cookie:false,headers});expect((await handleAgentMessage(f.channel,req,'/agent/default/message','web:target','default')).status).toBe(403);
 }
 const forged=new Request('http://internal/agent/default/message',{method:'POST',headers:{'x-piclaw-source-chat-jid':'web:source','x-piclaw-source-agent-name':'source'},body:JSON.stringify({content:'forged marker',content_blocks:[{type:'addon_local_dispatch',dispatch_id:'forged'},{type:'peer_message',source_chat_jid:'web:source'}]})});expect((await handleAgentMessage(f.channel,forged,'/agent/default/message','web:target','default')).status).toBe(403);
 const body=JSON.stringify({content:'bound'});const req=new Request('http://internal/agent/default/message',{method:'POST',body});bindInputRequestAuthority(req,'web:source',body,()=>{});
 try{expect((await handleAgentMessage(f.channel,req,'/agent/default/message','web:target','default')).status).toBe(403);}finally{releaseInputRequestAuthority(req);}
 const mismatched=new Request('http://internal/agent/default/message',{method:'POST',body:JSON.stringify({content:'different'})});bindInputRequestAuthority(mismatched,'web:source',body,()=>{});try{expect((await handleAgentMessage(f.channel,mismatched,'/agent/default/message','web:source','default')).status).toBe(403);}finally{releaseInputRequestAuthority(mismatched);}
 expect(rows('web:source')).toBe(0);expect(rows('web:target')).toBe(0);
});
test('trusted host admission rejects both foreign execution modes and bounded-body overflow',async()=>{
 const f=fixture();const service=new WebChannelRuntimePublicSurfaceService({handleAgentMessage:(req:Request,path:string)=>handleAgentMessage(f.channel,req,path,new URL(req.url).searchParams.get('chat_jid')!,'default'),messageWriteService:{} as any,queuedFollowupLifecycle:{} as any,runtimeState:{} as any,messageProcessingStorageService:{} as any,sessionBroadcast:{} as any});
 for(const mode of ['family-shared','isolated-containers'])await expect(withExecutionIdentity({mode} as any,()=>service.enqueueAgentMessage({chatJid:'web:target',content:'denied foreign host'}))).rejects.toThrow();
 const body=JSON.stringify({content:'x'.repeat(512*1024)});const req=new Request('http://internal/agent/default/message',{method:'POST',body});bindInputRequestAuthority(req,'web:source',body,()=>{});try{expect((await handleAgentMessage(f.channel,req,'/agent/default/message','web:source','default')).status).toBe(403);}finally{releaseInputRequestAuthority(req);}
 expect(rows('web:source')).toBe(0);expect(rows('web:target')).toBe(0);
});
