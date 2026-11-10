import '../helpers.js';
import {expect,test} from 'bun:test';
import {initDatabase,getDb,closeDatabase} from '../../src/db/connection.js';
import {createTask,updateTask,getTaskById,deleteTask} from '../../src/db/tasks.js';
import {createCurrentPiclawScheduledRunStore} from '../../src/service-effects/current-piclaw/scheduled-run-store.js';
import {hashCanonicalRequest} from '../../src/service-effects/contracts/common.js';
import {installHistoricalExpenseFixture,historicalExpenseRows} from '../fixtures/historical-expense.js';
function value<T>(r:{ok:true;value:T}|{ok:false;error:unknown}):T{if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;}
const old='2026-10-24T11:00:00.000Z',at='2026-10-24T12:00:00.000Z',fresh='2026-10-24T12:10:00.000Z';
test('explicit generic fresh-occurrence transition leaves old success, unsettled work, user pauses and opaque monetary history unchanged',async()=>{
 initDatabase();const db=getDb();db.exec('PRAGMA foreign_keys=ON');
 const definition=(id:string)=>({id,chat_jid:'web:historical-pause',prompt:'retained prompt',task_kind:'shell' as const,command:'printf synthetic',schedule_type:'once' as const,schedule_value:old,next_run:old,status:'active' as const,created_at:old});
 const s=value(createCurrentPiclawScheduledRunStore(db,{hitFault:()=>false,recordTrace(){}}));
 const claim=(now:string,prefix:string)=>s.claimDue({now,limit:100,workerId:'fixture',leaseTokenPrefix:prefix,leaseDurationMs:60000,reclaimAuthorities:[]});
 try{
  createTask(definition('historical-budget-pause'));
  const completedLease=value(await claim(at,'old-completion'))[0]!;
  const completion={effect:{idempotencyKey:'historical-complete',requestHash:'',operationId:null,sourceSeq:null,provenanceRef:completedLease.record.runId,redactionClass:'private' as const},runId:completedLease.record.runId,workerId:'fixture',expectedAttempt:1,expectedTaskRevision:1,leaseToken:completedLease.leaseToken,now:at,completedAt:at,status:'success' as const,durationMs:1,resultRef:'task_run_result:'+completedLease.record.runId,errorCode:null,outboxIntents:[],resultPayload:{version:1 as const,result:'original known result',error:null}};
  completion.effect.requestHash=hashCanonicalRequest(completion);
  value(await s.complete(completion));
  updateTask('historical-budget-pause',{status:'paused'});
  createTask({...definition('user-paused'),status:'paused'});
  createTask(definition('user-cancelled'));deleteTask('user-cancelled');
  createTask(definition('unsettled-old-occurrence'));
  const unsettled=value(await claim(at,'unsettled-claim'))[0]!;
  expect(unsettled.record.taskId).toBe('unsettled-old-occurrence');
  updateTask('unsettled-old-occurrence',{status:'paused'});
  installHistoricalExpenseFixture(db);
  db.query("INSERT INTO budget_caps(id,scope,scheduled_task_id,metric,amount,timezone,created_at,updated_at) VALUES('legacy-zero','scheduled_run','historical-budget-pause','api_usd_micros',0,'UTC',?,?)").run(old,old);
  const money=historicalExpenseRows(db,['budget_caps','budget_work','budget_request_reservations','budget_usage_events']);
  const known=value(await s.get(completedLease.record.runId)),unknown=value(await s.get(unsettled.record.runId));
  const user=getTaskById('user-paused');
  expect(value(await claim(fresh,'paused-control'))).toEqual([]);
  // The operator selects one definition and a new instant. No money/reason
  // decoder guesses why any paused task was paused or resumes another task.
  updateTask('historical-budget-pause',{status:'active',schedule_value:fresh,next_run:fresh},1);
  expect(getTaskById('historical-budget-pause')).toMatchObject({revision:2,status:'active',next_run:fresh});
  expect(value(await claim('2026-10-24T12:09:00.000Z','not-yet-due'))).toEqual([]);
  const admitted=value(await claim(fresh,'fresh-admission'));
  expect(admitted).toHaveLength(1);expect(admitted[0]!.record).toMatchObject({taskId:'historical-budget-pause',taskRevision:2,scheduledFor:fresh,attempt:1});
  expect(value(await claim(fresh,'fresh-admission'))).toEqual(admitted);
  expect(value(await claim(fresh,'no-second-admission'))).toEqual([]);
  expect(value(await s.get(completedLease.record.runId))).toEqual(known);
  expect(value(await s.get(unsettled.record.runId))).toEqual(unknown);
  // Selecting a fresh revision of the same unsettled task must not reclaim or
  // rewrite its previous occurrence, even after that old lease has expired.
  const nextFresh='2026-10-24T12:11:00.000Z';
  updateTask('unsettled-old-occurrence',{status:'active',schedule_value:nextFresh,next_run:nextFresh},1);
  const next=value(await claim(nextFresh,'fresh-after-unsettled'));
  expect(next).toHaveLength(1);
  expect(next[0]!.record).toMatchObject({taskId:'unsettled-old-occurrence',taskRevision:2,scheduledFor:nextFresh,attempt:1});
  expect(next[0]!.record.runId).not.toBe(unsettled.record.runId);
  expect(value(await s.get(unsettled.record.runId))).toEqual(unknown);
  expect(value(await claim(nextFresh,'no-old-replay'))).toEqual([]);
  expect(getTaskById('user-paused')).toEqual(user);expect(getTaskById('user-cancelled')).toBeNull();
  expect(historicalExpenseRows(db,['budget_caps','budget_work','budget_request_reservations','budget_usage_events'])).toEqual(money);
  expect(db.query('SELECT result FROM task_run_logs ORDER BY id').all()).toEqual([{result:'original known result'}]);
  expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{await closeDatabase();}
});
