import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {createProvider,createAssistantMessageEventStream,type AssistantMessage,type TranscriptContext} from '../../runtime/durable-engine/qualification/ai.ts';
import {awaitWithContext,withAbortSignal} from '../../runtime/durable-engine/qualification/context.ts';
import {nativeMessageFixture} from './src/native-message-fixture.ts';
import {barrier,context} from './src/fixture.ts';

for(const finalLevel of ['off','max'] as const)test(`busy native model/thinking choices persist without stopping, replaying or rewriting accepted SDK work: ${finalLevel}`,async()=>{
  const f=await nativeMessageFixture(),entered=barrier(),release=barrier();
  const requests:{model:string;thinking:unknown}[]=[];
  const original=f.base.models.getModel('qualification','synthetic')!;
  const thinkingLevelMap={off:'off',minimal:null,low:null,medium:'medium',high:'high',xhigh:'xhigh',max:'max'};
  const models=[{...original,reasoning:true,thinkingLevelMap},{...original,id:'alternate',name:'Alternate',reasoning:true,thinkingLevelMap}];
  const stream=(model:typeof original,_input:TranscriptContext,options?:{signal?:AbortSignal;reasoning?:unknown})=>{
    requests.push({model:model.id,thinking:options?.reasoning});const hold=requests.length===2,output=createAssistantMessageEventStream();
    let message:AssistantMessage={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),stopReason:'stop',content:[{type:'text',text:'OWNED_ANSWER'}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    void(async()=>{try{if(hold){entered.release();await awaitWithContext(release.promise,options?.signal?withAbortSignal(options.signal,context):context);}options?.signal?.throwIfAborted();output.push({type:'done',reason:'stop',message});output.end(message);}catch(error){message={...message,content:[],stopReason:'aborted',errorMessage:String(error)};output.push({type:'error',reason:'aborted',error:message});output.end(message);}})();return output;
  };
  f.base.models.setProvider(createProvider({id:original.provider,models,auth:{apiKey:{name:'synthetic',resolve:async()=>({auth:{},source:'fixture'})}},api:{stream,streamSimple:stream}}));
  try{
    await f.open();
    const completed=f.accept('first independently accepted input'),firstId=await f.runtime.submitMessage(completed);expect((await f.runtime.waitForMessage(completed,firstId)).status).toBe('done');
    const current=f.accept('second independently accepted input'),id=await f.runtime.submitMessage(current);await entered.promise;
    const before=f.sdkSnapshot(),sourceRows=f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all(),oldRequest={...requests[1]};
    await f.runtime.setSessionModel(f.binding,{provider:'qualification',modelId:'alternate'});
    const runtime=f.runtime as unknown as {projectContext:(...args:any[])=>Promise<any>},measure=runtime.projectContext;
    runtime.projectContext=async()=>[{role:'user',content:'x'.repeat(original.contextWindow*7),timestamp:Date.now()}];
    try{
      // Same-model choices do not perform a new candidate render/fit while an
      // admitted request is running. Genuinely different choices still must.
      await f.runtime.setSessionModel(f.binding,{provider:'qualification',modelId:'alternate'});
      await f.runtime.setSessionThinkingLevel(f.binding,'high');
      expect(await f.runtime.readSessionModel(f.binding)).toBe('qualification/alternate');expect(await f.runtime.readSessionThinkingLevel(f.binding)).toBe('high');
      await expect(f.runtime.setSessionThinkingLevel(f.binding,'minimal')).rejects.toThrow('Unsupported thinking');expect(await f.runtime.readSessionThinkingLevel(f.binding)).toBe('high');
      for(const level of ['xhigh','max']){await f.runtime.setSessionThinkingLevel(f.binding,level);expect(await f.runtime.readSessionThinkingLevel(f.binding)).toBe(level);}
      await f.runtime.setSessionThinkingLevel(f.binding,finalLevel);expect(await f.runtime.readSessionThinkingLevel(f.binding)).toBe(finalLevel);
      await expect(f.runtime.setSessionModel(f.binding,{provider:'qualification',modelId:'synthetic'})).rejects.toThrow('compact first');
    }finally{runtime.projectContext=measure;}
    expect(await f.runtime.readSessionModel(f.binding)).toBe('qualification/alternate');expect(requests).toHaveLength(2);expect(requests[1]).toEqual(oldRequest);expect(oldRequest.model).toBe('synthetic');
    expect(f.sdkSnapshot()).toEqual(before);expect(f.root.query('SELECT * FROM service_effect_s01_sources ORDER BY source_seq').all()).toEqual(sourceRows);
    expect((await f.runtime.inspectAuthority()).inspection.tasks.length).toBeGreaterThan(0);
    await expect(f.runtime.setSessionModel({...f.binding,incarnation:'stale'},{provider:'qualification',modelId:'alternate'})).rejects.toThrow('binding conflict');
    await expect(f.runtime.setSessionThinkingLevel(f.binding,'nonsense')).rejects.toThrow('Unsupported thinking');
    release.release();expect((await f.runtime.waitForMessage(current,id)).status).toBe('done');
    await f.reopen();expect(requests).toHaveLength(2);expect(await f.runtime.readSessionThinkingLevel(f.binding)).toBe(finalLevel);
    const next=f.accept('next independently accepted request'),nextId=await f.runtime.submitMessage(next);expect((await f.runtime.waitForMessage(next,nextId)).status).toBe('done');
    expect(requests).toHaveLength(3);expect(requests[2]).toEqual({model:'alternate',thinking:finalLevel==='off'?undefined:finalLevel});
    expect(f.root.query('SELECT count(*) n FROM messages WHERE is_bot_message=0').get()).toEqual({n:3});
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
  }finally{release.release();await f.close();}
},10000);
