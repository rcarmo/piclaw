import {installHistoricalExpenseFixture} from '../../runtime/test/fixtures/historical-expense.js';
import { expect } from "bun:test";
import { Database } from "bun:sqlite";
import { copyFileSync, constants, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { captureNativeRecoveryUnit, fingerprintSqliteTables, type RecoveryEnvironment, type RecoveryCaptureOptions } from "../../runtime/scripts/lib/native-recovery-unit.js";
import { measureRetentionStorage } from "../../runtime/scripts/lib/retention-storage-inventory.js";
import { qualifyNativeRecoveryUnit } from "../../runtime/durable-engine/src/recovery-unit-qualification.js";
import { createVerifiedSqliteBackup } from "../../runtime/src/db/backup.js";
import { storeTokenUsage, type TokenUsageRecord } from "../../runtime/src/db/token-usage.js";
import { planUsageReportRetention, applyUsageReportRetention } from "../../runtime/src/db/usage-report-retention.js";
import { nativeToolOutputRetentionHeld } from "../../runtime/src/db/tool-outputs.js";
import { createCurrentPiclawScheduledRunStore } from "../../runtime/src/service-effects/current-piclaw/scheduled-run-store.js";
import { scheduledResultRef } from "../../runtime/src/service-effects/current-piclaw/scheduled-history-projection.js";
import { createScheduledTaskAuthority } from "../../runtime/src/service-effects/current-piclaw/scheduled-task-authority.js";
import { definitionRef, insertScheduledDefinition, type ScheduledTaskDefinitionBody } from "../../runtime/src/db/scheduled-task-definitions.js";
import { createMediaInDatabase, attachMediaToMessageInDatabase } from "../../runtime/src/db/media.js";
import { hashCanonicalRequest, type CanonicalJsonValue } from "../../runtime/src/service-effects/contracts/common.js";
import type { CompleteScheduledRunRequest } from "../../runtime/src/service-effects/contracts/scheduled-run-store.js";
import type { Result } from "../../runtime/src/service-effects/contracts/result.js";
const value=<T,E>(result:Result<T,E>):T=>{if(!result.ok)throw Error(JSON.stringify(result.error));return result.value;};

/** Literal historical fixture data only; no cap evaluator, reservation owner,
 * financial settlement, schema mutation or execution permission is installed. */
export function seedRetentionHistoryFixture(database:Database){
  installHistoricalExpenseFixture(database);
  const old="2000-01-01T00:00:00.000Z",recorded="2001-02-15T00:00:00.000Z";
  const usage:TokenUsageRecord={chat_jid:"web:default",run_at:old,input_tokens:1,output_tokens:1,cache_read_tokens:0,cache_write_tokens:0,total_tokens:2,cost_input:0,cost_output:0,cost_cache_read:0,cost_cache_write:0,cost_total:0};
  for(let i=0;i<5;i++)storeTokenUsage(usage,database);
  database.query("INSERT INTO budget_work(id,chat_jid,execution_kind,scheduled_task_id,created_at,updated_at) VALUES ('retention-held-work','web:default','scheduled','retention-fixture:3',?,?),('retention-long-work','web:default','background',NULL,?,?)").run(old,old,old,old);
  database.query("INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at) VALUES ('retention-held-request','retention-held-work','web:default','fixture','fixture','synthetic',?,1,'reserved',?,?)").run("a".repeat(64),old,old);
  storeTokenUsage({...usage,work_id:"retention-held-work"},database);
  storeTokenUsage({...usage,work_id:"retention-long-work"},database);
  storeTokenUsage({...usage,run_at:"2001-02-01T00:00:00.000Z"},database);
  database.query("INSERT INTO budget_caps(id,scope,metric,amount,timezone,created_at,updated_at) VALUES ('retention-recorded-window','instance_monthly','api_usd_micros',100,'UTC',?,?)").run(recorded,recorded);
  database.query("INSERT INTO budget_cap_revisions(cap_id,revision,scope,metric,amount,enabled,timezone,recorded_at) VALUES ('retention-recorded-window',1,'instance_monthly','api_usd_micros',100,1,'UTC',?)").run(recorded);
  database.query("INSERT INTO budget_cap_windows(cap_id,cap_revision,window_id,starts_at,ends_at,timezone,created_at) VALUES ('retention-recorded-window',1,'historical-February-2001','2001-02-01T00:00:00.000Z','2001-03-01T00:00:00.000Z','UTC',?)").run(recorded);
}

/** Full native/import/review/unknown-outbox checkpoint prepared by the existing
 * actual factory fixture. Maintenance below touches only its disposable copy. */
export async function qualifyNativeRetentionUnit(unit:string,environment:RecoveryEnvironment,payloads:Pick<RecoveryCaptureOptions,"answers"|"workspace"|"externalPayloads">){
  const parent=dirname(unit),path=join(parent,"retention-candidate.sqlite");copyFileSync(join(unit,"database.sqlite"),path,constants.COPYFILE_EXCL);
  const database=new Database(path,{strict:true});database.exec("PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL");
  const beforePath=join(parent,"retention-before.sqlite"),afterPath=join(parent,"retention-after.sqlite");
  let before:ReturnType<typeof measureRetentionStorage>,after:ReturnType<typeof measureRetentionStorage>;
  try{
    const old="2000-01-01T00:00:00.000Z",cutoff="2026-01-01T00:00:00.000Z";
    seedRetentionHistoryFixture(database);
    // Raw cache data has no qualified native reference-retirement inventory.
    // It stays retained even when metadata looks expired and unowned.
    database.query("INSERT INTO tool_outputs(id,created_at,summary) VALUES('retained-history-cache',?,'retained archive dependency')").run(old);
    database.query("INSERT INTO tool_outputs_fts(content,output_id) VALUES('retained full cached output','retained-history-cache')").run();
    const media=createMediaInDatabase(database,"retained.png","image/png",new Uint8Array([137,80,78,71]),null,null,old);
    const message=database.query("SELECT rowid AS id FROM messages ORDER BY rowid LIMIT 1").get() as {id:number};attachMediaToMessageInDatabase(database,message.id,[media],{index:false});
    const scheduler=value(createCurrentPiclawScheduledRunStore(database,{hitFault(){return false;},recordTrace(){}})),authority=createScheduledTaskAuthority(database);
    for(let i=0;i<7;i++){
      const body:ScheduledTaskDefinitionBody={version:1,id:`retention-fixture:${i}`,revision:1,chat_jid:"web:default",prompt:"synthetic completed shell",model:null,task_kind:"shell",command:"exit 1",cwd:null,timeout_sec:null,notify_on_complete:false,schedule_type:i===6?"interval":"once",schedule_value:i===6?"60000":old,created_at:"1999-01-01T00:00:00.000Z"};
      const snapshot=authority.create({taskId:body.id,chatJid:body.chat_jid,kind:"shell",payloadRef:definitionRef(body),modelLabel:null,scheduleType:body.schedule_type,scheduleValue:body.schedule_value,timezone:"UTC",notifyOnComplete:false,muted:true,cwd:null,timeoutSec:null,internalTask:null,redactionClass:"private",executionRepeatability:"repeatable",nextRunAt:old,authoredAt:body.created_at});
      insertScheduledDefinition(database,snapshot,body,"authored",body.created_at);
    }
    const leases=value(await scheduler.claimDue({now:old,limit:7,workerId:"fixture:owner",leaseTokenPrefix:"fixture:retention",leaseDurationMs:60000,reclaimAuthorities:[]}));expect(leases).toHaveLength(7);
    authority.pause("retention-fixture:6");
    const completions:CompleteScheduledRunRequest[]=leases.map((lease,index)=>{
      const effect={idempotencyKey:`retention-completion:${index}`,requestHash:"",operationId:null,sourceSeq:null,provenanceRef:"fixture:retention",redactionClass:"private" as const};
      const request:CompleteScheduledRunRequest={effect,runId:lease.record.runId,workerId:lease.record.workerId,expectedAttempt:lease.record.attempt,expectedTaskRevision:lease.record.taskRevision,leaseToken:lease.leaseToken,now:"2000-01-01T00:00:10.000Z",status:index===2||index===4?"success":"error",durationMs:10,resultRef:index===2?"opaque:must-retain":index===4?scheduledResultRef(lease.record.runId):null,errorCode:index===2||index===4?null:"fixture_error",completedAt:"2000-01-01T00:00:10.000Z",outboxIntents:[],...(index===4?{resultPayload:{version:1 as const,result:"retained linked host payload",error:null}}:index===5?{resultPayload:{version:1 as const,result:null,error:"retained linked host error"}}:{})};
      effect.requestHash=hashCanonicalRequest(request as unknown as CanonicalJsonValue);return request;
    });for(const request of completions)value(await scheduler.complete(request));
    const preserved=["conversations","entries","tasks","submissions","documents","document_revisions","record_ids","piclaw_durable_bindings_v1","piclaw_durable_intent_bindings_v1",
      "task_run_logs","host_scheduled_task_definitions","service_effect_s01_sources","service_effect_s01_operations","service_effect_s01_operation_sources","service_effect_s02_commits","service_effect_s05_outbox","budget_work","budget_caps","budget_cap_revisions","budget_cap_windows","budget_request_reservations","budget_usage_events","tool_outputs","tool_outputs_fts","media","message_media",
      ...(database.query("SELECT name FROM sqlite_schema WHERE type='table' AND name GLOB 'addon_code_review_*'").all() as {name:string}[]).map(row=>row.name)];
    const identity=fingerprintSqliteTables(database,preserved);
    const legacy=await scheduler.cleanupTerminal({settledBefore:cutoff,limit:100});expect(legacy.ok).toBe(false);expect(!legacy.ok&&legacy.error._tag).toBe('invalid_transition');
    expect(fingerprintSqliteTables(database,preserved)).toBe(identity);
    expect(nativeToolOutputRetentionHeld(database)).toBe(true);
    createVerifiedSqliteBackup(database,path,beforePath);before=measureRetentionStorage(beforePath);
    let cursor=0,removed=0;
    do{const plan=planUsageReportRetention(database,{before:cutoff,after:cursor,limit:2});expect(plan.examined).toBeLessThanOrEqual(2);
      const persisted=JSON.parse(JSON.stringify(plan)),result=applyUsageReportRetention(database,persisted);removed+=result.removed.length;
      expect(applyUsageReportRetention(database,persisted).removed).toEqual([]);if(plan.next===null)break;cursor=plan.next;
    }while(true);
    expect(removed).toBe(5);expect(database.query("SELECT work_id FROM token_usage WHERE run_at=? ORDER BY id").all(old)).toEqual([{work_id:"retention-held-work"},{work_id:'retention-long-work'}]);
    expect(database.query("SELECT run_at FROM token_usage WHERE work_id IS NULL").all()).toEqual([{run_at:'2001-02-01T00:00:00.000Z'}]);
    let position=value(await scheduler.planRetention({settledBefore:cutoff,limit:1}));
    let retired=0;
    while(true){const result=value(await scheduler.applyRetention(position));retired+=result.removed;expect(value(await scheduler.applyRetention(JSON.parse(JSON.stringify(position))))).toEqual(result);
      if(position.nextCursor===null)break;position=value(await scheduler.planRetention({settledBefore:cutoff,limit:1,after:position.nextCursor}));}
    expect(retired).toBe(2);expect(value(await scheduler.get(completions[2]!.runId))?.retained).toBe(false);
    for(const index of [3,4,5,6])expect(value(await scheduler.get(completions[index]!.runId))?.retained).toBe(false);
    expect(value(await scheduler.complete(completions[0]!)).retained).toBe(true);
    expect(fingerprintSqliteTables(database,preserved)).toBe(identity);
    expect(database.query("SELECT state,certainty FROM service_effect_s05_outbox WHERE outbox_id='uncertain'").get()).toEqual({state:"unknown",certainty:"unknown"});
    expect(database.query("PRAGMA foreign_key_check").all()).toEqual([]);
    createVerifiedSqliteBackup(database,path,afterPath);after=measureRetentionStorage(afterPath);
    expect(before.classes["usage-reports"]!.rows-after.classes["usage-reports"]!.rows).toBe(5);
    expect(after.classes["usage-reports"]!.logicalValueBytes).toBeLessThan(before.classes["usage-reports"]!.logicalValueBytes);
    for(const key of ["sdk-history-and-provenance","sdk-execution-identities","accounting-and-holds","native-admission-effects","saved-code-review","media-and-links","tool-output-cache-and-handles"])
      expect(after.classes[key]).toEqual(before.classes[key]);
  }finally{database.close();}
  const renewed=join(parent,"retention-recovery-unit");await captureNativeRecoveryUnit({database:afterPath,output:renewed,environment,...payloads});
  const qualified=await qualifyNativeRecoveryUnit(renewed,environment,join(parent,"retention-qualified"));expect(qualified.scheduling).toBe("paused");expect(qualified.credentialReads).toBe(0);
  const report={before:before!,after:after!,note:"Logical measurements on disposable snapshots; no VACUUM or file-size reclaim promise. Authoritative history/holds/uncertain effects/cache handles retained."};
  writeFileSync(join(parent,"retention-measurements.json"),JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
  console.log("RETENTION_STORAGE "+JSON.stringify(report));
}
