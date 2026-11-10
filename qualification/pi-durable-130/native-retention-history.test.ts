import {historicalExpenseRows} from '../../runtime/test/fixtures/historical-expense.js';
import './src/test-guard.js';
import {installHistoricalExpenseFixture} from '../../runtime/test/fixtures/historical-expense.js';
import {createCurrentPiclawScheduledRunStore} from '../../runtime/src/service-effects/current-piclaw/scheduled-run-store.js';
import {createScheduledTaskAuthority} from '../../runtime/src/service-effects/current-piclaw/scheduled-task-authority.js';
import {hashCanonicalRequest,type CanonicalJsonValue} from '../../runtime/src/service-effects/contracts/common.js';
import type {CompleteScheduledRunRequest} from '../../runtime/src/service-effects/contracts/scheduled-run-store.js';
import {definitionRef,insertScheduledDefinition,type ScheduledTaskDefinitionBody} from '../../runtime/src/db/scheduled-task-definitions.js';
import type {Result} from '../../runtime/src/service-effects/contracts/result.js';
const value=<T,E>(result:Result<T,E>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};
import {expect,test} from 'bun:test';
import {nativeMessageFixture} from './src/native-message-fixture.js';
import {seedRetentionHistoryFixture} from './native-retention-unit-fixture.js';
import {planUsageReportRetention,applyUsageReportRetention} from '../../runtime/src/db/usage-report-retention.js';

test('native shared database retains scheduled references across all historical states without executing SDK work',async()=>{
  const f=await nativeMessageFixture();
  try{
    const sdk=f.sdkSnapshot(),store=value(createCurrentPiclawScheduledRunStore(f.root,{hitFault(){return false;},recordTrace(){}})),authority=createScheduledTaskAuthority(f.root);
    const instant='2026-01-01T00:00:00.000Z',done='2026-01-01T00:00:10.000Z',states=['reserved','dispatched','unresolved','settled','released','no-reservation'];
    for(let i=0;i<=states.length;i++){
      const body:ScheduledTaskDefinitionBody={version:1,id:`history-ref:${i}`,revision:1,chat_jid:f.chat,prompt:'synthetic terminal shell',model:null,task_kind:'shell',command:'exit 1',cwd:null,timeout_sec:null,notify_on_complete:false,schedule_type:'once',schedule_value:instant,created_at:instant};
      const snapshot=authority.create({taskId:body.id,chatJid:f.chat,kind:'shell',payloadRef:definitionRef(body),modelLabel:null,scheduleType:'once',scheduleValue:instant,timezone:'UTC',notifyOnComplete:false,muted:true,cwd:null,timeoutSec:null,internalTask:null,redactionClass:'private',executionRepeatability:'repeatable',nextRunAt:instant,authoredAt:instant});
      insertScheduledDefinition(f.root,snapshot,body,'authored',instant);
    }
    const leases=value(await store.claimDue({now:instant,limit:100,workerId:'reference-fixture',leaseTokenPrefix:'reference',leaseDurationMs:60000,reclaimAuthorities:[]}));expect(leases).toHaveLength(7);
    for(const lease of leases){
      const effect={idempotencyKey:`complete:${lease.record.runId}`,requestHash:'',operationId:null,sourceSeq:null,provenanceRef:'fixture:references',redactionClass:'private' as const};
      const request:CompleteScheduledRunRequest={effect,runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:lease.record.attempt,expectedTaskRevision:lease.record.taskRevision,leaseToken:lease.leaseToken,now:done,status:'error',durationMs:10,resultRef:null,errorCode:'fixture',completedAt:done,outboxIntents:[]};
      effect.requestHash=hashCanonicalRequest(request as unknown as CanonicalJsonValue);value(await store.complete(request));
    }
    installHistoricalExpenseFixture(f.root);
    for(let i=0;i<states.length;i++){
      f.root.query("INSERT INTO budget_work(id,chat_jid,execution_kind,scheduled_task_id,created_at,updated_at) VALUES (?,?,'scheduled',?,?,?)").run(`work:${i}`,f.chat,leases[i]!.record.taskId,instant,instant);
      if(states[i]!=='no-reservation')f.root.query('INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,state,created_at,updated_at,settlement_sha256,usage_event_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(`request:${i}`,`work:${i}`,f.chat,'fixture','fixture','opaque-history','a'.repeat(64),states[i]!,instant,instant,states[i]==='settled'?'b'.repeat(64):null,states[i]==='settled'?`old-event:${i}`:null);
    }
    const history=()=>historicalExpenseRows(f.root,['budget_work','budget_request_reservations','budget_usage_events']),before=history(),schema=f.root.query('SELECT type,name,sql FROM main.sqlite_schema ORDER BY type,name').all();
    const plan=value(await store.planRetention({settledBefore:'2026-01-02T00:00:00.000Z',limit:100}));expect(plan.rows.map(row=>row.runId)).toEqual([leases[6]!.record.runId]);
    const result=value(await store.applyRetention(plan));expect(result.removed).toBe(1);expect(value(await store.applyRetention(JSON.parse(JSON.stringify(plan))))).toEqual(result);
    for(const lease of leases.slice(0,6))expect(value(await store.get(lease.record.runId))?.retained).toBe(false);
    expect(history()).toEqual(before);expect(f.sdkSnapshot()).toEqual(sdk);expect(f.root.query('SELECT type,name,sql FROM main.sqlite_schema ORDER BY type,name').all()).toEqual(schema);
    expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);expect(f.base.host.modelCalls).toBe(0);expect(f.base.host.credentialLookups).toBe(0);
  }finally{await f.close();}
},12000);

