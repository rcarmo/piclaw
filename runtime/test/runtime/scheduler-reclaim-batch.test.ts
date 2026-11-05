import {expect,spyOn,test} from 'bun:test';
import Database from 'bun:sqlite';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {initDatabase,closeDatabase,getDb} from '../../src/db/connection.js';
import {createTask,updateTask} from '../../src/db/tasks.js';
import {createCurrentPiclawScheduledRunStore} from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import {createScheduledTaskAuthority} from '../../src/service-effects/current-piclaw/scheduled-task-authority.js';
import {createCurrentPiclawServiceWorkStore} from '../../src/service-effects/current-piclaw/service-work-store.js';
import {hashCanonicalRequest,type CanonicalJsonValue} from '../../src/service-effects/contracts/common.js';
import type {ScheduledRunLease,ScheduledRunReclaimAuthority} from '../../src/service-effects/contracts/scheduled-run-store.js';
import {pollScheduledRunsOnce,type SchedulerDeps} from '../../src/task-scheduler.js';

async function fixture(fixedDue?:string){
  await closeDatabase();const ws=createTempWorkspace('scheduler-reclaim-batch-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  try{
    process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');const path=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;
    expect(path).toContain(ws.store);expect(db.query('PRAGMA journal_mode').get()).toEqual({journal_mode:'wal'});
    const built=createCurrentPiclawScheduledRunStore(db,{hitFault:()=>false,recordTrace(){}});if(!built.ok)throw Error(built.error._tag);const store=built.value,directClaim=store.claimDue.bind(store),due=fixedDue??new Date(Date.now()-20000).toISOString(),coreIds=new Set<string>();
    const requests:Array<{count:number;ids:string[]}>=[],queued:Array<{id:string;run:()=>Promise<void>}>=[],pending=new Set<()=>Promise<void>>();let executions=0;
    store.claimDue=async r=>{requests.push({count:r.reclaimAuthorities.length,ids:r.reclaimAuthorities.map(a=>a.runId)});return directClaim(r);};
    const deps={queue:{enqueueTask(id:string,run:()=>Promise<void>){const once=async()=>{if(!pending.delete(once))throw Error('fixture callback replay');await run();};pending.add(once);queued.push({id,run:once});}},agentPool:{isDurableRuntime:()=>true,dispatchScheduledAgent:async()=>{executions++;throw Error('reclaim fixture must not execute agents');}},sendMessage:async()=>{executions++;throw Error('reclaim fixture must not deliver');}} as unknown as SchedulerDeps;
    function add(id:string,kind:'repeatable'|'unsafe'|'agent'='repeatable'){
      if(kind==='repeatable'){coreIds.add(id);createTask({id,chat_jid:'web:'+id,prompt:'fixture',task_kind:'shell',command:"printf 'must-not-execute'",cwd:'.',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});}
      else createScheduledTaskAuthority(db).create({taskId:id,chatJid:'web:'+id,kind:kind==='agent'?'agent':'shell',payloadRef:'fixture:'+id,modelLabel:null,scheduleType:'once',scheduleValue:due,timezone:'UTC',notifyOnComplete:false,muted:true,cwd:null,timeoutSec:null,internalTask:null,redactionClass:'private',executionRepeatability:kind==='agent'?'agent_source':'reconciliation_required',nextRunAt:due,authoredAt:due});
    }
    function request(prefix:string,authorities:readonly ScheduledRunReclaimAuthority[]=[],now=new Date().toISOString()){return{now,limit:100,workerId:'worker:reclaim',leaseTokenPrefix:prefix,leaseDurationMs:60000,reclaimAuthorities:authorities};}
    async function seed(){const leases:ScheduledRunLease[]=[];for(let i=0;;i++){const r=await directClaim({...request('seed:'+i,[],due),leaseDurationMs:1000});if(!r.ok)throw Error(r.error._tag);leases.push(...r.value);if(!r.value.length)return leases;}}
    const rows=(t:string)=>db.query(`SELECT * FROM ${t} ORDER BY rowid`).all(),snapshot=()=>['service_effect_s07_occurrences','service_effect_s07_leases','service_effect_s07_source_bindings','service_effect_s07_tasks','service_effect_s01_sources'].map(rows);
    async function accept(lease:ScheduledRunLease){const s=createCurrentPiclawServiceWorkStore(db,{hitFault:()=>false,recordTrace(){}});if(!s.ok)throw Error(s.error._tag);const r={effect:{idempotencyKey:'accepted:'+lease.record.runId,requestHash:'',operationId:null,sourceSeq:null,provenanceRef:lease.record.runId,redactionClass:'private' as const},chatJid:lease.task.chatJid,sourceId:lease.record.runId,kind:'scheduled_agent' as const,payloadRef:lease.task.payloadRef,targetOperationId:null,parentSourceSeq:null,acceptedAt:new Date().toISOString(),createWakeIntent:false};r.effect.requestHash=hashCanonicalRequest(r as unknown as CanonicalJsonValue);const accepted=await s.value.acceptSource(r);if(!accepted.ok)throw Error(accepted.error._tag);}
    return{db,path,store,directClaim,due,coreIds,add,request,seed,accept,requests,queued,snapshot,rows,poll:()=>pollScheduledRunsOnce(deps,store),executions:()=>executions,async close(){if(pending.size){for(const id of coreIds)updateTask(id,{status:'paused'});for(const run of [...pending])await run();}await closeDatabase();restore();ws.cleanup();}};
  }catch(error){await closeDatabase();restore();ws.cleanup();throw error;}
}
const repeatable=(l:ScheduledRunLease):ScheduledRunReclaimAuthority=>({runId:l.record.runId,expectedAttempt:l.record.attempt,kind:'repeatable',reconciliationRef:null});

