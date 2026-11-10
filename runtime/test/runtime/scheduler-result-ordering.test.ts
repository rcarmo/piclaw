import { expect, spyOn, test } from 'bun:test';
import { createTempWorkspace, setEnv } from '../helpers.js';
import { initDatabase, closeDatabase, getDb } from '../../src/db/connection.js';
import { createTask, getTaskRunLogs } from '../../src/db/tasks.js';
import { startSchedulerLoop, stopSchedulerLoop, type SchedulerDeps } from '../../src/task-scheduler.js';
import * as stores from '../../src/service-effects/current-piclaw/scheduled-run-store.js';

for (const deliveryFails of [false,true]) test(`completion precedes delivery and retains a known result after delivery failure=${deliveryFails}`, async () => {
  await stopSchedulerLoop(); await closeDatabase();
  const ws=createTempWorkspace('scheduler-known-result-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  const admitted=Promise.withResolvers<void>(),queue:Array<()=>Promise<void>>=[];
  let sends=0;
  try{
    process.env.PICLAW_DB_IN_MEMORY='0';initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');
    const now=new Date(Date.now()-1000).toISOString();
    createTask({id:'task:known-result',chat_jid:'web:ordering',prompt:'fixture',task_kind:'shell',command:"printf 'known-result'",cwd:'.',schedule_type:'once',schedule_value:now,next_run:now,status:'active',notify_on_complete:false,created_at:now});
    const deps={queue:{enqueueTask(_id:string,run:()=>Promise<void>){queue.push(run);admitted.resolve();}},agentPool:{isDurableRuntime:()=>true},sendMessage:async()=>{
      sends++;expect(getTaskRunLogs('task:known-result')).toHaveLength(1);
      expect(db.query('SELECT state FROM service_effect_s07_occurrences').get()).toEqual({state:'completed'});
      if(deliveryFails)throw Error('fixture delivery unavailable');
    }} as unknown as SchedulerDeps;
    const stop=startSchedulerLoop(deps);await admitted.promise;await stop();await queue[0]!();
    expect(sends).toBe(1);const logs=getTaskRunLogs('task:known-result');expect(logs).toHaveLength(1);expect(logs[0]!.result).toContain('known-result');
    expect(db.query('SELECT state,result_status FROM service_effect_s07_occurrences').get()).toEqual({state:'completed',result_status:'success'});
    await closeDatabase();initDatabase();expect(getTaskRunLogs('task:known-result')).toEqual(logs);
  }finally{await stopSchedulerLoop();await closeDatabase();restore();ws.cleanup();}
},15000);

test('a lost renewal ACK retries the same request without duplicating committed renewal',async()=>{
  await stopSchedulerLoop();await closeDatabase();const ws=createTempWorkspace('scheduler-renewal-ack-'),restore=setEnv({PICLAW_WORKSPACE:ws.workspace,PICLAW_STORE:ws.store,PICLAW_DATA:ws.data});
  const admitted=Promise.withResolvers<void>(),queued:Array<()=>Promise<void>>=[],callbacks:Array<()=>Promise<void>>=[],requests:unknown[]=[];
  let timerSpy:ReturnType<typeof spyOn>|undefined,factorySpy:ReturnType<typeof spyOn>|undefined;
  const factory=stores.createCurrentPiclawScheduledRunStore;let lost=true;
  try{
    initDatabase();const db=getDb();
    factorySpy=spyOn(stores,'createCurrentPiclawScheduledRunStore').mockImplementation((database,runtime)=>{
      const made=factory(database,{...runtime,hitFault(point,method){if(method==='renew'&&point==='effect_then_lost_acknowledgement'&&lost){lost=false;return true;}return false;}});
      if(made.ok){const renew=made.value.renew.bind(made.value);made.value.renew=(request,context)=>{requests.push({...request});return renew(request,context);};}return made;
    });
    const original=globalThis.setTimeout;timerSpy=spyOn(globalThis,'setTimeout').mockImplementation(((fn:any,delay:number,...args:any[])=>{const t=original(fn,delay,...args);if(delay===20000)callbacks.push(async()=>{clearTimeout(t);await fn(...args);});return t;})as any);
    const due=new Date(Date.now()-1000).toISOString();createTask({id:'task:renew-ack',chat_jid:'web:ack',prompt:'fixture',task_kind:'shell',command:"printf 'ack-result'",cwd:'.',schedule_type:'once',schedule_value:due,next_run:due,status:'active',notify_on_complete:false,created_at:due});
    const deps={queue:{enqueueTask(_id:string,run:()=>Promise<void>){queued.push(run);admitted.resolve();}},agentPool:{isDurableRuntime:()=>true},sendMessage:async()=>{}}as unknown as SchedulerDeps;
    const stop=startSchedulerLoop(deps);await admitted.promise;await Bun.sleep(5);await callbacks[0]!();
    expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);expect(db.query('SELECT count(*) AS n FROM service_effect_s07_lease_renewals').get()).toEqual({n:1});
    await stop();await queued[0]!();expect(getTaskRunLogs('task:renew-ack')).toHaveLength(1);
  }finally{await stopSchedulerLoop();timerSpy?.mockRestore();factorySpy?.mockRestore();await closeDatabase();restore();ws.cleanup();}
},15000);