// This proves the literal seed/protected-history part of the larger offline
// recovery fixture. It does NOT certify its factory/capture/restore aggregate.
test('retention fixture keeps historical work, holds, caps and recorded windows inert while retiring only unlinked observations',async()=>{
  const f=await nativeMessageFixture();
  try{
    const sdk=f.sdkSnapshot();seedRetentionHistoryFixture(f.root);
    const schema=f.root.query('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all();
    const history=()=>historicalExpenseRows(f.root,['budget_work','budget_caps','budget_cap_revisions','budget_cap_windows','budget_request_reservations','budget_usage_events']);
    const original=history();
    expect(f.root.query('SELECT count(*) n FROM token_usage').get()).toEqual({n:8});
    expect(f.root.query('SELECT state,terminal_receipt_json FROM budget_request_reservations').all()).toEqual([{state:'reserved',terminal_receipt_json:null}]);
    let cursor=0,removed=0;
    for(;;){
      const plan=planUsageReportRetention(f.root,{before:'2026-01-01T00:00:00.000Z',after:cursor,limit:2});
      expect(plan.examined).toBeLessThanOrEqual(2);
      const data=JSON.parse(JSON.stringify(plan)),result=applyUsageReportRetention(f.root,data);removed+=result.removed.length;
      expect(applyUsageReportRetention(f.root,data).removed).toEqual([]);
      if(plan.next===null)break;cursor=plan.next;
    }
    expect(removed).toBe(5);
    expect(f.root.query('SELECT work_id,run_at FROM token_usage ORDER BY id').all()).toEqual([
      {work_id:'retention-held-work',run_at:'2000-01-01T00:00:00.000Z'},
      {work_id:'retention-long-work',run_at:'2000-01-01T00:00:00.000Z'},
      {work_id:null,run_at:'2001-02-01T00:00:00.000Z'},
    ]);
    expect(history()).toEqual(original);expect(f.sdkSnapshot()).toEqual(sdk);
    expect(f.root.query('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').all()).toEqual(schema);
    expect(f.root.query('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(f.base.host.modelCalls).toBe(0);expect(f.base.host.credentialLookups).toBe(0);
  }finally{await f.close();}
},12000);
