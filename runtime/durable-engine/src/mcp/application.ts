import {createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {realpathSync} from 'node:fs';
import type {Database} from 'bun:sqlite';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import type {Registry,Harness,ConversationId,ToolExecutionApi} from '@earendil-works/pi-durable';
import {getPiclawAgentDir} from '../../../src/core/agent-dir.js';
import {McpConnectionStore} from './connections.ts';
import {createMcpRuntime} from './runtime.ts';
import {connectMcpConnection,mcpCredentialRevision} from './connect.ts';
import {createMcpRecallExtension} from './recall.ts';
import {applicationRetainedDatabase} from './retained-database.ts';
import {importLegacyMcpOnce} from './migration.ts';
import {readLegacyMcpServers} from './legacy-config.ts';

export interface ApplicationMcpBinding {chatJid:string;branchId:string;conversationId:number}
/** Adapt the application's owned SDK and store ports to outbound MCP. */
export function createApplicationMcp(options:{root:Database;workspaceRoot:string;registry:Registry;harness():Harness;bindings(harness:Harness):Promise<readonly ApplicationMcpBinding[]>;assertOwner():void;assertCleanupOwner?():void;captureSource(api:ToolExecutionApi):Promise<()=>void>;offlineMaintenance:boolean}){
 const workspaceRoot=realpathSync(options.workspaceRoot),workspaceId=createHash('sha256').update(workspaceRoot).digest('hex');
 // Persisted recall and retained-output owners depend on this existing identity.
 const environmentRevision=createHash('sha256').update(JSON.stringify([hostname(),process.platform,process.arch,workspaceRoot,getPiclawAgentDir()])).digest('hex');
 let closed=false;
 const check=()=>{options.assertOwner();if(closed)throw Error('Application MCP adapter is closed');};
 const database=applicationRetainedDatabase(options.root,check),connections=new McpConnectionStore(options.root,check,mcpCredentialRevision);
 // MCP grants use the persisted branch lifetime, never its renameable friendly handle.
 async function identity(id:ConversationId,harness=options.harness()){
  check();const mapped=await options.bindings(harness);check();
  const bindings=mapped.filter(binding=>options.root.query('SELECT 1 FROM chat_branches WHERE chat_jid=? AND branch_id=? AND archived_at IS NULL').get(binding.chatJid,binding.branchId));
  let current=await harness.commit(tx=>tx.conversation(id),context);const seen=new Set<number>();let taskOwned=false,child=false;
  while(current){check();taskOwned ||= !!current.owner;if(seen.has(current.id))throw Error('Invalid SDK identity ancestry');seen.add(current.id);const root=bindings.find(binding=>binding.conversationId===current!.id);if(root)return{binding:root,child,agentId:root.branchId,readOnly:child||taskOwned};
   child=true;const parent=current.owner?.conversationId??current.parent?.conversationId;current=parent?await harness.commit(tx=>tx.conversation(parent),context):undefined;
  }return undefined;
 }
 const mcp=createMcpRuntime({workspaceId,registry:options.registry,store:connections,assertOwner:check,assertCleanupOwner:options.assertCleanupOwner,async resolveAgent(id){const owner=await identity(id);return owner?{agentId:owner.agentId,readOnly:owner.readOnly}:undefined;},captureSource:options.captureSource,connect(config,grant,signal){return connectMcpConnection(config,check,grant,signal,{id:workspaceId,root:workspaceRoot});}});
 const recall=createMcpRecallExtension({workspaceId,harness:options.harness,connections,database,async identityOf(id){const owner=await identity(id);check();if(!owner||owner.readOnly)throw Error('MCP recall identity unavailable');return{owner:JSON.stringify([workspaceId,environmentRevision,owner.binding.chatJid]),agentId:owner.agentId};}});
 options.registry.install(recall);
 let migration:Awaited<ReturnType<typeof importLegacyMcpOnce>>|undefined;
 return{workspaceId,environmentRevision,connections,mcp,identity,get migration(){return migration;},
  async prepare(){check();if(!options.root.query('SELECT 1 FROM router_state WHERE key=?').get('native.mcp-config-import.v1'))migration=await importLegacyMcpOnce(options.root,connections,readLegacyMcpServers(workspaceRoot),{id:workspaceId,root:workspaceRoot},check);},
  async attach(){check();if(!options.offlineMaintenance)await mcp.attach();},
  async close(){if(closed)return;await mcp.close();closed=true;},
 };
}
