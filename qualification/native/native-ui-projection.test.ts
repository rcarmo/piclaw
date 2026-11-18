import './src/test-guard.js';
import {expect} from 'bun:test';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {barrier,context} from './src/fixture.js';
import type {Harness,ConversationId} from '../../runtime/durable-engine/qualification/durable.js';
import {getRouterState,setRouterState} from '../../runtime/src/db.js';
import {extensionKvGet,extensionKvSet} from '../../runtime/src/db/extension-kv.js';
import {createNativeTurnView} from '../../runtime/src/channels/web/agent/native-turn-view.js';
import {AgentStatusStore} from '../../runtime/src/channels/web/agent/agent-status-store.js';

const applicationTest=isolatedApplicationTest(import.meta.url);
for(const phase of ['generation','tool','tool-restart'] as const)applicationTest(`native ${phase}: fresh web projection rejoins actual SDK state without host intents or replay`,async()=>{
  const f=await nativeMessageFixture(),stops:Array<()=>Promise<void>>=[],stores:AgentStatusStore[]=[];
  let providerEntries=0,toolEntries=0;
  f.base.host.onModelEnter=()=>{providerEntries++;};f.base.host.onToolEnter=()=>{toolEntries++;};
  try{
    const history='{"agentStatuses":{"old":{"type":"thinking"}},"contextUsages":{"old":{"tokens":777}},"draftRecoveries":{"old":{"text":"uncommitted model text"}},"unknown":"keep"}';
    setRouterState('last_agent_timestamp_web',history);setRouterState('web:oobe:provider-ready:completed','true');
    const preferences={theme:'dark',outputPad:false,meters:true};f.root.transaction(()=>extensionKvSet('native-ui-projection-fixture','preferences',preferences,'global')).immediate();
    await f.open();
    const first=f.accept('completed native input A'),firstId=await f.runtime.submitMessage(first);expect((await f.runtime.waitForMessage(first,firstId)).status).toBe('done');
    f.base.host.modelHold=barrier();
    const pending=f.accept(phase==='generation'?'accepted native input B':'use-tool'),id=await f.runtime.submitMessage(pending),runId=`sdk-run:${f.base.root.id}:${id}`;
    const attach=async()=>{
      const store=new AgentStatusStore(15000,2);stores.push(store);
      const events:Array<{event:string;data:Record<string,any>}>=[],generation=barrier(),tool=barrier();let inputs:readonly number[]|undefined;
      const render=createNativeTurnView(f.root,{broadcastEvent(event,data){events.push({event,data});},updateAgentStatus(chat,data){store.update(chat,data);}},f.chat);
      const stop=await f.runtime.watchSession(f.binding,(view,startedAt,summaries)=>{render(view,startedAt,summaries);const live=view.docs['pi.live'] as any;inputs=live?.run?.inputs;if(live?.generation)generation.release();if(live?.tools?.some((slot:any)=>slot.name==='host_effect'&&slot.status==='running'))tool.release();});
      stops.push(stop);return {store,events,stop,generation,tool,get inputs(){return inputs;}};
    };
    if(phase==='generation'){
      // Put the run's first entry outside the SDK watch's default 50-entry
      // window. Reattachment must read its exact immutable timestamp publicly.
      const harness=Reflect.get(f.runtime,'harness') as Harness;
      const conversation=(await harness.conversation(f.binding.conversationId as ConversationId,context))!;
      await conversation.commit(async tx=>{for(let i=0;i<60;i++)await tx.appendEntry(conversation.id,{kind:'qualification.display',data:{i}});},context);
    }
    await Bun.sleep(25); // Attaching later cannot become the turn's start.
    const view=await attach();await view.generation.promise;
    expect(view.store.get(f.chat)).toMatchObject({type:'thinking',operation_id:runId});expect(view.inputs).toEqual([id]);
    const startedAt=view.store.get(f.chat)!.started_at;
    const inputEntry=(await f.runtime.readTurnEntries(f.binding))!.entries.find(entry=>entry.kind==='host.accepted'&&(entry.data as any)?.sourceId===pending.sourceId)!;
    expect(startedAt).toBe(new Date((inputEntry.model![0] as {timestamp:number}).timestamp).toISOString());
    const beforeContext=await f.runtime.readSessionContextUsage(f.binding);expect(beforeContext.contextWindow).toBe(100000);expect(beforeContext.tokens).toBeGreaterThan(0);
    await expect(f.runtime.watchSession({...f.binding,chatJid:'web:foreign'},()=>{throw Error('foreign publication');})).rejects.toThrow('Manifest conflict');
    await expect(f.runtime.readSessionContextUsage({...f.binding,incarnation:'stale'})).rejects.toThrow('Host binding conflict');
    await view.stop();view.store.dispose();
    if(phase==='generation'){
      await f.reopen();const entries=providerEntries,before=f.sdkSnapshot();
      expect(await f.runtime.readSessionContextUsage(f.binding)).toEqual(beforeContext);
      const restored=await attach();expect(restored.store.get(f.chat)).toMatchObject({operation_id:runId,started_at:startedAt});
      expect(f.sdkSnapshot()).toEqual(before);expect(providerEntries).toBe(entries);expect(toolEntries).toBe(0);
      await f.runtime.abortMessages(f.binding);expect(providerEntries).toBe(entries);
    }else{
      f.base.host.toolHold=barrier();f.base.host.modelHold.release();await f.base.host.toolEntered.promise;
      const replacement=await attach();await replacement.tool.promise;
      expect(replacement.store.get(f.chat)).toMatchObject({tool_name:'host_effect',status:'running',active_tool_count:1});expect(f.base.host.effects).toBe(0);
      const before=f.sdkSnapshot();replacement.store.update('other-chat-1',{type:'thinking'});replacement.store.update('other-chat-2',{type:'thinking'});expect(replacement.store.get(f.chat)).toBeNull();
      expect((await f.runtime.messageSubmissionStatus(pending))?.id).toBe(id);
      await replacement.stop();replacement.store.dispose();const fresh=await attach();await fresh.tool.promise;
      expect(fresh.store.get(f.chat)).toMatchObject({tool_name:'host_effect',status:'running',active_tool_count:1,started_at:startedAt});expect(f.sdkSnapshot()).toEqual(before);expect(providerEntries).toBe(2);expect(toolEntries).toBe(1);
      if(phase==='tool-restart'){
        await fresh.stop();fresh.store.dispose();await f.reopen();const paused=f.sdkSnapshot(),entries=providerEntries;
        const reopened=await attach();expect(reopened.store.get(f.chat)).toMatchObject({operation_id:runId,started_at:startedAt});expect(f.sdkSnapshot()).toEqual(paused);expect(providerEntries).toBe(entries);expect(toolEntries).toBe(1);expect(f.base.host.effects).toBe(0);
        expect((await f.runtime.inspectAuthority()).inspection.scheduling).toBe('paused');
        await f.runtime.abortMessages(f.binding);expect(providerEntries).toBe(entries);expect(toolEntries).toBe(1);
      }else{
        f.base.host.toolHold.release();expect((await f.runtime.waitForMessage(pending,id)).status).toBe('done');expect(f.base.host.effects).toBe(1);expect(toolEntries).toBe(1);
      }
    }
    expect(getRouterState('last_agent_timestamp_web')).toBe(history);expect(getRouterState('web:oobe:provider-ready:completed')).toBe('true');expect(extensionKvGet<typeof preferences>('native-ui-projection-fixture','preferences','global')).toEqual(preferences);
    expect(await f.runtime.submitMessage(first)).toBe(firstId);expect(f.base.host.credentialLookups).toBe(0);
    expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
  }finally{f.base.host.modelHold?.release();f.base.host.toolHold?.release();for(const stop of stops.reverse())await stop();for(const store of stores)store.dispose();await f.close();}
},30000);

