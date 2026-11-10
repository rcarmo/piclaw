import { beforeEach, afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { createTempWorkspace } from "../helpers.js";
import { createCurrentPiclawScheduledRunStore, type ScheduledRunAdapterRuntime, type ScheduledRunStatement } from "../../src/service-effects/current-piclaw/scheduled-run-store.js";
import { createCurrentPiclawServiceOutboxStore } from "../../src/service-effects/current-piclaw/service-outbox-store.js";
import { installScheduledRunCompositionSchema } from "../../src/service-effects/current-piclaw/scheduled-run-schema.js";
import { createScheduledTaskAuthority } from "../../src/service-effects/current-piclaw/scheduled-task-authority.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../src/service-effects/contracts/common.js";
import type { CompleteScheduledRunRequest, ScheduledRunLease, ScheduledTaskAuthorityInput } from "../../src/service-effects/contracts/scheduled-run-store.js";
import type { Result } from "../../src/service-effects/contracts/result.js";
function value<T,E>(result:Result<T,E>):T{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;}
let workspace:ReturnType<typeof createTempWorkspace>, database:Database, path:string;
let fail:ScheduledRunStatement|undefined,lost=false;
const runtime:ScheduledRunAdapterRuntime={recordTrace(){},hitFault(point,method){if(lost&&point==='effect_then_lost_acknowledgement'&&method==='cleanupTerminal'){lost=false;return true;}return false;},afterStatement(statement){if(statement===fail){fail=undefined;throw Error('retention statement fault');}}};
const open=()=>{database=new Database(path,{create:true});database.exec("PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL");installScheduledRunCompositionSchema(database);return value(createCurrentPiclawScheduledRunStore(database,runtime));};
let store:ReturnType<typeof open>;
beforeEach(()=>{workspace=createTempWorkspace('scheduler-retention-');path=join(workspace.store,'owner.sqlite');fail=undefined;lost=false;store=open();});
afterEach(()=>{database.close();workspace.cleanup();});
const instant='2026-08-16T01:00:00.000Z',done='2026-08-16T01:00:10.000Z',cutoff='2026-08-17T00:00:00.000Z';
const task=(id:string):ScheduledTaskAuthorityInput=>({taskId:id,chatJid:'web:retention',kind:'shell',payloadRef:'payload:'+id,modelLabel:null,scheduleType:'once',scheduleValue:instant,timezone:'UTC',notifyOnComplete:true,muted:false,cwd:null,timeoutSec:null,internalTask:null,redactionClass:'private',executionRepeatability:'repeatable',nextRunAt:instant,authoredAt:'2026-08-16T00:00:00.000Z'});
function completion(lease:ScheduledRunLease,withOutbox=false):CompleteScheduledRunRequest{
  const outbox={effect:{idempotencyKey:'deliver:'+lease.record.runId,requestHash:'',operationId:null,sourceSeq:null,provenanceRef:'fixture:retention',redactionClass:'private' as const},outboxId:'deliver:'+lease.record.runId,kind:'channel_delivery' as const,payloadRef:'payload:delivery',destinationRef:'destination:web',availableAt:done,enqueuedAt:done,repeatability:'reconciliation_required' as const};
  outbox.effect.requestHash=hashCanonicalRequest(outbox as unknown as CanonicalJsonValue);
  const request:CompleteScheduledRunRequest={effect:{idempotencyKey:'complete:'+lease.record.runId,requestHash:'',operationId:null,sourceSeq:null,provenanceRef:'fixture:retention',redactionClass:'private'},runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:lease.record.attempt,expectedTaskRevision:lease.record.taskRevision,leaseToken:lease.leaseToken,now:done,status:'error',durationMs:10,resultRef:null,errorCode:'fixture_error',completedAt:done,outboxIntents:withOutbox?[outbox]:[]};
  request.effect.requestHash=hashCanonicalRequest(request as unknown as CanonicalJsonValue);return request;
}
async function seed(count:number,withOutbox=false){const authority=createScheduledTaskAuthority(database);for(let i=0;i<count;i++)authority.create(task('task:retention:'+i));
  const leases=value(await store.claimDue({now:instant,limit:100,workerId:'worker:retention',leaseTokenPrefix:'retention',leaseDurationMs:60000,reclaimAuthorities:[]}));
  const requests=leases.map(lease=>completion(lease,withOutbox));for(const request of requests)value(await store.complete(request));return requests;}
const snapshot=()=>['occurrences','leases','lease_renewals','source_bindings','run_logs','next_decisions','abandonments','outbox_links','decisions','tombstones'].map(name=>database.query(`SELECT * FROM service_effect_s07_${name} ORDER BY rowid`).all());
function historicalReference(taskId:string,state?:string){
  // Minimal historical data only: there is no evaluator or financial schema
  // initializer, and eligibility must not depend on these opaque states.
  database.exec('CREATE TABLE budget_work(id TEXT PRIMARY KEY,scheduled_task_id TEXT)');
  database.query('INSERT INTO budget_work VALUES (?,?)').run('historical-reference',taskId);
  if(state!==undefined){
    database.exec('CREATE TABLE budget_request_reservations(id TEXT PRIMARY KEY,work_id TEXT REFERENCES budget_work(id),state TEXT)');
    database.query('INSERT INTO budget_request_reservations VALUES (?,?,?)').run('historical-request','historical-reference',state);
  }
}
const historicalRows=()=>['budget_work','budget_request_reservations'].map(table=>database.query('SELECT 1 FROM main.sqlite_schema WHERE name=?').get(table)?database.query(`SELECT rowid,* FROM main.${table}`).all():[]);

for(const state of ['reserved','dispatched','unresolved','settled','released','opaque-future-state',undefined])test(`scheduled retention: historical task reference is state independent; state=${state??'no-reservation-table'}`,async()=>{
  const [request]=await seed(1);const record=value(await store.get(request!.runId))!;
  historicalReference(record.taskId,state);const history=historicalRows(),before=snapshot();
  const plan=value(await store.planRetention({settledBefore:cutoff,limit:1}));expect(plan.rows).toEqual([]);
  expect(value(await store.applyRetention(plan))).toEqual({removed:0,runIds:[]});expect(snapshot()).toEqual(before);
  // The legacy cleanup entry point must not bypass the same retention rule.
  expect(value(await store.cleanupTerminal({settledBefore:cutoff,limit:1}))).toEqual({removed:0,runIds:[]});
  expect(snapshot().filter((_,index)=>index!==8)).toEqual(before.filter((_,index)=>index!==8));
  database.close();store=open();expect(historicalRows()).toEqual(history);
  expect(value(await store.get(request!.runId))?.retained).toBe(false);
  expect(value(await store.complete(request!)).retained).toBe(false);
  expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
});

test('scheduled retention: unrelated historical work does not protect another task',async()=>{
  await seed(1);historicalReference('unrelated-task','opaque-future-state');const history=historicalRows();
  const plan=value(await store.planRetention({settledBefore:cutoff,limit:1}));expect(plan.rows).toHaveLength(1);
  expect(value(await store.applyRetention(plan)).removed).toBe(1);expect(historicalRows()).toEqual(history);
});

test('scheduled retention: incomplete historical mapping cannot authorise deletion',async()=>{
  await seed(1);database.exec("CREATE TABLE budget_request_reservations(id TEXT PRIMARY KEY,work_id TEXT,state TEXT);INSERT INTO budget_request_reservations VALUES('opaque-request','missing-work','opaque-state')");
  const before=snapshot(),history=historicalRows();
  const plan=value(await store.planRetention({settledBefore:cutoff,limit:1}));expect(plan.rows).toEqual([]);
  expect(value(await store.cleanupTerminal({settledBefore:cutoff,limit:1})).removed).toBe(0);
  expect(snapshot().filter((_,index)=>index!==8)).toEqual(before.filter((_,index)=>index!==8));expect(historicalRows()).toEqual(history);
});

test('scheduled retention: newly present historical reference revokes a whole approved page before deletion',async()=>{
  await seed(2);const plan=value(await store.planRetention({settledBefore:cutoff,limit:2}));expect(plan.rows).toHaveLength(2);
  historicalReference(value(await store.get(plan.rows[1]!.runId))!.taskId);const before=snapshot(),history=historicalRows();
  const result=await store.applyRetention(plan);expect(result.ok).toBe(false);expect(!result.ok&&result.error._tag).toBe('invalid_transition');
  expect(snapshot()).toEqual(before);expect(historicalRows()).toEqual(history);
  const current=value(await store.planRetention({settledBefore:cutoff,limit:2}));expect(current.rows).toHaveLength(1);
  expect(value(await store.applyRetention(current)).removed).toBe(1);expect(historicalRows()).toEqual(history);
});

test('scheduled retention: historical reference does not deny a fresh occurrence for the same task',async()=>{
  const [original]=await seed(1);const taskId=value(await store.get(original!.runId))!.taskId;
  historicalReference(taskId,'opaque-future-state');const history=historicalRows();
  createScheduledTaskAuthority(database).update({...task(taskId),payloadRef:'fresh-payload:'+taskId,expectedRevision:1});
  const lease=value(await store.claimDue({now:instant,limit:1,workerId:'worker:fresh',leaseTokenPrefix:'fresh',leaseDurationMs:60000,reclaimAuthorities:[]}))[0]!;
  expect(lease.record.taskId).toBe(taskId);expect(lease.record.taskRevision).toBe(2);expect(lease.record.runId).not.toBe(original!.runId);
  expect(value(await store.complete(completion(lease))).state).toBe('completed');expect(historicalRows()).toEqual(history);
});

test('scheduled retention: lost ACK replay after reopen never repeats deletion when a historical reference arrives later',async()=>{
  const [request]=await seed(1),taskId=value(await store.get(request!.runId))!.taskId;
  const plan=value(await store.planRetention({settledBefore:cutoff,limit:1}));lost=true;
  const result=await store.applyRetention(plan);expect(result.ok).toBe(false);expect(!result.ok&&result.error.certainty).toBe('unknown');
  database.close();store=open();historicalReference(taskId,'opaque-future-state');
  const before=snapshot(),history=historicalRows();
  expect(value(await store.applyRetention(JSON.parse(JSON.stringify(plan))))).toEqual({removed:1,runIds:[request!.runId]});
  expect(snapshot()).toEqual(before);expect(historicalRows()).toEqual(history);expect(value(await store.get(request!.runId))?.retained).toBe(true);
  expect(value(await store.complete(request!)).retained).toBe(true);
});

for(const table of ['budget_work','budget_request_reservations'])test(`scheduled retention: temporary historical shadow cannot authorise deletion; table=${table}`,async()=>{
  await seed(1);const plan=value(await store.planRetention({settledBefore:cutoff,limit:1})),before=snapshot();
  database.exec(`CREATE TEMP TABLE ${table}(opaque TEXT)`);
  const preview=await store.planRetention({settledBefore:cutoff,limit:1});expect(preview.ok).toBe(false);expect(!preview.ok&&preview.error._tag).toBe('corrupt_state');
  const applied=await store.applyRetention(plan);expect(applied.ok).toBe(false);expect(!applied.ok&&applied.error._tag).toBe('corrupt_state');
  const legacy=await store.cleanupTerminal({settledBefore:cutoff,limit:1});expect(legacy.ok).toBe(false);expect(!legacy.ok&&legacy.error._tag).toBe('corrupt_state');
  expect(snapshot()).toEqual(before);
});

test('scheduled retention: malformed historical mapping fails without modifying evidence',async()=>{
  await seed(1);database.exec('CREATE TABLE budget_work(opaque TEXT)');const before=snapshot();
  const result=await store.planRetention({settledBefore:cutoff,limit:1});expect(result.ok).toBe(false);expect(snapshot()).toEqual(before);
});

test('scheduled retention: dry-run, lost ACK, reopen and cursor preserve tombstone replay identities',async()=>{
  const requests=await seed(3),before=snapshot();const plan=value(await store.planRetention({settledBefore:cutoff,limit:1}));expect(plan.examined).toBe(1);expect(plan.rows).toHaveLength(1);expect(snapshot()).toEqual(before);
  const persisted=JSON.parse(JSON.stringify(plan));lost=true;const unknown=await store.applyRetention(persisted);expect(unknown.ok).toBe(false);expect(!unknown.ok&&unknown.error.certainty).toBe('unknown');
  database.close();store=open();const replay=value(await store.applyRetention(persisted));expect(replay).toEqual({removed:1,runIds:[plan.rows[0]!.runId]});
  expect(value(await store.get(replay.runIds[0]!))?.retained).toBe(true);
  expect(value(await store.complete(requests.find(request=>request.runId===replay.runIds[0])!)).retained).toBe(true);
  const next=value(await store.planRetention({settledBefore:cutoff,limit:1,after:plan.nextCursor}));expect(next.rows[0]!.runId).not.toBe(plan.rows[0]!.runId);expect(value(await store.applyRetention(next)).removed).toBe(1);
  expect(value(await store.applyRetention(persisted))).toEqual(replay);expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
});
test('scheduled retention: caller mutation cannot change an admitted retirement page',async()=>{
  await seed(2);const plan=value(await store.planRetention({settledBefore:cutoff,limit:1})),input=JSON.parse(JSON.stringify(plan));
  const pending=store.applyRetention(input);input.rows=[];input.settledBefore='2999-01-01T00:00:00.000Z';
  expect(value(await pending).runIds).toEqual([plan.rows[0]!.runId]);expect(value(await store.applyRetention(plan)).removed).toBe(1);
});
test('scheduled retention: opaque result references remain owned and cannot be compacted',async()=>{
  createScheduledTaskAuthority(database).create(task('opaque-task'));
  const lease=value(await store.claimDue({now:instant,limit:1,workerId:'worker:opaque',leaseTokenPrefix:'opaque',leaseDurationMs:60000,reclaimAuthorities:[]}))[0]!;
  const base=completion(lease),effect={...base.effect,requestHash:''};const request:CompleteScheduledRunRequest={...base,effect,status:'success',resultRef:'opaque:external-result',errorCode:null};
  effect.requestHash=hashCanonicalRequest(request as unknown as CanonicalJsonValue);value(await store.complete(request));const before=snapshot();
  expect(value(await store.planRetention({settledBefore:cutoff,limit:1})).rows).toEqual([]);expect(snapshot()).toEqual(before);
});
test('scheduled retention: pending and unknown delivery retain complete correlation evidence',async()=>{
  const [request]=await seed(1,true);const before=snapshot();const empty=value(await store.planRetention({settledBefore:cutoff,limit:1}));expect(empty.rows).toEqual([]);expect(value(await store.applyRetention(empty))).toEqual({removed:0,runIds:[]});expect(snapshot()).toEqual(before);
  const outbox=value(createCurrentPiclawServiceOutboxStore(database,{hitFault(){return false;},recordTrace(){}}));
  const claim=value(await outbox.claimNext({kinds:['channel_delivery'],workerId:'worker:delivery',leaseToken:'delivery-lease',now:done,leaseExpiresAt:'2026-08-16T01:01:10.000Z'}));if(!claim.lease)throw Error('Missing delivery lease');
  value(await outbox.markUnknown({outboxId:request!.outboxIntents[0]!.outboxId,workerId:'worker:delivery',expectedAttempt:claim.lease.record.attempt,leaseToken:'delivery-lease',errorTag:'lost_ack',certainty:'unknown',observedAt:'2026-08-16T01:00:11.000Z'}));
  const held=snapshot();expect(value(await store.planRetention({settledBefore:cutoff,limit:1})).rows).toEqual([]);expect(snapshot()).toEqual(held);
  expect(value(await store.get(request!.runId))?.outboxIds).toEqual([request!.outboxIntents[0]!.outboxId]);
});
test('scheduled retention: legacy cleanup cannot bypass native plans or pending effect holds',async()=>{
  await seed(1,true);const held=snapshot();
  expect(value(await store.cleanupTerminal({settledBefore:cutoff,limit:1})).removed).toBe(0);
  expect(database.query('SELECT count(*) AS n FROM service_effect_s07_outbox_links').get()).toEqual({n:1});
  // Only the legacy cleanup receipt may be new; the run and its correlation survive.
  expect(snapshot().slice(0,8)).toEqual(held.slice(0,8));
  database.exec('CREATE TABLE piclaw_durable_bindings_v1(id INTEGER PRIMARY KEY)');
  const before=snapshot();expect(value(await store.cleanupTerminal({settledBefore:cutoff,limit:1})).removed).toBe(0);expect(snapshot()).toEqual(before); // Exact historic ACK remains valid.
  const result=await store.cleanupTerminal({settledBefore:'2026-08-18T00:00:00.000Z',limit:1});
  expect(result.ok).toBe(false);expect(!result.ok&&result.error._tag).toBe('invalid_transition');expect(snapshot()).toEqual(before);
});
for(const statement of ['tombstone_insert','retention_delete','decision_insert'] as const)test(`scheduled retention: ${statement} failure rolls back the exact page and receipt`,async()=>{
  await seed(2);const plan=value(await store.planRetention({settledBefore:cutoff,limit:2})),before=snapshot();fail=statement;
  expect((await store.applyRetention(plan)).ok).toBe(false);expect(snapshot()).toEqual(before);expect(value(await store.applyRetention(plan)).removed).toBe(2);
});
test('scheduled retention: changed plan, invalid cursor, and ignored tombstone refuse all deletion',async()=>{
  await seed(2);const plan=value(await store.planRetention({settledBefore:cutoff,limit:2})),before=snapshot();
  expect((await store.planRetention({settledBefore:cutoff,limit:101})).ok).toBe(false);
  expect((await store.applyRetention({...plan,rows:plan.rows.map((row,index)=>index?{...row,sha256:'0'.repeat(64)}:row)})).ok).toBe(false);expect(snapshot()).toEqual(before);
  database.exec("CREATE TEMP TRIGGER ignore_tombstone BEFORE INSERT ON service_effect_s07_tombstones BEGIN SELECT RAISE(IGNORE); END");
  try{expect((await store.applyRetention(plan)).ok).toBe(false);expect(snapshot()).toEqual(before);}finally{database.exec('DROP TRIGGER ignore_tombstone');}
  expect(value(await store.applyRetention(plan)).removed).toBe(2);
});

test('scheduled retention keeps its read snapshot and uses only the existing admitted writer',async()=>{
  await seed(2);const before=snapshot(),transaction=database.transaction.bind(database);let calls=0;
  const scope=spyOn(database,'transaction').mockImplementation((fn:any)=>{calls++;return transaction(fn);});
  try{
    const plan=value(await store.planRetention({settledBefore:cutoff,limit:2}));expect(calls).toBe(1);expect(plan.rows).toHaveLength(2);expect(snapshot()).toEqual(before);
    calls=0;const applied=value(await store.applyRetention(plan));expect(applied.removed).toBe(2);expect(calls).toBe(1);expect(database.inTransaction).toBe(false);
    calls=0;expect(value(await store.applyRetention(plan))).toEqual(applied);expect(calls).toBe(1);
    expect(value(await store.get(applied.runIds[0]!))?.retained).toBe(true);expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    const empty=value(await store.planRetention({settledBefore:cutoff,limit:2}));calls=0;expect(value(await store.applyRetention(empty))).toEqual({removed:0,runIds:[]});expect(calls).toBe(0);
  }finally{scope.mockRestore();}
});
