import {expect,spyOn,test} from 'bun:test';
import Database from 'bun:sqlite';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {initDatabase,closeDatabase,getDb} from '../../src/db/connection.js';
import {createTask,updateTask,getTaskRunLogs} from '../../src/db/tasks.js';
import {createCurrentPiclawScheduledRunStore} from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import {createCurrentPiclawServiceWorkStore} from '../../src/service-effects/current-piclaw/service-work-store.js';
import {createScheduledTaskAuthority} from '../../src/service-effects/current-piclaw/scheduled-task-authority.js';
import {hashCanonicalRequest,type CanonicalJsonValue} from '../../src/service-effects/contracts/common.js';
import {pollScheduledRunsOnce,type SchedulerDeps} from '../../src/task-scheduler.js';

async function fixture(){
  await closeDatabase();const ws=createTempWorkspace('scheduler-idle-claim-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  try{
    process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');
    const path=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;
    expect(path).toContain(ws.store);expect(db.query('PRAGMA journal_mode').get()).toEqual({journal_mode:'wal'});
    const built=createCurrentPiclawScheduledRunStore(db,{hitFault:()=>false,recordTrace(){}});if(!built.ok)throw Error(built.error._tag);
    const store=built.value,directClaim=store.claimDue.bind(store),queued:Array<()=>Promise<void>>=[],sent:string[]=[];let calls=0,dispatches=0;
    store.claimDue=async request=>{calls++;return directClaim(request);};
    const deps={queue:{enqueueTask(_id:string,run:()=>Promise<void>){queued.push(run);}},agentPool:{isDurableRuntime:()=>true,dispatchScheduledAgent:async()=>{dispatches++;throw Error('agent dispatch outside fixture scope');}},sendMessage:async(_chat:string,text:string)=>{sent.push(text);}} as unknown as SchedulerDeps;
    function add(id:string,options:{due?:string;status?:'active'|'paused';agent?:boolean;unreconciled?:boolean}={}){
      const due=options.due??new Date(Date.now()-10000).toISOString();
      if(options.unreconciled)createScheduledTaskAuthority(db).create({taskId:id,chatJid:'web:'+id,kind:'shell',payloadRef:'historical:'+id,modelLabel:null,scheduleType:'once',scheduleValue:due,timezone:'UTC',notifyOnComplete:false,muted:true,cwd:null,timeoutSec:null,internalTask:null,redactionClass:'private',executionRepeatability:'reconciliation_required',nextRunAt:due,authoredAt:due});
      else createTask({id,chat_jid:'web:'+id,prompt:'fixture',task_kind:options.agent?'agent':'shell',command:options.agent?undefined:"printf 'fresh-slot'",cwd:options.agent?undefined:'.',schedule_type:'once',schedule_value:due,next_run:due,status:options.status??'active',notify_on_complete:false,created_at:due});return due;
    }
    function request(prefix:string,now=new Date().toISOString()){return{now,limit:100,workerId:'worker:idle-fixture',leaseTokenPrefix:prefix,leaseDurationMs:60000,reclaimAuthorities:[] as const};}
    async function claim(prefix:string,now?:string){const r=await directClaim(request(prefix,now));if(!r.ok)throw Error(r.error._tag);return r.value;}
    const snapshot=()=>['service_effect_s07_tasks','service_effect_s07_occurrences','service_effect_s07_leases','service_effect_s07_decisions','service_effect_s07_tombstones','service_effect_s01_sources'].map(t=>db.query(`SELECT * FROM ${t} ORDER BY rowid`).all());
    return{db,path,store,directClaim,request,add,claim,queued,sent,snapshot,poll:()=>pollScheduledRunsOnce(deps,store),calls:()=>calls,dispatches:()=>dispatches,async close(){await closeDatabase();restore();ws.cleanup();}};
  }catch(error){await closeDatabase();restore();ws.cleanup();throw error;}
}

