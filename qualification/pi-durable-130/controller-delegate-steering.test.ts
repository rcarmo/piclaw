import './src/test-guard.js';
import {expect,test} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {Type,createProvider,createAssistantMessageEventStream,type AssistantMessage,type TranscriptContext} from '../../runtime/durable-engine/qualification/ai.ts';
import {Harness,defineExtension,defineTool,configure,type SubmissionId} from '../../runtime/durable-engine/qualification/durable.ts';
import {awaitWithContext,withAbortSignal} from '../../runtime/durable-engine/qualification/context.ts';
import {createHostController} from '../../runtime/durable-engine/src/host-controller.ts';
import {createHostObservabilityPrompt} from '../../runtime/durable-engine/src/host-observability.ts';
import type {AcceptedInput} from '../../runtime/durable-engine/src/host-runtime.ts';
import {hashCanonicalRequest} from '../../runtime/src/service-effects/contracts/common.ts';
import {createHostDelegateTool} from '../../runtime/durable-engine/src/host-delegate-tool.ts';
import {SqliteStorage} from '../../runtime/durable-engine/qualification/sqlite.ts';
import {TestOwner,OwnedSqlite} from './src/ownership.ts';
import {acceptedSteerFixture} from './src/accepted-steer-recovery-fixture.ts';
import {barrier,context} from './src/fixture.ts';
import {at,effect,sealed,value} from './src/host-handoff.ts';
import {getDeferredQueuedFollowups,setDeferredQueuedFollowups,storeChatMetadata} from '../../runtime/src/db.ts';
import {createDurableConversationAdapter} from '../../runtime/src/agent-pool/durable-runtime-adapter.ts';
import {createDurableQueuedSteering} from '../../runtime/src/agent-pool/durable-queued-steering.ts';
import {getMessageByRowIdFromDatabase} from '../../runtime/src/db/messages.ts';
import {admitWebMessage} from '../../runtime/src/channels/web/messaging/message-store.ts';

