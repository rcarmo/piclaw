import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {InboxDoc,LiveDoc,type Harness,type HarnessInspection,type SubmissionRecord,type ConversationId,type TaskId,type RegistryReader} from '@earendil-works/pi-durable';
import {SessionsDoc,JobsDoc,ClassifiersDoc,KnowledgeDoc,RunDoc,SteeringEntry,runIdentity,type HostSession} from '#token-optimizer/pi-durable';
import {AutoWaitersDoc,GuardJobsDoc} from '#token-optimizer/state';
import {fingerprint,sessionKey,scopeKey} from '#token-optimizer/core';
import {NativeOptimizerSessions,type CoreOptimizerAgent} from './token-optimizer.ts';

export interface OptimizerAuthority {
 task(harness:Harness,record:HarnessInspection['tasks'][number]['record']):Promise<boolean>;
 steering(harness:Harness,record:SubmissionRecord):Promise<boolean>;
}
const kinds=new Set(['token-economizer.inference','token-economizer.fold','token-economizer.checkpoint','token-economizer.guard-judge','token-economizer.auto-publication','token-economizer.fit']);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Read-only qualification of the imported SDK extension's own tasks and advisory inputs. */
export function createOptimizerAuthority(options:{workspaceId:string;environmentRevision:string;registry:RegistryReader;extension:import('@earendil-works/pi-durable').Extension;assertOwner():void;agents(harness:Harness):Promise<readonly CoreOptimizerAgent[]>}):OptimizerAuthority{
 const check=()=>options.assertOwner();
 async function hostCurrent(harness:Harness,host:HostSession|undefined){
  if(!host||host.scope.host!=='piclaw.native'||host.scope.repository!==options.workspaceId||host.scope.environment!==options.environmentRevision)return false;
  const agents=await options.agents(harness);check();
  const actor:unknown=JSON.parse(host.id);if(!Array.isArray(actor)||actor.length!==2||typeof actor[0]!=='string')return false;
  const record=agents.find(agent=>agent.agentId===actor[0]&&agent.durableId===host.conversationId);
  return !!record&&!record.readOnly&&!record.oneShotCallId&&!record.parentId;
 }
 return{
  async task(harness,record){
   check();if(!kinds.has(record.kind))return false;
   const registration=options.registry.snapshot().task(record.kind),definition=options.extension.tasks?.find(task=>task.definition.name===record.kind);
   if(!definition||!registration||registration.definition!==definition.definition||record.version!==definition.definition.version||!record.background||record.owner!==undefined||record.conversationId!==1||!object(record.input))return false;
   const current=await harness.getTask(record.id,context);check();if(current?.state.status==='terminal')return true;
   if(!current||current.kind!==record.kind||JSON.stringify(current.input)!==JSON.stringify(record.input))return false;
   const sessions=await harness.snapshot(SessionsDoc,context);check();if(!sessions)return false;
   if(record.kind==='token-economizer.inference'){
    const id=record.input.id;if(typeof id!=='string')return false;
    const job=(await harness.snapshot(JobsDoc,context))?.jobs[id];check();
    const host=job&&sessions.hosts[job.sessionKey];return !!job&&job.taskId===record.id&&job.conversationId===host?.conversationId&&await hostCurrent(harness,host);
   }
   if(record.kind==='token-economizer.guard-judge'){
    const id=record.input.id;if(typeof id!=='string')return false;
    const job=(await harness.snapshot(GuardJobsDoc,context))?.jobs[id];check();
    return !!job&&job.effect.id===id&&job.sessionKey===sessionKey(job.host.scope,job.host.id)&&JSON.stringify(sessions.hosts[job.sessionKey])===JSON.stringify(job.host)&&await hostCurrent(harness,job.host);
   }
   if(record.kind==='token-economizer.auto-publication'){
    const repository=record.input.repository;if(typeof repository!=='string')return false;
    const waiter=(await harness.snapshot(AutoWaitersDoc,context))?.repositories[repository];check();
    if(!waiter||waiter.task!==record.id||!waiter.items.length)return false;
    for(const item of waiter.items)if(JSON.stringify([item.scope.host,item.scope.repository])!==repository||scopeKey(item.scope)!==scopeKey(item.host.scope)||item.sessionKey!==sessionKey(item.host.scope,item.host.id)||JSON.stringify(sessions.hosts[item.sessionKey])!==JSON.stringify(item.host)||!await hostCurrent(harness,item.host))return false;
    return true;
   }
   const key=record.input.key,host=typeof key==='string'?sessions.hosts[key]:undefined;
   if(!host||JSON.stringify(record.input.host)!==JSON.stringify(host)||key!==sessionKey(host.scope,host.id)||!await hostCurrent(harness,host))return false;
   if(record.kind==='token-economizer.fit')return record.input.scope===scopeKey(host.scope)&&(await harness.snapshot(ClassifiersDoc,scopeKey(host.scope),context))?.fitTask===record.id;
   const knowledge=await harness.snapshot(KnowledgeDoc,scopeKey(host.scope),context);check();
   return !!sessions.sessions[key as string]&&!!knowledge&&(knowledge.foldQueue.includes(key as string)||sessions.sessions[key as string]?.claim===String(record.id));
  },
  async steering(harness,inspected){
   check();if(inspected.type!=='input'||!inspected.requestId)return false;
   const record=await harness.commit(tx=>tx.submissionByRequest(inspected.conversationId,inspected.requestId!),context);check();
   if(!record||record.type!=='input'||record.id!==inspected.id)return false;
   const entry=record.entry!==undefined?await harness.commit(tx=>tx.entry(record.entry!),context):(await harness.snapshot(InboxDoc,record.conversationId,context))?.items.find(item=>item.id===record.id)?.entry;
   check();if(!entry||entry.kind!==SteeringEntry.kind||!object(entry.data)||typeof entry.data.decisionId!=='string'||typeof entry.data.runId!=='string')return false;
   const data=entry.data;
   const hosts=Object.values((await harness.snapshot(NativeOptimizerSessions,context))?.sessions??{}).map(row=>row.host).filter(host=>host.conversationId===record.conversationId);
   for(const host of hosts){
    if(!await hostCurrent(harness,host))continue;
    const run=await harness.snapshot(RunDoc,sessionKey(host.scope,host.id),context);check();
    const decision=run?.decisions.find(row=>row.id===data.decisionId&&row.runId===data.runId&&row.submissionId===record.id&&row.mode==='active'&&row.action==='redirect'&&['queued','consumed'].includes(row.status));
    if(!decision||record.requestId!==`token-economizer-${fingerprint(decision.id)}`)continue;
    if(record.status==='queued'||record.status==='placed'){
     const live=await harness.snapshot(LiveDoc,record.conversationId,context);check();
     if(!live?.run||runIdentity(live.run)!==decision.runId||!run!.inputs.length||!run!.inputs.every(id=>live.run!.inputs.includes(id)))return false;
    }
    return true;
   }
   return false;
  },
 };
}