for(const mode of ['empty','future','paused','claimed','expired-unsafe','accepted-agent','tombstone'] as const)test(`runtime ${mode} idle claim writes no transaction or empty receipt`,async()=>{
  const f=await fixture();let scope:ReturnType<typeof spyOn>|undefined;
  try{
    if(mode!=='empty'){
      const due=f.add('task:'+mode,{due:mode==='future'?'2099-01-01T00:00:00.000Z':undefined,status:mode==='paused'?'paused':'active',agent:mode==='accepted-agent',unreconciled:mode==='expired-unsafe'});
      if(!['future','paused'].includes(mode)){
        const lease=(await f.claim('seed:'+mode,due))[0]!;
        if(mode==='expired-unsafe'||mode==='accepted-agent'){
          const expiry=new Date(Date.now()-1000).toISOString();f.db.query('UPDATE service_effect_s07_occurrences SET lease_expires_at=? WHERE run_id=?').run(expiry,lease.record.runId);
          f.db.query('UPDATE service_effect_s07_leases SET lease_expires_at=? WHERE run_id=?').run(expiry,lease.record.runId);
        }
        if(mode==='accepted-agent'){
          const s=createCurrentPiclawServiceWorkStore(f.db,{hitFault:()=>false,recordTrace(){}});if(!s.ok)throw Error(s.error._tag);
          const input={effect:{idempotencyKey:'accepted:'+mode,requestHash:'',operationId:null,sourceSeq:null,provenanceRef:lease.record.runId,redactionClass:'private' as const},chatJid:lease.task.chatJid,sourceId:lease.record.runId,kind:'scheduled_agent' as const,payloadRef:lease.task.payloadRef,targetOperationId:null,parentSourceSeq:null,acceptedAt:new Date().toISOString(),createWakeIntent:false};input.effect.requestHash=hashCanonicalRequest(input as unknown as CanonicalJsonValue);
          const accepted=await s.value.acceptSource(input);if(!accepted.ok)throw Error(accepted.error._tag);
        }
        if(mode==='tombstone'){
          const now=new Date().toISOString(),complete={effect:{idempotencyKey:'retire:'+mode,requestHash:'',operationId:null,sourceSeq:null,provenanceRef:lease.record.runId,redactionClass:'private' as const},runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:1,expectedTaskRevision:1,leaseToken:lease.leaseToken,now,status:'error' as const,durationMs:1,resultRef:null,errorCode:'fixture',completedAt:now,outboxIntents:[]};complete.effect.requestHash=hashCanonicalRequest(complete as unknown as CanonicalJsonValue);
          const completed=await f.store.complete(complete);if(!completed.ok)throw Error(completed.error._tag);
          const retired=await f.store.cleanupTerminal({settledBefore:new Date(Date.now()+1000).toISOString(),limit:100});if(!retired.ok)throw Error(retired.error._tag);expect(retired.value.removed).toBe(1);
          // Synthetic historical head drift: a retained slot must never be recreated.
          f.db.query("UPDATE service_effect_s07_tasks SET status='active',next_run_at=? WHERE task_id=?").run(due,lease.record.taskId);
        }
      }
    }
    const before=f.snapshot(),transaction=f.db.transaction.bind(f.db);let transactions=0;
    scope=spyOn(f.db,'transaction').mockImplementation((fn:any)=>{transactions++;return transaction(fn);});
    await f.poll();await f.poll();expect(f.calls()).toBe(0);expect(transactions).toBe(0);expect(f.queued).toHaveLength(0);expect(f.snapshot()).toEqual(before);expect(f.dispatches()).toBe(0);
  }finally{scope?.mockRestore();await f.close();}
},15000);

