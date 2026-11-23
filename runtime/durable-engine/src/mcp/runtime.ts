// Outbound discovery/lifecycle port of Kintsugi b8469c29; MIT — see UPSTREAM-LICENSE.
import type {Context} from '@earendil-works/chord/context';
import type {Registry,ConversationId,ToolExecutionApi,Agent,Extension} from '@earendil-works/pi-durable';
import {McpConnectionClosedError,type McpClient,type Tool as McpTool} from '@earendil-works/pi-mcp';
import {createMcpAuthority,type McpAuthority} from './authority.ts';
import {mcpAgentAllowed,mcpWorkspaceAllowed} from './policy.ts';
import {mcpToolsExtension,mcpFailure,retryableMcpFailure,lostMcpSession} from './client.ts';
import type {McpConnection,McpConnectionStore} from './connections.ts';
export interface McpConnectionStatus {state:'connecting'|'retrying'|'connected'|'unavailable';tools:string[];message:string;nextRetryAt?:number}
export interface ConnectedMcp {client:McpClient;tools:McpTool[];close():Promise<void>;assertCurrent?():void}
export interface McpRuntimeOptions {
 workspaceId:string;registry:Registry;store:McpConnectionStore;assertOwner():void;assertCleanupOwner?():void;
 resolveAgent(id:ConversationId):Promise<{agentId:string;readOnly:boolean}|undefined>;
 captureSource(api:ToolExecutionApi):Promise<()=>void>;
 connect(config:McpConnection,authority:McpAuthority,signal:AbortSignal):Promise<ConnectedMcp>;
}
const retryDelays=[1000,5000,15000];
type Attempt={abort:AbortController;connection?:ConnectedMcp;dispose?:()=>Promise<boolean>;publication?:Extension;unlisten?:()=>void;healthy?:ReturnType<typeof setTimeout>};
type Slot={config:McpConnection;failures:number;attempt?:Attempt;timer?:ReturnType<typeof setTimeout>};
/** The SDK owns calls. This pool retries setup only and never replays a remote invocation. */
export function createMcpRuntime(options:McpRuntimeOptions){
 const slots=new Map<string,Slot>(),queue=new Set<Slot>(),pending=new Set<Promise<void>>(),waiters=new Set<()=>void>(),statuses=new Map<string,McpConnectionStatus>(),cleanupErrors:unknown[]=[];
 let closed=false,active=0,unwatch:(()=>void)|undefined,closing:Promise<void>|undefined;
 const current=(slot:Slot)=>{if(closed||slots.get(slot.config.id)!==slot)return false;try{options.assertOwner();const row=options.store.credential(slot.config.id);return row?.revision===slot.config.revision&&row?.accessEpoch===slot.config.accessEpoch;}catch{return false;}};
 const live=(slot:Slot,attempt:Attempt)=>slot.attempt===attempt&&current(slot);
 function drained(){if(!pending.size&&!queue.size&&!active){for(const resolve of waiters)resolve();waiters.clear();}}
 function ready(){return !pending.size&&!queue.size&&!active?Promise.resolve():new Promise<void>(resolve=>waiters.add(resolve));}
 function track(body:()=>Promise<void>){const job=Promise.resolve().then(body).finally(()=>{pending.delete(job);drained();});pending.add(job);return job;}
 async function discard(authority:McpAuthority,connection:ConnectedMcp){try{await authority.cleanup(()=>connection.close());return true;}catch(error){cleanupErrors.push(new Error(mcpFailure(error)));return false;}}
 function withdraw(slot:Slot){
  clearTimeout(slot.timer);slot.timer=undefined;queue.delete(slot);
  const attempt=slot.attempt;slot.attempt=undefined;
  if(!attempt)return;
  clearTimeout(attempt.healthy);attempt.unlisten?.();
  if(attempt.publication)options.registry.uninstall(attempt.publication);
  attempt.abort.abort();
  if(attempt.dispose)track(async()=>{await attempt.dispose!();});
 }
 function failed(slot:Slot,attempt:Attempt,error:unknown){
  if(!live(slot,attempt))return;
  withdraw(slot);slot.failures++;
  const delay=retryDelays[slot.failures-1];
  if(retryableMcpFailure(error)&&delay!==undefined){
   statuses.set(slot.config.id,{state:'retrying',tools:[],nextRetryAt:Date.now()+delay,message:`${mcpFailure(error)} Retrying connection in ${delay/1000}s.`});
   slot.timer=setTimeout(()=>{slot.timer=undefined;track(async()=>{
    if(!current(slot))return;
    if(attempt.dispose&&!await attempt.dispose()){
     if(current(slot))statuses.set(slot.config.id,{state:'unavailable',tools:[],message:'MCP cleanup is uncertain. Resolve it before reconnecting.'});return;
    }
    if(current(slot)){queue.add(slot);pump();}
   });},delay);slot.timer.unref();
  }else statuses.set(slot.config.id,{state:'unavailable',tools:[],message:mcpFailure(error)});
 }
 async function discover(slot:Slot){
  const attempt:Attempt={abort:new AbortController()};slot.attempt=attempt;
  const signal=attempt.abort.signal;
  const authority=createMcpAuthority({assertOwner:options.assertOwner,assertCleanupOwner:options.assertCleanupOwner,
   assertConnection(){if(!live(slot,attempt))throw Error('MCP connection changed');attempt.connection?.assertCurrent?.();},
   captureSource:async api=>{
    const identity=await options.resolveAgent(api.conversationId);
    if(!identity||identity.readOnly||!mcpAgentAllowed(options.store.credential(slot.config.id),options.workspaceId,identity.agentId))throw Error('MCP Agent grant unavailable');
    const guard=await options.captureSource(api);
    return()=>{guard();if(!mcpAgentAllowed(options.store.credential(slot.config.id),options.workspaceId,identity.agentId))throw Error('MCP Agent grant revoked');};
   }});
  statuses.set(slot.config.id,{state:'connecting',tools:[],message:'Discovering MCP tools…'});
  try{
   const connection=await options.connect(slot.config,authority,AbortSignal.any([signal,AbortSignal.timeout(slot.config.timeoutSeconds*1000)]));
   if(!live(slot,attempt)){await discard(authority,connection);return;}
   if(connection.client.connectionState!=='connected'){const disposed=await discard(authority,connection);failed(slot,attempt,disposed?new McpConnectionClosedError():Error('MCP startup cleanup uncertain'));return;}
   attempt.connection=connection;
   let disposal:Promise<boolean>|undefined;attempt.dispose=()=>disposal??=discard(authority,connection);
   const onClose=connection.client.onClose(()=>failed(slot,attempt,new McpConnectionClosedError()));
   const publish=(tools:McpTool[])=>{
    const next=mcpToolsExtension(slot.config,tools,async id=>{
     const identity=await options.resolveAgent(id);options.assertOwner();
     if(!live(slot,attempt)||attempt.publication!==next||!identity||identity.readOnly||!mcpAgentAllowed(options.store.credential(slot.config.id),options.workspaceId,identity.agentId))throw Error('MCP catalogue or connection grant changed; discover the tool again');
     if(connection.client.connectionState!=='connected')throw Error('MCP connection is recovering');
     connection.assertCurrent?.();return connection.client;
    },error=>{if(lostMcpSession(error))failed(slot,attempt,error);},authority);
    options.registry.install(next);attempt.publication=next;
    statuses.set(slot.config.id,{state:'connected',tools:tools.map(t=>t.name),message:'Connected'});
   };
   let refreshing:Promise<void>|undefined,again=false;
   const changed=()=>{
    if(!live(slot,attempt))return;
    if(refreshing){again=true;return refreshing;}
    refreshing=track(async()=>{
     try{do{
      again=false;
      const tools=await connection.client.listTools({signal:AbortSignal.any([signal,AbortSignal.timeout(slot.config.timeoutSeconds*1000)])});
      if(!live(slot,attempt))return;
      if(!again)publish(tools);
     }while(again);}
     catch(error){failed(slot,attempt,error);}
     finally{refreshing=undefined;}
    });
    return refreshing;
   };
   const listChanged=connection.client.serverCapabilities?.tools?.listChanged===true;
   const onChanged=connection.client.onNotification('notifications/tools/list_changed',()=>{if(listChanged)changed();});
   attempt.unlisten=()=>{onClose();onChanged();};
   // The first list preceded notification registration. Reconcile after subscribing.
   if(listChanged)await changed();else publish(connection.tools);
   if(!live(slot,attempt))return;
   attempt.healthy=setTimeout(()=>{if(live(slot,attempt))slot.failures=0;},30000);attempt.healthy.unref();
  }catch(error){if(error instanceof AggregateError)cleanupErrors.push(new Error(mcpFailure(error)));failed(slot,attempt,error);}
 }
 function pump(){while(!closed&&active<4&&queue.size){const slot=queue.values().next().value!;queue.delete(slot);if(!current(slot))continue;active++;track(async()=>{try{if(current(slot))await discover(slot);}finally{active--;pump();}});}drained();}
 function refresh(){
  options.assertOwner();if(closed)return;const desired=options.store.list().filter(row=>mcpWorkspaceAllowed(row,options.workspaceId));
  for(const[id,slot]of slots)if(!desired.some(row=>row.id===id&&row.revision===slot.config.revision&&row.accessEpoch===slot.config.accessEpoch)){slots.delete(id);withdraw(slot);statuses.delete(id);}
  for(const row of desired)if(!slots.has(row.id)){
   const config=options.store.credential(row.id)!;
   const slot={config,failures:0};slots.set(row.id,slot);queue.add(slot);statuses.set(row.id,{state:'connecting',tools:[],message:'Waiting for discovery…'});
  }
  pump();
 }
 return{
  async attach(){options.assertOwner();if(unwatch||closed)throw Error('MCP runtime already attached or closed');unwatch=options.store.watch(async()=>refresh());refresh();},ready,
  reconnect(id:string){options.assertOwner();const slot=slots.get(id);if(slot){slots.delete(id);withdraw(slot);statuses.delete(id);}refresh();},
  status(id:string){options.assertOwner();return statuses.get(id)?structuredClone(statuses.get(id)!):undefined;},
  async visibleAgent(id:ConversationId,agent:Agent,context:Context):Promise<Agent>{
   const identity=await options.resolveAgent(id);context.abortSignal?.throwIfAborted();options.assertOwner();
   const visible=new Set<Extension>();
   if(identity&&!identity.readOnly)for(const slot of slots.values()){
    const publication=slot.attempt?.publication;
    if(publication&&current(slot)&&mcpAgentAllowed(slot.config,options.workspaceId,identity.agentId))visible.add(publication);
   }
   const providers=new Map<string,Extension>();
   // Match the SDK's last selected tool registration; names alone are not grant identity.
   for(const extension of agent.extensions)for(const tool of extension.tools??[])providers.set(tool.name,extension);
   return{...agent,extensions:agent.extensions.filter(extension=>!extension.name.startsWith('piclaw.mcp.')||visible.has(extension)),
    callable:agent.callable.filter(tool=>{const provider=providers.get(tool.name);return !tool.name.startsWith('mcp__')||(provider!==undefined&&visible.has(provider));})};
  },
  close(){return closing??=(async()=>{(options.assertCleanupOwner??options.assertOwner)();closed=true;unwatch?.();for(const[id,slot]of slots){slots.delete(id);withdraw(slot);statuses.delete(id);}await ready();if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'MCP cleanup uncertain');})();},
 };
}
