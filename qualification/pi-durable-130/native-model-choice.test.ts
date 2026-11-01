import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createProvider, createAssistantMessageEventStream, type AssistantMessage, type TranscriptContext } from "../../runtime/durable-engine/qualification/ai.ts";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { OwnedSqlite } from "./src/ownership.ts";
import { Harness } from "../../runtime/durable-engine/qualification/durable.ts";
import { awaitWithContext, withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import { acceptedSteerFixture } from "./src/accepted-steer-recovery-fixture.ts";
import { barrier, context } from "./src/fixture.ts";

for(const finalLevel of ['off','max'] as const) test("busy native model/thinking choices persist for next request without stopping, replaying or rewriting accepted work"+(finalLevel==='off'?'':' [extended max]'), async () => {
  const dir=await mkdtemp(join(process.env.PICLAW_WORKSPACE!,"model-choice-"));
  const f=await acceptedSteerFixture(dir,"committed-ack-lost");
  const entered=barrier(),release=barrier();
  const requests:{model:string;thinking:unknown}[]=[];
  const original=f.base.models.getModel('qualification','synthetic')!;
  const thinkingLevelMap={off:'off',minimal:null,low:null,medium:'medium',high:'high',xhigh:'xhigh',max:'max'};
  const models=[{...original,reasoning:true,thinkingLevelMap},{...original,id:'alternate',name:'Alternate',reasoning:true,thinkingLevelMap}];
  const stream=(model:typeof original,_input:TranscriptContext,options?:{signal?:AbortSignal;reasoning?:unknown})=>{
    requests.push({model:model.id,thinking:options?.reasoning});const hold=requests.length===2;
    const output=createAssistantMessageEventStream();
    let message:AssistantMessage={role:'assistant',api:model.api,provider:model.provider,model:model.id,
      timestamp:Date.now(),stopReason:'stop',content:[{type:'text',text:'OWNED_ANSWER'}],usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    void(async()=>{try{if(hold){entered.release();await awaitWithContext(release.promise,options?.signal?withAbortSignal(options.signal,context):context);}
      options?.signal?.throwIfAborted();output.push({type:'done',reason:'stop',message});output.end(message);
    }catch(error){message={...message,content:[],stopReason:'aborted',errorMessage:String(error)};output.push({type:'error',reason:'aborted',error:message});output.end(message);}})();return output;
  };
  f.base.models.setProvider(createProvider({id:original.provider,models,auth:{apiKey:{name:'synthetic',resolve:async()=>({auth:{},source:'fixture'})}},api:{stream,streamSimple:stream}}));
  let raw:Harness|undefined;
  try{
    const prepared=await f.prepare();await entered.promise;
    const binding={incarnation:f.incarnation,chatJid:f.chatJid,branchId:'main',conversationId:f.base.root.id};
    const before=f.snapshot();const oldRequest={...requests[1]};
    await f.runtime!.setSessionModel(binding,{provider:'qualification',modelId:'alternate'});
    const runtime=f.runtime! as any, measure=runtime.projectContext;
    runtime.projectContext=async()=>[{role:"user", content:"x".repeat(original.contextWindow*7), timestamp:Date.now()}];
    // Existing requests already fit. Same-model choices must not run a new
    // candidate fit/render; genuinely different models still must.
    await f.runtime!.setSessionModel(binding,{provider:'qualification',modelId:'alternate'});
    await f.runtime!.setSessionThinkingLevel(binding,'high');
    expect(await f.runtime!.readSessionModel(binding)).toBe('qualification/alternate');
    expect(await f.runtime!.readSessionThinkingLevel(binding)).toBe('high');
    await expect(f.runtime!.setSessionThinkingLevel(binding,'minimal')).rejects.toThrow('Unsupported thinking');
    expect(await f.runtime!.readSessionThinkingLevel(binding)).toBe('high');
    for(const level of ['xhigh','max']){
      await f.runtime!.setSessionThinkingLevel(binding,level);
      expect(await f.runtime!.readSessionThinkingLevel(binding)).toBe(level);
    }
    await f.runtime!.setSessionThinkingLevel(binding,finalLevel);
    expect(await f.runtime!.readSessionThinkingLevel(binding)).toBe(finalLevel);
    await expect(f.runtime!.setSessionModel(binding,{provider:'qualification',modelId:'synthetic'})).rejects.toThrow('compact first');
    expect(await f.runtime!.readSessionModel(binding)).toBe('qualification/alternate');
    runtime.projectContext=measure;
    expect(requests).toHaveLength(2);expect(requests[1]).toEqual(oldRequest);expect(requests[1]!.model).toBe('synthetic');
    expect(f.snapshot()).toEqual(before);
    expect((await f.runtime!.inspectAuthority()).inspection.tasks.length).toBeGreaterThan(0);
    await expect(f.runtime!.setSessionModel({...binding,incarnation:'stale'},{provider:'qualification',modelId:'alternate'})).rejects.toThrow('binding conflict');
    await expect(f.runtime!.setSessionThinkingLevel(binding,'nonsense')).rejects.toThrow('Unsupported thinking');
    release.release();
    for(let i=0;i<300;i++){if(!(await f.runtime!.inspectAuthority()).inspection.tasks.length)break;await Bun.sleep(5);}
    expect((await f.runtime!.inspectAuthority()).inspection.tasks).toHaveLength(0);
    await f.runtime!.close();
    raw=await Harness.open(await SqliteStorage.open(new OwnedSqlite(f.owner)),{models:f.base.models,registry:f.base.registry,settings:{retry:{enabled:false},compaction:{enabled:false}}},context);
    const conversation=(await raw.conversation(binding.conversationId,context))!;
    expect((await conversation.agent(context)).thinkingLevel).toBe(finalLevel);
    const follow=await conversation.submit({type:'input',content:'next request',requestId:'after-choice'},context);
    expect((await follow.wait(context)).status).toBe('done');
    expect(requests).toHaveLength(3);expect(requests[2]!.model).toBe('alternate');expect(requests[2]!.thinking).toBe(finalLevel==='off'?undefined:finalLevel);
    const rows=(await conversation.entries({},100,undefined,context)).items;
    expect(rows.flatMap(e=>e.model??[]).filter(m=>m.role==='user')).toHaveLength(3);
  }finally{release.release();await raw?.close(context);await f.close();await rm(dir,{recursive:true,force:true});}
},10000);