applicationTest('tool-owned summaries survive actual native live, historical and nested projection without execution or model metadata leakage',async()=>{
  const {defineExtension,defineTool}=await import('../../runtime/durable-engine/qualification/durable.js');
  const {createProvider,createAssistantMessageEventStream,Type}=await import('../../runtime/durable-engine/qualification/ai.js');
  const {toolCallSummary}=await import('../../runtime/src/tool-call-summary.js');
  const {projectTurnActivity}=await import('../../runtime/src/channels/web/agent/turn-activity.js');
  const f=await nativeMessageFixture();let stop:(()=>Promise<void>)|undefined,rogue=0;
  const events:Record<string,any>[]=[],declarationKeys:string[][]=[];
  try{
    const prior=f.base.registry.snapshot().extension('qualification')!;
    const effect=prior.tools!.find(tool=>tool.name==='host_effect')!;
    const child=defineTool({...effect,callers:['model','tools'],...toolCallSummary(()=> 'add-on child caption')});
    const parent=defineTool({name:'summary_parent',description:'Synthetic nested-call probe',parameters:Type.Object({}),
      ...toolCallSummary(()=> 'add-on parent caption'),async execute(_args,api,ctx){
        await api.executeTool('host_effect',{value:'nested'},ctx);
        return{output:[{type:'text' as const,text:'nested complete'}],details:{calls:[{name:'host_effect',args:{value:'nested'},status:'ok'}]}};
      }});
    const selected=defineExtension({...prior,tools:[child,parent]});f.base.registry.install(selected);
    // Same name elsewhere in the registry must never supply this chat's caption.
    f.base.registry.install(defineExtension({name:'unselected-summary-owner',tools:[defineTool({...effect,
      ...toolCallSummary(()=>{rogue++;return 'wrong owner';})})]}));
    await f.base.root.configure({extensions:[selected],tools:[child,parent]},context);
    const model=f.base.models.getModel('qualification','synthetic')!;
    const stream=(_model:any,input:any)=>{
      declarationKeys.push(...input.messages.flatMap((message:any)=>message.role==='system'?(message.toolsAdded??[]):[]).map((tool:any)=>Object.keys(tool)));
      f.base.host.modelCalls++;
      const call=input.messages.findLast((message:any)=>message.role!=='system')?.role==='user';
      const message:any={role:'assistant',api:model.api,provider:model.provider,model:model.id,
        content:call?[{type:'toolCall',id:'summary-parent',name:'summary_parent',arguments:{}}]:[{type:'text',text:'done'}],
        stopReason:call?'toolUse':'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
      const output=createAssistantMessageEventStream();output.push({type:'done',reason:call?'toolUse':'stop',message});output.end(message);return output;
    };
    f.base.models.setProvider(createProvider({id:model.provider,models:[model],auth:{apiKey:{name:'keyless',resolve:async()=>({auth:{},source:'fixture'})}},api:{stream,streamSimple:stream}}));
    f.base.host.toolHold=barrier();await f.open();
    const render=createNativeTurnView(f.root,{broadcastEvent(event,data){if(event==='agent_status')events.push(data);}},f.chat);
    stop=await f.runtime.watchSession(f.binding,(view,startedAt,summaries)=>render(view,startedAt,summaries));
    const input=f.accept('run the summary probe'),id=await f.runtime.submitMessage(input);
    await f.base.host.toolEntered.promise;
    const until=Date.now()+5000;while(!events.some(event=>event.tool_name==='host_effect'&&event.title==='host_effect: add-on child caption')&&Date.now()<until)await Bun.sleep(5);
    expect(events.some(event=>event.tool_name==='summary_parent'&&event.title==='summary_parent: add-on parent caption')).toBe(true);
    expect(events.some(event=>event.tool_name==='host_effect'&&event.title==='host_effect: add-on child caption')).toBe(true);
    expect(f.base.host.effects).toBe(0);expect(rogue).toBe(0);
    f.base.host.toolHold.release();expect((await f.runtime.waitForMessage(input,id)).status).toBe('done');
    const before=f.sdkSnapshot(),turn=(await f.runtime.readTurnEntries(f.binding))!;
    const activity=projectTurnActivity(turn,null),step=activity.steps.find(step=>step.tool?.name==='summary_parent')!;
    expect(step.tool!.title).toBe('summary_parent: add-on parent caption');
    expect(step.tool!.nested?.[0].title).toBe('host_effect: add-on child caption');
    expect(JSON.stringify(turn.entries)).not.toContain('add-on child caption');
    expect(f.sdkSnapshot()).toEqual(before);expect(rogue).toBe(0);expect(f.base.host.effects).toBe(1);
    expect(declarationKeys.length).toBeGreaterThan(0);
    expect(declarationKeys.every(keys=>!keys.includes('callSummary')&&!keys.includes('execute'))).toBe(true);
  }finally{f.base.host.toolHold?.release();await stop?.();await f.close();}
},30000);
