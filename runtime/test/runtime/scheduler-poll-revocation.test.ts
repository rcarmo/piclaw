import {expect,spyOn,test} from 'bun:test';
import Database from 'bun:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {initDatabase,closeDatabase,getDb} from '../../src/db/connection.js';
import {createTask,updateTask,getTaskRunLogs} from '../../src/db/tasks.js';
import * as stores from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import {scheduledResultRef} from '../../src/service-effects/current-piclaw/scheduled-history-projection.js';
import type {ScheduledRunStore,ScheduledRunLease} from '../../src/service-effects/contracts/scheduled-run-store.js';
import {hashCanonicalRequest,type CanonicalJsonValue} from '../../src/service-effects/contracts/common.js';
import {startSchedulerLoop,stopSchedulerLoop,type SchedulerDeps} from '../../src/task-scheduler.js';
import {readAccessConfig} from '../../src/core/config-access.js';
import {getRuntimeTimingConfig} from '../../src/core/config.js';

async function fixture(stage:'claim'|'expired-source'|'completed-source'){
  await stopSchedulerLoop();await closeDatabase();const ws=createTempWorkspace('scheduler-poll-revocation-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  const config=join(ws.workspace,'.piclaw/config.json');mkdirSync(join(ws.workspace,'.piclaw'),{recursive:true});writeFileSync(config,JSON.stringify({domains:{access:{mode:'single-user'}}}));
  try{
    process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');const path=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;
    expect(path).toContain(ws.store);expect(db.query('PRAGMA journal_mode').get()).toEqual({journal_mode:'wal'});
    const due=new Date(Date.now()-10000).toISOString(),id='task:revocation',chat='web:revocation';
    createTask({id,chat_jid:chat,prompt:'fixture',task_kind:stage==='claim'?'shell':'agent',command:stage==='claim'?"printf 'queue-owned'":undefined,cwd:stage==='claim'?'.':undefined,schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
    if(stage!=='claim'){
      const built=stores.createCurrentPiclawScheduledRunStore(db,{hitFault:()=>false,recordTrace(){}});if(!built.ok)throw Error(built.error._tag);
      const claimed=await built.value.claimDue({now:due,limit:100,workerId:'worker:revocation',leaseTokenPrefix:stage,leaseDurationMs:60000,reclaimAuthorities:[]});if(!claimed.ok)throw Error(claimed.error._tag);const lease=claimed.value[0]!,operation='operation:revocation',now=new Date().toISOString();
      db.transaction(()=>{
        db.query('INSERT INTO service_effect_s01_chats(chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id) VALUES(?,2,0,?)').run(chat,operation);
        db.query("INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,accepted_at,provenance_ref,create_wake_intent) VALUES(?,1,?,?,'scheduled_agent','claimed','payload:revocation',?,'fixture:revocation',0)").run(chat,lease.record.runId,'a'.repeat(64),now);
        db.query("INSERT INTO service_effect_s01_operations(operation_id,chat_jid,version,phase,primary_source_seq) VALUES(?,?,1,'claimed',1)").run(operation,chat);
        db.query('INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq) VALUES(?,?,1)').run(chat,operation);
      }).immediate();
      const effect={idempotencyKey:'bind:'+stage,requestHash:'',operationId:operation,sourceSeq:1,provenanceRef:lease.record.runId,redactionClass:'private' as const},fence={runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:1,expectedTaskRevision:1,leaseToken:lease.leaseToken,now};
      const binding={...fence,effect,sourceSeq:1,operationId:operation,boundAt:now};effect.requestHash=hashCanonicalRequest(binding as unknown as CanonicalJsonValue);const bound=await built.value.bindAcceptedSource(binding);if(!bound.ok)throw Error(bound.error._tag);
      if(stage==='expired-source'){
        const expiry=new Date(Date.now()-1000).toISOString();db.query('UPDATE service_effect_s07_occurrences SET lease_expires_at=? WHERE run_id=?').run(expiry,lease.record.runId);db.query('UPDATE service_effect_s07_leases SET lease_expires_at=? WHERE run_id=?').run(expiry,lease.record.runId);
      }else{
        const complete={...fence,effect:{...effect,idempotencyKey:'complete:'+stage,requestHash:''},status:'success' as const,durationMs:1,resultRef:scheduledResultRef(lease.record.runId),errorCode:null,completedAt:now,resultPayload:{version:1 as const,result:'retained successful outcome',error:null},outboxIntents:[]};complete.effect.requestHash=hashCanonicalRequest(complete as unknown as CanonicalJsonValue);const done=await built.value.complete(complete);if(!done.ok)throw Error(done.error._tag);
      }
    }
    const queued:Array<()=>Promise<void>>=[],pending=new Set<()=>Promise<void>>(),admitted=Promise.withResolvers<void>(),sent:string[]=[];let dispatches=0;
    const deps={queue:{enqueueTask(_id:string,run:()=>Promise<void>){const once=async()=>{if(!pending.delete(once))throw Error('fixture callback replay');await run();};pending.add(once);queued.push(once);admitted.resolve();}},agentPool:{isDurableRuntime:()=>true,dispatchScheduledAgent:async()=>{dispatches++;throw Error('must not dispatch an agent');}},sendMessage:async(_chat:string,text:string)=>{sent.push(text);}} as unknown as SchedulerDeps;
    const snapshot=()=>['service_effect_s01_chats','service_effect_s01_sources','service_effect_s01_operations','service_effect_s07_occurrences','service_effect_s07_leases','service_effect_s07_source_bindings','service_effect_s07_decisions','service_effect_s07_next_decisions','task_run_logs'].map(t=>db.query(`SELECT * FROM ${t} ORDER BY rowid`).all());
    return{db,path,config,deps,queued,admitted,sent,snapshot,dispatches:()=>dispatches,async close(){await stopSchedulerLoop();if(pending.size){process.env.PICLAW_STORE=ws.store;writeFileSync(config,JSON.stringify({domains:{access:{mode:'single-user'}}}));updateTask(id,{status:'paused'});for(const run of [...pending])await run();}await closeDatabase();restore();ws.cleanup();}};
  }catch(error){await stopSchedulerLoop();await closeDatabase();restore();ws.cleanup();throw error;}
}

for(const stage of ['claim','expired-source','completed-source'] as const)for(const revocation of ['stop','access','binding'] as const)test(`unentered ${stage} acquisition joins on ${revocation} while the real writer is still held`,async()=>{
  const f=await fixture(stage),attempted=Promise.withResolvers<void>(),closed=Promise.withResolvers<void>(),pollReturned=Promise.withResolvers<void>(),factory=stores.createCurrentPiclawScheduledRunStore;
  const spies:Array<ReturnType<typeof spyOn>>=[];let writer:Database|undefined,timer:ReturnType<typeof setTimeout>|undefined,attempts=0;
  function observe(database:Database){const transaction=database.transaction.bind(database);spies.push(spyOn(database,'transaction').mockImplementation((fn:any)=>{attempts++;attempted.resolve();return transaction(fn);}));}
  if(stage!=='claim')observe(f.db);
  const factorySpy=spyOn(stores,'createCurrentPiclawScheduledRunStore').mockImplementation((...args)=>{
    const database=args[0],close=database.close.bind(database);expect(database).not.toBe(f.db);
    if(stage==='claim')observe(database);
    spies.push(spyOn(database,'close').mockImplementation(()=>{const result=close();closed.resolve();return result;}));return factory(...args);
  });
  try{
    const before=f.snapshot();writer=new Database(f.path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');let released=false;
    if(revocation==='binding'){const timeout=globalThis.setTimeout;spies.push(spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,ms:number,...args:any[])=>{const timer=timeout(fn,ms,...args);if(ms===getRuntimeTimingConfig().schedulerPollIntervalMs)pollReturned.resolve();return timer;}) as any));}
    const stop=startSchedulerLoop(f.deps);await attempted.promise;expect(attempts).toBeGreaterThan(0);
    timer=setTimeout(()=>{writer!.exec('ROLLBACK');released=true;},1200);
    if(revocation==='stop'){const joined=stop();expect(stop()).toBe(joined);await joined;}
    else if(revocation==='access'){writeFileSync(f.config,JSON.stringify({domains:{access:{mode:'isolated-containers',isolation:{component:'backend',backendId:'fixture',ownerUserId:'fixture-owner',gatewayUrl:'https://gateway.invalid',verificationKeyRef:'fixture:verification'}}}}));expect(readAccessConfig().mode).toBe('isolated-containers');await closed.promise;}
    else{process.env.PICLAW_STORE=f.path+'.revoked-profile';await pollReturned.promise;await stop();}
    expect(released).toBe(false);expect(writer.inTransaction).toBe(true);expect(f.queued).toHaveLength(0);expect(f.dispatches()).toBe(0);expect(f.snapshot()).toEqual(before);
    const finalAttempts=attempts;await Bun.sleep(75);expect(attempts).toBe(finalAttempts);expect(writer.inTransaction).toBe(true);expect(f.db.query('PRAGMA busy_timeout').get()).toEqual({timeout:0});
  }finally{
    if(timer)clearTimeout(timer);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();
    for(const spy of spies.toReversed())spy.mockRestore();factorySpy.mockRestore();await f.close();
  }
},15000);

test('already accepted queue work keeps the original store alive and settles after poll stop',async()=>{
  const f=await fixture('claim'),factory=stores.createCurrentPiclawScheduledRunStore;let roleClosed=false,closeSpy:ReturnType<typeof spyOn>|undefined,store:ScheduledRunStore|undefined,lease:ScheduledRunLease|undefined,work:Promise<void>|undefined;
  const factorySpy=spyOn(stores,'createCurrentPiclawScheduledRunStore').mockImplementation((...args)=>{const database=args[0],close=database.close.bind(database);closeSpy=spyOn(database,'close').mockImplementation(()=>{const result=close();roleClosed=true;return result;});const result=factory(...args);if(result.ok){store=result.value;const claim=store.claimDue.bind(store);store.claimDue=async request=>{const r=await claim(request);if(r.ok)lease=r.value[0];return r;};}return result;});
  try{
    const stop=startSchedulerLoop(f.deps);await f.admitted.promise;await stop();expect(roleClosed).toBe(false);expect(f.queued).toHaveLength(1);expect(getTaskRunLogs('task:revocation')).toHaveLength(0);
    const l=lease!;expect(await store!.renew({runId:l.record.runId,workerId:l.record.workerId,expectedAttempt:l.record.attempt,expectedTaskRevision:l.record.taskRevision,leaseToken:l.leaseToken,now:new Date().toISOString(),leaseExpiresAt:new Date(Date.parse(l.record.leaseExpiresAt)+60000).toISOString()})).toMatchObject({ok:true});
    work=f.queued[0]!();await work;expect(roleClosed).toBe(true);expect(getTaskRunLogs('task:revocation')).toHaveLength(1);expect(getTaskRunLogs('task:revocation')[0]?.result).toBe('```\nqueue-owned\n```');expect(f.sent).toEqual(['```\nqueue-owned\n```']);expect(f.dispatches()).toBe(0);
    expect(f.db.query('SELECT state,attempt FROM service_effect_s07_occurrences').get()).toEqual({state:'completed',attempt:1});
  }finally{if(!work&&f.queued[0])work=f.queued[0]();await work;closeSpy?.mockRestore();factorySpy.mockRestore();await f.close();}
},15000);

test('a stopped waiting generation stays inert while its replacement claims after writer release',async()=>{
  const f=await fixture('claim'),factory=stores.createCurrentPiclawScheduledRunStore,attempted:Array<ReturnType<typeof Promise.withResolvers<void>>>=[],spies:Array<ReturnType<typeof spyOn>>=[];
  let writer:Database|undefined,timer:ReturnType<typeof setTimeout>|undefined,work:Promise<void>|undefined;
  const factorySpy=spyOn(stores,'createCurrentPiclawScheduledRunStore').mockImplementation((...args)=>{const database=args[0],transaction=database.transaction.bind(database),ready=Promise.withResolvers<void>();attempted.push(ready);spies.push(spyOn(database,'transaction').mockImplementation((fn:any)=>{ready.resolve();return transaction(fn);}));return factory(...args);});
  try{
    const before=f.snapshot();writer=new Database(f.path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');let released=false;
    const stopOld=startSchedulerLoop(f.deps);await attempted[0]!.promise;timer=setTimeout(()=>{writer!.exec('ROLLBACK');released=true;},1200);
    await stopOld();expect(released).toBe(false);expect(writer.inTransaction).toBe(true);expect(f.snapshot()).toEqual(before);expect(f.queued).toHaveLength(0);
    clearTimeout(timer);timer=undefined;
    const stopNew=startSchedulerLoop(f.deps);expect(stopNew).not.toBe(stopOld);expect(attempted).toHaveLength(2);await attempted[1]!.promise;
    writer.exec('ROLLBACK');await f.admitted.promise;await stopNew();expect(f.queued).toHaveLength(1);
    work=f.queued[0]!();await work;expect(getTaskRunLogs('task:revocation')).toHaveLength(1);expect(f.dispatches()).toBe(0);
    expect(f.db.query('SELECT state,attempt FROM service_effect_s07_occurrences').get()).toEqual({state:'completed',attempt:1});expect(f.db.query("SELECT count(*) AS n FROM service_effect_s07_decisions WHERE method='claimDue'").get()).toEqual({n:1});
  }finally{if(timer)clearTimeout(timer);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();if(!work&&f.queued[0])work=f.queued[0]();await work;for(const spy of spies.toReversed())spy.mockRestore();factorySpy.mockRestore();await f.close();}
},15000);

for (const revocation of ['stop', 'access', 'binding'] as const) test(`a captured native terminal-proof fence is revoked on ${revocation}`, async () => {
  const f = await fixture('claim'), factory = stores.createCurrentPiclawScheduledRunStore;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let runtime: Parameters<typeof factory>[1] | undefined, nativeChecks = 0;
  f.deps.agentPool.prepareInterruptedScheduledHarness = async () => { entered.resolve(); await release.promise; return () => { nativeChecks++; }; };
  const factorySpy = spyOn(stores, 'createCurrentPiclawScheduledRunStore').mockImplementation((...args) => { runtime = args[1]; return factory(...args); });
  try {
    const stop = startSchedulerLoop(f.deps); await f.admitted.promise;
    const capture = runtime!.prepareInterruptedHarness!({ sessionId: 'fixture', submissionId: '42', runId: 'fixture', operationId: 'fixture', sourceSeq: 1, chatJid: 'web:revocation' });
    await entered.promise;
    if (revocation === 'stop') await stop();
    else if (revocation === 'access') writeFileSync(f.config, JSON.stringify({ domains: { access: { mode: 'isolated-containers', isolation: { component: 'backend', backendId: 'fixture', ownerUserId: 'fixture-owner', gatewayUrl: 'https://gateway.invalid', verificationKeyRef: 'fixture:verification' } } } }));
    else process.env.PICLAW_STORE = f.path + '.revoked-profile';
    release.resolve();
    const fence = await capture;
    expect(fence).toBeDefined(); expect(fence!).toThrow();
    expect(nativeChecks).toBe(0);
  } finally { release.resolve(); factorySpy.mockRestore(); await f.close(); }
}, 15000);
