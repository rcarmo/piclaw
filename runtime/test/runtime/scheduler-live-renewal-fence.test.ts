import {expect,spyOn,test} from 'bun:test';
import Database from 'bun:sqlite';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {initDatabase,closeDatabase,getDb} from '../../src/db/connection.js';
import {createTask,updateTask,getTaskRunLogs} from '../../src/db/tasks.js';
import {createScheduledTaskAuthority} from '../../src/service-effects/current-piclaw/scheduled-task-authority.js';
import {installScheduledRunCompositionSchema} from '../../src/service-effects/current-piclaw/scheduled-run-schema.js';
import * as stores from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import type {ScheduledRunLease,ScheduledRunStore} from '../../src/service-effects/contracts/scheduled-run-store.js';
import {startSchedulerLoop,stopSchedulerLoop,type SchedulerDeps} from '../../src/task-scheduler.js';

function logicalFixture(checked:boolean){
  const ws=createTempWorkspace('scheduler-live-renewal-logical-'),db=new Database(ws.store+'/s07.sqlite');db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA busy_timeout=0');installScheduledRunCompositionSchema(db);
  let now='2026-08-16T01:00:10.000Z',lost=false,cross:null|stores.ScheduledRunStatement=null,clockCalls=0,renewalInserts=0;
  const runtime={hitFault(point:string,method:string){if(point==='effect_then_lost_acknowledgement'&&method==='renew'&&lost){lost=false;return true;}return false;},recordTrace(){},afterStatement(statement:string){if(statement==='renewal_insert')renewalInserts++;if(statement===cross)now='2026-08-16T01:01:00.000Z';},...(checked?{liveRenewalNow:()=>{clockCalls++;return now;}}:{})} as stores.ScheduledRunAdapterRuntime;
  const built=stores.createCurrentPiclawScheduledRunStore(db,runtime);if(!built.ok)throw Error(built.error._tag);
  const due='2026-08-16T01:00:00.000Z';createScheduledTaskAuthority(db).create({taskId:'task:logical',chatJid:'web:logical',kind:'shell',payloadRef:'fixture:logical',modelLabel:null,scheduleType:'once',scheduleValue:due,timezone:'UTC',notifyOnComplete:false,muted:true,cwd:null,timeoutSec:null,internalTask:null,redactionClass:'private',executionRepeatability:'repeatable',nextRunAt:due,authoredAt:due});
  const snapshot=()=>['service_effect_s07_occurrences','service_effect_s07_leases','service_effect_s07_lease_renewals','service_effect_s07_decisions'].map(t=>db.query(`SELECT * FROM ${t} ORDER BY rowid`).all());
  return{ws,db,store:built.value,due,snapshot,setNow(value:string){now=value;},setLost(){lost=true;},setCross(statement:stores.ScheduledRunStatement="renewal_insert"){cross=statement;},clockCalls:()=>clockCalls,renewalInserts:()=>renewalInserts,close(){db.close();ws.cleanup();}};
}
async function logicalLease(f:ReturnType<typeof logicalFixture>){const claim=await f.store.claimDue({now:f.due,limit:1,workerId:'worker:logical',leaseTokenPrefix:'logical',leaseDurationMs:60000,reclaimAuthorities:[]});if(!claim.ok||!claim.value[0])throw Error('Missing logical lease');return claim.value[0];}
function renewal(lease:ScheduledRunLease){return{runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:lease.record.attempt,expectedTaskRevision:lease.record.taskRevision,leaseToken:lease.leaseToken,now:'2026-08-16T01:00:10.000Z',leaseExpiresAt:'2026-08-16T01:02:00.000Z'};}

