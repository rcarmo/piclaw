import { expect } from "bun:test";
import { mkdtemp,rm } from "node:fs/promises";
import { join } from "node:path";
import { TestOwner,OwnedSqlite } from "./src/ownership.js";
import { SqliteStorage } from "../../runtime/durable-engine/qualification/sqlite.ts";
import { configure,defineExtension,type ToolHooks } from "../../runtime/durable-engine/qualification/durable.ts";
import { createProvider } from "../../runtime/durable-engine/qualification/ai.ts";
import { AssistantMessageEventStream } from "../../runtime/durable-engine/qualification/event-stream.ts";
import { bindNativeBackgroundPolicy,assertNativeBackgroundExecution,claimNativeBackgroundTool,NativeBackgroundPolicyDoc } from "../../runtime/durable-engine/src/host-background-policy.js";
import { createNativeBackgroundPayload,nativeBackgroundPolicyHash,assertNativeBackgroundModel } from "../../runtime/src/agent-pool/background-operation-contract.js";
import { openFixture,context } from "./src/fixture.js";

/** Public-SDK quota/configuration component qualification only. This synthetic
 * host callback is NOT production grant/S01 admission or a native AgentPool. */
export async function backgroundPolicyFixture(mode:"allowed"|"limit"|"ceiling"|"forged-call"|"revoked"|"expired"|"configuration"|"parallel"|"reused-call-id"|"api-change"|"long-call"){
  const f=await openFixture({acquired:true});let permitted=true,now=Date.parse('2026-10-26T15:20:00.000Z');
  const payload=createNativeBackgroundPayload({origin:{kind:'dream',invocationId:'policy-fixture',chatJid:'web:qualification-policy',mode:'manual'},
    workId:'fixture:work',parentWorkId:null,model:{provider:'qualification',modelId:'synthetic',api:mode==='api-change'?'different-api':'openai-completions'},allowedTools:['host_effect'],maxToolCalls:mode==='limit'?0:mode==='reused-call-id'?2:1,
    acceptedAt:new Date(now).toISOString(),expiresAt:new Date(now+60_000).toISOString(),prompt:'use-tool',instructions:'Background quota fixture'});
  const policy=payload.policy,check=()=>{if(!permitted)throw Error('Synthetic background grant revoked');};
  let attempts=0;
  if(mode==='parallel'||mode==='reused-call-id'||mode==='long-call'){
    const model=f.models.getModel('qualification','synthetic')!;
    const stream=(_model:unknown,input:{messages:readonly {role:string}[]})=>{
      attempts++;const output=new AssistantMessageEventStream(),tools=mode==='reused-call-id'?attempts<=2:input.messages.findLast(message=>message.role!=='system')?.role==='user';
      const message={role:'assistant' as const,api:model.api,provider:model.provider,model:model.id,timestamp:1,
        content:tools?(mode==='reused-call-id'||mode==='long-call'?[{type:'toolCall' as const,id:mode==='long-call'?'x'.repeat(2049):'reused',name:'host_effect',arguments:{value:'fixture'}}]:[{type:'toolCall' as const,id:'parallel-1',name:'host_effect',arguments:{value:'first'}},{type:'toolCall' as const,id:'parallel-2',name:'host_effect',arguments:{value:'second'}}]):[{type:'text' as const,text:'synthetic answer'}],
        stopReason:tools?'toolUse' as const:'stop' as const,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      output.push({type:'done',reason:message.stopReason,message});output.end();return output;
    };
    f.models.setProvider(createProvider({id:model.provider,models:[model],auth:{apiKey:{name:'Synthetic keyless',resolve:async()=>({auth:{},source:'synthetic'})}},api:{stream,streamSimple:stream}}));
  }
  // A thrown generation hook is diagnostic-only in this SDK; it is NOT an
  // admission fence. Use the public model port here. This fixture's awaited
  // header transform is not production's atomic post-auth effect proof.
  const originalStream=f.models.streamSimple.bind(f.models);
  f.models.streamSimple=(model,input,options)=>{
    assertNativeBackgroundModel(policy,model);
    return originalStream(model,input,{...options,transformHeaders:async headers=>{
      await f.harness.commit(tx=>assertNativeBackgroundExecution(tx,f.root.id,policy,now,check),context);return headers;
    }});
  };
  const extension=defineExtension({name:'qualification-background-policy',hooks:[
    {task:'pi.tool',handlers:{beforeTool:async(call:Parameters<ToolHooks['beforeTool']>[0],api:Parameters<ToolHooks['beforeTool']>[1])=>{
      if(mode==='configuration')await f.root.commit(tx=>configure(tx,f.root.id,{instructions:'changed after request'}),context);
      const actual={taskId:api.taskId,callId:mode==='forged-call'?call.id+':foreign':call.id,toolName:mode==='ceiling'?'forbidden':call.name};
      await f.harness.commit(tx=>claimNativeBackgroundTool(tx,f.root.id,policy,actual,now,check),context);
      // A lost hook ACK/re-entry claims the SAME public task in a fresh commit.
      if(mode==='allowed')await f.harness.commit(tx=>claimNativeBackgroundTool(tx,f.root.id,policy,actual,now,check),context);
    }}},
  ]});
  f.registry.install(extension);
  try{
    await f.root.commit(async tx=>{
      await configure(tx,f.root.id,{extensions:[f.registry.snapshot().extension('qualification')!,extension],tools:[f.registry.snapshot().tools().find(row=>row.tool.name==='host_effect')!.tool],instructions:payload.instructions});
      await bindNativeBackgroundPolicy(tx,f.root.id,policy,check);
    },context);
    if(mode==='revoked')f.host.onModelEnter=()=>{permitted=false;};
    if(mode==='expired')f.host.onModelEnter=()=>{now=Date.parse(policy.expiresAt);};
    const submitted=await f.submit(policy.sourceId,payload.prompt),settled=await submitted.wait(context);
    const effects=mode==='reused-call-id'?2:mode==='allowed'||mode==='parallel'?1:0;
    expect(f.host.effects).toBe(effects);expect(f.host.credentialLookups).toBe(0);
    expect(settled.status).toBe(['revoked','expired','configuration','api-change'].includes(mode)?'unanswered':'done');
    const state=(await f.harness.snapshot(NativeBackgroundPolicyDoc,f.root.id,policy.sourceId,context))!;
    expect(state.sourceId).toBe(policy.sourceId);expect(state.policySha256).toBe(nativeBackgroundPolicyHash(policy));expect(state.calls).toHaveLength(effects);
    if(effects)expect(state.calls[0]!.toolName).toBe('host_effect');
    if(mode==='parallel'||mode==='reused-call-id'||mode==='long-call')expect(attempts).toBe(mode==='reused-call-id'?3:2);
    else expect(f.host.modelCalls).toBe(mode==='api-change'?0:['revoked','expired','configuration'].includes(mode)?1:2);
    // Rebinding cannot widen permissions or erase a used quota.
    if(mode==='allowed'){
      await f.root.commit(tx=>bindNativeBackgroundPolicy(tx,f.root.id,policy,check),context);
      expect((await f.harness.snapshot(NativeBackgroundPolicyDoc,f.root.id,policy.sourceId,context))!.calls).toEqual(state.calls);
      await expect(f.root.commit(tx=>bindNativeBackgroundPolicy(tx,f.root.id,{...policy,maxToolCalls:2},check),context)).rejects.toThrow('binding conflict');
      const latest=await f.root.entries({order:'descending'},1,undefined,context);
      const fork=await f.root.commit(tx=>tx.forkConversation(f.root.id,latest.items[0]!.id,{ownership:{kind:'ownerless'}}),context);
      await expect(f.harness.commit(tx=>bindNativeBackgroundPolicy(tx,fork.id,policy,check),context)).rejects.toThrow('Fresh private background conversation required');
      expect((await f.harness.snapshot(NativeBackgroundPolicyDoc,f.root.id,policy.sourceId,context))!.calls).toEqual(state.calls);
    }
  }finally{await f.close();}
}

export async function backgroundPolicyOwnerFixture(){
  const contract=await Bun.file(new URL('../../runtime/scripts/schema-ownership.json',import.meta.url)).json();
  const definition=NativeBackgroundPolicyDoc.definition,entry=contract.documents.find((row:{kind:string})=>row.kind===definition.kind);
  expect(entry).toEqual({kind:definition.kind,owner:'core:background-policy',scope:definition.scope,history:definition.history,fork:definition.fork});
  expect(contract.owners[entry.owner].writers).toEqual(['runtime/durable-engine/src/host-background-policy.ts']);
}

export async function backgroundPolicyReopenFixture(){
  const dir=await mkdtemp(join(process.env.PICLAW_WORKSPACE!,'background-policy-')),path=join(dir,'candidate.sqlite');
  let owner:TestOwner|undefined,f:Awaited<ReturnType<typeof openFixture>>|undefined;
  const payload=createNativeBackgroundPayload({origin:{kind:'dream',invocationId:'reopen-policy',chatJid:'web:qualification-reopen',mode:'manual'},
    workId:'fixture:reopen',parentWorkId:null,model:{provider:'qualification',modelId:'synthetic',api:'openai-completions'},allowedTools:['host_effect'],maxToolCalls:1,
    acceptedAt:'2026-10-26T15:20:00.000Z',expiresAt:'2026-10-26T15:23:00.000Z',prompt:'use-tool',instructions:'Persistent quota fixture'});
  const policy=payload.policy,now=Date.parse(policy.acceptedAt);
  const open=async()=>{
    owner=TestOwner.acquire(path);const lease=owner;
    const opened=await openFixture({get acquired(){return lease.acquired;}},()=>{},()=>SqliteStorage.open(new OwnedSqlite(lease)));f=opened;
    const extension=defineExtension({name:'qualification-background-quota',hooks:[{task:'pi.tool',handlers:{
      beforeTool:async(call:Parameters<ToolHooks['beforeTool']>[0],api:Parameters<ToolHooks['beforeTool']>[1])=>{
        await opened.harness.commit(tx=>claimNativeBackgroundTool(tx,opened.root.id,policy,{taskId:api.taskId,callId:call.id,toolName:call.name},now,()=>lease.assert()),context);
      },
    }}]});opened.registry.install(extension);
    await opened.root.commit(async tx=>{
      await configure(tx,opened.root.id,{extensions:[opened.registry.snapshot().extension('qualification')!,extension],
        tools:[opened.registry.snapshot().tools().find(row=>row.tool.name==='host_effect')!.tool],instructions:payload.instructions});
      await bindNativeBackgroundPolicy(tx,opened.root.id,policy,()=>lease.assert());
    },context);return opened;
  };
  const close=async()=>{
    if(!f)return;await f.close();f=undefined;
    owner!.releaseAfterClose();owner!.closeConnection();owner=undefined;
  };
  try{
    f=await open();const first=await f.submit(policy.sourceId,payload.prompt);expect((await first.wait(context)).status).toBe('done');expect(f.host.effects).toBe(1);
    const state=await f.harness.snapshot(NativeBackgroundPolicyDoc,f.root.id,policy.sourceId,context);expect(state?.calls).toHaveLength(1);await close();
    f=await open();expect((await f.harness.inspect(context)).scheduling).toBe('paused');
    const replay=await f.submit(policy.sourceId,payload.prompt);expect((await replay.wait(context)).status).toBe('done');expect(f.host.modelCalls).toBe(0);expect(f.host.effects).toBe(0);
    // Deliberate SDK-only negative probe: production admission must never accept
    // a second primary in this one-operation private context. Quota cannot reset.
    expect((await (await f.submit('negative-quota-probe',payload.prompt)).wait(context)).status).toBe('done');expect(f.host.effects).toBe(0);
    expect(await f.harness.snapshot(NativeBackgroundPolicyDoc,f.root.id,policy.sourceId,context)).toEqual(state);expect(f.host.credentialLookups).toBe(0);
    await close();await rm(dir,{recursive:true});
  }finally{await close();} // Cleanup failure retains the owned copy/lease instead of forcing removal.
}
