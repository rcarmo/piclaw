import {afterEach,expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {TokenOptimizerConfiguration,parseOptimizerConfig} from '../src/token-optimizer-config.ts';
import {defaultPolicy,oversightPolicy,purposeAllowed} from '#token-optimizer/core';
const close:(()=>void)[]=[];afterEach(()=>{for(const fn of close.splice(0).reverse())fn();});
function fixture(){
 const db=new Database(':memory:');db.exec('PRAGMA busy_timeout=0; CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);');close.push(()=>db.close());
 let owner=true;const guard=()=>{if(!owner)throw Error('owner revoked');};
 const service=new TokenOptimizerConfiguration(db,guard,'local');
 const seed=(config:unknown)=>db.run('INSERT OR REPLACE INTO router_state VALUES (?,?)',['native.token-optimizer.v1',JSON.stringify(config)]);
 const raw=()=>db.query<{value:string},[]>('SELECT value FROM router_state').get()?.value;
 return{service,seed,raw,reopen:()=>new TokenOptimizerConfiguration(db,guard,'local'),revoke(){owner=false;}};
}
test('optimizer defaults read Off without writes and first enable requires Observe before explicit Active',async()=>{
 const f=fixture(),config=await f.service.load();expect(f.service.policy().mode).toBe('off');expect(f.raw()).toBeUndefined();
 config.policy.enabled=true;config.policy.mode='active';config.hasEnabled=true;
 expect((await f.service.configure(config)).policy.mode).toBe('observe');
 const active=f.service.snapshot();active.policy.mode='active';await f.service.configure(active);
 expect((await f.reopen().load()).policy.mode).toBe('active');active.policy.enabled=false;await f.service.configure(active);
 expect(f.service.policy().mode).toBe('off');expect(f.service.snapshot().hasEnabled).toBe(true);
});
test('write contract rejects unknown schemas and both kinds of Agent overrides',async()=>{
 const f=fixture();expect(()=>parseOptimizerConfig({version:2})).toThrow();const config=await f.service.load();
 config.policy.enabled=true;config.policy.mode='active';
 for(const field of ['agents','oversightAgents','workspaces','oversightWorkspaces']) {
  const obsolete={...config,[field]:{local:'active'}};
  await expect(f.service.configure(obsolete)).rejects.toThrow();
  await expect(f.service.update(()=>obsolete)).rejects.toThrow();
 }
 expect(f.service.snapshot().hasEnabled).toBe(false);expect(f.service.policy().enabled).toBe(false);expect(f.raw()).toBeUndefined();
});
test('classifier-only selection stays distinct from a text model and does not consent to inference',async()=>{
 const f=fixture(),config=await f.service.load();config.policy.enabled=true;config.policy.mode='observe';config.policy.loop='judge';config.policy.judge='classifier';config.policy.classifierModel={provider:'fixture',id:'classifier'};config.policy.generativeModel=null;await f.service.configure(config);const saved=await f.reopen().load();expect(saved.policy.classifierModel).toEqual({provider:'fixture',id:'classifier'});expect(saved.policy.generativeModel).toBeNull();expect(saved.policy.inferenceInObserve).toBe(false);
});
test('missing models, stale revisions, aborted requests and owner revocation leave config unchanged',async()=>{
 const f=fixture(),initial=f.service.snapshot(),revision=f.service.revision();const paid=structuredClone(initial);paid.policy.enabled=true;paid.policy.mode='active';paid.policy.microSkills='distiller';await expect(f.service.configure(paid)).rejects.toThrow('Pick a model');expect(f.service.snapshot()).toEqual(initial);const changed=await f.service.load();changed.policy.maxFacts=3;await f.service.configure(changed,{expectedRevision:revision});await expect(f.service.configure(initial,{expectedRevision:revision})).rejects.toThrow('changed');const abort=new AbortController();abort.abort();await expect(f.service.configure(initial,{signal:abort.signal})).rejects.toThrow();expect(f.service.snapshot().policy.maxFacts).toBe(3);f.revoke();await expect(f.service.configure(initial)).rejects.toThrow('owner');
});
for(const combined of [false,true])test(`legacy ${combined?'combined':'independent'} policy preserves local instance modes and ignores Agent overrides`,async()=>{
 const f=fixture(),agent=JSON.stringify(['local','agent']);
 const policy={...defaultPolicy(),enabled:true,mode:'active',goalChecks:true,loop:'rules',inferenceInObserve:true,...(combined?{}:{oversightMode:'active',oversightInferenceInObserve:false})};
 const legacy={version:1,hasEnabled:true,policy,workspaces:{local:'observe',foreign:'off'},agents:{[agent]:'off'},...(combined?{}:{oversightWorkspaces:{local:'active'},oversightAgents:{[agent]:'off'}})};
 f.seed(legacy);
 const revision=f.service.revision(),view=f.service.snapshot();
 expect(f.raw()).toBe(JSON.stringify(legacy));expect(f.service.revision()).toBe(revision);
 expect(Object.keys(view).sort()).toEqual(['hasEnabled','policy','version']);
 expect(f.service.policy()).toMatchObject({mode:'observe',oversightMode:combined?'observe':'active',oversightInferenceInObserve:combined});
 expect(view.policy.sharePlanWithJudge).toBeUndefined();
 await f.service.configure(view,{expectedRevision:revision});
 expect(JSON.parse(f.raw()!)).toEqual(view);expect(f.reopen().snapshot()).toEqual(view);
});
test('legacy Agent overrides cannot enable a disabled global mode or bypass a local Workspace Off',()=>{
 const f=fixture(),agent=JSON.stringify(['local','agent']);
 for(const policy of [defaultPolicy(),{...defaultPolicy(),enabled:true,mode:'active',oversightMode:'active'}]){
  f.seed({version:1,hasEnabled:policy.enabled,policy,workspaces:{local:'off'},agents:{[agent]:'active'},oversightWorkspaces:{local:'off'},oversightAgents:{[agent]:'active'}});
  expect(f.service.policy()).toMatchObject({enabled:false,mode:'off',oversightMode:'off'});
 }
});
test('revision still detects edits to legacy records even when the projected policy is unchanged',async()=>{
 const f=fixture(),legacy={version:1,hasEnabled:false,policy:defaultPolicy(),workspaces:{},agents:{}};
 f.seed(legacy);const global=f.service.snapshot(),revision=f.service.revision();
 f.seed({...legacy,agents:{[JSON.stringify(['local','agent'])]:'off'}});const changed=f.raw();expect(f.service.snapshot()).toEqual(global);
 await expect(f.service.configure(global,{expectedRevision:revision})).rejects.toThrow('changed');expect(f.raw()).toBe(changed);
});
test('independent form edits use the latest admitted SQLite config without losing either feature',async()=>{
 const f=fixture();await Promise.all([f.service.update(config=>{config.policy.maxFacts=7;return config;}),f.service.update(config=>{config.policy.oversightMode='observe';config.policy.goalChecks=true;return config;})]);const saved=f.service.snapshot();expect(saved.policy.maxFacts).toBe(7);expect(saved.policy.oversightMode).toBe('observe');expect(saved.policy.enabled).toBe(false);expect(saved.policy.inferenceInObserve).toBe(false);expect(saved.policy.oversightInferenceInObserve).toBe(false);
});
test('oversight model and plan sharing consent remain explicit even with token optimisation off',async()=>{
 const f=fixture(),config=await f.service.load();Object.assign(config.policy,{oversightMode:'active',loop:'judge',judge:'generative',goalChecks:true});await expect(f.service.configure(config)).rejects.toThrow('Pick a model');config.policy.generativeModel={provider:'fixture',id:'judge'};await f.service.configure(config);
 const policy=f.service.policy(),request={id:'check',purpose:'loop-judge' as const,model:config.policy.generativeModel,prompt:'data',maxOutputTokens:100,deadlineMs:1000,includesPlan:true};expect(policy.mode).toBe('off');expect(oversightPolicy(policy).mode).toBe('active');expect(purposeAllowed(policy,request)).toBe(false);await f.service.update(current=>{current.policy.sharePlanWithJudge=true;return current;});expect(purposeAllowed(f.service.policy(),request)).toBe(true);
});
