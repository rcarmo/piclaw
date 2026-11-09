import {expect,spyOn,test} from 'bun:test';
import Database from 'bun:sqlite';
import {createTempWorkspace,setEnv} from '../helpers.js';
import {initDatabase,closeDatabase,getDb} from '../../src/db/connection.js';
import {createTask,updateTask} from '../../src/db/tasks.js';
import {AgentQueue} from '../../src/queue.js';
import {createCurrentPiclawScheduledRunStore} from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import {pollScheduledRunsOnce,type SchedulerDeps} from '../../src/task-scheduler.js';

async function until(predicate:()=>boolean,ms:number){const deadline=Date.now()+ms;while(!predicate()){if(Date.now()>=deadline)throw Error('capacity fixture wait timed out');await Bun.sleep(10);}}

test('one hundred queued leases retain renewal authority after a six-second WAL writer outage',async()=>{
  await closeDatabase();const ws=createTempWorkspace('scheduler-renewal-capacity-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  let writer:Database|undefined,unlock:ReturnType<typeof setTimeout>|undefined,timerSpy:ReturnType<typeof spyOn>|undefined;const blocker=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();let queue:AgentQueue|undefined;
  try{
    process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');const path=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;
    expect(path).toContain(ws.store);expect(db.query('PRAGMA journal_mode').get()).toEqual({journal_mode:'wal'});expect(db.query('PRAGMA busy_timeout').get()).toEqual({timeout:0});
    const built=createCurrentPiclawScheduledRunStore(db,{hitFault:()=>false,recordTrace(){},liveRenewalNow:()=>new Date().toISOString()});if(!built.ok)throw Error(built.error._tag);const store=built.value;
    const renew=store.renew.bind(store),outcomes:Array<Awaited<ReturnType<typeof renew>>>=[];store.renew=async (request,context)=>{const result=await renew(request,context);outcomes.push(result);return result;};
    const due=new Date(Date.now()-1000).toISOString(),ids=Array.from({length:100},(_,i)=>'task:capacity:'+String(i).padStart(3,'0'));
    for(const id of ids)createTask({id,chat_jid:'web:capacity',prompt:'fixture',task_kind:'shell',command:"printf 'must-not-execute'",cwd:'.',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
    queue=new AgentQueue();queue.enqueue(async()=>{entered.resolve();await blocker.promise;},'fixture:blocker','scheduled-shell:web:capacity');await entered.promise;
    let deliveries=0;const deps={queue,agentPool:{isDurableRuntime:()=>true},sendMessage:async()=>{deliveries++;}} as unknown as SchedulerDeps;
    const original=globalThis.setTimeout,callbacks:Array<()=>Promise<void>>=[];
    timerSpy=spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,delay:number,...args:any[])=>{const t=original(fn,delay,...args);if(delay===20000)callbacks.push(async()=>{clearTimeout(t);await fn(...args);});return t;}) as any);
    await pollScheduledRunsOnce(deps,store);expect(callbacks).toHaveLength(100);expect(queue.getMetrics().enqueued).toBe(101);expect(queue.getMetrics().started).toBe(1);
    const before=db.query('SELECT run_id,attempt,worker_id,lease_token_hash,lease_expires_at FROM service_effect_s07_occurrences ORDER BY run_id').all();expect(before).toHaveLength(100);
    writer=new Database(path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');let released=false,ticks=0;const pulse=setInterval(()=>ticks++,10);unlock=setTimeout(()=>{writer!.exec('ROLLBACK');released=true;},6000);
    try{
      const first=callbacks.slice();await Promise.all(first.map(run=>run()));await until(()=>released,3000);
      const failed=outcomes.filter(r=>!r.ok);expect(failed).toHaveLength(100);expect(failed.every(r=>!r.ok&&r.error._tag==='storage_unavailable'&&r.error.certainty==='not_applied'&&r.error.retryable)).toBe(true);expect(outcomes.filter(r=>r.ok)).toHaveLength(100);
      expect((before as Array<{lease_expires_at:string}>).every(row=>Date.parse(row.lease_expires_at)>Date.now()+15000)).toBe(true);
      try{await until(()=>((db.query('SELECT count(*) AS n FROM service_effect_s07_lease_renewals').get() as {n:number}).n===100),8000);}catch(error){expect(db.query('SELECT count(*) AS n FROM service_effect_s07_lease_renewals').get()).toEqual({n:100});throw error;}
      expect(ticks).toBeGreaterThan(50);expect(db.query('SELECT count(*) AS n FROM service_effect_s07_lease_renewals').get()).toEqual({n:100});
      const after=db.query('SELECT run_id,attempt,worker_id,lease_token_hash,lease_expires_at FROM service_effect_s07_occurrences ORDER BY run_id').all() as Array<{run_id:string;attempt:number;worker_id:string;lease_token_hash:string;lease_expires_at:string}>;
      expect(after.map(({lease_expires_at:_expiry,...identity})=>identity)).toEqual((before as typeof after).map(({lease_expires_at:_expiry,...identity})=>identity));
      expect(after.every((row,i)=>row.lease_expires_at>(before as typeof after)[i]!.lease_expires_at)).toBe(true);expect(queue.getMetrics().started).toBe(1);expect(deliveries).toBe(0);expect(db.query('SELECT count(*) AS n FROM task_run_logs').get()).toEqual({n:0});
    }finally{clearInterval(pulse);}
  }finally{
    if(unlock)clearTimeout(unlock);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();
    if(queue){for(let i=0;i<100;i++){const id='task:capacity:'+String(i).padStart(3,'0');updateTask(id,{status:'paused'});}blocker.resolve();await until(()=>queue!.getMetrics().succeeded+queue!.getMetrics().failed>=101,20000);await queue.shutdown();}
    timerSpy?.mockRestore();await closeDatabase();restore();ws.cleanup();
  }
},45000);

test('a renewal waiting across actual lease expiry cannot revive the old occurrence',async()=>{
  await closeDatabase();const ws=createTempWorkspace('scheduler-late-renewal-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  let writer:Database|undefined,unlock:ReturnType<typeof setTimeout>|undefined,timerSpy:ReturnType<typeof spyOn>|undefined;const blocker=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();let queue:AgentQueue|undefined;
  try{
    process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');const path=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;
    expect(path).toContain(ws.store);expect(db.query('PRAGMA journal_mode').get()).toEqual({journal_mode:'wal'});
    const built=createCurrentPiclawScheduledRunStore(db,{hitFault:()=>false,recordTrace(){},liveRenewalNow:()=>new Date().toISOString()});if(!built.ok)throw Error(built.error._tag);const store=built.value,claim=store.claimDue.bind(store);store.claimDue=request=>claim({...request,leaseDurationMs:1000});
    const due=new Date(Date.now()-1000).toISOString(),id='task:late-renewal';createTask({id,chat_jid:'web:late-renewal',prompt:'fixture',task_kind:'shell',command:"printf 'must-not-execute'",cwd:'.',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
    queue=new AgentQueue();queue.enqueue(async()=>{entered.resolve();await blocker.promise;},'fixture:blocker','scheduled-shell:web:late-renewal');await entered.promise;
    let deliveries=0;const deps={queue,agentPool:{isDurableRuntime:()=>true},sendMessage:async()=>{deliveries++;}} as unknown as SchedulerDeps;
    const original=globalThis.setTimeout,callbacks:Array<()=>Promise<void>>=[];timerSpy=spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,delay:number,...args:any[])=>{const t=original(fn,delay,...args);if(delay===20000)callbacks.push(async()=>{clearTimeout(t);await fn(...args);});return t;}) as any);
    await pollScheduledRunsOnce(deps,store);expect(callbacks).toHaveLength(1);const before=db.query('SELECT run_id,attempt,worker_id,lease_token_hash,lease_expires_at FROM service_effect_s07_occurrences').get() as {run_id:string;attempt:number;worker_id:string;lease_token_hash:string;lease_expires_at:string};expect(Date.parse(before.lease_expires_at)).toBeGreaterThan(Date.now());
    writer=new Database(path);writer.exec('PRAGMA busy_timeout=0;BEGIN IMMEDIATE');let released=false;unlock=setTimeout(()=>{writer!.exec('ROLLBACK');released=true;},1800);
    await callbacks[0]!();expect(released).toBe(false);expect(writer.inTransaction).toBe(true);expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(before.lease_expires_at));
    await until(()=>released,3000);
    expect(db.query('SELECT count(*) AS n FROM service_effect_s07_lease_renewals').get()).toEqual({n:0});expect(db.query('SELECT run_id,attempt,worker_id,lease_token_hash,lease_expires_at FROM service_effect_s07_occurrences').get()).toEqual(before);
    expect(queue.getMetrics().started).toBe(1);expect(deliveries).toBe(0);expect(db.query('SELECT count(*) AS n FROM task_run_logs').get()).toEqual({n:0});
  }finally{
    if(unlock)clearTimeout(unlock);if(writer?.inTransaction)writer.exec('ROLLBACK');writer?.close();
    if(queue){updateTask('task:late-renewal',{status:'paused'});blocker.resolve();await until(()=>queue!.getMetrics().succeeded+queue!.getMetrics().failed>=2,10000);await queue.shutdown();}
    timerSpy?.mockRestore();await closeDatabase();restore();ws.cleanup();
  }
},15000);