for(const runtime of [false,true])test(`one hundred unrelated unsafe expiries cannot hide an authorised later occurrence: runtime=${runtime}`,async()=>{
  const f=await fixture();
  try{
    for(let i=0;i<100;i++)f.add('task:old:'+String(i).padStart(3,'0'),'unsafe');f.add('task:z-eligible');const leases=await f.seed();expect(leases).toHaveLength(101);
    const target=leases.find(l=>l.record.taskId==='task:z-eligible')!,old=f.db.query("SELECT * FROM service_effect_s07_occurrences WHERE task_id LIKE 'task:old:%' ORDER BY run_id").all(),history=f.db.query('SELECT * FROM service_effect_s07_leases WHERE run_id<>? ORDER BY run_id').all(target.record.runId);
    if(runtime){await f.poll();expect(f.requests.map(r=>r.count)).toEqual([1]);expect(f.queued).toHaveLength(1);expect(f.queued[0]!.id).toBe(target.record.runId);}
    else{const r=await f.directClaim(f.request('target',[repeatable(target)]));expect(r).toMatchObject({ok:true});if(!r.ok)throw Error(r.error._tag);expect(r.value).toHaveLength(1);expect(r.value[0]!.record.runId).toBe(target.record.runId);expect(r.value[0]!.record.attempt).toBe(2);}
    expect(f.db.query("SELECT * FROM service_effect_s07_occurrences WHERE task_id LIKE 'task:old:%' ORDER BY run_id").all()).toEqual(old);expect(f.db.query('SELECT * FROM service_effect_s07_leases WHERE run_id<>? ORDER BY run_id').all(target.record.runId)).toEqual(history);expect(f.executions()).toBe(0);expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{await f.close();}
},30000);

test('runtime eligibility cap emits100then1 without invalidating the closed public request',async()=>{
  const f=await fixture();
  try{
    for(let i=0;i<101;i++)f.add('task:eligible:'+String(i).padStart(3,'0'));const leases=await f.seed();expect(leases).toHaveLength(101);const history=f.db.query('SELECT * FROM service_effect_s07_leases WHERE attempt=1 ORDER BY run_id').all();
    await f.poll();expect(f.requests.map(r=>r.count)).toEqual([100]);expect(f.queued).toHaveLength(100);
    await f.poll();expect(f.requests.map(r=>r.count)).toEqual([100,1]);expect(f.queued).toHaveLength(101);expect(new Set(f.queued.map(q=>q.id)).size).toBe(101);
    expect(f.db.query("SELECT count(*) AS n FROM service_effect_s07_occurrences WHERE attempt=2 AND state='claimed'").get()).toEqual({n:101});expect(f.db.query('SELECT * FROM service_effect_s07_leases WHERE attempt=1 ORDER BY run_id').all()).toEqual(history);expect(f.executions()).toBe(0);expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{await f.close();}
},30000);

test('runtime cap counts eligibility rather than accepted-agent or unsafe expired rows',async()=>{
  const f=await fixture();
  try{
    for(let i=0;i<50;i++)f.add('task:a-unsafe:'+i,'unsafe');for(let i=0;i<50;i++)f.add('task:b-accepted:'+i,'agent');f.add('task:z-eligible');const leases=await f.seed();for(const lease of leases.filter(l=>l.task.kind==='agent'))await f.accept(lease);
    const accepted=f.rows('service_effect_s01_sources'),target=leases.find(l=>l.record.taskId==='task:z-eligible')!;
    await f.poll();expect(f.requests.map(r=>r.count)).toEqual([1]);expect(f.queued.map(q=>q.id)).toEqual([target.record.runId]);expect(f.rows('service_effect_s01_sources')).toEqual(accepted);expect(f.executions()).toBe(0);
  }finally{await f.close();}
},30000);

for(const invalid of ['kind','attempt','missing-id','unexpired'] as const)test(`expired selection preserves ${invalid} authority refusal`,async()=>{
  const f=await fixture();
  try{
    f.add('task:negative');const lease=(await f.seed())[0]!,before=f.snapshot(),a=repeatable(lease);
    const authority=invalid==='kind'?{...a,kind:'agent_reconciled_absent' as const,reconciliationRef:'proof:wrong-kind'}:invalid==='attempt'?{...a,expectedAttempt:2}:invalid==='missing-id'?{...a,runId:'scheduled_run:'+'f'.repeat(64)}:a;
    const now=invalid==='unexpired'?new Date(Date.parse(f.due)+500).toISOString():new Date().toISOString();const r=await f.directClaim(f.request('negative:'+invalid,[authority],now));expect(r).toMatchObject({ok:true,value:[]});expect(f.snapshot()).toEqual(before);expect(f.executions()).toBe(0);
  }finally{await f.close();}
},15000);

test('public max100authority validation and exact reclaim replay remain unchanged',async()=>{
  const f=await fixture();
  try{
    f.add('task:replay');const lease=(await f.seed())[0]!,authorities=Array.from({length:101},(_,i)=>({...repeatable(lease),runId:'scheduled_run:'+i.toString(16).padStart(64,'0')})),before=f.snapshot();expect(await f.directClaim(f.request('too-many',authorities))).toMatchObject({ok:false,error:{_tag:'invalid_request'}});expect(f.snapshot()).toEqual(before);
    const request=f.request('replay',[repeatable(lease)]),first=await f.directClaim(request);expect(first).toMatchObject({ok:true});if(!first.ok)throw Error(first.error._tag);expect(first.value).toHaveLength(1);const applied=f.snapshot();expect(await f.directClaim(request)).toEqual(first);expect(f.snapshot()).toEqual(applied);expect(first.value[0]!.record.attempt).toBe(2);
  }finally{await f.close();}
},15000);

test('authority-driven selection uses the existing run primary key rather than scanning expired rows',async()=>{
  const f=await fixture();let spy:ReturnType<typeof spyOn>|undefined;
  try{
    f.add('task:plan');const lease=(await f.seed())[0]!,request=f.request('plan',[repeatable(lease)]),query=f.db.query.bind(f.db),sql:string[]=[];
    spy=spyOn(f.db,'query').mockImplementation((text:any)=>{if(typeof text==='string'&&text.includes('json_each('))sql.push(text);return query(text);});const r=await f.directClaim(request);expect(r).toMatchObject({ok:true});spy.mockRestore();spy=undefined;expect(sql).toHaveLength(1);
    const plan=f.db.query('EXPLAIN QUERY PLAN '+sql[0]!).all(JSON.stringify(request.reclaimAuthorities),request.now) as {detail:string}[],detail=plan.map(r=>r.detail).join('\n');expect(detail).toContain('SCAN a VIRTUAL TABLE');expect(detail).toContain('SEARCH r USING INDEX sqlite_autoindex_service_effect_s07_occurrences_1 (run_id=?)');expect(detail).not.toMatch(/SCAN r(?:\s|$)/);expect(f.db.query('PRAGMA busy_timeout').get()).toEqual({timeout:0});
  }finally{spy?.mockRestore();await f.close();}
},15000);

for(const reverse of [false,true])test(`equal task/time revisions use a deterministic run identity tie: reverse=${reverse}`,async()=>{
  const f=await fixture('2026-08-16T01:00:00.000Z');
  try{
    const id='task:stable-tie';f.add(id);const first=(await f.seed())[0]!;updateTask(id,{prompt:'new revision'});
    const secondResult=await f.directClaim({...f.request('tie:new-revision',[],f.due),leaseDurationMs:1000});if(!secondResult.ok)throw Error(secondResult.error._tag);const second=secondResult.value[0]!;expect(second.record.taskRevision).toBe(2);
    const authorities=[repeatable(first),repeatable(second)];if(reverse)authorities.reverse();const expected=[first.record.runId,second.record.runId].sort();
    const result=await f.directClaim({...f.request('tie:claim',authorities),limit:1});expect(result).toMatchObject({ok:true});if(!result.ok)throw Error(result.error._tag);expect(result.value).toHaveLength(1);expect(result.value[0]!.record.runId).toBe(expected[0]);
    expect(f.db.query('SELECT run_id FROM service_effect_s07_occurrences WHERE attempt=1').get()).toEqual({run_id:expected[1]});expect(f.executions()).toBe(0);
  }finally{await f.close();}
},15000);

for(const change of ['renew','reclaim'] as const)test(`writer-time ${change} invalidates the previously valid reclaim authority`,async()=>{
  const f=await fixture();let writer:Database|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  try{
    f.add('task:writer-race');const lease=(await f.seed())[0]!,request=f.request('writer:observer',[repeatable(lease)]);writer=new Database(f.path);writer.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=0;BEGIN IMMEDIATE');
    const peer=createCurrentPiclawScheduledRunStore(writer,{hitFault:()=>false,recordTrace(){}});if(!peer.ok)throw Error(peer.error._tag);
    if(change==='renew')expect(await peer.value.renew({runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:1,expectedTaskRevision:1,leaseToken:lease.leaseToken,now:new Date(Date.parse(f.due)+500).toISOString(),leaseExpiresAt:new Date(Date.now()+60000).toISOString()})).toMatchObject({ok:true});
    else expect(await peer.value.claimDue(f.request('writer:reclaim',[repeatable(lease)]))).toMatchObject({ok:true});
    const observed=await peer.value.get(lease.record.runId);expect(observed).toMatchObject({ok:true});
    let released=false,ticks=0;const pulse=setInterval(()=>{ticks++;},5);timer=setTimeout(()=>{writer!.exec('COMMIT');released=true;},150);
    try{expect(await f.directClaim(request)).toMatchObject({ok:true,value:[]});}finally{clearInterval(pulse);}
    expect(released).toBe(true);expect(ticks).toBeGreaterThan(2);expect(await f.store.get(lease.record.runId)).toEqual(observed);expect(f.queued).toHaveLength(0);expect(f.executions()).toBe(0);expect(f.db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{if(timer)clearTimeout(timer);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();await f.close();}
},15000);
