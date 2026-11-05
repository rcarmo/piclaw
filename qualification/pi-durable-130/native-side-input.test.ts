import './src/test-guard.js';
import {expect,spyOn} from 'bun:test';
import {writeFileSync,readFileSync,existsSync,rmSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {getConfigPath} from '../../runtime/src/core/config-context.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {createAssistantMessageEventStream} from '../../node_modules/@earendil-works/pi-ai';
import {awaitWithContext,withAbortSignal,BACKGROUND_CONTEXT} from '../../runtime/durable-engine/qualification/context.js';
import * as hostModels from '../../runtime/durable-engine/src/host-models.js';
import {Harness,createRegistry} from '../../runtime/durable-engine/qualification/durable.js';
import {createModels} from '../../runtime/durable-engine/qualification/ai.js';
import {SqliteStorage} from '../../runtime/durable-engine/qualification/sqlite.js';
import {BunSqliteDatabase} from '../../runtime/durable-engine/src/bun-sqlite.js';
import {context as sdkContext} from './src/fixture.js';
const applicationTest=isolatedApplicationTest(import.meta.url);
const barrier=()=>{let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return {promise,release};};

async function sideFixture(){
  const f=await nativeGoalFixture();const baseline=await f.send('Baseline parent conversation');await f.entered.promise;f.held.release();await f.until(()=>f.status(baseline.submission_id)==='done');
  const state={calls:0,contexts:[] as any[],signals:[] as (AbortSignal|undefined)[],entered:barrier(),held:barrier(),toolPath:undefined as string|undefined,authGate:undefined as (()=>Promise<void>)|undefined,usage:undefined as Record<string,any>|undefined};
  const stream=(model:any,context:any,options?:{signal?:AbortSignal})=>{
    const output=createAssistantMessageEventStream();state.calls++;state.contexts.push(JSON.parse(JSON.stringify(context)));state.signals.push(options?.signal);
    const tool=JSON.stringify(context.messages.findLast((item:any)=>item.role==='user')?.content).includes('USE_SIDE_TOOL')&&!context.messages.some((item:any)=>item.role==='toolResult'&&item.toolName==='read');
    const message:any={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),content:tool?[{type:'toolCall',id:'native-side-read',name:'read',arguments:{path:state.toolPath}}]:[{type:'text',text:'Native isolated side reply'}],stopReason:tool?'toolUse':'stop',usage:state.usage?structuredClone(state.usage):{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    void(async()=>{try{
      if(JSON.stringify(context.messages.findLast((item:any)=>item.role==='user')?.content).includes('HELD_SIDE')){state.entered.release();await awaitWithContext(state.held.promise,withAbortSignal(options!.signal!,BACKGROUND_CONTEXT));}
      options?.signal?.throwIfAborted();if(!tool)output.push({type:'text_delta',contentIndex:0,delta:'Native isolated side reply',partial:message});output.push({type:'done',reason:message.stopReason,message});output.end(message);
    }catch(error){const aborted={...message,content:[],stopReason:'aborted',errorMessage:String(error),usage:{...message.usage,input:0,output:0,totalTokens:0}};output.push({type:'error',reason:'aborted',error:aborted});output.end(aborted);}})();return output;
  };
  f.modelRuntime.registerNativeProvider({id:f.model.provider,name:'Side fixture',getModels:()=>[f.model],auth:{apiKey:{name:'Keyless fixture',resolve:async()=>{await state.authGate?.();return {auth:{},source:'fixture'};}}},stream:stream as any,streamSimple:stream as any});await f.modelRuntime.refresh({allowNetwork:false});
  const parent=(f.root.query("SELECT conversation_id FROM piclaw_durable_bindings_v1 WHERE chat_jid='web:default' LIMIT 1").get() as {conversation_id:number}).conversation_id;
  const history=()=>f.root.query('SELECT * FROM entries WHERE conversation_id=? ORDER BY id').all(parent);
  const financial=()=>(f.root.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'budget_%' ORDER BY name").all() as {name:string}[]).map(({name})=>f.root.query(`SELECT * FROM ${name} ORDER BY rowid`).all());
  return {f,state,parent,history,financial,async close(){state.held.release();await f.close();}};
}

applicationTest('actual factory side request preserves isolated SDK history, current request identity, streaming and stored result across reopen without finance',async()=>{
  const s=await sideFixture(),{f,state}=s;
  try{
    f.root.query("INSERT INTO budget_work(id,chat_jid,execution_kind,status,created_at,updated_at) VALUES ('historical-side','web:default','side_prompt','paused','2020-01-01','2020-01-01')").run();
    f.root.query("INSERT INTO budget_caps(id,scope,metric,amount,work_id,created_at,updated_at) VALUES ('historical-side-zero','task','api_usd_micros',0,'historical-side','2020-01-01','2020-01-01')").run();
    f.root.query("INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,state,created_at,updated_at) VALUES ('historical-side-hold','historical-side','web:default','fixture','lifecycle','historical-account',?,'unresolved','2020-01-01','2020-01-01')").run('a'.repeat(64));
    const parent=s.history(),financial=s.financial(),position=f.backend.sessionOptions.getDurableSession!('web:default')!,identity=position.sessionId,model=await position.readModel!();
    const events:string[]=[],text:string[]=[];
    const options={requestId:'stable-current-side',systemPrompt:'SIDE_SYSTEM_PREFIX',onEvent(event:any){events.push(event.type);},onTextDelta(delta:string){text.push(delta);}};
    const result=await f.pool.runSidePrompt('web:default','Isolated side request',options);expect(result).toMatchObject({status:'success',result:'Native isolated side reply',model:'fixture/lifecycle',usage:{totalTokens:2}});
    expect(state.calls).toBe(1);expect(events).toContain('text_delta');expect(events).toContain('done');expect(text.join('')).toBe('Native isolated side reply');expect(JSON.stringify(state.contexts.at(-1))).toContain('SIDE_SYSTEM_PREFIX\\n\\nIsolated side request');
    expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);expect(position.sessionId).toBe(identity);expect(await position.readModel!()).toBe(model);
    const side=f.root.query("SELECT conversation_id,request_id,source_id FROM piclaw_durable_bindings_v1 WHERE source_id LIKE 'side-prompt:%'").get() as {conversation_id:number;request_id:string;source_id:string};expect(side.conversation_id).not.toBe(s.parent);expect(side.request_id).toBe(side.source_id);
    expect(await f.pool.runSidePrompt('web:default','Isolated side request',{requestId:options.requestId,systemPrompt:options.systemPrompt})).toEqual(result);expect(state.calls).toBe(1);
    for(const changed of [{prompt:'Changed body',system:options.systemPrompt},{prompt:'Isolated side request',system:'Changed prefix'}])expect((await f.pool.runSidePrompt('web:default',changed.prompt,{requestId:options.requestId,systemPrompt:changed.system})).status).toBe('error');
    expect(state.calls).toBe(1);const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all();await f.reopen();
    expect(await f.pool.runSidePrompt('web:default','Isolated side request',{requestId:options.requestId,systemPrompt:options.systemPrompt})).toEqual(result);expect(state.calls).toBe(1);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);
  }finally{await s.close();}
},30000);

applicationTest('actual factory optional side observers cannot mutate original provider output or usage, reject privately, or lose their owner fence after detachment',async()=>{
  const create=hostModels.createHostModels,observers:hostModels.HostModelEventObserver[]=[];
  const capture=spyOn(hostModels,'createHostModels').mockImplementation((host,approved,policy)=>create(host,approved,{...policy,captureEventObserver(signal){const observer=policy.captureEventObserver?.(signal);if(observer)observers.push(observer);return observer;}}));
  const s=await sideFixture(),{f,state}=s;
  try{
    const parent=s.history(),financial=s.financial();const deltas:string[]=[];
    const mutated=await f.pool.runSidePrompt('web:default','Mutating observer',{onEvent(event:any){if(event.type==='done'){event.message.content=[];event.message.usage.totalTokens=999;event.message.usage.cost.total=999;}if(event.type==='text_delta')event.delta='MUTATED';},onTextDelta:delta=>{deltas.push(delta);}});
    expect(mutated).toMatchObject({status:'success',result:'Native isolated side reply',usage:{totalTokens:2,cost:{total:0}}});expect(deltas.join('')).toBe('Native isolated side reply');
    for(const kind of ['sync-event','async-event','async-text'] as const){let calls=0;const fail=()=>{calls++;throw Error('PRIVATE_SIDE_OBSERVER_FAILURE');};const asyncFail=async()=>fail();const reply=await f.pool.runSidePrompt('web:default',kind,kind==='sync-event'?{onEvent:fail}:kind==='async-event'?{onEvent:asyncFail}:{onTextDelta:asyncFail});await Bun.sleep(0);expect(reply).toMatchObject({status:'success',result:'Native isolated side reply',usage:{totalTokens:2}});expect(calls).toBe(1);}
    expect(state.calls).toBe(4);expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);expect(observers.length).toBeGreaterThan(0);
    const failure=Error('Current side owner revoked');const owner=spyOn(f.owner,'assertCurrentOwner').mockImplementation(()=>{throw failure;});try{expect(()=>observers.at(-1)!.assertCurrent()).toThrow(failure.message);}finally{owner.mockRestore();}
  }finally{capture.mockRestore();await s.close();}
},30000);

