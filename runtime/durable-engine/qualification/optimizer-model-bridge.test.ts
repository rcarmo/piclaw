import {afterEach,expect,test} from 'bun:test';
import {Database} from 'bun:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Harness,createRegistry,MemoryStorage} from '@earendil-works/pi-durable';
import {SqliteStorage} from '@earendil-works/pi-durable/storage/sqlite';
import {BACKGROUND_CONTEXT as context} from '@earendil-works/chord/context';
import {BunSqliteDatabase} from '../src/bun-sqlite.ts';
import {TokenOptimizerConfiguration} from '../src/token-optimizer-config.ts';
import {createNativeTokenOptimizer,type CoreOptimizerAgent} from '../src/token-optimizer.ts';
import {createOptimizerModels} from '../src/token-optimizer-models.ts';
import {applicationRetainedDatabase} from '../src/mcp/retained-database.ts';
import {withTaskModelRequestScope} from '../src/task-model-boundary-shim.ts';
import {JobsDoc} from '#token-optimizer/pi-durable';
const rootPackage=new URL('../../../package.json',import.meta.url).href;
const {ModelRuntime}:typeof import('../../../node_modules/@earendil-works/pi-coding-agent')=await import(import.meta.resolve('@earendil-works/pi-coding-agent',rootPackage));
const {createAssistantMessageEventStream}:typeof import('../../../node_modules/@earendil-works/pi-ai')=await import(import.meta.resolve('@earendil-works/pi-ai',rootPackage));
const cleanup:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
// The bridge execution test also qualifies durable storage. The auth and
// payload guards use real SDK jobs too, but do not assert restart persistence.
async function fixture({sqlite=false,beforeSend,replace}: {sqlite?:boolean;beforeSend?:()=>Promise<void>;replace?:'headers'|'body'} = {}){
 const dir=mkdtempSync(join(tmpdir(),'optimizer-host-bridge-')),file=sqlite?join(dir,'state.sqlite'):':memory:',db=new Database(file,{create:true});
 db.exec('PRAGMA journal_mode=WAL;PRAGMA secure_delete=ON;PRAGMA busy_timeout=0;CREATE TABLE router_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
 cleanup.push(async()=>{db.close();rmSync(dir,{recursive:true,force:true});});
 const config=new TokenOptimizerConfiguration(db,()=>{}),ref={provider:'optimizer-fixture',id:'small'};
 const model={...ref,name:'Fixture',api:'openai-completions' as const,input:['text'] as ('text')[],reasoning:false,contextWindow:128000,maxTokens:4096,baseUrl:'https://fixture.invalid',cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 const host=await ModelRuntime.create({credentials:{read:async()=>({type:'api_key' as const,key:'SYNTHETIC'}),list:async()=>[{providerId:ref.provider,type:'api_key' as const}],modify:async()=>undefined,delete:async()=>{}},modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
 let calls=0,hold=false,payloadChecks=0;const entered=Promise.withResolvers<void>(),released=Promise.withResolvers<void>(),headerNames:string[][]=[];
 type RootRun=NonNullable<Parameters<typeof host.registerNativeProvider>[0]['streamSimple']>;
 const run=(actual:Parameters<RootRun>[0],_request:unknown,options?:Pick<NonNullable<Parameters<RootRun>[2]>,'onPayload'>)=>{
  calls++;const stream=createAssistantMessageEventStream();
  queueMicrotask(async()=>{
   const message={role:'assistant' as const,api:model.api,provider:ref.provider,model:ref.id,content:[{type:'text' as const,text:'Useful synthetic summary.'}],stopReason:'stop' as const,timestamp:Date.now(),usage:{input:5,output:4,cacheRead:0,cacheWrite:0,totalTokens:9,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
   try{await options?.onPayload?.({model:ref.id,messages:[{role:'user',content:'synthetic'}]},actual);stream.push({type:'done',reason:'stop',message});}
   catch(error){stream.push({type:'error',reason:'error',error:{...message,stopReason:'error',errorMessage:error instanceof Error?error.message:String(error),content:[]}});}
  });return stream;
 };
 host.registerNativeProvider({id:ref.provider,name:'Fixture',getModels:()=>[model],auth:{apiKey:{name:'Fixture',resolve:async()=>{if(hold){entered.resolve();await released.promise;}return{auth:{headers:{Authorization:'SYNTHETIC_ROOT_HEADER'}},source:'fixture'};}}},stream:run,streamSimple:run});await host.refresh({allowNetwork:false});
 let harness:Harness;const agents:CoreOptimizerAgent[]=[];
 const bridge=createOptimizerModels(host,[ref],{harness:()=>harness,configuration:config,workspaceId:'workspace',environmentRevision:'owned-env',signal:new AbortController().signal,assertOwner(){},assertAgent(id){if(id!=='root_agent')throw Error('wrong Agent');},assertModel(current){if(current.provider!==ref.provider||current.id!==ref.id)throw Error('unapproved');}});
 const complete:typeof bridge.completeSimple=(selected,request,options)=>bridge.completeSimple(selected,request,{...options,async transformHeaders(headers){headerNames.push(Object.keys(headers));await beforeSend!();return replace==='headers'?{Authorization:'SYNTHETIC_ATTEMPT'}:headers;},async onPayload(payload){payloadChecks++;await beforeSend!();return replace==='body'?{model:'foreign'}:payload;}});
 const models=beforeSend?new Proxy({} as typeof bridge,{get(_target,key){if(key==='completeSimple')return complete;const value=Reflect.get(bridge,key,bridge);return typeof value==='function'?value.bind(bridge):value;}}):bridge;
 const policy=await config.load();Object.assign(policy.policy,{enabled:true,mode:'observe',offloadOutputs:true,outputSummaries:true,generativeModel:ref});await config.configure(policy);const active=config.snapshot();active.policy.mode='active';await config.configure(active);
 const registry=createRegistry(),native=createNativeTokenOptimizer({workspaceId:'workspace',workspaceRoot:dir,environmentRevision:'owned-env',harness:()=>harness,models,registry,configuration:config,agents:async()=>agents,plan:async()=>null,readSavedOutput:async()=>({status:'unavailable'}),database:applicationRetainedDatabase(db,()=>{})});
 registry.install(native.optimizer.extension);harness=await Harness.open(sqlite?await SqliteStorage.open(new BunSqliteDatabase(file)):new MemoryStorage(),{registry:withTaskModelRequestScope(registry),models},context);
 cleanup.push(async()=>{released.resolve();try{await native.close();}finally{await harness.close(context);}});
 const root=await harness.root(context);agents.push({agentId:'root_agent',durableId:root.id});await native.attach();harness.resume();
 return{native,root,models,jobs:()=>harness.snapshot(JobsDoc,context),model:models.getModel(ref.provider,ref.id)!,calls:()=>calls,headerNames,payloadChecks:()=>payloadChecks,holdAuth(){hold=true;return{entered:entered.promise,release:()=>released.resolve()};}};
}
const summary=(f:Awaited<ReturnType<typeof fixture>>)=>f.native.optimizer.summarizeOutput(f.root.id,{id:'out_fixture',tool:'bash',label:'fixture',text:'synthetic '.repeat(1000),lines:200,bytes:10000},2000);
test('optimizer inference crosses the existing physical Root/private bridge only under its real SDK job',async()=>{const f=await fixture({sqlite:true});expect(await summary(f)).toBe('Useful synthetic summary.');expect(f.calls()).toBe(1);});
test('outside-task use of the optimizer bridge fails closed without a provider request',async()=>{const f=await fixture();const r=await f.models.completeSimple(f.model,{messages:[{role:'user',content:'No task',timestamp:0}]},{signal:new AbortController().signal});expect(r.stopReason).toBe('error');expect(f.calls()).toBe(0);});
test('SDK optimizer before-send guards stay local, run after auth and cannot see credentials',async()=>{let guards=0;const f=await fixture({beforeSend:async()=>{guards++;}});const result=await summary(f);expect(result,JSON.stringify({jobs:await f.jobs(),guards,headers:f.headerNames,payload:f.payloadChecks()})).toBe('Useful synthetic summary.');expect(f.calls()).toBe(1);expect(guards).toBeGreaterThanOrEqual(2);expect(f.headerNames.length).toBeGreaterThan(0);expect(f.headerNames.every(keys=>keys.length===0)).toBe(true);expect(f.payloadChecks()).toBe(1);});
test('a guard revoked while physical Root auth waits prevents provider inference',async()=>{let allowed=true;const f=await fixture({beforeSend:async()=>{if(!allowed)throw Error('Plan binding changed');}}),auth=f.holdAuth();const pending=summary(f);try{await Promise.race([auth.entered,pending.then(async()=>{throw Error('Request ended before auth: '+JSON.stringify(await f.jobs()));})]);allowed=false;}finally{auth.release();}expect(await pending).toBeNull();expect(f.calls()).toBe(0);});

test('optimizer guard callbacks cannot replace Root credentials or the authorised provider body',async()=>{
 const headers=await fixture({beforeSend:async()=>{},replace:'headers'});expect(await summary(headers)).toBeNull();expect(headers.calls()).toBe(0);
 const body=await fixture({beforeSend:async()=>{},replace:'body'});expect(await summary(body)).toBeNull();expect(body.payloadChecks()).toBe(1);
});
