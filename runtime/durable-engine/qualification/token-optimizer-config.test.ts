import {afterEach,expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {TokenOptimizerConfiguration,parseOptimizerConfig,splitOptimizerPolicy,projectInstanceOptimizerConfig} from '../src/token-optimizer-config.ts';
import {oversightPolicy,purposeAllowed} from '#token-optimizer/core';
const close:(()=>void)[]=[];afterEach(()=>{for(const fn of close.splice(0).reverse())fn();});
function fixture(){const db=new Database(':memory:');db.exec('PRAGMA busy_timeout=0; CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);');close.push(()=>db.close());let owner=true;const guard=()=>{if(!owner)throw Error('owner revoked');};return{db,guard,service:new TokenOptimizerConfiguration(db,guard),revoke(){owner=false;}};}
test('optimizer defaults read Off without writes and first enable requires Observe before explicit Active',async()=>{const f=fixture(),config=await f.service.load();expect(f.service.policy('workspace','agent').mode).toBe('off');expect(f.db.query('SELECT count(*) AS n FROM router_state').get()).toEqual({n:0});config.policy.enabled=true;config.policy.mode='active';expect((await f.service.configure(config)).policy.mode).toBe('observe');const active=f.service.snapshot();active.policy.mode='active';active.workspaces.workspace='off';active.agents[JSON.stringify(['workspace','agent'])]='active';await f.service.configure(active);expect(f.service.policy('workspace','agent').mode).toBe('off');active.workspaces.workspace='inherit';await f.service.configure(active);expect(f.service.policy('workspace','agent').mode).toBe('active');const reopen=new TokenOptimizerConfiguration(f.db,f.guard);expect((await reopen.load()).policy.mode).toBe('active');active.policy.enabled=false;await f.service.configure(active);expect(f.service.policy('workspace','agent').mode).toBe('off');});
test('unknown schemas and latent Active overrides cannot bypass first-enable consent',async()=>{const f=fixture();expect(()=>parseOptimizerConfig({version:2})).toThrow();const config=await f.service.load();config.policy.enabled=true;config.workspaces.workspace='active';await expect(f.service.configure(config)).rejects.toThrow('Observe');expect(f.service.snapshot().hasEnabled).toBe(false);expect(f.service.snapshot().policy.enabled).toBe(false);});
test('classifier-only selection stays distinct from a text model and does not consent to inference',async()=>{const f=fixture(),config=await f.service.load();config.policy.enabled=true;config.policy.mode='observe';config.policy.loop='judge';config.policy.judge='classifier';config.policy.classifierModel={provider:'fixture',id:'classifier'};config.policy.generativeModel=null;await f.service.configure(config);const saved=await new TokenOptimizerConfiguration(f.db,f.guard).load();expect(saved.policy.classifierModel).toEqual({provider:'fixture',id:'classifier'});expect(saved.policy.generativeModel).toBeNull();expect(saved.policy.inferenceInObserve).toBe(false);});
test('missing models, stale revisions, aborted requests and owner revocation leave config unchanged',async()=>{const f=fixture(),initial=f.service.snapshot(),revision=f.service.revision();const paid=structuredClone(initial);paid.policy.enabled=true;paid.policy.microSkills='distiller';await expect(f.service.configure(paid)).rejects.toThrow('Pick a model');expect(f.service.snapshot()).toEqual(initial);const changed=await f.service.load();changed.policy.maxFacts=3;await f.service.configure(changed,{expectedRevision:revision});await expect(f.service.configure(initial,{expectedRevision:revision})).rejects.toThrow('changed');const abort=new AbortController();abort.abort();await expect(f.service.configure(initial,{signal:abort.signal})).rejects.toThrow();expect(f.service.snapshot().policy.maxFacts).toBe(3);f.revoke();await expect(f.service.configure(initial)).rejects.toThrow('owner');});

test('split settings retain legacy oversight and ancestor vetoes, then edit independently',async()=>{
 const f=fixture(),config=await f.service.load();Object.assign(config.policy,{enabled:true,goalChecks:true,loop:'rules'});await f.service.configure(config);const legacy=f.service.snapshot();legacy.policy.mode='active';legacy.workspaces.blocked='off';await f.service.configure(legacy);
 expect(oversightPolicy(f.service.policy('allowed','agent')).mode).toBe('active');const split=f.service.snapshot();splitOptimizerPolicy(split);split.policy.enabled=false;await f.service.configure(split);
 expect(f.service.policy('allowed','agent').mode).toBe('off');expect(oversightPolicy(f.service.policy('allowed','agent')).mode).toBe('active');expect(oversightPolicy(f.service.policy('blocked','agent')).mode).toBe('off');expect(split.policy.sharePlanWithJudge).toBeUndefined();
 const next=f.service.snapshot();next.policy.enabled=true;next.policy.oversightMode='off';await f.service.configure(next);const reopened=new TokenOptimizerConfiguration(f.db,f.guard);expect(reopened.policy('allowed','agent').mode).toBe('active');expect(oversightPolicy(reopened.policy('allowed','agent')).mode).toBe('off');
});
test('instance Settings folds only the local legacy overrides into the defaults without changing effective Agent modes',async()=>{
 const f=fixture(),initial=f.service.snapshot(),instance='local',other='foreign',agentKey=(agent:string)=>JSON.stringify([instance,agent]);
 initial.policy.enabled=true;initial.policy.mode='observe';await f.service.configure(initial);
 const config=f.service.snapshot();Object.assign(config.policy,{mode:'active',goalChecks:true,inferenceInObserve:true});
 config.workspaces={[instance]:'off',[other]:'observe'};config.agents={[agentKey('on')]:'active',[agentKey('off')]:'off'};
 // A legacy combined policy must split before its historical inherited modes are folded.
 await f.service.configure(config);const first=f.service.snapshot(),revision=f.service.revision();
 const agents=['on','off','new'];const modes=()=>agents.map(agent=>{const policy=f.service.policy(instance,agent);return [policy.mode,oversightPolicy(policy).mode];});
 const before=modes();const projected=projectInstanceOptimizerConfig(first,instance);
 expect(f.service.revision()).toBe(revision);expect(f.service.snapshot()).toEqual(first);
 expect(projected.workspaces).toEqual({[other]:'observe'});expect(projected.oversightWorkspaces).toEqual({[other]:'observe'});
 expect(projected.policy).toMatchObject({enabled:false,mode:'off',oversightMode:'off',oversightInferenceInObserve:true});
 expect(projected.agents).toEqual(first.agents);expect(projected.oversightAgents).toEqual(first.agents);
 await f.service.configure(projected,{expectedRevision:revision});expect(modes()).toEqual(before);
 const independent=f.service.snapshot();independent.policy.enabled=true;independent.policy.mode='active';independent.policy.oversightMode='active';
 independent.workspaces[instance]='observe';independent.oversightWorkspaces![instance]='active';independent.oversightAgents![agentKey('on')]='observe';
 await f.service.configure(independent);const prior=modes(),next=projectInstanceOptimizerConfig(f.service.snapshot(),instance);
 expect(next.policy.mode).toBe('observe');expect(next.policy.oversightMode).toBe('active');
 await f.service.configure(next);expect(modes()).toEqual(prior);expect(projectInstanceOptimizerConfig(next,instance)).toEqual(next);
});
test('instance projection keeps a disabled ancestor Off even with a dormant Active override',()=>{
 const f=fixture(),config=f.service.snapshot();config.workspaces.local='active';config.oversightWorkspaces={local:'active'};config.policy.oversightMode='off';
 const view=projectInstanceOptimizerConfig(config,'local');expect(view.policy.mode).toBe('off');expect(view.policy.enabled).toBe(false);expect(view.policy.oversightMode).toBe('off');expect(view.hasEnabled).toBe(false);expect(view.workspaces).toEqual({});
});

test('independent form edits use the latest admitted SQLite config without losing either feature',async()=>{
 const f=fixture();await Promise.all([f.service.update(config=>{splitOptimizerPolicy(config);config.policy.maxFacts=7;return config;}),f.service.update(config=>{splitOptimizerPolicy(config);config.policy.oversightMode='observe';config.policy.goalChecks=true;return config;})]);const saved=f.service.snapshot();expect(saved.policy.maxFacts).toBe(7);expect(saved.policy.oversightMode).toBe('observe');expect(saved.policy.enabled).toBe(false);expect(saved.policy.inferenceInObserve).toBe(false);expect(saved.policy.oversightInferenceInObserve).toBe(false);
});
test('oversight model and plan sharing consent remain explicit even with token optimisation off',async()=>{
 const f=fixture(),config=await f.service.load();splitOptimizerPolicy(config);Object.assign(config.policy,{oversightMode:'active',loop:'judge',judge:'generative',goalChecks:true});await expect(f.service.configure(config)).rejects.toThrow('Pick a model');config.policy.generativeModel={provider:'fixture',id:'judge'};await f.service.configure(config);
 const policy=f.service.policy('workspace','agent'),request={id:'check',purpose:'loop-judge' as const,model:config.policy.generativeModel,prompt:'data',maxOutputTokens:100,deadlineMs:1000,includesPlan:true};expect(policy.mode).toBe('off');expect(purposeAllowed(policy,request)).toBe(false);await f.service.update(current=>{current.policy.sharePlanWithJudge=true;return current;});expect(purposeAllowed(f.service.policy('workspace','agent'),request)).toBe(true);
});