for(const entry of ['pool','backend'] as const)applicationTest(`actual side ${entry} cannot acquire single-user authority from a family-scoped invocation`,async()=>{
  const {withExecutionIdentity}=await import('../../runtime/src/core/execution-context.js');const s=await sideFixture(),{f,state}=s;
  try{
    const before=f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY chat_jid,source_seq').all(),sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all();
    if(entry==='pool')expect(await withExecutionIdentity({mode:'family-shared'} as never,()=>f.pool.runSidePrompt('web:default','Family-scoped side effect'))).toMatchObject({status:'error'});
    else await expect(withExecutionIdentity({mode:'family-shared'} as never,()=>f.backend.sessionOptions.dispatchSidePrompt!('web:default','Family-scoped direct side effect',{}))).rejects.toThrow();
    expect(state.calls).toBe(0);expect(f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY chat_jid,source_seq').all()).toEqual(before);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);
  }finally{await s.close();}
},30000);

applicationTest('actual side cancellation joins its owned provider, preserves parent history and cannot replay the cancelled request ID',async()=>{
  const s=await sideFixture(),{f,state}=s;const aborter=new AbortController();
  try{
    const parent=s.history(),financial=s.financial();
    const pending=f.pool.runSidePrompt('web:default','HELD_SIDE cancellation',{requestId:'cancel-owned-side',signal:aborter.signal});await state.entered.promise;
    aborter.abort();expect(await pending).toMatchObject({status:'error',stopReason:'aborted',error:'Side prompt cancelled'});expect(state.signals.at(-1)?.aborted).toBe(true);expect(state.calls).toBe(1);
    expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);expect(f.root.query("SELECT * FROM service_effect_s01_sources WHERE kind='internal' AND state NOT IN ('consumed','disposed')").all()).toEqual([]);
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all();await f.reopen();
    expect(await f.pool.runSidePrompt('web:default','HELD_SIDE cancellation',{requestId:'cancel-owned-side'})).toMatchObject({status:'error',stopReason:'aborted'});expect(state.calls).toBe(1);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);
    expect((await f.pool.runSidePrompt('web:default','New independent side after cancellation')).status).toBe('success');expect(state.calls).toBe(2);expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);
  }finally{aborter.abort();await s.close();}
},30000);

