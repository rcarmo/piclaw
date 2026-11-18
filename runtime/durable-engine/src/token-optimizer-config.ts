// Settings semantics ported from Kintsugi b8469c29; MIT — see mcp/UPSTREAM-LICENSE.
// Config uses the existing application router_state table; learned/runtime state remains SDK documents.
import type {Database} from 'bun:sqlite';
import {createHash} from 'node:crypto';
import {Type,type Static} from 'typebox';
import {Value} from 'typebox/value';
import {defaultPolicy,effectivePolicy,modelFor,PolicySchema} from '#token-optimizer/core';
import {admitSqliteWrite} from '../../src/db/sqlite-async-admission.js';
const purposeLabels={proposer:'model-written facts',loopJudge:'the stuck-run judge',writer:'redirect writing',toolJudge:'task-aware tool picks',loopClassifier:'the stuck-run classifier',toolClassifier:'the tool classifier'} satisfies Record<keyof ReturnType<typeof defaultPolicy>['models'],string>;
const override=Type.Enum(['inherit','off','observe','active']);
export const optimizerConfigSchema=Type.Object({version:Type.Literal(1),hasEnabled:Type.Boolean(),policy:PolicySchema,workspaces:Type.Record(Type.String({maxLength:256}),override),agents:Type.Record(Type.String({maxLength:512}),override)},{additionalProperties:false});
export type OptimizerConfig=Static<typeof optimizerConfigSchema>;
export function parseOptimizerConfig(value:unknown):OptimizerConfig{Value.Assert(optimizerConfigSchema,value);return structuredClone(value);}
const key='native.token-optimizer.v1';
export class TokenOptimizerConfiguration{
 private readonly listeners=new Set<()=>Promise<void>>();
 constructor(private readonly database:Database,private readonly assertOwner:()=>void){}
 async load(){return this.snapshot();}
 snapshot():OptimizerConfig{this.assertOwner();const row=this.database.query<{value:string},[string]>('SELECT value FROM router_state WHERE key=?').get(key);return row?parseOptimizerConfig(JSON.parse(row.value)):{version:1,hasEnabled:false,policy:defaultPolicy(),workspaces:{},agents:{}};}
 revision(){return createHash('sha256').update(JSON.stringify(this.snapshot())).digest('hex');}
 policy(workspaceId:string,agentId:string){const state=this.snapshot();return effectivePolicy(state.policy,state.workspaces[workspaceId]??'inherit',state.agents[JSON.stringify([workspaceId,agentId])]??'inherit');}
 watch(listener:()=>Promise<void>){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 async configure(input:OptimizerConfig,options:{expectedRevision?:string;authorise?:()=>void;signal?:AbortSignal}={}){
  const next=parseOptimizerConfig(input),check=()=>{this.assertOwner();options.authorise?.();};
  const result=await admitSqliteWrite(this.database,()=>{
   check();if(options.expectedRevision!==undefined&&options.expectedRevision!==this.revision())throw Error('Token optimizer configuration changed; reload before saving');
   const previous=this.snapshot();
   if(next.policy.enabled&&!previous.hasEnabled){if([...Object.values(next.workspaces),...Object.values(next.agents)].includes('active'))throw Error('Start in Observe before enabling an Active override');next.policy.mode='observe';}
   if(next.policy.enabled){const policy=next.policy,required:(keyof typeof policy.models)[]=[];
    if(['both','distiller'].includes(policy.microSkills))required.push('proposer');
    if(policy.loop==='judge'){if(['generative','cascade'].includes(policy.judge)){required.push('loopJudge');if(!policy.savers.templates)required.push('writer');}if(['classifier','cascade'].includes(policy.judge))required.push('loopClassifier');}
    if(policy.pruning!=='off'){if(['generative','cascade'].includes(policy.toolJudge))required.push('toolJudge');if(['classifier','cascade'].includes(policy.toolJudge))required.push('toolClassifier');}
    for(const purpose of required)if(!modelFor(policy,purpose))throw Error(`Pick a model for ${purposeLabels[purpose]}, or turn that feature off`);
    if(policy.offloadOutputs&&policy.outputSummaries&&!policy.generativeModel)throw Error('Pick an optimizer model for output summaries, or turn summaries off');
   }
   next.hasEnabled=previous.hasEnabled||next.policy.enabled;
   const json=JSON.stringify(next);if(Buffer.byteLength(json)>65536)throw Error('Token optimizer configuration exceeds 64 KiB');
   this.database.query('INSERT INTO router_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,json);check();return structuredClone(next);
  },check,options.signal,undefined,check);
  await Promise.all([...this.listeners].map(listener=>listener()));return result;
 }
}
