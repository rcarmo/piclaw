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
const optimizerConfigSchema=Type.Object({version:Type.Literal(1),hasEnabled:Type.Boolean(),policy:PolicySchema},{additionalProperties:false});
const legacyConfigSchema=Type.Object({
 ...optimizerConfigSchema.properties,
 workspaces:Type.Record(Type.String({maxLength:256}),override),
 agents:Type.Record(Type.String({maxLength:512}),override),
 oversightWorkspaces:Type.Optional(Type.Record(Type.String({maxLength:256}),override)),
 oversightAgents:Type.Optional(Type.Record(Type.String({maxLength:512}),override)),
},{additionalProperties:false});
export type OptimizerConfig=Static<typeof optimizerConfigSchema>;
export function parseOptimizerConfig(value:unknown):OptimizerConfig{Value.Assert(optimizerConfigSchema,value);return structuredClone(value);}

/** Read old records without rewriting them. The old local workspace mode was
 * instance-wide; carry it forward, but never use individual Agent settings. */
function readStoredConfig(value:unknown,workspaceId:string):OptimizerConfig {
 if(!Value.Check(legacyConfigSchema,value))return normaliseConfig(parseOptimizerConfig(value));
 const policy=structuredClone(value.policy);
 const oldWorkspace=value.workspaces[workspaceId]??'inherit';
 const oldOversight=policy.oversightMode===undefined?oldWorkspace:value.oversightWorkspaces?.[workspaceId]??'inherit';
 return normaliseConfig({version:value.version,hasEnabled:value.hasEnabled,policy},oldWorkspace,oldOversight);
}
function normaliseConfig(config:OptimizerConfig,workspace:Static<typeof override>='inherit',oversightWorkspace:Static<typeof override>='inherit') {
 const policy=config.policy,oversight=oversightPolicy(policy);
 policy.mode=effectivePolicy(policy,workspace).mode;
 policy.enabled=policy.mode!=='off';
 policy.oversightMode=effectivePolicy(oversight,oversightWorkspace).mode;
 policy.oversightInferenceInObserve=oversight.inferenceInObserve;
 return config;
}
const key='native.token-optimizer.v1';
type WriteOptions={expectedRevision?:string;authorise?:()=>void;signal?:AbortSignal};
export class TokenOptimizerConfiguration{
 private readonly listeners=new Set<()=>Promise<void>>();
 constructor(private readonly database:Database,private readonly assertOwner:()=>void,private readonly workspaceId:string){}
 async load(){return this.snapshot();}
 private stored(){this.assertOwner();return this.database.query<{value:string},[string]>('SELECT value FROM router_state WHERE key=?').get(key)?.value;}
 snapshot():OptimizerConfig{const raw=this.stored();return readStoredConfig(raw===undefined?{version:1,hasEnabled:false,policy:defaultPolicy()}:JSON.parse(raw),this.workspaceId);}
 revision(){return createHash('sha256').update(this.stored()??JSON.stringify(this.snapshot())).digest('hex');}
 policy(){return this.snapshot().policy;}
 watch(listener:()=>Promise<void>){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 async configure(input:OptimizerConfig,options:WriteOptions={}){
  const replacement=parseOptimizerConfig(input);return this.update(()=>replacement,options);
 }
 /** Edit the latest committed config through Core's existing SQLite admission. */
 async update(edit:(current:OptimizerConfig)=>OptimizerConfig,options:WriteOptions={}){
  const check=()=>{this.assertOwner();options.authorise?.();};
  const result=await admitSqliteWrite(this.database,()=>{
   check();if(options.expectedRevision!==undefined&&options.expectedRevision!==this.revision())throw Error('Token optimizer configuration changed; reload before saving');
   const previous=this.snapshot(),hadEnabled=previous.hasEnabled;
   const next=parseOptimizerConfig(edit(previous));
   if(next.policy.enabled&&next.policy.mode!=='off'&&!hadEnabled)next.policy.mode='observe';
   normaliseConfig(next);
   const policy=next.policy,required:(keyof typeof policy.models)[]=[];
   if(policy.enabled&&['both','distiller'].includes(policy.microSkills))required.push('proposer');
   if(oversightPolicy(policy).enabled&&policy.loop==='judge'){if(['generative','cascade'].includes(policy.judge)){required.push('loopJudge');if(!policy.savers.templates)required.push('writer');}if(['classifier','cascade'].includes(policy.judge))required.push('loopClassifier');}
   if(policy.enabled&&policy.pruning!=='off'){if(['generative','cascade'].includes(policy.toolJudge))required.push('toolJudge');if(['classifier','cascade'].includes(policy.toolJudge))required.push('toolClassifier');}
   for(const purpose of required)if(!modelFor(policy,purpose))throw Error(`Pick a model for ${purposeLabels[purpose]}, or turn that feature off`);
   if(policy.enabled&&policy.offloadOutputs&&policy.outputSummaries&&!policy.generativeModel)throw Error('Pick an optimizer model for output summaries, or turn summaries off');
   next.hasEnabled=hadEnabled||next.policy.enabled;
   const json=JSON.stringify(next);if(Buffer.byteLength(json)>65536)throw Error('Token optimizer configuration exceeds 64 KiB');
   this.database.query('INSERT INTO router_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,json);check();return structuredClone(next);
  },check,options.signal,undefined,check);
  await Promise.all([...this.listeners].map(listener=>listener()));return result;
 }
}