for(const disconnect of [false,true])applicationTest(`actual side HTTP stream retains native text/source isolation and joins disconnect cancellation: disconnect=${disconnect}`,async()=>{
  const s=await sideFixture(),{f,state}=s,aborter=new AbortController();
  try{
    const parent=s.history(),timeline=f.root.query('SELECT * FROM messages ORDER BY rowid').all(),financial=s.financial();
    const response=await f.channel.handleRequest(new Request('https://fixture/agent/side-prompt/stream?chat_jid=web%3Adefault',{method:'POST',headers:{'content-type':'application/json',origin:'https://fixture'},signal:aborter.signal,body:JSON.stringify({prompt:disconnect?'HELD_SIDE HTTP disconnect':'HTTP side stream'})}));
    expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('text/event-stream');const body=response.text();
    if(disconnect){await state.entered.promise;aborter.abort();expect(await body).toContain('event: side_prompt_start');await f.until(()=>state.signals.at(-1)?.aborted===true);await f.until(()=>f.root.query("SELECT 1 FROM service_effect_s01_sources WHERE kind='internal' AND state NOT IN ('consumed','disposed')").get()===null);}
    else{const events=await body;expect(events).toContain('event: side_prompt_start');expect(events).toContain('event: side_prompt_text_delta\ndata: {"delta":"Native isolated side reply"}');expect(events).toContain('event: side_prompt_done');expect(events).not.toContain('event: side_prompt_error');}
    expect(state.calls).toBe(1);expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);expect(f.root.query('SELECT * FROM messages ORDER BY rowid').all()).toEqual(timeline);
  }finally{aborter.abort();await s.close();}
},30000);

