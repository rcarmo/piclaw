// Settings semantics ported from Kintsugi 4afeac1e; MIT — see mcp/UPSTREAM-LICENSE.
// Config uses existing application SQLite; runtime state remains SDK documents.
import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {Type,type Static} from 'typebox';
import {Value} from 'typebox/value';
import {defaultPolicy,effectivePolicy,modelFor,oversightPolicy,PolicySchema} from '#token-optimizer/core';
import {admitSqliteWrite} from '../../src/db/sqlite-async-admission.js';
const purposeLabels={proposer:'model-written facts',loopJudge:'the stuck-run judge',writer:'redirect writing',toolJudge:'task-aware tool picks',loopClassifier:'the stuck-run classifier',toolClassifier:'the tool classifier'} satisfies Record<keyof ReturnType<typeof defaultPolicy>['models'],string>;
const override=Type.Enum(['inherit','off','observe','active']);
export const optimizerConfigSchema=Type.Object({version:Type.Literal(1),hasEnabled:Type.Boolean(),policy:PolicySchema,workspaces:Type.Record(Type.String({maxLength:256}),override),agents:Type.Record(Type.String({maxLength:512}),override),oversightWorkspaces:Type.Optional(Type.Record(Type.String({maxLength:256}),override)),oversightAgents:Type.Optional(Type.Record(Type.String({maxLength:512}),override))},{additionalProperties:false});
export type OptimizerConfig=Static<typeof optimizerConfigSchema>;
export function parseOptimizerConfig(value:unknown):OptimizerConfig{Value.Assert(optimizerConfigSchema,value);return structuredClone(value);}
/** Freeze legacy combined choices before independently editing either feature. */
export function splitOptimizerPolicy(config:OptimizerConfig){
 if(config.policy.oversightMode===undefined){
  config.policy.oversightMode=oversightPolicy(config.policy).mode;
  config.policy.oversightInferenceInObserve=config.policy.inferenceInObserve;
  config.oversightWorkspaces={...config.workspaces};config.oversightAgents={...config.agents};
 }
}
/** Settings has a single instance. Fold its old workspace mode into each default
 * without touching Agent choices, other identities, or SQLite on a read. */
export function projectInstanceOptimizerConfig(input:OptimizerConfig,workspaceId:string):OptimizerConfig {
 const config=structuredClone(input);
 splitOptimizerPolicy(config);
 const policy=config.policy;
 const mode=effectivePolicy(policy,config.workspaces[workspaceId]??'inherit').mode;
 policy.enabled=mode!=='off';policy.mode=mode;
 policy.oversightMode=effectivePolicy(oversightPolicy(policy),config.oversightWorkspaces?.[workspaceId]??'inherit').mode;
 delete config.workspaces[workspaceId];
 if(config.oversightWorkspaces)delete config.oversightWorkspaces[workspaceId];
 return config;
}
const key='native.token-optimizer.v1';
type WriteOptions={expectedRevision?:string;authorise?:()=>void;signal?:AbortSignal};
export class TokenOptimizerConfiguration{
 private readonly listeners=new Set<()=>Promise<void>>();
 constructor(private readonly database:Database,private readonly assertOwner:()=>void){}
 async load(){return this.snapshot();}
 snapshot():OptimizerConfig{this.assertOwner();const row=this.database.query<{value:string},[string]>('SELECT value FROM router_state WHERE key=?').get(key);return row?parseOptimizerConfig(JSON.parse(row.value)):{version:1,hasEnabled:false,policy:defaultPolicy(),workspaces:{},agents:{}};}
 revision(){return createHash('sha256').update(JSON.stringify(this.snapshot())).digest('hex');}
 policy(workspaceId:string,agentId:string){
  const state=this.snapshot(),id=JSON.stringify([workspaceId,agentId]);
  const policy=effectivePolicy(state.policy,state.workspaces[workspaceId]??'inherit',state.agents[id]??'inherit');
  if(state.policy.oversightMode!==undefined)policy.oversightMode=effectivePolicy(oversightPolicy(state.policy),state.oversightWorkspaces?.[workspaceId]??'inherit',state.oversightAgents?.[id]??'inherit').mode;
  return policy;
 }
 watch(listener:()=>Promise<void>){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 async configure(input:OptimizerConfig,options:WriteOptions={}){
  const replacement=parseOptimizerConfig(input);return this.update(()=>replacement,options);
 }
 /** Edit the latest committed config through Core's existing SQLite admission. */
 async update(edit:(current:OptimizerConfig)=>OptimizerConfig,options:WriteOptions={}){
  const check=()=>{this.assertOwner();options.authorise?.();};
  const result=await admitSqliteWrite(this.database,()=>{
   check();if(options.expectedRevision!==undefined&&options.expectedRevision!==this.revision())throw Error('Token optimizer configuration changed; reload before saving');
   const previous=this.snapshot(),next=parseOptimizerConfig(edit(structuredClone(previous)));
   if(next.policy.enabled&&!previous.hasEnabled){if([...Object.values(next.workspaces),...Object.values(next.agents)].includes('active'))throw Error('Start in Observe before enabling an Active override');next.policy.mode='observe';}
   const policy=next.policy,required:(keyof typeof policy.models)[]=[];
   if(policy.enabled&&['both','distiller'].includes(policy.microSkills))required.push('proposer');
   if(oversightPolicy(policy).enabled&&policy.loop==='judge'){if(['generative','cascade'].includes(policy.judge)){required.push('loopJudge');if(!policy.savers.templates)required.push('writer');}if(['classifier','cascade'].includes(policy.judge))required.push('loopClassifier');}
   if(policy.enabled&&policy.pruning!=='off'){if(['generative','cascade'].includes(policy.toolJudge))required.push('toolJudge');if(['classifier','cascade'].includes(policy.toolJudge))required.push('toolClassifier');}
   for(const purpose of required)if(!modelFor(policy,purpose))throw Error(`Pick a model for ${purposeLabels[purpose]}, or turn that feature off`);
   if(policy.enabled&&policy.offloadOutputs&&policy.outputSummaries&&!policy.generativeModel)throw Error('Pick an optimizer model for output summaries, or turn summaries off');
   next.hasEnabled=previous.hasEnabled||next.policy.enabled;
   const json=JSON.stringify(next);if(Buffer.byteLength(json)>65536)throw Error('Token optimizer configuration exceeds 64 KiB');
   this.database.query('INSERT INTO router_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,json);check();return structuredClone(next);
  },check,options.signal,undefined,check);
  await Promise.all([...this.listeners].map(listener=>listener()));return result;
 }
}
