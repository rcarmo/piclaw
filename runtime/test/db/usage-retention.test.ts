import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { planUsageReportRetention, applyUsageReportRetention } from "../../src/db/usage-report-retention.js";
import { createTempWorkspace, setEnv } from "../helpers.js";
import { initDatabase, closeDatabase, getDb } from "../../src/db/connection.js";
import { storeTokenUsage, pruneOldTokenUsage, type TokenUsageRecord } from "../../src/db/token-usage.js";

let workspace: ReturnType<typeof createTempWorkspace>, restore:()=>void;
beforeEach(async()=>{workspace=createTempWorkspace("usage-retention-");restore=setEnv({PICLAW_WORKSPACE:workspace.workspace,PICLAW_STORE:workspace.store,PICLAW_DATA:workspace.data});await closeDatabase();initDatabase();});
afterEach(async()=>{await closeDatabase();restore();workspace.cleanup();});
const old="2000-01-01T00:00:00.000Z";
const usage=(overrides:Partial<TokenUsageRecord>={}):TokenUsageRecord=>({chat_jid:"web:retention",run_at:old,input_tokens:1,output_tokens:1,cache_read_tokens:0,cache_write_tokens:0,total_tokens:2,cost_input:0,cost_output:0,cost_cache_read:0,cost_cache_write:0,cost_total:0,...overrides});
function seed(count:number){getDb().transaction(()=>{for(let i=0;i<count;i++)storeTokenUsage(usage());}).immediate();}
const before="2026-01-01T00:00:00.000Z";
const snapshot=()=>getDb().query("SELECT * FROM token_usage ORDER BY id").all();
const historicalFinance=()=>['budget_work','budget_caps','budget_cap_revisions','budget_cap_windows','budget_request_reservations','budget_usage_events'].map(table=>getDb().query(`SELECT * FROM ${table} ORDER BY rowid`).all());
test("usage retention: dry-run, exact-page ACK replay and persisted cursor survive a disposable reopen",()=>{
  seed(7);storeTokenUsage(usage({usage_event_id:"retained-event"}));
  const database=getDb(), rows=snapshot(), events=database.query("SELECT * FROM budget_usage_events").all();
  const plan=planUsageReportRetention(database,{before,limit:2});expect(snapshot()).toEqual(rows);expect(plan.rows).toHaveLength(2);expect(plan.next).toBe(plan.rows[1]!.id);
  const path=join(workspace.store,"disposable.sqlite");writeFileSync(path,database.serialize(),{mode:0o600});
  let copy=new Database(path,{strict:true});
  try{
    const persisted=JSON.parse(JSON.stringify(plan));
    const first=applyUsageReportRetention(copy,persisted);expect(first.removed).toEqual(plan.rows.map(row=>row.id));expect(first.serializedBytesRemoved).toBe(plan.rows.reduce((sum,row)=>sum+row.serializedBytes,0));
    copy.close();copy=new Database(path,{strict:true,safeIntegers:true}); // Lost ACK: same exact IDs, never the next two rows.
    const again=applyUsageReportRetention(copy,persisted);expect(again.removed).toEqual([]);expect(again.alreadyAbsent).toEqual(first.removed);expect(again.next).toBe(plan.next);
    const next=planUsageReportRetention(copy,{before,after:plan.next!,limit:2});expect(next.rows[0]!.id).toBeGreaterThan(plan.rows[1]!.id);expect(applyUsageReportRetention(copy,next).removed).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(copy.query("SELECT * FROM budget_usage_events").all(),(_key,value)=>typeof value==="bigint"?Number(value):value))).toEqual(events);expect(copy.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(snapshot()).toEqual(rows); // The source restore is untouched.
  }finally{copy.close();}
});
test("usage retention: sole legacy spend evidence survives work lifetime and recorded calendar windows",()=>{
  const database=getDb();
  database.query("INSERT INTO budget_work(id,chat_jid,execution_kind,created_at,updated_at) VALUES ('long-lived-work','web:retention','background',?,?)").run(old,old);
  storeTokenUsage(usage({work_id:'long-lived-work',api_equivalent_cost_known:true,api_equivalent_cost_microusd:7}));
  storeTokenUsage(usage({run_at:'2000-02-01T00:00:00.000Z',api_equivalent_cost_known:true,api_equivalent_cost_microusd:11}));
  // Literal historical window, without installing a cap evaluator or recorder.
  database.query("INSERT INTO budget_caps(id,scope,metric,amount,timezone,created_at,updated_at) VALUES ('old-calendar','instance_monthly','api_usd_micros',100,'UTC',?,?)").run(old,old);
  database.query("INSERT INTO budget_cap_revisions(cap_id,revision,scope,metric,amount,enabled,timezone,recorded_at) VALUES ('old-calendar',1,'instance_monthly','api_usd_micros',100,1,'UTC',?)").run(old);
  database.query("INSERT INTO budget_cap_windows(cap_id,cap_revision,window_id,starts_at,ends_at,timezone,created_at) VALUES ('old-calendar',1,'historical-February-2000','2000-02-01T00:00:00.000Z','2000-03-01T00:00:00.000Z','UTC',?)").run(old);
  const records=snapshot(),history=historicalFinance();
  expect(planUsageReportRetention(database,{before}).rows).toEqual([]);expect(pruneOldTokenUsage()).toBe(0);
  expect(snapshot()).toEqual(records);expect(historicalFinance()).toEqual(history);
});
test("usage retention: newly recorded accounting window invalidates an approved page before deletion",()=>{
  storeTokenUsage(usage());storeTokenUsage(usage({run_at:'2000-02-01T00:00:00.000Z'}));
  const plan=planUsageReportRetention(getDb(),{before,limit:2});expect(plan.rows).toHaveLength(2);
  const database=getDb();
  database.query("INSERT INTO budget_caps(id,scope,metric,amount,timezone,created_at,updated_at) VALUES ('late-window','instance_daily','api_usd_micros',100,'UTC',?,?)").run(old,old);
  database.query("INSERT INTO budget_cap_revisions(cap_id,revision,scope,metric,amount,enabled,timezone,recorded_at) VALUES ('late-window',1,'instance_daily','api_usd_micros',100,1,'UTC',?)").run(old);
  database.query("INSERT INTO budget_cap_windows(cap_id,cap_revision,window_id,starts_at,ends_at,timezone,created_at) VALUES ('late-window',1,'historical-February-1-2000','2000-02-01T00:00:00.000Z','2000-02-02T00:00:00.000Z','UTC',?)").run(old);
  const rows=snapshot(),history=historicalFinance();expect(()=>applyUsageReportRetention(database,plan)).toThrow("became referenced");expect(snapshot()).toEqual(rows);expect(historicalFinance()).toEqual(history);
});
test("usage retention: changed report, mid-page fault and final revocation preserve the whole page",()=>{
  seed(3);const database=getDb(), plan=planUsageReportRetention(database,{before,limit:3});
  database.query("UPDATE token_usage SET cost_total=1 WHERE id=?").run(plan.rows[2]!.id);const changed=snapshot();
  expect(()=>applyUsageReportRetention(database,plan)).toThrow("plan changed");expect(snapshot()).toEqual(changed);
  const current=planUsageReportRetention(database,{before,limit:3});
  database.exec(`CREATE TEMP TRIGGER retention_fault BEFORE DELETE ON token_usage WHEN OLD.id=${current.rows[1]!.id} BEGIN SELECT RAISE(ABORT,'page fault'); END`);
  try{expect(()=>applyUsageReportRetention(database,current)).toThrow("page fault");expect(snapshot()).toEqual(changed);}finally{database.exec("DROP TRIGGER retention_fault");}
  let checks=0;expect(()=>applyUsageReportRetention(database,current,()=>{if(++checks===2)throw Error("revoked");})).toThrow("revoked");expect(snapshot()).toEqual(changed);
});
test("usage retention: malformed bounds/proofs and suppressed deletes cannot advance accounting",()=>{
  seed(3);const database=getDb(), plan=planUsageReportRetention(database,{before,limit:2}), rows=snapshot();
  for(const limit of [0,1001,NaN])expect(()=>planUsageReportRetention(database,{before,limit})).toThrow();
  expect(()=>planUsageReportRetention(database,{before:"yesterday"})).toThrow();
  expect(()=>applyUsageReportRetention(database,{...plan,next:999})).toThrow("cursor");
  expect(()=>applyUsageReportRetention(database,{...plan,rows:[...plan.rows].reverse()})).toThrow("proof");expect(snapshot()).toEqual(rows);
  database.exec(`CREATE TEMP TRIGGER retention_ignore BEFORE DELETE ON token_usage WHEN OLD.id=${plan.rows[0]!.id} BEGIN SELECT RAISE(IGNORE); END`);
  try{const result=applyUsageReportRetention(database,plan);expect(result.blocked).toEqual([plan.rows[0]!.id]);expect(result.removed).toEqual([plan.rows[1]!.id]);expect(result.next).toBe(plan.after);expect(result.serializedBytesRemoved).toBe(plan.rows[1]!.serializedBytes);}
  finally{database.exec("DROP TRIGGER retention_ignore");}
  expect(applyUsageReportRetention(database,plan).removed).toEqual([plan.rows[0]!.id]);
});
test("usage retention: examined pages advance past protected reports with an atomic restart cursor",()=>{
  const database=getDb();database.transaction(()=>{for(let i=0;i<1000;i++)storeTokenUsage(usage({usage_event_id:`keep-${i}`}));storeTokenUsage(usage());}).immediate();
  const beforeEvents=database.query("SELECT * FROM budget_usage_events ORDER BY usage_event_id").all();
  const page=planUsageReportRetention(database,{before,limit:1000});expect(page.examined).toBe(1000);expect(page.rows).toEqual([]);expect(page.next).toBe(1000);
  expect(pruneOldTokenUsage()).toBe(0);
  const cursor=database.query("SELECT value FROM router_state WHERE key='retention:legacy-usage-reports:v1'").get() as {value:string};expect(JSON.parse(cursor.value).after).toBe(1000);
  expect(pruneOldTokenUsage()).toBe(1);expect(database.query("SELECT value FROM router_state WHERE key='retention:legacy-usage-reports:v1'").get()).toBeNull();
  expect(database.query("SELECT * FROM budget_usage_events ORDER BY usage_event_id").all()).toEqual(beforeEvents);
});
test("usage retention: refused cursor publication rolls back deletion and malformed cursors preserve data",()=>{
  seed(1001);const database=getDb(),rows=snapshot();
  database.exec("CREATE TEMP TRIGGER ignore_retention_cursor BEFORE INSERT ON router_state WHEN NEW.key='retention:legacy-usage-reports:v1' BEGIN SELECT RAISE(IGNORE); END");
  try{expect(()=>pruneOldTokenUsage()).toThrow('cursor write refused');expect(snapshot()).toEqual(rows);}finally{database.exec('DROP TRIGGER ignore_retention_cursor');}
  for(const state of ['null','not-json',JSON.stringify({version:1,retentionDays:90,before:'2999-01-01T00:00:00.000Z',after:1})]){
    database.query("INSERT OR REPLACE INTO router_state(key,value) VALUES('retention:legacy-usage-reports:v1',?)").run(state);
    expect(()=>pruneOldTokenUsage()).toThrow();expect(snapshot()).toEqual(rows);
  }
});
test("usage retention: missing event or request records do not turn named evidence into anonymous cache",()=>{
  storeTokenUsage(usage());storeTokenUsage(usage({invocation_id:'missing-request'}));
  getDb().exec("UPDATE token_usage SET usage_event_id='missing-event' WHERE invocation_id IS NULL");
  const rows=snapshot(),plan=planUsageReportRetention(getDb(),{before});expect(plan.rows).toEqual([]);expect(applyUsageReportRetention(getDb(),plan).removed).toEqual([]);expect(snapshot()).toEqual(rows);
});
test("usage retention: malformed report dates remain retained evidence",()=>{
  storeTokenUsage(usage({run_at:'0000-bad'}));storeTokenUsage(usage());const plan=planUsageReportRetention(getDb(),{before,limit:2});expect(plan.examined).toBe(2);expect(plan.rows).toHaveLength(1);
  expect(applyUsageReportRetention(getDb(),plan).removed).toHaveLength(1);expect(getDb().query('SELECT run_at FROM token_usage').all()).toEqual([{run_at:'0000-bad'}]);
});
test("usage retention: startup compatibility cleanup is bounded to one thousand reports",()=>{
  seed(1001);
  expect(pruneOldTokenUsage()).toBe(1000);
  expect(getDb().query("SELECT count(*) AS n FROM token_usage").get()).toEqual({n:1});
});
test("usage retention: unresolved work protects legacy reports even without an invocation link",()=>{
  getDb().query("INSERT INTO budget_work(id,chat_jid,execution_kind,created_at,updated_at) VALUES ('held-work','web:retention','background',?,?)").run(old,old);
  getDb().query("INSERT INTO budget_request_reservations(id,work_id,chat_jid,provider_id,model_id,account_ref,binding_sha256,amount_microusd,state,created_at,updated_at) VALUES ('held-request','held-work','web:retention','fixture','fixture','synthetic',?,1,'reserved',?,?)").run('a'.repeat(64),old,old);
  storeTokenUsage(usage({work_id:"held-work"}));storeTokenUsage(usage());
  const before=getDb().query("SELECT * FROM budget_request_reservations").all();
  expect(pruneOldTokenUsage()).toBe(1);
  expect(getDb().query("SELECT work_id FROM token_usage").all()).toEqual([{work_id:"held-work"}]);
  expect(getDb().query("SELECT * FROM budget_request_reservations").all()).toEqual(before);
});
