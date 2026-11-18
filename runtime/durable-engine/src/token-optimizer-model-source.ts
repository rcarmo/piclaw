import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import type {Harness,ConversationId} from '@earendil-works/pi-durable';
import {Type} from 'typebox';import{Value}from'typebox/value';
import {JobsDoc,SessionsDoc,type HostSession} from '#token-optimizer/pi-durable';
import {purposeAllowed,modelFor,type InferenceRequest} from '#token-optimizer/core';
import {currentTaskExecutionScope} from './task-model-boundary-shim.ts';
import type {TokenOptimizerConfiguration} from './token-optimizer-config.ts';
const actorSchema=Type.Tuple([Type.String(),Type.String()]);
/** Authorise a model side-call only from the actual running public SDK optimizer task. */
export async function captureOptimizerModelSource(options:{harness:()=>Harness;assertOwner():void;configuration:TokenOptimizerConfiguration;workspaceId:string;environmentRevision:string;assertAgent(agentId:string,conversationId:ConversationId):void},signal:AbortSignal|undefined){
 options.assertOwner();if(!signal)throw Error('Optimizer model request signal is required');signal.throwIfAborted();
 const scope=currentTaskExecutionScope();if(!scope||scope.taskKind!=='token-economizer.inference'||scope.phase!=='invoke'||!scope.checkpointHash)throw Error('Optimizer request requires its exact SDK inference phase');scope.signal.throwIfAborted();
 const task=await options.harness().getTask(scope.taskId,context);options.assertOwner();scope.signal.throwIfAborted();signal.throwIfAborted();
 if(!task||task.kind!=='token-economizer.inference'||task.version!==1||task.conversationId!==scope.conversationId||!task.background||task.state.status!=='running'||!Value.Check(Type.Object({phase:Type.Literal('invoke')}),task.state.checkpoint))throw Error('Optimizer SDK task binding changed');
 const inputSchema=Type.Object({id:Type.String()});Value.Assert(inputSchema,task.input);
 const jobs=await options.harness().snapshot(JobsDoc,context),job=jobs?.jobs[task.input.id];
 const sessions=await options.harness().snapshot(SessionsDoc,context),host=job&&sessions?.hosts[job.sessionKey];
 if(!job||job.taskId!==scope.taskId||job.status!=='running'||jobs?.worker!==job.id||!host||job.conversationId===undefined||host.conversationId!==job.conversationId||jobs.paused.includes(job.account))throw Error('Optimizer job/session authority is unavailable');
 if(host.scope.host!=='piclaw.native'||host.scope.repository!==options.workspaceId||host.scope.environment!==options.environmentRevision)throw Error('Optimizer request belongs to another workspace/environment');
 const actor:unknown=JSON.parse(host.id);Value.Assert(actorSchema,actor);const agentId=actor[0];
 const selected=(request:InferenceRequest)=>{const policy=options.configuration.policy(options.workspaceId,agentId);if(request.classification)return modelFor(policy,request.classification.purpose==='loop'?'loopClassifier':'toolClassifier');if(request.purpose==='output-summary')return policy.generativeModel;if(request.purpose==='proposer'||request.auditFor==='proposer')return modelFor(policy,'proposer');if(request.purpose==='writer')return modelFor(policy,'writer');if(request.purpose==='tool-judge'||request.auditFor==='tools')return modelFor(policy,'toolJudge');return modelFor(policy,'loopJudge');};
 const check=(model?:{provider:string;id:string})=>{
  options.assertOwner();scope.signal.throwIfAborted();signal.throwIfAborted();options.assertAgent(agentId,host.conversationId);
  const policy=options.configuration.policy(options.workspaceId,agentId),chosen=selected(job.request);
  if(!purposeAllowed(policy,job.request)||Date.now()>=job.deadline||!chosen||chosen.provider!==job.request.model.provider||chosen.id!==job.request.model.id||model&&(model.provider!==chosen.provider||model.id!==chosen.id))throw Error('Optimizer policy, model or deadline changed');
 };
 check();return{job:structuredClone(job),host:structuredClone(host) as HostSession,agentId,check};
}
