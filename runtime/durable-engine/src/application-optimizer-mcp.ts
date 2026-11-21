import {createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {realpathSync} from 'node:fs';
import type {Database} from 'bun:sqlite';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {createRegistry,type Harness,type ConversationId,type Cursor,type ToolExecutionApi} from '@earendil-works/pi-durable';
import type {RuntimeModelServices} from '../../src/agent-pool/model-services.js';
import {parsePlanMarkdown} from '../../src/plan/markdown.js';
import {getPiclawAgentDir} from '../../src/core/agent-dir.js';
import {TokenOptimizerConfiguration} from './token-optimizer-config.ts';
import {createNativeTokenOptimizer,type CoreOptimizerAgent} from './token-optimizer.ts';
import {createOptimizerModels} from './token-optimizer-models.ts';
import {createOptimizerAuthority} from './token-optimizer-authority.ts';
import {PlanDoc} from './plan-document.ts';
import {McpConnectionStore} from './mcp/connections.ts';
import {createMcpRuntime} from './mcp/runtime.ts';
import {connectMcpConnection,mcpCredentialRevision} from './mcp/connect.ts';
import {createMcpRecallExtension} from './mcp/recall.ts';
import {applicationRetainedDatabase} from './mcp/retained-database.ts';
import {importLegacyMcpOnce} from './mcp/migration.ts';
import {readLegacyMcpServers} from './mcp/legacy-config.ts';
import {readOwnedBashOutput} from './saved-bash-output.ts';
export interface ApplicationFeatureBinding {chatJid:string;branchId:string;conversationId:number}
/** Compose imported public SDK extensions with the one executing application namespace. */
export function createApplicationOptimizerMcp(options:{root:Database;workspaceRoot:string;registry:ReturnType<typeof createRegistry>;host:RuntimeModelServices;harness():Harness;bindings(harness:Harness):Promise<readonly ApplicationFeatureBinding[]>;assertOwner():void;assertCleanupOwner?():void;captureSource(api:ToolExecutionApi):Promise<()=>void>;offlineMaintenance:boolean}){
 const workspaceRoot=realpathSync(options.workspaceRoot),workspaceId=createHash('sha256').update(workspaceRoot).digest('hex');
 const environmentRevision=createHash('sha256').update(JSON.stringify([hostname(),process.platform,process.arch,workspaceRoot,getPiclawAgentDir()])).digest('hex');
 const lifetime=new AbortController();let closed=false;
 const check=()=>{options.assertOwner();if(closed)throw Error('Application features are closed');};
 const database=applicationRetainedDatabase(options.root,check),configuration=new TokenOptimizerConfiguration(options.root,check,workspaceId),connections=new McpConnectionStore(options.root,check,mcpCredentialRevision);
 async function roots(harness=options.harness()){
  check();const bindings=await options.bindings(harness);check();
  return bindings.flatMap(binding=>{const row=options.root.query<{agent_name:string},[string,string]>('SELECT agent_name FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL').get(binding.chatJid,binding.branchId);return row?[{...binding,profile:row.agent_name}]:[];});
 }
 async function agents(harness=options.harness()):Promise<CoreOptimizerAgent[]>{
  const bindings=await roots(harness),result:CoreOptimizerAgent[]=bindings.map(binding=>({agentId:binding.chatJid,durableId:binding.conversationId as ConversationId,label:binding.profile,title:binding.profile}));
  const byId=new Map(result.map(record=>[record.durableId,record]));let cursor:Cursor|undefined;
  do{const page=await harness.commit(tx=>tx.scanConversations({},500,cursor),context);check();for(const record of page.items){
   if(byId.has(record.id))continue;const parentId=record.owner?.conversationId??record.parent?.conversationId,parent=parentId&&byId.get(parentId);if(!parent)continue;
   const child:CoreOptimizerAgent={agentId:`child_${record.id}`,durableId:record.id,parentId:parent.agentId,rootId:parent.rootId??parent.agentId,...(record.owner?{oneShotCallId:`sdk:${record.owner.taskId}`}:{readOnly:true}),label:record.owner?'SDK task-owned child':'Unrouted SDK fork'};result.push(child);byId.set(record.id,child);
  }cursor=page.next;}while(cursor);return result;
 }
 // MCP grants use the persisted branch lifetime, never its renameable friendly handle.
 async function identity(id:ConversationId,harness=options.harness()){
  const bindings=await roots(harness);let current=await harness.commit(tx=>tx.conversation(id),context);const seen=new Set<number>();let taskOwned=false,child=false;
  while(current){check();taskOwned ||= !!current.owner;if(seen.has(current.id))throw Error('Invalid SDK identity ancestry');seen.add(current.id);const root=bindings.find(binding=>binding.conversationId===current!.id);if(root)return{binding:root,child,agentId:root.branchId,readOnly:child||taskOwned};
   child=true;const parent=current.owner?.conversationId??current.parent?.conversationId;current=parent?await harness.commit(tx=>tx.conversation(parent),context):undefined;
  }return undefined;
 }
 const refs=[...options.host.modelRegistry.getAvailable().map(model=>({provider:model.provider,id:model.id,type:'chat' as const})),...options.host.modelRuntime.getModelsOfType('classifier').filter(model=>options.host.modelRuntime.getProviderAuthStatus(model.provider).configured).map(model=>({provider:model.provider,id:model.id,type:'classifier' as const}))];
 const models=createOptimizerModels(options.host.modelRuntime,refs,{harness:options.harness,configuration,workspaceId,environmentRevision,signal:lifetime.signal,assertOwner:check,assertAgent(agentId,conversationId){
  const row=options.root.query<{chat_jid:string},[string]>('SELECT chat_jid FROM chat_branches WHERE chat_jid=? AND archived_at IS NULL').get(agentId);const session=optimizer.lookup(conversationId);if(!row||!session||JSON.parse(session.id)[0]!==agentId)throw Error('Optimizer Agent was archived or revoked');
 },assertModel(ref){
  check();if(!refs.some(approved=>approved.provider===ref.provider&&approved.id===ref.id&&(approved.type??'chat')===(ref.type??'chat')))throw Error('Optimizer model was not approved');
  if(ref.type==='classifier'){if(!options.host.modelRuntime.getProviderAuthStatus(ref.provider).configured||!options.host.modelRuntime.getModelOfType('classifier',ref.provider,ref.id))throw Error('Classifier credential/model was revoked');}
  else if(!options.host.modelRegistry.getAvailable().some(model=>model.provider===ref.provider&&model.id===ref.id))throw Error('Optimizer model is no longer available');
 }});
 const optimizer=createNativeTokenOptimizer({workspaceId,workspaceRoot,environmentRevision,harness:options.harness,models,registry:options.registry,configuration,agents:()=>agents(),database,readSavedOutput:path=>readOwnedBashOutput(options.harness(),path,check),async plan(host){
  const owner=await identity(host.conversationId);if(!owner||owner.child)return null;const stored=await options.harness().snapshot(PlanDoc,owner.binding.chatJid,context);check();return stored?{revision:stored.revision??0,steps:parsePlanMarkdown(stored.markdown).plan}:null;
 }});
 const authority=createOptimizerAuthority({workspaceId,environmentRevision,registry:options.registry,extension:optimizer.optimizer.extension,assertOwner:check,agents});
 const mcp=createMcpRuntime({workspaceId,registry:options.registry,store:connections,assertOwner:check,assertCleanupOwner:options.assertCleanupOwner,async resolveAgent(id){const owner=await identity(id);return owner?{agentId:owner.agentId,readOnly:owner.readOnly}:undefined;},captureSource:options.captureSource,connect(config,grant,signal){return connectMcpConnection(config,check,grant,signal,{id:workspaceId,root:workspaceRoot});}});
 const recall=createMcpRecallExtension({workspaceId,harness:options.harness,connections,database,async identityOf(id){const owner=await identity(id);check();if(!owner||owner.readOnly)throw Error('MCP recall identity unavailable');return{owner:JSON.stringify([workspaceId,environmentRevision,owner.binding.chatJid]),agentId:owner.agentId};}});
 options.registry.install(optimizer.optimizer.extension);options.registry.install(recall);
 let migration:Awaited<ReturnType<typeof importLegacyMcpOnce>>|undefined;
 return{workspaceId,environmentRevision,configuration,connections,optimizer,mcp,authority,agents,identity,refs,get migration(){return migration;},
  async prepare(){check();if(!options.root.query('SELECT 1 FROM router_state WHERE key=?').get('native.mcp-config-import.v1'))migration=await importLegacyMcpOnce(options.root,connections,readLegacyMcpServers(workspaceRoot),{id:workspaceId,root:workspaceRoot},check);},
  async attach(){check();if(!options.offlineMaintenance){await optimizer.attach();await mcp.attach();}},
  async conversationReady(id:ConversationId){if(options.offlineMaintenance)return;const record=(await agents()).find(agent=>agent.durableId===id);if(record)await optimizer.start((await options.harness().conversation(id,context))!,record,'startup');},
  async reset(id:ConversationId){const record=(await agents()).find(agent=>agent.durableId===id);if(record)await optimizer.reset((await options.harness().conversation(id,context))!,record);},
  async detach(){await optimizer.detach();},
  async close(){if(closed)return;await Promise.all([mcp.close(),optimizer.detach()]);closed=true;lifetime.abort();},
 };
}