applicationTest('actual side configured timeout cancels only its admitted SDK input and preserves truthful aborted outcome',async()=>{
  const s=await sideFixture(),{f,state}=s;
  const {getAgentRuntimeConfig}=await import('../../runtime/src/core/config.js');const timeout=getAgentRuntimeConfig().timeoutMs,original=setTimeout;let expire:(()=>void)|undefined;
  const timer=spyOn(globalThis,'setTimeout').mockImplementation(((callback:()=>void,ms?:number,...args:unknown[])=>{if(ms===timeout){expire=callback;return original(()=>{},timeout);}return original(callback,ms,...args);}) as typeof setTimeout);
  try{
    const parent=s.history(),financial=s.financial();const pending=f.pool.runSidePrompt('web:default','HELD_SIDE configured deadline');await state.entered.promise;await f.until(()=>expire!==undefined);expire!();
    expect(await pending).toMatchObject({status:'error',stopReason:'aborted'});expect(state.signals.at(-1)?.aborted).toBe(true);expect(state.calls).toBe(1);expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);
    expect(f.root.query("SELECT * FROM service_effect_s01_sources WHERE kind='internal' AND state NOT IN ('consumed','disposed')").all()).toEqual([]);
  }finally{timer.mockRestore();await s.close();}
},30000);

applicationTest('actual side SDK tool uses its isolated source and leaves the parent head and entries unchanged',async()=>{
  const s=await sideFixture(),{f,state}=s;
  try{
    const parent=s.history(),financial=s.financial(),position=await f.backend.sessionOptions.getDurableSession!('web:default')!.readPosition();
    state.toolPath=join(process.env.PICLAW_WORKSPACE!,'native-side-tool.txt');writeFileSync(state.toolPath,'NATIVE_SIDE_TOOL_SOURCE');
    const result=await f.pool.runSidePrompt('web:default','USE_SIDE_TOOL read the selected fixture file',{requestId:'owned-side-tool'});
    expect(result).toMatchObject({status:'success',result:'Native isolated side reply'});expect(state.calls).toBe(2);expect(JSON.stringify(state.contexts.at(-1))).toContain('NATIVE_SIDE_TOOL_SOURCE');
    expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);expect(await f.backend.sessionOptions.getDurableSession!('web:default')!.readPosition()).toBe(position);
    const tools=f.root.query("SELECT record FROM tasks WHERE kind=json_quote('pi.tool')").all() as {record:string}[];expect(tools).toHaveLength(1);const tool=JSON.parse(tools[0]!.record);expect(tool.conversationId).not.toBe(s.parent);expect(tool.state).toMatchObject({status:'terminal',outcome:{status:'completed'}});
  }finally{await s.close();}
},30000);

