import './src/test-guard.js';
import {expect} from 'bun:test';
import {isolatedApplicationTest} from './src/isolated-application-test.js';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {barrier} from './src/fixture.js';
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
      const stop=await f.runtime.watchSession(f.binding,view=>{render(view);const live=view.docs['pi.live'] as any;inputs=live?.run?.inputs;if(live?.generation)generation.release();if(live?.tools?.some((slot:any)=>slot.name==='host_effect'&&slot.status==='running'))tool.release();});
      stops.push(stop);return {store,events,stop,generation,tool,get inputs(){return inputs;}};
    };
    const view=await attach();await view.generation.promise;
    expect(view.store.get(f.chat)).toMatchObject({type:'thinking',operation_id:runId});expect(view.inputs).toEqual([id]);
    const beforeContext=await f.runtime.readSessionContextUsage(f.binding);expect(beforeContext.contextWindow).toBe(100000);expect(beforeContext.tokens).toBeGreaterThan(0);
    await expect(f.runtime.watchSession({...f.binding,chatJid:'web:foreign'},()=>{throw Error('foreign publication');})).rejects.toThrow('Manifest conflict');
    await expect(f.runtime.readSessionContextUsage({...f.binding,incarnation:'stale'})).rejects.toThrow('Host binding conflict');
    await view.stop();view.store.dispose();
    if(phase==='generation'){
      await f.reopen();const entries=providerEntries,before=f.sdkSnapshot();
      expect(await f.runtime.readSessionContextUsage(f.binding)).toEqual(beforeContext);
      const restored=await attach();expect(restored.store.get(f.chat)).toMatchObject({operation_id:runId});
      expect(f.sdkSnapshot()).toEqual(before);expect(providerEntries).toBe(entries);expect(toolEntries).toBe(0);
      await f.runtime.abortMessages(f.binding);expect(providerEntries).toBe(entries);
    }else{
      f.base.host.toolHold=barrier();f.base.host.modelHold.release();await f.base.host.toolEntered.promise;
      const replacement=await attach();await replacement.tool.promise;
      expect(replacement.store.get(f.chat)).toMatchObject({tool_name:'host_effect',status:'running',active_tool_count:1});expect(f.base.host.effects).toBe(0);
      const before=f.sdkSnapshot();replacement.store.update('other-chat-1',{type:'thinking'});replacement.store.update('other-chat-2',{type:'thinking'});expect(replacement.store.get(f.chat)).toBeNull();
      expect((await f.runtime.messageSubmissionStatus(pending))?.id).toBe(id);
      await replacement.stop();replacement.store.dispose();const fresh=await attach();await fresh.tool.promise;
      expect(fresh.store.get(f.chat)).toMatchObject({tool_name:'host_effect',status:'running',active_tool_count:1});expect(f.sdkSnapshot()).toEqual(before);expect(providerEntries).toBe(2);expect(toolEntries).toBe(1);
      if(phase==='tool-restart'){
        await fresh.stop();fresh.store.dispose();await f.reopen();const paused=f.sdkSnapshot(),entries=providerEntries;
        const reopened=await attach();expect(reopened.store.get(f.chat)).toMatchObject({operation_id:runId});expect(f.sdkSnapshot()).toEqual(paused);expect(providerEntries).toBe(entries);expect(toolEntries).toBe(1);expect(f.base.host.effects).toBe(0);
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
