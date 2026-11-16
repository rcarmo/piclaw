import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {Harness} from '../../runtime/durable-engine/qualification/durable.ts';
import {createProvider,createAssistantMessageEventStream,type TranscriptContext,type AssistantMessage} from '../../runtime/durable-engine/qualification/ai.ts';
import {SqliteStorage} from '../../runtime/durable-engine/qualification/sqlite.ts';
import {BunSqliteDatabase} from '../../runtime/durable-engine/src/bun-sqlite.ts';
import {createHostController} from '../../runtime/durable-engine/src/host-controller.ts';
import type {AcceptedInput} from '../../runtime/durable-engine/src/host-runtime.ts';
import {withTaskModelRequestScope,taskModelRequestScope} from '../../runtime/durable-engine/src/task-model-boundary-shim.ts';
import {TestOwner,OwnedSqlite} from './src/ownership.ts';
import {hostSourceContractFixture} from './src/host-source-contract-fixture.ts';
import {barrier,context} from './src/fixture.ts';
import {at,effect,sealed,value} from './src/host-handoff.ts';
import {hashCanonicalRequest} from '../../runtime/src/service-effects/contracts/common.ts';
import {storeChatMetadata} from '../../runtime/src/db.ts';

for(const same of [false,true])test(`controller compacts ${same?'the busy current':'an idle unrelated'} conversation without global idle`,async()=>{
 const dir=await mkdtemp(join(process.env.PICLAW_WORKSPACE!,'scoped-compact-'));
 const f=await hostSourceContractFixture(dir,'before-submit', false,{sharedDatabase:true});
 let controller:Awaited<ReturnType<typeof createHostController>>|undefined,sql!:BunSqliteDatabase;
 const release=barrier(),summaryRelease=barrier();f.base.host.toolHold=release;
 try{
  const h=await Harness.open(await SqliteStorage.open(new OwnedSqlite(f.owner)),{models:f.base.models,registry:f.base.registry,settings:{compaction:{enabled:false,keepRecentTokens:1}}},context);
  const root=(await h.conversation(f.base.root.id,context))!;
  const target=same?root:await h.createConversation({ownership:{kind:'ownerless'},agent:{model:{provider:'qualification',modelId:'synthetic'},tools:[]}},context);
  const targetChat=same?f.chatJid:'web:scoped-target';
  for(let n=0;n<3;n++)expect((await(await target.submit({type:'input',requestId:`history-${n}`,content:'Recorded decision '+n+' important detail '.repeat(100)},context)).wait(context)).status).toBe('done');
  await h.close(context);
  const manifest=[{chatJid:f.chatJid,branchId:'main',conversationId:root.id},...(!same?[{chatJid:targetChat,branchId:'main',conversationId:target.id}]:[])];
  f.owner.releaseAfterClose();f.owner.closeConnection();
  controller=await createHostController({
   async acquireOwnership(){f.owner=TestOwner.acquire(f.path);return{assertCurrentOwner:()=>f.owner.assert(),release(){f.owner.releaseAfterClose();}};},
   async createStorage(){sql=new BunSqliteDatabase(f.path,{root:f.db,assertOwner:()=>f.owner.assert(),fenceTransactions:true});return SqliteStorage.open(sql);},
   runtime:{incarnation:f.incarnation,...f.ports,harnessOptions:{models:f.base.models,registry:withTaskModelRequestScope(f.base.registry),settings:{retry:{enabled:false},compaction:{enabled:false,keepRecentTokens:1}}},
    withIdleModelGuard:body=>sql.withIdleModelGuard(body),withCompactionGuard:body=>sql.withCompactionGuard(body),
    existingConversationIds:manifest.map(b=>b.conversationId),conversationFor:(chat)=>manifest.find(b=>b.chatJid===chat)!.conversationId,
    putAnswer(ref,text){f.putAnswer(ref,text);},sessionId:f.incarnation,lane:'main',generation:f.generation,now:()=>at},
   recovery:{manifest,work:f.ports.work,bindings:f.ports.bindings,async readAcceptedInput(source){const row=f.db.query('SELECT content FROM messages WHERE id=? AND chat_jid=?').get(source.sourceId,source.chatJid) as {content:string};const binding=await f.ports.bindings.findSource(source.chatJid,source.sourceSeq);return{claimed:{source,operation:value(await f.ports.work.getOperation(f.incarnation))!},branchId:'main',requestId:binding?.requestId??f.primaryRequestId,content:row.content};}},
  },context);
  const model=f.base.models.getModel('qualification','synthetic')!;
  const stream=(_model:unknown,transcript:TranscriptContext,options?:{signal?:AbortSignal})=>{
   const scope=taskModelRequestScope(options?.signal);f.base.host.onModelEnter?.(options?.signal);
   const last=transcript.messages.findLast(message=>message.role!=='system');
   const tool=scope?.taskKind!=='pi.compaction'&&last?.role==='user'&&JSON.stringify(last.content).includes('use-tool');
   const message:AssistantMessage={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:tool?[{type:'toolCall',id:'busy-call',name:'host_effect',arguments:{value:'synthetic'}}]:[{type:'text',text:'PRESERVED_DECISIONS'}],stopReason:tool?'toolUse':'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
   const output=createAssistantMessageEventStream();void(async()=>{if(scope?.taskKind==='pi.compaction')await summaryRelease.promise;output.push({type:'done',reason:tool?'toolUse':'stop',message});output.end(message);})();return output;
  };
  f.base.models.setProvider(createProvider({id:model.provider,models:[model],auth:{apiKey:{name:'keyless',resolve:async()=>({auth:{},source:'fixture'})}},api:{stream,streamSimple:stream}}));
  storeChatMetadata(f.chatJid,at);
  const id=crypto.randomUUID();const source=value(await f.ports.work.acceptSource(sealed({effect:effect(id),chatJid:f.chatJid,sourceId:id,kind:'message',payloadRef:id,targetOperationId:null,parentSourceSeq:null,acceptedAt:at,createWakeIntent:false})));
  f.db.query('INSERT INTO messages(id,chat_jid,content,timestamp) VALUES (?,?,?,?)').run(id,f.chatJid,'use-tool',at);
  const claimed=value(await f.ports.work.claimNext(sealed({effect:effect('claim:'+id),chatJid:f.chatJid,expectedFrontier:0,newOperationId:f.incarnation,claimedAt:at})))!;
  const input:AcceptedInput={incarnation:f.incarnation,conversationId:root.id,chatJid:f.chatJid,branchId:'main',operationId:claimed.operation.operationId,sourceId:id,sourceSeq:source.sourceSeq,payloadRef:id,requestId:f.primaryRequestId,requestHash:hashCanonicalRequest({type:'input',requestId:f.primaryRequestId,content:'use-tool'})};
  const submissionId=await controller.runtime.submit(input);
  const op=value(await f.ports.work.getOperation(f.incarnation))!;value(await f.ports.work.bindHarness(sealed({ effect:effect('bind:'+id,f.incarnation,source.sourceSeq), expectedVersion:op.version, sessionId:f.incarnation, harnessOperationId:String(submissionId) })));
  await f.base.host.toolEntered.promise;
  const before=(await controller.runtime.inspectAuthority()).inspection.tasks.find(t=>t.record.kind==='pi.tool')!.record;
  const entered=barrier();f.base.host.finalContent=[{type:'text',text:'PRESERVED_DECISIONS'}];
  f.base.host.onModelEnter=signal=>{const scope=taskModelRequestScope(signal);if(scope?.taskKind==='pi.compaction'){controller!.runtime.assertMaintenanceRequest(scope);entered.release();}};
  let settled=false;const compact=controller.runtime.compactSession({incarnation:f.incarnation,chatJid:targetChat,branchId:'main',conversationId:target.id}).then(result=>{settled=true;return result;});
  await entered.promise;
  // Running observers and unrelated model/tool authority stay usable throughout.
  await controller.reconcileRecovered();
  expect((await controller.runtime.inspectAuthority()).inspection.tasks.find(t=>t.record.id===before.id)?.record).toEqual(before);
  expect(f.base.host.effects).toBe(0);
  const activeMaintenance=await controller.runtime.inspectRecoverableMaintenance((await controller.runtime.inspectAuthority()).inspection);
  expect(activeMaintenance).toHaveLength(1);expect(activeMaintenance[0]!.conversationId).toBe(target.id);
  summaryRelease.release();
  if(same){
   let inspection=(await controller.runtime.inspectAuthority()).inspection;
   for(let n=0;n<100&&!inspection.submissions.some(s=>s.type==='write');n++){await Bun.sleep(10);inspection=(await controller.runtime.inspectAuthority()).inspection;}
   expect(inspection.submissions.some(s=>s.type==='write')).toBe(true);
   const recoverable=await controller.runtime.inspectRecoverableMaintenance(inspection);
   expect(recoverable).toHaveLength(1);expect(recoverable[0]!.state.status).toBe('terminal');
   await controller.reconcileRecovered();expect(settled).toBe(false);
  }else expect(await compact).toEqual({compacted:true});
  release.release();await controller.runtime.wait(input,submissionId);
  expect(await compact).toEqual({compacted:true});
  expect(f.base.host.effects).toBe(1);expect(f.base.host.credentialLookups).toBe(0);
  expect(await controller.runtime.settle(input)).not.toBeNull();
  const usage=await controller.runtime.readSessionContextUsage({incarnation:f.incarnation,chatJid:targetChat,branchId:'main',conversationId:target.id});expect(usage.tokens).toBeGreaterThan(0);
  expect((await controller.runtime.inspectAuthority()).inspection.tasks).toHaveLength(0);
 }finally{summaryRelease.release();release.release();await controller?.close();await f.close();await rm(dir,{recursive:true,force:true});}
},12000);