for(const revoked of ['model','access-mode'] as const)applicationTest(`actual side ${revoked} authority is rechecked after credential await before any provider effect`,async()=>{
  const s=await sideFixture(),{f,state}=s,entered=barrier(),held=barrier();let revoke:ReturnType<typeof spyOn>|undefined;
  const path=getConfigPath(),previous=existsSync(path)?readFileSync(path,'utf8'):undefined;
  try{
    const parent=s.history(),financial=s.financial();state.authGate=async()=>{entered.release();await held.promise;};
    const pending=f.pool.runSidePrompt('web:default','Revoke physical model while authentication waits');await entered.promise;
    if(revoked==='model')revoke=spyOn(f.modelRuntime,'getPhysicalModel').mockReturnValue(undefined);
    else{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify({domains:{access:{mode:'family-shared'}}}));}
    held.release();expect((await pending).status).toBe('error');expect(state.calls).toBe(0);
    expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);
  }finally{held.release();revoke?.mockRestore();if(previous===undefined)rmSync(path,{force:true});else writeFileSync(path,previous);await s.close();}
},30000);

applicationTest('actual completed private side fork reopens without replay but forged source/request provenance refuses before provider work',async()=>{
  const s=await sideFixture(),{f,state}=s;
  try{
    expect((await f.pool.runSidePrompt('web:default','Exact side routing provenance',{requestId:'side-route-proof'})).status).toBe('success');expect(state.calls).toBe(1);
    const row=f.root.query("SELECT conversation_id,source_id,request_id FROM piclaw_durable_bindings_v1 WHERE source_id LIKE 'side-prompt:%'").get() as {conversation_id:number;source_id:string;request_id:string};expect(row.conversation_id).not.toBe(s.parent);
    await f.reopen();expect(state.calls).toBe(1);await f.backend.close();
    f.root.query('UPDATE piclaw_durable_bindings_v1 SET request_id=? WHERE source_id=?').run('forged-private-side-request',row.source_id);
    await expect(f.reopen()).rejects.toThrow('Invalid durable application routing provenance');expect(state.calls).toBe(1);
    f.root.query('UPDATE piclaw_durable_bindings_v1 SET request_id=? WHERE source_id=?').run(row.request_id,row.source_id);
  }finally{await s.close();}
},30000);

