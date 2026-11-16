import './src/test-guard.js';
import {expect,test,spyOn} from 'bun:test';
import {join} from 'node:path';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {barrier,context} from './src/fixture.js';
import {createApplicationBootstrapBundle} from '../../runtime/durable-engine/src/application-bootstrap.js';
import {HostConversationRuntime,type AcceptedInput} from '../../runtime/durable-engine/src/host-runtime.js';
import {InMemoryEffectPayloadResolver} from '../../runtime/src/service-effects/testing/in-memory-payload-resolver.js';

test('native close joins an entered SDK admission return; process-idle excludes only its exact calling source',async()=>{
  const f=await nativeMessageFixture(),entered=barrier(),held=barrier(),model=barrier();
  f.base.host.modelHold=model;
  let input:AcceptedInput|undefined,runtime:HostConversationRuntime|undefined;
  const submit=HostConversationRuntime.prototype.submitMessage;
  const slow=spyOn(HostConversationRuntime.prototype,'submitMessage').mockImplementation(async function(this:HostConversationRuntime,...args:Parameters<typeof submit>){const id=await submit.apply(this,args);input=args[0];entered.release();await held.promise;return id;});
  let bundle:Awaited<ReturnType<typeof createApplicationBootstrapBundle>>|undefined;
  try{
    await f.base.close();const answers=new InMemoryEffectPayloadResolver();
    bundle=await createApplicationBootstrapBundle({root:f.root,path:join(f.identity.workspace.store,'messages.db'),
      ownership:{borrow(){let sealed=false;return {assertCurrentOwner(){if(sealed)throw Error('Borrowed owner sealed');f.options.owner.assert();},release(){sealed=true;}};}},
      manifest:[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}],sessions:new Map([[f.chat,'admission-close']]),offlineInitialize:true,
      onRuntime(value){runtime=value;},answers:{put(ref,text){answers.putText(ref,text);},resolver:answers},runtime:{incarnation:f.domain,sessionId:f.domain,now:()=>new Date().toISOString(),harnessOptions:f.options.harnessOptions}},context);
    const accepted=f.accept('Already accepted SDK work must not outlive its admission observer unchecked');
    const pending=bundle.dispatchAcceptedInput(f.chat,accepted.sourceId,Number(accepted.payloadRef.slice(12)));void pending.catch(()=>{});await entered.promise;
    expect(()=>bundle!.assertProcessControlIdle()).toThrow('active or uncertain');expect(()=>bundle!.assertProcessControlIdle(input!)).not.toThrow();expect(()=>bundle!.assertProcessControlIdle({...input!,sourceId:'other'})).toThrow('active or uncertain');
    const before=f.sdkSnapshot();bundle.stop();let finished=false;const closing=bundle.close().then(()=>{finished=true;});
    await Promise.resolve();expect(finished).toBe(false);expect((await runtime!.inspectAuthority()).inspection.tasks.length).toBeGreaterThan(0);expect(f.sdkSnapshot()).toEqual(before);
    held.release();await expect(pending).rejects.toThrow();await closing;expect(finished).toBe(true);
    expect(f.root.query('SELECT count(*) n FROM submissions').get()).toEqual({n:1});expect(f.root.query('SELECT count(*) n FROM messages').get()).toEqual({n:1});expect(f.root.query('SELECT * FROM service_effect_s01_operations').all()).toEqual([]);expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
  }finally{held.release();model.release();slow.mockRestore();await bundle?.close();await f.close();}
},15000);
