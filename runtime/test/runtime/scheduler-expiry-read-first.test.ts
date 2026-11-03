import {expect,spyOn,test} from 'bun:test';
import Database from 'bun:sqlite';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {initDatabase,closeDatabase,getDb} from '../../src/db/connection.js';
import {createTask} from '../../src/db/tasks.js';
import {createCurrentPiclawScheduledRunStore} from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import {hashCanonicalRequest,type CanonicalJsonValue} from '../../src/service-effects/contracts/common.js';
import type {ScheduledRunStore} from '../../src/service-effects/contracts/scheduled-run-store.js';
import {pollScheduledRunsOnce,type SchedulerDeps} from '../../src/task-scheduler.js';

async function fixture(){
  await closeDatabase();const ws=createTempWorkspace('scheduler-expiry-read-first-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data,PICLAW_DB_IN_MEMORY:'0'});
  try{
    // setEnv deliberately enforces memory; this isolated WAL workload requires a real file.
    process.env.PICLAW_DB_IN_MEMORY='0';
    initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');
    const main=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!;
    expect(main.file).toContain(ws.store);expect(db.query('PRAGMA journal_mode').get()).toEqual({journal_mode:'wal'});const built=createCurrentPiclawScheduledRunStore(db,{hitFault:()=>false,recordTrace(){}});if(!built.ok)throw Error(built.error._tag);
    let claims=0;// Isolate expiry repair from the separate S07 claim writer. An unavailable receipt probe must never turn completed authority into interruption.
    const store={claimDue:async()=>{claims++;return{ok:true as const,value:[]};},get:async()=>({ok:false,error:{_tag:'storage_unavailable',certainty:'not_applied',retryable:true}})} as unknown as ScheduledRunStore;
    const deps={queue:{enqueueTask(){throw Error('expiry repair must not enqueue work');}},agentPool:{isDurableRuntime:()=>true},sendMessage:async()=>{throw Error('expiry repair must not deliver output');}} as unknown as SchedulerDeps;
    async function seed(id:string,mode:'healthy'|'expired'|'abandoned'|'completed'|'missing'){
      const now=new Date().toISOString(),due=new Date(Date.now()-1000).toISOString(),chat='web:expiry:'+id;
      createTask({id,chat_jid:chat,prompt:'never execute',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
      const claimed=await built.value.claimDue({now:due,limit:100,workerId:'worker:expiry',leaseTokenPrefix:id,leaseDurationMs:60000,reclaimAuthorities:[]});if(!claimed.ok)throw Error(claimed.error._tag);
      const lease=claimed.value.find(l=>l.record.taskId===id);if(!lease)throw Error('missing claim');
      const operation='operation:'+id;
      db.transaction(()=>{
        db.query('INSERT INTO service_effect_s01_chats(chat_jid,next_source_seq,consumed_through_source_seq,active_operation_id) VALUES(?,2,0,?)').run(chat,operation);
        db.query("INSERT INTO service_effect_s01_sources(chat_jid,source_seq,source_id,source_hash,kind,state,payload_ref,accepted_at,provenance_ref,create_wake_intent) VALUES(?,1,?,?,'scheduled_agent','claimed','payload:expiry',?,'fixture:expiry',0)").run(chat,mode==='missing'?'scheduled_run:'+'0'.repeat(64):lease.record.runId,'a'.repeat(64),now);
        db.query("INSERT INTO service_effect_s01_operations(operation_id,chat_jid,version,phase,primary_source_seq) VALUES(?,?,1,'claimed',1)").run(operation,chat);
        db.query('INSERT INTO service_effect_s01_operation_sources(chat_jid,operation_id,source_seq) VALUES(?,?,1)').run(chat,operation);
      }).immediate();
      if(mode!=='missing'){
        const request={effect:{idempotencyKey:'bind:'+id,requestHash:'',operationId:operation,sourceSeq:1,provenanceRef:lease.record.runId,redactionClass:'private' as const},runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:1,expectedTaskRevision:1,leaseToken:lease.leaseToken,now,boundAt:now,sourceSeq:1,operationId:operation};request.effect.requestHash=hashCanonicalRequest(request as unknown as CanonicalJsonValue);
        const bound=await built.value.bindAcceptedSource(request);if(!bound.ok)throw Error(bound.error._tag);
        if(mode==='expired')db.query('UPDATE service_effect_s07_occurrences SET lease_expires_at=? WHERE run_id=?').run(new Date(Date.now()-100).toISOString(),lease.record.runId);
        if(mode==='completed'||mode==='abandoned'){
          const effect={...request.effect,idempotencyKey:mode+':'+id,requestHash:''},fence={runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:1,expectedTaskRevision:1,leaseToken:lease.leaseToken,now};
          if(mode==='completed'){const complete={...fence,effect,status:'success' as const,durationMs:1,resultRef:'result:'+id,errorCode:null,completedAt:now,outboxIntents:[]};effect.requestHash=hashCanonicalRequest(complete as unknown as CanonicalJsonValue);const r=await built.value.complete(complete);if(!r.ok)throw Error(r.error._tag);}
          else{const abandon={...fence,effect,reasonTag:'fixture',abandonedAt:now,retryAt:null};effect.requestHash=hashCanonicalRequest(abandon as unknown as CanonicalJsonValue);const r=await built.value.abandon(abandon);if(!r.ok)throw Error(r.error._tag);}
        }
      }
      return{chat,operation,runId:lease.record.runId};
    }
    const snapshot=()=>['service_effect_s01_chats','service_effect_s01_sources','service_effect_s01_operations','service_effect_s07_occurrences','service_effect_s07_leases','service_effect_s07_source_bindings'].map(t=>db.query(`SELECT * FROM ${t} ORDER BY rowid`).all());
    return{db,seed,snapshot,poll:()=>pollScheduledRunsOnce(deps,store),claims:()=>claims,async close(){await closeDatabase();restore();ws.cleanup();}};
  }catch(error){await closeDatabase();restore();ws.cleanup();throw error;}
}

for(const mode of ['empty','healthy','missing','completed'] as const)test(`expiry repair idle ${mode} reads do not acquire a writer`,async()=>{
  const f=await fixture();let scope:ReturnType<typeof spyOn>|undefined;
  try{
    if(mode!=='empty')await f.seed('task:idle:'+mode,mode);
    const before=f.snapshot(),transaction=f.db.transaction.bind(f.db);let calls=0;
    scope=spyOn(f.db,'transaction').mockImplementation((fn:any)=>{calls++;return transaction(fn);});
    await f.poll();expect(calls).toBe(0);expect(f.snapshot()).toEqual(before);expect(f.claims()).toBe(1);
    expect(f.db.query('PRAGMA busy_timeout').get()).toEqual({timeout:0});
  }finally{scope?.mockRestore();await f.close();}
},15000);

test('expiry repair idle poll completes while another real WAL writer remains held',async()=>{
  const f=await fixture();let writer:Database|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  try{
    await f.seed('task:idle:writer','healthy');const before=f.snapshot();
    const path=(f.db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;
    writer=new Database(path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');let released=false;
    timer=setTimeout(()=>{writer!.exec('ROLLBACK');released=true;},1000);
    await f.poll();expect(released).toBe(false);expect(writer.inTransaction).toBe(true);expect(f.snapshot()).toEqual(before);expect(f.claims()).toBe(1);
  }finally{if(timer)clearTimeout(timer);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();await f.close();}
},15000);

for(const mode of ['expired','abandoned'] as const)test(`expiry repair settles ${mode} sources once with unchanged S07 evidence`,async()=>{
  const f=await fixture();let scope:ReturnType<typeof spyOn>|undefined;
  try{
    const row=await f.seed('task:repair:'+mode,mode),before=f.snapshot().slice(3),transaction=f.db.transaction.bind(f.db);let calls=0;
    scope=spyOn(f.db,'transaction').mockImplementation((fn:any)=>{calls++;return transaction(fn);});
    await f.poll();expect(calls).toBe(1);
    expect(f.db.query('SELECT phase,terminal_disposition,terminal_error_code,version FROM service_effect_s01_operations WHERE operation_id=?').get(row.operation)).toEqual({phase:'terminal',terminal_disposition:'failed',terminal_error_code:'scheduled_run_interrupted',version:2});
    expect(f.db.query('SELECT state,disposition_reason FROM service_effect_s01_sources WHERE chat_jid=?').get(row.chat)).toEqual({state:'disposed',disposition_reason:'scheduled_run_interrupted'});
    expect(f.db.query('SELECT active_operation_id,consumed_through_source_seq FROM service_effect_s01_chats WHERE chat_jid=?').get(row.chat)).toEqual({active_operation_id:null,consumed_through_source_seq:0});
    expect(f.snapshot().slice(3)).toEqual(before);const settled=f.snapshot();calls=0;
    await f.poll();expect(calls).toBe(0);expect(f.snapshot()).toEqual(settled);expect(f.claims()).toBe(2);
  }finally{scope?.mockRestore();await f.close();}
},15000);

test('expiry repair repeats eligibility inside admission after a lease renewal race',async()=>{
  const f=await fixture();let scope:ReturnType<typeof spyOn>|undefined;
  try{
    const row=await f.seed('task:renewal-race','expired'),transaction=f.db.transaction.bind(f.db);let intercepted=false;
    scope=spyOn(f.db,'transaction').mockImplementation((fn:any)=>{
      if(!intercepted){intercepted=true;f.db.query('UPDATE service_effect_s07_occurrences SET lease_expires_at=? WHERE run_id=?').run(new Date(Date.now()+60000).toISOString(),row.runId);}
      return transaction(fn);
    });
    await f.poll();expect(intercepted).toBe(true);
    expect(f.db.query('SELECT phase,version FROM service_effect_s01_operations WHERE operation_id=?').get(row.operation)).toEqual({phase:'claimed',version:1});
    expect(f.db.query('SELECT state FROM service_effect_s01_sources WHERE chat_jid=?').get(row.chat)).toEqual({state:'claimed'});
    expect(f.db.query('SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?').get(row.chat)).toEqual({active_operation_id:row.operation});
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{scope?.mockRestore();await f.close();}
},15000);

for(const change of ['renewed','terminal'] as const)test(`expiry repair rechecks ${change} authority after a real writer wait`,async()=>{
  const f=await fixture();let writer:Database|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const row=await f.seed('task:held:'+change,'expired'),path=(f.db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;
    writer=new Database(path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');
    if(change==='renewed')writer.query('UPDATE service_effect_s07_occurrences SET lease_expires_at=? WHERE run_id=?').run(new Date(Date.now()+60000).toISOString(),row.runId);
    else writer.query("UPDATE service_effect_s01_operations SET phase='terminal',version=version+1,terminal_disposition='completed',terminal_committed_at=? WHERE operation_id=?").run(new Date().toISOString(),row.operation);
    let released=false,ticks=0;const pulse=setInterval(()=>{ticks++;},5);
    timer=setTimeout(()=>{writer!.exec('COMMIT');released=true;},150);
    try{await f.poll();}finally{clearInterval(pulse);}
    expect(released).toBe(true);expect(ticks).toBeGreaterThan(2);expect(f.claims()).toBe(1);
    expect(f.db.query('SELECT phase,version,terminal_error_code FROM service_effect_s01_operations WHERE operation_id=?').get(row.operation)).toEqual({phase:change==='renewed'?'claimed':'terminal',version:change==='renewed'?1:2,terminal_error_code:null});
    expect(f.db.query('SELECT state FROM service_effect_s01_sources WHERE chat_jid=?').get(row.chat)).toEqual({state:'claimed'});
    expect(f.db.query('SELECT active_operation_id FROM service_effect_s01_chats WHERE chat_jid=?').get(row.chat)).toEqual({active_operation_id:row.operation});
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);expect(f.db.query('PRAGMA busy_timeout').get()).toEqual({timeout:0});
  }finally{if(timer)clearTimeout(timer);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();await f.close();}
},15000);
