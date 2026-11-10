import './src/test-guard.js';
import {expect,spyOn,test} from 'bun:test';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {barrier,context} from './src/fixture.js';
import {createApplicationBootstrapBundle} from '../../runtime/durable-engine/src/application-bootstrap.js';
import {AgentPool} from '../../runtime/src/agent-pool.js';
import {createTask,updateTask,getTaskRunLogs} from '../../runtime/src/db/tasks.js';
import {startSchedulerLoop,stopSchedulerLoop,pollScheduledRunsOnce,type SchedulerDeps} from '../../runtime/src/task-scheduler.js';
import * as stores from '../../runtime/src/service-effects/current-piclaw/scheduled-run-store.js';
import {InMemoryEffectPayloadResolver} from '../../runtime/src/service-effects/testing/in-memory-payload-resolver.js';
import type {HostConversationRuntime,AcceptedInput} from '../../runtime/durable-engine/src/host-runtime.js';
import type {ScheduledRunLease,ScheduledRunStore} from '../../runtime/src/service-effects/contracts/scheduled-run-store.js';
import {createAgentPoolModelOptions} from '../../runtime/test/model-services-fixture.js';
import Database from 'bun:sqlite';
import {AgentQueue} from '../../runtime/src/queue.js';
import {nativeGoalFixture} from './src/native-goal-default-fixture.js';
import {taskModelRequestScope} from '../../runtime/durable-engine/src/task-model-boundary-shim.js';
async function until(check:()=>boolean,ms=15000){const end=Date.now()+ms;while(!check()){if(Date.now()>=end)throw Error('Production scheduled boundary not reached');await Bun.sleep(10);}}
test('default factory scheduled execution uses native SDK authority and leaves host execution/terminal ownership absent',async()=>{
  await stopSchedulerLoop();const f=await nativeGoalFixture();const sent:string[]=[];let stop:(()=>Promise<void>)|undefined;
  try{
    const due=new Date(Date.now()-1000).toISOString();createTask({id:'default-native-scheduled',chat_jid:'web:default',prompt:'Produce the original native result',task_kind:'agent',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
    stop=startSchedulerLoop({queue:{enqueueTask(){throw Error('Host queue cannot place native scheduled work');}},agentPool:f.pool,sendMessage:async(_chat:string,text:string)=>{expect(getTaskRunLogs('default-native-scheduled')).toHaveLength(1);sent.push(text);}}as unknown as SchedulerDeps);
    await f.entered.promise;expect(f.calls()).toBe(1);expect(f.root.query('SELECT harness_session_id,harness_operation_id FROM service_effect_s01_operations').get()).toEqual({harness_session_id:null,harness_operation_id:null});
    expect(f.root.query("SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid='web:default'").get()).toEqual({active_operation_id:null});
    f.held.release();await until(()=>sent.length===1);await stop();
    expect(sent).toEqual(['Ordinary native reply']);expect(getTaskRunLogs('default-native-scheduled')[0]?.result).toBe('Ordinary native reply');expect(f.calls()).toBe(1);
    expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);expect(f.root.query('SELECT * FROM messages WHERE is_bot_message=1').all()).toEqual([]);
    expect(f.root.query("SELECT count(*) n FROM token_usage").get()).toEqual({n:1});
    const entries=f.root.query('SELECT * FROM entries ORDER BY id').all(),submissions=f.root.query('SELECT * FROM submissions ORDER BY id').all();await f.reopen();
    expect(f.calls()).toBe(1);expect(f.root.query('SELECT * FROM entries ORDER BY id').all()).toEqual(entries);expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(submissions);
    expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{f.held.release();await stop?.();await stopSchedulerLoop();await f.close();}
},30000);

test('one hundred SDK-scheduled agents bypass a held host lane and renew through a real six-second writer outage',async()=>{
  await stopSchedulerLoop();const f=await nativeMessageFixture(),queue=new AgentQueue(),hold=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>(),closed=Promise.withResolvers<void>();
  let bundle:Awaited<ReturnType<typeof createApplicationBootstrapBundle>>|undefined,pool:AgentPool|undefined,stop:(()=>Promise<void>)|undefined,writer:Database|undefined,unlock:ReturnType<typeof setTimeout>|undefined;
  let timerSpy:ReturnType<typeof spyOn>|undefined,factorySpy:ReturnType<typeof spyOn>|undefined,closeSpy:ReturnType<typeof spyOn>|undefined;
  const renewals:Array<()=>Promise<void>>=[],outcomes:Array<{runId:string;result:Awaited<ReturnType<ScheduledRunStore['renew']>>}>=[],requests=new Map<string,Set<string>>(),sent:string[]=[],factory=stores.createCurrentPiclawScheduledRunStore;
  try{
    await f.base.close();const resolver=new InMemoryEffectPayloadResolver();
    bundle=await createApplicationBootstrapBundle({root:f.root,path:(f.root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file,ownership:{borrow:()=>f.ownerLease()},manifest:[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}],sessions:new Map([[f.chat,'fixture-session']]),offlineInitialize:true,runtime:{incarnation:f.domain,sessionId:'fixture-session',now:()=>new Date().toISOString(),harnessOptions:f.options.harnessOptions},answers:{resolver,put:(ref,text)=>{resolver.putText(ref,text);}}},context);
    pool=new AgentPool({...createAgentPoolModelOptions(),...bundle.sessionOptions});f.base.host.modelHold=barrier();
    queue.enqueue(async()=>{entered.resolve();await hold.promise;},'held-host-user-lane',`chat:${f.chat}`);await entered.promise;
    factorySpy=spyOn(stores,'createCurrentPiclawScheduledRunStore').mockImplementation((database,options)=>{
      const made=factory(database,options);if(made.ok){const close=database.close.bind(database);closeSpy=spyOn(database,'close').mockImplementation(()=>{close();closed.resolve();});const renew=made.value.renew.bind(made.value);made.value.renew=async(request,scope)=>{const identities=requests.get(request.runId)??new Set<string>();identities.add(JSON.stringify(request));requests.set(request.runId,identities);const result=await renew(request,scope);outcomes.push({runId:request.runId,result});return result;};}return made;
    });
    // One explicitly invoked renewal round; real acquisition and expiry clocks remain intact.
    const original=globalThis.setTimeout;timerSpy=spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,delay:number,...args:any[])=>{const t=original(fn,delay,...args);if(delay===20000){clearTimeout(t);renewals.push(async()=>{await fn(...args);});}return t;})as any);
    const due=new Date(Date.now()-1000).toISOString();for(let i=0;i<100;i++)createTask({id:`native-capacity:${i}`,chat_jid:f.chat,prompt:'independent scheduled result',task_kind:'agent',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
    stop=startSchedulerLoop({queue,agentPool:pool,sendMessage:async(_chat,text)=>{sent.push(text);}}as SchedulerDeps);
    await until(()=>(f.root.query("SELECT count(*) n FROM submissions WHERE json_extract(request_id,'$') LIKE 'scheduled:%'").get() as {n:number}).n===100,30000);
    await stop();expect(queue.getMetrics().enqueued).toBe(1);expect(queue.getMetrics().started).toBe(1);expect(f.base.host.modelCalls).toBe(0);expect(renewals).toHaveLength(100);
    expect(f.root.query('SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?').get(f.chat)).toEqual({active_operation_id:null});
    expect(f.root.query('SELECT count(*) n FROM service_effect_s01_operations WHERE harness_operation_id IS NOT NULL').get()).toEqual({n:0});
    const before=f.root.query('SELECT run_id,attempt,worker_id,lease_token_hash,lease_expires_at FROM service_effect_s07_occurrences ORDER BY run_id').all() as {run_id:string;attempt:number;worker_id:string;lease_token_hash:string;lease_expires_at:string}[];
    const path=(f.root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;writer=new Database(path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');let released=false,ticks=0;
    const pulse=setInterval(()=>ticks++,10);unlock=setTimeout(()=>{writer!.exec('ROLLBACK');released=true;},6000);
    try{await Promise.all(renewals.slice().map(run=>run()));}finally{clearInterval(pulse);}
    expect(released).toBe(true);
    const failed=outcomes.filter(({result})=>!result.ok),succeeded=outcomes.filter(({result})=>result.ok);
    expect(new Set(failed.map(r=>r.runId))).toEqual(new Set(before.map(r=>r.run_id)));
    expect(failed.every(({result:r})=>!r.ok&&r.error._tag==='storage_unavailable'&&r.error.certainty==='not_applied'&&r.error.retryable)).toBe(true);
    expect(succeeded).toHaveLength(100);expect(new Set(succeeded.map(r=>r.runId)).size).toBe(100);
    expect(requests.size).toBe(100);expect([...requests.values()].every(identities=>identities.size===1)).toBe(true);expect(ticks).toBeGreaterThan(50);
    expect(f.root.query('SELECT count(*) n FROM service_effect_s07_lease_renewals').get()).toEqual({n:100});
    const after=f.root.query('SELECT run_id,attempt,worker_id,lease_token_hash,lease_expires_at FROM service_effect_s07_occurrences ORDER BY run_id').all() as typeof before;
    expect(after.map(({lease_expires_at:_expiry,...identity})=>identity)).toEqual(before.map(({lease_expires_at:_expiry,...identity})=>identity));expect(after.every((row,i)=>row.lease_expires_at>before[i]!.lease_expires_at)).toBe(true);
    expect(sent).toEqual([]);expect(f.base.host.modelCalls).toBe(0);f.base.host.modelHold.release();await closed.promise;
    expect(sent).toHaveLength(100);expect(f.base.host.modelCalls).toBe(100);expect(f.root.query('SELECT count(*) n FROM task_run_logs').get()).toEqual({n:100});expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
    expect(f.root.query('SELECT count(*) n FROM entries WHERE conversation_id=?').get(f.base.root.id)).toEqual({n:0});expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{
    if(unlock)clearTimeout(unlock);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();await stop?.();await stopSchedulerLoop();const closing=bundle?.close();f.base.host.modelHold?.release();hold.resolve();await closing;await pool?.shutdown();await queue.shutdown();timerSpy?.mockRestore();factorySpy?.mockRestore();closeSpy?.mockRestore();await f.close();
  }
},120000);

const modes=['success','conflict','actual-expiry','pause-before-run','revision-before-run','pause-pending-model','revision-pending-model','pause-pending-tool','revision-pending-tool'] as const;
for(const mode of modes)test(`direct production scheduled SDK invocation: ${mode}`,async()=>{
  await stopSchedulerLoop();
  const f=await nativeMessageFixture(),resolver=new InMemoryEffectPayloadResolver(),closed=Promise.withResolvers<void>();
  let bundle:Awaited<ReturnType<typeof createApplicationBootstrapBundle>>|undefined,pool:AgentPool|undefined;
  let runtime!:HostConversationRuntime,captured:AcceptedInput|undefined,submission:number|undefined,lease:ScheduledRunLease|undefined;
  let timerSpy:ReturnType<typeof spyOn>|undefined,factorySpy:ReturnType<typeof spyOn>|undefined,inputSpy:ReturnType<typeof spyOn>|undefined,closeSpy:ReturnType<typeof spyOn>|undefined;
  let writer:Database|undefined,unlock:ReturnType<typeof setTimeout>|undefined,expiry=0,revoke=false,stop:(()=>Promise<void>)|undefined;
  let toolSignal:AbortSignal|undefined,scheduledSignal:AbortSignal|undefined,expiryObservation:Promise<{leaseAborted:boolean;aborted:boolean;writerHeld:boolean}>|undefined;
  const renewals:Array<()=>Promise<void>>=[],sent:string[]=[],factory=stores.createCurrentPiclawScheduledRunStore;
  const before=mode.endsWith('before-run'),pendingModel=mode.endsWith('pending-model'),success=mode==='success';
  const mutateHead=()=>updateTask('task:production-sdk',mode.startsWith('pause')?{status:'paused'}:{prompt:'new revision must not be overwritten'});
  try{
    await f.base.close();
    bundle=await createApplicationBootstrapBundle({root:f.root,path:(f.root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file,
      ownership:{borrow:()=>f.ownerLease()},manifest:[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}],sessions:new Map([[f.chat,'fixture-session']]),offlineInitialize:true,
      // Match the default factory's existing lifetime-bound SQL contention policy.
      // Pi1.5 defers streaming progress; the finite offline-construction policy
      // would fail that background store before the real60s lease expires.
      contentionSignal:new AbortController().signal,
      runtime:{incarnation:f.domain,sessionId:'fixture-session',now:()=>new Date().toISOString(),harnessOptions:f.options.harnessOptions},answers:{resolver,put:(ref,text)=>{resolver.putText(ref,text);}},onRuntime:r=>{runtime=r;}},context);
    const direct=runtime.runScheduledInput.bind(runtime);
    inputSpy=spyOn(runtime,'runScheduledInput').mockImplementation((input,id,signal)=>{captured=input;submission=id;scheduledSignal=signal;return direct(input,id,signal);});
    pool=new AgentPool({...createAgentPoolModelOptions(),...bundle.sessionOptions});
    f.base.host.onToolEnter=signal=>{toolSignal=signal;};
    if(pendingModel)f.base.host.modelHold=barrier();else if(!success&&!before)f.base.host.toolHold=barrier();
    factorySpy=spyOn(stores,'createCurrentPiclawScheduledRunStore').mockImplementation((database,options)=>{
      const made=factory(database,options);
      if(made.ok){
        const close=database.close.bind(database);closeSpy=spyOn(database,'close').mockImplementation(()=>{close();closed.resolve();});
        const renew=made.value.renew.bind(made.value);made.value.renew=(request,scope)=>renew(revoke?{...request,leaseToken:'revoked-test-token'}:request,scope);
        const claim=made.value.claimDue.bind(made.value);made.value.claimDue=async request=>{
          const result=await claim(request);if(result.ok&&result.value.length){
            lease=result.value[0]!;const conversations=f.root.query('SELECT count(*) n FROM conversations').get();
            for(const forged of [lease,{...lease,record:{...lease.record,attempt:lease.record.attempt+1}},{...lease,task:{...lease.task,kind:'shell' as const}}])await expect(bundle!.sessionOptions.dispatchScheduledAgent!(forged)).rejects.toThrow();
            expect(f.root.query('SELECT count(*) n FROM conversations').get()).toEqual(conversations);expect(f.base.host.modelCalls).toBe(0);
            if(before)mutateHead();
          }return result;
        };
      }return made;
    });
    const original=globalThis.setTimeout;timerSpy=spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,delay:number,...args:any[])=>{const timer=original(fn,delay,...args);if(delay===20000)renewals.push(async()=>{clearTimeout(timer);await fn(...args);});return timer;})as any);
    const due=new Date(Date.now()-1000).toISOString();createTask({id:'task:production-sdk',chat_jid:f.chat,prompt:success||pendingModel?'native scheduled answer':'use-tool',task_kind:'agent',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
    const deps={queue:{enqueueTask(){throw Error('Native scheduled input must not enter a host execution lane');}},agentPool:pool,sendMessage:async(_chat:string,text:string)=>{expect(getTaskRunLogs('task:production-sdk')).toHaveLength(1);sent.push(text);}}as unknown as SchedulerDeps;
    stop=startSchedulerLoop(deps);
    await until(()=>before?!!f.root.query("SELECT 1 FROM service_effect_s07_occurrences WHERE state='abandoned'").get():captured!==undefined);
    expect(renewals).toHaveLength(1);await stop();
    if(!success&&!before){
      if(pendingModel)await until(()=>f.base.host.transcripts.length>0);else{await f.base.host.toolEntered.promise;expect(toolSignal).toBeInstanceOf(AbortSignal);}
      expect(f.base.host.effects).toBe(0);
      if(mode==='conflict'){revoke=true;await renewals[0]!();}
      else if(mode==='actual-expiry'){
        expiry=Date.parse((f.root.query('SELECT lease_expires_at FROM service_effect_s07_occurrences').get() as {lease_expires_at:string}).lease_expires_at);
        const file=(f.root.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(row=>row.name==='main')!.file;
        writer=new Database(file);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');expiryObservation=new Promise(resolve=>setTimeout(()=>resolve({leaseAborted:scheduledSignal?.aborted===true,aborted:toolSignal?.aborted===true,writerHeld:writer!.inTransaction}),Math.max(0,expiry-Date.now())+100));unlock=setTimeout(()=>writer!.exec('ROLLBACK'),Math.max(0,expiry-Date.now())+250);
      }else{mutateHead();await renewals[0]!();}
    }
    await closed.promise;
    if(success){
      expect(sent).toEqual(['synthetic answer']);expect(getTaskRunLogs('task:production-sdk')).toHaveLength(1);
      expect(f.root.query('SELECT harness_session_id,harness_operation_id FROM service_effect_s01_operations').get()).toEqual({harness_session_id:null,harness_operation_id:null});
      expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);
      const calls=f.base.host.modelCalls,entries=f.root.query('SELECT count(*) n FROM entries').get();
      expect(await direct(captured!,submission as any,AbortSignal.abort())).toMatchObject({status:'success',result:'synthetic answer'});
      for(const change of [{conversationId:f.base.root.id},{incarnation:'foreign'},{requestHash:'forged'},{sourceId:'scheduled_run:'+'f'.repeat(64)}])await expect(Promise.resolve().then(()=>direct({...captured!,...change},submission as any))).rejects.toThrow();
      expect(f.base.host.modelCalls).toBe(calls);expect(f.root.query('SELECT count(*) n FROM entries').get()).toEqual(entries);
    }else{
      expect(sent).toEqual([]);expect(getTaskRunLogs('task:production-sdk')).toEqual([]);expect(f.base.host.effects).toBe(0);expect(f.base.host.modelCalls).toBe(before||pendingModel?0:1);
      const records=f.root.query("SELECT status FROM submissions WHERE json_extract(request_id,'$') LIKE 'scheduled:%'").all();expect(records).toEqual(before?[]:[{status:'unanswered'}]);
      if(mode==='actual-expiry'){expect(Date.now()).toBeGreaterThanOrEqual(expiry);expect(writer!.inTransaction).toBe(false);expect(await expiryObservation).toEqual({leaseAborted:true,aborted:true,writerHeld:true});}
      if(mode.startsWith('revision'))expect(f.root.query("SELECT current_revision FROM service_effect_s07_tasks WHERE task_id='task:production-sdk'").get()).toEqual({current_revision:2});
    }
    if(mode==='actual-expiry'){
      const records=f.root.query('SELECT * FROM submissions ORDER BY id').all(),modelCalls=f.base.host.modelCalls;
      const unproven=stores.createCurrentPiclawScheduledRunStore(f.root,{hitFault:()=>false,recordTrace(){}});if(!unproven.ok)throw Error('Missing unproven reconciliation store');
      await pollScheduledRunsOnce(deps,unproven.value);
      expect(f.root.query('SELECT state FROM service_effect_s07_occurrences').get()).toEqual({state:'source_bound'});expect(getTaskRunLogs('task:production-sdk')).toEqual([]);
      let proofCalls=0;const proven=stores.createCurrentPiclawScheduledRunStore(f.root,{hitFault:()=>false,recordTrace(){},prepareInterruptedHarness:async identity=>{proofCalls++;return runtime.captureInterruptedScheduledHarness(identity);}});if(!proven.ok)throw Error('Missing SDK-proof reconciliation store');
      f.root.query('UPDATE piclaw_durable_bindings_v1 SET submission_id=NULL WHERE source_id=?').run(captured!.sourceId);
      await pollScheduledRunsOnce(deps,proven.value);expect(proofCalls).toBe(0);expect(getTaskRunLogs('task:production-sdk')).toEqual([]);
      f.root.query('UPDATE piclaw_durable_bindings_v1 SET submission_id=? WHERE source_id=?').run(submission!,captured!.sourceId);
      await pollScheduledRunsOnce(deps,proven.value);expect(proofCalls).toBe(1);
      expect(f.root.query('SELECT state,result_status,error_code FROM service_effect_s07_occurrences').get()).toEqual({state:'completed',result_status:'error',error_code:'scheduled_run_interrupted'});
      expect(f.root.query('SELECT count(*) n FROM service_effect_s07_run_logs').get()).toEqual({n:1});expect(getTaskRunLogs('task:production-sdk')).toEqual([]);expect(sent).toEqual([]);expect(f.base.host.modelCalls).toBe(modelCalls);expect(f.base.host.effects).toBe(0);
      await pollScheduledRunsOnce(deps,proven.value);expect(f.root.query('SELECT count(*) n FROM service_effect_s07_run_logs').get()).toEqual({n:1});expect(f.root.query('SELECT * FROM submissions ORDER BY id').all()).toEqual(records);
    }
    expect(lease).toBeDefined();expect(f.root.query('SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?').get(f.chat)).toEqual(before?null:{active_operation_id:null});
    expect(f.base.host.credentialLookups).toBe(0);expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{
    if(unlock)clearTimeout(unlock);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();
    await stop?.();await stopSchedulerLoop();const closing=bundle?.close();f.base.host.modelHold?.release();f.base.host.toolHold?.release();await closing;await pool?.shutdown();
    timerSpy?.mockRestore();factorySpy?.mockRestore();inputSpy?.mockRestore();closeSpy?.mockRestore();await f.close();
  }
},90000);


for(const stage of ['model','tool'] as const)test(`scoped cancellation aborts only its scheduled ${stage} while a writer is held; sibling continues and cleanup joins`,async()=>{
  await stopSchedulerLoop();const f=await nativeMessageFixture(),cancel=new AbortController(),signals=new Map<string,AbortSignal>(),inputs=new Map<string,AcceptedInput>(),held=barrier(),closed=Promise.withResolvers<void>();
  let bundle:Awaited<ReturnType<typeof createApplicationBootstrapBundle>>|undefined,pool:AgentPool|undefined,runtime!:HostConversationRuntime,stop:(()=>Promise<void>)|undefined,writer:Database|undefined;
  let dispatchSpy:ReturnType<typeof spyOn>|undefined,inputSpy:ReturnType<typeof spyOn>|undefined,factorySpy:ReturnType<typeof spyOn>|undefined,closeSpy:ReturnType<typeof spyOn>|undefined;
  const factory=stores.createCurrentPiclawScheduledRunStore,sent:string[]=[];let returned=0;
  try{
    await f.base.close();const resolver=new InMemoryEffectPayloadResolver();
    bundle=await createApplicationBootstrapBundle({root:f.root,path:(f.root.query('PRAGMA database_list').all()as {name:string;file:string}[]).find(row=>row.name==='main')!.file,ownership:{borrow:()=>f.ownerLease()},manifest:[{chatJid:f.chat,branchId:'main',conversationId:f.base.root.id}],sessions:new Map([[f.chat,'fixture-session']]),offlineInitialize:true,runtime:{incarnation:f.domain,sessionId:'fixture-session',now:()=>new Date().toISOString(),harnessOptions:f.options.harnessOptions},answers:{resolver,put:(ref,text)=>{resolver.putText(ref,text);}},onRuntime:r=>{runtime=r;}},context);
    const run=runtime.runScheduledInput.bind(runtime);inputSpy=spyOn(runtime,'runScheduledInput').mockImplementation((input,id,signal)=>{inputs.set(input.sourceId,input);return run(input,id,signal);});
    pool=new AgentPool({...createAgentPoolModelOptions(),...bundle.sessionOptions});const dispatch=pool.dispatchScheduledAgent.bind(pool);
    dispatchSpy=spyOn(pool,'dispatchScheduledAgent').mockImplementation((lease,options)=>{const signal=lease.record.taskId==='a-cancel'?AbortSignal.any([options!.signal!,cancel.signal]):options!.signal;return dispatch(lease,{signal})!.finally(()=>returned++);});
    const capture=(signal:AbortSignal|undefined,conversationId:number|undefined)=>{if(!conversationId||!signal)throw Error('Missing scoped tool execution');const binding=f.root.query('SELECT source_id FROM piclaw_durable_bindings_v1 WHERE conversation_id=?').get(conversationId)as {source_id:string};signals.set(binding.source_id,signal);};
    if(stage==='tool'){f.base.host.toolHold=held;f.base.host.onToolEnter=capture;}else{f.base.host.modelHold=held;f.base.host.onModelEnter=signal=>capture(signal,taskModelRequestScope(signal)?.conversationId);}
    factorySpy=spyOn(stores,'createCurrentPiclawScheduledRunStore').mockImplementation((db,options)=>{const result=factory(db,options);if(result.ok){const close=db.close.bind(db);closeSpy=spyOn(db,'close').mockImplementation(()=>{close();closed.resolve();});}return result;});
    const due=new Date(Date.now()-1000).toISOString();for(const id of ['a-cancel','b-survive'])createTask({id,chat_jid:f.chat,prompt:stage==='tool'?'use-tool':'independent model result',task_kind:'agent',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
    stop=startSchedulerLoop({queue:{enqueueTask(){throw Error('Host lane must remain unused');}},agentPool:pool,sendMessage:async(_chat:string,text:string)=>{sent.push(text);}}as unknown as SchedulerDeps);
    await until(()=>signals.size===2);await stop();const rows=f.root.query('SELECT task_id,run_id FROM service_effect_s07_occurrences ORDER BY task_id').all()as {task_id:string;run_id:string}[],first=rows[0]!.run_id,second=rows[1]!.run_id;
    const input=inputs.get(first)!;let granted=false;
    for(const forged of [{...input,conversationId:f.base.root.id},{...input,sourceId:'scheduled_run:'+'f'.repeat(64)}])await expect(runtime.withScheduledCancellation(forged,new AbortController().signal,async()=>{granted=true;})).rejects.toThrow();
    await expect(runtime.withScheduledCancellation(input,new AbortController().signal,async()=>{granted=true;})).rejects.toThrow('already registered');expect(granted).toBe(false);
    writer=new Database((f.root.query('PRAGMA database_list').all()as {name:string;file:string}[]).find(row=>row.name==='main')!.file);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');cancel.abort(Error('cancel only first scheduled occurrence'));
    await until(()=>signals.get(first)!.aborted);expect(writer.inTransaction).toBe(true);expect(signals.get(second)!.aborted).toBe(false);expect(returned).toBe(0);expect(f.base.host.effects).toBe(0);expect(f.root.query('SELECT * FROM task_run_logs').all()).toEqual([]);
    writer.exec('ROLLBACK');await until(()=>returned===1);expect(signals.get(second)!.aborted).toBe(false);expect(f.base.host.effects).toBe(0);
    held.release();await closed.promise;expect(returned).toBe(2);expect(f.base.host.effects).toBe(stage==='tool'?1:0);expect(sent).toEqual(['synthetic answer']);
    expect(f.root.query('SELECT task_id,result_status FROM service_effect_s07_occurrences ORDER BY task_id').all()).toEqual([{task_id:'a-cancel',result_status:'error'},{task_id:'b-survive',result_status:'success'}]);
    expect(f.root.query('SELECT count(*) n FROM task_run_logs').get()).toEqual({n:2});expect(f.root.query('SELECT * FROM service_effect_s02_commits').all()).toEqual([]);expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();cancel.abort();held.release();await stop?.();await stopSchedulerLoop();await bundle?.close();await pool?.shutdown();dispatchSpy?.mockRestore();inputSpy?.mockRestore();factorySpy?.mockRestore();closeSpy?.mockRestore();await f.close();}
},30000);
