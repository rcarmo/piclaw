import {addonLocalContextApi} from '../../src/addons/local-context.js';
import type {createApplicationOptimizerMcp} from './application-optimizer-mcp.ts';
import {parseOptimizerConfig} from './token-optimizer-config.ts';
import {describeKnowledge,outputOffload,oversightPolicy} from '#token-optimizer/core';
import {applicationRetainedDatabase,forgetRetainedCopies} from './mcp/retained-database.ts';
import type {Database} from 'bun:sqlite';
/** JSON controls reuse the existing authenticated Core add-on configuration surface. */
export function optimizerSettingsApi(service:ReturnType<typeof createApplicationOptimizerMcp>,database:Database,assertOwner:()=>void,write:<T>(check:()=>void,body:()=>Promise<T>)=>Promise<T>){
 const check=(request:Request)=>{assertOwner();request.signal.throwIfAborted();const principal=addonLocalContextApi.getRequestContext(request);if(!principal||principal.kind!=='operator'||principal.workspaceId!==service.workspaceId)throw Error('Authenticated optimiser configuration owner required');};
 const retainedOwner=(agentId:string)=>JSON.stringify([service.workspaceId,service.environmentRevision,agentId]);
 async function snapshot(request:Request){
  check(request);const agents=(await service.agents()).filter(agent=>!agent.parentId&&!agent.readOnly&&!agent.oneShotCallId),status=[];check(request);
  const retained=new Set<string>();
  for(const table of ['retained_tool_outputs','mcp_recall']){
   if(database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)){
    for(const {owner} of database.query<{owner:string},[]>(`SELECT DISTINCT owner FROM ${table}`).all())retained.add(owner);
   }
  }
  for(const record of agents){
   const host=service.optimizer.lookup(record.durableId);if(!host)continue;
   const state=await service.optimizer.optimizer.status(host);check(request);
   status.push({agentId:record.agentId,label:record.title??record.label??record.agentId,policy:{...state.policy,oversightMode:oversightPolicy(state.policy).mode},
    process:state.run?.guard?{turns:state.run.guard.cum_turns,errors:state.run.guard.st.error_outputs,checks:state.run.guard.st.test_runs,judgeCalls:state.run.guard.judge_calls,nudges:state.run.guard.nudges_done,calibrationSamples:state.knowledge?.envelope.resolved_turns.length??0,closed:state.run.closed}:null,
    accounting:state.accounting,lastError:state.lastError,hiddenTools:state.knowledge?.tools.applied??[],proposedTools:state.knowledge?.tools.proposal??[],
    facts:state.knowledge?describeKnowledge(state.knowledge.environment,state.knowledge.distiller,state.knowledge.factReviews).facts.slice(0,40):[],
    factsInContext:state.session?.injectedIds.length??0,nudges:state.run?.decisions.slice(-20)??[],hasRetainedCopies:retained.has(retainedOwner(record.agentId))});
  }
  const config=service.configuration.snapshot();config.policy.offload??=outputOffload(config.policy);
  return{ok:true,config,revision:service.configuration.revision(),models:service.refs.map(ref=>({...ref,name:ref.id})),status};
 }
 return{
  get:(_payload:unknown,request:Request)=>snapshot(request),
  async set(payload:unknown,request:Request){
   check(request);if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Error('Optimiser settings object required');const input=payload as Record<string,unknown>;
   if(input.config!==undefined){if(typeof input.expectedRevision!=='string')throw Error('Expected optimiser revision required');await service.configuration.configure(parseOptimizerConfig(input.config),{expectedRevision:input.expectedRevision,authorise:()=>check(request),signal:request.signal});return snapshot(request);}
   const agentId=input.agentId;
   if(typeof agentId!=='string'||!(await service.agents()).some(agent=>agent.agentId===agentId&&!agent.parentId))throw Error('Current Agent required');
   const host=await service.optimizer.hostForAgent(agentId),native=service.optimizer.optimizer,names=Array.isArray(input.names)&&input.names.every(name=>typeof name==='string')?input.names as string[]:undefined;
   await write(()=>check(request),async()=>{
    check(request);
    if(input.action==='restore')await native.restore(host,names);
    else if(input.action==='apply'){if(!names)throw Error('Explicit tool names required');await native.apply(host,names);}
    else if(input.action==='remove_context')await native.removeContext(host);
    else if(input.action==='stale_facts')await native.staleFacts(host);
    else if(input.action==='retry_models')await native.retryModelCalls();
    else if(input.action==='forget_outputs')await forgetRetainedCopies(applicationRetainedDatabase(database,()=>check(request)),retainedOwner(agentId));
    else if(input.action==='prepare'){if(typeof input.task!=='string'||input.task.length>16000)throw Error('Bounded task text required');await service.optimizer.preparePrompt(host.conversationId,input.task);}
    else if(input.action==='review_fact'){
     if(!['environment','distilled'].includes(String(input.source))||!['approved','rejected','stale'].includes(String(input.decision))||typeof input.id!=='string'||typeof input.expectedClaim!=='string')throw Error('Exact fact/review required');
     await native.reviewFact(host,input.source as 'environment'|'distilled',input.id,input.decision as 'approved'|'rejected'|'stale',input.expectedClaim,typeof input.note==='string'?input.note.slice(0,500):'');
    }else throw Error('Unsupported optimiser action');check(request);
   });
   return snapshot(request);
  },
 };
}
