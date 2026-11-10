import "./src/test-guard.js";
import { expect, test } from "bun:test";
import { Type, createProvider, createAssistantMessageEventStream, type AssistantMessage, type TranscriptContext } from "../../runtime/durable-engine/qualification/ai.ts";
import { defineExtension, defineTool } from "../../runtime/durable-engine/qualification/durable.ts";
import { awaitWithContext, withAbortSignal } from "../../runtime/durable-engine/qualification/context.ts";
import { createHostDelegateTool } from "../../runtime/durable-engine/src/host-delegate-tool.ts";
import { readNativeDelegateProgress } from "../../runtime/src/agent-pool/delegate-progress.ts";
import { barrier, context, openFixture } from "./src/fixture.ts";

test("actual native children publish independent tool/generation/completion details through public SDK watches", async () => {
  const f = await openFixture({ acquired: true });
  const toolEntered = barrier(), modelEntered = barrier(), releaseTool = barrier(), releaseModel = barrier();
  let watch: Awaited<ReturnType<typeof f.root.watch>> | undefined;
  let latest: any;
  const frames: any[] = [];
  const read = defineTool({ name: "read", description: "Synthetic reader", parameters: Type.Object({}), async execute() {
    toolEntered.release(); await releaseTool.promise; return { output: [{type:"text",text:"PRIVATE_READER_OUTPUT"}] };
  } });
  const readers = defineExtension({name:"progress-readers",tools:[read]}); f.registry.install(readers);
  const delegate = createHostDelegateTool({name:"delegate",description:"Synthetic declaration",parameters:Type.Object({prompt:Type.String()})}, {
    assertCurrent() {}, runtime:()=>({ async captureToolSource(){return {inputs:[]} as never;},async watchOwnedDelegateChild(_p,_t,_c,id,ctx){return (await f.harness.conversation(id,ctx))!.watch(ctx);},assertCapturedSourceCurrent(){} }),
    async selectModel(_args,parent){return parent!;},assertModelCurrent(){},readonlyTools:[read],readonlyExtensions:[readers],
  });
  const extension=defineExtension({name:"progress-delegate",tools:[delegate]}); f.registry.install(extension);
  await f.root.configure({extensions:[extension],tools:[delegate]},context);
  const model=f.models.getModel("qualification","synthetic")!;
  let children=0;
  const stream=(_model:unknown,input:TranscriptContext,options?:{signal?:AbortSignal})=>{
    const user=JSON.stringify(input.messages.findLast(m=>m.role==='user')?.content);
    const childA=user.includes('CHILD_A'),childB=user.includes('CHILD_B');
    const result=input.messages.some(m=>m.role==='toolResult');
    const calling=(!childA&&!childB&&!result)||(childA&&!result);
    const content:AssistantMessage['content']=calling ? childA ? [{type:'toolCall',id:'reader',name:'read',arguments:{}}]
      : ['A','B'].map(id=>({type:'toolCall',id,name:'delegate',arguments:{prompt:`CHILD_${id}`}}))
      : [{type:'thinking',thinking:'PRIVATE_REASONING'},{type:'text',text:childA?'CHILD_A_ANSWER':childB?'CHILD_B_ANSWER':'PARENT_DONE'}];
    const message:AssistantMessage={role:'assistant',api:model.api,provider:model.provider,model:model.id,content,
      stopReason:calling?'toolUse':'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
    const output=createAssistantMessageEventStream();
    if((childA&&!result)||childB)children++;
    void(async()=>{
      try {
        if(childB){modelEntered.release();await awaitWithContext(releaseModel.promise,options?.signal?withAbortSignal(options.signal,context):context);}
        options?.signal?.throwIfAborted();output.push({type:'done',reason:calling?'toolUse':'stop',message});output.end(message);
      }catch(error){const aborted={...message,content:[],stopReason:'aborted' as const,errorMessage:String(error)};output.push({type:'error',reason:'aborted',error:aborted});output.end(aborted);}
    })();return output;
  };
  f.models.setProvider(createProvider({id:model.provider,models:[model],auth:{apiKey:{name:'keyless',resolve:async()=>({auth:{},source:'fixture'})}},api:{stream,streamSimple:stream}}));
  async function until(predicate:()=>boolean){for(let i=0;i<300;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}throw Error('progress frame not observed '+JSON.stringify(latest?.docs['pi.live']));}
  const details=()=> (latest?.docs['pi.live']?.tools??[]).flatMap((s:any)=>{
    const result=latest?.entries.flatMap((e:any)=>e.model??[]).find((m:any)=>m.role==='toolResult'&&m.toolCallId===s.callId);
    const p=readNativeDelegateProgress(s.details??result?.details);return p?[{id:s.callId,status:s.status,...p}]:[];
  });
  try{
    watch=await f.root.watch(context);latest=watch.value;watch.start(async call=>{if(call.kind==='failed')throw call.error;latest=call.value;frames.push(details());});
    const submission=await f.root.submit({type:'input',content:'ROOT_PRIVATE',requestId:'progress-parent'},context);
    await Promise.all([toolEntered.promise,modelEntered.promise]);
    await until(()=>details().some((p:any)=>p.id==='A'&&p.phase==='tool')&&details().some((p:any)=>p.id==='B'&&p.phase==='generating'));
    expect(children).toBe(2);expect(new Set(details().map((p:any)=>p.conversationId)).size).toBe(2);
    expect(details().find((p:any)=>p.id==='A').tools).toEqual(['read']);
    expect((await submission.status(context)).status).toBe('placed');
    releaseTool.release();
    await until(()=>details().some((p:any)=>p.id==='A'&&p.phase==='done')&&details().some((p:any)=>p.id==='B'&&p.status!=='done'));
    expect((await submission.status(context)).status).toBe('placed');
    releaseModel.release();expect((await submission.wait(context)).status).toBe('done');
    const results=(await f.root.entries({},100,undefined,context)).items.flatMap(e=>e.model??[]).filter(m=>m.role==='toolResult');
    expect(results).toHaveLength(2);
    expect(results.every(m=>readNativeDelegateProgress(m.details)?.phase==='done')).toBe(true);
    expect(JSON.stringify(frames)).not.toContain('PRIVATE');expect(JSON.stringify(frames)).not.toContain('ANSWER');
    expect((await f.harness.inspect(context)).tasks).toHaveLength(0);
  }finally{releaseTool.release();releaseModel.release();await watch?.stop();await f.close();}
},10000);