for (const point of ["renewal_insert","decision_insert"] as const) test(`expiry crossing at ${point} rolls back every write without callback replay`,async()=>{
  const f=logicalFixture(true);try{
    const lease=await logicalLease(f),request=renewal(lease),before=f.snapshot();f.setCross(point);
    const result=await f.store.renew(request);expect(result).toMatchObject({ok:false,error:{_tag:'lease_expired',certainty:'not_applied',retryable:false}});expect(f.snapshot()).toEqual(before);expect(f.clockCalls()).toBe(2);expect(f.renewalInserts()).toBe(1);expect(f.db.inTransaction).toBe(false);expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{f.close();}
});

test('a lost committed renewal acknowledgement replays the exact receipt without a fresh expiry check',async()=>{
  const f=logicalFixture(true);try{
    const lease=await logicalLease(f),request=renewal(lease);f.setLost();
    expect(await f.store.renew(request)).toMatchObject({ok:false,error:{_tag:'storage_unavailable',certainty:'unknown',retryable:true}});const committed=f.snapshot();expect(f.clockCalls()).toBe(2);
    f.setNow('2026-08-16T01:03:00.000Z');const replay=await f.store.renew(request);expect(replay).toMatchObject({ok:true,value:{record:{runId:lease.record.runId,leaseExpiresAt:request.leaseExpiresAt}}});expect(f.snapshot()).toEqual(committed);expect(f.clockCalls()).toBe(2);expect(f.db.query('SELECT count(*) AS n FROM service_effect_s07_lease_renewals').get()).toEqual({n:1});
    expect(await f.store.renew({...request,now:'2026-08-16T01:00:11.000Z'})).toMatchObject({ok:false,error:{_tag:'idempotency_conflict'}});
    expect(f.snapshot()).toEqual(committed);expect(f.clockCalls()).toBe(2);
  }finally{f.close();}
});

test('wrong lease attempt retains its existing conflict classification before the live clock',async()=>{
  const f=logicalFixture(true);try{
    const lease=await logicalLease(f),request={...renewal(lease),expectedAttempt:2},before=f.snapshot();expect(await f.store.renew(request)).toMatchObject({ok:false,error:{_tag:'lease_conflict',certainty:'not_applied',retryable:false}});expect(f.clockCalls()).toBe(0);expect(f.snapshot()).toEqual(before);
  }finally{f.close();}
});

test('generic offline S07 renewal retains its explicit logical clock and exact replay',async()=>{
  const f=logicalFixture(false);try{
    const lease=await logicalLease(f),request=renewal(lease),first=await f.store.renew(request);expect(first).toMatchObject({ok:true,value:{record:{leaseExpiresAt:request.leaseExpiresAt}}});const committed=f.snapshot();expect(await f.store.renew(request)).toEqual(first);expect(f.snapshot()).toEqual(committed);expect(f.clockCalls()).toBe(0);
  }finally{f.close();}
});

for(const late of [false,true])test(`production renewal ${late?'rejects writer-wait expiry':'succeeds before expiry and settles queued work after stop'}`,async()=>{
  await stopSchedulerLoop();await closeDatabase();const ws=createTempWorkspace('scheduler-live-renewal-production-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  const factory=stores.createCurrentPiclawScheduledRunStore,admitted=Promise.withResolvers<void>(),queued:Array<()=>Promise<void>>=[],captured:Array<()=>Promise<void>>=[],sent:string[]=[],statements:string[]=[];let roleStore:ScheduledRunStore|undefined,lease:ScheduledRunLease|undefined,renewResult:Awaited<ReturnType<ScheduledRunStore['renew']>>|undefined,work:Promise<void>|undefined,writer:Database|undefined,unlock:ReturnType<typeof setTimeout>|undefined,timerSpy:ReturnType<typeof spyOn>|undefined;
  const factorySpy=spyOn(stores,'createCurrentPiclawScheduledRunStore').mockImplementation((database,runtime)=>{const made=factory(database,{...runtime,afterStatement:point=>{statements.push(point);runtime.afterStatement?.(point);}});if(made.ok){roleStore=made.value;const claim=roleStore.claimDue.bind(roleStore),renew=roleStore.renew.bind(roleStore);roleStore.claimDue=async request=>{const r=await claim({...request,leaseDurationMs:late?2000:10000});if(r.ok)lease=r.value[0];return r;};roleStore.renew=async request=>{const r=await renew(request);renewResult=r;return r;};}return made;});
  try{
    // setEnv enforces memory mode; opt into disk only after isolating these paths.
    process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');const path=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;expect(path).toContain(ws.store);expect(db.query('PRAGMA journal_mode').get()).toEqual({journal_mode:'wal'});
    const due=new Date(Date.now()-1000).toISOString();createTask({id:'task:production-renew',chat_jid:'web:renew-fence',prompt:'fixture',task_kind:'shell',command:"printf 'owned-result'",cwd:'.',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
    const original=globalThis.setTimeout;timerSpy=spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,delay:number,...args:any[])=>{const timer=original(fn,delay,...args);if(delay===20000)captured.push(async()=>{clearTimeout(timer);await fn(...args);});return timer;}) as any);
    const deps={queue:{enqueueTask(_id:string,run:()=>Promise<void>){queued.push(run);admitted.resolve();}},agentPool:{isDurableRuntime:()=>true},sendMessage:async(_chat:string,text:string)=>{sent.push(text);}} as unknown as SchedulerDeps;
    const stop=startSchedulerLoop(deps);await admitted.promise;expect(queued).toHaveLength(1);expect(captured).toHaveLength(1);const l=lease!;expect(l).toBeDefined();const before=db.query('SELECT run_id,state,attempt,worker_id,lease_token_hash,lease_expires_at FROM service_effect_s07_occurrences').get();
    writer=new Database(path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');const remaining=Date.parse(l.record.leaseExpiresAt)-Date.now();expect(remaining).toBeGreaterThan(200);let released=false,ticks=0;const pulse=setInterval(()=>ticks++,10);unlock=setTimeout(()=>{writer!.exec('ROLLBACK');released=true;},late?remaining+250:150);
    statements.length=0;try{await captured[0]!();}finally{clearInterval(pulse);}expect(released).toBe(true);expect(ticks).toBeGreaterThan(2);
    if(late){expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(l.record.leaseExpiresAt));expect(renewResult).toMatchObject({ok:false,error:{_tag:'lease_expired',certainty:'not_applied',retryable:false}});expect(db.query('SELECT count(*) AS n FROM service_effect_s07_lease_renewals').get()).toEqual({n:0});expect(statements).toEqual([]);expect(db.query('SELECT run_id,state,attempt,worker_id,lease_token_hash,lease_expires_at FROM service_effect_s07_occurrences').get()).toEqual(before);expect(getTaskRunLogs('task:production-renew')).toHaveLength(0);expect(sent).toEqual([]);}
    else{expect(renewResult).toMatchObject({ok:true,value:{record:{runId:l.record.runId,attempt:l.record.attempt}}});expect(db.query('SELECT count(*) AS n FROM service_effect_s07_lease_renewals').get()).toEqual({n:1});expect(statements).toEqual(['renewal_insert','lease_history_update','lease_renew','decision_insert']);await stop();work=queued[0]!();await work;expect(getTaskRunLogs('task:production-renew')).toHaveLength(1);expect(sent).toEqual(['```\nowned-result\n```']);expect(db.query('SELECT state,attempt FROM service_effect_s07_occurrences').get()).toEqual({state:'completed',attempt:1});}
    expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{
    if(unlock)clearTimeout(unlock);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();await stopSchedulerLoop();if(!work&&queued[0]){updateTask('task:production-renew',{status:'paused'});work=queued[0]();}await work;timerSpy?.mockRestore();factorySpy.mockRestore();await closeDatabase();restore();ws.cleanup();
  }
},15000);

test('already expired live renewal rejects at the exact boundary without any renewal writes', async () => {
  const f = logicalFixture(true);
  try {
    const lease = await logicalLease(f);
    f.setNow(lease.record.leaseExpiresAt);
    const before = f.snapshot();
    expect(await f.store.renew(renewal(lease))).toMatchObject({
      ok: false, error: { _tag: 'lease_expired', certainty: 'not_applied', retryable: false },
    });
    expect(f.clockCalls()).toBe(1);
    expect(f.renewalInserts()).toBe(0);
    expect(f.snapshot()).toEqual(before);
    expect(f.db.inTransaction).toBe(false);
  } finally { f.close(); }
});

test('live expiry cannot override token, worker or revision conflicts', async () => {
  const f = logicalFixture(true);
  try {
    const lease = await logicalLease(f);
    f.setNow('2026-08-16T01:03:00.000Z');
    const before = f.snapshot();
    for (const [change, tag] of [
      [{ leaseToken: 'wrong-token' }, 'lease_conflict'],
      [{ workerId: 'worker:other' }, 'lease_conflict'],
      [{ expectedTaskRevision: 2 }, 'task_revision_mismatch'],
    ] as const) {
      expect(await f.store.renew({ ...renewal(lease), ...change })).toMatchObject({
        ok: false, error: { _tag: tag, certainty: 'not_applied', retryable: false },
      });
    }
    expect(f.clockCalls()).toBe(0);
    expect(f.snapshot()).toEqual(before);
  } finally { f.close(); }
});
