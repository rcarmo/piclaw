// Outbound discovery/lifecycle port of Kintsugi b8469c29; MIT — see UPSTREAM-LICENSE.
import type {Context} from '@earendil-works/chord/context';
import type {Registry,ConversationId,ToolExecutionApi,Agent} from '@earendil-works/pi-durable';
import {defineExtension} from '@earendil-works/pi-durable';
import {McpConnectionClosedError,mcpNamespace,type McpClient,type Tool as McpTool} from '@earendil-works/pi-mcp';
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
type Slot={config:McpConnection;failures:number;connection?:ConnectedMcp;authority:McpAuthority;abort?:AbortController;timer?:ReturnType<typeof setTimeout>;healthy?:ReturnType<typeof setTimeout>;unlisten?:()=>void};
/** The SDK owns calls; this pool retries connection setup only and never replays a remote invocation. */
export function createMcpRuntime(options:McpRuntimeOptions){
 const slots=new Map<string,Slot>(),queue=new Set<Slot>(),pending=new Set<Promise<void>>(),waiters=new Set<()=>void>(),statuses=new Map<string,McpConnectionStatus>(),cleanupErrors:unknown[]=[];
 let closed=false,active=0,unwatch:(()=>void)|undefined,closing:Promise<void>|undefined;
 const current=(slot:Slot)=>{if(closed||slots.get(slot.config.id)!==slot)return false;try{options.assertOwner();const row=options.store.credential(slot.config.id);return row?.revision===slot.config.revision&&row?.accessEpoch===slot.config.accessEpoch;}catch{return false;}};
 async function discard(slot:Slot,connection:ConnectedMcp){try{await slot.authority.cleanup(()=>connection.close());return true;}catch(error){cleanupErrors.push(new Error(mcpFailure(error)));return false;}}
 function drained(){if(!pending.size&&!queue.size&&!active){for(const resolve of waiters)resolve();waiters.clear();}}
 function ready(){return!pending.size&&!queue.size&&!active?Promise.resolve():new Promise<void>(resolve=>waiters.add(resolve));}
 function closeConnection(slot:Slot){slot.unlisten?.();slot.unlisten=undefined;const connection=slot.connection;slot.connection=undefined;if(!connection)return;const job=(async()=>slot.authority.cleanup(()=>connection.close()))().catch(error=>{cleanupErrors.push(new Error(mcpFailure(error)));}).finally(()=>{pending.delete(job);drained();});pending.add(job);}
 function withdraw(slot:Slot){clearTimeout(slot.timer);clearTimeout(slot.healthy);slot.timer=undefined;slot.healthy=undefined;queue.delete(slot);slot.abort?.abort();options.registry.uninstall(defineExtension({name:`piclaw.mcp.${slot.config.id}`}));closeConnection(slot);}
 function failed(slot:Slot,error:unknown){if(!current(slot))return;withdraw(slot);slot.failures++;const delay=retryDelays[slot.failures-1];if(retryableMcpFailure(error)&&delay!==undefined){statuses.set(slot.config.id,{state:'retrying',tools:[],nextRetryAt:Date.now()+delay,message:`${mcpFailure(error)} Retrying connection in ${delay/1000}s.`});slot.timer=setTimeout(()=>{slot.timer=undefined;if(current(slot)){queue.add(slot);pump();}},delay);slot.timer.unref();}else statuses.set(slot.config.id,{state:'unavailable',tools:[],message:mcpFailure(error)});}
 async function discover(slot:Slot){
  slot.abort=new AbortController();statuses.set(slot.config.id,{state:'connecting',tools:[],message:'Discovering MCP tools…'});
  try{
   const connection=await options.connect(slot.config,slot.authority,AbortSignal.any([slot.abort.signal,AbortSignal.timeout(slot.config.timeoutSeconds*1000)]));
   if(!current(slot)){await discard(slot,connection);return;}
   if(connection.client.connectionState!=='connected'){const disposed=await discard(slot,connection);failed(slot,disposed?new McpConnectionClosedError():Error('MCP startup cleanup uncertain'));return;}
   slot.connection=connection;slot.healthy=setTimeout(()=>{slot.healthy=undefined;if(current(slot)&&slot.connection===connection)slot.failures=0;},30000);slot.healthy.unref();
   const onClose=connection.client.onClose(()=>failed(slot,new McpConnectionClosedError()));
   const publish=()=>options.registry.install(mcpToolsExtension(slot.config,connection.tools,async id=>{
    const identity=await options.resolveAgent(id);options.assertOwner();if(!current(slot)||!identity||identity.readOnly||!mcpAgentAllowed(options.store.credential(slot.config.id),options.workspaceId,identity.agentId))throw Error('This Agent has no current MCP connection grant');
    const next=slot.connection;if(!next||next.client.connectionState!=='connected')throw Error('MCP connection is recovering');next.assertCurrent?.();return next.client;
   },error=>{if(lostMcpSession(error))failed(slot,error);},slot.authority));
   publish();let refreshing=false,again=false;
   const changed=()=>{if(!current(slot)||slot.connection!==connection)return;if(refreshing){again=true;return;}refreshing=true;const job=(async()=>{do{again=false;const tools=await connection.client.listTools({signal:slot.abort!.signal});if(!current(slot)||slot.connection!==connection)return;connection.tools=tools;publish();statuses.set(slot.config.id,{state:'connected',tools:tools.map(t=>t.name),message:'Connected'});}while(again);})().catch(error=>{if(current(slot)&&slot.connection===connection)failed(slot,error);}).finally(()=>{refreshing=false;pending.delete(job);drained();});pending.add(job);};
   const onChanged=connection.client.onNotification('notifications/tools/list_changed',()=>{if(connection.client.serverCapabilities?.tools?.listChanged)changed();});slot.unlisten=()=>{onClose();onChanged();};
   statuses.set(slot.config.id,{state:'connected',tools:connection.tools.map(t=>t.name),message:'Connected'});
  }catch(error){if(error instanceof AggregateError)cleanupErrors.push(new Error(mcpFailure(error)));failed(slot,error);}
 }
 function pump(){while(!closed&&active<4&&queue.size){const slot=queue.values().next().value!;queue.delete(slot);if(!current(slot))continue;active++;const job=discover(slot).finally(()=>{active--;pending.delete(job);pump();drained();});pending.add(job);}drained();}
 function refresh(){
  options.assertOwner();if(closed)return;const desired=options.store.list().filter(row=>mcpWorkspaceAllowed(row,options.workspaceId));
  for(const[id,slot]of slots)if(!desired.some(row=>row.id===id&&row.revision===slot.config.revision&&row.accessEpoch===slot.config.accessEpoch)){slots.delete(id);withdraw(slot);statuses.delete(id);}
  for(const row of desired)if(!slots.has(row.id)){
   const config=options.store.credential(row.id)!;let slot:Slot;
   const authority=createMcpAuthority({assertOwner:options.assertOwner,assertCleanupOwner:options.assertCleanupOwner,assertConnection(){if(!current(slot))throw Error('MCP connection changed');slot.connection?.assertCurrent?.();},captureSource:async api=>{
    const identity=await options.resolveAgent(api.conversationId);if(!identity||identity.readOnly||!mcpAgentAllowed(options.store.credential(config.id),options.workspaceId,identity.agentId))throw Error('MCP Agent grant unavailable');
    const guard=await options.captureSource(api);return()=>{guard();if(!mcpAgentAllowed(options.store.credential(config.id),options.workspaceId,identity.agentId))throw Error('MCP Agent grant revoked');};
   }});
   slot={config,failures:0,authority};slots.set(row.id,slot);queue.add(slot);statuses.set(row.id,{state:'connecting',tools:[],message:'Waiting for discovery…'});
  }
  pump();
 }
 return{
  async attach(){options.assertOwner();if(unwatch||closed)throw Error('MCP runtime already attached or closed');unwatch=options.store.watch(async()=>refresh());refresh();},ready,
  reconnect(id:string){options.assertOwner();const slot=slots.get(id);if(slot){slots.delete(id);withdraw(slot);statuses.delete(id);}refresh();},
  status(id:string){options.assertOwner();return statuses.get(id)?structuredClone(statuses.get(id)!):undefined;},
  async visibleAgent(id:ConversationId,agent:Agent,context:Context):Promise<Agent>{
   const identity=await options.resolveAgent(id);context.abortSignal?.throwIfAborted();options.assertOwner();
   const grants=identity&&!identity.readOnly?options.store.list().filter(row=>mcpAgentAllowed(row,options.workspaceId,identity.agentId)):[];
   const prefixes=grants.map(row=>mcpNamespace(row.name)),extensions=new Set(grants.map(row=>`piclaw.mcp.${row.id}`));
   return{...agent,extensions:agent.extensions.filter(extension=>!extension.name.startsWith('piclaw.mcp.')||extensions.has(extension.name)),
    callable:agent.callable.filter(tool=>!tool.name.startsWith('mcp__')||prefixes.some(prefix=>tool.name.startsWith(prefix)))};
  },
  close(){return closing??=(async()=>{(options.assertCleanupOwner??options.assertOwner)();closed=true;unwatch?.();for(const[id,slot]of slots){slots.delete(id);withdraw(slot);statuses.delete(id);}await ready();if(cleanupErrors.length)throw new AggregateError(cleanupErrors,'MCP cleanup uncertain');})();},
 };
}