for(const mode of ['native','reopen','late-ack-recovery','late-ack-observability','wrong-request','wrong-tool','extra-child'] as const) test(`real controller Delegate steering authority: ${mode}`,async()=>{
 const dir=await mkdtemp(join(process.env.PICLAW_WORKSPACE!,'controller-delegates-'));
 const f=await acceptedSteerFixture(dir,'before-submit');
 let controller:Awaited<ReturnType<typeof createHostController>>|undefined;
 let entered=[barrier(),barrier()];const release=barrier(),startParent=barrier();let calls=0,children=0;
 const lateAck=mode==='late-ack-recovery'||mode==='late-ack-observability';
 const valid=mode==='native'||mode==='reopen'||lateAck,toolName=mode==='wrong-tool'?'worker':'delegate',run=crypto.randomUUID();
 const observabilityFailures:unknown[]=[];
 const primaryBindingFault=new AsyncLocalStorage<'missing'|'wrong-id'>();
 let recoveredCaptures=0;
 const observability=mode==='late-ack-observability'?createHostObservabilityPrompt({
  async prepareObservabilityRuntime(){},buildObservabilitySystemPrompt(){return 'FIXTURE_OBSERVABILITY';},bindObservabilityConfiguration(){return()=>{};},
 },{root:f.db,runtime:()=>({async captureRunSource(conversation,task){
  const captured=await controller!.runtime.captureRunSource(conversation,task);
  if(captured.inputs.length===2){
   recoveredCaptures++;
   expect(captured.inputs[0]!.requestId).toBe(f.primaryRequestId);
   expect(captured.inputs[1]!.requestId).toStartWith('queued-steer:');
   for(const fault of ['missing','wrong-id'] as const){
    await primaryBindingFault.run(fault,async()=>{
     await expect(controller!.runtime.captureRunSource(conversation,task)).rejects.toThrow('Exact host primary binding required');
    });
   }
  }
  return captured;
 }}),assertOwner:()=>f.owner.assert(),failClosed:error=>{observabilityFailures.push(error);}}):undefined;
 if(observability)f.base.registry.install(observability);
 let primary!:AcceptedInput;
 try{
  const read=defineTool({name:'read',description:'Fixture reader',parameters:Type.Object({}),async execute(){return{output:[{type:'text',text:'READ'}]};}});
  const readers=defineExtension({name:'controller-readers',tools:[read]});f.base.registry.install(readers);
  const native=createHostDelegateTool({name:'delegate',description:'Fixture declaration',parameters:Type.Object({prompt:Type.String()})},{
   assertCurrent(){f.owner.assert();},runtime:()=>controller!.runtime,async selectModel(_args,parent){return parent!;},assertModelCurrent(){},readonlyTools:[read],readonlyExtensions:[readers],
  });
  // Negative cases create REAL public SDK work, not fabricated ownership records.
  const delegate=valid?native:defineTool({name:toolName,description:'Unqualified child producer',parameters:Type.Object({prompt:Type.String()}),executionMode:'parallel',replay:'safe',async execute(args,api,ctx){
   const id=await api.commit(async tx=>{const child=await tx.createConversation({ownership:{kind:'task',taskId:api.taskId}});await configure(tx,child.id,{tools:[read],modelTools:[read],extensions:[readers]});if(mode==='extra-child')await tx.createConversation({ownership:{kind:'task',taskId:api.taskId}});return child.id;},ctx);
   const child=(await api.conversation(id,ctx))!;const settled=await(await child.submit({type:'input',content:args.prompt,requestId:`${mode==='wrong-request'?'unapproved':'delegate'}:${api.taskId}`},ctx)).wait(ctx);
   return{output:[{type:'text',text:settled.status}]};
  }});
  const extension=defineExtension({name:'controller-delegate',tools:[delegate]});f.base.registry.install(extension);
  const storage=await SqliteStorage.open(new OwnedSqlite(f.owner));
  const harness=await Harness.open(storage,{models:f.base.models,registry:f.base.registry},context);
  await (await harness.conversation(f.base.root.id,context))!.configure({extensions:[extension,...(observability?[observability]:[])],tools:[delegate]},context);await harness.close(context);
  const model=f.base.models.getModel('qualification','synthetic')!;
  const stream=(_model:unknown,input:TranscriptContext,options?:{signal?:AbortSignal})=>{
   const user=JSON.stringify(input.messages.findLast(m=>m.role==='user')?.content);
   const ordinal=user.includes('CHILD_A')?0:user.includes('CHILD_B')?1:-1;
   const delegated=input.messages.some(m=>m.role==='toolResult'&&m.toolName==='delegate');
   const calling=ordinal<0&&!delegated;
   const content:AssistantMessage['content']=calling?['A','B'].map(id=>({type:'toolCall',id,name:toolName,arguments:{prompt:`CHILD_${id}`}})):[{type:'text',text:ordinal>=0?'CHILD_DONE':JSON.stringify(input.messages.filter(m=>m.role==='user')).includes('accepted C')?'ROOT_DONE_STEER_SEEN':'ROOT_DONE'}];
   const message:AssistantMessage={role:'assistant',api:model.api,provider:model.provider,model:model.id,content,stopReason:calling?'toolUse':'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
   const output=createAssistantMessageEventStream();calls++;
   void(async()=>{try{if(calling)await awaitWithContext(startParent.promise,options?.signal?withAbortSignal(options.signal,context):context);if(ordinal>=0){children++;entered[ordinal]!.release();await awaitWithContext(release.promise,options?.signal?withAbortSignal(options.signal,context):context);}options?.signal?.throwIfAborted();output.push({type:'done',reason:calling?'toolUse':'stop',message});output.end(message);}catch(error){const failed={...message,content:[],stopReason:'aborted' as const,errorMessage:String(error)};output.push({type:'error',reason:'aborted',error:failed});output.end(failed);}})();return output;
  };
  f.base.models.setProvider(createProvider({id:model.provider,models:[model],auth:{apiKey:{name:'keyless',resolve:async()=>({auth:{},source:'fixture'})}},api:{stream,streamSimple:stream}}));
  f.owner.releaseAfterClose();f.owner.closeConnection();
  const openController=()=>createHostController({
   async acquireOwnership(){f.owner=TestOwner.acquire(f.path);return{assertCurrentOwner:()=>f.owner.assert(),release(){f.owner.releaseAfterClose();}};},
   async createStorage(lease){lease.assertCurrentOwner();return SqliteStorage.open(new OwnedSqlite(f.owner));},
   runtime:{ incarnation:f.incarnation, ...f.ports, bindings:{...f.ports.bindings,async get(input){
    const binding=await f.ports.bindings.get(input);
    const fault=primaryBindingFault.getStore();
    if(fault&&input.sourceSeq===primary.sourceSeq)return fault==='missing'?null:binding?{...binding,submissionId:(binding.submissionId!+1) as SubmissionId}:null;
    return binding;
   }}, harnessOptions:{models:f.base.models,registry:f.base.registry,settings:{retry:{enabled:false},compaction:{enabled:false}}}, existingConversationIds:[f.base.root.id], conversationFor:()=>f.base.root.id, putAnswer(ref,text){f.putAnswer(ref,text);}, sessionId:f.incarnation, now:()=>at },
   recovery:{manifest:[{chatJid:f.chatJid,branchId:'main',conversationId:f.base.root.id}],work:f.ports.work,bindings:f.ports.bindings,async readAcceptedInput(source){const row=f.db.query('SELECT content FROM messages WHERE id=? AND chat_jid=?').get(source.sourceId,source.chatJid) as {content:string}|null;if(!row)throw Error('Missing accepted message');const binding=await f.ports.bindings.findSource(source.chatJid,source.sourceSeq);return{claimed:{source,operation:value(await f.ports.work.getOperation(f.incarnation))!},branchId:'main',requestId:binding?.requestId??(source.sourceSeq===1?f.primaryRequestId:`queued-steer:${source.sourceId}`),content:row.content};}},
  },context);
  controller=await openController();
  storeChatMetadata(f.chatJid,at);
  const a=value(await f.ports.work.acceptSource(sealed({effect:effect(`controller-primary:${run}`),chatJid:f.chatJid,sourceId:`controller-primary:${run}`,kind:'message' as const,payloadRef:`controller-primary:${run}`,targetOperationId:null,parentSourceSeq:null,acceptedAt:at,createWakeIntent:false})));
  f.db.query('INSERT INTO messages(id,chat_jid,content,timestamp) VALUES (?,?,?,?)').run(a.sourceId,f.chatJid,'parent request',at);
  const claimed=value(await f.ports.work.claimNext(sealed({effect:effect(`controller-claim:${run}`),chatJid:f.chatJid,expectedFrontier:0,newOperationId:f.incarnation,claimedAt:at})))!;
  primary={incarnation:f.incarnation,conversationId:f.base.root.id,chatJid:f.chatJid,branchId:'main',operationId:claimed.operation.operationId,sourceId:a.sourceId,sourceSeq:a.sourceSeq,payloadRef:a.payloadRef,requestId:f.primaryRequestId,requestHash:hashCanonicalRequest({type:'input',requestId:f.primaryRequestId,content:'parent request'})};
  const primaryId=await controller.runtime.submit(primary);
  const op=value(await f.ports.work.getOperation(f.incarnation))!;value(await f.ports.work.bindHarness(sealed({ effect:effect(`controller-running:${run}`,f.incarnation,a.sourceSeq), expectedVersion:op.version, sessionId:f.incarnation, harnessOperationId:String(primaryId) })));
  startParent.release();await Promise.all(entered.map(b=>b.promise));expect(children).toBe(2);
  if(mode==='reopen'){await controller.close();f.owner.closeConnection();entered=[barrier(),barrier()];controller=await openController();await controller.runtime.resume(primary,primaryId);await Promise.all(entered.map(b=>b.promise));expect(children).toBe(4);}
  const adapter=createDurableConversationAdapter({incarnation:f.incarnation,manifest:[{chatJid:f.chatJid,branchId:'main',conversationId:f.base.root.id}],runtime:controller.runtime});
  const id=`source-controller-C:${run}`;const c=value(await f.ports.work.acceptSource(sealed({effect:effect(id),chatJid:f.chatJid,sourceId:id,kind:'message' as const,payloadRef:`queued-source:${id}`,targetOperationId:null,parentSourceSeq:null,acceptedAt:at,createWakeIntent:false})));
  setDeferredQueuedFollowups(f.chatJid,[{rowId:1651,threadId:null,source_id:c.sourceId,source_accepted:true,queuedContent:'accepted C',queuedAt:at}]);
  let error:unknown,acceptedInput:Parameters<typeof adapter.submitIntent>[0]|undefined;
  const steering=createDurableQueuedSteering({work:f.ports.work,chatJid:f.chatJid,branchId:'main',assertCurrentWriter:()=>f.owner.assert(),runningBinding:{ sessionId:f.incarnation },adapter:{...adapter,async submitIntent(input){acceptedInput=input;try{if(lateAck){const {source,operation}=input.claimed;const intents=f.ports.bindings.intents;if(!intents)throw Error('Fixture requires intent bindings');await intents.getOrBind({...primary,operationId:operation.operationId,sourceSeq:source.sourceSeq,sourceId:source.sourceId,payloadRef:source.payloadRef,requestId:input.requestId,requestHash:hashCanonicalRequest({type:'input',requestId:input.requestId,content:input.content})});throw Error('Fixture dispatch interrupted before SDK submit');}return await adapter.submitIntent(input);}catch(e){error=e;throw e;}}},readQueued:row=>getDeferredQueuedFollowups(f.chatJid).find(x=>x.rowId===row),validatePayload({item}){expect(item.source_id).toBe(id);},materialize:(item,accept)=>admitWebMessage({broadcastEvent(){},pendingLinkPreviews:new Set<number>()} as Parameters<typeof admitWebMessage>[0],{chatJid:f.chatJid,content:item.queuedContent,isBot:false,mediaIds:[],agentId:'default',agentName:'Fixture'},{consumeDeferredFollowupRowId:item.rowId,materializeQueuedSource:accept,isSteeringMessage:true})});
  const accepted=await steering.accept(1651);await accepted.dispatch();expect(acceptedInput).toBeDefined();
  if(!valid){expect(String(error)).toContain('Unknown recovered candidate authority');expect((await f.ports.bindings.findSource(f.chatJid,c.sourceSeq))?.submissionId).toBeNull();await expect(controller.reconcileRecovered()).rejects.toThrow('Unknown recovered candidate authority');return;}
  if(lateAck){
   expect(String(error)).toContain('Fixture dispatch interrupted');expect((await f.ports.bindings.findSource(f.chatJid,c.sourceSeq))?.submissionId).toBeNull();
   release.release();for(let i=0;i<100;i++){if((await controller.runtime.reconcile(primary)).status?.status==='done')break;await new Promise(resolve=>setTimeout(resolve,10));}
   expect((await controller.runtime.reconcile(primary)).status?.status).toBe('done');
   await controller.close();f.owner.closeConnection();controller=await openController();await controller.reconcileRecovered();
   // Same accepted input identity; committed parent/child submissions are not replayed.
   expect(children).toBe(2);
  }else{expect(error).toBeUndefined();await controller.reconcileRecovered();}
  const intent=(await controller.runtime.reconcileIntent({...primary,sourceSeq:c.sourceSeq,sourceId:c.sourceId,payloadRef:c.payloadRef,requestId:`queued-steer:${id}`,requestHash:(await f.ports.bindings.findSource(f.chatJid,c.sourceSeq))!.requestHash}));expect(intent.submissionId).not.toBeNull();expect(lateAck?['queued','placed','done']:['queued']).toContain(intent.status?.status??'missing');
  release.release();await controller.runtime.wait(primary,primaryId);const settled=await controller.runtime.settle(primary);expect(settled).not.toBeNull();if(!settled?.messageRowId)throw Error('Missing published parent reply');expect(getMessageByRowIdFromDatabase(f.db,f.chatJid,settled.messageRowId)?.data.content).toContain('ROOT_DONE_STEER_SEEN');
  expect((await controller.runtime.reconcile(primary)).operation.terminal?.disposition).toBe('completed');expect(children).toBe(mode==='reopen'?4:2);expect(calls).toBe(mode==='reopen'?6:lateAck?5:4);
  expect(observabilityFailures.map(String)).toEqual([]);
  if(observability)expect(recoveredCaptures).toBe(1);
  expect((await controller.runtime.inspectAuthority()).inspection.tasks).toHaveLength(0);
 }finally{startParent.release();release.release();await controller?.close();await f.close();await rm(dir,{recursive:true,force:true});}
},12000);