for(const mode of ['empty','claimed'] as const)test(`runtime idle ${mode} poll returns while an unrelated WAL writer remains held`,async()=>{
  const f=await fixture();let writer:Database|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  try{
    if(mode==='claimed'){f.add('task:held');await f.claim('held');}
    const before=f.snapshot();writer=new Database(f.path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');let released=false;
    timer=setTimeout(()=>{writer!.exec('ROLLBACK');released=true;},1000);
    await f.poll();expect(released).toBe(false);expect(writer.inTransaction).toBe(true);expect(f.calls()).toBe(0);expect(f.snapshot()).toEqual(before);
  }finally{if(timer)clearTimeout(timer);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();await f.close();}
},15000);

test('new due work after an idle poll is claimed once, queued once and executes once',async()=>{
  const f=await fixture();
  try{
    await f.poll();expect(f.calls()).toBe(0);f.add('task:new-after-idle');
    await f.poll();expect(f.calls()).toBe(1);expect(f.queued).toHaveLength(1);
    const claimed=f.snapshot();await f.poll();expect(f.calls()).toBe(1);expect(f.queued).toHaveLength(1);expect(f.snapshot()).toEqual(claimed);
    await f.queued[0]!();expect(getTaskRunLogs('task:new-after-idle')).toHaveLength(1);expect(f.sent).toEqual(['```\nfresh-slot\n```']);expect(f.dispatches()).toBe(0);
  }finally{await f.close();}
},15000);

test('public empty claim decisions and exact replay remain supported independently of polling',async()=>{
  const f=await fixture();
  try{
    const request=f.request('public-empty'),a=await f.directClaim(request);expect(a).toMatchObject({ok:true,value:[]});const before=f.snapshot();
    expect(await f.directClaim(request)).toEqual(a);expect(f.snapshot()).toEqual(before);expect(f.db.query("SELECT count(*) AS n FROM service_effect_s07_decisions WHERE method='claimDue'").get()).toEqual({n:1});
    expect(await f.directClaim({...request,leaseTokenPrefix:'public-empty:new'})).toMatchObject({ok:true,value:[]});expect(f.db.query("SELECT count(*) AS n FROM service_effect_s07_decisions WHERE method='claimDue'").get()).toEqual({n:2});
  }finally{await f.close();}
},15000);

for(const runtime of [false,true])test(`one hundred active slots do not starve a fresh due slot: runtime=${runtime}`,async()=>{
  const f=await fixture();
  try{
    const due=new Date(Date.now()-20000).toISOString();for(let i=0;i<100;i++)f.add('task:occupied:'+String(i).padStart(3,'0'),{due});
    const active=await f.claim('hundred:seed');expect(active).toHaveLength(100);const evidence=f.db.query('SELECT * FROM service_effect_s07_leases ORDER BY run_id').all();
    f.add('task:fresh-101',{due:new Date(Date.now()-10000).toISOString()});
    if(runtime){await f.poll();expect(f.calls()).toBe(1);expect(f.queued).toHaveLength(1);await f.queued[0]!();expect(getTaskRunLogs('task:fresh-101')).toHaveLength(1);expect(f.sent).toEqual(['```\nfresh-slot\n```']);}
    else{const fresh=await f.claim('hundred:fresh');expect(fresh).toHaveLength(1);expect(fresh[0]!.record.taskId).toBe('task:fresh-101');}
    expect(f.db.query("SELECT count(*) AS n FROM service_effect_s07_occurrences WHERE task_id LIKE 'task:occupied:%' AND attempt=1 AND state='claimed'").get()).toEqual({n:100});
    expect(f.db.query("SELECT * FROM service_effect_s07_leases WHERE run_id<> (SELECT run_id FROM service_effect_s07_occurrences WHERE task_id='task:fresh-101') ORDER BY run_id").all()).toEqual(evidence);
    expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{await f.close();}
},15000);

test('an expired absent agent is still reclaimed by the existing explicit authority',async()=>{
  const f=await fixture();
  try{
    const due=f.add('task:reclaim',{agent:true}),first=(await f.claim('reclaim:first',due))[0]!,expiry=new Date(Date.now()-1000).toISOString();
    f.db.query('UPDATE service_effect_s07_occurrences SET lease_expires_at=? WHERE run_id=?').run(expiry,first.record.runId);f.db.query('UPDATE service_effect_s07_leases SET lease_expires_at=? WHERE run_id=?').run(expiry,first.record.runId);
    await f.poll();expect(f.calls()).toBe(1);expect(f.queued).toHaveLength(1);expect(f.db.query('SELECT attempt,state FROM service_effect_s07_occurrences WHERE run_id=?').get(first.record.runId)).toEqual({attempt:2,state:'claimed'});
    expect(f.db.query('SELECT authority_kind,reconciliation_ref FROM service_effect_s07_leases WHERE run_id=? AND attempt=2').get(first.record.runId)).toEqual({authority_kind:'agent_reconciled_absent',reconciliation_ref:`scheduled_source_absent:${first.record.runId}:attempt:1`});
    updateTask('task:reclaim',{status:'paused'});await f.queued[0]!();expect(f.dispatches()).toBe(0);
  }finally{await f.close();}
},15000);

test('a due candidate paused during real writer acquisition is revalidated by S07',async()=>{
  const f=await fixture();let writer:Database|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  try{
    f.add('task:pause-race');writer=new Database(f.path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');writer.query("UPDATE service_effect_s07_tasks SET status='paused' WHERE task_id='task:pause-race'").run();
    let released=false,ticks=0;const pulse=setInterval(()=>{ticks++;},5);timer=setTimeout(()=>{writer!.exec('COMMIT');released=true;},150);
    try{await f.poll();}finally{clearInterval(pulse);}
    expect(released).toBe(true);expect(ticks).toBeGreaterThan(2);expect(f.calls()).toBe(1);expect(f.queued).toHaveLength(0);expect(f.db.query('SELECT count(*) AS n FROM service_effect_s07_occurrences').get()).toEqual({n:0});expect(f.dispatches()).toBe(0);
  }finally{if(timer)clearTimeout(timer);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();await f.close();}
},15000);

test('new claim batch limit counts one hundred fresh slots rather than occupied heads',async()=>{
  const f=await fixture();
  try{
    const oldDue=new Date(Date.now()-20000).toISOString(),newDue=new Date(Date.now()-10000).toISOString();
    for(let i=0;i<100;i++)f.add('task:old:'+String(i).padStart(3,'0'),{due:oldDue});expect(await f.claim('batch:old')).toHaveLength(100);
    for(let i=0;i<101;i++)f.add('task:new:'+String(i).padStart(3,'0'),{due:newDue});
    const page=await f.claim('batch:first');expect(page).toHaveLength(100);expect(page.every(l=>l.record.taskId.startsWith('task:new:')&&l.record.attempt===1)).toBe(true);
    const last=await f.claim('batch:last');expect(last).toHaveLength(1);expect(last[0]!.record.taskId).toBe('task:new:100');
    expect(new Set([...page,...last].map(l=>l.record.runId)).size).toBe(101);expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{await f.close();}
},15000);

test('actual runtime and admitted claim candidate queries use existing due and unique slot indexes',async()=>{
  const f=await fixture();let scope:ReturnType<typeof spyOn>|undefined;
  try{
    f.add('task:index-plan');const query=f.db.query.bind(f.db),queries:string[]=[];
    scope=spyOn(f.db,'query').mockImplementation((sql:any)=>{if(typeof sql==='string'&&sql.includes('FROM service_effect_s07_tasks t WHERE t.status='))queries.push(sql);return query(sql);});
    await f.poll();scope.mockRestore();scope=undefined;expect(queries).toHaveLength(2);
    for(const sql of queries){const plan=f.db.query('EXPLAIN QUERY PLAN '+sql).all(new Date().toISOString()) as {detail:string}[];const detail=plan.map(r=>r.detail).join('\n');
      expect(detail).toContain('USING INDEX service_effect_s07_due_tasks');
      expect(detail).toContain('USING COVERING INDEX sqlite_autoindex_service_effect_s07_occurrences_2');
      expect(detail).toContain('USING COVERING INDEX sqlite_autoindex_service_effect_s07_tombstones_2');
      expect(detail).not.toMatch(/SCAN (?:t|r)(?:\s|$)/);
    }
    await f.queued[0]!();expect(getTaskRunLogs('task:index-plan')).toHaveLength(1);
  }finally{scope?.mockRestore();await f.close();}
},15000);