applicationTest('actual side automatic compaction stays in the exact private SDK fork and preserves the parent and stable request result without finance',async()=>{
  let enabled=false;const open=Harness.open;const settings=spyOn(Harness,'open').mockImplementation((storage,options,ctx)=>open.call(Harness,storage,{...options,settings:()=>{
    const current=typeof options.settings==='function'?options.settings():options.settings;return {...current,compaction:{...current?.compaction,enabled,keepRecentTokens:1,reserveTokens:99999,backgroundTokens:0}};
  }},ctx));
  const s=await sideFixture(),{f,state}=s;
  try{
    await f.backend.close();const path=(f.root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
    const forbidden=async():Promise<never>=>{throw Error('Paused history seeding cannot execute a provider or read credentials');};
    const harness=await Harness.open(await SqliteStorage.open(new BunSqliteDatabase(path,{root:f.root,assertOwner:()=>f.owner.assertCurrentOwner(),fenceTransactions:true})),{models:createModels({authContext:{env:forbidden,fileExists:forbidden}}),registry:createRegistry()},sdkContext);
    try{expect((await harness.inspect(sdkContext)).scheduling).toBe('paused');const parent=(await harness.conversation(s.parent as any,sdkContext))!;await parent.commit(async tx=>{for(let index=0;index<6;index++)await tx.appendEntry(parent.id,{kind:'pi.user',model:[{role:'user',content:`Historical side fact ${index}: `+'Preserve the accepted decision. '.repeat(100),timestamp:index}]});},sdkContext);}finally{await harness.close(sdkContext);}
    await f.reopen();const parent=s.history(),financial=s.financial();enabled=true;
    const result=await f.pool.runSidePrompt('web:default','Side request with native automatic compaction',{requestId:'private-auto-summary',systemPrompt:'SIDE_SYSTEM_PREFIX'});expect(result).toMatchObject({status:'success',result:'Native isolated side reply'});expect(state.calls).toBe(2);expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);
    const side=f.root.query("SELECT conversation_id FROM piclaw_durable_bindings_v1 WHERE source_id LIKE 'side-prompt:%'").get() as {conversation_id:number};expect(side.conversation_id).not.toBe(s.parent);
    const tasks=f.root.query("SELECT record FROM tasks WHERE kind=json_quote('pi.compaction')").all() as {record:string}[];expect(tasks).toHaveLength(1);const task=JSON.parse(tasks[0]!.record);expect(task).toMatchObject({conversationId:side.conversation_id,input:{reason:'threshold'},background:false,state:{status:'terminal',outcome:{status:'completed'}}});expect(task.owner).toBeGreaterThan(0);
    const generation=JSON.parse((f.root.query('SELECT record FROM tasks WHERE id=?').get(task.owner) as {record:string}).record);expect(generation).toMatchObject({kind:'pi.generation',conversationId:side.conversation_id,state:{status:'terminal',outcome:{status:'completed'}}});
    expect(await f.pool.runSidePrompt('web:default','Side request with native automatic compaction',{requestId:'private-auto-summary',systemPrompt:'SIDE_SYSTEM_PREFIX'})).toEqual(result);expect(state.calls).toBe(2);enabled=false;
    const sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all(),entries=f.root.query('SELECT * FROM entries ORDER BY id').all();await f.reopen();expect(await f.pool.runSidePrompt('web:default','Side request with native automatic compaction',{requestId:'private-auto-summary',systemPrompt:'SIDE_SYSTEM_PREFIX'})).toEqual(result);expect(state.calls).toBe(2);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(s.history()).toEqual(parent);expect(s.financial()).toEqual(financial);
  }finally{settings.mockRestore();await s.close();}
},30000);

for(const providerCost of [0,0.2])applicationTest(`actual factory passive metadata preserves provider cost ${providerCost}, catalogue valuation, reasoning and cache reporting without finance`,async()=>{
  const s=await sideFixture(),{f,state}=s;
  try{
    const financial=s.financial();state.usage={input:10,output:2,cacheRead:0,cacheWrite:0,totalTokens:12,providerCost,reasoningTokens:1,cacheReadReported:true,cost:{input:0.00004,output:0,cacheRead:0,cacheWrite:0,total:0.00004}};
    expect((await f.pool.runSidePrompt('web:default','Observe original provider metadata',{requestId:`side-metadata-${providerCost}`})).status).toBe('success');
    const report=()=>f.root.query('SELECT provider_cost_total,catalogue_cost_total,cost_total,cost_provenance,reasoning_tokens,cache_read_reported FROM token_usage WHERE input_tokens=10').all();
    await f.until(()=>report().length===1);expect(report()).toEqual([{provider_cost_total:providerCost,catalogue_cost_total:0.00004,cost_total:providerCost,cost_provenance:'provider_reported',reasoning_tokens:1,cache_read_reported:1}]);expect(s.financial()).toEqual(financial);
    const before=f.root.query('SELECT * FROM token_usage ORDER BY id').all(),sdk=f.root.query('SELECT * FROM submissions ORDER BY id').all();await f.reopen();expect(state.calls).toBe(1);expect(f.root.query('SELECT * FROM token_usage ORDER BY id').all()).toEqual(before);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(sdk);expect(s.financial()).toEqual(financial);
  }finally{await s.close();}
},30000);
