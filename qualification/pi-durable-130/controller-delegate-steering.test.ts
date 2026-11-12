import './src/test-guard.js';
import {expect,test,spyOn} from 'bun:test';
import {Type,createProvider,createAssistantMessageEventStream,type AssistantMessage,type TranscriptContext} from '../../runtime/durable-engine/qualification/ai.ts';
import {defineExtension,defineTool,configure} from '../../runtime/durable-engine/qualification/durable.ts';
import {awaitWithContext,withAbortSignal} from '../../runtime/durable-engine/qualification/context.ts';
import {createHostDelegateTool} from '../../runtime/durable-engine/src/host-delegate-tool.ts';
import {createHostObservabilityPrompt} from '../../runtime/durable-engine/src/host-observability.ts';
import {nativeMessageFixture} from './src/native-message-fixture.ts';
import {barrier,context} from './src/fixture.ts';

// Model/child work is REAL public SDK work. Only the provider is deterministic.
// A native steer is another accepted SDK input, never a recovered host intent.
for(const mode of ['native','reopen','observability','lost-ack','lost-ack-observability','wrong-request','wrong-tool','extra-child'] as const)test(`native Delegate steering/source authority: ${mode}`,async()=>{
  const f=await nativeMessageFixture();
  const entered=[barrier(),barrier()],release=barrier(),start=barrier();
  let calls=0,children=0,captures=0;
  const valid=!['wrong-request','wrong-tool','extra-child'].includes(mode);
  const toolName=mode==='wrong-tool'?'worker':'delegate';
  const failures:unknown[]=[];
  const lostAck=mode.startsWith('lost-ack');let primarySource='',bindingFault:'missing'|'wrong-id'|undefined;
  const getBinding=f.bindings.get.bind(f.bindings),recordBinding=f.bindings.recordSubmission.bind(f.bindings);
  const getSpy=spyOn(f.bindings,'get').mockImplementation(async input=>{const binding=await getBinding(input);if(input.sourceId===primarySource&&bindingFault)return bindingFault==='missing'?null:binding?{...binding,submissionId:((binding.submissionId??0)+1000) as never}:null;return binding;});
  const ackSpy=spyOn(f.bindings,'recordSubmission').mockImplementation(async(input,id)=>{if(lostAck&&input.sourceId!==primarySource)throw Error('synthetic accepted SDK ACK lost');await recordBinding(input,id);});
  const observability=mode.includes('observability')?createHostObservabilityPrompt({
    buildObservabilitySystemPrompt(){return 'FIXTURE_OBSERVABILITY';},
  },{root:f.root,runtime:()=>({async captureRunSource(conversation,task){const captured=await f.runtime.captureRunSource(conversation,task);expect(captured.native).toBeDefined();if(captured.inputs.length===2){captures++;for(const fault of ['missing','wrong-id'] as const){bindingFault=fault;try{await expect(f.runtime.captureRunSource(conversation,task)).rejects.toThrow('Host binding conflict');}finally{bindingFault=undefined;}}}return captured;}}),assertOwner:f.options.owner.assert,failClosed:error=>failures.push(error)}):undefined;
  try{
    const read=defineTool({name:'read',description:'Fixture reader',parameters:Type.Object({}),async execute(){return{output:[{type:'text',text:'READ'}]};}});
    const readers=defineExtension({name:'controller-readers',tools:[read]});f.base.registry.install(readers);
    const native=createHostDelegateTool({name:'delegate',description:'Fixture declaration',parameters:Type.Object({prompt:Type.String()})},{
      assertCurrent:f.options.owner.assert,runtime:()=>f.runtime,async selectModel(_args,parent){return parent!;},assertModelCurrent(){},readonlyTools:[read],readonlyExtensions:[readers],
    });
    const delegate=valid?native:defineTool({name:toolName,description:'Unqualified child producer',parameters:Type.Object({prompt:Type.String()}),executionMode:'parallel',replay:'safe',async execute(args,api,ctx){
      const id=await api.commit(async tx=>{const child=await tx.createConversation({ownership:{kind:'task',taskId:api.taskId}});await configure(tx,child.id,{tools:[read],modelTools:[read],extensions:[readers]});if(mode==='extra-child')await tx.createConversation({ownership:{kind:'task',taskId:api.taskId}});return child.id;},ctx);
      const child=(await api.conversation(id,ctx))!;
      const settled=await(await child.submit({type:'input',content:args.prompt,requestId:`${mode==='wrong-request'?'unapproved':'delegate'}:${api.taskId}`},ctx)).wait(ctx);
      return{output:[{type:'text',text:settled.status}]};
    }});
    const extension=defineExtension({name:'controller-delegate',tools:[delegate]});f.base.registry.install(extension);
    if(observability)f.base.registry.install(observability);
    await f.base.root.configure({extensions:[extension,...(observability?[observability]:[])],tools:[delegate]},context);
    const model=f.base.models.getModel('qualification','synthetic')!;
    const stream=(_model:unknown,input:TranscriptContext,options?:{signal?:AbortSignal})=>{
      const user=JSON.stringify(input.messages.findLast(m=>m.role==='user')?.content);
      const ordinal=user.includes('CHILD_A')?0:user.includes('CHILD_B')?1:-1;
      const delegated=input.messages.some(m=>m.role==='toolResult'&&m.toolName===toolName);
      const calling=ordinal<0&&!delegated;
      const content:AssistantMessage['content']=calling?['A','B'].map(id=>({type:'toolCall',id,name:toolName,arguments:{prompt:`CHILD_${id}`}})):[{type:'text',text:ordinal>=0?'CHILD_DONE':JSON.stringify(input.messages.filter(m=>m.role==='user')).includes('accepted C')?'ROOT_DONE_STEER_SEEN':'ROOT_DONE'}];
      const message:AssistantMessage={role:'assistant',api:model.api,provider:model.provider,model:model.id,content,stopReason:calling?'toolUse':'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      const output=createAssistantMessageEventStream();calls++;
      void(async()=>{try{if(calling)await awaitWithContext(start.promise,options?.signal?withAbortSignal(options.signal,context):context);if(ordinal>=0){children++;entered[ordinal]!.release();await awaitWithContext(release.promise,options?.signal?withAbortSignal(options.signal,context):context);}options?.signal?.throwIfAborted();output.push({type:'done',reason:calling?'toolUse':'stop',message});output.end(message);}catch(error){const failed={...message,content:[],stopReason:'aborted' as const,errorMessage:String(error)};output.push({type:'error',reason:'aborted',error:failed});output.end(failed);}})();return output;
    };
    f.base.models.setProvider(createProvider({id:model.provider,models:[model],auth:{apiKey:{name:'keyless',resolve:async()=>({auth:{},source:'fixture'})}},api:{stream,streamSimple:stream}}));
    await f.open();
    const primary=f.accept('parent request');primarySource=primary.sourceId;const primaryId=await f.runtime.submitMessage(primary);
    start.release();await Promise.all(entered.map(item=>item.promise));expect(children).toBe(2);
    const inspection=await f.runtime.inspectAuthority();
    const childSubmissions=inspection.inspection.submissions.filter(item=>item.conversationId!==f.base.root.id);
    expect(childSubmissions).toHaveLength(2);
    for(const child of childSubmissions){
      const proof=await f.runtime.inspectOwnedDelegateAuthority(child);
      expect(!!proof).toBe(valid);
      if(proof){expect(proof.inputs.map(input=>input.sourceId)).toEqual([primary.sourceId]);expect(proof.inputs.every(input=>input.chatJid===f.chat)).toBe(true);expect(proof.taskId).toBeGreaterThan(0);}
    }
    if(!valid){await expect(f.controller.reconcileRecovered()).rejects.toThrow('Unknown recovered candidate authority');expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);await f.runtime.abortMessages(f.binding);return;}
    await f.controller.reconcileRecovered();
    const steer=f.accept('accepted C');
    const steerId=await f.runtime.submitMessage(steer,'steer');
    if(lostAck)expect((await f.runtime.messageSubmissionStatus(steer))?.id).toBe(steerId);
    if(lostAck)expect((await getBinding(steer))?.submissionId).toBeNull();
    expect((await f.runtime.readMessageInbox(f.binding)).map(item=>item.submissionId)).toEqual([steerId]);
    const accepted=f.root.query('SELECT record FROM submissions WHERE id=?').get(steerId);
    if(mode==='reopen'){
      const before=calls;await f.reopen();
      expect(calls).toBe(before);expect(children).toBe(2);
      expect(f.root.query('SELECT record FROM submissions WHERE id=?').get(steerId)).toEqual(accepted);
      // A paused reopen is observation, never replay of the two interrupted children.
      await f.runtime.abortMessages(f.binding);
      expect(await f.runtime.waitForMessage(primary,primaryId)).toMatchObject({status:'unanswered',reason:'aborted'});
      expect(await f.runtime.waitForMessage(steer,steerId)).toMatchObject({status:'unanswered',reason:'aborted'});
      expect(calls).toBe(before);return;
    }
    release.release();
    const result=await f.runtime.waitForMessage(primary,primaryId),steered=await f.runtime.waitForMessage(steer,steerId);
    expect(result.status).toBe('done');expect(steered.status).toBe('done');
    expect((await f.runtime.readMessageResult(primary))?.answer?.text).toBe('ROOT_DONE_STEER_SEEN');
    const source=(await f.runtime.readMessageResult(primary))!.inputs;
    expect(source.map(input=>input.sourceId)).toEqual([primary.sourceId,steer.sourceId]);
    expect(children).toBe(2);expect(calls).toBe(4);expect(failures).toEqual([]);
    if(observability)expect(captures).toBe(1);
    if(lostAck){
      const entries=f.root.query('SELECT * FROM entries ORDER BY id').all(),submissions=f.root.query('SELECT * FROM submissions ORDER BY id').all();
      ackSpy.mockImplementation(recordBinding);
      expect(await f.runtime.submitMessage(steer,'steer')).toBe(steerId);
      expect((await getBinding(steer))?.submissionId).toBe(steerId);
      expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(submissions);
      expect(calls).toBe(4);
    }
    expect((await f.runtime.inspectAuthority()).inspection.tasks).toHaveLength(0);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);
    expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
  }finally{start.release();release.release();await f.close();getSpy.mockRestore();ackSpy.mockRestore();}
},12000);