test('one hundred queued leases renew with unchanged identities when the writer is available',async()=>{
  await closeDatabase();const ws=createTempWorkspace('scheduler-renewal-control-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  let timerSpy:ReturnType<typeof spyOn>|undefined;const blocker=Promise.withResolvers<void>(),entered=Promise.withResolvers<void>();let queue:AgentQueue|undefined;
  try{
    process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');const path=(db.query('PRAGMA database_list').all() as {name:string;file:string}[]).find(r=>r.name==='main')!.file;expect(path).toContain(ws.store);expect(db.query('PRAGMA journal_mode').get()).toEqual({journal_mode:'wal'});
    const built=createCurrentPiclawScheduledRunStore(db,{hitFault:()=>false,recordTrace(){},liveRenewalNow:()=>new Date().toISOString()});if(!built.ok)throw Error(built.error._tag);const store=built.value,due=new Date(Date.now()-1000).toISOString();
    for(let i=0;i<100;i++){const id='task:control:'+String(i).padStart(3,'0');createTask({id,chat_jid:'web:control',prompt:'fixture',task_kind:'shell',command:"printf 'must-not-execute'",cwd:'.',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});}
    queue=new AgentQueue();queue.enqueue(async()=>{entered.resolve();await blocker.promise;},'fixture:blocker','scheduled-shell:web:control');await entered.promise;
    let deliveries=0;const deps={queue,agentPool:{isDurableRuntime:()=>true},sendMessage:async()=>{deliveries++;}} as unknown as SchedulerDeps;
    const original=globalThis.setTimeout,callbacks:Array<()=>Promise<void>>=[];timerSpy=spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,delay:number,...args:any[])=>{const t=original(fn,delay,...args);if(delay===20000)callbacks.push(async()=>{clearTimeout(t);await fn(...args);});return t;}) as any);
    await pollScheduledRunsOnce(deps,store);expect(callbacks).toHaveLength(100);expect(queue.getMetrics().enqueued).toBe(101);expect(queue.getMetrics().started).toBe(1);
    const before=db.query('SELECT run_id,attempt,worker_id,lease_token_hash,lease_expires_at FROM service_effect_s07_occurrences ORDER BY run_id').all() as Array<{run_id:string;attempt:number;worker_id:string;lease_token_hash:string;lease_expires_at:string}>;expect(before).toHaveLength(100);
    await Promise.all(callbacks.slice().map(run=>run()));expect(db.query('SELECT count(*) AS n FROM service_effect_s07_lease_renewals').get()).toEqual({n:100});
    const after=db.query('SELECT run_id,attempt,worker_id,lease_token_hash,lease_expires_at FROM service_effect_s07_occurrences ORDER BY run_id').all() as typeof before;
    expect(after.map(({lease_expires_at:_expiry,...identity})=>identity)).toEqual(before.map(({lease_expires_at:_expiry,...identity})=>identity));expect(after.every((row,i)=>row.lease_expires_at>before[i]!.lease_expires_at)).toBe(true);
    expect(queue.getMetrics().started).toBe(1);expect(deliveries).toBe(0);expect(db.query('SELECT count(*) AS n FROM task_run_logs').get()).toEqual({n:0});expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  }finally{
    if(queue){for(let i=0;i<100;i++)updateTask('task:control:'+String(i).padStart(3,'0'),{status:'paused'});blocker.resolve();await until(()=>queue!.getMetrics().succeeded+queue!.getMetrics().failed>=101,20000);await queue.shutdown();}
    timerSpy?.mockRestore();await closeDatabase();restore();ws.cleanup();
  }
},45000);
